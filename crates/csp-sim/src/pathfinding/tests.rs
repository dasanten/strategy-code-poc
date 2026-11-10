//! `apps/server/src/pathfinding.test.ts`, one test for each of its tests, and the path fixtures.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use csp_shared::balance::{PATH_DETOUR_LIMIT, PATH_DETOUR_SLACK};
use csp_shared::terrain::{
    beside_step, is_passable_terrain, step_length, terrain_at, wrap, Terrain, TerrainMap,
    DIAGONAL_STEP,
};
use serde_json::Value;

use super::*;
use crate::walls::{WallMap, WallTile};

fn walking() -> &'static TerrainCosts {
    &WALKING_COSTS
}

fn carriage() -> &'static TerrainCosts {
    &CARRIAGE_COSTS
}

fn find(finder: &mut PathFinder, from: Point, to: Point) -> PathResult {
    finder.find_path(from, to, walking(), PathOptions::default())
}

fn path_of(r: &PathResult) -> &[Point] {
    match r {
        PathResult::Found { path, .. } => path,
        other => panic!("expected a path, got {other:?}"),
    }
}

fn cost_of(r: &PathResult) -> f64 {
    match r {
        PathResult::Found { cost, .. } => *cost,
        other => panic!("expected a path, got {other:?}"),
    }
}

