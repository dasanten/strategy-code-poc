//! `working-a-site.test.ts`: working a site (`CONTEXT.md`: Working a site). Work given or queued
//! on a construction site of a workplace kind builds it first, as Build would, with materials from
//! the nearest storage of the realm holding them, then works it once it is finished, with no new
//! order.

use std::sync::Arc;

use csp_shared::balance::{BUILD_MATERIALS, MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, Good, Realm, Resident, Stat, Stock, Task, WorldState};
use serde_json::{json, Value};

use super::default_host::{default_script_id, DefaultScripts};
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::queries::names::{good_of, held};
use crate::queues::{queues_sound, QueueHost, QueueRunner};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::sight::seen_script;
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 32;
const AT: (f64, f64) = (6.0, 6.0);

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

struct Senders;

impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(me)
    }
}

fn resident(world: &mut WorldState, id: &str, (x, y): (f64, f64)) {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some("r1"), city_id: None, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.city_id = Some("c1".into());
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    world.residents.push(r);
}

/// The materials a kind takes, by good.
fn materials(kind: &str) -> Vec<(Good, f64)> {
    let table = BUILD_MATERIALS.get(kind).expect("materials");
    table.0.iter().map(|(g, n)| (good_of(g).expect("a good"), *n)).collect()
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scripts: DefaultScripts,
    orders: OrderQueue,
    queues: QueueRunner,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1 on Plains: site f1 of a `kind` workplace at (6, 6) (a quarry
/// on a stone node on Hills), with nothing delivered; storage s1 at (14, 6) holding twice its
/// materials and some Food; and resident w1 standing on the site (`setup`).
fn setup(kind: &str) -> Setup {
    let mut terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    if kind == "quarry" {
        terrain.tiles[(AT.1 as i32 * SIZE + AT.0 as i32) as usize] = Terrain::Hills as u8;
    }
    let mut world = create_world(&terrain, 1);
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "w1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    // A node's workplace belongs to no city (`CONTEXT.md`: Workplace).
    let city = if kind == "farm" { json!("c1") } else { Value::Null };
    let f1 = json!({ "id": "f1", "kind": kind, "cityId": city, "x": AT.0, "y": AT.1, "site": { "delivered": {}, "work": 0 } });
    if kind == "quarry" {
        let node = json!({ "id": "n1", "kind": "stone", "x": AT.0, "y": AT.1 });
        world.nodes.push(serde_json::from_value(node).unwrap());
    }
    let mut stock = Stock::from([(Good::Food, 50.0)]);
    for (g, n) in materials(kind) {
        stock.insert(g, n * 2.0);
    }
    world.buildings.push(serde_json::from_value::<Building>(f1).unwrap());
    let s1 = json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 14, "y": 6 });
    let mut s1 = serde_json::from_value::<Building>(s1).unwrap();
    s1.stock = Some(stock);
    world.buildings.push(s1);
    resident(&mut world, "w1", AT);
    let terrain = Arc::new(terrain);
    let scripts = DefaultScripts::new(terrain.clone(), &[me()]);
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
    let queues = QueueRunner::new(Box::new(Senders), scripts.kinds.clone(), Some(terrain.clone()));
    let walking = Walking::new(terrain.clone());
    Setup { world, terrain, scripts, orders, queues, walking, scratch: Scratch::default() }
}

impl Setup {
    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn b(&self, id: &str) -> Option<&Building> {
        self.world.buildings.iter().find(|b| b.id == id)
    }

    fn f1_is_site(&self) -> bool {
        self.b("f1").is_some_and(|b| b.site.is_some())
    }

    fn order(&self, id: &str) -> Value {
        self.r(id).order.as_ref().map_or(Value::Null, |o| serde_json::to_value(o).unwrap())
    }

    fn memory(&self, id: &str, key: &str) -> Option<Value> {
        self.r(id).script.as_ref().map(|s| s.memory.get(key).cloned().unwrap_or(Value::Null))
    }

