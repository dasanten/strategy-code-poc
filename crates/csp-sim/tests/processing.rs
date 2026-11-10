//! `apps/server/src/processing.test.ts`, ported (T86.17, part 5): the smelter and the mint, the
//! conversion rates, and where smelters, mints and smithies may stand.

mod build_common;

use build_common::*;
use csp_shared::balance::{BATCHES_PER_DAY, RECIPES, WORKPLACE_MAX_WORKERS, WORK_SKILL_PER_DAY};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, Pile, ResourceKind, ResourceNode, SkillName, Stock, WorldState,
};
use csp_sim::invariants::world_invariants;
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::balance::{batch_work, skill_of};
use csp_sim::queries::building::{
    build_problem, input_at, pile_tile, workplace_good, TerrainLookup,
};
use serde_json::json;

/// Plains, with Mountain at (5, 5) and Hills (an iron ore node) at (7, 5).
fn terrain() -> TerrainMap {
    let mut t = plains(16);
    t.tiles[5 * 16 + 5] = Terrain::Mountain as u8;
    t.tiles[5 * 16 + 7] = Terrain::Hills as u8;
    t
}

fn me() -> OrderSender {
    player(7)
}

fn iron_ore_node() -> ResourceNode {
    ResourceNode { id: "n1".into(), kind: ResourceKind::IronOre, x: 7.0, y: 5.0 }
}

/// A world with realm r1 (Player 7), a finished `kind` at (2, 2) and resident w1 working it.
fn setup(kind: BuildingKind) -> (WorldState, TerrainMap, Orders) {
    let t = terrain();
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "w1"));
    world.nodes.push(iron_ore_node());
    world.buildings.push(building(&format!("{kind:?}").to_lowercase(), kind, 2.0, 2.0));
    resident_at_work(&mut world, "w1");
    let mut orders = Orders::default();
    let answer = orders.receive(&world, &me(), json!({ "kind": "workAt", "residentId": "w1" }), &t);
    assert_eq!(answer, Ok(()));
    orders.apply_all(&mut world, &t);
    (world, t, orders)
}

/// A resident of r1 on (2, 2) with Strength, Intellect and Endurance 10.
fn resident_at_work(world: &mut WorldState, id: &str) -> usize {
    world.residents.push(new_resident(id, Some("r1"), 2.0, 2.0));
    world.residents.len() - 1
}

fn pile_at(world: &WorldState, x: i32, y: i32) -> Option<&Pile> {
    let (px, py) = pile_tile(world, x, y, 16);
    world.piles.iter().find(|p| p.x as i32 == px && p.y as i32 == py)
}

/// All units of a good anywhere: carried, in piles and in storages.
fn total(world: &WorldState, good: Good) -> f64 {
    world.residents.iter().map(|r| r.carried.get(&good).copied().unwrap_or(0.0)).sum::<f64>()
        + world.piles.iter().map(|p| p.goods.get(&good).copied().unwrap_or(0.0)).sum::<f64>()
        + world
            .buildings
            .iter()
            .map(|b| b.stock.as_ref().and_then(|s| s.get(&good)).copied().unwrap_or(0.0))
            .sum::<f64>()
}

#[test]
fn a_smelter_turns_2_iron_ore_into_1_iron_a_mint_1_gold_ore_into_10_coins() {
    // processing.test.ts: conversion rates (balance file): a smelter turns 2 iron ore into 1 iron,
    // a mint 1 gold ore into 10 coins
    let smelter = RECIPES.get("smelter").unwrap();
    assert_eq!(smelter.len(), 1);
    assert_eq!(smelter[0].input.get("ironOre"), Some(2.0));
    assert_eq!(smelter[0].input.0.len(), 1);
    assert_eq!(smelter[0].output.get("iron"), Some(1.0));
    assert_eq!(smelter[0].output.0.len(), 1);
    let mint = RECIPES.get("mint").unwrap();
    assert_eq!(mint.len(), 1);
    assert_eq!(mint[0].input.get("goldOre"), Some(1.0));
    assert_eq!(mint[0].output.get("coins"), Some(10.0));
    assert!(BATCHES_PER_DAY.get("smelter").unwrap() > 0.0);
    assert!(BATCHES_PER_DAY.get("mint").unwrap() > 0.0);
}

#[test]
fn an_average_worker_gets_through_batches_per_day_a_game_day() {
    let (mut world, _, _) = setup(BuildingKind::Smelter);
    let per_day = BATCHES_PER_DAY.get("smelter").unwrap();
    let tick = world.tick as f64;
    close(
        batch_work(&world.residents[0], BuildingKind::Smelter, tick) * TICKS_PER_GAME_DAY,
        per_day,
    );
    world.residents[0].skills.insert(SkillName::Smelting, 10.0);
    assert!(
        batch_work(&world.residents[0], BuildingKind::Smelter, tick) * TICKS_PER_GAME_DAY > per_day
    );
}

#[test]
fn smelter_and_mint_make_iron_and_coins() {
    let (smelter, _, _) = setup(BuildingKind::Smelter);
    let (mint, _, _) = setup(BuildingKind::Mint);
    assert_eq!(workplace_good(&smelter, &smelter.buildings[0], None), Some(Good::Iron));
    assert_eq!(workplace_good(&mint, &mint.buildings[0], None), Some(Good::Coins));
}

