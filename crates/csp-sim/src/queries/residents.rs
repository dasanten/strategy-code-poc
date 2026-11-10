//! The helpers of `packages/shared/src/balance.ts` and `world.ts` that take a world type: age,
//! stats, Hunger, weapons, weights, Down, horse stats.

use csp_shared::balance::{
    ADULT_AGE, AGILITY_AVERAGE, AGILITY_LIMIT, AGILITY_SPEED_EFFECT, AGILITY_TERRAIN_EFFECT,
    CARRIAGE_CAPACITY, CARRY_BASE, CARRY_PER_STRENGTH, CHILD_YEAR_DAYS, DECLINE_AGE, DECLINE_FLOOR,
    DECLINE_PER_YEAR, ENDURANCE_TERRAIN_EFFECT, GOOD_WEIGHT, HORSE_STAT_AVERAGE,
    HORSE_STRENGTH_EFFECT, HORSE_STRENGTH_LIMIT, HUNGER_ENDURANCE_AVERAGE, HUNGER_ENDURANCE_EFFECT,
    HUNGER_ENDURANCE_LIMIT, TERRAIN_FOOD, TERRAIN_SPEED, WALK_TICKS_PER_TILE, WEAPON_ATTACK,
};
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{Good, Horse, HorseStats, Resident, StatName, Stock};

use super::names::{good_name, good_of, held};

const CHILDHOOD_TICKS: f64 = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;

/// A resident's age in game years at `tick` (`ageInYears`): each year up to `ADULT_AGE` takes
/// `CHILD_YEAR_DAYS`, later years a full game year.
pub fn age_in_years(born_at: f64, tick: f64) -> f64 {
    let lived = tick - born_at;
    if lived <= CHILDHOOD_TICKS {
        return lived / (CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY);
    }
    ADULT_AGE + (lived - CHILDHOOD_TICKS) / TICKS_PER_GAME_YEAR
}

/// Whether a resident is grown up (`canWork`, `CONTEXT.md`: Child).
pub fn can_work(born_at: f64, tick: f64) -> bool {
    age_in_years(born_at, tick) >= ADULT_AGE
}

/// What old age leaves of a resident's stats (`ageFactor`).
pub fn age_factor(r: &Resident, tick: f64) -> f64 {
    let past = age_in_years(r.born_at, tick).floor() - DECLINE_AGE;
    if past <= 0.0 {
        return 1.0;
    }
    DECLINE_FLOOR.max(1.0 - past * DECLINE_PER_YEAR)
}

/// A stat as it counts at `tick` (`statValue`): base and trained bonus, less old age's decline.
pub fn stat_value(r: &Resident, stat: StatName, tick: f64) -> f64 {
    let s = match stat {
        StatName::Strength => &r.stats.strength,
        StatName::Endurance => &r.stats.endurance,
        StatName::Agility => &r.stats.agility,
        StatName::Intellect => &r.stats.intellect,
    };
    (s.base + s.trained) * age_factor(r, tick)
}

/// How much of `FOOD_PER_DAY` a resident eats, from their Endurance (`hungerFactor`).
pub fn hunger_factor(r: &Resident, tick: f64) -> f64 {
    let away = stat_value(r, StatName::Endurance, tick) - HUNGER_ENDURANCE_AVERAGE;
    let change =
        (-HUNGER_ENDURANCE_LIMIT).max(HUNGER_ENDURANCE_LIMIT.min(away * HUNGER_ENDURANCE_EFFECT));
    1.0 - change
}

/// The strongest weapon a resident carries (`bestWeapon`), the first in `WEAPON_ATTACK`'s order
/// on a tie.
pub fn best_weapon(carried: &Stock) -> Option<Good> {
    let mut armed: Vec<(Good, f64)> = WEAPON_ATTACK
        .0
        .iter()
        .filter_map(|(w, attack)| good_of(w).map(|g| (g, *attack)))
        .filter(|(g, _)| held(carried, *g) > 0.0)
        .collect();
    armed.sort_by(|a, b| b.1.total_cmp(&a.1));
    armed.first().map(|(g, _)| *g)
}

/// Whether a resident is armed: carries a weapon (`isArmed`, `CONTEXT.md`: Soldier).
pub fn is_armed(carried: &Stock) -> bool {
    best_weapon(carried).is_some()
}

/// What a stock weighs, in kg (`stockWeight`).
pub fn stock_weight(stock: &Stock) -> f64 {
    stock.iter().fold(0.0, |kg, (g, units)| kg + units * good_weight(*g))
}

/// What one unit of a good weighs, in kg (`GOOD_WEIGHT[good]`).
pub fn good_weight(g: Good) -> f64 {
    GOOD_WEIGHT.get(good_name(g)).expect("every good has a weight")
}

