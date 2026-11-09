//! The WebSocket side (`realtime.test.ts`), against a real server on a free port: the router,
//! the hub and the game thread, as `index.ts` wires them, and a `tokio-tungstenite` client.
//!
//! Not ported yet, each waiting for what it tests: founding a starting city and the cases that
//! start from one (T86.8; the realm is set up by hand here), Last seen out of sight (T86.13), the
//! alliance matters and the Region map (T86.11), the Leader's death (T86.3/T86.8), and the
//! script watch cases that need a running script (T86.12).
use std::sync::{Arc, Mutex};
use std::time::Duration;

use csp_server::app::{build_app, AppOptions};
use csp_server::auth::{create_admin, create_session, delete_session, hash_token, now_ms};
use csp_server::config::{Origins, RealtimeLimits};
use csp_server::db::open_db;
use csp_server::monitoring::LogSink;
use csp_server::realtime::{
    Realtime, RealtimeOptions, WS_CLOSE_LOGGED_OUT, WS_CLOSE_TOO_MANY_REQUESTS,
};
use csp_server::server::{Game, GameThread, TickSettings};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::protocol::OrderRequest;
use csp_shared::world::{Realm, WorldState};
use csp_sim::explored::ExploredTerrain;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderKind, OrderKinds, OrderQueue};
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::world::create_world;
use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use tokio_tungstenite::tungstenite::Message;

struct NoLog;

impl LogSink for NoLog {
    fn log(&self, _: tracing::Level, _: Value, _: &str) {}
}

const SETTINGS: TickSettings =
    TickSettings { invariant_sample_rate: 0.0, slow_tick_ms: 800.0, save_every_ticks: 1_000 };

fn limits() -> RealtimeLimits {
    RealtimeLimits {
        max_payload_bytes: 16 * 1024,
        message_burst: 20,
        messages_per_second: 10,
        connections_per_user: 3,
        pending_orders_per_realm: 50,
    }
}

/// A test order (`wait` of `sync.test.ts`): valid with a number of ticks, and counted when applied.
struct Wait(Arc<Mutex<Vec<Value>>>);

impl OrderKind for Wait {
    fn validate(
        &self,
        _: &WorldState,
        _: &OrderSender,
        o: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        if o.fields.get("ticks").is_some_and(Value::is_number) {
            None
        } else {
            Some("ticks must be a number".into())
        }
    }
    fn apply(&self, _: &mut WorldState, _: &OrderSender, o: &OrderRequest, _: Option<&TerrainMap>) {
        self.0.lock().unwrap().push(Value::Object(o.fields.clone()));
    }
}

/// An order whose check panics, as a bug in one order kind's check would.
struct Broken;

impl OrderKind for Broken {
    fn validate(
        &self,
        _: &WorldState,
        _: &OrderSender,
        _: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        panic!("a bug in this order's check")
    }
    fn apply(&self, _: &mut WorldState, _: &OrderSender, _: &OrderRequest, _: Option<&TerrainMap>) {
    }
}

struct Server {
    url: String,
    db_path: std::path::PathBuf,
    _dir: tempfile::TempDir,
    user_id: i64,
    token: String,
    game: Arc<GameThread<NoLog>>,
    realtime: Arc<Realtime>,
    applied: Arc<Mutex<Vec<Value>>>,
    errors: Arc<Mutex<Vec<(String, i64)>>>,
}

impl Server {
    fn conn(&self) -> Connection {
        open_db(&self.db_path, None).unwrap()
    }

    async fn tick(&self) {
        self.game.tick().await.unwrap();
    }

    /// The tick message alone, without stepping the world (`broadcastTick`).
    async fn broadcast(&self) {
        let rt = Arc::clone(&self.realtime);
        self.game
            .run(move |g, _| {
                let grown = Default::default();
                rt.broadcast_tick(&g.world, &g.terrain, &mut g.scratch, &grown, now_ms());
            })
            .await
            .unwrap();
    }

    async fn world<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut WorldState) -> T + Send + 'static,
    ) -> T {
        self.game.run(move |g, _| f(&mut g.world)).await.unwrap()
    }
}

