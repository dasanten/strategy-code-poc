//! Lists the fields Players' active scripts read that the script views don't declare (ADR 0011;
//! `cli/check-fields.ts`), with the script and the Player, before scripts see exactly their
//! views:
//!
//! ```text
//! check-fields
//! ```
//!
//! Reads the database at `DB_PATH`. Read only; safe to run while the server is up.
use std::process::ExitCode;

use csp_server::admin_cli::db_path;
use csp_server::db::open_db;
use csp_server::field_check::{
    describe_undeclared_reads, script_check_env, undeclared_field_reads,
};

fn main() -> ExitCode {
    let (Some(own), Some(default)) = (script_check_env(false), script_check_env(true)) else {
        eprintln!("check-fields: the script views are not ported to Rust yet (T86.12)");
        return ExitCode::FAILURE;
    };
    let conn = match open_db(db_path(), None) {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    match undeclared_field_reads(&conn, [&own, &default]) {
        Ok(reads) => {
            println!("{}", describe_undeclared_reads(&reads));
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
