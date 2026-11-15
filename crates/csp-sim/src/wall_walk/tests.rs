//! The wall walk (T105.2, `CONTEXT.md`: Wall walk): getting up and down takes its ticks, only the
//! wall's side gets up, down only to the side they came from, paths count the time and go up only
//! when sent there; the step that keeps being up true to the walls, and its invariants.

use std::sync::Arc;

use csp_shared::balance::{WALK_TICKS_PER_TILE, WALL_WALK_TICKS};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, ClimbOrder, ResidentOrder, Tile, UpSide, WorldState};

use super::*;
use crate::movement_test_world::{add_city, building, plains, realm, resident, walk_to};
use crate::pathfinding::{PathFinder, PathOptions, PathResult, WALKING_COSTS, WALL_WALK_COST};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::walls::wall_map;
use crate::world::step_world;

const SIZE: i32 = 512;

/// Realm r1 (Player 7) and r2 (Player 8), and r1's city c1: a ring of wall from (5, 5) to
/// (11, 11) with a gate in the middle of its south side, (8, 11), and its town hall at (8, 8). The
/// map is large enough for the ring to have an inside.
fn setup() -> (WorldState, Arc<TerrainMap>) {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for i in 5..=11 {
        for (x, y) in [(i, 5), (i, 11), (5, i), (11, i)] {
            let (x, y) = (f64::from(x), f64::from(y));
            if world.buildings.iter().any(|b| b.x == x && b.y == y) {
                continue;
            }
            let kind = if (x, y) == (8.0, 11.0) { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x, y);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    (world, Arc::new(terrain))
}

/// Steps the world with walking `ticks` times, calling `each` after every tick.
fn run(
    world: &mut WorldState,
    terrain: &Arc<TerrainMap>,
    walking: &mut Walking,
    ticks: u32,
    mut each: impl FnMut(&WorldState),
) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        step_world(world, terrain, &mut scratch, Some(walking), None);
        each(world);
    }
}

fn at(world: &WorldState, id: &str) -> (f64, f64, Option<UpSide>) {
    let r = world.residents.iter().find(|r| r.id == id).expect("the resident");
    (r.x, r.y, r.up)
}

/// The path, and its cost, from `from` (up from `up`, or on the ground) to `to` for someone of r1.
fn path(
    world: &WorldState,
    terrain: &Arc<TerrainMap>,
    side: &str,
    from: (i32, i32),
    up: Option<UpSide>,
    to: (i32, i32),
) -> PathResult {
    let mut finder = PathFinder::new(terrain.clone());
    finder.set_walls(Some(Arc::new(wall_map(world, terrain))));
    let options =
        PathOptions { realm_id: Some(side.into()), on_walls: true, up, ..PathOptions::default() };
    finder.find_path(from, to, &WALKING_COSTS, options)
}

fn ticks(t: f64) -> u32 {
    t as u32
}

#[test]
fn getting_up_takes_its_ticks_and_so_does_getting_down() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::new(terrain.clone());
    let mut a1 = resident("a1", Some("r1"), 8.0, 6.0);
    walk_to(&mut a1, 8.0, 5.0);
    world.residents.push(a1);
    run(&mut world, &terrain, &mut walking, ticks(WALL_WALK_TICKS) - 1, |_| {});
    assert_eq!(at(&world, "a1"), (8.0, 6.0, None));
    run(&mut world, &terrain, &mut walking, 1, |_| {});
    assert_eq!(at(&world, "a1"), (8.0, 5.0, Some(UpSide::Inside)));
    assert!(world.residents[0].order.is_none());

    walk_to(&mut world.residents[0], 8.0, 6.0);
    run(&mut world, &terrain, &mut walking, ticks(WALL_WALK_TICKS) - 1, |_| {});
    assert_eq!(at(&world, "a1"), (8.0, 5.0, Some(UpSide::Inside)));
    run(&mut world, &terrain, &mut walking, 1, |_| {});
    assert_eq!(at(&world, "a1"), (8.0, 6.0, None));
}