struct StartOptions {
    origins: Origins,
    limits: RealtimeLimits,
    /// Whether Daniel has a realm (a Leader on the map) before he connects.
    realm: bool,
}

impl Default for StartOptions {
    fn default() -> Self {
        StartOptions {
            origins: Origins {
                allowed: vec!["https://game.example.com".into()],
                allow_missing: true,
            },
            limits: limits(),
            realm: true,
        }
    }
}

/// A Plains map with Daniel's realm on it: his Leader and a second resident.
fn world_for(user_id: i64, realm: bool) -> (WorldState, TerrainMap) {
    let terrain = TerrainMap { size: 128, tiles: vec![Terrain::Plains as u8; 128 * 128] };
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    if realm {
        let mut rand = csp_sim::random::Mulberry32::new(1.0);
        let mut next = || rand.next();
        for (id, x) in [("a1", 10.0), ("a2", 12.0)] {
            let fields =
                NewResident { id, owner: Some("r1"), city_id: None, x, y: 10.0, tick: 0.0 };
            world.residents.push(new_resident(&mut next, &fields, None));
        }
        world.realms.push(Realm {
            id: "r1".into(),
            user_id: user_id as u64,
            leader_id: "a1".into(),
            name: Some("Ironvale".into()),
            demands_sent_at: None,
        });
    }
    (world, terrain)
}

async fn start(opts: StartOptions) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("game.db");
    let conn = open_db(&db_path, None).unwrap();
    create_admin(&conn, Some("Daniel"), Some("admin password")).unwrap();
    let user_id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    let token = create_session(&conn, user_id, now_ms()).unwrap();
    let (world, terrain) = world_for(user_id, opts.realm);
    let applied = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let path = db_path.clone();
    let kinds_applied = Arc::clone(&applied);
    let game = GameThread::spawn(
        move || {
            let explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
            let mut game = Game::new(world, terrain, explored, NoLog);
            let mut kinds = OrderKinds::default();
            kinds.insert("wait", Wait(kinds_applied));
            kinds.insert("claimHorses", Wait(Arc::new(Mutex::new(Vec::new()))));
            kinds.insert("broken", Broken);
            game.orders = OrderQueue::new(kinds, None);
            Ok((open_db(&path, None)?, game))
        },
        SETTINGS,
    )
    .unwrap();
    let game = Arc::new(game);
    let errs = Arc::clone(&errors);
    let realtime = Realtime::new(RealtimeOptions {
        db: Arc::new(Mutex::new(open_db(&db_path, None).unwrap())),
        origins: opts.origins,
        limits: opts.limits,
        sight_check: None,
        on_error: Some(Box::new(move |e, user| errs.lock().unwrap().push((e.to_owned(), user)))),
        now: None,
    });
    {
        let rt = Arc::clone(&realtime);
        game.run(move |g, _| g.realtime = Some(rt)).await;
    }
    let mut app = AppOptions::new(open_db(&db_path, None).unwrap());
    app.game = Some(game.clone());
    app.realtime = Some(Arc::clone(&realtime));
    app.sockets = Some(realtime.clone());
    let router = build_app(app);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await
            .unwrap();
    });
    Server {
        url: format!("ws://127.0.0.1:{port}/ws"),
        db_path,
        _dir: dir,
        user_id,
        token,
        game,
        realtime,
        applied,
        errors,
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// A connected socket and every message it got so far.
struct Client {
    socket: Socket,
    got: Vec<Value>,
    closed: Option<u16>,
}

/// The status a refused upgrade answered with, or the open socket.
async fn open(url: &str, token: Option<&str>, origin: Option<&str>) -> Result<Client, u16> {
    let mut req = url.into_client_request().unwrap();
    if let Some(token) = token {
        req.headers_mut().insert("cookie", format!("csp_session={token}").parse().unwrap());
    }
    if let Some(origin) = origin {
        req.headers_mut().insert("origin", origin.parse().unwrap());
    }
    match tokio_tungstenite::connect_async(req).await {
        Ok((socket, _)) => Ok(Client { socket, got: Vec::new(), closed: None }),
        Err(tokio_tungstenite::tungstenite::Error::Http(res)) => Err(res.status().as_u16()),
        Err(e) => panic!("unexpected: {e}"),
    }
}

async fn connect(s: &Server) -> Client {
    open(&s.url, Some(&s.token), None).await.unwrap_or_else(|status| panic!("refused: {status}"))
}

impl Client {
    /// The next message of type `kind`, waiting up to 2 s for it.
    async fn next(&mut self, kind: &str) -> Value {
        if let Some(i) = self.got.iter().position(|m| m["type"] == kind) {
            return self.got.remove(i);
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            let msg = tokio::time::timeout_at(deadline, self.socket.next())
                .await
                .unwrap_or_else(|_| panic!("no {kind} message; got {:?}", self.got));
            match msg {
                Some(Ok(Message::Text(text))) => {
                    let v: Value = serde_json::from_str(&text).unwrap();
                    if v["type"] == kind {
                        return v;
                    }
                    self.got.push(v);
                }
                Some(Ok(Message::Close(frame))) => {
                    self.closed = Some(frame.map_or(1005, |f| u16::from(f.code)));
                    panic!("closed ({:?}) waiting for {kind}", self.closed);
                }
                Some(Ok(_)) => {}
                other => panic!("socket ended waiting for {kind}: {other:?}"),
            }
        }
    }

    /// The close code the socket gets, waiting up to 2 s.
    async fn close_code(&mut self) -> u16 {
        if let Some(code) = self.closed {
            return code;
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            match tokio::time::timeout_at(deadline, self.socket.next()).await {
                Err(_) => panic!("not closed"),
                Ok(Some(Ok(Message::Close(frame)))) => {
                    return frame.map_or(1005, |f| u16::from(f.code));
                }
                Ok(Some(Ok(Message::Text(text)))) => {
                    self.got.push(serde_json::from_str(&text).unwrap())
                }
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(_))) | Ok(None) => return 1006,
            }
        }
    }

    async fn send(&mut self, msg: Value) {
        self.socket.send(Message::Text(msg.to_string().into())).await.unwrap();
    }

    /// Whether the socket got nothing more within a short while.
    async fn quiet(&mut self) -> bool {
        tokio::time::timeout(Duration::from_millis(150), self.socket.next()).await.is_err()
    }
}

