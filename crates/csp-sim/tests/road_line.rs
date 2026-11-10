//! `apps/server/src/road-line.test.ts`, ported (T86.6): the line's tiles, the order's checks and
//! the walks that build a line tile by tile, with every invariant checked after each tick. The
//! restart halfway needs the saves of `csp-server` and is tested there.

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_MATERIALS, ROAD_LINE_MAX_TILES};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Good, ResidentOrder, SkillName, Stock, WorldState};
use csp_sim::invariants::invariant_named;
use csp_sim::pathfinding::{PathFinder, PathOptions, PathResult, WALKING_COSTS};
use csp_sim::queries::building::{road_at, road_line};
use csp_sim::walls::wall_map;
use serde_json::json;
use std::sync::Arc;

/// A square map drawn as text (sides join): . plains, ^ mountain, ~ lake.
fn draw(rows: &[String]) -> TerrainMap {
    let tiles = rows
        .concat()
        .chars()
        .map(|c| match c {
            '.' => Terrain::Plains as u8,
            '^' => Terrain::Mountain as u8,
            '~' => Terrain::Lake as u8,
            other => panic!("no terrain {other}"),
        })
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

/// A world on `map` with realm r1 (Player 7) and its resident w1 at (x, y), carrying `stone`.
fn setup(map: &TerrainMap, x: f64, y: f64, stone: f64) -> (WorldState, Orders) {
    let mut world = empty_world(map);
    world.realms.push(realm("r1", 7, "w1"));
    let mut r = new_resident("w1", Some("r1"), x, y);
    r.carried = Stock::from([(Good::Stone, stone)]);
    world.residents.push(r);
    (world, Orders::default())
}

fn stone() -> f64 {
    BUILD_MATERIALS.get("road").unwrap().get("stone").unwrap()
}

fn line(
    kind: &str,
    resident_id: &str,
    from: serde_json::Value,
    to: serde_json::Value,
) -> serde_json::Value {
    json!({ "kind": kind, "residentId": resident_id, "from": from, "to": to })
}

#[test]
fn runs_from_end_to_end_with_each_tile_next_to_the_one_before() {
    assert_eq!(road_line((1, 1), (4, 1), 10), [(1, 1), (2, 1), (3, 1), (4, 1)]);
    assert_eq!(road_line((0, 0), (3, 2), 10), [(0, 0), (1, 1), (2, 1), (3, 2)]);
    assert_eq!(road_line((2, 2), (2, 2), 10), [(2, 2)]);
}

#[test]
fn steps_diagonally_0_0_to_5_5_is_6_tiles_each_a_diagonal_step_on() {
    let l = road_line((0, 0), (5, 5), 10);
    assert_eq!(l.len(), 6);
    assert_eq!(l[0], (0, 0));
    assert_eq!(*l.last().unwrap(), (5, 5));
    for w in l.windows(2) {
        assert_eq!((w[1].0 - w[0].0, w[1].1 - w[0].1), (1, 1));
    }
    // Any way round, every tile is one step on from the one before.
    for to in [(7, 3), (2, 8), (9, 6)] {
        let tiles = road_line((4, 4), to, 10);
        assert_eq!(*tiles.last().unwrap(), to);
        for w in tiles.windows(2) {
            assert_eq!((w[0].0 - w[1].0).abs().max((w[0].1 - w[1].1).abs()), 1);
        }
    }
}

#[test]
fn goes_the_short_way_round_the_map() {
    assert_eq!(road_line((8, 0), (1, 0), 10), [(8, 0), (9, 0), (0, 0), (1, 0)]);
}

#[test]
fn rejects_lines_it_cant_build_and_orders_it_cant_give() {
    let mut rows = vec![".".repeat(10); 10];
    rows[1] = "...~......".into();
    let map = draw(&rows);
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 3.0 * stone());
    let me = player(7);
    let send = |world: &WorldState, orders: &mut Orders, to: serde_json::Value, id: &str| {
        orders.receive(world, &me, line("roadLine", id, json!({ "x": 1, "y": 1 }), to), &map)
    };
    let reason = send(&world, &mut orders, json!({ "x": 5, "y": 1 }), "w1").unwrap_err();
    assert!(reason.contains("(3, 1)"), "{reason}");
    assert!(send(&world, &mut orders, json!({ "x": 1.5, "y": 1 }), "w1").is_err());
    assert_eq!(
        send(&world, &mut orders, json!({ "x": 1, "y": 2 }), "nobody"),
        Err("not one of your residents".into())
    );
    world.residents[0].born_at = world.tick as f64;
    assert_eq!(
        send(&world, &mut orders, json!({ "x": 1, "y": 2 }), "w1"),
        Err("children can’t build".into())
    );
}

