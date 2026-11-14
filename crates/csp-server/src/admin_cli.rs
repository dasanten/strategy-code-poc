//! What the `admin` binary does (`apps/server/src/cli/admin.ts`), apart from its terminal, so it is
//! testable.
use std::{path::PathBuf, time::SystemTime};

use csp_sim::terrain_gen::generate_full_terrain;

use rusqlite::Connection;

use crate::auth::{create_admin, create_invite_code, AuthFailure};
use crate::map_tools::{describe_map_stats, explore, map_stats, Reach};
use crate::reset::reset_world;

pub const USAGE: &str = "usage: admin create <name> | admin invite \
                         | admin explore <player> (--radius <tiles> | --all) [--yes] \
                         | admin map-stats \r
                         | admin reset-world [--seed <n>] [--yes]";

/// The database the server uses (`config.dbPath`, `.env` included): `DB_PATH`, or
/// `data/world.db` from where it runs.
pub fn db_path() -> PathBuf {
    crate::config::Config::from_env().map(|c| c.db_path).unwrap_or_else(|_| {
        std::env::var_os("DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("data/world.db"))
    })
}

/// Where `reset-world` writes its backup: `BACKUP_DIR` as the server uses it, or `backups/` next
/// to the database when that is unset (dev).
pub fn backup_dir() -> PathBuf {
    crate::config::Config::from_env().ok().and_then(|c| c.backup_dir).unwrap_or_else(|| {
        db_path().parent().map_or_else(|| PathBuf::from("backups"), |p| p.join("backups"))
    })
}

/// Runs one admin command; `Ok` is what to print, `Err` the message for stderr (exit code 1).
/// The password for `create` is `env_password`, or asked for with `ask`.
pub fn run(
    conn: &Connection,
    args: &[String],
    env_password: Option<String>,
    ask: impl FnOnce(&str) -> std::io::Result<String>,
) -> Result<String, String> {
    match args {
        [command, name, ..] if command == "create" => {
            let password = match env_password {
                Some(p) => p,
                None => ask(&format!("Password for {name}: ")).map_err(|e| e.to_string())?,
            };
            create_admin(conn, Some(name), Some(&password)).map_err(message)?;
            Ok(format!("{name} is an admin."))
        }
        [command, ..] if command == "invite" => {
            create_invite_code(conn, None).map_err(|e| e.to_string())
        }
        [command, player, rest @ ..] if command == "explore" => {
            let yes = rest.iter().any(|a| a == "--yes");
            let reach = match rest.iter().position(|a| a == "--radius") {
                Some(i) => Reach::Radius(
                    rest.get(i + 1)
                        .and_then(|r| r.parse().ok())
                        .filter(|r| *r >= 0)
                        .ok_or_else(|| USAGE.to_owned())?,
                ),
                None if rest.iter().any(|a| a == "--all") => Reach::All,
                None => return Err(USAGE.to_owned()),
            };
            explore(conn, player, reach, yes)
        }
        [command] if command == "map-stats" => Ok(describe_map_stats(&map_stats(conn)?)),
        [command, rest @ ..] if command == "reset-world" => {
            let yes = rest.iter().any(|a| a == "--yes");
            let seed = match rest.iter().position(|a| a == "--seed") {
                Some(i) => Some(
                    rest.get(i + 1)
                        .and_then(|s| s.parse::<i64>().ok())
                        .filter(|s| *s > 0)
                        .ok_or_else(|| USAGE.to_owned())?,
                ),
                None => None,
            };
            reset_world(conn, seed, yes, &backup_dir(), SystemTime::now(), generate_full_terrain)
        }
        _ => Err(USAGE.to_owned()),
    }
}

fn message(e: AuthFailure) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::{log_in, LoginBackoff},
        db::open_db,
    };

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn creates_an_admin_with_the_password_from_the_environment_or_asked() {
        let conn = open_db(":memory:", None).unwrap();
        let never = |_: &str| -> std::io::Result<String> { panic!("asked") };
        let out = run(&conn, &args(&["create", "Daniel"]), Some("admin password".into()), never);
        assert_eq!(out.unwrap(), "Daniel is an admin.");
        let user =
            log_in(&conn, &LoginBackoff::new(), Some("Daniel"), Some("admin password"), 0).unwrap();
        assert!(user.is_admin);

        let mut asked = String::new();
        let out = run(&conn, &args(&["create", "Mara"]), None, |q| {
            asked = q.to_owned();
            Ok("correct horse".into())
        });
        assert_eq!(out.unwrap(), "Mara is an admin.");
        assert_eq!(asked, "Password for Mara: ");

        let short = run(&conn, &args(&["create", "Tomas"]), Some("short".into()), never);
        assert_eq!(short.unwrap_err(), "Passwords need at least 10 characters.");
    }

    #[test]
    fn prints_an_invite_code_and_the_usage_otherwise() {
        let conn = open_db(":memory:", None).unwrap();
        let never = |_: &str| -> std::io::Result<String> { panic!("asked") };
        let code = run(&conn, &args(&["invite"]), None, never).unwrap();
        let stored: i64 = conn
            .query_row(
                "SELECT count(*) FROM invite_codes WHERE code = ?1 AND created_by IS NULL",
                [&code],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, 1);
        for a in [&[][..], &["create"], &["nonsense"]] {
            assert_eq!(run(&conn, &args(a), None, never).unwrap_err(), USAGE);
        }
    }
}
