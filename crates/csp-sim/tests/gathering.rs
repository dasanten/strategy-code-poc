//! Gathering by hand (`CONTEXT.md`: Gathering, Patch; T114.1): the `gather` order fills a grown
//! resident's hands from the patch of the Forest or Hills tile they stand on, at a pace between a
//! poor node's and a normal one's; the patch runs out and grows back.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

mod build_common;

use build_common::*;
use csp_shared::balance::{
    GATHER_PER_DAY, PATCH_REGROW_DAYS, PATCH_REST_DAYS, PATCH_SIZE, RICHNESS_FACTOR,
    WORK_OUTPUT_PER_DAY,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, OrderEndedKind, Patch, ResidentOrder, ResourceKind, ResourceNode,
    SkillName, WorldState,
};
use csp_sim::gathering::{gather_order_problems, patch_left, patch_problems, picked_over};
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::balance::{gather_output, skill_of};
use serde_json::json;

const FOREST: (i32, i32) = (3, 3);
const HILLS: (i32, i32) = (5, 3);

/// Plains, with Forest at (3, 3) and (4, 3) and Hills at (5, 3).
fn terrain() -> TerrainMap {
    let mut t = plains(16);
    for (x, y, k) in [(3, 3, Terrain::Forest), (4, 3, Terrain::Forest), (5, 3, Terrain::Hills)] {
        t.tiles[(y * 16 + x) as usize] = k as u8;
    }
    t
}

fn me() -> OrderSender {
    player(7)
}

/// Realm r1 (Player 7) with resident g1 on the Forest tile.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let t = terrain();
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "g1"));
    resident(&mut world, "g1", FOREST.0 as f64, FOREST.1 as f64);
    (world, t, Orders::default())
}

fn gather(id: &str, good: &str) -> serde_json::Value {
    json!({ "kind": "gather", "residentId": id, "good": good })
}

fn carried(world: &WorldState, id: &str, good: Good) -> f64 {
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    r.carried.get(&good).copied().unwrap_or(0.0)
}

fn gathering(world: &WorldState, id: &str) -> bool {
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    matches!(r.order, Some(ResidentOrder::Gather(_)))
}

fn progress(world: &WorldState, id: &str) -> f64 {
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    match &r.order {
        Some(ResidentOrder::Gather(o)) => o.progress,
        _ => 0.0,
    }
}

fn ended_reason(world: &WorldState, id: &str) -> Option<String> {
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    let ended = r.order_ended.as_ref()?;
    assert_eq!(ended.kind, OrderEndedKind::Gather);
    ended.reason.clone()
}

/// Runs until the resident's gather order ends, checking the invariants every game day.
fn run_until_done(world: &mut WorldState, t: &TerrainMap, id: &str, max_days: f64) {
    let max = (max_days * TICKS_PER_GAME_DAY) as usize;
    for i in 0..max {
        if !gathering(world, id) {
            return;
        }
        run(world, t, 1);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            assert_sound(world, t);
        }
    }
    panic!("still gathering after {max_days} game days");
}

#[test]
fn gathers_between_a_poor_nodes_pace_and_a_normal_ones() {
    for good in ["wood", "stone", "food"] {
        let per_day = GATHER_PER_DAY.get(good).unwrap();
        let node = WORK_OUTPUT_PER_DAY.get(good).unwrap();
        assert!(per_day > node * RICHNESS_FACTOR.poor && per_day < node, "{good}");
    }
}

#[test]
fn fills_the_hands_at_the_pace_strength_skill_and_tools_give() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "wood"), &t), Ok(()));
    let plain = GATHER_PER_DAY.get("wood").unwrap() / TICKS_PER_GAME_DAY;
    close(progress(&world, "g1") * 1e4, plain * 1e4);

    // Twice the Strength, 50 Woodcutting (+50 %) and Tools (+25 %).
    let r = at(&mut world, "g1");
    r.stats.strength.base = 20.0;
    r.skills.insert(SkillName::Woodcutting, 50.0);
    r.carried.insert(Good::Tools, 1.0);
    let tick = world.tick as f64;
    let r = world.residents[0].clone();
    close(
        gather_output(&r, Good::Wood, SkillName::Woodcutting, tick) * 1e4,
        plain * 2.0 * 1.5 * 1.25 * 1e4,
    );
    let before = progress(&world, "g1");
    run(&mut world, &t, 1);
    close((progress(&world, "g1") - before) * 1e4, plain * 3.75 * 1e4);
    assert!(skill_of(&world.residents[0], SkillName::Woodcutting) > 50.0, "it teaches the skill");
    assert!(world.wear.contains_key("g1"), "it wears the Tools");
}

