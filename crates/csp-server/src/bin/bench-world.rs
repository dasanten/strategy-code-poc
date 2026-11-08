//! World generation by stage (ADR 0030; `bench-ts.mts world`):
//!
//! ```text
//! cargo run --release -p csp-server --bin bench-world -- [size] [seed]
//! ```
//!
//! The full-size map (`MAP_SIZE`) is the default; run it on an idle machine, in release.
use std::process::ExitCode;

use csp_server::bench::bench_world;
use csp_shared::balance::MAP_SIZE;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let size = match args.first().map(|a| a.parse::<i32>()) {
        None => MAP_SIZE,
        Some(Ok(n)) if n > 0 => n,
        _ => return usage(),
    };
    let seed = match args.get(1).map(|a| a.parse::<i64>()) {
        None => 1,
        Some(Ok(n)) => n,
        Some(Err(_)) => return usage(),
    };
    bench_world(size, seed, &mut |line| println!("{line}"));
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage: bench-world [size] [seed]");
    ExitCode::from(2)
}
