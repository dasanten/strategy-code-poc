//! Survival: health, hunger, age, going down and dying.

// `!(x >= 0)` as the TypeScript writes it: true for NaN too, which a plain `x < 0` is not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use csp_shared::balance::{LIFESPAN_MAX, LIFESPAN_MIN, MAX_HEALTH, MAX_HUNGER, MEAL_UNITS};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Good, WorldState};

use super::shared::Out;
use super::{invariant, js_json, js_number, violation, Invariant};
use crate::queries::goods::units_that_fit;
use crate::queries::names::held;
use crate::queries::residents::age_in_years;
use crate::survival::{refill_source, refill_target};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("health-and-hunger-in-range", health_and_hunger_in_range),
    invariant("ages-in-range", ages_in_range),
    invariant("refilled-when-low", refilled_when_low),
    invariant("dead-leave-loot", dead_leave_loot),
    invariant("down-do-nothing", |w, _| crate::survival::down_do_nothing(w)),
    invariant("awake-alive", |w, _| crate::survival::awake_alive(w)),
];

/// Health and the hunger meter stay within their ranges, for residents and horses alike.
pub fn health_and_hunger_in_range(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "health-and-hunger-in-range";
    let mut living: Vec<(&str, &str, f64, f64)> = Vec::new();
    living.extend(world.residents.iter().map(|r| ("resident", r.id.as_str(), r.health, r.hunger)));
    living.extend(world.horses.iter().map(|h| ("horse", h.id.as_str(), h.health, h.hunger)));
    living
        .into_iter()
        .filter(|(_, _, health, hunger)| {
            !(*health >= 0.0 && *health <= MAX_HEALTH && *hunger >= 0.0 && *hunger <= MAX_HUNGER)
        })
        .map(|(what, id, health, hunger)| {
            let msg = format!(
                "{what} {id} has health {} and hunger {}",
                js_number(health),
                js_number(hunger)
            );
            violation(name, msg, &[id])
        })
        .collect()
}

/// Every resident has a lifespan in range and has not outlived it, and nobody is born after the
/// current tick (`agesInRange`).
pub fn ages_in_range(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "ages-in-range";
    let mut out = Vec::new();
    for r in &world.residents {
        let age = age_in_years(r.born_at, world.tick as f64);
        let mut problems = Vec::new();
        if !(r.lifespan >= LIFESPAN_MIN && r.lifespan <= LIFESPAN_MAX) {
            problems.push(format!("has lifespan {}", js_number(r.lifespan)));
        }
        if age >= r.lifespan {
            problems.push(format!(
                "is {} years old, past their lifespan {}",
                js_number(age),
                js_number(r.lifespan)
            ));
        }
        if !(age >= 0.0) {
            problems.push(format!("is born after the current tick ({})", js_number(r.born_at)));
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// After a tick, nobody at home, near an outpost storage of their realm, at their workplace, or
/// in an army or aboard as a passenger by a carriage runs low on food (a child at home: has less
/// than their own food) while the storage, pile or carriage they refill from still has some and
/// a meal would fit (`refilledWhenLow`, `stepRefill`, `refillTarget`).
pub fn refilled_when_low(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "refilled-when-low";
    let size = terrain.size;
    world
        .residents
        .iter()
        .filter(|r| {
            held(&r.carried, Good::Food) < refill_target(world, r, size)
                && refill_source(world, r, size).map_or(0.0, |s| s.food) > 0.0
                && units_that_fit(r, Good::Food, world.tick as f64) >= MEAL_UNITS
        })
        .map(|r| {
            let msg = format!(
                "resident {} has only {} food where there is more",
                r.id,
                js_number(held(&r.carried, Good::Food))
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}

/// Dead residents leave their goods as loot: none with no health left is still in the world,
/// unless Down (`deadLeaveLoot`).
pub fn dead_leave_loot(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "dead-leave-loot";
    world
        .residents
        .iter()
        .filter(|r| !(r.health > 0.0) && r.down_until.is_none())
        .map(|r| {
            let msg = format!(
                "resident {} has no health left but is still in the world, holding {}",
                r.id,
                js_json(&r.carried)
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}
