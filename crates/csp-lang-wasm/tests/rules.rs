//! The rules module's first slice (T122.1): a rule without a world, and the throwaway mirror of
//! what the client sees, read by a world-reading rule. `apps/web/src/wasm-rules.test.ts` checks the
//! same against the client's TypeScript copy, through the WebAssembly build.

use csp_lang_wasm::rules::{building_work, WorldMirror};
use csp_shared::terrain::Terrain;
use serde_json::json;

fn building(id: &str, kind: &str, x: i32, y: i32) -> serde_json::Value {
    json!({ "is": "building", "id": id, "kind": kind, "cityId": null, "x": x, "y": y })
}

fn welcome(entities: Vec<serde_json::Value>) -> String {
    json!({ "type": "welcome", "map": { "size": 64 }, "entities": entities }).to_string()
}

#[test]
fn a_rule_without_a_world_answers_the_sims_own() {
    use csp_shared::world::BuildingKind;
    let on = Some(Terrain::Mountain as u8);
    let sim = csp_sim::queries::building::building_work;
    assert_eq!(building_work("road", on), sim(BuildingKind::Road, on));
    assert_eq!(building_work("farm", None), sim(BuildingKind::Farm, None));
    assert!(building_work("castle", None).is_nan());
}

#[test]
fn the_mirror_takes_in_ticks_and_answers_by_tile() {
    let mut m = WorldMirror::new();
    let resident = json!({ "is": "resident", "id": "r1", "anything": [1, 2] });
    m.welcome(&welcome(vec![
        building("b1", "farm", 10, 10),
        building("b2", "storage", 30, 30),
        resident,
    ]))
    .expect("a welcome");
    assert_eq!(m.count(), 2);
    assert_eq!(m.building_at(11, 11).as_deref(), Some("b1"));
    let tick = json!({
        "type": "tick",
        "changed": [building("b3", "house", 40, 40), building("b1", "farm", 12, 10)],
        "gone": ["b2"],
    });
    m.tick(&tick.to_string()).expect("a tick");
    assert_eq!(m.count(), 2);
    assert_eq!(m.building_at(10, 10), None);
    assert_eq!(m.building_at(12, 10).as_deref(), Some("b1"));
    assert_eq!(m.building_at(30, 30), None);
    assert_eq!(m.building_at(40, 40).as_deref(), Some("b3"));
    // Not a tick: nothing changes.
    assert!(m.tick("{\"changed\": 1}").is_err());
    assert_eq!(m.building_at(12, 10).as_deref(), Some("b1"));
}
