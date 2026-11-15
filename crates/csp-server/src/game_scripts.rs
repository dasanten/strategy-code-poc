//! The game thread's way to the script library (`index.ts`'s `scriptHost` and `kinds`): the
//! simulation finds scripts, senders, explored terrain and default scripts here, and the order
//! kinds that need them (`runScript`, `task`, `setWorkSettings` and the rest) are built on it.

use std::sync::{Arc, Mutex, MutexGuard};

use csp_shared::world::{Task, WorldState};
use csp_sim::explored::{ExploredTerrain, MapTerrain};
use csp_sim::order_sender::{Account, OrderSender};
use csp_sim::orders::{order_kinds, OrderKinds};
use csp_sim::queues::QueueHost;
use csp_sim::script_params::SetScriptParamOrder;
use csp_sim::script_runner::{
    ArmyRunScriptOrder, DefaultScriptHost, RunScriptOrder, ScriptHost, SetAlarmScriptOrder,
    SetDefenceScriptOrder, TaskOrder,
};
use csp_sim::scripts::{RunnableScript, ScriptLibrary};
use csp_sim::tick::ScriptErrorWhere;
use csp_sim::workplace_settings::{SetWorkSettingsOrder, WorkSettingsHost};
use rusqlite::{Connection, OptionalExtension};

use crate::scripts::{default_script_id, runnable_script, Defaults};

/// Where a script error of the game's own goes (`reporter.scriptError`).
pub type ScriptErrors = Box<dyn Fn(&WorldState, &str, &ScriptErrorWhere) + Send + Sync>;

/// The script library on the database, with the Players' explored terrain (`scriptHost`).
pub struct LibraryHost {
    db: Arc<Mutex<Connection>>,
    defaults: &'static Defaults,
    explored: Arc<Mutex<ExploredTerrain>>,
    /// The map's terrain, whose regions tile views name.
    map: Arc<MapTerrain>,
    errors: Option<ScriptErrors>,
}

impl LibraryHost {
    pub fn new(
        db: Arc<Mutex<Connection>>,
        defaults: &'static Defaults,
        explored: Arc<Mutex<ExploredTerrain>>,
        errors: Option<ScriptErrors>,
    ) -> Self {
        let map = Arc::clone(explored.lock().unwrap_or_else(|e| e.into_inner()).map());
        LibraryHost { db, defaults, explored, map, errors }
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `runnableScript`; a database error is no script, as a missing one is.
    fn runnable(&self, script_id: u64) -> Option<RunnableScript> {
        let s = runnable_script(&self.db(), i64::try_from(script_id).ok()?).ok()??;
        Some(RunnableScript {
            user_id: s.user_id as u64,
            name: s.name,
            version: s.version as u32,
            source: s.source,
            follows_default: s.follows_default,
            task: s.task,
        })
    }

    /// `defaultScriptId`, 0 (no script) when the Player has none and none can be made.
    fn default_id(&self, user_id: u64, task: Task) -> u64 {
        default_script_id(&self.db(), self.defaults, user_id as i64, task)
            .ok()
            .flatten()
            .map_or(0, |id| id as u64)
    }

    /// The Player as an order's sender, from their account.
    fn account_sender(&self, user_id: u64) -> Option<OrderSender> {
        let (name, is_admin): (String, bool) = self
            .db()
            .query_row("SELECT name, is_admin FROM users WHERE id = ?1", [user_id as i64], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .ok()??;
        Some(OrderSender { user_id, account: Account { name, is_admin }, npc_city_id: None })
    }
}

impl ScriptHost for LibraryHost {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.account_sender(user_id)
    }
    fn explored(&self, user_id: u64, x: i32, y: i32) -> bool {
        self.explored.lock().unwrap_or_else(|e| e.into_inner()).is_explored(user_id, x, y)
    }
    fn regions(&self, seed: i64) -> Option<&csp_sim::regions::Regions> {
        Some(self.map.regions(seed))
    }
    fn default_script(&self, user_id: u64, task: Task) -> Option<u64> {
        Some(self.default_id(user_id, task)).filter(|&id| id != 0)
    }
    fn script_error(&self, world: &WorldState, error: &str, at: &ScriptErrorWhere) {
        if let Some(report) = &self.errors {
            report(world, error, at);
        }
    }
}

impl DefaultScriptHost for LibraryHost {
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.default_id(user_id, task)
    }
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    /// The library tells scripts (`index.ts` gives the task order `script`): without this, a
    /// task given with param values is refused as taking none, and Work at a workplace ignores
    /// the work script its settings pick.
    fn has_scripts(&self) -> bool {
        true
    }
}

impl WorkSettingsHost for LibraryHost {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.default_id(user_id, task)
    }
}

impl ScriptLibrary for LibraryHost {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
}

/// The queue runner's host: the same library, as a shared one.
pub struct SharedHost(pub Arc<LibraryHost>);

impl QueueHost for SharedHost {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.0.account_sender(user_id)
    }
}

/// Every order kind, those that need the script library built on `host` (`kinds` of `index.ts`).
pub fn library_order_kinds(host: &Arc<LibraryHost>) -> OrderKinds {
    let mut kinds = order_kinds();
    let script_host: Arc<dyn ScriptHost + Send + Sync> = host.clone();
    kinds.insert("runScript", RunScriptOrder { host: script_host.clone() });
    kinds.insert(
        "armyRunScript",
        ArmyRunScriptOrder { host: script_host.clone(), builtins: order_kinds() },
    );
    kinds.insert("setScriptParam", SetScriptParamOrder { library: host.clone() });
    kinds.insert("setDefenceScript", SetDefenceScriptOrder { host: script_host.clone() });
    kinds.insert("setAlarmScript", SetAlarmScriptOrder { host: script_host });
    kinds.insert("setWorkSettings", SetWorkSettingsOrder { host: host.clone() });
    kinds.insert("task", TaskOrder::new(host.clone()));
    kinds
}
