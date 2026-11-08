//! World queries of `packages/shared/src/army.ts` that survival needs (ADR 0002): whose army a
//! resident is in, and the Food on a carriage that army members and drivers may take.

use csp_shared::balance::HAUL_HORSE_FOOD;
use csp_shared::world::{Army, Carriage, Good, Resident, ResidentOrder, WorldState};

use super::names::held;

/// The army the resident is in, if any (`armyOf`, `CONTEXT.md`: Army: at most one).
pub fn army_of<'w>(world: &'w WorldState, resident_id: &str) -> Option<&'w Army> {
    world.armies.iter().find(|a| a.member_ids.iter().any(|id| id == resident_id))
}

/// The Food on a carriage that army members may take (`spareFood`, `CONTEXT.md`: Refilling from a
/// carriage): all of it, except what a haul route keeps on board for the horse.
pub fn spare_food(world: &WorldState, carriage: &Carriage) -> f64 {
    let keep = world
        .residents
        .iter()
        .find_map(|r| match &r.order {
            Some(ResidentOrder::Haul(o)) if o.carriage_id == carriage.id => Some(o.keep_food),
            _ => None,
        })
        .unwrap_or(0.0);
    (held(&carriage.load, Good::Food) - keep).max(0.0)
}

/// Where in `world.carriages` the carriage a resident drives stands (a drive order or a haul
/// route), and the Food on it they may take as its driver (`driversFood`, `CONTEXT.md`: Refilling
/// from a carriage): all of it, except the horse's share of what a haul route keeps on board
/// (`HAUL_HORSE_FOOD`, at most its `keepFood`).
pub fn drivers_food(world: &WorldState, driver: &Resident) -> Option<(usize, f64)> {
    let (carriage_id, keep) = match &driver.order {
        Some(ResidentOrder::Drive(o)) => (&o.carriage_id, 0.0),
        Some(ResidentOrder::Haul(o)) => (&o.carriage_id, o.keep_food.min(HAUL_HORSE_FOOD)),
        _ => return None,
    };
    let i = world.carriages.iter().position(|k| &k.id == carriage_id)?;
    Some((i, (held(&world.carriages[i].load, Good::Food) - keep).max(0.0)))
}
