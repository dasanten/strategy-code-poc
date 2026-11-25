//! Boats and ships. The numbers of a kind of vessel are in its spec (`craft_specs.rs`).

use super::craft_specs::{BOAT, SHIP};

balance! {
/// Most weight a boat carries, in kg (`CONTEXT.md`: Boat).
pub const BOAT_CAPACITY: f64 = BOAT.capacity;

/// Most weight a ship carries, in kg (`CONTEXT.md`: Ship).
pub const SHIP_CAPACITY: f64 = SHIP.capacity;

/// The fewest crew aboard a ship for it to sail (`CONTEXT.md`: Crew, Sailing).
pub const SHIP_MIN_CREW: f64 = SHIP.min_crew;

/// How fast a ship sails with an unskilled crew, as a share of walking on Plains (`CONTEXT.md`:
/// Sailing).
pub const SAIL_SPEED: f64 = SHIP.speed;

/// How fast an average rower moves a boat over water, as a share of walking on Plains
/// (`CONTEXT.md`: Rowing).
pub const ROW_SPEED: f64 = BOAT.speed;

/// How much faster a boat goes for each point of its rower's Strength above
/// `ROW_STRENGTH_AVERAGE`, and slower below it (`CONTEXT.md`: Seafaring: a stronger rower goes
/// faster).
pub const ROW_STRENGTH_EFFECT: f64 = 0.03;

/// The Strength at which a rower moves a boat at `ROW_SPEED`.
pub const ROW_STRENGTH_AVERAGE: f64 = 10.0;

/// The furthest Strength speeds a boat up or slows it down, as a share of its speed.
pub const ROW_STRENGTH_LIMIT: f64 = 0.3;

/// How much faster a boat goes for each point of its rower's Seafaring skill.
pub const SEAFARING_SKILL_EFFECT: f64 = 0.02;

/// The furthest Seafaring speeds a boat up, as a share of its speed: a master rower, half as fast
/// again, as a master driver.
pub const SEAFARING_SKILL_LIMIT: f64 = 0.5;

/// Seafaring a rower of average Intellect gains per game day of rowing, as Driving.
pub const SEAFARING_SKILL_PER_DAY: f64 = 1.0;
}
