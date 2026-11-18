//! An NPC city's repairs (`CONTEXT.md`: Repairing, Decay; Epic 97): its builders repair its
//! buildings and its road crew its roads, worst first, from materials above its reserve (NPC
//! reserve). Like everything an NPC city does, only orders a Player could give (ADR 0002): a walk,
//! a pick-up at its storage and the repair order. A Trade Org city repairs its own from its stock
//! instead (`repair::trade_org_repairs`).

use std::collections::HashSet;

use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, City, GoodsSpot, PickUpOrder, RepairOrder, ResidentOrder, Stock, Tile, WorldState,
};

use crate::npc_behaviour::walk_to;
use crate::npc_founding::kept_from_walls;
use crate::queries::names::{held, held_in, placed};
use crate::repair::{repair_materials_needed, worn_of_city};

/// The buildings the city's other residents are repairing now.
fn taken(world: &WorldState, i: usize) -> HashSet<String> {
    world
        .residents
        .iter()
        .enumerate()
        .filter(|(o, _)| *o != i)
        .filter_map(|(_, r)| match &r.order {
            Some(ResidentOrder::Repair(o)) => Some(o.building_id.clone()),
            _ => None,
        })
        .collect()
}

/// What of `need` the resident doesn't carry.
fn lacking(carried: &Stock, need: &Stock) -> Stock {
    need.iter().map(|(g, n)| (*g, n - held(carried, *g))).filter(|(_, n)| *n > 0.0).collect()
}

/// What the store holds above what the city's repairs leave there, of each good: its reserve, and
/// while it saves for its founding party that party's Stone too (`kept_from_walls`, #1379).
fn above_reserve(world: &WorldState, city: &City, store: &Building) -> Stock {
    let reserve = kept_from_walls(world, city);
    store
        .stock
        .iter()
        .flatten()
        .map(|(g, n)| (*g, n - held(&reserve, *g)))
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// Whether a city has a repair its builders (`roads` false) or road crew (`roads` true) could
/// take on now: a building of that sort needing one whose materials the store holds above its
/// reserve. Never at a Trade Org city, which repairs its own from its stock.
pub fn repair_due(world: &WorldState, city: &City, store: Option<usize>, roads: bool) -> bool {
    if city.trade_org.is_some() {
        return false;
    }
    let Some(store) = store.map(|s| &world.buildings[s]) else { return false };
    let above = above_reserve(world, city, store);
    worn_of_city(world, &city.id, roads)
        .iter()
        .any(|b| repair_materials_needed(b).iter().all(|(g, n)| held(&above, *g) >= *n))
}

/// Gives an idle builder (`roads` false) or one of the road crew (`roads` true) of an NPC city
/// their next step of a repair, worst first, if there is one: carrying all a repair still lacks,
/// to the building and there the repair order; else, with `fetch`, the walk to the store
/// (`store`, its storage) and there a pick-up of what it lacks, from what the store holds above
/// the city's reserve. A building another of the city repairs is left to them. False with
/// nothing to do.
pub fn take_repair(
    world: &mut WorldState,
    city: &City,
    i: usize,
    store: Option<usize>,
    size: i32,
    roads: bool,
    fetch: bool,
) -> bool {
    if city.trade_org.is_some() {
        return false;
    }
    let taken = taken(world, i);
    let r = &world.residents[i];
    let here = (r.x as i32, r.y as i32);
    let worn: Vec<(String, (f64, f64), bool, Stock)> = worn_of_city(world, &city.id, roads)
        .into_iter()
        .filter(|b| !taken.contains(&b.id))
        .map(|b| {
            let lacks = lacking(&r.carried, &repair_materials_needed(b));
            (b.id.clone(), (b.x, b.y), is_at(here, placed(b), size), lacks)
        })
        .collect();
    // Carrying all a repair lacks, they repair it.
    if let Some((id, at, there, _)) = worn.iter().find(|w| w.3.is_empty()) {
        let r = &mut world.residents[i];
        if *there {
            let at = Tile { x: r.x, y: r.y };
            r.order = Some(ResidentOrder::Repair(RepairOrder { building_id: id.clone(), at }));
        } else {
            walk_to(r, *at);
        }
        return true;
    }
    if !fetch {
        return false;
    }
    let Some(s) = store else { return false };
    let above = above_reserve(world, city, &world.buildings[s]);
    let Some((_, _, _, lacks)) =
        worn.into_iter().find(|w| w.3.iter().all(|(g, n)| held(&above, *g) >= *n))
    else {
        return false;
    };
    let sb = &world.buildings[s];
    if !is_at(here, placed(sb), size) {
        let at = (sb.x, sb.y);
        walk_to(&mut world.residents[i], at);
        return true;
    }
    debug_assert!(lacks.iter().all(|(g, n)| held_in(sb.stock.as_ref(), *g) >= *n));
    let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder { from, goods: lacks }));
    true
}

#[cfg(test)]
#[path = "npc_repair/tests.rs"]
mod tests;