#[test]
fn along_the_walk_is_walking_and_goes_over_the_gate() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::new(terrain.clone());
    let mut a1 = resident("a1", Some("r1"), 6.0, 11.0);
    a1.up = Some(UpSide::Inside);
    walk_to(&mut a1, 10.0, 11.0);
    world.residents.push(a1);
    let mut seen = Vec::new();
    // Four tiles of plains, the gate's among them, at a walker's pace: far less than getting
    // down and up again.
    let tiles = 4.0 * WALK_TICKS_PER_TILE;
    run(&mut world, &terrain, &mut walking, ticks(tiles * 1.5), |w| seen.push(at(w, "a1")));
    assert_eq!(at(&world, "a1"), (10.0, 11.0, Some(UpSide::Inside)));
    assert!(seen.iter().all(|&(_, y, up)| y == 11.0 && up == Some(UpSide::Inside)), "{seen:?}");
    assert!(seen.iter().any(|&(x, _, _)| x == 8.0), "over the gate: {seen:?}");
}

#[test]
fn only_the_walls_side_gets_up() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::new(terrain.clone());
    let mut b1 = resident("b1", Some("r2"), 8.0, 4.0);
    walk_to(&mut b1, 8.0, 5.0);
    world.residents.push(b1);
    let mut a2 = resident("a2", Some("r1"), 9.0, 4.0);
    walk_to(&mut a2, 9.0, 5.0);
    world.residents.push(a2);
    run(&mut world, &terrain, &mut walking, ticks(WALL_WALK_TICKS) + 2, |_| {});
    // The outsider finds no way up; the wall's own side gets up from outside too.
    assert_eq!(at(&world, "b1"), (8.0, 4.0, None));
    assert!(world.residents[0].order.is_none());
    assert_eq!(at(&world, "a2"), (9.0, 5.0, Some(UpSide::Outside)));
    assert!(matches!(path(&world, &terrain, "r2", (8, 4), None, (8, 5)), PathResult::Unreachable));
}

#[test]
fn down_only_to_the_side_they_came_up_from() {
    let (world, terrain) = setup();
    // Up from outside, bound inside: down outside, then round through the gate.
    let PathResult::Found { path: p, .. } =
        path(&world, &terrain, "r1", (8, 5), Some(UpSide::Outside), (8, 6))
    else {
        panic!("a way round through the gate");
    };
    assert!(p.contains(&(8, 11)), "through the gate: {p:?}");
    assert!(!p.starts_with(&[(8, 6)]), "not straight down inside: {p:?}");
    let walls = wall_map(&world, &terrain);
    let ring = |&(x, y): &(i32, i32)| walls.tiles.contains_key(&((y * SIZE + x) as usize));
    let first_ground = p.iter().position(|t| !ring(t)).expect("comes down");
    let down = p[first_ground];
    assert!(!walls.inside.contains(&((down.1 * SIZE + down.0) as usize)), "down outside: {p:?}");
    // Up from inside, the same goal is straight down.
    let PathResult::Found { path: p, .. } =
        path(&world, &terrain, "r1", (8, 5), Some(UpSide::Inside), (8, 6))
    else {
        panic!("straight down");
    };
    assert_eq!(p, vec![(8, 6)]);
}

#[test]
fn a_path_onto_the_wall_counts_the_time_and_one_that_needs_no_wall_never_goes_up() {
    let (world, terrain) = setup();
    let PathResult::Found { path: p, cost } = path(&world, &terrain, "r1", (8, 6), None, (8, 5))
    else {
        panic!("a way up");
    };
    assert_eq!(p, vec![(8, 5)]);
    assert!((cost - WALL_WALK_COST).abs() < 1e-4, "{cost}");
    // Along the wall inside, and out through the gate: never onto the wall.
    let walls = wall_map(&world, &terrain);
    for (from, to) in [((6, 6), (10, 6)), ((6, 6), (6, 10)), ((7, 7), (8, 14)), ((4, 4), (12, 12))]
    {
        let PathResult::Found { path: p, .. } = path(&world, &terrain, "r1", from, None, to) else {
            panic!("a way from {from:?} to {to:?}");
        };
        let walled =
            p.iter().filter(|&&(x, y)| walls.tiles.contains_key(&((y * SIZE + x) as usize)));
        assert!(walled.clone().all(|&t| t == (8, 11)), "{from:?} to {to:?} went up: {p:?}");
    }
}

