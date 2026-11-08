//! The server's loop (`index.ts`): ticks with saves every 30 ticks, the game thread, the tick
//! schedule and the daily jobs.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use csp_server::{
    auth::{create_admin, create_session, find_user_by_name},
    db::open_db,
    monitoring::LogSink,
    server::{tick_loop, Game, GameThread, TickSettings},
};
use csp_shared::terrain::TerrainMap;
use csp_sim::{explored::ExploredTerrain, world::create_world};
use rusqlite::Connection;
use serde_json::Value;
use tracing::Level;

#[derive(Clone, Default)]
struct FakeLog(Arc<Mutex<Vec<(Level, String)>>>);

impl LogSink for FakeLog {
    fn log(&self, level: Level, _: Value, message: &str) {
        self.0.lock().unwrap().push((level, message.to_owned()));
    }
}

impl FakeLog {
    fn messages(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().map(|l| l.1.clone()).collect()
    }
}

const SETTINGS: TickSettings =
    TickSettings { invariant_sample_rate: 1.0, slow_tick_ms: 800.0, save_every_ticks: 30 };

fn game(log: FakeLog) -> Game<FakeLog> {
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let world = create_world(&terrain, 1);
    let explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
    Game::new(world, terrain, explored, log)
}

fn ticks(conn: &Connection) -> Vec<i64> {
    let mut stmt = conn.prepare("SELECT tick FROM world_saves ORDER BY id").unwrap();
    stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
}

#[test]
fn ticks_with_tick_health_and_saves_every_thirty_ticks() {
    let conn = open_db(":memory:", None).unwrap();
    let mut g = game(FakeLog::default());
    for _ in 0..29 {
        assert!(g.tick(&conn, SETTINGS).is_some());
    }
    assert_eq!(g.world.tick, 29);
    let health = g.tick(&conn, SETTINGS).unwrap();
    assert_eq!(health.tick, 30);
    assert!(g.saver.in_flight());
    g.saver.settled(&conn);
    assert_eq!(ticks(&conn), vec![30]);
    assert_eq!(g.tick_health().lock().unwrap().len(), 30);
}

#[test]
fn saves_the_world_for_shutdown() {
    let conn = open_db(":memory:", None).unwrap();
    let mut g = game(FakeLog::default());
    g.tick(&conn, SETTINGS);
    g.save_for_shutdown(&conn).unwrap();
    assert_eq!(ticks(&conn), vec![1]);
}

#[test]
fn the_daily_jobs_delete_expired_sessions_and_write_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_db(dir.path().join("world.db"), None).unwrap();
    create_admin(&conn, Some("Daniel"), Some("admin password")).unwrap();
    let id = find_user_by_name(&conn, "Daniel").unwrap().unwrap().id;
    create_session(&conn, id, 0).unwrap(); // expired long ago
    let log = FakeLog::default();
    let g = game(log.clone());
    let backups = dir.path().join("backups");
    g.daily(&conn, Some(&backups));
    let sessions: i64 = conn.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0)).unwrap();
    assert_eq!(sessions, 0);
    assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1);
    assert_eq!(log.messages(), vec!["backup written"]);
}

#[tokio::test]
async fn the_game_thread_ticks_runs_jobs_between_ticks_and_saves_on_stop() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("world.db");
    let open_path = path.clone();
    let thread = GameThread::spawn(
        move || Ok((open_db(&open_path, None)?, game(FakeLog::default()))),
        SETTINGS,
    )
    .unwrap();
    assert_eq!(thread.started_at, (0, 1));
    assert_eq!(thread.tick().await.unwrap().tick, 1);
    assert_eq!(thread.tick().await.unwrap().tick, 2);
    assert_eq!(thread.run(|g, _| g.world.tick).await, Some(2));
    assert_eq!(thread.tick_health.lock().unwrap().len(), 2);
    thread.stop().await.unwrap();
    assert_eq!(ticks(&Connection::open(&path).unwrap()), vec![2]);
}

#[tokio::test]
async fn the_loop_ticks_on_schedule_until_stopped() {
    let thread =
        GameThread::spawn(|| Ok((open_db(":memory:", None)?, game(FakeLog::default()))), SETTINGS)
            .unwrap();
    let start = Instant::now();
    tick_loop(
        &thread,
        Duration::from_millis(20),
        Duration::from_secs(3600),
        None,
        tokio::time::sleep(Duration::from_millis(210)),
    )
    .await;
    let elapsed = start.elapsed().as_millis() as u64;
    let ticked = thread.run(|g, _| g.world.tick).await.unwrap();
    // One tick per period, never more: a late tick is skipped, not made up for.
    assert!(ticked >= 1, "{ticked} ticks");
    assert!(ticked <= elapsed / 20, "{ticked} ticks in {elapsed} ms");
    thread.stop().await.unwrap();
}
