//! Army queries of `packages/shared/src/army.ts` (`CONTEXT.md`: Army, Supply line, Refilling
//! from a carriage).

use csp_shared::balance::HAUL_HORSE_FOOD;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Army, Carriage, Good, HaulStop, Resident, ResidentOrder, WorldState};

use super::names::held;

/// The longest an army's name may be (`ARMY_NAME_MAX_LENGTH`).
pub const ARMY_NAME_MAX_LENGTH: usize = 30;

/// The army the resident is in, if any (`armyOf`).
pub fn army_of<'w>(world: &'w WorldState, resident_id: &str) -> Option<&'w Army> {
    world.armies.iter().find(|a| a.member_ids.iter().any(|id| id == resident_id))
}

/// The army a driver's carriage goes after now (`armyDrivenTo`): the one a drive order follows,
/// or the one a haul route has as its second stop while bound there or standing with it.
pub fn army_driven_to(driver: &Resident) -> Option<&str> {
    match &driver.order {
        Some(ResidentOrder::Drive(o)) => o.army.as_deref(),
        Some(ResidentOrder::Haul(o)) if o.stop == HaulStop::To => o.to_army.as_deref(),
        _ => None,
    }
}

/// Where an army is for a carriage at `from` that goes after it (`armySpot`): the tile of its
/// member nearest `from`. `army_id` may name a Trade Org punishment. None when the army is gone.
pub fn army_spot(
    world: &WorldState,
    army_id: &str,
    from: (f64, f64),
    size: i32,
) -> Option<(f64, f64)> {
    let members: Vec<&str> = match world.armies.iter().find(|a| a.id == army_id) {
        Some(a) => a.member_ids.iter().map(String::as_str).collect(),
        None => world
            .punishments
            .iter()
            .find(|p| p.id == army_id)?
            .members
            .iter()
            .map(|m| m.resident_id.as_str())
            .collect(),
    };
    let mut best: Option<((f64, f64), f64)> = None;
    for r in &world.residents {
        if !members.contains(&r.id.as_str()) {
            continue;
        }
        let d = wrap_distance(size, (from.0 as i32, from.1 as i32), (r.x as i32, r.y as i32));
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some(((r.x, r.y), d));
        }
    }
    best.map(|b| b.0)
}

/// The Food on a carriage that army members may take (`spareFood`): all of it but what a haul
/// route keeps on board for the horse.
pub fn spare_food(world: &WorldState, carriage: &Carriage) -> f64 {
    let keep = world
        .residents
        .iter()
        .find_map(|r| match &r.order {
            Some(ResidentOrder::Haul(o)) if o.carriage_id == carriage.id => Some(o.keep_food),
            _ => None,
        })
        .unwrap_or(0.0);
    0f64.max(held(&carriage.load, Good::Food) - keep)
}

/// The carriage a resident drives and the Food on it they may take as its driver
/// (`driversFood`): all of it but the horse's share of what a haul route keeps on board.
pub fn drivers_food<'w>(world: &'w WorldState, driver: &Resident) -> Option<(&'w Carriage, f64)> {
    let (carriage_id, keep) = match &driver.order {
        Some(ResidentOrder::Drive(o)) => (&o.carriage_id, 0.0),
        Some(ResidentOrder::Haul(o)) => (&o.carriage_id, o.keep_food.min(HAUL_HORSE_FOOD)),
        _ => return None,
    };
    let carriage = world.carriages.iter().find(|k| k.id == *carriage_id)?;
    Some((carriage, 0f64.max(held(&carriage.load, Good::Food) - keep)))
}
