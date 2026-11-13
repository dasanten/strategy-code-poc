//! `apps/server/src/known-workplace.test.ts`, ported one to one.
//!
//! Any known workplace (`CONTEXT.md`: Script parameter, Queue): a Work step, a `workplace` param
//! or an order may name a workplace or construction site the Player knows, in sight or last seen,
//! whoever built it. Any other building, and every storage param, stays the realm's own.

mod default_scripts_host;

use std::sync::Arc;

use csp_lang::ParamType;
use csp_shared::balance::{OWN_FOOD, WORKPLACE_MAX_WORKERS};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Good, Resident, ResidentOrder, Stat, Task, WorldState};
use serde_json::{json, Value};

use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::script_params::{param_target, ParamTarget};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use default_scripts_host::{default_script_id, default_scripts, DefaultScripts};

const SIZE: i32 = 160;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// Player 7's version of the Work default (`defaultScripts`).
fn work() -> u64 {
    default_script_id(7, Task::Work)
}

struct Host;
impl QueueHost for Host {
    fn sender(&self, id: u64) -> Option<OrderSender> {
        (id == 7).then(me)
    }
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

fn add_city(world: &mut WorldState, id: &str, realm: &str, x: f64, y: f64) {
    let hall = format!("{id}-hall");
    world.buildings.push(
        serde_json::from_value(
            json!({ "id": hall, "kind": "townHall", "cityId": id, "x": x, "y": y }),
        )
        .unwrap(),
    );
    world.cities.push(
        serde_json::from_value(json!({
            "id": id, "name": "Ashford", "realmId": realm, "townHallId": hall, "occupation": null,
        }))
        .unwrap(),
    );
}

/// Mara's realm r1 with city c1 and resident w1 at (10, 12); far out of its sight, realm r2's
/// city c2 with farm f9 at (130, 130) and storage s9 beside it, which Mara remembers as last seen
/// (`setup`).
fn setup() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "w1"), ("r2", 8, "x0")] {
        world.realms.push(
            serde_json::from_value(json!({ "id": id, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
    }
    add_city(&mut world, "c1", "r1", 10.0, 10.0);
    add_city(&mut world, "c2", "r2", 134.0, 126.0);
    let f9 = json!({ "id": "f9", "kind": "farm", "cityId": "c2", "x": 130, "y": 130 });
    let s9 =
        json!({ "id": "s9", "kind": "storage", "cityId": "c2", "x": 136, "y": 130, "stock": {} });
    world.buildings.push(serde_json::from_value(f9.clone()).unwrap());
    world.buildings.push(serde_json::from_value(s9.clone()).unwrap());
    let seen = |b: &Value| {
        let mut v = b.clone();
        v["is"] = json!("building");
        v["seenAt"] = json!(0);
        serde_json::from_value(v).unwrap()
    };
    world.last_seen.insert(7, vec![seen(&f9), seen(&s9)]);
    let mut m = Mulberry32::new(1.0);
    let fields =
        NewResident { id: "w1", owner: Some("r1"), city_id: None, x: 10.0, y: 12.0, tick: 0.0 };
    let mut w1 = new_resident(&mut || m.next(), &fields, None);
    w1.city_id = Some("c1".into());
    w1.stats.strength = Stat { base: 10.0, trained: 0.0 };
    w1.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
    world.residents.push(w1);
    let scripts = default_scripts(&terrain, vec![me()], None);
    let shared = Arc::new(terrain.clone());
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(shared.clone()));
    let queues = QueueRunner::new(Box::new(Host), scripts.kinds.clone(), Some(shared.clone()));
    let walking = Walking::new(shared);
    Setup { world, terrain, scripts, orders, queues, walking, scratch: Scratch::default() }
}

impl Setup {
    fn w1(&self) -> &Resident {
        self.world.residents.iter().find(|r| r.id == "w1").unwrap()
    }

    /// One tick as the game runs it: orders, queues, scripts (with invariants), the world steps
    /// (`tick`).
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), vec![]);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
    }

    fn receive(&mut self, order: Value) -> OrderReply {
        let mut o = json!({ "residentId": "w1" });
        for (k, v) in order.as_object().unwrap() {
            o[k] = v.clone();
        }
        self.orders.receive(&self.world, &me(), &json!("q"), &o)
    }

    fn give(&mut self, order: Value) {
        assert_eq!(self.receive(order), OrderReply::Ack { request_id: "q".into() });
    }

    fn stopped(&self) -> Vec<String> {
        self.world
            .events
            .iter()
            .map(|e| serde_json::to_value(&e.what).unwrap())
            .filter(|e| e["kind"] == "scriptStopped")
            .map(|e| e["reason"].as_str().unwrap().to_string())
            .collect()
    }

    fn works_f9(&self) -> bool {
        matches!(&self.w1().order, Some(ResidentOrder::WorkAt(o)) if o.building_id == "f9")
    }

    /// Ticks until w1 works the far farm, or ends their script, at most `n` ticks (`until`).
    fn until(&mut self, n: usize) {
        for i in 0..n {
            let working = matches!(self.w1().order, Some(ResidentOrder::WorkAt(_)));
            if working || (i > 0 && self.w1().script.is_none()) {
                break;
            }
            self.tick();
        }
    }
}

