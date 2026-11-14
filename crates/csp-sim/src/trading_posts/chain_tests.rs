//! `apps/server/src/trading-post-chain.test.ts`, ported one to one: trading posts and the HQ run
//! the chain (`CONTEXT.md`: Trading post, Trade Org HQ): their warehouses' stock floor is their
//! reserve, their spare hands work and build for what is short of it, and the output goes into the
//! warehouse.

use std::sync::Arc;

use csp_shared::balance::{NPC_VILLAGE, OWN_FOOD, WAREHOUSE_FLOOR};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    CityJobKind, CityProject, Good, Resident, ResidentOrder, Task, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::hq_growth::hq_project;
use crate::invariants::check_all;
use crate::npc_behaviour::{npc_home, step_npc_cities};
use crate::npc_chain::{short_goods, trade_org_reserve, warehouse_for};
use crate::npc_plan::{plan_city, trade_org_sends_no_one};
use crate::queries::city_area::free_housing;
use crate::queries::names::held;
use crate::queries::residents::can_work;
use crate::queries::warehouse::warehouse_keeps;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn order_of(v: Value) -> ResidentOrder {
    serde_json::from_value(v).unwrap()
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

/// The warehouse of `city`, by index.
fn warehouse(world: &WorldState, city: &str) -> usize {
    world
        .buildings
        .iter()
        .position(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(city))
        .unwrap()
}

/// A trading post alone on a Plains map, its warehouse at its floor but for no Iron ore.
fn post(ore: bool) -> (WorldState, TerrainMap, String) {
    let mut terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(3.0);
    let c = found_trading_post(&mut world, &terrain, 40, 40, None, &mut || m.next());
    if ore {
        let home = npc_home(&world, &c).unwrap();
        let (x, y) = (home.x + 30.0, home.y);
        world.nodes.push(
            serde_json::from_value(json!({ "id": "n-ore", "kind": "ironOre", "x": x, "y": y }))
                .unwrap(),
        );
        terrain.tiles[tile_index(terrain.size, x as i32, y as i32)] = Terrain::Hills as u8;
    }
    let mut floor: Stock =
        WAREHOUSE_FLOOR.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))).collect();
    floor.insert(Good::IronOre, 0.0);
    floor.insert(Good::Wood, 200.0);
    floor.insert(Good::Stone, 200.0);
    let w = warehouse(&world, &c);
    world.buildings[w].stock = Some(floor);
    (world, terrain, c)
}

fn floor_of(name: &str) -> f64 {
    WAREHOUSE_FLOOR.get(name).unwrap()
}

// a trading post runs the chain for its warehouse

#[test]
fn is_short_of_what_its_warehouse_lacks_of_its_floor_food_aside() {
    let (world, terrain, c) = post(false);
    let reserve = trade_org_reserve(&world, city(&world, &c));
    assert_eq!(held(&reserve, Good::IronOre), floor_of("ironOre"));
    assert_eq!(held(&reserve, Good::Coins), floor_of("coins"));
    assert!(!reserve.contains_key(&Good::Food));
    assert_eq!(short_goods(&world, city(&world, &c), terrain.size, None)[0], Good::IronOre);
    // Its loads go to the warehouse, its Food to the storage its residents eat from.
    let w = warehouse(&world, &c);
    assert_eq!(
        warehouse_for(&world, city(&world, &c), &[Good::IronOre]).map(|b| b.id.clone()),
        Some(world.buildings[w].id.clone())
    );
    assert!(warehouse_for(&world, city(&world, &c), &[Good::Food]).is_none());
}

#[test]
fn with_no_node_in_reach_builds_nothing_and_its_warehouse_is_left_to_what_is_brought() {
    let (mut world, terrain, c) = post(false);
    plan_city(&mut world, &c, Some(&terrain), None, None);
    let plan = world.city_plans.get(&c).unwrap();
    assert_eq!(plan.project, None);
    assert!(!plan.jobs.values().any(|j| matches!(j.kind, CityJobKind::Trade | CityJobKind::Found)));
}

