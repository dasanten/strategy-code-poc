//! ms per tick of the Broadcast phase with Players connected, one of them remembering every
//! building (T99.7):
//!
//! ```text
//! cargo run --release -p csp-server --bin bench-broadcast -- <village|villages|hq|save> [clients] [ticks]
//! ```
//!
//! `save` reads the newest save of the database at `DB_PATH`, from a copy.
use std::process::ExitCode;

use csp_server::bench::{bench_broadcast, scene, SceneName};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(name) = args.first().and_then(|a| SceneName::parse(a)) else {
        return usage();
    };
    let number = |i: usize, default: usize| match args.get(i).map(|a| a.parse::<usize>()) {
        None => Some(default),
        Some(Ok(n)) => Some(n),
        Some(Err(_)) => None,
    };
    let (Some(clients), Some(ticks)) = (number(1, 1), number(2, 100)) else {
        return usage();
    };
    let scene = match scene(name) {
        Ok(scene) => scene,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    bench_broadcast(name, scene, clients, ticks, &mut |line| println!("{line}"));
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage: bench-broadcast <village|villages|hq|save> [clients] [ticks]");
    ExitCode::from(2)
}
