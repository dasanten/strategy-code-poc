//! The HTTP routes (`app.test.ts`, the requests of `first-day.test.ts` and the script library API
//! of `scripts.test.ts`), driven through the router as Fastify's `inject` drives the app.
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::Router;
use csp_server::app::{build_app, AppOptions, SESSION_COOKIE};
use csp_server::auth::{
    create_admin, create_invite_code, create_session, get_session_user, now_ms,
};
use csp_server::db::open_db;
use csp_server::first_day::read_first_day;
use csp_server::scripts::{create_script, save_script, DefaultScript};
use csp_shared::balance::SCRIPT_MAX_VERSIONS;
use csp_shared::terrain::TerrainMap;
use csp_sim::explored::ExploredTerrain;
use csp_sim::world::create_world;
use rusqlite::Connection;
use serde_json::{json, Value};

mod common;

const VALID: &str = "let x = 1\n";
const VALID_2: &str = "let x = 2\n";
const BROKEN: &str = "let = \n";

/// The database file both the app and the test use, as one `:memory:` database can't be shared.
struct Db {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
}

impl Db {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("game.db");
        open_db(&path, None).unwrap();
        Db { _dir: dir, path }
    }

    fn conn(&self) -> Connection {
        open_db(&self.path, None).unwrap()
    }

    fn opts(&self) -> AppOptions {
        let mut opts = AppOptions::new(self.conn());
        opts.defaults = Box::leak(common::defaults().into_boxed_slice()) as &[DefaultScript];
        opts
    }

    fn app(&self) -> Router {
        build_app(self.opts())
    }
}

struct Res {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn error(&self) -> String {
        self.json()["error"].as_str().unwrap_or_default().to_owned()
    }

    /// The session token the answer set, if it set one.
    fn cookie(&self) -> Option<String> {
        let set = self.headers.get(header::SET_COOKIE)?.to_str().ok()?;
        let value = set.split(';').next()?.strip_prefix(&format!("{SESSION_COOKIE}="))?;
        (!value.is_empty()).then(|| value.to_owned())
    }
}

async fn call(
    app: &Router,
    method: &str,
    url: &str,
    token: Option<&str>,
    payload: Option<Value>,
) -> Res {
    use tower::ServiceExt;
    let mut req = Request::builder().method(method).uri(url);
    if let Some(token) = token {
        req = req.header(header::COOKIE, format!("{SESSION_COOKIE}={token}"));
    }
    let body = match payload {
        Some(p) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(p.to_string())
        }
        None => Body::empty(),
    };
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap().to_vec();
    Res { status, headers, body }
}

async fn sign_up(app: &Router, name: &str, invite: &str, password: &str) -> Res {
    let payload = json!({ "name": name, "password": password, "inviteCode": invite });
    call(app, "POST", "/api/signup", None, Some(payload)).await
}

async fn login_as(app: &Router, name: &str, password: &str) -> String {
    let res =
        call(app, "POST", "/api/login", None, Some(json!({ "name": name, "password": password })))
            .await;
    res.cookie().unwrap_or_default()
}

fn add_user(db: &Connection, name: &str) -> i64 {
    db.query_row("INSERT INTO users (name) VALUES (?1) RETURNING id", [name], |r| r.get(0)).unwrap()
}

fn token_for(db: &Connection, user: i64) -> String {
    create_session(db, user, now_ms()).unwrap()
}

// ------------------------------------------------------------------------------------- accounts

#[tokio::test]
async fn signs_up_with_an_invite_code_which_then_cannot_be_reused() {
    let db = Db::new();
    let app = db.app();
    let code = create_invite_code(&db.conn(), None).unwrap();
    let res = sign_up(&app, "Mara", &code, "correct horse").await;
    assert_eq!(res.status, StatusCode::CREATED);
    assert_eq!(res.json(), json!({ "name": "Mara", "isAdmin": false }));
    assert!(res.cookie().is_some());

    let again = sign_up(&app, "Tobin", &code, "correct horse").await;
    assert_eq!(again.status, StatusCode::FORBIDDEN);
    assert_eq!(again.error(), "invalid-invite");
}

