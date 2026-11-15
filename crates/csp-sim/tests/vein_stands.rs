//! How the vein stands (`CONTEXT.md`: Running dry; T102.3): whoever works a node's workplace,
//! their realm and its allies, sees how its vein stands in words (plenty, thinning, nearly gone,
//! or never runs dry), never as a number; others see nothing of it. The log of each realm working
//! it says once when it turns to thinning and once at nearly gone.

mod build_common;

use build_common::*;
use csp_shared::balance::{VEIN_NEARLY_GONE, VEIN_THINNING};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Alliance, AllianceMember, BuildingKind, RealmEventWhat, ResourceKind, ResourceNode, Richness,
    VeinStock, VeinWord, WorldState,
};
use csp_sim::sight::entities_in_sight;
use csp_sim::vein_stands::{vein_seen_by, vein_word, veins_seen_by};
use csp_sim::world_index::WorldIndex;
use serde_json::json;

const MARA: u64 = 7;
const TOBIN: u64 = 8;

/// A work-at order for the mine at (x, 1).
fn work_at(x: i32) -> csp_shared::world::ResidentOrder {
    serde_json::from_value(json!({
        "kind": "workAt", "buildingId": "mine", "at": { "x": x, "y": 1 }, "progress": 0
    }))
    .unwrap()
}

/// A rich iron ore node at (7, 1) holding `units`, its mine on it, w1 of Mara's realm r1 and t1 of
/// Tobin's r2 working it; r3 (no realm of its own here) is r1's ally and works nothing; r4 is nobody's friend.
fn mine_world(units: f64) -> (WorldState, TerrainMap) {
    let mut terrain = plains(16);
    terrain.tiles[16 + 7] = Terrain::Hills as u8;
    let mut world = empty_world(&terrain);
    for (id, user, leader) in [("r1", MARA, "w1"), ("r2", TOBIN, "t1")] {
        world.realms.push(realm(id, user, leader));
    }
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    let mut n = ResourceNode::new("n1", ResourceKind::IronOre, 7.0, 1.0);
    n.richness = Richness::Rich;
    n.stock = Some(VeinStock { first: units, left: units, made: 0.0 });
    world.nodes.push(n);
    world.buildings.push(building("mine", BuildingKind::Mine, 7.0, 1.0));
    for (id, owner, x) in [("w1", "r1", 7), ("t1", "r2", 8)] {
        let mut r = new_resident(id, Some(owner), f64::from(x), 1.0);
        r.stats.strength.base = 40.0;
        r.order = Some(work_at(x));
        world.residents.push(r);
    }
    world.alliances.push(Alliance {
        id: "alliance-1".into(),
        name: "North".into(),
        leader_id: "r1".into(),
        members: ["r1", "r3"]
            .iter()
            .map(|r| AllianceMember { realm_id: r.to_string(), joined_at: 0.0, leaving: None })
            .collect(),
        invites: vec![],
        army: vec![],
    });
    (world, terrain)
}

fn left(world: &WorldState) -> Option<f64> {
    world.nodes.first().and_then(|n| n.stock).map(|s| s.left)
}

#[test]
fn the_word_follows_the_share_left_through_both_steps() {
    let word = |left: f64| VeinStock { first: 100.0, left, made: 100.0 - left }.word();
    assert_eq!(word(100.0), VeinWord::Plenty);
    assert_eq!(word(100.0 * VEIN_THINNING + 1.0), VeinWord::Plenty);
    assert_eq!(word(100.0 * VEIN_THINNING), VeinWord::Thinning);
    assert_eq!(word(100.0 * VEIN_NEARLY_GONE + 1.0), VeinWord::Thinning);
    assert_eq!(word(100.0 * VEIN_NEARLY_GONE), VeinWord::NearlyGone);
    assert_eq!(word(1.0), VeinWord::NearlyGone);
}

