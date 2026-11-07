//! `open_db` against a database the TypeScript server's code made (`tests/data/make-ts-db.mjs`),
//! and the ports of `backup.test.ts`'s cases.
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use csp_server::{
    backup::{backup_db, prune_backups, stamp, Reason},
    db::{migrations, open_db, DbError},
};
use rusqlite::Connection;

fn fixture(dir: &Path) -> PathBuf {
    let copy = dir.join("world.db");
    fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/ts-made.db"), &copy).unwrap();
    copy
}

fn schema(conn: &Connection) -> Vec<(String, String, String)> {
    let mut stmt = conn
        .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn journal(conn: &Connection) -> Vec<(i64, String, i64)> {
    let mut stmt = conn
        .prepare("SELECT rowid, hash, created_at FROM __drizzle_migrations ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn opens_a_typescript_database_and_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path());
    let before = journal(&Connection::open(&path).unwrap());
    assert_eq!(before.len(), migrations::all().len());

    let conn = open_db(&path, None).unwrap();
    assert_eq!(journal(&conn), before);

    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(count("SELECT count(*) FROM users WHERE name = 'Mara' AND is_admin = 1"), 1);
    assert_eq!(count("SELECT count(*) FROM sessions WHERE token_hash = 'tok'"), 1);
    assert_eq!(count("SELECT count(*) FROM invite_codes WHERE code = 'CODE1'"), 1);
    assert_eq!(count("SELECT count(*) FROM scripts WHERE name = 'farm'"), 1);
    assert_eq!(count("SELECT count(*) FROM script_versions WHERE source = 'harvest()'"), 1);
    assert_eq!(count("SELECT diameter FROM terrain WHERE seed = 7"), 2);
    assert_eq!(count("SELECT length(data) FROM explored WHERE user_id = 1"), 1);
    assert_eq!(count("SELECT tick FROM world_saves"), 30);
}

#[test]
fn sets_the_pragmas_of_the_typescript_server() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_db(dir.path().join("sub/world.db"), None).unwrap();
    let pragma = |name: &str| -> rusqlite::types::Value {
        conn.query_row(&format!("PRAGMA {name}"), [], |r| r.get(0)).unwrap()
    };
    assert_eq!(pragma("journal_mode"), "wal".to_string().into());
    assert_eq!(pragma("foreign_keys"), 1.into());
    assert_eq!(pragma("busy_timeout"), 5000.into());
}

#[test]
fn an_empty_file_gets_the_typescript_schema_and_journal() {
    let dir = tempfile::tempdir().unwrap();
    let ts = fixture(dir.path());
    let fresh = open_db(dir.path().join("fresh.db"), None).unwrap();
    let ts = Connection::open(ts).unwrap();
    assert_eq!(schema(&fresh), schema(&ts));
    // Same hashes and timestamps, so the TypeScript migrator sees nothing to run.
    let strip_id =
        |j: Vec<(i64, String, i64)>| j.into_iter().map(|(_, h, c)| (h, c)).collect::<Vec<_>>();
    assert_eq!(strip_id(journal(&fresh)), strip_id(journal(&ts)));
}

#[test]
fn a_database_behind_the_journal_gets_only_the_newer_migrations() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path());
    {
        // As if the TypeScript server stopped at migration 0007: undo 0008 and its journal row.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE users DROP COLUMN first_day_done;
             ALTER TABLE users DROP COLUMN first_day_dismissed;
             DELETE FROM __drizzle_migrations WHERE rowid = (SELECT max(rowid) FROM __drizzle_migrations);",
        )
        .unwrap();
    }
    let conn = open_db(&path, None).unwrap();
    assert_eq!(journal(&conn).len(), migrations::all().len());
    // 0008 marks every existing player's first day as dismissed.
    let dismissed: i64 = conn
        .query_row("SELECT first_day_dismissed FROM users WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(dismissed, 1);
}

#[test]
fn the_hook_runs_only_for_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let calls = std::cell::Cell::new(0);
    let mut hook = |_: &Connection| -> Result<(), DbError> {
        calls.set(calls.get() + 1);
        Ok(())
    };
    open_db(dir.path().join("a.db"), Some(&mut hook)).unwrap();
    assert_eq!(calls.get(), 0);
    open_db(dir.path().join("a.db"), Some(&mut hook)).unwrap();
    assert_eq!(calls.get(), 1);
}

#[test]
fn backs_up_before_migrating_and_prunes_old_backups() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path());
    let backups = dir.path().join("backups");

    let mut backup_file = None;
    let mut hook = |c: &Connection| -> Result<(), DbError> {
        backup_file = Some(backup_db(c, &backups, Reason::Start, SystemTime::now())?);
        Ok(())
    };
    open_db(&path, Some(&mut hook)).unwrap();
    let backup_file = backup_file.unwrap();
    assert!(backup_file.exists());
    assert!(backup_file.file_name().unwrap().to_str().unwrap().ends_with("-start.db"));

    let restored = open_db(&backup_file, None).unwrap();
    let seed: i64 = restored.query_row("SELECT seed FROM terrain", [], |r| r.get(0)).unwrap();
    assert_eq!(seed, 7);
    drop(restored);

    let old = backups.join("world-old-daily.db");
    fs::write(&old, "").unwrap();
    let file = fs::File::options().write(true).open(&old).unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(15 * 86_400)).unwrap();
    drop(file);
    prune_backups(&backups, SystemTime::now()).unwrap();
    assert!(!old.exists());
    assert!(backup_file.exists());
}

#[test]
fn backup_names_match_the_typescript_ones() {
    // new Date(Date.UTC(2026, 10, 8, 9, 5, 7, 42)).toISOString() with : and . replaced by -
    let t = UNIX_EPOCH + Duration::from_millis(1_794_128_707_042);
    assert_eq!(stamp(t), "2026-11-08T09-05-07-042Z");
    let dir = tempfile::tempdir().unwrap();
    let conn = open_db(":memory:", None).unwrap();
    let file = backup_db(&conn, dir.path(), Reason::Daily, t).unwrap();
    assert_eq!(
        file.file_name().unwrap().to_str().unwrap(),
        "world-2026-11-08T09-05-07-042Z-daily.db"
    );
}
