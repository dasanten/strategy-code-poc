//! The NPC cities' own steps (`step_npc_defence`, `step_npc_hire`, `step_npc_cities`) over the
//! stepped fixture worlds, nobody walking, against what the frozen TypeScript did:
//! `src/npc/npc-stepped.json`, written by `src/npc/gen-expected.mts`. Their plans, the orders and
//! scripts they give, pairs, gates and new horses must come out the same, tick for tick.

mod common;

use csp_shared::world::WorldState;
use csp_sim::npc_behaviour::step_npc_cities;
use csp_sim::npc_defence::step_npc_defence;
use csp_sim::npc_hire::step_npc_hire;
use serde_json::{json, Value};

use common::{assert_same_json, read_json, terrain_of};

/// Drops `null`s from objects, as `JSON.stringify` leaves `undefined` out.
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

/// What the TypeScript script keeps of a world.
fn subset(world: &WorldState, t: u64) -> Value {
    let v = serde_json::to_value(world).unwrap();
    let residents: Vec<Value> = v["residents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            json!({
                "id": r["id"], "cityId": r["cityId"], "carried": r["carried"], "order": r["order"],
                "script": r.get("script").cloned().unwrap_or(Value::Null),
                "pair": r.get("pair").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    let buildings: Vec<Value> = v["buildings"]
        .as_array()
        .unwrap()
        .iter()
        .map(
            |b| json!({ "id": b["id"], "closed": b.get("closed").cloned().unwrap_or(Value::Null) }),
        )
        .collect();
    json!({
        "t": t,
        "nextId": v["nextId"],
        "residents": residents,
        "cityPlans": v["cityPlans"],
        "cities": v["cities"],
        "buildings": buildings,
        "horses": world.horses.len(),
    })
}

#[test]
fn npc_cities_step_as_in_typescript() {
    let stepped: Value = serde_json::from_str(include_str!("../src/npc/npc-stepped.json"))
        .expect("npc-stepped.json");
    for case in stepped.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let file = read_json(&format!("worlds/{name}.json"));
        let terrain = terrain_of(&file);
        let mut world: WorldState = serde_json::from_value(file["world"].clone()).unwrap();
        let mut at = case["at"].as_array().unwrap().iter();
        let mut next = at.next();
        for t in 1..=360u64 {
            step_npc_defence(&mut world, terrain.size);
            step_npc_hire(&mut world, terrain.size);
            step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
            world.tick += 1;
            if let Some(want) = next.filter(|w| w["t"] == t) {
                let got = subset(&world, t);
                assert_same_json(&format!("{name}@{t}"), &strip_nulls(want), &strip_nulls(&got));
                next = at.next();
            }
        }
        assert!(next.is_none(), "{name}: not every tick was compared");
    }
}
