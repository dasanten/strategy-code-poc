//! For tests without a script library (`test-default-scripts.ts`): tasks given as from the UI,
//! every Player running the game's default scripts unedited (`CONTEXT.md`: Default script). A
//! Player's version of a task's default has the id `user_id * 100` plus the task's place in
//! `TASKS`, from 1; Run script runs it by that id. Every Player has explored the whole map.

use std::sync::Arc;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Task, WorldState};

use super::{
    DefaultScriptHost, RunScriptOrder, ScriptHost, ScriptRunner, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use crate::default_scripts::{default_script, TASKS};
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderKinds};
use crate::scripts::RunnableScript;
use crate::sight::InvariantViolation;
use crate::tick::Scratch;

/// The id of Player `user_id`'s version of a task's default (`defaultScript`).
pub fn default_script_id(user_id: u64, task: Task) -> u64 {
    let place = TASKS.iter().position(|t| *t == task).expect("a task") as u64;
    user_id * 100 + place + 1
}

struct Host {
    senders: Vec<OrderSender>,
}

impl Host {
    fn runnable(&self, id: u64) -> Option<RunnableScript> {
        let task = *TASKS.get(((id % 100) as usize).checked_sub(1)?)?;
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
        self.runnable(id)
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
        self.runnable(id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

/// The order kinds with the run-script and task orders, and a runner of the default scripts
/// (`defaultScripts`).
pub struct DefaultScripts {
    pub kinds: OrderKinds,
    runner: ScriptRunner,
}

impl DefaultScripts {
    pub fn new(terrain: Arc<TerrainMap>, senders: &[OrderSender]) -> Self {
        let host = Arc::new(Host { senders: senders.to_vec() });
        let mut kinds = order_kinds();
        kinds.insert("runScript", RunScriptOrder { host: host.clone() });
        kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: host.clone() });
        kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: host.clone() });
        kinds.insert("task", TaskOrder::new(host.clone()));
        let runner = ScriptRunner::new(terrain, host, kinds.clone());
        DefaultScripts { kinds, runner }
    }

    /// Runs every running script once, as the game does before the world steps (`runAll`), with
    /// the invariants checked.
    pub fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
    ) -> Vec<InvariantViolation> {
        self.runner.run_all(world, scratch, true)
    }
}
