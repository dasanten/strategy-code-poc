//! The WebSocket side (ADR 0006; `apps/server/src/realtime.ts`): only logged-in sessions
//! connect; each client gets what its Player sees and their realm log on connect, then the
//! changes every tick; orders come back the same way.
//!
//! The socket tasks do only what needs no world: the origin, the session, the connection cap,
//! the message allowance, and passing frames on. Everything that reads or changes the world (the
//! welcome, founding, orders, watching a script) runs on the game thread between ticks, as a job
//! in the order the frames came, and the tick message is made there during the tick's broadcast
//! phase ([`Realtime::broadcast_tick`]). The clients' state lives in the [`Realtime`] hub, which
//! both sides reach.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::protocol::{OrderRequest, Remembered};
use csp_shared::world::WorldState;
use csp_sim::explored::ExploredTerrain;
use csp_sim::last_seen::{
    last_seen_in_sight, last_seen_on_cadence, last_seen_out_of_sight, LastSeenState,
};
use csp_sim::order_sender::{Account, OrderSender};
use csp_sim::orders::OrderReply;
use csp_sim::queries::alliance::commander_of;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::people::founding_problem;
use csp_sim::queries::region_map::{region_map_for, RegionMap};
use csp_sim::queries::territory::Territory;
use csp_sim::region_map::region_map_unsound;
use csp_sim::sight::{
    entities_in_sight, sent_inside_unseen, sent_out_of_sight, with_sight, InvariantViolation,
};
use csp_sim::starting_city::{found_starting_city, suggested_leader_name, FoundingNames};
use csp_sim::tick::Scratch;
use csp_sim::world_index::{world_index, WorldIndex};
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;

use crate::app::{cookie_value, GameHandle, GameView, SESSION_COOKIE};
use crate::auth::{get_session_user, hash_token, now_ms, session_alive, SessionSockets};
use crate::config::{Origins, RealtimeLimits};
use crate::diplomacy::{carried_ways_for, diplomacy_for, realms_seen, storages_seen};
use crate::first_day::{first_day_line_of, mark_first_day, read_first_day};
use crate::sync::{ClientView, HasId, SyncRound};

/// Where the client opens its socket (`WS_PATH`).
pub const WS_PATH: &str = "/ws";
/// The close code of a socket that sent too many messages (`WS_CLOSE_TOO_MANY_REQUESTS`).
pub const WS_CLOSE_TOO_MANY_REQUESTS: u16 = 4429;
/// The close code of a socket whose session ended (`WS_CLOSE_LOGGED_OUT`).
pub const WS_CLOSE_LOGGED_OUT: u16 = 4001;
/// The most scripts one client watches at once (`SCRIPT_WATCH_MAX`).
pub const SCRIPT_WATCH_MAX: usize = 20;
/// How often each client's session is checked again after the handshake (`SESSION_RECHECK_MS`).
pub const SESSION_RECHECK_MS: i64 = 60_000;

impl HasId for csp_shared::protocol::SeenEntity {
    fn id(&self) -> &str {
        csp_shared::protocol::SeenEntity::id(self)
    }
}

type Seen = csp_shared::protocol::SeenEntity;

impl HasId for Remembered {
    fn id(&self) -> &str {
        match self {
            Remembered::Building(b) => &b.id,
            Remembered::City(c) => &c.id,
        }
    }
}

/// What the broadcast reads beside the world: the territory worked out last, and the Players'
/// explored terrain, for the Region map.
#[derive(Clone, Copy)]
pub struct TickView<'a> {
    pub territory: Option<&'a Territory>,
    pub explored: &'a ExploredTerrain,
}

