//! Scripts and queues: budgets and limits.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptValueLimits {
    pub max_string_length: f64,
    pub max_list_length: f64,
    pub max_object_keys: f64,
}

balance! {
/// How many interpreter steps one resident's or army's script may use each tick (`CONTEXT.md`:
/// Step budget). Every evaluated node costs 1; enough for a few loops over what it sees.
pub const SCRIPT_STEP_BUDGET: f64 = 2000.0;

/// How deeply a script's own function calls may nest before the run stops with an error.
pub const SCRIPT_MAX_CALL_DEPTH: f64 = 50.0;

/// The longest string a script may build, in characters (`CONTEXT.md`: Value limits): as much as
/// its whole memory holds (`SCRIPT_MEMORY_MAX`), so no one string outgrows it. Past the cap the
/// script stops with a runtime error.
pub const SCRIPT_MAX_STRING_LENGTH: f64 = 4000.0;

/// The most items a list a script builds may hold (`CONTEXT.md`: Value limits): more than a large
/// realm has residents and buildings in sight, so a script can collect all it sees in one list.
pub const SCRIPT_MAX_LIST_LENGTH: f64 = 500.0;

/// The most keys an object a script builds may hold (`CONTEXT.md`: Value limits): plenty for a
/// memory keyed by id or tile, far fewer than the memory could hold anyway.
pub const SCRIPT_MAX_OBJECT_KEYS: f64 = 200.0;

/// The three together, in the shape the interpreter's `run` takes (`ValueLimits` in `@csp/lang`).
pub const SCRIPT_VALUE_LIMITS: ScriptValueLimits = ScriptValueLimits {
    max_string_length: SCRIPT_MAX_STRING_LENGTH,
    max_list_length: SCRIPT_MAX_LIST_LENGTH,
    max_object_keys: SCRIPT_MAX_OBJECT_KEYS,
};

/// Extra steps a script pays to ask the world something it sees as a list (`residents()`,
/// `buildings()`, `nodes()`, …), on top of the 1 every evaluated node costs (`CONTEXT.md`: Step
/// budget). Dear enough that a script keeps what it found in a variable rather than asking again.
pub const SCRIPT_LIST_QUERY_COST: f64 = 20.0;

/// Extra steps for a small query about one tile or two things, such as `terrainAt` or `distance`.
pub const SCRIPT_TILE_QUERY_COST: f64 = 1.0;

/// Extra steps for a helper that only works on what it is given: `floor`, `pickRandom`.
pub const SCRIPT_HELPER_COST: f64 = 1.0;

/// Extra steps a script pays to request an action (`walkTo`, `pickUp`, …), accepted or not.
pub const SCRIPT_ACTION_COST: f64 = 10.0;

/// The most a running script's memory may hold, in characters of its JSON (`CONTEXT.md`:
/// Memory). Enough for a role, a few tiles and ids; a run that leaves more keeps the old memory.
pub const SCRIPT_MEMORY_MAX: f64 = 4000.0;

/// The most a value a script passes to an action or `withMemory` may hold, in characters of its
/// JSON: as much as its memory, so anything a script keeps it can also pass. Script values are
/// shared by reference, so one built in a few steps can stand for far more than this; the check
/// gives up as soon as it passes the limit and the call fails with a runtime error.
pub const SCRIPT_ACTION_VALUE_MAX: f64 = SCRIPT_MEMORY_MAX;

/// The longest text a script can give `doing()` for its resident's Doing line (`CONTEXT.md`:
/// Doing), in characters after trimming; longer text is cut. One line of the resident card.
pub const DOING_MAX_LENGTH: f64 = 60.0;

/// The lines a resident's script log keeps (`CONTEXT.md`: Script log); once full, the oldest
/// goes. Enough to follow a few minutes of a script logging its turns.
pub const SCRIPT_LOG_LINES: f64 = 20.0;

/// Ticks between two realm-log entries about the same resident's script going wrong (an error,
/// or running out of steps), so a script failing every tick doesn't flood the log. A minute.
pub const SCRIPT_LOG_INTERVAL: f64 = 60.0;

/// The most scripts a Player's library holds (`CONTEXT.md`: Library cap), their default scripts
/// among them; a new script past it is refused until one is deleted. A few dozen: room for a
/// script per task and plenty of experiments, too few to grow the database without bound.
pub const SCRIPT_LIBRARY_MAX_SCRIPTS: f64 = 40.0;

/// The most versions one script keeps (`CONTEXT.md`: Library cap); a save or reset past it is
/// refused until old versions are deleted. A few dozen saves of history to go back to.
pub const SCRIPT_MAX_VERSIONS: f64 = 40.0;

/// Script library writes (create, save, rename, activate, reset, delete) one Player may make in a
/// minute before the server answers 429. One a second: far more than anyone saves by hand, so
/// only a script hammering the API ever meets it.
pub const SCRIPT_WRITES_PER_MINUTE: f64 = 60.0;

/// The most steps and blocks a queue holds as written (`CONTEXT.md`: Queue, Repeat block): a day's
/// round with a few blocks; a block counts once however often it repeats. With
/// `QUEUE_STEP_MAX_CHARS` a full queue still fits the socket's largest frame
/// (`realtime.maxPayloadBytes`).
pub const QUEUE_MAX_STEPS: f64 = 50.0;

/// How deep a queue's blocks nest (`CONTEXT.md`: Repeat block): a block in a block in a block.
pub const QUEUE_MAX_DEPTH: f64 = 3.0;

/// The most rounds a repeat block counts (`CONTEXT.md`: Repeat block); for more, it repeats
/// forever.
pub const QUEUE_MAX_REPEAT: f64 = 1000.0;

/// The most a queue step's order request may hold, in characters of its JSON.
pub const QUEUE_STEP_MAX_CHARS: f64 = 1000.0;

/// The duration, in game minutes, the card gives a step that never ends on its own (work, haul)
/// once another step is put after it without one: a game hour, a real minute.
pub const QUEUE_DEFAULT_STEP_MINUTES: f64 = 60.0;
}