#[tokio::test]
async fn refuses_sign_up_without_a_valid_invite_code() {
    let db = Db::new();
    let res = sign_up(&db.app(), "Mara", "NOPE", "correct horse").await;
    assert_eq!(res.error(), "invalid-invite");
}

#[tokio::test]
async fn treats_names_as_the_same_regardless_of_case() {
    let db = Db::new();
    let app = db.app();
    sign_up(&app, "Mara", &create_invite_code(&db.conn(), None).unwrap(), "correct horse").await;
    let res =
        sign_up(&app, "mara", &create_invite_code(&db.conn(), None).unwrap(), "correct horse")
            .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn rejects_short_passwords_and_odd_names() {
    let db = Db::new();
    let app = db.app();
    let code = create_invite_code(&db.conn(), None).unwrap();
    assert_eq!(sign_up(&app, "Mara", &code, "short").await.error(), "invalid-input");
    assert_eq!(sign_up(&app, "a b", &code, "correct horse").await.error(), "invalid-input");
}

#[tokio::test]
async fn logs_in_knows_the_session_and_logs_out() {
    let db = Db::new();
    let app = db.app();
    sign_up(&app, "Mara", &create_invite_code(&db.conn(), None).unwrap(), "correct horse").await;
    let wrong = call(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({ "name": "Mara", "password": "wrong password" })),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);

    let login = call(
        &app,
        "POST",
        "/api/login",
        None,
        Some(json!({ "name": "mara", "password": "correct horse" })),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK);
    let token = login.cookie().unwrap();

    let me = call(&app, "GET", "/api/me", Some(&token), None).await;
    assert_eq!(me.json(), json!({ "name": "Mara", "isAdmin": false }));

    call(&app, "POST", "/api/logout", Some(&token), None).await;
    assert_eq!(get_session_user(&db.conn(), Some(&token), now_ms()).unwrap(), None);
    assert_eq!(call(&app, "GET", "/api/me", None, None).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rate_limits_login_attempts() {
    let db = Db::new();
    let mut opts = db.opts();
    opts.auth_rate_limit = 2;
    let limited = build_app(opts);
    let attempt = || {
        call(&limited, "POST", "/api/login", None, Some(json!({ "name": "x", "password": "y" })))
    };
    attempt().await;
    attempt().await;
    let res = attempt().await;
    assert_eq!(res.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(res.error(), "rate-limited");
}

// ---------------------------------------------------------------------------------------- admin

#[tokio::test]
async fn lets_admins_create_invite_codes_and_reset_passwords() {
    let db = Db::new();
    let app = db.app();
    create_admin(&db.conn(), Some("Daniel"), Some("admin password")).unwrap();
    let admin = login_as(&app, "Daniel", "admin password").await;

    let invite = call(&app, "POST", "/api/admin/invites", Some(&admin), None).await;
    assert_eq!(invite.status, StatusCode::CREATED);
    let code = invite.json()["code"].as_str().unwrap().to_owned();
    assert_eq!(sign_up(&app, "Mara", &code, "correct horse").await.status, StatusCode::CREATED);

    let reset = call(
        &app,
        "POST",
        "/api/admin/password",
        Some(&admin),
        Some(json!({ "name": "Mara", "password": "a new password" })),
    )
    .await;
    assert_eq!(reset.status, StatusCode::NO_CONTENT);
    assert!(!login_as(&app, "Mara", "a new password").await.is_empty());
}

#[tokio::test]
async fn lets_admins_offer_horses_again_to_all_or_by_name_and_no_one_else() {
    let db = Db::new();
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let world = create_world(&terrain, 1);
    let explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
    let game = game_thread(&db, world, terrain, explored);
    let mut opts = db.opts();
    opts.game = Some(game.clone());
    let app = build_app(opts);
    create_admin(&db.conn(), Some("Daniel"), Some("admin password")).unwrap();
    let admin = login_as(&app, "Daniel", "admin password").await;
    let mut ids = Vec::new();
    let mut tokens = Vec::new();
    for name in ["Mara", "Tobin", "Ilse"] {
        let invite = call(&app, "POST", "/api/admin/invites", Some(&admin), None).await;
        sign_up(&app, name, invite.json()["code"].as_str().unwrap(), "correct horse").await;
        let token = login_as(&app, name, "correct horse").await;
        ids.push(get_session_user(&db.conn(), Some(&token), now_ms()).unwrap().unwrap().id as u64);
        tokens.push(token);
    }
    let (mara, tobin) = (ids[0], ids[1]);
    let claimed = || {
        let game = game.clone();
        async move { game.run(|g, _| g.world.horse_offers_claimed.clone()).await.unwrap() }
    };
    let set_claimed = |c: Vec<u64>| {
        let game = game.clone();
        async move { game.run(move |g, _| g.world.horse_offers_claimed = c).await.unwrap() }
    };
    let reopen = |payload: Value, token: String| {
        let app = app.clone();
        async move {
            call(&app, "POST", "/api/admin/horse-offers/reopen", Some(&token), Some(payload)).await
        }
    };
    set_claimed(vec![mara, tobin]).await;

    let refused = reopen(json!({ "name": "Mara" }), tokens[0].clone()).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.error(), "not-admin");
    assert_eq!(claimed().await, [mara, tobin]);

    for name in [json!("Nobody"), json!(""), json!(7)] {
        let unknown = reopen(json!({ "name": name }), admin.clone()).await;
        assert_eq!(unknown.status, StatusCode::NOT_FOUND);
        assert_eq!(unknown.json()["message"], "No account with that name.");
    }
    assert_eq!(claimed().await, [mara, tobin]);

    // A Player who hasn't claimed is no error, and nothing to re-open.
    let none = reopen(json!({ "name": "Ilse" }), admin.clone()).await;
    assert_eq!(none.status, StatusCode::OK);
    assert_eq!(none.json(), json!({ "reopened": 0 }));
    assert_eq!(claimed().await, [mara, tobin]);

    assert_eq!(
        reopen(json!({ "name": "mara" }), admin.clone()).await.json(),
        json!({ "reopened": 1 })
    );
    assert_eq!(claimed().await, [tobin]);

    set_claimed(vec![mara, tobin]).await;
    assert_eq!(reopen(json!({}), admin.clone()).await.json(), json!({ "reopened": 2 }));
    assert_eq!(claimed().await, Vec::<u64>::new());
    assert_eq!(reopen(json!({}), admin.clone()).await.json(), json!({ "reopened": 0 }));
}

#[tokio::test]
async fn serves_the_admin_panel_page_from_the_built_client() {
    let db = Db::new();
    let web = tempfile::tempdir().unwrap();
    std::fs::write(web.path().join("index.html"), r#"<div id="root"></div>"#).unwrap();
    let mut opts = db.opts();
    opts.web_dist = Some(web.path().to_path_buf());
    let served = build_app(opts);
    let page = call(&served, "GET", "/admin", None, None).await;
    assert_eq!(page.status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&page.body).contains(r#"id="root""#));
    assert_eq!(call(&served, "GET", "/api/admin", None, None).await.status, StatusCode::NOT_FOUND);
    // A file of the built client is served as it is.
    std::fs::write(web.path().join("app.js"), "let x").unwrap();
    let file = call(&served, "GET", "/app.js", None, None).await;
    assert_eq!((file.status, file.body.as_slice()), (StatusCode::OK, b"let x".as_slice()));
}

#[tokio::test]
async fn keeps_players_out_of_admin_routes() {
    let db = Db::new();
    let app = db.app();
    sign_up(&app, "Mara", &create_invite_code(&db.conn(), None).unwrap(), "correct horse").await;
    let mara = login_as(&app, "Mara", "correct horse").await;
    assert_eq!(
        call(&app, "POST", "/api/admin/invites", Some(&mara), None).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "POST", "/api/admin/invites", None, None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

// ------------------------------------------------------------------------------------- sessions

#[tokio::test]
async fn sessions_expire_after_30_days_unless_used_and_renew_when_used() {
    let db = Db::new();
    let app = db.app();
    create_admin(&db.conn(), Some("Daniel"), Some("admin password")).unwrap();
    let token = login_as(&app, "Daniel", "admin password").await;
    let day = 24 * 60 * 60 * 1000;
    let now = now_ms();
    let conn = db.conn();
    // Used on day 20: renewed to 30 days from then, so still valid on day 45.
    assert!(get_session_user(&conn, Some(&token), now + 20 * day).unwrap().is_some());
    assert!(get_session_user(&conn, Some(&token), now + 45 * day).unwrap().is_some());
    assert!(get_session_user(&conn, Some(&token), now + 80 * day).unwrap().is_none());
}

// ---------------------------------------------------------------------------- first-day requests

#[tokio::test]
async fn ticks_picking_a_resident_and_opening_the_wiki_when_the_client_reports_them() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    let post = |line: &str| {
        let token = token_for(&conn, id);
        let app = app.clone();
        let payload = json!({ "line": line });
        async move { call(&app, "POST", "/api/first-day", Some(&token), Some(payload)).await }
    };
    let picked = post("pickResident").await;
    assert_eq!(picked.status, StatusCode::OK);
    assert_eq!(picked.json(), json!({ "done": ["pickResident"], "dismissed": false }));
    let wiki = post("openWiki").await;
    assert_eq!(wiki.json(), json!({ "done": ["pickResident", "openWiki"], "dismissed": false }));
    // Reported again, nothing changes.
    assert_eq!(post("openWiki").await.json(), wiki.json());
}

#[tokio::test]
async fn ignores_a_report_of_a_line_the_server_sees_itself_or_of_no_line_at_all() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    for line in
        [json!("claimHorses"), json!("giveOrder"), json!("constructor"), json!(7), Value::Null]
    {
        let payload = if line.is_null() { json!({}) } else { json!({ "line": line }) };
        let res =
            call(&app, "POST", "/api/first-day", Some(&token_for(&conn, id)), Some(payload)).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{line}");
        assert_eq!(res.error(), "invalid-input");
    }
    assert!(read_first_day(&conn, id).unwrap().done.is_empty());
}

#[tokio::test]
async fn keeps_the_card_dismissed_across_logins() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    let dismissed =
        call(&app, "POST", "/api/first-day/dismiss", Some(&token_for(&conn, id)), None).await;
    assert_eq!(dismissed.json(), json!({ "done": [], "dismissed": true }));
    let wiki = call(
        &app,
        "POST",
        "/api/first-day",
        Some(&token_for(&conn, id)),
        Some(json!({ "line": "openWiki" })),
    )
    .await;
    assert_eq!(wiki.json(), json!({ "done": ["openWiki"], "dismissed": true }));
    assert!(read_first_day(&conn, id).unwrap().dismissed);
}

#[tokio::test]
async fn refuses_a_first_day_request_without_a_session() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id: i64 = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    let res = call(&app, "POST", "/api/first-day/dismiss", None, None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert!(!read_first_day(&conn, id).unwrap().dismissed);
}

// ------------------------------------------------------------------------- explored terrain

#[tokio::test]
async fn serves_explored_chunks_one_at_a_time_and_in_batches_refusing_unexplored_ones() {
    let db = Db::new();
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let world = create_world(&terrain, 1);
    let mut explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
    let conn = db.conn();
    let mara = add_user(&conn, "Mara");
    explored.explore(mara as u64, 5, 5, 2);
    let game = game_thread(&db, world, terrain, explored);
    let mut opts = db.opts();
    opts.game = Some(game);
    let app = build_app(opts);
    let token = token_for(&conn, mara);

    let chunk = call(&app, "GET", "/api/terrain/0/0", Some(&token), None).await;
    assert_eq!(chunk.status, StatusCode::OK);
    assert_eq!(chunk.headers[header::CONTENT_TYPE], "application/octet-stream");
    let far = call(&app, "GET", "/api/terrain/1/1", Some(&token), None).await;
    assert_eq!((far.status, far.error().as_str()), (StatusCode::FORBIDDEN, "not-explored"));
    assert_eq!(
        call(&app, "GET", "/api/terrain/0/0", None, None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let batch = call(
        &app,
        "POST",
        "/api/terrain/chunks",
        Some(&token),
        Some(json!({ "chunks": [0, 3, "x", 0] })),
    )
    .await;
    assert_eq!(batch.status, StatusCode::OK);
    assert!(batch.body.len() > chunk.body.len());
    let too_many: Vec<u32> = (0..65).collect();
    let refused = call(
        &app,
        "POST",
        "/api/terrain/chunks",
        Some(&token),
        Some(json!({ "chunks": too_many })),
    )
    .await;
    assert_eq!(
        (refused.status, refused.error().as_str()),
        (StatusCode::BAD_REQUEST, "invalid-input")
    );

    // The admin map's terrain is for admins only.
    let admin_chunk = call(&app, "GET", "/api/admin/terrain/1/1", Some(&token), None).await;
    assert_eq!(admin_chunk.status, StatusCode::FORBIDDEN);
}

// -------------------------------------------------------------------------- script library API

#[tokio::test]
async fn saves_renames_activates_and_deletes_over_http() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    let token = token_for(&conn, add_user(&conn, "Mara"));
    let t = Some(token.as_str());
    let created =
        call(&app, "POST", "/api/scripts", t, Some(json!({ "name": "miners", "source": VALID })))
            .await;
    assert_eq!(created.status, StatusCode::CREATED);
    let id = created.json()["id"].as_i64().unwrap();

    let broken = call(
        &app,
        "POST",
        &format!("/api/scripts/{id}/versions"),
        t,
        Some(json!({ "source": BROKEN })),
    )
    .await;
    assert_eq!(broken.status, StatusCode::CREATED);
    assert_eq!(
        (broken.json()["activeVersion"].clone(), broken.json()["latestVersion"].clone()),
        (json!(1), json!(2))
    );

    let refused =
        call(&app, "POST", &format!("/api/scripts/{id}/active"), t, Some(json!({ "version": 2 })))
            .await;
    assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(refused.error(), "script-has-errors");

    let renamed = call(
        &app,
        "POST",
        &format!("/api/scripts/{id}/name"),
        t,
        Some(json!({ "name": "diggers" })),
    )
    .await;
    assert_eq!(renamed.json()["name"], "diggers");
    let list = call(&app, "GET", "/api/scripts", t, None).await.json();
    let own: Vec<&Value> =
        list.as_array().unwrap().iter().filter(|s| s["task"].is_null()).collect();
    assert_eq!(
        own,
        [
            &json!({ "id": id, "name": "diggers", "activeVersion": 1, "latestVersion": 2, "task": null, "followsDefault": false, "params": [] })
        ]
    );
    let detail = call(&app, "GET", &format!("/api/scripts/{id}"), t, None).await.json();
    assert_eq!(detail["versions"].as_array().unwrap().len(), 2);
    assert_eq!(
        call(&app, "DELETE", &format!("/api/scripts/{id}"), t, None).await.status,
        StatusCode::NO_CONTENT
    );

    // A default script can't be deleted, only reset.
    let list = call(&app, "GET", "/api/scripts", t, None).await.json();
    let work = list.as_array().unwrap().iter().find(|s| s["task"] == "work").unwrap()["id"]
        .as_i64()
        .unwrap();
    let refused_delete = call(&app, "DELETE", &format!("/api/scripts/{work}"), t, None).await;
    assert_eq!(refused_delete.status, StatusCode::CONFLICT);
    assert_eq!(refused_delete.error(), "default-script");
    call(
        &app,
        "POST",
        &format!("/api/scripts/{work}/versions"),
        t,
        Some(json!({ "source": VALID })),
    )
    .await;
    let reset = call(&app, "POST", &format!("/api/scripts/{work}/reset"), t, None).await.json();
    assert_eq!(
        (reset["followsDefault"].clone(), reset["latestVersion"].clone()),
        (json!(true), json!(3))
    );
    assert_eq!(
        call(&app, "GET", &format!("/api/scripts/{id}"), t, None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn deletes_versions_over_http_refusing_the_active_one() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    let token = token_for(&conn, add_user(&conn, "Mara"));
    let t = Some(token.as_str());
    let id =
        call(&app, "POST", "/api/scripts", t, Some(json!({ "name": "miners", "source": VALID })))
            .await
            .json()["id"]
            .as_i64()
            .unwrap();
    call(
        &app,
        "POST",
        &format!("/api/scripts/{id}/versions"),
        t,
        Some(json!({ "source": VALID_2 })),
    )
    .await;
    call(&app, "POST", &format!("/api/scripts/{id}/versions"), t, Some(json!({ "source": VALID })))
        .await;
    let numbers = |v: &Value| -> Vec<i64> {
        v["versions"].as_array().unwrap().iter().map(|x| x["version"].as_i64().unwrap()).collect()
    };

    let refused = call(&app, "DELETE", &format!("/api/scripts/{id}/versions/3"), t, None).await;
    assert_eq!(
        (refused.status, refused.error().as_str()),
        (StatusCode::CONFLICT, "active-version")
    );
    let one = call(&app, "DELETE", &format!("/api/scripts/{id}/versions/2"), t, None).await;
    assert_eq!(one.status, StatusCode::OK);
    assert_eq!(numbers(&one.json()), [1, 3]);
    let older =
        call(&app, "POST", &format!("/api/scripts/{id}/delete-older"), t, None).await.json();
    assert_eq!(
        (older["activeVersion"].clone(), older["latestVersion"].clone()),
        (json!(3), json!(3))
    );
    assert_eq!(numbers(&older), [3]);
    assert_eq!(
        call(&app, "DELETE", &format!("/api/scripts/{id}/versions/1"), t, None).await.status,
        StatusCode::NOT_FOUND
    );

    let tobin = token_for(&conn, add_user(&conn, "Tobin"));
    let theirs =
        call(&app, "POST", &format!("/api/scripts/{id}/delete-older"), Some(&tobin), None).await;
    assert_eq!(theirs.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn needs_a_login_and_hides_other_players_scripts() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    let mara = token_for(&conn, add_user(&conn, "Mara"));
    let tobin = token_for(&conn, add_user(&conn, "Tobin"));
    let id = call(
        &app,
        "POST",
        "/api/scripts",
        Some(&mara),
        Some(json!({ "name": "miners", "source": VALID })),
    )
    .await
    .json()["id"]
        .as_i64()
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/scripts", None, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "GET", &format!("/api/scripts/{id}"), Some(&tobin), None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, "DELETE", &format!("/api/scripts/{id}"), Some(&tobin), None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn rate_limits_a_players_writes_together_not_their_reads_or_other_players() {
    let db = Db::new();
    let mut opts = db.opts();
    opts.script_write_rate_limit = 2;
    let limited = build_app(opts);
    let conn = db.conn();
    let mara = add_user(&conn, "Mara");
    let created = call(
        &limited,
        "POST",
        "/api/scripts",
        Some(&token_for(&conn, mara)),
        Some(json!({ "name": "a", "source": VALID })),
    )
    .await;
    assert_eq!(created.status, StatusCode::CREATED);
    let id = created.json()["id"].as_i64().unwrap();
    // A second write of another kind counts against the same limit.
    let saved = call(
        &limited,
        "POST",
        &format!("/api/scripts/{id}/versions"),
        Some(&token_for(&conn, mara)),
        Some(json!({ "source": VALID_2 })),
    )
    .await;
    assert_eq!(saved.status, StatusCode::CREATED);
    let res = call(
        &limited,
        "POST",
        "/api/scripts",
        Some(&token_for(&conn, mara)),
        Some(json!({ "name": "c", "source": VALID })),
    )
    .await;
    assert_eq!((res.status, res.error().as_str()), (StatusCode::TOO_MANY_REQUESTS, "rate-limited"));
    assert_eq!(
        call(&limited, "GET", "/api/scripts", Some(&token_for(&conn, mara)), None).await.status,
        StatusCode::OK
    );
    let tobin = add_user(&conn, "Tobin");
    let theirs = call(
        &limited,
        "POST",
        "/api/scripts",
        Some(&token_for(&conn, tobin)),
        Some(json!({ "name": "a", "source": VALID })),
    )
    .await;
    assert_eq!(theirs.status, StatusCode::CREATED);
}

#[tokio::test]
async fn answers_a_save_past_a_cap_with_409_library_full() {
    let db = Db::new();
    let app = db.app();
    let conn = db.conn();
    let mara = add_user(&conn, "Mara");
    let defaults = common::defaults();
    let s = create_script(&conn, &defaults, mara, Some("miners"), Some(VALID)).unwrap().summary.id;
    for _ in 2..=SCRIPT_MAX_VERSIONS as i64 {
        save_script(&conn, &defaults, mara, s, Some(VALID)).unwrap();
    }
    let res = call(
        &app,
        "POST",
        &format!("/api/scripts/{s}/versions"),
        Some(&token_for(&conn, mara)),
        Some(json!({ "source": VALID_2 })),
    )
    .await;
    assert_eq!(res.status, StatusCode::CONFLICT);
    assert_eq!(
        res.json(),
        json!({
            "error": "library-full",
            "message": format!("This script has {} versions, the most it can keep: delete old versions first.", SCRIPT_MAX_VERSIONS as i64),
        })
    );
}

#[tokio::test]
async fn answers_the_health_check_with_the_tick() {
    let db = Db::new();
    let res = call(&db.app(), "GET", "/api/health", None, None).await;
    assert_eq!(res.json(), json!({ "ok": true, "tick": 0, "language": 1 }));
}

// ------------------------------------------------------------------ with the server's game thread

struct NoLog;

impl csp_server::monitoring::LogSink for NoLog {
    fn log(&self, _: tracing::Level, _: Value, _: &str) {}
}

#[tokio::test(flavor = "multi_thread")]
async fn lets_admins_give_and_lift_directives_and_no_one_else() {
    let db = Db::new();
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let world = create_world(&terrain, 1);
    let explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
    let game = game_thread(&db, world, terrain, explored);
    let mut opts = db.opts();
    opts.game = Some(game.clone());
    let app = build_app(opts);
    create_admin(&db.conn(), Some("Daniel"), Some("admin password")).unwrap();
    let admin = login_as(&app, "Daniel", "admin password").await;
    let invite = call(&app, "POST", "/api/admin/invites", Some(&admin), None).await;
    sign_up(&app, "Mara", invite.json()["code"].as_str().unwrap(), "correct horse").await;
    let mara = login_as(&app, "Mara", "correct horse").await;
    let mara_id = get_session_user(&db.conn(), Some(&mara), now_ms()).unwrap().unwrap().id;
    let realm = json!({ "id": "r1", "userId": mara_id, "leaderId": "a1" });
    game.run(move |g, _| g.world.realms.push(serde_json::from_value(realm).unwrap())).await;
    let directives = || {
        let game = game.clone();
        async move { game.run(|g, _| g.world.directives.clone()).await.unwrap() }
    };

    let listed = call(&app, "GET", "/api/admin/directives", Some(&admin), None).await;
    assert_eq!(
        listed.json(),
        json!({
            "directives": [],
            "targets": [{
                "org": "r1", "name": "a fallen realm", "is": "realm", "account": "Mara",
                "cities": [], "allies": [],
            }],
        })
    );
    let payload = json!({
        "target": "r1",
        "withAlliance": false,
        "reason": "farms new Players",
        "goals": [{ "kind": "soldiers", "count": 20 }],
    });
    let with = |key: &str, value: Value| {
        let mut p = payload.clone();
        p[key] = value;
        p
    };
    let url = "/api/admin/directives";
    let refused = call(&app, "POST", url, Some(&mara), Some(payload.clone())).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    let bad = call(&app, "POST", url, Some(&admin), Some(with("target", json!("nowhere")))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    let no_goals = call(&app, "POST", url, Some(&admin), Some(with("goals", json!([])))).await;
    assert_eq!(no_goals.status, StatusCode::BAD_REQUEST);

    let given = call(&app, "POST", url, Some(&admin), Some(payload.clone())).await;
    assert_eq!(given.status, StatusCode::CREATED);
    let shown = given.json();
    for key in ["target", "withAlliance", "reason"] {
        assert_eq!(shown[key], payload[key], "{key}");
    }
    let goal = &shown["goals"][0];
    assert_eq!(
        (&goal["kind"], goal["count"].as_f64()),
        (&json!("soldiers"), Some(20.0)),
        "{shown}"
    );
    assert_eq!(shown["goals"].as_array().map(Vec::len), Some(1));
    assert_eq!((&shown["givenBy"], &shown["soldiersKilled"]), (&json!("Daniel"), &json!(0.0)));
    let now = directives().await;
    assert_eq!(now.len(), 1);
    assert_eq!(now[0].price, None);

    let one = format!("{url}/{}", shown["id"].as_str().unwrap());
    let priced = json!({ "price": 800 });
    let refused = call(&app, "PATCH", &one, Some(&mara), Some(priced.clone())).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    let bad_price = call(&app, "PATCH", &one, Some(&admin), Some(json!({ "price": 0 }))).await;
    assert_eq!(bad_price.status, StatusCode::BAD_REQUEST);
    let set = call(&app, "PATCH", &one, Some(&admin), Some(priced)).await;
    assert_eq!(set.status, StatusCode::OK);
    assert_eq!(set.json()["price"], json!(800.0));
    assert_eq!(directives().await[0].price, Some(800.0));

    assert_eq!(call(&app, "DELETE", &one, Some(&mara), None).await.status, StatusCode::FORBIDDEN);
    assert_eq!(call(&app, "DELETE", &one, Some(&admin), None).await.status, StatusCode::NO_CONTENT);
    assert_eq!(directives().await, []);
    assert_eq!(call(&app, "DELETE", &one, Some(&admin), None).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_health_and_tick_health_from_the_game_thread_between_ticks() {
    use csp_server::server::{Game, GameThread, TickSettings};
    let db = Db::new();
    let path = db.path.clone();
    let settings =
        TickSettings { invariant_sample_rate: 0.0, slow_tick_ms: 800.0, save_every_ticks: 30 };
    let game = GameThread::spawn(
        move || {
            let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
            let world = create_world(&terrain, 1);
            let explored = ExploredTerrain::new(terrain.clone(), &world.nodes);
            Ok((open_db(&path, None)?, Game::new(world, terrain, explored, NoLog)))
        },
        settings,
    )
    .unwrap();
    game.tick().await.unwrap();
    game.tick().await.unwrap();
    let window = Arc::clone(&game.tick_health);
    let clock = game.tick_clock;
    let game = Arc::new(game);
    let mut opts = db.opts();
    opts.game = Some(game.clone());
    opts.tick_health = Some(Arc::new(move || {
        let now = clock.elapsed().as_secs_f64() * 1000.0;
        serde_json::to_value(window.lock().unwrap().summary(now)).unwrap()
    }));
    let app = build_app(opts);

    let health = call(&app, "GET", "/api/health", None, None).await;
    assert_eq!(health.json(), json!({ "ok": true, "tick": 2, "language": 1 }));

    let conn = db.conn();
    create_admin(&conn, Some("Daniel"), Some("admin password")).unwrap();
    let admin = login_as(&app, "Daniel", "admin password").await;
    let summary = call(&app, "GET", "/api/admin/tick-health", Some(&admin), None).await;
    assert_eq!(summary.status, StatusCode::OK);
    assert_eq!(summary.json()["lastMinute"]["ticks"], 2);
    assert_eq!(summary.json()["lastHour"]["ticks"], 2);
    let mara = token_for(&conn, add_user(&conn, "Mara"));
    let refused = call(&app, "GET", "/api/admin/tick-health", Some(&mara), None).await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);

    drop(app);
    Arc::try_unwrap(game).ok().expect("the app let go of the game").stop().await.unwrap();
}

/// The server's game thread on `world`, sharing the test's database file.
fn game_thread(
    db: &Db,
    world: csp_shared::world::WorldState,
    terrain: TerrainMap,
    explored: ExploredTerrain,
) -> Arc<csp_server::server::GameThread<NoLog>> {
    use csp_server::server::{Game, GameThread, TickSettings};
    let path = db.path.clone();
    let settings =
        TickSettings { invariant_sample_rate: 0.0, slow_tick_ms: 800.0, save_every_ticks: 30 };
    let game = GameThread::spawn(
        move || Ok((open_db(&path, None)?, Game::new(world, terrain, explored, NoLog))),
        settings,
    )
    .unwrap();
    Arc::new(game)
}