#[test]
fn covers_at_most_road_line_max_tiles_tiles() {
    let size = 3 * ROAD_LINE_MAX_TILES as usize;
    let map = draw(&vec![".".repeat(size); size]);
    let (world, mut orders) = setup(&map, 1.0, 1.0, 3.0 * stone());
    let me = player(7);
    let end = |n: f64| json!({ "x": n, "y": 1 });
    let from = json!({ "x": 1, "y": 1 });
    assert_eq!(
        orders.receive(
            &world,
            &me,
            line("roadLine", "w1", from.clone(), end(ROAD_LINE_MAX_TILES)),
            &map
        ),
        Ok(())
    );
    assert!(orders
        .receive(&world, &me, line("roadLine", "w1", from, end(ROAD_LINE_MAX_TILES + 1.0)), &map)
        .is_err());
}

#[test]
fn a_wall_line_skips_tiles_with_a_wall_or_gate_and_checks_the_rest_like_a_wall() {
    let rows: Vec<String> =
        (0..10).map(|y| if y == 5 { ".^........".into() } else { ".".repeat(10) }).collect();
    let map = draw(&rows);
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 0.0);
    world.buildings.push(building("old", BuildingKind::Gate, 2.0, 1.0));
    let me = player(7);
    let from = json!({ "x": 1, "y": 1 });
    let reason = orders
        .receive(&world, &me, line("wallLine", "w1", from.clone(), json!({ "x": 1, "y": 6 })), &map)
        .unwrap_err();
    assert!(reason.contains("(1, 5)"), "{reason}");
    assert_eq!(
        orders.receive(&world, &me, line("wallLine", "w1", from, json!({ "x": 3, "y": 1 })), &map),
        Ok(())
    );
    orders.apply_all(&mut world, &map);
    assert_eq!(
        serde_json::to_value(&world.residents[0].order).unwrap()["tiles"],
        json!([[1.0, 1.0], [2.0, 1.0], [3.0, 1.0]])
    );
}

#[test]
fn builds_the_wall_line_that_skips_a_wall_or_gate() {
    let rows: Vec<String> =
        (0..10).map(|y| if y == 5 { ".^........".into() } else { ".".repeat(10) }).collect();
    let map = draw(&rows);
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 0.0);
    world.buildings.push(building("old", BuildingKind::Gate, 2.0, 1.0));
    let from = json!({ "x": 1, "y": 1 });
    let o = line("wallLine", "w1", from, json!({ "x": 3, "y": 1 }));
    assert_eq!(orders.receive(&world, &player(7), o, &map), Ok(()));
    orders.apply_all(&mut world, &map);
    at(&mut world, "w1").carried = Stock::from([(Good::Wood, 3.0 * wood())]);
    run_walking(&mut world, &map, 40_000, |w| w.residents[0].order.is_none());
    for x in [1, 3] {
        let wall = wall_at(&world, x, 1).expect("a wall");
        assert!(wall.site.is_none());
    }
    let on_2_1: Vec<&str> = world
        .buildings
        .iter()
        .filter(|b| b.x == 2.0 && b.y == 1.0)
        .map(|b| b.id.as_str())
        .collect();
    assert_eq!(on_2_1, ["old"]);
}

fn wood() -> f64 {
    BUILD_MATERIALS.get("wall").unwrap().get("wood").unwrap()
}

