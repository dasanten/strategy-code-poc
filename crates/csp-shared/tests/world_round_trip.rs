//! The world state types load what the TypeScript server saves and write it back unchanged
//! (ADR 0030: same shape of state, same save format), compared as parsed JSON.

use std::io::Read;
use std::path::PathBuf;

use csp_shared::world::{parse_save, SaveError, WorldState, WORLD_FORMAT_VERSION};
use serde_json::Value;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The live save: the latest `world_saves` row of a worktree database, migrated to the current
/// format by the TypeScript server (`loadOrCreateWorld`) and written as `saveWorld` writes it.
/// The shared fixture of `scripts/dump-fixtures.mts` (T84.2) once it is there, else this crate's
/// own copy made the same way.
fn live_save() -> (u32, Vec<u8>) {
    let shared = crate_dir().join("../csp-sim/fixtures/save");
    let dir =
        if shared.join("live.json.gz").exists() { shared } else { crate_dir().join("tests/saves") };
    let mut json = Vec::new();
    flate2::read::GzDecoder::new(std::fs::File::open(dir.join("live.json.gz")).unwrap())
        .read_to_end(&mut json)
        .unwrap();
    let version: Value =
        serde_json::from_slice(&std::fs::read(dir.join("version.json")).unwrap()).unwrap();
    let version = version
        .get("WORLD_FORMAT_VERSION")
        .or_else(|| version.get("version"))
        .and_then(Value::as_u64)
        .unwrap();
    (version as u32, json)
}

/// The stepped worlds of `scripts/dump-fixtures.mts` (T84.2), once they are there.
fn world_fixtures() -> Vec<PathBuf> {
    let dir = crate_dir().join("../csp-sim/fixtures/worlds");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        // What each side sees of a world (`*.sight.json`, T85.5) is not a world.
        .filter(|p| !p.to_string_lossy().ends_with(".sight.json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no world fixtures in {}", dir.display());
    files
}

/// Every number as an `f64`, so `5` and `5.0` compare equal: JavaScript has one number type, and
/// a field the port keeps as `f64` writes a whole number as `5.0`.
fn normalised(v: &Value) -> Value {
    match v {
        Value::Number(n) => Value::from(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(normalised).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), normalised(v))).collect())
        }
        other => other.clone(),
    }
}

/// The first place where two JSON values differ, for a readable failure.
fn first_difference(a: &Value, b: &Value, at: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return Some(format!("{at}.{k}: missing after the round trip")),
                    Some(w) => {
                        if let Some(d) = first_difference(v, w, &format!("{at}.{k}")) {
                            return Some(d);
                        }
                    }
                }
            }
            y.keys()
                .find(|k| !x.contains_key(*k))
                .map(|k| format!("{at}.{k}: added by the round trip"))
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (v, w))| first_difference(v, w, &format!("{at}[{i}]"))),
        _ if a == b => None,
        _ => Some(format!("{at}: {a} became {b}")),
    }
}

fn assert_round_trip(name: &str, input: &Value, world: &WorldState) {
    let output = normalised(&serde_json::to_value(world).unwrap());
    let input = normalised(input);
    if let Some(d) = first_difference(&input, &output, "world") {
        panic!("{name} does not round-trip: {d}");
    }
    assert_eq!(input, output, "{name}");
}

#[test]
fn the_live_save_round_trips() {
    let (version, json) = live_save();
    let world = parse_save(version, &json).unwrap();
    assert!(!world.residents.is_empty() && !world.buildings.is_empty());
    let input: Value = serde_json::from_slice(&json).unwrap();
    assert_round_trip("the live save", &input, &world);
}

#[test]
fn every_world_fixture_round_trips() {
    for path in world_fixtures() {
        // `{ terrain, world }`: the terrain is stored apart from the world state (ADR 0006).
        let mut fixture: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let input = fixture["world"].take();
        let world: WorldState = serde_json::from_value(input.clone())
            .unwrap_or_else(|e| panic!("{} does not load: {e}", path.display()));
        assert_round_trip(&path.display().to_string(), &input, &world);
    }
}

#[test]
fn a_save_of_another_version_is_refused() {
    let (_, json) = live_save();
    for version in [WORLD_FORMAT_VERSION - 1, WORLD_FORMAT_VERSION + 1] {
        match parse_save(version, &json) {
            Err(SaveError::Version { found }) => assert_eq!(found, version),
            other => panic!("format {version} loaded: {:?}", other.map(|_| ())),
        }
    }
}

/// The live-format save is the TypeScript server's last format (111, the freeze). A format bump
/// after the cutover migrates it in `csp-server`'s `world_format`, with a test of its own.
#[test]
fn the_live_save_is_the_current_format() {
    assert_eq!(live_save().0, WORLD_FORMAT_VERSION);
}

/// Adds `extra` to the object at `pointer` of the live save and tries to load it.
fn load_with_extra_field(pointer: &str) -> Result<WorldState, String> {
    let (_, json) = live_save();
    let mut value: Value = serde_json::from_slice(&json).unwrap();
    value
        .pointer_mut(pointer)
        .unwrap_or_else(|| panic!("the live save has nothing at {pointer}"))
        .as_object_mut()
        .unwrap()
        .insert("notAField".into(), Value::Bool(true));
    serde_json::from_value(value).map_err(|e| e.to_string())
}

#[test]
fn an_unknown_field_is_refused() {
    for pointer in [
        "",
        "/residents/0",
        "/residents/0/stats/strength",
        "/buildings/0",
        "/cities/0",
        "/events/0",
        "/caravans/0",
        "/traders/0",
    ] {
        let err = load_with_extra_field(pointer)
            .err()
            .unwrap_or_else(|| panic!("an extra field at {pointer:?} loaded"));
        assert!(err.contains("notAField"), "{pointer:?}: {err}");
    }
    // A resident's order and a remembered building: an internally tagged enum and its variant.
    let (_, json) = live_save();
    let value: Value = serde_json::from_slice(&json).unwrap();
    let with_order = value["residents"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| !r["order"].is_null())
        .expect("a resident with an order");
    assert!(load_with_extra_field(&format!("/residents/{with_order}/order")).is_err());
    let user = value["lastSeen"].as_object().unwrap().keys().next().unwrap();
    assert!(load_with_extra_field(&format!("/lastSeen/{user}/0")).is_err());
}

#[test]
fn a_missing_field_is_refused() {
    let (_, json) = live_save();
    let mut value: Value = serde_json::from_slice(&json).unwrap();
    value["residents"][0].as_object_mut().unwrap().remove("hunger");
    assert!(serde_json::from_value::<WorldState>(value).is_err());
}
