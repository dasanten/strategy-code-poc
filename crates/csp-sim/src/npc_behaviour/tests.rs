//! `npc-behaviour.test.ts`.

use csp_shared::balance::{ticks_for_age, NPC_VILLAGE, OWN_FOOD, WORK_FOOD_KEPT};
use csp_shared::footprint::{is_at, FOOTPRINT};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Good, Pile, ResidentOrder, ResourceKind, ResourceNode, Stock,
    WorldState,
};
use serde_json::json;

use super::step_npc_cities;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::workers_of;
use crate::queries::city::stored_food;
use crate::queries::goods::{pile_at, units_that_fit};
use crate::queries::names::placed;
use crate::random::Mulberry32;
use crate::script_runner::run_npc_scripts;
use crate::survival::end_realm;
use crate::test_world::{city_terrain, world_with_city};
use crate::tick::Scratch;
use crate::world::create_world;

/// A village alone on a small Plains map, its top-left wall tile at (20, 20) (`village`).
fn village() -> (WorldState, TerrainMap, String) {
    let terrain = plains(64);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    (world, terrain, city)
}

fn own(world: &WorldState, city: &str, kind: BuildingKind) -> usize {
    world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(city) && b.kind == kind)
        .expect("a building of the city")
}

fn storage_of(world: &WorldState, city: &str) -> usize {
    own(world, city, BuildingKind::Storage)
}

fn farm_of(world: &WorldState, city: &str) -> Building {
    world.buildings[own(world, city, BuildingKind::Farm)].clone()
}

fn city_of<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

/// Runs the world for `ticks`, checking the invariants every game day (`run`).
fn run(world: &mut WorldState, terrain: &TerrainMap, runner: &mut Runner, ticks: usize) {
    for _ in 0..ticks {
        runner.step(world, terrain);
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(world, terrain), []);
        }
    }
}

fn scripts(world: &mut WorldState, terrain: &TerrainMap) {
    run_npc_scripts(world, terrain, &mut Scratch::default());
}

fn target(order: &Option<ResidentOrder>) -> (i32, i32) {
    match order {
        Some(ResidentOrder::WalkTo(o)) => (o.target.x as i32, o.target.y as i32),
        other => panic!("not walking: {other:?}"),
    }
}

fn order(v: serde_json::Value) -> Option<ResidentOrder> {
    Some(serde_json::from_value(v).unwrap())
}

#[test]
#[ignore = "45.7 s alone; see #1092"]
fn a_village_left_alone_survives_ten_game_weeks() {
    let (mut world, terrain, city) = village();
    let mut runner = Runner::new(&terrain);
    // Everyone starts idle at home, so the city has to send them out to work.
    let s = &world.buildings[storage_of(&world, &city)];
    let (x, y) = (s.x, s.y);
    for r in &mut world.residents {
        (r.x, r.y, r.order) = (x, y, None);
    }
    let people: Vec<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    run(&mut world, &terrain, &mut runner, 70 * TICKS_PER_GAME_DAY as usize);
    // Starting ages and lifespans leave nobody to die of old age in ten weeks.
    assert!(people.iter().all(|id| world.residents.iter().any(|r| &r.id == id)));
    // Left in the storage, the starting food would have mostly spoiled by now.
    assert!(stored_food(&world, city_of(&world, &city)) > NPC_VILLAGE.food);
}

#[test]
#[ignore = "6.2 s alone; see #1092"]
fn carries_the_farms_output_to_the_storage() {
    let (mut world, terrain, city) = village();
    let mut runner = Runner::new(&terrain);
    let s = storage_of(&world, &city);
    world.buildings[s].stock = Some(Stock::new());
    run(&mut world, &terrain, &mut runner, 5 * TICKS_PER_GAME_DAY as usize);
    assert!(stored_food(&world, city_of(&world, &city)) > 0.0);
    // Its carriers keep taking full loads away: the pile stays below one, past what it keeps.
    let farm = farm_of(&world, &city);
    let tick = world.tick as f64;
    let load = world
        .residents
        .iter()
        .map(|r| {
            let mut empty = r.clone();
            empty.carried = Stock::new();
            units_that_fit(&empty, Good::Food, tick)
        })
        .fold(f64::NEG_INFINITY, f64::max);
    let piled = pile_at(&world, farm.x, farm.y)
        .and_then(|p| p.goods.get(&Good::Food).copied())
        .unwrap_or(0.0);
    assert!(piled < load + WORK_FOOD_KEPT, "{piled} on the farm");
}

