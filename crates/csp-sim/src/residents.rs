//! New residents and children (`apps/server/src/residents.ts`, `CONTEXT.md`: Resident, Child,
//! Aging, Game-given names). The seeded generator and the string hash of that file are in
//! [`crate::random`] (`Mulberry32`, `hash_str`).

use std::collections::HashSet;

use csp_shared::balance::{
    ticks_for_age, CHILD_STAT_SPREAD, LIFESPAN_MAX, LIFESPAN_MIN, MAX_HEALTH, MAX_HUNGER,
    START_AGE_MAX, START_AGE_MIN, STAT_BASE_MAX, STAT_BASE_MIN,
};
use csp_shared::world::{Resident, Stat, StatName, StatRecord, Stock};

use crate::names::unique_name;
use crate::queries::js_round;

/// A source of random numbers in [0, 1), as the TypeScript's `rand: () => number`.
pub type Rand<'a> = dyn FnMut() -> f64 + 'a;

/// Given names for new residents (`RESIDENT_NAMES`). Only flavour: a name means nothing to the
/// rules.
pub const RESIDENT_NAMES: [&str; 30] = [
    "Mara", "Tobin", "Corwin", "Edda", "Pell", "Ilse", "Saskia", "Bram", "Odo", "Wren", "Hale",
    "Ysolde", "Garrick", "Linnea", "Aldo", "Petra", "Rurik", "Senna", "Joran", "Tilde", "Anselm",
    "Brisa", "Cato", "Dagny", "Emeric", "Fenna", "Gisli", "Hesper", "Ivo", "Jutta",
];

/// The stats in the TypeScript's order (`STAT_NAMES`): the order random draws are made in.
pub const STAT_NAMES: [StatName; 4] =
    [StatName::Strength, StatName::Endurance, StatName::Agility, StatName::Intellect];

/// A name from the game's list for a resident, drawn with `rand` (`residentName`).
pub fn resident_name(rand: &mut Rand) -> &'static str {
    RESIDENT_NAMES[(rand() * RESIDENT_NAMES.len() as f64).floor() as usize]
}

/// The name the game gives a new resident, drawn with `rand` (`givenName`, `CONTEXT.md`:
/// Game-given names): with `taken`, the names of their realm's living residents, one it doesn't
/// hold, which it then holds too, marked as the game's. Without, the bare draw.
fn given_name(rand: &mut Rand, taken: Option<&mut HashSet<String>>) -> (String, Option<bool>) {
    let drawn = resident_name(rand);
    let Some(taken) = taken else { return (drawn.to_string(), None) };
    let name = unique_name(drawn, taken, &RESIDENT_NAMES);
    taken.insert(name.clone());
    (name, Some(true))
}

/// A lifespan in game years between `LIFESPAN_MIN` and `LIFESPAN_MAX` (`drawLifespan`,
/// `CONTEXT.md`: Aging).
pub fn draw_lifespan(rand: &mut Rand) -> f64 {
    LIFESPAN_MIN + rand() * (LIFESPAN_MAX - LIFESPAN_MIN)
}

/// A whole number from `min` to `max`, both included (`between`).
fn between(rand: &mut Rand, min: f64, max: f64) -> f64 {
    min + (rand() * (max - min + 1.0)).floor()
}

/// Where a new resident is and whose they are (the `fields` of `newResident`).
#[derive(Debug, Clone, PartialEq)]
pub struct NewResident<'a> {
    pub id: &'a str,
    pub owner: Option<&'a str>,
    pub city_id: Option<&'a str>,
    pub x: f64,
    pub y: f64,
    pub tick: f64,
}

