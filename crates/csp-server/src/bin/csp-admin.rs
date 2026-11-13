//! Admin commands that work without logging in (`apps/server/src/cli/admin.ts`, ADR 0005):
//!
//! ```text
//! admin create <name>   creates an admin account (or makes one admin); the password comes from
//!                       ADMIN_PASSWORD or is asked for
//! admin invite          prints a new invite code
//! admin explore <player> (--radius <tiles> | --all) --yes
//!                       marks tiles as explored for a Player: a disc round their first city's
//!                       town hall, or the whole map (Epic 99, to stage a far-explored Player)
//! admin map-stats       prints what each Player's map costs as it is sent (ADR 0034)
//! ```
//!
//! `create`, `invite` and `map-stats` are safe to run while the server is up: SQLite lets both
//! write, and `map-stats` only reads. `explore` is for a copy of a world or a stopped server: a
//! running one writes its own explored terrain back at its next save.
use std::{
    io::{self, BufRead, Write},
    process::ExitCode,
};

use csp_server::{admin_cli, db::open_db};

fn ask(question: &str) -> io::Result<String> {
    print!("{question}");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_owned())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let conn = match open_db(admin_cli::db_path(), None) {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let env_password = std::env::var("ADMIN_PASSWORD").ok();
    let outcome = admin_cli::run(&conn, &args, env_password, ask);
    match outcome {
        Ok(out) => {
            println!("{out}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