/// What goes out on a socket.
#[derive(Debug, Clone, PartialEq)]
pub enum Outgoing {
    Text(String),
    Close(u16, &'static str),
}

/// A connected socket's session: what it is closed by when the session ends.
struct Session {
    token_hash: String,
    user_id: i64,
    out: mpsc::UnboundedSender<Outgoing>,
}

impl Session {
    fn send(&self, json: String) {
        let _ = self.out.send(Outgoing::Text(json));
    }
}

/// What was last sent to a watched script's tab, as JSON.
#[derive(Default)]
struct Watched {
    memory: String,
    run: String,
    log: String,
}

/// A client with a realm (`Client`).
struct Client {
    user_id: i64,
    realm_id: String,
    /// The residents and armies whose Script tab the Player has open, in the order asked.
    watching: Vec<(String, Watched)>,
    view: ClientView,
    /// What was last sent of what the Player remembers out of sight.
    last_seen_view: ClientView,
    last_event_seq: u64,
    last_diplomacy: String,
    /// The territory's tick the last Region map sent was of; none before the first.
    region_tick: Option<u64>,
    leader_id: String,
    realm_name: Option<String>,
    horse_offer: bool,
    last_work_settings: String,
    last_waypoints: String,
    last_trader_visits: String,
}

#[derive(Default)]
struct Hub {
    next_id: u64,
    /// Every connected socket, whether or not its Player has a realm yet, in the order they came.
    sessions: indexmap::IndexMap<u64, Session>,
    clients: indexmap::IndexMap<u64, Client>,
    last_session_check: i64,
}

/// Where the sampled sight checks report what they found.
pub type ReportViolations = Box<dyn Fn(&WorldState, &[InvariantViolation]) + Send + Sync>;
/// Told of an error that escaped a client's message handler, with the Player's id.
pub type OnError = Box<dyn Fn(&str, i64) + Send + Sync>;

/// Checks, on the sampled share of ticks, that nothing is sent outside a Player's sight or from
/// inside what they may not see, and reports what is (`sightCheck`).
pub struct SightCheck {
    pub sample_rate: f64,
    pub report: ReportViolations,
    pub rand: Box<dyn Fn() -> f64 + Send + Sync>,
}

/// The WebSocket hub (`attachRealtime`).
pub struct Realtime {
    db: Arc<Mutex<Connection>>,
    origins: Origins,
    limits: RealtimeLimits,
    hub: Mutex<Hub>,
    sight_check: Option<SightCheck>,
    /// Told of an error that escaped a client's message handler (ADR 0004).
    on_error: Option<OnError>,
    /// The clock the message allowance runs on, in ms.
    now: Box<dyn Fn() -> f64 + Send + Sync>,
}

/// What `Realtime` is built with.
pub struct RealtimeOptions {
    pub db: Arc<Mutex<Connection>>,
    pub origins: Origins,
    pub limits: RealtimeLimits,
    pub sight_check: Option<SightCheck>,
    pub on_error: Option<OnError>,
    pub now: Option<Box<dyn Fn() -> f64 + Send + Sync>>,
}

/// Whether a WebSocket upgrade comes from a page the game may be played from (`originAllowed`):
/// one of the allowed origins, or the request's own host. Any other page's socket is refused, so
/// a site a Player's browser also has open can't play as them with their cookie.
pub fn origin_allowed(headers: &HeaderMap, policy: &Origins) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else { return policy.allow_missing };
    let Ok(origin) = origin.to_str() else { return false };
    if policy.allowed.iter().any(|o| o == origin) {
        return true;
    }
    // `new URL(origin).host`: what follows the scheme, up to the path.
    let Some((_, rest)) = origin.split_once("://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let own = headers.get(header::HOST).and_then(|h| h.to_str().ok());
    !host.is_empty() && Some(host) == own
}

/// A socket's allowance of messages: it holds up to `message_burst` and earns
/// `messages_per_second` back, each message spending one (`TokenBucket`).
struct TokenBucket {
    tokens: f64,
    last: f64,
    burst: f64,
    per_second: f64,
}

impl TokenBucket {
    fn take(&mut self, now: f64) -> bool {
        let earned = (now - self.last) / 1000.0 * self.per_second;
        self.tokens = self.burst.min(self.tokens + earned);
        self.last = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

/// The script a resident or army runs for the realm, if any (`runningScriptFor`).
fn running_script_for<'w>(
    world: &'w WorldState,
    realm_id: &str,
    id: &str,
) -> Option<&'w csp_shared::world::RunningScript> {
    if let Some(r) = world.residents.iter().find(|r| r.id == id) {
        let commands = commander_of(world, &r.id, r.owner.as_deref()).as_deref() == Some(realm_id);
        return if commands { r.script.as_ref() } else { None };
    }
    let army = world.armies.iter().find(|a| a.id == id)?;
    if army.realm_id == realm_id {
        army.script.as_ref()
    } else {
        None
    }
}

/// The memory of the script a resident or army runs, for the realm running it (`scriptMemoryFor`):
/// null when it runs none, or another realm runs it.
pub fn script_memory_for(world: &WorldState, realm_id: &str, id: &str) -> Value {
    running_script_for(world, realm_id, id)
        .map_or(Value::Null, |s| serde_json::to_value(&s.memory).unwrap_or(Value::Null))
}

/// How the script a resident or army runs last ran, for the realm running it (`scriptRunFor`):
/// its last runtime error, the steps it used and since when it waits; null as above.
pub fn script_run_for(world: &WorldState, realm_id: &str, id: &str) -> Value {
    let Some(s) = running_script_for(world, realm_id, id) else { return Value::Null };
    let mut run = Map::new();
    if let Some(e) = &s.last_error {
        run.insert("lastError".into(), serde_json::to_value(e).unwrap_or(Value::Null));
    }
    if let Some(r) = &s.last_run {
        run.insert("lastRun".into(), serde_json::to_value(r).unwrap_or(Value::Null));
    }
    if let Some(w) = s.waiting_since {
        run.insert("waitingSince".into(), json!(w));
    }
    Value::Object(run)
}

/// A resident's script log, for the realm owning them (`scriptLogFor`): null for anyone else's
/// resident, or an army.
pub fn script_log_for(world: &WorldState, realm_id: &str, id: &str) -> Value {
    match world.residents.iter().find(|r| r.id == id) {
        Some(r) if r.owner.as_deref() == Some(realm_id) => {
            serde_json::to_value(r.script_log.clone().unwrap_or_default()).unwrap_or(Value::Null)
        }
        _ => Value::Null,
    }
}

/// The realm events of a Player after `after`, as sent, and the last one's number.
fn events_json(world: &WorldState, user_id: i64, after: u64) -> (Value, Option<u64>) {
    let events = csp_sim::events::events_for(world, user_id as u64, after);
    let last = events.last().map(|e| e.seq);
    (serde_json::to_value(events).unwrap_or(Value::Array(vec![])), last)
}

/// The Player's alliance matters as their realm sees them, with the realms and storages among
/// what they see (`diplomacyFor` with `carriedWaysFor`).
fn diplomacy_of(world: &WorldState, size: i32, realm_id: &str, seen: &[Seen]) -> Value {
    let ways = carried_ways_for(world, size, realm_id, storages_seen(seen));
    let diplomacy = diplomacy_for(world, realm_id, realms_seen(seen), ways);
    serde_json::to_value(diplomacy).expect("serialisable")
}

/// The traders standing at the realm's cities (`traderVisitsTo`).
fn trader_visits_to(world: &WorldState, realm_id: &str) -> Value {
    serde_json::to_value(csp_sim::queries::trader_trade::trader_visits_to(world, realm_id))
        .expect("serialisable")
}

/// The Region map to send a client, if any (`regionFor`): all of it when territory was worked out
/// again since the last one went out, else the chunks whose explored terrain grew.
fn region_for(
    client: &mut Client,
    world: &WorldState,
    size: i32,
    view: TickView<'_>,
    grown: &[usize],
) -> Option<RegionMap> {
    let territory = view.territory?;
    let fresh = Some(territory.tick) != client.region_tick;
    if !fresh && grown.is_empty() {
        return None;
    }
    client.region_tick = Some(territory.tick);
    let user_id = client.user_id as u64;
    let is_explored = |x: i32, y: i32| view.explored.is_explored(user_id, x, y);
    let chunks = (!fresh).then(|| grown.iter().map(|&c| c as i32).collect());
    Some(region_map_for(world, territory, size, &is_explored, chunks))
}

/// Why the names given to found a realm won't do (`foundingProblem`), or none: a name that is no
/// string is none given.
fn founding_problem_of(realm_name: &Value, leader_name: &Value) -> Option<String> {
    founding_problem(realm_name.as_str(), leader_name.as_str())
}

/// The realms whose residents are among the entities, and the cities among them (`realmsSeen`).
fn json_of<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

impl Realtime {
    pub fn new(opts: RealtimeOptions) -> Arc<Self> {
        let start = std::time::Instant::now();
        Arc::new(Realtime {
            db: opts.db,
            origins: opts.origins,
            limits: opts.limits,
            hub: Mutex::new(Hub { last_session_check: now_ms(), ..Hub::default() }),
            sight_check: opts.sight_check,
            on_error: opts.on_error,
            now: opts
                .now
                .unwrap_or_else(|| Box::new(move || start.elapsed().as_secs_f64() * 1000.0)),
        })
    }

