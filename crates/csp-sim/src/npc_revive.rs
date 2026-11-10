//! A city the game runs revives its own (`apps/server/src/npc-revive.ts`, `CONTEXT.md`:
//! Reviving). Its planning pass gives one grown resident per Down resident a `revive` job
//! (ADR 0016); between passes the city walks them through it with orders a Player could give
//! (`run_reviver`, ADR 0002): take Food at the storage, walk there, Feed. A reviver lost on the
//! way is replaced at the next pass, which sees the Down resident still has nobody.

use std::collections::HashSet;

use csp_shared::balance::{FEED_UNITS, NPC_REVIVE_REACH, OWN_FOOD};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    City, CityJob, CityJobKind, DropOrder, FeedOrder, Good, GoodsSpot, PickUpOrder, ResidentOrder,
    Stock, WorldState,
};

use crate::npc_behaviour::{food_of, haul, walk_to, Jobs};
use crate::queries::city_area::near_city_area;
use crate::queries::combat::in_contact;
use crate::queries::goods::units_that_fit;
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::npc_storages;
use crate::queries::offers::free_stock;
use crate::queries::residents::{can_work, is_armed};
use crate::sight::InvariantViolation;

/// A resident's tile.
fn at(world: &WorldState, i: usize) -> (i32, i32) {
    let r = &world.residents[i];
    (r.x as i32, r.y as i32)
}

/// The city's Down residents it fetches, soonest to die first, by id (`downToRevive`,
/// `CONTEXT.md`: Reviving): those in its area or within `NPC_REVIVE_REACH` of it, while its
/// storage holds Food. `size` is the map's.
pub fn down_to_revive(world: &WorldState, city: &City, size: i32) -> Vec<String> {
    let Some(storage) = npc_storages(world, city).into_iter().next() else { return Vec::new() };
    if held(&free_stock(world, &storage.id, storage.stock.as_ref()), Good::Food) < 1.0 {
        return Vec::new();
    }
    let mut down: Vec<&csp_shared::world::Resident> = world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_ref() == Some(&city.id)
                && r.owner.is_none()
                && r.down_until.is_some()
                && near_city_area(world, &city.id, r.x, r.y, NPC_REVIVE_REACH, size)
        })
        .collect();
    down.sort_by(|a, b| a.down_until.unwrap().total_cmp(&b.down_until.unwrap()));
    down.into_iter().map(|r| r.id.clone()).collect()
}

/// Whether the job of the last pass still stands (`goesOnReviving`): a reviver goes on while the
/// one they go to is still waiting, and is the one reviver of them, so they are taken off
/// `waiting`.
pub fn goes_on_reviving(job: Option<&CityJob>, waiting: &mut Vec<String>) -> bool {
    let Some(job) = job.filter(|j| j.kind == CityJobKind::Revive) else { return false };
    let target = job.target_id.clone().unwrap_or_default();
    match waiting.iter().position(|id| *id == target) {
        Some(i) => {
            waiting.remove(i);
            true
        }
        None => false,
    }
}

/// Sends a reviver to each Down resident `waiting` (`sendRevivers`, `CONTEXT.md`: Reviving),
/// nearest first, never a soldier or one carrying a child: spare hands (`spare`, who have no job
/// yet); then workers, then builders; and last farmers, but only while Food isn't short. `leave`
/// is told of whoever gives up a job for it.
#[allow(clippy::too_many_arguments)]
pub fn send_revivers(
    world: &WorldState,
    waiting: &[String],
    spare: &[usize],
    adults: &[usize],
    jobs: &mut Jobs,
    food_short: bool,
    size: i32,
    leave: &mut dyn FnMut(usize, &Jobs),
) {
    for target_id in waiting {
        let Some(target) = world.residents.iter().position(|r| &r.id == target_id) else {
            continue;
        };
        let by_job = |jobs: &Jobs, kind: CityJobKind| -> Vec<usize> {
            adults
                .iter()
                .copied()
                .filter(|&i| jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == kind))
                .collect()
        };
        let ranks: [Vec<usize>; 4] = [
            spare.iter().copied().filter(|&i| !jobs.contains_key(&world.residents[i].id)).collect(),
            by_job(jobs, CityJobKind::Work),
            by_job(jobs, CityJobKind::Build),
            if food_short { Vec::new() } else { by_job(jobs, CityJobKind::Farm) },
        ];
        let reviver = ranks.iter().find_map(|rank| nearest(world, rank, target, size));
        let Some(reviver) = reviver else { return };
        leave(reviver, jobs);
        jobs.insert(
            world.residents[reviver].id.clone(),
            CityJob {
                kind: CityJobKind::Revive,
                building_id: None,
                target_id: Some(target_id.clone()),
                stable_id: None,
                ground_id: None,
                subject: None,
            },
        );
    }
}

