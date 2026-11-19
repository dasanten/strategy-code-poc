//! The founding invariants (`npc-founding.ts`; ADR 0004).

use std::collections::HashMap;

use csp_shared::world::WorldState;

use super::founding_party;
use crate::npc_plan::violation;
use crate::sight::InvariantViolation;

/// Invariant `founding-parties-sound` (`CONTEXT.md`: Founding): a founding party has a site, and
/// each member is in one party only and, while alive and of no realm, of the city that sends it.
/// Its size isn't held to `NPC_FOUND_PARTY_MOST`: as many more go as it takes to carry its load
/// (Daniel, 2026-11-15; #1379: a city of 110 sent 16).
pub fn founding_parties_sound(world: &WorldState) -> Vec<InvariantViolation> {
    const NAME: &str = "founding-parties-sound";
    let mut out = Vec::new();
    let mut seen: HashMap<String, String> = HashMap::new();
    for (city_id, plan) in &world.city_plans {
        let party = founding_party(Some(plan));
        if party.is_empty() {
            continue;
        }
        if plan.founding_site.is_none() {
            let message = format!("{city_id} has a party of {} and no site", party.len());
            out.push(violation(NAME, message, vec![city_id.clone()]));
        }
        for id in party {
            if let Some(other) = seen.get(&id) {
                let message = format!("{id} is in the founding parties of {other} and {city_id}");
                out.push(violation(
                    NAME,
                    message,
                    vec![id.clone(), other.clone(), city_id.clone()],
                ));
            }
            seen.insert(id.clone(), city_id.clone());
            let Some(r) = world.residents.iter().find(|r| r.id == id) else { continue };
            if r.health > 0.0 && r.owner.is_none() && r.city_id.as_deref() != Some(city_id) {
                let of = r.city_id.as_deref().unwrap_or("no city");
                let message = format!("{id} of {city_id}'s founding party belongs to {of}");
                out.push(violation(NAME, message, vec![id.clone(), city_id.clone()]));
            }
        }
    }
    out
}

/// Invariant `full-wait-sound` (`CONTEXT.md`: Founding): a city short of room since a tick no
/// later than now has its full wait under way, and no founding party yet.
pub fn full_wait_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let Some(short) = plan.short_since else { continue };
        let party = founding_party(Some(plan)).len();
        if plan.full_since.is_some() && party == 0 && short <= world.tick as f64 {
            continue;
        }
        let with = if plan.full_since.is_none() {
            "no wait under way".to_string()
        } else {
            format!("a party of {party}")
        };
        let message = format!("{city_id} has been short since {short}, with {with}");
        out.push(violation("full-wait-sound", message, vec![city_id.clone()]));
    }
    out
}

/// Invariant `founding-site-clear` (`CONTEXT.md`: Founding, Starting site): no city's founding
/// site lies within `NPC_STARTING_SITE_CLEARANCE` of a starting site.
pub fn founding_site_clear(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let starting = crate::land_sites::starting_site_middles(world);
    if starting.is_empty() {
        return Vec::new();
    }
    let half = (csp_shared::balance::NPC_VILLAGE.size / 2.0).floor();
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let Some(site) = plan.founding_site else { continue };
        // The site is the daughter's town hall; the middle of its square as `find_founding_site`.
        let (x, y) = super::square_of((site.x as i32, site.y as i32));
        let middle = (f64::from(x) + half, f64::from(y) + half);
        if crate::land_sites::near_a_starting_site(&starting, size, middle) {
            let message = format!("{city_id} means to found by a starting site at {site:?}");
            out.push(violation("founding-site-clear", message, vec![city_id.clone()]));
        }
    }
    out
}

/// Invariant `founding-party-sets-out-loaded` (`CONTEXT.md`: Founding; Daniel, 2026-11-19,
/// #1438): a founding party that set out this tick has the room for at least its town hall's
/// materials and its Food for the walk and the first weeks; a second wave brings the rest.
pub fn founding_party_sets_out_loaded(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    use csp_shared::balance::WALK_TICKS_PER_TILE;
    use csp_shared::terrain::wrap_distance;
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        if plan.planned_at != tick || plan.full_since != Some(tick) {
            continue;
        }
        let party: Vec<usize> = {
            let ids = founding_party(Some(plan));
            if ids.is_empty() {
                continue;
            }
            (0..world.residents.len()).filter(|&i| ids.contains(&world.residents[i].id)).collect()
        };
        let (Some(city), Some(home), Some(site)) = (
            world.cities.iter().find(|c| &c.id == city_id),
            crate::npc_behaviour::npc_home(world, city_id),
            plan.founding_site,
        ) else {
            continue;
        };
        let walk =
            wrap_distance(size, (home.x as i32, home.y as i32), (site.x as i32, site.y as i32))
                * WALK_TICKS_PER_TILE;
        let load = super::PartyLoad::new(world, city, walk);
        let (holds, least) = (load.holds(&party), load.to_set_out(party.len()));
        if holds < least - 1e-9 {
            let message = format!(
                "{city_id}'s party of {} set out holding {holds:.1}, under its hall and Food's {least:.1}",
                party.len()
            );
            out.push(violation("founding-party-sets-out-loaded", message, vec![city_id.clone()]));
        }
    }
    out
}

/// Invariant `founding-wave-sound` (`CONTEXT.md`: Founding; Daniel, 2026-11-19, #1438): a plan
/// made this tick that keeps its founding site with no full wait under way does so only to send
/// the rest of its party's load after the daughter it founded there: a finished town hall stands
/// on the site.
pub fn founding_wave_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        if plan.planned_at != tick || plan.full_since.is_some() || plan.founding_site.is_none() {
            continue;
        }
        if !super::hall_stands(world, plan) {
            let message = format!(
                "{city_id} keeps its founding site {:?} with no wait and no hall there",
                plan.founding_site
            );
            out.push(violation("founding-wave-sound", message, vec![city_id.clone()]));
        }
    }
    out
}
