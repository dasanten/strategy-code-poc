//! `tasks-started-directly.test.ts`, one test per `it`. Tear down, Feed the stable and Breed
//! horses started directly (`CONTEXT.md`: Default script, Started directly; Breeding; Feeding the
//! stable): their target is the param `building` or `stable`; unset, the one on the resident's
//! tile when it starts, never kept between starts. With none there each ends with a reason.

mod goods_support;
mod tasks_support;

use csp_shared::balance::{MAX_HEALTH, MAX_HUNGER, OWN_FOOD};
use csp_shared::world::{Good, Horse, Resident, Stock, Task};
use csp_sim::order_sender::OrderSender;
use goods_support::{drawn_resident, open, realm};
use serde_json::{json, Value};
use tasks_support::{add_city, default_script_id, events, from, Game};

const SIZE: i32 = 32;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// Player 7's version of a task's default (`defaultScripts`).
fn script(task: Task) -> u64 {
    default_script_id(7, task)
}

fn horse(id: &str, x: f64, y: f64) -> Horse {
    from(json!({
        "id": id, "realmId": "r1", "cityId": null, "x": x, "y": y, "hunger": MAX_HUNGER,
        "health": MAX_HEALTH, "name": "Rowan",
        "stats": { "speed": 10, "strength": 10, "endurance": 10 }, "bornAt": 0,
    }))
}

/// Realm r1 (Player 7) with city c1: stable st1 at (6, 6) with fed horses h1 and h2 of r1 in it,
/// a storage s1 at (14, 6) with Food, a house hs at (6, 16); resident w1 standing in the stable,
/// w2 on an empty tile (24, 24) and w3 on the house.
fn setup() -> Game {
    let terrain = open(SIZE);
    let mut world = csp_sim::world::create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    for b in [
        json!({ "id": "st1", "kind": "stable", "cityId": "c1", "x": 6, "y": 6, "stock": {} }),
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 14, "y": 6, "stock": { "food": 200 } }),
        json!({ "id": "hs", "kind": "house", "cityId": "c1", "x": 6, "y": 16 }),
    ] {
        world.buildings.push(from(b));
    }
    world.horses.push(horse("h1", 6.0, 6.0));
    world.horses.push(horse("h2", 7.0, 7.0));
    for (id, x, y, seed) in [("w1", 7.0, 7.0, 1.0), ("w2", 24.0, 24.0, 2.0), ("w3", 6.0, 16.0, 3.0)]
    {
        let mut r = drawn_resident(seed, id, Some("r1"), None, x, y);
        r.city_id = Some("c1".into());
        r.stats.strength.base = 10.0;
        r.stats.strength.trained = 0.0;
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        world.residents.push(r);
    }
    Game::new(world, terrain, vec![me()])
}

/// One tick as the game runs it: orders, scripts (with invariants), the world steps; everyone
/// kept fed.
fn tick(g: &mut Game) {
    for r in &mut g.world.residents {
        r.hunger = 100.0;
    }
    g.tick();
}

fn give(g: &mut Game, order: Value, resident_id: &str) {
    let mut order = order;
    order["residentId"] = json!(resident_id);
    g.send(&me(), order);
}

fn get<'g>(g: &'g Game, id: &str) -> &'g Resident {
    g.world.residents.iter().find(|r| r.id == id).unwrap()
}

fn order(g: &Game, id: &str) -> Value {
    serde_json::to_value(&get(g, id).order).unwrap()
}

fn order_kind(g: &Game, id: &str) -> Value {
    order(g, id)["kind"].clone()
}

fn running(g: &Game, id: &str) -> bool {
    get(g, id).script.is_some()
}

fn memory(g: &Game, id: &str) -> Value {
    Value::Object(get(g, id).script.as_ref().unwrap().memory.clone())
}

/// The params `id` has picked for `task`'s default, if any.
fn params(g: &Game, id: &str, task: Task) -> Value {
    let all = serde_json::to_value(&get(g, id).script_params).unwrap();
    all.get(script(task).to_string()).cloned().unwrap_or(Value::Null)
}

fn stopped(g: &Game) -> Vec<String> {
    events(&g.world, "scriptStopped")
        .into_iter()
        .map(|e| e["reason"].as_str().unwrap().to_string())
        .collect()
}

fn stable_food(g: &Game) -> f64 {
    let st1 = g.world.buildings.iter().find(|b| b.id == "st1").unwrap();
    st1.stock.as_ref().and_then(|s| s.get(&Good::Food)).copied().unwrap_or(0.0)
}

// Tear down started directly

#[test]
fn tears_down_the_house_the_resident_stands_on_with_run_script_on_an_empty_tile_it_ends() {
    let mut s = setup();
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::TearDown) }), "w3");
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::TearDown) }), "w2");
    tick(&mut s);
    assert_eq!(order_kind(&s, "w3"), "tearDown");
    assert_eq!(order(&s, "w3")["buildingId"], "hs");
    assert!(!running(&s, "w2"));
    assert_eq!(stopped(&s), ["no building on their tile"]);
    for _ in 0..3000 {
        if !running(&s, "w3") {
            break;
        }
        tick(&mut s);
    }
    assert!(!s.world.buildings.iter().any(|b| b.id == "hs"));
    assert!(!running(&s, "w3"));
}

#[test]
fn walks_to_the_building_picked_before_it_starts_and_tears_it_down() {
    let mut s = setup();
    let o = json!({ "kind": "runScript", "scriptId": script(Task::TearDown), "params": { "building": "hs" } });
    give(&mut s, o, "w2");
    for _ in 0..1000 {
        if order_kind(&s, "w2") == "tearDown" {
            break;
        }
        tick(&mut s);
    }
    assert_eq!(order_kind(&s, "w2"), "tearDown");
    assert_eq!(order(&s, "w2")["buildingId"], "hs");
}

