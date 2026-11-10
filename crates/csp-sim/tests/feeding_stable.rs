//! `feeding-stable.test.ts`, one test per `it`. Feeding the stable (`CONTEXT.md`: Feeding the
//! stable): a resident given the task keeps Food for `STABLE_FEED_DAYS` game days for the horses
//! in the stable, fetching what is missing from the nearest storage with Food or the one picked,
//! and waits there while it has enough.

mod goods_support;
mod tasks_support;

use csp_shared::balance::{
    ticks_for_age, AVERAGE_HORSE_STATS, HORSE_FOOD_PER_DAY, MAX_HEALTH, MAX_HUNGER, OWN_FOOD,
    STABLE_FEED_DAYS,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, Horse, Resident, ResidentOrder, Stock};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use goods_support::{drawn_resident, open, realm};
use serde_json::{json, Value};
use tasks_support::{ack, add_city, from, reason, Game};

const SIZE: i32 = 32;

/// Two horses' Food for `STABLE_FEED_DAYS`.
const KEEP: f64 = 2.0 * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn horse(id: &str, x: f64, y: f64) -> Horse {
    let s = AVERAGE_HORSE_STATS;
    from(json!({
        "id": id, "realmId": "r1", "cityId": null, "x": x, "y": y, "hunger": MAX_HUNGER,
        "health": MAX_HEALTH, "name": "Rowan",
        "stats": { "speed": s.speed, "strength": s.strength, "endurance": s.endurance },
        "bornAt": 0,
    }))
}

/// Realm r1 (Player 7) with city c1 at (10, 14); a stable s1 at (10, 10) holding `food` with
/// horses h1 and h2 in it, a storage near at (14, 10) with 100 Food and one far at (10, 18) with
/// 100; resident w1 standing in the stable.
fn setup(food: f64) -> Game {
    let terrain = open(SIZE);
    let mut world = csp_sim::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 14.0);
    for b in [
        json!({ "id": "s1", "kind": "stable", "cityId": "c1", "x": 10, "y": 10, "stock": { "food": food } }),
        json!({ "id": "near", "kind": "storage", "cityId": "c1", "x": 14, "y": 10, "stock": { "food": 100 } }),
        json!({ "id": "far", "kind": "storage", "cityId": "c1", "x": 10, "y": 18, "stock": { "food": 100 } }),
    ] {
        world.buildings.push(from(b));
    }
    world.horses.push(horse("h1", 10.0, 11.0));
    world.horses.push(horse("h2", 12.0, 11.0));
    let mut w1 = drawn_resident(1.0, "w1", Some("r1"), Some("c1"), 11.0, 11.0);
    w1.stats.strength.base = 10.0;
    w1.stats.strength.trained = 0.0;
    w1.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    world.residents.push(w1);
    Game::new(world, terrain, vec![me()])
}

fn w1(g: &Game) -> &Resident {
    g.world.residents.iter().find(|r| r.id == "w1").unwrap()
}

fn w1_mut(g: &mut Game) -> &mut Resident {
    g.world.residents.iter_mut().find(|r| r.id == "w1").unwrap()
}

fn food_in(g: &Game, id: &str) -> f64 {
    let b = g.world.buildings.iter().find(|b| b.id == id).unwrap();
    b.stock.as_ref().and_then(|s| s.get(&Good::Food)).copied().unwrap_or(0.0)
}

fn order(g: &Game) -> Value {
    serde_json::to_value(&w1(g).order).unwrap()
}

fn memory(g: &Game) -> Value {
    Value::Object(w1(g).script.as_ref().unwrap().memory.clone())
}

/// Runs scripts and steps the world, keeping the resident fed; `each` sees every tick (`run`).
fn run(g: &mut Game, ticks: usize, mut each: impl FnMut(&Game)) {
    for _ in 0..ticks {
        for r in &mut g.world.residents {
            r.hunger = MAX_HUNGER;
        }
        g.tick();
        each(g);
    }
    assert_eq!(check_all(&g.world, &g.terrain), []);
}

fn give(g: &mut Game, stable_id: &str) -> csp_sim::orders::OrderReply {
    let order =
        json!({ "kind": "task", "task": "feedStable", "residentId": "w1", "stableId": stable_id });
    g.give(&me(), order)
}

