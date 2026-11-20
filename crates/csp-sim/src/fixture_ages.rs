//! The frozen TypeScript fixtures (`crates/csp-sim/fixtures`) aged by today's rules: Epic 113
//! shortened childhood, so a resident the TypeScript made at an age has another `bornAt` now. Only
//! the fixture comparisons use this.

use csp_shared::world::WorldState;

/// Game days each year of a child's age took in the TypeScript the fixtures were frozen from;
/// Epic 113 made it `CHILD_YEAR_DAYS`.
pub const TYPESCRIPT_CHILD_YEAR_DAYS: f64 = 10.0;

/// A `bornAt` a frozen fixture holds for a resident seen at `tick`, moved so today's childhood
/// (`CHILD_YEAR_DAYS`) gives them the same age: a grown resident's by the difference in childhood
/// (exact, as both are whole ticks), a child's by the ratio of the years.
pub fn born_at_as_today(born_at: f64, tick: f64) -> f64 {
    use csp_shared::balance::{ADULT_AGE, CHILD_YEAR_DAYS};
    use csp_shared::time::TICKS_PER_GAME_DAY;
    let then = ADULT_AGE * TYPESCRIPT_CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    let now = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    let lived = tick - born_at;
    if lived >= then {
        born_at + then - now
    } else {
        tick - crate::queries::js_round(lived * CHILD_YEAR_DAYS / TYPESCRIPT_CHILD_YEAR_DAYS)
    }
}

/// Every resident of a frozen fixture's world given today's `bornAt` (`born_at_as_today`).
pub fn residents_aged_as_today(world: &mut WorldState) {
    let tick = world.tick as f64;
    for r in &mut world.residents {
        r.born_at = born_at_as_today(r.born_at, tick);
    }
}

/// The same for every `bornAt` in a frozen fixture's JSON of residents (not horses), seen at `tick`.
pub fn json_aged_as_today(v: &mut serde_json::Value, tick: f64) {
    match v {
        serde_json::Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                match x.as_f64() {
                    Some(born_at) if k == "bornAt" => {
                        *x = serde_json::json!(born_at_as_today(born_at, tick))
                    }
                    _ => json_aged_as_today(x, tick),
                }
            }
        }
        serde_json::Value::Array(a) => a.iter_mut().for_each(|x| json_aged_as_today(x, tick)),
        _ => {}
    }
}
