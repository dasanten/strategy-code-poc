//! Armies (`CONTEXT.md`: Army, Supply line), ported from `apps/server/src/armies.ts`: a named
//! group of a realm's residents under one order. The army's order is plain data on the army
//! (ADR 0002); each tick it gives its members walk or attack orders tagged with the army, and
//! walking holds back a member who gets ahead. A member given an order of their own leaves.
//!
//! The army orders are plain `validate`/`apply` functions over an [`ArmyRequest`]; the order
//! queue (T86.2) wires them under their kinds.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{ARMY_SPREAD, SIGHT_RANGE};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Army, ArmyOrder, Resident, ResidentOrder, Tile, WalkOrder, WorldState};

use crate::combat::attack_order;
use crate::order_sender::commands;
use crate::queries::alliance::commander_of;
use crate::queries::army::{army_of, ARMY_NAME_MAX_LENGTH};
use crate::queries::combat::in_contact;
use crate::sight::InvariantViolation;

/// The fields an army order may carry (`OrderRequest` as the army kinds read it).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ArmyRequest {
    pub army_id: Option<String>,
    pub name: Option<String>,
    pub resident_ids: Option<Vec<String>>,
    pub target_id: Option<String>,
    /// `order.x`, `order.y`: a tile when both are whole numbers.
    pub x: Option<f64>,
    pub y: Option<f64>,
}

/// The army order kinds (`armyOrders`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArmyOrderKind {
    FormArmy,
    DisbandArmy,
    ArmyWalkTo,
    ArmyGuard,
    ArmyAttack,
    ArmyFollow,
    ArmyStop,
}

impl ArmyOrderKind {
    /// The kind an order names, if it is an army order.
    pub fn of(kind: &str) -> Option<Self> {
        Some(match kind {
            "formArmy" => Self::FormArmy,
            "disbandArmy" => Self::DisbandArmy,
            "armyWalkTo" => Self::ArmyWalkTo,
            "armyGuard" => Self::ArmyGuard,
            "armyAttack" => Self::ArmyAttack,
            "armyFollow" => Self::ArmyFollow,
            "armyStop" => Self::ArmyStop,
            _ => return None,
        })
    }
}

fn realm_of(world: &WorldState, user_id: u64) -> Option<String> {
    world.realms.iter().find(|r| r.user_id == user_id).map(|r| r.id.clone())
}

/// The realm's army named by `order.army_id` (`ownArmy`), by index, or a reason.
fn own_army(world: &WorldState, realm_id: &str, order: &ArmyRequest) -> Result<usize, String> {
    world
        .armies
        .iter()
        .position(|a| Some(&a.id) == order.army_id.as_ref() && a.realm_id == realm_id)
        .ok_or_else(|| "not one of your armies".to_string())
}

/// Whether any of the realm's residents sees the spot (`inSightOf`).
fn in_sight_of(world: &WorldState, realm_id: &str, at: &Resident, size: i32) -> bool {
    world.residents.iter().any(|x| {
        commands(world, realm_id, Some(x))
            && wrap_distance(size, (x.x as i32, x.y as i32), (at.x as i32, at.y as i32))
                <= SIGHT_RANGE
    })
}

/// A reason the army can't go after resident `order.target_id` (`badTarget`).
fn bad_target(
    world: &WorldState,
    realm_id: &str,
    order: &ArmyRequest,
    size: Option<i32>,
) -> Option<String> {
    let Some(target) = world.residents.iter().find(|x| Some(&x.id) == order.target_id.as_ref())
    else {
        return Some("no such resident".into());
    };
    if size.is_some_and(|size| !in_sight_of(world, realm_id, target, size)) {
        return Some("that resident is out of sight".into());
    }
    None
}

/// A reason `order.x`, `order.y` is not a tile (`badTile`).
fn bad_tile(order: &ArmyRequest) -> Option<String> {
    let whole = |v: Option<f64>| v.is_some_and(|v| v.is_finite() && v.fract() == 0.0);
    if whole(order.x) && whole(order.y) {
        None
    } else {
        Some("the target must be a tile".into())
    }
}

/// Whether the order is one the army `army_id` gave (`forArmy`).
fn for_army(o: Option<&ResidentOrder>, army_id: &str) -> bool {
    match o {
        Some(ResidentOrder::WalkTo(w)) => w.army.as_deref() == Some(army_id),
        Some(ResidentOrder::Attack(a)) => a.army.as_deref() == Some(army_id),
        _ => false,
    }
}

