//! The gate order's and walking's cases of `apps/server/src/walls.test.ts` ("the gate order", "a
//! walker finds a new way when a gate closes before them", the gate cases of "allies at walls and
//! gates"). The wall map's own cases and wall defence are T86.6's and T86.7's; `gatesSound` is
//! T86.13's.

use std::sync::Arc;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, ConstructionSite, ResidentOrder, Tile, WalkOrder, WorldState,
};
use serde_json::json;

use crate::movement_test_world::{add_city, building, order_from, plains, realm, resident};
use crate::pathfinding::{PathFinder, PathOptions, PathResult, Point, WALKING_COSTS};
use crate::tick::Scratch;
use crate::walking::{StepAction, Walking};
use crate::walls::{wall_map, walls_key};
use crate::world::create_world;

const GATE: (f64, f64) = (8.0, 11.0);

fn terrain() -> TerrainMap {
    plains(512)
}

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
            let kind = if (x, y) == GATE { BuildingKind::Gate } else { BuildingKind::Wall };
            let mut b = building(&format!("w{x}-{y}"), kind, x, y);
            b.city_id = Some("c1".into());
            world.buildings.push(b);
        }
    }
    world
}

fn gate(world: &mut WorldState) -> &mut csp_shared::world::Building {
    world.buildings.iter_mut().find(|b| b.kind == BuildingKind::Gate).expect("the gate")
}

/// The path from one tile to another for `realm_id` on foot, or None when there is none.
fn path(
    world: &WorldState,
    terrain: &TerrainMap,
    from: Point,
    to: Point,
    realm_id: Option<&str>,
) -> Option<Vec<Point>> {
    let mut finder = PathFinder::new(Arc::new(terrain.clone()));
    finder.set_walls(Some(Arc::new(wall_map(world, terrain))));
    let options = PathOptions {
        realm_id: realm_id.map(str::to_string),
        on_walls: true,
        ..PathOptions::default()
    };
    match finder.find_path(from, to, &WALKING_COSTS, options) {
        PathResult::Found { path, .. } => Some(path),
        _ => None,
    }
}

/// An alliance of r1 and r2 called North.
fn ally(world: &mut WorldState) {
    let alliance = json!({
        "id": "alliance-1", "name": "North", "leaderId": "r1",
        "members": [{"realmId": "r1", "joinedAt": 0, "leaving": null}, {"realmId": "r2", "joinedAt": 0, "leaving": null}],
        "invites": [], "army": []
    });
    world.alliances.push(serde_json::from_value(alliance).expect("an alliance"));
}

fn send(
    world: &mut WorldState,
    terrain: &TerrainMap,
    user_id: u64,
    o: serde_json::Value,
) -> String {
    let mut base = json!({"kind": "setGate"});
    base.as_object_mut().expect("an object").extend(o.as_object().expect("an object").clone());
    match order_from(world, terrain, user_id, base) {
        Ok(()) => "ack".into(),
        Err(reason) => reason,
    }
}

#[test]
fn a_walker_finds_a_new_way_when_a_gate_closes_before_them() {
    let terrain = terrain();
    let mut world = setup(&terrain);
    world.residents.push(resident("b1", Some("r2"), 8.0, 14.0));
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let walk = |world: &WorldState| match &world.residents[0].order {
        Some(ResidentOrder::WalkTo(o)) => Some(o.clone()),
        _ => None,
    };
    world.residents[0].order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: 8.0, y: 8.0 },
        path: None,
        progress: 0.0,
        army: None,
    }));
    walking.request_steps(&mut world, &mut scratch, 50.0);
    assert_eq!(
        walk(&world).and_then(|o| o.path).and_then(|p| p.first().copied()),
        Some((8.0, 13.0))
    );
    if let Some(ResidentOrder::WalkTo(o)) = &mut world.residents[0].order {
        o.path = Some(vec![(8.0, 12.0), GATE]);
    }
    world.residents[0].y = 12.0;
    gate(&mut world).closed = Some(true);
    let step = StepAction { resident_id: "b1".into(), to: GATE, carriage_id: None, horse_id: None };
    walking.resolve(&mut world, &mut scratch, &[step]);
    assert_eq!((world.residents[0].x, world.residents[0].y), (8.0, 12.0));
    let o = walk(&world).expect("still walking");
    assert_eq!((o.path, o.progress), (None, 0.0));
    // With the gate shut there is no way in, so the order ends once the search has looked
    // everywhere, which on this map takes a few ticks.
    for _ in 0..20 {
        if world.residents[0].order.is_none() {
            break;
        }
        walking.request_steps(&mut world, &mut scratch, 50.0);
    }
    assert_eq!(world.residents[0].order, None);
}

#[test]
fn a_member_passes_an_allys_closed_gate_and_the_way_changes_when_the_alliance_does() {
    let terrain = terrain();
    let mut world = setup(&terrain);
    ally(&mut world);
    gate(&mut world).closed = Some(true);
    assert!(path(&world, &terrain, (8, 14), (8, 8), Some("r2"))
        .expect("a way in")
        .contains(&(8, 11)));
    assert_eq!(path(&world, &terrain, (8, 14), (8, 8), None), None);
    let before = walls_key(&world);
    world.alliances[0].members.pop();
    assert_ne!(walls_key(&world), before);
    assert_eq!(path(&world, &terrain, (8, 14), (8, 8), Some("r2")), None);
}

#[test]
fn only_the_citys_own_realm_opens_and_closes_its_gates() {
    let terrain = terrain();
    let mut world = setup(&terrain);
    ally(&mut world);
    let id = gate(&mut world).id.clone();
    assert_eq!(
        send(&mut world, &terrain, 8, json!({"gateId": id, "open": false})),
        "not a gate of your cities"
    );
}

#[test]
fn the_citys_realm_opens_and_closes_its_gates() {
    let terrain = terrain();
    let mut world = setup(&terrain);
    let id = gate(&mut world).id.clone();
    assert_eq!(send(&mut world, &terrain, 7, json!({"gateId": id, "open": false})), "ack");
    assert_eq!(gate(&mut world).closed, Some(true));
    assert_eq!(send(&mut world, &terrain, 7, json!({"gateId": id, "open": true})), "ack");
    assert_eq!(gate(&mut world).closed, None);
}

#[test]
fn only_for_a_finished_gate_of_one_of_your_cities() {
    let terrain = terrain();
    let mut world = setup(&terrain);
    let id = gate(&mut world).id.clone();
    assert_eq!(
        send(&mut world, &terrain, 8, json!({"gateId": id, "open": false})),
        "not a gate of your cities"
    );
    assert_eq!(
        send(&mut world, &terrain, 7, json!({"gateId": "w5-5", "open": false})),
        "no such gate"
    );
    assert_eq!(
        send(&mut world, &terrain, 7, json!({"gateId": id})),
        "say whether the gate should be open"
    );
    gate(&mut world).site = Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
    assert_eq!(
        send(&mut world, &terrain, 7, json!({"gateId": id, "open": false})),
        "that gate is not finished yet"
    );
    assert_eq!(gate(&mut world).closed, None);
}
