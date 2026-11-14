//! World saves (`apps/server/src/saves.ts` and `terrain.ts`, ADR 0006): rolling gzipped-JSON rows
//! in `world_saves`, tagged with the world format they were written in, pruned to the newest few
//! and one an hour for a week; the terrain stored once beside them. The same rows the TypeScript
//! server writes and reads.

use std::{
    io::{Read, Write},
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};

use csp_shared::{
    terrain::TerrainMap,
    world::{WorldState, WORLD_FORMAT_VERSION},
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::world_format::{
    before_the_reset, migrate_world, MigrationContext, WorldFormatError, RESET_FORMAT_VERSION,
};

/// How many of the newest saves are always kept.
pub const KEEP_LATEST: i64 = 20;
/// Beyond those, one save per real hour is kept for this long.
pub const KEEP_HOURLY_FOR_S: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, thiserror::Error)]
pub enum SavesError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Format(#[from] WorldFormatError),
    /// The stored terrain and the save do not belong together.
    #[error("stored terrain is from seed {stored}, the world is seed {world}")]
    SeedMismatch { stored: i64, world: i64 },
    #[error("the saved world has no seed")]
    NoSeed,
}

/// gzip at Node's default level, as `zlib.gzip`.
pub fn gzip(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut enc = GzEncoder::new(Vec::with_capacity(data.len() / 8), Compression::default());
    enc.write_all(data)?;
    enc.finish()
}

pub fn gunzip(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    GzDecoder::new(data).read_to_end(&mut out)?;
    Ok(out)
}

/// Saves the world synchronously, as `saveWorld`.
pub fn save_world(conn: &Connection, world: &WorldState) -> Result<(), SavesError> {
    insert_save(conn, world.tick, &gzip(&serde_json::to_vec(world)?)?)?;
    Ok(())
}

fn insert_save(conn: &Connection, tick: u64, data: &[u8]) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO world_saves (tick, version, data) VALUES (?1, ?2, ?3)",
        params![tick as i64, WORLD_FORMAT_VERSION, data],
    )?;
    Ok(())
}

/// Where [`WorldSaver`] says what became of a save.
pub trait SaveLog {
    /// The save of `tick` was skipped: the one of `saving_tick` is still being written.
    fn skipped(&self, tick: u64, saving_tick: u64);
    fn failed(&self, tick: u64, error: &SavesError);
}

struct InFlight {
    tick: u64,
    gzipped: JoinHandle<std::io::Result<Vec<u8>>>,
}

/// The loop's saves (ADR 0006), off the tick: the world is turned into JSON on the loop, since
/// that needs the live world, then gzipped on another thread, and once that is done the row is
/// written on the loop, tagged with the tick it was taken at, and old saves are pruned. At most one
/// save is in flight; a save asked for while one is still running is skipped and logged.
///
/// The loop calls [`WorldSaver::poll`] every tick to write a finished save: the connection stays
/// on the loop, as the TypeScript wrote the row on its event loop once gzip was done.
/// [`WorldSaver::save_now`] is the shutdown's synchronous save.
pub struct WorldSaver<L: SaveLog> {
    log: L,
    saving: Option<InFlight>,
    closed: bool,
}

impl<L: SaveLog> WorldSaver<L> {
    pub fn new(log: L) -> Self {
        Self { log, saving: None, closed: false }
    }

    pub fn log(&self) -> &L {
        &self.log
    }

    /// Starts a save of the world as it is now; false if it was skipped.
    pub fn start(&mut self, world: &WorldState) -> bool {
        if self.closed {
            return false;
        }
        if let Some(saving) = &self.saving {
            self.log.skipped(world.tick, saving.tick);
            return false;
        }
        let tick = world.tick;
        let json = match serde_json::to_vec(world) {
            Ok(json) => json,
            Err(e) => {
                self.log.failed(tick, &e.into());
                return false;
            }
        };
        let gzipped = std::thread::spawn(move || gzip(&json));
        self.saving = Some(InFlight { tick, gzipped });
        true
    }

    /// Whether a save is in flight.
    pub fn in_flight(&self) -> bool {
        self.saving.is_some()
    }

    /// Writes the save in flight if its gzip is done; never waits.
    pub fn poll(&mut self, conn: &Connection) {
        if self.saving.as_ref().is_some_and(|s| s.gzipped.is_finished()) {
            self.land(conn);
        }
    }

    /// Waits for the save in flight, if any, and writes it.
    pub fn settled(&mut self, conn: &Connection) {
        if self.saving.is_some() {
            self.land(conn);
        }
    }