#[test]
fn with_an_iron_node_in_reach_builds_a_mine_and_its_ore_goes_into_the_warehouse() {
    let (mut world, terrain, c) = post(true);
    let store = warehouse(&world, &c);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let storage = npc_home(&world, &c).unwrap().id.clone();
    plan_city(&mut world, &c, Some(&terrain), None, None);
    assert!(matches!(
        world.city_plans.get(&c).unwrap().project,
        Some(CityProject::Build { building: BuildingKind::Mine, .. })
    ));
    let ore = |w: &WorldState| held_in(w.buildings[store].stock.as_ref(), Good::IronOre);
    let mut run =
        |world: &mut WorldState, days: usize, done: &dyn Fn(&WorldState) -> bool, buyer: bool| {
            for _ in 0..days {
                if done(world) {
                    break;
                }
                for _ in 0..TICKS_PER_GAME_DAY as usize {
                    if done(world) {
                        break;
                    }
                    let morning = world.tick as f64 % TICKS_PER_GAME_DAY == 0.0;
                    if buyer && morning && ore(world) <= floor_of("ironOre") {
                        world.buildings[store]
                            .stock
                            .get_or_insert_with(Stock::new)
                            .insert(Good::IronOre, 0.0);
                    }
                    step_world(world, &terrain, &mut scratch, Some(&mut walking), None);
                }
                assert_eq!(check_all(world, &terrain), vec![]);
            }
        };
    let mine = |w: &WorldState| {
        w.buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Mine && b.site.is_none())
            .map(|b| b.id.clone())
    };
    run(&mut world, 20, &|w| mine(w).is_some(), false);
    let ids = city(&world, &c).workplace_ids.clone().unwrap_or_default();
    assert!(mine(&world).is_some_and(|m| ids.contains(&m)));
    // Nothing tops the warehouse up: it holds Iron ore only by what its miners brought.
    run(&mut world, 30, &|w| ore(w) > floor_of("ironOre"), true);
    assert!(ore(&world) > floor_of("ironOre"));
    let st = world.buildings.iter().find(|b| b.id == storage).unwrap();
    assert_eq!(held_in(st.stock.as_ref(), Good::IronOre), 0.0);
    assert_eq!(world.cities.len(), 1);
}

// an idle resident of a Trade Org city puts their load away

/// One of the city's adults, made idle at the city's storage, holding `carried`. Returns its id.
fn idle(world: &mut WorldState, c: &str, carried: Stock) -> String {
    let home = npc_home(world, c).unwrap();
    let (hx, hy) = (home.x, home.y);
    let tick = world.tick as f64;
    let r = world
        .residents
        .iter_mut()
        .find(|x| {
            x.city_id.as_deref() == Some(c) && can_work(x.born_at, tick) && x.carrying.is_none()
        })
        .unwrap();
    r.x = hx;
    r.y = hy;
    r.order = None;
    r.carried = carried;
    r.script = None;
    r.id.clone()
}

fn res<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

/// Runs the world until `done`, checking the invariants as it goes.
fn run_until(world: &mut WorldState, terrain: &TerrainMap, done: &dyn Fn(&WorldState) -> bool) {
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for t in 0..400 {
        if done(world) {
            break;
        }
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
        if t % 25 == 0 {
            assert_eq!(check_all(world, terrain), vec![]);
        }
    }
    assert!(done(world));
    assert_eq!(check_all(world, terrain), vec![]);
}

/// The Trade Org HQ alone on a Plains map, with its coin and its goods warehouse (indices).
fn hq() -> (WorldState, TerrainMap, String, usize, usize) {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let c = crate::trade_org::found_trade_org_hq(&mut world, &terrain, 320, 320, &mut || m.next());
    let keeping = |w: &WorldState, g: Good| {
        w.buildings
            .iter()
            .position(|b| b.city_id.as_ref() == Some(&c) && warehouse_keeps(w, b).contains(&g))
            .unwrap()
    };
    let (goods, coins) = (keeping(&world, Good::Iron), keeping(&world, Good::Coins));
    (world, terrain, c, goods, coins)
}

#[test]
fn a_posts_soldier_takes_iron_to_the_warehouse_and_keeps_their_weapon_and_food() {
    let (mut world, terrain, c) = post(false);
    let store = warehouse(&world, &c);
    let iron = held_in(world.buildings[store].stock.as_ref(), Good::Iron);
    let r = idle(
        &mut world,
        &c,
        stock(&[
            (Good::Spear, 1.0),
            (Good::Shield, 1.0),
            (Good::Iron, 10.0),
            (Good::Food, OWN_FOOD),
        ]),
    );
    let id = r.clone();
    run_until(&mut world, &terrain, &move |w| !res(w, &id).carried.contains_key(&Good::Iron));
    assert_eq!(held_in(world.buildings[store].stock.as_ref(), Good::Iron), iron + 10.0);
    let r = res(&world, &r);
    assert_eq!(held(&r.carried, Good::Spear), 1.0);
    assert_eq!(held(&r.carried, Good::Shield), 1.0);
    assert!(held(&r.carried, Good::Food) > 0.0);
    assert_eq!(held_in(npc_home(&world, &c).unwrap().stock.as_ref(), Good::Iron), 0.0);
}

