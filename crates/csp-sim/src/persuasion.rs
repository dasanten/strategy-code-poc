//! Persuading a city (`CONTEXT.md`: Persuading a city, Respect), ported from
//! `apps/server/src/persuasion.ts`: an NPC city that holds a realm in high standing and sees more
//! of its armed residents and walls than it has soldiers asks to join it. The Player accepts, and
//! the city joins the realm as when bought, or declines, and the city doesn't ask that realm again
//! for `PERSUADE_ASK_AGAIN_DAYS`.
//!
//! The two orders (`acceptJoin`, `declineJoin`) are plain `validate`/`apply` functions here; the
//! order queue (T86.2) wires them under their kinds.

use std::collections::HashSet;

use csp_shared::balance::{PERSUADE_ASK_AGAIN_DAYS, PERSUADE_CHECK_TICKS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, JoinRequest, RealmEventWhat, WorldState};

use crate::capture::join_realm;
use crate::events::record_event;
use crate::queries::city::{for_sale, town_hall_of};
use crate::queries::persuasion::{holds_high, persuaded_by, respect_seen_by};
use crate::queries::standing::standing_of;
use crate::sight::InvariantViolation;

/// The city a realm can still be asked by (`askable`): an NPC city that isn't gone.
fn askable<'w>(world: &'w WorldState, city_id: &str) -> Option<&'w City> {
    world.cities.iter().find(|c| c.id == city_id).filter(|c| for_sale(c))
}

/// One tick of persuasion (`stepPersuasion`). An ask is withdrawn, with a line in the realm log,
/// once the city is no NPC city any more, the realm is gone or the city no longer holds it in
/// high standing; a declined ask is forgotten after `PERSUADE_ASK_AGAIN_DAYS`. Every
/// `PERSUADE_CHECK_TICKS`, each NPC city that asks nobody yet asks the realm it is persuaded by
/// and hasn't been declined by lately: the one it holds highest, then the one it sees the most
/// respect from. `size` is the map's.
pub fn step_persuasion(world: &mut WorldState, size: i32) {
    let realms: HashSet<String> = world.realms.iter().map(|r| r.id.clone()).collect();
    let tick = world.tick as f64;
    let mut kept = Vec::new();
    for q in std::mem::take(&mut world.join_requests) {
        let city = askable(world, &q.city_id);
        if q.declined {
            if city.is_some()
                && realms.contains(&q.realm_id)
                && tick - q.at < PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY
            {
                kept.push(q);
            }
            continue;
        }
        if city.is_some_and(|c| realms.contains(&q.realm_id) && holds_high(world, c, &q.realm_id)) {
            kept.push(q);
            continue;
        }
        let name = city
            .map(|c| c.name.clone())
            .or_else(|| world.cities.iter().find(|c| c.id == q.city_id).map(|c| c.name.clone()));
        if let (true, Some(city)) = (realms.contains(&q.realm_id), name) {
            let what = RealmEventWhat::JoinWithdrawn { city_id: q.city_id.clone(), city };
            record_event(world, Some(&q.realm_id), what);
        }
    }
    // Events recorded above don't touch the asks; the ones a withdrawal logged are gone.
    world.join_requests = kept;
    if !world.tick.is_multiple_of(PERSUADE_CHECK_TICKS as u64) {
        return;
    }
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        if !for_sale(city) {
            continue;
        }
        let asked: Vec<&JoinRequest> =
            world.join_requests.iter().filter(|q| q.city_id == city.id).collect();
        if asked.iter().any(|q| !q.declined) {
            continue;
        }
        let declined: HashSet<&str> = asked.iter().map(|q| q.realm_id.as_str()).collect();
        let mut candidates: Vec<(String, f64, f64)> = world
            .realms
            .iter()
            .map(|r| r.id.as_str())
            .filter(|id| !declined.contains(id) && persuaded_by(world, city, id, size))
            .map(|id| {
                (
                    id.to_string(),
                    standing_of(world, &city.id, id),
                    respect_seen_by(world, city, id, size),
                )
            })
            .collect();
        candidates.sort_by(|a, b| {
            (b.1 - a.1)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| (b.2 - a.2).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal))
                .then_with(|| {
                    if a.0 < b.0 {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    }
                })
        });
        let Some(realm_id) = candidates.into_iter().next().map(|c| c.0) else { continue };
        let Some(hall) = town_hall_of(world, city) else { continue };
        let what = RealmEventWhat::JoinAsked {
            city_id: city.id.clone(),
            city: city.name.clone(),
            x: hall.x,
            y: hall.y,
        };
        let request = JoinRequest {
            city_id: city.id.clone(),
            realm_id: realm_id.clone(),
            at: tick,
            declined: false,
        };
        world.join_requests.push(request);
        record_event(world, Some(&realm_id), what);
    }
}

