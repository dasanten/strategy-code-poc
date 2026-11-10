//! `apps/server/src/fetching-inputs.test.ts`, ported one to one.
//!
//! Fetching inputs (`CONTEXT.md`: Fetching inputs, Smelter / Mint, Smithy): at a smelter, mint or
//! smithy whose pile and workers lack what it uses, one worker picked at random fetches a load
//! from the Work default's `input`, else its `storage`, else the nearest storage of the realm
//! holding it, puts it on the pile and goes back; one at a time, and not while someone carries the
//! output.

use std::sync::Arc;

use csp_shared::balance::{MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Good, Resident, Stat, Stock, Task, WorldState};
use serde_json::{json, Value};

use csp_sim::default_scripts::default_script;
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::queries::building::{input_to_fetch, recipe_for};
use csp_sim::queries::goods::pile_at;
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::script_runner::{one_input_fetcher_at_a_time, ScriptHost, ScriptRunner};
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};

const SIZE: i32 = 32;
const WORK: u64 = 1;

struct Host;

impl ScriptHost for Host {
    fn script(&self, _: u64) -> Option<RunnableScript> {
        let (name, source) = default_script(Task::Work);
        Some(RunnableScript {
            user_id: 1,
            name: name.into(),
            version: 1,
            source: source.into(),
            follows_default: true,
            task: None,
        })
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        Some(OrderSender::player(user_id, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

fn runner(terrain: &TerrainMap) -> ScriptRunner {
    ScriptRunner::new(Arc::new(terrain.clone()), Arc::new(Host), order_kinds())
}

/// Mara's realm r1 with city c1 and a smelter (or smithy) at (6, 6), its pile empty
/// (`smelterWorld`).
fn smelter_world(kind: &str) -> (WorldState, TerrainMap) {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 1, "leaderId": "w1" })).unwrap(),
    );
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": 24, "y": 24,
        }))
        .unwrap(),
    );
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "c1-hall",
            "occupation": null,
        }))
        .unwrap(),
    );
    world.buildings.push(
        serde_json::from_value(
            json!({ "id": "place", "kind": kind, "cityId": null, "x": 6, "y": 6 }),
        )
        .unwrap(),
    );
    (world, terrain)
}

fn place(world: &WorldState) -> &Building {
    world.buildings.iter().find(|b| b.id == "place").unwrap()
}

/// A worker of the place, running the Work default with `params` (`addWorker`).
fn add_worker(world: &mut WorldState, id: &str, params: Value, makes: Option<&str>) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields =
        NewResident { id, owner: Some("r1"), city_id: Some("c1"), x: 6.0, y: 6.0, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
    let mut order =
        json!({ "kind": "workAt", "buildingId": "place", "at": { "x": 6, "y": 6 }, "progress": 0 });
    let mut memory = json!({ "workplaceId": "place" });
    if let Some(makes) = makes {
        order["makes"] = json!(makes);
        memory["makes"] = json!(makes);
    }
    r.order = Some(serde_json::from_value(order).unwrap());
    r.script = Some(serde_json::from_value(json!({ "scriptId": WORK, "memory": memory })).unwrap());
    r.script_params = Some(serde_json::from_value(json!({ WORK.to_string(): params })).unwrap());
    world.residents.push(r);
    world.residents.len() - 1
}

fn storage(world: &mut WorldState, id: &str, x: f64, y: f64, stock: Value) {
    world.buildings.push(
        serde_json::from_value(json!({
            "id": id, "kind": "storage", "cityId": "c1", "x": x, "y": y, "stock": stock,
        }))
        .unwrap(),
    );
}

fn fetchers(world: &WorldState) -> Vec<&Resident> {
    world
        .residents
        .iter()
        .filter(|r| {
            r.script.as_ref().is_some_and(|s| s.memory.get("input").is_some_and(|v| !v.is_null()))
        })
        .collect()
}

/// The one worker sent to fetch inputs, after one run; fails unless exactly one went
/// (`oneFetcher`).
fn one_fetcher(world: &mut WorldState, terrain: &TerrainMap) -> Resident {
    assert_eq!(runner(terrain).run_all(world, &mut Scratch::default(), true), vec![]);
    let sent = fetchers(world);
    assert_eq!(sent.len(), 1, "{:?}", sent.iter().map(|r| &r.id).collect::<Vec<_>>());
    sent[0].clone()
}

fn order_json(r: &Resident) -> Value {
    serde_json::to_value(&r.order).unwrap()
}

fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => {
            e.iter().all(|(k, v)| a.get(k).is_some_and(|x| matches(x, v)))
        }
        (Value::Number(a), Value::Number(e)) => a.as_f64() == e.as_f64(),
        _ => actual == expected,
    }
}

