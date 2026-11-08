//! The HTTP side of the server (`apps/server/src/app.ts`; ADR 0005, ADR 0006): accounts, the
//! first-day card, explored terrain, the script library, the admin routes, health and, in
//! production, the built client. Same paths, bodies and error shapes (`{ error, message }` with
//! the status of `STATUS`) as the TypeScript, so the client does not notice the change.
//!
//! The accounts and the script library use the HTTP side's own database connection (SQLite in WAL
//! mode lets the game thread's connection work beside it); the world and the explored terrain are
//! read and changed between ticks through a [`GameHandle`].
//!
//! Not served yet, each waiting for its port: the admin directives, the admin map's world,
//! places, inspection and territory (T86.11).

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use csp_shared::balance::SCRIPT_WRITES_PER_MINUTE;
use csp_shared::chunks::{ADMIN_TERRAIN_OVERVIEW_PATH, TERRAIN_BATCH_MAX, TERRAIN_BATCH_PATH};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use csp_sim::explored::ExploredTerrain;
use csp_sim::orders::OrderQueue;
use csp_sim::sight::SightTracker;
use csp_sim::tick::Scratch;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};

use crate::auth::{
    create_invite_code, create_session, delete_session, find_user_by_name, get_session_user,
    log_in, now_ms, reset_password, sign_up, ApiErrorCode, AuthError, AuthFailure, LoginBackoff,
    SessionSockets, SessionUser, SESSION_DAYS,
};
use crate::first_day::{
    dismiss_first_day, mark_first_day, read_first_day, FirstDayLine, FIRST_DAY_DISMISS_PATH,
    FIRST_DAY_PATH,
};
use crate::scripts::{
    activate_version, create_script, delete_older_versions, delete_script, delete_version,
    get_script, list_scripts, rename_script, reset_script, save_script, Defaults,
};

/// The session cookie's name (`SESSION_COOKIE`).
pub const SESSION_COOKIE: &str = "csp_session";
/// Where the admin map asks for the world's seed and size (`ADMIN_MAP_INFO_PATH`).
pub const ADMIN_MAP_INFO_PATH: &str = "/api/admin/map";

/// The world and what the game keeps beside it, as a job between ticks sees them.
pub struct GameView<'a> {
    pub world: &'a mut WorldState,
    pub terrain: &'a TerrainMap,
    pub explored: &'a mut ExploredTerrain,
    /// Orders accepted since the last tick, applied at the start of the next.
    pub orders: &'a mut OrderQueue,
    pub sight: &'a mut SightTracker,
    pub scratch: &'a mut Scratch,
}

/// Work on the game between ticks.
pub type GameJob = Box<dyn for<'a> FnOnce(GameView<'a>) + Send>;

/// How the HTTP side reaches the running game: a job runs between ticks, never during one. The
/// server's game thread (`GameThread`) is the one.
pub trait GameHandle: Send + Sync + 'static {
    /// Runs `job` between ticks; resolves false if the game is gone and the job never ran.
    fn run_job(&self, job: GameJob) -> Pin<Box<dyn Future<Output = bool> + Send + '_>>;
}

impl<L: crate::monitoring::LogSink + Send + Sync + 'static> GameHandle
    for crate::server::GameThread<L>
{
    fn run_job(&self, job: GameJob) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async move {
            self.run(move |g, _conn| {
                job(GameView {
                    world: &mut g.world,
                    terrain: &g.terrain,
                    explored: &mut g.explored,
                    orders: &mut g.orders,
                    sight: &mut g.sight,
                    scratch: &mut g.scratch,
                })
            })
            .await
            .is_some()
        })
    }
}

/// Runs `f` on the game between ticks and answers its result; `None` if the game is gone.
pub async fn with_game<T: Send + 'static>(
    game: &dyn GameHandle,
    f: impl for<'a> FnOnce(GameView<'a>) -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ran = game
        .run_job(Box::new(move |view| {
            let _ = tx.send(f(view));
        }))
        .await;
    if !ran {
        return None;
    }
    rx.await.ok()
}

