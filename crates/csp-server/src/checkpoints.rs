//! Checkpoints (`CONTEXT.md`: Creative mode, ADR 0043): named copies of the world an admin saves
//! and restores from the Creative bar while a creative server runs. They are saves kept beside
//! the world, not part of it: rows in `checkpoints`, in the same snapshot format as the world's
//! saves (`saves.rs`, gzipped JSON tagged with its world format), so a checkpoint from an older
//! format is migrated when it is restored. Accounts live apart from the world and are never
//! touched.

use csp_shared::{
    terrain::TerrainMap,
    world::{WorldState, WORLD_FORMAT_VERSION},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::{
    saves::{gunzip, gzip, SavesError},
    world_format::{migrate_world, MigrationContext, WorldFormatError},
};

/// The longest checkpoint name, in characters.
pub const CHECKPOINT_NAME_MAX: usize = 60;

/// A checkpoint as the Creative bar lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: u64,
    pub name: String,
    /// The world's tick when it was saved: the bar shows it as game time.
    pub tick: u64,
    /// When it was saved, in Unix seconds.
    pub created_at: i64,
}

/// A checkpoint to save, asked for by the Creative bar.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSaveRequest {
    pub name: String,
}

impl CheckpointSaveRequest {
    /// The name, trimmed, or `None` if it is empty or longer than [`CHECKPOINT_NAME_MAX`].
    pub fn name(&self) -> Option<&str> {
        let name = self.name.trim();
        (!name.is_empty() && name.chars().count() <= CHECKPOINT_NAME_MAX).then_some(name)
    }
}

/// Why a checkpoint cannot be restored.
#[derive(Debug, thiserror::Error)]
pub enum CheckpointError {
    #[error("no such checkpoint")]
    NotFound,
    /// Saved from a world on other land (a `reset-world` since): it does not fit this terrain.
    #[error("the checkpoint is of world seed {saved}, this world is seed {world}")]
    OtherWorld { saved: i64, world: i64 },
    #[error(transparent)]
    Format(#[from] WorldFormatError),
    #[error(transparent)]
    Saves(#[from] SavesError),
}

impl From<rusqlite::Error> for CheckpointError {
    fn from(e: rusqlite::Error) -> Self {
        CheckpointError::Saves(e.into())
    }
}

impl From<serde_json::Error> for CheckpointError {
    fn from(e: serde_json::Error) -> Self {
        CheckpointError::Saves(e.into())
    }
}

/// Saves `world` (its JSON, as the saves write it) as the checkpoint `name`, at `tick`. A
/// checkpoint of the same name is replaced. Returns the checkpoint.
pub fn save_checkpoint(
    conn: &Connection,
    name: &str,
    tick: u64,
    world_json: &[u8],
) -> Result<Checkpoint, SavesError> {
    let data = gzip(world_json)?;
    conn.execute("DELETE FROM checkpoints WHERE name = ?1", params![name])?;
    conn.execute(
        "INSERT INTO checkpoints (name, tick, version, data) VALUES (?1, ?2, ?3, ?4)",
        params![name, tick as i64, WORLD_FORMAT_VERSION, data],
    )?;
    let id = conn.last_insert_rowid();
    Ok(conn.query_row(
        "SELECT id, name, tick, created_at FROM checkpoints WHERE id = ?1",
        params![id],
        checkpoint_row,
    )?)
}

fn checkpoint_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Checkpoint> {
    Ok(Checkpoint {
        id: r.get::<_, i64>(0)? as u64,
        name: r.get(1)?,
        tick: r.get::<_, i64>(2)? as u64,
        created_at: r.get(3)?,
    })
}

/// Every checkpoint, the newest first.
pub fn list_checkpoints(conn: &Connection) -> rusqlite::Result<Vec<Checkpoint>> {
    let mut stmt =
        conn.prepare("SELECT id, name, tick, created_at FROM checkpoints ORDER BY id DESC")?;
    let rows = stmt.query_map([], checkpoint_row)?;
    rows.collect()
}

/// Deletes checkpoint `id`; false if there was none.
pub fn delete_checkpoint(conn: &Connection, id: u64) -> rusqlite::Result<bool> {
    Ok(conn.execute("DELETE FROM checkpoints WHERE id = ?1", params![id as i64])? > 0)
}

/// Checkpoint `id` as a world of the current format, for the world of seed `seed` on `terrain`:
/// migrated if it was saved in an older format, refused if it is of another world.
pub fn load_checkpoint(
    conn: &Connection,
    id: u64,
    terrain: &TerrainMap,
    seed: i64,
) -> Result<WorldState, CheckpointError> {
    load_checkpoint_with(conn, id, seed, |state, version| {
        migrate_world(state, version, &MigrationContext { terrain })
    })
}

/// [`load_checkpoint`] with the migration `migrate` brings, for tests of a format change.
pub fn load_checkpoint_with(
    conn: &Connection,
    id: u64,
    seed: i64,
    migrate: impl FnOnce(Value, u32) -> Result<Value, WorldFormatError>,
) -> Result<WorldState, CheckpointError> {
    let row: Option<(Vec<u8>, u32)> = conn
        .query_row("SELECT data, version FROM checkpoints WHERE id = ?1", params![id as i64], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let (data, version) = row.ok_or(CheckpointError::NotFound)?;
    let state: Value = serde_json::from_slice(&gunzip(&data).map_err(SavesError::from)?)?;
    // Every world format so far carries the seed at the top level.
    let saved = state.get("seed").and_then(Value::as_i64).ok_or(SavesError::NoSeed)?;
    if saved != seed {
        return Err(CheckpointError::OtherWorld { saved, world: seed });
    }
    Ok(serde_json::from_value(migrate(state, version)?)?)
}
