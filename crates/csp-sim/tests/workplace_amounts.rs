//! `apps/server/src/workplace-amounts.test.ts`. What a workplace's card says is made
//! (`CONTEXT.md`: Workplace amounts): a simulated worker at the skill's cap makes `madePerDay` a
//! game day, give or take a batch, at each kind of workplace.

mod build_common;

use build_common::{building, new_resident, player, realm};
use csp_shared::balance::{RECIPES, WORK_SKILL_MAX};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Pile, ResourceKind, ResourceNode, Stat, Stock};
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::balance::{made_per_day, workplace_skill};
use csp_sim::tick::Scratch;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use std::sync::Arc;

const DAYS: u64 = 10;

/// Plains, with Hills at (2, 2) for the mine on its node.
fn terrain() -> TerrainMap {
    let mut t = TerrainMap { size: 16, tiles: vec![Terrain::Plains as u8; 16 * 16] };
    t.tiles[2 * 16 + 2] = Terrain::Hills as u8;
    t
}

fn name_of(good: Good) -> String {
    serde_json::to_value(good).unwrap().as_str().unwrap().to_string()
}

fn good_named(name: &str) -> Good {
    serde_json::from_value(json!(name)).unwrap()
}

/// The recipe of `kind` that makes `good`, if the workplace has recipes.
fn recipe_for(kind: &str, good: Good) -> Option<&'static csp_shared::balance::Recipe> {
    let name = name_of(good);
    RECIPES.get(kind)?.iter().find(|r| r.output.get(&name).is_some())
}

fn a_worker_makes_that_much_a_game_day(
    kind_name: &str,
    kind: BuildingKind,
    good: Good,
    makes: Option<&str>,
) {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "w1"));
    if kind == BuildingKind::Mine {
        world.nodes.push(ResourceNode {
            id: "n1".into(),
            kind: ResourceKind::IronOre,
            x: 2.0,
            y: 2.0,
        });
    }
    world.buildings.push(building("b1", kind, 2.0, 2.0));
    // More than they use in the time, so they have what they need.
    if let Some(recipe) = recipe_for(kind_name, good) {
        let goods: Stock = recipe.input.0.iter().map(|(g, _)| (good_named(g), 10_000.0)).collect();
        world.piles.push(Pile { id: "p1".into(), x: 2.0, y: 2.0, goods });
    }
    let mut r = new_resident("w1", Some("r1"), 2.0, 2.0);
    r.stats.strength = Stat { base: 13.0, trained: 0.0 };
    // At the skill's cap, so what they learn at work doesn't change the pace meanwhile.
    r.skills.insert(workplace_skill(kind).expect("a workplace skill"), WORK_SKILL_MAX);
    world.residents.push(r);

    let mut queue = OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone())));
    let mut order = json!({ "kind": "workAt", "residentId": "w1" });
    if let Some(m) = makes {
        order["makes"] = json!(m);
    }
    let reply = queue.receive(&world, &player(7), &json!("q"), &order);
    assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
    queue.apply_all(&mut world);
    let order_of = |w: &csp_shared::world::WorldState| -> Value {
        serde_json::to_value(w.residents[0].order.as_ref().expect("an order")).unwrap()
    };
    assert_eq!(order_of(&world)["kind"], "workAt");
    assert_eq!(order_of(&world)["buildingId"], "b1");
    let per_day = made_per_day(&world.residents[0], kind, good, world.tick as f64);

    // What lands on the pile is taken off at once, so Food doesn't spoil before it is counted.
    let mut scratch = Scratch::default();
    let mut made = 0.0;
    for _ in 0..DAYS * TICKS_PER_GAME_DAY as u64 {
        world.residents[0].hunger = 100.0;
        step_world(&mut world, &terrain, &mut scratch, None, None);
        // `pileAt(world, 2, 2)`.
        if let Some(pile) = world.piles.iter_mut().find(|p| p.x == 2.0 && p.y == 2.0) {
            made += pile.goods.shift_remove(&good).unwrap_or(0.0);
        }
    }

    assert_eq!(order_of(&world)["kind"], "workAt");
    assert_eq!(order_of(&world)["buildingId"], "b1");
    // Whole units or batches at a time: up to a batch short of the pace, never over it.
    let batch =
        recipe_for(kind_name, good).and_then(|r| r.output.get(&name_of(good))).unwrap_or(1.0);
    let days = DAYS as f64;
    assert!(made <= per_day * days + 1e-6, "{kind_name}: made {made}, pace {per_day}/day");
    assert!(made >= per_day * days - batch - 1e-6, "{kind_name}: made {made}, pace {per_day}/day");
    assert!(per_day > 0.0);
}

#[test]
fn a_simulated_worker_at_a_farm_makes_that_much_food_a_game_day() {
    a_worker_makes_that_much_a_game_day("farm", BuildingKind::Farm, Good::Food, None);
}

#[test]
fn a_simulated_worker_at_a_mine_makes_that_much_iron_ore_a_game_day() {
    a_worker_makes_that_much_a_game_day("mine", BuildingKind::Mine, Good::IronOre, None);
}

#[test]
fn a_simulated_worker_at_a_smelter_makes_that_much_iron_a_game_day() {
    a_worker_makes_that_much_a_game_day("smelter", BuildingKind::Smelter, Good::Iron, None);
}

#[test]
fn a_simulated_worker_at_a_mint_makes_that_much_coins_a_game_day() {
    a_worker_makes_that_much_a_game_day("mint", BuildingKind::Mint, Good::Coins, None);
}

#[test]
fn a_simulated_worker_at_a_smithy_makes_that_much_sword_a_game_day() {
    a_worker_makes_that_much_a_game_day("smithy", BuildingKind::Smithy, Good::Sword, Some("sword"));
}
