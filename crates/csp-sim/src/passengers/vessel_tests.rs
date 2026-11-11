//! Boarding and loading a boat (`CONTEXT.md`: Beside a vessel, Passenger, What vessels carry,
//! T90.3): residents beside a boat board it onto its water tile and get off onto a free land tile
//! beside it; goods go on and off from beside it, up to what it holds with passengers counted.

use csp_shared::balance::{BOAT_CAPACITY, LIFESPAN_MAX, OWN_FOOD, PASSENGER_WEIGHT};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{Good, Stock, Vessel, VesselKind, WorldState};
use serde_json::json;

use crate::game_test_world::Game;
use crate::invariants::{check_invariants, world_invariants};
use crate::movement_test_world::{horse, resident, world_with_realm};
use crate::queries::names::held;
use crate::queries::residents::good_weight;
use crate::queries::vessels::vessel_room;

const SIZE: i32 = 24;

/// Plains, with a Lake over columns 10 to 13.
fn terrain() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 10..=13 {
            tiles[tile_index(SIZE, x, y)] = Terrain::Lake as u8;
        }
    }
    TerrainMap { size: SIZE, tiles }
}

fn boat(id: &str, realm: Option<&str>, x: f64, y: f64) -> Vessel {
    Vessel {
        id: id.into(),
        kind: VesselKind::Boat,
        realm_id: realm.map(str::to_string),
        x,
        y,
        load: Stock::new(),
    }
}

/// Realm r1 (Player 7) with residents w1, p1, p2, p3 on the west shore at (9, 5), each with their
/// own food, and its empty boat v1 on the Lake at (10, 5).
fn game() -> Game {
    let map = terrain();
    let mut world = world_with_realm(&map);
    for id in ["w1", "p1", "p2", "p3"] {
        let mut r = resident(id, Some("r1"), 9.0, 5.0);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
        world.residents.push(r);
    }
    world.vessels.push(boat("v1", Some("r1"), 10.0, 5.0));
    Game::new(world, map)
}

fn board(game: &mut Game, id: &str) -> String {
    game.order(7, json!({"kind": "board", "residentId": id, "vesselId": "v1"}))
}

fn v1(world: &WorldState) -> &Vessel {
    world.vessels.iter().find(|v| v.id == "v1").expect("boat v1")
}

#[test]
fn a_resident_beside_a_boat_boards_it_onto_its_water_tile() {
    let mut game = game();
    assert_eq!(board(&mut game, "p1"), "ack");
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (Some("v1"), 10.0, 5.0));
    game.run(3);
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (Some("v1"), 10.0, 5.0));
}

#[test]
fn boarding_goes_by_carriage_id_too_as_a_script_names_it() {
    let mut game = game();
    let answer = game.order(7, json!({"kind": "board", "residentId": "p1", "carriageId": "v1"}));
    assert_eq!(answer, "ack");
    assert_eq!(game.r("p1").aboard.as_deref(), Some("v1"));
}

#[test]
fn boarding_only_from_beside_it_and_only_a_boat_of_ones_realm() {
    let mut game = game();
    // Diagonally beside it counts.
    game.r_mut("p1").y = 4.0;
    assert_eq!(board(&mut game, "p1"), "ack");
    game.r_mut("p2").x = 8.0;
    assert_eq!(board(&mut game, "p2"), "that boat is not beside the resident");
    game.world.vessels.push(boat("v2", None, 10.0, 6.0));
    let theirs = game.order(7, json!({"kind": "board", "residentId": "p3", "vesselId": "v2"}));
    assert_eq!(theirs, "not a boat of your realm");
}

#[test]
fn passengers_count_against_what_it_holds_so_a_fourth_finds_it_full() {
    let mut game = game();
    let fit = (BOAT_CAPACITY / PASSENGER_WEIGHT).floor() as usize;
    assert_eq!(fit, 3, "three residents and a little cargo");
    for id in ["w1", "p1", "p2"] {
        assert_eq!(board(&mut game, id), "ack");
    }
    assert_eq!(board(&mut game, "p3"), "the boat is full");
    let room = vessel_room(&game.world, v1(&game.world));
    assert!((room - (BOAT_CAPACITY - 3.0 * PASSENGER_WEIGHT)).abs() < 1e-9);
}

