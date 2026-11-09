//! Explored terrain saved to and loaded from the database: the storage cases of `explored.test.ts`.
use std::{path::Path, time::Instant};

use csp_server::{
    db::open_db,
    explored::{load_explored, save_explored},
};
use csp_shared::{
    balance::{MAP_SIZE, SIGHT_RANGE},
    terrain::TerrainMap,
};
use csp_sim::explored::ExploredTerrain;
use rusqlite::Connection;

/// A 128 × 128 map: the tiles do not matter here, only the bitmap.
fn terrain(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: (0..size * size).map(|t| (t % 7) as u8).collect() }
}

/// A database with one account, whose id it returns.
fn db() -> (Connection, u64) {
    let conn = open_db(":memory:", None).unwrap();
    conn.execute("INSERT INTO users (name, password_hash, is_admin) VALUES ('Daniel', '', 1)", [])
        .unwrap();
    let id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    (conn, id as u64)
}

/// A few scattered looks, some across the joins and over each other.
const LOOKS: [(i32, i32, i32); 6] =
    [(5, 5, 3), (60, 60, 7), (127, 64, 9), (64, 0, 12), (62, 58, 10), (100, 100, 1)];

#[test]
fn saves_what_changed_and_loads_it_back() {
    let (conn, id) = db();
    let map = terrain(128);
    let mut explored = ExploredTerrain::new(map.clone(), &[]);
    explored.explore(id, 60, 60, 5);
    assert_eq!(save_explored(&conn, &mut explored, 1_700_000_000_500).unwrap(), 1);
    // Nothing changed since: nothing is written.
    assert_eq!(save_explored(&conn, &mut explored, 1_700_000_001_000).unwrap(), 0);
    explored.explore(id, 20, 60, 1);
    assert_eq!(save_explored(&conn, &mut explored, 1_700_000_002_000).unwrap(), 1);

    let (rows, updated): (i64, i64) = conn
        .query_row("SELECT count(*), max(updated_at) FROM explored", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!((rows, updated), (1, 1_700_000_002));

    let loaded = load_explored(&conn, map, &[]).unwrap();
    assert!(loaded.is_explored(id, 60, 65));
    assert!(loaded.is_explored(id, 20, 60));
    assert!(!loaded.is_explored(id, 40, 60));
    assert_eq!(loaded.bitmap(id), explored.bitmap(id));
}

#[test]
fn explored_chunks_come_back_the_same_after_a_load_on_any_map() {
    // 77 is a side that is not a whole number of bytes.
    for size in [128, 77] {
        let (conn, id) = db();
        let map = terrain(size);
        let mut fresh = ExploredTerrain::new(map.clone(), &[]);
        for (x, y, r) in LOOKS {
            fresh.explore(id, x, y, r);
        }
        save_explored(&conn, &mut fresh, 0).unwrap();
        let loaded = load_explored(&conn, map, &[]).unwrap();
        assert!(!loaded.explored_chunks(id).is_empty());
        assert_eq!(loaded.explored_chunks(id), fresh.explored_chunks(id), "size {size}");
    }
}

#[test]
fn loads_what_the_typescript_server_wrote() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("world.db");
    std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/ts-made.db"), &path)
        .unwrap();
    let conn = open_db(&path, None).unwrap();
    let (size, tiles): (i32, Vec<u8>) = conn
        .query_row("SELECT diameter, data FROM terrain", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    let bits: Vec<u8> =
        conn.query_row("SELECT data FROM explored WHERE user_id = 1", [], |r| r.get(0)).unwrap();
    let loaded = load_explored(&conn, TerrainMap { size, tiles }, &[]).unwrap();
    assert_eq!(loaded.bitmap(1), Some(bits.as_slice()));
    let mut again = loaded.clone();
    // A load is not a change: nothing to write back.
    assert_eq!(save_explored(&conn, &mut again, 0).unwrap(), 0);
}

#[test]
fn ten_welcomes_on_a_full_size_map_take_well_under_a_second() {
    let (conn, id) = db();
    let full = TerrainMap { size: MAP_SIZE, tiles: vec![0; (MAP_SIZE * MAP_SIZE) as usize] };
    let mut before = ExploredTerrain::new(full.clone(), &[]);
    for i in 0..40 {
        before.explore(id, (i * 977) % MAP_SIZE, (i * 1931) % MAP_SIZE, SIGHT_RANGE as i32);
    }
    save_explored(&conn, &mut before, 0).unwrap();
    let explored = load_explored(&conn, full, &[]).unwrap();
    let start = Instant::now();
    for _ in 0..10 {
        explored.explored_chunks(id);
    }
    assert!(start.elapsed().as_millis() < 100);
    assert_eq!(explored.explored_chunks(id), before.explored_chunks(id));
}