    fn hub(&self) -> MutexGuard<'_, Hub> {
        self.hub.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// How many sockets an account holds open, with or without a realm (the connection cap).
    fn sockets_of(&self, user_id: i64) -> usize {
        self.hub().sessions.values().filter(|s| s.user_id == user_id).count()
    }

    /// Closes a socket because its session ended; the client shows the login screen.
    fn end_session(hub: &mut Hub, socket: u64) {
        if let Some(s) = hub.sessions.shift_remove(&socket) {
            let _ = s.out.send(Outgoing::Close(WS_CLOSE_LOGGED_OUT, "logged out"));
        }
        hub.clients.shift_remove(&socket);
    }

    /// Closes the sockets of one session: called when it is logged out.
    pub fn disconnect_session(&self, token_hash: &str) {
        let mut hub = self.hub();
        let ended: Vec<u64> = hub
            .sessions
            .iter()
            .filter(|(_, s)| s.token_hash == token_hash)
            .map(|(id, _)| *id)
            .collect();
        for socket in ended {
            Self::end_session(&mut hub, socket);
        }
    }

    /// Closes every socket of an account: called when a password reset ends all its sessions.
    pub fn disconnect_user(&self, user_id: i64) {
        let mut hub = self.hub();
        let ended: Vec<u64> =
            hub.sessions.iter().filter(|(_, s)| s.user_id == user_id).map(|(id, _)| *id).collect();
        for socket in ended {
            Self::end_session(&mut hub, socket);
        }
    }

