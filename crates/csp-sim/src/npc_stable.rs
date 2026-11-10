//! An NPC city feeds its stable (`apps/server/src/npc-stable.ts`, `CONTEXT.md`: NPC horses,
//! Feeding the stable): one of its residents runs the game's Feed the stable default, as a
//! Player's would. The city only says who, and how much Food they may take (`memory.spareFood`):
//! its people come first.

use std::collections::HashSet;

use csp_shared::balance::{
    HORSE_FOOD_PER_DAY, HORSE_HUNGRY_SHARE, MAX_HUNGER, NPC_STABLE_HUNGRY_DAYS,
    NPC_STABLE_REFILL_DAYS, NPC_TRADE, STABLE_FEED_DAYS,
};
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, Good, Resident, Task, WorldState,
};
use indexmap::IndexMap;
use serde_json::json;

use crate::npc_behaviour::{default_script, task_of, Jobs};
use crate::queries::city::{city_food_use, stored_food};
use crate::queries::horses::{horses_in, owns_horse, HorseOwner};
use crate::queries::names::held_in;
use crate::queries::residents::is_armed;
use crate::sight::InvariantViolation;

/// What a stable of an NPC city needs for its own horses in it now (`StableNeed`).
#[derive(Debug, Clone, Copy, PartialEq)]
struct StableNeed {
    /// Hungry or Down horses of the city in it.
    hungry: usize,
    /// Whether it is time to send a feeder: a horse is hungry, or the stable is running low.
    due: bool,
    /// Whole units of Food the city lets go to it now: what is above the reserve for its people,
    /// or below that a little for each hungry horse, and no more than the stable lacks.
    food: f64,
}

fn stable_need(world: &WorldState, city: &City, stable: &Building) -> Option<StableNeed> {
    let own: Vec<_> = horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(HorseOwner::City(&city.id), h))
        .collect();
    if own.is_empty() {
        return None;
    }
    let held = held_in(stable.stock.as_ref(), Good::Food);
    let n = own.len() as f64;
    let lacks = n * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY - held;
    if lacks <= 0.0 {
        return None;
    }
    let hungry = own.iter().filter(|h| h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER).count();
    let stored = stored_food(world, city);
    // Food for its horses is in the reserve too, but it is there to go to them: what the feeder
    // may not touch is only what its people eat.
    let spare = stored - city_food_use(world, city, NPC_TRADE.reserve_food_days);
    let meals = (hungry as f64 * NPC_STABLE_HUNGRY_DAYS * HORSE_FOOD_PER_DAY).ceil();
    let food = lacks.ceil().min(stored).min(spare.max(meals)).floor();
    let low = held < n * NPC_STABLE_REFILL_DAYS * HORSE_FOOD_PER_DAY;
    Some(StableNeed { hungry, due: food >= 1.0 && (hungry > 0 || low), food })
}

/// Whether a resident is running the Feed the stable default (`isFeeder`).
fn is_feeder(r: &Resident) -> bool {
    r.script.as_ref().is_some_and(|s| s.script_id == 0 && s.task == Some(Task::FeedStable))
}

/// A job of feeding a stable.
fn feed_job(stable_id: &str) -> CityJob {
    CityJob {
        kind: CityJobKind::Feed,
        building_id: None,
        target_id: None,
        stable_id: Some(stable_id.to_string()),
        ground_id: None,
        subject: None,
    }
}

/// The job of a resident already feeding, for a planning pass (`feedJobKept`): they go on while the
/// stable needs Food the city can let go, and until the Food they fetched is in it. `None` once
/// they are done.
pub fn feed_job_kept(world: &WorldState, city: &City, r: &Resident) -> Option<CityJob> {
    if !is_feeder(r) {
        return None;
    }
    let memory = &r.script.as_ref()?.memory;
    let stable_id = memory.get("stableId")?.as_str()?;
    let stable = world.buildings.iter().find(|b| b.id == stable_id)?;
    let under = r.order.is_some() || memory.get("fetched").is_some_and(|v| !v.is_null());
    let food = stable_need(world, city, stable).map_or(0.0, |n| n.food);
    (under || food >= 1.0).then(|| feed_job(stable_id))
}

