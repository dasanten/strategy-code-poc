//! The helpers of `packages/shared/src/balance.ts` that take a resident and that building, work
//! and training use: building and work pace, skills learned by doing, training gains, carry
//! capacity. The numbers are `csp_shared::balance`'s.

use csp_shared::balance::trained_cap;
use csp_shared::balance::{
    SkillValues, BATCHES_PER_DAY, BUILD_STRENGTH_AVERAGE, CARRY_BASE, CARRY_PER_STRENGTH,
    CONSTRUCTION_SKILL_EFFECT, CONSTRUCTION_SKILL_LIMIT, CONSTRUCTION_SKILL_MAX,
    CONSTRUCTION_SKILL_PER_DAY, INTELLECT_AVERAGE, RECIPES, SKILL_MAX, SKILL_PER_DAY,
    TRAIN_COMBAT_FACTOR, TRAIN_SKILL_FACTOR, TRAIN_STAT_PER_TICK, WORKPLACE_SKILL,
    WORK_OUTPUT_PER_DAY, WORK_SKILL_EFFECT, WORK_SKILL_LIMIT, WORK_SKILL_MAX, WORK_SKILL_PER_DAY,
    WORK_STRENGTH_AVERAGE,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, Resident, SkillName, StatName, TrainingSubject};

use super::names::{good_name, kind_name};
use super::residents::{age_factor, stat_value};

/// A resident's points in a skill: 0 for one they never learned (`skills[skill] ?? 0`).
pub fn skill_of(r: &Resident, skill: SkillName) -> f64 {
    r.skills.get(&skill).copied().unwrap_or(0.0)
}

/// The skill a TypeScript name names (`WORKPLACE_SKILL`'s values).
pub fn skill_named(name: &str) -> Option<SkillName> {
    serde_json::from_value(serde_json::Value::String(name.to_owned())).ok()
}

/// The skill working a workplace of `kind` uses and teaches (`WORKPLACE_SKILL`).
pub fn workplace_skill(kind: BuildingKind) -> Option<SkillName> {
    WORKPLACE_SKILL.get(kind_name(kind)).and_then(skill_named)
}

/// A skill's value in a per-skill table (`SKILL_MAX`, `SKILL_PER_DAY`).
pub fn skill_value(values: &SkillValues, skill: SkillName) -> f64 {
    match skill {
        SkillName::Mining => values.mining,
        SkillName::Woodcutting => values.woodcutting,
        SkillName::Smelting => values.smelting,
        SkillName::Smithing => values.smithing,
        SkillName::Construction => values.construction,
        SkillName::Farming => values.farming,
        SkillName::Combat => values.combat,
        SkillName::Driving => values.driving,
    }
}

/// A training subject as a stat or a skill (`subject in resident.stats`).
pub fn subject_parts(subject: TrainingSubject) -> Result<StatName, SkillName> {
    match subject {
        TrainingSubject::Strength => Ok(StatName::Strength),
        TrainingSubject::Endurance => Ok(StatName::Endurance),
        TrainingSubject::Agility => Ok(StatName::Agility),
        TrainingSubject::Intellect => Ok(StatName::Intellect),
        TrainingSubject::Mining => Err(SkillName::Mining),
        TrainingSubject::Woodcutting => Err(SkillName::Woodcutting),
        TrainingSubject::Smelting => Err(SkillName::Smelting),
        TrainingSubject::Smithing => Err(SkillName::Smithing),
        TrainingSubject::Construction => Err(SkillName::Construction),
        TrainingSubject::Farming => Err(SkillName::Farming),
        TrainingSubject::Combat => Err(SkillName::Combat),
        TrainingSubject::Driving => Err(SkillName::Driving),
    }
}

/// Building work a resident puts in per tick (`buildWork`): in proportion to Strength, plus
/// `CONSTRUCTION_SKILL_EFFECT` a point of Construction, up to `CONSTRUCTION_SKILL_LIMIT`.
pub fn build_work(r: &Resident, tick: f64) -> f64 {
    let strength = stat_value(r, StatName::Strength, tick) / BUILD_STRENGTH_AVERAGE;
    let skill = skill_of(r, SkillName::Construction) * CONSTRUCTION_SKILL_EFFECT;
    strength * (1.0 + CONSTRUCTION_SKILL_LIMIT.min(skill))
}

