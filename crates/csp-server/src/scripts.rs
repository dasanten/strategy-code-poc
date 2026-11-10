//! A Player's script library (`CONTEXT.md`: Script; `apps/server/src/scripts.ts`, its database
//! half): named scripts with every saved version kept. Scripts belong to the account, so they
//! outlast the realm and a Leader's death.
//!
//! The active version is the one that runs. Saving a version without syntax errors makes it
//! active, so a saved change is picked up on the next tick; a version with errors is kept in the
//! history but never becomes active. Any version but the active one can be deleted; the others
//! keep their numbers.
//!
//! Each Player also has their own version of every default script (`CONTEXT.md`: Default script;
//! ADR 0009), made the first time their library is used. Until they edit it, it takes each new
//! game default as a new version ([`ensure_default_scripts`]); once edited it stays theirs until
//! they reset it. Default scripts can't be renamed or deleted.
//!
//! The game's defaults are a parameter ([`Defaults`]) rather than a constant, so a test can give
//! its own; [`game_defaults`] gives the game's (`DEFAULT_SCRIPTS`).

use csp_lang::{check_script, script_params, Diagnostic, ParamInfo};
use csp_shared::balance::{SCRIPT_LIBRARY_MAX_SCRIPTS, SCRIPT_MAX_VERSIONS};
use csp_shared::world::default_scripts::Task;
use csp_sim::sight::InvariantViolation;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use ts_rs::TS;

use crate::auth::{ApiErrorCode, AuthError, AuthFailure, AuthResult};

/// Script names are at most this many characters (`SCRIPT_NAME_MAX_LENGTH`).
pub const SCRIPT_NAME_MAX_LENGTH: usize = 40;
/// Scripts are at most this many characters (`SCRIPT_MAX_LENGTH`).
pub const SCRIPT_MAX_LENGTH: usize = 20_000;

/// The game's default script of a task (`DefaultScript`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultScript {
    pub task: Task,
    /// The name shown in the library, before ` (default)` (`DEFAULT_SCRIPTS[task].name`).
    pub name: String,
    pub source: String,
}

/// The game's default scripts, one per task in `TASKS` order (`DEFAULT_SCRIPTS`).
pub type Defaults = [DefaultScript];

/// The game's current default scripts (`DEFAULT_SCRIPTS`), one per task in `TASKS` order.
pub fn game_defaults() -> &'static Defaults {
    static DEFAULTS: std::sync::LazyLock<Vec<DefaultScript>> = std::sync::LazyLock::new(|| {
        csp_sim::default_scripts::DEFAULT_SCRIPTS
            .iter()
            .map(|&(task, name, source)| DefaultScript {
                task,
                name: name.to_owned(),
                source: source.to_owned(),
            })
            .collect()
    });
    &DEFAULTS
}

/// A task's name as stored in `scripts.task` (`Task` in camelCase).
pub fn task_name(task: Task) -> String {
    serde_json::to_value(task).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
}

/// The stored task, if it is one of the game's (`isTask`).
fn task_of(stored: Option<&str>) -> Option<Task> {
    stored.and_then(|s| serde_json::from_value(serde_json::Value::String(s.to_owned())).ok())
}

/// `defaultScriptName`: the library name of a task's default script.
pub fn default_script_name(d: &DefaultScript) -> String {
    format!("{} (default)", d.name)
}

fn default_of(defaults: &Defaults, task: Task) -> Option<&DefaultScript> {
    defaults.iter().find(|d| d.task == task)
}

fn fail(code: ApiErrorCode, message: impl Into<String>) -> AuthFailure {
    AuthFailure::Auth(AuthError { code, message: message.into() })
}

/// A JavaScript string's `length`: UTF-16 code units.
fn js_length(s: &str) -> usize {
    s.encode_utf16().count()
}

