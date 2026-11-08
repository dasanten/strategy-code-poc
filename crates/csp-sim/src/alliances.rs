//! Alliances (`apps/server/src/alliances.ts`, `CONTEXT.md`: Alliance, Alliance leader, Alliance
//! army, NPC city in an alliance): the alliance orders, members leaving, and one tick of alliances.
//!
//! The orders are agreements between Players, not physical actions: they change the alliance
//! records, plain data (ADR 0002). Each is checked when it arrives and again when it applies.
//! Where the TypeScript compares objects (`world.alliances.includes(alliance)`, `parts.includes`),
//! this compares ids, which are unique.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{ALLIANCE_LEAVE_DELAY, ALLIANCE_RECALL_DELAY};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Alliance, AllianceArmyPart, AllianceArmyPartIs, AllianceLeftWhy, AllianceMember, Leaving,
    OrderRequest, RealmEventWhat, WorldState,
};

use crate::queries::alliance::{alliance_of, carriage_commander_of, commander_of, handed_over_to};
use crate::queries::alliance_rules::{
    is_alliance_city, npc_city_accepts, npc_city_wants_out, ALLIANCE_NAME_MAX_LENGTH,
};
use crate::queries::carriages::driven_carriage_id;
use crate::queries::residents::is_armed;
use crate::random::new_id;
use crate::realm_pending::{
    leave_armies, organization_label, realm_name, realm_of, record_event, str_field, OrderKind,
    OrderSender,
};

type Check = fn(&WorldState, &str, &OrderRequest) -> Option<String>;
type Act = fn(&mut WorldState, &str, &OrderRequest);

/// An order that only needs the sender's realm (`allianceOrder`): `check` gives a reason to reject
/// it, `act` carries it out.
pub struct AllianceOrder {
    check: Check,
    act: Act,
}

impl OrderKind for AllianceOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_of(world, sender.user_id) else {
            return Some("you have no realm".into());
        };
        (self.check)(world, &realm.id, order)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some(realm_id) = realm_of(world, sender.user_id).map(|r| r.id.clone()) else { return };
        if (self.check)(world, &realm_id, order).is_none() {
            (self.act)(world, &realm_id, order);
        }
    }
}

fn index_of(world: &WorldState, alliance_id: &str) -> Option<usize> {
    world.alliances.iter().position(|a| a.id == alliance_id)
}

fn alliance_index_of(world: &WorldState, realm_id: &str) -> Option<usize> {
    alliance_of(world, realm_id).and_then(|a| index_of(world, &a.id))
}

/// The alliance the realm leads, or a reason it can't act as an alliance leader (`ledBy`).
fn led_by<'w>(world: &'w WorldState, realm_id: &str) -> Result<&'w Alliance, String> {
    let alliance = alliance_of(world, realm_id).ok_or("you are in no alliance")?;
    if alliance.leader_id != realm_id {
        return Err("only the alliance leader can do that".into());
    }
    Ok(alliance)
}

/// The order's name trimmed, as `String.prototype.trim` does.
fn trimmed_name(order: &OrderRequest) -> String {
    str_field(order, "name").map(|n| n.trim().to_string()).unwrap_or_default()
}

/// Founding an alliance (`foundAlliance`): the realm becomes its only member and its leader.
pub const FOUND_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        if alliance_of(world, realm_id).is_some() {
            return Some("you are already in an alliance".into());
        }
        let name = trimmed_name(order);
        // `name.length` counts UTF-16 code units.
        let length = name.encode_utf16().count();
        if length == 0 {
            return Some("the alliance needs a name".into());
        }
        if length > ALLIANCE_NAME_MAX_LENGTH {
            return Some(format!(
                "an alliance name is at most {ALLIANCE_NAME_MAX_LENGTH} characters"
            ));
        }
        None
    },
    act: |world, realm_id, order| {
        let id = new_id("alliance", &mut world.next_id);
        world.alliances.push(Alliance {
            id,
            name: trimmed_name(order),
            leader_id: realm_id.to_string(),
            members: vec![AllianceMember {
                realm_id: realm_id.to_string(),
                joined_at: world.tick as f64,
                leaving: None,
            }],
            invites: Vec::new(),
            army: Vec::new(),
        });
        drop_invites_to(world, realm_id);
    },
};

