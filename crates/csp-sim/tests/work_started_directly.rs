//! `apps/server/src/work-started-directly.test.ts`, ported (T86.17, part 5): Work started
//! directly (`CONTEXT.md`: Default script, Started directly; ADR 0014). Its workplace is the param
//! `workplace`; unset, the one on the resident's tile when it starts, never kept between starts.
//! With none there it ends with a reason.

mod build_common;
mod scripts_common;

use std::sync::Arc;

use build_common::*;
use csp_shared::balance::OWN_FOOD;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, Good, ResidentOrder, Stock, Task, WorldState};
use csp_sim::default_scripts::TASKS;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::queues::QueueRunner;
use csp_sim::script_runner::defaults_have_a_target;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use scripts_common::{as_numbers, default_script_id, default_scripts, DefaultScripts};
use serde_json::{json, Value};

const SIZE: i32 = 32;

fn me() -> OrderSender {
    player(7)
}

/// Player 7's version of the Work default.
fn work() -> u64 {
    default_script_id(7, Task::Work)
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scripts: DefaultScripts,
    orders: OrderQueue,
    queues: QueueRunner,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1: resident w1 standing on farm f1 at (6, 6), a second farm f2
/// at (6, 14), a storage s1 at (12, 6) with Food, and resident w2 on an empty tile (20, 20).
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    for (id, kind, x, y) in
        [("f1", BuildingKind::Farm, 6.0, 6.0), ("f2", BuildingKind::Farm, 6.0, 14.0)]
    {
        let mut b = building(id, kind, x, y);
        b.city_id = Some("c1".into());
        world.buildings.push(b);
    }
    let mut s1 = building("s1", BuildingKind::Storage, 12.0, 6.0);
    s1.city_id = Some("c1".into());
    s1.stock = Some(Stock::from([(Good::Food, 50.0)]));
    world.buildings.push(s1);
    for (id, x, y) in [("w1", 6.0, 6.0), ("w2", 20.0, 20.0)] {
        let mut r = new_resident(id, Some("r1"), x, y);
        r.city_id = Some("c1".into());
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        world.residents.push(r);
    }
    let scripts = default_scripts(&terrain, vec![me()]);
    let t = Arc::new(terrain.clone());
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(t.clone()));
    let queues = scripts.queue_runner();
    let walking = Walking::new(t);
    Setup { world, terrain, scripts, orders, queues, walking, scratch: Scratch::default() }
}

impl Setup {
    /// One tick as the game runs it: orders, queues, scripts (with invariants), the world steps.
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        let broken = self.scripts.run_all(&mut self.world, &mut self.scratch);
        assert!(broken.is_empty(), "{broken:?}");
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
    }

    fn give(&mut self, order: Value) {
        self.give_to("w1", order);
    }

    fn give_to(&mut self, resident_id: &str, mut order: Value) {
        order["residentId"] = json!(resident_id);
        let answer = self.orders.receive(&self.world, &me(), &json!("q"), &order);
        assert!(matches!(answer, OrderReply::Ack { .. }), "{answer:?}");
    }

    fn r(&self, id: &str) -> &csp_shared::world::Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    /// The reasons of the realm log's `scriptStopped` events.
    fn stopped(&self) -> Vec<String> {
        self.world
            .events
            .iter()
            .filter_map(|e| {
                let v = serde_json::to_value(e).unwrap();
                (v["kind"] == "scriptStopped").then(|| v["reason"].as_str().unwrap().to_string())
            })
            .collect()
    }

    fn working_on(&self, id: &str) -> Option<String> {
        match &self.r(id).order {
            Some(ResidentOrder::WorkAt(o)) => Some(o.building_id.clone()),
            _ => None,
        }
    }

    fn memory(&self, id: &str) -> Value {
        Value::Object(self.r(id).script.as_ref().unwrap().memory.clone())
    }
}

#[test]
fn works_the_farm_the_resident_stands_on_with_run_script_on_an_empty_tile_it_ends() {
    let mut s = setup();
    s.give(json!({ "kind": "runScript", "scriptId": work() }));
    s.give_to("w2", json!({ "kind": "runScript", "scriptId": work() }));
    s.tick();
    assert_eq!(s.working_on("w1").as_deref(), Some("f1"));
    assert_eq!(s.memory("w1")["workplaceId"], "f1");
    // Nothing to work on w2's tile: the script ends, and the realm log says why.
    assert!(s.r("w2").script.is_none());
    assert!(s.r("w2").order.is_none());
    assert_eq!(s.stopped(), vec!["no workplace on their tile".to_string()]);
    for _ in 0..50 {
        s.tick();
    }
    assert_eq!(s.working_on("w1").as_deref(), Some("f1"));
}

