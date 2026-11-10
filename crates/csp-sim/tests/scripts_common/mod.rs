//! `apps/server/src/test-default-scripts.ts`, for the tests that run scripts without a script
//! library (T86.17): tasks given as from the UI, every Player running the game's default scripts
//! unedited (`CONTEXT.md`: Default script). A Player's version of a task's default has the id
//! `userId * 100` plus the task's place in `TASKS`, from 1; Run script runs it by that id. Other
//! scripts of theirs go in `library`, by id. Every Player has explored the whole map.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Task, WorldState};
use csp_sim::default_scripts::{default_script, TASKS};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderKinds};
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::script_runner::{
    DefaultScriptHost, RunScriptOrder, ScriptHost, ScriptRunner, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use csp_sim::scripts::RunnableScript;
use csp_sim::sight::InvariantViolation;
use csp_sim::tick::Scratch;

/// The id of a Player's version of a task's default script (`defaultScript`).
pub fn default_script_id(user_id: u64, task: Task) -> u64 {
    let place = TASKS.iter().position(|t| *t == task).expect("a task with a default");
    user_id * 100 + place as u64 + 1
}

/// The game's own default scripts as the host finds them, and the library of other scripts.
#[derive(Default)]
pub struct Library {
    scripts: Mutex<HashMap<u64, RunnableScript>>,
    senders: Vec<OrderSender>,
}

impl Library {
    pub fn insert(&self, id: u64, script: RunnableScript) {
        self.scripts.lock().unwrap().insert(id, script);
    }

    pub fn remove(&self, id: u64) {
        self.scripts.lock().unwrap().remove(&id);
    }

    fn find(&self, id: u64) -> Option<RunnableScript> {
        if let Some(s) = self.scripts.lock().unwrap().get(&id) {
            return Some(s.clone());
        }
        let task = *TASKS.get((id % 100) as usize - 1)?;
        let (name, source) = default_script(task);
        Some(RunnableScript {
            user_id: id / 100,
            name: name.into(),
            version: 1,
            source: source.into(),
            follows_default: true,
            task: Some(task),
        })
    }
}

struct Host(Arc<Library>);

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.0.find(id)
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.0.senders.iter().find(|s| s.user_id == user_id).cloned()
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
        self.0.find(id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

struct Senders(Arc<Library>);

impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.0.senders.iter().find(|s| s.user_id == user_id).cloned()
    }
}

/// The order kinds with the run-script and task orders, and a runner of every running script.
pub struct DefaultScripts {
    pub kinds: OrderKinds,
    pub library: Arc<Library>,
    runner: ScriptRunner,
    terrain: Arc<TerrainMap>,
}

/// `defaultScripts(terrain, senders, library)`.
pub fn default_scripts(terrain: &TerrainMap, senders: Vec<OrderSender>) -> DefaultScripts {
    let library = Arc::new(Library { senders, ..Library::default() });
    let terrain = Arc::new(terrain.clone());
    let host = Arc::new(Host(library.clone()));
    let script_host: Arc<dyn ScriptHost + Send + Sync> = host.clone();
    let mut kinds = order_kinds();
    kinds.insert("runScript", RunScriptOrder { host: script_host.clone() });
    kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: script_host.clone() });
    kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: script_host.clone() });
    kinds.insert("task", TaskOrder::new(host));
    let runner = ScriptRunner::new(terrain.clone(), script_host, kinds.clone());
    DefaultScripts { kinds, library, runner, terrain }
}

impl DefaultScripts {
    /// Runs every running script once, as the game does before the world steps, and what the
    /// invariants found (`runAll`).
    pub fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
    ) -> Vec<InvariantViolation> {
        self.runner.run_all(world, scratch, true)
    }

    /// The Players' queues, run with these order kinds.
    pub fn queue_runner(&self) -> QueueRunner {
        QueueRunner::new(
            Box::new(Senders(self.library.clone())),
            self.kinds.clone(),
            Some(self.terrain.clone()),
        )
    }
}

/// A JSON value with every number as an `f64`, so a Rust `4.0` and a TypeScript `4` compare equal.
pub fn as_numbers(v: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Number(n) => n.as_f64().map_or(Value::Null, |f| serde_json::json!(f)),
        Value::Array(a) => Value::Array(a.iter().map(as_numbers).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), as_numbers(v))).collect())
        }
        other => other.clone(),
    }
}

