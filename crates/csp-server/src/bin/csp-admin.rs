//! Admin commands that work without logging in (ADR 0005):
//!
//! ```text
//! admin create <name>   creates an admin account (or makes one admin); the password comes from
//!                       ADMIN_PASSWORD or is asked for
//! admin invite          prints a new invite code
//! admin explore <player> (--radius <tiles> | --all) --yes
//!                       marks tiles as explored for a Player: a disc round their first city's
//!                       town hall, or the whole map (Epic 99, to stage a far-explored Player)
//! admin map-stats       prints what each Player's map costs as it is sent (ADR 0034)
//! admin reset-world [--seed <n>] --yes
//!                       generates the world again, once (ADR 0035): backs the database up, then
//!                       removes every world save, the terrain and explored terrain and clears the
//!                       First day card; accounts, invite codes and script libraries stay. Without
//!                       --yes it lists what it would remove and keep
//! admin new-world --db <path> [--size <tiles>] [--seed <n>]
//!                       makes a small test world (Epic 117) into a new database at <path>, by
//!                       the live generator: 768 tiles across without --size, a random seed
//!                       without --seed. Refuses a database that exists
//! ```
//!
//! `create`, `invite` and `map-stats` are safe to run while the server is up: SQLite lets both
//! write, and `map-stats` only reads. `explore` is for a copy of a world or a stopped server: a
//! running one writes its own explored terrain back at its next save. `reset-world` likewise:
//! stop the server first (`docker compose stop server`, then `docker compose run --rm server
//! csp-admin reset-world`).
use std::{
    io::{self, BufRead, Write},
    process::ExitCode,
};

use csp_server::{admin_cli, db::open_db, new_world};

fn ask(question: &str) -> io::Result<String> {
    print!("{question}");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_owned())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // A new world goes into a database of its own, never the server's.
    if args.first().is_some_and(|a| a == "new-world") {
        let made = new_world::parse(&args[1..]).and_then(|order| new_world::new_world(&order));
        return report(made);
    }
    let conn = match open_db(admin_cli::db_path(), None) {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let env_password = std::env::var("ADMIN_PASSWORD").ok();
    report(admin_cli::run(&conn, &args, env_password, ask))
}

fn report(outcome: Result<String, String>) -> ExitCode {
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
