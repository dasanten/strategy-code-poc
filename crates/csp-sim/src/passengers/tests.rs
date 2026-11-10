//! `apps/server/src/passengers.test.ts`, the cases on boarding, riding along and getting off.
//! Still to come with their tickets: loading by `drop` and `unitsThatFitCarriage` (T86.5), the
//! `stop` order and queue steps (T86.2, T86.12), refilling from a carriage (T86.3), and the
//! `checkInvariants` checks (T86.13).

use std::sync::Arc;

use csp_shared::balance::{CARRIAGE_CAPACITY, OWN_FOOD, PASSENGER_WEIGHT};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Good, Resident, WorldState};
use serde_json::json;

use crate::movement_test_world::{
    carriage, horse, order, plains, resident, walk_out, world_with_realm,
};
use crate::queries::carriages::carriage_capacity;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

const SIZE: i32 = 24;

/// A world on an open map with realm r1 (Player 7, Leader w1) and, at (2, 2), its residents w1
/// (the driver), p1 and p2 with their own food, and carriage k1 with horse h1 of r1.
fn setup() -> (WorldState, TerrainMap) {
    let map = plains(SIZE);
    let mut world = world_with_realm(&map);
    for id in ["w1", "p1", "p2"] {
        let mut r = resident(id, Some("r1"), 2.0, 2.0);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        world.residents.push(r);
    }
    world.horses.push(horse("h1", Some("r1"), 2.0, 2.0));
    world.carriages.push(carriage("k1", Some("r1"), 2.0, 2.0, Some("h1")));
    (world, map)
}

fn who<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).expect("a resident")
}

fn who_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("a resident")
}

fn board(world: &mut WorldState, map: &TerrainMap, id: &str) -> Result<(), String> {
    order(world, map, json!({"kind": "board", "residentId": id, "carriageId": "k1"}))
}

/// Steps the world until the resident's order is done or 2000 ticks pass.
fn until(world: &mut WorldState, map: &TerrainMap, id: &str) {
    walk_out(world, map, &mut Walking::new(Arc::new(map.clone())), id, 2000);
}

fn drive(world: &mut WorldState, map: &TerrainMap, x: f64, y: f64) -> Result<(), String> {
    order(
        world,
        map,
        json!({"kind": "drive", "residentId": "w1", "carriageId": "k1", "x": x, "y": y}),
    )
}

#[test]
fn board_ride_along_with_the_driven_carriage_and_get_off_on_it_or_right_next_to_it() {
    let (mut world, map) = setup();
    assert_eq!(board(&mut world, &map, "p1"), Ok(()));
    assert_eq!(board(&mut world, &map, "p2"), Ok(()));
    assert_eq!(
        [who(&world, "p1").aboard.as_deref(), who(&world, "p2").aboard.as_deref()],
        [Some("k1"); 2]
    );
    assert_eq!(drive(&mut world, &map, 12.0, 5.0), Ok(()));
    until(&mut world, &map, "w1");
    assert_eq!((world.carriages[0].x, world.carriages[0].y), (12.0, 5.0));
    for p in ["p1", "p2"] {
        let p = who(&world, p);
        assert_eq!((p.x, p.y, p.aboard.as_deref()), (12.0, 5.0, Some("k1")));
    }
    // p1 gets off on the carriage's tile, p2 onto the tile right next to it.
    assert_eq!(order(&mut world, &map, json!({"kind": "getOff", "residentId": "p1"})), Ok(()));
    assert_eq!(who(&world, "p1").aboard, None);
    assert_eq!(
        order(&mut world, &map, json!({"kind": "getOff", "residentId": "p2", "x": 13, "y": 6})),
        Ok(())
    );
    assert_eq!(who(&world, "p2").aboard, None);
    until(&mut world, &map, "p2");
    let (p1, p2) = (who(&world, "p1"), who(&world, "p2"));
    assert_eq!([p1.x, p1.y, p2.x, p2.y], [12.0, 5.0, 13.0, 6.0]);
    // The carriage drives on without them.
    drive(&mut world, &map, 16.0, 5.0).expect("driving on");
    until(&mut world, &map, "w1");
    assert_eq!((who(&world, "p1").x, who(&world, "p1").y), (12.0, 5.0));
}

#[test]
fn get_off_only_next_to_the_carriage_and_only_while_aboard() {
    let (mut world, map) = setup();
    assert_eq!(
        order(&mut world, &map, json!({"kind": "getOff", "residentId": "p1"})),
        Err("not aboard a carriage".into())
    );
    board(&mut world, &map, "p1").expect("aboard");
    assert_eq!(
        order(&mut world, &map, json!({"kind": "getOff", "residentId": "p1", "x": 5, "y": 2})),
        Err("that tile is not next to the carriage".into())
    );
    assert_eq!(
        order(&mut world, &map, json!({"kind": "getOff", "residentId": "p1", "x": 3})),
        Err("the target must be a tile".into())
    );
}