    /// Closes the sockets whose session is gone or expired, at most once in `SESSION_RECHECK_MS`.
    fn recheck_sessions(&self, now: i64) {
        let mut hub = self.hub();
        if now - hub.last_session_check < SESSION_RECHECK_MS {
            return;
        }
        hub.last_session_check = now;
        let sessions: Vec<(u64, String)> =
            hub.sessions.iter().map(|(id, s)| (*id, s.token_hash.clone())).collect();
        let db = self.db();
        for (socket, token_hash) in sessions {
            if !session_alive(&db, &token_hash, now).unwrap_or(true) {
                Self::end_session(&mut hub, socket);
            }
        }
    }

    fn sampled(&self) -> Option<&SightCheck> {
        let check = self.sight_check.as_ref()?;
        (check.sample_rate >= 1.0 || (check.rand)() < check.sample_rate).then_some(check)
    }

    /// Reports entities about to go to a realm's Player outside their sight, on sampled ticks.
    fn check_sent(&self, world: &WorldState, index: &WorldIndex, realm_id: &str, sent: &[Seen]) {
        let Some(check) = self.sampled() else { return };
        let mut violations = sent_out_of_sight(world, index, realm_id, sent);
        violations.extend(sent_inside_unseen(world, index, realm_id, sent));
        if !violations.is_empty() {
            (check.report)(world, &violations);
        }
    }

    /// Reports Last seen about to go to a realm's Player that is in their sight, or that is off
    /// its cadence, as `check_sent` (`checkLastSeen`).
    fn check_last_seen(
        &self,
        world: &WorldState,
        terrain: &TerrainMap,
        cadence: &LastSeenState,
        realm_id: &str,
        sent: &[Remembered],
    ) {
        let Some(check) = self.sampled() else { return };
        let mut violations = if sent.is_empty() {
            Vec::new()
        } else {
            last_seen_in_sight(world, terrain, realm_id, sent)
        };
        violations.extend(last_seen_on_cadence(world, cadence, realm_id));
        if !violations.is_empty() {
            (check.report)(world, &violations);
        }
    }

    /// Reports a Region map about to go to a realm's Player that shows what they may not see, as
    /// `check_sent` (`regionFor`'s check).
    fn check_region(
        &self,
        world: &WorldState,
        size: i32,
        view: TickView<'_>,
        client: &Client,
        region: &RegionMap,
    ) {
        let Some(territory) = view.territory else { return };
        let Some(check) = self.sampled() else { return };
        let user_id = client.user_id as u64;
        let is_explored = |x: i32, y: i32| view.explored.is_explored(user_id, x, y);
        let violations =
            region_map_unsound(region, territory, size, &is_explored, &client.realm_id);
        if !violations.is_empty() {
            (check.report)(world, &violations);
        }
    }

    /// The Region map to send a client, if any, checked on sampled ticks.
    fn region(
        &self,
        client: &mut Client,
        world: &WorldState,
        size: i32,
        view: TickView<'_>,
        grown: &[usize],
    ) -> Option<Value> {
        let region = region_for(client, world, size, view, grown)?;
        self.check_region(world, size, view, client, &region);
        Some(serde_json::to_value(region).expect("serialisable"))
    }

