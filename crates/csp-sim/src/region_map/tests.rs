//! `apps/server/src/region-map.test.ts`.

use csp_shared::chunks::{chunks_across, CHUNK_SIZE};
use csp_shared::world::WorldState;
use indexmap::IndexMap;
use serde_json::json;

use super::*;
use crate::queries::region_map::{organization_name, region_map_for, RegionAlliance, RegionHolder};
use crate::queries::standing::TRADE_ORG_NAME;
use crate::queries::territory::{Territory, TRADE_ORGANIZATION};
use crate::realm_test_world::{add_city, plains, resident};
use crate::world::create_world;

const SIZE: i32 = 64;

/// Realms r1, r2 and r3 led by Ann, Bo and Cy; r1 and r2 in the alliance North; city c3 alone.
fn setup() -> WorldState {
    let mut world = create_world(&plains(SIZE), 1);
    world.nodes.clear();
    for (i, (id, name)) in [("r1", "Ann"), ("r2", "Bo"), ("r3", "Cy")].into_iter().enumerate() {
        let leader = format!("lead-{id}");
        world.realms.push(
            serde_json::from_value(json!({"id": id, "userId": i + 1, "leaderId": leader}))
                .expect("a realm"),
        );
        let mut r = resident(&leader, Some(id), 60.0, 60.0 + i as f64);
        r.name = name.into();
        world.residents.push(r);
    }
    let north = json!({
        "id": "a1", "name": "North", "leaderId": "r1",
        "members": [{"realmId": "r1", "joinedAt": 0, "leaving": null}, {"realmId": "r2", "joinedAt": 0, "leaving": null}],
        "invites": [], "army": []
    });
    world.alliances.push(serde_json::from_value(north).expect("an alliance"));
    add_city(&mut world, "c3", None, 40.0, 40.0, "Oakmoor");
    world
}

/// Territory with the given tiles held.
fn territory(owners: &[((i32, i32), &str)]) -> Territory {
    let owners: IndexMap<usize, String> =
        owners.iter().map(|&((x, y), o)| ((y * SIZE + x) as usize, o.to_string())).collect();
    Territory { tick: 120, size: SIZE, owners }
}

fn everywhere(_: i32, _: i32) -> bool {
    true
}

fn north() -> Option<RegionAlliance> {
    Some(RegionAlliance { id: "a1".into(), name: "North".into() })
}

#[test]
fn names_realms_by_their_leader_and_cities_by_their_own_name() {
    let world = setup();
    assert_eq!(organization_name(&world, "r2"), "Bo");
    assert_eq!(organization_name(&world, "c3"), "Oakmoor");
    assert_eq!(organization_name(&world, TRADE_ORGANIZATION), TRADE_ORG_NAME);
}

#[test]
fn shows_every_holder_over_explored_terrain_alliance_members_with_their_alliance() {
    let world = setup();
    let t = territory(&[
        ((1, 1), "r1"),
        ((2, 1), "r2"),
        ((3, 1), "r3"),
        ((1, 2), "c3"),
        ((5, 5), "r1"),
    ]);
    let region = region_map_for(&world, &t, SIZE, &everywhere, None);
    let s = SIZE as usize;
    let holder = |id: &str, name: &str, alliance, tiles: Vec<usize>| RegionHolder {
        id: id.into(),
        name: name.into(),
        alliance,
        tiles,
    };
    assert_eq!(region.tick, 120);
    assert_eq!(region.chunks, None);
    assert_eq!(
        region.holders,
        vec![
            holder("c3", "Oakmoor", None, vec![2 * s + 1]),
            holder("r1", "Ann", north(), vec![65, 5 * s + 5]),
            holder("r2", "Bo", north(), vec![66]),
            holder("r3", "Cy", None, vec![67]),
        ]
    );
    assert!(region_map_unsound(&region, &t, SIZE, &everywhere, "r3").is_empty());
}

#[test]
fn leaves_out_territory_on_terrain_the_player_has_not_explored() {
    let world = setup();
    let t = territory(&[((1, 1), "r1"), ((20, 1), "r1"), ((30, 30), "r3")]);
    let explored = |x: i32, _y: i32| x < 10;
    let region = region_map_for(&world, &t, SIZE, &explored, None);
    let got: Vec<(&str, &[usize])> =
        region.holders.iter().map(|h| (h.id.as_str(), h.tiles.as_slice())).collect();
    assert_eq!(got, vec![("r1", &[(SIZE + 1) as usize][..])]);
    assert!(region_map_unsound(&region, &t, SIZE, &explored, "r2").is_empty());
}

#[test]
fn covers_only_the_given_chunks_when_asked_for_part_of_it() {
    let world = setup();
    let t = territory(&[((1, 1), "r1"), ((CHUNK_SIZE + 1, 1), "r2"), ((1, 40), "r3")]);
    let region = region_map_for(&world, &t, SIZE, &everywhere, Some(vec![1]));
    assert_eq!(region.chunks, Some(vec![1]));
    let got: Vec<(String, Vec<usize>)> =
        region.holders.iter().map(|h| (h.id.clone(), h.tiles.clone())).collect();
    assert_eq!(got, vec![("r2".to_string(), vec![(SIZE + CHUNK_SIZE + 1) as usize])]);
    // Every chunk together is the whole map.
    let n = chunks_across(SIZE);
    let all = region_map_for(&world, &t, SIZE, &everywhere, Some((0..n * n).collect()));
    assert_eq!(all.holders, region_map_for(&world, &t, SIZE, &everywhere, None).holders);
}

#[test]
fn flags_a_region_map_showing_unexplored_wrong_or_doubled_tiles() {
    let t = territory(&[((1, 1), "r1"), ((2, 1), "r2")]);
    let s = SIZE as usize;
    let region = RegionMap {
        tick: 120,
        chunks: None,
        holders: vec![
            RegionHolder {
                id: "r1".into(),
                name: "Ann".into(),
                alliance: None,
                tiles: vec![s + 1, s + 2, 40 * s],
            },
            RegionHolder { id: "r2".into(), name: "Bo".into(), alliance: None, tiles: vec![s + 2] },
        ],
    };
    let explored = |_x: i32, y: i32| y < 10;
    let problems: Vec<String> = region_map_unsound(&region, &t, SIZE, &explored, "r3")
        .into_iter()
        .map(|v| v.message)
        .collect();
    assert_eq!(
        problems,
        vec![
            "tile 2,1 went to realm r3 as held by r1: not theirs",
            "tile 0,40 went to realm r3 as held by r1: unexplored",
            "tile 2,1 went to realm r3 as held by r2: shown twice",
        ]
    );
}
