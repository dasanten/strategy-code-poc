//! What the integration tests share.
use csp_server::scripts::{task_name, DefaultScript};
use csp_shared::world::default_scripts::Task;

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

/// A stand-in for `DEFAULT_SCRIPTS` until the default scripts are ported (T86.12): a valid script
/// of its own for every task, which is all the library's tests need of them.
pub fn defaults() -> Vec<DefaultScript> {
    TASKS
        .iter()
        .map(|&task| {
            let name = task_name(task);
            DefaultScript {
                task,
                name: format!("{}{}", name[..1].to_uppercase(), &name[1..]),
                source: format!("// {name} (default)\nlet task = 1\n"),
            }
        })
        .collect()
}