#[test]
fn sends_one_worker_by_the_work_default_to_pick_up_a_full_pile_leaving_food_for_the_others() {
    let (mut world, terrain, city) = village();
    let farm = farm_of(&world, &city);
    world.piles.push(Pile {
        id: "pile1".into(),
        x: farm.x,
        y: farm.y,
        goods: Stock::from([(Good::Food, 100.0)]),
    });
    scripts(&mut world, &terrain);
    let picking: Vec<_> = world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::PickUp(_))))
        .collect();
    assert_eq!(picking.len(), 1);
    assert_eq!(
        picking[0].order,
        order(json!({
            "kind": "pickUp", "from": { "kind": "ground" }, "goods": { "food": 100.0 - WORK_FOOD_KEPT },
        }))
    );
    let storage = &world.buildings[storage_of(&world, &city)].id;
    let carry = picking[0].script.as_ref().and_then(|s| s.memory.get("carry"));
    assert_eq!(carry.and_then(|c| c.get("storageId")), Some(&json!(storage)));
}

#[test]
fn takes_what_a_carrier_brings_home_into_the_storage_keeping_a_little_to_eat() {
    let (mut world, _terrain, city) = village();
    let s = world.buildings[storage_of(&world, &city)].clone();
    let r = &mut world.residents[0];
    (r.x, r.y, r.order, r.script) = (s.x, s.y, None, None);
    r.carried = Stock::from([(Good::Food, 12.0)]);
    step_npc_cities(&mut world, 64, None, None);
    assert_eq!(
        world.residents[0].order,
        order(json!({
            "kind": "drop", "to": { "kind": "storage", "storageId": s.id },
            "goods": { "food": 12.0 - OWN_FOOD },
        }))
    );
}

#[test]
fn puts_idle_adults_to_work_on_the_farm_and_sends_children_to_a_house() {
    let (mut world, terrain, city) = village();
    let farm = farm_of(&world, &city);
    let s = world.buildings[storage_of(&world, &city)].clone();
    // Two of them: the adult is the farmer who feeds them.
    world.residents.truncate(2);
    for r in &mut world.residents {
        (r.x, r.y, r.order, r.script) = (s.x, s.y, None, None);
    }
    world.residents[1].born_at = world.tick as f64 - ticks_for_age(1.0);
    // The city decides in its planning pass (ADR 0016) and hands the jobs out in the tick.
    plan_city(&mut world, &city, None, None, None);
    step_npc_cities(&mut world, terrain.size, None, None);
    // On the Work default, which walks them to the farm (its anchor tile, then a tile of its
    // footprint once there).
    let want = json!({
        "scriptId": 0, "task": "work",
        "memory": { "workplaceId": farm.id, "at": { "x": farm.x, "y": farm.y } },
    });
    let script = serde_json::to_value(&world.residents[0].script).unwrap();
    assert_eq!(crate::test_support::as_numbers(&script), crate::test_support::as_numbers(&want));
    scripts(&mut world, &terrain);
    let size = csp_shared::balance::MAP_SIZE;
    assert!(is_at(target(&world.residents[0].order), placed(&farm), size));
    let house = target(&world.residents[1].order);
    assert!(world
        .buildings
        .iter()
        .any(|b| b.kind == BuildingKind::House && is_at(house, placed(b), size)));
}