/// The alliance leader invites a realm or an NPC city in no alliance (`inviteToAlliance`). An NPC
/// city answers at once (`answer_as_city`).
pub const INVITE_TO_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        let alliance = match led_by(world, realm_id) {
            Ok(a) => a,
            Err(e) => return Some(e),
        };
        let id = str_field(order, "realmId");
        let known = id.is_some_and(|id| {
            world.realms.iter().any(|r| r.id == id) || is_alliance_city(world, id)
        });
        let Some(id) = id.filter(|_| known) else {
            return Some("no such realm or NPC city".into());
        };
        if alliance_of(world, id).is_some() {
            return Some("they are already in an alliance".into());
        }
        if alliance.invites.iter().any(|x| x == id) {
            return Some("already invited".into());
        }
        None
    },
    act: |world, realm_id, order| {
        let a = alliance_index_of(world, realm_id).expect("the leader's alliance");
        let id = str_field(order, "realmId").expect("checked").to_string();
        if is_alliance_city(world, &id) {
            return answer_as_city(world, a, &id);
        }
        world.alliances[a].invites.push(id.clone());
        let what = RealmEventWhat::AllianceInvited {
            alliance_id: world.alliances[a].id.clone(),
            name: world.alliances[a].name.clone(),
        };
        record_event(world, Some(&id), what);
    },
};

/// The NPC city `city_id` answers the alliance's invitation: it joins or declines
/// (`answerAsCity`).
fn answer_as_city(world: &mut WorldState, a: usize, city_id: &str) {
    let (alliance_id, name) = (world.alliances[a].id.clone(), world.alliances[a].name.clone());
    let realm = organization_label(world, city_id);
    if !npc_city_accepts(world, city_id, &world.alliances[a]) {
        let leader = world.alliances[a].leader_id.clone();
        let what = RealmEventWhat::AllianceDeclined {
            alliance_id,
            name,
            realm_id: city_id.to_string(),
            realm,
        };
        record_event(world, Some(&leader), what);
        return;
    }
    let joined_at = world.tick as f64;
    world.alliances[a].members.push(AllianceMember {
        realm_id: city_id.to_string(),
        joined_at,
        leaving: None,
    });
    let what = RealmEventWhat::AllianceJoined {
        alliance_id,
        name,
        realm_id: city_id.to_string(),
        realm,
        city: Some(true),
    };
    tell_members(world, a, what);
}

/// The alliance leader takes back an invitation not yet answered (`withdrawInvite`).
pub const WITHDRAW_INVITE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        let alliance = match led_by(world, realm_id) {
            Ok(a) => a,
            Err(e) => return Some(e),
        };
        let id = str_field(order, "realmId");
        (!alliance.invites.iter().any(|x| Some(x.as_str()) == id))
            .then(|| "that realm is not invited".into())
    },
    act: |world, realm_id, order| {
        let a = alliance_index_of(world, realm_id).expect("the leader's alliance");
        let id = str_field(order, "realmId");
        world.alliances[a].invites.retain(|x| Some(x.as_str()) != id);
    },
};

/// The invitation the realm holds from the alliance `allianceId`, or why it holds none
/// (`invitation`).
fn invitation(world: &WorldState, realm_id: &str, order: &OrderRequest) -> Result<usize, String> {
    let id = str_field(order, "allianceId");
    world
        .alliances
        .iter()
        .position(|a| Some(a.id.as_str()) == id && a.invites.iter().any(|x| x == realm_id))
        .ok_or_else(|| "you hold no such invitation".into())
}

/// Accepting an invitation (`acceptInvite`): the realm joins as the newest member; its other
/// invitations lapse.
pub const ACCEPT_INVITE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        if let Err(e) = invitation(world, realm_id, order) {
            return Some(e);
        }
        alliance_of(world, realm_id).is_some().then(|| "you are already in an alliance".into())
    },
    act: |world, realm_id, order| {
        let a = invitation(world, realm_id, order).expect("checked");
        let joined_at = world.tick as f64;
        world.alliances[a].members.push(AllianceMember {
            realm_id: realm_id.to_string(),
            joined_at,
            leaving: None,
        });
        drop_invites_to(world, realm_id);
        let what = RealmEventWhat::AllianceJoined {
            alliance_id: world.alliances[a].id.clone(),
            name: world.alliances[a].name.clone(),
            realm_id: realm_id.to_string(),
            realm: realm_name(world, realm_id),
            city: None,
        };
        tell_members(world, a, what);
    },
};

