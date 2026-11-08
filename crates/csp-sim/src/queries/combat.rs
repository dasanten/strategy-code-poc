//! Combat queries (`CONTEXT.md`: Combat, Weapons and armour): the contact test of
//! `packages/shared/src/combat.ts` and the blow helpers of `balance.ts`.

use csp_shared::balance::{
    BLOW_BASE, BLOW_PER_STRENGTH, COMBAT_SKILL_EFFECT, COMBAT_SKILL_LIMIT, COMBAT_SKILL_PER_BLOW,
    DODGE_LIMIT, DODGE_PER_AGILITY, INTELLECT_AVERAGE, MIN_BLOW_DAMAGE, PROTECTION_DEFENCE,
    WEAPON_ATTACK,
};
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{Resident, SkillName, StatName};

use super::names::{good_name, good_of, held};
use super::residents::{best_weapon, stat_value};

/// Whether two spots are in contact (`inContact`): on the same tile or one of the eight around
/// it, the short way round the map of `size` tiles.
pub fn in_contact(size: i32, a: (i32, i32), b: (i32, i32)) -> bool {
    wrap_delta(a.0, b.0, size).abs() <= 1 && wrap_delta(a.1, b.1, size).abs() <= 1
}

/// Damage a resident's protection takes off each blow (`protection`): a shield and armour, if
/// they carry them, one of each counting.
pub fn protection(r: &Resident) -> f64 {
    PROTECTION_DEFENCE
        .0
        .iter()
        .filter(|(p, _)| good_of(p).is_some_and(|g| held(&r.carried, g) > 0.0))
        .fold(0.0, |sum, (_, d)| sum + d)
}

/// How hard a resident strikes at `tick` (`attackPower`): from Strength and the best weapon they
/// carry, harder with Combat skill.
pub fn attack_power(r: &Resident, tick: f64) -> f64 {
    let weapon =
        best_weapon(&r.carried).and_then(|w| WEAPON_ATTACK.get(good_name(w))).unwrap_or(0.0);
    let raw = BLOW_BASE + BLOW_PER_STRENGTH * stat_value(r, StatName::Strength, tick) + weapon;
    let combat = r.skills.get(&SkillName::Combat).copied().unwrap_or(0.0);
    let skill = COMBAT_SKILL_LIMIT.min(combat * COMBAT_SKILL_EFFECT);
    raw * (1.0 + skill)
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