#[test]
fn the_hqs_soldier_takes_iron_to_its_goods_warehouse() {
    let (mut world, terrain, c, goods, _) = hq();
    let iron = held_in(world.buildings[goods].stock.as_ref(), Good::Iron);
    let r = idle(
        &mut world,
        &c,
        stock(&[(Good::Spear, 1.0), (Good::Iron, 10.0), (Good::Food, OWN_FOOD)]),
    );
    let id = r.clone();
    run_until(&mut world, &terrain, &move |w| !res(w, &id).carried.contains_key(&Good::Iron));
    assert_eq!(held_in(world.buildings[goods].stock.as_ref(), Good::Iron), iron + 10.0);
    assert_eq!(held(&res(&world, &r).carried, Good::Spear), 1.0);
    assert_eq!(held_in(npc_home(&world, &c).unwrap().stock.as_ref(), Good::Iron), 0.0);
}

#[test]
fn materials_go_to_the_warehouse_coins_to_the_coin_warehouse_spare_food_to_the_storage() {
    let (mut world, terrain, c, goods, coins) = hq();
    let wood_before = held_in(world.buildings[goods].stock.as_ref(), Good::Wood);
    let coins_before = held_in(world.buildings[coins].stock.as_ref(), Good::Coins);
    let storage = npc_home(&world, &c).unwrap().id.clone();
    let st = |w: &WorldState| w.buildings.iter().find(|b| b.id == storage).unwrap().stock.clone();
    let food = held_in(st(&world).as_ref(), Good::Food);
    let r = idle(
        &mut world,
        &c,
        stock(&[(Good::Wood, 6.0), (Good::Coins, 5.0), (Good::Food, OWN_FOOD + 3.0)]),
    );
    let id = r.clone();
    run_until(&mut world, &terrain, &move |w| {
        let c = &res(w, &id).carried;
        held(c, Good::Wood) == 0.0 && held(c, Good::Coins) == 0.0 && held(c, Good::Food) <= OWN_FOOD
    });
    assert_eq!(held_in(world.buildings[goods].stock.as_ref(), Good::Wood), wood_before + 6.0);
    assert_eq!(held_in(world.buildings[coins].stock.as_ref(), Good::Coins), coins_before + 5.0);
    assert_eq!(held_in(world.buildings[goods].stock.as_ref(), Good::Coins), 0.0);
    assert_eq!(held_in(st(&world).as_ref(), Good::Wood), 0.0);
    assert!(held_in(st(&world).as_ref(), Good::Food) > food);
}

#[test]
fn a_worker_keeps_the_input_of_the_workplace_they_go_to_process_at() {
    let (mut world, _, c, goods, _) = hq();
    let smelter =
        world.buildings.iter().find(|b| b.kind == BuildingKind::Smelter).unwrap().id.clone();
    let r = idle(&mut world, &c, stock(&[(Good::IronOre, 4.0), (Good::Iron, 3.0)]));
    let (gx, gy, gid) =
        (world.buildings[goods].x, world.buildings[goods].y, world.buildings[goods].id.clone());
    let res_mut = world.residents.iter_mut().find(|x| x.id == r).unwrap();
    res_mut.x = gx;
    res_mut.y = gy;
    world.city_plans.insert(
        c.clone(),
        serde_json::from_value(json!({
            "plannedAt": 0, "jobs": { r.clone(): { "kind": "work", "buildingId": smelter } },
        }))
        .unwrap(),
    );
    step_npc_cities(&mut world, 640, None, None);
    let want = order_of(json!({
        "kind": "drop", "to": { "kind": "storage", "storageId": gid }, "goods": { "iron": 3 },
    }));
    assert_eq!(res(&world, &r).order, Some(want));
}