/// Fills the farm with realm r2's workers, so it is held by someone else (`holdFarm`).
fn hold_farm(world: &mut WorldState) {
    for i in 0..WORKPLACE_MAX_WORKERS.get("farm").unwrap() as usize {
        let mut m = Mulberry32::new(10.0 + i as f64);
        let id = format!("x{i}");
        let fields = NewResident {
            id: &id,
            owner: Some("r2"),
            city_id: None,
            x: 130.0,
            y: 130.0,
            tick: 0.0,
        };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.city_id = Some("c2".into());
        r.order = Some(
            serde_json::from_value(json!({
                "kind": "workAt", "buildingId": "f9", "at": { "x": 130, "y": 130 }, "progress": 0,
            }))
            .unwrap(),
        );
        world.residents.push(r);
    }
}

// a param naming a known workplace

#[test]
fn names_a_last_seen_workplace_of_another_realm_never_its_storage_or_one_never_seen() {
    let mut s = setup();
    let w = &s.world;
    assert!(matches!(
        param_target(w, Some("r1"), ParamType::Building, "f9"),
        Some(ParamTarget::Building(_))
    ));
    assert!(param_target(w, Some("r1"), ParamType::Building, "s9").is_none());
    assert!(param_target(w, Some("r1"), ParamType::Storage, "s9").is_none());
    s.world.last_seen.insert(7, vec![]);
    assert!(param_target(&s.world, Some("r1"), ParamType::Building, "f9").is_none());
}

#[test]
fn is_accepted_with_run_script_the_resident_walks_to_it_as_last_seen_and_works_it() {
    let mut s = setup();
    s.give(json!({ "kind": "runScript", "scriptId": work(), "params": { "workplace": "f9" } }));
    s.until(600);
    assert_eq!((s.w1().x, s.w1().y), (130.0, 130.0));
    assert!(s.works_f9(), "{:?}", s.w1().order);
    assert!(s.stopped().is_empty(), "{:?}", s.stopped());
}

#[test]
fn takes_a_work_step_at_it_in_a_queue_after_a_walk_there() {
    let mut s = setup();
    s.give(json!({
        "kind": "queue",
        "steps": [
            { "order": { "kind": "walkTo", "x": 130, "y": 130 } },
            { "order": { "kind": "task", "task": "work", "workplaceId": "f9" } },
        ],
    }));
    for _ in 0..600 {
        if matches!(s.w1().order, Some(ResidentOrder::WorkAt(_))) {
            break;
        }
        s.tick();
    }
    assert!(s.works_f9(), "{:?}", s.w1().order);
    assert_eq!(s.w1().queue.as_ref().and_then(|q| q.current_index()), Some(1));
    // The task fills the param, which the card shows.
    let params = serde_json::to_value(&s.w1().script_params).unwrap();
    assert_eq!(params[work().to_string()]["workplace"], json!("f9"));
}

#[test]
fn a_storage_of_another_realm_stays_refused() {
    let mut s = setup();
    let answer = s
        .receive(json!({ "kind": "runScript", "scriptId": work(), "params": { "storage": "s9" } }));
    assert_eq!(
        answer,
        OrderReply::Rejected {
            request_id: "q".into(),
            reason: "storage: must be a storage, a stable or a carriage of yours".into(),
        }
    );
}

// the Work default at a known workplace

#[test]
fn ends_with_the_reason_when_the_workplace_is_gone_on_arrival() {
    let mut s = setup();
    s.give(json!({ "kind": "runScript", "scriptId": work(), "params": { "workplace": "f9" } }));
    s.tick();
    // Torn down while they walk there: they still go where they last saw it.
    s.world.buildings.retain(|b| b.id != "f9");
    s.until(600);
    assert!(s.w1().script.is_none());
    assert_eq!((s.w1().x, s.w1().y), (130.0, 130.0));
    assert_eq!(s.stopped(), ["the workplace is gone"]);
}

#[test]
fn ends_with_the_reason_when_the_workplace_is_held_by_someone_else() {
    let mut s = setup();
    hold_farm(&mut s.world);
    s.give(json!({ "kind": "runScript", "scriptId": work(), "params": { "workplace": "f9" } }));
    s.until(600);
    assert!(s.w1().script.is_none());
    assert_eq!((s.w1().x, s.w1().y), (130.0, 130.0));
    assert_eq!(s.stopped(), ["the farm is held by someone else"]);
}