    /// Starts sending a Player with a realm their world: the welcome now, then every tick.
    fn welcome(
        &self,
        g: &mut GameView<'_>,
        socket: u64,
        user: &Value,
        user_id: i64,
        realm_id: &str,
    ) {
        let size = g.terrain.size;
        // Their residents look around before the welcome goes out.
        {
            let index = world_index(&mut g.scratch.index, g.world, size);
            g.sight.update(g.world, index, g.explored);
        }
        let world = &*g.world;
        let Some(realm) = world.realms.iter().find(|r| r.id == realm_id) else { return };
        let mut client = Client {
            user_id,
            realm_id: realm.id.clone(),
            watching: Vec::new(),
            view: ClientView::new(),
            last_seen_view: ClientView::new(),
            last_event_seq: 0,
            last_diplomacy: String::new(),
            region_tick: None,
            leader_id: realm.leader_id.clone(),
            realm_name: realm.name.clone(),
            horse_offer: !world.horse_offers_claimed.contains(&(user_id as u64)),
            last_work_settings: String::new(),
            last_waypoints: json_of(
                &world.waypoints.get(&(user_id as u64)).cloned().unwrap_or_default(),
            ),
            last_trader_visits: json_of(&trader_visits_to(world, &realm.id)),
        };
        // The view starts at the town hall of the realm's first city, or with the Leader if it
        // has none left.
        let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.id.as_str()));
        let leader = world.residents.iter().find(|r| r.id == realm.leader_id);
        let (x, y) = city
            .and_then(|c| town_hall_of(world, c))
            .map(|b| (b.x, b.y))
            .or_else(|| leader.map(|r| (r.x, r.y)))
            .unwrap_or((0.0, 0.0));
        let index = world_index(&mut g.scratch.index, world, size);
        let in_sight = entities_in_sight(world, index, Some(&realm.id), None);
        let entities = client.view.initial(&in_sight);
        self.check_sent(world, index, &realm.id, &entities);
        let remembered = last_seen_out_of_sight(world, index, user_id as u64);
        let last_seen = client.last_seen_view.initial(&remembered);
        self.check_last_seen(world, g.terrain, &g.scratch.last_seen, &realm.id, &last_seen);
        // Their map is fresh from the next tick, not when the realm's turn comes round.
        g.scratch.last_seen.refresh_soon(&realm.id);
        let (events, last) = events_json(world, user_id, 0);
        client.last_event_seq = last.unwrap_or(0);
        let diplomacy = diplomacy_of(world, size, &realm.id, &entities);
        client.last_diplomacy = json_of(&diplomacy);
        let work_settings = world
            .workplace_settings
            .get(&realm.id)
            .map_or_else(|| json!({}), |s| serde_json::to_value(s).unwrap_or(json!({})));
        client.last_work_settings = json_of(&work_settings);
        let first_day = read_first_day(&self.db(), user_id).ok();
        let view = TickView { territory: g.territory, explored: &*g.explored };
        let region = self.region(&mut client, world, size, view, &[]).unwrap_or(Value::Null);
        let welcome = json!({
            "type": "welcome",
            "account": user,
            "tick": world.tick,
            "map": { "seed": world.seed, "size": size },
            "exploredChunks": g.explored.explored_chunks(user_id as u64),
            "home": {
                "realmId": realm.id,
                "leaderId": realm.leader_id,
                "realmName": client.realm_name,
                "cityId": city.map(|c| c.id.clone()),
                "x": x,
                "y": y,
            },
            "entities": entities,
            "lastSeen": last_seen,
            "events": events,
            "diplomacy": diplomacy,
            "region": region,
            "horseOffer": client.horse_offer,
            "waypoints": world.waypoints.get(&(user_id as u64)).cloned().unwrap_or_default(),
            "traderVisits": trader_visits_to(world, &realm.id),
            "firstDay": first_day,
            "workSettings": work_settings,
        });
        let mut hub = self.hub();
        if let Some(s) = hub.sessions.get(&socket) {
            s.send(welcome.to_string());
            hub.clients.insert(socket, client);
        }
    }

    /// Ticks the first-day line an accepted order of the Player's ticks, if any, and tells every
    /// tab of theirs when that changed their card (`tickFirstDayFor`).
    fn tick_first_day_for(&self, user_id: i64, order: &Value) {
        let Ok(order) = serde_json::from_value::<OrderRequest>(order.clone()) else { return };
        let Some(line) = first_day_line_of(&order) else { return };
        let Ok(Some(card)) = mark_first_day(&self.db(), user_id, line) else { return };
        let msg = json!({ "type": "firstDay", "firstDay": card }).to_string();
        let hub = self.hub();
        for (socket, client) in &hub.clients {
            if client.user_id == user_id {
                if let Some(s) = hub.sessions.get(socket) {
                    s.send(msg.clone());
                }
            }
        }
    }

    fn send_to(&self, socket: u64, msg: Value) {
        if let Some(s) = self.hub().sessions.get(&socket) {
            s.send(msg.to_string());
        }
    }

    /// Answers a socket that just connected: the welcome, or the founding question for a Player
    /// without a realm (first login, or after a Leader death).
    pub fn connected(&self, g: &mut GameView<'_>, socket: u64, user: &Value, user_id: i64) {
        let realm =
            g.world.realms.iter().find(|r| r.user_id == user_id as u64).map(|r| r.id.clone());
        match realm {
            Some(realm) => self.welcome(g, socket, user, user_id, &realm),
            None => self.send_to(
                socket,
                json!({
                    "type": "founding",
                    "account": user,
                    "leaderName": suggested_leader_name(g.world, user_id as u64),
                }),
            ),
        }
    }

    /// Answers one message from a logged-in client (`handle`); an error in it is reported and
    /// answered `rejected`, and the socket stays open.
    pub fn message(
        &self,
        g: &mut GameView<'_>,
        socket: u64,
        user: &Value,
        user_id: i64,
        raw: &str,
    ) {
        let msg: Value = match serde_json::from_str(raw) {
            Ok(msg) => msg,
            Err(_) => {
                return self.send_to(
                    socket,
                    json!({ "type": "rejected", "requestId": "", "reason": "not JSON" }),
                )
            }
        };
        let handled =
            catch_unwind(AssertUnwindSafe(|| self.handle(g, socket, user, user_id, &msg)));
        if let Err(panic) = handled {
            let error = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "message handler panicked".into());
            if let Some(on_error) = &self.on_error {
                on_error(&error, user_id);
            }
            let request_id = msg.get("requestId").and_then(Value::as_str).unwrap_or("");
            self.send_to(
                socket,
                json!({ "type": "rejected", "requestId": request_id, "reason": "server error" }),
            );
        }
    }

    fn handle(&self, g: &mut GameView<'_>, socket: u64, user: &Value, user_id: i64, msg: &Value) {
        let kind = msg.get("type").and_then(Value::as_str);
        let request_id = || msg.get("requestId").and_then(Value::as_str).unwrap_or("").to_owned();
        let has_client = self.hub().clients.contains_key(&socket);
        if kind == Some("found") && !has_client {
            let (realm_name, leader_name) = (
                msg.get("realmName").unwrap_or(&Value::Null),
                msg.get("leaderName").unwrap_or(&Value::Null),
            );
            if let Some(problem) = founding_problem_of(realm_name, leader_name) {
                return self.send_to(
                    socket,
                    json!({ "type": "rejected", "requestId": request_id(), "reason": problem }),
                );
            }
            // Founded from another tab meanwhile: that realm stands, under the names given there.
            let names = FoundingNames {
                realm_name: realm_name.as_str().unwrap_or("").to_owned(),
                leader_name: leader_name.as_str().unwrap_or("").to_owned(),
            };
            let at = found_starting_city(g.world, g.terrain, user_id as u64, Some(&names));
            let realm = g.world.realms[at].id.clone();
            return self.welcome(g, socket, user, user_id, &realm);
        }
        if kind == Some("order") {
            if !has_client {
                return self.send_to(
                    socket,
                    json!({ "type": "rejected", "requestId": request_id(), "reason": "no realm yet" }),
                );
            }
            // A realm's orders waiting for the next tick are capped, so no script in a browser
            // console can pile up more than a tick works through.
            if g.orders.pending_for(user_id as u64) >= self.limits.pending_orders_per_realm {
                return self.send_to(
                    socket,
                    json!({
                        "type": "rejected",
                        "requestId": request_id(),
                        "reason": "too many orders waiting",
                    }),
                );
            }
            let account = Account {
                name: user["name"].as_str().unwrap_or("").to_owned(),
                is_admin: user["isAdmin"].as_bool().unwrap_or(false),
            };
            let sender = OrderSender { user_id: user_id as u64, account, npc_city_id: None };
            let order = msg.get("order").cloned().unwrap_or(Value::Null);
            let reply = g.orders.receive(
                g.world,
                &sender,
                msg.get("requestId").unwrap_or(&Value::Null),
                &order,
            );
            let acked = matches!(reply, OrderReply::Ack { .. });
            self.send_to(socket, serde_json::to_value(&reply).unwrap_or(Value::Null));
            // Accepted, so it is an order request.
            if acked {
                self.tick_first_day_for(user_id, &order);
            }
        }
        if kind == Some("watch") && has_client {
            let Some(ids) = msg.get("ids").and_then(Value::as_array) else { return };
            let ids: Vec<String> = ids
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .take(SCRIPT_WATCH_MAX)
                .collect();
            let mut hub = self.hub();
            let Hub { sessions, clients, .. } = &mut *hub;
            let (Some(client), Some(session)) = (clients.get_mut(&socket), sessions.get(&socket))
            else {
                return;
            };
            // Newly watched ones go out now; those still watched only when they change.
            let mut before: HashMap<String, Watched> = client.watching.drain(..).collect();
            client.watching = ids
                .into_iter()
                .map(|id| {
                    let w = before.remove(&id).unwrap_or_default();
                    (id, w)
                })
                .collect();
            send_script_memory(g.world, session, client);
            send_script_logs(g.world, session, client);
        }
    }

    /// Sends every client the changes in its sight since the last tick, and the chunks whose
    /// explored terrain grew for its Player, and its Player's new realm events, and the rest that
    /// changed (`broadcastTick`). First, once a minute, the sockets whose session ended meanwhile
    /// are closed. What a realm sees is worked out once and shared by its sockets.
    pub fn broadcast_tick(
        &self,
        world: &WorldState,
        terrain: &TerrainMap,
        scratch: &mut Scratch,
        explored: &BTreeMap<u64, BTreeSet<usize>>,
        view: TickView<'_>,
        now: i64,
    ) {
        self.recheck_sessions(now);
        let size = terrain.size;
        let Scratch { sight, index, last_seen: cadence, .. } = scratch;
        let cadence = &*cadence;
        let index = world_index(index, world, size);
        with_sight(sight.as_mut(), size, |cache| {
            let mut round = SyncRound::<Seen>::default();
            let mut hub = self.hub();
            let Hub { sessions, clients, .. } = &mut *hub;
            for (socket, client) in clients.iter_mut() {
                let Some(session) = sessions.get(socket) else { continue };
                let in_sight = entities_in_sight(world, index, Some(&client.realm_id), Some(cache));
                let diff = client.view.diff(&in_sight, &mut round);
                self.check_sent(world, index, &client.realm_id, &diff.changed);
                let mut tick = Map::new();
                tick.insert("type".into(), json!("tick"));
                tick.insert("tick".into(), json!(world.tick));
                let remembered =
                    Arc::new(last_seen_out_of_sight(world, index, client.user_id as u64));
                let remembered = client.last_seen_view.diff_alone(&remembered);
                self.check_last_seen(
                    world,
                    terrain,
                    cadence,
                    &client.realm_id,
                    &remembered.changed,
                );
                if !remembered.changed.is_empty() || !remembered.gone.is_empty() {
                    tick.insert(
                        "lastSeen".into(),
                        json!({ "changed": remembered.changed, "gone": remembered.gone }),
                    );
                }
                let grown: Vec<usize> = explored
                    .get(&(client.user_id as u64))
                    .map(|s| s.iter().copied().collect())
                    .unwrap_or_default();
                tick.insert("explored".into(), json!(grown));
                let (events, last) = events_json(world, client.user_id, client.last_event_seq);
                if let Some(last) = last {
                    client.last_event_seq = last;
                }
                tick.insert("events".into(), events);
                let diplomacy = diplomacy_of(world, size, &client.realm_id, &in_sight);
                let diplomacy_json = json_of(&diplomacy);
                if diplomacy_json != client.last_diplomacy {
                    client.last_diplomacy = diplomacy_json;
                    tick.insert("diplomacy".into(), diplomacy);
                }
                if let Some(region) = self.region(client, world, size, view, &grown) {
                    tick.insert("region".into(), region);
                }
                let realm = world.realms.iter().find(|r| r.id == client.realm_id);
                if let Some(leader_id) = realm.map(|r| r.leader_id.clone()) {
                    if leader_id != client.leader_id {
                        client.leader_id = leader_id.clone();
                        tick.insert("leaderId".into(), json!(leader_id));
                    }
                }
                if let Some(name) = realm.and_then(|r| r.name.clone()) {
                    if client.realm_name.as_deref() != Some(name.as_str()) {
                        client.realm_name = Some(name.clone());
                        tick.insert("realmName".into(), json!(name));
                    }
                }
                // Off once claimed, on again once an admin re-opens it (`CONTEXT.md`: Horse offer).
                let horse_offer = !world.horse_offers_claimed.contains(&(client.user_id as u64));
                if horse_offer != client.horse_offer {
                    client.horse_offer = horse_offer;
                    tick.insert("horseOffer".into(), json!(horse_offer));
                }
                let work_settings = world
                    .workplace_settings
                    .get(&client.realm_id)
                    .map_or_else(|| json!({}), |s| serde_json::to_value(s).unwrap_or(json!({})));
                let settings_json = json_of(&work_settings);
                if settings_json != client.last_work_settings {
                    client.last_work_settings = settings_json;
                    tick.insert("workSettings".into(), work_settings);
                }
                // Only the Player's own waypoints, only when they changed (`CONTEXT.md`: Waypoint).
                let waypoints =
                    world.waypoints.get(&(client.user_id as u64)).cloned().unwrap_or_default();
                let waypoints_json = json_of(&waypoints);
                if waypoints_json != client.last_waypoints {
                    client.last_waypoints = waypoints_json;
                    tick.insert("waypoints".into(), json!(waypoints));
                }
                let visits = trader_visits_to(world, &client.realm_id);
                let visits_json = json_of(&visits);
                if visits_json != client.last_trader_visits {
                    client.last_trader_visits = visits_json;
                    tick.insert("traderVisits".into(), visits);
                }
                // `changed` and `gone` go last, as the JSON the realm's sockets in step share.
                let rest = Value::Object(tick).to_string();
                let fragment = round.fragment(&diff);
                session.send(format!("{},{fragment}}}", &rest[..rest.len() - 1]));
                send_script_memory(world, session, client);
                send_script_logs(world, session, client);
            }
        });
    }

    /// Closes every socket (`close`).
    pub fn close(&self) {
        let mut hub = self.hub();
        for (_, s) in hub.sessions.drain(..) {
            let _ = s.out.send(Outgoing::Close(1000, ""));
        }
        hub.clients.clear();
    }

    /// The number of connected sockets, with or without a realm.
    pub fn socket_count(&self) -> usize {
        self.hub().sessions.len()
    }
}

