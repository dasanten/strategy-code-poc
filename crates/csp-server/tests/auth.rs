//! Accounts, sessions and invite codes against a real database (`auth.ts`); the login back-off
//! cases of `auth.test.ts` are unit tests in `src/auth.rs`.
use std::cell::RefCell;

use csp_server::{
    auth::{
        create_admin, create_invite_code, create_session, delete_expired_sessions, delete_session,
        find_user_by_name, get_session_user, hash_password, hash_token, log_in, reset_password,
        session_alive, sign_up, verify_password, ApiErrorCode, AuthFailure, LoginBackoff,
        SessionSockets, SESSION_DAYS,
    },
    db::open_db,
};
use rusqlite::Connection;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const T0: i64 = 1_700_000_000_000;

fn db() -> Connection {
    open_db(":memory:", None).unwrap()
}

fn code_of(r: Result<impl std::fmt::Debug, AuthFailure>) -> ApiErrorCode {
    match r {
        Err(AuthFailure::Auth(e)) => e.code,
        other => panic!("expected an AuthError, got {other:?}"),
    }
}

#[derive(Default)]
struct Sockets {
    sessions: RefCell<Vec<String>>,
    users: RefCell<Vec<i64>>,
}

impl SessionSockets for Sockets {
    fn disconnect_session(&self, token_hash: &str) {
        self.sessions.borrow_mut().push(token_hash.to_owned());
    }
    fn disconnect_user(&self, user_id: i64) {
        self.users.borrow_mut().push(user_id);
    }
}

#[test]
fn verifies_a_hash_the_typescript_server_wrote() {
    // `scryptSync('correct horse', '0123456789abcdef', 64)` in Node, as `hashPassword` stores it.
    let stored = "scrypt$MDEyMzQ1Njc4OWFiY2RlZg==$0LupyHkzAIgDr9UDsriAAf87vMbCbcaUfDvFOAHk0D0j5FDm643A031eTgoXAgCtB9917OPAizRUNx9itOkmEA==";
    assert!(verify_password("correct horse", stored));
    assert!(!verify_password("wrong horse", stored));
}

#[test]
fn hashes_in_the_typescript_format_and_refuses_anything_else() {
    let stored = hash_password("correct horse");
    let parts: Vec<&str> = stored.split('$').collect();
    assert_eq!(parts[0], "scrypt");
    assert_eq!(parts[1].len(), 24); // 16 bytes, base64 with padding
    assert_eq!(parts[2].len(), 88); // 64 bytes
    assert!(verify_password("correct horse", &stored));
    assert_ne!(hash_password("correct horse"), stored); // a new salt each time
    for bad in ["", "scrypt", "scrypt$$", "argon2$abc$def", "scrypt$!!$!!"] {
        assert!(!verify_password("correct horse", bad), "{bad}");
    }
}

#[test]
fn hashes_tokens_as_the_typescript_server() {
    // `createHash('sha256').update('some-token').digest('base64url')` in Node.
    assert_eq!(hash_token("some-token"), "MI7ana8mt0RrKERJpYlauaBP8wwSnURU5HHPuBv1VX0");
}

#[test]
fn signs_up_with_an_invite_code_once() {
    let conn = db();
    let code = create_invite_code(&conn, None).unwrap();
    assert_eq!(code.len(), 10);
    assert!(code.bytes().all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b)));

    let mara = sign_up(&conn, Some("Mara"), Some("correct horse"), Some(&format!(" {code} ")), T0)
        .unwrap();
    assert_eq!(mara.name, "Mara");
    assert!(!mara.is_admin);
    let (used_by, used_at): (i64, i64) = conn
        .query_row("SELECT used_by, used_at FROM invite_codes WHERE code = ?1", [&code], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!((used_by, used_at), (mara.id, T0 / 1000));

    // The code is used up.
    assert_eq!(
        code_of(sign_up(&conn, Some("Tomas"), Some("correct horse"), Some(&code), T0)),
        ApiErrorCode::InvalidInvite
    );
    assert_eq!(
        code_of(sign_up(&conn, Some("Tomas"), Some("correct horse"), None, T0)),
        ApiErrorCode::InvalidInvite
    );
    // Names are unique whatever their case; the code is not used up by a refused sign-up.
    let second = create_invite_code(&conn, Some(mara.id)).unwrap();
    assert_eq!(
        code_of(sign_up(&conn, Some("mara"), Some("correct horse"), Some(&second), T0)),
        ApiErrorCode::NameTaken
    );
    sign_up(&conn, Some("Tomas"), Some("correct horse"), Some(&second), T0).unwrap();
}

