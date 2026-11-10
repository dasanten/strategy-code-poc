//! `apps/server/src/horses-down.test.ts`, ported (T86.17): horses going Down (`CONTEXT.md`: Down,
//! Reviving, Horses have no inventory).

mod build_common;

use build_common::*;
use csp_shared::balance::{AVERAGE_HORSE_STATS, HORSE_WAKE_HEALTH, MAX_HEALTH, MAX_HUNGER};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Carriage, Horse, HorseStats, RealmEventWhat, ResidentOrder, WorldState};
use csp_sim::events::events_for;
use csp_sim::horses::{horses_down_lie_still, HORSE_DOWN_TICKS};
use csp_sim::queries::residents::is_down;
use csp_sim::sight::entities_in_sight;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use csp_sim::world_index::WorldIndex;
use serde_json::{json, Value};
use std::sync::Arc;

const SIZE: i32 = 32;

/// A world with realm r1 (Player 7, Leader w1 at (2, 2), carrying Food) and its horse Rowan, h1,
/// on the same tile, and realm r2 (Player 8, Leader b1) next to them.
fn setup() -> (WorldState, TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    let w1 = resident(&mut world, "w1", 2.0, 2.0);
    world.residents[w1].carried = serde_json::from_value(json!({ "food": 5 })).unwrap();
    world.residents.push(new_resident("b1", Some("r2"), 3.0, 2.0));
    world.horses.push(Horse {
        id: "h1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 2.0,
        y: 2.0,
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
    (world, terrain)
}

/// Starves a horse to its last bit of health, with nothing in reach.
fn starving(world: &mut WorldState) {
    world.horses[0].hunger = 0.0;
    world.horses[0].health = 0.0001;
}

/// Steps the world `ticks` times, residents kept fed, checking every invariant after each.
fn run(world: &mut WorldState, terrain: &TerrainMap, ticks: usize, mut walking: Option<&mut Walking>) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        step_world(world, terrain, &mut scratch, walking.as_deref_mut().map(|w| w as _), None);
        assert_sound(world, terrain);
    }
}

/// Sends an order of the Player's and applies it, as the next tick would; the reason when it was
/// refused.
fn order(world: &mut WorldState, terrain: &TerrainMap, o: Value) -> Result<(), String> {
    let mut orders = Orders::default();
    let answer = orders.receive(world, &player(7), o, terrain);
    orders.apply_all(world, terrain);
    answer
}

fn horse_down(world: &WorldState) -> bool {
    is_down(world.horses[0].down_until)
}

fn w1(world: &mut WorldState) -> &mut csp_shared::world::Resident {
    at(world, "w1")
}

fn drive_order() -> Value {
    json!({ "kind": "drive", "residentId": "w1", "carriageId": "k1", "x": 20, "y": 2 })
}

#[test]
fn puts_a_starving_horse_down_instead_of_killing_it_and_logs_it() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    assert_eq!(world.horses.len(), 1);
    assert!(horse_down(&world));
    assert_eq!(world.horses[0].health, 0.0);
    assert_eq!(world.horses[0].down_until, Some(world.tick as f64 - 1.0 + HORSE_DOWN_TICKS));
    let until = world.horses[0].down_until.unwrap();
    assert!(events_for(&world, 7, 0).iter().any(|e| e.what
        == RealmEventWhat::HorseDown { horse_id: "h1".into(), name: "Rowan".into(), until }));
    // Down, it loses nothing more while it waits.
    run(&mut world, &terrain, 100, None);
    assert_eq!([world.horses[0].hunger, world.horses[0].health], [0.0, 0.0]);
}

#[test]
fn wakes_at_low_health_once_food_is_put_down_by_it() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 10, None);
    assert!(horse_down(&world));
    // Food in the rider's hands is out of reach (`CONTEXT.md`: Horses have no inventory).
    assert_eq!(w1(&mut world).carried.get(&csp_shared::world::Good::Food).copied(), Some(5.0));
    let reply = order(
        &mut world,
        &terrain,
        json!({ "kind": "drop", "residentId": "w1", "spot": { "kind": "ground" }, "goods": { "food": 2 } }),
    );
    assert_eq!(reply, Ok(()));
    // Put down in one tick, eaten in the next.
    run(&mut world, &terrain, 2, None);
    assert!(!horse_down(&world));
    assert_eq!(world.horses[0].health, HORSE_WAKE_HEALTH);
    assert!(world.horses[0].hunger > 0.0);
    assert_eq!(w1(&mut world).carried.get(&csp_shared::world::Good::Food).copied(), Some(3.0));
    // It eats what it needs of the rest and heals from there.
    run(&mut world, &terrain, 100, None);
    assert!(world.horses[0].health > HORSE_WAKE_HEALTH);
}

#[test]
fn wakes_from_food_on_a_tile_next_to_it_too() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    world
        .piles
        .push(serde_json::from_value(json!({ "id": "p1", "x": 3, "y": 3, "goods": { "food": 1 } })).unwrap());
    run(&mut world, &terrain, 1, None);
    assert!(!horse_down(&world));
    assert!(world.piles.is_empty());
}