#[test]
fn a_worked_mine_goes_from_plenty_to_thinning_to_nearly_gone_and_each_realm_working_it_is_told_once_at_each(
) {
    let (mut world, terrain) = mine_world(20.0);
    let mut words = vec![];
    while left(&world).is_some() {
        let mine = world.buildings.iter().find(|b| b.id == "mine").unwrap();
        let word = vein_word(&world, mine).unwrap();
        // What the Player sees follows the stock.
        let share = left(&world).unwrap() / 20.0;
        assert_eq!(word, VeinWord::of_share(share));
        if words.last() != Some(&word) {
            words.push(word);
        }
        run(&mut world, &terrain, 1);
        assert!(world.tick < 20_000, "the mine never ran dry");
    }
    assert_eq!(words, vec![VeinWord::Plenty, VeinWord::Thinning, VeinWord::NearlyGone]);
    let told: Vec<(u64, VeinWord)> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::VeinTurned { vein, building_id, node, .. } => {
                assert_eq!((building_id.as_str(), *node), ("mine", ResourceKind::IronOre));
                Some((e.user_id, *vein))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        told,
        vec![
            (MARA, VeinWord::Thinning),
            (TOBIN, VeinWord::Thinning),
            (MARA, VeinWord::NearlyGone),
            (TOBIN, VeinWord::NearlyGone),
        ]
    );
    // The ally working nothing there is told nothing.
    assert!(world.events.iter().all(|e| e.user_id == MARA || e.user_id == TOBIN));
    // The work-at orders end on the dry mine the tick after.
    run(&mut world, &terrain, 2);
    assert_sound(&world, &terrain);
}

#[test]
fn the_workers_realms_and_their_allies_see_the_word_and_nobody_else_does() {
    let (mut world, _) = mine_world(100.0);
    world.nodes[0].stock = Some(VeinStock { first: 100.0, left: 40.0, made: 60.0 });
    let mine = world.buildings.iter().find(|b| b.id == "mine").unwrap().clone();
    for (realm, sees) in [("r1", true), ("r2", true), ("r3", true), ("r4", false)] {
        let want = sees.then_some(VeinWord::Thinning);
        assert_eq!(vein_seen_by(&world, &mine, realm), want, "{realm}");
        let all = veins_seen_by(&world, realm);
        assert_eq!(all.get("mine").copied(), want, "{realm}");
    }
    // Nothing of the stock leaves the server: not in what anyone sees, not even the workers.
    let index = WorldIndex::new(&world, 16);
    for realm in ["r1", "r4"] {
        let seen =
            serde_json::to_string(&*entities_in_sight(&world, &index, Some(realm), None)).unwrap();
        assert!(!seen.contains("\"left\"") && !seen.contains("\"first\""), "{seen}");
    }
    // Once nobody of r1's alliance works it, r1 and r3 see nothing of it.
    world.residents.retain(|r| r.id != "w1");
    assert_eq!(vein_seen_by(&world, &mine, "r1"), None);
    assert!(veins_seen_by(&world, "r3").is_empty());
    assert_eq!(vein_seen_by(&world, &mine, "r2"), Some(VeinWord::Thinning));
}

#[test]
fn a_worker_away_from_the_mine_still_counts_through_their_work_script() {
    let (mut world, _) = mine_world(100.0);
    world.residents.retain(|r| r.id == "w1");
    let w1 = &mut world.residents[0];
    w1.order = None;
    w1.script = Some(
        serde_json::from_value(json!({ "scriptId": 0, "memory": { "workplaceId": "mine" } }))
            .unwrap(),
    );
    assert_eq!(veins_seen_by(&world, "r1").get("mine"), Some(&VeinWord::Plenty));
    let w1 = &mut world.residents[0];
    w1.script = Some(serde_json::from_value(json!({ "scriptId": 12, "memory": {} })).unwrap());
    w1.script_params =
        Some(serde_json::from_value(json!({ "12": { "workplace": "mine" } })).unwrap());
    assert_eq!(veins_seen_by(&world, "r1").get("mine"), Some(&VeinWord::Plenty));
}

#[test]
fn a_node_that_never_runs_dry_says_so_and_a_dry_mine_or_a_site_says_nothing() {
    let (mut world, _) = mine_world(100.0);
    // A poor node holds no stock: it never runs dry.
    world.nodes[0].richness = Richness::Poor;
    world.nodes[0].stock = None;
    assert_eq!(veins_seen_by(&world, "r1").get("mine"), Some(&VeinWord::Endless));
    mine_of(&mut world).site =
        Some(serde_json::from_value(json!({ "delivered": {}, "work": 0 })).unwrap());
    assert!(veins_seen_by(&world, "r1").is_empty());
    mine_of(&mut world).site = None;
    world.nodes.clear();
    assert!(veins_seen_by(&world, "r1").is_empty());
}

fn mine_of(world: &mut WorldState) -> &mut csp_shared::world::Building {
    world.buildings.iter_mut().find(|b| b.id == "mine").unwrap()
}
