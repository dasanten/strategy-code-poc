//! Respect and persuading a city, the queries of `packages/shared/src/persuasion.ts`
//! (`CONTEXT.md`: Respect, Persuading a city; ADR 0033).

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    BLOW_BASE, OUTWEIGH_HOLD_DAYS, PERSUADE_STANDING, RESPECT_PER_WALL, SIGHT_RANGE,
};
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, Outweighed, Resident, WorldState};

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

/// The respect an NPC city sees from each Organization near it (`respectBySide`, ADR 0033), by
/// the side their armed residents fight on (`wall_side`), as `respect_seen_by` weighs it. Those
/// with nothing near are left out.
pub fn respect_by_side<'w>(world: &'w WorldState, city: &City, size: i32) -> HashMap<&'w str, f64> {
    let mut out = HashMap::new();
    let area: HashSet<(i32, i32)> = city_area_tiles(world, &city.id, size).into_iter().collect();
    let home: Vec<(i32, i32)> =
        city_people(world, city).map(tile).filter(|t| area.contains(t)).collect();
    if home.is_empty() {
        return out;
    }
    let near = |t: (i32, i32)| {
        area.contains(&t) || home.iter().any(|&e| wrap_distance(size, e, t) <= SIGHT_RANGE)
    };
    for r in &world.residents {
        let Some(side) = wall_side(r) else { continue };
        if side == city.id
            || r.health <= 0.0
            || !is_armed(&r.carried)
            || is_lent_by(world, &r.id, &city.id)
            || !near(tile(r))
        {
            continue;
        }
        *out.entry(side).or_insert(0.0) += fighter_strength(r);
    }
    out
}

/// The respect an NPC city sees from an Organization (`respectSeenBy`, ADR 0033): the strength of
/// its armed residents standing in the city's area or in sight of one of the city's residents who
/// is at home, in that area. The Organization's walls don't count, nor what the city's people see
/// far from home, nor residents the city lent it. `org` is a realm, or another NPC city by its id.
/// `size` is the map's.
pub fn respect_seen_by(world: &WorldState, city: &City, org: &str, size: i32) -> f64 {
    respect_by_side(world, city, size).get(org).copied().unwrap_or(0.0)
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

/// How long a realm's force must outweigh an NPC city without a break before it yields to a
/// demand or asks to join (`OUTWEIGH_HOLD_DAYS`), in ticks.
pub fn outweigh_hold_ticks() -> f64 {
    OUTWEIGH_HOLD_DAYS * TICKS_PER_GAME_DAY
}

/// Since when the realm's force has outweighed the city without a break (`outweighedBy`), as of
/// its last planning pass.
pub fn outweighed_by<'c>(city: &'c City, realm_id: &str) -> Option<&'c Outweighed> {
    city.outweighed.iter().flatten().find(|o| o.realm_id == realm_id)
}

/// The ticks left before an NPC city yields to the realm's demand (`ticksUntilYield`, `CONTEXT.md`:
/// Demand): while it wavers, its force far outweighing the city, how long it must still stay;
/// `None` while it doesn't, and the time starts from nothing once it does.
pub fn ticks_until_yield(world: &WorldState, city: &City, realm_id: &str) -> Option<f64> {
    let since = outweighed_by(city, realm_id)?.far_since?;
    Some((since + outweigh_hold_ticks() - world.tick as f64).max(0.0))
}

/// Whether an NPC city holds a realm in high standing (`holdsHigh`, `PERSUADE_STANDING`).
pub fn holds_high(world: &WorldState, city: &City, realm_id: &str) -> bool {
    standing_of(world, &city.id, realm_id) >= PERSUADE_STANDING
}

/// Whether an NPC city would ask a realm to join (`persuadedBy`, ADR 0033): for sale, holding the
/// realm in high standing, and the realm's force has outweighed its own side for
/// `OUTWEIGH_HOLD_DAYS` without a break and still does.
pub fn persuaded_by(world: &WorldState, city: &City, realm_id: &str, size: i32) -> bool {
    for_sale(city)
        && holds_high(world, city, realm_id)
        && outweighed_by(city, realm_id)
            .is_some_and(|o| world.tick as f64 - o.since >= outweigh_hold_ticks())
        && respect_seen_by(world, city, realm_id, size) > city_strength(world, city)
}
