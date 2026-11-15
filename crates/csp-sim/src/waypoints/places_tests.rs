//! `waypoint-places.test.ts`: a waypoint is a place like a tile (`CONTEXT.md`: Waypoint): picked
//! for a walk-to or a queue step, the UI gives the order the waypoint's tile; scripts read, add
//! and remove their Player's waypoints.

use std::sync::Arc;

use csp_lang::interpreter::{run, RunOptions, RunResult, ValueLimits};
use csp_lang::{parse, Object};
use csp_shared::balance::{OWN_FOOD, SCRIPT_MAX_CALL_DEPTH, SCRIPT_VALUE_LIMITS, WAYPOINTS_MAX};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Good, Realm, Resident, Stock, Waypoint, WorldState};
use serde_json::{json, Map, Value};

use super::waypoints_of;
use crate::invariants::check_all;
use crate::order_sender::{npc_sender, OrderSender};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::{QueueHost, QueueRunner};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::script_bindings::{bind_script, script_requests_sound, ScriptContext};
use crate::script_runner::default_host::DefaultScripts;
use crate::sight::{sight_of, InvariantViolation};
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};
use crate::world_index::WorldIndex;

const SIZE: i32 = 32;

fn mara() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn edda() -> OrderSender {
    OrderSender::player(8, "Edda")
}

struct Senders;

impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(mara)
    }
}

fn new_r(id: &str, seed: f64, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let mut m = Mulberry32::new(seed);
    let fields = NewResident { id, owner, city_id: None, x, y, tick: 0.0 };
    new_resident(&mut || m.next(), &fields, None)
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

/// Realm r1 (Player 7) with w1 at (6, 6), realm r2 (Player 8) with x1 (`setup`).
fn setup() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "w1"), ("r2", 8, "x1")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    let mut r = new_r("w1", 1.0, Some("r1"), 6.0, 6.0);
    r.city_id = Some("c1".into());
    r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    world.residents.push(r);
    world.residents.push(new_r("x1", 2.0, Some("r2"), 1.0, 1.0));
    let terrain = Arc::new(terrain);
    let scripts = DefaultScripts::new(terrain.clone(), &[mara()]);
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
    let queues = QueueRunner::new(Box::new(Senders), scripts.kinds.clone(), Some(terrain.clone()));
    let walking = Walking::new(terrain.clone());
    Setup { world, terrain, scripts, orders, queues, walking, scratch: Scratch::default() }
}

impl Setup {
    fn w1(&self) -> &Resident {
        self.world.residents.iter().find(|r| r.id == "w1").unwrap()
    }

    /// Orders, queues and scripts as the game runs them, then the world steps.
    fn tick(&mut self) {
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
    }

