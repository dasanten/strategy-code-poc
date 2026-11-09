//! The Rust half of the shadow run (`shadow-step`, T88.5): its commands on a small save.
use std::path::{Path, PathBuf};

use csp_server::{
    db::open_db,
    saves::{save_terrain, save_world},
    server::TickSettings,
    shadow::serve,
};
use csp_shared::terrain::TerrainMap;
use csp_sim::world::create_world;
use serde_json::Value;

const SETTINGS: TickSettings =
    TickSettings { invariant_sample_rate: 1.0, slow_tick_ms: 800.0, save_every_ticks: 30 };

/// A database holding a 64 × 64 world at tick 0 and its terrain.
fn small_save(dir: &Path) -> PathBuf {
    let path = dir.join("world.db");
    let conn = open_db(&path, None).unwrap();
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let world = create_world(&terrain, 1);
    save_terrain(&conn, world.seed as i64, &terrain).unwrap();
    save_world(&conn, &world).unwrap();
    path
}

fn answers(db: &Path, commands: &[String]) -> Vec<Value> {
    let input = commands.join("\n") + "\n";
    let mut out = Vec::new();
    serve(db, SETTINGS, input.as_bytes(), &mut out).unwrap();
    String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

#[test]
fn steps_probes_and_dumps_the_world_one_json_line_a_command() {
    let dir = tempfile::tempdir().unwrap();
    let db = small_save(dir.path());
    let phases = dir.path().join("phases");
    let dump = dir.path().join("world.json");
    let a = answers(
        &db,
        &[
            r#"{"cmd":"step"}"#.into(),
            r#"{"cmd":"step","probe":true}"#.into(),
            serde_json::json!({ "cmd": "phases", "dir": phases }).to_string(),
            serde_json::json!({ "cmd": "dump", "path": dump }).to_string(),
            r#"{"cmd":"what"}"#.into(),
            r#"{"cmd":"stop"}"#.into(),
        ],
    );
    assert_eq!(a.len(), 7);
    assert_eq!(a[0]["ready"], true);
    assert_eq!(a[0]["tick"], 0);
    assert_eq!(a[1]["health"]["tick"], 1);
    assert!(a[1]["health"]["phases"]["world"].is_number());
    assert_eq!(a[2]["health"]["tick"], 2);
    assert!(a[2]["notes"].is_array());

    // The world as it was after each phase of the probed tick: the step itself counts the tick.
    let files = a[3]["files"].as_object().unwrap();
    let tick_at = |point: &str| {
        let text = std::fs::read_to_string(files[point].as_str().unwrap()).unwrap();
        serde_json::from_str::<Value>(&text).unwrap()["tick"].as_u64().unwrap()
    };
    assert_eq!(["orders", "queues", "scripts", "world", "end"].map(tick_at), [1, 1, 1, 2, 2]);

    assert_eq!(a[4]["ok"], true);
    let world: Value = serde_json::from_str(&std::fs::read_to_string(&dump).unwrap()).unwrap();
    assert_eq!(world["tick"], 2);
    assert!(a[5]["error"].as_str().unwrap().starts_with("unknown command"));
    assert_eq!(a[6]["ok"], true);
}
