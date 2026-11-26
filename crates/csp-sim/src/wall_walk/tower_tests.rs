//! Towers (T109.1, `CONTEXT.md`: Tower): a 2×2 building of wood or stone set in a wall's line or
//! alone. It closes the way like a wall, its top is part of the wall walk where a wall touches it,
//! it holds `TOWER_ROOM` residents up at once, and it is broken like a wall but holds out longer,
//! dropping those up on it.

use std::sync::Arc;

use csp_shared::balance::{
    FALL_DAMAGE, MAX_HEALTH, STONE_WALL_STRENGTH, TOWER_ROOM, WALK_TICKS_PER_TILE, WALL_STRENGTH,
    WALL_WALK_TICKS,
};
use csp_shared::terrain::{tile_index, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, ConstructionSite, ResidentOrder, Stock, UpSide, WallMaterial,
    WorldState,
};

use super::*;
use crate::invariants::check_all;
use crate::movement_test_world::{add_city, building, plains, realm, resident, walk_to};
use crate::queries::building::{build_problem, build_problem_for};
use crate::queries::walls::wall_strength;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::walls::{may_step, wall_map, WallKind};
use crate::world::step_world;

const SIZE: i32 = 512;

/// Realm r1 (Player 7) and r2 (Player 8), and r1's city c1: a ring of wall from (5, 5) to
/// (11, 11) with a gate at (8, 11) and its town hall at (8, 8), and a wooden tower of c1 covering
/// (8, 4) to (9, 5), set in the north side where its walls were.
fn setup() -> (WorldState, Arc<TerrainMap>) {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for i in 5..=11 {
        for (x, y) in [(i, 5), (i, 11), (5, i), (11, i)] {
            let (x, y) = (f64::from(x), f64::from(y));
            let taken = world.buildings.iter().any(|b| b.x == x && b.y == y);
            if taken || (y == 5.0 && (x == 8.0 || x == 9.0)) {
                continue;
            }
            let kind = if (x, y) == (8.0, 11.0) { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x, y);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    world.buildings.push(tower());
    (world, Arc::new(terrain))
}

fn tower() -> Building {
    let mut t = building("t1", BuildingKind::Tower, 8.0, 4.0);
    t.city_id = Some("c1".into());
    t
}

fn run(world: &mut WorldState, terrain: &Arc<TerrainMap>, walking: &mut Walking, ticks: u32) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        step_world(world, terrain, &mut scratch, Some(walking), None);
        let broken: Vec<_> = check_all(world, terrain)
            .into_iter()
            .filter(|v| v.invariant.contains("wall") || v.invariant.contains("tower"))
            .map(|v| format!("{}: {}", v.invariant, v.message))
            .collect();
        assert!(broken.is_empty(), "{broken:?}");
    }
}

fn at(world: &WorldState, id: &str) -> (f64, f64, Option<UpSide>) {
    let r = world.residents.iter().find(|r| r.id == id).expect("the resident");
    (r.x, r.y, r.up)
}

fn up(id: &str, x: f64, y: f64) -> csp_shared::world::Resident {
    let mut r = resident(id, Some("r1"), x, y);
    r.up = Some(UpSide::Inside);
    r
}

#[test]
fn is_a_buildable_two_by_two_of_wood_or_stone_and_not_on_wall_tiles() {
    let (world, terrain) = setup();
    assert_eq!(csp_shared::footprint::FOOTPRINT.get("tower"), Some(2));
    // Alone in the field, of either material.
    assert_eq!(build_problem(&world, 20, 20, BuildingKind::Tower, Some(&*terrain)), None);
    let stone = Some(WallMaterial::Stone);
    assert_eq!(
        build_problem_for(&world, 20, 20, BuildingKind::Tower, stone, Some(&*terrain)),
        None
    );
    // Not over wall tiles: those come down first.
    assert_eq!(
        build_problem(&world, 6, 4, BuildingKind::Tower, Some(&*terrain)).as_deref(),
        Some("there is already a building there")
    );
}