    fn give(&mut self, order: Value) -> String {
        match self.orders.receive(&self.world, &mara(), &json!("q"), &order) {
            OrderReply::Ack { .. } => "ok".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    /// Runs `source` once as a script of `resident_id` for `sender`, applying what it requested
    /// (`runOnce`): its memory and how many requests it made.
    fn run_once_as(
        &mut self,
        source: &str,
        sender: &OrderSender,
        resident_id: &str,
    ) -> (Map<String, Value>, usize) {
        let kinds = order_kinds();
        let memory = Object::new();
        let requests = {
            let world = &self.world;
            let index = WorldIndex::new(world, SIZE);
            let seen = || Arc::new(Vec::new());
            let side =
                world.realms.iter().find(|r| r.user_id == sender.user_id).map(|r| r.id.clone());
            let side = side.unwrap_or_else(|| "nobody".into());
            let eyes = || sight_of(world, &index, &side, None);
            let explored = |_: i32, _: i32| true;
            let ctx = ScriptContext {
                world,
                terrain: &self.terrain,
                index: &index,
                sender,
                resident_id: Some(resident_id),
                army_id: None,
                memory: memory.clone(),
                seen: &seen,
                places: None,
                place: None,
                eyes: &eyes,
                explored: &explored,
                kinds: &kinds,
                edge: None,
                land: None,
                params: None,
            };
            let mut bound = bind_script(ctx).unwrap();
            let program = parse(source).unwrap();
            let limits = ValueLimits {
                max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
                max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
                max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
            };
            let options =
                RunOptions { steps: 10_000, max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32, limits };
            let result = run(&program, &mut bound, &options).unwrap();
            assert!(matches!(result, RunResult::Done { .. }), "{result:?}");
            std::mem::take(&mut bound.requests)
        };
        let sound = script_requests_sound(
            &self.world,
            &self.terrain,
            sender,
            resident_id,
            &requests,
            &kinds,
        );
        assert_eq!(sound, Vec::<InvariantViolation>::new());
        // Applied as the script runner applies them.
        for order in &requests {
            kinds.get(&order.kind).unwrap().apply(
                &mut self.world,
                sender,
                order,
                Some(&self.terrain),
            );
        }
        let memory = csp_lang::Value::Object(memory);
        let memory = csp_lang::plain_value(&memory, usize::MAX).unwrap().value;
        (object(memory), requests.len())
    }

    fn run_once(&mut self, source: &str) -> Map<String, Value> {
        self.run_once_as(source, &mara(), "w1").0
    }

    fn mine(&self) -> Vec<Waypoint> {
        waypoints_of(&self.world, 7).to_vec()
    }
}

fn object(v: Value) -> Map<String, Value> {
    let Value::Object(m) = v else { panic!("an object") };
    m
}

fn as_json(w: &[Waypoint]) -> Value {
    serde_json::to_value(w).unwrap()
}

#[test]
fn take_a_resident_walking_to_one_there() {
    let mut s = setup();
    s.give(json!({ "kind": "addWaypoint", "x": 12, "y": 9, "name": "Pass" }));
    s.tick();
    let pass = s.mine()[0].clone();
    // Walk to with the waypoint picked: the order gets its tile.
    let walk = json!({ "kind": "walkTo", "residentId": "w1", "x": pass.x, "y": pass.y });
    assert_eq!(s.give(walk), "ok");
    for i in 0..200 {
        if i > 0 && s.w1().order.is_none() {
            break;
        }
        s.tick();
    }
    assert_eq!((s.w1().x, s.w1().y, s.w1().order.is_none()), (12.0, 9.0, true));
}

#[test]
fn give_a_queue_step_their_tile_which_it_keeps_once_the_waypoint_is_removed() {
    let mut s = setup();
    s.give(json!({ "kind": "addWaypoint", "x": 6, "y": 12, "name": "Ford" }));
    s.give(json!({ "kind": "addWaypoint", "x": 12, "y": 12, "name": "Pass" }));
    s.tick();
    let (ford, pass) = (s.mine()[0].clone(), s.mine()[1].clone());
    let walk = |w: &Waypoint| json!({ "order": { "kind": "walkTo", "x": w.x, "y": w.y } });
    let steps = json!([walk(&ford), walk(&pass)]);
    assert_eq!(s.give(json!({ "kind": "queue", "residentId": "w1", "steps": steps })), "ok");
    s.tick();
    assert_eq!(s.give(json!({ "kind": "removeWaypoint", "waypointId": pass.id })), "ok");
    let mut been: Vec<String> = Vec::new();
    for _ in 0..200 {
        if s.w1().queue.is_none() {
            break;
        }
        s.tick();
        been.push(format!("{},{}", s.w1().x, s.w1().y));
    }
    assert_eq!(s.mine(), [ford]);
    let at = |t: &str| been.iter().position(|b| b == t);
    assert!(at("6,12").is_some());
    assert!(at("6,12") < at("12,12"));
    assert_eq!((s.w1().x, s.w1().y, s.w1().order.is_none()), (12.0, 12.0, true));
}

#[test]
fn are_read_added_and_removed_by_their_players_scripts() {
    let mut s = setup();
    let added = s.run_once(&format!(
        "memory.pass = addWaypoint(3, 4, \"  Pass \")\nmemory.ford = addWaypoint(5, 6, \"Ford\")\nmemory.unnamed = addWaypoint(5, 6, \"\")\nmemory.off = addWaypoint({SIZE}, 6, \"Off\")\n"
    ));
    assert_eq!(
        added,
        object(
            json!({ "pass": null, "ford": null, "unnamed": "Name: needs a name", "off": "not a tile on the map" })
        )
    );
    let held = s.mine();
    let places: Vec<(String, f64, f64)> = held.iter().map(|w| (w.name.clone(), w.x, w.y)).collect();
    assert_eq!(places, [("Pass".into(), 3.0, 4.0), ("Ford".into(), 5.0, 6.0)]);
    // Their own Player's only, as the waypoint script view shows them.
    let seen = s.run_once("memory.seen = waypoints()");
    assert_eq!(
        crate::test_support::as_numbers(&seen["seen"]),
        crate::test_support::as_numbers(&as_json(&held))
    );
    let theirs = s.run_once_as("memory.seen = waypoints()", &edda(), "x1").0;
    assert_eq!(theirs["seen"], json!([]));

    // By the waypoint or its id; removing the same one twice in a run is turned down the second
    // time.
    let removed = s.run_once(
        "memory.first = removeWaypoint(waypoints()[0])\nmemory.again = removeWaypoint(waypoints()[0].id)\nmemory.unknown = removeWaypoint(\"wp999\")\n",
    );
    assert_eq!(
        removed,
        object(
            json!({ "first": null, "again": "not one of your waypoints", "unknown": "not one of your waypoints" })
        )
    );
    assert_eq!(s.mine(), [held[1].clone()]);
    // Another Player's script can't remove it.
    let id = held[1].id.clone();
    let source = format!("memory.r = removeWaypoint(\"{id}\")");
    let r = s.run_once_as(&source, &edda(), "x1").0;
    assert_eq!(r["r"], "not one of your waypoints");
    assert_eq!(s.run_once(&source)["r"], Value::Null);
    assert!(s.world.waypoints.is_empty());
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
fn stop_a_script_at_50_counting_those_the_same_run_added() {
    let mut s = setup();
    let most = WAYPOINTS_MAX as usize;
    let some: Vec<Waypoint> = (0..most - 1)
        .map(|i| Waypoint {
            id: format!("wp{}", 100 + i),
            name: format!("W{i}"),
            x: (i as i32 % SIZE) as f64,
            y: 1.0,
        })
        .collect();
    s.world.waypoints.insert(7, some);
    let full = format!("you hold {most} waypoints already, the most");
    let (first, requests) = s.run_once_as(
        "memory.last = addWaypoint(1, 2, \"Last\")\nmemory.over = addWaypoint(2, 2, \"Too many\")\n",
        &mara(),
        "w1",
    );
    assert_eq!(first, object(json!({ "last": null, "over": full })));
    assert_eq!(requests, 1);
    assert_eq!(s.mine().len(), most);
    // Removing one makes room from the next run on: requests are applied after the run.
    let out = s.run_once("memory.out = removeWaypoint(waypoints()[0])\nmemory.in = addWaypoint(3, 2, \"Too soon\")\n");
    assert_eq!(out, object(json!({ "out": null, "in": full })));
    assert_eq!(s.mine().len(), most - 1);
    assert_eq!(s.run_once("memory.in = addWaypoint(3, 2, \"Instead\")")["in"], Value::Null);
    assert_eq!(s.mine().len(), most);
    assert_eq!(s.mine().last().unwrap().name, "Instead");
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
fn are_none_for_an_npc_citys_script_which_cant_add_any() {
    let mut s = setup();
    add_city(&mut s.world, "n1", None, 22.0, 22.0);
    let mut npc = new_r("v1", 3.0, None, 22.0, 23.0);
    npc.city_id = Some("n1".into());
    s.world.residents.push(npc);
    let city = s.world.cities.iter().find(|c| c.id == "n1").unwrap().clone();
    let sender = npc_sender(&city);
    let out = s
        .run_once_as(
            "memory.seen = waypoints() memory.add = addWaypoint(1, 1, \"Mine\")",
            &sender,
            "v1",
        )
        .0;
    assert_eq!(out, object(json!({ "seen": [], "add": "only a Player holds waypoints" })));
    assert!(s.world.waypoints.is_empty());
}
