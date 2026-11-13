//! `csp-admin explore` (Epic 99, T99.1): staging a far-explored Player in a copy of a world. What
//! `map-stats` prints is checked against a real welcome in `realtime.rs`.

use csp_server::admin_cli::run;
use csp_server::auth::{create_admin, now_ms};
use csp_server::db::open_db;
use csp_server::explored::{load_explored, save_explored};
use csp_server::map_tools::EXPLORE_WARNING;
use csp_server::saves::{save_terrain, save_world};
use csp_shared::chunks::{chunks_across, CHUNK_SIZE};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_sim::explored::ExploredTerrain;
use csp_sim::starting_city::found_starting_city;
use csp_sim::world::create_world;
use rusqlite::Connection;

/// The side of the test map: a whole number of chunks, so the joins fall between chunks.
const SIZE: i32 = 256;
/// Where Daniel's town hall is moved to: near a corner, so a disc round it crosses both joins.
const HALL: (i32, i32) = (3, 250);

fn never(_: &str) -> std::io::Result<String> {
    panic!("asked")
}

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| (*s).to_owned()).collect()
}

/// A saved Plains world in which Daniel founded a city (its town hall moved to `HALL`) and Mara
/// explored a little; their account ids.
fn world_db(conn: &Connection) -> (i64, i64) {
    create_admin(conn, Some("Daniel"), Some("admin password")).unwrap();
    create_admin(conn, Some("Mara"), Some("admin password")).unwrap();
    let id = |name: &str| -> i64 {
        conn.query_row("SELECT id FROM users WHERE name = ?1", [name], |r| r.get(0)).unwrap()
    };
    let (daniel, mara) = (id("Daniel"), id("Mara"));
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    found_starting_city(&mut world, &terrain, daniel as u64, None);
    let hall = world.cities[0].town_hall_id.clone();
    let hall = world.buildings.iter_mut().find(|b| b.id == hall).unwrap();
    (hall.x, hall.y) = (f64::from(HALL.0) + 0.5, f64::from(HALL.1) + 0.5);
    save_terrain(conn, world.seed, &terrain).unwrap();
    save_world(conn, &world).unwrap();
    let mut explored = ExploredTerrain::new(terrain, &[]);
    explored.explore(mara as u64, 100, 100, 5);
    save_explored(conn, &mut explored, now_ms()).unwrap();
    (daniel, mara)
}

fn row(conn: &Connection, user_id: i64) -> Option<Vec<u8>> {
    conn.query_row("SELECT data FROM explored WHERE user_id = ?1", [user_id], |r| r.get(0)).ok()
}

/// The explored terrain the server would load from the database.
fn loaded(conn: &Connection) -> ExploredTerrain {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    load_explored(conn, terrain, &[]).unwrap()
}

/// How far apart two coordinates are across the map's join.
fn apart(a: i32, b: i32) -> i32 {
    let d = (a - b).rem_euclid(SIZE);
    d.min(SIZE - d)
}

#[test]
fn explore_writes_nothing_without_yes() {
    let conn = open_db(":memory:", None).unwrap();
    let (daniel, mara) = world_db(&conn);
    let before = row(&conn, mara);
    for reach in [&["--radius", "10"][..], &["--all"]] {
        let mut a = vec!["explore", "Daniel"];
        a.extend_from_slice(reach);
        assert_eq!(run(&conn, &args(&a), None, never).unwrap_err(), EXPLORE_WARNING);
    }
    assert_eq!(row(&conn, daniel), None);
    assert_eq!(row(&conn, mara), before);
}

#[test]
fn explore_marks_exactly_the_disc_round_the_town_hall_across_the_joins() {
    let conn = open_db(":memory:", None).unwrap();
    let (daniel, mara) = world_db(&conn);
    let mara_before = row(&conn, mara).unwrap();
    let radius = 20;
    let out = run(&conn, &args(&["explore", "Daniel", "--radius", "20", "--yes"]), None, never);
    assert!(out.unwrap().starts_with("Daniel has explored "));
    let explored = loaded(&conn);
    let user = daniel as u64;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let (dx, dy) = (apart(x, HALL.0), apart(y, HALL.1));
            let inside = dx * dx + dy * dy <= radius * radius;
            assert_eq!(explored.is_explored(user, x, y), inside, "({x}, {y})");
        }
    }
    // The server serves the chunks on both sides of each join.
    let n = chunks_across(SIZE);
    let chunks = explored.explored_chunks(user);
    for (cx, cy) in [(0, n - 1), (n - 1, n - 1), (0, 0), (n - 1, 0)] {
        assert!(chunks.contains(&((cy * n + cx) as u32)), "chunk ({cx}, {cy}) of {chunks:?}");
        assert!(explored.chunk(user, cx, cy).is_some());
    }
    assert!(explored.chunk(user, n / 2, n / 2).is_none());
    // Nobody else's explored terrain changed.
    assert_eq!(row(&conn, mara).unwrap(), mara_before);
}

#[test]
fn explore_all_marks_every_tile_and_leaves_others_alone() {
    let conn = open_db(":memory:", None).unwrap();
    let (daniel, mara) = world_db(&conn);
    let mara_before = row(&conn, mara).unwrap();
    run(&conn, &args(&["explore", &daniel.to_string(), "--all", "--yes"]), None, never).unwrap();
    let explored = loaded(&conn);
    let user = daniel as u64;
    assert_eq!(explored.explored_tiles(user), (SIZE * SIZE) as usize);
    let n = chunks_across(SIZE) as usize;
    assert_eq!(explored.explored_chunks(user).len(), n * n);
    let last = (SIZE / CHUNK_SIZE) - 1;
    assert!(explored.chunk(user, last, last).is_some());
    assert_eq!(row(&conn, mara).unwrap(), mara_before);
    assert_eq!(
        explored.explored_tiles(mara as u64),
        mara_before.iter().map(|b| b.count_ones() as usize).sum::<usize>()
    );
}

#[test]
fn explore_refuses_an_unknown_player_or_a_missing_reach() {
    let conn = open_db(":memory:", None).unwrap();
    world_db(&conn);
    let out = run(&conn, &args(&["explore", "Nobody", "--all", "--yes"]), None, never);
    assert_eq!(out.unwrap_err(), "no account Nobody");
    let usage = csp_server::admin_cli::USAGE;
    assert_eq!(run(&conn, &args(&["explore", "Daniel", "--yes"]), None, never).unwrap_err(), usage);
    let bad = args(&["explore", "Daniel", "--radius", "far", "--yes"]);
    assert_eq!(run(&conn, &bad, None, never).unwrap_err(), usage);
}