#[test]
fn count_each_passenger_against_what_the_carriage_holds_shared_with_its_goods() {
    let (mut world, map) = setup();
    let holds = carriage_capacity(&world, &world.carriages[0]);
    assert_eq!(holds, CARRIAGE_CAPACITY);
    board(&mut world, &map, "p1").expect("aboard");
    // Goods leave room for one passenger less than none: p2 can't board.
    world.carriages[0].load =
        [(Good::Food, holds - 2.0 * PASSENGER_WEIGHT + 1.0)].into_iter().collect();
    assert_eq!(board(&mut world, &map, "p2"), Err("the carriage is full".into()));
    world.carriages[0].load = [(Good::Food, holds - 2.0 * PASSENGER_WEIGHT)].into_iter().collect();
    assert_eq!(board(&mut world, &map, "p2"), Ok(()));
}

#[test]
fn fill_a_carriage_with_people_five_behind_an_average_horse_and_no_more() {
    let (mut world, map) = setup();
    for i in 0..6 {
        world.residents.push(resident(&format!("q{i}"), Some("r1"), 2.0, 2.0));
    }
    let replies: Vec<_> = (0..6).map(|i| board(&mut world, &map, &format!("q{i}"))).collect();
    let acks = replies.iter().filter(|r| r.is_ok()).count();
    assert_eq!(acks as f64, (CARRIAGE_CAPACITY / PASSENGER_WEIGHT).floor());
    assert_eq!(replies.last(), Some(&Err("the carriage is full".to_string())));
}

#[test]
fn take_children_aboard_but_not_the_driver_a_rider_or_anyone_off_the_tile_or_of_another_realm() {
    let (mut world, map) = setup();
    who_mut(&mut world, "p1").born_at = world.tick as f64 - 1.0;
    assert_eq!(board(&mut world, &map, "p1"), Ok(()));
    assert_eq!(board(&mut world, &map, "p1"), Err("already aboard that carriage".into()));
    drive(&mut world, &map, 12.0, 5.0).expect("driving");
    assert_eq!(board(&mut world, &map, "w1"), Err("the driver can’t board".into()));
    who_mut(&mut world, "w1").order = None;
    who_mut(&mut world, "p2").riding = Some("h9".into());
    assert_eq!(board(&mut world, &map, "p2"), Err("dismount first to board".into()));
    who_mut(&mut world, "p2").riding = None;
    who_mut(&mut world, "p2").x = 3.0;
    assert_eq!(
        board(&mut world, &map, "p2"),
        Err("that carriage is not on the resident’s tile".into())
    );
    who_mut(&mut world, "p2").x = 2.0;
    world.carriages[0].realm_id = Some("r2".into());
    assert_eq!(board(&mut world, &map, "p2"), Err("not a carriage of your realm".into()));
    world.carriages[0].realm_id = Some("r1".into());
    assert_eq!(
        order(&mut world, &map, json!({"kind": "board", "residentId": "p2", "carriageId": "nope"})),
        Err("no such carriage".into())
    );
}

#[test]
fn get_a_passenger_off_first_when_they_are_given_a_walk_and_then_walk() {
    let (mut world, map) = setup();
    board(&mut world, &map, "p1").expect("aboard");
    assert_eq!(
        order(&mut world, &map, json!({"kind": "walkTo", "residentId": "p1", "x": 2, "y": 9})),
        Ok(())
    );
    assert_eq!(who(&world, "p1").aboard, None);
    // The driver sets off at once; the carriage leaves p1 behind.
    drive(&mut world, &map, 12.0, 2.0).expect("driving");
    until(&mut world, &map, "p1");
    until(&mut world, &map, "w1");
    assert_eq!((who(&world, "p1").x, who(&world, "p1").y), (2.0, 9.0));
    assert_eq!((world.carriages[0].x, world.carriages[0].y), (12.0, 2.0));
}

#[test]
fn stop_what_a_resident_was_doing_when_they_board() {
    let (mut world, map) = setup();
    order(&mut world, &map, json!({"kind": "walkTo", "residentId": "p1", "x": 2, "y": 9}))
        .expect("walking");
    board(&mut world, &map, "p1").expect("aboard");
    assert_eq!(who(&world, "p1").order, None);
    assert_eq!(who(&world, "p1").aboard.as_deref(), Some("k1"));
}

#[test]
fn get_passengers_off_a_carriage_that_is_gone_or_no_longer_of_their_realm() {
    let (mut world, map) = setup();
    let mut scratch = Scratch::default();
    board(&mut world, &map, "p1").expect("aboard");
    board(&mut world, &map, "p2").expect("aboard");
    world.carriages[0].realm_id = Some("r2".into());
    step_world(&mut world, &map, &mut scratch, None, None);
    assert_eq!(who(&world, "p1").aboard, None);
    world.carriages[0].realm_id = Some("r1".into());
    board(&mut world, &map, "p1").expect("aboard");
    world.carriages.clear();
    step_world(&mut world, &map, &mut scratch, None, None);
    assert_eq!([who(&world, "p1").aboard.clone(), who(&world, "p2").aboard.clone()], [None, None]);
}