fn validate_name(name: Option<&str>) -> AuthResult<String> {
    let trimmed = name.map(str::trim).unwrap_or("");
    let n = js_length(trimmed);
    if n == 0 || n > SCRIPT_NAME_MAX_LENGTH {
        return Err(fail(
            ApiErrorCode::InvalidInput,
            format!("Script names need 1 to {SCRIPT_NAME_MAX_LENGTH} characters."),
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_source(source: Option<&str>) -> AuthResult<String> {
    let Some(source) = source else {
        return Err(fail(ApiErrorCode::InvalidInput, "A script needs source."));
    };
    if js_length(source) > SCRIPT_MAX_LENGTH {
        return Err(fail(
            ApiErrorCode::InvalidInput,
            format!("Scripts can be at most {SCRIPT_MAX_LENGTH} characters long."),
        ));
    }
    Ok(source.to_owned())
}

fn name_taken(
    conn: &Connection,
    user_id: i64,
    name: &str,
    except_id: Option<i64>,
) -> rusqlite::Result<bool> {
    let row: Option<i64> = conn
        .query_row(
            "SELECT id FROM scripts WHERE user_id = ?1 AND lower(name) = lower(?2)",
            params![user_id, name],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row.is_some_and(|id| Some(id) != except_id))
}

/// A row of `scripts`.
#[derive(Debug, Clone)]
struct ScriptRow {
    id: i64,
    name: String,
    active_version: Option<i64>,
    latest_version: i64,
    task: Option<String>,
    follows_default: bool,
    edited_from: Option<String>,
}

const SCRIPT_COLUMNS: &str =
    "id, name, active_version, latest_version, task, follows_default, edited_from";

fn script_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScriptRow> {
    Ok(ScriptRow {
        id: r.get(0)?,
        name: r.get(1)?,
        active_version: r.get(2)?,
        latest_version: r.get(3)?,
        task: r.get(4)?,
        follows_default: r.get(5)?,
        edited_from: r.get(6)?,
    })
}

fn own_script(conn: &Connection, user_id: i64, id: i64) -> AuthResult<ScriptRow> {
    conn.query_row(
        &format!("SELECT {SCRIPT_COLUMNS} FROM scripts WHERE id = ?1 AND user_id = ?2"),
        params![id, user_id],
        script_row,
    )
    .optional()?
    .ok_or_else(|| fail(ApiErrorCode::NotFound, "No such script."))
}

/// The library cap (`CONTEXT.md`: Library cap): a new script is refused once the Player's
/// library, their default scripts among them, holds `SCRIPT_LIBRARY_MAX_SCRIPTS`.
fn room_for_script(conn: &Connection, user_id: i64) -> AuthResult<()> {
    let count: i64 =
        conn.query_row("SELECT count(*) FROM scripts WHERE user_id = ?1", [user_id], |r| r.get(0))?;
    if count as f64 >= SCRIPT_LIBRARY_MAX_SCRIPTS {
        return Err(fail(
            ApiErrorCode::LibraryFull,
            format!(
                "Your library has {count} scripts, the most it can hold: delete scripts first."
            ),
        ));
    }
    Ok(())
}

/// The version cap (`CONTEXT.md`: Library cap): a Player's save or reset is refused once the
/// script keeps `SCRIPT_MAX_VERSIONS` versions. The game adding a changed default to a script
/// that follows it isn't the Player's save and never checks this.
fn room_for_version(conn: &Connection, script_id: i64) -> AuthResult<()> {
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM script_versions WHERE script_id = ?1",
        [script_id],
        |r| r.get(0),
    )?;
    if count as f64 >= SCRIPT_MAX_VERSIONS {
        return Err(fail(
            ApiErrorCode::LibraryFull,
            format!(
                "This script has {count} versions, the most it can keep: delete old versions first."
            ),
        ));
    }
    Ok(())
}

/// A script that isn't a default script; those can't be renamed or deleted.
fn not_default(row: &ScriptRow, what: &str) -> AuthResult<()> {
    if row.task.is_some() {
        return Err(fail(
            ApiErrorCode::DefaultScript,
            format!("A default script can’t be {what}."),
        ));
    }
    Ok(())
}

/// Adds a version; it becomes active if it has no syntax errors. It is numbered after the highest
/// version ever saved, so a deleted version's number is never used again.
fn add_version(conn: &Connection, script_id: i64, source: &str) -> rusqlite::Result<()> {
    let latest: i64 =
        conn.query_row("SELECT latest_version FROM scripts WHERE id = ?1", [script_id], |r| {
            r.get(0)
        })?;
    let version = latest + 1;
    conn.execute(
        "INSERT INTO script_versions (script_id, version, source) VALUES (?1, ?2, ?3)",
        params![script_id, version, source],
    )?;
    if check_script(source).is_empty() {
        conn.execute(
            "UPDATE scripts SET latest_version = ?1, active_version = ?1 WHERE id = ?2",
            params![version, script_id],
        )?;
    } else {
        conn.execute(
            "UPDATE scripts SET latest_version = ?1 WHERE id = ?2",
            params![version, script_id],
        )?;
    }
    Ok(())
}

fn source_of(
    conn: &Connection,
    script_id: i64,
    version: Option<i64>,
) -> rusqlite::Result<Option<String>> {
    let Some(version) = version else { return Ok(None) };
    conn.query_row(
        "SELECT source FROM script_versions WHERE script_id = ?1 AND version = ?2",
        params![script_id, version],
        |r| r.get(0),
    )
    .optional()
}

/// A default script being edited by its Player stops following the game's default.
fn mark_edited(conn: &Connection, defaults: &Defaults, row: &ScriptRow) -> rusqlite::Result<()> {
    if !row.follows_default {
        return Ok(());
    }
    let Some(d) = task_of(row.task.as_deref()).and_then(|t| default_of(defaults, t)) else {
        return Ok(());
    };
    conn.execute(
        "UPDATE scripts SET follows_default = 0, edited_from = ?1 WHERE id = ?2",
        params![d.source, row.id],
    )?;
    Ok(())
}

/// Makes sure the Player has their version of every default script, and that those they haven't
/// edited run the game's current default: a changed default becomes their newest version. A
/// script of theirs already called by a default script's name gets a number after its name.
pub fn ensure_default_scripts(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    for d in defaults {
        let task = task_name(d.task);
        let row = tx
            .query_row(
                &format!("SELECT {SCRIPT_COLUMNS} FROM scripts WHERE user_id = ?1 AND task = ?2"),
                params![user_id, task],
                script_row,
            )
            .optional()?;
        match row {
            None => {
                let name = default_script_name(d);
                let clash: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM scripts WHERE user_id = ?1 AND lower(name) = lower(?2)",
                        params![user_id, name],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(clash) = clash {
                    let mut n = 2;
                    while name_taken(&tx, user_id, &format!("{name} {n}"), None)? {
                        n += 1;
                    }
                    tx.execute(
                        "UPDATE scripts SET name = ?1 WHERE id = ?2",
                        params![format!("{name} {n}"), clash],
                    )?;
                }
                let id: i64 = tx.query_row(
                    "INSERT INTO scripts (user_id, name, task, follows_default) VALUES (?1, ?2, ?3, 1) RETURNING id",
                    params![user_id, name, task],
                    |r| r.get(0),
                )?;
                add_version(&tx, id, &d.source)?;
            }
            Some(row) => {
                if row.follows_default
                    && source_of(&tx, row.id, row.active_version)?.as_deref()
                        != Some(d.source.as_str())
                {
                    add_version(&tx, row.id, &d.source)?;
                }
            }
        }
    }
    tx.commit()
}

/// [`ensure_default_scripts`] for every Player, as the server starts with perhaps new defaults.
pub fn sync_default_scripts(conn: &Connection, defaults: &Defaults) -> rusqlite::Result<()> {
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM users")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for id in ids {
        ensure_default_scripts(conn, defaults, id)?;
    }
    Ok(())
}

/// The id of the Player's version of a task's default script, made if they have none yet.
pub fn default_script_id(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    task: Task,
) -> rusqlite::Result<Option<i64>> {
    ensure_default_scripts(conn, defaults, user_id)?;
    conn.query_row(
        "SELECT id FROM scripts WHERE user_id = ?1 AND task = ?2",
        params![user_id, task_name(task)],
        |r| r.get(0),
    )
    .optional()
}

/// A script in the Player's library (`ScriptSummary`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSummary {
    pub id: i64,
    pub name: String,
    /// The version that runs, always one without syntax errors; null while there is none.
    pub active_version: Option<i64>,
    pub latest_version: i64,
    /// For the Player's version of a default script, its task; null for their own scripts.
    pub task: Option<Task>,
    /// A default script the Player hasn't edited, which follows the game's default.
    pub follows_default: bool,
    /// The active version's `param` lines; none while there is none.
    #[ts(as = "Vec<csp_shared::views::ScriptParam>")]
    pub params: Vec<ParamInfo>,
}

/// One saved version of a script, with the syntax errors it has (at most one).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScriptVersion {
    pub version: i64,
    pub source: String,
    /// Seconds since the epoch.
    pub saved_at: i64,
    #[ts(type = "Array<{ message: string, line: number, column: number }>")]
    pub errors: Vec<Diagnostic>,
}

