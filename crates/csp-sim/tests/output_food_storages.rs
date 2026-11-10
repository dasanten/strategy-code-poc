//! `apps/server/src/output-food-storages.test.ts`, ported (T86.17, part 5): separate output and
//! food storages (`CONTEXT.md`: Script parameter, Carrying the output, Getting food, Crew food).
//! The Work default keeps `storage` as its main storage, and `output` and `food` each take its
//! place for one use while picked; Build, Build line and Tear down get Food at `food`, else their
//! `source`. Unset, each falls back to the main one, then the nearest storage.

mod build_common;
mod scripts_common;

use std::sync::Arc;

use build_common::*;
use csp_shared::balance::{CREW_FOOD, MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Good, Pile, Resident, Stock, Task, WorldState};
use csp_sim::queries::building::pile_tile;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use scripts_common::{assert_matches, from, order_json, task_runner};
use serde_json::{json, Value};

const SIZE: i32 = 40;
const SCRIPT: u64 = 1;

/// Mara's realm r1 with city c1 at (30, 10) and a lumber camp of no city at (6, 10).
fn camp_world() -> (WorldState, TerrainMap, (i32, i32)) {
    let mut terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 1, "w1"));
    add_city(&mut world, "c1", Some("r1"), 30.0, 10.0);
    let at = (6, 10);
    terrain.tiles[(at.1 * SIZE + at.0) as usize] = Terrain::Forest as u8;
    world.nodes.push(from(json!({ "id": "n", "kind": "forest", "x": at.0, "y": at.1 })));
    world.buildings.push(building("camp", BuildingKind::LumberCamp, at.0 as f64, at.1 as f64));
    (world, terrain, at)
}

/// A worker of city c1 on `place` working it, carrying `food`, with the script's params set.
fn add_worker(
    world: &mut WorldState,
    id: &str,
    place: (&str, f64, f64),
    food: f64,
    params: &Value,
) {
    let mut r = new_resident(id, Some("r1"), place.1, place.2);
    r.city_id = Some("c1".into());
    r.carried = Stock::from([(Good::Food, food)]);
    r.order = Some(from(json!({
        "kind": "workAt", "buildingId": place.0, "at": { "x": place.1, "y": place.2 }, "progress": 0
    })));
    r.script = Some(from(json!({ "scriptId": SCRIPT, "memory": { "workplaceId": place.0 } })));
    r.script_params = Some(from(json!({ SCRIPT.to_string(): params })));
    world.residents.push(r);
}

/// Outpost storages of r1 (`CONTEXT.md`: Outpost storage), out of the city's area.
fn storage(world: &mut WorldState, id: &str, x: i32, y: i32, stock: Stock) {
    let mut b = building(id, BuildingKind::Storage, x as f64, y as f64);
    b.realm_id = Some("r1".into());
    b.stock = Some(stock);
    world.buildings.push(b);
}

fn goods(items: &[(Good, f64)]) -> Stock {
    items.iter().copied().collect()
}

fn pile_goods(world: &WorldState, x: i32, y: i32) -> Option<&Stock> {
    let (px, py) = pile_tile(world, x, y, SIZE);
    world.piles.iter().find(|p| p.x as i32 == px && p.y as i32 == py).map(|p| &p.goods)
}

fn pile_of(world: &WorldState, x: i32, y: i32, good: Good) -> f64 {
    pile_goods(world, x, y).and_then(|g| g.get(&good).copied()).unwrap_or(0.0)
}

fn stock<'w>(world: &'w WorldState, id: &str) -> &'w Stock {
    world.buildings.iter().find(|b| b.id == id).unwrap().stock.as_ref().unwrap()
}

fn stock_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Stock {
    world.buildings.iter_mut().find(|b| b.id == id).unwrap().stock.as_mut().unwrap()
}

fn units(s: &Stock, good: Good) -> f64 {
    s.get(&good).copied().unwrap_or(0.0)
}

fn resident<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

/// Runs the scripts of `task` and the world with nobody hungry until `done` or out of ticks.
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    done: impl Fn(&WorldState) -> bool,
    task: Task,
) {
    let mut runner = task_runner(terrain, task);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..800 {
        if done(world) {
            break;
        }
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        let broken = runner.run_all(world, &mut scratch, true);
        assert!(broken.is_empty(), "{broken:?}");
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
    }
}