/// The army an order is tagged with, for a walk or attack order.
fn tagged(o: Option<&ResidentOrder>) -> Option<&str> {
    match o {
        Some(ResidentOrder::WalkTo(w)) => w.army.as_deref(),
        Some(ResidentOrder::Attack(a)) => a.army.as_deref(),
        _ => None,
    }
}

/// Ends the army's own orders for its members (`stopMembers`).
fn stop_members(world: &mut WorldState, army_id: &str) {
    for r in &mut world.residents {
        if for_army(r.order.as_ref(), army_id) {
            r.order = None;
        }
    }
}

/// Takes residents out of every army; an army left with nobody is gone (`leaveArmies`).
pub fn leave_armies(world: &mut WorldState, ids: &HashSet<String>) {
    for a in &mut world.armies {
        a.member_ids.retain(|id| !ids.contains(id));
    }
    world.armies.retain(|a| !a.member_ids.is_empty());
}

/// The `check` of an army order kind: a reason to reject it, on a map of `size` tiles when known.
fn check(
    world: &WorldState,
    kind: ArmyOrderKind,
    realm_id: &str,
    order: &ArmyRequest,
    size: Option<i32>,
) -> Option<String> {
    use ArmyOrderKind::*;
    if kind == FormArmy {
        let name = order.name.as_deref().map(str::trim).unwrap_or("");
        if name.is_empty() {
            return Some("the army needs a name".into());
        }
        // `name.length` counts UTF-16 code units.
        if name.encode_utf16().count() > ARMY_NAME_MAX_LENGTH {
            return Some(format!("an army name is at most {ARMY_NAME_MAX_LENGTH} characters"));
        }
        let Some(ids) = order.resident_ids.as_ref().filter(|ids| !ids.is_empty()) else {
            return Some("an army needs at least one resident".into());
        };
        if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
            return Some("a resident is named twice".into());
        }
        let own =
            |id: &String| commands(world, realm_id, world.residents.iter().find(|r| r.id == *id));
        if !ids.iter().all(own) {
            return Some("not all of them are your residents".into());
        }
        return None;
    }
    let army = match own_army(world, realm_id, order) {
        Ok(a) => &world.armies[a],
        Err(e) => return Some(e),
    };
    match kind {
        FormArmy | DisbandArmy | ArmyStop => None,
        ArmyWalkTo | ArmyGuard => bad_tile(order),
        ArmyAttack => {
            if let Some(bad) = bad_target(world, realm_id, order, size) {
                return Some(bad);
            }
            let target = world.residents.iter().find(|x| Some(&x.id) == order.target_id.as_ref());
            match target {
                Some(t)
                    if t.owner.as_deref() == Some(realm_id)
                        || commands(world, realm_id, Some(t)) =>
                {
                    Some("that is one of your own residents".into())
                }
                _ => None,
            }
        }
        ArmyFollow => {
            if let Some(bad) = bad_target(world, realm_id, order, size) {
                return Some(bad);
            }
            let target = order.target_id.as_ref();
            if target.is_some_and(|t| army.member_ids.contains(t)) {
                Some("that is one of the army".into())
            } else {
                None
            }
        }
    }
}

/// `validate` of an army order kind: the sender `user_id` needs a realm.
pub fn validate_army_order(
    world: &WorldState,
    kind: ArmyOrderKind,
    user_id: u64,
    order: &ArmyRequest,
    size: Option<i32>,
) -> Option<String> {
    let Some(realm_id) = realm_of(world, user_id) else { return Some("you have no realm".into()) };
    check(world, kind, &realm_id, order, size)
}