/// Who feeds a stable that is due (`planFeeder`, `CONTEXT.md`: NPC horses), part of a planning
/// pass with no feeder out: the stable with hungry horses first, then the first running low. The
/// one sent is idle if any is, else at a workplace, else on a farm; never a soldier, one carrying a
/// child or a breeder. Whether one was sent; their job becomes `feed`.
pub fn plan_feeder(world: &WorldState, city: &City, adults: &[usize], jobs: &mut Jobs) -> bool {
    let mut needs: Vec<(&Building, StableNeed)> = Vec::new();
    for b in &world.buildings {
        if b.kind != BuildingKind::Stable
            || b.site.is_some()
            || b.city_id.as_ref() != Some(&city.id)
        {
            continue;
        }
        if let Some(need) = stable_need(world, city, b).filter(|n| n.due) {
            needs.push((b, need));
        }
    }
    let Some((stable, _)) = needs.iter().find(|(_, n)| n.hungry > 0).or(needs.first()) else {
        return false;
    };
    let rank = |r: &Resident| -> Option<u8> {
        if is_armed(&r.carried) || r.carrying.is_some() || task_of(r) == Some(Task::Breed) {
            return None;
        }
        match jobs.get(&r.id).map(|j| j.kind) {
            Some(CityJobKind::Idle) => Some(0),
            Some(CityJobKind::Work) => Some(1),
            Some(CityJobKind::Farm) => Some(2),
            _ => None,
        }
    };
    let mut hands: Vec<(usize, u8)> =
        adults.iter().filter_map(|&i| rank(&world.residents[i]).map(|k| (i, k))).collect();
    hands.sort_by_key(|(_, k)| *k);
    let Some(&(i, _)) = hands.first() else { return false };
    jobs.insert(world.residents[i].id.clone(), feed_job(&stable.id));
    true
}

/// What `steer_feeder` says to do with a feeder (`'stop' | undefined`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Steer {
    Stop,
}

/// Between passes (`steerFeeder`): a feeder the pass just let go stops; one still feeding is told
/// how much Food the city lets go now. Their own run of the default does the rest.
pub fn steer_feeder(
    world: &mut WorldState,
    city: &City,
    i: usize,
    job: Option<&CityJob>,
    planned: bool,
) -> Option<Steer> {
    if !is_feeder(&world.residents[i]) {
        return None;
    }
    let Some(job) = job.filter(|j| j.kind == CityJobKind::Feed) else {
        return planned.then_some(Steer::Stop);
    };
    let stable = world.buildings.iter().find(|b| Some(&b.id) == job.stable_id.as_ref());
    let food = stable.and_then(|s| stable_need(world, city, s)).map_or(0.0, |n| n.food);
    if let Some(script) = &mut world.residents[i].script {
        script.memory.insert("spareFood".into(), json!(food));
    }
    None
}

/// Puts a resident with a `feed` job to feeding (`startFeeding`): they run the game's Feed the
/// stable default. Whether they were given it: not once the stable is gone.
pub fn start_feeding(world: &mut WorldState, city: &City, i: usize, job: &CityJob) -> bool {
    let Some(stable) = world.buildings.iter().find(|b| Some(&b.id) == job.stable_id.as_ref())
    else {
        return false;
    };
    if stable.site.is_some() {
        return false;
    }
    let spare_food = stable_need(world, city, stable).map_or(0.0, |n| n.food);
    let memory = json!({ "stableId": stable.id, "spareFood": spare_food });
    world.residents[i].script = Some(default_script(Task::FeedStable, memory));
    true
}

/// Invariant `trade-org-breeds-no-horses` (`CONTEXT.md`: NPC horses; ADR 0004): none of the
/// Trade Organization's residents runs the game's Breed horses default.
pub fn trade_org_breeds_no_horses(world: &WorldState) -> Vec<InvariantViolation> {
    let theirs: HashSet<&String> =
        world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| &c.id).collect();
    world
        .residents
        .iter()
        .filter(|r| r.owner.is_none())
        .filter_map(|r| r.city_id.as_ref().filter(|c| theirs.contains(c)).map(|c| (r, c)))
        .filter(|(r, _)| {
            r.script.as_ref().is_some_and(|s| s.script_id == 0 && s.task == Some(Task::Breed))
        })
        .map(|(r, c)| InvariantViolation {
            invariant: "trade-org-breeds-no-horses".into(),
            message: format!("{} of the Trade Organization's {c} breeds horses", r.id),
            entity_ids: vec![r.id.clone(), c.clone()],
        })
        .collect()
}

/// Invariant `npc-one-feeder` (`CONTEXT.md`: NPC horses; ADR 0004): no city the game runs has more
/// than one of its residents running the Feed the stable default, none of them in the Trade
/// Organization's cities.
pub fn npc_one_feeder(world: &WorldState) -> Vec<InvariantViolation> {
    let mut by_city: IndexMap<&String, Vec<&String>> = IndexMap::new();
    for r in &world.residents {
        let Some(city) = &r.city_id else { continue };
        if r.owner.is_some() || !is_feeder(r) {
            continue;
        }
        by_city.entry(city).or_default().push(&r.id);
    }
    let mut out = Vec::new();
    for (city_id, ids) in by_city {
        let trade_org = world.cities.iter().find(|c| &c.id == city_id).and_then(|c| c.trade_org);
        if ids.len() > 1 || trade_org.is_some() {
            let of = if trade_org.is_some() { ", of the Trade Organization," } else { "" };
            let names: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
            let mut entity_ids = vec![city_id.clone()];
            entity_ids.extend(ids.iter().map(|s| s.to_string()));
            out.push(InvariantViolation {
                invariant: "npc-one-feeder".into(),
                message: format!("{city_id}{of} has {} feeding its stable", names.join(", ")),
                entity_ids,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests;
