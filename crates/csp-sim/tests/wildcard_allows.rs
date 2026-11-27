//! A `_ =>` over an enum fails `pnpm check:rust` (`clippy::wildcard_enum_match_arm`, Epic 127).
//! The files that still had such arms when the lint came on allow it for the whole file; Epic
//! 127's tickets remove those allows area by area. This test counts them, so the number can only
//! go down: a new file-level allow fails it, and so does a removed one until `ALLOWED_FILES` is
//! lowered to match. A wildcard that is right keeps an `#[allow]` on its function, with its
//! reason beside it.

use std::path::{Path, PathBuf};

/// The files that allow the lint for the whole file. Lower it as their arms are named.
const ALLOWED_FILES: usize = 74;

const FILE_ALLOW: &str = "#![allow(clippy::wildcard_enum_match_arm)]";

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Every file of the workspace's crates that allows the lint for the whole file, from `crates/`.
fn allowed_files() -> Vec<String> {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut files = Vec::new();
    for krate in std::fs::read_dir(&crates).unwrap() {
        let krate = krate.unwrap().path();
        rust_files(&krate.join("src"), &mut files);
        rust_files(&krate.join("tests"), &mut files);
    }
    let mut allowed: Vec<String> = files
        .iter()
        .filter(|f| {
            std::fs::read_to_string(f).unwrap().lines().any(|line| line.trim() == FILE_ALLOW)
        })
        .map(|f| f.strip_prefix(&crates).unwrap().to_string_lossy().replace('\\', "/"))
        .collect();
    allowed.sort();
    allowed
}

#[test]
fn file_level_wildcard_allows_only_go_down() {
    let allowed = allowed_files();
    assert!(
        allowed.len() <= ALLOWED_FILES,
        "{} files allow `wildcard_enum_match_arm` for the whole file, more than {ALLOWED_FILES}: \
         name the variants instead, or allow it on the function with the reason beside it.\n{}",
        allowed.len(),
        allowed.join("\n")
    );
    assert_eq!(
        allowed.len(),
        ALLOWED_FILES,
        "fewer files allow `wildcard_enum_match_arm` for the whole file: lower ALLOWED_FILES to {}",
        allowed.len()
    );
}

#[test]
fn the_small_crates_have_no_file_level_wildcard_allow() {
    let outside: Vec<String> =
        allowed_files().into_iter().filter(|f| !f.starts_with("csp-sim/")).collect();
    assert!(outside.is_empty(), "file-level allows outside csp-sim:\n{}", outside.join("\n"));
}
