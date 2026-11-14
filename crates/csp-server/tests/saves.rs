//! World saves through the database: the cases of `saves.test.ts` that are not migration steps
//! (those stay in TypeScript, before the freeze), and a round trip of the live save fixture.
use std::{cell::RefCell, path::PathBuf, sync::OnceLock};

use csp_server::{
    db::open_db,
    saves::{
        gunzip, gzip, latest_save, load_or_create_world, load_terrain, prune_saves, save_world,
        SaveLog, SavesError, WorldSaver, KEEP_LATEST,
    },
    world_format::{FREEZE_FORMAT_VERSION, RESET_BEFORE},
};
use csp_shared::{
    terrain::TerrainMap,
    world::{WorldState, WORLD_FORMAT_VERSION},
};
use rusqlite::{params, Connection};
use serde_json::Value;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../csp-sim/fixtures/save")
}

/// `fixtures/save/live.json.gz`: a real world as `saveWorld` wrote it, and its format.
fn live_gz() -> &'static (Vec<u8>, u32) {
    static LIVE: OnceLock<(Vec<u8>, u32)> = OnceLock::new();
    LIVE.get_or_init(|| {
        let gz = std::fs::read(fixtures().join("live.json.gz")).unwrap();
        let version: Value =
            serde_json::from_slice(&std::fs::read(fixtures().join("version.json")).unwrap())
                .unwrap();
        (gz, version["WORLD_FORMAT_VERSION"].as_u64().unwrap() as u32)
    })
}

fn live_world() -> WorldState {
    serde_json::from_slice(&gunzip(&live_gz().0).unwrap()).unwrap()
}

/// A small map for any seed, counting how often it is asked for.
struct Counting {
    seeds: RefCell<Vec<i64>>,
}

impl Counting {
    fn new() -> Self {
        Self { seeds: RefCell::new(Vec::new()) }
    }
    fn terrain(&self) -> impl FnOnce(i64) -> TerrainMap + '_ {
        |seed| {
            self.seeds.borrow_mut().push(seed);
            small_terrain(seed)
        }
    }
    fn seeds(&self) -> Vec<i64> {
        self.seeds.borrow().clone()
    }
}

fn small_terrain(seed: i64) -> TerrainMap {
    TerrainMap { size: 16, tiles: (0..256).map(|t| ((t + seed) % 5) as u8).collect() }
}

/// `generateWorld` stands in for: the live world with the seed asked for, at tick 0.
fn generate_world(_: &TerrainMap, seed: i64) -> WorldState {
    let mut world = live_world();
    world.seed = seed;
    world.tick = 0;
    world
}

fn db() -> Connection {
    open_db(":memory:", None).unwrap()
}

