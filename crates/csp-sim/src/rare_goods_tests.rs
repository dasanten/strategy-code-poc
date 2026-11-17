//! Rare goods (`CONTEXT.md`: Rare goods, ADR 0035): gold ore has no nodes in a heartland, only in
//! the frontier and on islands, and a heartland realm gets its Coins by trade.

use std::collections::HashSet;

use csp_shared::balance::{
    CARRIAGE_CAPACITY, NPC_VILLAGE, RECIPES, START_COINS, START_RESIDENTS, WORK_OUTPUT_PER_DAY,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, ResourceKind, ResourceNode, Stock, TradeOrgCity, TradeSide, WorldState,
};

use super::*;
use crate::npc_behaviour::npc_home;
use crate::npc_chain::short_goods;
use crate::npc_cities::found_npc_city;
use crate::npc_coins::earns_coins;
use crate::npc_plan::plan_city;
use crate::npc_scouts::knows_node;
use crate::npc_test_world::Runner;
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::{npc_reserve, NPC_SMITHY_WEAPON};
use crate::queries::warehouse_trade::{quote_trade, TradeHolder};
use crate::random::Mulberry32;
use crate::regions::{RegionKind, Regions};
use crate::starting_sites::free_starting_sites;
use crate::terrain_gen::generate_terrain;
use crate::test_support::{new_land, world_with_post};
use crate::world::generate_world;

/// The regions the nodes of `kind` lie in.
fn regions_with(nodes: &[ResourceNode], regions: &Regions, kind: ResourceKind) -> HashSet<u32> {
    nodes
        .iter()
        .filter(|n| n.kind == kind)
        .filter_map(|n| regions.id_at(n.x as i32, n.y as i32))
        .collect()
}

/// On one generated map: no gold or coal node in a heartland, every frontier region with one of
/// each in it or next to it, and the heartlands still with their iron.
fn assert_gold_lies_out_there(seed: i64) {
    let terrain = generate_terrain(seed, 1536);
    let regions = Regions::of(seed, &terrain);
    let nodes = place_resource_nodes_by_region(&terrain, seed, &regions);
    let kind_of = |id: &u32| regions.regions[*id as usize].kind;
    let next = regions.next_to();
    for kind in RARE_KINDS {
        let rare = regions_with(&nodes, &regions, kind);
        assert!(rare.iter().all(|id| kind_of(id) != RegionKind::Heartland), "{seed} {kind:?}");
        for r in regions.of_kind(RegionKind::Frontier) {
            assert!(
                rare.contains(&r.id) || next[r.id as usize].iter().any(|n| rare.contains(n)),
                "seed {seed}: frontier {} has no {kind:?} of its own nor next to it",
                r.name
            );
        }
    }
    let iron = regions_with(&nodes, &regions, ResourceKind::IronOre);
    assert!(iron.iter().any(|id| kind_of(id) == RegionKind::Heartland), "seed {seed}");
}

#[test]
fn no_gold_node_lies_in_a_heartland_and_every_frontier_has_gold_in_it_or_next_to_it_seed_1() {
    assert_gold_lies_out_there(1);
}

#[test]
fn no_gold_node_lies_in_a_heartland_and_every_frontier_has_gold_in_it_or_next_to_it_seed_2() {
    assert_gold_lies_out_there(2);
}

#[test]
fn no_gold_node_lies_in_a_heartland_and_every_frontier_has_gold_in_it_or_next_to_it_seed_3() {
    assert_gold_lies_out_there(3);
}

#[test]
fn a_kind_that_is_not_rare_may_lie_anywhere_gold_only_out_there() {
    for region in [RegionKind::Heartland, RegionKind::Frontier, RegionKind::Island] {
        for kind in [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre] {
            assert!(allowed_in(kind, region));
        }
        assert_eq!(allowed_in(ResourceKind::GoldOre, region), region != RegionKind::Heartland);
    }
}

