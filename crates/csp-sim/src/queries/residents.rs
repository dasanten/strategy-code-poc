//! The helpers of `packages/shared/src/balance.ts` and `world.ts` that take a world type: age,
//! stats, Hunger, weapons, weights, Down, horse stats.

use csp_shared::balance::{
    ADULT_AGE, CARRIAGE_CAPACITY, CHILD_YEAR_DAYS, DECLINE_AGE, DECLINE_FLOOR, DECLINE_PER_YEAR,
    GOOD_WEIGHT, HORSE_STAT_AVERAGE, HORSE_STRENGTH_EFFECT, HORSE_STRENGTH_LIMIT,
    HUNGER_ENDURANCE_AVERAGE, HUNGER_ENDURANCE_EFFECT, HUNGER_ENDURANCE_LIMIT, WEAPON_ATTACK,
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
