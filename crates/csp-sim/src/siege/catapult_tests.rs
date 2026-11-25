//! The catapult (T110.3, `CONTEXT.md`: Catapult, Walls in combat): crewed, it throws one Stone a
//! shot, every `CATAPULT_SHOT_TICKS`, at a wall, gate or tower of another realm within
//! `CATAPULT_REACH`, `CATAPULT_BLOW` a shot, from beyond a wall archer's reach. The Stone comes
//! from what its crew carry or what lies on its tile; out of Stone it stops. It hits buildings
//! only. Its crew stands in the open.

use csp_shared::balance::{
    BUILD_MATERIALS, CATAPULT_BLOW, CATAPULT_REACH, CATAPULT_SHOT_TICKS, LIFESPAN_MAX, OWN_FOOD,
    SHOT_REACH, STONE_WALL_STRENGTH, WALL_SHOT_REACH_BONUS,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CrimeKind, Good, Pile, ResidentOrder, SiegeMachine, SiegeMachineKind,
    Stock, ThrowOrder, UpSide, WallMaterial, WorldState,
};
use serde_json::json;

use super::*;
use crate::game_test_world::{player, run_script, Game};
use crate::movement_test_world::{add_city, building, draw, realm, resident, world_with_realm};
use crate::queries::combat::{shot_reach, tiles_apart};

/// Plains 40 tiles wide.
fn map() -> TerrainMap {
    let rows: Vec<String> = (0..40).map(|_| ".".repeat(40)).collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

const CREW: [&str; 3] = ["w1", "c2", "c3"];
/// The catapult's tile, 18 tiles west of r2's wall.
const AT: (f64, f64) = (4.0, 4.0);

/// Realm r1 (Player 7) with its crewed catapult m1 at (4, 4), its crew on it with no Stone; realm
/// r2 (Player 8) with city c2 (town hall at (30, 4)) and its stone wall of three tiles (22, 3) to
/// (22, 5), the middle one a gate, and its archer d1 up on the wall at (22, 5) with a Bow. Everyone
/// is grown and fed.
fn world() -> WorldState {
    let mut world = world_with_realm(&map());
    world.realms.push(realm("r2", 8, "d1"));
    add_city(&mut world, "c2", Some("r2"), 30.0, 4.0);
    for (id, y, kind) in [
        ("w-3", 3.0, BuildingKind::Wall),
        ("g-4", 4.0, BuildingKind::Gate),
        ("w-5", 5.0, BuildingKind::Wall),
    ] {
        let mut b = building(id, kind, 22.0, y);
        b.city_id = Some("c2".into());
        b.material = Some(WallMaterial::Stone);
        world.buildings.push(b);
    }
    for id in CREW {
        world.residents.push(resident(id, Some("r1"), AT.0, AT.1));
    }
    let mut d1 = resident("d1", Some("r2"), 22.0, 5.0);
    d1.up = Some(UpSide::Inside);
    world.residents.push(d1);
    for r in &mut world.residents {
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
    }
    let d1 = world.residents.iter_mut().find(|r| r.id == "d1").expect("d1");
    d1.carried.extend([(Good::Bow, 1.0), (Good::Arrows, 40.0)]);
    world.siege_machines.push(SiegeMachine {
        id: "m1".into(),
        kind: SiegeMachineKind::Catapult,
        realm_id: Some("r1".into()),
        x: AT.0,
        y: AT.1,
        damage: None,
        teardown: None,
        crew_ids: CREW.iter().map(|s| s.to_string()).collect(),
    });
    world
}

/// Gives each of the crew `each` Stone.
fn stone(world: &mut WorldState, each: f64) {
    for r in world.residents.iter_mut().filter(|r| CREW.contains(&r.id.as_str())) {
        r.carried.insert(Good::Stone, each);
    }
}

fn throw(game: &mut Game, by: &str, target: &str) -> String {
    game.order(7, json!({"kind": "throw", "residentId": by, "machineId": "m1", "targetId": target}))
}

fn wall<'w>(game: &'w Game, id: &str) -> Option<&'w Building> {
    game.world.buildings.iter().find(|b| b.id == id)
}

fn stone_left(game: &Game) -> f64 {
    stone_at_hand(&game.world, &game.world.siege_machines[0])
}

