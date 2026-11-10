//! `apps/server/src/getting-food.test.ts`, ported (T86.17, part 5): Getting food (`CONTEXT.md`:
//! Getting food, Own food). A resident running the Work, Build or Tear down default goes to get
//! Food below `foodAt` units on them, up to `foodTake`, and comes back; storing a load or
//! fetching materials tops their own food up to `foodTake` too. Both params have defaults, so they
//! do it without any set; `foodAt` 0 turns it off.

mod build_common;
mod scripts_common;

use std::sync::Arc;

use build_common::*;
use csp_shared::balance::{
    BUILD_MATERIALS, GET_FOOD_AT, GET_FOOD_TAKE, MAX_HUNGER, MEAL_UNITS, OWN_FOOD,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Good, Pile, ResidentOrder, Stock, Task, WorldState};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use scripts_common::{assert_matches, from, order_json, task_runner};
use serde_json::{json, Value};

const SIZE: i32 = 32;
const WORK: u64 = 1;

/// Mara's realm r1 with city c1 at (14, 10) and a lumber camp of no city at (6, 10).
fn camp_world() -> (WorldState, TerrainMap, (i32, i32)) {
    let mut terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 1, "w1"));
    add_city(&mut world, "c1", Some("r1"), 14.0, 10.0);
    let at = (6, 10);
    terrain.tiles[(at.1 * SIZE + at.0) as usize] = Terrain::Forest as u8;
    world.nodes.push(
        serde_json::from_value(json!({ "id": "n", "kind": "forest", "x": at.0, "y": at.1 }))
            .unwrap(),
    );
    world.buildings.push(building("camp", BuildingKind::LumberCamp, at.0 as f64, at.1 as f64));
    (world, terrain, at)
}

/// A worker on `place` working it, carrying `food`, with the Work script's params set.
fn add_worker(world: &mut WorldState, place: (&str, f64, f64), food: f64, params: Value) {
    let mut r = new_resident("w1", Some("r1"), place.1, place.2);
    r.city_id = Some("c1".into());
    r.carried = Stock::from([(Good::Food, food)]);
    r.order = Some(from(json!({
        "kind": "workAt", "buildingId": place.0, "at": { "x": place.1, "y": place.2 }, "progress": 0
    })));
    r.script = Some(from(json!({ "scriptId": WORK, "memory": { "workplaceId": place.0 } })));
    r.script_params = Some(from(json!({ WORK.to_string(): params })));
    world.residents.push(r);
}

fn storage(world: &mut WorldState, id: &str, x: f64, y: f64, stock: Stock) {
    let mut b = building(id, BuildingKind::Storage, x, y);
    b.city_id = Some("c1".into());
    b.stock = Some(stock);
    world.buildings.push(b);
}

fn food(items: f64) -> Stock {
    Stock::from([(Good::Food, items)])
}

fn w1(world: &WorldState) -> &csp_shared::world::Resident {
    world.residents.iter().find(|r| r.id == "w1").unwrap()
}

fn memory(world: &WorldState, key: &str) -> Option<Value> {
    w1(world).script.as_ref().and_then(|s| s.memory.get(key).cloned())
}

fn truthy(v: Option<Value>) -> bool {
    !matches!(v, None | Some(Value::Null) | Some(Value::Bool(false)))
}

fn carried(world: &WorldState, good: Good) -> f64 {
    w1(world).carried.get(&good).copied().unwrap_or(0.0)
}

fn stock_of(world: &WorldState, id: &str, good: Good) -> Option<f64> {
    world.buildings.iter().find(|b| b.id == id).unwrap().stock.as_ref()?.get(&good).copied()
}

