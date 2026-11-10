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
