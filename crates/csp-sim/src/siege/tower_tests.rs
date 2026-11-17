//! Siege machines against towers (Epics 109 and 110 together, `CONTEXT.md`: Tower, Ram,
//! Catapult): a catapult throws at a tower from beyond the reach of an archer up on it, and those
//! up on it fall when it breaks; a ram strikes a tower from beside any of its tiles.

use csp_shared::balance::{
    CATAPULT_BLOW, CATAPULT_REACH, CATAPULT_SHOT_TICKS, LIFESPAN_MAX, OWN_FOOD, SHOT_REACH,
    STONE_WALL_STRENGTH, TOWER_SHOT_REACH_BONUS,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, Good, SiegeMachine, SiegeMachineKind, UpSide, WallMaterial, WorldState,
};
use serde_json::json;

use crate::game_test_world::Game;
use crate::movement_test_world::{add_city, building, draw, realm, resident, world_with_realm};
use crate::queries::combat::shot_reach;

/// Plains 40 tiles wide.
fn map() -> TerrainMap {
    let rows: Vec<String> = (0..40).map(|_| ".".repeat(40)).collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

const CREW: [&str; 4] = ["w1", "c2", "c3", "c4"];

/// Realm r1 (Player 7) with its crewed machine m1 of `kind` at `at`, its crew on it carrying
/// Stone; realm r2 (Player 8) with city c2 (town hall at (30, 4)) and its stone tower t1 covering
/// (22, 4) to (23, 5), its archer d1 up on it at (22, 4) with a Bow.
fn world(kind: SiegeMachineKind, at: (f64, f64)) -> WorldState {
    let mut world = world_with_realm(&map());
    world.realms.push(realm("r2", 8, "d1"));
    add_city(&mut world, "c2", Some("r2"), 30.0, 4.0);
    let mut t = building("t1", BuildingKind::Tower, 22.0, 4.0);
    t.city_id = Some("c2".into());
    t.material = Some(WallMaterial::Stone);
    world.buildings.push(t);
    for id in CREW {
        world.residents.push(resident(id, Some("r1"), at.0, at.1));
    }
    let mut d1 = resident("d1", Some("r2"), 22.0, 4.0);
    d1.up = Some(UpSide::Inside);
    world.residents.push(d1);
    for r in &mut world.residents {
        r.carried = [(Good::Food, OWN_FOOD), (Good::Stone, 20.0)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
    }
    let d1 = world.residents.iter_mut().find(|r| r.id == "d1").expect("d1");
    d1.carried =
        [(Good::Food, OWN_FOOD), (Good::Bow, 1.0), (Good::Arrows, 40.0)].into_iter().collect();
    world.siege_machines.push(SiegeMachine {
        id: "m1".into(),
        kind,
        realm_id: Some("r1".into()),
        x: at.0,
        y: at.1,
        damage: None,
        teardown: None,
        crew_ids: CREW.iter().map(|s| s.to_string()).collect(),
    });
    world
}

#[test]
fn a_catapult_breaks_a_tower_from_beyond_its_archers_reach_and_those_up_on_it_fall() {
    let mut game = Game::new(world(SiegeMachineKind::Catapult, (4.0, 4.0)), map());
    game.tick();
    let bow = SHOT_REACH.get("bow").expect("a bow's reach");
    assert_eq!(shot_reach(&game.world, game.r("d1")), Some(bow + TOWER_SHOT_REACH_BONUS));
    assert!(18.0 > bow + TOWER_SHOT_REACH_BONUS && 18.0 <= CATAPULT_REACH);
    let shoot = json!({"kind": "attack", "residentId": "d1", "targetId": "c2", "shoot": true});
    assert_ne!(game.order(8, shoot), "ack", "the crew is out of the tower archer's reach");
    // Aimed at a tile of the tower other than its north-west one.
    let at = json!({"kind": "throw", "residentId": "w1", "machineId": "m1", "x": 23, "y": 5});
    assert_eq!(game.order(7, at), "ack");
    let shots = (STONE_WALL_STRENGTH.tower / CATAPULT_BLOW).ceil();
    let mut ticks = 0;
    while game.world.buildings.iter().any(|b| b.id == "t1") {
        assert!(ticks < 5000, "the tower still stands after {ticks} ticks");
        game.tick();
        ticks += 1;
    }
    let want = shots * CATAPULT_SHOT_TICKS;
    assert!((ticks as f64 - want).abs() <= 2.0, "{ticks} ticks, {want} wanted");
    // d1 was up on it and fell: down on the ground now, hurt, or dead.
    let d1 = game.world.residents.iter().find(|r| r.id == "d1");
    assert!(d1.is_none_or(|d| d.up.is_none() && d.health < 100.0), "{d1:?}");
}

#[test]
fn a_ram_strikes_a_tower_from_beside_any_tile_of_it() {
    // Beside its south-east tile (23, 5), not its north-west one.
    let mut game = Game::new(world(SiegeMachineKind::Ram, (24.0, 6.0)), map());
    let ram = json!({"kind": "ram", "residentId": "w1", "machineId": "m1", "targetId": "t1"});
    assert_eq!(game.order(7, ram), "ack");
    game.run(25);
    let t1 = game.world.buildings.iter().find(|b| b.id == "t1").expect("the tower");
    assert!(t1.damage.is_some_and(|d| d > 0.0), "struck");
}
