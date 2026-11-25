//! Realms, their leaders and heirs, alliances, crimes, standing and persuasion.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    ALLIANCE_LEAVE_DELAY, ALLIANCE_RECALL_DELAY, CRIME_MEMORY_DAYS, REALM_LOG_LENGTH,
    REALM_NAME_MAX_LENGTH,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::WorldState;

use super::shared::{npc_cities, Out};
use super::{invariant, js_json, js_number, violation, Invariant};
use crate::queries::people::{js_trim, name_problem};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("realms-have-leaders", realms_have_leaders),
    invariant("leaders-serve-no-one", |w, _| crate::leader::leaders_serve_no_one(w)),
    invariant("heirs-qualify", |w, _| crate::heir::heirs_qualify(w)),
    invariant("heirs-took-over", |w, _| crate::heir::takeover::heirs_took_over(w)),
    invariant("realm-logs-in-order", realm_logs_in_order),
    invariant("owners-exist", owners_exist),
    invariant("alliances-sound", alliances_sound),
    invariant("crimes-sound", crimes_sound),
    invariant("standings-sound", |w, _| crate::standing::standings_sound(w)),
    invariant("join-requests-sound", |w, _| crate::persuasion::join_requests_sound(w)),
    invariant("respect-sound", |w, t| crate::persuasion::respect_sound(w, t.size)),
    invariant("outweighed-sound", |w, t| crate::persuasion::outweighed_sound(w, t.size)),
    invariant("former-players-sound", |w, _| crate::standing::former_players_sound(w)),
    invariant("lent-never-turn", |w, _| crate::lent::lent_never_turn(w)),
    invariant("rallies-sound", |w, _| crate::rally::rallies_sound(w)),
];

/// Every realm has a Player and a living Leader who belongs to it; one realm per Player; a realm
/// name, once given, is trimmed, not empty and no longer than `REALM_NAME_MAX_LENGTH`.
pub fn realms_have_leaders(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "realms-have-leaders";
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for realm in &world.realms {
        let leader = world.residents.iter().find(|r| r.id == realm.leader_id);
        let mut problems = Vec::new();
        if leader.is_none_or(|l| l.owner.as_deref() != Some(realm.id.as_str())) {
            problems.push(format!("has no Leader {}", realm.leader_id));
        }
        if seen.contains(&realm.user_id) {
            problems.push(format!("is a second realm of Player {}", realm.user_id));
        }
        seen.insert(realm.user_id);
        if let Some(n) = &realm.name {
            if n != js_trim(n) || name_problem(Some(n), REALM_NAME_MAX_LENGTH).is_some() {
                problems.push(format!("has a bad name {}", js_json(n)));
            }
        }
        for p in problems {
            out.push(violation(name, format!("realm {} {p}", realm.id), &[&realm.id]));
        }
    }
    out
}

/// Realm logs stay in order and in bounds (`realmLogsInOrder`).
pub fn realm_logs_in_order(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "realm-logs-in-order";
    let mut out = Vec::new();
    let mut fail = |m: String| out.push(violation(name, m, &[]));
    let mut kept: Vec<(u64, usize)> = Vec::new();
    let mut last: Option<u64> = None;
    for e in &world.events {
        if last.is_some_and(|l| e.seq <= l) {
            fail(format!("event {} is logged after event {}", e.seq, last.unwrap()));
        }
        if e.seq >= world.next_id {
            fail(format!("event {} is numbered past next id {}", e.seq, world.next_id));
        }
        if e.tick > world.tick {
            fail(format!("event {} happened at tick {}, after now", e.seq, e.tick));
        }
        last = Some(e.seq);
        match kept.iter_mut().find(|(u, _)| *u == e.user_id) {
            Some((_, n)) => *n += 1,
            None => kept.push((e.user_id, 1)),
        }
    }
    for (user, n) in kept {
        if n as f64 > REALM_LOG_LENGTH {
            fail(format!("Player {user} keeps {n} events, over {}", js_number(REALM_LOG_LENGTH)));
        }
    }
    out
}

