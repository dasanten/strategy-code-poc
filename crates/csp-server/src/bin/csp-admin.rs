//! Admin commands that work without logging in (`apps/server/src/cli/admin.ts`, ADR 0005):
//!
//! ```text
//! admin create <name>   creates an admin account (or makes one admin); the password comes from
//!                       ADMIN_PASSWORD or is asked for
//! admin invite          prints a new invite code
//! ```
//!
//! Safe to run while the server is up: SQLite lets both write.
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