/// Runs the world with the resident never hungry, so the Food on them stays countable, running
/// the default of `task`, until `done` or the ticks run out; whether they left their tile on the
/// way (`run`).
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    mut done: impl FnMut(&WorldState) -> bool,
    ticks: usize,
    task: Task,
) -> bool {
    let (home_x, home_y) = (w1(world).x, w1(world).y);
    let mut runner = task_runner(terrain, task);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let mut left = false;
    for _ in 0..ticks {
        if done(world) {
            break;
        }
        for r in &mut world.residents {
            if r.id == "w1" {
                r.hunger = MAX_HUNGER;
            }
        }
        let broken = runner.run_all(world, &mut scratch, true);
        assert!(broken.is_empty(), "{broken:?}");
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
        left |= w1(world).x != home_x || w1(world).y != home_y;
    }
    left
}

/// One run of the scripts of `task`, without the world stepping.
fn run_once(world: &mut WorldState, terrain: &TerrainMap, task: Task) {
    let mut runner = task_runner(terrain, task);
    let broken = runner.run_all(world, &mut Scratch::default(), false);
    assert!(broken.is_empty(), "{broken:?}");
}

fn working(world: &WorldState, camp: (i32, i32)) -> bool {
    let w = w1(world);
    (w.x, w.y) == (camp.0 as f64, camp.1 as f64)
        && matches!(w.order, Some(ResidentOrder::WorkAt(_)))
        && !truthy(memory(world, "food"))
}

// getting food in the Work default

#[test]
fn walks_to_the_storage_below_food_at_comes_back_with_food_take_and_works_on() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_worker(&mut world, ("camp", 6.0, 10.0), 3.0, json!({ "foodAt": 4, "foodTake": 12 }));
    let mut fetched = false;
    let left = run(
        &mut world,
        &t,
        |w| {
            fetched |= carried(w, Good::Food) >= 12.0;
            fetched && working(w, camp)
        },
        400,
        Task::Work,
    );
    assert!(left);
    assert!(working(&world, camp));
    assert_eq!(carried(&world, Good::Food), 12.0);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - 9.0));
    assert_sound(&world, &t);
}

#[test]
fn with_no_params_set_fetches_the_default_food_take_once_below_the_default_food_at() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_worker(&mut world, ("camp", 6.0, 10.0), GET_FOOD_AT, json!({}));
    assert!(!run(&mut world, &t, |_| false, 20, Task::Work));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::WorkAt(_))));

    world.residents[0].carried.insert(Good::Food, 0.0);
    let mut fetched = false;
    let left = run(
        &mut world,
        &t,
        |w| {
            fetched |= carried(w, Good::Food) >= GET_FOOD_TAKE;
            fetched && working(w, camp)
        },
        400,
        Task::Work,
    );
    assert!(left);
    assert!(working(&world, camp));
    // They set off for foodTake; arriving with none, they also refill a meal at the storage.
    assert_eq!(carried(&world, Good::Food), GET_FOOD_TAKE + MEAL_UNITS);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - GET_FOOD_TAKE - MEAL_UNITS));
    assert_sound(&world, &t);
}

#[test]
fn goes_to_the_picked_storage_while_it_holds_food_else_the_nearest_with_food() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "near", camp.0 as f64 + 2.0, camp.1 as f64, Stock::new());
    storage(&mut world, "far", camp.0 as f64 + 8.0, camp.1 as f64, food(50.0));
    add_worker(
        &mut world,
        ("camp", 6.0, 10.0),
        1.0,
        json!({ "foodAt": 4, "foodTake": 12, "storage": "near" }),
    );
    run_once(&mut world, &t, Task::Work);
    assert_matches(
        &order_json(w1(&world)),
        json!({ "kind": "fetch", "from": { "storageId": "far" } }),
    );

    world.buildings.iter_mut().find(|b| b.id == "near").unwrap().stock = Some(food(5.0));
    let r = &mut world.residents[0];
    r.order = Some(from(json!({
        "kind": "workAt", "buildingId": "camp", "at": { "x": camp.0, "y": camp.1 }, "progress": 0
    })));
    r.script.as_mut().unwrap().memory = from(json!({ "workplaceId": "camp" }));
    run_once(&mut world, &t, Task::Work);
    assert_matches(
        &order_json(w1(&world)),
        json!({ "kind": "fetch", "from": { "storageId": "near" }, "goods": { "food": 11 } }),
    );
}

