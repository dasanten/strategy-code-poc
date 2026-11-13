//! `apps/server/src/region-map.test.ts`, and the Region map per chunk (T99.8, ADR 0034).

use std::collections::BTreeMap;

use csp_shared::chunks::CHUNK_SIZE;
use csp_shared::world::WorldState;
use indexmap::IndexMap;
use serde_json::json;

use super::*;
use crate::queries::region_map::{
    organization_name, region_map_for, region_tiles, region_update, RegionAlliance, RegionChanges,
    RegionChunk, RegionHolder, RegionIndex, RegionSent,
};
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

/// Territory worked out at `tick` with the given tiles held.
fn territory_at(tick: u64, owners: &[((i32, i32), &str)]) -> Territory {
    let owners: IndexMap<usize, String> =
        owners.iter().map(|&((x, y), o)| ((y * SIZE + x) as usize, o.to_string())).collect();
    Territory { tick, size: SIZE, owners }
}

fn territory(owners: &[((i32, i32), &str)]) -> Territory {
    territory_at(120, owners)
}

fn everywhere(_: i32, _: i32) -> bool {
    true
}

fn north() -> Option<RegionAlliance> {
    Some(RegionAlliance { id: "a1".into(), name: "North".into() })
}

/// The holder of every tile an update shows, by tile.
fn decoded(region: &RegionMap) -> BTreeMap<usize, String> {
    let (tiles, problems) = region_tiles(region, SIZE);
    assert!(problems.is_empty(), "{problems:?}");
    tiles
        .into_iter()
        .filter(|&(_, h)| h >= 0)
        .map(|(t, h)| (t, region.holders[h as usize].id.clone()))
        .collect()
}

/// The territory a Player may see, by tile: what the Region map is to show them.
fn seen(t: &Territory, is_explored: &dyn Fn(i32, i32) -> bool) -> BTreeMap<usize, String> {
    t.owners
        .iter()
        .filter(|(&i, _)| is_explored(i as i32 % SIZE, i as i32 / SIZE))
        .map(|(&i, o)| (i, o.clone()))
        .collect()
}

/// A Player's updates across workings-out of territory: the first whole, then the changes.
struct Player {
    sent: RegionSent,
    index: Option<RegionIndex>,
}

impl Player {
    fn new() -> Self {
        Player { sent: RegionSent::default(), index: None }
    }

    fn update(
        &mut self,
        world: &WorldState,
        t: &Territory,
        grown: &[i32],
        is_explored: &dyn Fn(i32, i32) -> bool,
    ) -> Option<RegionMap> {
        let index = RegionIndex::new(world, t, SIZE);
        let changed = self.index.as_ref().map(|before| (before.tick, index.changed_since(before)));
        let changes = changed.as_ref().map(|(from, chunks)| RegionChanges { from: *from, chunks });
        let out = region_update(&index, changes, grown, &mut self.sent, is_explored);
        self.index = Some(index);
        out
    }
}

#[test]
fn names_realms_by_their_leader_and_cities_by_their_own_name() {
    let world = setup();
    assert_eq!(organization_name(&world, "r2"), "Bo");
    assert_eq!(organization_name(&world, "c3"), "Oakmoor");
    assert_eq!(organization_name(&world, TRADE_ORGANIZATION), TRADE_ORG_NAME);
}

#[test]
fn sends_each_chunk_as_runs_along_its_rows_with_the_holders_listed_once() {
    let world = setup();
    let t = territory(&[
        ((1, 1), "r1"),
        ((2, 1), "r2"),
        ((3, 1), "r3"),
        ((1, 2), "c3"),
        ((5, 5), "r1"),
        ((6, 5), "r1"),
    ]);
    let region = region_map_for(&world, &t, SIZE, &everywhere);
    let holder = |id: &str, name: &str, alliance| RegionHolder {
        id: id.into(),
        name: name.into(),
        alliance,
    };
    assert_eq!(region.tick, 120);
    assert!(region.whole);
    assert_eq!(
        region.holders,
        vec![
            holder("c3", "Oakmoor", None),
            holder("r1", "Ann", north()),
            holder("r2", "Bo", north()),
            holder("r3", "Cy", None),
        ]
    );
    let c = CHUNK_SIZE;
    #[rustfmt::skip]
    let runs = vec![
        c + 1, -1, 1, 1, 1, 2, 1, 3,     // row 1: tiles 1, 2 and 3
        c - 4 + 1, -1, 1, 0,             // row 2: tile 1
        3 * c - 2 + 5, -1, 2, 1,         // row 5: tiles 5 and 6
    ];
    assert_eq!(region.chunks, vec![RegionChunk { chunk: 0, runs }]);
    assert!(region.gone.is_empty());
    assert_eq!(decoded(&region), seen(&t, &everywhere));
    assert!(region_map_unsound(&region, &t, SIZE, &everywhere, "r3").is_empty());
}

