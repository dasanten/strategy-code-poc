//! Stand-ins for the resident and horse generators of `residents.ts` (TODO(T86.3)) and
//! `horses.ts` (TODO(T86.4)), ported bit for bit so a world founded here is the TypeScript's.
//! The owning ticket replaces the calls and deletes this file.

use std::collections::HashSet;

use csp_shared::balance::{
    ticks_for_age, CHILD_STAT_SPREAD, HORSE_START_AGE_MAX, HORSE_START_AGE_MIN, HORSE_STAT_MAX,
    HORSE_STAT_MIN, LIFESPAN_MAX, LIFESPAN_MIN, MAX_HEALTH, MAX_HUNGER, START_AGE_MAX,
    START_AGE_MIN, STAT_BASE_MAX, STAT_BASE_MIN,
};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{Horse, HorseStats, Resident, Stat, StatRecord};

use super::unique_name;
use crate::queries::js_round;
use crate::random::Mulberry32;

/// Given names for new residents (`RESIDENT_NAMES`).
pub(crate) const RESIDENT_NAMES: [&str; 30] = [
    "Mara", "Tobin", "Corwin", "Edda", "Pell", "Ilse", "Saskia", "Bram", "Odo", "Wren", "Hale",
    "Ysolde", "Garrick", "Linnea", "Aldo", "Petra", "Rurik", "Senna", "Joran", "Tilde", "Anselm",
    "Brisa", "Cato", "Dagny", "Emeric", "Fenna", "Gisli", "Hesper", "Ivo", "Jutta",
];

/// Names for horses (`HORSE_NAMES`).
pub(crate) const HORSE_NAMES: [&str; 36] = [
    "Brisk", "Chestnut", "Dapple", "Ember", "Flint", "Gale", "Hazel", "Juniper", "Kestrel", "Lark",
    "Maple", "Nimbus", "Onyx", "Pepper", "Quill", "Rowan", "Sorrel", "Thistle", "Umber", "Velvet",
    "Willow", "Zephyr", "Ash", "Bramble", "Cinder", "Dusk", "Fable", "Heather", "Ivory", "Jet",
    "Moss", "Nutmeg", "Pebble", "Rusty", "Storm", "Tansy",
];

/// A name from the game's list for a resident (`residentName`).
pub(crate) fn resident_name(rand: &mut Mulberry32) -> String {
    RESIDENT_NAMES[(rand.next() * RESIDENT_NAMES.len() as f64).floor() as usize].to_string()
}

/// A name from the game for a horse (`horseName`).
pub(crate) fn horse_name(rand: &mut Mulberry32) -> String {
    HORSE_NAMES[(rand.next() * HORSE_NAMES.len() as f64).floor() as usize].to_string()
}

/// The name the game gives a new resident (`givenName`): with `taken`, one it doesn't hold,
/// which it then holds too, marked as the game's; without, the bare draw.
fn given_name(
    rand: &mut Mulberry32,
    taken: Option<&mut HashSet<String>>,
) -> (String, Option<bool>) {
    let drawn = resident_name(rand);
    let Some(taken) = taken else { return (drawn, None) };
    let name = unique_name(&drawn, taken, &RESIDENT_NAMES);
    taken.insert(name.clone());
    (name, Some(true))
}

/// A lifespan in game years (`drawLifespan`).
fn draw_lifespan(rand: &mut Mulberry32) -> f64 {
    LIFESPAN_MIN + rand.next() * (LIFESPAN_MAX - LIFESPAN_MIN)
}

/// `between(rand, min, max)`: a whole number from `min` to `max`.
fn between(rand: &mut Mulberry32, min: f64, max: f64) -> f64 {
    min + (rand.next() * (max - min + 1.0)).floor()
}

/// Where a new resident comes to be.
#[derive(Debug, Clone)]
pub(crate) struct Place<'a> {
    pub id: String,
    pub owner: Option<&'a str>,
    pub city_id: Option<&'a str>,
    pub x: f64,
    pub y: f64,
    pub tick: f64,
}