/// Sends the client the memory of each script it watches, and how it last ran, where they
/// changed since they were last sent.
fn send_script_memory(world: &WorldState, session: &Session, client: &mut Client) {
    for (id, last) in &mut client.watching {
        let memory = script_memory_for(world, &client.realm_id, id);
        let memory_json = json_of(&memory);
        if memory_json != last.memory {
            last.memory = memory_json;
            session.send(json!({ "type": "scriptMemory", "id": id, "memory": memory }).to_string());
        }
        let run = script_run_for(world, &client.realm_id, id);
        let run_json = json_of(&run);
        if run_json != last.run {
            last.run = run_json;
            session.send(json!({ "type": "scriptRun", "id": id, "run": run }).to_string());
        }
    }
}

/// Sends the client the script log of each resident it watches that changed since last sent.
fn send_script_logs(world: &WorldState, session: &Session, client: &mut Client) {
    for (id, last) in &mut client.watching {
        let lines = script_log_for(world, &client.realm_id, id);
        let json = json_of(&lines);
        if json == last.log {
            continue;
        }
        last.log = json;
        session.send(json!({ "type": "scriptLog", "id": id, "lines": lines }).to_string());
    }
}

impl SessionSockets for Realtime {
    fn disconnect_session(&self, token_hash: &str) {
        Realtime::disconnect_session(self, token_hash);
    }
    fn disconnect_user(&self, user_id: i64) {
        Realtime::disconnect_user(self, user_id);
    }
}