#[test]
fn as_a_queue_step_works_the_workplace_the_resident_stands_on_when_the_step_starts() {
    let mut s = setup();
    s.give(json!({
        "kind": "queue",
        "steps": [
            { "order": { "kind": "walkTo", "x": 6, "y": 14 } },
            { "order": { "kind": "runScript", "scriptId": work() } },
        ],
    }));
    for _ in 0..100 {
        if matches!(s.r("w1").order, Some(ResidentOrder::WorkAt(_))) {
            break;
        }
        s.tick();
    }
    assert_eq!((s.r("w1").x, s.r("w1").y), (6.0, 14.0));
    assert_eq!(s.working_on("w1").as_deref(), Some("f2"));
    assert_eq!(s.r("w1").queue.as_ref().and_then(|q| q.current_index()), Some(1));
    assert_eq!(s.stopped(), Vec::<String>::new());
}

#[test]
fn never_keeps_the_workplace_given_at_one_farm_run_again_on_the_other_it_works_that_one() {
    let mut s = setup();
    s.give(
        json!({ "kind": "task", "task": "work", "workplaceId": "f1", "params": { "foodTake": 4 } }),
    );
    s.tick();
    // Giving the task fills the param, which the card shows.
    let params = |s: &Setup| {
        serde_json::to_value(&s.r("w1").script_params).unwrap()[work().to_string()].clone()
    };
    assert_eq!(as_numbers(&params(&s)), as_numbers(&json!({ "workplace": "f1", "foodTake": 4 })));
    assert_eq!(s.working_on("w1").as_deref(), Some("f1"));
    s.give(json!({ "kind": "walkTo", "x": 6, "y": 14 }));
    for _ in 0..100 {
        if (s.r("w1").x, s.r("w1").y) == (6.0, 14.0) {
            break;
        }
        s.tick();
    }
    s.give(json!({ "kind": "runScript", "scriptId": work() }));
    s.tick();
    assert_eq!(s.working_on("w1").as_deref(), Some("f2"));
    // The other params are kept as usual.
    assert_eq!(as_numbers(&params(&s)), as_numbers(&json!({ "foodTake": 4 })));
}

#[test]
fn works_the_workplace_picked_before_it_starts_wherever_the_resident_stands() {
    let mut s = setup();
    s.give(json!({ "kind": "runScript", "scriptId": work(), "params": { "workplace": "f2" } }));
    for _ in 0..100 {
        if matches!(s.r("w1").order, Some(ResidentOrder::WorkAt(_))) {
            break;
        }
        s.tick();
    }
    assert_eq!(s.working_on("w1").as_deref(), Some("f2"));
}

#[test]
fn ends_once_its_workplace_is_gone_or_when_the_one_picked_is_no_workplace() {
    let mut s = setup();
    s.give(json!({ "kind": "task", "task": "work", "workplaceId": "f1" }));
    s.give_to(
        "w2",
        json!({ "kind": "runScript", "scriptId": work(), "params": { "workplace": "s1" } }),
    );
    s.tick();
    assert!(s.r("w2").script.is_none());
    assert_eq!(s.working_on("w1").as_deref(), Some("f1"));
    s.world.buildings.retain(|b| b.id != "f1");
    for _ in 0..5 {
        if s.r("w1").script.is_none() {
            break;
        }
        s.tick();
    }
    assert!(s.r("w1").script.is_none());
    assert_eq!(
        s.stopped(),
        vec!["the storage is no workplace".to_string(), "the workplace is gone".to_string()]
    );
}

// workers-have-a-workplace invariant

#[test]
fn flags_a_resident_running_work_that_knows_no_workplace() {
    let s = setup();
    let mut world = s.world;
    for (i, memory) in [(0, json!({ "workplaceId": "f1" })), (1, json!({}))] {
        world.residents[i].script =
            Some(serde_json::from_value(json!({ "scriptId": work(), "memory": memory })).unwrap());
    }
    let found = defaults_have_a_target(&world, &|_| Some(Task::Work));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "workers-have-a-workplace");
    assert_eq!(found[0].entity_ids, vec!["w2".to_string()]);
    let only_w1 = |r: &csp_shared::world::Resident| (r.id == "w1").then_some(Task::Work);
    assert_eq!(defaults_have_a_target(&world, &only_w1), vec![]);
}

#[test]
fn is_checked_where_a_players_scripts_run_once_the_work_default_has_run() {
    let mut s = setup();
    // A game default that forgets its workplace, as a bug would.
    s.scripts.library.insert(
        work(),
        csp_sim::scripts::RunnableScript {
            user_id: 7,
            name: "Work".into(),
            version: 1,
            source: "param workplace: building\n".into(),
            follows_default: true,
            task: Some(Task::Work),
        },
    );
    s.world.residents[0].script =
        Some(serde_json::from_value(json!({ "scriptId": work(), "memory": {} })).unwrap());
    let found = s.scripts.run_all(&mut s.world, &mut s.scratch);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "workers-have-a-workplace");
    assert_eq!(found[0].entity_ids, vec!["w1".to_string()]);
    let _ = TASKS;
}