/// Declining an invitation (`declineInvite`): it is gone, and the realm stays out.
pub const DECLINE_INVITE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| invitation(world, realm_id, order).err(),
    act: |world, realm_id, order| {
        let a = invitation(world, realm_id, order).expect("checked");
        world.alliances[a].invites.retain(|x| x != realm_id);
    },
};

/// The realm's own membership, to change.
fn member_mut<'w>(
    world: &'w mut WorldState,
    realm_id: &str,
    of: &str,
) -> Option<&'w mut AllianceMember> {
    let a = alliance_index_of(world, realm_id)?;
    world.alliances[a].members.iter_mut().find(|m| m.realm_id == of)
}

/// Leaving the alliance (`leaveAlliance`): the realm stops being a member after the leave delay.
pub const LEAVE_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, _order| {
        let member = alliance_of(world, realm_id)
            .and_then(|a| a.members.iter().find(|m| m.realm_id == realm_id));
        match member {
            None => Some("you are in no alliance".into()),
            Some(m) if m.leaving.is_some() => Some("you are already leaving".into()),
            Some(_) => None,
        }
    },
    act: |world, realm_id, _order| {
        let at = world.tick as f64 + ALLIANCE_LEAVE_DELAY;
        let m = member_mut(world, realm_id, realm_id).expect("checked");
        m.leaving = Some(Leaving { at, removed: false });
    },
};

/// The alliance leader removes a member (`removeFromAlliance`); it goes after the leave delay.
pub const REMOVE_FROM_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        let alliance = match led_by(world, realm_id) {
            Ok(a) => a,
            Err(e) => return Some(e),
        };
        let id = str_field(order, "realmId");
        if id == Some(realm_id) {
            return Some("to go yourself, leave the alliance".into());
        }
        match alliance.members.iter().find(|m| Some(m.realm_id.as_str()) == id) {
            None => Some("that realm is not a member".into()),
            Some(m) if m.leaving.is_some() => Some("that realm is already leaving".into()),
            Some(_) => None,
        }
    },
    act: |world, realm_id, order| {
        let at = world.tick as f64 + ALLIANCE_LEAVE_DELAY;
        let id = str_field(order, "realmId").expect("checked");
        let m = member_mut(world, realm_id, id).expect("checked");
        m.leaving = Some(Leaving { at, removed: true });
    },
};

/// The realm's alliance, or why it can't hand over or recall (`standingMember`).
fn standing_member<'w>(world: &'w WorldState, realm_id: &str) -> Result<&'w Alliance, String> {
    let alliance = alliance_of(world, realm_id);
    let member = alliance.and_then(|a| a.members.iter().find(|m| m.realm_id == realm_id));
    match (alliance, member) {
        (Some(_), Some(m)) if m.leaving.is_some() => Err("you are leaving the alliance".into()),
        (Some(a), Some(_)) => Ok(a),
        _ => Err("you are in no alliance".into()),
    }
}

/// The ids in `order[key]` (`idList`): none for a missing or null field; None when that is not a
/// list of distinct strings.
fn id_list(order: &OrderRequest, key: &str) -> Option<Vec<String>> {
    let v = match order.fields.get(key) {
        None | Some(serde_json::Value::Null) => return Some(Vec::new()),
        Some(v) => v,
    };
    let ids: Vec<String> =
        v.as_array()?.iter().map(|x| x.as_str().map(str::to_string)).collect::<Option<_>>()?;
    let distinct: HashSet<&String> = ids.iter().collect();
    (distinct.len() == ids.len()).then_some(ids)
}

