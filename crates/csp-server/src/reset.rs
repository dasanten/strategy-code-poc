//! The reset (ADR 0035, `csp-admin reset-world`): the world is generated again, once, with nothing
//! carried over. What belongs to the Player stays: accounts with their passwords and logins, admin
//! rights, invite codes and script libraries with every version. Everything in the world goes: the
//! saves (the map's realms, cities, residents, horses, goods, standing, contracts, alliances,
//! demands, Last seen and realm logs all live in them), the stored terrain and every Player's
//! explored terrain. The Horse offer is kept in the world, so it goes with it; the First day card
//! is kept on the account, so it is cleared there. The new seed's terrain is stored, so the next
//! start generates the new world on it and each Player founds a realm on their next login.

use std::{path::Path, time::SystemTime};

use csp_shared::terrain::TerrainMap;
use rusqlite::Connection;

use crate::{
    backup::{backup_db, Reason},
    saves::{load_terrain, save_terrain},
};

/// What `reset-world` says, and all it does, without `--yes`.
pub const RESET_WARNING: &str = "Nothing changed. Stop the server first: a running one writes \
its world back at its next save. Add --yes to reset.";

/// What the database holds that the reset removes or keeps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holdings {
    pub saves: i64,
    /// The seed of the stored terrain, if any.
    pub terrain_seed: Option<i64>,
    pub explored: i64,
    /// Players whose First day card has a line ticked or was dismissed.
    pub first_day_used: i64,
    pub accounts: i64,
    pub admins: i64,
    pub invite_codes: i64,
    pub unused_invite_codes: i64,
    pub scripts: i64,
    pub script_versions: i64,
}

fn count(conn: &Connection, sql: &str) -> rusqlite::Result<i64> {
    conn.query_row(sql, [], |r| r.get(0))
}

/// What the database holds now.
pub fn holdings(conn: &Connection) -> rusqlite::Result<Holdings> {
    Ok(Holdings {
        saves: count(conn, "SELECT count(*) FROM world_saves")?,
        terrain_seed: load_terrain(conn)?.map(|(seed, _)| seed),
        explored: count(conn, "SELECT count(*) FROM explored")?,
        first_day_used: count(
            conn,
            "SELECT count(*) FROM users WHERE first_day_done != '' OR first_day_dismissed",
        )?,
        accounts: count(conn, "SELECT count(*) FROM users")?,
        admins: count(conn, "SELECT count(*) FROM users WHERE is_admin")?,
        invite_codes: count(conn, "SELECT count(*) FROM invite_codes")?,
        unused_invite_codes: count(
            conn,
            "SELECT count(*) FROM invite_codes WHERE used_by IS NULL",
        )?,
        scripts: count(conn, "SELECT count(*) FROM scripts")?,
        script_versions: count(conn, "SELECT count(*) FROM script_versions")?,
    })
}

/// The list `reset-world` prints before it does anything.
pub fn describe(h: &Holdings, seed: i64) -> String {
    let terrain = match h.terrain_seed {
        Some(old) => format!("the stored terrain (seed {old})"),
        None => "no stored terrain".to_owned(),
    };
    format!(
        "Removes: {} world saves, {terrain}, explored terrain of {} Players, the First day state \
         of {} Players (the card and the Horse offer show again).\n\
         Keeps: {} accounts ({} admins) with their passwords and logins, {} invite codes ({} \
         unused), {} scripts with {} versions.\n\
         New world: seed {seed}; its terrain is stored now and the server generates the world at \
         its next start.",
        h.saves,
        h.explored,
        h.first_day_used,
        h.accounts,
        h.admins,
        h.invite_codes,
        h.unused_invite_codes,
        h.scripts,
        h.script_versions,
    )
}

/// A seed for the new world: random, never the old one. Seeds stay within what JavaScript
/// numbers and the terrain's `f64` hold exactly.
pub fn new_seed(old: Option<i64>) -> i64 {
    loop {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).expect("the operating system's random source");
        let seed = i64::from(u32::from_le_bytes(bytes) >> 1).max(1);
        if Some(seed) != old {
            return seed;
        }
    }
}

/// `csp-admin reset-world [--seed <n>] [--yes]`. Without `yes` it lists what it would remove and
/// keep and changes nothing (an `Err`, so the command exits 1). With `yes` it backs the database
/// up into `backup_dir` (a `-reset` file, never pruned), generates the new seed's terrain with
/// `generate_terrain`, and then, in one transaction, removes the world and stores that terrain.
pub fn reset_world(
    conn: &Connection,
    seed: Option<i64>,
    yes: bool,
    backup_dir: &Path,
    now: SystemTime,
    generate_terrain: impl FnOnce(i64) -> TerrainMap,
) -> Result<String, String> {
    let before = holdings(conn).map_err(|e| e.to_string())?;
    let seed = seed.unwrap_or_else(|| new_seed(before.terrain_seed));
    let listed = describe(&before, seed);
    if !yes {
        return Err(format!("{listed}\n{RESET_WARNING}"));
    }
    let backup = backup_db(conn, backup_dir, Reason::Reset, now).map_err(|e| e.to_string())?;
    let terrain = generate_terrain(seed);
    let wipe = || -> rusqlite::Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM world_saves", [])?;
        tx.execute("DELETE FROM terrain", [])?;
        tx.execute("DELETE FROM explored", [])?;
        tx.execute("UPDATE users SET first_day_done = '', first_day_dismissed = 0", [])?;
        save_terrain(&tx, seed, &terrain)?;
        tx.commit()
    };
    wipe().map_err(|e| format!("{e}: nothing changed (the backup is {})", backup.display()))?;
    // The saves were most of the file; a failure here leaves it as large, not wrong.
    let shrunk = match conn.execute_batch("VACUUM") {
        Ok(()) => String::new(),
        Err(e) => format!("\nThe file was not shrunk ({e})."),
    };
    Ok(format!(
        "{listed}\nBacked up to {}.{shrunk}\nDone: start the server to generate the new world.",
        backup.display()
    ))
}
