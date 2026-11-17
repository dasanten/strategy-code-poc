//! Retaliating (`CONTEXT.md`: Retaliating, Stance; Epic 98, T98.8). An NPC city whose threat from a
//! realm reaches `NPC_RETALIATE.threat` while it knows of a recent crime of theirs against it turns
//! on them at its first planning pass of a game day: it takes the stance Retaliate. Then:
//!
//! - it arms as under Fortify (more soldiers, bigger escorts, gates shut sooner) and sends that
//!   realm demands (`npc_demands`);
//! - rarely, it marches: with a threat of `march_threat`, its standing toward them at
//!   `march_standing` or below and its soldiers beyond its hall and gate posts at least
//!   `march_outweigh` times as strong as the defenders of their nearest city, never in the realm's
//!   shelter, those soldiers walk to that city's town hall and stand on it, so they occupy it
//!   (Capturing a city);
//! - at each planning pass it checks whether it is over: its threat from them faded below
//!   `ends_below` (a paid demand clears it), or its losses left it the weaker (its strength below
//!   theirs). Then it turns to Fortify and a march under way is called off: its soldiers walk home.

use csp_shared::balance::NPC_RETALIATE;
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{CityMarch, ResidentOrder, Stance, WorldState};

use crate::npc_behaviour::{npc_home, walk_to};
use crate::npc_demands::{org_strength, sheltered};
use crate::npc_plan::plan_due;
use crate::npc_posts::{free_soldiers, posts_to_hold};
use crate::queries::alliance_rules::knows_recent_crime;
use crate::queries::city::{for_sale, town_hall_of};
use crate::queries::city_area::defends_city;
use crate::queries::names::placed;
use crate::queries::persuasion::{city_strength, fighter_strength};
use crate::queries::residents::can_work;
use crate::queries::standing::standing_of;
use crate::sight::InvariantViolation;
use csp_shared::world::City;

/// Its threat from `org`.
fn threat(city: &City, org: &str) -> f64 {
    city.threats.as_ref().and_then(|t| t.get(org).copied()).unwrap_or(0.0)
}

/// The realm `city` turns on, or stays turned on (`turnsOn`): the one it already retaliates
/// against, else of the realms it holds a threat of at least `NPC_RETALIATE.threat` from and knows
/// of a recent crime by, the one it fears most (the first by id of equals).
pub fn turns_on(world: &WorldState, city: &City) -> Option<String> {
    if let Some(org) = &city.retaliating {
        return Some(org.clone());
    }
    let mut threats: Vec<(&String, &f64)> = city.threats.iter().flatten().collect();
    threats.sort_by(|a, b| a.0.cmp(b.0));
    let mut best: Option<(&String, f64)> = None;
    for (org, &t) in threats {
        if t >= NPC_RETALIATE.threat
            && world.realms.iter().any(|r| &r.id == org)
            && knows_recent_crime(world, &city.id, org)
            && best.is_none_or(|b| t > b.1)
        {
            best = Some((org, t));
        }
    }
    best.map(|b| b.0.clone())
}

/// Whether `city`'s Retaliate against `org` is over: its threat from them faded, they are no realm
/// any more, or its losses left it the weaker.
pub fn retaliation_over(world: &WorldState, city: &City, org: &str) -> bool {
    threat(city, org) < NPC_RETALIATE.ends_below
        || !world.realms.iter().any(|r| r.id == org)
        || city_strength(world, city) < org_strength(world, org)
}

/// The soldiers marching for `city_id`, by id.
pub fn marchers(world: &WorldState, city_id: &str) -> Vec<String> {
    world
        .city_plans
        .get(city_id)
        .and_then(|p| p.march.as_ref())
        .map_or_else(Vec::new, |m| m.resident_ids.clone())
}

/// The NPC city `r` marches for, if any: they hold a town hall for it (`occupation_of`).
pub fn marching_for(world: &WorldState, id: &str, city_id: Option<&str>) -> Option<String> {
    let city_id = city_id?;
    let m = world.city_plans.get(city_id)?.march.as_ref()?;
    m.resident_ids.iter().any(|x| x == id).then(|| city_id.to_string())
}

/// One tick of retaliating (`stepNpcRetaliate`), after hunts: each NPC city in Retaliate checks at
/// its planning pass whether it is over, marches at its first pass of a game day if it would, and
/// keeps its march going. A march of a city no longer in Retaliate is called off.
pub fn step_npc_retaliate(world: &mut WorldState, size: i32) {
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        let id = city.id.clone();
        let Some(org) = city.retaliating.clone().filter(|_| for_sale(city)) else {
            if world.city_plans.get(&id).is_some_and(|p| p.march.is_some()) {
                call_off(world, &id);
            }
            continue;
        };
        if plan_due(world, &id) && retaliation_over(world, city, &org) {
            let c = &mut world.cities[ci];
            (c.stance, c.retaliating) = (Some(Stance::Fortify), None);
            call_off(world, &id);
            continue;
        }
        let marching = world.city_plans.get(&id).is_some_and(|p| p.march.is_some());
        if !marching && crate::npc_stance::first_pass_of_day(world, &id) {
            if let Some(m) = would_march(world, &world.cities[ci], &org, size) {
                if let Some(plan) = world.city_plans.get_mut(&id) {
                    plan.march = Some(m);
                }
            }
        }
        keep_march(world, &id, &org, size);
    }
}