// --------------------------------------------------------------------------------- handshake

#[tokio::test(flavor = "multi_thread")]
async fn refuses_sockets_without_a_session() {
    let s = start(StartOptions::default()).await;
    assert_eq!(open(&s.url, None, None).await.err(), Some(401));
    assert_eq!(open(&s.url, Some("not-a-session"), None).await.err(), Some(401));
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_socket_from_another_origin_and_takes_the_allowed_ones_and_its_own_host() {
    let s = start(StartOptions::default()).await;
    let token = Some(s.token.as_str());
    assert_eq!(open(&s.url, token, Some("https://evil.example.com")).await.err(), Some(403));
    assert_eq!(open(&s.url, token, Some("not a url")).await.err(), Some(403));
    assert!(open(&s.url, token, Some("https://game.example.com")).await.is_ok());
    let own = s.url.trim_start_matches("ws://").trim_end_matches("/ws");
    assert!(open(&s.url, token, Some(&format!("http://{own}"))).await.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn lets_a_socket_without_an_origin_in_only_where_the_policy_allows_it() {
    let strict = start(StartOptions {
        origins: Origins { allowed: vec![], allow_missing: false },
        ..StartOptions::default()
    })
    .await;
    assert_eq!(open(&strict.url, Some(&strict.token), None).await.err(), Some(403));
    let dev = start(StartOptions::default()).await;
    assert!(open(&dev.url, Some(&dev.token), None).await.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_malformed_session_cookie_and_keeps_serving_the_next_upgrade() {
    let s = start(StartOptions::default()).await;
    assert_eq!(open(&s.url, Some("%E0%A4%A"), None).await.err(), Some(401));
    let mut ok = connect(&s).await;
    ok.next("welcome").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn caps_the_sockets_one_account_holds_open_and_frees_a_slot_when_one_closes() {
    let s = start(StartOptions::default()).await;
    let mut tabs = Vec::new();
    for _ in 0..3 {
        let mut c = connect(&s).await;
        c.next("welcome").await;
        tabs.push(c);
    }
    assert_eq!(open(&s.url, Some(&s.token), None).await.err(), Some(429));
    let mut first = tabs.remove(0);
    first.socket.close(None).await.unwrap();
    let _ = first.close_code().await;
    // The slot frees once the server has seen the close.
    for _ in 0..40 {
        if s.realtime.socket_count() < 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(open(&s.url, Some(&s.token), None).await.is_ok());
}

// ---------------------------------------------------------------------------------- limits

#[tokio::test(flavor = "multi_thread")]
async fn closes_a_socket_that_sends_a_frame_over_max_payload_and_stays_up() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    let big = "x".repeat(limits().max_payload_bytes + 1);
    let _ = c.socket.send(Message::Text(big.into())).await;
    let code = c.close_code().await;
    assert_ne!(code, 1000, "closed as too big, not normally");
    let mut next = connect(&s).await;
    next.next("welcome").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn closes_a_socket_that_floods_it_with_messages_as_too_many_requests() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    for _ in 0..=limits().message_burst {
        c.send(json!({ "type": "watch", "ids": [] })).await;
    }
    assert_eq!(c.close_code().await, WS_CLOSE_TOO_MANY_REQUESTS);
}

#[tokio::test(flavor = "multi_thread")]
async fn caps_a_realms_orders_waiting_for_the_next_tick_and_takes_more_once_it_ran() {
    let mut l = limits();
    l.pending_orders_per_realm = 2;
    l.message_burst = 50;
    let s = start(StartOptions { limits: l, ..StartOptions::default() }).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    let order = |id: &str| json!({ "type": "order", "requestId": id, "order": { "kind": "wait", "ticks": 1 } });
    c.send(order("o1")).await;
    c.send(order("o2")).await;
    c.send(order("o3")).await;
    assert_eq!(c.next("ack").await["requestId"], "o1");
    assert_eq!(c.next("ack").await["requestId"], "o2");
    let refused = c.next("rejected").await;
    assert_eq!(
        refused,
        json!({ "type": "rejected", "requestId": "o3", "reason": "too many orders waiting" })
    );
    s.tick().await;
    assert_eq!(s.applied.lock().unwrap().len(), 2);
    c.send(order("o4")).await;
    assert_eq!(c.next("ack").await["requestId"], "o4");
}

// --------------------------------------------------------------------------------- the world

#[tokio::test(flavor = "multi_thread")]
async fn welcomes_a_logged_in_player_then_sends_only_changes() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    let welcome = c.next("welcome").await;
    assert_eq!(welcome["account"], json!({ "name": "Daniel", "isAdmin": true }));
    assert_eq!(welcome["tick"], 0);
    assert_eq!(welcome["map"], json!({ "seed": 1, "size": 128 }));
    // The view starts with the Leader, as the realm has no city.
    assert_eq!(
        welcome["home"],
        json!({ "realmId": "r1", "leaderId": "a1", "realmName": "Ironvale", "cityId": null, "x": 10.0, "y": 10.0 })
    );
    let ids: Vec<&str> =
        welcome["entities"].as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["a1", "a2"]);
    // Explored terrain: what the residents see, not the whole map.
    let explored = welcome["exploredChunks"].as_array().unwrap().len();
    assert!(explored > 0 && explored < 16, "{explored}");
    assert_eq!(welcome["events"], json!([]));
    assert_eq!(welcome["horseOffer"], true);
    assert_eq!(welcome["waypoints"], json!([]));
    assert_eq!(welcome["firstDay"], json!({ "done": [], "dismissed": false }));

    s.broadcast().await;
    let tick = c.next("tick").await;
    assert_eq!(
        tick,
        json!({ "type": "tick", "tick": 0, "explored": [], "events": [], "changed": [], "gone": [] })
    );

    // A resident moves: only they go out; one leaves sight, and is gone.
    s.world(|w| {
        w.residents[1].x = 13.0;
    })
    .await;
    s.broadcast().await;
    let tick = c.next("tick").await;
    let changed: Vec<&str> =
        tick["changed"].as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
    assert_eq!(changed, ["a2"]);
    s.world(|w| {
        w.residents.retain(|r| r.id != "a2");
    })
    .await;
    s.broadcast().await;
    assert_eq!(c.next("tick").await["gone"], json!(["a2"]));
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_each_tab_the_same_and_welcomes_a_tab_that_connects_between_ticks_in_full() {
    let s = start(StartOptions::default()).await;
    let mut a = connect(&s).await;
    a.next("welcome").await;
    s.world(|w| w.residents[0].x = 11.0).await;
    s.tick().await;
    let first = a.next("tick").await;
    let mut b = connect(&s).await;
    let welcome = b.next("welcome").await;
    assert_eq!(welcome["entities"].as_array().unwrap().len(), 2);
    s.world(|w| w.residents[0].x = 12.0).await;
    s.tick().await;
    let (ta, tb) = (a.next("tick").await, b.next("tick").await);
    assert_eq!(ta, tb);
    assert!(first["changed"].as_array().unwrap().iter().any(|e| e["id"] == "a1"));
}

#[tokio::test(flavor = "multi_thread")]
async fn asks_a_player_without_a_realm_to_name_it_and_their_leader_first() {
    let s = start(StartOptions { realm: false, ..StartOptions::default() }).await;
    let mut c = connect(&s).await;
    let founding = c.next("founding").await;
    assert_eq!(founding["account"], json!({ "name": "Daniel", "isAdmin": true }));
    assert_eq!(s.world(|w| w.realms.len()).await, 0);
    // Names are checked before anything is founded.
    c.send(json!({ "type": "found", "requestId": "f1", "realmName": "  ", "leaderName": "Ada" }))
        .await;
    let refused = c.next("rejected").await;
    assert_eq!(refused["requestId"], "f1");
    assert!(refused["reason"].as_str().unwrap().starts_with("Realm name:"));
    let long = "x".repeat(31);
    c.send(
        json!({ "type": "found", "requestId": "f2", "realmName": "Ironvale", "leaderName": long }),
    )
    .await;
    assert!(c.next("rejected").await["reason"].as_str().unwrap().starts_with("Leader name:"));
    // Orders wait for a realm.
    c.send(json!({ "type": "order", "requestId": "o1", "order": { "kind": "wait", "ticks": 1 } }))
        .await;
    assert_eq!(c.next("rejected").await["reason"], "no realm yet");
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_orders_with_an_ack_or_a_rejection() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    c.send(json!({ "type": "order", "requestId": "r1", "order": { "kind": "wait", "ticks": 3 } }))
        .await;
    assert_eq!(c.next("ack").await, json!({ "type": "ack", "requestId": "r1" }));
    c.send(json!({ "type": "order", "requestId": "r2", "order": { "kind": "fly" } })).await;
    assert_eq!(
        c.next("rejected").await,
        json!({ "type": "rejected", "requestId": "r2", "reason": "unknown order: fly" })
    );
    c.send(json!({ "type": "order", "requestId": "r3", "order": { "kind": "wait" } })).await;
    assert_eq!(c.next("rejected").await["reason"], "ticks must be a number");
    for kind in ["constructor", "toString", "__proto__"] {
        c.send(json!({ "type": "order", "requestId": "r4", "order": { "kind": kind } })).await;
        assert_eq!(c.next("rejected").await["reason"], format!("unknown order: {kind}"));
    }
    c.socket.send(Message::Text("{ not json".into())).await.unwrap();
    assert_eq!(
        c.next("rejected").await,
        json!({ "type": "rejected", "requestId": "", "reason": "not JSON" })
    );
    // Applied on the next tick, not before.
    assert!(s.applied.lock().unwrap().is_empty());
    s.tick().await;
    assert_eq!(*s.applied.lock().unwrap(), [json!({ "ticks": 3 })]);
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_a_message_whose_handling_panics_reports_it_and_keeps_the_socket_open() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    c.send(json!({ "type": "order", "requestId": "b1", "order": { "kind": "broken" } })).await;
    assert_eq!(
        c.next("rejected").await,
        json!({ "type": "rejected", "requestId": "b1", "reason": "server error" })
    );
    let errors = s.errors.lock().unwrap().clone();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].0.contains("a bug in this order's check"));
    assert_eq!(errors[0].1, s.user_id);
    c.send(json!({ "type": "order", "requestId": "w1", "order": { "kind": "wait", "ticks": 1 } }))
        .await;
    assert_eq!(c.next("ack").await["requestId"], "w1");
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_each_player_only_their_own_realm_events_each_once_and_the_log_on_connect() {
    let s = start(StartOptions::default()).await;
    let user = s.user_id as u64;
    s.world(move |w| {
        csp_sim::events::record_player_event(w, user, hungry());
        csp_sim::events::record_player_event(w, user + 1, hungry());
    })
    .await;
    let mut c = connect(&s).await;
    let welcome = c.next("welcome").await;
    assert_eq!(welcome["events"].as_array().unwrap().len(), 1);
    s.world(move |w| csp_sim::events::record_player_event(w, user, hungry())).await;
    s.tick().await;
    assert_eq!(c.next("tick").await["events"].as_array().unwrap().len(), 1);
    s.tick().await;
    assert_eq!(c.next("tick").await["events"], json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn offers_the_horses_on_connect_and_says_once_when_they_are_claimed_and_offered_again() {
    let s = start(StartOptions::default()).await;
    let user = s.user_id as u64;
    let mut c = connect(&s).await;
    assert_eq!(c.next("welcome").await["horseOffer"], true);
    s.world(move |w| w.horse_offers_claimed.push(user)).await;
    s.tick().await;
    assert_eq!(c.next("tick").await["horseOffer"], false);
    s.tick().await;
    assert!(c.next("tick").await.get("horseOffer").is_none());
    s.world(|w| w.horse_offers_claimed.clear()).await;
    s.tick().await;
    assert_eq!(c.next("tick").await["horseOffer"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_the_new_leader_and_the_realm_name_once_they_change() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    s.world(|w| {
        w.realms[0].leader_id = "a2".into();
        w.realms[0].name = Some("Ironvale".into());
    })
    .await;
    s.tick().await;
    let tick = c.next("tick").await;
    assert_eq!(tick["leaderId"], "a2");
    assert!(tick.get("realmName").is_none(), "the name did not change");
    s.tick().await;
    assert!(c.next("tick").await.get("leaderId").is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_each_player_only_their_own_waypoints_when_they_change() {
    let s = start(StartOptions::default()).await;
    let user = s.user_id as u64;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    let waypoint: csp_shared::world::Waypoint =
        serde_json::from_value(json!({ "id": "w1", "name": "Ford", "x": 3, "y": 4 })).unwrap();
    let (mine, theirs) = (waypoint.clone(), waypoint);
    s.world(move |w| {
        w.waypoints.insert(user, vec![mine]);
        w.waypoints.insert(user + 1, vec![theirs]);
    })
    .await;
    s.tick().await;
    assert_eq!(c.next("tick").await["waypoints"].as_array().unwrap().len(), 1);
    s.tick().await;
    assert!(c.next("tick").await.get("waypoints").is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn ticks_the_first_day_card_as_the_player_claims_their_horses_and_gives_an_order_in_every_tab(
) {
    let s = start(StartOptions::default()).await;
    s.conn().execute("UPDATE users SET first_day_dismissed = 0", []).unwrap();
    let mut a = connect(&s).await;
    a.next("welcome").await;
    let mut b = connect(&s).await;
    b.next("welcome").await;
    a.send(json!({ "type": "order", "requestId": "c1", "order": { "kind": "claimHorses", "ticks": 0 } })).await;
    a.next("ack").await;
    let card =
        json!({ "type": "firstDay", "firstDay": { "done": ["claimHorses"], "dismissed": false } });
    assert_eq!(a.next("firstDay").await, card);
    assert_eq!(b.next("firstDay").await, card);
    a.send(json!({ "type": "order", "requestId": "c2", "order": { "kind": "wait", "ticks": 1, "residentId": "a1" } })).await;
    a.next("ack").await;
    assert_eq!(a.next("firstDay").await["firstDay"]["done"], json!(["claimHorses", "giveOrder"]));
    // Ticked already: nothing more is sent.
    a.send(json!({ "type": "order", "requestId": "c3", "order": { "kind": "claimHorses", "ticks": 0 } })).await;
    a.next("ack").await;
    assert!(a.quiet().await);
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_nothing_of_a_watched_resident_running_no_script_beyond_once() {
    let s = start(StartOptions::default()).await;
    let mut c = connect(&s).await;
    c.next("welcome").await;
    c.send(json!({ "type": "watch", "ids": ["a1", 7, "nobody"] })).await;
    assert_eq!(
        c.next("scriptMemory").await,
        json!({ "type": "scriptMemory", "id": "a1", "memory": null })
    );
    assert_eq!(c.next("scriptRun").await, json!({ "type": "scriptRun", "id": "a1", "run": null }));
    assert_eq!(c.next("scriptMemory").await["id"], "nobody");
    assert_eq!(c.next("scriptRun").await["id"], "nobody");
    // The Player's own resident has a log, an empty one; nobody's is null.
    assert_eq!(c.next("scriptLog").await, json!({ "type": "scriptLog", "id": "a1", "lines": [] }));
    assert_eq!(
        c.next("scriptLog").await,
        json!({ "type": "scriptLog", "id": "nobody", "lines": null })
    );
    s.tick().await;
    c.next("tick").await;
    assert!(c.quiet().await, "unchanged, so not sent again");
}

// ---------------------------------------------------------------------------------- sessions

#[tokio::test(flavor = "multi_thread")]
async fn closes_the_socket_of_a_session_logged_out_and_keeps_the_accounts_other_sessions() {
    let s = start(StartOptions::default()).await;
    let other = create_session(&s.conn(), s.user_id, now_ms()).unwrap();
    let mut a = connect(&s).await;
    a.next("welcome").await;
    let mut b = open(&s.url, Some(&other), None).await.unwrap();
    b.next("welcome").await;
    delete_session(&s.conn(), &s.token, Some(s.realtime.as_ref())).unwrap();
    assert_eq!(a.close_code().await, WS_CLOSE_LOGGED_OUT);
    s.tick().await;
    b.next("tick").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn closes_every_socket_of_an_account_whose_password_an_admin_reset() {
    let s = start(StartOptions::default()).await;
    let mut a = connect(&s).await;
    a.next("welcome").await;
    csp_server::auth::reset_password(
        &s.conn(),
        Some("Daniel"),
        Some("another password"),
        Some(s.realtime.as_ref()),
    )
    .unwrap();
    assert_eq!(a.close_code().await, WS_CLOSE_LOGGED_OUT);
}

#[tokio::test(flavor = "multi_thread")]
async fn closes_the_socket_of_a_session_that_ended_on_the_next_check() {
    let s = start(StartOptions::default()).await;
    let mut a = connect(&s).await;
    a.next("welcome").await;
    // Gone some other way than logout: the socket stays until the next check, a minute on.
    s.conn().execute("DELETE FROM sessions WHERE token_hash = ?1", [hash_token(&s.token)]).unwrap();
    s.tick().await;
    a.next("tick").await;
    let rt = Arc::clone(&s.realtime);
    s.game
        .run(move |g, _| {
            let grown = Default::default();
            rt.broadcast_tick(&g.world, &g.terrain, &mut g.scratch, &grown, now_ms() + 61_000);
        })
        .await;
    assert_eq!(a.close_code().await, WS_CLOSE_LOGGED_OUT);
}

/// A realm event, any will do.
fn hungry() -> csp_shared::world::RealmEventWhat {
    csp_shared::world::RealmEventWhat::Hungry { resident_id: "a1".into(), name: "Ada".into() }
}