#[test]
fn puts_residents_on_the_farms_first_when_food_runs_short() {
    let (mut world, mut terrain, city) = village();
    let farm = farm_of(&world, &city);
    // A lumber camp of the village's on a forest node just east of the farm, worked by one
    // resident.
    let at = (farm.x + f64::from(FOOTPRINT.get("farm").unwrap()), farm.y);
    let size = terrain.size;
    terrain.tiles[(at.1 as i32 * size + at.0 as i32) as usize] = Terrain::Forest as u8;
    world.nodes.push(ResourceNode {
        id: "n1".into(),
        kind: ResourceKind::Forest,
        x: at.0,
        y: at.1,
    });
    let camp =
        crate::test_support::building("camp", BuildingKind::LumberCamp, Some(&city), at.0, at.1);
    world.buildings.push(camp.clone());
    let r = &mut world.residents[0];
    (r.x, r.y, r.script) = (at.0, at.1, None);
    r.order = order(json!({
        "kind": "workAt", "buildingId": "camp", "at": { "x": at.0, "y": at.1 }, "progress": 0,
    }));
    let id = r.id.clone();
    let s = storage_of(&world, &city);

    world.buildings[s].stock = Some(Stock::from([(Good::Food, 1000.0)]));
    plan_city(&mut world, &city, None, None, None);
    step_npc_cities(&mut world, size, None, None);
    let workers: Vec<&str> = workers_of(&world, &camp).iter().map(|r| r.id.as_str()).collect();
    assert_eq!(workers, [id.as_str()]);

    world.buildings[s].stock = Some(Stock::new());
    plan_city(&mut world, &city, None, None, None);
    step_npc_cities(&mut world, size, None, None);
    step_npc_cities(&mut world, size, None, None);
    scripts(&mut world, &terrain);
    let r = world.residents.iter().find(|r| r.id == id).unwrap();
    assert!(is_at(target(&r.order), placed(&farm), csp_shared::balance::MAP_SIZE));
}

#[test]
fn a_players_city_whose_leader_died_runs_on_its_own_player_only_orders_ended() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = world.realms[0].id.clone();
    let hall = world.buildings.iter().find(|b| b.kind == BuildingKind::TownHall).unwrap().clone();
    let driver = &mut world.residents[0];
    (driver.x, driver.y) = (hall.x, hall.y);
    driver.order = order(json!({
        "kind": "drive", "carriageId": "k0", "target": { "x": 0, "y": 0 }, "path": null,
        "progress": 0,
    }));
    let work = world.residents[1].order.clone();
    end_realm(&mut world, &realm, terrain.size);
    assert_eq!(world.residents[0].order, None);
    assert_eq!(world.residents[1].order, work);
    step_npc_cities(&mut world, terrain.size, None, None);
    assert!(check_all(&world, terrain).iter().all(|v| v.invariant != "npc-orders-allowed"));
}

/// Not a check: what one run of an NPC's default script costs, binding, interpreting and applying
/// what it asked for (#1092), on the farm village of `carries_the_farms_output_to_the_storage`.
/// `cargo test -p csp-sim --release --lib bench_npc_runs -- --ignored --nocapture`.
#[test]
#[ignore = "a measurement, not a check"]
fn bench_npc_runs() {
    let (mut world, terrain, city) = village();
    let mut runner = Runner::new(&terrain);
    let s = storage_of(&world, &city);
    world.buildings[s].stock = Some(Stock::new());
    let mut snapshots = Vec::new();
    for _ in 0..2 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut world, &terrain);
        if world.tick % 30 == 0 {
            snapshots.push(world.clone());
        }
    }
    // The best of ten passes, as the machine is often busy with other work.
    let mut best = f64::INFINITY;
    for _ in 0..10 {
        let (mut runs, mut spent) = (0, std::time::Duration::ZERO);
        for w in &snapshots {
            let mut w = w.clone();
            let from = std::time::Instant::now();
            runs += run_npc_scripts(&mut w, &terrain, &mut Scratch::default());
            spent += from.elapsed();
        }
        best = best.min(spent.as_secs_f64() * 1e6 / runs as f64);
    }
    eprintln!("BENCH npc run {best:.2} us");
}
