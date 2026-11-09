//! The Rust half of the shadow run (T88.5; ADR 0030, "The cutover"). `scripts/shadow-run.mts`
//! starts the `shadow-step` binary on its copy of a save and steps it in lock-step with the
//! TypeScript server, one JSON command a line on stdin, one answer a line on stdout:
//!
//! - `{"cmd":"step","probe":false}` runs one tick as the server does ([`Game::tick`]) and answers
//!   `{"health":TickHealth|null,"notes":[…]}`, the notes being what the game logged at warn or
//!   above (slow ticks aside). With `"probe":true` the world is also kept as JSON at each
//!   [`ProbePoint`] of the tick.
//! - `{"cmd":"dump","path":p}` writes the world as JSON to `p`.
//! - `{"cmd":"phases","dir":d}` writes the last probed tick's worlds to `d/<point>.json` and answers
//!   `{"files":{point:path}}`.
//! - `{"cmd":"stop"}` waits for a save in flight and ends.
//!
//! The game is the server's own ([`Game`] with its scripts attached, on its database) with one
//! difference: path searches get no wall-clock budget ([`ServerWalking::budget_ms`]), so where a
//! walker is never depends on how fast each side happened to be.
//!
//! [`ServerWalking::budget_ms`]: crate::server::ServerWalking

use std::{
    cell::RefCell,
    fs::File,
    io::{BufRead, BufWriter, Write},
    path::{Path, PathBuf},
    rc::Rc,
    sync::{Arc, Mutex, PoisonError},
};

use csp_shared::balance::MAP_SIZE;
use csp_sim::{terrain_gen::generate_terrain, world::generate_world};
use rusqlite::Connection;
use serde_json::{json, Value};
use tracing::Level;

use crate::{
    db::open_db,
    explored::load_explored,
    monitoring::LogSink,
    saves::load_or_create_world,
    scripts::{game_defaults, sync_default_scripts},
    server::{Game, ProbePoint, ServerError, TickSettings},
};

/// What the game logged at warn or above since the last tick, as one line each.
#[derive(Clone, Default)]
pub struct NoteLog(Arc<Mutex<Vec<String>>>);

impl NoteLog {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

impl LogSink for NoteLog {
    fn log(&self, level: Level, fields: Value, message: &str) {
        // `ERROR` is the least verbose level; slow ticks show in the report's tick times instead.
        if level > Level::WARN || message.starts_with("slow tick") {
            return;
        }
        let err = fields.pointer("/err/message").and_then(Value::as_str);
        let line = match err {
            Some(err) => format!("{message}: {err}"),
            None => message.to_owned(),
        };
        self.0.lock().unwrap_or_else(PoisonError::into_inner).push(line);
    }
}

/// Opens the save at `db_path` as the server does at start (`open_world` without its backup),
/// with unhurried path searches.
pub fn open_shadow(
    db_path: &Path,
    log: NoteLog,
) -> Result<(Connection, Game<NoteLog>), ServerError> {
    let conn = open_db(db_path, None)?;
    let (world, terrain) =
        load_or_create_world(&conn, |seed| generate_terrain(seed, MAP_SIZE), generate_world, 1)?;
    let explored = load_explored(&conn, terrain.clone(), &world.nodes)?;
    sync_default_scripts(&conn, game_defaults())?;
    let mut game = Game::new(world, terrain, explored, log);
    game.walking.budget_ms = f64::INFINITY;
    game.attach_scripts(open_db(db_path, None)?);
    Ok((conn, game))
}

/// The worlds of a probed tick, as JSON, by probe point.
type Snapshots = Rc<RefCell<Option<Vec<(ProbePoint, String)>>>>;

/// Serves the commands on `input` until `stop` or the end of the input.
pub fn serve(
    db_path: &Path,
    settings: TickSettings,
    input: impl BufRead,
    mut output: impl Write,
) -> Result<(), ServerError> {
    let log = NoteLog::default();
    let (conn, mut game) = open_shadow(db_path, log.clone())?;
    let snapshots: Snapshots = Rc::default();
    let kept = Rc::clone(&snapshots);
    game.probe = Some(Box::new(move |point, world| {
        if let Some(list) = kept.borrow_mut().as_mut() {
            list.push((point, serde_json::to_string(world).unwrap_or_default()));
        }
    }));
    let mut last_probe: Vec<(ProbePoint, String)> = Vec::new();
    writeln!(
        output,
        "{}",
        json!({ "ready": true, "tick": game.world.tick, "seed": game.world.seed })
    )?;
    output.flush()?;
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let command: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                answer(&mut output, &json!({ "error": format!("not JSON: {e}") }))?;
                continue;
            }
        };
        let reply = match command["cmd"].as_str() {
            Some("step") => {
                let probe = command["probe"].as_bool().unwrap_or(false);
                *snapshots.borrow_mut() = probe.then(Vec::new);
                let health = game.tick(&conn, settings);
                if let Some(list) = snapshots.borrow_mut().take() {
                    last_probe = list;
                }
                json!({ "health": health, "notes": log.take() })
            }
            Some("dump") => match command["path"].as_str() {
                Some(path) => match write_json(Path::new(path), &game.world) {
                    Ok(()) => json!({ "ok": true }),
                    Err(e) => json!({ "error": e.to_string() }),
                },
                None => json!({ "error": "dump needs a path" }),
            },
            Some("phases") => match command["dir"].as_str() {
                Some(dir) => match write_phases(Path::new(dir), &last_probe) {
                    Ok(files) => json!({ "files": files }),
                    Err(e) => json!({ "error": e.to_string() }),
                },
                None => json!({ "error": "phases needs a dir" }),
            },
            Some("stop") => {
                game.saver.settled(&conn);
                answer(&mut output, &json!({ "ok": true }))?;
                return Ok(());
            }
            _ => json!({ "error": format!("unknown command: {line}") }),
        };
        answer(&mut output, &reply)?;
    }
    game.saver.settled(&conn);
    Ok(())
}

fn answer(output: &mut impl Write, reply: &Value) -> std::io::Result<()> {
    writeln!(output, "{reply}")?;
    output.flush()
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> std::io::Result<()> {
    let mut file = BufWriter::new(File::create(path)?);
    serde_json::to_writer(&mut file, value)?;
    file.flush()
}

fn write_phases(
    dir: &Path,
    snapshots: &[(ProbePoint, String)],
) -> std::io::Result<serde_json::Map<String, Value>> {
    std::fs::create_dir_all(dir)?;
    let mut files = serde_json::Map::new();
    for (point, text) in snapshots {
        let path: PathBuf = dir.join(format!("{}.json", point.name()));
        std::fs::write(&path, text)?;
        files.insert(point.name().to_owned(), json!(path.to_string_lossy()));
    }
    Ok(files)
}