#[test]
fn no_horse_goes_aboard() {
    let mut game = game();
    game.world.horses.push(horse("h1", Some("r1"), 9.0, 5.0));
    game.r_mut("p1").riding = Some("h1".into());
    assert_eq!(board(&mut game, "p1"), "no horse goes aboard: dismount first");
    game.run(1);
    assert!(game.world.horses.iter().all(|h| h.x == 9.0 && h.y == 5.0));
}

#[test]
fn a_passenger_gets_off_onto_a_free_land_tile_beside_it() {
    let mut game = game();
    board(&mut game, "p1");
    let off = |x: i32, y: i32| json!({"kind": "getOff", "residentId": "p1", "x": x, "y": y});
    assert_eq!(game.order(7, off(8, 5)), "that tile is not beside the boat");
    assert_eq!(game.order(7, off(11, 5)), "nobody can stand there");
    assert_eq!(game.order(7, off(9, 6)), "ack");
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (None, 9.0, 6.0));
    // Without a tile: the first free one beside it, a straight one.
    board(&mut game, "p1");
    assert_eq!(game.order(7, json!({"kind": "getOff", "residentId": "p1"})), "ack");
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (None, 9.0, 5.0));
    game.run(2);
}

#[test]
fn a_walk_gets_a_passenger_off_first_onto_the_shore_nearest_where_they_go() {
    let mut game = game();
    board(&mut game, "p1");
    assert_eq!(game.order(7, json!({"kind": "walkTo", "residentId": "p1", "x": 3, "y": 1})), "ack");
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (None, 9.0, 4.0));
    until_done(&mut game, "p1");
    let p1 = game.r("p1");
    assert_eq!((p1.x, p1.y), (3.0, 1.0));
}

#[test]
fn a_boat_away_from_every_shore_keeps_its_passengers_aboard() {
    let mut game = game();
    board(&mut game, "p1");
    // Out in the middle of the Lake, as rowing will take it (T90.4).
    game.world.vessels[0].x = 11.0;
    game.r_mut("p1").x = 11.0;
    game.run(1);
    let none = "no shore beside the boat to get off onto";
    assert_eq!(game.order(7, json!({"kind": "getOff", "residentId": "p1"})), none);
    assert_eq!(game.order(7, json!({"kind": "walkTo", "residentId": "p1", "x": 3, "y": 1})), none);
    // Whatever gives them a walk anyway ends it: nobody steps onto water.
    crate::movement_test_world::walk_to(game.r_mut("p1"), 3.0, 1.0);
    game.run(2);
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.order.is_none()), (Some("v1"), 11.0, true));
}

#[test]
fn residents_beside_it_load_it_up_to_what_it_holds_with_passengers_counted() {
    let mut game = game();
    board(&mut game, "p1");
    board(&mut game, "p2");
    // Stone aboard leaves room for only some of the Wood w1 brings from inland.
    let stone = BOAT_CAPACITY - 2.0 * PASSENGER_WEIGHT - 15.0 * good_weight(Good::Wood);
    game.world.vessels[0].load.insert(Good::Stone, stone / good_weight(Good::Stone));
    let w1 = game.r_mut("w1");
    (w1.x, w1.y) = (4.0, 9.0);
    w1.carried.insert(Good::Wood, 20.0);
    let store = json!({"kind": "store", "residentId": "w1", "goods": ["wood"], "to": "v1"});
    assert_eq!(game.order(7, store), "ack");
    until_done(&mut game, "w1");
    let w1 = game.r("w1");
    assert!(w1.order.is_none(), "the store order is done");
    assert_eq!(w1.x, 9.0, "beside the boat, on the shore");
    assert_eq!(held(&v1(&game.world).load, Good::Wood), 15.0);
    assert_eq!(held(&game.r("w1").carried, Good::Wood), 5.0);
    // Someone getting off makes room for more.
    assert_eq!(game.order(7, json!({"kind": "getOff", "residentId": "p2"})), "ack");
    let drop = json!({"kind": "drop", "residentId": "w1", "goods": {"wood": 5},
        "spot": {"kind": "vessel", "vesselId": "v1"}});
    assert_eq!(game.order(7, drop), "ack");
    game.run(1);
    assert_eq!(held(&v1(&game.world).load, Good::Wood), 20.0);
}