#[test]
fn every_tile_of_it_closes_the_way_like_a_wall() {
    let (world, terrain) = setup();
    let walls = wall_map(&world, &terrain);
    for (x, y) in [(8, 4), (9, 4), (8, 5), (9, 5)] {
        let t = tile_index(SIZE, x, y);
        let w = walls.tiles.get(&t).expect("a wall tile");
        assert_eq!((w.kind, w.tower.as_deref()), (WallKind::Wall, Some("t1")), "({x}, {y})");
        for side in [Some("r1"), Some("r2"), None] {
            assert!(!may_step(&walls, side, t), "nobody walks through it: {side:?}");
        }
    }
    // The ring stays closed with it in its line: the town hall is inside.
    assert!(walls.inside.contains(&tile_index(SIZE, 8, 8)));
    // A tower site closes nothing yet.
    let mut site = world.clone();
    site.buildings.last_mut().expect("the tower").site =
        Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert!(!wall_map(&site, &terrain).tiles.contains_key(&tile_index(SIZE, 8, 4)));
}

#[test]
fn residents_walk_from_the_walk_onto_it_and_back() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    let mut a1 = up("a1", 6.0, 5.0);
    walk_to(&mut a1, 9.0, 4.0);
    world.residents.push(a1);
    // Along the walk is walking: four tiles, no getting up or down.
    run(&mut world, &terrain, &mut walking, (4.0 * WALK_TICKS_PER_TILE * 1.5) as u32);
    assert_eq!(at(&world, "a1"), (9.0, 4.0, Some(UpSide::Inside)));
    walk_to(&mut world.residents[0], 10.0, 5.0);
    run(&mut world, &terrain, &mut walking, (2.0 * WALK_TICKS_PER_TILE * 1.5) as u32);
    assert_eq!(at(&world, "a1"), (10.0, 5.0, Some(UpSide::Inside)));
}

#[test]
fn its_side_gets_up_onto_it_from_the_ground_inside() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    let mut a1 = resident("a1", Some("r1"), 8.0, 6.0);
    walk_to(&mut a1, 8.0, 5.0);
    world.residents.push(a1);
    run(&mut world, &terrain, &mut walking, WALL_WALK_TICKS as u32 + 1);
    assert_eq!(at(&world, "a1"), (8.0, 5.0, Some(UpSide::Inside)));
}

#[test]
fn a_full_tower_refuses_more_until_one_leaves() {
    let (mut world, terrain) = setup();
    let mut walking = Walking::without_budget(terrain.clone());
    let room = TOWER_ROOM as usize;
    let tiles = [(8.0, 4.0), (9.0, 4.0), (8.0, 5.0), (9.0, 5.0)];
    for (i, &(x, y)) in tiles.iter().cycle().take(room).enumerate() {
        world.residents.push(up(&format!("t{i}"), x, y));
    }
    let mut a1 = up("a1", 7.0, 5.0);
    walk_to(&mut a1, 8.0, 5.0);
    world.residents.push(a1);
    run(&mut world, &terrain, &mut walking, (WALK_TICKS_PER_TILE * 4.0) as u32);
    assert_eq!(at(&world, "a1"), (7.0, 5.0, Some(UpSide::Inside)), "it waits beside the tower");
    assert!(matches!(at_order(&world, "a1"), Some(ResidentOrder::WalkTo(_))), "still going");
    // One of those up on it walks off along the walk the other way: a1 gets on.
    let leaver = world.residents.iter_mut().find(|r| r.id == "t1").expect("t1");
    walk_to(leaver, 11.0, 5.0);
    run(&mut world, &terrain, &mut walking, (WALK_TICKS_PER_TILE * 6.0) as u32);
    assert_eq!(at(&world, "a1"), (8.0, 5.0, Some(UpSide::Inside)));
}

