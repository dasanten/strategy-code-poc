//! `apps/server/src/driving.test.ts`. The `checkInvariants` checks and "carriage invariants" come
//! with T86.13; loading by `drop` and `pickUp` orders ("loading a carriage" and the second half of
//! the Strength case) with T86.5.

use std::sync::Arc;

use csp_shared::balance::{
    ticks_for_age, CARRIAGE_CAPACITY, CARRIAGE_MAX_CAPACITY, CARRIAGE_SPEED, HORSE_STAT_AVERAGE,
    HORSE_STAT_MAX, HORSE_STAT_MIN, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{terrain_at, Terrain, TerrainMap};
use csp_shared::world::{
    DriveOrder, Good, OrderRequest, Pile, ResidentOrder, SkillName, Tile, WorldState,
};
use serde_json::json;

use super::*;
use crate::horses::{step_horses, HORSE_DOWN_TICKS};
use crate::movement_pending::OrderSender;
use crate::movement_test_world::{
    carriage, draw, horse, order, order_from, resident, walk_out, world_with_realm,
};
use crate::queries::carriages::carriage_capacity;
use crate::queries::names::held;
use crate::queries::pace::{drive_speed, horse_speed_factor};
use crate::queries::riding::{horse_food, FoodPlace};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

fn open() -> TerrainMap {
    draw(&[".".repeat(16).as_str(); 16])
}

/// A world on `map` with realm r1 (Player 7, Leader w1) and, at (x, y), w1, carriage k1 of r1 and
/// horse h1 of r1, not yet hitched.
fn setup(map: &TerrainMap, x: f64, y: f64) -> WorldState {
    let mut world = world_with_realm(map);
    world.residents.push(resident("w1", Some("r1"), x, y));
    world.horses.push(horse("h1", Some("r1"), x, y));
    world.carriages.push(carriage("k1", Some("r1"), x, y, None));
    world
}

fn drive_to(world: &mut WorldState, x: f64, y: f64) {
    world.residents[0].order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id: "k1".into(),
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    }));
}

/// Steps the world until the driver's order is done or 5000 ticks pass; returns the ticks.
fn drive_out(world: &mut WorldState, map: &TerrainMap) -> u32 {
    walk_out(world, map, &mut Walking::new(Arc::new(map.clone())), "w1", 5000)
}

fn drive_order(o: serde_json::Value) -> serde_json::Value {
    let mut base = json!({"kind": "drive", "residentId": "w1", "carriageId": "k1"});
    base.as_object_mut().expect("an object").extend(o.as_object().expect("an object").clone());
    base
}

#[test]
fn needs_an_adult_of_the_player_on_their_own_carriages_tile_with_a_horse_there() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    let sender = OrderSender { user_id: 7, npc_city_id: None };
    let check = |world: &WorldState, o: serde_json::Value| {
        let o: OrderRequest = serde_json::from_value(drive_order(o)).expect("an order");
        Drive.validate(world, &sender, &o, Some(&map))
    };
    assert_eq!(check(&world, json!({"x": 8, "y": 2})), None);
    assert_eq!(
        check(&world, json!({"x": 8.5, "y": 2})).as_deref(),
        Some("the target must be a tile")
    );
    assert_eq!(
        check(&world, json!({"x": 8, "y": 2, "carriageId": "nope"})).as_deref(),
        Some("not one of your carriages")
    );
    assert_eq!(
        order_from(&mut world.clone(), &map, 8, drive_order(json!({"x": 8, "y": 2}))),
        Err("not one of your residents".into())
    );
    world.horses[0].x = 3.0;
    assert_eq!(
        check(&world, json!({"x": 8, "y": 2})).as_deref(),
        Some("no horse here to pull that carriage")
    );
    world.horses[0].x = 2.0;
    world.carriages[0].x = 3.0;
    assert_eq!(
        check(&world, json!({"x": 8, "y": 2})).as_deref(),
        Some("that carriage is not on the resident’s tile")
    );
    world.carriages[0].x = 2.0;
    world.residents[0].born_at = world.tick as f64 - ticks_for_age(5.0);
    assert_eq!(check(&world, json!({"x": 8, "y": 2})).as_deref(), Some("children can’t drive"));
}

