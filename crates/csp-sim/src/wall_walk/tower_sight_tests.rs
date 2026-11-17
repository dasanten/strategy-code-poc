//! Up on a tower (T109.2, `CONTEXT.md`: Tower, Sight, Ranged combat): a resident up on a tower sees
//! `TOWER_SIGHT_RANGE` instead of `SIGHT_RANGE`, which grows their realm's Sight and explored
//! terrain; an archer up there reaches `TOWER_SHOT_REACH_BONUS` further, beyond a wall archer; and
//! the wall's cover holds up there too.

use std::collections::HashSet;

use csp_shared::balance::{
    SHOT_REACH, SIGHT_RANGE, TOWER_SHOT_REACH_BONUS, TOWER_SIGHT_RANGE, WALL_SHOT_REACH_BONUS,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::world::{BuildingKind, Good, UpSide, WorldState};

use crate::movement_test_world::{add_city, building, plains, realm, resident};
use crate::queries::combat::shot_reach;
use crate::queries::walls::{on_own_wall, sight_range_of, up_on_tower};
use crate::sight::{entities_in_sight, Explore, SightTracker};
use crate::world_index::WorldIndex;

const SIZE: i32 = 512;

/// Realm r1 (Player 7) with city c1 (town hall at (100, 100)), its tower t1 covering (100, 90) to
/// (101, 91) and a wall tile at (99, 90); its l1 on the tower's tile (100, 90), up or not; realm
/// r2's x1 60 tiles south of l1.
fn world(up: bool) -> WorldState {
    let terrain = plains(SIZE);
    let mut world = crate::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "l1"));
    world.realms.push(realm("r2", 8, "x1"));
    add_city(&mut world, "c1", Some("r1"), 100.0, 100.0);
    for (id, kind, x) in [("t1", BuildingKind::Tower, 100.0), ("w1", BuildingKind::Wall, 99.0)] {
        let mut b = building(id, kind, x, 90.0);
        b.city_id = Some("c1".into());
        world.buildings.push(b);
    }
    let mut l1 = resident("l1", Some("r1"), 100.0, 90.0);
    l1.up = up.then_some(UpSide::Inside);
    world.residents.push(l1);
    world.residents.push(resident("x1", Some("r2"), 100.0, 150.0));
    world
}

fn sees_x1(world: &WorldState) -> bool {
    let index = WorldIndex::new(world, SIZE);
    entities_in_sight(world, &index, Some("r1"), None)
        .iter()
        .any(|e| matches!(e, SeenEntity::Resident(r) if r.id == "x1"))
}

#[test]
fn up_on_a_tower_they_see_the_bigger_ring_and_off_it_the_usual() {
    const { assert!(TOWER_SIGHT_RANGE > SIGHT_RANGE && TOWER_SIGHT_RANGE <= 2.0 * SIGHT_RANGE) };
    let up = world(true);
    assert!(up_on_tower(&up, &up.residents[0]));
    assert_eq!(sight_range_of(&up, &up.residents[0]), TOWER_SIGHT_RANGE);
    assert!(sees_x1(&up), "60 tiles off, seen from up on the tower");
    let down = world(false);
    assert_eq!(sight_range_of(&down, &down.residents[0]), SIGHT_RANGE);
    assert!(!sees_x1(&down), "on the ground below it, out of sight");
    // Up on the wall next to it is only a wall's.
    let mut on_wall = world(true);
    on_wall.residents[0].x = 99.0;
    assert!(!up_on_tower(&on_wall, &on_wall.residents[0]));
    assert!(!sees_x1(&on_wall));
}

/// What a Player's explored terrain is asked to grow by: the radius looked around with.
#[derive(Default)]
struct Radii(Vec<(u64, i32)>);

impl Explore for Radii {
    fn explore(&mut self, user: u64, _: i32, _: i32, radius: i32) -> HashSet<usize> {
        self.0.push((user, radius));
        HashSet::new()
    }
}

#[test]
fn up_on_a_tower_they_explore_the_bigger_ring() {
    for (up, want) in [(true, TOWER_SIGHT_RANGE), (false, SIGHT_RANGE)] {
        let world = world(up);
        let index = WorldIndex::new(&world, SIZE);
        let mut radii = Radii::default();
        SightTracker::new().update(&world, &index, &mut radii);
        let ours: Vec<i32> = radii.0.iter().filter(|(u, _)| *u == 7).map(|(_, r)| *r).collect();
        assert_eq!(ours, [want as i32], "up: {up}");
    }
}

#[test]
fn an_archer_up_on_a_tower_reaches_beyond_one_on_the_wall_and_takes_its_cover() {
    let mut world = world(true);
    world.residents[0].carried = [(Good::Bow, 1.0), (Good::Arrows, 10.0)].into_iter().collect();
    crate::equipment::settle_all(&mut world);
    let bow = SHOT_REACH.get("bow").expect("a bow's reach");
    assert_eq!(shot_reach(&world, &world.residents[0]), Some(bow + TOWER_SHOT_REACH_BONUS));
    world.residents[0].x = 99.0;
    assert_eq!(shot_reach(&world, &world.residents[0]), Some(bow + WALL_SHOT_REACH_BONUS));
    const { assert!(TOWER_SHOT_REACH_BONUS > WALL_SHOT_REACH_BONUS) };
    // The wall's cover, on the tower as on the wall.
    world.residents[0].x = 101.0;
    assert!(on_own_wall(&world, &world.residents[0]));
}
