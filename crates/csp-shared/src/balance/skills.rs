//! Training and skills.

use serde::Serialize;

use super::*;
use crate::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValues {
    pub mining: f64,
    pub woodcutting: f64,
    pub smelting: f64,
    pub smithing: f64,
    pub farming: f64,
    pub construction: f64,
    pub combat: f64,
    pub driving: f64,
    pub seafaring: f64,
}

balance! {
/// Most trainees at one training ground at a time (`CONTEXT.md`: Trainee).
pub const TRAINING_GROUND_MAX_TRAINEES: f64 = 6.0;

/// Trained bonus a trainee of average Intellect gains in a stat each tick a teacher is there
/// (`CONTEXT.md`: Training): an average base of 10 reaches its cap of 5 in half a game year.
pub const TRAIN_STAT_PER_TICK: f64 = 5.0 / (TICKS_PER_GAME_YEAR / 2.0);

/// How much faster training a work skill, Construction or Driving goes than learning it by doing
/// (`CONTEXT.md`: Training). Fast enough that training first and then working has made more by the
/// end of a game year than learning at the job, the teacher's lost work counted.
pub const TRAIN_SKILL_FACTOR: f64 = 6.0;

/// How much faster training Combat goes than its game year in `SKILL_PER_DAY`, half a game year to
/// its maximum. Slower than `TRAIN_SKILL_FACTOR`: it doubles a blow and has no output to give up.
pub const TRAIN_COMBAT_FACTOR: f64 = 2.0;

/// The most of each skill a resident can have (`CONTEXT.md`: Skill): where it stops making them
/// better. Training never takes a skill past it.
pub const SKILL_MAX: SkillValues = SkillValues {
    mining: WORK_SKILL_MAX,
    woodcutting: WORK_SKILL_MAX,
    smelting: WORK_SKILL_MAX,
    smithing: WORK_SKILL_MAX,
    farming: WORK_SKILL_MAX,
    construction: CONSTRUCTION_SKILL_MAX,
    combat: COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT,
    driving: DRIVING_SKILL_LIMIT / DRIVING_SKILL_EFFECT,
    seafaring: SEAFARING_SKILL_LIMIT / SEAFARING_SKILL_EFFECT,
};

/// Each skill learned by doing, in points per game day for a learner of average Intellect. Combat
/// is learned by blows rather than days; for training it counts as reaching its maximum in a game
/// year, as the work skills do.
pub const SKILL_PER_DAY: SkillValues = SkillValues {
    mining: WORK_SKILL_PER_DAY,
    woodcutting: WORK_SKILL_PER_DAY,
    smelting: WORK_SKILL_PER_DAY,
    smithing: WORK_SKILL_PER_DAY,
    farming: WORK_SKILL_PER_DAY,
    construction: CONSTRUCTION_SKILL_PER_DAY,
    combat: SKILL_MAX.combat / (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY),
    driving: DRIVING_SKILL_PER_DAY,
    seafaring: SEAFARING_SKILL_PER_DAY,
};
}