#[test]
fn takes_a_patch_into_the_hands_until_it_is_picked_over() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "wood"), &t), Ok(()));
    let days = PATCH_SIZE / GATHER_PER_DAY.get("wood").unwrap();
    run_until_done(&mut world, &t, "g1", days + 1.0);
    assert_eq!(carried(&world, "g1", Good::Wood), PATCH_SIZE);
    assert_eq!(ended_reason(&world, "g1").as_deref(), Some("picked over"));
    assert!(picked_over(&world, FOREST.0, FOREST.1));
    assert_eq!(world.patches.len(), 1, "only the tile that isn't full is kept");
    assert_sound(&world, &t);

    // The tile gives nothing more: an emptier resident is turned away.
    at(&mut world, "g1").carried.clear();
    let answer = orders.receive(&world, &me(), gather("g1", "food"), &t);
    assert_eq!(answer, Err("picked over".into()));
}

#[test]
fn a_picked_over_patch_grows_back_and_leaves_the_list() {
    let (mut world, t, _) = setup();
    world.patches.push(Patch { x: FOREST.0, y: FOREST.1, left: 0.0, at: world.tick });
    assert!(picked_over(&world, FOREST.0, FOREST.1));
    // Nothing grows back while it rests from the last gathering.
    run(&mut world, &t, (PATCH_REST_DAYS * TICKS_PER_GAME_DAY) as usize);
    assert_eq!(patch_left(&world, FOREST.0, FOREST.1), 0.0);
    run(&mut world, &t, (PATCH_REGROW_DAYS / 2.0 * TICKS_PER_GAME_DAY) as usize);
    close(patch_left(&world, FOREST.0, FOREST.1), PATCH_SIZE / 2.0);
    assert!(!picked_over(&world, FOREST.0, FOREST.1));
    run(&mut world, &t, (PATCH_REGROW_DAYS / 2.0 * TICKS_PER_GAME_DAY) as usize + 1);
    assert_eq!(patch_left(&world, FOREST.0, FOREST.1), PATCH_SIZE);
    assert!(world.patches.is_empty(), "a full patch leaves the list at the turn of the day");
}

#[test]
fn food_and_wood_use_up_the_same_forest_patch() {
    let (mut world, t, mut orders) = setup();
    world.patches.push(Patch { x: FOREST.0, y: FOREST.1, left: 2.0, at: 0 });
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "food"), &t), Ok(()));
    run_until_done(&mut world, &t, "g1", 3.0);
    assert_eq!(carried(&world, "g1", Good::Food), 2.0);
    assert_eq!(ended_reason(&world, "g1").as_deref(), Some("picked over"));
    assert_eq!(orders.receive(&world, &me(), gather("g1", "wood"), &t), Err("picked over".into()));
}

#[test]
fn stops_once_the_hands_are_full() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "g1").carried.insert(Good::Stone, 28.0);
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "wood"), &t), Ok(()));
    run_until_done(&mut world, &t, "g1", 2.0);
    assert_eq!(carried(&world, "g1", Good::Wood), 2.0);
    assert_eq!(ended_reason(&world, "g1").as_deref(), Some("hands full"));
    close(patch_left(&world, FOREST.0, FOREST.1), PATCH_SIZE - 2.0);
    assert_eq!(orders.receive(&world, &me(), gather("g1", "wood"), &t), Err("hands full".into()));
}

#[test]
fn stone_comes_from_hills_and_ore_is_never_gathered() {
    let (mut world, t, mut orders) = setup();
    let answer = orders.receive(&world, &me(), gather("g1", "stone"), &t);
    assert_eq!(answer, Err("gather that in hills".into()));
    for ore in ["ironOre", "goldOre", "coal"] {
        let answer = orders.receive(&world, &me(), gather("g1", ore), &t);
        assert_eq!(answer, Err("only wood, stone and food are gathered".into()), "{ore}");
    }
    at(&mut world, "g1").x = HILLS.0 as f64;
    assert_eq!(
        orders.receive(&world, &me(), gather("g1", "wood"), &t),
        Err("gather that in a forest".into())
    );
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "stone"), &t), Ok(()));
    run(&mut world, &t, (TICKS_PER_GAME_DAY / GATHER_PER_DAY.get("stone").unwrap()) as usize + 2);
    assert_eq!(carried(&world, "g1", Good::Stone), 1.0);
    assert!(skill_of(&world.residents[0], SkillName::Mining) > 0.0);
}