use csp_shared::world::Resident;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};

/// A world run as the game runs it, with the default scripts, queues and walking (the `setup`s of
/// the script tests): `tick` is orders, queues, scripts (with their invariants), the world.
pub struct Game {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub scripts: DefaultScripts,
    pub orders: OrderQueue,
    pub queues: QueueRunner,
    pub walking: Walking,
    pub scratch: Scratch,
    pub sender: OrderSender,
}

impl Game {
    pub fn new(world: WorldState, terrain: TerrainMap, sender: OrderSender) -> Game {
        let scripts = default_scripts(&terrain, vec![sender.clone()]);
        let t = Arc::new(terrain.clone());
        let orders = OrderQueue::new(scripts.kinds.clone(), Some(t.clone()));
        let queues = scripts.queue_runner();
        let walking = Walking::new(t);
        Game {
            world,
            terrain,
            scripts,
            orders,
            queues,
            walking,
            scratch: Scratch::default(),
            sender,
        }
    }

    /// One tick as the game runs it: residents fed, orders, queues, scripts, the world steps.
    pub fn tick(&mut self) {
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

    /// Ticks until `done`, at most `max` ticks; it must be true then.
    #[track_caller]
    pub fn until(&mut self, max: usize, done: impl Fn(&Game) -> bool) {
        for _ in 0..max {
            if done(self) {
                break;
            }
            self.tick();
        }
        assert!(done(self), "not done after {max} ticks, at tick {}", self.world.tick);
    }

    /// Sends an order for `resident_id`; it waits for the next tick.
    pub fn give_to(&mut self, resident_id: &str, mut order: Value) -> OrderReply {
        order["residentId"] = json!(resident_id);
        self.orders.receive(&self.world, &self.sender, &json!("q"), &order)
    }

    pub fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    pub fn memory(&self, id: &str) -> Value {
        Value::Object(self.r(id).script.as_ref().expect("running a script").memory.clone())
    }

    /// The realm events of one `kind`, as JSON.
    pub fn events(&self, kind: &str) -> Vec<Value> {
        self.world
            .events
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|v| v["kind"] == kind)
            .collect()
    }
}

/// `{ kind: 'ack' }` of an order's answer.
pub fn acked(reply: &OrderReply) -> bool {
    matches!(reply, OrderReply::Ack { .. })
}

/// The reason of a rejected order's answer.
pub fn rejected(reply: &OrderReply) -> Option<&str> {
    match reply {
        OrderReply::Rejected { reason, .. } => Some(reason),
        _ => None,
    }
}

/// What `toMatchObject` checks: every field of `want` is in `got` with an equal value (objects
/// by their fields, numbers by value, arrays whole).
pub fn contains(got: &Value, want: &Value) -> bool {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => {
            w.iter().all(|(k, v)| g.get(k).is_some_and(|x| contains(x, v)))
        }
        (Value::Array(g), Value::Array(w)) => {
            g.len() == w.len() && g.iter().zip(w).all(|(x, y)| contains(x, y))
        }
        (Value::Number(g), Value::Number(w)) => g.as_f64() == w.as_f64(),
        _ => got == want,
    }
}

/// `expect(value).toMatchObject(want)`.
#[track_caller]
pub fn assert_matches(got: &Value, want: Value) {
    assert!(contains(got, &want), "{got} does not match {want}");
}

/// A resident's order as JSON (`null` for none).
pub fn order_json(r: &Resident) -> Value {
    serde_json::to_value(&r.order).unwrap()
}

/// `serde_json::from_value` with the type inferred, for setting up state.
pub fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// A host whose every script is the default of one `task`, for tests of a single default without
/// a library (`hostOf`).
struct TaskHost {
    task: Task,
}

impl ScriptHost for TaskHost {
    fn script(&self, _: u64) -> Option<RunnableScript> {
        let (name, source) = default_script(self.task);
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

/// A runner of the scripts of `task`'s default (`new ScriptRunner(terrain, hostOf(task))`).
pub fn task_runner(terrain: &TerrainMap, task: Task) -> ScriptRunner {
    ScriptRunner::new(Arc::new(terrain.clone()), Arc::new(TaskHost { task }), order_kinds())
}