fn close(a: f64, b: f64, digits: i32) -> bool {
    // vitest's `toBeCloseTo`: |a - b| < 10^-digits / 2.
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

/// A square map drawn as text (its sides join): . plains, f forest, h hills, m mountain, ~ lake.
fn draw(rows: &[&str]) -> TerrainMap {
    let tiles = rows
        .concat()
        .chars()
        .map(|c| match c {
            '.' => Terrain::Plains,
            'f' => Terrain::Forest,
            'h' => Terrain::Hills,
            'm' => Terrain::Mountain,
            '~' => Terrain::Lake,
            _ => panic!("no terrain drawn as {c}"),
        } as u8)
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

/// Checks a path step by step: each to one of the eight tiles around (across the joins too), all
/// enterable, never cutting a corner past land that can't be entered, ending at the goal.
fn check_path(
    map: &TerrainMap,
    from: Point,
    to: Point,
    path: &[Point],
    costs: &TerrainCosts,
) -> f64 {
    let (mut x, mut y) = from;
    let mut cost = 0.0;
    for &(nx, ny) in path {
        let length = step_length(map.size, x, y, nx, ny);
        assert!(length > 0.0, "({x}, {y}) to ({nx}, {ny}) is no step");
        for side in beside_step(map.size, x, y, nx, ny) {
            assert!(costs.get(map.tiles[side]) < f64::INFINITY);
        }
        let t = terrain_at(map, nx, ny);
        assert!(is_passable_terrain(t));
        assert!(costs.get(t) < f64::INFINITY);
        cost += costs.get(t) * length;
        (x, y) = (nx, ny);
    }
    assert_eq!((x, y), (wrap(to.0, map.size), wrap(to.1, map.size)));
    cost
}

/// Lake along the top and bottom rows, so no way leads round the north–south join.
fn drawn_map() -> TerrainMap {
    draw(&[
        "~~~~~~~~~",
        ".........",
        "...mmm...",
        "...m~m...",
        "...m~m...",
        "...m~m...",
        "...fff...",
        ".........",
        "~~~~~~~~~",
    ])
}

mod on_a_drawn_map {
    use super::*;

    #[test]
    fn takes_the_cheapest_way_not_the_shortest() {
        let map = drawn_map();
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        // Straight down is lake; over the mountains costs ~16, around them on plains 10.
        let r = find(&mut finder, (4, 1), (4, 7));
        let cost = check_path(&map, (4, 1), (4, 7), path_of(&r), walking());
        assert!(close(cost_of(&r), cost, 2));
        assert!(!path_of(&r)
            .iter()
            .any(|&(x, y)| terrain_at(&map, x, y) == Terrain::Mountain as u8));
    }

    #[test]
    fn never_puts_lakes_or_sea_on_a_path_and_says_when_there_is_no_way() {
        let mut finder = PathFinder::new(Arc::new(drawn_map()));
        assert_eq!(find(&mut finder, (4, 1), (4, 4)), PathResult::Unreachable); // into the lake
        assert_eq!(find(&mut finder, (4, 1), (0, 0)), PathResult::Unreachable); // onto the lake row
        assert_eq!(
            find(&mut finder, (4, 1), (4, 1)),
            PathResult::Found { path: vec![], cost: 0.0 }
        );
    }

    #[test]
    fn keeps_carriages_out_of_the_mountains() {
        let mut finder = PathFinder::new(Arc::new(drawn_map()));
        let o = PathOptions::default;
        assert_eq!(finder.find_path((4, 1), (4, 2), carriage(), o()), PathResult::Unreachable);
        assert_eq!(finder.find_path((4, 1), (4, 2), walking(), o()).status(), "found");
    }

    #[test]
    fn takes_the_short_way_across_a_join() {
        // Lake everywhere between the two plains columns, which meet across the east–west join.
        let strip = Arc::new(draw(&[".~~~~~~~."; 9]));
        let r = find(&mut PathFinder::new(strip.clone()), (0, 4), (8, 4));
        assert_eq!(r, PathResult::Found { path: vec![(8, 4)], cost: 1.0 });
        // Coordinates past a side mean the same tiles.
        assert_eq!(find(&mut PathFinder::new(strip), (9, 4), (-1, 4)), r);
    }

    #[test]
    fn hands_out_each_finished_result_once_and_forgets_cancelled_requests() {
        let mut finder = PathFinder::new(Arc::new(drawn_map()));
        finder.request("a", (1, 2), (7, 2), walking(), PathOptions::default());
        finder.request("b", (1, 2), (7, 6), walking(), PathOptions::default());
        finder.cancel("b");
        assert_eq!(finder.result("a"), Some(PathResult::Searching));
        finder.advance(1000.0);
        assert_eq!(finder.pending(), 0);
        assert_eq!(finder.result("a").map(|r| r.status()), Some("found"));
        assert_eq!(finder.result("a"), None);
        assert_eq!(finder.result("b"), None);
    }
}

/// A square map of one terrain.
fn blank(size: i32, terrain: Terrain) -> TerrainMap {
    TerrainMap { size, tiles: vec![terrain as u8; (size * size) as usize] }
}

fn paint(map: &mut TerrainMap, x: i32, y: i32, t: Terrain) {
    map.tiles[(y * map.size + x) as usize] = t as u8;
}

/// A wall of nobody's on each of the given tiles.
fn walls_on(size: i32, tiles: &[usize]) -> Option<Arc<WallMap>> {
    Some(Arc::new(WallMap {
        size,
        tiles: tiles.iter().map(|&t| (t, WallTile::wall())).collect(),
        inside: Default::default(),
    }))
}

/// A clock that moves on 1 ms each time it is read.
fn counter() -> impl FnMut() -> f64 {
    let mut t = 0.0;
    move || {
        let now = t;
        t += 1.0;
        now
    }
}

/// One turn of the finder's loop: one request checked, or one batch of one search.
fn one_turn(finder: &mut PathFinder) {
    finder.advance_with(2.0, &mut counter());
}

mod settling_requests_before_any_search {
    use super::*;

    #[test]
    fn a_goal_on_land_the_start_can_never_reach_is_unreachable_at_once() {
        // An island in a lake, and an island ringed by mountains: open plains all round.
        let mut map = blank(200, Terrain::Plains);
        for i in 0..=20 {
            for (x, y) in [(i, 0), (i, 20), (0, i), (20, i)] {
                paint(&mut map, 140 + x, 140 + y, Terrain::Lake);
                paint(&mut map, 40 + x, 140 + y, Terrain::Mountain);
            }
        }
        let mut finder = PathFinder::new(Arc::new(map));
        finder.request("island", (20, 20), (150, 150), walking(), PathOptions::default());
        one_turn(&mut finder);
        assert_eq!(finder.result("island"), Some(PathResult::Unreachable));
        // On foot, over the mountains.
        assert_eq!(find(&mut finder, (20, 20), (50, 150)).status(), "found");
        // A carriage needs a road over them (`CONTEXT.md`: Road), so it has to search.
        let o = PathOptions::default;
        assert_eq!(finder.find_path((20, 20), (50, 150), carriage(), o()), PathResult::Unreachable);
        finder.set_roads([200 * 140 + 50]);
        assert_eq!(finder.find_path((20, 20), (50, 150), carriage(), o()).status(), "found");
    }

    #[test]
    fn an_attacker_needs_only_reachable_land_next_to_the_goal() {
        let mut map = blank(64, Terrain::Plains);
        for x in 0..64 {
            paint(&mut map, x, 0, Terrain::Lake);
            paint(&mut map, x, 32, Terrain::Lake);
        }
        let mut finder = PathFinder::new(Arc::new(map));
        // Across the lake from the start, a row off its shore.
        let near = || PathOptions { near: true, ..PathOptions::default() };
        assert_eq!(find(&mut finder, (10, 10), (10, 33)), PathResult::Unreachable);
        assert_eq!(
            finder.find_path((10, 10), (10, 33), walking(), near()),
            PathResult::Unreachable
        );
        // On the lake itself, but beside the start's shore.
        assert_eq!(finder.find_path((10, 10), (10, 32), walking(), near()).status(), "found");
    }

    #[test]
    fn gives_up_on_a_way_dearer_than_the_detour_limit_allows() {
        // Lake columns with gaps at alternate ends: the corridors between them make one long
        // winding way. Lake round the edges, so no way leads across the joins.
        let mut map = blank(100, Terrain::Plains);
        for i in 0..100 {
            paint(&mut map, i, 0, Terrain::Lake);
            paint(&mut map, i, 99, Terrain::Lake);
            paint(&mut map, 99, i, Terrain::Lake);
        }
        for x in (1..99).step_by(2) {
            let gap = if ((x - 1) / 2) % 2 == 0 { 1 } else { 98 };
            for y in 1..99 {
                if y != gap {
                    paint(&mut map, x, y, Terrain::Lake);
                }
            }
        }
        let mut finder = PathFinder::new(Arc::new(map));
        // Two corridors over: about 200 steps, well within the limit.
        assert_eq!(find(&mut finder, (0, 50), (4, 50)).status(), "found");
        // Twenty corridors over: about 2000 steps for 40 as the crow flies, past the limit.
        const { assert!(PATH_DETOUR_LIMIT * 40.0 + PATH_DETOUR_SLACK < 1900.0) };
        assert_eq!(find(&mut finder, (0, 50), (40, 50)), PathResult::Unreachable);
    }

    #[test]
    fn forgets_walls_that_are_gone_when_the_walls_change() {
        let column = |x: usize| (0..9).map(move |y| y * 9 + x);
        let mut finder = PathFinder::new(Arc::new(blank(9, Terrain::Plains)));
        // Walls on two columns shut the way off, across the join too.
        let both: Vec<usize> = column(0).chain(column(4)).collect();
        finder.set_walls(walls_on(9, &both));
        assert_eq!(find(&mut finder, (2, 4), (6, 4)), PathResult::Unreachable);
        finder.set_walls(walls_on(9, &column(0).collect::<Vec<_>>()));
        assert_eq!(cost_of(&find(&mut finder, (2, 4), (6, 4))), 4.0);
        finder.set_walls(None);
        assert_eq!(cost_of(&find(&mut finder, (2, 4), (6, 4))), 4.0);
    }
}

mod stepping_diagonally {
    use super::*;

    #[test]
    fn goes_diagonally_across_open_plains_each_diagonal_step_costing_root_2() {
        let map = blank(20, Terrain::Plains);
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        let r = find(&mut finder, (2, 2), (7, 7));
        assert_eq!(path_of(&r), [(3, 3), (4, 4), (5, 5), (6, 6), (7, 7)]);
        assert!(close(cost_of(&r), 5.0 * DIAGONAL_STEP, 4));
        // Slanting: two diagonal steps and three straight ones.
        let slant = find(&mut finder, (2, 2), (7, 4));
        assert_eq!(path_of(&slant).len(), 5);
        assert!(close(cost_of(&slant), 3.0 + 2.0 * DIAGONAL_STEP, 4));
        let checked = check_path(&map, (2, 2), (7, 4), path_of(&slant), walking());
        assert!(close(checked, 3.0 + 2.0 * DIAGONAL_STEP, 4));
    }

    #[test]
    fn goes_diagonally_across_a_join() {
        let mut finder = PathFinder::new(Arc::new(blank(20, Terrain::Plains)));
        assert_eq!(path_of(&find(&mut finder, (0, 0), (19, 19))), [(19, 19)]);
    }

    #[test]
    fn never_cuts_a_corner_past_a_wall_a_closed_gate_or_a_lake() {
        let at = |x: usize, y: usize| y * 20 + x;
        let gate = |closed: bool| {
            Some(Arc::new(WallMap {
                size: 20,
                tiles: HashMap::from([(at(4, 5), WallTile::gate(closed))]),
                inside: Default::default(),
            }))
        };
        let mut map = blank(20, Terrain::Plains);
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        // From (4, 4) to (5, 5); the straight tiles beside the step are (5, 4) and (4, 5).
        let way = |finder: &mut PathFinder| find(finder, (4, 4), (5, 5));
        assert_eq!(path_of(&way(&mut finder)), [(5, 5)]);
        finder.set_walls(walls_on(20, &[at(5, 4)]));
        let around = |path: Vec<Point>| PathResult::Found { path, cost: 2.0 };
        assert_eq!(way(&mut finder), around(vec![(4, 5), (5, 5)]));
        finder.set_walls(gate(true));
        assert_eq!(way(&mut finder), around(vec![(5, 4), (5, 5)]));
        // An open gate is in nobody's way.
        finder.set_walls(gate(false));
        assert_eq!(path_of(&way(&mut finder)), [(5, 5)]);
        finder.set_walls(None);
        // The TypeScript paints the lake into the finder's own map; here the map is shared and
        // fixed, so the finder is made anew on the painted one.
        paint(&mut map, 5, 4, Terrain::Lake);
        let mut finder = PathFinder::new(Arc::new(map));
        assert_eq!(way(&mut finder), around(vec![(4, 5), (5, 5)]));
    }

    #[test]
    fn keeps_a_carriage_from_cutting_a_corner_past_a_mountain_which_a_walker_may() {
        let mut map = blank(20, Terrain::Plains);
        paint(&mut map, 5, 4, Terrain::Mountain);
        let mut finder = PathFinder::new(Arc::new(map));
        assert_eq!(path_of(&find(&mut finder, (4, 4), (5, 5))), [(5, 5)]);
        let r = finder.find_path((4, 4), (5, 5), carriage(), PathOptions::default());
        assert_eq!(path_of(&r), [(4, 5), (5, 5)]);
    }

    #[test]
    fn a_diagonal_line_of_walls_keeps_everyone_out_like_a_straight_one() {
        // A diamond of walls round (10, 10), each touching the next only at a corner.
        let mut ring = Vec::new();
        for y in 0..21i32 {
            for x in 0..21i32 {
                if (x - 10).abs() + (y - 10).abs() == 4 {
                    ring.push((y * 21 + x) as usize);
                }
            }
        }
        let mut finder = PathFinder::new(Arc::new(blank(21, Terrain::Plains)));
        finder.set_walls(walls_on(21, &ring));
        assert_eq!(find(&mut finder, (0, 0), (10, 10)), PathResult::Unreachable);
        assert_eq!(find(&mut finder, (10, 10), (0, 0)), PathResult::Unreachable);
        assert_eq!(find(&mut finder, (10, 10), (12, 11)).status(), "found");
    }

    #[test]
    fn an_attacker_goes_diagonally_into_contact() {
        let mut finder = PathFinder::new(Arc::new(blank(20, Terrain::Plains)));
        let near = PathOptions { near: true, ..PathOptions::default() };
        let r = finder.find_path((2, 2), (8, 8), walking(), near);
        assert_eq!(path_of(&r), [(3, 3), (4, 4), (5, 5), (6, 6), (7, 7)]);
    }
}

mod lanes {
    use super::*;

    #[test]
    fn finds_a_short_path_while_a_long_search_is_under_way() {
        // Forest everywhere: dear ground, so a long search goes through a great many tiles.
        let map = Arc::new(blank(256, Terrain::Forest));
        let mut finder = PathFinder::with_local_side(map, 32);
        finder.request("long", (0, 0), (120, 120), walking(), PathOptions::default());
        finder.request("short", (200, 200), (205, 203), walking(), PathOptions::default());
        finder.advance_with(6.0, &mut counter());
        assert_eq!(finder.result("short").map(|r| r.status()), Some("found"));
        assert_eq!(finder.result("long"), Some(PathResult::Searching));
        while finder.pending() > 0 {
            finder.advance(f64::INFINITY);
        }
        assert_eq!(finder.result("long").map(|r| r.status()), Some("found"));
    }

    #[test]
    fn finds_a_short_path_whose_only_way_leaves_its_window() {
        // A lake wall between the ends, longer than the window: the way goes round outside it.
        let mut map = blank(256, Terrain::Plains);
        for y in 60..=140 {
            paint(&mut map, 100, y, Terrain::Lake);
        }
        let mut finder = PathFinder::with_local_side(Arc::new(map.clone()), 32);
        let r = find(&mut finder, (98, 100), (102, 100));
        let checked = check_path(&map, (98, 100), (102, 100), path_of(&r), walking());
        assert!(close(checked, cost_of(&r), 4));
        // 41 rows up past the lake's end and back down, slanting where that helps.
        assert!(cost_of(&r) > 2.0 * 41.0);
        assert!(cost_of(&r) < 4.0 + 2.0 * 41.0);
    }

    #[test]
    fn gives_the_same_paths_as_one_lane_for_the_whole_map() {
        let mut map = blank(128, Terrain::Plains);
        let mut seed: f64 = 5.0;
        let mut rnd = move || {
            seed = (seed * 16807.0) % 2147483647.0;
            seed / 2147483647.0
        };
        let rough = [Terrain::Forest, Terrain::Hills, Terrain::Lake];
        for i in 0..3000 {
            let x = (rnd() * 128.0).floor() as i32;
            let y = (rnd() * 128.0).floor() as i32;
            paint(&mut map, x, y, rough[i % 3]);
        }
        let map = Arc::new(map);
        let mut lanes = PathFinder::with_local_side(map.clone(), 32);
        let mut one = PathFinder::with_local_side(map, 128);
        for _ in 0..30 {
            let from = ((rnd() * 128.0).floor() as i32, (rnd() * 128.0).floor() as i32);
            let to = (
                from.0 + (rnd() * 16.0).floor() as i32 - 8,
                from.1 + (rnd() * 16.0).floor() as i32 - 8,
            );
            let a = find(&mut lanes, from, to);
            let b = find(&mut one, from, to);
            assert_eq!(a.status(), b.status());
            if let (PathResult::Found { cost: ca, .. }, PathResult::Found { cost: cb, .. }) =
                (&a, &b)
            {
                assert!(close(*ca, *cb, 2));
            }
        }
    }
}

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn fixture_terrain(name: &str, size: i32) -> TerrainMap {
    let tiles = std::fs::read(fixtures().join("terrain").join(name)).expect("terrain fixture");
    assert_eq!(tiles.len(), (size * size) as usize);
    TerrainMap { size, tiles }
}

/// `nearestFreeTile` of `world.ts` with nothing occupied: the walkable tile nearest (x, y), ring
/// by ring.
fn nearest_walkable(map: &TerrainMap, x: i32, y: i32) -> Point {
    for r in 0..map.size {
        for dy in -r..=r {
            for dx in -r..=r {
                if dx.abs().max(dy.abs()) != r {
                    continue;
                }
                let (tx, ty) = (wrap(x + dx, map.size), wrap(y + dy, map.size));
                if is_passable_terrain(terrain_at(map, tx, ty)) {
                    return (tx, ty);
                }
            }
        }
    }
    panic!("no walkable tile on the map")
}

/// The TypeScript runs these on `generateTerrain(1)`, the full 5760-tile map, which takes minutes
/// to make; here they run on the 1024-tile fixture map of seed 7, between places half the map
/// apart along each direction.
mod across_the_full_map {
    use super::*;

    fn ends(map: &TerrainMap) -> (Point, Point) {
        (
            nearest_walkable(map, 100, 100),
            nearest_walkable(map, 100 + map.size / 2, 100 + map.size / 2),
        )
    }

    #[test]
    fn finds_a_path_between_the_farthest_places_in_steps_that_stay_within_the_tick_budget() {
        let map = fixture_terrain("7-1024.bin", 1024);
        let (west, east) = ends(&map);
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        let budget_ms = 20.0;
        finder.request("across", west, east, walking(), PathOptions::default());
        // A clock that moves on 1 ms each time it is read: the finder reads it once per batch of
        // expansions, so how far it moves in one `advance` is how much work that step did.
        let reads = std::cell::Cell::new(0.0);
        let mut now = || {
            let t = reads.get();
            reads.set(t + 1.0);
            t
        };
        let mut worst: f64 = 0.0;
        let mut ticks = 0;
        let started = Instant::now();
        while finder.pending() > 0 {
            let start = reads.get();
            finder.advance_with(budget_ms, &mut now);
            worst = worst.max(reads.get() - start);
            ticks += 1;
            assert!(ticks < 100);
        }
        let took = started.elapsed();
        // It stops at its deadline: one batch per ms of budget, plus the readings that look for
        // short requests waiting.
        assert!(worst <= budget_ms + 2.0);
        let r = finder.result("across").expect("a result");
        let path = path_of(&r);
        eprintln!(
            "across 1024: {} steps, {ticks} ticks of {budget_ms} batches, {:.1} ms in all, {:.3} ms per batch of 1024",
            path.len(),
            took.as_secs_f64() * 1000.0,
            took.as_secs_f64() * 1000.0 / reads.get()
        );
        // Half the map along each direction: at least that many steps.
        assert!(path.len() >= 512);
        // The finder sums costs in 32-bit floats: close, not exact, over a path this long.
        assert!(close(check_path(&map, west, east, path, walking()), cost_of(&r), 1));
    }

    #[test]
    fn finds_a_carriage_path_across_with_no_mountain_on_it() {
        let map = fixture_terrain("7-1024.bin", 1024);
        let (west, east) = ends(&map);
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        let r = finder.find_path(west, east, carriage(), PathOptions::default());
        let path = path_of(&r);
        assert!(close(check_path(&map, west, east, path, carriage()), cost_of(&r), 1));
        assert!(!path.iter().any(|&(x, y)| terrain_at(&map, x, y) == Terrain::Mountain as u8));
    }
}

/// `fixtures/paths/requests.json`: the TypeScript's `findPath` for 200 requests on
/// `generateTerrain(1, 512)`, one finder per walls/roads setting kept across its requests.
#[test]
fn matches_the_path_fixtures_exactly() {
    let text = std::fs::read_to_string(fixtures().join("paths/requests.json")).expect("fixture");
    let fixture: Value = serde_json::from_str(&text).expect("fixture JSON");
    let size = fixture["size"].as_i64().unwrap() as i32;
    let terrain_file = fixture["terrain"].as_str().unwrap();
    let tiles = std::fs::read(fixtures().join(terrain_file)).expect("terrain fixture");
    let terrain = Arc::new(TerrainMap { size, tiles });
    let roads: Vec<usize> =
        fixture["roads"].as_array().unwrap().iter().map(|t| t.as_u64().unwrap() as usize).collect();
    let walls = &fixture["walls"];
    let walls = Arc::new(WallMap {
        size,
        tiles: walls["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| {
                let tile = w["tile"].as_u64().unwrap() as usize;
                (tile, serde_json::from_value(w.clone()).expect("a wall tile"))
            })
            .collect(),
        inside: walls["inside"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_u64().unwrap() as usize)
            .collect(),
    });
    let point = |v: &Value| (v[0].as_i64().unwrap() as i32, v[1].as_i64().unwrap() as i32);

    let mut finders: HashMap<(bool, bool), PathFinder> = HashMap::new();
    let mut found = 0;
    let started = Instant::now();
    let requests = fixture["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 200);
    for req in requests {
        let with_walls = req["walls"].as_bool().unwrap();
        let with_roads = req["roads"].as_bool().unwrap();
        let finder = finders.entry((with_walls, with_roads)).or_insert_with(|| {
            let mut f = PathFinder::new(terrain.clone());
            if with_walls {
                f.set_walls(Some(walls.clone()));
            }
            if with_roads {
                f.set_roads(roads.iter().copied());
            }
            f
        });
        let o = &req["options"];
        let options = PathOptions {
            realm_id: o["realmId"].as_str().map(str::to_string),
            on_walls: o["onWalls"].as_bool().unwrap_or(false),
            near: o["near"].as_bool().unwrap_or(false),
            area: None,
        };
        let costs = match req["costs"].as_str().unwrap() {
            "walking" => walking(),
            "carriage" => carriage(),
            other => panic!("no costs {other}"),
        };
        let r = finder.find_path(point(&req["from"]), point(&req["to"]), costs, options);
        let want = &req["result"];
        let id = &req["id"];
        assert_eq!(r.status(), want["status"].as_str().unwrap(), "request {id}");
        if let PathResult::Found { path, cost } = &r {
            found += 1;
            let want_path: Vec<Point> =
                want["path"].as_array().unwrap().iter().map(point).collect();
            assert_eq!(path, &want_path, "request {id}: path");
            assert_eq!(*cost, want["cost"].as_f64().unwrap(), "request {id}: cost");
        }
    }
    eprintln!(
        "200 fixture requests ({found} found) in {:.1} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    assert!(found > 50, "the fixture should hold a good many paths");
}

/// The fixture's requests all queued at once on each finder and worked off a few batches a tick
/// (`advance` with a budget of 8 on a clock that moves on 1 each time it is read), whole map and
/// 64-tile windows: each answers on the same tick as in the TypeScript, with the same path
/// length and cost. `ticks.txt` is written by `gen-ticks.mts` from the frozen TypeScript.
#[test]
fn answers_on_the_same_ticks_as_the_typescript() {
    let text = std::fs::read_to_string(fixtures().join("paths/requests.json")).expect("fixture");
    let fixture: Value = serde_json::from_str(&text).expect("fixture JSON");
    let tiles = std::fs::read(fixtures().join("terrain/1-512.bin")).expect("terrain fixture");
    let terrain = Arc::new(TerrainMap { size: 512, tiles });
    let roads: Vec<usize> =
        fixture["roads"].as_array().unwrap().iter().map(|t| t.as_u64().unwrap() as usize).collect();
    let w = &fixture["walls"];
    let walls = Arc::new(WallMap {
        size: 512,
        tiles: w["tiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| {
                let tile = w["tile"].as_u64().unwrap() as usize;
                (tile, serde_json::from_value(w.clone()).expect("a wall tile"))
            })
            .collect(),
        inside: w["inside"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_u64().unwrap() as usize)
            .collect(),
    });
    let point = |v: &Value| (v[0].as_i64().unwrap() as i32, v[1].as_i64().unwrap() as i32);
    let requests = fixture["requests"].as_array().unwrap();

    let mut lines = Vec::new();
    for local in [512, 64] {
        for (with_walls, with_roads) in [(true, true), (true, false), (false, true), (false, false)]
        {
            let mut f = PathFinder::with_local_side(terrain.clone(), local);
            if with_walls {
                f.set_walls(Some(walls.clone()));
            }
            if with_roads {
                f.set_roads(roads.iter().copied());
            }
            let reqs: Vec<&Value> = requests
                .iter()
                .filter(|r| r["walls"] == with_walls && r["roads"] == with_roads)
                .collect();
            for r in &reqs {
                let o = &r["options"];
                let options = PathOptions {
                    realm_id: o["realmId"].as_str().map(str::to_string),
                    on_walls: o["onWalls"].as_bool().unwrap_or(false),
                    near: o["near"].as_bool().unwrap_or(false),
                    area: None,
                };
                let costs = if r["costs"] == "walking" { walking() } else { carriage() };
                f.request(&r["id"].to_string(), point(&r["from"]), point(&r["to"]), costs, options);
            }
            let mut now = counter();
            let mut tick = 0;
            while f.pending() > 0 {
                f.advance_with(8.0, &mut now);
                for r in &reqs {
                    let id = r["id"].to_string();
                    let line = match f.result(&id) {
                        Some(PathResult::Found { path, cost }) => {
                            format!("found {} {}", path.len(), js_number(cost))
                        }
                        Some(PathResult::Unreachable) => "unreachable".to_string(),
                        _ => continue,
                    };
                    lines.push(format!("{local} {with_walls}/{with_roads} {id} {tick} {line}"));
                }
                tick += 1;
            }
        }
    }
    let want: Vec<&str> = include_str!("ticks.txt").lines().collect();
    assert_eq!(lines.len(), want.len());
    for (got, want) in lines.iter().zip(want) {
        // Costs as numbers: JavaScript and Rust may print the same double with a different last
        // digit.
        let (g, w): (Vec<&str>, Vec<&str>) = (got.split(' ').collect(), want.split(' ').collect());
        assert_eq!(g.len(), w.len(), "{got} / {want}");
        for (a, b) in g.iter().zip(&w) {
            if a != b {
                assert_eq!(
                    a.parse::<f64>().ok(),
                    Some(b.parse::<f64>().expect(want)),
                    "{got} / {want}"
                );
            }
        }
    }
}

/// A cost as JavaScript prints it (`String(x)`): the shortest digits that read back the same,
/// with no `.0` on whole numbers.
fn js_number(x: f64) -> String {
    if x.fract() == 0.0 && x.abs() < 1e21 {
        format!("{}", x as i64)
    } else {
        format!("{x}")
    }
}
