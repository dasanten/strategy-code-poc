//! The world's side of the script library (`apps/server/src/scripts.ts`): a script that can run.
//! The library itself, its versions and checks, is the database's (Epic 1004, `csp-server`),
//! which hands scripts to the simulation through [`ScriptLibrary`].

use csp_shared::world::Task;

/// A script that can run (`RunnableScript`): its Player and active version.
#[derive(Debug, Clone, PartialEq)]
pub struct RunnableScript {
    pub user_id: u64,
    pub name: String,
    /// The active version's number and source.
    pub version: u32,
    pub source: String,
    /// A default script its Player hasn't edited: running out of steps is the game's fault.
    pub follows_default: bool,
    /// The task it is the default script of; `None` for any other script.
    pub task: Option<Task>,
}

/// Where the simulation finds scripts by id (`runnableScript`, the `ScriptHost`'s `script`);
/// `None` for one with no active version, or gone.
pub trait ScriptLibrary {
    fn script(&self, script_id: u64) -> Option<RunnableScript>;
}
