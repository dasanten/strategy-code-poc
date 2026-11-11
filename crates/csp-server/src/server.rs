//! The server's loop (`apps/server/src/index.ts`): opens the database (backing it up before
//! migrations), loads or creates the world, then ticks once every `TICK_MS` on a schedule that
//! never drifts, runs the daily jobs, and on SIGINT or SIGTERM saves the world and stops.
//!
//! The world lives in a [`Game`] behind a mutex: a tick takes it on the runtime's blocking
//! threads, and anything else (the sockets, HTTP) reads it only between ticks.
//!
//! HTTP (`app.rs`) is served beside the loop, on its own database connection, and reaches the
//! world through the game thread between ticks.
//!
//! The game thread reads the script library on a connection of its own ([`Game::with_library`]),
//! for the orders, queues and scripts that run the Players' scripts.

use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime},
};

use csp_shared::{balance::MAP_SIZE, terrain::TerrainMap, world::WorldState, TICK_MS};
use csp_sim::{
    explored::ExploredTerrain,
    orders::{order_kinds, OrderQueue},
    queues::QueueRunner,
    script_runner::ScriptRunner,
    sight::{InvariantViolation, SightTracker},
    terrain_gen::generate_terrain,
    territory::TerritoryTracker,
    tick::{
        run_tick, ApplyOrders, RunQueues, RunScripts, Scratch, TickHealth, TickOptions, TickPhase,
        TickReporter, TickTimer, Walk,
    },
    walking::{Walking, PATH_BUDGET_MS},
    world::generate_world,
};
use rusqlite::Connection;
use serde_json::json;
use std::sync::MutexGuard;
use tokio::sync::oneshot;
use tracing::Level;

use std::future::IntoFuture;

use crate::{
    app::{build_app, AppOptions, GameHandle},
    auth::SessionSockets,
    auth::{delete_expired_sessions, now_ms},
    backup::{backup_db, Reason},
    config::Config,
    db::{open_db, DbError},
    explored::{load_explored, save_explored},
    field_check::note_script_view_changes,
    game_scripts::{library_order_kinds, LibraryHost, ScriptErrors, SharedHost},
    monitoring::{init_sentry, tag_world, LogSink, ServerReporter, TracingLog},
    realtime::{Realtime, RealtimeOptions, SightCheck, TickView},
    saves::{load_or_create_world, SaveLog, SavesError, WorldSaver},
    scripts::{check_script_library, Defaults},
    tick_window::TickHealthWindow,
};

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Saves(#[from] SavesError),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Where the world saver's news goes: the log.
pub struct SaverLog<L: LogSink>(pub Arc<L>);

impl<L: LogSink> SaveLog for SaverLog<L> {
    fn skipped(&self, tick: u64, saving_tick: u64) {
        self.0.log(
            Level::WARN,
            json!({ "tick": tick, "savingTick": saving_tick }),
            "save skipped: the last one is still being written",
        );
    }
    fn failed(&self, tick: u64, error: &SavesError) {
        self.0.log(
            Level::ERROR,
            json!({ "err": { "message": error.to_string() }, "tick": tick }),
            "save failed",
        );
    }
}

impl<L: LogSink> LogSink for Arc<L> {
    fn log(&self, level: Level, fields: serde_json::Value, message: &str) {
        (**self).log(level, fields, message);
    }
}

/// How the loop ticks (`config.ts`'s part of `runTick`'s options).
#[derive(Debug, Clone, Copy)]
pub struct TickSettings {
    pub invariant_sample_rate: f64,
    pub slow_tick_ms: f64,
    pub save_every_ticks: u64,
}

impl From<&Config> for TickSettings {
    fn from(c: &Config) -> Self {
        Self {
            invariant_sample_rate: c.invariant_sample_rate,
            slow_tick_ms: c.slow_tick_ms,
            save_every_ticks: c.save_every_ticks,
        }
    }
}

/// Where in a tick the shadow run looks at the world (`scripts/shadow-run.mts`): after the
/// orders, the queues, the scripts and the world's step (with its invariants), and once the
/// loop's work after it (territory, sight, broadcast, save) is done.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbePoint {
    Orders,
    Queues,
    Scripts,
    World,
    End,
}

impl ProbePoint {
    pub fn name(self) -> &'static str {
        match self {
            ProbePoint::Orders => "orders",
            ProbePoint::Queues => "queues",
            ProbePoint::Scripts => "scripts",
            ProbePoint::World => "world",
            ProbePoint::End => "end",
        }
    }
}