/// The march `city` would send against `org` now (`wouldMarch`), if it would.
pub fn would_march(world: &WorldState, city: &City, org: &str, size: i32) -> Option<CityMarch> {
    if threat(city, org) < NPC_RETALIATE.march_threat
        || standing_of(world, &city.id, org) > NPC_RETALIATE.march_standing
        || sheltered(world, org)
    {
        return None;
    }
    let home = npc_home(world, &city.id)?;
    let at = (home.x as i32, home.y as i32);
    let target = world
        .cities
        .iter()
        .filter(|c| c.realm_id.as_deref() == Some(org))
        .filter_map(|c| town_hall_of(world, c).map(|h| (c, h)))
        .min_by(|a, b| {
            let d =
                |h: &csp_shared::world::Building| wrap_distance(size, at, (h.x as i32, h.y as i32));
            d(a.1).total_cmp(&d(b.1))
        })?
        .0;
    let defenders: f64 = world
        .residents
        .iter()
        .filter(|r| r.health > 0.0 && defends_city(world, target, r, size))
        .map(fighter_strength)
        .sum();
    let tick = world.tick as f64;
    let adults: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none()
                && r.city_id.as_ref() == Some(&city.id)
                && r.health > 0.0
                && can_work(r.born_at, tick)
        })
        .collect();
    let mut free = free_soldiers(world, city, &adults);
    free.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    let army: Vec<usize> = free.into_iter().skip(posts_to_hold(world, city) as usize).collect();
    let strength: f64 = army.iter().map(|&i| fighter_strength(&world.residents[i])).sum();
    if army.is_empty() || strength < NPC_RETALIATE.march_outweigh * defenders {
        return None;
    }
    Some(CityMarch {
        city_id: target.id.clone(),
        resident_ids: army.iter().map(|&i| world.residents[i].id.clone()).collect(),
    })
}

/// Takes `city_id`'s march a step on: drops marchers who fell or left, calls it off once nobody is
/// left or the city is no longer `org`'s; the rest walk to its town hall and stand on it, unless
/// fighting.
fn keep_march(world: &mut WorldState, city_id: &str, org: &str, size: i32) {
    let Some(m) = world.city_plans.get(city_id).and_then(|p| p.march.clone()) else { return };
    let target =
        world.cities.iter().find(|c| c.id == m.city_id && c.realm_id.as_deref() == Some(org));
    let Some(hall) = target.and_then(|t| town_hall_of(world, t)).cloned() else {
        return call_off(world, city_id);
    };
    let ids: Vec<String> = m
        .resident_ids
        .iter()
        .filter(|id| {
            world.residents.iter().any(|r| {
                &r.id == *id
                    && r.health > 0.0
                    && r.owner.is_none()
                    && r.city_id.as_deref() == Some(city_id)
            })
        })
        .cloned()
        .collect();
    if ids.is_empty() {
        return call_off(world, city_id);
    }
    if let Some(plan) = world.city_plans.get_mut(city_id) {
        plan.march = Some(CityMarch { city_id: m.city_id.clone(), resident_ids: ids.clone() });
    }
    for id in ids {
        let i = world.residents.iter().position(|r| r.id == id).expect("a marcher");
        let r = &mut world.residents[i];
        if matches!(r.order, Some(ResidentOrder::Attack(_)))
            || is_at((r.x as i32, r.y as i32), placed(&hall), size)
        {
            continue;
        }
        let going = matches!(&r.order, Some(ResidentOrder::WalkTo(w))
            if w.target.x == hall.x && w.target.y == hall.y);
        if !going {
            (r.script, r.interrupted) = (None, None);
            walk_to(r, (hall.x, hall.y));
        }
    }
}

/// Calls off `city_id`'s march (`callOff`): its soldiers stop and walk home.
pub fn call_off(world: &mut WorldState, city_id: &str) {
    let Some(m) = world.city_plans.get_mut(city_id).and_then(|p| p.march.take()) else { return };
    let home = world
        .cities
        .iter()
        .find(|c| c.id == city_id)
        .and_then(|c| town_hall_of(world, c))
        .map(|h| (h.x, h.y));
    for id in m.resident_ids {
        let Some(r) = world.residents.iter_mut().find(|r| r.id == id) else { continue };
        r.order = None;
        if let Some(home) = home {
            walk_to(r, home);
        }
    }
}

/// Invariant `marches-sound` (`CONTEXT.md`: Retaliating; ADR 0004): only a city in Retaliate
/// marches, on a city of the realm it turned on, with its own living residents.
pub fn marches_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let Some(m) = &plan.march else { continue };
        let city = world.cities.iter().find(|c| &c.id == city_id);
        let org = city.and_then(|c| c.retaliating.as_deref());
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "marches-sound".into(),
                message,
                entity_ids: vec![city_id.clone()],
            });
        };
        let Some(org) = org else {
            fail(format!("{city_id} marches but retaliates against nobody"));
            continue;
        };
        if !world.cities.iter().any(|c| c.id == m.city_id && c.realm_id.as_deref() == Some(org)) {
            fail(format!("{city_id} marches on {}, which is not {org}'s", m.city_id));
        }
        for id in &m.resident_ids {
            let ok = world.residents.iter().any(|r| {
                &r.id == id && r.city_id.as_deref() == Some(city_id.as_str()) && r.owner.is_none()
            });
            if !ok {
                fail(format!("{city_id} marches with {id}, who is not its own"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