/// What the app is built with (`AppOptions`).
pub struct AppOptions {
    /// The HTTP side's own connection to the database.
    pub db: Connection,
    pub secure_cookies: bool,
    pub trust_proxy: bool,
    /// The built client to serve; dev leaves this to Vite.
    pub web_dist: Option<PathBuf>,
    /// The running game: the health check's tick, explored terrain, the admin map. Without it
    /// there is no terrain API and no admin map.
    pub game: Option<Arc<dyn GameHandle>>,
    /// Login and sign-up attempts allowed per IP and minute.
    pub auth_rate_limit: u32,
    /// Script library writes allowed per Player and minute.
    pub script_write_rate_limit: u32,
    /// The open sockets, closed when logout or a password reset ends sessions.
    pub sockets: Option<Arc<dyn SessionSockets + Send + Sync>>,
    /// The game's default scripts (`DEFAULT_SCRIPTS`).
    pub defaults: &'static Defaults,
    /// The last hour of tick health, for admins (T87.1); none without a tick loop.
    pub tick_health: Option<Arc<dyn Fn() -> Value + Send + Sync>>,
    /// The WebSocket hub, served at `WS_PATH` with the game; without it there are no sockets.
    pub realtime: Option<Arc<crate::realtime::Realtime>>,
}

impl AppOptions {
    /// Options as the TypeScript tests start: a database, insecure cookies, no proxy, nothing
    /// else.
    pub fn new(db: Connection) -> Self {
        AppOptions {
            db,
            secure_cookies: false,
            trust_proxy: false,
            web_dist: None,
            game: None,
            auth_rate_limit: 10,
            script_write_rate_limit: SCRIPT_WRITES_PER_MINUTE as u32,
            sockets: None,
            defaults: crate::scripts::game_defaults(),
            tick_health: None,
            realtime: None,
        }
    }
}

/// The status each API error answers with (`STATUS`).
pub fn status_of(code: ApiErrorCode) -> StatusCode {
    match code {
        ApiErrorCode::InvalidInput => StatusCode::BAD_REQUEST,
        ApiErrorCode::NameTaken => StatusCode::CONFLICT,
        ApiErrorCode::InvalidInvite => StatusCode::FORBIDDEN,
        ApiErrorCode::WrongLogin => StatusCode::UNAUTHORIZED,
        ApiErrorCode::NotLoggedIn => StatusCode::UNAUTHORIZED,
        ApiErrorCode::NotAdmin => StatusCode::FORBIDDEN,
        ApiErrorCode::NotFound => StatusCode::NOT_FOUND,
        ApiErrorCode::NotExplored => StatusCode::FORBIDDEN,
        ApiErrorCode::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        ApiErrorCode::ScriptHasErrors => StatusCode::UNPROCESSABLE_ENTITY,
        ApiErrorCode::DefaultScript => StatusCode::CONFLICT,
        ApiErrorCode::ActiveVersion => StatusCode::CONFLICT,
        ApiErrorCode::LibraryFull => StatusCode::CONFLICT,
    }
}

/// An answer that went wrong: an API error for the client, or a failure of the server's own.
#[derive(Debug)]
pub enum ApiFailure {
    Api(AuthError),
    Internal(String),
}

impl From<AuthFailure> for ApiFailure {
    fn from(f: AuthFailure) -> Self {
        match f {
            AuthFailure::Auth(e) => ApiFailure::Api(e),
            AuthFailure::Sqlite(e) => ApiFailure::Internal(e.to_string()),
        }
    }
}

impl From<rusqlite::Error> for ApiFailure {
    fn from(e: rusqlite::Error) -> Self {
        ApiFailure::Internal(e.to_string())
    }
}

/// `fail(reply, code, message)`.
pub fn fail(code: ApiErrorCode, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Api(AuthError { code, message: message.into() })
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        match self {
            ApiFailure::Api(e) => {
                (status_of(e.code), Json(json!({ "error": e.code, "message": e.message })))
                    .into_response()
            }
            // Fastify's answer to an error its handler doesn't know.
            ApiFailure::Internal(message) => {
                tracing::error!(err = %message, "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "statusCode": 500,
                        "error": "Internal Server Error",
                        "message": message,
                    })),
                )
                    .into_response()
            }
        }
    }
}

type ApiResult<T> = Result<T, ApiFailure>;

/// A fixed one-minute window of attempts per key (`@fastify/rate-limit`'s in-memory store).
struct RateLimit {
    max: u32,
    window_ms: i64,
    hits: Mutex<HashMap<String, (i64, u32)>>,
}

