//! Reviving and Feeding a horse (`apps/server/src/reviving.ts` and shared `reviving.ts`,
//! `CONTEXT.md`: Reviving, Feeding a horse): the feed order, and feeding as the world steps.

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    FeedOrder, Good, Horse, OrderRequest, Resident, ResidentOrder, WorldState,
};
use serde_json::Value;

use crate::horses::{horse_eats, horse_full};
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::OrderKind;
use crate::queries::combat::in_contact;
use crate::queries::goods::units_that_fit;
use crate::queries::residents::{can_work, is_down};
use crate::survival::wake;
use crate::tick::Scratch;

/// Why a child can't Feed anyone (`NO_CHILD_FEEDS`).
pub const NO_CHILD_FEEDS: &str = "children can’t feed others";
/// Why a resident without Food in their hands can't Feed anyone (`NO_FOOD_TO_FEED`).
pub const NO_FOOD_TO_FEED: &str = "no Food in hand";
/// Why a horse can't be Fed (`HORSE_FULL`).
pub const HORSE_FULL: &str = "that horse is full";

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

fn food_of(r: &Resident) -> f64 {
    r.carried.get(&Good::Food).copied().unwrap_or(0.0)
}

/// What is wrong with the feeder (`feederProblem`), `None` when they can Feed someone within
/// their reach.
fn feeder_problem(
    feeder: &Resident,
    target: (f64, f64),
    tick: f64,
    size: i32,
    too_far: &str,
) -> Option<String> {
    if !can_work(feeder.born_at, tick) {
        return Some(NO_CHILD_FEEDS.into());
    }
    if !in_contact(size, tile(feeder.x, feeder.y), tile(target.0, target.1)) {
        return Some(too_far.into());
    }
    if food_of(feeder) < 1.0 {
        return Some(NO_FOOD_TO_FEED.into());
    }
    None
}

/// Why `feeder` can't Feed `target` now (`feedProblem`): a grown resident with Food in their
/// hands, on or next to the tile of a resident who is Down.
pub fn feed_problem(
    feeder: &Resident,
    target: Option<&Resident>,
    tick: f64,
    size: i32,
) -> Option<String> {
    let Some(target) = target.filter(|t| is_down(t.down_until)) else {
        return Some("nobody Down there to feed".into());
    };
    feeder_problem(
        feeder,
        (target.x, target.y),
        tick,
        size,
        "stand on or next to their tile to feed them",
    )
}

/// Why `feeder` can't Feed `horse` now (`feedHorseProblem`): a grown resident with Food in their
/// hands, on or next to the tile of a horse that isn't full.
pub fn feed_horse_problem(
    feeder: &Resident,
    horse: &Horse,
    tick: f64,
    size: i32,
) -> Option<String> {
    if horse_full(horse) {
        return Some(HORSE_FULL.into());
    }
    feeder_problem(
        feeder,
        (horse.x, horse.y),
        tick,
        size,
        "stand on or next to its tile to feed it",
    )
}

/// The feed order (`feed`, `CONTEXT.md`: Reviving, Feeding a horse): a grown resident of the
/// Player's realm with Food in their hands, on or next to the tile of a Down resident or of a
/// horse that isn't full, gives it up to `units` of that Food.
pub struct Feed;

impl OrderKind for Feed {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let Some(i) = ordered_resident(world, sender, f.get("residentId").and_then(Value::as_str))
        else {
            return Some("not one of your residents".into());
        };
        let units = f.get("units").and_then(Value::as_f64);
        if !units.is_some_and(|u| u.fract() == 0.0 && u > 0.0) {
            return Some("units must be a whole number above 0".into());
        }
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        let r = &world.residents[i];
        let target_id = f.get("targetId").and_then(Value::as_str);
        let tick = world.tick as f64;
        if let Some(horse) = world.horses.iter().find(|h| Some(h.id.as_str()) == target_id) {
            return feed_horse_problem(r, horse, tick, size);
        }
        let target = world.residents.iter().find(|x| Some(x.id.as_str()) == target_id);
        feed_problem(r, target, tick, size)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = f.get("residentId").and_then(Value::as_str);
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        r.order = Some(ResidentOrder::Feed(FeedOrder {
            target_id: f.get("targetId").and_then(Value::as_str).unwrap_or_default().to_string(),
            units: f.get("units").and_then(Value::as_f64).unwrap_or(0.0),
        }));
    }
}

/// Takes `units` of Food from the feeder's hands (`takeFood`).
fn take_food(from: &mut Resident, units: f64) {
    let left = food_of(from) - units;
    if left > 0.0 {
        from.carried.insert(Good::Food, left);
    } else {
        from.carried.shift_remove(&Good::Food);
    }
}

/// Feeding (`stepFeeding`): each resident with a feed order gives up to its units of the Food in
/// their hands. A Down resident eats a unit at once and wakes, the rest goes in their hands as far
/// as it fits, and what doesn't fit stays with the feeder. A horse eats all it takes at once. A
/// feed that no longer holds does nothing. Either way the order is done.
pub fn step_feeding(world: &mut WorldState, size: i32, _scratch: &mut Scratch) {
    let tick = world.tick as f64;
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::Feed(o)) = world.residents[i].order.clone() else { continue };
        world.residents[i].order = None;
        if let Some(h) = world.horses.iter().position(|h| h.id == o.target_id) {
            if feed_horse_problem(&world.residents[i], &world.horses[h], tick, size).is_some() {
                continue;
            }
            let units = o.units.min(food_of(&world.residents[i]).floor());
            let eaten = horse_eats(&mut world.horses[h], units);
            take_food(&mut world.residents[i], eaten);
            continue;
        }
        let Some(t) = world.residents.iter().position(|x| x.id == o.target_id) else { continue };
        if feed_problem(&world.residents[i], Some(&world.residents[t]), tick, size).is_some() {
            continue;
        }
        let food = o.units.min(food_of(&world.residents[i]));
        // The first unit is eaten at once; the rest has to fit in their hands.
        let given = food.min(1.0 + units_that_fit(&world.residents[t], Good::Food, tick));
        take_food(&mut world.residents[i], given);
        let target = &mut world.residents[t];
        *target.carried.entry(Good::Food).or_insert(0.0) += given;
        let by = world.residents[i].name.clone();
        wake(world, t, &by);
    }
}

#[cfg(test)]
mod tests;