/// Everything belongs to a realm that exists, an NPC city that exists, or nobody
/// (`ownersExist`).
pub fn owners_exist(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "owners-exist";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let npc = npc_cities(world);
    let mut out = Vec::new();
    let mut problem = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for r in &world.residents {
        if let Some(owner) = r.owner.as_deref().filter(|o| !realms.contains(o)) {
            problem(&r.id, format!("belongs to ended realm {owner}"));
        }
    }
    for c in &world.cities {
        if let Some(realm) = c.realm_id.as_deref().filter(|o| !realms.contains(o)) {
            problem(&c.id, format!("belongs to ended realm {realm}"));
        }
    }
    let things = world
        .horses
        .iter()
        .map(|h| (&h.id, &h.realm_id, &h.city_id))
        .chain(world.carriages.iter().map(|k| (&k.id, &k.realm_id, &k.city_id)));
    for v in &world.vessels {
        if let Some(realm) = v.realm_id.as_deref().filter(|o| !realms.contains(o)) {
            problem(&v.id, format!("belongs to ended realm {realm}"));
        }
    }
    for m in &world.siege_machines {
        if let Some(realm) = m.realm_id.as_deref().filter(|o| !realms.contains(o)) {
            problem(&m.id, format!("belongs to ended realm {realm}"));
        }
    }
    for (id, realm, city) in things {
        if let Some(realm) = realm.as_deref().filter(|o| !realms.contains(o)) {
            problem(id, format!("belongs to ended realm {realm}"));
        }
        if let Some(city) = city {
            if realm.is_some() || !npc.contains(city.as_str()) {
                problem(id, format!("belongs to {city}, which is no NPC city it can belong to"));
            }
        }
    }
    out
}

/// The longest an alliance's name may be (`ALLIANCE_NAME_MAX_LENGTH`).
const ALLIANCE_NAME_MAX_LENGTH: usize = 30;

/// Alliances hold together (`alliancesSound`, `CONTEXT.md`: Alliance).
pub fn alliances_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "alliances-sound";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let mut member_of: HashMap<&str, &str> = HashMap::new();
    for a in &world.alliances {
        for m in &a.members {
            let v = if member_of.contains_key(m.realm_id.as_str()) { "" } else { a.id.as_str() };
            member_of.insert(&m.realm_id, v);
        }
    }
    let mut handed_over: HashMap<&str, &str> = HashMap::new();
    for a in &world.alliances {
        for p in &a.army {
            let v = if handed_over.contains_key(p.id.as_str()) { "" } else { a.id.as_str() };
            handed_over.insert(&p.id, v);
        }
    }
    let alliance_city = |id: &str| {
        world.cities.iter().any(|c| c.id == id && c.realm_id.is_none() && c.trade_org.is_none())
    };
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for a in &world.alliances {
        let mut problems = Vec::new();
        if a.name.trim().is_empty() || a.name.encode_utf16().count() > ALLIANCE_NAME_MAX_LENGTH {
            problems.push(format!("has a bad name \"{}\"", a.name));
        }
        if a.members.is_empty() {
            problems.push("has no members".into());
        }
        if !a.members.iter().any(|m| m.realm_id == a.leader_id) {
            problems.push(format!("has leader {}, who is not a member", a.leader_id));
        }
        // An NPC city that founded it may lead it (`CONTEXT.md`: Acting first).
        if !realms.contains(a.leader_id.as_str()) && !alliance_city(&a.leader_id) {
            problems.push(format!("has leader {}, which is no realm or NPC city", a.leader_id));
        }
        for (i, m) in a.members.iter().enumerate() {
            if !realms.contains(m.realm_id.as_str()) && !alliance_city(&m.realm_id) {
                problems.push(format!("has member {}, which is no realm or NPC city", m.realm_id));
            }
            if member_of.get(m.realm_id.as_str()) == Some(&"") {
                problems.push(format!("shares member {}", m.realm_id));
            }
            if i > 0 && m.joined_at < a.members[i - 1].joined_at {
                problems
                    .push(format!("lists member {} before one that joined earlier", m.realm_id));
            }
            if let Some(at) = m.leaving.as_ref().map(|l| l.at) {
                if at <= tick || at > tick + ALLIANCE_LEAVE_DELAY {
                    problems.push(format!(
                        "has member {} leaving at tick {}",
                        m.realm_id,
                        js_number(at)
                    ));
                }
            }
        }
        let unique: HashSet<&String> = a.invites.iter().collect();
        if unique.len() != a.invites.len() {
            problems.push("invites a realm twice".into());
        }
        for id in &a.invites {
            if !realms.contains(id.as_str()) {
                problems.push(format!("invites {id}, which has ended"));
            } else if member_of.contains_key(id.as_str()) {
                problems.push(format!("invites {id}, which is in an alliance"));
            }
        }
        let members: HashSet<&str> = a.members.iter().map(|m| m.realm_id.as_str()).collect();
        for p in &a.army {
            let is = serde_json::to_value(p.is).ok();
            let is = is.as_ref().and_then(|v| v.as_str()).unwrap_or_default();
            // `?.owner` / `?.realmId`: gone is `undefined`, of nobody `null`.
            let owner: Option<Option<&str>> = if is == "resident" {
                world.residents.iter().find(|r| r.id == p.id).map(|r| r.owner.as_deref())
            } else {
                world.carriages.iter().find(|k| k.id == p.id).map(|k| k.realm_id.as_deref())
            };
            match owner {
                None => problems.push(format!("has {is} {} in its army, which is gone", p.id)),
                Some(o) if !members.contains(o.unwrap_or("")) => {
                    problems.push(format!("has {is} {} in its army, which is no member's", p.id))
                }
                _ => {}
            }
            if handed_over.get(p.id.as_str()) != Some(&a.id.as_str()) {
                problems.push(format!("shares {is} {} in its army", p.id));
            }
            if let Some(at) = p.recall_at {
                if at <= tick || at > tick + ALLIANCE_RECALL_DELAY {
                    problems.push(format!(
                        "has {is} {} in its army recalled at tick {}",
                        p.id,
                        js_number(at)
                    ));
                }
            }
        }
        for p in problems {
            out.push(violation(name, format!("alliance {} {p}", a.id), &[&a.id]));
        }
    }
    out
}

