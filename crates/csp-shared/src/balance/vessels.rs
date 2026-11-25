//! Boats and ships.

balance! {
/// Most weight a boat carries, in kg (`CONTEXT.md`: Boat): passengers at `PASSENGER_WEIGHT` and
/// goods together, so three residents and a little cargo, or a single rower's worth of goods eight
/// times over. Its rower doesn't count against it.
pub const BOAT_CAPACITY: f64 = 250.0;

/// Most weight a ship carries, in kg (`CONTEXT.md`: Ship: far more than a carriage): passengers at
/// `PASSENGER_WEIGHT` and goods together, five carriages' worth. Its crew don't count against it.
pub const SHIP_CAPACITY: f64 = 2000.0;

/// The fewest crew aboard a ship for it to sail (`CONTEXT.md`: Crew, Sailing): a captain and three
/// hands to work the sails, so a small realm can man one but it takes a few of its residents.
pub const SHIP_MIN_CREW: f64 = 4.0;

/// How fast a ship sails with an unskilled crew, as a share of walking on Plains (`CONTEXT.md`:
/// Sailing): faster than a boat is rowed, as wind does the work; the crew's Seafaring adds to it as
/// it does to rowing (`SEAFARING_SKILL_EFFECT`, from their average).
pub const SAIL_SPEED: f64 = 1.6;

/// How fast an average rower moves a boat over water, as a share of walking on Plains
/// (`CONTEXT.md`: Rowing): a little quicker than walking round the shore, so crossing pays off.
pub const ROW_SPEED: f64 = 1.2;

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