/// Looks at the world at each [`ProbePoint`] of a tick.
pub type Probe = dyn FnMut(ProbePoint, &WorldState);

/// The running world and what the loop keeps beside it.
pub struct Game<L: LogSink> {
    pub world: WorldState,
    /// Shared with the order queue, whose orders check the land.
    pub terrain: Arc<TerrainMap>,
    pub scratch: Scratch,
    /// Shared with the script host, whose scripts ask what their Player explored.
    pub explored: Arc<Mutex<ExploredTerrain>>,
    pub sight: SightTracker,
    /// The world's territory, worked out again once a game hour (`TerritoryTracker`).
    pub territory: TerritoryTracker,
    /// Orders accepted from the sockets since the last tick, applied at the start of the next.
    pub orders: OrderQueue,
    /// Moves the residents' queues on; none until the script library is attached.
    pub queues: Option<QueueRunner>,
    /// Runs the residents' and armies' scripts; none until the script library is attached.
    pub scripts: Option<ScriptRunner>,
    pub walking: Walking,
    /// The script library the game thread reads, once attached ([`Game::with_library`]).
    pub library: Option<(Arc<LibraryHost>, &'static Defaults)>,
    /// The sockets, told of every tick in its broadcast phase; none until they are attached.
    pub realtime: Option<Arc<Realtime>>,
    pub saver: WorldSaver<SaverLog<L>>,
    pub reporter: ServerReporter<Arc<L>>,
    /// Wall-clock time a tick's path searches get, [`PATH_BUDGET_MS`]; the shadow run gives them
    /// no limit, so where a walker is never depends on how fast the machine is.
    pub path_budget_ms: f64,
    /// Looks at the world through each tick, for the shadow run; none in the game.
    pub probe: Option<Box<Probe>>,
    log: Arc<L>,
}

impl<L: LogSink> Game<L> {
    /// The game without a script library: orders, walking and territory, but no script runs.
    pub fn new(world: WorldState, terrain: TerrainMap, explored: ExploredTerrain, log: L) -> Self {
        let log = Arc::new(log);
        let terrain = Arc::new(terrain);
        Self {
            world,
            orders: OrderQueue::new(order_kinds(), Some(Arc::clone(&terrain))),
            walking: Walking::new(Arc::clone(&terrain)),
            terrain,
            scratch: Scratch::default(),
            explored: Arc::new(Mutex::new(explored)),
            sight: SightTracker::new(),
            territory: TerritoryTracker::default(),
            queues: None,
            scripts: None,
            library: None,
            realtime: None,
            saver: WorldSaver::new(SaverLog(Arc::clone(&log))),
            reporter: ServerReporter::new(Arc::clone(&log)),
            path_budget_ms: PATH_BUDGET_MS,
            probe: None,
            log,
        }
    }

    /// Attaches the script library on `db` (`scriptHost`): the order kinds that need it, the
    /// queue runner and the script runner, as `index.ts` builds them. Orders already waiting are
    /// dropped, so attach it before the first socket connects.
    pub fn with_library(
        mut self,
        db: Arc<Mutex<Connection>>,
        defaults: &'static Defaults,
        errors: Option<ScriptErrors>,
    ) -> Self {
        let host = Arc::new(LibraryHost::new(db, defaults, Arc::clone(&self.explored), errors));
        let kinds = library_order_kinds(&host);
        let terrain = Arc::clone(&self.terrain);
        self.orders = OrderQueue::new(kinds.clone(), Some(Arc::clone(&terrain)));
        self.queues = Some(QueueRunner::new(
            Box::new(SharedHost(Arc::clone(&host))),
            kinds.clone(),
            Some(Arc::clone(&terrain)),
        ));
        self.scripts = Some(ScriptRunner::new(terrain, host.clone(), kinds));
        self.library = Some((host, defaults));
        self
    }

    /// The script library's invariants (`checkScriptLibrary`), reported as the tick's are: at
    /// start and daily. Nothing without a library attached.
    pub fn check_script_library(&mut self, conn: &Connection) {
        let Some((_, defaults)) = self.library else { return };
        match check_script_library(conn, defaults) {
            Ok(violations) if !violations.is_empty() => {
                self.reporter.invariant_violations(&self.world, &violations);
            }
            Ok(_) => {}
            Err(e) => self.log.log(
                Level::ERROR,
                json!({ "err": { "message": e.to_string() } }),
                "script library not checked",
            ),
        }
    }

