//! Carriage queries of `packages/shared/src/carriages.ts`, read only: its horse, its driver and
//! passengers, what it holds and how loaded it looks, a caravan's crew.

use csp_shared::balance::{
    CARAVAN_ESCORTS, CARAVAN_FOOD, CARAVAN_FOOD_PER_ESCORT, CARRIAGE_HALF_LOAD, CARRIAGE_LIGHT_LOAD,
};
use csp_shared::protocol::LoadLevel;
use csp_shared::world::{Carriage, Horse, Resident, ResidentOrder, Stock, WorldState};

use super::residents::{carriage_capacity_with, is_down, stock_weight};

/// Everyone on a caravan or trader, by id (`crewIdsOf`): its driver, if any, and its escort.
pub fn crew_ids_of(driver_id: Option<&str>, escort_ids: &[String]) -> Vec<String> {
    driver_id.map(str::to_string).into_iter().chain(escort_ids.iter().cloned()).collect()
}

/// The carriage a horse is hitched to, if it pulls one (`carriagePulledBy`).
pub fn carriage_pulled_by<'w>(world: &'w WorldState, horse_id: &str) -> Option<&'w Carriage> {
    world.carriages.iter().find(|k| k.horse_id.as_deref() == Some(horse_id))
}

/// Why a horse can't be hitched to a carriage now (`hitchHorseProblem`), if it can't.
fn hitch_horse_problem(
    world: &WorldState,
    carriage: &Carriage,
    horse: &Horse,
) -> Option<&'static str> {
    if horse.realm_id != carriage.realm_id || horse.city_id != carriage.city_id {
        return Some("not a horse of your realm");
    }
    if horse.x != carriage.x || horse.y != carriage.y {
        return Some("that horse is not on the carriage’s tile");
    }
    if carriage_pulled_by(world, &horse.id).is_some() {
        return Some("that horse already pulls a carriage");
    }
    if world.residents.iter().any(|r| r.riding.as_deref() == Some(horse.id.as_str())) {
        return Some("someone rides that horse");
    }
    if is_down(horse.down_until) {
        return Some("that horse is Down");
    }
    None
}

/// The horse that pulls a carriage once it is driven (`horseFor`): the one hitched to it, or else
/// one of its realm (or NPC city) on its tile that pulls no other carriage, nobody rides and isn't
/// Down.
pub fn horse_for<'w>(world: &'w WorldState, carriage: &Carriage) -> Option<&'w Horse> {
    if let Some(id) = carriage.horse_id.as_deref() {
        return world.horses.iter().find(|h| h.id == id);
    }
    world.horses.iter().find(|h| hitch_horse_problem(world, carriage, h).is_none())
}

/// The carriage a resident drives, by a drive order or on a haul route (`drivenCarriageId`).
pub fn driven_carriage_id(r: &Resident) -> Option<&str> {
    match &r.order {
        Some(ResidentOrder::Drive(o)) => Some(&o.carriage_id),
        Some(ResidentOrder::Haul(o)) => Some(&o.carriage_id),
        _ => None,
    }
}

/// The resident driving a carriage, if anyone is (`driverOf`).
pub fn driver_of<'w>(world: &'w WorldState, carriage_id: &str) -> Option<&'w Resident> {
    world.residents.iter().find(|r| driven_carriage_id(r) == Some(carriage_id))
}

/// Whether a carriage stands still with nothing to move it (`standsStill`): no driver, or its
/// horse Down or missing.
pub fn stands_still(world: &WorldState, carriage: &Carriage) -> bool {
    if driver_of(world, &carriage.id).is_none() {
        return true;
    }
    horse_for(world, carriage).is_none_or(|h| is_down(h.down_until))
}

/// Most weight a carriage holds, in kg (`carriageCapacity`): by the Strength of its horse.
pub fn carriage_capacity(world: &WorldState, carriage: &Carriage) -> f64 {
    carriage_capacity_with(horse_for(world, carriage))
}

/// The residents aboard a carriage (`passengersOf`).
pub fn passengers_of<'w>(world: &'w WorldState, carriage_id: &str) -> Vec<&'w Resident> {
    world.residents.iter().filter(|r| r.aboard.as_deref() == Some(carriage_id)).collect()
}

/// How heavily a load looks against what its carriage holds (`loadLevel`).
pub fn load_level(load: &Stock, capacity: f64) -> LoadLevel {
    let share = stock_weight(load) / capacity;
    if share <= 0.0 {
        LoadLevel::Empty
    } else if share <= CARRIAGE_LIGHT_LOAD {
        LoadLevel::Light
    } else if share <= CARRIAGE_HALF_LOAD {
        LoadLevel::Half
    } else if share < 1.0 - 1e-9 {
        LoadLevel::Heavy
    } else {
        LoadLevel::Full
    }
}

/// The Food a caravan or trader with `escorts` escorts keeps on board for its crew
/// (`caravanFoodFor`).
pub fn caravan_food_for(escorts: f64) -> f64 {
    CARAVAN_FOOD + CARAVAN_FOOD_PER_ESCORT * (escorts - CARAVAN_ESCORTS).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queries::residents::good_weight;
    use csp_shared::balance::CARRIAGE_CAPACITY;
    use csp_shared::world::Good;

    /// `loadLevel` of `sight.test.ts`.
    #[test]
    fn names_how_heavily_a_carriage_is_loaded_by_weight_against_its_capacity() {
        let food = |kg: f64| Stock::from_iter([(Good::Food, kg / good_weight(Good::Food))]);
        let level = |kg: f64| load_level(&food(kg), CARRIAGE_CAPACITY);
        assert_eq!(level(0.0), LoadLevel::Empty);
        assert_eq!(level(CARRIAGE_CAPACITY * CARRIAGE_LIGHT_LOAD), LoadLevel::Light);
        assert_eq!(level(CARRIAGE_CAPACITY / 2.0), LoadLevel::Half);
        assert_eq!(level(CARRIAGE_CAPACITY * 0.9), LoadLevel::Heavy);
        assert_eq!(level(CARRIAGE_CAPACITY), LoadLevel::Full);
        // Behind a stronger horse the same load leaves room.
        assert_eq!(load_level(&food(CARRIAGE_CAPACITY), CARRIAGE_CAPACITY * 1.2), LoadLevel::Heavy);
    }

    #[test]
    fn a_crew_is_its_driver_and_its_escort() {
        let escorts = vec!["e1".to_string(), "e2".to_string()];
        assert_eq!(crew_ids_of(Some("d"), &escorts), ["d", "e1", "e2"]);
        assert_eq!(crew_ids_of(None, &escorts), ["e1", "e2"]);
    }
}