impl RateLimit {
    fn per_minute(max: u32) -> Self {
        RateLimit { max, window_ms: 60_000, hits: Mutex::new(HashMap::new()) }
    }

    /// Counts an attempt for `key`; past the limit, the error to answer.
    fn hit(&self, key: &str, now: i64) -> ApiResult<()> {
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        if hits.len() > 10_000 {
            hits.retain(|_, (start, _)| now - *start < self.window_ms);
        }
        let entry = hits.entry(key.to_owned()).or_insert((now, 0));
        if now - entry.0 >= self.window_ms {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > self.max {
            let ttl = self.window_ms - (now - entry.0);
            return Err(fail(
                ApiErrorCode::RateLimited,
                format!("Too many attempts. Try again in {} s.", (ttl + 999) / 1000),
            ));
        }
        Ok(())
    }
}

struct AppState {
    db: Arc<Mutex<Connection>>,
    secure_cookies: bool,
    trust_proxy: bool,
    game: Option<Arc<dyn GameHandle>>,
    auth_limit: RateLimit,
    script_writes: RateLimit,
    backoff: LoginBackoff,
    sockets: Option<Arc<dyn SessionSockets + Send + Sync>>,
    defaults: &'static Defaults,
    tick_health: Option<Arc<dyn Fn() -> Value + Send + Sync>>,
}

type Shared = Arc<AppState>;

impl AppState {
    /// Runs `f` on the database off the async threads (a login's password check takes a while).
    async fn db<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Connection) -> ApiResult<T> + Send + 'static,
    ) -> ApiResult<T> {
        let db = Arc::clone(&self.db);
        tokio::task::spawn_blocking(move || {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            f(&conn)
        })
        .await
        .map_err(|e| ApiFailure::Internal(e.to_string()))?
    }

    fn sockets(&self) -> Option<Arc<dyn SessionSockets + Send + Sync>> {
        self.sockets.clone()
    }
}

/// The logged-in user of a request, if any (`req.user`).
#[derive(Clone)]
struct User(Option<SessionUser>);

impl User {
    fn logged_in(&self) -> ApiResult<&SessionUser> {
        self.0.as_ref().ok_or_else(|| fail(ApiErrorCode::NotLoggedIn, "Not logged in."))
    }

    fn admin(&self) -> ApiResult<&SessionUser> {
        let user = self.logged_in()?;
        if !user.is_admin {
            return Err(fail(ApiErrorCode::NotAdmin, "Admins only."));
        }
        Ok(user)
    }
}

/// The value of percent-encoded `s`, or `s` as sent if it isn't valid percent-encoding (as the
/// `cookie` package's `decode` falls back).
fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_owned();
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
            let Some(b) = hex else { return s.to_owned() };
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_owned())
}

/// The named cookie in a `Cookie` header, as `@fastify/cookie` parses it: the first one of the
/// name, its value unquoted and percent-decoded.
pub fn cookie_value(header: Option<&str>, name: &str) -> Option<String> {
    for pair in header?.split(';') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        if key.trim() != name {
            continue;
        }
        let value = value.trim();
        let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
        return Some(percent_decode(value));
    }
    None
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    let header = headers.get(header::COOKIE).and_then(|v| v.to_str().ok());
    cookie_value(header, SESSION_COOKIE)
}

/// The client's address (`req.ip`): behind a trusted proxy the first `X-Forwarded-For` entry.
fn client_ip(state: &AppState, req: &Request) -> String {
    if state.trust_proxy {
        let forwarded = req.headers().get("x-forwarded-for").and_then(|v| v.to_str().ok());
        if let Some(first) = forwarded.and_then(|f| f.split(',').next()) {
            return first.trim().to_owned();
        }
    }
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map_or_else(|| "127.0.0.1".to_owned(), |c| c.0.ip().to_string())
}

/// Finds the request's user from its session cookie (the `onRequest` hook).
async fn find_user(State(state): State<Shared>, mut req: Request, next: Next) -> Response {
    let token = session_token(req.headers());
    let user = match token {
        Some(token) => {
            match state.db(move |conn| Ok(get_session_user(conn, Some(&token), now_ms())?)).await {
                Ok(user) => user,
                Err(e) => return e.into_response(),
            }
        }
        None => None,
    };
    let ip = client_ip(&state, &req);
    req.extensions_mut().insert(User(user));
    req.extensions_mut().insert(ClientIp(ip));
    next.run(req).await
}

