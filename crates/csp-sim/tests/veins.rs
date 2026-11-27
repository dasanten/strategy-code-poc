//! Running dry (`CONTEXT.md`: Running dry; T102.1): a normal or rich ore node holds a stock that
//! working it uses up; at zero it is gone for good, the mine on it stands and makes nothing, its
//! workers' Work default ends saying why and the realm log says so once. Poor nodes, forest and
//! stone never run dry. A Player who saw the node keeps it on their map until they see the tile
//! again.

mod build_common;
mod scripts_common;

use build_common::*;
use csp_shared::balance::{vein_stock, VEIN_CREW_DAYS, WORKPLACE_MAX_WORKERS, WORK_OUTPUT_PER_DAY};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, DryNode, Good, RealmEventWhat, ResidentOrder, ResourceKind, ResourceNode,
    Richness, VeinStock, WorldState,
};
use csp_sim::explored::ExploredTerrain;
use csp_sim::last_seen::{refresh_last_seen, LastSeenState};
use csp_sim::queries::building::{build_problem, pile_tile};
use csp_sim::veins::{gone_nodes_of, veins_sound};
use scripts_common::{acked, rejected, Game};
use serde_json::json;

const MARA: u64 = 7;

/// A node of `kind` and `richness` at (x, y), with the stock it comes into being with.
fn node(kind: ResourceKind, richness: Richness, x: f64, y: f64) -> ResourceNode {
    let mut n = ResourceNode::new(format!("n{x}-{y}"), kind, x, y);
    n.richness = richness;
    n.fill_stock();
    n
}

/// A stock of `units`, none of it made yet.
fn stock(units: f64) -> VeinStock {
    VeinStock { first: units, left: units, made: 0.0 }
}

/// Mara's realm r1 with city c1, a mine (of no realm, as every workplace on a node) on the node
/// `n` at (7, 1) on Hills, and w1 of r1 on it,
/// strong enough to make a unit every few game hours.
fn mine_world(n: ResourceNode) -> (WorldState, TerrainMap) {
    let mut terrain = plains(16);
    terrain.tiles[16 + 7] = Terrain::Hills as u8;
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    world.nodes.push(n);
    world.buildings.push(building("mine", BuildingKind::Mine, 7.0, 1.0));
    let mut w1 = new_resident("w1", Some("r1"), 7.0, 1.0);
    w1.city_id = Some("c1".into());
    w1.stats.strength.base = 40.0;
    world.residents.push(w1);
    (world, terrain)
}

fn piled(world: &WorldState, good: Good) -> f64 {
    let (px, py) = pile_tile(world, 7, 1, 16);
    world
        .piles
        .iter()
        .filter(|p| p.x as i32 == px && p.y as i32 == py)
        .map(|p| p.goods.get(&good).copied().unwrap_or(0.0))
        .sum()
}

#[test]
fn every_normal_or_rich_ore_node_comes_into_being_with_its_stock_and_no_other_node_has_one() {
    csp_npc::install(); // T1719
    for kind in [ResourceKind::IronOre, ResourceKind::GoldOre, ResourceKind::Coal] {
        let good = match kind {
            ResourceKind::IronOre => "ironOre",
            ResourceKind::GoldOre => "goldOre",
            _ => "coal",
        };
        let crew =
            WORKPLACE_MAX_WORKERS.get("mine").unwrap() * WORK_OUTPUT_PER_DAY.get(good).unwrap();
        for (richness, days) in
            [(Richness::Normal, VEIN_CREW_DAYS.normal), (Richness::Rich, VEIN_CREW_DAYS.rich)]
        {
            let want = (crew * richness.factor() * days).round();
            assert_eq!(vein_stock(kind, richness), Some(want));
            assert_eq!(node(kind, richness, 1.0, 1.0).stock, Some(stock(want)));
        }
        assert_eq!(node(kind, Richness::Poor, 1.0, 1.0).stock, None);
    }
    for kind in [ResourceKind::Forest, ResourceKind::Stone] {
        for richness in [Richness::Poor, Richness::Normal, Richness::Rich] {
            assert_eq!(node(kind, richness, 1.0, 1.0).stock, None, "{kind:?} {richness:?}");
        }
    }
    // A rich vein holds more than a normal one.
    let rich = vein_stock(ResourceKind::IronOre, Richness::Rich).unwrap();
    assert!(rich > vein_stock(ResourceKind::IronOre, Richness::Normal).unwrap());
}

