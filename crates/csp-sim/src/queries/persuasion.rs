//! Respect and persuading a city, the queries of `packages/shared/src/persuasion.ts`
//! (`CONTEXT.md`: Respect, Persuading a city).

use std::collections::HashMap;

use csp_shared::balance::{PERSUADE_STANDING, SIGHT_RANGE};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{City, Resident, WorldState};

use super::city::for_sale;
use super::residents::is_armed;
use super::standing::standing_of;
use super::walls::{is_wall_or_gate, wall_side};

/// The residents an NPC city sees through (`eyesOf`): those who live there, wherever they stand.
fn eyes_of<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Resident> {
    world
        .residents
        .iter()
        .filter(|r| {
            r.owner.is_none() && r.city_id.as_deref() == Some(city.id.as_str()) && r.health > 0.0
        })
        .collect()
}

/// The respect an NPC city sees from an Organization (`respectSeenBy`): how many of its armed
/// residents and its finished walls and gates are within sight range of anyone who lives there.
/// `org` is a realm, or an NPC city by its id. `size` is the map's.
pub fn respect_seen_by(world: &WorldState, city: &City, org: &str, size: i32) -> f64 {
    let eyes = eyes_of(world, city);
    if eyes.is_empty() {
        return 0.0;
    }
    let seen = |x: f64, y: f64| {
        eyes.iter().any(|e| {
            wrap_distance(size, (e.x as i32, e.y as i32), (x as i32, y as i32)) <= SIGHT_RANGE
        })
    };
    let armed = world
        .residents
        .iter()
        .filter(|r| {
            r.health > 0.0 && wall_side(r) == Some(org) && is_armed(&r.carried) && seen(r.x, r.y)
        })
        .count();
    let orgs: HashMap<&str, &str> = world
        .cities
        .iter()
        .map(|c| (c.id.as_str(), c.realm_id.as_deref().unwrap_or(&c.id)))
        .collect();
    let walls = world
        .buildings
        .iter()
        .filter(|b| {
            is_wall_or_gate(b)
                && b.city_id.as_deref().and_then(|c| orgs.get(c)) == Some(&org)
                && seen(b.x, b.y)
        })
        .count();
    (armed + walls) as f64
}

/// An NPC city's soldiers (`citySoldiers`): the armed residents who live there.
pub fn city_soldiers(world: &WorldState, city: &City) -> f64 {
    eyes_of(world, city).iter().filter(|r| is_armed(&r.carried)).count() as f64
}

/// Whether an NPC city holds a realm in high standing (`holdsHigh`, `PERSUADE_STANDING`).
pub fn holds_high(world: &WorldState, city: &City, realm_id: &str) -> bool {
    standing_of(world, &city.id, realm_id) >= PERSUADE_STANDING
}

/// Whether an NPC city would ask a realm to join (`persuadedBy`): for sale, holding the realm in
/// high standing and seeing more respect from it than it has soldiers.
pub fn persuaded_by(world: &WorldState, city: &City, realm_id: &str, size: i32) -> bool {
    for_sale(city)
        && holds_high(world, city, realm_id)
        && respect_seen_by(world, city, realm_id, size) > city_soldiers(world, city)
}