#[test]
fn refuses_a_target_in_the_mountains_and_a_carriage_someone_else_drives() {
    let rows: Vec<String> = (0..16).map(|y| if y == 8 { "^" } else { "." }.repeat(16)).collect();
    let map = draw(&rows.iter().map(String::as_str).collect::<Vec<_>>());
    let mut world = setup(&map, 2.0, 2.0);
    world.residents.push(resident("w2", Some("r1"), 2.0, 2.0));
    let sender = OrderSender { user_id: 7, npc_city_id: None };
    let o = |id: &str, y: f64| -> OrderRequest {
        serde_json::from_value(
            json!({"kind": "drive", "residentId": id, "carriageId": "k1", "x": 2, "y": y}),
        )
        .expect("an order")
    };
    assert_eq!(
        Drive.validate(&world, &sender, &o("w1", 8.0), Some(&map)).as_deref(),
        Some("a carriage can’t go there")
    );
    // Both are accepted in one tick, but only the first gets to drive.
    assert_eq!(Drive.validate(&world, &sender, &o("w1", 5.0), Some(&map)), None);
    assert_eq!(Drive.validate(&world, &sender, &o("w2", 5.0), Some(&map)), None);
    Drive.apply(&mut world, &sender, &o("w1", 5.0), Some(&map));
    Drive.apply(&mut world, &sender, &o("w2", 5.0), Some(&map));
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::Drive(_))));
    assert_eq!(world.residents[1].order, None);
    assert_eq!(
        Drive.validate(&world, &sender, &o("w2", 5.0), Some(&map)).as_deref(),
        Some("someone else is driving that carriage")
    );
}

#[test]
fn moves_driver_carriage_and_horse_together_hitching_the_horse_then_stops() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    drive_to(&mut world, 6.0, 2.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    while world.residents[0].order.is_some() {
        step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
        let (r, k, h) = (&world.residents[0], &world.carriages[0], &world.horses[0]);
        assert_eq!((k.x, k.y), (r.x, r.y));
        assert_eq!((h.x, h.y), (r.x, r.y));
    }
    assert_eq!((world.residents[0].x, world.residents[0].y), (6.0, 2.0));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
}

#[test]
fn is_fast_on_plains_slower_in_forest_faster_with_driving_skill() {
    let open = open();
    let forest = draw(&["f".repeat(16).as_str(); 16]);
    let ticks = |map: &TerrainMap, skill: f64| {
        let mut world = setup(map, 2.0, 2.0);
        world.residents[0].skills.insert(SkillName::Driving, skill);
        drive_to(&mut world, 6.0, 2.0);
        f64::from(drive_out(&mut world, map)) / 4.0
    };
    let plains = ticks(&open, 0.0);
    // Twice an unloaded walker's speed on plains: about 15 s a tile.
    let speed = CARRIAGE_SPEED.get(Terrain::Plains as u8).expect("a speed");
    assert!((plains - WALK_TICKS_PER_TILE / speed).abs() < 2.0);
    assert!(ticks(&forest, 0.0) > plains * 2.0);
    assert!(ticks(&open, 20.0) < plains);
}

#[test]
fn teaches_driving_to_the_driver_while_they_drive() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    drive_to(&mut world, 6.0, 2.0);
    drive_out(&mut world, &map);
    let r = &world.residents[0];
    assert!(r.skills.get(&SkillName::Driving).copied().unwrap_or(0.0) > 0.0);
    let speed = drive_speed(r, &world.horses[0].stats, Terrain::Plains as u8);
    assert!(
        speed > CARRIAGE_SPEED.get(Terrain::Plains as u8).expect("a speed") / WALK_TICKS_PER_TILE
    );
}

