//! `apps/server/src/road-line.test.ts`, ported (T86.6) as far as it runs without walking: the
//! line's tiles and the order's checks. The tests that walk the line tile by tile (and the restart
//! halfway, and the invariant) need walking, saves and the invariants (T86.4, T87, T86.13) and
//! come with the differential run (T86.14).

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_MATERIALS, ROAD_LINE_MAX_TILES};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Good, Stock, WorldState};
use csp_sim::queries::building::road_line;
use serde_json::json;

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
    // TODO(T86.4): walking the line; the walls built on (1, 1) and (3, 1), the gate left.
}
