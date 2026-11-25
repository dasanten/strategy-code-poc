//! Zeal and rallying.

use crate::time::TICKS_PER_GAME_HOUR;

balance! {
/// How much Zeal a Player's pool holds when full, in game hours of rallying (`CONTEXT.md`: Zeal):
/// two game days, 48 real minutes of a rallied crew.
pub const ZEAL_CAP_HOURS: f64 = 48.0;

/// Ticks a Player's Zeal takes to fill from empty to full (`CONTEXT.md`: Zeal): two real hours, so
/// a Player who comes back a few times a day finds it full, and nobody is punished for sleeping.
pub const ZEAL_FILL_TICKS: f64 = 2.0 * 60.0 * 60.0;

/// What a rallied crew's work is multiplied by (`CONTEXT.md`: Rallying the crew): with skill,
/// Strength and Tools, never instead of them.
pub const RALLY_PACE: f64 = 3.0;
}

/// The Zeal a pool gains in a tick while it is not full (`ZEAL_CAP_HOURS` over `ZEAL_FILL_TICKS`).
///
/// Not exported: the client has no use for it.
pub const ZEAL_PER_TICK: f64 = ZEAL_CAP_HOURS / ZEAL_FILL_TICKS;

/// The Zeal a Player spends in a tick their crew is rallied: a game hour of rallying per game hour.
///
/// Not exported: the client has no use for it.
pub const ZEAL_PER_RALLIED_TICK: f64 = 1.0 / TICKS_PER_GAME_HOUR;
