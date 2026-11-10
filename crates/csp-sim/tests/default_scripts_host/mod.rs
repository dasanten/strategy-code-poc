//! `apps/server/src/test-default-scripts.ts`: for tests without a script library, tasks given as
//! from the UI, every Player running the game's default scripts unedited (`CONTEXT.md`: Default
//! script). A Player's version of a task's default has the id `userId * 100` plus the task's place
//! in `TASKS`, from 1; Run script runs it by that id. Other scripts of theirs go in `library`, by
//! id; deleting one there deletes it. Every Player has explored the whole map, unless `explored`
//! says otherwise.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Task, WorldState};

use csp_sim::default_scripts::{default_script, TASKS};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderKinds};
use csp_sim::script_runner::{
    DefaultScriptHost, RunScriptOrder, ScriptHost, ScriptRunner, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use csp_sim::scripts::RunnableScript;
use csp_sim::sight::InvariantViolation;
use csp_sim::tick::Scratch;

/// Whether a Player has explored a tile.
pub type Explored = Arc<dyn Fn(u64, i32, i32) -> bool + Send + Sync>;

/// The id of a Player's version of a task's default script (`defaultScript`).
pub fn default_script_id(user_id: u64, task: Task) -> u64 {
    user_id * 100 + TASKS.iter().position(|t| *t == task).expect("a task") as u64 + 1
}

/// The host the runner and the orders ask.
pub struct Host {
    pub library: Mutex<HashMap<u64, RunnableScript>>,
    pub senders: Vec<OrderSender>,
    pub explored: Explored,
}

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        if let Some(s) = self.library.lock().unwrap().get(&id) {
            return Some(s.clone());
        }
        let task = *TASKS.get(((id % 100) as usize).checked_sub(1)?)?;
        let (name, source) = default_script(task);
        Some(RunnableScript {
            user_id: id / 100,
            name: name.to_string(),
            version: 1,
            source: source.to_string(),
            follows_default: true,
            task: Some(task),
        })
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.senders.iter().find(|s| s.user_id == user_id).cloned()
    }
    fn explored(&self, user_id: u64, x: i32, y: i32) -> bool {
        (self.explored)(user_id, x, y)
    }
    fn default_script(&self, user_id: u64, task: Task) -> Option<u64> {
        Some(default_script_id(user_id, task))
    }
}

impl DefaultScriptHost for Host {
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        default_script_id(user_id, task)
    }
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        ScriptHost::script(self, script_id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

/// What `defaultScripts` gives back: the order kinds with the run-script and task orders, and the
/// runner.
pub struct DefaultScripts {
    pub host: Arc<Host>,
    /// The order kinds with the run-script and task orders.
    pub kinds: OrderKinds,
    pub runner: ScriptRunner,
}

impl DefaultScripts {
    /// Runs every running script once, as the game does before the world steps (`runAll`), and
    /// gives back the invariant violations found.
    pub fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
    ) -> Vec<InvariantViolation> {
        self.runner.run_all(world, scratch, true)
    }
}

/// `defaultScripts(terrain, senders, library, explored)`.
pub fn default_scripts(
    terrain: &TerrainMap,
    senders: Vec<OrderSender>,
    explored: Option<Explored>,
) -> DefaultScripts {
    let host = Arc::new(Host {
        library: Mutex::new(HashMap::new()),
        senders,
        explored: explored.unwrap_or_else(|| Arc::new(|_, _, _| true)),
    });
    let script_host: Arc<dyn ScriptHost + Send + Sync> = host.clone();
    let mut kinds = order_kinds();
    kinds.insert("runScript", RunScriptOrder { host: script_host.clone() });
    kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: script_host.clone() });
    kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: script_host.clone() });
    kinds.insert("task", TaskOrder::new(host.clone()));
    let runner = ScriptRunner::new(Arc::new(terrain.clone()), script_host, kinds.clone());
    DefaultScripts { host, kinds, runner }
}