#[test]
fn a_child_cant_gather() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "g1").born_at = world.tick as f64 - 10.0;
    let answer = orders.receive(&world, &me(), gather("g1", "wood"), &t);
    assert_eq!(answer, Err("children can’t gather".into()));
}

#[test]
fn nothing_is_gathered_under_a_building_a_site_or_a_node() {
    let (mut world, t, mut orders) = setup();
    world.nodes.push(ResourceNode::new(
        "n1",
        ResourceKind::Forest,
        FOREST.0 as f64,
        FOREST.1 as f64,
    ));
    let taken = Err("something stands on this tile".to_string());
    assert_eq!(orders.receive(&world, &me(), gather("g1", "wood"), &t), taken);
    world.nodes.clear();
    world.buildings.push(site("s1", BuildingKind::Road, FOREST.0 as f64, FOREST.1 as f64));
    assert_eq!(orders.receive(&world, &me(), gather("g1", "wood"), &t), taken);

    // A site laid out under a gatherer ends their gathering.
    world.buildings.clear();
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "wood"), &t), Ok(()));
    assert!(gathering(&world, "g1"));
    world.buildings.push(site("s1", BuildingKind::Road, FOREST.0 as f64, FOREST.1 as f64));
    assert_eq!(gather_order_problems(&world, &t).len(), 1, "the invariant sees it");
    run(&mut world, &t, 1);
    assert!(!gathering(&world, "g1"));
    assert_sound(&world, &t);
}

#[test]
fn a_gatherer_who_walks_off_stops() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(order(&mut world, &mut orders, &me(), gather("g1", "wood"), &t), Ok(()));
    at(&mut world, "g1").x = 4.0;
    run(&mut world, &t, 1);
    assert!(!gathering(&world, "g1"));
}

#[test]
fn the_patch_invariant_catches_a_bad_patch() {
    let (mut world, t, _) = setup();
    world.patches.push(Patch { x: FOREST.0, y: FOREST.1, left: 3.0, at: 0 });
    assert_eq!(patch_problems(&world, &t), []);
    world.patches.push(Patch { x: 1, y: 1, left: -1.0, at: 0 });
    let broken: Vec<String> = patch_problems(&world, &t).into_iter().map(|v| v.message).collect();
    assert!(broken.iter().any(|m| m.contains("outside 0")), "{broken:?}");
    assert!(broken.iter().any(|m| m.contains("no Forest or Hills")), "{broken:?}");
    assert!(broken.iter().any(|m| m.contains("out of order")), "{broken:?}");
}

#[test]
fn a_player_sees_the_patches_in_sight_that_arent_full_and_none_out_of_it() {
    use csp_shared::protocol::SeenEntity;
    use csp_sim::sight::{entities_in_sight, sent_out_of_sight};
    use csp_sim::world_index::WorldIndex;
    let mut t = plains(256);
    for (x, y) in [(3, 3), (120, 120)] {
        t.tiles[(y * 256 + x) as usize] = Terrain::Forest as u8;
    }
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "g1"));
    resident(&mut world, "g1", 3.0, 3.0);
    world.patches.push(Patch { x: 3, y: 3, left: 4.0, at: 2 });
    world.patches.push(Patch { x: 120, y: 120, left: 0.0, at: 2 });
    let index = WorldIndex::new(&world, t.size);
    let seen = entities_in_sight(&world, &index, Some("r1"), None);
    let patches: Vec<_> = seen
        .iter()
        .filter_map(|e| match e {
            SeenEntity::Patch(p) => Some((p.id.clone(), p.x, p.y, p.left, p.at)),
            _ => None,
        })
        .collect();
    assert_eq!(patches, [("patch:3,3".to_string(), 3, 3, 4.0, 2)]);
    assert_eq!(sent_out_of_sight(&world, &index, "r1", &seen), []);
}
