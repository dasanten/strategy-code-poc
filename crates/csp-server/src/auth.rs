//! Accounts, sessions and invite codes (`apps/server/src/auth.ts`, ADR 0005): scrypt password hashes
//! the TypeScript server wrote verify here and the other way round, session tokens kept only as a
//! hash, single-use invite codes and the per-name login back-off.
//!
//! Times are milliseconds since the epoch, as `Date.now()`; the database keeps whole seconds, as
//! Drizzle's `mode: 'timestamp'` columns do.

use std::{
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use indexmap::IndexMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

const KEY_LENGTH: usize = 64;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
pub const SESSION_DAYS: i64 = 30;

/// Failed logins in a row for one name before that name's back-off starts.
pub const LOGIN_FAILURES_BEFORE_BACKOFF: u32 = 5;
/// The first back-off wait; it doubles with every further failure.
pub const LOGIN_BACKOFF_MS: i64 = 30 * 1000;
/// The longest back-off wait.
pub const LOGIN_BACKOFF_MAX_MS: i64 = 15 * 60 * 1000;
/// How many names the back-off remembers at once; past that, the oldest entries are dropped.
pub const LOGIN_BACKOFF_TRACKED_NAMES: usize = 10_000;

/// `MIN_PASSWORD_LENGTH` and `MAX_PASSWORD_LENGTH` of `packages/shared/src/api.ts`, counted in
/// UTF-16 code units as JavaScript's `length`.
pub const MIN_PASSWORD_LENGTH: usize = 10;
pub const MAX_PASSWORD_LENGTH: usize = 200;

/// `ApiErrorCode` of `packages/shared/src/api.ts`: what the API reports as `{ error, message }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiErrorCode {
    InvalidInput,
    NameTaken,
    InvalidInvite,
    WrongLogin,
    NotLoggedIn,
    NotAdmin,
    NotFound,
    NotExplored,
    RateLimited,
    ScriptHasErrors,
    DefaultScript,
    ActiveVersion,
    LibraryFull,
}

/// A failure the API reports to the client as `{ error, message }`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct AuthError {
    pub code: ApiErrorCode,
    pub message: String,
}