    /// The explored terrain, locked: only the game thread takes it, between ticks or in one.
    pub fn explored(&self) -> MutexGuard<'_, ExploredTerrain> {
        self.explored.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The last hour of tick health, for admins.
    pub fn tick_health(&self) -> Arc<Mutex<TickHealthWindow>> {
        self.reporter.window()
    }

    /// One tick, as `index.ts`'s interval runs it: writes a save whose gzip finished, runs the
    /// tick, then territory, sight, broadcast and, every `save_every_ticks`, the save, all timed
    /// in the tick's health.
    pub fn tick(&mut self, conn: &Connection, settings: TickSettings) -> Option<TickHealth> {
        self.saver.poll(conn);
        let Game {
            world,
            terrain,
            scratch,
            explored,
            sight,
            territory,
            orders,
            queues,
            scripts,
            walking,
            realtime,
            saver,
            reporter,
            log,
            path_budget_ms,
            probe,
            ..
        } = self;
        let size = terrain.size;
        let map: &TerrainMap = terrain;
        let explored: &Mutex<ExploredTerrain> = explored;
        let lock = || explored.lock().unwrap_or_else(|e| e.into_inner());
        let probe = RefCell::new(probe.as_deref_mut());
        let look = |point: ProbePoint, world: &WorldState| {
            if let Some(p) = probe.borrow_mut().as_mut() {
                p(point, world);
            }
        };
        let mut finish = |timer: &TickTimer, world: &mut WorldState, scratch: &mut Scratch| {
            look(ProbePoint::World, world);
            timer.time(TickPhase::Territory, || territory.update(world, map));
            let grown = timer.time(TickPhase::Sight, || {
                let index = scratch.index(world, size);
                sight.update(world, index, &mut *lock())
            });
            timer.time(TickPhase::Broadcast, || {
                if let Some(rt) = realtime.as_ref() {
                    let explored = lock();
                    let view =
                        TickView { territory: territory.current.as_ref(), explored: &explored };
                    rt.broadcast_tick(world, map, scratch, &grown, view, now_ms());
                }
            });
            if world.tick.is_multiple_of(settings.save_every_ticks) {
                timer.time(TickPhase::Save, || {
                    saver.start(world);
                    if let Err(e) = save_explored(conn, &mut lock(), now_ms()) {
                        log.log(
                            Level::ERROR,
                            json!({ "err": { "message": e.to_string() }, "tick": world.tick }),
                            "explored terrain save failed",
                        );
                    }
                });
            }
            look(ProbePoint::End, world);
        };
        let mut orders = Probed { inner: orders, look: &look };
        let mut queues = queues.as_mut().map(|inner| Probed { inner, look: &look });
        let mut scripts = scripts.as_mut().map(|inner| Probed { inner, look: &look });
        let mut walking = Budgeted { walking, budget_ms: *path_budget_ms };
        let mut opts =
            TickOptions::new(reporter, settings.invariant_sample_rate, settings.slow_tick_ms);
        opts.orders = Some(&mut orders);
        opts.queues = queues.as_mut().map(|q| q as &mut dyn RunQueues);
        opts.scripts = scripts.as_mut().map(|s| s as &mut dyn RunScripts);
        opts.walking = Some(&mut walking);
        opts.finish = Some(&mut finish);
        let health = run_tick(world, map, scratch, opts);
        tag_world(world);
        health
    }

    /// The daily jobs: expired sessions go, the script library is checked, and a backup is
    /// written when there is a backup dir.
    pub fn daily(&mut self, conn: &Connection, backup_dir: Option<&Path>) {
        if let Err(e) = delete_expired_sessions(conn, now_ms()) {
            self.log.log(
                Level::ERROR,
                json!({ "err": { "message": e.to_string() } }),
                "expired sessions not deleted",
            );
        }
        // The script library lives in the database, so its invariant is checked here.
        self.check_script_library(conn);
        if let Some(dir) = backup_dir {
            match backup_db(conn, dir, Reason::Daily, SystemTime::now()) {
                Ok(file) => self.log.log(Level::INFO, json!({ "file": file }), "backup written"),
                Err(e) => self.log.log(
                    Level::ERROR,
                    json!({ "err": { "message": e.to_string() } }),
                    "backup failed",
                ),
            }
        }
    }