/// The generated world, with Player 1's starting city: no gold node in a heartland, not even one
/// placed for a starting site, and the Trade Org HQ still has its gold mine, out in the frontier,
/// and its mint. Player 1's storage holds their Coins.
#[test]
fn a_generated_world_has_no_gold_in_a_heartland_the_hq_mines_it_out_there_a_new_city_holds_coins() {
    let (world, terrain) = world_with_post();
    let regions = Regions::of(world.seed, &terrain);
    let region_kind = |x: f64, y: f64| regions.region_at(x as i32, y as i32).map(|r| r.kind);
    let gold: Vec<&ResourceNode> =
        world.nodes.iter().filter(|n| n.kind == ResourceKind::GoldOre).collect();
    assert!(!gold.is_empty());
    assert!(gold.iter().all(|n| region_kind(n.x, n.y) != Some(RegionKind::Heartland)));

    let hq = world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq)).expect("the HQ");
    let workplaces: Vec<_> = world
        .buildings
        .iter()
        .filter(|b| hq.workplace_ids.as_ref().is_some_and(|ids| ids.contains(&b.id)))
        .collect();
    let gold_mine = workplaces
        .iter()
        .find(|b| {
            b.kind == BuildingKind::Mine
                && gold.iter().any(|n| is_at((n.x as i32, n.y as i32), placed(b), terrain.size))
        })
        .expect("a gold mine");
    assert_ne!(region_kind(gold_mine.x, gold_mine.y), Some(RegionKind::Heartland));
    assert!(workplaces.iter().any(|b| b.kind == BuildingKind::Mint));

    let storage = player_storage(&world);
    assert_eq!(region_kind(storage.x, storage.y), Some(RegionKind::Heartland));
    assert_eq!(held(storage.stock.as_ref().expect("a stock"), Good::Coins), START_COINS);
}

/// Player 1's starting city's storage.
fn player_storage(world: &WorldState) -> &csp_shared::world::Building {
    let city = world.cities.iter().find(|c| c.realm_id.is_some()).expect("Player 1's city");
    world
        .buildings
        .iter()
        .find(|b| b.city_id.as_ref() == Some(&city.id) && b.kind == BuildingKind::Storage)
        .expect("a storage")
}

/// The Coins the gold ore one miner digs in a game day is minted into.
fn a_days_gold() -> f64 {
    let mint = RECIPES.get("mint").expect("a mint")[0];
    let per_ore =
        mint.output.get("coins").expect("coins") / mint.input.get("goldOre").expect("ore");
    WORK_OUTPUT_PER_DAY.get("goldOre").expect("gold ore") * per_ore
}

/// A carriage load of Food, Wood, Stone or Iron sold at a heartland's trading post brings home
/// more Coins than the whole starting city would make in a day if each of them mined gold
/// (`CONTEXT.md`: Rare goods): hauling there is worth a day's work.
#[test]
fn a_carriage_load_sold_at_the_heartlands_trading_post_is_worth_more_than_a_days_work() {
    let (world, terrain) = world_with_post();
    let storage = player_storage(&world);
    let at = (storage.x as i32, storage.y as i32);
    let warehouse = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Warehouse
                && world.cities.iter().any(|c| {
                    Some(&c.id) == b.city_id.as_ref() && c.trade_org == Some(TradeOrgCity::Post)
                })
        })
        .min_by_key(|b| wrap_distance(terrain.size, at, (b.x as i32, b.y as i32)) as i64)
        .expect("a trading post");
    let regions = Regions::of(world.seed, &terrain);
    let region = |x: i32, y: i32| regions.id_at(x, y);
    assert_eq!(region(warehouse.x as i32, warehouse.y as i32), region(at.0, at.1));
    let day = START_RESIDENTS * a_days_gold();
    for good in [Good::Food, Good::Wood, Good::Stone, Good::Iron] {
        let load: Stock = [(good, CARRIAGE_CAPACITY)].into_iter().collect();
        let holder = TradeHolder { stock: &load, room: CARRIAGE_CAPACITY };
        let q = quote_trade(
            &world,
            warehouse,
            holder,
            TradeSide::Sell,
            good,
            CARRIAGE_CAPACITY,
            0.0,
            &[],
        );
        assert!(q.coins > day, "{good:?}: {} Coins for {} units, a day is {day}", q.coins, q.units);
    }
}

