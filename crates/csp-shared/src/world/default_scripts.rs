//! The world-state types of default scripts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The tasks that run a default script (`TASKS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    Work,
    Build,
    Haul,
    TearDown,
    Repair,
    Breed,
    FeedStable,
    Defend,
    Train,
    BuildLine,
    Explore,
    Alarm,
    /// Gathering by hand (`CONTEXT.md`: Gather).
    Gather,
}
