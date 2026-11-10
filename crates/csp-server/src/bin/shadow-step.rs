//! The Rust server's side of the shadow run (T88.5), driven by `scripts/shadow-run.mts`:
//!
//! ```text
//! shadow-step <world.db> [--invariant-sample-rate r] [--slow-tick-ms ms] [--save-every-ticks n]
//! ```
//!
//! Commands on stdin, answers on stdout, one JSON line each (`csp_server::shadow`).
use std::{io, path::PathBuf, process::ExitCode};

use csp_server::{server::TickSettings, shadow::serve};

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(db) = args.next() else { return usage() };
    let mut settings =
        TickSettings { invariant_sample_rate: 1.0, slow_tick_ms: 800.0, save_every_ticks: 30 };
    while let Some(flag) = args.next() {
        let Some(value) = args.next() else { return usage() };
        let ok = match flag.as_str() {
            "--invariant-sample-rate" => {
                value.parse().map(|v| settings.invariant_sample_rate = v).is_ok()
            }
            "--slow-tick-ms" => value.parse().map(|v| settings.slow_tick_ms = v).is_ok(),
            "--save-every-ticks" => value.parse().map(|v| settings.save_every_ticks = v).is_ok(),
            _ => false,
        };
        if !ok {
            return usage();
        }
    }
    match serve(&PathBuf::from(db), settings, io::stdin().lock(), io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("shadow-step: {e}");
            ExitCode::FAILURE
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: shadow-step <world.db> [--invariant-sample-rate r] [--slow-tick-ms ms] \
         [--save-every-ticks n]"
    );
    ExitCode::from(2)
}