#[test]
fn a_rich_mine_makes_exactly_its_stock_then_the_node_is_gone_the_mine_stands_and_work_ends() {
    csp_npc::install(); // T1719
    let mut n = node(ResourceKind::IronOre, Richness::Rich, 7.0, 1.0);
    n.stock = Some(stock(3.0));
    let (world, terrain) = mine_world(n);
    let mut g = Game::new(world, terrain, player(MARA));
    let reply = g.give_to("w1", json!({ "kind": "task", "task": "work", "workplaceId": "mine" }));
    assert!(acked(&reply), "{reply:?}");
    g.until(4000, |g| g.world.nodes.is_empty());
    // Exactly the stock was made, the last unit with it.
    assert_eq!(piled(&g.world, Good::IronOre), 3.0);
    assert_eq!(g.world.dry_nodes.len(), 1);
    let dry = &g.world.dry_nodes[0];
    assert_eq!(
        (dry.kind, dry.richness, dry.x, dry.y),
        (ResourceKind::IronOre, Richness::Rich, 7.0, 1.0)
    );
    assert!(g.world.buildings.iter().any(|b| b.id == "mine" && b.site.is_none()));
    // The worker's Work default ends, their log saying why; nothing more is made.
    g.until(50, |g| g.r("w1").script.is_none());
    assert!(!matches!(g.r("w1").order, Some(ResidentOrder::WorkAt(_))), "{:?}", g.r("w1").order);
    let log: Vec<String> = g.r("w1").script_log.iter().flatten().map(|l| l.text.clone()).collect();
    assert_eq!(log.last().map(String::as_str), Some("the vein ran dry"), "{log:?}");
    for _ in 0..500 {
        g.tick();
    }
    assert_eq!(piled(&g.world, Good::IronOre), 3.0);
    assert!(g.world.buildings.iter().any(|b| b.id == "mine"));
    // The realm log says so once, and no worker adds a line of their own.
    let dry_lines = g.events("veinRanDry");
    assert_eq!(dry_lines.len(), 1, "{dry_lines:?}");
    assert_eq!(dry_lines[0]["buildingId"], "mine");
    assert_eq!(dry_lines[0]["node"], "ironOre");
    assert!(g.events("scriptStopped").is_empty(), "{:?}", g.events("scriptStopped"));
    assert_sound(&g.world, &g.terrain);
    // Work there is refused from now on, saying why.
    for order in [
        json!({ "kind": "task", "task": "work", "workplaceId": "mine" }),
        json!({ "kind": "workAt" }),
    ] {
        let reply = g.give_to("w1", order);
        assert_eq!(rejected(&reply), Some("the vein ran dry"), "{reply:?}");
    }
}

#[test]
fn a_work_script_started_on_a_dry_mine_ends_there_saying_why() {
    csp_npc::install(); // T1719
    // Its stock all made, the node gone: as a mine stands on a dry spot after a restart.
    let (mut world, terrain) = mine_world(node(ResourceKind::IronOre, Richness::Normal, 7.0, 1.0));
    let n = world.nodes.remove(0);
    world.dry_nodes.push(DryNode {
        id: n.id,
        kind: n.kind,
        x: n.x,
        y: n.y,
        richness: n.richness,
        at: 0,
        seen_gone_by: Vec::new(),
        next: None,
    });
    let mut g = Game::new(world, terrain, player(MARA));
    g.world.residents[0].script = Some(
        serde_json::from_value(json!({
            "scriptId": scripts_common::default_script_id(MARA, csp_shared::world::Task::Work),
            "memory": {}
        }))
        .unwrap(),
    );
    g.until(5, |g| g.r("w1").script.is_none());
    let log: Vec<String> = g.r("w1").script_log.iter().flatten().map(|l| l.text.clone()).collect();
    assert_eq!(log, vec!["the vein ran dry".to_string()]);
    assert!(g.events("scriptStopped").is_empty());
    assert_sound(&g.world, &g.terrain);
}

