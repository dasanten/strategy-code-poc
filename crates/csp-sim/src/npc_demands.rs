//! NPC demands and the new realm's shelter (`CONTEXT.md`: NPC demand, New realm's shelter, Demand;
//! Epic 98, T98.7). At its first planning pass of a game day, a militarist NPC city sends each
//! realm it knows of (one it holds a threat from, or a standing with either way) whose armed
//! residents it far outweighs an ordinary Demand for Coins, with a deadline: never to the Trade
//! Organization, nor to a realm still in its shelter, nor again before `NPC_DEMAND_AGAIN_DAYS`.
//! Paid, its threat from the payer is gone and its standing toward them is back to neutral at
//! least; refused or lapsed, it turns hostile (`NPC_DEMAND_REFUSED_STANDING`). A city in Retaliate
//! (T98.8) is to send them too.
//!
//! The Player pays by a Transfer to the city (`npc_demand_hand_over`): it fetches nothing set
//! aside.

use csp_shared::balance::{
    NEW_REALM_SHELTER_DAYS, NPC_DEMAND_AGAIN_DAYS, NPC_DEMAND_MIN_STRENGTH,
    NPC_DEMAND_OUTWEIGH_TIMES, NPC_DEMAND_REFUSED_STANDING,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, Demand, DemandTerms, Good, Temperament, WorldState};

use crate::demands::send_npc_demand;
use crate::queries::city::for_sale;
use crate::queries::demand::{answered_by_game, AnsweredBy};
use crate::queries::persuasion::{city_strength, fighter_strength};
use crate::queries::standing::standing_of;
use crate::queries::walls::wall_side;
use crate::sight::InvariantViolation;
use crate::standing::change_standing;

/// Whether `org` is a realm still in its shelter (`CONTEXT.md`: New realm's shelter): its first
/// `NEW_REALM_SHELTER_DAYS` game days. No NPC city sends it a demand or marches on it then.
pub fn sheltered(world: &WorldState, org: &str) -> bool {
    sheltered_at(world, org, world.tick as f64)
}

fn sheltered_at(world: &WorldState, org: &str, tick: f64) -> bool {
    let realm = world.realms.iter().find(|r| r.id == org);
    realm
        .and_then(|r| r.founded_at)
        .is_some_and(|at| tick < at + NEW_REALM_SHELTER_DAYS * TICKS_PER_GAME_DAY)
}

/// The strength of an Organization's armed residents, wherever they are, as respect weighs them.
pub fn org_strength(world: &WorldState, org: &str) -> f64 {
    world
        .residents
        .iter()
        .filter(|r| r.health > 0.0 && wall_side(r) == Some(org))
        .map(fighter_strength)
        .sum()
}

/// Whether `city` sends demands at all: an NPC city, militarist.
fn sends_demands(world: &WorldState, city: &City) -> bool {
    for_sale(city)
        && world.city_plans.contains_key(&city.id)
        && crate::temperament::temperament_of(world.seed, city) == Some(Temperament::Militarist)
}

/// The realms `city` knows of: those it holds a threat from, and those with a standing toward it
/// or it toward them. In the world's order of realms.
fn realms_known(world: &WorldState, city: &City) -> Vec<String> {
    let threat = |id: &str| city.threats.as_ref().is_some_and(|t| t.contains_key(id));
    let standing = |id: &str| {
        world
            .standings
            .iter()
            .any(|s| (s.of == city.id && s.toward == id) || (s.toward == city.id && s.of == id))
    };
    world.realms.iter().filter(|r| threat(&r.id) || standing(&r.id)).map(|r| r.id.clone()).collect()
}

