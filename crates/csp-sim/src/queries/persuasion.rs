//! Respect and persuading a city, the queries of `packages/shared/src/persuasion.ts`
//! (`CONTEXT.md`: Respect, Persuading a city; ADR 0033).

use std::collections::HashSet;

use csp_shared::balance::{BLOW_BASE, PERSUADE_STANDING, RESPECT_PER_WALL, SIGHT_RANGE};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{City, Resident, WorldState};

use super::city::for_sale;
use super::city_area::city_area_tiles;
use super::combat::{combat_skill_factor, protection, weapon_attack};
use super::contract::is_lent_by;
use super::residents::is_armed;
use super::standing::standing_of;
use super::walls::{is_wall_or_gate, wall_side};

/// The residents who live in an NPC city (`cityPeople`), alive, wherever they stand.
fn city_people<'w>(world: &'w WorldState, city: &'w City) -> impl Iterator<Item = &'w Resident> {
    let id = city.id.as_str();
    world
        .residents
        .iter()
        .filter(move |r| r.owner.is_none() && r.city_id.as_deref() == Some(id) && r.health > 0.0)
}

fn tile(r: &Resident) -> (i32, i32) {
    (r.x as i32, r.y as i32)
}

/// How much an armed resident counts for in respect (`fighterStrength`, `CONTEXT.md`: Respect):
/// as combat weighs them, from their gear and training, not their body: the blow of their best
/// weapon, harder with Combat skill, and what their shield and armour take off each blow struck at
/// them. Nothing for the unarmed.
pub fn fighter_strength(r: &Resident) -> f64 {
    if !is_armed(&r.carried) {
        return 0.0;
    }
    (BLOW_BASE + weapon_attack(r)) * combat_skill_factor(r) + protection(r)
}

/// The respect an NPC city sees from an Organization (`respectSeenBy`, ADR 0033): the strength of
/// its armed residents standing in the city's area or in sight of one of the city's residents who
/// is at home, in that area. The Organization's walls don't count, nor what the city's people see
/// far from home, nor residents the city lent it. `org` is a realm, or an NPC city by its id.
/// `size` is the map's.
pub fn respect_seen_by(world: &WorldState, city: &City, org: &str, size: i32) -> f64 {
    let area: HashSet<(i32, i32)> = city_area_tiles(world, &city.id, size).into_iter().collect();
    let home: Vec<(i32, i32)> =
        city_people(world, city).map(tile).filter(|t| area.contains(t)).collect();
    if home.is_empty() {
        return 0.0;
    }
    let near = |t: (i32, i32)| {
        area.contains(&t) || home.iter().any(|&e| wrap_distance(size, e, t) <= SIGHT_RANGE)
    };
    world
        .residents
        .iter()
        .filter(|r| {
            r.health > 0.0
                && wall_side(r) == Some(org)
                && is_armed(&r.carried)
                && !is_lent_by(world, &r.id, &city.id)
                && near(tile(r))
        })
        .map(fighter_strength)
        .sum()
}

/// An NPC city's own side (`cityStrength`, ADR 0033): the strength of its soldiers, the armed
/// residents who live there, and `RESPECT_PER_WALL` for each of its finished walls and gates.
pub fn city_strength(world: &WorldState, city: &City) -> f64 {
    let soldiers: f64 = city_people(world, city).map(fighter_strength).sum();
    let walls = world
        .buildings
        .iter()
        .filter(|b| is_wall_or_gate(b) && b.city_id.as_deref() == Some(city.id.as_str()))
        .count();
    soldiers + RESPECT_PER_WALL * walls as f64
}

/// Whether an NPC city holds a realm in high standing (`holdsHigh`, `PERSUADE_STANDING`).
pub fn holds_high(world: &WorldState, city: &City, realm_id: &str) -> bool {
    standing_of(world, &city.id, realm_id) >= PERSUADE_STANDING
}

/// Whether an NPC city would ask a realm to join (`persuadedBy`): for sale, holding the realm in
/// high standing and seeing more respect from it than its own side.
pub fn persuaded_by(world: &WorldState, city: &City, realm_id: &str, size: i32) -> bool {
    for_sale(city)
        && holds_high(world, city, realm_id)
        && respect_seen_by(world, city, realm_id, size) > city_strength(world, city)
}