#[test]
fn decodes_to_the_same_holder_for_every_tile_as_the_territory_shows_on_explored_terrain() {
    let world = setup();
    let ids = ["r1", "r2", "r3", "c3"];
    let mut owners = Vec::new();
    for y in 0..SIZE {
        for x in 0..SIZE {
            if (x * 7 + y * 3) % 5 != 0 {
                owners.push(((x, y), ids[((x / 3 + y / 5) % 4) as usize]));
            }
        }
    }
    let t = territory(&owners);
    let explored = |x: i32, y: i32| (x - 20).pow(2) + (y - 30).pow(2) < 600;
    let region = region_map_for(&world, &t, SIZE, &explored);
    assert_eq!(decoded(&region), seen(&t, &explored));
    assert!(region_map_unsound(&region, &t, SIZE, &explored, "r1").is_empty());
}

#[test]
fn leaves_out_territory_on_terrain_the_player_has_not_explored() {
    let world = setup();
    let t = territory(&[((1, 1), "r1"), ((20, 1), "r1"), ((40, 40), "r3")]);
    let explored = |x: i32, _y: i32| x < 10;
    let region = region_map_for(&world, &t, SIZE, &explored);
    assert_eq!(decoded(&region), BTreeMap::from([((SIZE + 1) as usize, "r1".to_string())]));
    // r3's chunk shows nothing, so it is not sent, nor r3 named.
    assert_eq!(region.chunks.iter().map(|c| c.chunk).collect::<Vec<_>>(), vec![0]);
    assert_eq!(region.holders.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["r1"]);
    assert!(region_map_unsound(&region, &t, SIZE, &explored, "r2").is_empty());
}

#[test]
fn a_working_out_that_changes_nothing_the_player_sees_sends_nothing() {
    let world = setup();
    let mut p = Player::new();
    let owners = [((1, 1), "r1"), ((40, 40), "r3")];
    assert!(p.update(&world, &territory_at(60, &owners), &[], &everywhere).is_some());
    assert_eq!(p.update(&world, &territory_at(120, &owners), &[], &everywhere), None);
    // Nor does a change on terrain the Player has not explored.
    let explored = |x: i32, _y: i32| x < 32;
    let mut p = Player::new();
    p.update(&world, &territory_at(60, &owners), &[], &explored);
    let grew = [((1, 1), "r1"), ((40, 40), "r3"), ((41, 40), "r3")];
    assert_eq!(p.update(&world, &territory_at(120, &grew), &[], &explored), None);
}

#[test]
fn a_city_that_grows_sends_only_its_changed_chunks() {
    let world = setup();
    let mut p = Player::new();
    let before = [((1, 1), "r1"), ((40, 1), "r2"), ((40, 40), "r3")];
    p.update(&world, &territory_at(60, &before), &[], &everywhere);
    let after = [((1, 1), "r1"), ((40, 1), "r2"), ((40, 40), "r3"), ((41, 40), "r3")];
    let t = territory_at(120, &after);
    let update = p.update(&world, &t, &[], &everywhere).expect("an update");
    assert!(!update.whole);
    assert_eq!(update.tick, 120);
    assert_eq!(update.chunks.iter().map(|c| c.chunk).collect::<Vec<_>>(), vec![3]);
    assert_eq!(update.holders.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["r3"]);
    let s = SIZE as usize;
    let want = BTreeMap::from([(40 * s + 40, "r3".to_string()), (40 * s + 41, "r3".to_string())]);
    assert_eq!(decoded(&update), want);
    assert!(region_map_unsound(&update, &t, SIZE, &everywhere, "r1").is_empty());
}

#[test]
fn territory_that_goes_away_names_its_chunks_as_gone() {
    let world = setup();
    let mut p = Player::new();
    p.update(&world, &territory_at(60, &[((1, 1), "r1"), ((40, 40), "r3")]), &[], &everywhere);
    let update =
        p.update(&world, &territory_at(120, &[((1, 1), "r1")]), &[], &everywhere).expect("one");
    assert!(update.chunks.is_empty());
    assert_eq!(update.gone, vec![3]);
    assert!(update.holders.is_empty());
}

