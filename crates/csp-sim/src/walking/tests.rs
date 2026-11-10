//! `apps/server/src/walking.test.ts`. The order queue (T86.2) is not ported yet, so the walk-to
//! order's tests call its `validate` and `apply` as `OrderQueue.receive` and `applyAll` would. The
//! two invariant cases (`pathsAreSteps`, `checkInvariants`) come with T86.13.

use std::sync::Arc;

use csp_shared::balance::WALK_TICKS_PER_TILE;
use csp_shared::terrain::{is_passable_terrain, terrain_at, Terrain, TerrainMap, DIAGONAL_STEP};
use csp_shared::world::{
    OrderRequest, Resident, ResidentOrder, StatName, Tile, WalkOrder, WorldState,
};

use super::*;
use crate::movement_test_world::{draw, resident, world_with_realm};
use crate::tick::Scratch;
use crate::world::step_world;

fn open() -> TerrainMap {
    draw(&[&".".repeat(16); 16].map(|s| s.as_str()))
}

/// A world on `map` with one resident `w1` at (x, y) of the given Agility, owned by realm r1.
fn one_walker(map: &TerrainMap, x: f64, y: f64, agility: f64) -> WorldState {
    let mut world = world_with_realm(map);
    let mut r = resident("w1", Some("r1"), x, y);
    r.stats.agility.base = agility;
    world.residents.push(r);
    world
}

fn walk_to(r: &mut Resident, x: f64, y: f64) {
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

fn w1(world: &WorldState) -> &Resident {
    &world.residents[0]
}

fn step(world: &mut WorldState, map: &TerrainMap, walking: &mut Walking, scratch: &mut Scratch) {
    step_world(world, map, scratch, Some(walking), None);
}

/// Ticks until the resident stands on (x, y) or `max` runs out.
fn ticks_until(world: &mut WorldState, map: &TerrainMap, x: f64, y: f64) -> f64 {
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    for t in 1..=2000 {
        step(world, map, &mut walking, &mut scratch);
        if w1(world).x == x && w1(world).y == y {
            return f64::from(t);
        }
    }
    f64::INFINITY
}

/// A walker of `agility` at (2, 2) on `map`, walking to (3, 2).
fn walker(map: &TerrainMap, agility: f64) -> WorldState {
    let mut world = one_walker(map, 2.0, 2.0, agility);
    walk_to(&mut world.residents[0], 3.0, 2.0);
    world
}

#[test]
fn takes_about_30_s_to_walk_a_plains_tile_unloaded_at_average_agility() {
    let open = open();
    let mut world = walker(&open, 10.0);
    let t = ticks_until(&mut world, &open, 3.0, 2.0);
    assert!((t - WALK_TICKS_PER_TILE).abs() <= 2.0);
    assert!(w1(&world).order.is_none());
}

#[test]
fn walks_the_whole_path_to_the_target_on_passable_tiles_only_then_stops() {
    let map = draw(&[
        "..........",
        "....~.....",
        "....~.....",
        "....~.....",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
    ]);
    let mut world = one_walker(&map, 2.0, 2.0, 10.0);
    walk_to(&mut world.residents[0], 6.0, 2.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    let mut visited = std::collections::HashSet::new();
    let mut t = 0;
    while t < 400 && w1(&world).order.is_some() {
        step(&mut world, &map, &mut walking, &mut scratch);
        let r = w1(&world);
        assert!(is_passable_terrain(terrain_at(&map, r.x as i32, r.y as i32)));
        visited.insert((r.x as i32, r.y as i32));
        t += 1;
    }
    assert_eq!((w1(&world).x, w1(&world).y), (6.0, 2.0));
    assert!(w1(&world).order.is_none());
    assert!(visited.len() > 4);
}

#[test]
fn is_slower_in_forest_and_faster_with_high_agility() {
    let open = open();
    let forest = draw(&[&"f".repeat(16); 16].map(|s| s.as_str()));
    let plains = ticks_until(&mut walker(&open, 10.0), &open, 3.0, 2.0);
    let woods = ticks_until(&mut walker(&forest, 10.0), &forest, 3.0, 2.0);
    let nimble = ticks_until(&mut walker(&open, 20.0), &open, 3.0, 2.0);
    assert!(woods > plains * 1.3);
    assert!(nimble < plains);
    // Agility softens the terrain's slowdown too.
    let r = one_walker(&forest, 0.0, 0.0, 20.0).residents.remove(0);
    let s = one_walker(&forest, 0.0, 0.0, 10.0).residents.remove(0);
    let (f, p) = (Terrain::Forest as u8, Terrain::Plains as u8);
    assert!(
        walk_speed(&r, f, 0.0) / walk_speed(&r, p, 0.0)
            > walk_speed(&s, f, 0.0) / walk_speed(&s, p, 0.0)
    );
    assert_eq!(crate::queries::residents::stat_value(&r, StatName::Agility, 0.0), 20.0);
}

#[test]
fn takes_root_2_times_as_long_for_a_diagonal_step_as_for_a_straight_one() {
    let open = open();
    let straight = ticks_until(&mut walker(&open, 10.0), &open, 3.0, 2.0);
    let mut world = one_walker(&open, 2.0, 2.0, 10.0);
    walk_to(&mut world.residents[0], 3.0, 3.0);
    let diagonal = ticks_until(&mut world, &open, 3.0, 3.0);
    assert!((diagonal - straight * DIAGONAL_STEP).abs() <= 2.0);
    assert!(w1(&world).order.is_none());
}

#[test]
fn takes_a_diagonal_step_only_between_two_steppable_tiles_using_up_root_2_of_progress() {
    let map = draw(&["......", "......", "...~..", "......", "......", "......"]);
    let mut world = one_walker(&map, 2.0, 2.0, 10.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut scratch = Scratch::default();
    let mut step = |world: &mut WorldState, x: f64, y: f64, path: Vec<(f64, f64)>| {
        world.residents[0].order = Some(ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x, y },
            path: Some(path),
            progress: 2.0,
            army: None,
        }));
        let action =
            StepAction { resident_id: "w1".into(), to: (x, y), carriage_id: None, horse_id: None };
        walking.resolve(world, &mut scratch, &[action])
    };
    let walk = |world: &WorldState| match &w1(world).order {
        Some(ResidentOrder::WalkTo(o)) => Some((o.path.clone(), o.progress)),
        _ => None,
    };
    // Past the lake's corner at (3, 2): refused, and a new path is found.
    assert_eq!(step(&mut world, 3.0, 3.0, vec![(3.0, 3.0)]), 0);
    assert_eq!((w1(&world).x, w1(&world).y), (2.0, 2.0));
    assert_eq!(walk(&world), Some((None, 0.0)));
    // The other way round is open.
    assert_eq!(step(&mut world, 1.0, 3.0, vec![(1.0, 3.0), (0.0, 3.0)]), 1);
    assert_eq!((w1(&world).x, w1(&world).y), (1.0, 3.0));
    assert!((walk(&world).expect("still walking").1 - (2.0 - DIAGONAL_STEP)).abs() < 1e-9);
    // Two tiles off is no step at all.
    assert_eq!(step(&mut world, 3.0, 5.0, vec![(3.0, 5.0)]), 0);
    assert!(w1(&world).order.is_none());
}

