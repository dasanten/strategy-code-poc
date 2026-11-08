//! `apps/server/src/riding.test.ts`. `walkOut`'s `checkInvariants` after every tick and "the
//! riders-on-horses invariant" come with T86.13.

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{HORSE_HUNGRY_SHARE, HUNGRY_HORSE_PACE, MAX_HUNGER};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{SkillName, WorldState};
use serde_json::json;

use crate::movement_test_world::{
    carriage, draw, horse, order, resident, walk_out, walk_to, world_with_realm,
};
use crate::queries::pace::{drive_speed, ride_speed, walk_speed};
use crate::tick::Scratch;
use crate::walk_time::walk_time;
use crate::walking::Walking;
use crate::world::step_world;

fn open() -> TerrainMap {
    draw(&[".".repeat(24).as_str(); 24])
}

/// A world on `map` with realm r1 (Player 7, Leader w1) and, at (2, 2), w1 and horse h1 of r1.
fn setup(map: &TerrainMap) -> WorldState {
    let mut world = world_with_realm(map);
    world.residents.push(resident("w1", Some("r1"), 2.0, 2.0));
    world.horses.push(horse("h1", Some("r1"), 2.0, 2.0));
    world
}

fn out(world: &mut WorldState, map: &TerrainMap) -> u32 {
    walk_out(world, map, &mut Walking::new(Arc::new(map.clone())), "w1", 5000)
}

fn at(world: &WorldState) -> [f64; 4] {
    let (r, h) = (&world.residents[0], &world.horses[0]);
    [r.x, r.y, h.x, h.y]
}

#[test]
fn mount_a_horse_of_the_realm_on_the_residents_tile_and_leave_it_there_on_dismounting() {
    let map = open();
    let mut world = setup(&map);
    assert_eq!(
        order(&mut world, &map, json!({"kind": "mount", "residentId": "w1", "horseId": "h1"})),
        Ok(())
    );
    assert_eq!(world.residents[0].riding.as_deref(), Some("h1"));
    walk_to(&mut world.residents[0], 8.0, 2.0);
    out(&mut world, &map);
    assert_eq!(at(&world), [8.0, 2.0, 8.0, 2.0]);
    assert_eq!(order(&mut world, &map, json!({"kind": "dismount", "residentId": "w1"})), Ok(()));
    assert_eq!(world.residents[0].riding, None);
    walk_to(&mut world.residents[0], 10.0, 2.0);
    out(&mut world, &map);
    assert_eq!([world.residents[0].x, world.horses[0].x], [10.0, 8.0]);
}

#[test]
fn turn_down_a_horse_elsewhere_hitched_or_ridden_by_someone_else() {
    let map = open();
    let mut world = setup(&map);
    let mount = |world: &mut WorldState| {
        order(world, &map, json!({"kind": "mount", "residentId": "w1", "horseId": "h1"}))
    };
    assert_eq!(
        order(&mut world, &map, json!({"kind": "dismount", "residentId": "w1"})),
        Err("not riding".into())
    );
    assert_eq!(
        order(&mut world, &map, json!({"kind": "mount", "residentId": "w1", "horseId": "nope"})),
        Err("no such horse".into())
    );
    world.horses[0].x = 3.0;
    assert_eq!(mount(&mut world), Err("that horse is not on the resident’s tile".into()));
    world.horses[0].x = 2.0;
    world.carriages.push(carriage("k1", Some("r1"), 2.0, 2.0, Some("h1")));
    assert_eq!(mount(&mut world), Err("that horse is hitched to a carriage".into()));
    world.carriages.clear();
    let mut w2 = resident("w2", Some("r1"), 2.0, 2.0);
    w2.riding = Some("h1".into());
    world.residents.push(w2);
    assert_eq!(mount(&mut world), Err("someone else rides that horse".into()));
    assert_eq!(world.residents[0].riding, None);
}

#[test]
fn keep_a_ridden_horse_from_being_hitched_and_a_rider_from_driving() {
    let map = open();
    let mut world = setup(&map);
    world.carriages.push(carriage("k1", Some("r1"), 2.0, 2.0, None));
    order(&mut world, &map, json!({"kind": "mount", "residentId": "w1", "horseId": "h1"}))
        .expect("mounted");
    assert_eq!(world.residents[0].riding.as_deref(), Some("h1"));
    let drive =
        |id: &str| json!({"kind": "drive", "residentId": id, "carriageId": "k1", "x": 8, "y": 2});
    assert_eq!(order(&mut world, &map, drive("w1")), Err("dismount first to drive".into()));
    world.residents.push(resident("w2", Some("r1"), 2.0, 2.0));
    assert_eq!(
        order(&mut world, &map, drive("w2")),
        Err("no horse here to pull that carriage".into())
    );
    assert_eq!(world.carriages[0].horse_id, None);
}