/// Of `people`, the one nearest `to` (`nearest`).
fn nearest(world: &WorldState, people: &[usize], to: usize, size: i32) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for &i in people {
        let d = wrap_distance(size, at(world, i), at(world, to));
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some((i, d));
        }
    }
    best.map(|(i, _)| i)
}

/// Where the Down resident a `revive` job goes to stands in `world.residents` (`reviveTarget`);
/// `None` once they are awake or dead.
pub fn revive_target(world: &WorldState, job: Option<&CityJob>) -> Option<usize> {
    let job = job.filter(|j| j.kind == CityJobKind::Revive)?;
    let i = world.residents.iter().position(|x| Some(&x.id) == job.target_id.as_ref())?;
    world.residents[i].down_until.is_some().then_some(i)
}

/// What an idle reviver does next (`runReviver`, `CONTEXT.md`: Reviving): beside the Down resident
/// with Food in hand, Feeds them; else takes what they give from the storage on top of their own
/// Food, putting any load of goods away there first, and walks to them. Whether they were given
/// something to do; not when there is nobody to go to any more, or no Food to take to them.
pub fn run_reviver(
    world: &mut WorldState,
    i: usize,
    job: Option<&CityJob>,
    storage: Option<usize>,
    size: i32,
) -> bool {
    let Some(target) = revive_target(world, job) else { return false };
    let hand = food_of(&world.residents[i]);
    let target_at = at(world, target);
    if hand >= 1.0 && in_contact(size, at(world, i), target_at) {
        let target_id = world.residents[target].id.clone();
        world.residents[i].order =
            Some(ResidentOrder::Feed(FeedOrder { target_id, units: FEED_UNITS }));
        return true;
    }
    let wanted = OWN_FOOD + FEED_UNITS - hand;
    let food = storage.map_or(0.0, |s| {
        let b = &world.buildings[s];
        held(&free_stock(world, &b.id, b.stock.as_ref()), Good::Food)
    });
    if let Some(s) = storage.filter(|_| food > 0.0 && wanted > 0.0) {
        let storage = &world.buildings[s];
        let (storage_id, storage_at) = (storage.id.clone(), (storage.x, storage.y));
        if !is_at(at(world, i), placed(storage), size) {
            walk_to(&mut world.residents[i], storage_at);
            return true;
        }
        let to = GoodsSpot::Storage { storage_id };
        let r = &world.residents[i];
        if let Some(load) = haul(r, Some(&Stock::from([(Good::Food, 1.0)]))) {
            world.residents[i].order = Some(ResidentOrder::Drop(DropOrder { to, goods: load }));
            return true;
        }
        let units = food.min(wanted).min(units_that_fit(r, Good::Food, world.tick as f64));
        if units > 0.0 {
            let goods = Stock::from([(Good::Food, units)]);
            world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder { from: to, goods }));
            return true;
        }
    }
    if hand < 1.0 {
        return false;
    }
    let (tx, ty) = (world.residents[target].x, world.residents[target].y);
    walk_to(&mut world.residents[i], (tx, ty));
    true
}

/// Invariant `npc-revivers` (`CONTEXT.md`: Reviving; ADR 0004): in the plan its pass made this
/// tick, an NPC city's revivers are each a grown resident who isn't Down, no soldier and not
/// carrying a child; one per Down resident; and a Down resident they go to lies within reach of
/// the city.
pub fn npc_revivers(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        if plan.planned_at != tick {
            continue;
        }
        let mut seen = HashSet::new();
        for (resident_id, job) in &plan.jobs {
            if job.kind != CityJobKind::Revive {
                continue;
            }
            let mut fail = |message: String, ids: &[&str]| {
                let mut entity_ids = vec![city_id.clone(), resident_id.clone()];
                entity_ids.extend(ids.iter().map(|s| s.to_string()));
                out.push(InvariantViolation {
                    invariant: "npc-revivers".into(),
                    message: format!("{city_id} sends {resident_id} to revive: {message}"),
                    entity_ids,
                });
            };
            let r = world.residents.iter().find(|r| &r.id == resident_id);
            if let Some(r) = r {
                if !can_work(r.born_at, tick) {
                    fail("a child".into(), &[]);
                }
                if r.down_until.is_some() {
                    fail("who is Down".into(), &[]);
                }
                if is_armed(&r.carried) {
                    fail("a soldier".into(), &[]);
                }
                if r.carrying.is_some() {
                    fail("who carries a child".into(), &[]);
                }
            }
            let target_id = job.target_id.clone().unwrap_or_default();
            if !seen.insert(target_id.clone()) {
                fail(format!("a second reviver of {target_id}"), &[&target_id]);
            }
            let target = world.residents.iter().find(|r| r.id == target_id);
            if let Some(t) = target {
                if t.down_until.is_some()
                    && !near_city_area(world, &city.id, t.x, t.y, NPC_REVIVE_REACH, size)
                {
                    fail(format!("{target_id} lies out of its reach"), &[&target_id]);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