/// Refuses an upgrade with a status and a reason, as `verifyClient`'s `done(false, …)`.
fn refuse(status: StatusCode, reason: &'static str) -> Response {
    (status, reason).into_response()
}

/// The WebSocket upgrade at `WS_PATH` (`verifyClient` and `connection`).
pub async fn upgrade(
    realtime: Arc<Realtime>,
    game: Arc<dyn GameHandle>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(&headers, &realtime.origins) {
        return refuse(StatusCode::FORBIDDEN, "Origin not allowed");
    }
    let header = headers.get(header::COOKIE).and_then(|v| v.to_str().ok());
    let token = cookie_value(header, SESSION_COOKIE);
    let user = match &token {
        Some(t) => match get_session_user(&realtime.db(), Some(t), now_ms()) {
            Ok(user) => user,
            Err(e) => {
                tracing::error!(err = %e, "WebSocket upgrade refused: unexpected error");
                return refuse(StatusCode::BAD_REQUEST, "Bad request");
            }
        },
        None => None,
    };
    let (Some(user), Some(token)) = (user, token) else {
        return refuse(StatusCode::UNAUTHORIZED, "Not logged in");
    };
    if realtime.sockets_of(user.id) >= realtime.limits.connections_per_user {
        return refuse(StatusCode::TOO_MANY_REQUESTS, "Too many connections");
    }
    let token_hash = hash_token(&token);
    let max = realtime.limits.max_payload_bytes;
    ws.max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| serve(realtime, game, socket, user, token_hash))
}

