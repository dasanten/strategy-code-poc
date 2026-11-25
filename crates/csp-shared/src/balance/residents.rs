//! Residents: stats, age and lifespan.

use crate::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};

balance! {
/// A resident's base stats are drawn from this range when no parents pass theirs on.
pub const STAT_BASE_MIN: f64 = 5.0;

pub const STAT_BASE_MAX: f64 = 15.0;

/// Training can add at most this share of a stat's base value (`CONTEXT.md`: Trained bonus).
pub const TRAINED_CAP_SHARE: f64 = 0.5;

/// Most health a resident can have.
pub const MAX_HEALTH: f64 = 100.0;

/// A full hunger meter.
pub const MAX_HUNGER: f64 = 100.0;

/// Placeholder residents (until starting cities, T2.2) are this many game years old.
pub const START_AGE_MIN: f64 = 16.0;

pub const START_AGE_MAX: f64 = 45.0;

/// A new resident's lifespan, the age in game years they die of old age, lies in this range.
pub const LIFESPAN_MIN: f64 = 55.0;

pub const LIFESPAN_MAX: f64 = 65.0;

/// Children are grown at this age in game years (`CONTEXT.md`: Aging, Child): from then on they
/// can work, build, tear down and pair.
pub const ADULT_AGE: f64 = 14.0;

/// Game days each year of age up to `ADULT_AGE` takes: children age faster, so a newborn is grown
/// after 56 game days (~22 real hours; Epic 113). Later years take a full game year (`CONTEXT.md`:
/// Aging).
pub const CHILD_YEAR_DAYS: f64 = 4.0;

/// The goods a child may pick up, put down, Fetch and Store: their meals (`CONTEXT.md`: Child).
pub const CHILD_GOODS: &[&str] = &["food"];

/// Stats start to decline at this age in game years (`CONTEXT.md`: Aging).
pub const DECLINE_AGE: f64 = 45.0;

/// Share of a stat's effective value lost for each full game year past `DECLINE_AGE`.
pub const DECLINE_PER_YEAR: f64 = 0.02;

/// However old a resident gets, their stats keep at least this share of their effective value.
pub const DECLINE_FLOOR: f64 = 0.6;
}

/// Ticks from birth until a resident is grown up.
///
/// Not exported: the client has no use for it.
const CHILDHOOD_TICKS: f64 = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;

/// The ticks a resident has lived at an age in game years: the inverse of `ageInYears`.
pub fn ticks_for_age(age: f64) -> f64 {
    if age <= ADULT_AGE {
        return age * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    }
    CHILDHOOD_TICKS + (age - ADULT_AGE) * TICKS_PER_GAME_YEAR
}

/// The most a stat's trained bonus can be, for a given base value.
pub fn trained_cap(base: f64) -> f64 {
    (base * TRAINED_CAP_SHARE).floor()
}
