//! Alliance and command queries of `packages/shared/src/alliance.ts` and `contract.ts`: who sees
//! with whom, and whose orders a resident or carriage takes.

use csp_shared::world::{Alliance, Carriage, MercenaryContract, WorldState};

use super::standing::{TRADE_ORG, TRADE_ORG_NAME};

/// Whether two realms stand together (`allied`): the same realm, or members of one alliance.
pub fn allied(world: &WorldState, a: &str, b: &str) -> bool {
    a == b || allied_realms(world, a).iter().any(|x| x == b)
}

/// How Players call a realm (`realmName`): by its realm name, else its Leader's name; the Trade
/// Organization by its own.
pub fn realm_name(world: &WorldState, realm_id: &str) -> String {
    if realm_id == TRADE_ORG {
        return TRADE_ORG_NAME.to_string();
    }
    let realm = world.realms.iter().find(|r| r.id == realm_id);
    if let Some(name) = realm.and_then(|r| r.name.as_ref()) {
        return name.clone();
    }
    realm
        .and_then(|realm| world.residents.iter().find(|r| r.id == realm.leader_id))
        .map_or_else(|| "a fallen realm".to_string(), |l| l.name.clone())
}

/// The alliance the realm or NPC city `realm_id` is a member of (`allianceOf`).
pub fn alliance_of<'w>(world: &'w WorldState, realm_id: &str) -> Option<&'w Alliance> {
    world.alliances.iter().find(|a| a.members.iter().any(|m| m.realm_id == realm_id))
}

/// The realm and its allies (`alliedRealms`): every member of its alliance, a leaving one
/// included, or just itself in none.
pub fn allied_realms(world: &WorldState, realm_id: &str) -> Vec<String> {
    match alliance_of(world, realm_id) {
        Some(a) => a.members.iter().map(|m| m.realm_id.clone()).collect(),
        None => vec![realm_id.to_string()],
    }
}

/// The realms whose residents a realm's Player sees through (`sharingSight`, `CONTEXT.md`:
/// Sight): their own and every member of their alliance.
pub fn sharing_sight(world: &WorldState, realm_id: &str) -> Vec<String> {
    allied_realms(world, realm_id)
}

/// The alliance whose army holds the resident or carriage `id` (`handedOverTo`).
pub fn handed_over_to<'w>(world: &'w WorldState, id: &str) -> Option<&'w Alliance> {
    world.alliances.iter().find(|a| a.army.iter().any(|p| p.id == id))
}

/// The started mercenary contract renting out the resident (`contractOf`).
pub fn contract_of<'w>(world: &'w WorldState, resident_id: &str) -> Option<&'w MercenaryContract> {
    world
        .contracts
        .iter()
        .find(|c| c.started_at.is_some() && c.resident_ids.iter().any(|id| id == resident_id))
}

/// The realm whose orders the resident takes (`commanderOf`): the alliance leader's while handed
/// over to its army, the hirer's while a contract rents them out, their own realm's otherwise.
pub fn commander_of(world: &WorldState, id: &str, owner: Option<&str>) -> Option<String> {
    if let Some(a) = handed_over_to(world, id) {
        return Some(a.leader_id.clone());
    }
    if let Some(c) = contract_of(world, id) {
        return Some(c.hirer_id.clone());
    }
    owner.map(str::to_string)
}

/// The realm whose orders the carriage takes, as `commander_of` for a resident
/// (`carriageCommanderOf`).
pub fn carriage_commander_of(world: &WorldState, k: &Carriage) -> Option<String> {
    match handed_over_to(world, &k.id) {
        Some(a) => Some(a.leader_id.clone()),
        None => k.realm_id.clone(),
    }
}