    /// Shutdown's saves: the world synchronously, dropping any save still in flight, and the
    /// explored terrain.
    pub fn save_for_shutdown(&mut self, conn: &Connection) -> Result<(), ServerError> {
        self.saver.save_now(conn, &self.world)?;
        let explored = Arc::clone(&self.explored);
        save_explored(conn, &mut explored.lock().unwrap_or_else(|e| e.into_inner()), now_ms())?;
        Ok(())
    }
}

/// Work for the game thread between ticks: it gets the game and its connection.
/// A phase of the tick, looked at once it has run (the shadow run's probe).
struct Probed<'a, T: ?Sized> {
    inner: &'a mut T,
    look: &'a dyn Fn(ProbePoint, &WorldState),
}

impl<T: ApplyOrders + ?Sized> ApplyOrders for Probed<'_, T> {
    fn apply_all(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        self.inner.apply_all(world, scratch);
        (self.look)(ProbePoint::Orders, world);
    }
}

impl<T: RunQueues + ?Sized> RunQueues for Probed<'_, T> {
    fn run_all(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        self.inner.run_all(world, scratch);
        (self.look)(ProbePoint::Queues, world);
    }
}

impl<T: RunScripts + ?Sized> RunScripts for Probed<'_, T> {
    fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        check: bool,
    ) -> Vec<InvariantViolation> {
        let violations = self.inner.run_all(world, scratch, check);
        (self.look)(ProbePoint::Scripts, world);
        violations
    }
    fn runs(&self) -> usize {
        self.inner.runs()
    }
}

/// Walking with a wall-clock budget for its path searches other than [`PATH_BUDGET_MS`].
struct Budgeted<'a> {
    walking: &'a mut Walking,
    budget_ms: f64,
}

impl Walk for Budgeted<'_> {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.walking.request_steps(world, scratch, self.budget_ms);
        self.walking.resolve(world, scratch, &steps);
        steps.len()
    }

    fn ways(&mut self) -> Option<&mut dyn csp_sim::npc_roads::WayFinder> {
        self.walking.ways()
    }
}

pub type Job<L> = Box<dyn FnOnce(&mut Game<L>, &Connection) + Send>;

enum Command<L: LogSink> {
    Tick(oneshot::Sender<Option<TickHealth>>),
    Run(Job<L>),
    Stop(oneshot::Sender<Result<(), ServerError>>),
}

/// The game thread: it owns the [`Game`] (whose scratch memory never leaves it) and its
/// database connection, and does one thing at a time, a tick or a job between ticks, so nothing
/// reads the world while a tick runs.
pub struct GameThread<L: LogSink> {
    tx: mpsc::Sender<Command<L>>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// The last hour of tick health, readable from anywhere.
    pub tick_health: Arc<Mutex<TickHealthWindow>>,
    /// The world's tick and seed as it was loaded.
    pub started_at: (u64, i64),
    /// When the tick health window's clock started (`ServerReporter::started`).
    pub tick_clock: std::time::Instant,
}

fn thread_gone() -> ServerError {
    ServerError::Io(std::io::Error::other("the game thread ended"))
}

impl<L: LogSink + 'static> GameThread<L> {
    /// Starts the thread, which opens the game with `open`; returns once it is open.
    pub fn spawn(
        open: impl FnOnce() -> Result<(Connection, Game<L>), ServerError> + Send + 'static,
        settings: TickSettings,
    ) -> Result<Self, ServerError> {
        let (tx, rx) = mpsc::channel::<Command<L>>();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread = std::thread::Builder::new().name("game".into()).spawn(move || {
            let (conn, mut game) = match open() {
                Ok(opened) => opened,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let _ = ready_tx.send(Ok((
                game.tick_health(),
                (game.world.tick, game.world.seed),
                game.reporter.started(),
            )));
            for command in rx {
                match command {
                    Command::Tick(reply) => {
                        let _ = reply.send(game.tick(&conn, settings));
                    }
                    Command::Run(job) => job(&mut game, &conn),
                    Command::Stop(reply) => {
                        let _ = reply.send(game.save_for_shutdown(&conn));
                        return;
                    }
                }
            }
        })?;
        let (tick_health, started_at, tick_clock) =
            ready_rx.recv().map_err(|_| thread_gone())??;
        Ok(Self { tx, thread: Some(thread), tick_health, started_at, tick_clock })
    }

    /// Runs one tick and waits for it.
    pub async fn tick(&self) -> Option<TickHealth> {
        let (reply, done) = oneshot::channel();
        self.tx.send(Command::Tick(reply)).ok()?;
        done.await.ok().flatten()
    }

    /// Runs `f` on the game between ticks and waits for its result; `None` if the thread ended.
    pub async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Game<L>, &Connection) -> T + Send + 'static,
    ) -> Option<T> {
        let (reply, done) = oneshot::channel();
        let job: Job<L> = Box::new(move |game, conn| {
            let _ = reply.send(f(game, conn));
        });
        self.tx.send(Command::Run(job)).ok()?;
        done.await.ok()
    }

    /// Saves the world for shutdown and ends the thread.
    pub async fn stop(mut self) -> Result<(), ServerError> {
        let (reply, done) = oneshot::channel();
        self.tx.send(Command::Stop(reply)).map_err(|_| thread_gone())?;
        let saved = done.await.map_err(|_| thread_gone())?;
        if let Some(thread) = self.thread.take() {
            let _ = tokio::task::spawn_blocking(move || thread.join()).await;
        }
        saved
    }
}