    /// One tick as the game runs it: orders, queues, scripts (with invariants), the world steps.
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), []);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
        assert_eq!(queues_sound(&self.world, &self.terrain), []);
    }

    fn give(&mut self, order: Value, resident_id: &str) -> String {
        let mut o = json!({ "residentId": resident_id });
        o.as_object_mut().unwrap().extend(order.as_object().unwrap().clone());
        match self.orders.receive(&self.world, &me(), &json!("q"), &o) {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    fn stopped(&self) -> Vec<String> {
        let events = self.world.events.iter().map(|e| serde_json::to_value(e).unwrap());
        let stopped = events.filter(|e| e["kind"] == "scriptStopped");
        stopped.map(|e| e["reason"].as_str().unwrap().to_string()).collect()
    }

    /// Ticks until `done`, at most `n` ticks.
    fn until(&mut self, n: usize, mut done: impl FnMut(&Setup) -> bool) {
        for _ in 0..n {
            if done(self) {
                return;
            }
            self.tick();
        }
    }

    fn seen(&self, id: &str) -> Value {
        let script = self.r(id).script.as_ref().expect("a script");
        serde_json::to_value(seen_script(&self.world, script, true)).unwrap()
    }
}

fn work() -> Value {
    json!({ "kind": "task", "task": "work", "workplaceId": "f1" })
}

fn kind_is(s: &Setup, id: &str, kind: &str) -> bool {
    s.order(id)["kind"] == kind
}

#[test]
fn builds_it_with_materials_from_the_nearest_storage_then_works_it_without_a_new_order() {
    let mut s = setup("quarry");
    assert_eq!(s.give(work(), "w1"), "ack");
    s.until(20, |s| kind_is(s, "w1", "build"));
    assert_eq!(s.order("w1")["siteId"], "f1");
    assert_eq!(s.memory("w1", "workplaceId"), Some(json!("f1")));
    assert_eq!(s.memory("w1", "siteId"), Some(json!("f1")));
    // The Doing line says they build it to work it.
    let seen = s.seen("w1");
    assert_eq!((seen["building"].clone(), seen["site"].clone()), (json!("quarry"), json!(true)));
    let mut fetched = false;
    s.until(6000, |s| {
        fetched |= s.memory("w1", "fetch").is_some_and(|f| !f.is_null());
        !s.f1_is_site()
    });
    assert!(fetched);
    assert!(!s.f1_is_site());
    // Only what was missing left the storage.
    let store = s.b("s1").unwrap().stock.clone().unwrap();
    for (g, n) in materials("quarry") {
        assert_eq!(held(&store, g), n * 2.0 - n);
    }
    s.until(40, |s| kind_is(s, "w1", "workAt"));
    assert_eq!(s.order("w1")["buildingId"], "f1");
    assert_eq!(s.memory("w1", "siteId"), Some(Value::Null));
    assert!(s.seen("w1").get("site").is_none());
    assert_eq!(s.stopped(), Vec::<String>::new());
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
fn is_a_queue_step_they_walk_there_build_it_with_a_build_builder_then_work_it() {
    let mut s = setup("farm");
    // w1 is elsewhere and queues Work there; w2 builds it with the Build task.
    s.r_mut("w1").x = 12.0;
    s.r_mut("w1").y = 12.0;
    resident(&mut s.world, "w2", AT);
    assert_eq!(s.give(json!({ "kind": "task", "task": "build", "building": "farm" }), "w2"), "ack");
    let queue = json!({ "kind": "queue", "steps": [
        { "order": { "kind": "walkTo", "x": AT.0, "y": AT.1 } },
        { "order": work() },
    ] });
    assert_eq!(s.give(queue, "w1"), "ack");
    s.until(200, |s| kind_is(s, "w1", "build"));
    assert_eq!(s.r("w1").queue.as_ref().and_then(|q| q.current_index()), Some(1));
    assert_eq!(s.order("w1")["siteId"], "f1");
    // One fetcher at a time between the two scripts: the invariant runs every tick.
    s.until(6000, |s| !s.f1_is_site());
    assert!(!s.f1_is_site());
    s.until(40, |s| kind_is(s, "w1", "workAt"));
    assert_eq!(s.order("w1")["buildingId"], "f1");
    assert_eq!(s.r("w2").script, None); // Build ended once it was finished
    assert_eq!(s.stopped(), Vec::<String>::new());
}

#[test]
fn ends_with_the_reason_when_the_site_is_torn_down_meanwhile() {
    let mut s = setup("farm");
    s.r_mut("w1").x = 12.0;
    s.r_mut("w1").y = 12.0;
    let id = default_script_id(7, Task::Work);
    let run = json!({ "kind": "runScript", "scriptId": id, "params": { "workplace": "f1" } });
    assert_eq!(s.give(run, "w1"), "ack");
    s.tick();
    s.tick();
    assert_eq!(s.memory("w1", "siteId"), Some(json!("f1")));
    s.world.buildings.retain(|b| b.id != "f1");
    s.until(200, |s| s.r("w1").script.is_none());
    assert_eq!(s.r("w1").script, None);
    assert_eq!(s.stopped(), ["the site is gone"]);
}

#[test]
fn is_refused_on_a_site_of_a_building_that_is_no_workplace() {
    let mut s = setup("farm");
    let house = json!({ "id": "h1", "kind": "house", "cityId": "c1", "x": 20, "y": 20, "site": { "delivered": {}, "work": 0 } });
    s.world.buildings.push(serde_json::from_value::<Building>(house).unwrap());
    s.r_mut("w1").x = 20.0;
    s.r_mut("w1").y = 20.0;
    let answer = s.give(json!({ "kind": "task", "task": "work", "workplaceId": "h1" }), "w1");
    assert_eq!(answer, "there is no workplace to work here");
}

#[test]
fn leaves_build_of_the_same_site_as_it_was_it_still_ends_once_finished() {
    let mut s = setup("farm");
    s.r_mut("w1").script = None;
    assert_eq!(s.give(json!({ "kind": "task", "task": "build", "building": "farm" }), "w1"), "ack");
    s.until(6000, |s| !s.f1_is_site());
    s.until(5, |s| s.r("w1").script.is_none());
    assert_eq!(s.r("w1").script, None);
}