#[derive(Clone)]
struct ClientIp(String);

/// The auth routes' limit per IP and minute.
async fn limit_auth(State(state): State<Shared>, req: Request, next: Next) -> Response {
    let ip = req.extensions().get::<ClientIp>().map(|c| c.0.clone()).unwrap_or_default();
    if let Err(e) = state.auth_limit.hit(&ip, now_ms()) {
        return e.into_response();
    }
    next.run(req).await
}

/// The script library writes' shared limit, per Player (per IP before logging in).
async fn limit_script_writes(State(state): State<Shared>, req: Request, next: Next) -> Response {
    let key = match req.extensions().get::<User>().and_then(|u| u.0.as_ref()) {
        Some(user) => format!("user:{}", user.id),
        None => req.extensions().get::<ClientIp>().map(|c| c.0.clone()).unwrap_or_default(),
    };
    if let Err(e) = state.script_writes.hit(&key, now_ms()) {
        return e.into_response();
    }
    next.run(req).await
}

/// The request's JSON body as `req.body ?? {}`: fields of anything but an object are absent.
#[derive(Debug, Default)]
struct JsonBody(Value);

impl JsonBody {
    fn parse(bytes: &Bytes) -> ApiResult<Self> {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(JsonBody(Value::Null));
        }
        serde_json::from_slice(bytes)
            .map(JsonBody)
            .map_err(|_| fail(ApiErrorCode::InvalidInput, "The body is not valid JSON."))
    }

    fn get(&self, field: &str) -> Option<&Value> {
        self.0.get(field)
    }

    fn str(&self, field: &str) -> Option<&str> {
        self.get(field).and_then(Value::as_str)
    }

    fn number(&self, field: &str) -> Option<f64> {
        self.get(field).and_then(Value::as_f64)
    }
}

/// `Number(param)`: a path parameter as a number, `NaN` for anything else.
fn number_param(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// A path parameter naming a row: a whole number, or an id no row has.
fn id_param(s: &str) -> i64 {
    let n = number_param(s);
    if n.fract() == 0.0 && n.is_finite() {
        n as i64
    } else {
        -1
    }
}

/// A chunk coordinate from the path: a whole number in range, or none (no such chunk).
fn chunk_param(s: &str) -> Option<i32> {
    let n = number_param(s);
    (n.fract() == 0.0 && n.is_finite() && n.abs() < f64::from(i32::MAX)).then_some(n as i32)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    name: String,
    is_admin: bool,
}

fn public_account(u: &SessionUser) -> Account {
    Account { name: u.name.clone(), is_admin: u.is_admin }
}

/// The session cookie for a new session (`startSession`).
fn session_cookie(state: &AppState, token: &str) -> HeaderValue {
    let max_age = SESSION_DAYS * 24 * 60 * 60;
    let secure = if state.secure_cookies { "; Secure" } else { "" };
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Max-Age={max_age}; Path=/; HttpOnly{secure}; SameSite=Lax"
    );
    HeaderValue::from_str(&cookie).expect("a token is a valid header value")
}

async fn start_session(
    state: &Shared,
    status: StatusCode,
    user: SessionUser,
) -> ApiResult<Response> {
    let id = user.id;
    let token = state.db(move |conn| Ok(create_session(conn, id, now_ms())?)).await?;
    let mut res = (status, Json(public_account(&user))).into_response();
    res.headers_mut().insert(header::SET_COOKIE, session_cookie(state, &token));
    Ok(res)
}

fn octets(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
}

fn no_content() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

// ------------------------------------------------------------------------------------- routes

async fn health(State(state): State<Shared>) -> Json<Value> {
    let tick = match &state.game {
        Some(game) => with_game(game.as_ref(), |g| g.world.tick).await.unwrap_or(0),
        None => 0,
    };
    Json(json!({ "ok": true, "tick": tick, "language": csp_lang::LANGUAGE_VERSION }))
}

async fn signup(State(state): State<Shared>, body: Bytes) -> ApiResult<Response> {
    let b = JsonBody::parse(&body)?;
    let (name, password, invite) = (
        b.str("name").map(str::to_owned),
        b.str("password").map(str::to_owned),
        b.str("inviteCode").map(str::to_owned),
    );
    let user = state
        .db(move |conn| {
            Ok(sign_up(conn, name.as_deref(), password.as_deref(), invite.as_deref(), now_ms())?)
        })
        .await?;
    start_session(&state, StatusCode::CREATED, user).await
}