#[test]
fn workers_of_two_realms_make_nothing_more_once_the_last_unit_is_made_and_each_realm_is_told_once()
{
    // Stepping the world alone, with work-at orders and no script: the orders end.
    let mut n = node(ResourceKind::Coal, Richness::Normal, 7.0, 1.0);
    n.stock = Some(stock(5.0));
    let (mut world, terrain) = mine_world(n);
    world.realms.push(realm("r2", 8, "t1"));
    let mut t1 = new_resident("t1", Some("r2"), 8.0, 1.0);
    t1.stats.strength.base = 40.0;
    world.residents.push(t1);
    for (i, x) in [(0, 7), (1, 8)] {
        world.residents[i].order = Some(
            serde_json::from_value(json!({
                "kind": "workAt", "buildingId": "mine", "at": { "x": x, "y": 1 }, "progress": 0
            }))
            .unwrap(),
        );
    }
    run(&mut world, &terrain, 1440);
    assert_eq!(piled(&world, Good::Coal), 5.0);
    assert!(world.nodes.is_empty());
    assert!(world.residents.iter().all(|r| r.order.is_none()));
    let told: Vec<u64> = world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::VeinRanDry { .. }))
        .map(|e| e.user_id)
        .collect();
    assert_eq!(told, vec![MARA, 8]);
    assert_sound(&world, &terrain);
}

#[test]
fn a_poor_node_a_forest_and_a_stone_node_never_run_dry() {
    csp_npc::install(); // T1719
    let cases = [
        (BuildingKind::Mine, ResourceKind::IronOre, Richness::Poor, Good::IronOre),
        (BuildingKind::Mine, ResourceKind::GoldOre, Richness::Poor, Good::GoldOre),
        (BuildingKind::LumberCamp, ResourceKind::Forest, Richness::Rich, Good::Wood),
        (BuildingKind::Quarry, ResourceKind::Stone, Richness::Rich, Good::Stone),
    ];
    for (kind, node_kind, richness, good) in cases {
        let (mut world, mut terrain) = mine_world(node(node_kind, richness, 7.0, 1.0));
        if node_kind == ResourceKind::Forest {
            terrain.tiles[16 + 7] = Terrain::Forest as u8;
        }
        world.buildings[0].kind = kind;
        world.residents[0].order = Some(
            serde_json::from_value(json!({
                "kind": "workAt", "buildingId": "mine", "at": { "x": 7, "y": 1 }, "progress": 0
            }))
            .unwrap(),
        );
        run(&mut world, &terrain, 2000);
        assert!(piled(&world, good) >= 2.0, "{node_kind:?}: {}", piled(&world, good));
        assert_eq!(world.nodes.len(), 1, "{node_kind:?}");
        assert_eq!(world.nodes[0].stock, None);
        assert!(world.dry_nodes.is_empty());
        assert!(matches!(world.residents[0].order, Some(ResidentOrder::WorkAt(_))));
    }
}

#[test]
fn nothing_can_be_built_on_the_dry_spot_as_a_mine() {
    csp_npc::install(); // T1719
    let mut n = node(ResourceKind::GoldOre, Richness::Normal, 7.0, 1.0);
    n.stock = Some(stock(1.0));
    let (mut world, terrain) = mine_world(n);
    world.residents[0].order = Some(
        serde_json::from_value(json!({
            "kind": "workAt", "buildingId": "mine", "at": { "x": 7, "y": 1 }, "progress": 0
        }))
        .unwrap(),
    );
    run(&mut world, &terrain, 1440);
    assert!(world.nodes.is_empty());
    // Torn down, the spot takes no mine again.
    world.buildings.retain(|b| b.id != "mine");
    assert_eq!(
        build_problem(&world, 7, 1, BuildingKind::Mine, None).as_deref(),
        Some("a mine goes with one tile on a fitting resource node")
    );
}