/// A resident with nothing trained or learned yet, full health and a full hunger meter, born at
/// `tick` with no lifespan yet.
fn blank(fields: &NewResident, name: (String, Option<bool>), stats: StatRecord<Stat>) -> Resident {
    Resident {
        id: fields.id.to_string(),
        name: name.0,
        game_name: name.1,
        owner: fields.owner.map(str::to_string),
        city_id: fields.city_id.map(str::to_string),
        x: fields.x,
        y: fields.y,
        stats,
        skills: Default::default(),
        health: MAX_HEALTH,
        hunger: MAX_HUNGER,
        born_at: fields.tick,
        lifespan: 0.0,
        carried: Stock::new(),
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

/// One value per stat, made in `STAT_NAMES`' order.
fn stat_record(mut stat: impl FnMut(StatName) -> Stat) -> StatRecord<Stat> {
    let [strength, endurance, agility, intellect] = STAT_NAMES.map(&mut stat);
    StatRecord { strength, endurance, agility, intellect }
}

/// A new adult resident (`newResident`): random base stats, nothing trained or learned yet, full
/// health and a full hunger meter, aged between `START_AGE_MIN` and `START_AGE_MAX` at `tick`,
/// with a lifespan between `LIFESPAN_MIN` and `LIFESPAN_MAX`. Its name is one `taken` doesn't
/// hold (`given_name`).
pub fn new_resident(
    rand: &mut Rand,
    fields: &NewResident,
    taken: Option<&mut HashSet<String>>,
) -> Resident {
    let stats =
        stat_record(|_| Stat { base: between(rand, STAT_BASE_MIN, STAT_BASE_MAX), trained: 0.0 });
    let age = START_AGE_MIN + rand() * (START_AGE_MAX - START_AGE_MIN);
    let name = given_name(rand, taken);
    let mut r = blank(fields, name, stats);
    r.born_at = fields.tick - js_round(ticks_for_age(age));
    r.lifespan = draw_lifespan(rand);
    r
}

/// A resident's base stats (`baseStats`, `CONTEXT.md`: Base value), the only part a child
/// inherits.
pub fn base_stats(r: &Resident) -> StatRecord<f64> {
    StatRecord {
        strength: r.stats.strength.base,
        endurance: r.stats.endurance.base,
        agility: r.stats.agility.base,
        intellect: r.stats.intellect.base,
    }
}

/// One stat of a record (`record[stat]`).
pub fn stat_of<T: Copy>(record: &StatRecord<T>, stat: StatName) -> T {
    match stat {
        StatName::Strength => record.strength,
        StatName::Endurance => record.endurance,
        StatName::Agility => record.agility,
        StatName::Intellect => record.intellect,
    }
}

/// A child of two parents, given by their base stats, born at `tick` (`newChild`, `CONTEXT.md`:
/// Child): each base stat is the parents' average, rounded, plus a whole random amount of at most
/// `CHILD_STAT_SPREAD` either way, and at least 1. Nothing trained or learned; full health and
/// hunger meter; a lifespan between `LIFESPAN_MIN` and `LIFESPAN_MAX`; a name `taken` doesn't
/// hold (`given_name`).
pub fn new_child(
    rand: &mut Rand,
    parents: [&StatRecord<f64>; 2],
    fields: &NewResident,
    taken: Option<&mut HashSet<String>>,
) -> Resident {
    let [a, b] = parents;
    let stats = stat_record(|s| {
        let average = js_round((stat_of(a, s) + stat_of(b, s)) / 2.0);
        let base = average + between(rand, -CHILD_STAT_SPREAD, CHILD_STAT_SPREAD);
        Stat { base: base.max(1.0), trained: 0.0 }
    });
    let name = given_name(rand, taken);
    let mut r = blank(fields, name, stats);
    r.lifespan = draw_lifespan(rand);
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queries::residents::{age_in_years, can_work};
    use crate::random::Mulberry32;

    fn fields(tick: f64) -> NewResident<'static> {
        NewResident { id: "r1", owner: Some("realm1"), city_id: None, x: 3.0, y: 4.0, tick }
    }

    #[test]
    fn makes_the_same_resident_from_the_same_seed() {
        let make = || {
            let mut m = Mulberry32::new(5.0);
            new_resident(&mut || m.next(), &fields(100.0), None)
        };
        assert_eq!(make(), make());
    }

    #[test]
    fn makes_an_adult_with_stats_age_and_lifespan_in_range() {
        let mut m = Mulberry32::new(11.0);
        for i in 0..200 {
            let tick = f64::from(i) * 1000.0;
            let r = new_resident(&mut || m.next(), &fields(tick), None);
            for s in STAT_NAMES {
                let base = stat_of(&base_stats(&r), s);
                assert!((STAT_BASE_MIN..=STAT_BASE_MAX).contains(&base) && base.fract() == 0.0);
            }
            let age = age_in_years(r.born_at, tick);
            assert!((START_AGE_MIN - 1e-6..=START_AGE_MAX + 1e-6).contains(&age), "{age}");
            assert!(can_work(r.born_at, tick));
            assert!((LIFESPAN_MIN..LIFESPAN_MAX).contains(&r.lifespan));
            assert_eq!((r.health, r.hunger), (MAX_HEALTH, MAX_HUNGER));
            assert!(RESIDENT_NAMES.contains(&r.name.as_str()) && r.game_name.is_none());
        }
    }

    #[test]
    fn gives_a_name_none_of_the_taken_hold_and_takes_it() {
        let mut m = Mulberry32::new(2.0);
        let mut taken: HashSet<String> = RESIDENT_NAMES.iter().map(|n| n.to_string()).collect();
        let r = new_resident(&mut || m.next(), &fields(0.0), Some(&mut taken));
        assert!(r.name.ends_with(" II"), "{}", r.name);
        assert_eq!(r.game_name, Some(true));
        assert!(taken.contains(&r.name));
    }

    #[test]
    fn makes_a_child_near_the_parents_average_and_at_least_one() {
        let mut m = Mulberry32::new(3.0);
        let low = StatRecord { strength: 1.0, endurance: 1.0, agility: 1.0, intellect: 1.0 };
        let high = StatRecord { strength: 15.0, endurance: 13.0, agility: 9.0, intellect: 7.0 };
        for _ in 0..100 {
            let c = new_child(&mut || m.next(), [&low, &low], &fields(50.0), None);
            for s in STAT_NAMES {
                assert!(stat_of(&base_stats(&c), s) >= 1.0);
            }
            let c = new_child(&mut || m.next(), [&high, &low], &fields(50.0), None);
            for s in STAT_NAMES {
                let average = js_round((stat_of(&high, s) + 1.0) / 2.0);
                assert!((stat_of(&base_stats(&c), s) - average).abs() <= CHILD_STAT_SPREAD);
            }
            assert_eq!(c.born_at, 50.0);
            assert!(!can_work(c.born_at, 50.0));
            assert!(c.skills.is_empty() && c.stats.strength.trained == 0.0);
        }
    }

    /// What `gen-expected.mts` wrote from the frozen TypeScript.
    fn expected() -> serde_json::Value {
        serde_json::from_str(include_str!("residents/expected.json")).expect("expected.json")
    }

    #[test]
    fn makes_the_residents_and_children_the_typescript_makes() {
        for case in expected()["residents"].as_array().unwrap() {
            let mut m = Mulberry32::new(case["seed"].as_f64().unwrap());
            let mut rand = || m.next();
            let mut taken: HashSet<String> =
                ["Mara", "Tobin", "Edda"].iter().map(|n| n.to_string()).collect();
            let mut made = Vec::new();
            for i in 0..6u32 {
                let id = format!("r{i}");
                let fields = NewResident {
                    id: &id,
                    owner: Some("realm1"),
                    city_id: (i % 2 == 1).then_some("city2"),
                    x: f64::from(i),
                    y: f64::from(2 * i),
                    tick: 1000.0 * f64::from(i),
                };
                let taken = (i % 3 != 0).then_some(&mut taken);
                made.push(new_resident(&mut rand, &fields, taken));
            }
            let parents = [&base_stats(&made[0]), &base_stats(&made[1])];
            let fields = NewResident {
                id: "c",
                owner: None,
                city_id: Some("city2"),
                x: 1.0,
                y: 1.0,
                tick: 5000.0,
            };
            let child = new_child(&mut rand, parents, &fields, Some(&mut taken));
            assert!(crate::test_support::same_json(&made, &case["made"]), "seed {}", case["seed"]);
            assert!(
                crate::test_support::same_json(&child, &case["child"]),
                "seed {}",
                case["seed"]
            );
        }
    }

    #[test]
    fn gives_the_names_and_layouts_the_typescript_gives() {
        let pool = ["Mara", "Tobin", "Ivo", "Jutta", "Bram", "Wren"];
        for case in expected()["names"].as_array().unwrap() {
            let taken: HashSet<String> = serde_json::from_value(case["taken"].clone()).unwrap();
            let drawn = case["drawn"].as_str().unwrap();
            assert_eq!(unique_name(drawn, &taken, &pool), case["out"].as_str().unwrap());
        }
        for case in expected()["layouts"].as_array().unwrap() {
            let layout = crate::city_layout::pick_layout(
                case["seed"].as_i64().unwrap(),
                case["id"].as_str().unwrap(),
            );
            assert_eq!(serde_json::to_value(layout).unwrap(), case["out"]);
        }
    }
}
