//! `transfers.fixture.ts`: the Trade Org HQ, a trading post with its caravan, Mara's and Ivo's
//! starting cities, and Mara's resident p1 on the post's warehouse with 1,000 coins, as the
//! TypeScript wrote it (`fixtures/trade/transfers.json`), and the helpers its tests share.

#![allow(dead_code)]

use std::sync::Arc;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, BuildingKind, City, Good, Stock, TradeOrgCity, WorldState};
use csp_sim::invariants::{check_invariants, world_invariants};
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::warehouse_trade::delivery_storage;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};

use super::common;
use super::goods_support::{open, player};

pub const MARA: u64 = 7;
pub const IVO: u64 = 8;

pub struct Fixture {
    pub world: WorldState,
    pub terrain: Arc<TerrainMap>,
    pub scratch: Scratch,
    pub queue: OrderQueue,
    /// Mara's realm, city and the storage deliveries go to there.
    pub realm: String,
    pub city: String,
    pub storage: String,
    /// Ivo's.
    pub other: String,
    pub to_city: String,
    pub to_storage: String,
}

fn realm_of(world: &WorldState, user: u64) -> String {
    world.realms.iter().find(|r| r.user_id == user).unwrap().id.clone()
}

fn city_of(world: &WorldState, realm: &str) -> String {
    world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm)).unwrap().id.clone()
}

/// What an order answers: "ack", or why it was refused.
pub fn answer(reply: OrderReply) -> String {
    match reply {
        OrderReply::Rejected { reason, .. } => reason,
        _ => "ack".into(),
    }
}

/// `setup()`.
pub fn setup() -> Fixture {
    let (world, size, _) = common::load_world("trade/transfers.json");
    let terrain = Arc::new(open(size));
    let realm = realm_of(&world, MARA);
    let other = realm_of(&world, IVO);
    let city = city_of(&world, &realm);
    let to_city = city_of(&world, &other);
    let storage = delivery_storage(&world, &city).unwrap().id.clone();
    let to_storage = delivery_storage(&world, &to_city).unwrap().id.clone();
    Fixture {
        queue: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        world,
        terrain,
        scratch: Scratch::default(),
        realm,
        other,
        city,
        to_city,
        storage,
        to_storage,
    }
}

/// An NPC city of the test world, with its town hall at (x, y) (`addCity`).
pub fn add_city(world: &mut WorldState, id: &str, name: &str, x: f64, y: f64) {
    let hall: Building = serde_json::from_value(json!({
        "id": format!("{id}-hall"), "kind": "townHall", "cityId": id, "x": x, "y": y,
    }))
    .unwrap();
    world.buildings.push(hall);
    let city: City = serde_json::from_value(json!({
        "id": id, "name": name, "realmId": null, "townHallId": format!("{id}-hall"),
        "layout": "grid",
    }))
    .unwrap();
    world.cities.push(city);
}

impl Fixture {
    pub fn size(&self) -> i32 {
        self.terrain.size
    }

    pub fn b(&self, id: &str) -> &Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }

    pub fn b_mut(&mut self, id: &str) -> &mut Building {
        self.world.buildings.iter_mut().find(|b| b.id == id).unwrap()
    }

    pub fn held(&self, id: &str, g: Good) -> Option<f64> {
        self.b(id).stock.as_ref().and_then(|s| s.get(&g)).copied()
    }

    pub fn set(&mut self, id: &str, g: Good, n: Option<f64>) {
        let s = self.b_mut(id).stock.get_or_insert_with(Stock::new);
        match n {
            Some(n) => s.insert(g, n),
            None => s.shift_remove(&g),
        };
    }

    pub fn xy(&self, id: &str) -> (f64, f64) {
        let b = self.b(id);
        (b.x, b.y)
    }

    /// The post's warehouse, where p1 stands.
    pub fn warehouse(&self) -> &Building {
        let post =
            self.world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Post)).unwrap();
        self.world
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(&post.id))
            .unwrap()
    }

    /// Mara's order (for p1, when it is a resident's), applied, and what it answers (`order`).
    pub fn order(&mut self, mut o: Value) -> String {
        if o.get("residentId").is_none() {
            o["residentId"] = json!("p1");
        }
        self.send(MARA, o)
    }

    /// A Player's order as it is, applied, and what it answers.
    pub fn send(&mut self, user: u64, o: Value) -> String {
        let reply = self.queue.receive(&self.world, &player(user), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        answer(reply)
    }

    /// The events of `kind` in a Player's log, as JSON (`eventsOf`).
    pub fn events(&self, kind: &str, user: u64) -> Vec<Value> {
        self.world
            .events
            .iter()
            .filter(|e| e.user_id == user)
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == kind)
            .collect()
    }

    /// Every invariant's findings, as messages.
    pub fn broken(&self) -> Vec<String> {
        check_invariants(&self.world, &self.terrain, &world_invariants())
            .into_iter()
            .map(|v| v.message)
            .collect()
    }

    /// Steps at least once and then until `done`, at most `ticks` times, checking every invariant
    /// now and then (`runUntil`).
    pub fn run_until(&mut self, ticks: usize, mut done: impl FnMut(&WorldState) -> bool) {
        let mut walking = Walking::new(self.terrain.clone());
        let terrain = self.terrain.clone();
        let mut t = 0;
        while t < ticks && (t == 0 || !done(&self.world)) {
            step_world(&mut self.world, &terrain, &mut self.scratch, Some(&mut walking), None);
            if t % 500 == 0 {
                assert_eq!(self.broken(), Vec::<String>::new(), "tick {}", self.world.tick);
            }
            t += 1;
        }
        assert!(done(&self.world), "not done after {t} ticks");
        assert_eq!(self.broken(), Vec::<String>::new());
    }

    /// Every unit of a good in the world (`total`).
    pub fn total(&self, g: Good) -> f64 {
        super::goods_support::total(&self.world).get(&g).copied().unwrap_or(0.0)
    }
}

/// Whether `actual` holds everything in `expected` (vitest's `toMatchObject`).
pub fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => {
            e.iter().all(|(k, v)| a.get(k).is_some_and(|x| matches(x, v)))
        }
        (Value::Array(a), Value::Array(e)) => {
            a.len() == e.len() && a.iter().zip(e).all(|(x, y)| matches(x, y))
        }
        (Value::Number(a), Value::Number(e)) => a.as_f64() == e.as_f64(),
        _ => actual == expected,
    }
}

#[track_caller]
pub fn assert_matches<T: serde::Serialize>(actual: &T, expected: Value) {
    let actual = serde_json::to_value(actual).unwrap();
    assert!(matches(&actual, &expected), "{actual:#}\ndoes not match\n{expected:#}");
}