#[test]
fn walks_across_a_join_of_the_map() {
    let open = open();
    let mut world = one_walker(&open, 0.0, 5.0, 10.0);
    walk_to(&mut world.residents[0], 15.0, 5.0);
    assert!(ticks_until(&mut world, &open, 15.0, 5.0) < WALK_TICKS_PER_TILE + 3.0);
}

#[test]
fn drops_an_order_whose_target_cannot_be_reached() {
    let map = draw(&["....", ".~~.", ".~~.", "...."]);
    let mut world = one_walker(&map, 0.0, 0.0, 10.0);
    walk_to(&mut world.residents[0], 1.0, 1.0);
    let mut walking = Walking::new(Arc::new(map.clone()));
    step(&mut world, &map, &mut walking, &mut Scratch::default());
    assert!(w1(&world).order.is_none());
}

#[test]
fn keeps_a_found_path_in_the_order_so_walking_goes_on_after_a_restart() {
    let open = open();
    let mut world = one_walker(&open, 2.0, 2.0, 10.0);
    walk_to(&mut world.residents[0], 8.0, 2.0);
    let mut walking = Walking::new(Arc::new(open.clone()));
    step(&mut world, &open, &mut walking, &mut Scratch::default());
    match &w1(&world).order {
        Some(ResidentOrder::WalkTo(o)) => assert_eq!(o.path.as_ref().map(Vec::len), Some(6)),
        other => panic!("still walking, not {other:?}"),
    }
    let mut saved: WorldState =
        serde_json::from_value(serde_json::to_value(&world).expect("a save")).expect("a load");
    assert!(ticks_until(&mut saved, &open, 8.0, 2.0) < 6.0 * WALK_TICKS_PER_TILE + 5.0);
}

fn order(fields: serde_json::Value) -> OrderRequest {
    serde_json::from_value(fields).expect("an order")
}

#[test]
fn accepts_an_order_for_your_own_resident_and_applies_it_next_tick() {
    let open = open();
    let mut world = one_walker(&open, 1.0, 1.0, 10.0);
    let sender = OrderSender::player(7, "Player");
    let o = order(serde_json::json!({"kind": "walkTo", "residentId": "w1", "x": 4, "y": 1}));
    assert_eq!(WalkTo.validate(&world, &sender, &o, None), None);
    assert!(w1(&world).order.is_none());
    WalkTo.apply(&mut world, &sender, &o, None);
    assert_eq!(
        w1(&world).order,
        Some(ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: 4.0, y: 1.0 },
            path: None,
            progress: 0.0,
            army: None
        }))
    );
}

#[test]
fn rejects_someone_elses_resident_and_targets_that_arent_tiles() {
    let open = open();
    let world = one_walker(&open, 1.0, 1.0, 10.0);
    let me = OrderSender::player(7, "Player");
    let stranger = OrderSender::player(8, "Player");
    let o = |x: f64, id: &str| {
        order(serde_json::json!({"kind": "walkTo", "residentId": id, "x": x, "y": 2}))
    };
    assert_eq!(
        WalkTo.validate(&world, &stranger, &o(2.0, "w1"), None).as_deref(),
        Some("not one of your residents")
    );
    assert_eq!(
        WalkTo.validate(&world, &me, &o(2.5, "w1"), None).as_deref(),
        Some("the target must be a tile")
    );
    assert!(WalkTo.validate(&world, &me, &o(2.0, "nobody"), None).is_some());
}
