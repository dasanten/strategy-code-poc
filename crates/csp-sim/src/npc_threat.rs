//! Threat and danger places (`CONTEXT.md`: Threat; Epic 98): how dangerous an NPC city thinks each
//! Organization is, apart from how it regards it (Standing), and where it lost people.
//!
//! - At its planning pass a city adds the strength of each Organization's armed residents it sees
//!   near itself or its people, by their gear (`THREAT_SEEN_PER_DAY`), and lets what it holds fade
//!   (`THREAT_HALF_LIFE_DAYS`, `DANGER_PLACE_HALF_LIFE_DAYS`).
//! - Learning that an Organization killed or robbed one of its people adds `THREAT_PER_KILLING` or
//!   `THREAT_PER_ROBBERY` (`note_crime_known`, from `crimes::learn`).
//! - One of its people killed outside its City area, by anyone, bandits too, marks a danger place
//!   (`note_losses`, from `survival::die_all`).
//!
//! Nothing acts on threat yet; danger places by a way grow the escort a city sends along it
//! (`danger_escorts`). All of it is the city's own mind: nobody else sees it.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    DANGER_ESCORTS_MAX, DANGER_PLACE_FORGOTTEN, DANGER_PLACE_HALF_LIFE_DAYS,
    DANGER_PLACE_MERGE_RANGE, DANGER_PLACE_WAY_REACH, NPC_PLAN_TICKS, SIGHT_RANGE,
    THREAT_FORGOTTEN, THREAT_HALF_LIFE_DAYS, THREAT_PER_KILLING, THREAT_PER_ROBBERY,
    THREAT_SEEN_PER_DAY,
};
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, CrimeKind, DangerPlace, Resident, WorldState};

use crate::npc_plan::plan_due;
use crate::queries::city::{for_sale, town_hall_of};
use crate::queries::city_area::{city_area_tiles, in_city_area};
use crate::queries::contract::is_lent_by;
use crate::queries::persuasion::fighter_strength;
use crate::queries::residents::is_armed;
use crate::queries::standing::standing_organization;
use crate::queries::walls::wall_side;
use crate::sight::InvariantViolation;

/// How much of a threat or danger place is left after `days` game days, fading to half every
/// `half_life` days.
fn faded(value: f64, days: f64, half_life: f64) -> f64 {
    value * 0.5f64.powf(days / half_life)
}

/// How dangerous `city` thinks the Organization `org` is (`threatOf`); nothing when it holds no
/// threat from it.
pub fn threat_of(world: &WorldState, city: &City, org: &str) -> f64 {
    let org = standing_organization(world, org);
    city.threats.as_ref().and_then(|t| t.get(org)).copied().unwrap_or(0.0)
}

/// Adds `by` to `city_id`'s threat from `org`, under the Organization `org` counts as. Nothing for
/// a city that is no NPC city, nor from itself.
fn raise_threat(world: &mut WorldState, city_id: &str, org: &str, by: f64) {
    let org = standing_organization(world, org).to_string();
    let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) else { return };
    if !for_sale(city) || org == city.id || by <= 0.0 {
        return;
    }
    *city.threats.get_or_insert_with(Default::default).entry(org).or_insert(0.0) += by;
}

/// What each Organization's armed residents near an NPC city or near one of its people weigh, as
/// respect weighs them (`seenArmed`): those in its City area or in sight of one of its people,
/// wherever they are. Its own and residents it lent out don't count.
pub fn seen_armed<'w>(world: &'w WorldState, city: &City, size: i32) -> HashMap<&'w str, f64> {
    let mut out = HashMap::new();
    let area: HashSet<(i32, i32)> = city_area_tiles(world, &city.id, size).into_iter().collect();
    let tile = |r: &Resident| (r.x as i32, r.y as i32);
    let eyes: Vec<(i32, i32)> = world
        .residents
        .iter()
        .filter(|r| {
            r.owner.is_none() && r.city_id.as_deref() == Some(city.id.as_str()) && r.health > 0.0
        })
        .map(tile)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if eyes.is_empty() {
        return out;
    }
    let near = |t: (i32, i32)| {
        area.contains(&t) || eyes.iter().any(|&e| wrap_distance(size, e, t) <= SIGHT_RANGE)
    };
    for r in &world.residents {
        let Some(side) = wall_side(r) else { continue };
        if side == city.id
            || r.health <= 0.0
            || !is_armed(r)
            || is_lent_by(world, &r.id, &city.id)
            || crate::npc_acting_first::hired_by(world, &r.id, &city.id)
            || !near(tile(r))
        {
            continue;
        }
        *out.entry(side).or_insert(0.0) += fighter_strength(r);
    }
    out
}

