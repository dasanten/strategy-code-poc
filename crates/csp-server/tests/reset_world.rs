//! `csp-admin reset-world` (T100.7, ADR 0035): the world goes, what belongs to the Player stays.
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::SystemTime,
};

use csp_server::{
    admin_cli,
    auth::create_admin,
    db::open_db,
    first_day::{dismiss_first_day, first_day_shown, mark_first_day, read_first_day, FirstDayLine},
    reset::{holdings, reset_world, RESET_WARNING},
    saves::{gunzip, latest_save, load_or_create_world, load_terrain, save_terrain, save_world},
};
use csp_shared::{terrain::TerrainMap, world::WorldState};
use rusqlite::{types::Value, Connection};

fn small_terrain(seed: i64) -> TerrainMap {
    TerrainMap { size: 16, tiles: (0..256).map(|t| ((t + seed) % 5) as u8).collect() }
}

/// A world that stands in for a generated one: the live save fixture with that seed, at tick 0,
/// with the Horse offer open.
fn small_world(seed: i64) -> WorldState {
    static LIVE: OnceLock<WorldState> = OnceLock::new();
    let mut world = LIVE
        .get_or_init(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../csp-sim/fixtures/save/live.json.gz");
            serde_json::from_slice(&gunzip(&std::fs::read(path).unwrap()).unwrap()).unwrap()
        })
        .clone();
    world.seed = seed;
    world.tick = 0;
    world.horse_offers_claimed.clear();
    world
}

/// Every row of a table, in key order, as SQLite holds it.
fn rows(conn: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table} ORDER BY 1")).unwrap();
    let n = stmt.column_count();
    stmt.query_map([], |r| (0..n).map(|i| r.get::<_, Value>(i)).collect())
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// The tables the reset keeps; of `users` everything but the First day card, which it clears.
const KEPT: [&str; 5] = [
    "(SELECT id, name, created_at, password_hash, is_admin FROM users)",
    "sessions",
    "invite_codes",
    "scripts",
    "script_versions",
];

fn kept(conn: &Connection) -> Vec<Vec<Vec<Value>>> {
    KEPT.iter().map(|t| rows(conn, t)).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// A database with an admin and a Player who have played: a world save on its terrain, explored
/// terrain, logins, invite codes used and unused, script libraries with history, and First day
/// cards ticked and dismissed.
fn played_db(path: &Path) -> Connection {
    let conn = open_db(path, None).unwrap();
    create_admin(&conn, Some("Daniel"), Some("admin password")).unwrap();
    conn.execute(
        "INSERT INTO users (name, password_hash) VALUES ('Mara', 'scrypt$hash-of-mara')",
        [],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t1', 1, 4000000000), \
         ('t2', 2, 4000000000);
         INSERT INTO invite_codes (code, created_by, used_by, used_at) VALUES ('USED', 1, 2, 100);
         INSERT INTO invite_codes (code, created_by) VALUES ('FREE', 1);
         INSERT INTO scripts (user_id, name, active_version, latest_version) VALUES \
         (1, 'woodcutter', 2, 2), (2, 'miner', 1, 1);
         INSERT INTO script_versions (script_id, version, source) VALUES (1, 1, 'gather wood'), \
         (1, 2, 'gather wood\nrest'), (2, 1, 'mine ore');
         INSERT INTO explored (user_id, data, updated_at) VALUES (1, x'ff00', 5), (2, x'0f', 5);",
    )
    .unwrap();
    mark_first_day(&conn, 1, FirstDayLine::ClaimHorses).unwrap();
    dismiss_first_day(&conn, 2).unwrap();
    save_terrain(&conn, 3, &small_terrain(3)).unwrap();
    let mut world = small_world(3);
    world.tick = 900;
    world.horse_offers_claimed.push(1);
    save_world(&conn, &world).unwrap();
    conn
}

#[test]
fn without_yes_it_lists_what_goes_and_what_stays_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let conn = played_db(&dir.path().join("world.db"));
    let before = (holdings(&conn).unwrap(), kept(&conn), rows(&conn, "world_saves"));
    let backups = dir.path().join("backups");

    let out =
        reset_world(&conn, Some(7), false, &backups, SystemTime::now(), |_| panic!("generated"))
            .unwrap_err();
    assert!(out.contains("Removes: 1 world saves, the stored terrain (seed 3)"), "{out}");
    assert!(out.contains("explored terrain of 2 Players"), "{out}");
    assert!(out.contains("Keeps: 2 accounts (1 admins)"), "{out}");
    assert!(out.contains("2 invite codes (1 unused), 2 scripts with 3 versions"), "{out}");
    assert!(out.contains("seed 7"), "{out}");
    assert!(out.ends_with(RESET_WARNING), "{out}");

    assert_eq!((holdings(&conn).unwrap(), kept(&conn), rows(&conn, "world_saves")), before);
    assert!(!backups.exists());
}

