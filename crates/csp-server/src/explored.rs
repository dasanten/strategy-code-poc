//! Explored terrain in the database (`ExploredTerrain.load` and `save` of
//! `apps/server/src/explored.ts`): one row per Player in `explored`, the bitmap as the blob, in the
//! TypeScript's bit layout, so either server reads what the other wrote. The in-memory half is
//! `csp_sim::explored`.

use csp_shared::{terrain::TerrainMap, world::ResourceNode};
use csp_sim::explored::ExploredTerrain;
use rusqlite::{params, Connection};

/// Loads every Player's explored terrain from the database.
pub fn load_explored(
    conn: &Connection,
    terrain: TerrainMap,
    nodes: &[ResourceNode],
) -> rusqlite::Result<ExploredTerrain> {
    let mut stmt = conn.prepare("SELECT user_id, data FROM explored")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, Vec<u8>>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ExploredTerrain::from_bitmaps(terrain, nodes, rows))
}

/// Writes the Players whose explored terrain changed since the last save, stamped `now_ms`
/// (milliseconds, stored as whole seconds like Drizzle's `timestamp` columns), in one
/// transaction. Returns how many rows were written.
pub fn save_explored(
    conn: &Connection,
    explored: &mut ExploredTerrain,
    now_ms: i64,
) -> rusqlite::Result<usize> {
    let dirty = explored.take_dirty();
    if dirty.is_empty() {
        return Ok(0);
    }
    let now = now_ms.div_euclid(1000);
    let tx = conn.unchecked_transaction()?;
    {
        let mut upsert = tx.prepare_cached(
            "INSERT INTO explored (user_id, data, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = ?3",
        )?;
        for &user_id in &dirty {
            if let Some(bits) = explored.bitmap(user_id) {
                upsert.execute(params![user_id as i64, bits, now])?;
            }
        }
    }
    tx.commit()?;
    Ok(dirty.len())
}