async fn login(State(state): State<Shared>, body: Bytes) -> ApiResult<Response> {
    let b = JsonBody::parse(&body)?;
    let (name, password) = (b.str("name").map(str::to_owned), b.str("password").map(str::to_owned));
    let st = Arc::clone(&state);
    let user = state
        .db(move |conn| {
            Ok(log_in(conn, &st.backoff, name.as_deref(), password.as_deref(), now_ms())?)
        })
        .await?;
    start_session(&state, StatusCode::OK, user).await
}

async fn logout(State(state): State<Shared>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(token) = session_token(&headers) {
        let sockets = state.sockets();
        state
            .db(move |conn| {
                let sockets = sockets.as_deref().map(|s| s as &dyn SessionSockets);
                Ok(delete_session(conn, &token, sockets)?)
            })
            .await?;
    }
    let mut res = no_content();
    res.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("csp_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
    );
    Ok(res)
}

async fn me(Extension(user): Extension<User>) -> ApiResult<Json<Account>> {
    Ok(Json(public_account(user.logged_in()?)))
}

async fn first_day_mark(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    body: Bytes,
) -> ApiResult<Response> {
    let id = user.logged_in()?.id;
    let b = JsonBody::parse(&body)?;
    let Some(line) = b.get("line").and_then(FirstDayLine::client) else {
        return Err(fail(ApiErrorCode::InvalidInput, "That line is not one the client ticks."));
    };
    let card = state
        .db(move |conn| {
            Ok(match mark_first_day(conn, id, line)? {
                Some(card) => card,
                None => read_first_day(conn, id)?,
            })
        })
        .await?;
    Ok(Json(card).into_response())
}

async fn first_day_dismiss(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    let id = user.logged_in()?.id;
    let card = state.db(move |conn| Ok(dismiss_first_day(conn, id)?)).await?;
    Ok(Json(card).into_response())
}

fn game_of(state: &AppState) -> ApiResult<&Arc<dyn GameHandle>> {
    state.game.as_ref().ok_or_else(|| fail(ApiErrorCode::NotFound, "Not found."))
}

async fn terrain_chunk(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path((cx, cy)): Path<(String, String)>,
) -> ApiResult<Response> {
    let id = user.logged_in()?.id as u64;
    let game = game_of(&state)?;
    let chunk = match (chunk_param(&cx), chunk_param(&cy)) {
        (Some(cx), Some(cy)) => {
            with_game(game.as_ref(), move |g| g.explored.chunk(id, cx, cy)).await.flatten()
        }
        _ => None,
    };
    match chunk {
        Some(bytes) => Ok(octets(bytes)),
        None => Err(fail(ApiErrorCode::NotExplored, "You have not explored that terrain.")),
    }
}

async fn terrain_batch(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    body: Bytes,
) -> ApiResult<Response> {
    let id = user.logged_in()?.id as u64;
    let game = game_of(&state)?;
    let b = JsonBody::parse(&body)?;
    let wanted = match b.get("chunks").and_then(Value::as_array) {
        Some(list) if list.len() <= TERRAIN_BATCH_MAX => list,
        _ => {
            return Err(fail(
                ApiErrorCode::InvalidInput,
                format!("Ask for a list of at most {TERRAIN_BATCH_MAX} chunk indices."),
            ))
        }
    };
    // Anything but a whole number is no chunk's index, and is left out.
    let indices: Vec<i64> = wanted
        .iter()
        .map(|v| match v.as_f64() {
            Some(n) if n.fract() == 0.0 && (0.0..4e9).contains(&n) => n as i64,
            _ => -1,
        })
        .collect();
    let bytes = with_game(game.as_ref(), move |g| g.explored.chunks(id, &indices))
        .await
        .ok_or_else(|| ApiFailure::Internal("the game is gone".into()))?;
    Ok(octets(bytes))
}

async fn scripts_list(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    let id = user.logged_in()?.id;
    let defaults = state.defaults;
    let list = state.db(move |conn| Ok(list_scripts(conn, defaults, id)?)).await?;
    Ok(Json(list).into_response())
}

async fn scripts_get(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail = state.db(move |conn| Ok(get_script(conn, defaults, user_id, id)?)).await?;
    Ok(Json(detail).into_response())
}