/// A heartland's NPC village has no gold node it knows of, so it can earn Coins only by trade
/// (`CONTEXT.md`: NPC reserve): a trading post is in reach, Coins under its war chest count as
/// short, and its trader sells its surplus there and brings Coins home.
#[test]
fn a_heartland_npc_village_fills_its_war_chest_by_trade() {
    let terrain = new_land();
    let mut world = generate_world(terrain, 1);
    let regions = Regions::of(world.seed, terrain);
    let size = terrain.size;
    let in_heartland = |b: &csp_shared::world::Building| {
        regions.region_at(b.x as i32, b.y as i32).map(|r| r.kind) == Some(RegionKind::Heartland)
    };
    let generated = world.cities.iter().find(|c| {
        c.realm_id.is_none()
            && c.trade_org.is_none()
            && npc_home(&world, &c.id).is_some_and(in_heartland)
    });
    // A map this small leaves no room for the heartland villages the generator places on a full
    // one: found one on the free starting site nearest a heartland's middle, where its post is.
    let village_id = match generated {
        Some(c) => c.id.clone(),
        None => {
            let heartland = regions.of_kind(RegionKind::Heartland).next().expect("a heartland");
            let site = free_starting_sites(&world, heartland.id).next().expect("a site").clone();
            let mut m = Mulberry32::new(7.0);
            found_npc_city(
                &mut world,
                terrain,
                &NPC_VILLAGE,
                site.x,
                site.y,
                &mut || m.next(),
                None,
            )
        }
    };
    let village = world.cities.iter().find(|c| c.id == village_id).expect("the village").clone();
    assert!(npc_home(&world, &village.id).is_some_and(in_heartland));
    let home = npc_home(&world, &village.id).expect("a home").clone();
    let home_at = (home.x as i32, home.y as i32);
    assert!(!world.nodes.iter().any(|n| n.kind == ResourceKind::GoldOre
        && knows_node(&village, home_at, (n.x as i32, n.y as i32), size)));
    assert!(earns_coins(&world, &village, size));

    // Its reserve and 60 Wood over it, its weapons, and no Coins.
    let reserve = npc_reserve(&world, &village);
    assert!(held(&reserve, Good::Coins) > 0.0);
    let mut stock = reserve.clone();
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + 60.0);
    stock.insert(NPC_SMITHY_WEAPON, held(&reserve, NPC_SMITHY_WEAPON));
    stock.insert(Good::Coins, 0.0);
    let storage = world.buildings.iter().position(|b| b.id == home.id).expect("the storage");
    world.buildings[storage].stock = Some(stock);
    assert!(short_goods(&world, &village, size, None).contains(&Good::Coins));

    // It sends a trader with its Wood to its heartland's trading post, to bring Coins home.
    plan_city(&mut world, &village.id, Some(terrain), None, None);
    let runs = |w: &WorldState| w.city_plans.get(&village.id).and_then(|p| p.traders.clone());
    let run = runs(&world).and_then(|r| r.into_iter().next()).expect("a trader sent");
    assert!(run.buys.is_empty() && held(&run.sells, Good::Wood) > 0.0, "{run:?}");
    let warehouse = world
        .buildings
        .iter()
        .find(|b| Some(&b.id) == run.warehouse_id.as_ref())
        .expect("the warehouse");
    let region = |b: &csp_shared::world::Building| regions.id_at(b.x as i32, b.y as i32);
    assert_eq!(region(warehouse), region(&home));
    let post = warehouse.city_id.clone().expect("a post");

    // Just the village and that post, so a game day runs fast.
    let keep: HashSet<String> = [village.id.clone(), post].into_iter().collect();
    let kept = |id: &Option<String>| id.as_ref().is_some_and(|id| keep.contains(id));
    world.cities.retain(|c| keep.contains(&c.id));
    world.buildings.retain(|b| kept(&b.city_id));
    world.residents.retain(|r| kept(&r.city_id));
    world.city_plans.retain(|id, _| keep.contains(id));
    (world.caravans, world.traders, world.horses, world.carriages) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut runner = Runner::new(terrain);
    let day = TICKS_PER_GAME_DAY as usize;
    for _ in 0..15 * day {
        runner.step(&mut world, terrain);
        if runs(&world).is_none_or(|r| r.is_empty()) {
            break;
        }
    }
    assert!(runs(&world).is_none_or(|r| r.is_empty()), "the trader is still out");
    let storage = world.buildings.iter().find(|b| b.id == home.id).expect("the storage");
    let coins = held(storage.stock.as_ref().expect("a stock"), Good::Coins);
    assert!(coins > 0.0, "the trader brought no Coins home");
}