#[test]
fn a_broken_tile_or_one_that_changed_hands_puts_nobody_up_and_a_wall_under_them_puts_its_side_up() {
    let (mut world, _) = setup();
    let mut a1 = resident("a1", Some("r1"), 6.0, 5.0);
    a1.up = Some(UpSide::Inside);
    let mut a2 = resident("a2", Some("r1"), 7.0, 5.0);
    a2.up = Some(UpSide::Inside);
    world.residents.push(a1);
    world.residents.push(a2);
    world.residents.push(resident("a3", Some("r1"), 9.0, 5.0));
    world.residents.push(resident("b1", Some("r2"), 10.0, 5.0));
    world.buildings.retain(|b| b.id != "w6-5");
    step_wall_walk(&mut world);
    assert_eq!(at(&world, "a1").2, None, "its tile broke");
    assert_eq!(at(&world, "a2").2, Some(UpSide::Inside));
    assert_eq!(at(&world, "a3").2, Some(UpSide::Inside), "of its side, on it");
    assert_eq!(at(&world, "b1").2, None, "not of its side");
    // The city goes to r2: r1's residents up on it are up on a foreign wall no more.
    world.cities[0].realm_id = Some("r2".into());
    step_wall_walk(&mut world);
    assert_eq!(at(&world, "a2").2, None);
    assert!(up_only_on_walls(&world, &plains(SIZE)).is_empty());
    assert!(up_only_on_own_walls(&world, &plains(SIZE)).is_empty());
}

#[test]
fn the_invariants_catch_someone_up_off_a_wall_or_on_another_sides_wall_but_a_climber() {
    let (mut world, _) = setup();
    let terrain = plains(SIZE);
    let mut a1 = resident("a1", Some("r1"), 8.0, 6.0);
    a1.up = Some(UpSide::Inside);
    let mut b1 = resident("b1", Some("r2"), 8.0, 5.0);
    b1.up = Some(UpSide::Outside);
    let mut b2 = resident("b2", Some("r2"), 9.0, 5.0);
    b2.up = Some(UpSide::Outside);
    b2.order = Some(ResidentOrder::Climb(ClimbOrder {
        wall_id: "w9-5".into(),
        at: Tile { x: 9.0, y: 4.0 },
        progress: 0.5,
    }));
    world.residents.extend([a1, b1, b2]);
    let off = up_only_on_walls(&world, &terrain);
    assert_eq!(off.len(), 1);
    assert_eq!(off[0].entity_ids, vec!["a1".to_string()]);
    let foreign = up_only_on_own_walls(&world, &terrain);
    assert_eq!(foreign.len(), 1);
    assert_eq!(foreign[0].entity_ids, vec!["b1".to_string(), "w8-5".to_string()]);
}

#[test]
fn up_stays_true_to_the_walls_while_residents_come_and_go() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::new(terrain.clone());
    for (i, (x, y, tx, ty)) in
        [(8.0, 6.0, 8.0, 5.0), (9.0, 4.0, 9.0, 5.0), (6.0, 7.0, 7.0, 14.0)].into_iter().enumerate()
    {
        let mut r = resident(&format!("a{i}"), Some("r1"), x, y);
        walk_to(&mut r, tx, ty);
        world.residents.push(r);
    }
    let mut broken = Vec::new();
    run(&mut world, &terrain, &mut walking, 120, |w| {
        broken.extend(up_only_on_walls(w, &terrain));
        broken.extend(up_only_on_own_walls(w, &terrain));
    });
    assert!(broken.is_empty(), "{broken:?}");
}