/// Handing over soldiers and carriages to the alliance army (`handOverToAlliance`): they stay the
/// realm's but take orders only from the alliance leader. They stop and leave any army.
pub const HAND_OVER_TO_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        if let Err(e) = standing_member(world, realm_id) {
            return Some(e);
        }
        let (Some(resident_ids), Some(carriage_ids)) =
            (id_list(order, "residentIds"), id_list(order, "carriageIds"))
        else {
            return Some("name each soldier and carriage once".into());
        };
        if resident_ids.len() + carriage_ids.len() == 0 {
            return Some("hand over at least one".into());
        }
        for id in &resident_ids {
            let Some(r) = world
                .residents
                .iter()
                .find(|x| x.id == *id)
                .filter(|r| r.owner.as_deref() == Some(realm_id))
            else {
                return Some("not all of them are your residents".into());
            };
            if world.realms.iter().any(|x| x.leader_id == *id) {
                return Some(format!("{} is your Leader", r.name));
            }
            if handed_over_to(world, id).is_some() {
                return Some(format!("{} is already in the alliance army", r.name));
            }
            if world.contracts.iter().any(|c| c.resident_ids.contains(id)) {
                return Some(format!("{} is in a mercenary contract", r.name));
            }
            if !is_armed(&r.carried) {
                return Some(format!("{} is not a soldier: they carry no weapon", r.name));
            }
        }
        for id in &carriage_ids {
            let k = world.carriages.iter().find(|x| x.id == *id);
            if k.is_none_or(|k| k.realm_id.as_deref() != Some(realm_id)) {
                return Some("not all of them are your carriages".into());
            }
            if handed_over_to(world, id).is_some() {
                return Some("that carriage is already in the alliance army".into());
            }
        }
        None
    },
    act: |world, realm_id, order| {
        let a = alliance_index_of(world, realm_id).expect("checked");
        let resident_ids = id_list(order, "residentIds").expect("checked");
        let carriage_ids = id_list(order, "carriageIds").expect("checked");
        let army = &mut world.alliances[a].army;
        for id in &resident_ids {
            army.push(AllianceArmyPart {
                is: AllianceArmyPartIs::Resident,
                id: id.clone(),
                recall_at: None,
            });
        }
        for id in &carriage_ids {
            army.push(AllianceArmyPart {
                is: AllianceArmyPartIs::Carriage,
                id: id.clone(),
                recall_at: None,
            });
        }
        let changed: Vec<String> = resident_ids.into_iter().chain(carriage_ids).collect();
        changed_command(world, &changed);
    },
};

/// Recalling what the realm handed over (`recallFromAlliance`): theirs to command again after
/// `ALLIANCE_RECALL_DELAY`.
pub const RECALL_FROM_ALLIANCE: AllianceOrder = AllianceOrder {
    check: |world, realm_id, order| {
        let Some(alliance) = alliance_of(world, realm_id) else {
            return Some("you are in no alliance".into());
        };
        let Some(ids) = id_list(order, "ids").filter(|ids| !ids.is_empty()) else {
            return Some("name each soldier and carriage once".into());
        };
        for id in &ids {
            let part = alliance.army.iter().find(|p| p.id == *id);
            let Some(part) = part.filter(|p| owner_of_part(world, p).flatten() == Some(realm_id))
            else {
                return Some("you did not hand that over".into());
            };
            if part.recall_at.is_some() {
                return Some("already recalled".into());
            }
        }
        None
    },
    act: |world, realm_id, order| {
        let ids: HashSet<String> = id_list(order, "ids").unwrap_or_default().into_iter().collect();
        let at = world.tick as f64 + ALLIANCE_RECALL_DELAY;
        let a = alliance_index_of(world, realm_id).expect("checked");
        for p in &mut world.alliances[a].army {
            if ids.contains(&p.id) {
                p.recall_at = Some(at);
            }
        }
    },
};

/// The realm the soldier or carriage belongs to (`ownerOfPart`): `None` when it is gone,
/// `Some(None)` for nobody's.
fn owner_of_part<'w>(world: &'w WorldState, part: &AllianceArmyPart) -> Option<Option<&'w str>> {
    match part.is {
        AllianceArmyPartIs::Resident => {
            world.residents.iter().find(|r| r.id == part.id).map(|r| r.owner.as_deref())
        }
        AllianceArmyPartIs::Carriage => {
            world.carriages.iter().find(|k| k.id == part.id).map(|k| k.realm_id.as_deref())
        }
    }
}