#[test]
fn a_crewed_catapult_breaks_a_stone_wall_from_beyond_a_wall_archers_reach() {
    let mut world = world();
    let shots = (STONE_WALL_STRENGTH.wall / CATAPULT_BLOW).ceil();
    stone(&mut world, shots); // Three times what it takes.
    let mut game = Game::new(world, map());
    game.tick();
    // The archer up on the wall shoots no further than a Bow from a wall; the catapult is out there.
    let bow = SHOT_REACH.get("bow").expect("a bow's reach");
    assert_eq!(shot_reach(&game.world, game.r("d1")), Some(bow + WALL_SHOT_REACH_BONUS));
    let apart = tiles_apart(40, (4, 4), (22, 5));
    assert!(apart > bow + WALL_SHOT_REACH_BONUS && apart <= CATAPULT_REACH);
    let shoot = json!({"kind": "attack", "residentId": "d1", "targetId": "c2", "shoot": true});
    assert_ne!(game.order(8, shoot), "ack", "the crew is out of the archer's reach");
    assert_eq!(throw(&mut game, "w1", "w-3"), "ack");
    let mut ticks = 0;
    while wall(&game, "w-3").is_some() {
        assert!(ticks < 2000, "w-3 still stands after {ticks} ticks");
        game.tick();
        ticks += 1;
    }
    let want = shots * CATAPULT_SHOT_TICKS;
    assert!((ticks as f64 - want).abs() <= 2.0, "{ticks} ticks, {want} wanted");
    // One Stone a shot, and the order ends with the wall; breaking r2's wall is a crime of
    // tearing down.
    assert_eq!(stone_left(&game), 3.0 * shots - shots);
    assert!(game.r("w1").order.is_none());
    assert!(game.world.crimes.iter().any(|c| c.kind == CrimeKind::TearDown));
    // Nobody of the crew was hurt by the archer.
    assert!(CREW.iter().all(|id| game.r(id).struck.is_none()));
}

#[test]
fn each_shot_takes_a_stone_from_its_crew_then_its_tile_and_with_none_it_stops() {
    let mut world = world();
    world.residents[0].carried.insert(Good::Stone, 2.0);
    world.piles.push(Pile {
        id: "p1".into(),
        x: AT.0,
        y: AT.1,
        goods: [(Good::Stone, 1.0), (Good::Wood, 2.0)].into_iter().collect(),
    });
    let mut game = Game::new(world, map());
    assert_eq!(throw(&mut game, "w1", "g-4"), "ack");
    game.run(2 * CATAPULT_SHOT_TICKS as usize);
    assert_eq!(game.r("w1").carried.get(&Good::Stone), None, "the crew's two thrown first");
    assert_eq!(stone_left(&game), 1.0, "the pile's one is left");
    game.run(CATAPULT_SHOT_TICKS as usize);
    assert_eq!(stone_left(&game), 0.0);
    let damage = wall(&game, "g-4").and_then(|b| b.damage);
    assert_eq!(damage, Some(3.0 * CATAPULT_BLOW));
    assert!(game.r("w1").order.is_none(), "out of Stone it stops");
    assert!(game.world.piles.iter().any(|p| p.goods.get(&Good::Wood) == Some(&2.0)));
    game.run(CATAPULT_SHOT_TICKS as usize);
    assert_eq!(wall(&game, "g-4").and_then(|b| b.damage), damage);
    assert_eq!(throw(&mut game, "w1", "g-4"), "the catapult has no Stone to throw");
}

#[test]
fn it_hits_the_building_only_never_anyone_on_it_or_by_it() {
    let mut world = world();
    stone(&mut world, 2.0);
    // d1 up on the gate it aims at, and another of r2's on the ground right by it.
    let d1 = world.residents.iter_mut().find(|r| r.id == "d1").expect("d1");
    d1.y = 4.0;
    let mut d2 = resident("d2", Some("r2"), 21.0, 4.0);
    d2.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
    d2.lifespan = LIFESPAN_MAX;
    world.residents.push(d2);
    let mut game = Game::new(world, map());
    let health = |g: &Game| (g.r("d1").health, g.r("d2").health);
    let before = health(&game);
    assert_eq!(throw(&mut game, "w1", "g-4"), "ack");
    game.run(6 * CATAPULT_SHOT_TICKS as usize);
    assert_eq!(wall(&game, "g-4").and_then(|b| b.damage), Some(6.0 * CATAPULT_BLOW));
    assert_eq!(health(&game), before);
    assert!(game.r("d1").struck.is_none() && game.r("d2").struck.is_none());
}

#[test]
fn its_crew_in_the_open_can_be_shot_and_struck() {
    let mut game = Game::new(world(), map());
    // d1 down from the wall and out within a Bow's reach of the catapult.
    let d1 = game.r_mut("d1");
    (d1.x, d1.y, d1.up) = (10.0, 4.0, None);
    game.tick();
    let shoot = json!({"kind": "attack", "residentId": "d1", "targetId": "c2", "shoot": true});
    assert_eq!(game.order(8, shoot), "ack");
    assert!(game.until_hit("c2", 40).is_some(), "c2 is shot");
    // Up on a wall next to it they'd strike down at it too: nothing roofs a catapult's crew.
    assert!(!under_roof(&game.world, game.r("c3")));
}

