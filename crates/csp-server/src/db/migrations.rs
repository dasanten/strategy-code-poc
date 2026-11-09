//! The migrations, in Drizzle's format: the TypeScript server's SQL files (copied into
//! `migrations/`, because the TypeScript is frozen and the Rust server must outlive its folder)
//! plus later Rust ones, listed in the same `meta/_journal.json` (see `build.rs`).
use sha2::{Digest, Sha256};

include!(concat!(env!("OUT_DIR"), "/migrations.rs"));

pub const STATEMENT_BREAKPOINT: &str = "--> statement-breakpoint";

pub struct Migration {
    pub tag: &'static str,
    /// Drizzle's `folderMillis`: the journal's `when`, stored as `created_at`.
    pub created_at: i64,
    /// Hex SHA-256 of the whole file, as Drizzle stores it.
    pub hash: String,
    pub statements: Vec<&'static str>,
}

pub fn all() -> Vec<Migration> {
    EMBEDDED
        .iter()
        .map(|&(tag, created_at, sql)| Migration {
            tag,
            created_at,
            hash: Sha256::digest(sql.as_bytes()).iter().map(|b| format!("{b:02x}")).collect(),
            statements: sql.split(STATEMENT_BREAKPOINT).collect(),
        })
        .collect()
}
