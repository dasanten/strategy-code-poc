//! Combat queries (`CONTEXT.md`: Combat, Weapons and armour): the contact test of
//! `packages/shared/src/combat.ts` and the blow helpers of `balance.ts`.

use csp_shared::balance::{
    BLOW_BASE, BLOW_PER_STRENGTH, COMBAT_SKILL_EFFECT, COMBAT_SKILL_LIMIT, COMBAT_SKILL_PER_BLOW,
    DODGE_LIMIT, DODGE_PER_AGILITY, INTELLECT_AVERAGE, MIN_BLOW_DAMAGE, PROTECTION_DEFENCE,
    SHOT_DAMAGE, SHOT_PIERCE, SHOT_REACH, SHOT_SKILL_LIMIT, SHOT_TICKS, STRIKE_TICKS,
    TOWER_SHOT_REACH_BONUS, WALL_SHOT_REACH_BONUS, WEAPON_ATTACK,
};
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{Good, Resident, SkillName, StatName, WorldState};

use super::names::{good_name, held};
use super::residents::stat_value;
use super::walls::{is_up, up_on_tower};
use crate::equipment::{equipped, Slot};

/// Whether two spots are in contact (`inContact`): on the same tile or one of the eight around
/// it, the short way round the map of `size` tiles.
pub fn in_contact(size: i32, a: (i32, i32), b: (i32, i32)) -> bool {
    wrap_delta(a.0, b.0, size).abs() <= 1 && wrap_delta(a.1, b.1, size).abs() <= 1
}

/// Damage a resident's protection takes off each blow (`protection`): the shield and armour they
/// have equipped (`CONTEXT.md`: Equipment); spares in the pack add nothing.
pub fn protection(r: &Resident) -> f64 {
    [Slot::Shield, Slot::Armour]
        .into_iter()
        .filter_map(|s| equipped(r, s))
        .filter_map(|g| PROTECTION_DEFENCE.get(good_name(g)))
        .sum()
}

/// How hard a resident strikes at `tick` (`attackPower`): from Strength and the weapon they have
/// equipped, harder with Combat skill.
pub fn attack_power(r: &Resident, tick: f64) -> f64 {
    let raw = BLOW_BASE + BLOW_PER_STRENGTH * stat_value(r, StatName::Strength, tick);
    (raw + weapon_attack(r)) * combat_skill_factor(r)
}

/// What the weapon a resident has equipped adds to each blow (`weaponAttack`): nothing unarmed.
pub fn weapon_attack(r: &Resident) -> f64 {
    equipped(r, Slot::Weapon).and_then(|w| WEAPON_ATTACK.get(good_name(w))).unwrap_or(0.0)
}

/// What a resident's Combat skill multiplies each blow by (`combatSkillFactor`): 1 unskilled, up
/// to `1 + COMBAT_SKILL_LIMIT`.
pub fn combat_skill_factor(r: &Resident) -> f64 {
    let combat = r.skills.get(&SkillName::Combat).copied().unwrap_or(0.0);
    1.0 + COMBAT_SKILL_LIMIT.min(combat * COMBAT_SKILL_EFFECT)
}

/// Damage a blow from `attacker` does to `defender` when it lands (`blowDamage`).
pub fn blow_damage(attacker: &Resident, defender: &Resident, tick: f64) -> f64 {
    MIN_BLOW_DAMAGE.max(attack_power(attacker, tick) - protection(defender))
}

/// Chance a resident dodges a blow at `tick`, from their Agility (`dodgeChance`).
pub fn dodge_chance(r: &Resident, tick: f64) -> f64 {
    DODGE_LIMIT.min(stat_value(r, StatName::Agility, tick) * DODGE_PER_AGILITY)
}

/// Combat skill a resident learns from one blow they strike or that is struck at them
/// (`combatLearned`), faster with more Intellect.
pub fn combat_learned(r: &Resident, tick: f64) -> f64 {
    COMBAT_SKILL_PER_BLOW * (stat_value(r, StatName::Intellect, tick) / INTELLECT_AVERAGE)
}

/// The Bow or Crossbow a resident has equipped, if any, Arrows or not (`CONTEXT.md`: Ranged
/// combat): its name in the `SHOT_*` tables.
pub fn ranged_weapon(r: &Resident) -> Option<&'static str> {
    let w = good_name(equipped(r, Slot::Weapon)?);
    SHOT_REACH.get(w).is_some().then_some(w)
}

