//! Writes `packages/balance/` from the Rust balance table (`pnpm balance:rust`, ADR 0030, T88.4).
//! With `--check` it writes nothing and fails when a file differs from what it would write.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use csp_shared::balance_export::files;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn main() -> ExitCode {
    let check = std::env::args().skip(1).any(|a| a == "--check");
    let root = workspace_root();
    let mut stale = false;
    for (path, text) in files() {
        let target = root.join(&path);
        if check {
            // A checkout with CRLF line endings holds the same file.
            let on_disk =
                std::fs::read_to_string(&target).unwrap_or_default().replace("\r\n", "\n");
            if on_disk != text {
                eprintln!("{path} is stale");
                stale = true;
            }
            continue;
        }
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).expect("create the output directory");
        }
        std::fs::write(&target, text).unwrap_or_else(|e| panic!("write {path}: {e}"));
        println!("wrote {path}");
    }
    if stale {
        eprintln!("run `pnpm balance:rust`");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