async fn scripts_create(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    body: Bytes,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let b = JsonBody::parse(&body)?;
    let (name, source) = (b.str("name").map(str::to_owned), b.str("source").map(str::to_owned));
    let defaults = state.defaults;
    let detail = state
        .db(move |conn| {
            Ok(create_script(conn, defaults, user_id, name.as_deref(), source.as_deref())?)
        })
        .await?;
    Ok((StatusCode::CREATED, Json(detail)).into_response())
}

async fn scripts_save(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    body: Bytes,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let b = JsonBody::parse(&body)?;
    let source = b.str("source").map(str::to_owned);
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail = state
        .db(move |conn| Ok(save_script(conn, defaults, user_id, id, source.as_deref())?))
        .await?;
    Ok((StatusCode::CREATED, Json(detail)).into_response())
}

async fn scripts_rename(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    body: Bytes,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let b = JsonBody::parse(&body)?;
    let name = b.str("name").map(str::to_owned);
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail = state
        .db(move |conn| Ok(rename_script(conn, defaults, user_id, id, name.as_deref())?))
        .await?;
    Ok(Json(detail).into_response())
}

async fn scripts_activate(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    body: Bytes,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let version = JsonBody::parse(&body)?.number("version");
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail =
        state.db(move |conn| Ok(activate_version(conn, defaults, user_id, id, version)?)).await?;
    Ok(Json(detail).into_response())
}

async fn scripts_reset(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail = state.db(move |conn| Ok(reset_script(conn, defaults, user_id, id)?)).await?;
    Ok(Json(detail).into_response())
}

async fn scripts_delete_version(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path((id, version)): Path<(String, String)>,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let (defaults, id, version) = (state.defaults, id_param(&id), number_param(&version));
    let detail = state
        .db(move |conn| Ok(delete_version(conn, defaults, user_id, id, Some(version))?))
        .await?;
    Ok(Json(detail).into_response())
}

async fn scripts_delete_older(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let (defaults, id) = (state.defaults, id_param(&id));
    let detail =
        state.db(move |conn| Ok(delete_older_versions(conn, defaults, user_id, id)?)).await?;
    Ok(Json(detail).into_response())
}

async fn scripts_delete(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let user_id = user.logged_in()?.id;
    let id = id_param(&id);
    state.db(move |conn| Ok(delete_script(conn, user_id, id)?)).await?;
    Ok(no_content())
}

async fn admin_invites(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    let id = user.admin()?.id;
    let code = state.db(move |conn| Ok(create_invite_code(conn, Some(id))?)).await?;
    Ok((StatusCode::CREATED, Json(json!({ "code": code }))).into_response())
}

async fn admin_password(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    body: Bytes,
) -> ApiResult<Response> {
    user.admin()?;
    let b = JsonBody::parse(&body)?;
    let (name, password) = (b.str("name").map(str::to_owned), b.str("password").map(str::to_owned));
    let sockets = state.sockets();
    state
        .db(move |conn| {
            let sockets = sockets.as_deref().map(|s| s as &dyn SessionSockets);
            Ok(reset_password(conn, name.as_deref(), password.as_deref(), sockets)?)
        })
        .await?;
    Ok(no_content())
}

async fn admin_overview(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    user.admin()?;
    let game = game_of(&state)?;
    let bytes = with_game(game.as_ref(), |g| g.explored.overview().to_vec())
        .await
        .ok_or_else(|| ApiFailure::Internal("the game is gone".into()))?;
    Ok(octets(bytes))
}

async fn admin_chunk(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    Path((cx, cy)): Path<(String, String)>,
) -> ApiResult<Response> {
    user.admin()?;
    let game = game_of(&state)?;
    let chunk = match (chunk_param(&cx), chunk_param(&cy)) {
        (Some(cx), Some(cy)) => {
            with_game(game.as_ref(), move |g| g.explored.whole_chunk(cx, cy)).await.flatten()
        }
        _ => None,
    };
    chunk.map(octets).ok_or_else(|| fail(ApiErrorCode::NotFound, "No such chunk."))
}

async fn admin_map_info(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    user.admin()?;
    let game = game_of(&state)?;
    let info =
        with_game(game.as_ref(), |g| json!({ "seed": g.world.seed, "size": g.terrain.size }))
            .await
            .ok_or_else(|| ApiFailure::Internal("the game is gone".into()))?;
    Ok(Json(info).into_response())
}

