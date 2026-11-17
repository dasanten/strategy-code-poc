//! Stances (`CONTEXT.md`: Stance; Epic 98, T98.4): what an NPC city is after for now, picked again
//! at its first planning pass of each game day from its needs, threats and neighbours, tilted by
//! its temperament. Each stance's need is a number; the city takes the stance whose need, its
//! temperament's own stance's times `NPC_STANCE.temperament_tilt`, is greatest from one up, and
//! grows otherwise. The stance itself changes only a few numbers elsewhere: the soldiers it keeps,
//! its escorts, how far off its gates shut, how much danger weighs on its jobs (Fortify); its
//! surplus caps and traders (Trade); how long it waits full and how many scouts it sends (Expand).

use csp_shared::balance::{NPC_PLAN_TICKS, NPC_STANCE, NPC_TRADER_REACH};
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, City, Stance, Temperament, WorldState};

use crate::npc_behaviour::npc_home;
use crate::npc_plan::plan_due;
use crate::queries::city::{for_sale, has_food_surplus};
use crate::sight::InvariantViolation;

/// What `city` is after for now: its stance, or Grow for one with none stored (also any city the
/// game doesn't run as an NPC city).
pub fn stance_of(city: &City) -> Stance {
    city.stance.unwrap_or(Stance::Grow)
}

/// The stance a temperament leans to.
fn leans_to(t: Temperament) -> Stance {
    match t {
        Temperament::Merchant => Stance::Trade,
        Temperament::Militarist => Stance::Fortify,
        Temperament::Settler => Stance::Expand,
    }
}

/// How much `city` needs each stance but Grow now, before its temperament tilts them, in the
/// order a tie goes to: Fortify by the threat it feels from all Organizations together; Trade with
/// a Food surplus and a Trade Org warehouse in its traders' reach; Expand with a Food surplus and
/// no good short.
pub fn stance_needs(world: &WorldState, city: &City, size: i32) -> [(Stance, f64); 3] {
    let threat: f64 = city.threats.as_ref().map_or(0.0, |t| t.values().sum());
    let surplus = has_food_surplus(world, city);
    let warehouse = surplus
        && npc_home(world, &city.id).is_some_and(|home| {
            let at = (home.x as i32, home.y as i32);
            world.buildings.iter().any(|b| {
                b.kind == BuildingKind::Warehouse
                    && b.site.is_none()
                    && wrap_distance(size, at, (b.x as i32, b.y as i32)) <= NPC_TRADER_REACH
            })
        });
    let project = world.city_plans.get(&city.id).and_then(|p| p.project.as_ref());
    let room = surplus && crate::npc_chain::shortages(world, city, size, project).is_empty();
    [
        (Stance::Fortify, threat / NPC_STANCE.fortify_threat),
        (Stance::Trade, if warehouse { NPC_STANCE.trade_need } else { 0.0 }),
        (Stance::Expand, if room { NPC_STANCE.expand_need } else { 0.0 }),
    ]
}

/// The stance `city` picks now (`pickStance`): of its needs, its temperament's own stance's
/// tilted, the greatest from one up, the first of equals; Grow when none is.
pub fn pick_stance(world: &WorldState, city: &City, size: i32) -> Stance {
    let leans = crate::temperament::temperament_of(world.seed, city).map(leans_to);
    let mut best = (Stance::Grow, 1.0);
    for (stance, need) in stance_needs(world, city, size) {
        let need = if leans == Some(stance) { need * NPC_STANCE.temperament_tilt } else { need };
        if need >= best.1 && (best.0 == Stance::Grow || need > best.1) {
            best = (stance, need);
        }
    }
    best.0
}

/// Whether this tick is `city_id`'s first planning pass of a game day.
fn first_pass_of_day(world: &WorldState, city_id: &str) -> bool {
    let tick = world.tick as f64;
    plan_due(world, city_id)
        && (tick / TICKS_PER_GAME_DAY).floor()
            != ((tick - NPC_PLAN_TICKS) / TICKS_PER_GAME_DAY).floor()
}

/// One tick of stances (`stepStances`), after threat: an NPC city picks its stance at its first
/// planning pass of each game day; one that is no NPC city any more drops it at once. Grow is
/// stored as none.
pub fn step_stances(world: &mut WorldState, size: i32) {
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        if !for_sale(city) {
            if city.stance.is_some() {
                world.cities[ci].stance = None;
            }
            continue;
        }
        if !first_pass_of_day(world, &city.id) {
            continue;
        }
        let stance = pick_stance(world, city, size);
        world.cities[ci].stance = (stance != Stance::Grow).then_some(stance);
    }
}

/// The mood line whoever sees an NPC city reads of its stance (`CONTEXT.md`: Stance); the client
/// has the same words (`stance-view.ts`).
pub fn mood(stance: Stance) -> &'static str {
    match stance {
        Stance::Grow => "growing",
        Stance::Fortify => "arming",
        Stance::Trade => "busy trading",
        Stance::Expand => "looking to expand",
    }
}

/// How many times the soldiers it keeps by its size `city` keeps for its stance.
pub fn soldiers_factor(city: &City) -> f64 {
    if stance_of(city) == Stance::Fortify {
        NPC_STANCE.fortify_soldiers
    } else {
        1.0
    }
}

/// The soldiers more `city` sends with each escort for its stance.
pub fn extra_escorts(city: &City) -> usize {
    if stance_of(city) == Stance::Fortify {
        NPC_STANCE.fortify_escorts as usize
    } else {
        0
    }
}

/// How many times as far off `city` shuts its gates to an armed outsider for its stance.
pub fn gate_watch_factor(city: &City) -> f64 {
    if stance_of(city) == Stance::Fortify {
        NPC_STANCE.fortify_gate_watch
    } else {
        1.0
    }
}

/// The share of its surplus caps `city` works up to for its stance.
pub fn surplus_cap_factor(city: &City) -> f64 {
    if stance_of(city) == Stance::Trade {
        NPC_STANCE.trade_surplus_cap
    } else {
        1.0
    }
}

/// The traders more `city` has out for its stance.
pub fn extra_traders(city: &City) -> usize {
    if stance_of(city) == Stance::Trade {
        NPC_STANCE.trade_traders as usize
    } else {
        0
    }
}

/// The share of the days full `city` waits before it founds, for its stance.
pub fn full_days_factor(city: &City) -> f64 {
    if stance_of(city) == Stance::Expand {
        NPC_STANCE.expand_full_days
    } else {
        1.0
    }
}

/// How many times the scouts `city` sends for its stance.
pub fn scouts_factor(city: &City) -> f64 {
    if stance_of(city) == Stance::Expand {
        NPC_STANCE.expand_scouts
    } else {
        1.0
    }
}

/// Invariant `stances-sound` (`CONTEXT.md`: Stance; ADR 0004): only an NPC city holds a stance, and
/// none holds Grow, which is stored as none.
pub fn stances_sound(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .cities
        .iter()
        .filter_map(|c| {
            let why = match c.stance? {
                _ if !for_sale(c) => "holds a stance but is no NPC city",
                Stance::Grow => "holds Grow, which is stored as none",
                _ => return None,
            };
            Some(InvariantViolation {
                invariant: "stances-sound".into(),
                message: format!("{} {why}", c.id),
                entity_ids: vec![c.id.clone()],
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
