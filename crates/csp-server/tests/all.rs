//! Every integration test of this crate, in one test binary. Cargo would build one binary per file
//! in `tests/`, each compiling and linking its own copy of the code it uses: that was most of the
//! build time of `cargo nextest run`. Cargo's own discovery is off (`autotests = false` in
//! Cargo.toml), so a new test file runs only once it is listed here; `every_test_file_is_listed`
//! fails when one isn't.
//!
//! Each file still declares its own helper modules (`mod common;`) as it did as a binary of its
//! own, so a helper is compiled once per file that uses it.
#![allow(clippy::duplicate_mod)]

#[path = "alliance_army.rs"]
mod alliance_army;
#[path = "app.rs"]
mod app;
#[path = "auth.rs"]
mod auth;
#[path = "bench.rs"]
mod bench;
#[path = "db.rs"]
mod db;
#[path = "default_scripts.rs"]
mod default_scripts;
#[path = "explored.rs"]
mod explored;
#[path = "field_check.rs"]
mod field_check;
#[path = "first_day.rs"]
mod first_day;
#[path = "horse_offer.rs"]
mod horse_offer;
#[path = "map_tools.rs"]
mod map_tools;
#[path = "npc_alliances.rs"]
mod npc_alliances;
#[path = "realtime.rs"]
mod realtime;
#[path = "saves.rs"]
mod saves;
#[path = "scripts.rs"]
mod scripts;
#[path = "server.rs"]
mod server;
#[path = "shadow.rs"]
mod shadow;

/// Cargo no longer finds test files on its own: one missing here would never run.
#[test]
fn every_test_file_is_listed() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let listed = include_str!("all.rs");
    let mut missing: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".rs") && name != "all.rs")
        .filter(|name| !listed.contains(&format!("#[path = \"{name}\"]")))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "tests/all.rs doesn't list {missing:?}; add `#[path = \"<file>.rs\"] mod <file>;` for each"
    );
}