impl AuthError {
    fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

/// What can go wrong in this module: a failure for the client, or the database.
#[derive(Debug, thiserror::Error)]
pub enum AuthFailure {
    #[error(transparent)]
    Auth(#[from] AuthError),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub type AuthResult<T> = Result<T, AuthFailure>;

/// The account a session belongs to (`SessionUser`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: i64,
    pub name: String,
    pub is_admin: bool,
}

/// A row of `users`, as `findUserByName` returns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserRow {
    pub id: i64,
    pub name: String,
    pub password_hash: String,
    pub is_admin: bool,
}

impl UserRow {
    fn account(&self) -> SessionUser {
        SessionUser { id: self.id, name: self.name.clone(), is_admin: self.is_admin }
    }
}

/// The open sockets of sessions (the realtime layer), closed when a session ends: one session's on
/// logout, all of an account's on a password reset.
pub trait SessionSockets {
    fn disconnect_session(&self, token_hash: &str);
    fn disconnect_user(&self, user_id: i64);
}

/// Milliseconds since the epoch, as `Date.now()`.
pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// A `Date` as Drizzle's `mode: 'timestamp'` stores it: whole seconds, rounded down.
fn to_seconds(ms: i64) -> i64 {
    ms.div_euclid(1000)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("the operating system's random source");
    bytes
}

/// Node's `scrypt` defaults: N = 16384, r = 8, p = 1.
fn scrypt_hash(password: &str, salt: &[u8], len: usize) -> Vec<u8> {
    #[cfg(test)]
    tests::PASSWORD_CHECKS.with(|c| c.set(c.get() + 1));
    let params = scrypt::Params::new(14, 8, 1, len).expect("valid scrypt parameters");
    let mut out = vec![0u8; len];
    scrypt::scrypt(password.as_bytes(), salt, &params, &mut out).expect("valid output length");
    out
}

/// `scrypt$<salt>$<hash>`, both base64 with padding, as `hashPassword`.
pub fn hash_password(password: &str) -> String {
    let salt = random_bytes::<16>();
    let hash = scrypt_hash(password, &salt, KEY_LENGTH);
    format!("scrypt${}${}", STANDARD.encode(salt), STANDARD.encode(hash))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let mut parts = stored.split('$');
    let (Some("scrypt"), Some(salt), Some(hash)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if salt.is_empty() || hash.is_empty() {
        return false;
    }
    let (Ok(salt), Ok(expected)) = (STANDARD.decode(salt), STANDARD.decode(hash)) else {
        return false;
    };
    if expected.is_empty() {
        return false;
    }
    let actual = scrypt_hash(password, &salt, expected.len());
    // Constant time, as `timingSafeEqual`.
    actual.iter().zip(&expected).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// `NAME_PATTERN`: 3–20 letters, digits, `_` or `-`.
pub fn is_valid_name(name: &str) -> bool {
    (3..=20).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn validate_name(name: Option<&str>) -> Result<&str, AuthError> {
    match name {
        Some(n) if is_valid_name(n) => Ok(n),
        _ => Err(AuthError::new(
            ApiErrorCode::InvalidInput,
            "Names are 3–20 letters, digits, \"_\" or \"-\".",
        )),
    }
}

fn validate_password(password: Option<&str>) -> Result<&str, AuthError> {
    match password {
        Some(p)
            if (MIN_PASSWORD_LENGTH..=MAX_PASSWORD_LENGTH).contains(&p.encode_utf16().count()) =>
        {
            Ok(p)
        }
        _ => Err(AuthError::new(
            ApiErrorCode::InvalidInput,
            format!("Passwords need at least {MIN_PASSWORD_LENGTH} characters."),
        )),
    }
}

/// The account of a name, whatever its case.
pub fn find_user_by_name(conn: &Connection, name: &str) -> rusqlite::Result<Option<UserRow>> {
    conn.query_row(
        "SELECT id, name, password_hash, is_admin FROM users WHERE lower(name) = lower(?1)",
        [name],
        |r| {
            Ok(UserRow {
                id: r.get(0)?,
                name: r.get(1)?,
                password_hash: r.get(2)?,
                is_admin: r.get(3)?,
            })
        },
    )
    .optional()
}

/// Creates an account, using up the invite code.
pub fn sign_up(
    conn: &Connection,
    name: Option<&str>,
    password: Option<&str>,
    invite_code: Option<&str>,
    now: i64,
) -> AuthResult<SessionUser> {
    let name = validate_name(name)?;
    let password = validate_password(password)?;
    let code = invite_code.map_or("", str::trim);
    let password_hash = hash_password(password);

    let tx = conn.unchecked_transaction()?;
    let invite: Option<String> = tx
        .query_row(
            "SELECT code FROM invite_codes WHERE code = ?1 AND used_by IS NULL",
            [code],
            |r| r.get(0),
        )
        .optional()?;
    if invite.is_none() {
        return Err(AuthError::new(
            ApiErrorCode::InvalidInvite,
            "That invite code is unknown or used.",
        )
        .into());
    }
    if find_user_by_name(&tx, name)?.is_some() {
        return Err(AuthError::new(ApiErrorCode::NameTaken, "That name is taken.").into());
    }
    let id: i64 = tx.query_row(
        "INSERT INTO users (name, password_hash) VALUES (?1, ?2) RETURNING id",
        params![name, password_hash],
        |r| r.get(0),
    )?;
    tx.execute(
        "UPDATE invite_codes SET used_by = ?1, used_at = ?2 WHERE code = ?3",
        params![id, to_seconds(now), code],
    )?;
    tx.commit()?;
    Ok(SessionUser { id, name: name.to_owned(), is_admin: false })
}

/// A hash no password matches, made once with the same scrypt parameters as real ones, so a login
/// for an unknown name does the same work as one for a known name with the wrong password.
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| hash_password(&STANDARD.encode(random_bytes::<32>())))
}

#[derive(Debug, Clone, Copy, Default)]
struct Failures {
    failures: u32,
    until: i64,
}

/// Failed logins per name (lower-cased), whether or not the name exists, so the back-off tells
/// nothing about which names exist. `until` is when the name may try again. In memory only: a
/// restart forgets it (ADR 0005, addendum). Ordered by last failure, oldest first.
#[derive(Debug, Default)]
pub struct LoginBackoff {
    failures: Mutex<IndexMap<String, Failures>>,
}

impl LoginBackoff {
    pub fn new() -> Self {
        Self::default()
    }

    fn map(&self) -> std::sync::MutexGuard<'_, IndexMap<String, Failures>> {
        self.failures.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Forgets every back-off.
    pub fn clear(&self) {
        self.map().clear();
    }

    /// How many names it remembers.
    pub fn len(&self) -> usize {
        self.map().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn waiting(&self, key: &str, now: i64) -> bool {
        self.map().get(key).is_some_and(|f| f.until > now)
    }

    fn note_failure(&self, key: &str, now: i64) {
        let mut map = self.map();
        // Re-inserted, so the map stays ordered by last failure.
        let mut entry = map.shift_remove(key).unwrap_or_default();
        entry.failures += 1;
        if let Some(over) = entry.failures.checked_sub(LOGIN_FAILURES_BEFORE_BACKOFF) {
            let wait = LOGIN_BACKOFF_MS.saturating_mul(1i64.checked_shl(over).unwrap_or(i64::MAX));
            entry.until = now + wait.clamp(0, LOGIN_BACKOFF_MAX_MS);
        }
        map.insert(key.to_owned(), entry);
        while map.len() > LOGIN_BACKOFF_TRACKED_NAMES {
            map.shift_remove_index(0);
        }
    }

    fn forget(&self, key: &str) {
        self.map().shift_remove(key);
    }
}

/// Logs in by name and password. Every attempt not refused by the back-off costs one password
/// check, whether or not the name exists.
pub fn log_in(
    conn: &Connection,
    backoff: &LoginBackoff,
    name: Option<&str>,
    password: Option<&str>,
    now: i64,
) -> AuthResult<SessionUser> {
    let wrong = || AuthError::new(ApiErrorCode::WrongLogin, "Wrong name or password.");
    let (Some(name), Some(password)) = (name, password) else {
        return Err(wrong().into());
    };
    let key = js_lower(name);
    if backoff.waiting(&key, now) {
        // Same message as a wrong password: the wait is per name, never a hint that the name exists.
        return Err(AuthError::new(ApiErrorCode::RateLimited, "Wrong name or password.").into());
    }
    let user = find_user_by_name(conn, name)?;
    let stored = user.as_ref().map_or_else(|| dummy_hash(), |u| u.password_hash.as_str());
    let ok = verify_password(password, stored);
    match user {
        Some(user) if ok => {
            backoff.forget(&key);
            Ok(user.account())
        }
        _ => {
            backoff.note_failure(&key, now);
            Err(wrong().into())
        }
    }
}

/// `toLowerCase()` for the back-off's key. Names that can log in are ASCII; any other string only
/// needs to map the same way every time.
fn js_lower(s: &str) -> String {
    s.to_lowercase()
}

/// The hash a session token is stored and tracked by; the token itself is only in the cookie.
pub fn hash_token(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

/// Starts a session and returns the token for the cookie.
pub fn create_session(conn: &Connection, user_id: i64, now: i64) -> rusqlite::Result<String> {
    let token = URL_SAFE_NO_PAD.encode(random_bytes::<32>());
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
        params![hash_token(&token), user_id, to_seconds(now + SESSION_DAYS * DAY_MS)],
    )?;
    Ok(token)
}

/// The user a session token belongs to, or `None` if it is unknown or expired. A session in use is
/// extended back to the full 30 days, at most once a day.
pub fn get_session_user(
    conn: &Connection,
    token: Option<&str>,
    now: i64,
) -> rusqlite::Result<Option<SessionUser>> {
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    let token_hash = hash_token(token);
    let row = conn
        .query_row(
            "SELECT users.id, users.name, users.is_admin, sessions.expires_at FROM sessions
             INNER JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?1",
            [&token_hash],
            |r| {
                Ok((
                    SessionUser { id: r.get(0)?, name: r.get(1)?, is_admin: r.get(2)? },
                    r.get::<_, i64>(3)? * 1000,
                ))
            },
        )
        .optional()?;
    let Some((user, expires_at)) = row else {
        return Ok(None);
    };
    if expires_at <= now {
        conn.execute("DELETE FROM sessions WHERE token_hash = ?1", [&token_hash])?;
        return Ok(None);
    }
    if expires_at - now < (SESSION_DAYS - 1) * DAY_MS {
        conn.execute(
            "UPDATE sessions SET expires_at = ?1 WHERE token_hash = ?2",
            params![to_seconds(now + SESSION_DAYS * DAY_MS), token_hash],
        )?;
    }
    Ok(Some(user))
}

/// Whether the session with this token hash still exists and has not expired.
pub fn session_alive(conn: &Connection, token_hash: &str, now: i64) -> rusqlite::Result<bool> {
    let expires: Option<i64> = conn
        .query_row("SELECT expires_at FROM sessions WHERE token_hash = ?1", [token_hash], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(expires.is_some_and(|s| s * 1000 > now))
}

/// Ends a session (logout), closing its open sockets.
pub fn delete_session(
    conn: &Connection,
    token: &str,
    sockets: Option<&dyn SessionSockets>,
) -> rusqlite::Result<()> {
    let token_hash = hash_token(token);
    conn.execute("DELETE FROM sessions WHERE token_hash = ?1", [&token_hash])?;
    if let Some(s) = sockets {
        s.disconnect_session(&token_hash);
    }
    Ok(())
}

pub fn delete_expired_sessions(conn: &Connection, now: i64) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM sessions WHERE expires_at < ?1", [to_seconds(now)])
}

/// 10 characters without look-alikes (0/O, 1/l/I), easy to read out or type.
const INVITE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub fn create_invite_code(conn: &Connection, created_by: Option<i64>) -> rusqlite::Result<String> {
    let code: String = random_bytes::<10>()
        .iter()
        .map(|b| INVITE_ALPHABET[usize::from(*b) % INVITE_ALPHABET.len()] as char)
        .collect();
    conn.execute(
        "INSERT INTO invite_codes (code, created_by) VALUES (?1, ?2)",
        params![code, created_by],
    )?;
    Ok(code)
}

/// Sets a new password and logs the account out everywhere, closing its open sockets.
pub fn reset_password(
    conn: &Connection,
    name: Option<&str>,
    password: Option<&str>,
    sockets: Option<&dyn SessionSockets>,
) -> AuthResult<()> {
    let pw = validate_password(password)?;
    let user = match name {
        Some(n) => find_user_by_name(conn, n)?,
        None => None,
    };
    let Some(user) = user else {
        return Err(AuthError::new(ApiErrorCode::NotFound, "No account with that name.").into());
    };
    let password_hash = hash_password(pw);
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![password_hash, user.id],
    )?;
    tx.execute("DELETE FROM sessions WHERE user_id = ?1", [user.id])?;
    tx.commit()?;
    if let Some(s) = sockets {
        s.disconnect_user(user.id);
    }
    Ok(())
}

/// Creates an admin account, or makes an existing account admin and sets its password.
pub fn create_admin(
    conn: &Connection,
    name: Option<&str>,
    password: Option<&str>,
) -> AuthResult<()> {
    let n = validate_name(name)?;
    let password_hash = hash_password(validate_password(password)?);
    match find_user_by_name(conn, n)? {
        Some(existing) => conn.execute(
            "UPDATE users SET is_admin = 1, password_hash = ?1 WHERE id = ?2",
            params![password_hash, existing.id],
        )?,
        None => conn.execute(
            "INSERT INTO users (name, password_hash, is_admin) VALUES (?1, ?2, 1)",
            params![n, password_hash],
        )?,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    //! The cases of `auth.test.ts`, which count password checks: those live here, beside the
    //! counter. The rest of the module's behaviour is tested in `tests/auth.rs`.
    use std::cell::Cell;

    use super::*;
    use crate::db::open_db;

    thread_local! {
        pub(super) static PASSWORD_CHECKS: Cell<usize> = const { Cell::new(0) };
    }

    fn password_checks() -> usize {
        PASSWORD_CHECKS.with(Cell::get)
    }

    fn reset_checks() {
        PASSWORD_CHECKS.with(|c| c.set(0));
    }

    fn setup() -> (Connection, LoginBackoff) {
        let conn = open_db(":memory:", None).unwrap();
        create_admin(&conn, Some("Mara"), Some("correct horse")).unwrap();
        reset_checks();
        (conn, LoginBackoff::new())
    }

    fn failure(
        conn: &Connection,
        b: &LoginBackoff,
        name: &str,
        password: &str,
        now: i64,
    ) -> AuthError {
        match log_in(conn, b, Some(name), Some(password), now) {
            Err(AuthFailure::Auth(e)) => e,
            Err(e) => panic!("{e}"),
            Ok(_) => panic!("login succeeded"),
        }
    }

    #[test]
    fn checks_the_password_for_an_unknown_name_just_like_for_a_wrong_password() {
        let (conn, b) = setup();
        // The first login for an unknown name may also make the dummy hash, once.
        failure(&conn, &b, "Warmup", "correct horse", 0);
        reset_checks();

        let unknown = failure(&conn, &b, "Nobody", "correct horse", 0);
        assert_eq!(unknown.code, ApiErrorCode::WrongLogin);
        assert_eq!(password_checks(), 1);

        let wrong = failure(&conn, &b, "Mara", "wrong password", 0);
        assert_eq!(wrong.code, ApiErrorCode::WrongLogin);
        assert_eq!(wrong.message, unknown.message);
        assert_eq!(password_checks(), 2);
    }

    #[test]
    fn refuses_a_name_after_repeated_failures_with_the_wrong_password_message() {
        let (conn, b) = setup();
        let t0 = 1_000_000;
        for _ in 0..LOGIN_FAILURES_BEFORE_BACKOFF {
            assert_eq!(
                failure(&conn, &b, "Mara", "wrong password", t0).code,
                ApiErrorCode::WrongLogin
            );
        }
        let checks = password_checks();
        let refused = failure(&conn, &b, "mara", "correct horse", t0 + LOGIN_BACKOFF_MS - 1);
        assert_eq!(refused.code, ApiErrorCode::RateLimited);
        assert_eq!(refused.message, "Wrong name or password.");
        assert_eq!(password_checks(), checks); // refused before any password check

        let user =
            log_in(&conn, &b, Some("Mara"), Some("correct horse"), t0 + LOGIN_BACKOFF_MS).unwrap();
        assert_eq!(user.name, "Mara");
    }

    #[test]
    fn clears_the_failures_on_a_successful_login() {
        let (conn, b) = setup();
        let t0 = 1_000_000;
        for _ in 0..LOGIN_FAILURES_BEFORE_BACKOFF - 1 {
            failure(&conn, &b, "Mara", "wrong password", t0);
        }
        log_in(&conn, &b, Some("Mara"), Some("correct horse"), t0).unwrap();
        for _ in 0..LOGIN_FAILURES_BEFORE_BACKOFF - 1 {
            assert_eq!(
                failure(&conn, &b, "Mara", "wrong password", t0).code,
                ApiErrorCode::WrongLogin
            );
        }
        assert!(log_in(&conn, &b, Some("Mara"), Some("correct horse"), t0).is_ok());
    }

    #[test]
    fn doubles_the_wait_with_every_further_failure_up_to_the_cap() {
        let (conn, b) = setup();
        let t0 = 1_000_000;
        for _ in 0..LOGIN_FAILURES_BEFORE_BACKOFF {
            failure(&conn, &b, "Mara", "wrong password", t0);
        }
        // One more failure once the first wait is over: the next wait is twice as long.
        let t1 = t0 + LOGIN_BACKOFF_MS;
        assert_eq!(failure(&conn, &b, "Mara", "wrong password", t1).code, ApiErrorCode::WrongLogin);
        assert_eq!(
            failure(&conn, &b, "Mara", "wrong password", t1 + 2 * LOGIN_BACKOFF_MS - 1).code,
            ApiErrorCode::RateLimited
        );
        assert_eq!(
            failure(&conn, &b, "Mara", "wrong password", t1 + 2 * LOGIN_BACKOFF_MS).code,
            ApiErrorCode::WrongLogin
        );
        // Many more failures never wait longer than the cap.
        let mut t = t1 + 2 * LOGIN_BACKOFF_MS;
        for _ in 0..20 {
            t += LOGIN_BACKOFF_MAX_MS;
            assert_eq!(
                failure(&conn, &b, "Mara", "wrong password", t).code,
                ApiErrorCode::WrongLogin
            );
        }
        assert_eq!(
            failure(&conn, &b, "Mara", "wrong password", t + LOGIN_BACKOFF_MAX_MS - 1).code,
            ApiErrorCode::RateLimited
        );
    }

    #[test]
    fn backs_off_unknown_names_too_so_the_back_off_tells_nothing_about_which_names_exist() {
        let (conn, b) = setup();
        let t0 = 1_000_000;
        for _ in 0..LOGIN_FAILURES_BEFORE_BACKOFF {
            assert_eq!(
                failure(&conn, &b, "Nobody", "correct horse", t0).code,
                ApiErrorCode::WrongLogin
            );
        }
        assert_eq!(
            failure(&conn, &b, "Nobody", "correct horse", t0).code,
            ApiErrorCode::RateLimited
        );
    }

    #[test]
    fn remembers_at_most_the_tracked_names_dropping_the_oldest() {
        let b = LoginBackoff::new();
        for i in 0..=LOGIN_BACKOFF_TRACKED_NAMES {
            b.note_failure(&format!("n{i}"), 0);
        }
        assert_eq!(b.len(), LOGIN_BACKOFF_TRACKED_NAMES);
        assert!(!b.map().contains_key("n0"));
        assert!(b.map().contains_key("n1"));
    }
}
