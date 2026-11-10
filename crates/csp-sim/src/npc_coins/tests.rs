//! `npc-coins.test.ts`: a city with no way to earn Coins doesn't count them as short
//! (`CONTEXT.md`: NPC reserve, Full city; #996). Its war chest stays as it is for everything else.

use csp_shared::balance::{
    NPC_NODE_REACH, NPC_TOWN, NPC_TRADER_REACH, NPC_WAR_CHEST_PER_RESIDENT, TRADER_STOP_REACH,
};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityProject, Good, ResourceKind, ResourceNode, Stock, WorldState,
};
use serde_json::json;

use super::{coins_short_only_with_income, earns_coins};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_chain::short_goods;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::{far_stable_spot, next_project};
use crate::npc_plan::plan_city;
use crate::queries::city::city_residents;
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_prices, npc_reserve};
use crate::random::Mulberry32;
use crate::test_support::{building, plains};
use crate::trade_org::found_trade_org_hq;
use crate::traders::place_traders;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

/// Everything a town's reserve wants but Coins, with none of them.
fn all_but_coins() -> Stock {
    Stock::from([
        (Good::Food, 3000.0),
        (Good::Wood, 800.0),
        (Good::Stone, 800.0),
        (Good::Iron, 200.0),
        (Good::Spear, 20.0),
        (Good::Coins, 0.0),
    ])
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

fn home(world: &WorldState, id: &str) -> Building {
    npc_home(world, id).expect("a storage").clone()
}

fn set_home_stock(world: &mut WorldState, id: &str, stock: Stock) {
    let home = home(world, id).id;
    world.buildings.iter_mut().find(|b| b.id == home).unwrap().stock = Some(stock);
}

/// A town at (x, y) on `world`, its storage full of all its reserve wants but Coins, and none of
/// those, with its stable, so nothing is left to build but a daughter (`brokeTown`).
fn broke_town(world: &mut WorldState, terrain: &TerrainMap, x: i32, y: i32) -> String {
    let mut m = Mulberry32::new(5.0);
    let id = found_npc_city(world, terrain, &NPC_TOWN, x, y, &mut || m.next(), None);
    set_home_stock(world, &id, all_but_coins());
    let h = home(world, &id);
    let (sx, sy) = far_stable_spot(world, city(world, &id), &h, terrain).expect("a spot");
    let stable = building(
        &format!("stable-{id}"),
        BuildingKind::Stable,
        Some(&id),
        f64::from(sx),
        f64::from(sy),
    );
    world.buildings.push(stable);
    id
}

/// A town alone on a Plains map, nothing short but Coins (`aloneBroke`).
fn alone_broke(size: i32) -> (WorldState, TerrainMap, String) {
    let terrain = plains(size);
    let mut world = create_world(&terrain, 1);
    let id = broke_town(&mut world, &terrain, 60, 60);
    (world, terrain, id)
}

/// Puts a gold node on Hills at (x, y) (`goldNode`).
fn gold_node(world: &mut WorldState, terrain: &mut TerrainMap, x: f64, y: f64) {
    world.nodes.push(ResourceNode {
        id: format!("gold{x},{y}"),
        kind: ResourceKind::GoldOre,
        x,
        y,
    });
    terrain.tiles[tile_index(terrain.size, x as i32, y as i32)] = Terrain::Hills as u8;
}

fn short(world: &WorldState, terrain: &TerrainMap, id: &str) -> Vec<Good> {
    short_goods(world, city(world, id), terrain.size, None)
}

fn earns(world: &WorldState, terrain: &TerrainMap, id: &str) -> bool {
    earns_coins(world, city(world, id), terrain.size)
}

// a city with no way to earn Coins

#[test]
fn counts_as_full_once_nothing_else_is_short_though_its_coins_are_under_its_war_chest() {
    let (mut world, terrain, id) = alone_broke(300);
    plan_city(&mut world, &id, Some(&terrain), None, None);
    assert_eq!(world.city_plans[&id].full_since, Some(world.tick as f64));
}

#[test]
fn does_not_count_coins_as_short_nor_build_for_them() {
    let (world, terrain, id) = alone_broke(300);
    assert!(!earns(&world, &terrain, &id));
    assert_eq!(short(&world, &terrain, &id), []);
    let project = next_project(&world, city(&world, &id), &home(&world, &id), &terrain);
    assert!(!matches!(project, Some(CityProject::Build { building: BuildingKind::Mint, .. })));
}

#[test]
fn keeps_its_war_chest_for_everything_else_its_reserve_and_what_it_sells() {
    let (world, _, id) = alone_broke(300);
    let c = city(&world, &id);
    let residents = city_residents(&world, &id).iter().filter(|r| r.health > 0.0).count();
    let reserve = npc_reserve(&world, c);
    assert_eq!(held(&reserve, Good::Coins), residents as f64 * NPC_WAR_CHEST_PER_RESIDENT);
    // Its prices still read its reserve, war chest and all: none of it is for sale.
    let prices = npc_city_prices(&world, c, None);
    let wood = prices.iter().find(|p| p.good == Good::Wood).expect("wood");
    assert_eq!(wood.for_sale, 800.0 - held(&reserve, Good::Wood));
}

#[test]
fn still_counts_what_else_it_lacks_as_short() {
    let (mut world, terrain, id) = alone_broke(300);
    let mut stock = all_but_coins();
    stock.insert(Good::Wood, 0.0);
    set_home_stock(&mut world, &id, stock);
    assert_eq!(short(&world, &terrain, &id), [Good::Wood]);
}

#[test]
fn keeps_the_coins_short_sound_invariant() {
    let (world, terrain, _) = alone_broke(300);
    assert_eq!(coins_short_only_with_income(&world, terrain.size), []);
    assert_eq!(check_all(&world, &terrain), []);
}

// a city with gold or a mint of its own

#[test]
fn counts_coins_as_short_with_a_mint_of_its_own_finished_or_begun() {
    for site in [false, true] {
        let (mut world, terrain, id) = alone_broke(300);
        let h = home(&world, &id);
        let mut mint = building("mint0", BuildingKind::Mint, Some(&id), h.x + 6.0, h.y + 6.0);
        if site {
            mint.site =
                Some(serde_json::from_value(json!({ "delivered": {}, "work": 0 })).unwrap());
        }
        world.buildings.push(mint);
        assert!(earns(&world, &terrain, &id));
        assert_eq!(short(&world, &terrain, &id), [Good::Coins]);
    }
}

#[test]
fn counts_coins_as_short_with_gold_ore_in_its_storage() {
    let (mut world, terrain, id) = alone_broke(300);
    let mut stock = all_but_coins();
    stock.insert(Good::GoldOre, 1.0);
    set_home_stock(&mut world, &id, stock);
    assert_eq!(short(&world, &terrain, &id), [Good::Coins]);
}

#[test]
fn counts_coins_as_short_with_a_gold_node_it_knows_of_not_one_out_of_its_knowing() {
    let (mut world, mut terrain, id) = alone_broke(2048);
    let h = home(&world, &id);
    gold_node(&mut world, &mut terrain, h.x + NPC_NODE_REACH + 200.0, h.y);
    assert!(!earns(&world, &terrain, &id));
    gold_node(&mut world, &mut terrain, h.x + NPC_NODE_REACH - 10.0, h.y);
    assert!(earns(&world, &terrain, &id));
    assert_eq!(short(&world, &terrain, &id), [Good::Coins]);
}

#[test]
fn counts_coins_as_short_with_a_gold_mine_of_its_own() {
    let (mut world, mut terrain, id) = alone_broke(2048);
    let h = home(&world, &id);
    let far = (h.x + NPC_NODE_REACH + 200.0, h.y);
    gold_node(&mut world, &mut terrain, far.0, far.1);
    world.buildings.push(building("mine0", BuildingKind::Mine, Some(&id), far.0, far.1));
    assert!(earns(&world, &terrain, &id));
}

// trade in reach

#[test]
fn a_trade_org_warehouse_within_its_traders_reach_across_the_maps_join_too_not_past_it() {
    let terrain = plains(2048);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    found_trading_post(&mut world, &terrain, 1000, 1000, None, &mut || m.next());
    let reach = NPC_TRADER_REACH as i32;
    let near = broke_town(&mut world, &terrain, 1000 + reach - 60, 1000);
    let far = broke_town(&mut world, &terrain, 1000 - reach - 60, 1000);
    assert!(earns(&world, &terrain, &near));
    assert_eq!(short(&world, &terrain, &near), [Good::Coins]);
    assert!(!earns(&world, &terrain, &far));
    assert_eq!(short(&world, &terrain, &far), []);

    let across = plains(2048);
    let mut other = create_world(&across, 1);
    let mut m = Mulberry32::new(7.0);
    found_trading_post(&mut other, &across, 30, 1000, None, &mut || m.next());
    let over = broke_town(&mut other, &across, 2048 - reach + 120, 1000);
    assert!(earns(&other, &across, &over));
}

#[test]
fn a_wandering_trader_whose_loop_passes_it_within_a_stops_reach_not_one_passing_further_off() {
    let terrain = plains(3200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    found_trade_org_hq(&mut world, &terrain, 100, 500, &mut rand);
    found_trading_post(&mut world, &terrain, 1600, 500, None, &mut rand);
    place_traders(&mut world, terrain.size);
    // Halfway between the two, past every warehouse's reach.
    let stop = TRADER_STOP_REACH as i32;
    let by = broke_town(&mut world, &terrain, 850, 500 + stop - 60);
    let off = broke_town(&mut world, &terrain, 850, 500 + stop + 300);
    assert!(earns(&world, &terrain, &by));
    assert_eq!(short(&world, &terrain, &by), [Good::Coins]);
    assert!(!earns(&world, &terrain, &off));

    world.traders.clear();
    assert!(!earns(&world, &terrain, &by));
}