/// Whether `city` would send `org` a demand now (`CONTEXT.md`: NPC demand): a realm out of its
/// shelter, with no demand of the city's open and none sent within `NPC_DEMAND_AGAIN_DAYS`, whose
/// armed residents its own side far outweighs.
pub fn demands_of(world: &WorldState, city: &City, org: &str) -> bool {
    if sheltered(world, org) || !world.realms.iter().any(|r| r.id == org) {
        return false;
    }
    if world.demands.iter().any(|d| d.from_id == city.id && d.to_id == org) {
        return false;
    }
    let tick = world.tick as f64;
    let last = world.city_plans.get(&city.id).and_then(|p| p.demanded.as_ref()?.get(org).copied());
    if last.is_some_and(|at| tick < at + NPC_DEMAND_AGAIN_DAYS * TICKS_PER_GAME_DAY) {
        return false;
    }
    let own = city_strength(world, city);
    own >= NPC_DEMAND_MIN_STRENGTH && own >= NPC_DEMAND_OUTWEIGH_TIMES * org_strength(world, org)
}

/// One tick of NPC demands (`stepNpcDemands`), after stances: at its first planning pass of a game
/// day, an NPC city that sends demands sends one to each realm it knows of and would.
pub fn step_npc_demands(world: &mut WorldState) {
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        // A city in Retaliate sends them to the realm it turned on (`CONTEXT.md`: Retaliating).
        let against = city.retaliating.clone().filter(|_| for_sale(city));
        if !(sends_demands(world, city) || against.is_some())
            || !crate::npc_stance::first_pass_of_day(world, &city.id)
        {
            continue;
        }
        let mut known =
            if sends_demands(world, city) { realms_known(world, city) } else { Vec::new() };
        known.extend(against.filter(|a| !known.contains(a)));
        let to: Vec<String> = known.into_iter().filter(|r| demands_of(world, city, r)).collect();
        let city_id = city.id.clone();
        let tick = world.tick as f64;
        for org in to {
            send_npc_demand(world, &city_id, &org);
            if let Some(plan) = world.city_plans.get_mut(&city_id) {
                plan.demanded.get_or_insert_with(Default::default).insert(org, tick);
            }
        }
    }
}

/// A demand an NPC city sent has been answered (`CONTEXT.md`: NPC demand): paid, its threat from
/// the payer is gone and its standing toward them back to neutral at least; refused or lapsed, its
/// standing falls to `NPC_DEMAND_REFUSED_STANDING` at most. Nothing for anyone else's demand, nor
/// for a city that is no NPC city any more.
pub fn npc_demand_ended(world: &mut WorldState, d: &Demand, paid: bool) {
    if answered_by_game(world, &d.from_id) != Some(AnsweredBy::City) {
        return;
    }
    let Some(ci) = world.cities.iter().position(|c| c.id == d.from_id && for_sale(c)) else {
        return;
    };
    let standing = standing_of(world, &d.from_id, &d.to_id);
    if paid {
        let city = &mut world.cities[ci];
        if let Some(t) = city.threats.as_mut() {
            t.shift_remove(&d.to_id);
            if t.is_empty() {
                city.threats = None;
            }
        }
        if standing < 0.0 {
            change_standing(world, &d.from_id, &d.to_id, -standing);
        }
    } else if standing > NPC_DEMAND_REFUSED_STANDING {
        change_standing(world, &d.from_id, &d.to_id, NPC_DEMAND_REFUSED_STANDING - standing);
    }
}

/// NPC demands hold together (`npc-demands-sound`, `CONTEXT.md`: NPC demand, New realm's
/// shelter): an NPC city's open demand goes to a realm that was out of its shelter when it was
/// sent, and asks only for Coins.
pub fn npc_demands_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for d in &world.demands {
        if answered_by_game(world, &d.from_id) != Some(AnsweredBy::City) {
            continue;
        }
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "npc-demands-sound".into(),
                message,
                entity_ids: vec![d.id.clone(), d.from_id.clone()],
            });
        };
        if !world.realms.iter().any(|r| r.id == d.to_id) {
            fail(format!("NPC city {} demands of {}, which is no realm", d.from_id, d.to_id));
        }
        if sheltered_at(world, &d.to_id, d.sent_at) {
            fail(format!("NPC city {} demanded of {} in its shelter", d.from_id, d.to_id));
        }
        let coins_only = matches!(&d.terms, DemandTerms::Goods { goods }
            if goods.keys().all(|g| *g == Good::Coins));
        if !coins_only {
            fail(format!("NPC city {} demands more than Coins in {}", d.from_id, d.id));
        }
    }
    out
}

#[cfg(test)]
mod tests;