#[track_caller]
fn assert_matches(actual: &Value, expected: Value) {
    assert!(matches(actual, &expected), "{actual:#}\ndoes not match\n{expected:#}");
}

fn held(s: &Stock, g: Good) -> f64 {
    s.get(&g).copied().unwrap_or(0.0)
}

fn load_of(
    world: &WorldState,
    fetcher: &Resident,
    kind: BuildingKind,
    makes: Option<&str>,
) -> Stock {
    input_to_fetch(world, place(world), recipe_for(kind, makes).unwrap(), fetcher)
}

// fetching inputs

#[test]
fn fetches_a_load_of_ore_at_the_storage_picked_as_input() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "near", 8.0, 6.0, json!({ "ironOre": 500 }));
    storage(&mut world, "main", 10.0, 6.0, json!({ "ironOre": 500 }));
    storage(&mut world, "inp", 14.0, 6.0, json!({ "ironOre": 500 }));
    for id in ["w1", "w2", "w3"] {
        add_worker(&mut world, id, json!({ "storage": "main", "input": "inp" }), None);
    }
    let fetcher = one_fetcher(&mut world, &terrain);
    let load = load_of(&world, &fetcher, BuildingKind::Smelter, None);
    assert!(held(&load, Good::IronOre) > 2.0);
    assert_matches(
        &order_json(&fetcher),
        json!({ "kind": "fetch", "goods": load, "from": { "kind": "storage", "storageId": "inp" } }),
    );
    let last = fetcher.script_log.as_ref().and_then(|l| l.last()).map(|l| l.text.clone());
    assert_eq!(
        last,
        Some(format!("fetching {} ironOre from the storage at 14,6", held(&load, Good::IronOre)))
    );
}

#[test]
fn fetches_at_the_main_storage_without_an_input_or_with_one_holding_none() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "near", 8.0, 6.0, json!({ "ironOre": 500 }));
    storage(&mut world, "main", 10.0, 6.0, json!({ "ironOre": 500 }));
    storage(&mut world, "inp", 14.0, 6.0, json!({ "wood": 50 }));
    add_worker(&mut world, "w1", json!({ "storage": "main", "input": "inp" }), None);
    add_worker(&mut world, "w2", json!({ "storage": "main" }), None);
    let fetcher = one_fetcher(&mut world, &terrain);
    assert_matches(
        &order_json(&fetcher),
        json!({ "from": { "kind": "storage", "storageId": "main" } }),
    );
}

#[test]
fn fetches_at_the_nearest_storage_holding_ore_with_none_picked() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "near", 8.0, 6.0, json!({ "wood": 50 }));
    storage(&mut world, "holding", 12.0, 6.0, json!({ "ironOre": 500 }));
    storage(&mut world, "far", 20.0, 6.0, json!({ "ironOre": 500 }));
    for id in ["w1", "w2"] {
        add_worker(&mut world, id, json!({}), None);
    }
    let fetcher = one_fetcher(&mut world, &terrain);
    assert_matches(
        &order_json(&fetcher),
        json!({ "from": { "kind": "storage", "storageId": "holding" } }),
    );
}

#[test]
fn stands_idle_with_no_ore_anywhere() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "s1", 8.0, 6.0, json!({ "wood": 50, "food": 50 }));
    for id in ["w1", "w2"] {
        add_worker(&mut world, id, json!({}), None);
    }
    let mut runner = runner(&terrain);
    let mut scratch = Scratch::default();
    for _ in 0..20 {
        assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
        step_world(&mut world, &terrain, &mut scratch, None, None);
    }
    assert!(fetchers(&world).is_empty());
    for r in &world.residents {
        assert_matches(&order_json(r), json!({ "kind": "workAt", "buildingId": "place" }));
    }
}

#[test]
fn fetches_nothing_while_the_pile_holds_a_batch_or_a_worker_carries_one() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "s1", 8.0, 6.0, json!({ "ironOre": 500 }));
    let w1 = add_worker(&mut world, "w1", json!({}), None);
    add_worker(&mut world, "w2", json!({}), None);
    world.residents[w1].carried.insert(Good::IronOre, 2.0);
    let mut runner = runner(&terrain);
    let mut scratch = Scratch::default();
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert!(fetchers(&world).is_empty());
    world.residents[w1].carried.insert(Good::IronOre, 1.0);
    world.piles.push(
        serde_json::from_value(json!({ "id": "p", "x": 6, "y": 6, "goods": { "ironOre": 1 } }))
            .unwrap(),
    );
    assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
    assert!(fetchers(&world).is_empty());
}