/// One run of the scripts of `task`, without the world stepping.
fn run_once(world: &mut WorldState, terrain: &TerrainMap, task: Task) {
    let broken = task_runner(terrain, task).run_all(world, &mut Scratch::default(), false);
    assert!(broken.is_empty(), "{broken:?}");
}

fn set_params(world: &mut WorldState, id: &str, params: Value) {
    let r = world.residents.iter_mut().find(|r| r.id == id).unwrap();
    r.script_params = Some(from(json!({ SCRIPT.to_string(): params })));
}

fn reset_work(world: &mut WorldState, id: &str, camp: (i32, i32)) {
    let r = world.residents.iter_mut().find(|r| r.id == id).unwrap();
    r.script.as_mut().unwrap().memory = from(json!({ "workplaceId": "camp" }));
    r.order = Some(from(json!({
        "kind": "workAt", "buildingId": "camp", "at": { "x": camp.0, "y": camp.1 }, "progress": 0
    })));
}

fn fetch_from(r: &Resident) -> String {
    order_json(r)["from"]["storageId"].as_str().unwrap().to_string()
}

// output and food in the Work default

#[test]
fn stores_the_output_at_output_while_the_crews_food_comes_from_food() {
    let (mut world, t, camp) = camp_world();
    // The main storage is the nearest, and holds Food: neither is used while both are picked.
    storage(&mut world, "main", camp.0 + 3, camp.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "out", camp.0 + 8, camp.1, Stock::new());
    storage(&mut world, "pantry", camp.0, camp.1 + 8, goods(&[(Good::Food, 50.0)]));
    let params = json!({ "storage": "main", "output": "out", "food": "pantry" });
    for id in ["w1", "w2", "w3"] {
        add_worker(&mut world, id, ("camp", 6.0, 10.0), OWN_FOOD, &params);
    }
    world.piles.push(Pile {
        id: "p".into(),
        x: camp.0 as f64,
        y: camp.1 as f64,
        goods: goods(&[(Good::Wood, 100.0)]),
    });
    run(&mut world, &t, |w| pile_of(w, camp.0, camp.1, Good::Food) > 0.0, Task::Work);
    assert!(pile_of(&world, camp.0, camp.1, Good::Food) > 0.0);
    assert!(units(stock(&world, "out"), Good::Wood) > 0.0);
    assert!(units(stock(&world, "pantry"), Good::Food) <= 50.0 - CREW_FOOD);
    assert_eq!(*stock(&world, "main"), goods(&[(Good::Food, 50.0)]));
    let carrier = world
        .residents
        .iter()
        .find(|r| r.script_log.as_ref().is_some_and(|l| !l.is_empty()))
        .unwrap();
    let texts: Vec<&str> =
        carrier.script_log.as_ref().unwrap().iter().map(|l| l.text.as_str()).collect();
    assert!(
        texts
            .iter()
            .any(|t| t.starts_with("pile full: carrying ")
                && t.ends_with(" to the storage at 14,10")),
        "{texts:?}"
    );
    let fetching = format!("fetching {CREW_FOOD} Food for the crew at the storage at 6,18");
    assert!(texts.contains(&fetching.as_str()), "{texts:?}");
    assert_sound(&world, &t);
}

#[test]
fn carries_the_output_to_output_else_storage_else_the_nearest_storage() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "near", camp.0 + 2, camp.1, Stock::new());
    storage(&mut world, "main", camp.0 + 5, camp.1, Stock::new());
    storage(&mut world, "out", camp.0 + 8, camp.1, Stock::new());
    add_worker(
        &mut world,
        "w1",
        ("camp", 6.0, 10.0),
        OWN_FOOD,
        &json!({ "storage": "main", "output": "out" }),
    );
    let mut carries_to = |params: Value| -> String {
        set_params(&mut world, "w1", params);
        reset_work(&mut world, "w1", camp);
        world.piles = vec![Pile {
            id: "p".into(),
            x: camp.0 as f64,
            y: camp.1 as f64,
            goods: goods(&[(Good::Wood, 100.0)]),
        }];
        run_once(&mut world, &t, Task::Work);
        let carry = &world.residents[0].script.as_ref().unwrap().memory["carry"];
        carry["storageId"].as_str().unwrap().to_string()
    };
    assert_eq!(carries_to(json!({ "storage": "main", "output": "out" })), "out");
    assert_eq!(carries_to(json!({ "storage": "main" })), "main");
    assert_eq!(carries_to(json!({})), "near");
}