#[test]
fn a_resident_with_a_site_to_bring_iron_to_brings_it_there_first() {
    let (mut world, terrain, c, goods, _) = hq();
    let hall = world.buildings.iter().find(|b| b.id == city(&world, &c).town_hall_id).unwrap();
    let at = (hall.x + 60.0, hall.y + 60.0);
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "site", "kind": "mint", "cityId": c, "x": at.0, "y": at.1,
            "site": { "delivered": {}, "work": 0 },
        }))
        .unwrap(),
    );
    let r = idle(&mut world, &c, stock(&[(Good::Iron, 10.0)]));
    let (gx, gy) = (world.buildings[goods].x, world.buildings[goods].y);
    world.residents.retain(|x| x.id == r);
    world.residents[0].x = gx;
    world.residents[0].y = gy;
    world.city_plans.insert(
        c.clone(),
        serde_json::from_value(json!({
            "plannedAt": 0, "jobs": {},
            "project": { "kind": "build", "building": "mint", "x": at.0, "y": at.1 },
        }))
        .unwrap(),
    );
    step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
    let r = res(&world, &r);
    assert_eq!(r.order, None);
    assert_eq!(r.script.as_ref().and_then(|s| s.task), Some(Task::Build));
}

#[test]
fn an_npc_city_goes_on_as_before_wood_to_its_storage_iron_left_in_hand() {
    let terrain = plains(64);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let c = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    let storage = npc_home(&world, &c).unwrap().id.clone();
    let r = idle(
        &mut world,
        &c,
        stock(&[(Good::Wood, 6.0), (Good::Iron, 10.0), (Good::Food, OWN_FOOD)]),
    );
    step_npc_cities(&mut world, terrain.size, None, None);
    let want = order_of(json!({
        "kind": "drop", "to": { "kind": "storage", "storageId": storage }, "goods": { "wood": 6 },
    }));
    assert_eq!(res(&world, &r).order, Some(want));
}

#[test]
fn a_players_city_is_not_touched() {
    let (mut world, terrain) = crate::test_support::world_with_city();
    let r = &mut world.residents[0];
    r.order = None;
    r.carried = stock(&[(Good::Iron, 10.0)]);
    r.script = None;
    step_npc_cities(&mut world, terrain.size, None, None);
    assert_eq!(world.residents[0].order, None);
    assert_eq!(held(&world.residents[0].carried, Good::Iron), 10.0);
}

// the Trade Org HQ runs the chain

#[test]
fn grows_its_rings_and_houses_first_while_too_weak_else_builds_for_its_warehouses() {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq_id = found_trade_org_hq(&mut world, &terrain, 320, 320, &mut || m.next());
    let storage = world
        .buildings
        .iter_mut()
        .find(|b| b.city_id.as_ref() == Some(&hq_id) && b.kind == BuildingKind::Storage)
        .unwrap();
    storage.stock = Some(stock(&[(Good::Food, 20_000.0)]));
    let one = world.residents.iter().find(|r| r.city_id.as_ref() == Some(&hq_id)).unwrap().clone();
    let mut i = 0;
    while free_housing(&world, &hq_id) > 0.0 {
        world.residents.push(Resident { id: format!("h{i}"), ..one.clone() });
        i += 1;
    }
    let planned = |world: &mut WorldState| {
        plan_city(world, &hq_id, Some(&terrain), None, None);
        world.city_plans.get(&hq_id).and_then(|p| p.project.clone())
    };
    // Strong enough: no house, though its housing is full.
    let house = |p: &Option<CityProject>| {
        matches!(p, Some(CityProject::Build { building: BuildingKind::House, .. }))
    };
    assert!(!house(&planned(&mut world)));
    // Far too weak against an Organization of many armed residents: a house, as before.
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    for i in 0..200 {
        world.residents.push(Resident {
            id: format!("x{i}"),
            owner: Some("r1".into()),
            city_id: None,
            carried: stock(&[(Good::Spear, 1.0)]),
            ..one.clone()
        });
    }
    let hq = city(&world, &hq_id).clone();
    let before = hq_project(&world, &hq, &terrain);
    assert!(house(&before));
    assert_eq!(planned(&mut world), before);
    assert_eq!(trade_org_sends_no_one(&world), vec![]);
}

#[test]
fn flags_a_trade_or_found_job_given_by_the_trade_organization() {
    let terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(3.0);
    let c = found_trading_post(&mut world, &terrain, 40, 40, None, &mut || m.next());
    let r = world.residents.iter().find(|x| x.city_id.as_ref() == Some(&c)).unwrap().id.clone();
    world.city_plans.insert(
        c.clone(),
        serde_json::from_value(json!({ "plannedAt": 0, "jobs": { r: { "kind": "trade" } } }))
            .unwrap(),
    );
    assert_eq!(trade_org_sends_no_one(&world).len(), 1);
}