#[test]
fn keeps_working_with_no_food_anywhere() {
    let (mut world, t, camp) = camp_world();
    storage(
        &mut world,
        "s1",
        camp.0 as f64 + 6.0,
        camp.1 as f64,
        Stock::from([(Good::Wood, 10.0)]),
    );
    add_worker(&mut world, ("camp", 6.0, 10.0), 1.0, json!({ "foodAt": 4, "foodTake": 12 }));
    assert!(!run(&mut world, &t, |_| false, 20, Task::Work));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::WorkAt(_))));
    assert!(!truthy(memory(&world, "food")));
}

#[test]
fn stays_at_work_with_food_at_0_however_little_food_they_carry() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_worker(&mut world, ("camp", 6.0, 10.0), 0.0, json!({ "foodAt": 0 }));
    assert!(!run(&mut world, &t, |_| false, 20, Task::Work));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::WorkAt(_))));
}

#[test]
fn carrying_the_output_with_food_take_set_tops_their_food_up_to_it() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_worker(&mut world, ("camp", 6.0, 10.0), OWN_FOOD, json!({ "foodTake": 12, "crewFood": 0 }));
    world.piles.push(Pile {
        id: "p".into(),
        x: camp.0 as f64,
        y: camp.1 as f64,
        goods: Stock::from([(Good::Wood, 100.0)]),
    });
    let mut went = false;
    run(
        &mut world,
        &t,
        |w| {
            went |= truthy(memory(w, "carry"));
            went && !truthy(memory(w, "carry"))
        },
        400,
        Task::Work,
    );
    assert!(went);
    assert_eq!(carried(&world, Good::Food), 12.0);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - (12.0 - OWN_FOOD)));
    assert!(stock_of(&world, "s1", Good::Wood).unwrap() > 0.0);
}

// getting food in the Build default

/// Where the house site goes: plains by the city.
const HOUSE_AT: (i32, i32) = (12, 12);

/// A builder at the camp's tile building a house site there, fully supplied unless `delivered`.
fn add_builder(world: &mut WorldState, food: f64, params: Value, delivered: Stock) {
    world.buildings.retain(|b| b.kind != BuildingKind::LumberCamp);
    let mut site = building("site", BuildingKind::House, HOUSE_AT.0 as f64, HOUSE_AT.1 as f64);
    site.site = Some(csp_shared::world::ConstructionSite { delivered, work: 0.0 });
    world.buildings.push(site);
    add_worker(world, ("site", HOUSE_AT.0 as f64, HOUSE_AT.1 as f64), food, params);
    let r = &mut world.residents[0];
    let at = json!({ "x": HOUSE_AT.0, "y": HOUSE_AT.1 });
    r.order =
        Some(from(json!({ "kind": "build", "building": "house", "at": at, "siteId": "site" })));
    r.script = Some(from(json!({
        "scriptId": WORK, "memory": { "building": "house", "at": at, "siteId": "site" }
    })));
}

fn house_materials() -> Stock {
    BUILD_MATERIALS
        .get("house")
        .unwrap()
        .0
        .iter()
        .map(|(g, n)| (serde_json::from_value(json!(g)).unwrap(), *n))
        .collect()
}

fn building_at_site(world: &WorldState) -> bool {
    let w = w1(world);
    (w.x, w.y) == (HOUSE_AT.0 as f64, HOUSE_AT.1 as f64)
        && matches!(w.order, Some(ResidentOrder::Build(_)))
        && !truthy(memory(world, "food"))
}

#[test]
fn build_walks_to_the_source_below_food_at_comes_back_with_food_take_and_builds_on() {
    let (mut world, t, _) = camp_world();
    storage(&mut world, "s1", HOUSE_AT.0 as f64 + 6.0, HOUSE_AT.1 as f64, food(50.0));
    add_builder(
        &mut world,
        3.0,
        json!({ "foodAt": 4, "foodTake": 12, "source": "s1" }),
        house_materials(),
    );
    let mut fetched = false;
    let left = run(
        &mut world,
        &t,
        |w| {
            fetched |= carried(w, Good::Food) >= 12.0;
            fetched && building_at_site(w)
        },
        400,
        Task::Build,
    );
    assert!(left);
    assert!(building_at_site(&world));
    assert_eq!(carried(&world, Good::Food), 12.0);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - 9.0));
    assert!(world.buildings.iter().find(|x| x.id == "site").unwrap().site.is_some());
    assert_sound(&world, &t);
}

