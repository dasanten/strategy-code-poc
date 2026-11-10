//! Horses (`apps/server/src/horses.ts`, `CONTEXT.md`: Horse, Horse stats, Horse name, Horses have
//! no inventory, Stable, Down, Reviving): new horses, one tick of their hunger, health, going Down
//! and dying, and the invariant that a Down horse lies still.

use std::collections::HashMap;

use csp_shared::balance::{
    DOWN_DAYS, HEAL_DAYS, HORSE_FILL_PER_FOOD, HORSE_HUNGRY_SHARE, HORSE_START_AGE_MAX,
    HORSE_START_AGE_MIN, HORSE_STAT_MAX, HORSE_STAT_MIN, HORSE_WAKE_HEALTH, HUNGER_DAYS,
    MAX_HEALTH, MAX_HUNGER, STARVE_DAYS,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{Good, Horse, HorseStats, RealmEventWhat, WorldState};

use crate::events::record_event;
use crate::queries::carriages::{carriage_pulled_by, driver_of};
use crate::queries::horses::rider_of;
use crate::queries::js_round;
use crate::queries::names::held;
use crate::queries::pace::horse_food_factor;
use crate::queries::riding::horse_food;
use crate::sight::InvariantViolation;

/// Given names for new horses (`HORSE_NAMES`), a pool apart from the residents'.
pub const HORSE_NAMES: [&str; 36] = [
    "Brisk", "Chestnut", "Dapple", "Ember", "Flint", "Gale", "Hazel", "Juniper", "Kestrel", "Lark",
    "Maple", "Nimbus", "Onyx", "Pepper", "Quill", "Rowan", "Sorrel", "Thistle", "Umber", "Velvet",
    "Willow", "Zephyr", "Ash", "Bramble", "Cinder", "Dusk", "Fable", "Heather", "Ivory", "Jet",
    "Moss", "Nutmeg", "Pebble", "Rusty", "Storm", "Tansy",
];

/// A name from the game for a horse (`horseName`).
pub fn horse_name(rand: &mut dyn FnMut() -> f64) -> String {
    HORSE_NAMES[(rand() * HORSE_NAMES.len() as f64).floor() as usize].to_string()
}

/// Whole stats for a new horse, each from `HORSE_STAT_MIN` to `HORSE_STAT_MAX` (`drawHorseStats`),
/// drawn in `HORSE_STAT_NAMES`' order.
pub fn draw_horse_stats(rand: &mut dyn FnMut() -> f64) -> HorseStats {
    let mut between = |min: f64, max: f64| min + (rand() * (max - min + 1.0)).floor();
    let speed = between(HORSE_STAT_MIN, HORSE_STAT_MAX);
    let strength = between(HORSE_STAT_MIN, HORSE_STAT_MAX);
    let endurance = between(HORSE_STAT_MIN, HORSE_STAT_MAX);
    HorseStats { speed, strength, endurance }
}

/// Where and whose a new horse is (`newHorse`'s fields).
#[derive(Debug, Clone)]
pub struct NewHorse {
    pub id: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub tick: f64,
}

/// A new grown horse (`newHorse`): drawn stats, a name from the pool, full hunger and health,
/// aged between `HORSE_START_AGE_MIN` and `HORSE_START_AGE_MAX` game years at `tick`.
pub fn new_horse(rand: &mut dyn FnMut() -> f64, fields: NewHorse) -> Horse {
    let stats = draw_horse_stats(rand);
    let age = HORSE_START_AGE_MIN + rand() * (HORSE_START_AGE_MAX - HORSE_START_AGE_MIN);
    let name = horse_name(rand);
    Horse {
        id: fields.id,
        name,
        realm_id: fields.realm_id,
        city_id: fields.city_id,
        x: fields.x,
        y: fields.y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats,
        born_at: fields.tick - js_round(age * TICKS_PER_GAME_YEAR),
        down_until: None,
    }
}

/// Ticks a horse lies Down before it dies of hunger (`HORSE_DOWN_TICKS`).
pub const HORSE_DOWN_TICKS: f64 = DOWN_DAYS * TICKS_PER_GAME_DAY;

/// Whether a horse's meter has no room for another unit of Food (`horseFull`).
pub fn horse_full(h: &Horse) -> bool {
    h.hunger > MAX_HUNGER - HORSE_FILL_PER_FOOD
}

/// A horse eats up to `units` whole units of Food, stopping once its meter is full
/// (`horseEats`), and returns how many it ate. Having eaten, a Down horse wakes at
/// `HORSE_WAKE_HEALTH`. The caller takes the Food from wherever it came.
pub fn horse_eats(h: &mut Horse, units: f64) -> f64 {
    let mut eaten = 0.0;
    while eaten < units && !horse_full(h) {
        h.hunger = MAX_HUNGER.min(h.hunger + HORSE_FILL_PER_FOOD);
        eaten += 1.0;
    }
    if eaten > 0.0 && h.down_until.is_some() {
        h.down_until = None;
        h.health = HORSE_WAKE_HEALTH;
    }
    eaten
}

/// One tick of horses (`stepHorses`): the meter runs down, a horse eats a unit when there is
/// room, from what is in reach (`horse_food`); a ridden horse going hungry with nothing from its
/// rider is logged once; an empty meter costs health, anything in it gives health back, and a
/// horse whose health is used up goes Down. Down, it waits to eat; when its time is up first it
/// dies, which is logged. Returns the horses that died.
pub fn step_horses(world: &mut WorldState, terrain: &TerrainMap) -> Vec<Horse> {
    let drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY);
    let starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY);
    let heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY);
    let hungry = HORSE_HUNGRY_SHARE * MAX_HUNGER;
    let mut died: Vec<usize> = Vec::new();
    let mut ate = false;
    // Who rides which horse, looked up once a tick; a later rider of the same horse wins, as the
    // TypeScript `Map.set` does.
    let mut riders: HashMap<String, usize> = HashMap::new();
    for (i, r) in world.residents.iter().enumerate() {
        if let Some(h) = &r.riding {
            riders.insert(h.clone(), i);
        }
    }
    let eat = |world: &mut WorldState, i: usize, ate: &mut bool| -> bool {
        let rider = riders.get(&world.horses[i].id).copied();
        let Some(place) = horse_food(world, &world.horses[i], terrain.size, rider).first().copied()
        else {
            return false;
        };
        let stock = place.stock_mut(world);
        let left = held(stock, Good::Food) - 1.0;
        if left > 0.0 {
            stock.insert(Good::Food, left);
        } else {
            stock.shift_remove(&Good::Food);
        }
        horse_eats(&mut world.horses[i], 1.0);
        *ate = true;
        true
    };
    for i in 0..world.horses.len() {
        if let Some(until) = world.horses[i].down_until {
            if !eat(world, i, &mut ate) && world.tick as f64 >= until {
                died.push(i);
            }
            continue;
        }
        let was_fed = world.horses[i].hunger >= hungry;
        // Endurance sets how fast the meter runs down, so how much Food the horse needs.
        let factor = horse_food_factor(&world.horses[i].stats);
        let h = &mut world.horses[i];
        h.hunger = 0.0f64.max(h.hunger - drain * factor);
        if h.hunger <= MAX_HUNGER - HORSE_FILL_PER_FOOD {
            eat(world, i, &mut ate);
        }
        // Going hungry with nothing in reach: a rider has no Food to spare for it.
        let h = &world.horses[i];
        let rider = if was_fed && h.hunger < hungry { riders.get(&h.id).copied() } else { None };
        if let Some(ri) = rider {
            let what = RealmEventWhat::HorseHungry {
                horse_id: h.id.clone(),
                horse_name: Some(h.name.clone()),
                resident_id: world.residents[ri].id.clone(),
                name: world.residents[ri].name.clone(),
            };
            let realm = h.realm_id.clone();
            record_event(world, realm.as_deref(), what);
        }
        let h = &mut world.horses[i];
        if h.hunger <= 0.0 {
            h.health = 0.0f64.max(h.health - starve);
        } else {
            h.health = MAX_HEALTH.min(h.health + heal);
        }
        if h.health <= 0.0 {
            let rider = riders.get(&h.id).copied();
            go_down(world, i, rider);
        }
    }
    if ate {
        world.piles.retain(|p| p.goods.values().any(|&n| n > 0.0));
    }
    let mut gone = Vec::new();
    if !died.is_empty() {
        let ids: Vec<String> = died.iter().map(|&i| world.horses[i].id.clone()).collect();
        let mut i = 0;
        world.horses.retain(|h| {
            let keep = !died.contains(&i);
            i += 1;
            if !keep {
                gone.push(h.clone());
            }
            keep
        });
        // A carriage whose horse died stands where it is, with nothing to pull it.
        for k in &mut world.carriages {
            if k.horse_id.as_ref().is_some_and(|id| ids.contains(id)) {
                k.horse_id = None;
            }
        }
        for h in &gone {
            let what =
                RealmEventWhat::HorseDied { horse_id: h.id.clone(), name: Some(h.name.clone()) };
            record_event(world, h.realm_id.as_deref(), what);
        }
    }
    gone
}