#[test]
fn goes_round_a_mountain_ridge_through_its_pass_never_into_the_mountains() {
    // A mountain ridge across the map with one pass through it far to the east.
    let ridge = format!("{}....", "^".repeat(20));
    let plain = ".".repeat(24);
    let rows: Vec<&str> =
        (0..24).map(|y| if y == 6 { ridge.as_str() } else { plain.as_str() }).collect();
    let map = draw(&rows);
    let mut world = setup(&map, 2.0, 2.0);
    drive_to(&mut world, 2.0, 10.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    let mut crossed_at = None;
    let mut t = 0;
    while t < 20000 && world.residents[0].order.is_some() {
        step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
        let k = &world.carriages[0];
        assert_ne!(terrain_at(&map, k.x as i32, k.y as i32), Terrain::Mountain as u8);
        if k.y == 6.0 {
            crossed_at = Some(k.x);
        }
        t += 1;
    }
    assert_eq!((world.carriages[0].x, world.carriages[0].y), (2.0, 10.0));
    // It went through the pass (east, or round the west across the join), not over the ridge.
    assert!(crossed_at.expect("crossed the ridge") >= 20.0);
}

#[test]
fn stands_when_its_horse_goes_down_and_a_dead_horse_is_unhitched() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    world.carriages[0].horse_id = Some("h1".into());
    drive_to(&mut world, 6.0, 2.0);
    world.horses[0].health = 0.0001;
    world.horses[0].hunger = 0.0;
    step_horses(&mut world, &map);
    // Down, it stays hitched, and the drive ends where the carriage stands.
    assert_eq!(world.horses[0].down_until, Some(world.tick as f64 + HORSE_DOWN_TICKS));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
    assert_eq!(world.residents[0].order, None);
    drive_to(&mut world, 6.0, 2.0);
    drive_out(&mut world, &map);
    assert_eq!([world.carriages[0].x, world.residents[0].x], [2.0, 2.0]);
    assert_eq!(world.residents[0].order, None);
    // Nobody feeds it: its time runs out.
    world.tick = world.horses[0].down_until.expect("Down") as u64;
    step_horses(&mut world, &map);
    assert!(world.horses.is_empty());
    assert_eq!(world.carriages[0].horse_id, None);
}

fn unhitch(world: &mut WorldState, map: &TerrainMap, o: serde_json::Value) -> Result<(), String> {
    let mut base = json!({"kind": "unhitch", "residentId": "w1", "carriageId": "k1"});
    base.as_object_mut().expect("an object").extend(o.as_object().expect("an object").clone());
    order(world, map, base)
}

#[test]
fn frees_the_horse_on_the_tile_and_stops_the_carriages_driver() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    drive_to(&mut world, 8.0, 2.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    while world.carriages[0].x < 4.0 {
        step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
    }
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
    assert_eq!(unhitch(&mut world, &map, json!({})), Ok(()));
    assert_eq!(world.carriages[0].horse_id, None);
    assert_eq!(world.residents[0].order, None);
    for _ in 0..5 {
        step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
    }
    assert_eq!((world.carriages[0].x, world.carriages[0].y), (4.0, 2.0));
    assert_eq!((world.horses[0].x, world.horses[0].y), (4.0, 2.0));
    // The free horse can be ridden now.
    order(&mut world, &map, json!({"kind": "mount", "residentId": "w1", "horseId": "h1"}))
        .expect("mounted");
    assert_eq!(world.residents[0].riding.as_deref(), Some("h1"));
    step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
    assert_eq!(world.residents[0].riding.as_deref(), Some("h1"));
}

#[test]
fn refuses_a_child_someone_off_the_tile_another_realm_and_a_carriage_with_no_horse() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    assert_eq!(
        unhitch(&mut world, &map, json!({})),
        Err("no horse is hitched to that carriage".into())
    );
    world.carriages[0].horse_id = Some("h1".into());
    assert_eq!(
        unhitch(&mut world, &map, json!({"carriageId": "nope"})),
        Err("no such carriage".into())
    );
    let born = world.residents[0].born_at;
    world.residents[0].born_at = world.tick as f64 - ticks_for_age(5.0);
    assert_eq!(unhitch(&mut world, &map, json!({})), Err("children can’t unhitch".into()));
    world.residents[0].born_at = born;
    world.residents[0].x = 3.0;
    assert_eq!(
        unhitch(&mut world, &map, json!({})),
        Err("that carriage is not on the resident’s tile".into())
    );
    world.residents[0].x = 2.0;
    world.carriages[0].realm_id = Some("r2".into());
    assert_eq!(unhitch(&mut world, &map, json!({})), Err("not a carriage of your realm".into()));
    world.carriages[0].realm_id = Some("r1".into());
    let o = json!({"kind": "unhitch", "residentId": "w1", "carriageId": "k1"});
    assert_eq!(order_from(&mut world, &map, 8, o), Err("not one of your residents".into()));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
}

