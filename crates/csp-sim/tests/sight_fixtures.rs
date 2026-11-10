//! Each side sees the same entities in Rust as in TypeScript (ADR 0030, `CONTEXT.md`: Sight):
//! `entitiesInSight` of every realm and city of the fixture worlds, compared as parsed JSON.

mod common;

use common::{assert_same_json, load_world, read_json};
use csp_sim::sight::{buildings_by_square, entities_in_sight, places_in_sight, SightCache};
use csp_sim::world_index::WorldIndex;
use serde_json::Value;

/// The stepped worlds with their sight, and the worlds of `sight.test.ts` with theirs.
const FIXTURES: [(&str, Option<&str>); 8] = [
    ("worlds/village-60.json", Some("worlds/village-60.sight.json")),
    ("worlds/village-1440.json", Some("worlds/village-1440.sight.json")),
    ("worlds/hq-60.json", Some("worlds/hq-60.sight.json")),
    ("worlds/hq-1440.json", Some("worlds/hq-1440.sight.json")),
    ("sight/city.json", None),
    ("sight/two-realms.json", None),
    ("sight/three-realms.json", None),
    ("sight/visitors.json", None),
];

#[test]
fn every_side_sees_what_it_sees_in_typescript() {
    let mut compared = 0;
    let mut kinds = std::collections::BTreeSet::new();
    for (world_file, sight_file) in FIXTURES {
        let (world, size, mut rest) = load_world(world_file);
        let sight = match sight_file {
            Some(f) => read_json(f),
            None => rest["sight"].take(),
        };
        let sides = sight.as_object().expect("sight by side");
        assert!(!sides.is_empty(), "{world_file}: no sides");
        let index = WorldIndex::new(&world, size);
        let by_square = buildings_by_square(&world, size);
        let mut cache = SightCache::open(size);
        for (side, want) in sides {
            let what = format!("{world_file} as seen by {side}");
            let seen = entities_in_sight(&world, &index, Some(side), None);
            assert_same_json(&what, want, &serde_json::to_value(&*seen).unwrap());
            compared += seen.len();
            kinds.extend(seen.iter().map(|e| e.is()));
            // Through a cache, and the buildings looked up by square, the same.
            let cached = entities_in_sight(&world, &index, Some(side), Some(&mut cache));
            assert_eq!(cached, seen, "{what}, cached");
            let places = places_in_sight(&world, &index, side, Some(&by_square), None);
            let want_places: Vec<Value> = want
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["is"] == "building" || e["is"] == "city")
                .cloned()
                .collect();
            assert_same_json(
                &format!("{what}, places"),
                &Value::Array(want_places),
                &serde_json::to_value(&*places.seen).unwrap(),
            );
        }
    }
    // Enough of each kind of thing to mean something.
    assert!(compared > 3000, "only {compared} entities compared");
    for kind in ["resident", "building", "city", "horse", "carriage", "pile"] {
        assert!(kinds.contains(kind), "no {kind} in any fixture");
    }
}