/// Crimes hold together (`crimesSound`, `CONTEXT.md`: Crime, Witness).
pub fn crimes_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "crimes-sound";
    let memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY;
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for c in &world.crimes {
        let mut problems: Vec<String> = Vec::new();
        if c.culprit.org == c.victim_org {
            problems.push("is against its culprit’s own Organization".into());
        }
        if c.tick > tick {
            problems.push(format!("happens later, at tick {}", js_number(c.tick)));
        }
        if c.witnesses.iter().collect::<HashSet<_>>().len() != c.witnesses.len() {
            problems.push("lists a witness twice".into());
        }
        for id in &c.witnesses {
            // `new Map(...)`: the last resident with the id.
            match world.residents.iter().rev().find(|r| &r.id == id) {
                None => problems.push(format!("has witness {id}, who is gone")),
                Some(w)
                    if w.owner.as_deref().or(w.city_id.as_deref())
                        == Some(c.culprit.org.as_str()) =>
                {
                    problems.push(format!("has witness {id} of the culprit’s Organization"))
                }
                _ => {}
            }
        }
        if c.known_by.iter().collect::<HashSet<_>>().len() != c.known_by.len() {
            problems.push("is known twice to one".into());
        }
        let remembered = !c.known_by.is_empty() && tick - c.heard_at.unwrap_or(c.tick) <= memory;
        // `awaitsTrader` (T86.7's `crimes.ts`): a captured post a wandering trader may still find out.
        let awaits = c.post.as_ref().is_some_and(|post| {
            !c.known_by.contains(&c.victim_org)
                && world.traders.iter().any(|t| t.r#loop.contains(post))
        });
        if c.witnesses.is_empty() && !remembered && !awaits {
            problems.push("is kept though forgotten".into());
        }
        let capture =
            serde_json::to_value(c.kind).ok().and_then(|v| v.as_str().map(|s| s == "capture"));
        if capture.unwrap_or(false) != c.post.is_some() {
            problems.push("names a post without being a capture, or the other way round".into());
        }
        for p in problems {
            out.push(violation(name, format!("crime {} {p}", c.id), &[&c.id]));
        }
    }
    out
}
