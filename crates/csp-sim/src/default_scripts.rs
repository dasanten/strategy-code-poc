//! The game's default scripts (`packages/shared/src/default-scripts.ts`, `CONTEXT.md`: Default
//! script; ADR 0009): the script behind each task the UI can give, written in the game's own
//! language. Their names and sources are generated into [`crate::script_tables`]; what giving a
//! task writes into `memory` (`TaskMemory`) is plain data the task order builds (T86.12's
//! `task` order in `script_runner`).

use csp_lang::{ParamInfo, ParamType};
use csp_shared::world::Task;
use serde_json::Value;

pub use crate::script_tables::DEFAULT_SCRIPTS;

/// The tasks that run a default script, in the TypeScript's order (`TASKS`). Defend and Alarm
/// are never given: being struck starts the one (`CONTEXT.md`: Defence script), an alarm the
/// other (Alarm script).
pub const TASKS: [Task; 11] = [
    Task::Work,
    Task::Build,
    Task::Haul,
    Task::TearDown,
    Task::Breed,
    Task::FeedStable,
    Task::Defend,
    Task::Train,
    Task::BuildLine,
    Task::Explore,
    Task::Alarm,
];

/// A task's name as the TypeScript writes it (`"tearDown"`).
pub fn task_name(task: Task) -> &'static str {
    match task {
        Task::Work => "work",
        Task::Build => "build",
        Task::Haul => "haul",
        Task::TearDown => "tearDown",
        Task::Breed => "breed",
        Task::FeedStable => "feedStable",
        Task::Defend => "defend",
        Task::Train => "train",
        Task::BuildLine => "buildLine",
        Task::Explore => "explore",
        Task::Alarm => "alarm",
    }
}

/// The task a value names, if it names one (`isTask`).
pub fn task_of(value: &Value) -> Option<Task> {
    let name = value.as_str()?;
    TASKS.into_iter().find(|t| task_name(*t) == name)
}

/// The param each task's default script takes its target in (`TARGET_PARAMS`, `CONTEXT.md`:
/// Default script, Started directly).
pub fn target_param_of(task: Task) -> Option<&'static str> {
    Some(match task {
        Task::Work => "workplace",
        Task::Build => "site",
        Task::Haul => "carriage",
        Task::TearDown => "building",
        Task::Breed => "stable",
        Task::FeedStable => "stable",
        Task::Train => "ground",
        _ => return None,
    })
}

/// The target param of a script, if it is the default of a task with one (`targetParam`).
pub fn target_param(task: Option<Task>) -> Option<&'static str> {
    task.and_then(target_param_of)
}

/// The param a work script is given its workplace in: the Work default's target param
/// (`WORKPLACE_PARAM`).
pub const WORKPLACE_PARAM: &str = "workplace";

/// Whether a script's `param` lines make it a work script (`isWorkScript`, `CONTEXT.md`:
/// Workplace settings): it declares `param workplace: building`, as the Work default does.
pub fn is_work_script(params: &[ParamInfo]) -> bool {
    params.iter().any(|p| p.param.name == WORKPLACE_PARAM && p.param.ty == ParamType::Building)
}

/// Whether a script has nothing to go on without this param (`paramNeedsValue`): it has no
/// default and its comment says nothing after `none:` (`/\bnone:/`).
pub fn param_needs_value(p: &ParamInfo) -> bool {
    if p.param.default.is_some() {
        return false;
    }
    let text = p.description.as_deref().unwrap_or("");
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    !text.match_indices("none:").any(|(i, _)| !text[..i].chars().next_back().is_some_and(word))
}

/// A task's default script: its name as the UI shows it and its source (`DEFAULT_SCRIPTS[task]`).
pub fn default_script(task: Task) -> (&'static str, &'static str) {
    let (_, name, source) =
        DEFAULT_SCRIPTS.iter().find(|(t, _, _)| *t == task).expect("every task has a default");
    (name, source)
}

/// The name of a Player's version of a task's default script in their library
/// (`defaultScriptName`).
pub fn default_script_name(task: Task) -> String {
    format!("{} (default)", default_script(task).0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_task_has_its_default() {
        assert_eq!(DEFAULT_SCRIPTS.len(), TASKS.len());
        for (i, task) in TASKS.into_iter().enumerate() {
            assert_eq!(DEFAULT_SCRIPTS[i].0, task);
        }
        assert_eq!(default_script_name(Task::TearDown), "Tear down (default)");
        assert_eq!(task_of(&Value::from("feedStable")), Some(Task::FeedStable));
        assert_eq!(task_of(&Value::from("toString")), None);
    }

    #[test]
    fn every_default_parses_and_names_its_target_param() {
        for (task, _, source) in DEFAULT_SCRIPTS {
            assert!(csp_lang::check_script(source).is_empty(), "{task:?}");
            if let Some(target) = target_param_of(*task) {
                let params = csp_lang::script_params(source);
                assert!(params.iter().any(|p| p.param.name == target), "{task:?}");
            }
        }
        let (_, work) = default_script(Task::Work);
        assert!(is_work_script(&csp_lang::script_params(work)));
    }
}
