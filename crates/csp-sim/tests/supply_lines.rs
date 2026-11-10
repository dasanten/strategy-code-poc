//! `apps/server/src/supply-lines.test.ts`, ported (T86.17): refilling from a carriage, and the
//! supply lines a haul route or a drive to an army makes.

mod build_common;

use build_common::*;
use csp_shared::balance::{
    AVERAGE_HORSE_STATS, FOOD_PER_DAY, HOME_FOOD_LOW, HUNGER_DAYS, MAX_HEALTH, MAX_HUNGER,
    STARVE_DAYS,
};
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Carriage, Good, Horse, HorseStats, Resident, ResidentOrder, WorldState,
};
use csp_sim::armies::supply_lines_sound;
use csp_sim::queries::residents::is_down;
use csp_sim::survival::{die, step_refill};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};
use std::sync::Arc;

const SIZE: i32 = 48;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: Orders,
    walking: Walking,
    scratch: Scratch,
    army_id: String,
}

/// A world with realm r1 (Player 7) whose city Ash stands at (5, 5), with a storage of plenty of
/// Food at (8, 5) where its Leader a1 stays fed. Carriage k1 of r1 and its horse h1 stand at the
/// storage with driver d1, who carries Food for a long trip. Soldiers s1 and s2 of r1 stand far
/// from home at (30, 30) and (30, 31) with nothing to eat, in army Foot.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "a1"));
    add_city(&mut world, "c1", Some("r1"), 5.0, 5.0);
    let mut storage = building("st", BuildingKind::Storage, 8.0, 5.0);
    storage.city_id = Some("c1".into());
    storage.stock = Some(serde_json::from_value(json!({ "food": 1000 })).unwrap());
    world.buildings.push(storage);
    add(&mut world, "a1", 8.0, 5.0);
    let d1 = add(&mut world, "d1", 8.0, 5.0);
    world.residents[d1].carried = serde_json::from_value(json!({ "food": 30 })).unwrap();
    add(&mut world, "s1", 30.0, 30.0);
    add(&mut world, "s2", 30.0, 31.0);
    world.horses.push(Horse {
        id: "h1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 8.0,
        y: 5.0,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        name: "Rowan".into(),
        stats: HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        },
        born_at: 0.0,
        down_until: None,
    });
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 8.0,
        y: 5.0,
        horse_id: None,
        load: Default::default(),
    });
    let mut s = Setup {
        world,
        walking: Walking::new(Arc::new(terrain.clone())),
        terrain,
        orders: Orders::default(),
        scratch: Scratch::default(),
        army_id: String::new(),
    };
    assert_eq!(
        s.order(json!({ "kind": "formArmy", "name": "Foot", "residentIds": ["s1", "s2"] })),
        Ok(())
    );
    s.army_id = s.world.armies[0].id.clone();
    s
}

/// A grown resident of r1 at (x, y) with every stat 10, carrying nothing.
fn add(world: &mut WorldState, id: &str, x: f64, y: f64) -> usize {
    let i = resident(world, id, x, y);
    world.residents[i].born_at = -20.0 * 24.0 * 3600.0;
    world.residents[i].lifespan = 60.0;
    i
}

fn food(r: &Resident) -> Option<f64> {
    r.carried.get(&Good::Food).copied()
}

fn r<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

impl Setup {
    /// Sends an order from Player 7, applies it and answers whether it was taken.
    fn order(&mut self, o: Value) -> Result<(), String> {
        let answer = self.orders.receive(&self.world, &player(7), o, &self.terrain);
        self.orders.apply_all(&mut self.world, &self.terrain);
        answer
    }

    /// Steps the world for `days` game days, checking every invariant now and then.
    fn run(&mut self, days: f64) {
        let ticks = (days * TICKS_PER_GAME_DAY) as usize;
        for t in 0..ticks {
            step_world(
                &mut self.world,
                &self.terrain,
                &mut self.scratch,
                Some(&mut self.walking),
                None,
            );
            if t % 200 == 0 {
                assert_sound(&self.world, &self.terrain);
            }
        }
        assert_sound(&self.world, &self.terrain);
    }

    fn soldiers(&self) -> Vec<&Resident> {
        ["s1", "s2"].iter().map(|id| r(&self.world, id)).collect()
    }
}

// refilling from a carriage

#[test]
fn feeds_army_members_from_a_carriage_of_their_realm_on_or_next_to_their_tile() {
    let mut s = setup();
    let k = &mut s.world.carriages[0];
    (k.x, k.y) = (31.0, 31.0);
    k.load = serde_json::from_value(json!({ "food": 10 })).unwrap();
    step_refill(&mut s.world, SIZE);
    for soldier in s.soldiers() {
        assert_eq!(food(soldier), Some(HOME_FOOD_LOW));
    }
    assert_eq!(s.world.carriages[0].load.get(&Good::Food).copied(), Some(10.0 - 2.0 * HOME_FOOD_LOW));
}

#[test]
fn feeds_nobody_outside_an_army_nor_from_a_carriage_further_off_or_of_another_realm() {
    let mut s = setup();
    add(&mut s.world, "x1", 31.0, 32.0);
    let k = &mut s.world.carriages[0];
    (k.x, k.y) = (32.0, 32.0);
    k.load = serde_json::from_value(json!({ "food": 10 })).unwrap();
    step_refill(&mut s.world, SIZE);
    // x1 is beside it but in no army; s2 is two tiles off.
    assert_eq!(food(r(&s.world, "x1")), None);
    assert_eq!(food(r(&s.world, "s2")), None);
    let k = &mut s.world.carriages[0];
    k.x = 30.0;
    k.realm_id = Some("r2".into());
    step_refill(&mut s.world, SIZE);
    assert_eq!(food(r(&s.world, "s1")), None);
}