#[test]
fn fetching_materials_with_food_take_set_tops_their_food_up_to_it() {
    let (mut world, t, _) = camp_world();
    storage(
        &mut world,
        "s1",
        HOUSE_AT.0 as f64 + 6.0,
        HOUSE_AT.1 as f64,
        Stock::from([(Good::Food, 50.0), (Good::Wood, 100.0), (Good::Stone, 100.0)]),
    );
    add_builder(&mut world, OWN_FOOD, json!({ "foodTake": 12 }), Stock::new());
    let mut went = false;
    run(
        &mut world,
        &t,
        |w| {
            went |= truthy(memory(w, "fetch"));
            went && building_at_site(w) && !truthy(memory(w, "fetch"))
        },
        400,
        Task::Build,
    );
    assert!(went);
    assert_eq!(carried(&world, Good::Food), 12.0);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - (12.0 - OWN_FOOD)));
}

#[test]
fn build_stays_at_the_site_with_food_at_0_however_little_food_they_carry() {
    let (mut world, t, _) = camp_world();
    storage(&mut world, "s1", HOUSE_AT.0 as f64 + 6.0, HOUSE_AT.1 as f64, food(50.0));
    add_builder(&mut world, 0.0, json!({ "foodAt": 0 }), house_materials());
    assert!(!run(&mut world, &t, |_| false, 20, Task::Build));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::Build(_))));
    assert!(!truthy(memory(&world, "food")));
}

// getting food in the Tear down default

/// A resident on the camp's tile given the Tear down task for it.
fn add_tearer(world: &mut WorldState, food: f64, params: Value) {
    add_worker(world, ("camp", 6.0, 10.0), food, params);
    let r = &mut world.residents[0];
    r.order = None;
    r.script = Some(from(json!({ "scriptId": WORK, "memory": { "buildingId": "camp" } })));
}

fn tearing(world: &WorldState, camp: (i32, i32)) -> bool {
    let w = w1(world);
    (w.x, w.y) == (camp.0 as f64, camp.1 as f64)
        && matches!(w.order, Some(ResidentOrder::TearDown(_)))
        && !truthy(memory(world, "food"))
}

#[test]
fn tear_down_walks_to_the_nearest_storage_with_food_below_food_at_comes_back_with_food_take_and_tears_down_on(
) {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "empty", camp.0 as f64 + 2.0, camp.1 as f64, Stock::new());
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_tearer(&mut world, 3.0, json!({ "foodAt": 4, "foodTake": 12 }));
    let mut fetched = false;
    let left = run(
        &mut world,
        &t,
        |w| {
            fetched |= carried(w, Good::Food) >= 12.0;
            fetched && tearing(w, camp)
        },
        400,
        Task::TearDown,
    );
    assert!(left);
    assert!(tearing(&world, camp));
    assert_eq!(carried(&world, Good::Food), 12.0);
    assert_eq!(stock_of(&world, "s1", Good::Food), Some(50.0 - 9.0));
    assert!(world.buildings.iter().any(|b| b.id == "camp"));
    assert_sound(&world, &t);
}

#[test]
fn tear_down_with_food_at_0_without_leaving_however_little_food_they_carry() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "s1", camp.0 as f64 + 6.0, camp.1 as f64, food(50.0));
    add_tearer(&mut world, 0.0, json!({ "foodAt": 0 }));
    assert!(!run(&mut world, &t, |_| false, 20, Task::TearDown));
    assert_matches(&order_json(w1(&world)), json!({ "kind": "tearDown", "buildingId": "camp" }));
    assert!(!truthy(memory(&world, "food")));
}