#[test]
fn refuses_bad_names_and_passwords() {
    let conn = db();
    let code = create_invite_code(&conn, None).unwrap();
    for name in [None, Some("ab"), Some("a".repeat(21).as_str()), Some("Mära"), Some("a b c")] {
        assert_eq!(
            code_of(sign_up(&conn, name, Some("correct horse"), Some(&code), T0)),
            ApiErrorCode::InvalidInput
        );
    }
    let long = "x".repeat(201);
    for password in [None, Some("short"), Some(long.as_str())] {
        let r = sign_up(&conn, Some("Mara"), password, Some(&code), T0);
        let Err(AuthFailure::Auth(e)) = r else { panic!() };
        assert_eq!(e.code, ApiErrorCode::InvalidInput);
        assert_eq!(e.message, "Passwords need at least 10 characters.");
    }
    // Ten characters are enough, counted as JavaScript counts them.
    sign_up(&conn, Some("Mara_-1"), Some("ääääääääää"), Some(&code), T0).unwrap();
}

#[test]
fn logs_in_by_name_whatever_its_case() {
    let conn = db();
    let b = LoginBackoff::new();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let user = log_in(&conn, &b, Some("mARA"), Some("correct horse"), T0).unwrap();
    assert_eq!((user.name.as_str(), user.is_admin), ("Mara", true));
    assert_eq!(code_of(log_in(&conn, &b, None, Some("x"), T0)), ApiErrorCode::WrongLogin);
    // An account with an empty hash cannot log in.
    conn.execute("INSERT INTO users (name) VALUES ('Empty')", []).unwrap();
    assert_eq!(code_of(log_in(&conn, &b, Some("Empty"), Some(""), T0)), ApiErrorCode::WrongLogin);
}

