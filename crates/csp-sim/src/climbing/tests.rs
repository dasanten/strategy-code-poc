//! "climbing a wall" of `apps/server/src/wall-breaking.test.ts`. "a climber can’t defend
//! themselves" is combat's (T86.7) and "the invariant catches a climber away from their tile"
//! comes with `climbOrdersSound` (T86.13).

use csp_shared::balance::CLIMB_TICKS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, ClimbOrder, ResidentOrder, Tile, WorldState};
use serde_json::json;

use crate::movement_test_world::{add_city, building, order_from, plains, realm, resident};
use crate::tick::Scratch;
use crate::walls::climb_landing;
use crate::world::{create_world, step_world};

/// A world with realm r1 (Player 7) and r2 (Player 8), and r1's city: a ring of wall from (5, 5)
/// to (11, 11) with a gate in the middle of its south side, and its town hall in the middle.
fn setup(terrain: &TerrainMap) -> WorldState {
    let mut world = create_world(terrain, 1);
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
    world
}

fn run(world: &mut WorldState, terrain: &TerrainMap, ticks: f64) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks as u32 {
        step_world(world, terrain, &mut scratch, None, None);
    }
}

fn send(
    world: &mut WorldState,
    terrain: &TerrainMap,
    user_id: u64,
    o: serde_json::Value,
) -> String {
    match order_from(world, terrain, user_id, o) {
        Ok(()) => "ack".into(),
        Err(reason) => reason,
    }
}

#[test]
fn climbing_takes_time_and_the_climber_comes_down_on_the_far_side() {
    let terrain = plains(512);
    let mut world = setup(&terrain);
    world.residents.push(resident("b1", Some("r2"), 8.0, 4.0));
    let climb = json!({"kind": "climb", "residentId": "b1", "wallId": "w8-5"});
    assert_eq!(send(&mut world, &terrain, 8, climb), "ack");
    run(&mut world, &terrain, CLIMB_TICKS - 1.0);
    let b = &world.residents[0];
    assert_eq!((b.x, b.y), (8.0, 4.0));
    assert!(matches!(b.order, Some(ResidentOrder::Climb(_))));
    run(&mut world, &terrain, 1.0);
    let b = &world.residents[0];
    assert_eq!((b.x, b.y, &b.order), (8.0, 6.0, &None));
}

#[test]
fn only_next_to_a_wall_of_another_realm() {
    let terrain = plains(512);
    let mut world = setup(&terrain);
    world.residents.push(resident("a1", Some("r1"), 8.0, 4.0));
    world.residents.push(resident("b1", Some("r2"), 8.0, 3.0));
    let climb = |id: &str, wall: &str| json!({"kind": "climb", "residentId": id, "wallId": wall});
    assert_eq!(send(&mut world, &terrain, 7, climb("a1", "w8-5")), "that is one of your own walls");
    assert_eq!(
        send(&mut world, &terrain, 8, climb("b1", "w8-5")),
        "stand next to the wall to climb it"
    );
    assert_eq!(send(&mut world, &terrain, 8, climb("b1", "c1-hall")), "no such wall or gate");
}

#[test]
fn a_climber_who_leaves_their_tile_or_loses_their_wall_stops() {
    let terrain = plains(512);
    let mut world = setup(&terrain);
    let mut b = resident("b1", Some("r2"), 8.0, 4.0);
    b.order = Some(ResidentOrder::Climb(ClimbOrder {
        wall_id: "w8-5".into(),
        at: Tile { x: 8.0, y: 4.0 },
        progress: 0.5,
    }));
    world.residents.push(b);
    world.buildings.retain(|x| x.id != "w8-5");
    run(&mut world, &terrain, 1.0);
    let b = &world.residents[0];
    assert_eq!((b.x, b.y, &b.order), (8.0, 4.0, &None));
}

#[test]
fn with_no_room_beyond_the_climber_ends_up_on_the_wall() {
    let terrain = plains(512);
    let mut world = setup(&terrain);
    let mut inner = building("w8-6", BuildingKind::Wall, 8.0, 6.0);
    inner.city_id = Some("c1".into());
    world.buildings.push(inner);
    assert_eq!(climb_landing(&world, &terrain, (8, 4), (8, 5)), (8, 5));
    assert_eq!(climb_landing(&world, &terrain, (7, 4), (7, 5)), (7, 6));
}