#[test]
fn residents_beside_it_take_goods_off() {
    let mut game = game();
    game.world.vessels[0].load.insert(Good::Wood, 5.0);
    let fetch = json!({"kind": "fetch", "residentId": "w1", "goods": {"wood": 3}, "from": "v1"});
    assert_eq!(game.order(7, fetch), "ack");
    game.run(2);
    assert_eq!(held(&game.r("w1").carried, Good::Wood), 3.0);
    assert_eq!(held(&v1(&game.world).load, Good::Wood), 2.0);
    let pick = json!({"kind": "pickUp", "residentId": "w1", "goods": {"wood": 2},
        "spot": {"kind": "vessel", "vesselId": "v1"}});
    game.r_mut("w1").x = 8.0;
    assert_eq!(game.order(7, pick.clone()), "that boat is not beside the resident");
    game.r_mut("w1").x = 9.0;
    assert_eq!(game.order(7, pick), "ack");
    game.run(1);
    assert!(v1(&game.world).load.is_empty());
}

#[test]
fn down_or_dead_aboard_they_stay_in_the_boat_with_what_they_carried() {
    let mut game = game();
    board(&mut game, "p1");
    let i = game.world.residents.iter().position(|r| r.id == "p1").expect("p1");
    crate::survival::go_down(&mut game.world, i);
    game.run(1);
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.down_until.is_some()), (Some("v1"), 10.0, true));
    crate::survival::die(&mut game.world, "p1");
    assert_eq!(held(&v1(&game.world).load, Good::Food), OWN_FOOD);
    assert!(game.world.piles.is_empty(), "nothing drops into the water");
    game.run(1);
}

#[test]
fn the_invariant_holds_nobody_aboard_on_land_and_nobody_else_on_water() {
    let mut game = game();
    board(&mut game, "p1");
    let none: Vec<crate::sight::InvariantViolation> = Vec::new();
    assert_eq!(check_invariants(&game.world, &game.terrain, &world_invariants()), none);
    // Aboard but standing on the shore.
    game.r_mut("p1").x = 9.0;
    let names: Vec<String> = check_invariants(&game.world, &game.terrain, &world_invariants())
        .into_iter()
        .map(|v| v.invariant)
        .collect();
    assert!(names.contains(&"vessel-passengers".to_string()), "{names:?}");
    // On the water but aboard nothing.
    let p1 = game.r_mut("p1");
    (p1.x, p1.aboard) = (11.0, None);
    let names: Vec<String> = check_invariants(&game.world, &game.terrain, &world_invariants())
        .into_iter()
        .map(|v| v.invariant)
        .collect();
    assert!(names.contains(&"nothing-on-impassable-terrain".to_string()), "{names:?}");
    // Too much aboard.
    let p1 = game.r_mut("p1");
    (p1.x, p1.aboard) = (10.0, Some("v1".into()));
    game.world.vessels[0].load.insert(Good::Stone, 200.0);
    let names: Vec<String> = check_invariants(&game.world, &game.terrain, &world_invariants())
        .into_iter()
        .map(|v| v.invariant)
        .collect();
    assert!(names.contains(&"vessel-passengers".to_string()), "{names:?}");
}

/// Ticks until resident `id`'s order is done, at most 600 ticks.
fn until_done(game: &mut Game, id: &str) {
    for _ in 0..600 {
        if game.r(id).order.is_none() {
            return;
        }
        game.tick();
    }
    panic!("{id}'s order is still not done");
}
