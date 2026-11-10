//! What the integration tests share.
use csp_server::scripts::{game_defaults, DefaultScript};
use csp_shared::world::default_scripts::Task;

#[allow(dead_code)] // Not every test file that shares this module uses it.
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

/// The game's default scripts (`DEFAULT_SCRIPTS`), as the library's tests use them.
pub fn defaults() -> Vec<DefaultScript> {
    game_defaults().to_vec()
}
