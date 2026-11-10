//! `apps/server/src/test-default-scripts.ts`, for the integration tests (T86.17): tasks given as
//! from the UI, every Player running the game's default scripts unedited (`CONTEXT.md`: Default
//! script). A Player's version of a task's default has the id `userId * 100` plus the task's
//! place in `TASKS`, from 1; Run script runs it by that id. Other scripts of theirs go in
//! `library`, by id. Every Player has explored the whole map.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Task, WorldState};
use csp_sim::default_scripts::{default_script, TASKS};
use csp_sim::invariants::InvariantViolation;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderKinds};
use csp_sim::script_runner::{
    DefaultScriptHost, RunScriptOrder, ScriptHost, ScriptRunner, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;

/// The scripts of the Players besides the defaults, by id.
pub type Library = Arc<Mutex<HashMap<u64, RunnableScript>>>;

pub struct Host {
    pub senders: Vec<OrderSender>,
    pub library: Library,
}

impl Host {
    fn default_id(user_id: u64, task: Task) -> u64 {
        user_id * 100 + TASKS.iter().position(|t| *t == task).expect("a task") as u64 + 1
    }

    fn find(&self, id: u64) -> Option<RunnableScript> {
        if let Some(s) = self.library.lock().unwrap().get(&id) {
            return Some(s.clone());
        }
        let task = *TASKS.get((id % 100).checked_sub(1)? as usize)?;
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
        Some(Host::default_id(user_id, task))
    }
}

impl DefaultScriptHost for Host {
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        Host::default_id(user_id, task)
    }
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.find(id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

pub struct DefaultScripts {
    /// The order kinds with the run-script and task orders.
    pub kinds: OrderKinds,
    runner: ScriptRunner,
}

impl DefaultScripts {
    /// Runs every running script once, as the game does before the world steps.
    pub fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
    ) -> Vec<InvariantViolation> {
        self.runner.run_all(world, scratch, true)
    }
}

/// The library is shared with the test, which may add scripts to it or delete them.
pub fn default_scripts(
    terrain: &TerrainMap,
    senders: Vec<OrderSender>,
    library: Library,
) -> DefaultScripts {
    let host = Arc::new(Host { senders, library });
    let mut kinds = order_kinds();
    let script_host: Arc<dyn ScriptHost + Send + Sync> = host.clone();
    kinds.insert("runScript", RunScriptOrder { host: script_host.clone() });
    kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: script_host.clone() });
    kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: script_host.clone() });
    kinds.insert("task", TaskOrder::new(host));
    let runner = ScriptRunner::new(Arc::new(terrain.clone()), script_host, kinds.clone());
    DefaultScripts { kinds, runner }
}
