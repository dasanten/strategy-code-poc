//! The founding invariants (`npc-founding.ts`; ADR 0004).

use std::collections::HashMap;

use csp_shared::balance::NPC_FOUND_PARTY_MOST;
use csp_shared::world::WorldState;

use super::founding_party;
use crate::npc_plan::violation;
use crate::sight::InvariantViolation;

/// Invariant `founding-parties-sound` (`CONTEXT.md`: Founding): a founding party has a site and
/// at most `NPC_FOUND_PARTY_MOST` members, each in one party only and, while alive and of no
/// realm, of the city that sends it.
pub fn founding_parties_sound(world: &WorldState) -> Vec<InvariantViolation> {
    const NAME: &str = "founding-parties-sound";
    let mut out = Vec::new();
    let mut seen: HashMap<String, String> = HashMap::new();
    for (city_id, plan) in &world.city_plans {
        let party = founding_party(Some(plan));
        if party.is_empty() {
            continue;
        }
        if plan.founding_site.is_none() || party.len() as f64 > NPC_FOUND_PARTY_MOST {
            let site = if plan.founding_site.is_some() { "" } else { " and no site" };
            let message = format!("{city_id} has a party of {}{site}", party.len());
            out.push(violation(NAME, message, vec![city_id.clone()]));
        }
        for id in party {
            if let Some(other) = seen.get(&id) {
                let message = format!("{id} is in the founding parties of {other} and {city_id}");
                out.push(violation(NAME, message, vec![id.clone(), other.clone(), city_id.clone()]));
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