/// Whether a resident or horse lies Down (`isDown`): `downUntil` set, or seen as `down`.
pub fn is_down(down_until: Option<f64>) -> bool {
    down_until.is_some()
}

fn horse_stat_share(stat: f64, effect: f64, limit: f64) -> f64 {
    (-limit).max(limit.min((stat - HORSE_STAT_AVERAGE) * effect))
}

/// How much more than an average horse a horse pulls, from its Strength (`horseStrengthFactor`).
pub fn horse_strength_factor(stats: &HorseStats) -> f64 {
    1.0 + horse_stat_share(stats.strength, HORSE_STRENGTH_EFFECT, HORSE_STRENGTH_LIMIT)
}

/// A horse's age in game years at `tick` (`horseAgeInYears`).
pub fn horse_age_in_years(horse: &Horse, tick: f64) -> f64 {
    (tick - horse.born_at) / TICKS_PER_GAME_YEAR
}

/// Most weight a carriage holds behind `horse`, or without one (`carriageCapacityWith`).
pub fn carriage_capacity_with(horse: Option<&Horse>) -> f64 {
    horse.map_or(CARRIAGE_CAPACITY, |h| CARRIAGE_CAPACITY * horse_strength_factor(&h.stats))
}

/// The most weight a resident can carry at `tick`, in kg (`carryCapacity`, `CONTEXT.md`: Carry
/// capacity).
pub fn carry_capacity(r: &Resident, tick: f64) -> f64 {
    CARRY_BASE + CARRY_PER_STRENGTH * stat_value(r, StatName::Strength, tick)
}

/// How much of the usual food a resident needs on a tile of `terrain` at `tick` (`foodUse`,
/// `CONTEXT.md`: Terrain, Hunger): their `hunger_factor`, times the terrain's extra food use
/// softened by Endurance (by up to `HUNGER_ENDURANCE_LIMIT` of it, either way).
pub fn food_use(r: &Resident, terrain: u8, tick: f64) -> f64 {
    let extra = TERRAIN_FOOD.get(terrain).unwrap_or(1.0) - 1.0;
    let away = stat_value(r, StatName::Endurance, tick) - HUNGER_ENDURANCE_AVERAGE;
    let soften =
        (-HUNGER_ENDURANCE_LIMIT).max(HUNGER_ENDURANCE_LIMIT.min(away * ENDURANCE_TERRAIN_EFFECT));
    hunger_factor(r, tick) * (1.0 + extra * (1.0 - soften))
}

/// How many tiles per tick a resident walks onto a tile of `terrain` (`walkSpeed`, `CONTEXT.md`:
/// Terrain, Stats): plains speed from Agility at `tick`, and the terrain's slowdown softened by
/// Agility. A road's speed-up comes on top, as it is. Zero for terrain nobody can enter.
pub fn walk_speed(r: &Resident, terrain: u8, tick: f64) -> f64 {
    let base = match TERRAIN_SPEED.get(terrain) {
        Some(b) if b != 0.0 => b,
        _ => return 0.0,
    };
    let away = stat_value(r, StatName::Agility, tick) - AGILITY_AVERAGE;
    let clamp = |v: f64| (-AGILITY_LIMIT).max(AGILITY_LIMIT.min(v));
    let pace = 1.0 + clamp(away * AGILITY_SPEED_EFFECT);
    let slowdown = (1.0 - base).max(0.0) * (1.0 - clamp(away * AGILITY_TERRAIN_EFFECT));
    let speed_up = (base - 1.0).max(0.0);
    (pace * (1.0 - slowdown + speed_up)) / WALK_TICKS_PER_TILE
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::balance::ticks_for_age;

    #[test]
    fn ages_children_ten_game_days_a_year() {
        assert_eq!(age_in_years(0.0, CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY), 1.0);
        for age in [3.0, ADULT_AGE, 30.0] {
            assert!((age_in_years(0.0, ticks_for_age(age)) - age).abs() < 1e-9);
        }
        assert!(!can_work(0.0, ticks_for_age(ADULT_AGE) - 1.0));
        assert!(can_work(0.0, ticks_for_age(ADULT_AGE)));
    }

    #[test]
    fn the_sword_beats_the_spear() {
        let mut carried = Stock::new();
        assert_eq!(best_weapon(&carried), None);
        carried.insert(Good::Spear, 1.0);
        carried.insert(Good::Sword, 1.0);
        assert_eq!(best_weapon(&carried), Some(Good::Sword));
        carried.insert(Good::Sword, 0.0);
        assert!(is_armed(&carried));
    }
}