#[test]
fn dies_of_hunger_when_its_time_is_up_and_nobody_fed_it() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    world.tick = (world.horses[0].down_until.unwrap() - 1.0) as _;
    run(&mut world, &terrain, 1, None);
    assert_eq!(world.horses.len(), 1);
    run(&mut world, &terrain, 1, None);
    assert!(world.horses.is_empty());
    assert!(events_for(&world, 7, 0).iter().any(|e| e.what
        == RealmEventWhat::HorseDied { horse_id: "h1".into(), name: Some("Rowan".into()) }));
}

#[test]
fn puts_its_rider_on_foot_and_cant_be_mounted() {
    let (mut world, terrain) = setup();
    let mount = json!({ "kind": "mount", "residentId": "w1", "horseId": "h1" });
    assert_eq!(order(&mut world, &terrain, mount.clone()), Ok(()));
    assert_eq!(w1(&mut world).riding.as_deref(), Some("h1"));
    // The rider carries no Food to spare for it (`OWN_FOOD`).
    w1(&mut world).carried.clear();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    assert!(horse_down(&world));
    assert_eq!(w1(&mut world).riding, None);
    assert_eq!(order(&mut world, &terrain, mount), Err("that horse is Down".into()));
    // The rider walks on alone; the horse stays where it lies.
    w1(&mut world).order = Some(
        serde_json::from_value::<ResidentOrder>(
            json!({ "kind": "walkTo", "target": { "x": 8, "y": 2 }, "path": null, "progress": 0 }),
        )
        .unwrap(),
    );
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    run(&mut world, &terrain, 600, Some(&mut walking));
    assert_eq!([w1(&mut world).x, world.horses[0].x], [8.0, 2.0]);
}

#[test]
fn leaves_its_carriage_standing_and_the_carriage_cant_be_driven() {
    let (mut world, terrain) = setup();
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 2.0,
        y: 2.0,
        horse_id: Some("h1".into()),
        load: Default::default(),
    });
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    assert_eq!(order(&mut world, &terrain, drive_order()), Ok(()));
    run(&mut world, &terrain, 30, Some(&mut walking));
    assert!(world.carriages[0].x > 2.0);
    let stands = world.carriages[0].x;
    starving(&mut world);
    run(&mut world, &terrain, 1, Some(&mut walking));
    assert!(horse_down(&world));
    assert!(w1(&mut world).order.is_none());
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
    run(&mut world, &terrain, 100, Some(&mut walking));
    assert_eq!([world.carriages[0].x, world.horses[0].x], [stands, stands]);
    assert_eq!(order(&mut world, &terrain, drive_order()), Err("its horse is Down".into()));
    // A drive the game gives anyway goes nowhere.
    w1(&mut world).order = Some(
        serde_json::from_value::<ResidentOrder>(json!({
            "kind": "drive", "carriageId": "k1", "target": { "x": 20, "y": 2 },
            "path": null, "progress": 0
        }))
        .unwrap(),
    );
    run(&mut world, &terrain, 30, Some(&mut walking));
    assert_eq!(world.carriages[0].x, stands);
    assert!(w1(&mut world).order.is_none());
}

#[test]
fn is_seen_down_by_anyone_in_sight_how_long_it_has_left_only_by_its_own_realm() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    let index = WorldIndex::new(&world, SIZE);
    let seen = |realm: &str| {
        entities_in_sight(&world, &index, Some(realm), None)
            .iter()
            .find_map(|e| match e {
                SeenEntity::Horse(h) if h.id == "h1" => Some(h.clone()),
                _ => None,
            })
            .expect("h1 in sight")
    };
    let own = seen("r1");
    assert_eq!(own.down, Some(true));
    assert_eq!(own.down_until, world.horses[0].down_until);
    let theirs = seen("r2");
    assert_eq!(theirs.down, Some(true));
    assert_eq!(theirs.down_until, None);
    assert_eq!(theirs.health, None);
}

#[test]
fn has_an_invariant_a_down_horse_is_neither_ridden_nor_pulling_a_driven_carriage() {
    let (mut world, terrain) = setup();
    starving(&mut world);
    run(&mut world, &terrain, 1, None);
    let found = |world: &WorldState| -> Vec<String> {
        horses_down_lie_still(world).into_iter().map(|v| v.message).collect()
    };
    assert_eq!(found(&world), Vec::<String>::new());
    w1(&mut world).riding = Some("h1".into());
    assert_eq!(found(&world), vec!["horse h1 is Down but is ridden".to_string()]);
    w1(&mut world).riding = None;
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 2.0,
        y: 2.0,
        horse_id: Some("h1".into()),
        load: Default::default(),
    });
    w1(&mut world).order = Some(
        serde_json::from_value::<ResidentOrder>(json!({
            "kind": "drive", "carriageId": "k1", "target": { "x": 9, "y": 2 },
            "path": null, "progress": 0
        }))
        .unwrap(),
    );
    assert_eq!(
        found(&world),
        vec!["horse h1 is Down but pulls carriage k1, which is driven".to_string()]
    );
}