#[test]
fn the_veins_invariant_holds_and_catches_a_broken_stock() {
    csp_npc::install(); // T1719
    let mut world = empty_world(&plains(16));
    world.nodes.push(node(ResourceKind::IronOre, Richness::Rich, 1.0, 1.0));
    world.nodes.push(node(ResourceKind::Forest, Richness::Rich, 3.0, 1.0));
    assert!(veins_sound(&world).is_empty());
    let broken = |world: &WorldState| -> Vec<String> {
        veins_sound(world).into_iter().map(|v| v.message).collect()
    };
    // Made and left don't add up to what it came into being with.
    world.nodes[0].stock.as_mut().unwrap().left -= 5.0;
    assert_eq!(broken(&world).len(), 1, "{:?}", broken(&world));
    world.nodes[0].stock.as_mut().unwrap().made += 5.0;
    assert!(broken(&world).is_empty());
    // Below zero.
    world.nodes[0].stock = Some(VeinStock { first: 2.0, left: -1.0, made: 3.0 });
    assert!(broken(&world).iter().any(|m| m.contains("below zero")), "{:?}", broken(&world));
    world.nodes[0].stock = Some(stock(2.0));
    // A forest with a stock, and a poor ore node with one.
    world.nodes[1].stock = Some(stock(10.0));
    assert!(broken(&world).iter().any(|m| m.contains("never runs dry")));
    world.nodes[1].stock = None;
    world.nodes.push(node(ResourceKind::Coal, Richness::Poor, 5.0, 1.0));
    world.nodes[2].stock = Some(stock(10.0));
    assert!(broken(&world).iter().any(|m| m.contains("never runs dry")));
    world.nodes.pop();
    // A node with nothing left still there.
    world.nodes[0].stock = Some(VeinStock { first: 2.0, left: 0.0, made: 2.0 });
    assert!(broken(&world).iter().any(|m| m.contains("nothing left")));
    world.nodes[0].stock = Some(stock(2.0));
    assert!(broken(&world).is_empty());
}

/// A plains map 128 tiles across: Mara's realm r1 with w1 at (100, 100), out of sight of a mine
/// spot at (10, 10) whose iron ran dry, which Mara had explored.
fn far_world() -> (WorldState, TerrainMap) {
    let terrain = plains(128);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    world.residents.push(new_resident("w1", Some("r1"), 100.0, 100.0));
    world.dry_nodes.push(DryNode {
        id: "n1".into(),
        kind: ResourceKind::IronOre,
        x: 10.0,
        y: 10.0,
        richness: Richness::Rich,
        at: 0,
        seen_gone_by: Vec::new(),
        next: None,
    });
    (world, terrain)
}

fn refresh(world: &mut WorldState, state: &mut LastSeenState) {
    refresh_last_seen(world, 128, &["r1".to_string()], state, &mut None, None);
}

#[test]
fn a_player_who_saw_the_node_keeps_it_on_their_map_until_they_see_the_tile_again() {
    csp_npc::install(); // T1719
    let (mut world, terrain) = far_world();
    let mut explored = ExploredTerrain::new(terrain, &world.nodes_ever());
    explored.explore(MARA, 10, 10, 3);
    let chunk_nodes = |explored: &ExploredTerrain| {
        csp_shared::chunks::decode_chunk(0, 0, &explored.chunk(MARA, 0, 0).unwrap()).nodes.len()
    };
    // The map's terrain still lists it for whoever explored it.
    assert_eq!(chunk_nodes(&explored), 1);
    let mut state = LastSeenState::default();
    refresh(&mut world, &mut state);
    assert_eq!(gone_nodes_of(&world, MARA), Vec::<(i32, i32)>::new());
    // Back in sight of the tile, they know it is gone.
    world.residents[0].x = 20.0;
    world.residents[0].y = 20.0;
    refresh(&mut world, &mut state);
    assert_eq!(gone_nodes_of(&world, MARA), vec![(10, 10)]);
    assert_eq!(world.dry_nodes[0].seen_gone_by, vec![MARA]);
    // Out of sight again, it stays gone; another Player who never saw it gone isn't told.
    world.residents[0].x = 100.0;
    refresh(&mut world, &mut state);
    assert_eq!(gone_nodes_of(&world, MARA), vec![(10, 10)]);
    assert_eq!(gone_nodes_of(&world, 8), Vec::<(i32, i32)>::new());
}

#[test]
fn a_world_with_a_dry_node_saves_and_loads_as_it_was() {
    csp_npc::install(); // T1719
    let (world, _) = far_world();
    let text = serde_json::to_string(&world).unwrap();
    assert!(text.contains("\"dryNodes\""));
    let back: WorldState = serde_json::from_str(&text).unwrap();
    assert_eq!(back, world);
    // A node with a stock too, and one without leaves it out.
    let rich = node(ResourceKind::Coal, Richness::Rich, 1.0, 1.0);
    let v = serde_json::to_value(&rich).unwrap();
    assert_eq!(v["stock"]["left"], v["stock"]["first"]);
    let forest =
        serde_json::to_value(node(ResourceKind::Forest, Richness::Normal, 1.0, 1.0)).unwrap();
    assert_eq!(forest, json!({ "id": "n1-1", "kind": "forest", "x": 1.0, "y": 1.0 }));
}