#[test]
fn it_takes_its_whole_crew_a_stone_and_a_foreign_wall_in_its_reach() {
    let mut world = world();
    stone(&mut world, 1.0);
    let mut game = Game::new(world, map());
    game.world.siege_machines[0].crew_ids.pop();
    assert_eq!(throw(&mut game, "w1", "g-4"), "the catapult needs 1 more crew to shoot");
    game.world.siege_machines[0].crew_ids = CREW.iter().map(|s| s.to_string()).collect();
    assert_eq!(throw(&mut game, "d1", "g-4"), "not one of your residents");
    assert_eq!(throw(&mut game, "w1", "nothing"), "no such wall or gate");
    // Too far.
    let far = json!({"kind": "throw", "residentId": "w1", "machineId": "m1", "targetId": "g-4"});
    game.world.siege_machines[0].x = 1.0;
    for id in CREW {
        game.r_mut(id).x = 1.0;
    }
    assert_eq!(game.order(7, far), "that is beyond the catapult’s reach");
    // Its own realm's wall isn't shot at.
    let mut own = building("own", BuildingKind::Wall, 8.0, 4.0);
    add_city(&mut game.world, "c1", Some("r1"), 2.0, 12.0);
    own.city_id = Some("c1".into());
    game.world.buildings.push(own);
    assert_eq!(throw(&mut game, "w1", "own"), "that is one of your own walls");
    // A ram doesn't throw.
    game.world.siege_machines[0].kind = SiegeMachineKind::Ram;
    assert_eq!(throw(&mut game, "w1", "g-4"), "a ram doesn’t throw");
}

#[test]
fn it_is_aimed_at_a_tile_of_the_wall_too() {
    let mut world = world();
    stone(&mut world, 1.0);
    let mut game = Game::new(world, map());
    let at = json!({"kind": "throw", "residentId": "w1", "machineId": "m1", "x": 22, "y": 3});
    assert_eq!(game.order(7, at), "ack");
    let Some(ResidentOrder::Throw(o)) = &game.r("w1").order else { panic!("a throw order") };
    assert_eq!(o.target_id, "w-3");
}

#[test]
fn scripts_throw_as_the_order_does() {
    let mut world = world();
    stone(&mut world, 1.0);
    for (source, at) in [
        ("throw(machines()[0], \"g-4\")", json!({"targetId": "g-4"})),
        ("throw(machines()[0], 22, 3)", json!({"x": 22, "y": 3})),
    ] {
        let script = format!("memory.answer = {source}");
        let (answer, requests) = run_script(&world, &map(), &player(7), "w1", &script);
        assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
        let mut want = json!({ "kind": "throw", "residentId": "w1", "machineId": "m1" });
        want.as_object_mut().unwrap().extend(at.as_object().unwrap().clone());
        assert_eq!(serde_json::to_value(&requests).unwrap(), json!([want]));
    }
}

#[test]
fn is_a_buildable_site_of_wood_iron_and_stone_that_becomes_a_catapult() {
    assert!(crate::queries::building::BUILDABLE.contains(&BuildingKind::Catapult));
    let materials = BUILD_MATERIALS.get("catapult").expect("its materials");
    for good in ["wood", "iron", "stone"] {
        assert!(materials.get(good).is_some_and(|n| n > 0.0), "{good}");
    }
    assert_eq!(
        SiegeMachineKind::built_as(BuildingKind::Catapult),
        Some(SiegeMachineKind::Catapult)
    );
    assert_eq!(SiegeMachineKind::Catapult.spec().built_as, BuildingKind::Catapult);
    let built: Stock = machine_materials(SiegeMachineKind::Catapult);
    assert!(built.get(&Good::Stone).is_some_and(|n| *n > 0.0));
}

#[test]
fn the_invariant_catches_a_throw_order_that_no_longer_holds() {
    let mut world = world();
    stone(&mut world, 1.0);
    world.residents[0].order = Some(ResidentOrder::Throw(ThrowOrder {
        machine_id: "m1".into(),
        target_id: "g-4".into(),
        progress: 0.0,
    }));
    let broken = |w: &WorldState| {
        crate::invariants::check_all(w, &map())
            .into_iter()
            .filter(|v| v.invariant == "siege-machines-in-place")
            .map(|v| v.message)
            .collect::<Vec<_>>()
    };
    assert!(broken(&world).is_empty());
    stone(&mut world, 0.0);
    assert_eq!(
        broken(&world),
        ["resident w1 throws at g-4 with m1, but the catapult has no Stone to throw"]
    );
}
