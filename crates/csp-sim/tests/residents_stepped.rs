//! Survival, spoilage, the stock floor, aging and refilling (T86.3) stepped over the fixture
//! worlds as `stepWorld` orders them, nobody walking, against what the frozen TypeScript did:
//! `src/residents/stepped.json`, written by `src/residents/gen-expected.mts` from
//! `fixtures/worlds/village-0.json` (made a Player's realm with residents away, Down, old and
//! young, so a Leader dies and the realm ends) and `fixtures/worlds/hq-0.json` (the Trade Org HQ,
//! its stock floor).

mod common;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use csp_sim::aging::step_aging;
use csp_sim::spoilage::step_spoilage;
use csp_sim::stock_floor::step_stock_floor;
use csp_sim::survival::{step_refill, step_survival};
use csp_sim::tick::Scratch;
use serde_json::{json, Value};

use common::{assert_same_json, read_json};

/// Standard base64, as `Buffer.toString('base64')` writes it.
fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("not base64: {c}"),
    };
    let bytes: Vec<u8> = text.bytes().filter(|c| *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, c)| n | u32::from(value(*c)) << (18 - 6 * i));
        out.extend_from_slice(&n.to_be_bytes()[1..chunk.len()]);
    }
    out
}

fn terrain_of(file: &Value) -> TerrainMap {
    let t = &file["terrain"];
    TerrainMap {
        size: t["size"].as_i64().unwrap() as i32,
        tiles: base64(t["tiles"].as_str().unwrap()),
    }
}

/// What the TypeScript script keeps of a world at a tick (`subset`).
fn subset(world: &WorldState, t: u64) -> Value {
    let v = serde_json::to_value(world).unwrap();
    let pick = |list: &str, keys: &[&str]| -> Value {
        v[list]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| list != "buildings" || e.get("stock").is_some())
            .map(|e| {
                Value::Object(
                    keys.iter().filter_map(|k| Some((k.to_string(), e.get(*k)?.clone()))).collect(),
                )
            })
            .collect()
    };
    json!({
        "t": t,
        "tick": v["tick"],
        "nextId": v["nextId"],
        "realms": v["realms"],
        "residents": pick("residents", &["id", "owner", "cityId", "x", "y", "hunger", "health", "carried", "downUntil", "order"]),
        "cities": pick("cities", &["id", "realmId", "layout", "formerPlayer"]),
        "buildings": pick("buildings", &["id", "stock"]),
        "horses": pick("horses", &["id", "realmId", "cityId"]),
        "carriages": pick("carriages", &["id", "realmId", "cityId", "load"]),
        "piles": v["piles"],
        "events": v["events"],
    })
}

#[test]
fn survival_spoilage_floor_aging_and_refill_step_as_in_typescript() {
    let stepped: Value =
        serde_json::from_str(include_str!("../src/residents/stepped.json")).expect("stepped.json");
    for case in stepped.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let file = read_json(&format!("worlds/{name}.json"));
        let terrain = terrain_of(&file);
        let start =
            if case["start"].is_null() { file["world"].clone() } else { case["start"].clone() };
        let mut world: WorldState = serde_json::from_value(start).expect("a world");
        let mut scratch = Scratch::default();
        let mut at = case["at"].as_array().unwrap().iter();
        let mut next = at.next();
        for t in 1..=8 * 1440u64 {
            step_survival(&mut world, &terrain, &mut scratch);
            step_spoilage(&mut world);
            step_stock_floor(&mut world, &mut scratch.made);
            world.tick += 1;
            step_aging(&mut world, terrain.size);
            step_refill(&mut world, terrain.size);
            if let Some(want) = next.filter(|w| w["t"] == t) {
                // JSON leaves out `undefined`; `null` fields the TypeScript dropped compare equal.
                let got = subset(&world, t);
                assert_same_json(&format!("{name}@{t}"), &strip_nulls(want), &strip_nulls(&got));
                next = at.next();
            }
        }
        assert!(next.is_none(), "{name}: not every tick was compared");
    }
}

/// Drops `null`s from objects that the other side writes without the key.
fn strip_nulls(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k.clone(), strip_nulls(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip_nulls).collect()),
        other => other.clone(),
    }
}