/// One socket, from its welcome to its close.
async fn serve(
    realtime: Arc<Realtime>,
    game: Arc<dyn GameHandle>,
    mut socket: WebSocket,
    user: crate::auth::SessionUser,
    token_hash: String,
) {
    let (out, mut outgoing) = mpsc::unbounded_channel::<Outgoing>();
    let id = {
        let mut hub = realtime.hub();
        hub.next_id += 1;
        let id = hub.next_id;
        hub.sessions.insert(id, Session { token_hash, user_id: user.id, out });
        id
    };
    let account = json!({ "name": user.name, "isAdmin": user.is_admin });
    let user_id = user.id;
    {
        let (rt, account) = (Arc::clone(&realtime), account.clone());
        game.run_job(Box::new(move |mut g| rt.connected(&mut g, id, &account, user_id))).await;
    }
    let mut allowance = TokenBucket {
        tokens: f64::from(realtime.limits.message_burst),
        last: (realtime.now)(),
        burst: f64::from(realtime.limits.message_burst),
        per_second: f64::from(realtime.limits.messages_per_second),
    };
    loop {
        tokio::select! {
            sent = outgoing.recv() => match sent {
                Some(Outgoing::Text(json)) => {
                    if socket.send(Message::Text(Utf8Bytes::from(json))).await.is_err() {
                        break;
                    }
                }
                Some(Outgoing::Close(code, reason)) => {
                    let frame = CloseFrame { code, reason: Utf8Bytes::from_static(reason) };
                    let _ = socket.send(Message::Close(Some(frame))).await;
                    break;
                }
                None => break,
            },
            received = socket.recv() => match received {
                Some(Ok(Message::Text(text))) => {
                    if !allowance.take((realtime.now)()) {
                        let frame = CloseFrame {
                            code: WS_CLOSE_TOO_MANY_REQUESTS,
                            reason: Utf8Bytes::from_static("Too many requests"),
                        };
                        let _ = socket.send(Message::Close(Some(frame))).await;
                        break;
                    }
                    let (rt, account, raw) = (Arc::clone(&realtime), account.clone(), text.to_string());
                    game.run_job(Box::new(move |mut g| rt.message(&mut g, id, &account, user_id, &raw))).await;
                }
                Some(Ok(Message::Binary(bytes))) => {
                    if !allowance.take((realtime.now)()) {
                        break;
                    }
                    let (rt, account) = (Arc::clone(&realtime), account.clone());
                    let raw = String::from_utf8_lossy(&bytes).into_owned();
                    game.run_job(Box::new(move |mut g| rt.message(&mut g, id, &account, user_id, &raw))).await;
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }
    let mut hub = realtime.hub();
    hub.sessions.shift_remove(&id);
    hub.clients.shift_remove(&id);
}