/// Offering horses again (`CONTEXT.md`: Horse offer; `reopenHorseOffers`): the one Player who
/// claimed, or with none every Player who did, may claim once more. Answers how many offers were
/// re-opened.
pub fn reopen_horse_offers(world: &mut WorldState, user_id: Option<u64>) -> usize {
    let before = world.horse_offers_claimed.len();
    match user_id {
        None => world.horse_offers_claimed.clear(),
        Some(id) => world.horse_offers_claimed.retain(|&claimed| claimed != id),
    }
    before - world.horse_offers_claimed.len()
}

async fn admin_horse_offers_reopen(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
    body: Bytes,
) -> ApiResult<Response> {
    user.admin()?;
    let game = game_of(&state)?;
    let b = JsonBody::parse(&body)?;
    let user_id = match b.get("name") {
        None => None,
        Some(name) => {
            let name = name.as_str().map(str::to_owned);
            let found = state
                .db(move |conn| match name {
                    Some(n) => Ok(find_user_by_name(conn, &n)?.map(|u| u.id)),
                    None => Ok(None),
                })
                .await?;
            let Some(id) = found else {
                return Err(fail(ApiErrorCode::NotFound, "No account with that name."));
            };
            Some(id as u64)
        }
    };
    let reopened = with_game(game.as_ref(), move |g| reopen_horse_offers(g.world, user_id))
        .await
        .ok_or_else(|| ApiFailure::Internal("the game is gone".into()))?;
    Ok(Json(json!({ "reopened": reopened })).into_response())
}

async fn admin_tick_health(
    State(state): State<Shared>,
    Extension(user): Extension<User>,
) -> ApiResult<Response> {
    user.admin()?;
    let summary =
        state.tick_health.as_ref().ok_or_else(|| fail(ApiErrorCode::NotFound, "Not found."))?;
    Ok(Json(summary()).into_response())
}

/// Fastify's answer to a route it doesn't have, without the built client.
async fn no_route(method: Method, uri: axum::http::Uri) -> Response {
    let message =
        format!("Route {method}:{} not found", uri.path_and_query().map_or("/", |p| p.as_str()));
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "message": message, "error": "Not Found", "statusCode": 404 })),
    )
        .into_response()
}

/// With the built client: client-side routes fall back to the app; unknown API paths stay 404.
async fn spa_fallback(index: Arc<PathBuf>, method: Method, uri: axum::http::Uri) -> Response {
    if method == Method::GET && !uri.path().starts_with("/api/") {
        if let Ok(html) = tokio::fs::read(index.as_ref()).await {
            return ([(header::CONTENT_TYPE, "text/html; charset=UTF-8")], html).into_response();
        }
    }
    fail(ApiErrorCode::NotFound, "Not found.").into_response()
}