#[test]
fn fetches_nothing_while_one_of_them_carries_the_output() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "s1", 8.0, 6.0, json!({ "ironOre": 500 }));
    let w1 = add_worker(&mut world, "w1", json!({}), None);
    add_worker(&mut world, "w2", json!({}), None);
    add_worker(&mut world, "w3", json!({}), None);
    let r = &mut world.residents[w1];
    r.order = None;
    r.x = 8.0;
    r.script.as_mut().unwrap().memory.insert(
        "carry".into(),
        json!({ "storageId": "s1", "goods": ["iron"], "stored": true, "walked": false }),
    );
    assert_eq!(runner(&terrain).run_all(&mut world, &mut Scratch::default(), true), vec![]);
    assert!(fetchers(&world).is_empty());
}

#[test]
fn brings_the_ore_to_the_pile_and_goes_back_to_work_one_fetcher_at_a_time() {
    let (mut world, terrain) = smelter_world("smelter");
    storage(&mut world, "s1", 12.0, 6.0, json!({ "ironOre": 300, "food": 200 }));
    for id in ["w1", "w2", "w3"] {
        add_worker(&mut world, id, json!({}), None);
    }
    let mut runner = runner(&terrain);
    let mut scratch = Scratch::default();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let pile = |w: &WorldState, g: Good| pile_at(w, 6.0, 6.0).map_or(0.0, |p| held(&p.goods, g));
    let mut trips = 0;
    let mut smelted = false;
    // Two loads take a few game days to smelt.
    for _ in 0..12_000 {
        if trips >= 2 {
            break;
        }
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        assert_eq!(runner.run_all(&mut world, &mut scratch, true), vec![]);
        assert!(fetchers(&world).len() <= 1);
        let before = pile(&world, Good::IronOre);
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if pile(&world, Good::IronOre) > before {
            trips += 1;
        }
        smelted |= pile(&world, Good::Iron) > 0.0;
    }
    assert!(trips > 1);
    assert!(smelted);
    let s1 = world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert!(held(s1.stock.as_ref().unwrap(), Good::IronOre) < 300.0);
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn fetches_iron_and_wood_for_a_smithy_workers_recipe_in_its_proportions() {
    let (mut world, terrain) = smelter_world("smithy");
    storage(&mut world, "s1", 10.0, 6.0, json!({ "iron": 200, "wood": 200 }));
    add_worker(&mut world, "w1", json!({}), Some("spear"));
    let fetcher = one_fetcher(&mut world, &terrain);
    let load = load_of(&world, &fetcher, BuildingKind::Smithy, Some("spear"));
    assert_eq!(held(&load, Good::Wood), 2.0 * held(&load, Good::Iron));
    assert!(held(&load, Good::Iron) > 1.0);
    assert_matches(&order_json(&fetcher), json!({ "kind": "fetch", "goods": load }));
}

#[test]
fn fetches_only_the_iron_a_smithy_lacks_with_wood_enough_on_its_pile_and_none_from_wood_alone() {
    let (mut world, terrain) = smelter_world("smithy");
    storage(&mut world, "s1", 10.0, 6.0, json!({ "wood": 200 }));
    world.piles.push(
        serde_json::from_value(json!({ "id": "p", "x": 6, "y": 6, "goods": { "wood": 5 } }))
            .unwrap(),
    );
    add_worker(&mut world, "w1", json!({}), Some("spear"));
    assert_eq!(runner(&terrain).run_all(&mut world, &mut Scratch::default(), true), vec![]);
    assert!(fetchers(&world).is_empty());
    let s = world.buildings.iter_mut().find(|b| b.id == "s1").unwrap();
    s.stock.as_mut().unwrap().insert(Good::Iron, 50.0);
    let fetcher = one_fetcher(&mut world, &terrain);
    let goods = order_json(&fetcher)["goods"].clone();
    let keys: Vec<&String> = goods.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["iron"]);
}

#[test]
fn flags_two_residents_of_a_workplace_away_fetching_its_inputs_at_once() {
    let (mut world, _) = smelter_world("smelter");
    let w1 = add_worker(&mut world, "w1", json!({}), None);
    let w2 = add_worker(&mut world, "w2", json!({}), None);
    let away = json!({ "missing": [{ "good": "ironOre", "units": 20 }] });
    world.residents[w1].script.as_mut().unwrap().memory.insert("input".into(), away.clone());
    assert_eq!(one_input_fetcher_at_a_time(&world, &|_| true), vec![]);
    world.residents[w2].script.as_mut().unwrap().memory.insert("input".into(), away);
    let found = one_input_fetcher_at_a_time(&world, &|_| true);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "one-input-fetcher-at-a-time");
    assert_eq!(found[0].entity_ids, ["place", "w1", "w2"]);
}