#[test]
fn crosses_plains_faster_than_walking_at_the_horses_carriage_pace() {
    let map = open();
    let mut walker = setup(&map);
    walk_to(&mut walker.residents[0], 14.0, 2.0);
    let on_foot = out(&mut walker, &map);
    let mut rider = setup(&map);
    rider.residents[0].riding = Some("h1".into());
    walk_to(&mut rider.residents[0], 14.0, 2.0);
    let riding = out(&mut rider, &map);
    assert_eq!([rider.residents[0].x, rider.horses[0].x], [14.0, 14.0]);
    assert!(f64::from(riding) < f64::from(on_foot) * 0.6);
    let (r, h, plains) = (&rider.residents[0], &rider.horses[0], Terrain::Plains as u8);
    assert!((ride_speed(r, h, plains) - drive_speed(r, &h.stats, plains)).abs() < 0.005);
    assert!(ride_speed(r, h, plains) > walk_speed(r, plains, 0.0));
}

#[test]
fn goes_slower_on_a_hungry_horse() {
    let mut world = setup(&open());
    let plains = Terrain::Plains as u8;
    let fed = ride_speed(&world.residents[0], &world.horses[0], plains);
    world.horses[0].hunger = HORSE_HUNGRY_SHARE * MAX_HUNGER - 1.0;
    let hungry = ride_speed(&world.residents[0], &world.horses[0], plains);
    assert!((hungry - fed * HUNGRY_HORSE_PACE).abs() < 0.005);
}

#[test]
fn never_enters_the_mountains_going_round_them_instead() {
    // A ridge of mountains across the map with one gap at x = 20; the sides of the map join, so
    // the way round goes through the gap or over the top edge.
    let ridge: String = (0..24).map(|x| if x == 20 { '.' } else { '^' }).collect();
    let plain = ".".repeat(24);
    let rows: Vec<&str> =
        (0..24).map(|y| if y == 8 { ridge.as_str() } else { plain.as_str() }).collect();
    let map = draw(&rows);
    let mut world = setup(&map);
    world.residents[0].riding = Some("h1".into());
    assert_eq!(
        order(&mut world, &map, json!({"kind": "walkTo", "residentId": "w1", "x": 2, "y": 8})),
        Err("a horse can’t go there".into())
    );
    walk_to(&mut world.residents[0], 2.0, 14.0);
    let mut seen = HashSet::new();
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    let mut t = 0;
    while t < 5000 && world.residents[0].order.is_some() {
        step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
        let r = &world.residents[0];
        seen.insert(map.tiles[(r.y as i32 * map.size + r.x as i32) as usize]);
        t += 1;
    }
    assert_eq!(at(&world), [2.0, 14.0, 2.0, 14.0]);
    assert!(!seen.contains(&(Terrain::Mountain as u8)));
    assert_eq!(world.residents[0].riding.as_deref(), Some("h1"));
}

#[test]
fn trains_driving() {
    let map = open();
    let mut world = setup(&map);
    world.residents[0].riding = Some("h1".into());
    walk_to(&mut world.residents[0], 20.0, 2.0);
    out(&mut world, &map);
    assert!(world.residents[0].skills.get(&SkillName::Driving).copied().unwrap_or(0.0) > 0.0);
}

#[test]
fn reckons_a_riders_walk_time_at_the_horses_pace() {
    let map = open();
    let mut world = setup(&map);
    let seen = |_: i32, _: i32| true;
    let on_foot = walk_time(&world, &map, &seen, &world.residents[0], (2, 2), (14, 2));
    world.residents[0].riding = Some("h1".into());
    assert!(walk_time(&world, &map, &seen, &world.residents[0], (2, 2), (14, 2)) < on_foot);
}

#[test]
fn ends_when_the_rider_leaves_their_horse_behind_or_it_is_gone() {
    let map = open();
    let mut world = setup(&map);
    let mut scratch = Scratch::default();
    world.residents[0].riding = Some("h1".into());
    world.residents[0].x = 5.0;
    step_world(&mut world, &map, &mut scratch, None, None);
    assert_eq!(world.residents[0].riding, None);
    assert_eq!([world.horses[0].x, world.horses[0].y], [2.0, 2.0]);
    world.residents[0].x = 2.0;
    world.residents[0].riding = Some("h1".into());
    world.horses.clear();
    step_world(&mut world, &map, &mut scratch, None, None);
    assert_eq!(world.residents[0].riding, None);
}
