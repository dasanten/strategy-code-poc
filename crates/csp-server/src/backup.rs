//! Backups (`backup.ts`, ADR 0007): SQLite's online backup into a dated file, 14 days kept.
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{backup::Backup, Connection};

use crate::db::DbError;

pub const KEEP_BACKUPS_DAYS: u64 = 14;

#[derive(Clone, Copy, Debug)]
pub enum Reason {
    Start,
    Daily,
}

impl Reason {
    fn as_str(self) -> &'static str {
        match self {
            Reason::Start => "start",
            Reason::Daily => "daily",
        }
    }
}

/// `Date.toISOString()` with `:` and `.` replaced by `-`: `2026-11-08T12-00-00-000Z`.
pub fn stamp(now: SystemTime) -> String {
    let ms = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis()) as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Days since the epoch to a civil date (Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}-{:02}-{:02}-{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Writes a consistent copy of the live database into `dir` (safe while the world runs) and
/// deletes backups older than 14 days.
pub fn backup_db(
    conn: &Connection,
    dir: &Path,
    reason: Reason,
    now: SystemTime,
) -> Result<PathBuf, DbError> {
    fs::create_dir_all(dir)?;
    let file = dir.join(format!("world-{}-{}.db", stamp(now), reason.as_str()));
    let mut dest = Connection::open(&file)?;
    {
        let backup = Backup::new(conn, &mut dest)?;
        backup.run_to_completion(1000, Duration::from_millis(5), None)?;
    }
    drop(dest);
    prune_backups(dir, now)?;
    Ok(file)
}

pub fn prune_backups(dir: &Path, now: SystemTime) -> Result<(), DbError> {
    let keep = Duration::from_secs(KEEP_BACKUPS_DAYS * 86_400);
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with("world-") && name.ends_with(".db")) {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        if now.duration_since(modified).is_ok_and(|age| age > keep) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}