#[test]
fn removes_the_world_keeps_the_players_and_backs_up_first() {
    let dir = tempfile::tempdir().unwrap();
    let conn = played_db(&dir.path().join("world.db"));
    let before = kept(&conn);
    let backups = dir.path().join("backups");

    let out =
        reset_world(&conn, Some(7), true, &backups, SystemTime::now(), small_terrain).unwrap();
    assert!(out.contains("Done: start the server"), "{out}");

    // The backup holds the old world, under a name that is never pruned.
    let files: Vec<_> = std::fs::read_dir(&backups).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(files.len(), 1);
    assert!(files[0].to_string_lossy().ends_with("-reset.db"), "{files:?}");
    let old = Connection::open(&files[0]).unwrap();
    assert_eq!(count(&old, "SELECT count(*) FROM world_saves"), 1);
    assert_eq!(count(&old, "SELECT count(*) FROM explored"), 2);

    // Accounts, password hashes, admin rights, logins, invite codes and every script version.
    assert_eq!(kept(&conn), before);
    // No save, no explored terrain; the new seed's terrain is stored.
    assert_eq!(count(&conn, "SELECT count(*) FROM world_saves"), 0);
    assert_eq!(count(&conn, "SELECT count(*) FROM explored"), 0);
    assert_eq!(load_terrain(&conn).unwrap(), Some((7, small_terrain(7))));
    // First day shows again for both.
    for user in [1, 2] {
        assert!(first_day_shown(&read_first_day(&conn, user).unwrap()), "user {user}");
    }

    // The next start generates the new world on that terrain; the Horse offer is open again.
    let (world, terrain) = load_or_create_world(
        &conn,
        |_| panic!("generated terrain"),
        |_, seed| small_world(seed),
        1,
    )
    .unwrap();
    assert_eq!((world.seed, world.tick), (7, 0));
    assert!(world.horse_offers_claimed.is_empty());
    assert_eq!(terrain, small_terrain(7));
    assert!(latest_save(&conn).unwrap().is_none());
}

#[test]
fn picks_a_new_seed_unless_one_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let conn = played_db(&dir.path().join("world.db"));
    let mut asked = None;
    reset_world(&conn, None, true, &dir.path().join("b"), SystemTime::now(), |seed| {
        asked = Some(seed);
        small_terrain(seed)
    })
    .unwrap();
    let seed = asked.unwrap();
    assert!(seed > 0 && seed != 3, "{seed}");
    assert_eq!(load_terrain(&conn).unwrap().map(|(s, _)| s), Some(seed));
}

#[test]
fn the_command_reads_its_seed_and_asks_for_yes() {
    let conn = open_db(":memory:", None).unwrap();
    let never = |_: &str| -> std::io::Result<String> { panic!("asked") };
    let args = |a: &[&str]| a.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let out =
        admin_cli::run(&conn, &args(&["reset-world", "--seed", "12"]), None, never).unwrap_err();
    assert!(out.contains("New world: seed 12") && out.ends_with(RESET_WARNING), "{out}");
    for bad in [&["reset-world", "--seed"][..], &["reset-world", "--seed", "x"]] {
        assert_eq!(admin_cli::run(&conn, &args(bad), None, never).unwrap_err(), admin_cli::USAGE);
    }
}