#[test]
fn sessions_last_thirty_days_and_are_extended_at_most_daily() {
    let conn = db();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id = find_user_by_name(&conn, "Mara").unwrap().unwrap().id;
    let token = create_session(&conn, id, T0).unwrap();
    let hash = hash_token(&token);
    let expires = || -> i64 {
        conn.query_row("SELECT expires_at FROM sessions WHERE token_hash = ?1", [&hash], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(expires(), (T0 + SESSION_DAYS * DAY_MS) / 1000);
    assert_eq!(get_session_user(&conn, Some(&token), T0).unwrap().unwrap().name, "Mara");
    assert_eq!(get_session_user(&conn, Some("nonsense"), T0).unwrap(), None);
    assert_eq!(get_session_user(&conn, None, T0).unwrap(), None);

    // Less than a day in: not extended.
    get_session_user(&conn, Some(&token), T0 + DAY_MS - 1000).unwrap().unwrap();
    assert_eq!(expires(), (T0 + SESSION_DAYS * DAY_MS) / 1000);
    // Over a day in: extended to 30 days from then.
    let later = T0 + 2 * DAY_MS;
    get_session_user(&conn, Some(&token), later).unwrap().unwrap();
    assert_eq!(expires(), (later + SESSION_DAYS * DAY_MS) / 1000);

    let end = later + SESSION_DAYS * DAY_MS;
    assert!(session_alive(&conn, &hash, end - 1000).unwrap());
    assert!(!session_alive(&conn, &hash, end).unwrap());
    // An expired session is unknown and gone.
    assert_eq!(get_session_user(&conn, Some(&token), end).unwrap(), None);
    assert!(!session_alive(&conn, &hash, T0).unwrap());
}

#[test]
fn logout_ends_one_session_and_closes_its_sockets() {
    let conn = db();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id = find_user_by_name(&conn, "Mara").unwrap().unwrap().id;
    let a = create_session(&conn, id, T0).unwrap();
    let b = create_session(&conn, id, T0).unwrap();
    let sockets = Sockets::default();
    delete_session(&conn, &a, Some(&sockets)).unwrap();
    assert_eq!(*sockets.sessions.borrow(), vec![hash_token(&a)]);
    assert_eq!(get_session_user(&conn, Some(&a), T0).unwrap(), None);
    assert!(get_session_user(&conn, Some(&b), T0).unwrap().is_some());
}

#[test]
fn deletes_expired_sessions_only() {
    let conn = db();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id = find_user_by_name(&conn, "Mara").unwrap().unwrap().id;
    let old = create_session(&conn, id, T0).unwrap();
    let new = create_session(&conn, id, T0 + 10 * DAY_MS).unwrap();
    assert_eq!(delete_expired_sessions(&conn, T0 + (SESSION_DAYS + 1) * DAY_MS).unwrap(), 1);
    assert!(!session_alive(&conn, &hash_token(&old), T0).unwrap());
    assert!(session_alive(&conn, &hash_token(&new), T0).unwrap());
}

#[test]
fn a_password_reset_logs_the_account_out_everywhere() {
    let conn = db();
    let b = LoginBackoff::new();
    create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
    let id = find_user_by_name(&conn, "Mara").unwrap().unwrap().id;
    let token = create_session(&conn, id, T0).unwrap();
    let sockets = Sockets::default();
    reset_password(&conn, Some("mara"), Some("battery staple"), Some(&sockets)).unwrap();
    assert_eq!(*sockets.users.borrow(), vec![id]);
    assert_eq!(get_session_user(&conn, Some(&token), T0).unwrap(), None);
    assert_eq!(
        code_of(log_in(&conn, &b, Some("Mara"), Some("correct horse"), T0)),
        ApiErrorCode::WrongLogin
    );
    log_in(&conn, &b, Some("Mara"), Some("battery staple"), T0).unwrap();

    assert_eq!(
        code_of(reset_password(&conn, Some("Nobody"), Some("battery staple"), None)),
        ApiErrorCode::NotFound
    );
    assert_eq!(
        code_of(reset_password(&conn, Some("Mara"), Some("short"), None)),
        ApiErrorCode::InvalidInput
    );
}

#[test]
fn create_admin_makes_an_existing_account_admin_and_sets_its_password() {
    let conn = db();
    let b = LoginBackoff::new();
    let code = create_invite_code(&conn, None).unwrap();
    let mara = sign_up(&conn, Some("Mara"), Some("correct horse"), Some(&code), T0).unwrap();
    create_admin(&conn, Some("MARA"), Some("battery staple")).unwrap();
    let user = log_in(&conn, &b, Some("Mara"), Some("battery staple"), T0).unwrap();
    assert_eq!((user.id, user.is_admin), (mara.id, true));
    let count: i64 = conn.query_row("SELECT count(*) FROM users", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        code_of(create_admin(&conn, Some("x"), Some("battery staple"))),
        ApiErrorCode::InvalidInput
    );
}

#[test]
fn errors_serialise_as_the_api_codes() {
    assert_eq!(serde_json::to_string(&ApiErrorCode::RateLimited).unwrap(), "\"rate-limited\"");
    assert_eq!(
        serde_json::to_string(&ApiErrorCode::ScriptHasErrors).unwrap(),
        "\"script-has-errors\""
    );
}
