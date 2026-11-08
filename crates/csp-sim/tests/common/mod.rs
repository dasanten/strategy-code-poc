//! Loading the fixtures of `scripts/dump-fixtures.mts` and comparing JSON as the TypeScript
//! wrote it.

#![allow(dead_code)]

use std::path::PathBuf;

use csp_shared::world::WorldState;
use serde_json::Value;

pub fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

pub fn read_json(path: &str) -> Value {
    let file = fixtures().join(path);
    serde_json::from_slice(
        &std::fs::read(&file).unwrap_or_else(|e| panic!("{}: {e}", file.display())),
    )
    .unwrap()
}

/// A world fixture: `{ terrain: { size, tiles }, world }` or `{ size, world, sight }`; its world
/// and map size.
pub fn load_world(path: &str) -> (WorldState, i32, Value) {
    let mut v = read_json(path);
    let size = v["size"].as_i64().or_else(|| v["terrain"]["size"].as_i64()).expect("a size") as i32;
    let world = serde_json::from_value(v["world"].take()).unwrap_or_else(|e| panic!("{path}: {e}"));
    (world, size, v)
}

/// Every number as an `f64`, so `5` and `5.0` compare equal: JavaScript has one number type.
pub fn normalised(v: &Value) -> Value {
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
pub fn first_difference(want: &Value, got: &Value, at: &str) -> Option<String> {
    match (want, got) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return Some(format!("{at}.{k}: missing, want {v}")),
                    Some(w) => {
                        if let Some(d) = first_difference(v, w, &format!("{at}.{k}")) {
                            return Some(d);
                        }
                    }
                }
            }
            y.iter().find(|(k, _)| !x.contains_key(*k)).map(|(k, v)| format!("{at}.{k}: extra {v}"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if let Some(d) = x
                .iter()
                .zip(y)
                .enumerate()
                .find_map(|(i, (v, w))| first_difference(v, w, &format!("{at}[{i}]")))
            {
                return Some(d);
            }
            (x.len() != y.len()).then(|| format!("{at}: {} items, want {}", y.len(), x.len()))
        }
        _ if want == got => None,
        _ => Some(format!("{at}: {got}, want {want}")),
    }
}

/// Asserts `got` serialises to the JSON the TypeScript wrote, as parsed JSON.
pub fn assert_same_json(what: &str, want: &Value, got: &Value) {
    let (want, got) = (normalised(want), normalised(got));
    if let Some(d) = first_difference(&want, &got, what) {
        panic!("{d}");
    }
}