/// Opens the database, backed up first if it exists and there is a backup dir (ADR 0007), and
/// the world on it.
pub fn open_world(config: &Config) -> Result<(Connection, Game<TracingLog>), ServerError> {
    let log = TracingLog;
    let mut backup = |conn: &Connection| -> Result<(), DbError> {
        if let Some(dir) = &config.backup_dir {
            let file = backup_db(conn, dir, Reason::Start, SystemTime::now())?;
            log.log(Level::INFO, json!({ "file": file }), "backup written");
        }
        Ok(())
    };
    let conn = open_db(&config.db_path, Some(&mut backup))?;
    let (world, terrain) =
        load_or_create_world(&conn, |seed| generate_terrain(seed, MAP_SIZE), generate_world, 1)?;
    let explored = load_explored(&conn, terrain.clone(), &world.nodes)?;
    tag_world(&world);
    let defaults = crate::scripts::game_defaults();
    // Players who haven't edited a default script run the game's current default from now on.
    crate::scripts::sync_default_scripts(&conn, defaults)?;
    // The script host reads the library on a connection of its own, as the scripts run.
    let library = Arc::new(Mutex::new(open_db(&config.db_path, None)?));
    let mut game = Game::new(world, terrain, explored, log).with_library(
        library,
        defaults,
        Some(reported_script_errors()),
    );
    // Players whose scripts read a field a script view dropped since the last start are told so.
    if note_script_view_changes(&conn, &mut game.world)? {
        game.saver.save_now(&conn, &game.world)?;
    }
    // The script library lives in the database, so its invariant is checked at start and daily.
    game.check_script_library(&conn);
    Ok((conn, game))
}

/// A tick reporter of its own for what is reported outside the tick's: the sampled sight checks
/// and the game's errors running scripts, logged and sent to Sentry as the tick's are.
fn side_reporter() -> Arc<Mutex<ServerReporter<TracingLog>>> {
    Arc::new(Mutex::new(ServerReporter::new(TracingLog)))
}

/// Script errors of the game's own, reported as `reporter.scriptError`.
fn reported_script_errors() -> ScriptErrors {
    let reporter = side_reporter();
    Box::new(move |world, error, at| {
        reporter.lock().unwrap_or_else(|e| e.into_inner()).script_error(world, error, at);
    })
}

/// Resolves on SIGINT, or SIGTERM where there is one.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("a SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

/// Ticks `game` at start + n Ã— `period` until `stop` resolves, with the daily jobs every `day`:
/// a slow tick skips the ticks it missed instead of rushing to catch up, so the schedule never
/// drifts, and the next tick starts only once the last one is done.
pub async fn tick_loop<L: LogSink + 'static>(
    game: &GameThread<L>,
    period: Duration,
    day: Duration,
    backup_dir: Option<PathBuf>,
    stop: impl std::future::Future<Output = ()>,
) {
    let mut ticks = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut daily = tokio::time::interval_at(tokio::time::Instant::now() + day, day);
    tokio::pin!(stop);
    loop {
        tokio::select! {
            _ = ticks.tick() => {
                game.tick().await;
            }
            _ = daily.tick() => {
                let dir = backup_dir.clone();
                game.run(move |g, conn| g.daily(conn, dir.as_deref())).await;
            }
            _ = &mut stop => break,
        }
    }
}