fn wall_at(world: &WorldState, x: i32, y: i32) -> Option<&csp_shared::world::Building> {
    world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Wall && b.x == f64::from(x) && b.y == f64::from(y))
}

fn finished(world: &WorldState, x: i32, y: i32) -> bool {
    road_at(world, x, y).is_some_and(|b| b.site.is_none())
}

fn open() -> TerrainMap {
    draw(&vec![".".repeat(10); 10])
}

fn order_json(world: &WorldState) -> serde_json::Value {
    serde_json::to_value(&world.residents[0].order).unwrap()
}

/// Gives w1 a road order and runs the tick that starts it.
fn road_order(
    world: &mut WorldState,
    orders: &mut Orders,
    map: &TerrainMap,
    from: (i32, i32),
    to: (i32, i32),
) -> Answer {
    let o = line(
        "roadLine",
        "w1",
        json!({ "x": from.0, "y": from.1 }),
        json!({ "x": to.0, "y": to.1 }),
    );
    let answer = orders.receive(world, &player(7), o, map);
    orders.apply_all(world, map);
    answer
}

#[test]
fn builds_the_line_of_road_tiles_one_after_another_then_is_done() {
    let map = open();
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 3.0 * stone());
    assert_eq!(road_order(&mut world, &mut orders, &map, (2, 1), (4, 1)), Ok(()));
    let o = order_json(&world);
    assert_eq!(o["kind"], "roadLine");
    assert_eq!(o["phase"], "walking");
    assert_eq!(o["tiles"], json!([[2.0, 1.0], [3.0, 1.0], [4.0, 1.0]]));
    let mut done_at: [Option<u64>; 5] = [None; 5];
    run_walking(&mut world, &map, 20_000, |w| {
        for x in [2usize, 3, 4] {
            if done_at[x].is_none() && finished(w, x as i32, 1) {
                done_at[x] = Some(w.tick);
            }
        }
        w.residents[0].order.is_none()
    });
    assert!(world.residents[0].order.is_none());
    for x in [2, 3, 4] {
        assert!(finished(&world, x, 1));
    }
    assert!(done_at[2] < done_at[3] && done_at[3] < done_at[4]);
    let r = &world.residents[0];
    assert_eq!(r.carried.get(&Good::Stone).copied().unwrap_or(0.0), 0.0);
    assert!(r.skills.get(&SkillName::Construction).copied().unwrap_or(0.0) > 0.0);
    assert_eq!((r.x, r.y), (4.0, 1.0));
}

#[test]
fn skips_a_tile_that_has_a_road_already() {
    let map = open();
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 2.0 * stone());
    world.buildings.push(building("old", BuildingKind::Road, 2.0, 1.0));
    road_order(&mut world, &mut orders, &map, (1, 1), (3, 1)).unwrap();
    run_walking(&mut world, &map, 20_000, |w| w.residents[0].order.is_none());
    let finished_roads =
        world.buildings.iter().filter(|b| b.kind == BuildingKind::Road && b.site.is_none()).count();
    assert_eq!(finished_roads, 3);
    let on_2: Vec<&str> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Road && b.x == 2.0)
        .map(|b| b.id.as_str())
        .collect();
    assert_eq!(on_2, ["old"]);
}

#[test]
fn waits_on_a_site_for_materials_it_doesnt_carry() {
    let map = open();
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 0.0);
    road_order(&mut world, &mut orders, &map, (1, 1), (2, 1)).unwrap();
    run_walking(&mut world, &map, 3000, |_| false);
    let o = order_json(&world);
    assert_eq!((o["kind"].clone(), o["phase"].clone()), (json!("roadLine"), json!("building")));
    assert_eq!(o["tiles"], json!([[1.0, 1.0], [2.0, 1.0]]));
    let site = road_at(&world, 1, 1).unwrap().site.as_ref().unwrap();
    assert!(site.delivered.is_empty());
}

