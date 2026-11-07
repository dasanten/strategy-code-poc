//! The world-state types of `packages/shared/src/default-scripts.ts`.

use serde::{Deserialize, Serialize};

/// The tasks that run a default script (`TASKS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    Work,
    Build,
    Haul,
    TearDown,
    Breed,
    FeedStable,
    Defend,
    Train,
    BuildLine,
    Explore,
    Alarm,
}