/// Runs the server until a shutdown signal: the tick loop, the daily jobs, the shutdown save.
pub async fn run(config: Config) -> Result<(), ServerError> {
    let sentry = init_sentry(config.sentry_dsn.as_deref(), &config.environment);
    let open_config = config.clone();
    let game = tokio::task::spawn_blocking(move || {
        let settings = TickSettings::from(&open_config);
        GameThread::spawn(move || open_world(&open_config), settings)
    })
    .await
    .map_err(|e| ServerError::Io(std::io::Error::other(e.to_string())))??;
    let (tick, seed) = game.started_at;
    let game = Arc::new(game);

    // The HTTP side, on its own connection; the game thread has migrated the database already.
    let http_db = open_db(&config.db_path, None)?;
    let defaults = crate::scripts::game_defaults();
    let window = Arc::clone(&game.tick_health);
    let clock = game.tick_clock;
    // The sockets, with their own connection for sessions and the first-day card.
    let realtime = Realtime::new(RealtimeOptions {
        db: Arc::new(Mutex::new(open_db(&config.db_path, None)?)),
        origins: config.origins.clone(),
        limits: config.realtime.clone(),
        // The sampled sight checks report as the tick's invariants do (`reporter`).
        sight_check: Some(SightCheck {
            sample_rate: config.invariant_sample_rate,
            report: {
                let reporter = side_reporter();
                Box::new(move |world, violations| {
                    reporter
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .invariant_violations(world, violations);
                })
            },
            rand: Box::new(rand_unit),
        }),
        on_error: Some(Box::new(|error, user_id| {
            TracingLog.log(
                Level::ERROR,
                json!({ "err": { "message": error }, "userId": user_id }),
                "client message failed",
            );
        })),
        now: None,
    });
    {
        let rt = Arc::clone(&realtime);
        game.run(move |g, _| g.realtime = Some(rt)).await;
    }
    let mut opts = AppOptions::new(http_db);
    opts.sockets = Some(Arc::clone(&realtime) as Arc<dyn SessionSockets + Send + Sync>);
    opts.realtime = Some(Arc::clone(&realtime));
    opts.secure_cookies = config.secure_cookies;
    opts.trust_proxy = config.trust_proxy;
    opts.web_dist = config.web_dist.clone();
    opts.game = Some(Arc::clone(&game) as Arc<dyn GameHandle>);
    opts.defaults = defaults;
    let slow_tick_ms = config.slow_tick_ms;
    opts.tick_health = Some(Arc::new(move || {
        let now = clock.elapsed().as_secs_f64() * 1000.0;
        let response = window.lock().unwrap_or_else(|e| e.into_inner()).response(now, slow_tick_ms);
        serde_json::to_value(response).unwrap_or_default()
    }));
    let app = build_app(opts);
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;

    // One signal stops both the loop and HTTP.
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        shutdown_signal().await;
        let _ = stop_tx.send(true);
    });
    let stopped = |mut rx: tokio::sync::watch::Receiver<bool>| async move {
        let _ = rx.wait_for(|&stop| stop).await;
    };
    let http = tokio::spawn(
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .with_graceful_shutdown(stopped(stop_rx.clone()))
            .into_future(),
    );
    TracingLog.log(
        Level::INFO,
        json!({ "tick": tick, "seed": seed, "sentry": sentry.is_some() }),
        &format!("world at tick {tick}, ticking every {TICK_MS} ms"),
    );
    tick_loop(
        &game,
        Duration::from_millis(TICK_MS),
        DAY,
        config.backup_dir.clone(),
        stopped(stop_rx),
    )
    .await;
    // The sockets close first, as `realtime.close()` before `app.close()`.
    realtime.close();
    if let Ok(Err(e)) = http.await {
        TracingLog.log(Level::ERROR, json!({ "err": { "message": e.to_string() } }), "http failed");
    }
    // HTTP and the sockets let go of the game once they have stopped, so the save has it alone.
    let mut game = game;
    let mut waited = 0;
    let saved = loop {
        match Arc::try_unwrap(game) {
            Ok(alone) => break alone.stop().await,
            Err(shared) if waited < 50 => {
                game = shared;
                waited += 1;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(_) => {
                break Err(ServerError::Io(std::io::Error::other("the game is still in use")))
            }
        }
    };
    if let Err(e) = &saved {
        TracingLog.log(
            Level::ERROR,
            json!({ "err": { "message": e.to_string() } }),
            "shutdown save failed",
        );
    }
    // Flushes Sentry (up to its shutdown timeout, 2 s).
    drop(sentry);
    saved
}

/// A draw in [0, 1) for the sampled checks (`Math.random`): the clock's nanoseconds mixed.
fn rand_unit() -> f64 {
    let nanos =
        SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let mut z = (nanos as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}