/// Puts a horse whose health hunger used up Down until `HORSE_DOWN_TICKS` from now (`goDown`): its
/// rider is on foot again, the carriage it pulls stands with its driver's order ended, and it stays
/// hitched. Its Player's realm log says so.
fn go_down(world: &mut WorldState, i: usize, rider: Option<usize>) {
    let until = world.tick as f64 + HORSE_DOWN_TICKS;
    let h = &mut world.horses[i];
    h.health = 0.0;
    h.down_until = Some(until);
    if let Some(r) = rider {
        world.residents[r].riding = None;
    }
    let h = &world.horses[i];
    let driver = carriage_pulled_by(world, &h.id)
        .and_then(|k| driver_of(world, &k.id))
        .map(|d| d.id.clone());
    if let Some(d) = driver {
        if let Some(r) = world.residents.iter_mut().find(|r| r.id == d) {
            r.order = None;
        }
    }
    let h = &world.horses[i];
    let what = RealmEventWhat::HorseDown { horse_id: h.id.clone(), name: h.name.clone(), until };
    let realm = h.realm_id.clone();
    record_event(world, realm.as_deref(), what);
}

/// The invariant `horses-down-lie-still` (`horsesDownLieStill`): nobody rides a Down horse or
/// drives the carriage it pulls, its hunger and health stay at 0, and it dies within
/// `HORSE_DOWN_TICKS` of going Down, not before the tick it is due.
pub fn horses_down_lie_still(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "horses-down-lie-still";
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for h in &world.horses {
        let Some(until) = h.down_until else { continue };
        let mut problems: Vec<String> = Vec::new();
        if rider_of(world, &h.id).is_some() {
            problems.push("is ridden".to_string());
        }
        if let Some(k) = carriage_pulled_by(world, &h.id) {
            if driver_of(world, &k.id).is_some() {
                problems.push(format!("pulls carriage {}, which is driven", k.id));
            }
        }
        if h.health != 0.0 {
            problems.push(format!("has health {}", js_number(h.health)));
        }
        if h.hunger != 0.0 {
            problems.push(format!("has hunger {}", js_number(h.hunger)));
        }
        if !(until >= tick && until <= tick + HORSE_DOWN_TICKS) {
            problems.push(format!("is due to die at {}", js_number(until)));
        }
        for p in problems {
            out.push(InvariantViolation {
                invariant: name.to_string(),
                message: format!("horse {} is Down but {p}", h.id),
                entity_ids: vec![h.id.clone()],
            });
        }
    }
    out
}

/// A number as JavaScript prints it in a template string, for the whole and simple values the
/// messages hold.
fn js_number(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests;