/// `apply` of an army order kind: checked again without the map, then carried out.
pub fn apply_army_order(
    world: &mut WorldState,
    kind: ArmyOrderKind,
    user_id: u64,
    order: &ArmyRequest,
) {
    use ArmyOrderKind::*;
    let Some(realm_id) = realm_of(world, user_id) else { return };
    if check(world, kind, &realm_id, order, None).is_some() {
        return;
    }
    if kind == FormArmy {
        let ids = order.resident_ids.clone().unwrap_or_default();
        leave_armies(world, &ids.iter().cloned().collect());
        let id = format!("army{}", world.next_id);
        world.next_id += 1;
        world.armies.push(Army {
            id,
            name: order.name.as_deref().unwrap_or("").trim().to_string(),
            realm_id,
            member_ids: ids,
            order: None,
            script: None,
        });
        return;
    }
    let Ok(a) = own_army(world, &realm_id, order) else { return };
    let army_id = world.armies[a].id.clone();
    stop_members(world, &army_id);
    let target = || order.target_id.clone().unwrap_or_default();
    let tile = || Tile { x: order.x.unwrap_or(0.0), y: order.y.unwrap_or(0.0) };
    let new = match kind {
        DisbandArmy => {
            world.armies.remove(a);
            return;
        }
        ArmyWalkTo => Some(ArmyOrder::WalkTo { target: tile(), started: false }),
        ArmyGuard => Some(ArmyOrder::Guard { at: tile(), started: false }),
        ArmyAttack => Some(ArmyOrder::Attack { target_id: target(), started: false }),
        ArmyFollow => Some(ArmyOrder::Follow { target_id: target(), started: false }),
        ArmyStop | FormArmy => None,
    };
    world.armies[a].order = new;
}

/// Each army member's order as it is now (`memberOrders`), to tell later whether they got one
/// of their own.
pub fn member_orders(world: &WorldState) -> HashMap<String, Option<ResidentOrder>> {
    let mut out = HashMap::new();
    if world.armies.is_empty() {
        return out;
    }
    let members: HashSet<&String> = world.armies.iter().flat_map(|a| &a.member_ids).collect();
    for r in &world.residents {
        if members.contains(&r.id) {
            out.insert(r.id.clone(), r.order.clone());
        }
    }
    out
}

/// Members whose order changed since `before` got an order of their own, and leave their army
/// (`leaveOnOwnOrders`). The TypeScript tells a changed order by identity; here it is one unequal
/// to the one before.
pub fn leave_on_own_orders(
    world: &mut WorldState,
    before: &HashMap<String, Option<ResidentOrder>>,
) {
    if before.is_empty() {
        return;
    }
    let left: HashSet<String> = world
        .residents
        .iter()
        .filter(|r| before.get(&r.id).is_some_and(|o| *o != r.order))
        .map(|r| r.id.clone())
        .collect();
    if !left.is_empty() {
        leave_armies(world, &left);
    }
}

fn walk_for(army_id: &str, x: f64, y: f64) -> ResidentOrder {
    ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: Some(army_id.to_string()),
    })
}

/// Keeps armies sound and carries out their orders, on a map of `size` tiles, as a tick ends
/// (`stepArmies`).
pub fn step_armies(world: &mut WorldState, size: i32) {
    let by_id: HashMap<String, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
    let realms: HashSet<String> = world.realms.iter().map(|r| r.id.clone()).collect();
    let mut armies = std::mem::take(&mut world.armies);
    for a in &mut armies {
        a.member_ids.retain(|id| {
            by_id.get(id).is_some_and(|&i| {
                let r = &world.residents[i];
                commander_of(world, &r.id, r.owner.as_deref()).as_deref()
                    == Some(a.realm_id.as_str())
            })
        });
    }
    armies.retain(|a| !a.member_ids.is_empty() && realms.contains(&a.realm_id));
    world.armies = armies;
    let army_id_of: HashMap<String, String> = world
        .armies
        .iter()
        .flat_map(|a| a.member_ids.iter().map(|id| (id.clone(), a.id.clone())))
        .collect();
    for r in &mut world.residents {
        let mine = army_id_of.get(&r.id);
        match &mut r.order {
            Some(ResidentOrder::WalkTo(o)) if o.army.is_some() && mine != o.army.as_ref() => {
                o.army = None
            }
            Some(ResidentOrder::Attack(o)) if o.army.is_some() && mine != o.army.as_ref() => {
                o.army = None
            }
            _ => {}
        }
    }
    let unsupplied: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            supplied_army(&world.residents[i]).is_some()
                && !supplies_own_army(world, &world.residents[i])
        })
        .collect();
    for i in unsupplied {
        world.residents[i].order = None;
    }
    for a in 0..world.armies.len() {
        let members: Vec<usize> = world.armies[a].member_ids.iter().map(|id| by_id[id]).collect();
        carry_out(world, a, &members, size);
    }
}