#[test]
fn gets_food_at_food_else_storage_else_the_nearest_storage_with_food() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "near", camp.0 + 2, camp.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "main", camp.0 + 5, camp.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "pantry", camp.0 + 8, camp.1, goods(&[(Good::Food, 50.0)]));
    add_worker(&mut world, "w1", ("camp", 6.0, 10.0), 1.0, &json!({}));
    let fetches_at = |world: &mut WorldState, params: Value| -> String {
        let mut all = json!({ "foodAt": 4, "foodTake": 12 });
        all.as_object_mut().unwrap().extend(params.as_object().unwrap().clone());
        set_params(world, "w1", all);
        reset_work(world, "w1", camp);
        run_once(world, &t, Task::Work);
        assert_matches(
            &order_json(&world.residents[0]),
            json!({ "kind": "fetch", "goods": { "food": 11 } }),
        );
        fetch_from(&world.residents[0])
    };
    assert_eq!(fetches_at(&mut world, json!({ "storage": "main", "food": "pantry" })), "pantry");
    assert_eq!(fetches_at(&mut world, json!({ "storage": "main", "output": "pantry" })), "main");
    assert_eq!(fetches_at(&mut world, json!({})), "near");
    // A picked food storage without Food: the nearest with Food, not the main storage.
    stock_mut(&mut world, "pantry").insert(Good::Food, 0.0);
    assert_eq!(fetches_at(&mut world, json!({ "storage": "main", "food": "pantry" })), "near");
}

#[test]
fn brings_the_crews_food_from_storage_while_food_is_unset_though_output_is_elsewhere() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "main", camp.0, camp.1 + 6, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "out", camp.0 + 8, camp.1, Stock::new());
    let params = json!({ "storage": "main", "output": "out" });
    for id in ["w1", "w2"] {
        add_worker(&mut world, id, ("camp", 6.0, 10.0), OWN_FOOD, &params);
    }
    world.piles.push(Pile {
        id: "p".into(),
        x: camp.0 as f64,
        y: camp.1 as f64,
        goods: goods(&[(Good::Wood, 100.0)]),
    });
    run(&mut world, &t, |w| pile_of(w, camp.0, camp.1, Good::Food) > 0.0, Task::Work);
    assert!(units(stock(&world, "out"), Good::Wood) > 0.0);
    assert!(units(stock(&world, "main"), Good::Food) <= 50.0 - CREW_FOOD);
}

// food in the Build, Build line and Tear down defaults

/// Where the house site goes: plains by the city.
const HOUSE_AT: (i32, i32) = (20, 12);

/// A builder on a house site at `HOUSE_AT` that lacks all its materials.
fn add_builder(world: &mut WorldState, food: f64, params: &Value) {
    world.buildings.retain(|b| b.kind != BuildingKind::LumberCamp);
    let mut site = building("site", BuildingKind::House, HOUSE_AT.0 as f64, HOUSE_AT.1 as f64);
    site.site = Some(csp_shared::world::ConstructionSite { delivered: Stock::new(), work: 0.0 });
    world.buildings.push(site);
    add_worker(world, "b1", ("site", HOUSE_AT.0 as f64, HOUSE_AT.1 as f64), food, params);
    let r = &mut world.residents[0];
    let at = json!({ "x": HOUSE_AT.0, "y": HOUSE_AT.1 });
    r.order =
        Some(from(json!({ "kind": "build", "building": "house", "at": at, "siteId": "site" })));
    r.script = Some(from(json!({
        "scriptId": SCRIPT, "memory": { "building": "house", "at": at, "siteId": "site" }
    })));
}