/// The Bow or Crossbow a resident shoots with: one equipped, and an Arrow carried to loose
/// (`CONTEXT.md`: Ranged combat). Out of Arrows they fight with their fists.
pub fn shooting_weapon(r: &Resident) -> Option<&'static str> {
    ranged_weapon(r).filter(|_| held(&r.carried, Good::Arrows) > 0.0)
}

/// How far, in tiles, a resident's equipped Bow or Crossbow shoots from where they stand: its
/// `SHOT_REACH`, further from up high (`height_reach_bonus`); None without one.
pub fn shot_reach(world: &WorldState, r: &Resident) -> Option<f64> {
    ranged_weapon(r)
        .and_then(|w| SHOT_REACH.get(w))
        .map(|reach| reach + height_reach_bonus(world, r))
}

/// The reach an archer gets from where they stand above the ground (`CONTEXT.md`: Ranged combat,
/// Walls in combat, Tower): up on a tower `TOWER_SHOT_REACH_BONUS`, up on a wall walk
/// `WALL_SHOT_REACH_BONUS`, on the ground none.
pub fn height_reach_bonus(world: &WorldState, r: &Resident) -> f64 {
    if up_on_tower(world, r) {
        TOWER_SHOT_REACH_BONUS
    } else if is_up(world, r) {
        WALL_SHOT_REACH_BONUS
    } else {
        0.0
    }
}

/// How far, in tiles, a resident strikes from at all (`CONTEXT.md`: Combat, Ranged combat): their
/// weapon's reach from where they stand with a Bow or Crossbow equipped, else contact (1). What
/// `shots-within-reach` holds every blow and shot to.
pub fn strike_reach(world: &WorldState, r: &Resident) -> f64 {
    shot_reach(world, r).unwrap_or(1.0).max(1.0)
}

/// Tiles between two spots as reach counts them: the larger of the two steps, the short way round
/// the map of `size` tiles, so the eight tiles around one are 1 away (contact).
pub fn tiles_apart(size: i32, a: (i32, i32), b: (i32, i32)) -> f64 {
    f64::from(wrap_delta(a.0, b.0, size).abs().max(wrap_delta(a.1, b.1, size).abs()))
}

/// Ticks between two of a resident's attacks: a shot's `SHOT_TICKS` while they shoot, else a
/// blow's `STRIKE_TICKS`.
pub fn attack_ticks(r: &Resident) -> f64 {
    shooting_weapon(r).and_then(|w| SHOT_TICKS.get(w)).unwrap_or(STRIKE_TICKS)
}

/// What a resident's Combat skill multiplies each shot by: 1 unskilled, up to `1 +
/// SHOT_SKILL_LIMIT` of their weapon at the skill a blow is at its hardest.
pub fn shot_skill_factor(r: &Resident, weapon: &str) -> f64 {
    let share = (combat_skill_factor(r) - 1.0) / COMBAT_SKILL_LIMIT;
    1.0 + SHOT_SKILL_LIMIT.get(weapon).unwrap_or(0.0) * share
}

/// Damage a shot from `attacker`'s `weapon` does to `defender` when it lands (`CONTEXT.md`: Ranged
/// combat): its `SHOT_DAMAGE` raised by Combat skill, less the defender's shield and armour but for
/// the share a Crossbow goes through, at least `MIN_BLOW_DAMAGE`.
pub fn shot_damage(attacker: &Resident, defender: &Resident, weapon: &str) -> f64 {
    let power = SHOT_DAMAGE.get(weapon).unwrap_or(0.0) * shot_skill_factor(attacker, weapon);
    let kept_off = protection(defender) * (1.0 - SHOT_PIERCE.get(weapon).unwrap_or(0.0));
    MIN_BLOW_DAMAGE.max(power - kept_off)
}

/// A resident's shot reach as scripts see it (`reach`): tiles their Bow or Crossbow shoots from
/// where they stand, null without one (`CONTEXT.md`: Ranged combat). Anyone who sees them sees
/// their weapon, so its reach too.
pub fn reach_json(world: &WorldState, r: &Resident) -> serde_json::Value {
    shot_reach(world, r).map_or(serde_json::Value::Null, |reach| serde_json::json!(reach))
}
