//! The default scripts' names and sources (`CONTEXT.md`: Default script; ADR 0009). Each source is
//! its own file in `default_scripts/`, in the game's own language; `.gitattributes` keeps them on
//! LF line endings, as `include_str!` takes them as they are.

use csp_shared::world::Task;

/// Each task's default script: its name as the UI shows it, and its source
/// (`DEFAULT_SCRIPTS`), in the order of `TASKS`.
pub static DEFAULT_SCRIPTS: &[(Task, &str, &str)] = &[
    (Task::Work, "Work", include_str!("default_scripts/work.script")),
    (Task::Build, "Build", include_str!("default_scripts/build.script")),
    (Task::Haul, "Haul", include_str!("default_scripts/haul.script")),
    (Task::TearDown, "Tear down", include_str!("default_scripts/tear_down.script")),
    (Task::Repair, "Repair", include_str!("default_scripts/repair.script")),
    (Task::Breed, "Breed horses", include_str!("default_scripts/breed.script")),
    (Task::FeedStable, "Feed the stable", include_str!("default_scripts/feed_stable.script")),
    (Task::Defend, "Defend", include_str!("default_scripts/defend.script")),
    (Task::Train, "Train", include_str!("default_scripts/train.script")),
    (Task::BuildLine, "Build line", include_str!("default_scripts/build_line.script")),
    (Task::Explore, "Explore", include_str!("default_scripts/explore.script")),
    (Task::Alarm, "Alarm", include_str!("default_scripts/alarm.script")),
    (Task::Gather, "Gather", include_str!("default_scripts/gather.script")),
];