/// The HTTP side of the server (`buildApp`).
pub fn build_app(opts: AppOptions) -> Router {
    let state: Shared = Arc::new(AppState {
        db: Arc::new(Mutex::new(opts.db)),
        secure_cookies: opts.secure_cookies,
        trust_proxy: opts.trust_proxy,
        game: opts.game,
        auth_limit: RateLimit::per_minute(opts.auth_rate_limit),
        script_writes: RateLimit::per_minute(opts.script_write_rate_limit),
        backoff: LoginBackoff::new(),
        sockets: opts.sockets,
        defaults: opts.defaults,
        tick_health: opts.tick_health,
    });

    let auth = Router::new()
        .route("/api/signup", post(signup))
        .route("/api/login", post(login))
        .route_layer(middleware::from_fn_with_state(Arc::clone(&state), limit_auth));

    // The writes share one rate limit per Player (`CONTEXT.md`: Library cap).
    let script_writes = Router::new()
        .route("/api/scripts", post(scripts_create))
        .route("/api/scripts/{id}/versions", post(scripts_save))
        .route("/api/scripts/{id}/name", post(scripts_rename))
        .route("/api/scripts/{id}/active", post(scripts_activate))
        .route("/api/scripts/{id}/reset", post(scripts_reset))
        .route("/api/scripts/{id}/versions/{version}", delete(scripts_delete_version))
        .route("/api/scripts/{id}/delete-older", post(scripts_delete_older))
        .route("/api/scripts/{id}", delete(scripts_delete))
        .route_layer(middleware::from_fn_with_state(Arc::clone(&state), limit_script_writes));

    let mut api = Router::new()
        .route("/api/health", get(health))
        .route("/api/logout", post(logout))
        .route("/api/me", get(me))
        .route(FIRST_DAY_PATH, post(first_day_mark))
        .route(FIRST_DAY_DISMISS_PATH, post(first_day_dismiss))
        .route("/api/scripts", get(scripts_list))
        .route("/api/scripts/{id}", get(scripts_get))
        .route("/api/admin/invites", post(admin_invites))
        .route("/api/admin/password", post(admin_password))
        .route("/api/admin/tick-health", get(admin_tick_health));
    if let (Some(rt), Some(game)) = (opts.realtime.clone(), state.game.clone()) {
        api = api.route(
            crate::realtime::WS_PATH,
            get(move |headers: HeaderMap, ws: axum::extract::ws::WebSocketUpgrade| {
                crate::realtime::upgrade(rt, game, headers, ws)
            }),
        );
    }
    if state.game.is_some() {
        api = api
            .route("/api/terrain/{cx}/{cy}", get(terrain_chunk))
            .route(TERRAIN_BATCH_PATH, post(terrain_batch))
            .route(ADMIN_TERRAIN_OVERVIEW_PATH, get(admin_overview))
            .route("/api/admin/terrain/{cx}/{cy}", get(admin_chunk))
            .route(ADMIN_MAP_INFO_PATH, get(admin_map_info))
            .route("/api/admin/horse-offers/reopen", post(admin_horse_offers_reopen));
        // TODO(T86.11): the admin directives (GET, POST `/api/admin/directives`, PATCH and DELETE
        // `/api/admin/directives/{id}`) and the admin map's world, places, inspection and
        // territory, once `directives.ts` and `admin-map.ts` are ported.
    }

    let mut app = api.merge(auth).merge(script_writes);
    app = match opts.web_dist.filter(|d| d.is_dir()) {
        Some(dir) => {
            let index = Arc::new(dir.join("index.html"));
            let files = tower_http::services::ServeDir::new(&dir)
                .append_index_html_on_directories(true)
                .fallback(tower::service_fn(move |req: Request| {
                    let index = Arc::clone(&index);
                    async move {
                        let (method, uri) = (req.method().clone(), req.uri().clone());
                        Ok::<_, std::convert::Infallible>(spa_fallback(index, method, uri).await)
                    }
                }));
            app.fallback_service(files)
        }
        None => app.fallback(no_route),
    };
    app.layer(middleware::from_fn_with_state(Arc::clone(&state), find_user)).with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_session_cookie_as_fastify_cookie_does() {
        assert_eq!(
            cookie_value(Some("a=1; csp_session=abc"), "csp_session").as_deref(),
            Some("abc")
        );
        assert_eq!(cookie_value(Some("csp_session=a%2Bb"), "csp_session").as_deref(), Some("a+b"));
        // Not valid percent-encoding: kept as sent, so it matches no session (#512).
        assert_eq!(
            cookie_value(Some("csp_session=%E0%A4%A"), "csp_session").as_deref(),
            Some("%E0%A4%A")
        );
        assert_eq!(cookie_value(Some("other=1"), "csp_session"), None);
        assert_eq!(cookie_value(None, "csp_session"), None);
    }

    #[test]
    fn counts_attempts_in_a_fixed_minute() {
        let limit = RateLimit::per_minute(2);
        assert!(limit.hit("ip", 0).is_ok());
        assert!(limit.hit("ip", 1_000).is_ok());
        let Err(ApiFailure::Api(e)) = limit.hit("ip", 2_000) else { panic!("not limited") };
        assert_eq!(e.message, "Too many attempts. Try again in 58 s.");
        assert!(limit.hit("other", 2_000).is_ok());
        assert!(limit.hit("ip", 60_000).is_ok());
    }

    #[test]
    fn reads_path_numbers_as_number_does() {
        assert_eq!(id_param("12"), 12);
        assert_eq!(id_param("x"), -1);
        assert_eq!(id_param("1.5"), -1);
        assert!(number_param("abc").is_nan());
        assert_eq!(chunk_param("-3"), Some(-3));
        assert_eq!(chunk_param("nope"), None);
    }
}