fn ticks(conn: &Connection) -> Vec<i64> {
    let mut stmt = conn.prepare("SELECT tick FROM world_saves ORDER BY id").unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn creates_a_world_once_stores_its_terrain_and_loads_what_was_saved() {
    let conn = db();
    let gen = Counting::new();
    let (mut world, terrain) =
        load_or_create_world(&conn, gen.terrain(), generate_world, 3).unwrap();
    assert_eq!(world, generate_world(&terrain, 3));
    assert_eq!(gen.seeds(), vec![3]);
    assert_eq!(load_terrain(&conn).unwrap(), Some((3, terrain.clone())));

    world.tick = 42;
    save_world(&conn, &world).unwrap();
    let gen2 = Counting::new();
    let (loaded, loaded_terrain) =
        load_or_create_world(&conn, gen2.terrain(), |_, _| panic!("generated"), 1).unwrap();
    assert_eq!(loaded, world);
    assert_eq!(loaded_terrain, terrain);
    // The stored terrain is used; nothing is generated again.
    assert!(gen2.seeds().is_empty());
}

#[test]
fn refuses_stored_terrain_from_another_seed_than_the_save() {
    let conn = db();
    let gen = Counting::new();
    load_or_create_world(&conn, gen.terrain(), generate_world, 1).unwrap();
    let mut other = generate_world(&small_terrain(2), 2);
    other.tick = 5;
    save_world(&conn, &other).unwrap();
    let err =
        load_or_create_world(&conn, Counting::new().terrain(), generate_world, 1).unwrap_err();
    assert!(matches!(err, SavesError::SeedMismatch { stored: 1, world: 2 }), "{err}");
    assert!(err.to_string().contains("seed 1, the world is seed 2"));
}

#[test]
fn discards_a_world_from_before_the_resets_keeping_accounts() {
    for version in [5, RESET_BEFORE - 1] {
        let conn = db();
        conn.execute(
            "INSERT INTO users (name, password_hash, is_admin) VALUES ('Daniel', '', 1)",
            [],
        )
        .unwrap();
        let user: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
        // An old world: an old save, its terrain and a Player's explored terrain.
        let old = gzip(br#"{"tick":900,"seed":1}"#).unwrap();
        conn.execute(
            "INSERT INTO world_saves (tick, version, data) VALUES (900, ?1, ?2)",
            params![version, old],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO terrain (id, seed, diameter, data) VALUES (1, 1, 120, ?1)",
            [vec![0u8; 120 * 120]],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO explored (user_id, data, updated_at) VALUES (?1, ?2, 0)",
            params![user, vec![0u8; 8]],
        )
        .unwrap();

        let gen = Counting::new();
        let (mut world, fresh) =
            load_or_create_world(&conn, gen.terrain(), generate_world, 1).unwrap();
        assert_eq!(gen.seeds(), vec![1]);
        assert_eq!(world, generate_world(&fresh, 1));
        assert_eq!(load_terrain(&conn).unwrap(), Some((1, fresh)));
        assert_eq!(count(&conn, "SELECT count(*) FROM world_saves"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM explored"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM users"), 1);

        // A save in the current format loads as it is; nothing is reset again.
        world.tick = 77;
        save_world(&conn, &world).unwrap();
        let gen = Counting::new();
        let (again, _) = load_or_create_world(&conn, gen.terrain(), generate_world, 1).unwrap();
        assert_eq!(again.tick, 77);
        assert!(gen.seeds().is_empty());
    }
}

#[test]
fn refuses_a_save_from_before_the_freeze_saying_to_run_the_typescript_server() {
    let conn = db();
    conn.execute(
        "INSERT INTO world_saves (tick, version, data) VALUES (1, ?1, ?2)",
        params![FREEZE_FORMAT_VERSION - 1, gzip(br#"{"tick":1,"seed":1}"#).unwrap()],
    )
    .unwrap();
    let err =
        load_or_create_world(&conn, Counting::new().terrain(), generate_world, 1).unwrap_err();
    assert!(err.to_string().contains("run the TypeScript server once"), "{err}");
    // Nothing was thrown away.
    assert_eq!(ticks(&conn), vec![1]);
}

/// The live save, from the TypeScript's last format, is from before the new world (ADR 0035): the
/// server refuses it and keeps it. A world in today's format round trips: written by this server
/// and read again, the same world.
#[test]
fn the_live_save_is_refused_and_a_world_round_trips_through_the_database() {
    let (gz, version) = live_gz();
    assert_eq!(*version, FREEZE_FORMAT_VERSION);
    let conn = db();
    let expected = live_world();
    conn.execute(
        "INSERT INTO world_saves (tick, version, data) VALUES (?1, ?2, ?3)",
        params![expected.tick as i64, version, gz],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO terrain (id, seed, diameter, data) VALUES (1, ?1, 16, ?2)",
        params![expected.seed, small_terrain(expected.seed).tiles],
    )
    .unwrap();
    let load =
        || load_or_create_world(&conn, |_| panic!("generated"), |_, _| panic!("generated"), 1);
    let err = load().unwrap_err();
    assert!(err.to_string().contains("from before the new world"), "{err}");
    assert_eq!(ticks(&conn), vec![expected.tick as i64]);

    save_world(&conn, &expected).unwrap();
    let (state, v) = latest_save(&conn).unwrap().unwrap();
    assert_eq!(v, WORLD_FORMAT_VERSION);
    assert_eq!(serde_json::from_value::<WorldState>(state).unwrap(), expected);
    assert_eq!(load().unwrap().0, expected);
}

/// Format 113 (T90.2): a world with no vessels loads with none; a world with a boat is saved with
/// it and loads back with it, and a server of format 112 would refuse that save.
#[test]
fn a_world_with_a_boat_is_saved_and_loads_with_it_and_one_from_before_has_none() {
    let conn = db();
    let expected = live_world();
    assert!(expected.vessels.is_empty());
    save_world(&conn, &expected).unwrap();
    conn.execute(
        "INSERT INTO terrain (id, seed, diameter, data) VALUES (1, ?1, 16, ?2)",
        params![expected.seed, small_terrain(expected.seed).tiles],
    )
    .unwrap();
    let load = || {
        load_or_create_world(&conn, |_| panic!("generated"), |_, _| panic!("generated"), 1)
            .unwrap()
            .0
    };
    let mut world = load();
    assert!(world.vessels.is_empty());

    world.tick += 1;
    world.vessels.push(csp_shared::world::Vessel {
        id: "boat1".into(),
        kind: csp_shared::world::VesselKind::Boat,
        realm_id: Some("r1".into()),
        x: 3.0,
        y: 4.0,
        load: csp_shared::world::Stock::from([(csp_shared::world::Good::Wood, 5.0)]),
        rower_id: None,
        crew_ids: Vec::new(),
    });
    // A ship is a vessel of another kind (T91.1): no new field, so no new format.
    world.vessels.push(csp_shared::world::Vessel {
        id: "ship2".into(),
        kind: csp_shared::world::VesselKind::Ship,
        realm_id: Some("r1".into()),
        x: 5.0,
        y: 4.0,
        load: csp_shared::world::Stock::new(),
        rower_id: None,
        crew_ids: Vec::new(),
    });
    save_world(&conn, &world).unwrap();
    let (state, v) = latest_save(&conn).unwrap().unwrap();
    assert_eq!(v, WORLD_FORMAT_VERSION);
    assert_eq!(state["vessels"][0]["kind"], "boat");
    assert_eq!(state["vessels"][1]["kind"], "ship");
    assert_eq!(load().vessels, world.vessels);
}

#[test]
fn keeps_the_newest_saves_and_one_per_hour_for_a_week() {
    let conn = db();
    let now = 1_000_000_000_i64;
    let hour = 3600;
    // 10 saves an hour for 10 days, oldest first.
    let tx = conn.unchecked_transaction().unwrap();
    for h in (1..=240).rev() {
        for i in 0..10 {
            tx.execute(
                "INSERT INTO world_saves (tick, version, data, created_at) VALUES (0, 1, x'', ?1)",
                [now - h * hour + i],
            )
            .unwrap();
        }
    }
    tx.commit().unwrap();
    prune_saves(&conn, now).unwrap();
    // One per hour for the last 7 days (168) plus the newest 20, which overlap the last 2 hours.
    assert_eq!(count(&conn, "SELECT count(*) FROM world_saves"), 168 + KEEP_LATEST - 2);
}

#[derive(Default)]
struct FakeLog {
    skipped: RefCell<Vec<(u64, u64)>>,
    failed: RefCell<Vec<u64>>,
}

impl SaveLog for FakeLog {
    fn skipped(&self, tick: u64, saving_tick: u64) {
        self.skipped.borrow_mut().push((tick, saving_tick));
    }
    fn failed(&self, tick: u64, _: &SavesError) {
        self.failed.borrow_mut().push(tick);
    }
}

#[test]
fn world_saver_writes_a_save_off_the_tick_that_loads_back_to_the_same_world() {
    let conn = db();
    let (mut world, map) =
        load_or_create_world(&conn, Counting::new().terrain(), generate_world, 1).unwrap();
    world.tick = 30;
    let mut saver = WorldSaver::new(FakeLog::default());
    assert!(saver.start(&world));
    let taken = world.clone();
    // The world goes on while the save is written; the save is the world as it was.
    world.tick = 31;
    saver.settled(&conn);
    let (loaded, loaded_map) =
        load_or_create_world(&conn, Counting::new().terrain(), generate_world, 1).unwrap();
    assert_eq!(loaded, taken);
    assert_eq!(loaded_map, map);
    assert_eq!(ticks(&conn).last(), Some(&30));
    assert!(saver.log().failed.borrow().is_empty());
}

#[test]
fn world_saver_skips_and_logs_a_save_asked_for_while_one_is_in_flight() {
    let conn = db();
    let mut world = generate_world(&small_terrain(1), 1);
    let mut saver = WorldSaver::new(FakeLog::default());
    world.tick = 30;
    assert!(saver.start(&world));
    world.tick = 60;
    assert!(!saver.start(&world));
    assert_eq!(*saver.log().skipped.borrow(), vec![(60, 30)]);
    saver.settled(&conn);
    assert_eq!(ticks(&conn), vec![30]);
    // Once it is written, the next save starts again; `poll` writes it once it is gzipped.
    world.tick = 90;
    assert!(saver.start(&world));
    while saver.in_flight() {
        saver.poll(&conn);
        std::thread::yield_now();
    }
    assert_eq!(ticks(&conn), vec![30, 90]);
}

#[test]
fn world_saver_saves_synchronously_on_shutdown_and_a_save_in_flight_does_not_land_after_it() {
    let conn = db();
    let mut world = generate_world(&small_terrain(1), 1);
    let mut saver = WorldSaver::new(FakeLog::default());
    world.tick = 30;
    saver.start(&world);
    world.tick = 45;
    saver.save_now(&conn, &world).unwrap();
    // Written before anything else runs.
    assert_eq!(ticks(&conn), vec![45]);
    saver.settled(&conn);
    saver.poll(&conn);
    assert_eq!(ticks(&conn), vec![45]);
    assert!(!saver.start(&world));
}