#[test]
fn a_smelter_turns_the_iron_ore_its_worker_carries_into_iron_on_its_pile_and_teaches_smelting() {
    let (mut world, t, _) = setup(BuildingKind::Smelter);
    world.residents[0].carried.insert(Good::IronOre, 10.0);
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize + 2);
    let batches = BATCHES_PER_DAY.get("smelter").unwrap();
    assert_eq!(
        pile_at(&world, 2, 2).and_then(|p| p.goods.get(&Good::Iron)).copied(),
        Some(batches)
    );
    let r = &world.residents[0];
    assert_eq!(r.carried.get(&Good::Iron).copied().unwrap_or(0.0), 0.0);
    assert_eq!(r.carried.get(&Good::IronOre).copied(), Some(10.0 - 2.0 * batches));
    assert!((skill_of(r, SkillName::Smelting) - WORK_SKILL_PER_DAY).abs() < 0.005);
    assert_sound(&world, &t);
}

#[test]
fn a_mint_turns_gold_ore_lying_on_its_tile_into_coins_left_there() {
    let (mut world, t, _) = setup(BuildingKind::Mint);
    world.piles.push(Pile {
        id: "p1".into(),
        x: 2.0,
        y: 2.0,
        goods: Stock::from([(Good::GoldOre, 1.0)]),
    });
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize);
    assert_eq!(world.residents[0].carried.get(&Good::Coins).copied().unwrap_or(0.0), 0.0);
    assert_eq!(world.piles.len(), 1);
    assert_eq!(world.piles[0].goods, Stock::from([(Good::Coins, 10.0)]));
    assert_sound(&world, &t);
}

#[test]
fn stands_idle_without_ore_no_work_nothing_learned() {
    let (mut world, t, _) = setup(BuildingKind::Smelter);
    world.residents[0].carried.insert(Good::IronOre, 1.0);
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize);
    let r = &world.residents[0];
    match &r.order {
        Some(csp_shared::world::ResidentOrder::WorkAt(o)) => assert_eq!(o.progress, 0.0),
        other => panic!("not working: {other:?}"),
    }
    assert_eq!(skill_of(r, SkillName::Smelting), 0.0);
    assert_eq!(r.carried, Stock::from([(Good::IronOre, 1.0)]));
}

#[test]
fn uses_up_the_workers_ore_first_then_the_pile_and_conserves_goods_by_the_recipe() {
    let (mut world, t, mut orders) = setup(BuildingKind::Smelter);
    let helpers: Vec<usize> = (0..WORKPLACE_MAX_WORKERS.get("smelter").unwrap() as usize - 1)
        .map(|i| resident_at_work(&mut world, &format!("h{i}")))
        .collect();
    for &h in &helpers {
        let id = world.residents[h].id.clone();
        let _ = orders.receive(&world, &me(), json!({ "kind": "workAt", "residentId": id }), &t);
    }
    orders.apply_all(&mut world, &t);
    world.residents[0].carried.insert(Good::IronOre, 3.0);
    world.residents[helpers[0]].carried.insert(Good::IronOre, 1.0);
    world.piles.push(Pile {
        id: "p1".into(),
        x: 2.0,
        y: 2.0,
        goods: Stock::from([(Good::IronOre, 20.0), (Good::Stone, 1.0)]),
    });
    let place = world.buildings[0].clone();
    assert_eq!(input_at(&world, &place), Stock::from([(Good::IronOre, 24.0)]));
    let ore = |w: &WorldState| total(w, Good::IronOre) + 2.0 * total(w, Good::Iron);
    for _ in 0..4 {
        run(&mut world, &t, TICKS_PER_GAME_DAY as usize / 2);
        assert_eq!(ore(&world), 24.0);
        assert_sound(&world, &t);
    }
    assert!(total(&world, Good::Iron) > 0.0);
    assert_eq!(world.residents[0].carried.get(&Good::IronOre).copied().unwrap_or(0.0), 0.0);
    assert_eq!(
        world.residents[helpers[0]].carried.get(&Good::IronOre).copied().unwrap_or(0.0),
        0.0
    );
    assert_eq!(world.piles[0].goods.get(&Good::Stone).copied(), Some(1.0));
}

#[test]
fn a_smelter_a_mint_and_a_smithy_go_off_nodes_and_off_mountain() {
    for kind in [BuildingKind::Smelter, BuildingKind::Mint, BuildingKind::Smithy] {
        let t = terrain();
        let mut world = empty_world(&t);
        world.nodes.push(iron_ore_node());
        let lookup = Some(&t as &dyn TerrainLookup);
        assert_eq!(build_problem(&world, 2, 2, kind, lookup), None, "{kind:?}");
        assert!(
            build_problem(&world, 5, 5, kind, lookup).unwrap().contains("Mountain"),
            "{kind:?}"
        );
        assert!(
            build_problem(&world, 7, 5, kind, lookup).unwrap().contains("resource node"),
            "{kind:?}"
        );
    }
}

#[test]
fn the_invariant_catches_one_on_a_node_or_on_mountain() {
    let t = terrain();
    let mut world = empty_world(&t);
    world.nodes.push(iron_ore_node());
    world.buildings.push(building("a", BuildingKind::Smelter, 7.0, 5.0));
    world.buildings.push(building("b", BuildingKind::Mint, 5.0, 5.0));
    world.buildings.push(building("c", BuildingKind::Mint, 2.0, 2.0));
    let ids: Vec<Vec<String>> = world_invariants()
        .iter()
        .find(|i| i.name == "buildings-in-place")
        .unwrap()
        .check(&world, &t)
        .into_iter()
        .map(|v| v.entity_ids)
        .collect();
    assert_eq!(ids, vec![vec!["a".to_string()], vec!["b".to_string()]]);
}