#[test]
fn leaves_the_carriage_to_hitch_a_free_horse_standing_with_it_when_next_driven() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    world.carriages[0].horse_id = Some("h1".into());
    assert_eq!(unhitch(&mut world, &map, json!({})), Ok(()));
    assert_eq!(world.carriages[0].horse_id, None);
    assert_eq!(order(&mut world, &map, drive_order(json!({"x": 6, "y": 2}))), Ok(()));
    drive_out(&mut world, &map);
    let (k, h) = (&world.carriages[0], &world.horses[0]);
    assert_eq!([k.x, k.y, h.x, h.y], [6.0, 2.0, 6.0, 2.0]);
    assert_eq!(k.horse_id.as_deref(), Some("h1"));
}

#[test]
fn a_faster_horse_pulls_its_carriage_faster_a_slower_one_slower() {
    let map = open();
    let ticks = |speed: f64| {
        let mut world = setup(&map, 2.0, 2.0);
        world.horses[0].stats.speed = speed;
        drive_to(&mut world, 10.0, 2.0);
        f64::from(drive_out(&mut world, &map))
    };
    let average = ticks(HORSE_STAT_AVERAGE);
    let fast = ticks(HORSE_STAT_MAX);
    let slow = ticks(HORSE_STAT_MIN);
    assert!(fast < average);
    assert!(slow > average);
    // As fast as `horseSpeedFactor` says, give or take the last part step.
    let mut stats = horse("h", None, 0.0, 0.0).stats;
    stats.speed = HORSE_STAT_MAX;
    assert!((fast - average / horse_speed_factor(&stats)).abs() < WALK_TICKS_PER_TILE);
}

#[test]
fn a_stronger_horse_lets_its_carriage_hold_more_a_weaker_one_less() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    assert_eq!(carriage_capacity(&world, &world.carriages[0]), CARRIAGE_CAPACITY);
    world.horses[0].stats.strength = HORSE_STAT_MAX;
    let strong = carriage_capacity(&world, &world.carriages[0]);
    assert!(strong > CARRIAGE_CAPACITY);
    assert!(strong <= CARRIAGE_MAX_CAPACITY);
    world.horses[0].stats.strength = HORSE_STAT_MIN;
    assert!(carriage_capacity(&world, &world.carriages[0]) < CARRIAGE_CAPACITY);
    // Without a horse a carriage holds the plain amount.
    world.horses.clear();
    assert_eq!(carriage_capacity(&world, &world.carriages[0]), CARRIAGE_CAPACITY);
}

#[test]
fn feeds_the_horse_pulling_it_from_its_load_first() {
    let map = open();
    let mut world = setup(&map, 2.0, 2.0);
    world.piles.push(Pile {
        id: "p1".into(),
        x: 2.0,
        y: 2.0,
        goods: [(Good::Food, 5.0)].into_iter().collect(),
    });
    world.carriages[0].load = [(Good::Food, 5.0)].into_iter().collect();
    // Not hitched: the horse eats from the ground, not from someone's cart.
    assert_eq!(horse_food(&world, &world.horses[0], map.size, None), vec![FoodPlace::Pile(0)]);
    world.carriages[0].horse_id = Some("h1".into());
    assert_eq!(horse_food(&world, &world.horses[0], map.size, None)[0], FoodPlace::Carriage(0));
    world.horses[0].hunger = 0.0;
    step_horses(&mut world, &map);
    assert_eq!(held(&world.carriages[0].load, Good::Food), 4.0);
    assert_eq!(held(&world.piles[0].goods, Good::Food), 5.0);
}