/// One tick of threat (`stepThreat`), after everyone has moved: at its planning pass an NPC city
/// lets its threats and danger places fade, forgets what fell below `THREAT_FORGOTTEN` and
/// `DANGER_PLACE_FORGOTTEN`, and takes threat from the armed residents it sees. A city that is no
/// NPC city any more forgets all of it at once.
pub fn step_threat(world: &mut WorldState, size: i32) {
    let days = NPC_PLAN_TICKS / TICKS_PER_GAME_DAY;
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        if !for_sale(city) {
            if city.threats.is_some() || city.danger_places.is_some() {
                let c = &mut world.cities[ci];
                c.threats = None;
                c.danger_places = None;
            }
            continue;
        }
        if !plan_due(world, &city.id) {
            continue;
        }
        let mut seen: Vec<(String, f64)> = seen_armed(world, city, size)
            .into_iter()
            .map(|(org, s)| (standing_organization(world, org).to_string(), s))
            .collect();
        // By id, so the same world always remembers in the same order.
        seen.sort_by(|a, b| a.0.cmp(&b.0));
        let c = &mut world.cities[ci];
        let mut threats = c.threats.take().unwrap_or_default();
        for v in threats.values_mut() {
            *v = faded(*v, days, THREAT_HALF_LIFE_DAYS);
        }
        for (org, strength) in seen {
            if org != c.id && strength > 0.0 {
                *threats.entry(org).or_insert(0.0) += strength * THREAT_SEEN_PER_DAY * days;
            }
        }
        threats.retain(|_, v| *v >= THREAT_FORGOTTEN);
        c.threats = (!threats.is_empty()).then_some(threats);
        let mut places = c.danger_places.take().unwrap_or_default();
        for p in &mut places {
            p.weight = faded(p.weight, days, DANGER_PLACE_HALF_LIFE_DAYS);
        }
        places.retain(|p| p.weight >= DANGER_PLACE_FORGOTTEN);
        c.danger_places = (!places.is_empty()).then_some(places);
    }
}

/// An NPC city learns of a crime against it (`noteCrimeKnown`, from `crimes::learn`): a killing or
/// a theft by `culprit_org` raises its threat from that Organization.
pub fn note_crime_known(
    world: &mut WorldState,
    victim_org: &str,
    culprit_org: &str,
    kind: CrimeKind,
) {
    let by = match kind {
        CrimeKind::Killing => THREAT_PER_KILLING,
        CrimeKind::Theft => THREAT_PER_ROBBERY,
        _ => return,
    };
    raise_threat(world, victim_org, culprit_org, by);
}

/// People killed (`noteLosses`, from `survival::die_all`, before they are gone): each who lived in
/// an NPC city and died outside its City area marks a danger place for it there, or adds to one it
/// remembers within `DANGER_PLACE_MERGE_RANGE`. Whoever killed them.
pub fn note_losses(world: &mut WorldState, killed: &[Resident], size: i32) {
    for r in killed {
        if r.owner.is_some() {
            continue;
        }
        let Some(city_id) = r.city_id.as_deref() else { continue };
        let Some(ci) = world.cities.iter().position(|c| c.id == city_id) else { continue };
        if !for_sale(&world.cities[ci]) || in_city_area(world, city_id, r.x, r.y, size) {
            continue;
        }
        let places = world.cities[ci].danger_places.get_or_insert_with(Vec::new);
        let near = places
            .iter_mut()
            .map(|p| {
                let d = distance_to_way(size, (p.x, p.y), (p.x, p.y), (r.x, r.y));
                (d, p)
            })
            .filter(|(d, _)| *d <= DANGER_PLACE_MERGE_RANGE)
            .min_by(|a, b| a.0.total_cmp(&b.0));
        match near {
            Some((_, p)) => p.weight += 1.0,
            None => places.push(DangerPlace { x: r.x.floor(), y: r.y.floor(), weight: 1.0 }),
        }
    }
}