fn at_order<'w>(world: &'w WorldState, id: &str) -> Option<&'w ResidentOrder> {
    world.residents.iter().find(|r| r.id == id).and_then(|r| r.order.as_ref())
}

#[test]
fn holds_out_longer_than_a_wall_and_stone_longer_still() {
    let mut t = tower();
    assert_eq!(wall_strength(&t), WALL_STRENGTH.tower);
    const { assert!(WALL_STRENGTH.tower > WALL_STRENGTH.gate) };
    t.material = Some(WallMaterial::Stone);
    assert_eq!(wall_strength(&t), STONE_WALL_STRENGTH.tower);
    const { assert!(STONE_WALL_STRENGTH.tower > WALL_STRENGTH.tower) };
}

#[test]
fn breaking_it_drops_those_up_on_it_inside_with_a_falls_damage() {
    let (mut world, terrain) = setup();
    for (id, x, y) in [("a1", 8.0, 4.0), ("a2", 9.0, 5.0)] {
        world.residents.push(up(id, x, y));
    }
    world.residents.push(up("a3", 10.0, 5.0));
    let t = world.buildings.iter_mut().find(|b| b.id == "t1").expect("the tower");
    t.damage = Some(wall_strength(t) - 0.01);
    // From outside, beside its north-east tile rather than the north-west one it is placed by.
    let mut b9 = resident("b9", Some("r2"), 10.0, 3.0);
    b9.order = Some(ResidentOrder::Attack(crate::combat::attack_order("t1", false, false)));
    world.residents.push(b9);
    let mut walking = Walking::without_budget(terrain.clone());
    let mut scratch = Scratch::default();
    for _ in 0..20 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if !world.buildings.iter().any(|b| b.id == "t1") {
            break;
        }
    }
    assert!(!world.buildings.iter().any(|b| b.id == "t1"), "the tower broke");
    // a1 stood on its outer row: down on the ground next to it, inside the ring's walls as they
    // stood; a2 on its inner row lands just inside.
    let (_, _, a1_up) = at(&world, "a1");
    assert_eq!(a1_up, None);
    assert_eq!(at(&world, "a2"), (9.0, 6.0, None));
    for id in ["a1", "a2"] {
        let r = world.residents.iter().find(|r| r.id == id).expect(id);
        assert_eq!(r.health, MAX_HEALTH - FALL_DAMAGE, "{id}");
    }
    // The wall next to it stands, and whoever is up there stays.
    assert_eq!(at(&world, "a3"), (10.0, 5.0, Some(UpSide::Inside)));
}

#[test]
fn the_invariant_catches_more_up_on_a_tower_than_its_room() {
    let (mut world, terrain) = setup();
    let room = TOWER_ROOM as usize;
    let tiles = [(8.0, 4.0), (9.0, 4.0), (8.0, 5.0), (9.0, 5.0)];
    for (i, &(x, y)) in tiles.iter().cycle().take(room).enumerate() {
        world.residents.push(up(&format!("t{i}"), x, y));
    }
    assert!(tower_room(&world, &terrain).is_empty());
    world.residents.push(up("one-more", 8.0, 4.0));
    let broken: Vec<_> = tower_room(&world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(broken, [format!("tower t1 has {} residents up, more than its room", room + 1)]);
}

#[test]
fn someone_put_on_it_is_up_and_nobody_stays_up_where_it_broke() {
    let (mut world, terrain) = setup();
    world.residents.push(resident("a1", Some("r1"), 9.0, 4.0));
    step_wall_walk(&mut world);
    assert_eq!(at(&world, "a1"), (9.0, 4.0, Some(UpSide::Inside)));
    assert!(up_only_on_walls(&world, &terrain).is_empty());
    world.buildings.retain(|b| b.id != "t1");
    step_wall_walk(&mut world);
    assert_eq!(at(&world, "a1"), (9.0, 4.0, None));
}
