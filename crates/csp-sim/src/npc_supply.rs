//! Whether an NPC town has a way to get a building's materials (`CONTEXT.md`: NPC city, "A town
//! doesn't begin a building whose materials it has no way to get", #1487). Before this a town with
//! four Iron from its starting stock and no iron node began a smithy (10 Iron), put its four on the
//! site and waited for the rest for ever; a begun building comes before every other project, so it
//! built nothing else.
//!
//! A good can come when the city holds enough of it, when a finished workplace of its own makes it
//! (and what that is made from can come), when it could build the workplace that makes it from
//! inputs that can come, when it knows of a node of it (`knows_node`), or when a Trade Org
//! warehouse within `NPC_TRADER_REACH` prices it, where its trader could buy it (`NPC trader`).

use std::collections::HashSet;

use csp_shared::balance::NPC_TRADER_REACH;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Building, BuildingKind, City, Good, Stock, WallMaterial, WorldState};

use crate::npc_chain::{chain_good, chain_input, own_workplaces};
use crate::npc_scouts::knows_node;
use crate::queries::building::{build_materials_of, materials_needed, node_good};
use crate::queries::names::held;
use crate::queries::warehouse::stock_floor;

/// What an NPC city has towards a building's materials: its finished storage's stock, or with no
/// storage yet (a daughter) what its people carry and what its supplying mother's storages hold,
/// which its builders fetch from there (`CONTEXT.md`: Founding; Daniel, 2026-11-19, #1379:
/// Oakhurst went for a lumber camp 122 tiles out instead, and starved).
pub fn materials_at_hand(world: &WorldState, city: &City) -> Stock {
    let storage = world.buildings.iter().find(|b| {
        b.city_id.as_ref() == Some(&city.id) && b.kind == BuildingKind::Storage && b.site.is_none()
    });
    if storage.is_some() || city.trade_org.is_some() {
        return storage.and_then(|s| s.stock.clone()).unwrap_or_default();
    }
    let mut out = Stock::new();
    for r in world.residents.iter().filter(|r| r.city_id.as_ref() == Some(&city.id)) {
        for (good, n) in &r.carried {
            *out.entry(*good).or_insert(0.0) += n;
        }
    }
    if let Some(mother) = crate::npc_founding::supplying_mother(world, &city.id) {
        for b in world.buildings.iter().filter(|b| {
            b.city_id.as_ref() == Some(&mother.id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        }) {
            for (good, n) in b.stock.iter().flatten() {
                *out.entry(*good).or_insert(0.0) += n;
            }
        }
    }
    out
}

/// Whether a good can come to the city at all, by any way but what it already holds (see the
/// module's comment). Food always can: a farm needs no node.
pub fn can_come(world: &WorldState, city: &City, home: (i32, i32), good: Good, size: i32) -> bool {
    can_come_seen(world, city, home, good, size, &mut HashSet::new())
}

fn can_come_seen(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    good: Good,
    size: i32,
    seen: &mut HashSet<Good>,
) -> bool {
    if good == Good::Food {
        return true;
    }
    if !seen.insert(good) {
        return false;
    }
    if warehouse_in_reach_prices(world, home, good, size) {
        return true;
    }
    if let Some(input) = chain_input(world, city, good) {
        // Processed: its workplace stands or could be built; what goes in must come.
        return input.keys().all(|g| can_come_seen(world, city, home, *g, size, seen));
    }
    let made = own_workplaces(world, city)
        .into_iter()
        .any(|b| b.site.is_none() && chain_good(world, b) == Some(good));
    made || world.nodes.iter().any(|n| {
        node_good(n.kind) == good && knows_node(city, home, (n.x as i32, n.y as i32), size)
    })
}

/// Whether a finished Trade Org warehouse within `NPC_TRADER_REACH` of `home` prices `good`.
fn warehouse_in_reach_prices(world: &WorldState, home: (i32, i32), good: Good, size: i32) -> bool {
    world.buildings.iter().any(|b| {
        b.kind == BuildingKind::Warehouse
            && b.site.is_none()
            && wrap_distance(size, home, (b.x as i32, b.y as i32)) <= NPC_TRADER_REACH
            && stock_floor(world, b).contains_key(&good)
    })
}

/// The first of `need` the city holds too little of (`have`) and has no way to get, if any.
pub fn unobtainable(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    need: &Stock,
    have: &Stock,
    size: i32,
) -> Option<Good> {
    if city.trade_org.is_some() {
        return None;
    }
    need.iter()
        .find(|(g, n)| held(have, **g) < **n && !can_come(world, city, home, **g, size))
        .map(|(g, _)| *g)
}

/// Whether an NPC town may begin a building of `kind` (`material`): no material it has no way to
/// get. Trade Org cities always may.
pub fn may_begin(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    kind: BuildingKind,
    material: Option<WallMaterial>,
    size: i32,
) -> bool {
    let need = build_materials_of(kind, material);
    let have = materials_at_hand(world, city);
    unobtainable(world, city, home, &need, &have, size).is_none()
}

/// Whether a begun site of an NPC town waits on a material the town has no way to get: it then no
/// longer comes before the town's other projects (a running world's smithy begun before #1487).
pub fn site_stuck(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    site: &Building,
    size: i32,
) -> bool {
    let have = materials_at_hand(world, city);
    unobtainable(world, city, home, &materials_needed(site), &have, size).is_some()
}

#[cfg(test)]
mod tests;
