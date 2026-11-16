//! What an NPC city is like (`CONTEXT.md`: Temperament, Epic 98): merchant, militarist or
//! settler, fixed when it comes into being. A city gets it from the world's seed and its id; a
//! daughter mostly takes its mother's. One with none stored (a city from before T98.1) reads it
//! from its id, so it never changes. On its own it changes nothing; stances and job scores weigh
//! it.

use csp_shared::balance::NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT;
use csp_shared::world::{City, Temperament, WorldState};

use crate::random::hash_str;
use crate::sight::InvariantViolation;

/// The temperaments a city can get, in the order its id draws them.
pub const TEMPERAMENTS: [Temperament; 3] =
    [Temperament::Merchant, Temperament::Militarist, Temperament::Settler];

/// The temperament a city gets from the world's seed and its id, so a world always picks the
/// same one for it.
pub fn pick_temperament(seed: i64, city_id: &str) -> Temperament {
    TEMPERAMENTS[(hash_str(&format!("{seed}:temperament:{city_id}")) % 3) as usize]
}

/// The temperament a daughter gets: its mother's, with the chance
/// `NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT` drawn from its id, else one of its own.
pub fn daughter_temperament(seed: i64, daughter_id: &str, mother: Temperament) -> Temperament {
    let roll = f64::from(hash_str(&format!("{seed}:mothers:{daughter_id}"))) / 4_294_967_296.0;
    if roll < NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT {
        mother
    } else {
        pick_temperament(seed, daughter_id)
    }
}

/// A city's temperament: the one it came into being with, or for a city from before there were
/// any, the one its id draws. None for a trading post or the HQ.
pub fn temperament_of(seed: i64, city: &City) -> Option<Temperament> {
    if city.trade_org.is_some() {
        return None;
    }
    Some(city.temperament.unwrap_or_else(|| pick_temperament(seed, &city.id)))
}

/// A daughter just founded takes its temperament from its mother (`found_daughter`).
pub fn inherit_temperament(world: &mut WorldState, mother_id: &str, daughter_id: &str) {
    let seed = world.seed;
    let Some(mother) =
        world.cities.iter().find(|c| c.id == mother_id).and_then(|c| temperament_of(seed, c))
    else {
        return;
    };
    if let Some(d) = world.cities.iter_mut().find(|c| c.id == daughter_id) {
        d.temperament = Some(daughter_temperament(seed, daughter_id, mother));
    }
}

/// Invariant `trading-posts-have-no-temperament` (`CONTEXT.md`: Temperament; ADR 0004): only an
/// NPC city has a temperament; a trading post or the HQ never gets one.
pub fn trading_posts_have_no_temperament(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .cities
        .iter()
        .filter(|c| c.trade_org.is_some() && c.temperament.is_some())
        .map(|c| InvariantViolation {
            invariant: "trading-posts-have-no-temperament".into(),
            message: format!("{} is the Trade Organization's but has a temperament", c.id),
            entity_ids: vec![c.id.clone()],
        })
        .collect()
}

#[cfg(test)]
mod tests;