/// How far a point lies from the way between two others, the short way round the map.
fn distance_to_way(size: i32, from: (f64, f64), to: (f64, f64), p: (f64, f64)) -> f64 {
    let s = f64::from(size);
    let delta = |a: f64, b: f64| {
        let d = (b - a).rem_euclid(s);
        if d > s / 2.0 {
            d - s
        } else {
            d
        }
    };
    let (wx, wy) = (delta(from.0, to.0), delta(from.1, to.1));
    let (px, py) = (delta(from.0, p.0), delta(from.1, p.1));
    let len2 = wx * wx + wy * wy;
    let t = if len2 == 0.0 { 0.0 } else { ((px * wx + py * wy) / len2).clamp(0.0, 1.0) };
    (px - t * wx).hypot(py - t * wy)
}

/// Soldiers more an NPC city sends along on the way from its town hall to `to` (`dangerEscorts`,
/// `CONTEXT.md`: Threat, Escort): the weight of the danger places it remembers within
/// `DANGER_PLACE_WAY_REACH` of the way, rounded up, at most `DANGER_ESCORTS_MAX`. `size` is the
/// map's.
pub fn danger_escorts(world: &WorldState, city: &City, to: (i32, i32), size: i32) -> usize {
    let Some(hall) = town_hall_of(world, city) else { return 0 };
    let to = (f64::from(to.0), f64::from(to.1));
    danger_by_way(city, (hall.x, hall.y), to, size).ceil().min(DANGER_ESCORTS_MAX) as usize
}

/// The weight of the danger places `city` remembers within `DANGER_PLACE_WAY_REACH` of the way from
/// `from` to `to` (`dangerByWay`); `size` is the map's.
pub fn danger_by_way(city: &City, from: (f64, f64), to: (f64, f64), size: i32) -> f64 {
    let Some(places) = city.danger_places.as_deref() else { return 0.0 };
    places
        .iter()
        .filter(|p| distance_to_way(size, from, to, (p.x, p.y)) <= DANGER_PLACE_WAY_REACH)
        .map(|p| p.weight)
        .sum()
}

/// Invariant (`threatSound`, `CONTEXT.md`: Threat): only an NPC city holds threats and danger
/// places; a threat is a number at least `THREAT_FORGOTTEN` (never negative), toward another
/// Organization; a danger place's weight is at least `DANGER_PLACE_FORGOTTEN`: it fades away, and
/// is forgotten below that. Empty lists are left out.
pub fn threat_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut report = |city: &City, message: String| {
        out.push(InvariantViolation {
            invariant: "threat-sound".into(),
            message,
            entity_ids: vec![city.id.clone()],
        });
    };
    let at_least = |x: f64, y: f64| x.is_finite() && x >= y;
    for city in &world.cities {
        if city.threats.is_none() && city.danger_places.is_none() {
            continue;
        }
        if !for_sale(city) {
            report(city, format!("{} is no NPC city but holds threats or danger places", city.id));
            continue;
        }
        for (org, v) in city.threats.iter().flatten() {
            if !at_least(*v, THREAT_FORGOTTEN) {
                report(city, format!("{} holds a threat of {v} from {org}", city.id));
            }
            if *org == city.id {
                report(city, format!("{} holds a threat from itself", city.id));
            }
        }
        if city.threats.as_ref().is_some_and(|t| t.is_empty()) {
            report(city, format!("{} keeps an empty list of threats", city.id));
        }
        let places = city.danger_places.as_deref().unwrap_or_default();
        if city.danger_places.is_some() && places.is_empty() {
            report(city, format!("{} keeps an empty list of danger places", city.id));
        }
        for p in places {
            if !at_least(p.weight, DANGER_PLACE_FORGOTTEN) {
                report(
                    city,
                    format!("{} remembers a danger place of weight {}", city.id, p.weight),
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
