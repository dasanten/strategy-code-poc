//! What the running game asks of the database (`index.ts`'s `scriptHost` and `kinds`): the
//! Players' scripts and default scripts, who an order's sender is, and what a Player has
//! explored. The script runner, the queues and the script orders reach the database through it,
//! on a connection of its own.

use std::sync::{Arc, Mutex, PoisonError, RwLock};

use csp_shared::world::{Task, WorldState};
use csp_sim::{
    explored::ExploredTerrain,
    order_sender::{Account, OrderSender},
    orders::{order_kinds, OrderKinds},
    queues::QueueHost,
    script_params::SetScriptParamOrder,
    script_runner::{
        ArmyRunScriptOrder, DefaultScriptHost, RunScriptOrder, ScriptHost, SetAlarmScriptOrder,
        SetDefenceScriptOrder, TaskOrder,
    },
    scripts::{RunnableScript, ScriptLibrary},
    tick::{ScriptErrorWhere, TickReporter},
    workplace_settings::{SetWorkSettingsOrder, WorkSettingsHost},
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;
use tracing::Level;

use crate::{
    monitoring::{LogSink, ServerReporter},
    scripts::{default_script_id, runnable_script, Defaults},
};

/// The game's way into the database and the explored terrain (`ScriptHost`).
pub struct GameHost<L: LogSink> {
    db: Mutex<Connection>,
    explored: Arc<RwLock<ExploredTerrain>>,
    defaults: &'static Defaults,
    log: Arc<L>,
}

impl<L: LogSink> GameHost<L> {
    pub fn new(
        db: Connection,
        explored: Arc<RwLock<ExploredTerrain>>,
        defaults: &'static Defaults,
        log: Arc<L>,
    ) -> Self {
        GameHost { db: Mutex::new(db), explored, defaults, log }
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A database error is the game's own: logged, and the script is told there is nothing.
    fn failed(&self, what: &str, e: &rusqlite::Error) {
        self.log.log(Level::ERROR, json!({ "err": { "message": e.to_string() } }), what);
    }

    fn runnable(&self, script_id: u64) -> Option<RunnableScript> {
        let id = i64::try_from(script_id).ok()?;
        match runnable_script(&self.db(), id) {
            Ok(s) => s.map(|s| RunnableScript {
                user_id: s.user_id as u64,
                name: s.name,
                version: s.version as u32,
                source: s.source,
                follows_default: s.follows_default,
                task: s.task,
            }),
            Err(e) => {
                self.failed("script not read", &e);
                None
            }
        }
    }

    fn default_id(&self, user_id: u64, task: Task) -> Option<u64> {
        match default_script_id(&self.db(), self.defaults, user_id as i64, task) {
            Ok(id) => id.map(|id| id as u64),
            Err(e) => {
                self.failed("default script not read", &e);
                None
            }
        }
    }

    fn sender_of(&self, user_id: u64) -> Option<OrderSender> {
        let row = self
            .db()
            .query_row("SELECT name, is_admin FROM users WHERE id = ?1", [user_id as i64], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))
            })
            .optional();
        match row {
            Ok(row) => row.map(|(name, is_admin)| OrderSender {
                user_id,
                account: Account { name, is_admin },
                npc_city_id: None,
            }),
            Err(e) => {
                self.failed("order sender not read", &e);
                None
            }
        }
    }
}

impl<L: LogSink> ScriptHost for GameHost<L> {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.sender_of(user_id)
    }
    fn explored(&self, user_id: u64, x: i32, y: i32) -> bool {
        self.explored.read().unwrap_or_else(PoisonError::into_inner).is_explored(user_id, x, y)
    }
    fn default_script(&self, user_id: u64, task: Task) -> Option<u64> {
        self.default_id(user_id, task)
    }
    fn script_error(&self, world: &WorldState, error: &str, at: &ScriptErrorWhere) {
        ServerReporter::new(Arc::clone(&self.log)).script_error(world, error, at);
    }
}

impl<L: LogSink> DefaultScriptHost for GameHost<L> {
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.default_id(user_id, task).unwrap_or(0)
    }
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    fn has_scripts(&self) -> bool {
        true
    }
}

impl<L: LogSink> WorkSettingsHost for GameHost<L> {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.default_id(user_id, task).unwrap_or(0)
    }
}

impl<L: LogSink> ScriptLibrary for GameHost<L> {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.runnable(script_id)
    }
}

/// The host as the queues see it: who sends a queue's steps.
pub struct QueueSenders<L: LogSink>(pub Arc<GameHost<L>>);

impl<L: LogSink> QueueHost for QueueSenders<L> {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        self.0.sender_of(user_id)
    }
}

/// Every order kind the server takes (`index.ts`'s `kinds`): the game's, and those that need the
/// Players' scripts.
pub fn server_order_kinds<L: LogSink + Send + Sync + 'static>(
    host: &Arc<GameHost<L>>,
) -> OrderKinds {
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