/// The residents and carriages `ids` now take another realm's orders (`changedCommand`): the
/// residents stop what they did and leave their army; a driver who no longer commands their
/// carriage stops driving.
fn changed_command(world: &mut WorldState, ids: &[String]) {
    let changed: HashSet<String> = ids.iter().cloned().collect();
    let mut stop = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let lost_carriage = driven_carriage_id(r)
            .filter(|d| changed.contains(*d))
            .and_then(|d| world.carriages.iter().find(|k| k.id == d))
            .is_some_and(|k| {
                carriage_commander_of(world, k) != commander_of(world, &r.id, r.owner.as_deref())
            });
        if changed.contains(&r.id) || lost_carriage {
            stop.push(i);
        }
    }
    for i in stop {
        world.residents[i].order = None;
        world.residents[i].script = None;
    }
    leave_armies(world, &changed);
}

/// Who commands the resident or carriage `id` now (`commanderOfId`): `None` when it is gone.
fn commander_of_id(world: &WorldState, id: &str) -> Option<Option<String>> {
    if let Some(r) = world.residents.iter().find(|x| x.id == id) {
        return Some(commander_of(world, &r.id, r.owner.as_deref()));
    }
    world.carriages.iter().find(|k| k.id == id).map(|k| carriage_commander_of(world, k))
}

/// Takes parts out of the alliance army (`giveBack`): their owner commands them again.
fn give_back(world: &mut WorldState, a: usize, ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    let before: HashMap<&String, Option<Option<String>>> =
        ids.iter().map(|id| (id, commander_of_id(world, id))).collect();
    let gone: HashSet<&String> = ids.iter().collect();
    world.alliances[a].army.retain(|p| !gone.contains(&p.id));
    let changed: Vec<String> =
        ids.iter().filter(|id| commander_of_id(world, id) != before[id]).cloned().collect();
    changed_command(world, &changed);
}

/// The alliance orders that exist (`allianceOrders`).
pub fn alliance_orders() -> Vec<(&'static str, AllianceOrder)> {
    vec![
        ("foundAlliance", FOUND_ALLIANCE),
        ("inviteToAlliance", INVITE_TO_ALLIANCE),
        ("withdrawInvite", WITHDRAW_INVITE),
        ("acceptInvite", ACCEPT_INVITE),
        ("declineInvite", DECLINE_INVITE),
        ("leaveAlliance", LEAVE_ALLIANCE),
        ("removeFromAlliance", REMOVE_FROM_ALLIANCE),
        ("handOverToAlliance", HAND_OVER_TO_ALLIANCE),
        ("recallFromAlliance", RECALL_FROM_ALLIANCE),
    ]
}

/// Takes back every invitation to the realm (`dropInvitesTo`).
fn drop_invites_to(world: &mut WorldState, realm_id: &str) {
    for a in &mut world.alliances {
        a.invites.retain(|id| id != realm_id);
    }
}

/// Writes an event in the realm log of every member of the alliance (`tellMembers`).
fn tell_members(world: &mut WorldState, a: usize, what: RealmEventWhat) {
    let members: Vec<String> =
        world.alliances[a].members.iter().map(|m| m.realm_id.clone()).collect();
    for m in members {
        record_event(world, Some(&m), what.clone());
    }
}