/// The ask of `city_id` to the sender's realm that stands now (`askOf`): the realm id and the
/// ask's index, or a reason.
fn ask_of(
    world: &WorldState,
    user_id: u64,
    city_id: Option<&str>,
) -> Result<(String, usize), &'static str> {
    let Some(realm_id) = world.realms.iter().find(|r| r.user_id == user_id).map(|r| r.id.clone())
    else {
        return Err("you have no realm");
    };
    let ask = world
        .join_requests
        .iter()
        .position(|q| Some(q.city_id.as_str()) == city_id && q.realm_id == realm_id && !q.declined);
    match ask {
        Some(i) if askable(world, &world.join_requests[i].city_id).is_some() => Ok((realm_id, i)),
        _ => Err("that city isn’t asking to join your realm"),
    }
}

/// `acceptJoin.validate`: a reason the Player can't accept `city_id`'s ask, if any.
pub fn validate_accept_join(
    world: &WorldState,
    user_id: u64,
    city_id: Option<&str>,
) -> Option<&'static str> {
    ask_of(world, user_id, city_id).err()
}

/// `acceptJoin.apply` (`CONTEXT.md`: Persuading a city): the city joins the realm with everything
/// in it, as when bought (`join_realm`). Without a map (`terrain` absent) nothing happens, as in
/// the TypeScript.
pub fn apply_accept_join(
    world: &mut WorldState,
    user_id: u64,
    city_id: Option<&str>,
    size: Option<i32>,
) {
    let Ok((realm_id, ask)) = ask_of(world, user_id, city_id) else { return };
    let Some(size) = size else { return };
    let city_id = world.join_requests[ask].city_id.clone();
    world.join_requests.retain(|q| q.city_id != city_id);
    let residents = join_realm(world, &city_id, &realm_id, size);
    let Some(city) = world.cities.iter().find(|c| c.id == city_id) else { return };
    let hall = town_hall_of(world, city);
    let what = RealmEventWhat::CityPersuaded {
        city_id: city.id.clone(),
        city: city.name.clone(),
        residents: residents as f64,
        x: hall.map_or(0.0, |h| h.x),
        y: hall.map_or(0.0, |h| h.y),
    };
    record_event(world, Some(&realm_id), what);
}

/// `declineJoin.validate`.
pub fn validate_decline_join(
    world: &WorldState,
    user_id: u64,
    city_id: Option<&str>,
) -> Option<&'static str> {
    ask_of(world, user_id, city_id).err()
}

/// `declineJoin.apply`: the city doesn't ask the realm again for a while.
pub fn apply_decline_join(world: &mut WorldState, user_id: u64, city_id: Option<&str>) {
    let Ok((_, ask)) = ask_of(world, user_id, city_id) else { return };
    let tick = world.tick as f64;
    let q = &mut world.join_requests[ask];
    q.declined = true;
    q.at = tick;
}

/// Invariant (`joinRequestsSound`): each ask from an NPC city to a realm that exists, at most one
/// per city and realm, at most one standing ask per city, made no later than now, a standing one
/// only toward a realm the city holds high, and a declined one forgotten in time.
pub fn join_requests_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "join-requests-sound";
    let mut out = Vec::new();
    let mut pairs = HashSet::new();
    let mut asking = HashSet::new();
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let tick = world.tick as f64;
    for q in &world.join_requests {
        let mut report = |message: String| {
            out.push(InvariantViolation {
                invariant: name.into(),
                message,
                entity_ids: vec![q.city_id.clone(), q.realm_id.clone()],
            })
        };
        let pair = format!("{} → {}", q.city_id, q.realm_id);
        let city = askable(world, &q.city_id);
        if city.is_none() {
            report(format!("{} asks {} to join but is no NPC city", q.city_id, q.realm_id));
        }
        if !realms.contains(q.realm_id.as_str()) {
            report(format!("{} asks {}, a realm that is gone", q.city_id, q.realm_id));
        }
        if q.at > tick {
            report(format!("the ask {pair} is from the future"));
        }
        if !pairs.insert(pair.clone()) {
            report(format!("the ask {pair} is kept twice"));
        }
        if q.declined {
            if tick - q.at > PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY {
                report(format!("the declined ask {pair} is remembered too long"));
            }
            continue;
        }
        if !asking.insert(q.city_id.clone()) {
            report(format!("{} asks more than one realm to join", q.city_id));
        }
        if city.is_some_and(|c| !holds_high(world, c, &q.realm_id)) {
            report(format!(
                "{} asks {} to join without holding it in high standing",
                q.city_id, q.realm_id
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests;