#[test]
fn newly_explored_terrain_sends_its_chunks_and_nothing_unexplored_is_ever_sent() {
    let world = setup();
    let t = territory(&[((1, 1), "r1"), ((40, 1), "r2"), ((40, 40), "r3")]);
    let mut p = Player::new();
    let first = p.update(&world, &t, &[], &|x, y| x < 32 && y < 32).expect("the first");
    assert_eq!(first.chunks.iter().map(|c| c.chunk).collect::<Vec<_>>(), vec![0]);
    // Explored terrain grew into chunk 1 within the same working-out of territory.
    let explored = |x: i32, y: i32| x < 48 && y < 32;
    let update = p.update(&world, &t, &[1, 3], &explored).expect("the grown chunk");
    assert!(!update.whole);
    assert_eq!(update.chunks.iter().map(|c| c.chunk).collect::<Vec<_>>(), vec![1]);
    for (tile, _) in decoded(&update) {
        assert!(explored(tile as i32 % SIZE, tile as i32 / SIZE));
    }
    assert!(region_map_unsound(&update, &t, SIZE, &explored, "r1").is_empty());
}

#[test]
fn a_holder_renamed_or_joining_an_alliance_is_sent_without_its_tiles() {
    let mut world = setup();
    let mut p = Player::new();
    let owners = [((1, 1), "r1"), ((40, 40), "c3")];
    p.update(&world, &territory_at(60, &owners), &[], &everywhere);
    world.cities.iter_mut().find(|c| c.id == "c3").expect("c3").name = "Elmford".into();
    let update = p.update(&world, &territory_at(120, &owners), &[], &everywhere).expect("one");
    assert!(update.chunks.is_empty() && update.gone.is_empty());
    assert_eq!(
        update.holders,
        vec![RegionHolder { id: "c3".into(), name: "Elmford".into(), alliance: None }]
    );
}

#[test]
fn a_client_that_missed_a_working_out_is_brought_up_to_date() {
    let world = setup();
    let mut p = Player::new();
    p.update(&world, &territory_at(60, &[((1, 1), "r1"), ((40, 40), "r3")]), &[], &everywhere);
    // Changes worked out from a territory the client never got do not count for it.
    let a = RegionIndex::new(&world, &territory_at(90, &[((1, 1), "r1")]), SIZE);
    let t = territory_at(120, &[((1, 1), "r1"), ((2, 1), "r1")]);
    let b = RegionIndex::new(&world, &t, SIZE);
    let changed = b.changed_since(&a);
    let changes = Some(RegionChanges { from: 90, chunks: &changed });
    let update = region_update(&b, changes, &[], &mut p.sent, &everywhere).expect("one");
    assert_eq!(update.chunks.iter().map(|c| c.chunk).collect::<Vec<_>>(), vec![0]);
    assert_eq!(update.gone, vec![3]);
}

#[test]
fn flags_a_region_map_showing_unexplored_wrong_doubled_or_malformed_tiles() {
    let t = territory(&[((1, 1), "r1"), ((2, 1), "r2")]);
    let holder = |id: &str| RegionHolder { id: id.into(), name: id.into(), alliance: None };
    let c = CHUNK_SIZE;
    let region = RegionMap {
        tick: 120,
        whole: false,
        holders: vec![holder("r1"), holder("r2")],
        chunks: vec![
            // r1 on 1,1 and 2,1 (2,1 is r2's), then on 0,10 (unexplored).
            RegionChunk { chunk: 0, runs: vec![c + 1, -1, 2, 0, 9 * c - 3, -1, 1, 0] },
            // Chunk 0 again: 2,1 shown twice; then a holder not listed, and a run too long.
            RegionChunk { chunk: 0, runs: vec![c + 2, -1, 1, 1, 1, 5, c * c, -1] },
        ],
        gone: vec![],
    };
    let explored = |_x: i32, y: i32| y < 10;
    let problems: Vec<String> = region_map_unsound(&region, &t, SIZE, &explored, "r3")
        .into_iter()
        .map(|v| v.message)
        .collect();
    assert_eq!(
        problems,
        vec![
            "the Region map sent to realm r3: chunk 0 names holder 5, which it does not list",
            "the Region map sent to realm r3: chunk 0 runs past its 1024 tiles",
            "tile 2,1 went to realm r3 as held by r1: not theirs",
            "tile 0,10 went to realm r3 as held by r1: unexplored",
            "tile 2,1 went to realm r3 as held by r2: shown twice",
        ]
    );
}