/// The army a resident's carriage supplies, following it or on a haul route to it
/// (`suppliedArmy`).
fn supplied_army(r: &Resident) -> Option<&str> {
    match &r.order {
        Some(ResidentOrder::Drive(o)) => o.army.as_deref(),
        Some(ResidentOrder::Haul(o)) => o.to_army.as_deref(),
        _ => None,
    }
}

/// Whether the army a resident supplies exists and is their commander's, or is the punishment
/// whose supply wagon they drive (`suppliesOwnArmy`).
fn supplies_own_army(world: &WorldState, r: &Resident) -> bool {
    let id = supplied_army(r);
    let drives_wagon = |w: &csp_shared::world::SupplyWagon| {
        w.driver_id.as_deref() == Some(r.id.as_str())
            && id.is_some()
            && w.punishment_id.as_deref() == id
    };
    if world.supply_wagons.iter().any(drives_wagon) {
        return true;
    }
    let commander = commander_of(world, &r.id, r.owner.as_deref());
    world
        .armies
        .iter()
        .any(|a| Some(a.id.as_str()) == id && Some(&a.realm_id) == commander.as_ref())
}

/// Invariant (`supplyLinesSound`): a carriage that follows an army, or a haul route with an army
/// as its second stop, goes to an army of the driver's realm.
pub fn supply_lines_sound(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| supplied_army(r).is_some() && !supplies_own_army(world, r))
        .map(|r| InvariantViolation {
            invariant: "supply-lines-sound".into(),
            message: format!(
                "resident {} supplies army {}, not one of their realm's",
                r.id,
                supplied_army(r).unwrap_or_default()
            ),
            entity_ids: vec![r.id.clone()],
        })
        .collect()
}

/// Gives the army's members their orders from the army's, and ends an order that is done
/// (`carryOut`). `members` are resident indices.
fn carry_out(world: &mut WorldState, a: usize, members: &[usize], size: i32) {
    let army_id = world.armies[a].id.clone();
    let Some(order) = world.armies[a].order.clone() else { return };
    let busy = |world: &WorldState| {
        members.iter().any(|&m| for_army(world.residents[m].order.as_ref(), &army_id))
    };
    let set_started = |world: &mut WorldState| match &mut world.armies[a].order {
        Some(ArmyOrder::WalkTo { started, .. })
        | Some(ArmyOrder::Attack { started, .. })
        | Some(ArmyOrder::Guard { started, .. })
        | Some(ArmyOrder::Follow { started, .. }) => *started = true,
        None => {}
    };
    match order {
        ArmyOrder::WalkTo { started, .. } | ArmyOrder::Attack { started, .. } if started => {
            if !busy(world) {
                world.armies[a].order = None;
            }
        }
        ArmyOrder::WalkTo { target, .. } => {
            for &m in members {
                world.residents[m].order = Some(walk_for(&army_id, target.x, target.y));
            }
            set_started(world);
        }
        ArmyOrder::Attack { target_id, .. } => {
            for &m in members {
                let mut o = attack_order(&target_id, false, false);
                o.army = Some(army_id.clone());
                world.residents[m].order = Some(ResidentOrder::Attack(o));
            }
            set_started(world);
        }
        ArmyOrder::Guard { at, started } => {
            for &m in members {
                let r = &mut world.residents[m];
                let here = r.x == at.x && r.y == at.y;
                // At first everyone goes; later only a member idle away from the spot walks back.
                if if started { r.order.is_none() && !here } else { !here } {
                    r.order = Some(walk_for(&army_id, at.x, at.y));
                } else if !started {
                    r.order = None;
                }
            }
            set_started(world);
        }
        ArmyOrder::Follow { target_id, started } => {
            let target = world.residents.iter().find(|x| x.id == target_id).map(|t| (t.x, t.y));
            let seen = target.is_some_and(|t| {
                members.iter().any(|&m| {
                    let r = &world.residents[m];
                    wrap_distance(size, (r.x as i32, r.y as i32), (t.0 as i32, t.1 as i32))
                        <= SIGHT_RANGE
                })
            });
            let (Some(target), true) = (target, seen) else {
                stop_members(world, &army_id);
                world.armies[a].order = None;
                return;
            };
            for &m in members {
                let r = &mut world.residents[m];
                if started && r.order.is_some() && !for_army(r.order.as_ref(), &army_id) {
                    continue;
                }
                if in_contact(size, (r.x as i32, r.y as i32), (target.0 as i32, target.1 as i32)) {
                    if !started || for_army(r.order.as_ref(), &army_id) {
                        r.order = None;
                    }
                    continue;
                }
                let keeps = started
                    && matches!(&r.order, Some(ResidentOrder::WalkTo(w))
                        if in_contact(size, (w.target.x as i32, w.target.y as i32), (target.0 as i32, target.1 as i32)) && w.army.is_some());
                if !keeps {
                    r.order = Some(walk_for(&army_id, target.0, target.1));
                }
            }
            set_started(world);
        }
    }
}