#[test]
fn lays_out_and_builds_every_tile_of_a_line_across_mountain() {
    let mut rows = vec![".".repeat(10); 10];
    rows[1] = "..^^^.....".into();
    let map = draw(&rows);
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 5.0 * stone());
    assert_eq!(road_order(&mut world, &mut orders, &map, (1, 1), (5, 1)), Ok(()));
    let tiles: Vec<serde_json::Value> = (1..=5).map(|x| json!([f64::from(x), 1.0])).collect();
    assert_eq!(order_json(&world)["tiles"], json!(tiles));
    run_walking(&mut world, &map, 40_000, |w| w.residents[0].order.is_none());
    assert!(world.residents[0].order.is_none());
    for x in 1..=5 {
        assert!(finished(&world, x, 1));
    }
}

#[test]
fn is_checked_by_an_invariant() {
    let map = open();
    let (mut world, _) = setup(&map, 1.0, 1.0, 3.0 * stone());
    world.residents[0].order = Some(
        serde_json::from_value(json!({
            "kind": "roadLine", "tiles": [[1, 1], [3, 1]], "phase": "building", "path": null,
            "progress": 0, "siteId": "nowhere"
        }))
        .unwrap(),
    );
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::RoadLine(_))));
    let found = invariant_named("line-orders-sound").unwrap().check(&world, &map);
    let messages: Vec<&str> = found.iter().map(|v| v.message.as_str()).collect();
    assert_eq!(
        messages,
        [
            "resident w1 has a road order whose tile 1 is not a step on from the one before",
            "resident w1 builds nowhere, which is not the road site on their tile and the order\u{2019}s next"
        ]
    );
}

#[test]
fn builds_wall_diagonally_tile_by_tile_and_nobody_steps_diagonally_through_it() {
    let map = open();
    let (mut world, mut orders) = setup(&map, 1.0, 1.0, 0.0);
    world.residents[0].carried = Stock::from([(Good::Wood, 4.0 * wood())]);
    let o = line("wallLine", "w1", json!({ "x": 2, "y": 2 }), json!({ "x": 5, "y": 5 }));
    assert_eq!(orders.receive(&world, &player(7), o, &map), Ok(()));
    orders.apply_all(&mut world, &map);
    let o = order_json(&world);
    assert_eq!(o["kind"], "wallLine");
    assert_eq!(o["tiles"], json!([[2.0, 2.0], [3.0, 3.0], [4.0, 4.0], [5.0, 5.0]]));
    let mut done_at: [Option<u64>; 6] = [None; 6];
    run_walking(&mut world, &map, 40_000, |w| {
        for x in [2usize, 3, 4, 5] {
            let finished = wall_at(w, x as i32, x as i32).is_some_and(|b| b.site.is_none());
            if done_at[x].is_none() && finished {
                done_at[x] = Some(w.tick);
            }
        }
        w.residents[0].order.is_none()
    });
    assert!(world.residents[0].order.is_none());
    for x in [2, 3, 4, 5] {
        assert!(wall_at(&world, x, x).unwrap().site.is_none());
    }
    let order: Vec<u64> = [2, 3, 4, 5].iter().map(|&x| done_at[x].unwrap()).collect();
    assert!(order.windows(2).all(|w| w[0] <= w[1]), "{order:?}");
    assert_eq!(world.residents[0].carried.get(&Good::Wood).copied().unwrap_or(0.0), 0.0);

    // From (4, 3) to (3, 4) is one diagonal step across the line, between the walls on (3, 3)
    // and (4, 4): closed, so the way goes round an end of the line.
    let mut finder = PathFinder::new(Arc::new(map.clone()));
    finder.set_walls(Some(Arc::new(wall_map(&world, &map))));
    match finder.find_path((4, 3), (3, 4), &WALKING_COSTS, PathOptions::default()) {
        PathResult::Found { path, .. } => {
            assert!(path.len() > 1);
            assert!(!path.iter().any(|&(x, y)| wall_at(&world, x, y).is_some()));
        }
        other => panic!("no way found: {other:?}"),
    }
}