/// Ends a member's membership now (`endMembership`): it and the members staying are told; what it
/// handed over comes back; the alliance leader's role passes to the longest-standing realm left;
/// an alliance with no realm left ends.
fn end_membership(world: &mut WorldState, a: usize, realm_id: &str, why: AllianceLeftWhy) {
    let city = world.cities.iter().any(|c| c.id == realm_id);
    let realm =
        if city { organization_label(world, realm_id) } else { realm_name(world, realm_id) };
    let (alliance_id, name) = (world.alliances[a].id.clone(), world.alliances[a].name.clone());
    let what = RealmEventWhat::AllianceLeft {
        alliance_id: alliance_id.clone(),
        name: name.clone(),
        realm_id: realm_id.to_string(),
        realm,
        why,
        city: city.then_some(true),
    };
    tell_members(world, a, what);
    // Leaving recalls everything the realm handed over (`CONTEXT.md`: Alliance army).
    let own: Vec<String> = world.alliances[a]
        .army
        .iter()
        .filter(|p| owner_of_part(world, p) == Some(Some(realm_id)))
        .map(|p| p.id.clone())
        .collect();
    give_back(world, a, own);
    world.alliances[a].members.retain(|m| m.realm_id != realm_id);
    let next = world.alliances[a]
        .members
        .iter()
        .find(|m| world.realms.iter().any(|r| r.id == m.realm_id))
        .map(|m| m.realm_id.clone());
    let Some(next) = next else {
        world.alliances.remove(a);
        return;
    };
    if world.alliances[a].leader_id != realm_id {
        return;
    }
    world.alliances[a].leader_id = next.clone();
    let what = RealmEventWhat::AllianceLeader {
        alliance_id,
        name,
        realm: realm_name(world, &next),
        realm_id: next,
    };
    tell_members(world, a, what);
}

/// A realm whose Leader died leaves its alliance at once and its invitations lapse
/// (`leaveOnLeaderDeath`). Call it before the realm ends, so its name is still known.
pub fn leave_on_leader_death(world: &mut WorldState, realm_id: &str) {
    drop_invites_to(world, realm_id);
    if let Some(a) = alliance_index_of(world, realm_id) {
        end_membership(world, a, realm_id, AllianceLeftWhy::LeaderDied);
    }
}

/// One tick of alliances (`stepAlliances`): recalls, leaves and removals whose delay ran out take
/// effect; members and invitations of realms that no longer exist go; so do army parts gone or no
/// longer a member's. An NPC city member torn down or joined to a realm leaves at once; one whose
/// standing toward another member fell too low starts leaving.
pub fn step_alliances(world: &mut WorldState) {
    let realms: HashSet<String> = world.realms.iter().map(|r| r.id.clone()).collect();
    let ids: Vec<String> = world.alliances.iter().map(|a| a.id.clone()).collect();
    for alliance_id in ids {
        let Some(a) = index_of(world, &alliance_id) else { continue };
        world.alliances[a].invites.retain(|id| realms.contains(id));
        let members: HashSet<String> =
            world.alliances[a].members.iter().map(|m| m.realm_id.clone()).collect();
        let strays: Vec<String> = world.alliances[a]
            .army
            .iter()
            .filter(|p| !members.contains(owner_of_part(world, p).flatten().unwrap_or("")))
            .map(|p| p.id.clone())
            .collect();
        give_back(world, a, strays);
        let tick = world.tick as f64;
        let due: Vec<String> = world.alliances[a]
            .army
            .iter()
            .filter(|p| p.recall_at.is_some_and(|at| at <= tick))
            .map(|p| p.id.clone())
            .collect();
        give_back(world, a, due);
        let member_ids: Vec<String> =
            world.alliances[a].members.iter().map(|m| m.realm_id.clone()).collect();
        for m in member_ids {
            let Some(a) = index_of(world, &alliance_id) else { break };
            let Some(member) = world.alliances[a].members.iter().find(|x| x.realm_id == m) else {
                continue;
            };
            let leaving = member.leaving.clone();
            let city = !realms.contains(&m) && is_alliance_city(world, &m);
            if !realms.contains(&m) && !city {
                let was_city = world.cities.iter().any(|c| c.id == m);
                end_membership(
                    world,
                    a,
                    &m,
                    if was_city { AllianceLeftWhy::Left } else { AllianceLeftWhy::LeaderDied },
                );
            } else if let Some(l) = leaving.clone().filter(|l| l.at <= tick) {
                end_membership(
                    world,
                    a,
                    &m,
                    if l.removed { AllianceLeftWhy::Removed } else { AllianceLeftWhy::Left },
                );
            } else if city
                && leaving.is_none()
                && npc_city_wants_out(world, &m, &world.alliances[a])
            {
                let member = world.alliances[a]
                    .members
                    .iter_mut()
                    .find(|x| x.realm_id == m)
                    .expect("a member");
                member.leaving = Some(Leaving { at: tick + ALLIANCE_LEAVE_DELAY, removed: false });
            }
        }
    }
}

#[cfg(test)]
mod tests;
