//! The server's loop (`index.ts`): ticks with saves every 30 ticks, the game thread, the tick
//! schedule and the daily jobs.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use csp_server::scripts::{create_script, game_defaults};
use csp_server::{
    auth::{create_admin, create_session, find_user_by_name},
    config::LIVE_INVARIANT_SAMPLE_RATE,
    creative::{CreativeSpeed, TimeControls, FAST_BROADCAST_GAP, MAX_SKIP_TICKS},
    db::open_db,
    monitoring::LogSink,
    server::{tick_loop, Game, GameThread, TickSettings},
};
use csp_shared::terrain::TerrainMap;
use csp_sim::order_sender::OrderSender;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::{explored::ExploredTerrain, world::create_world};
use rusqlite::Connection;
use serde_json::{json, Value};
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
    Game::new(world, explored, log)
}

#[test]
fn holds_the_maps_terrain_once_for_the_game_the_explored_terrain_and_the_http_side() {
    let g = game(FakeLog::default());
    assert!(Arc::ptr_eq(&g.terrain, g.explored().map().terrain()));
    let thread = GameThread::spawn(
        move || {
            let g = game(FakeLog::default());
            assert!(Arc::ptr_eq(&g.terrain, g.explored().map().terrain()));
            Ok((open_db(":memory:", None)?, g))
        },
        SETTINGS,
    )
    .unwrap();
    // The HTTP side's map and explored terrain are the game's, the same one copy.
    assert!(Arc::ptr_eq(thread.explored.lock().unwrap().map(), &thread.map));
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

/// With the script library attached, a Player's run-script order is taken and their script runs
/// on the next tick, as `index.ts` wires the script host into the orders and the runner.
#[test]
fn runs_a_players_script_from_the_library_once_attached() {
    let library = open_db(":memory:", None).unwrap();
    create_admin(&library, Some("Daniel"), Some("admin password")).unwrap();
    let user = find_user_by_name(&library, "Daniel").unwrap().unwrap().id;
    let defaults = game_defaults();
    let source = Some("let x = 1\n");
    let script = create_script(&library, defaults, user, Some("idle"), source).unwrap();
    let mut g =
        game(FakeLog::default()).with_library(Arc::new(Mutex::new(library)), defaults, None);
    let mut rand = csp_sim::random::Mulberry32::new(1.0);
    let mut next = || rand.next();
    let fields =
        NewResident { id: "a1", owner: Some("r1"), city_id: None, x: 10.0, y: 10.0, tick: 0.0 };
    g.world.residents.push(new_resident(&mut next, &fields, None));
    let realm = json!({ "id": "r1", "userId": user, "leaderId": "a1", "name": "Ironvale" });
    g.world.realms.push(serde_json::from_value(realm).unwrap());

    let order = json!({ "kind": "runScript", "residentId": "a1", "scriptId": script.summary.id });
    let sender = OrderSender::player(user as u64, "Daniel");
    let reply = g.orders.receive(&g.world, &sender, &json!("q"), &order);
    assert_eq!(serde_json::to_value(&reply).unwrap()["type"], "ack", "{reply:?}");
    let conn = open_db(":memory:", None).unwrap();
    g.tick(&conn, SETTINGS).unwrap();
    let running = g.world.residents[0].script.clone().expect("a running script");
    assert_eq!(running.script_id, script.summary.id as u64);
    assert!(running.last_run.is_some(), "it ran: {running:?}");
    assert_eq!(running.last_error, None);
}

/// A game with the script library attached, Daniel's realm `r1` and its resident `a1`.
fn game_with_library() -> (Game<FakeLog>, OrderSender) {
    let library = open_db(":memory:", None).unwrap();
    create_admin(&library, Some("Daniel"), Some("admin password")).unwrap();
    let user = find_user_by_name(&library, "Daniel").unwrap().unwrap().id;
    let mut g =
        game(FakeLog::default()).with_library(Arc::new(Mutex::new(library)), game_defaults(), None);
    let mut rand = csp_sim::random::Mulberry32::new(1.0);
    let mut next = || rand.next();
    let fields =
        NewResident { id: "a1", owner: Some("r1"), city_id: None, x: 10.0, y: 10.0, tick: -1e6 };
    g.world.residents.push(new_resident(&mut next, &fields, None));
    let realm = json!({ "id": "r1", "userId": user, "leaderId": "a1", "name": "Ironvale" });
    g.world.realms.push(serde_json::from_value(realm).unwrap());
    (g, OrderSender::player(user as u64, "Daniel"))
}

/// A task given with param values (from the form before it starts, or kept in a queue step) is
/// checked against the Player's script in the library, not refused as taking none.
#[test]
fn a_task_with_params_is_taken_with_the_library_attached() {
    let (mut g, sender) = game_with_library();
    let order = json!({ "kind": "task", "residentId": "a1", "task": "explore", "params": {} });
    let reply = g.orders.receive(&g.world, &sender, &json!("q"), &order);
    assert_eq!(serde_json::to_value(&reply).unwrap()["type"], "ack", "{reply:?}");
}

/// A queue whose task step carries param values starts that step instead of skipping it.
#[test]
fn a_queue_step_with_params_starts_with_the_library_attached() {
    let (mut g, sender) = game_with_library();
    let step = json!({ "order": { "kind": "task", "task": "explore", "params": {} } });
    let order = json!({ "kind": "queue", "residentId": "a1", "steps": [step] });
    let reply = g.orders.receive(&g.world, &sender, &json!("q"), &order);
    assert_eq!(serde_json::to_value(&reply).unwrap()["type"], "ack", "{reply:?}");
    let conn = open_db(":memory:", None).unwrap();
    g.tick(&conn, SETTINGS).unwrap();
    let events = format!("{:?}", g.world.events);
    assert!(!events.contains("QueueStepSkipped"), "no step was skipped: {events}");
    let queue = g.world.residents[0].queue.as_ref().expect("the queue is still going");
    assert_eq!(queue.started_at, Some(0.0), "its step started");
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
    let mut g = game(log.clone());
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

async fn tick_of(thread: &GameThread<FakeLog>) -> u64 {
    thread.run(|g, _| g.world.tick).await.unwrap()
}

#[tokio::test]
async fn creative_time_controls_pause_step_and_speed_up_the_loop() {
    let thread =
        GameThread::spawn(|| Ok((open_db(":memory:", None)?, game(FakeLog::default()))), SETTINGS)
            .unwrap();
    let controls = Arc::new(TimeControls::new());
    controls.pause();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let drive = async {
        // Paused: no tick runs, at any speed.
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(tick_of(&thread).await, 0, "paused");
        // A step runs exactly one tick, and answers once it has.
        controls.step().await;
        assert_eq!(tick_of(&thread).await, 1);
        controls.step().await;
        controls.step().await;
        assert_eq!(tick_of(&thread).await, 3);
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(tick_of(&thread).await, 3, "still paused after the steps");
        assert!(controls.state().paused);

        // ×10 with the game's one-second tick: ten ticks a real second.
        controls.set_speed(CreativeSpeed::X10);
        controls.resume();
        let (before, start) = (tick_of(&thread).await, Instant::now());
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let ran = tick_of(&thread).await - before;
        let elapsed = start.elapsed().as_millis() as u64;
        assert!(ran <= elapsed / 100, "{ran} ticks in {elapsed} ms at ×10");
        assert!(ran >= 7, "{ran} ticks in {elapsed} ms at ×10");
        assert_eq!(thread.run(|g, _| g.broadcasts.gap).await.unwrap(), None);

        // Max runs ticks back to back, and the sockets are told at most every gap.
        controls.set_speed(CreativeSpeed::Max);
        tokio::time::sleep(Duration::from_millis(20)).await;
        let before = tick_of(&thread).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        let ran = tick_of(&thread).await - before;
        assert!(ran > 20, "{ran} ticks in 200 ms at max");
        assert_eq!(thread.run(|g, _| g.broadcasts.gap).await.unwrap(), Some(FAST_BROADCAST_GAP));

        // Paused again, the ticks stop.
        controls.pause();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let held = tick_of(&thread).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(tick_of(&thread).await, held);
        let _ = stop.send(());
    };
    let run = tick_loop(
        &thread,
        Duration::from_millis(1000),
        Duration::from_secs(3600),
        None,
        Some(Arc::clone(&controls)),
        async {
            let _ = stopped.await;
        },
    );
    tokio::join!(run, drive);
    thread.stop().await.unwrap();
}

/// A paused game on its thread with creative time controls.
fn paused_creative_game() -> (GameThread<FakeLog>, Arc<TimeControls>) {
    let thread =
        GameThread::spawn(|| Ok((open_db(":memory:", None)?, game(FakeLog::default()))), SETTINGS)
            .unwrap();
    let controls = Arc::new(TimeControls::new());
    controls.pause();
    (thread, controls)
}

/// The creative tick loop at the game's one-second tick, until `stopped` resolves.
async fn creative_loop(
    thread: &GameThread<FakeLog>,
    controls: &Arc<TimeControls>,
    stopped: tokio::sync::oneshot::Receiver<()>,
) {
    let stop = async {
        let _ = stopped.await;
    };
    let (period, day) = (Duration::from_millis(1000), Duration::from_secs(3600));
    tick_loop(thread, period, day, None, Some(Arc::clone(controls)), stop).await;
}

/// Waits until no skip ahead runs.
async fn skip_ended(controls: &TimeControls) {
    let mut clock = controls.subscribe();
    tokio::time::timeout(Duration::from_secs(20), clock.wait_for(|c| c.skip.is_none()))
        .await
        .expect("the skip ends")
        .unwrap();
}

#[tokio::test]
async fn skipping_a_game_day_runs_the_same_1440_ticks_as_the_normal_loop() {
    let conn = open_db(":memory:", None).unwrap();
    let mut normal = game(FakeLog::default());
    for _ in 0..1440 {
        normal.tick(&conn, SETTINGS);
    }
    let (thread, controls) = paused_creative_game();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let drive = async {
        assert!(controls.skip(1440));
        skip_ended(&controls).await;
        let (skipped, holding) =
            thread.run(|g, _| (g.world.clone(), g.broadcasts.holding)).await.unwrap();
        assert_eq!(skipped.tick, 1440);
        assert!(skipped == normal.world, "the skipped world equals the normally ticked one");
        assert!(!holding, "the sockets are told again once it ends");
        // Paused before, paused after.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(tick_of(&thread).await, 1440);
        assert!(controls.state().paused);
        let _ = stop.send(());
    };
    tokio::join!(creative_loop(&thread, &controls, stopped), drive);
    thread.stop().await.unwrap();
}

#[tokio::test]
async fn a_cancelled_skip_stops_between_ticks() {
    let (thread, controls) = paused_creative_game();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let drive = async {
        assert!(controls.skip(MAX_SKIP_TICKS));
        let mut clock = controls.subscribe();
        clock.wait_for(|c| c.skip.is_some_and(|s| s.done >= 10)).await.unwrap();
        // The skip's ticks check invariants at the live rate, not the configured 1.0.
        let rate = thread.run(|g, _| g.invariant_sample_rate(SETTINGS.invariant_sample_rate));
        assert_eq!(rate.await.unwrap(), LIVE_INVARIANT_SAMPLE_RATE);
        controls.cancel_skip();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let stopped_at = tick_of(&thread).await;
        assert!((10..MAX_SKIP_TICKS).contains(&stopped_at), "{stopped_at}");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(tick_of(&thread).await, stopped_at, "no tick after the cancel");
        assert!(!thread.run(|g, _| g.broadcasts.holding).await.unwrap());
        let rate = thread.run(|g, _| g.invariant_sample_rate(SETTINGS.invariant_sample_rate));
        assert_eq!(rate.await.unwrap(), 1.0, "back to the configured rate");
        // A step still runs exactly one tick afterwards.
        controls.step().await;
        assert_eq!(tick_of(&thread).await, stopped_at + 1);
        let _ = stop.send(());
    };
    tokio::join!(creative_loop(&thread, &controls, stopped), drive);
    thread.stop().await.unwrap();
}

#[test]
fn a_skip_ahead_checks_invariants_at_most_at_the_live_rate() {
    let mut g = game(FakeLog::default());
    assert_eq!(g.invariant_sample_rate(1.0), 1.0, "outside a skip, as configured");
    g.skipping = true;
    assert_eq!(g.invariant_sample_rate(1.0), LIVE_INVARIANT_SAMPLE_RATE);
    assert_eq!(g.invariant_sample_rate(0.05), 0.05, "never more than configured");
}
