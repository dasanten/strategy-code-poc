//! SQLite with the tables and migration journal of the TypeScript server (`db/index.ts`, ADR 0006):
//! a database either server made opens in the other.
pub mod migrations;

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// The hook `open_db` gives an existing database file before migrating.
pub type BeforeMigrate<'a> = &'a mut dyn FnMut(&Connection) -> Result<(), DbError>;

/// Opens the database (`:memory:` allowed) with the pragmas of `openDb`, hands an already existing
/// file to `before_migrate` (the backup hook, ADR 0007), then applies the migrations the journal
/// table does not have yet.
pub fn open_db(
    path: impl AsRef<Path>,
    before_migrate: Option<BeforeMigrate<'_>>,
) -> Result<Connection, DbError> {
    let path = path.as_ref();
    let in_memory = path.as_os_str() == ":memory:";
    if !in_memory {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
    }
    let existed = !in_memory && path.exists();
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Admin commands write while the server runs; wait for the other writer instead of failing.
    conn.pragma_update(None, "busy_timeout", 5000)?;
    if existed {
        if let Some(hook) = before_migrate {
            hook(&conn)?;
        }
    }
    migrate(&mut conn)?;
    Ok(conn)
}

/// Drizzle's rule (`SQLiteSyncDialect.migrate`): run every migration whose `when` is later than
/// the newest `created_at` in `__drizzle_migrations`, in one transaction, recording hash and `when`.
pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS \"__drizzle_migrations\" (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			)",
    )?;
    let last: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM \"__drizzle_migrations\" ORDER BY created_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let tx = conn.transaction()?;
    for m in migrations::all() {
        if last.is_none_or(|l| l < m.created_at) {
            for stmt in &m.statements {
                tx.execute_batch(stmt)?;
            }
            tx.execute(
                "INSERT INTO \"__drizzle_migrations\" (\"hash\", \"created_at\") VALUES (?1, ?2)",
                (&m.hash, m.created_at),
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}
