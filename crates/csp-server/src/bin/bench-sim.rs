//! ms per tick per phase (ADR 0030; `bench-ts.mts sim`):
//!
//! ```text
//! cargo run --release -p csp-server --bin bench-sim -- <village|villages|hq|save> [ticks]
//! ```
//!
//! `save` reads the newest save of the database at `DB_PATH`, from a copy.
use std::process::ExitCode;

use csp_server::bench::{bench_sim, scene, SceneName, DEFAULT_TICKS};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(name) = args.first().and_then(|a| SceneName::parse(a)) else {
        return usage();
    };
    let ticks = match args.get(1).map(|a| a.parse::<usize>()) {
        None => DEFAULT_TICKS,
        Some(Ok(n)) => n,
        Some(Err(_)) => return usage(),
    };
    let scene = match scene(name) {
        Ok(scene) => scene,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    bench_sim(name, scene, ticks, &mut |line| println!("{line}"));
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage: bench-sim <village|villages|hq|save> [ticks]");
    ExitCode::from(2)
}