/// Construction a resident learns from one tick of building work (`constructionLearned`).
pub fn construction_learned(r: &Resident, tick: f64) -> f64 {
    let pace = stat_value(r, StatName::Intellect, tick) / INTELLECT_AVERAGE;
    let room = 0f64.max(CONSTRUCTION_SKILL_MAX - skill_of(r, SkillName::Construction));
    room.min((CONSTRUCTION_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace)
}

/// `per_day` a game day, as a share per tick (`workPace` in `balance.ts`).
fn pace_of(r: &Resident, per_day: f64, skill: SkillName, tick: f64) -> f64 {
    let strength = stat_value(r, StatName::Strength, tick) / WORK_STRENGTH_AVERAGE;
    let skilled = 1.0 + WORK_SKILL_LIMIT.min(skill_of(r, skill) * WORK_SKILL_EFFECT);
    (per_day / TICKS_PER_GAME_DAY) * strength * skilled
}

/// How much of a unit of `good` a worker makes per tick using `skill` (`workOutput`).
pub fn work_output(r: &Resident, good: Good, skill: SkillName, tick: f64) -> f64 {
    pace_of(r, WORK_OUTPUT_PER_DAY.get(good_name(good)).unwrap_or(0.0), skill, tick)
}

/// How much of a batch a worker gets through per tick at a processing workplace (`batchWork`).
pub fn batch_work(r: &Resident, kind: BuildingKind, tick: f64) -> f64 {
    match workplace_skill(kind) {
        Some(skill) => pace_of(r, BATCHES_PER_DAY.get(kind_name(kind)).unwrap_or(0.0), skill, tick),
        None => 0.0,
    }
}

/// How much of `good` a worker makes a game day at a workplace of `kind` (`madePerDay`).
pub fn made_per_day(r: &Resident, kind: BuildingKind, good: Good, tick: f64) -> f64 {
    if let Some(recipes) = RECIPES.get(kind_name(kind)) {
        let yields =
            recipes.iter().find_map(|recipe| recipe.output.get(good_name(good))).unwrap_or(0.0);
        return batch_work(r, kind, tick) * yields * TICKS_PER_GAME_DAY;
    }
    match workplace_skill(kind) {
        Some(skill) => work_output(r, good, skill, tick) * TICKS_PER_GAME_DAY,
        None => 0.0,
    }
}

/// How much of `skill` a worker learns from one tick of work (`workLearned`).
pub fn work_learned(r: &Resident, skill: SkillName, tick: f64) -> f64 {
    let pace = stat_value(r, StatName::Intellect, tick) / INTELLECT_AVERAGE;
    let room = 0f64.max(WORK_SKILL_MAX - skill_of(r, skill));
    room.min((WORK_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace)
}

/// What `trainee` gains in `subject` from one tick with `teacher` (`trainingGain`).
pub fn training_gain(
    trainee: &Resident,
    teacher: &Resident,
    subject: TrainingSubject,
    tick: f64,
) -> f64 {
    let pace = stat_value(trainee, StatName::Intellect, tick) / INTELLECT_AVERAGE;
    match subject_parts(subject) {
        Ok(stat) => {
            let s = stat_record(trainee, stat);
            let to_cap = trained_cap(s.0) - s.1;
            let to_teacher = (stat_value(teacher, stat, tick) - stat_value(trainee, stat, tick))
                / age_factor(trainee, tick);
            0f64.max((TRAIN_STAT_PER_TICK * pace).min(to_cap).min(to_teacher))
        }
        Err(skill) => {
            let has = skill_of(trainee, skill);
            let to_teacher = skill_of(teacher, skill) - has;
            let factor =
                if skill == SkillName::Combat { TRAIN_COMBAT_FACTOR } else { TRAIN_SKILL_FACTOR };
            let per_tick =
                (skill_value(&SKILL_PER_DAY, skill) / TICKS_PER_GAME_DAY) * factor * pace;
            0f64.max(per_tick.min(skill_value(&SKILL_MAX, skill) - has).min(to_teacher))
        }
    }
}

/// A stat's base and trained bonus.
fn stat_record(r: &Resident, stat: StatName) -> (f64, f64) {
    let s = match stat {
        StatName::Strength => &r.stats.strength,
        StatName::Endurance => &r.stats.endurance,
        StatName::Agility => &r.stats.agility,
        StatName::Intellect => &r.stats.intellect,
    };
    (s.base, s.trained)
}

/// A resident's value in a training subject (`subjectValue`).
pub fn subject_value(r: &Resident, subject: TrainingSubject, tick: f64) -> f64 {
    match subject_parts(subject) {
        Ok(stat) => stat_value(r, stat, tick),
        Err(skill) => skill_of(r, skill),
    }
}

/// The most `trainee` can reach in `subject` under `teacher` (`trainingCeiling`).
pub fn training_ceiling(
    trainee: &Resident,
    teacher: &Resident,
    subject: TrainingSubject,
    tick: f64,
) -> f64 {
    let teaches = subject_value(teacher, subject, tick);
    match subject_parts(subject) {
        Err(skill) => teaches.min(skill_value(&SKILL_MAX, skill)),
        Ok(stat) => {
            let (base, _) = stat_record(trainee, stat);
            teaches.min((base + trained_cap(base)) * age_factor(trainee, tick))
        }
    }
}

/// The most weight a resident can carry, in kg (`carryCapacity`).
pub fn carry_capacity(r: &Resident, tick: f64) -> f64 {
    CARRY_BASE + CARRY_PER_STRENGTH * stat_value(r, StatName::Strength, tick)
}