/// The game's side of a Player's default script (`GameDefault`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GameDefault {
    /// The game's current default.
    pub source: String,
    /// The game's default when the Player first edited theirs; null while they follow it.
    pub edited_from: Option<String>,
}

/// A script with its whole history, oldest version first (`ScriptDetail`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDetail {
    #[serde(flatten)]
    pub summary: ScriptSummary,
    pub versions: Vec<ScriptVersion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub game_default: Option<GameDefault>,
}

/// The `param` lines of an active version's source (`CONTEXT.md`: Script parameter).
fn params_of(source: Option<&str>) -> Vec<ParamInfo> {
    source.map(script_params).unwrap_or_default()
}

/// The Player's scripts, by name, their default scripts among them.
pub fn list_scripts(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
) -> rusqlite::Result<Vec<ScriptSummary>> {
    ensure_default_scripts(conn, defaults, user_id)?;
    let rows: Vec<ScriptRow> = conn
        .prepare(&format!(
            "SELECT {SCRIPT_COLUMNS} FROM scripts WHERE user_id = ?1 ORDER BY lower(name)"
        ))?
        .query_map([user_id], script_row)?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(|s| {
            let source = source_of(conn, s.id, s.active_version)?;
            Ok(ScriptSummary {
                id: s.id,
                name: s.name,
                active_version: s.active_version,
                latest_version: s.latest_version,
                task: task_of(s.task.as_deref()),
                follows_default: s.follows_default,
                params: params_of(source.as_deref()),
            })
        })
        .collect()
}

