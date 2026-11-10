//! `trade-org.test.ts`'s slow simulation (#1038): the HQ left alone for seven game weeks.

use std::sync::Arc;

use csp_shared::terrain::{tile_index, Terrain};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good};
use serde_json::json;

use super::found_trade_org_hq;
use crate::invariants::check_all;
use crate::queries::city::stored_food;
use crate::queries::names::held;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Where the test HQ's town hall stands on its map.
const MID: i32 = 320;

#[test]
#[ignore = "66.9 s with eight at once; see #1092"]
fn left_alone_keeps_itself_fed_over_seven_game_weeks() {
    // The HQ alone on a Plains map 640 across, with one node of each kind near it (`hq`).
    let mut terrain = plains(640);
    let nodes = [
        ("forest", MID + 80, MID),
        ("stone", MID + 80, MID + 12),
        ("ironOre", MID + 88, MID - 12),
        ("goldOre", MID + 96, MID),
    ];
    for (kind, x, y) in nodes {
        let t = if kind == "forest" { Terrain::Forest } else { Terrain::Hills };
        terrain.tiles[tile_index(terrain.size, x, y)] = t as u8;
    }
    let mut world = create_world(&terrain, 1);
    world.nodes = nodes
        .iter()
        .enumerate()
        .map(|(i, (kind, x, y))| {
            serde_json::from_value(json!({ "id": format!("n{i}"), "kind": kind, "x": x, "y": y }))
                .unwrap()
        })
        .collect();
    let mut m = Mulberry32::new(7.0);
    let city = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());

    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let people: Vec<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    for _ in 0..49 * TICKS_PER_GAME_DAY as usize {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(&world, &terrain), []);
        }
    }
    // Starting ages and lifespans leave nobody to die of old age in seven weeks.
    for id in &people {
        assert!(world.residents.iter().any(|r| &r.id == id), "{id} is gone");
    }
    let c = world.cities.iter().find(|c| c.id == city).unwrap();
    assert!(stored_food(&world, c) > 0.0);
    // What its builders had left went back to its goods warehouse, not the storage it eats from.
    let storage = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Storage && b.city_id.as_deref() == Some(city.as_str()))
        .unwrap();
    assert_eq!(storage.stock.as_ref().map_or(0.0, |s| held(s, Good::Wood)), 0.0);
}