fn blank(
    place: &Place,
    name: (String, Option<bool>),
    stats: StatRecord<Stat>,
    born_at: f64,
    lifespan: f64,
) -> Resident {
    Resident {
        id: place.id.clone(),
        name: name.0,
        game_name: name.1,
        owner: place.owner.map(str::to_string),
        city_id: place.city_id.map(str::to_string),
        x: place.x,
        y: place.y,
        stats,
        skills: Default::default(),
        health: MAX_HEALTH,
        hunger: MAX_HUNGER,
        born_at,
        lifespan,
        carried: Default::default(),
        order: None,
        order_ended: None,
        struck: None,
        script: None,
        interrupted: None,
        given_under_attack: None,
        defence_script_id: None,
        alarm_script_id: None,
        script_params: None,
        script_log: None,
        queue: None,
        pair: None,
        carrying: None,
        riding: None,
        aboard: None,
        down_until: None,
    }
}

/// A new adult resident with random base stats (`newResident`), aged between `START_AGE_MIN`
/// and `START_AGE_MAX`, named as `given_name` says.
pub(crate) fn new_resident(
    rand: &mut Mulberry32,
    place: Place,
    taken: Option<&mut HashSet<String>>,
) -> Resident {
    let mut stat = || Stat { base: between(rand, STAT_BASE_MIN, STAT_BASE_MAX), trained: 0.0 };
    let stats =
        StatRecord { strength: stat(), endurance: stat(), agility: stat(), intellect: stat() };
    let age = START_AGE_MIN + rand.next() * (START_AGE_MAX - START_AGE_MIN);
    let name = given_name(rand, taken);
    let born_at = place.tick - js_round(ticks_for_age(age));
    let lifespan = draw_lifespan(rand);
    blank(&place, name, stats, born_at, lifespan)
}

/// A resident's base stats (`baseStats`).
pub(crate) fn base_stats(r: &Resident) -> StatRecord<f64> {
    StatRecord {
        strength: r.stats.strength.base,
        endurance: r.stats.endurance.base,
        agility: r.stats.agility.base,
        intellect: r.stats.intellect.base,
    }
}

/// A child of two parents, given by their base stats, born at `place.tick` (`newChild`).
pub(crate) fn new_child(
    rand: &mut Mulberry32,
    parents: [&StatRecord<f64>; 2],
    place: Place,
    taken: Option<&mut HashSet<String>>,
) -> Resident {
    let [a, b] = parents;
    let mut stat = |x: f64, y: f64| {
        let average = js_round((x + y) / 2.0);
        let base = average + between(rand, -CHILD_STAT_SPREAD, CHILD_STAT_SPREAD);
        Stat { base: base.max(1.0), trained: 0.0 }
    };
    let stats = StatRecord {
        strength: stat(a.strength, b.strength),
        endurance: stat(a.endurance, b.endurance),
        agility: stat(a.agility, b.agility),
        intellect: stat(a.intellect, b.intellect),
    };
    let name = given_name(rand, taken);
    let lifespan = draw_lifespan(rand);
    blank(&place, name, stats, place.tick, lifespan)
}

/// Whole stats for a new horse (`drawHorseStats`).
fn draw_horse_stats(rand: &mut Mulberry32) -> HorseStats {
    let speed = between(rand, HORSE_STAT_MIN, HORSE_STAT_MAX);
    let strength = between(rand, HORSE_STAT_MIN, HORSE_STAT_MAX);
    let endurance = between(rand, HORSE_STAT_MIN, HORSE_STAT_MAX);
    HorseStats { speed, strength, endurance }
}

/// A new grown horse (`newHorse`).
pub(crate) fn new_horse(
    rand: &mut Mulberry32,
    id: String,
    realm_id: Option<&str>,
    city_id: Option<&str>,
    at: (f64, f64),
    tick: f64,
) -> Horse {
    let stats = draw_horse_stats(rand);
    let age = HORSE_START_AGE_MIN + rand.next() * (HORSE_START_AGE_MAX - HORSE_START_AGE_MIN);
    Horse {
        id,
        name: horse_name(rand),
        realm_id: realm_id.map(str::to_string),
        city_id: city_id.map(str::to_string),
        x: at.0,
        y: at.1,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats,
        born_at: tick - js_round(age * TICKS_PER_GAME_YEAR),
        down_until: None,
    }
}