#[test]
fn leaves_the_food_a_haul_route_keeps_on_board_for_the_horse() {
    let mut s = setup();
    s.world.carriages[0].load = serde_json::from_value(json!({ "food": 5 })).unwrap();
    let haul = json!({
        "kind": "haul", "residentId": "d1", "carriageId": "k1", "armyId": s.army_id,
        "goods": ["food"], "keepFood": 4
    });
    assert_eq!(s.order(haul), Ok(()));
    let k = &mut s.world.carriages[0];
    (k.x, k.y) = (30.0, 32.0);
    step_refill(&mut s.world, SIZE);
    assert_eq!(food(r(&s.world, "s2")), Some(1.0));
    assert_eq!(food(r(&s.world, "s1")), None);
    assert_eq!(s.world.carriages[0].load.get(&Good::Food).copied(), Some(4.0));
}

// supply lines

#[test]
fn take_only_the_players_own_army_as_a_stop_bringing_nothing_back() {
    let mut s = setup();
    let army = s.army_id.clone();
    let haul = |more: Value| {
        let mut o = json!({
            "kind": "haul", "residentId": "d1", "carriageId": "k1", "goods": ["food"], "keepFood": 0
        });
        o.as_object_mut().unwrap().extend(more.as_object().unwrap().clone());
        o
    };
    assert_eq!(s.order(haul(json!({ "armyId": "nope" }))), Err("not one of your armies".into()));
    assert_eq!(
        s.order(haul(json!({ "armyId": army, "returnGoods": ["wood"] }))),
        Err("nothing comes back from an army".into())
    );
    let drive = |army_id: &str| {
        json!({ "kind": "drive", "residentId": "d1", "carriageId": "k1", "armyId": army_id })
    };
    assert_eq!(s.order(drive("nope")), Err("not one of your armies".into()));
    assert_eq!(s.order(drive(&army)), Ok(()));
    match &r(&s.world, "d1").order {
        Some(ResidentOrder::Drive(d)) => assert_eq!(d.army.as_deref(), Some(army.as_str())),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_supply_wagon_follows_its_army_and_feeds_it_far_from_home() {
    let mut s = setup();
    s.world.carriages[0].load = serde_json::from_value(json!({ "food": 60 })).unwrap();
    let army = s.army_id.clone();
    assert_eq!(
        s.order(json!({ "kind": "drive", "residentId": "d1", "carriageId": "k1", "armyId": army })),
        Ok(())
    );
    assert_eq!(s.order(json!({ "kind": "armyWalkTo", "armyId": army, "x": 40, "y": 20 })), Ok(()));
    s.run(4.0);
    for soldier in s.soldiers() {
        assert_eq!((soldier.x, soldier.y), (40.0, 20.0));
        assert!(soldier.hunger > 0.0);
    }
    // Right next to the army, diagonals included.
    let k = &s.world.carriages[0];
    assert!(wrap_distance(SIZE, (k.x as i32, k.y as i32), (40, 20)) < 1.5);
    assert!(s.world.carriages[0].load.get(&Good::Food).copied().unwrap_or(0.0) < 60.0);
    // Disbanding the army ends its supply wagon's drive.
    assert_eq!(s.order(json!({ "kind": "disbandArmy", "armyId": army })), Ok(()));
    s.run(0.01);
    assert!(r(&s.world, "d1").order.is_none());
}

#[test]
fn a_haul_route_keeps_a_moving_army_fed_cutting_it_starves_the_army() {
    let start = |s: &mut Setup| {
        let route = json!({
            "kind": "haul", "residentId": "d1", "carriageId": "k1", "goods": ["food"],
            "armyId": s.army_id, "keepFood": 6
        });
        assert_eq!(s.order(route), Ok(()));
        let walk = json!({ "kind": "armyWalkTo", "armyId": s.army_id, "x": 40, "y": 40 });
        assert_eq!(s.order(walk), Ok(()));
    };
    let mut fed = setup();
    start(&mut fed);
    fed.run(2.0);
    // The army moves on; the route goes after it.
    let on = json!({ "kind": "armyWalkTo", "armyId": fed.army_id, "x": 20, "y": 40 });
    assert_eq!(fed.order(on), Ok(()));
    fed.run(3.0);
    for soldier in fed.soldiers() {
        assert_eq!((soldier.x, soldier.y), (20.0, 40.0));
        assert_eq!(soldier.health, MAX_HEALTH);
    }
    let stock = fed.world.buildings.iter().find(|b| b.id == "st").unwrap().stock.as_ref().unwrap();
    assert!(stock.get(&Good::Food).copied().unwrap() < 1000.0);

    let mut cut = setup();
    start(&mut cut);
    // The driver is killed on the way: nothing comes any more.
    cut.run(0.05);
    die(&mut cut.world, "d1");
    // What they carried, then a full meter, then starving: they lie Down (`CONTEXT.md`: Down).
    cut.run(HOME_FOOD_LOW / FOOD_PER_DAY + HUNGER_DAYS + STARVE_DAYS + 0.5);
    let down: Vec<bool> = cut.soldiers().iter().map(|s| is_down(s.down_until)).collect();
    assert_eq!(down, vec![true, true]);
}

#[test]
fn breaks_the_invariant_when_a_supply_line_goes_to_no_army_of_the_realm() {
    let mut s = setup();
    let army = s.army_id.clone();
    assert_eq!(
        s.order(json!({ "kind": "drive", "residentId": "d1", "carriageId": "k1", "armyId": army })),
        Ok(())
    );
    s.world.armies.clear();
    let found: Vec<String> = supply_lines_sound(&s.world).into_iter().map(|v| v.message).collect();
    assert_eq!(found, vec![format!("resident d1 supplies army {army}, not one of their realm's")]);
}
