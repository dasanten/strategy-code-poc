//! `test-default-scripts.ts` for the Rust tests: tasks given as from the UI, every Player running
//! the game's default scripts unedited (`CONTEXT.md`: Default script). A Player's version of a
//! task's default has the id `userId * 100` plus the task's place in `TASKS`, from 1; Run script
//! runs it by that id. Other scripts of theirs go in `library`, by id; deleting one there deletes
//! it. Every Player has explored the whole map.
//!
//! [`Game`] steps a world as the game does: orders applied, scripts run, then `stepWorld` with
//! walking (`Walking`), its scratch kept across ticks.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Task, WorldState};
use csp_sim::default_scripts::{DEFAULT_SCRIPTS, TASKS};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderKinds, OrderQueue, OrderReply};
use csp_sim::script_params::SetScriptParamOrder;
use csp_sim::script_runner::{
    DefaultScriptHost, RunScriptOrder, ScriptHost, ScriptRunner, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use csp_sim::scripts::{RunnableScript, ScriptLibrary};
use csp_sim::sight::InvariantViolation;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};

/// The id of a Player's version of a task's default (`defaultScript`).
pub fn default_script_id(user_id: u64, task: Task) -> u64 {
    user_id * 100 + TASKS.iter().position(|t| *t == task).expect("a task") as u64 + 1
}

/// The scripts the tests know: the defaults by id, and the Players' own in `library`.
pub struct Host {
    pub senders: Vec<OrderSender>,
    pub library: Mutex<HashMap<u64, RunnableScript>>,
}

impl Host {
    fn find(&self, id: u64) -> Option<RunnableScript> {
        if let Some(s) = self.library.lock().unwrap().get(&id) {
            return Some(s.clone());
        }
        let place = (id % 100) as usize;
        let task = *TASKS.get(place.checked_sub(1)?)?;
        let (_, name, source) = DEFAULT_SCRIPTS.iter().find(|(t, _, _)| *t == task)?;
        Some(RunnableScript {
            user_id: id / 100,
            name: name.to_string(),
            version: 1,
            source: source.to_string(),
            follows_default: true,
            task: Some(task),
        })
    }
}

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.find(id)
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.senders.iter().find(|s| s.user_id == user_id).cloned()
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
    fn default_script(&self, user_id: u64, task: Task) -> Option<u64> {
        Some(default_script_id(user_id, task))
    }
}

impl DefaultScriptHost for Host {
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        default_script_id(user_id, task)
    }
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.find(id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

impl ScriptLibrary for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.find(id)
    }
}

/// The order kinds with the run-script and task orders, and the runner (`defaultScripts`).
pub struct Tasks {
    pub host: Arc<Host>,
    pub kinds: OrderKinds,
    pub runner: ScriptRunner,
}

pub fn default_scripts(terrain: &TerrainMap, senders: Vec<OrderSender>) -> Tasks {
    let host = Arc::new(Host { senders, library: Mutex::new(HashMap::new()) });
    let script_host: Arc<dyn ScriptHost + Send + Sync> = host.clone();
    let mut kinds = order_kinds();
    kinds.insert("runScript", RunScriptOrder { host: script_host.clone() });
    kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: script_host.clone() });
    kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: script_host.clone() });
    kinds.insert("setScriptParam", SetScriptParamOrder { library: host.clone() });
    kinds.insert("task", TaskOrder::new(host.clone()));
    let runner = ScriptRunner::new(Arc::new(terrain.clone()), script_host, kinds.clone());
    Tasks { host, kinds, runner }
}

/// A world stepped as the game steps it: orders, then scripts, then the world with walking.
pub struct Game {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub tasks: Tasks,
    pub queue: OrderQueue,
    pub walking: Walking,
    pub scratch: Scratch,
}

impl Game {
    pub fn new(world: WorldState, terrain: TerrainMap, senders: Vec<OrderSender>) -> Self {
        let tasks = default_scripts(&terrain, senders);
        let queue = OrderQueue::new(tasks.kinds.clone(), Some(Arc::new(terrain.clone())));
        let walking = Walking::new(Arc::new(terrain.clone()));
        Game { world, terrain, tasks, queue, walking, scratch: Scratch::default() }
    }

    /// Sends an order as `sender` and applies it at once, answering as the queue does.
    pub fn give(&mut self, sender: &OrderSender, order: Value) -> OrderReply {
        let answer = self.queue.receive(&self.world, sender, &json!("q"), &order);
        self.queue.apply_all(&mut self.world);
        answer
    }

    /// Runs every running script once (`tasks.runAll(world)`), answering what the invariants on
    /// scripts found.
    pub fn run_scripts(&mut self) -> Vec<InvariantViolation> {
        self.tasks.runner.run_all(&mut self.world, &mut self.scratch, true)
    }

    /// One `stepWorld` with walking.
    pub fn step(&mut self) {
        step_world(&mut self.world, &self.terrain, &mut self.scratch, Some(&mut self.walking), None);
    }

    /// Sends an order as `sender`, to be applied as the next tick begins; the answer must be an
    /// ack.
    pub fn send(&mut self, sender: &OrderSender, order: Value) {
        let answer = self.queue.receive(&self.world, sender, &json!("q"), &order);
        assert_eq!(answer, ack(), "{order}");
    }

    /// Orders, scripts, then the world: one tick as the game runs it, the scripts' invariants
    /// held.
    pub fn tick(&mut self) {
        self.queue.apply_all(&mut self.world);
        let found = self.run_scripts();
        assert!(found.is_empty(), "{found:?}");
        self.step();
    }
}

/// The realm log's entries of `kind`, as JSON.
pub fn events(world: &WorldState, kind: &str) -> Vec<Value> {
    world
        .events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .filter(|e| e["kind"] == kind)
        .collect()
}

/// The ack the queue answers a good order with.
pub fn ack() -> OrderReply {
    OrderReply::Ack { request_id: "q".into() }
}

/// The reason an order was turned down, if it was.
pub fn reason(reply: &OrderReply) -> Option<String> {
    match reply {
        OrderReply::Rejected { reason, .. } => Some(reason.clone()),
        OrderReply::Ack { .. } => None,
    }
}

/// A city with its town hall at (x, y) (`addCity` of `test-terrain.ts`): named Ashford, laid out
/// as a grid when it is an NPC city.
pub fn add_city(world: &mut WorldState, id: &str, realm_id: Option<&str>, x: f64, y: f64) {
    let hall = format!("{id}-hall");
    world.buildings.push(from(json!({
        "id": hall, "kind": "townHall", "cityId": id, "x": x, "y": y,
    })));
    let mut city = json!({
        "id": id, "name": "Ashford", "realmId": realm_id, "townHallId": hall, "occupation": null,
    });
    if realm_id.is_none() {
        city["layout"] = json!("grid");
    }
    world.cities.push(from(city));
}

/// A value read from its JSON.
pub fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).expect("its JSON")
}