    fn land(&mut self, conn: &Connection) {
        let Some(InFlight { tick, gzipped }) = self.saving.take() else {
            return;
        };
        let result = match gzipped.join() {
            Ok(r) => r.map_err(SavesError::from),
            Err(_) => Err(SavesError::Io(std::io::Error::other("the gzip thread panicked"))),
        };
        // Shutdown has saved synchronously since; this older save must not land after it.
        if self.closed {
            return;
        }
        let written = result.and_then(|data| {
            insert_save(conn, tick, &data)?;
            prune_saves(conn, now_s())?;
            Ok(())
        });
        if let Err(e) = written {
            self.log.failed(tick, &e);
        }
    }

    /// Saves the world synchronously and drops any save still in flight; for shutdown.
    pub fn save_now(&mut self, conn: &Connection, world: &WorldState) -> Result<(), SavesError> {
        self.closed = true;
        self.saving = None;
        save_world(conn, world)
    }
}

fn now_s() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// The newest save as written: its parsed JSON and the format it was written in.
pub fn latest_save(conn: &Connection) -> Result<Option<(Value, u32)>, SavesError> {
    let row: Option<(Vec<u8>, u32)> = conn
        .query_row("SELECT data, version FROM world_saves ORDER BY id DESC LIMIT 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((data, version)) = row else {
        return Ok(None);
    };
    Ok(Some((serde_json::from_slice(&gunzip(&data)?)?, version)))
}

/// The terrain stored for this world and the seed it came from; `None` before it is created.
pub fn load_terrain(conn: &Connection) -> rusqlite::Result<Option<(i64, TerrainMap)>> {
    conn.query_row("SELECT seed, diameter, data FROM terrain LIMIT 1", [], |r| {
        Ok((r.get(0)?, TerrainMap { size: r.get(1)?, tiles: r.get(2)? }))
    })
    .optional()
}

/// Stores the world's terrain. Happens once, when the world is created (ADR 0006).
pub fn save_terrain(conn: &Connection, seed: i64, map: &TerrainMap) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO terrain (id, seed, diameter, data) VALUES (1, ?1, ?2, ?3)",
        params![seed, map.size, map.tiles],
    )?;
    Ok(())
}

/// The world's terrain: loaded if stored, otherwise generated from `seed` and stored. A stored
/// terrain from another seed means the database and the saves don't belong together.
pub fn terrain_for_world(
    conn: &Connection,
    seed: i64,
    generate: impl FnOnce(i64) -> TerrainMap,
) -> Result<TerrainMap, SavesError> {
    if let Some((stored, map)) = load_terrain(conn)? {
        if stored != seed {
            return Err(SavesError::SeedMismatch { stored, world: seed });
        }
        return Ok(map);
    }
    let map = generate(seed);
    save_terrain(conn, seed, &map)?;
    Ok(map)
}

/// The world and its terrain, as the server starts with them: the newest save migrated to the
/// current format, or a fresh world from `generate_world` (`generateWorld`, a rule the caller
/// brings). Terrain is loaded, or generated by `generate_terrain` from the world's seed and stored
/// the first time (ADR 0006).
pub fn load_or_create_world(
    conn: &Connection,
    generate_terrain: impl FnOnce(i64) -> TerrainMap,
    generate_world: impl FnOnce(&TerrainMap, i64) -> WorldState,
    new_seed: i64,
) -> Result<(WorldState, TerrainMap), SavesError> {
    let save = latest_save(conn)?;
    if let Some((_, version)) = save.as_ref().filter(|(_, v)| *v < RESET_FORMAT_VERSION) {
        // The world from before the new one (ADR 0035): refused before any terrain is touched.
        return Err(WorldFormatError(before_the_reset(*version)).into());
    }
    // Every save format so far carries the seed at the top level.
    let seed = match &save {
        Some((state, _)) => state.get("seed").and_then(Value::as_i64).ok_or(SavesError::NoSeed)?,
        None => load_terrain(conn)?.map_or(new_seed, |(seed, _)| seed),
    };
    let terrain = terrain_for_world(conn, seed, generate_terrain)?;
    let world = match save {
        Some((state, version)) => {
            let migrated = migrate_world(state, version, &MigrationContext { terrain: &terrain })?;
            serde_json::from_value(migrated)?
        }
        None => generate_world(&terrain, seed),
    };
    Ok((world, terrain))
}

/// Deletes old saves (ADR 0006): keeps the newest [`KEEP_LATEST`], plus the newest save of every
/// hour for the last week.
pub fn prune_saves(conn: &Connection, now_s: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM world_saves
         WHERE id NOT IN (SELECT id FROM world_saves ORDER BY id DESC LIMIT ?1)
           AND id NOT IN (
             SELECT max(id) FROM world_saves
             WHERE created_at > ?2
             GROUP BY created_at / 3600
           )",
        params![KEEP_LATEST, now_s - KEEP_HOURLY_FOR_S],
    )
}
