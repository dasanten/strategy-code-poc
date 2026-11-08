//! Building the `WallMap` from the world (`wallMap`, T86.6): the first test of
//! `apps/server/src/walls.test.ts`, ported. Its path and step tests are pathfinding's (T85.3,
//! `walls.rs`), its combat and gate-order tests the conflict ticket's (T86.7).

mod build_common;

use build_common::*;
use csp_shared::terrain::tile_index;
use csp_shared::world::{BuildingKind, WorldState};
use csp_sim::walls::{foreign_wall, wall_map, walls_key};

const GATE: (i32, i32) = (8, 11);

/// Realms r1 (Player 7) and r2 (Player 8), and r1's city: a ring of wall from (5, 5) to (11, 11)
/// with a gate in the middle of its south side, and its town hall in the middle.
fn setup() -> WorldState {
    let mut world = empty_world(&plains(512));
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for i in 5..=11 {
        for (x, y) in [(i, 5), (i, 11), (5, i), (11, i)] {
            if world.buildings.iter().any(|b| b.x as i32 == x && b.y as i32 == y) {
                continue;
            }
            let kind = if (x, y) == GATE { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x as f64, y as f64);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    world
}

#[test]
fn a_ring_of_wall_shuts_in_its_inside() {
    let world = setup();
    let terrain = plains(512);
    let walls = wall_map(&world, &terrain);
    assert_eq!(walls.inside.len(), 25);
    assert!(walls.inside.contains(&tile_index(512, 8, 8)));
    assert!(!walls.inside.contains(&tile_index(512, 8, 12)));
    let gate = &walls.tiles[&tile_index(512, GATE.0, GATE.1)];
    assert_eq!(gate.realm_id.as_deref(), Some("r1"));
    assert_eq!(gate.realms, ["r1"]);
}

#[test]
fn the_walls_key_changes_with_a_gate_closing_and_foreign_walls_are_told_apart() {
    // Not in the TypeScript tests: `wallsKey` and `foreignWall` on the same ring.
    let mut world = setup();
    let before = walls_key(&world);
    let gate = world.buildings.iter().position(|b| b.kind == BuildingKind::Gate).unwrap();
    world.buildings[gate].closed = Some(true);
    assert_ne!(walls_key(&world), before);
    assert!(walls_key(&world).contains("w8-11@8,11:c1!"));
    assert_eq!(
        foreign_wall(&world, Some("r1"), Some("w5-5")).err().as_deref(),
        Some("that is one of your own walls")
    );
    assert!(foreign_wall(&world, Some("r2"), Some("w5-5")).is_ok());
    assert_eq!(
        foreign_wall(&world, Some("r2"), Some("c1-hall")).err().as_deref(),
        Some("no such wall or gate")
    );
}