#[test]
fn build_gets_food_at_food_while_the_materials_come_from_source() {
    let (mut world, t, _) = camp_world();
    storage(
        &mut world,
        "src",
        HOUSE_AT.0 + 4,
        HOUSE_AT.1,
        goods(&[(Good::Food, 50.0), (Good::Wood, 100.0), (Good::Stone, 100.0)]),
    );
    storage(&mut world, "pantry", HOUSE_AT.0 - 4, HOUSE_AT.1, goods(&[(Good::Food, 50.0)]));
    add_builder(
        &mut world,
        1.0,
        &json!({ "source": "src", "food": "pantry", "foodAt": 4, "foodTake": 12 }),
    );
    run_once(&mut world, &t, Task::Build);
    assert_matches(
        &order_json(&world.residents[0]),
        json!({ "kind": "fetch", "from": { "storageId": "pantry" } }),
    );

    // Fed, they fetch the materials at source.
    run(
        &mut world,
        &t,
        |w| {
            let m = &w.residents[0].script.as_ref().unwrap().memory;
            m.get("fetch").is_some_and(|v| !v.is_null() && v != &json!(false))
        },
        Task::Build,
    );
    let order = order_json(&world.residents[0]);
    assert_matches(&order, json!({ "kind": "fetch", "from": { "storageId": "src" } }));
    assert!(order["goods"]["wood"].as_f64().unwrap() > 0.0);
    assert_eq!(units(stock(&world, "pantry"), Good::Food), 50.0 - 11.0);
}

#[test]
fn build_gets_food_at_source_while_food_is_unset() {
    let (mut world, t, _) = camp_world();
    storage(&mut world, "near", HOUSE_AT.0 + 1, HOUSE_AT.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "src", HOUSE_AT.0 + 4, HOUSE_AT.1, goods(&[(Good::Food, 50.0)]));
    add_builder(&mut world, 1.0, &json!({ "source": "src", "foodAt": 4, "foodTake": 12 }));
    run_once(&mut world, &t, Task::Build);
    assert_matches(
        &order_json(&world.residents[0]),
        json!({ "kind": "fetch", "from": { "storageId": "src" } }),
    );
}

#[test]
fn tear_down_gets_food_at_food_else_source_else_the_nearest_with_food() {
    let (mut world, t, camp) = camp_world();
    storage(&mut world, "near", camp.0 + 2, camp.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "src", camp.0 + 5, camp.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "pantry", camp.0 + 8, camp.1, goods(&[(Good::Food, 50.0)]));
    add_worker(&mut world, "w1", ("camp", 6.0, 10.0), 1.0, &json!({}));
    let fetches_at = |world: &mut WorldState, params: Value| -> String {
        let mut all = json!({ "foodAt": 4, "foodTake": 12 });
        all.as_object_mut().unwrap().extend(params.as_object().unwrap().clone());
        set_params(world, "w1", all);
        let r = &mut world.residents[0];
        r.script = Some(from(json!({ "scriptId": SCRIPT, "memory": { "buildingId": "camp" } })));
        r.order = None;
        run_once(world, &t, Task::TearDown);
        fetch_from(&world.residents[0])
    };
    assert_eq!(fetches_at(&mut world, json!({ "source": "src", "food": "pantry" })), "pantry");
    assert_eq!(fetches_at(&mut world, json!({ "source": "src" })), "src");
    assert_eq!(fetches_at(&mut world, json!({})), "near");
}

#[test]
fn build_line_gets_food_at_food() {
    let (mut world, t, _) = camp_world();
    storage(&mut world, "src", HOUSE_AT.0 + 4, HOUSE_AT.1, goods(&[(Good::Food, 50.0)]));
    storage(&mut world, "pantry", HOUSE_AT.0 - 4, HOUSE_AT.1, goods(&[(Good::Food, 50.0)]));
    add_worker(
        &mut world,
        "w1",
        ("x", HOUSE_AT.0 as f64, HOUSE_AT.1 as f64),
        1.0,
        &json!({ "source": "src", "food": "pantry", "foodAt": 4, "foodTake": 12 }),
    );
    let line = json!({
        "building": "road",
        "from": { "x": HOUSE_AT.0, "y": HOUSE_AT.1 },
        "to": { "x": HOUSE_AT.0 + 2, "y": HOUSE_AT.1 },
    });
    let r = &mut world.residents[0];
    r.order = None;
    r.script = Some(from(json!({ "scriptId": SCRIPT, "memory": { "line": line } })));
    run_once(&mut world, &t, Task::BuildLine);
    assert_matches(
        &order_json(resident(&world, "w1")),
        json!({ "kind": "fetch", "from": { "storageId": "pantry" } }),
    );
}
