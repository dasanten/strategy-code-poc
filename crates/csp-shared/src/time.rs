//! Game time (`CONTEXT.md`: Game time, Tick): one tick is one real second and one game minute.
//! Ported from `packages/shared/src/time.ts` and the tick constants of `world.ts`.
//!
//! The tick constants are `f64`: balance numbers multiply and divide them with other `f64`
//! constants, as TypeScript does, and they are whole numbers well below 2^53.

/// One game day is 24 real minutes: a real second is a game minute (`CONTEXT.md`: Game time).
pub const TICKS_PER_GAME_DAY: f64 = 1440.0;

/// One game year is 420 game days, one real week.
pub const TICKS_PER_GAME_YEAR: f64 = 420.0 * TICKS_PER_GAME_DAY;

/// Game days in a game year (`CONTEXT.md`: Game time).
pub const GAME_DAYS_PER_YEAR: f64 = TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY;

/// Ticks in one game hour: a game day has 24 hours like a real one.
pub const TICKS_PER_GAME_HOUR: f64 = TICKS_PER_GAME_DAY / 24.0;

/// A moment of game time. Year and day count from 1, like a calendar; hour and minute from 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameTime {
    pub year: u64,
    /// Day within the year, 1 to `GAME_DAYS_PER_YEAR`.
    pub day: u64,
    pub hour: u64,
    pub minute: u64,
}

/// The game time at a tick: one tick is one real second (`CONTEXT.md`: Game time, Tick).
pub fn game_time(tick: f64) -> GameTime {
    let t = tick.floor().max(0.0);
    let days = (t / TICKS_PER_GAME_DAY).floor();
    let in_day = t - days * TICKS_PER_GAME_DAY;
    let minutes = ((in_day / TICKS_PER_GAME_HOUR) * 60.0).floor();
    GameTime {
        year: ((days / GAME_DAYS_PER_YEAR).floor() + 1.0) as u64,
        day: ((days % GAME_DAYS_PER_YEAR) + 1.0) as u64,
        hour: (minutes / 60.0).floor() as u64,
        minute: (minutes % 60.0) as u64,
    }
}

/// Game time as the top bar shows it: "Year 1 · Day 3 · 14:20".
pub fn format_game_time(tick: f64) -> String {
    let GameTime { year, day, hour, minute } = game_time(tick);
    format!("Year {year} · Day {day} · {hour:02}:{minute:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: f64 = TICKS_PER_GAME_DAY;
    const YEAR: f64 = TICKS_PER_GAME_YEAR;
    const HOUR: f64 = TICKS_PER_GAME_HOUR;

    fn at(year: u64, day: u64, hour: u64, minute: u64) -> GameTime {
        GameTime { year, day, hour, minute }
    }

    #[test]
    fn runs_1_game_minute_per_real_second_1_game_day_per_24_real_minutes_420_game_days_a_year() {
        assert_eq!(TICKS_PER_GAME_DAY, 24.0 * 60.0);
        assert_eq!(TICKS_PER_GAME_YEAR, 7.0 * 24.0 * 60.0 * 60.0);
        assert_eq!(GAME_DAYS_PER_YEAR, 420.0);
        assert_eq!(TICKS_PER_GAME_HOUR, 60.0);
    }

    #[test]
    fn starts_at_year_1_day_1_midnight() {
        assert_eq!(game_time(0.0), at(1, 1, 0, 0));
    }

    #[test]
    fn counts_hours_and_minutes_within_a_day() {
        assert_eq!(game_time(HOUR), at(1, 1, 1, 0));
        // Half a game day is noon; a game minute is a real second.
        assert_eq!(game_time(DAY / 2.0 + 5.0), at(1, 1, 12, 5));
        assert_eq!(game_time(DAY - 1.0), at(1, 1, 23, 59));
    }

    #[test]
    fn rolls_over_into_the_next_day_and_the_next_year() {
        assert_eq!(game_time(DAY), at(1, 2, 0, 0));
        let last = game_time(YEAR - 1.0);
        assert_eq!((last.year, last.day, last.hour), (1, 420, 23));
        assert_eq!(game_time(YEAR), at(2, 1, 0, 0));
        let later = game_time(10.0 * YEAR + 3.0 * DAY);
        assert_eq!((later.year, later.day), (11, 4));
    }

    #[test]
    fn formats_for_the_top_bar() {
        assert_eq!(format_game_time(0.0), "Year 1 · Day 1 · 00:00");
        assert_eq!(format_game_time(2.0 * DAY + 14.0 * HOUR + 50.0), "Year 1 · Day 3 · 14:50");
    }
}