#[test]
fn never_keeps_the_building_given_on_the_house_run_again_in_the_stable_it_tears_that_down() {
    let mut s = setup();
    give(&mut s, json!({ "kind": "task", "task": "tearDown", "buildingId": "hs" }), "w3");
    tick(&mut s);
    assert_eq!(params(&s, "w3", Task::TearDown), json!({ "building": "hs" }));
    give(&mut s, json!({ "kind": "walkTo", "x": 7, "y": 7 }), "w3");
    for _ in 0..100 {
        let w3 = get(&s, "w3");
        if w3.x == 7.0 && w3.y == 7.0 {
            break;
        }
        tick(&mut s);
    }
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::TearDown) }), "w3");
    tick(&mut s);
    assert_eq!(order_kind(&s, "w3"), "tearDown");
    assert_eq!(order(&s, "w3")["buildingId"], "st1");
    assert_eq!(params(&s, "w3", Task::TearDown), Value::Null);
}

// Feed the stable started directly

#[test]
fn feeds_the_stable_the_resident_stands_in_with_run_script_on_an_empty_tile_it_ends() {
    let mut s = setup();
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::FeedStable) }), "w1");
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::FeedStable) }), "w2");
    tick(&mut s);
    assert!(!running(&s, "w2"));
    assert_eq!(stopped(&s), ["no stable here"]);
    assert_eq!(memory(&s, "w1")["stableId"], "st1");
    for _ in 0..300 {
        if stable_food(&s) > 0.0 {
            break;
        }
        tick(&mut s);
    }
    assert!(stable_food(&s) > 0.0);
}

#[test]
fn ends_once_the_stable_is_gone_or_when_the_one_picked_is_no_stable() {
    let mut s = setup();
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::FeedStable) }), "w1");
    let o = json!({ "kind": "runScript", "scriptId": script(Task::FeedStable), "params": { "stable": "s1" } });
    give(&mut s, o, "w2");
    tick(&mut s);
    assert!(!running(&s, "w2"));
    s.world.buildings.retain(|b| b.id != "st1");
    for _ in 0..300 {
        if !running(&s, "w1") {
            break;
        }
        tick(&mut s);
    }
    assert!(!running(&s, "w1"));
    assert_eq!(stopped(&s), ["the one picked is no stable", "the stable is gone"]);
}

#[test]
fn given_in_the_stable_fills_the_param_which_the_next_start_clears() {
    let mut s = setup();
    let o = json!({ "kind": "task", "task": "feedStable", "stableId": "st1", "params": { "source": "s1" } });
    give(&mut s, o, "w1");
    tick(&mut s);
    assert_eq!(params(&s, "w1", Task::FeedStable), json!({ "stable": "st1", "source": "s1" }));
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::FeedStable) }), "w1");
    tick(&mut s);
    assert_eq!(params(&s, "w1", Task::FeedStable), json!({ "source": "s1" }));
    assert_eq!(memory(&s, "w1")["stableId"], "st1");
}

// Breed horses started directly

fn until_breeding(s: &mut Game, id: &str, ticks: usize) {
    for _ in 0..ticks {
        if order_kind(s, id) == "breed" {
            break;
        }
        tick(s);
    }
}

#[test]
fn breeds_two_fed_horses_in_the_stable_the_resident_stands_in_elsewhere_it_ends() {
    let mut s = setup();
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::Breed) }), "w1");
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::Breed) }), "w2");
    until_breeding(&mut s, "w1", 20);
    let o = order(&s, "w1");
    assert_eq!(o["kind"], "breed", "{o}");
    assert_eq!(o["stableId"], "st1");
    assert_eq!(o["horseIds"], json!(["h1", "h2"]));
    assert!(!running(&s, "w2"));
    assert_eq!(stopped(&s), ["no stable here"]);
}

#[test]
fn ends_with_no_two_fed_horses_in_the_stable() {
    let mut s = setup();
    s.world.horses.retain(|h| h.id != "h2");
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::Breed) }), "w1");
    tick(&mut s);
    assert!(!running(&s, "w1"));
    assert_eq!(stopped(&s), ["no two fed horses here"]);
}

#[test]
fn carries_on_with_a_paused_pair_in_the_stable_first() {
    let mut s = setup();
    for id in ["h3", "h4"] {
        let mut h = s.world.horses[0].clone();
        h.id = id.into();
        h.x = 8.0;
        h.y = 8.0;
        s.world.horses.push(h);
    }
    let st1 = s.world.buildings.iter_mut().find(|b| b.id == "st1").unwrap();
    st1.breedings = Some(from(json!([{ "horseIds": ["h3", "h4"], "progress": 25 }])));
    give(&mut s, json!({ "kind": "runScript", "scriptId": script(Task::Breed) }), "w1");
    until_breeding(&mut s, "w1", 20);
    let o = order(&s, "w1");
    assert_eq!(o["kind"], "breed", "{o}");
    assert_eq!(o["horseIds"], json!(["h3", "h4"]));
    assert!(o["progress"].as_f64().unwrap() >= 25.0);
}

#[test]
fn walks_to_the_stable_picked_before_it_starts_and_breeds_there() {
    let mut s = setup();
    let o = json!({ "kind": "runScript", "scriptId": script(Task::Breed), "params": { "stable": "st1" } });
    give(&mut s, o, "w2");
    until_breeding(&mut s, "w2", 1000);
    let o = order(&s, "w2");
    assert_eq!(o["kind"], "breed", "{o}");
    assert_eq!(o["stableId"], "st1");
    assert_eq!(o["horseIds"], json!(["h1", "h2"]));
}