#[test]
fn fetches_what_is_missing_from_the_nearest_storage_with_food_and_stores_it_in_the_stable() {
    let mut g = setup(3.0);
    assert_eq!(give(&mut g, "s1"), ack());
    assert_eq!(memory(&g), json!({ "stableId": "s1" }));
    run(&mut g, 1, |_| {});
    let o = order(&g);
    assert_eq!(o["kind"], "fetch", "{o}");
    assert_eq!(o["goods"], json!({ "food": (KEEP - 3.0).ceil() }));
    assert_eq!(o["from"]["kind"], "storage");
    assert_eq!(o["from"]["storageId"], "near");
    run(&mut g, 200, |_| {});
    assert!(food_in(&g, "s1") >= KEEP - 0.1);
    // What they fetched went in; their own food stayed theirs.
    assert!(w1(&g).carried.get(&Good::Food).copied().unwrap_or(0.0) >= OWN_FOOD - 1.0);
}

#[test]
fn keeps_it_at_the_amount_while_the_source_has_food_and_waits_in_the_stable() {
    let mut g = setup(KEEP + 1.0);
    give(&mut g, "s1");
    run(&mut g, 5, |_| {});
    // Enough: they wait there.
    assert!(w1(&g).order.is_none());
    assert!(food_in(&g, "s1") > KEEP);
    let mut lowest = f64::INFINITY;
    let mut trips = 0;
    let mut fetching = false;
    run(&mut g, 2 * TICKS_PER_GAME_DAY as usize, |g| {
        lowest = lowest.min(food_in(g, "s1"));
        let now = matches!(w1(g).order, Some(ResidentOrder::Fetch(_)));
        if now && !fetching {
            trips += 1;
        }
        fetching = now;
    });
    // The horses ate it down; each time it fell below, they brought more at once.
    assert!(trips > 0);
    assert!(lowest >= KEEP - 1.0, "{lowest}"); // horses eat whole units
    assert!(g.world.horses.iter().all(|h| h.hunger > 0.0));
}

#[test]
fn fetches_from_the_storage_picked_as_source_and_feeds_the_stable_picked_as_stable() {
    let mut g = setup(0.0);
    g.world.buildings.push(from(
        json!({ "id": "s2", "kind": "stable", "cityId": "c1", "x": 6, "y": 14, "stock": {} }),
    ));
    g.world.horses.push(horse("h3", 7.0, 15.0));
    give(&mut g, "s1");
    let script_id = w1(&g).script.as_ref().unwrap().script_id;
    w1_mut(&mut g).script_params =
        Some(from(json!({ script_id.to_string(): { "source": "far", "stable": "s2" } })));
    run(&mut g, 1, |_| {});
    let o = order(&g);
    assert_eq!(o["kind"], "fetch", "{o}");
    assert_eq!(o["from"]["kind"], "storage");
    assert_eq!(o["from"]["storageId"], "far");
    run(&mut g, 300, |_| {});
    // One horse's Food at s2; s1 got none.
    assert!(food_in(&g, "s2") >= STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY - 0.1);
    assert_eq!(food_in(&g, "s1"), 0.0);
}

#[test]
fn waits_in_the_stable_while_no_storage_of_the_realm_has_food() {
    let mut g = setup(0.0);
    for b in &mut g.world.buildings {
        if b.kind == csp_shared::world::BuildingKind::Storage {
            b.stock = Some(Stock::new());
        }
    }
    w1_mut(&mut g).x = 4.0;
    w1_mut(&mut g).y = 11.0;
    give(&mut g, "s1"); // not standing in it
    assert!(w1(&g).script.is_none());
    w1_mut(&mut g).x = 10.0;
    give(&mut g, "s1");
    run(&mut g, 5, |_| {});
    assert!(w1(&g).order.is_none());
    assert_eq!(memory(&g).get("fetched"), None);
}

#[test]
fn is_turned_down_outside_the_stable_and_for_a_child() {
    let mut g = setup(0.0);
    w1_mut(&mut g).x = 4.0;
    assert_eq!(reason(&give(&mut g, "s1")).as_deref(), Some("not standing in that stable"));
    w1_mut(&mut g).x = 11.0;
    let tick = g.world.tick as f64;
    w1_mut(&mut g).born_at = tick - ticks_for_age(5.0);
    assert_eq!(
        reason(&give(&mut g, "s1")).as_deref(),
        Some("children can\u{2019}t store or fetch goods")
    );
}