/// Which residents walking for an army wait this tick (`waitingForArmy`): while any member walking
/// for the same army is still finding their way, all wait; otherwise one with more than
/// `ARMY_SPREAD` tiles fewer to go than the one furthest behind waits. `holding` don't walk anyway.
pub fn waiting_for_army(world: &WorldState, holding: &HashSet<String>) -> HashSet<String> {
    type Group<'w> = (&'w str, Vec<(&'w str, Option<usize>)>);
    let mut groups: Vec<Group> = Vec::new();
    for r in &world.residents {
        let (army, left) = match &r.order {
            Some(ResidentOrder::WalkTo(o)) => (o.army.as_deref(), o.path.as_ref().map(Vec::len)),
            Some(ResidentOrder::Attack(o)) => (o.army.as_deref(), o.path.as_ref().map(Vec::len)),
            _ => continue,
        };
        let Some(army) = army else { continue };
        if holding.contains(&r.id) {
            continue;
        }
        match groups.iter_mut().find(|g| g.0 == army) {
            Some(g) => g.1.push((&r.id, left)),
            None => groups.push((army, vec![(&r.id, left)])),
        }
    }
    let mut waiting = HashSet::new();
    for (_, group) in groups {
        if group.len() < 2 {
            continue;
        }
        let finding = group.iter().any(|m| m.1.is_none());
        let behind = group.iter().map(|m| m.1.unwrap_or(0)).max().unwrap_or(0) as f64;
        for (id, left) in group {
            if finding || (left.unwrap_or(0) as f64) < behind - ARMY_SPREAD {
                waiting.insert(id.to_string());
            }
        }
    }
    waiting
}

/// Invariant (`armiesSound`): each army has a name, belongs to a realm that exists and has
/// members, all living residents that realm commands, none in two armies; an order tagged with an
/// army is held by one of its members.
pub fn armies_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut report = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation { invariant: "armies-sound".into(), message, entity_ids })
    };
    let by_id: HashMap<&str, &Resident> =
        world.residents.iter().map(|r| (r.id.as_str(), r)).collect();
    let mut seen = HashSet::new();
    for a in &world.armies {
        if a.name.trim().is_empty() {
            report(format!("army {} has no name", a.id), vec![a.id.clone()]);
        }
        if !world.realms.iter().any(|r| r.id == a.realm_id) {
            report(
                format!("army {} belongs to realm {}, which does not exist", a.id, a.realm_id),
                vec![a.id.clone()],
            );
        }
        if a.member_ids.is_empty() {
            report(format!("army {} has no members", a.id), vec![a.id.clone()]);
        }
        for id in &a.member_ids {
            match by_id.get(id.as_str()) {
                None => report(
                    format!("army {} has member {id}, who does not exist", a.id),
                    vec![a.id.clone(), id.clone()],
                ),
                Some(r)
                    if commander_of(world, &r.id, r.owner.as_deref()).as_deref()
                        != Some(a.realm_id.as_str()) =>
                {
                    report(
                        format!("army {} has member {id} another realm commands", a.id),
                        vec![a.id.clone(), id.clone()],
                    )
                }
                _ => {}
            }
            if !seen.insert(id.clone()) {
                report(format!("resident {id} is in two armies"), vec![id.clone()]);
            }
        }
    }
    for r in &world.residents {
        let Some(army) = tagged(r.order.as_ref()) else { continue };
        if army_of(world, &r.id).map(|a| a.id.as_str()) != Some(army) {
            report(
                format!("resident {} holds an order of army {army}, not theirs", r.id),
                vec![r.id.clone()],
            );
        }
    }
    out
}

#[cfg(test)]
mod tests;