/// One of the Player's scripts with its whole history.
pub fn get_script(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
) -> AuthResult<ScriptDetail> {
    let script = own_script(conn, user_id, id)?;
    let versions: Vec<ScriptVersion> = conn
        .prepare(
            "SELECT version, source, created_at FROM script_versions WHERE script_id = ?1 ORDER BY version ASC",
        )?
        .query_map([id], |r| {
            let source: String = r.get(1)?;
            Ok(ScriptVersion {
                version: r.get(0)?,
                errors: check_script(&source),
                source,
                saved_at: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let task = task_of(script.task.as_deref());
    let params = params_of(
        versions
            .iter()
            .find(|v| Some(v.version) == script.active_version)
            .map(|v| v.source.as_str()),
    );
    let game_default = task.and_then(|t| default_of(defaults, t)).map(|d| GameDefault {
        source: d.source.clone(),
        edited_from: if script.follows_default { None } else { script.edited_from.clone() },
    });
    Ok(ScriptDetail {
        summary: ScriptSummary {
            id: script.id,
            name: script.name,
            active_version: script.active_version,
            latest_version: script.latest_version,
            task,
            follows_default: script.follows_default,
            params,
        },
        versions,
        game_default,
    })
}

/// Starts a new script with its first version.
pub fn create_script(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    name: Option<&str>,
    source: Option<&str>,
) -> AuthResult<ScriptDetail> {
    let name = validate_name(name)?;
    let source = validate_source(source)?;
    // So a new script can't take a default script's name.
    ensure_default_scripts(conn, defaults, user_id)?;
    let tx = conn.unchecked_transaction()?;
    if name_taken(&tx, user_id, &name, None)? {
        return Err(fail(ApiErrorCode::NameTaken, "You have a script by that name."));
    }
    room_for_script(&tx, user_id)?;
    let id: i64 = tx.query_row(
        "INSERT INTO scripts (user_id, name) VALUES (?1, ?2) RETURNING id",
        params![user_id, name],
        |r| r.get(0),
    )?;
    add_version(&tx, id, &source)?;
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Saves a new version of a script; earlier versions stay. A default script the Player saves is
/// theirs from then on.
pub fn save_script(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
    source: Option<&str>,
) -> AuthResult<ScriptDetail> {
    let source = validate_source(source)?;
    let tx = conn.unchecked_transaction()?;
    let row = own_script(&tx, user_id, id)?;
    room_for_version(&tx, id)?;
    add_version(&tx, id, &source)?;
    mark_edited(&tx, defaults, &row)?;
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Renames one of the Player's own scripts; names are unique per Player regardless of case.
pub fn rename_script(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
    name: Option<&str>,
) -> AuthResult<ScriptDetail> {
    let name = validate_name(name)?;
    ensure_default_scripts(conn, defaults, user_id)?;
    let tx = conn.unchecked_transaction()?;
    not_default(&own_script(&tx, user_id, id)?, "renamed")?;
    if name_taken(&tx, user_id, &name, Some(id))? {
        return Err(fail(ApiErrorCode::NameTaken, "You have a script by that name."));
    }
    tx.execute("UPDATE scripts SET name = ?1 WHERE id = ?2", params![name, id])?;
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// A version number as the JSON body gave it: only a whole number names a version (a JavaScript
/// number that is not an integer matches no row).
fn version_number(version: Option<f64>) -> Option<i64> {
    version.filter(|v| v.fract() == 0.0 && v.is_finite()).map(|v| v as i64)
}

/// Makes an earlier (or later) version the one that runs; refused if it has syntax errors. For a
/// default script that counts as editing it.
pub fn activate_version(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
    version: Option<f64>,
) -> AuthResult<ScriptDetail> {
    let tx = conn.unchecked_transaction()?;
    let script = own_script(&tx, user_id, id)?;
    let row: Option<(i64, String)> = match version_number(version) {
        Some(v) => tx
            .query_row(
                "SELECT version, source FROM script_versions WHERE script_id = ?1 AND version = ?2",
                params![id, v],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?,
        None => None,
    };
    let Some((number, source)) = row else {
        return Err(fail(ApiErrorCode::NotFound, "No such version."));
    };
    if let Some(error) = check_script(&source).first() {
        return Err(fail(
            ApiErrorCode::ScriptHasErrors,
            format!(
                "Version {number} has a syntax error at {}:{}: {}",
                error.line, error.column, error.message
            ),
        ));
    }
    tx.execute("UPDATE scripts SET active_version = ?1 WHERE id = ?2", params![number, id])?;
    mark_edited(&tx, defaults, &script)?;
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Resets a default script (`CONTEXT.md`: Default script): the game's current default becomes its
/// newest version, and it follows the game's default again until the Player edits it.
pub fn reset_script(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
) -> AuthResult<ScriptDetail> {
    let tx = conn.unchecked_transaction()?;
    let row = own_script(&tx, user_id, id)?;
    let Some(d) = task_of(row.task.as_deref()).and_then(|t| default_of(defaults, t)) else {
        return Err(fail(ApiErrorCode::DefaultScript, "Only a default script can be reset."));
    };
    room_for_version(&tx, id)?;
    add_version(&tx, id, &d.source)?;
    tx.execute("UPDATE scripts SET follows_default = 1, edited_from = NULL WHERE id = ?1", [id])?;
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Deletes one version for good; any but the active one, of a default script too. The others
/// keep their numbers and new saves keep counting up.
pub fn delete_version(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
    version: Option<f64>,
) -> AuthResult<ScriptDetail> {
    let tx = conn.unchecked_transaction()?;
    let script = own_script(&tx, user_id, id)?;
    let Some(version) = version else {
        return Err(fail(ApiErrorCode::NotFound, "No such version."));
    };
    // The active version can't be deleted (`CONTEXT.md`: Script, Deleting versions).
    if script.active_version.is_some_and(|a| a as f64 == version) {
        return Err(fail(ApiErrorCode::ActiveVersion, "The active version can’t be deleted."));
    }
    let deleted = match version_number(Some(version)) {
        Some(v) => tx.execute(
            "DELETE FROM script_versions WHERE script_id = ?1 AND version = ?2",
            params![id, v],
        )?,
        None => 0,
    };
    if deleted == 0 {
        return Err(fail(ApiErrorCode::NotFound, "No such version."));
    }
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Deletes every version older than the active one; nothing while there is no active version.
pub fn delete_older_versions(
    conn: &Connection,
    defaults: &Defaults,
    user_id: i64,
    id: i64,
) -> AuthResult<ScriptDetail> {
    let tx = conn.unchecked_transaction()?;
    if let Some(active) = own_script(&tx, user_id, id)?.active_version {
        tx.execute(
            "DELETE FROM script_versions WHERE script_id = ?1 AND version < ?2",
            params![id, active],
        )?;
    }
    tx.commit()?;
    get_script(conn, defaults, user_id, id)
}

/// Deletes a script with its whole history.
pub fn delete_script(conn: &Connection, user_id: i64, id: i64) -> AuthResult<()> {
    let tx = conn.unchecked_transaction()?;
    not_default(&own_script(&tx, user_id, id)?, "deleted")?;
    tx.execute("DELETE FROM scripts WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// What the run-script order needs of a script (`RunnableScript`): whose it is, its name for the
/// realm log and its active version's source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunnableScript {
    pub user_id: i64,
    pub name: String,
    /// The active version's number and source.
    pub version: i64,
    pub source: String,
    /// A default script its Player hasn't edited: running out of steps is the game's fault.
    pub follows_default: bool,
    /// The task it is the default script of; none for any other script.
    pub task: Option<Task>,
}

/// A script that can run: its Player and active version; none if it has none (or is gone).
pub fn runnable_script(
    conn: &Connection,
    script_id: i64,
) -> rusqlite::Result<Option<RunnableScript>> {
    conn.query_row(
        "SELECT s.user_id, s.name, v.version, v.source, s.follows_default, s.task
         FROM scripts s
         JOIN script_versions v ON v.script_id = s.id AND v.version = s.active_version
         WHERE s.id = ?1",
        [script_id],
        |r| {
            let task: Option<String> = r.get(5)?;
            Ok(RunnableScript {
                user_id: r.get(0)?,
                name: r.get(1)?,
                version: r.get(2)?,
                source: r.get(3)?,
                follows_default: r.get(4)?,
                task: task_of(task.as_deref()),
            })
        },
    )
    .optional()
}

/// The source of the script's active version, or none if it has none (or is gone).
pub fn active_source(conn: &Connection, script_id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT v.source FROM scripts s
         JOIN script_versions v ON v.script_id = s.id AND v.version = s.active_version
         WHERE s.id = ?1",
        [script_id],
        |r| r.get(0),
    )
    .optional()
}

/// The script library's invariants (ADR 0004): every active version exists and has no syntax
/// errors; no version is numbered above its script's latest version, so new saves never reuse a
/// number; every default script is for a task, and one its Player hasn't edited runs the game's
/// current default (checked after [`sync_default_scripts`]).
pub fn check_script_library(
    conn: &Connection,
    defaults: &Defaults,
) -> rusqlite::Result<Vec<InvariantViolation>> {
    let violation = |invariant: &str, message: String, id: i64| InvariantViolation {
        invariant: invariant.into(),
        message,
        entity_ids: vec![format!("script-{id}")],
    };
    let mut out = Vec::new();
    let active: Vec<(i64, i64, Option<String>)> = conn
        .prepare(
            "SELECT s.id, s.active_version, v.source FROM scripts s
             LEFT JOIN script_versions v ON v.script_id = s.id AND v.version = s.active_version
             WHERE s.active_version IS NOT NULL",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (id, version, source) in active {
        match source {
            None => out.push(violation(
                "active-scripts-valid",
                format!("script {id} has missing active version {version}"),
                id,
            )),
            Some(source) if !check_script(&source).is_empty() => out.push(violation(
                "active-scripts-valid",
                format!("script {id} has syntax errors in its active version {version}"),
                id,
            )),
            Some(_) => {}
        }
    }
    let ahead: Vec<(i64, i64)> = conn
        .prepare(
            "SELECT DISTINCT s.id, s.latest_version FROM scripts s
             JOIN script_versions v ON v.script_id = s.id
             WHERE v.version > s.latest_version",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, latest) in ahead {
        out.push(violation(
            "script-versions-counted",
            format!("script {id} has a version above its latest version {latest}"),
            id,
        ));
    }
    let tasked: Vec<(i64, String, bool, Option<i64>)> = conn
        .prepare(
            "SELECT id, task, follows_default, active_version FROM scripts WHERE task IS NOT NULL",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    for (id, task, follows, active_version) in tasked {
        let fail = |message: String| {
            violation("default-scripts-follow", format!("default script {id} {message}"), id)
        };
        match task_of(Some(&task)) {
            None => out.push(fail(format!("is for no task: {task}"))),
            Some(t) => {
                // A task the given defaults leave out (a test's) is not checked.
                let Some(d) = default_of(defaults, t) else { continue };
                if follows
                    && source_of(conn, id, active_version)?.as_deref() != Some(d.source.as_str())
                {
                    out.push(fail(format!(
                        "follows the game's default of {task} but doesn't run it"
                    )));
                }
            }
        }
    }
    Ok(out)
}
