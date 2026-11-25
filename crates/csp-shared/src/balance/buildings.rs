//! Buildings: materials, work and construction skill.

use super::*;
use crate::building_spec::{opt, spec_table};

balance! {
/// Materials each kind of building needs before its construction site can become the building
/// (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
/// the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
/// the smelter's iron goes into the mint and the smithy.
pub const BUILD_MATERIALS: Table<Table<f64>> =
    spec_table!(Table<f64>, |s| opt!(s.build, b => Some(b.materials)));

/// Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
/// lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
/// a mint 5, a smithy 5, a town hall 6, a training ground 3 (about a stable), a haven 4. A tile of wooden
/// wall takes a sixteenth of a game day, a gate an eighth, a tile of road a sixteenth (a quarter of
/// what a 40 m tile took), a house one game day, a storage two and a farm half of one; a carriage
/// two, a boat one, a ship ten, a ram two, a catapult two. More or stronger workers finish it
/// sooner (`buildWork`).
pub const BUILD_WORK: Table<f64> = spec_table!(f64, |s| opt!(s.build, b => Some(b.work)));

/// What a stone wall or gate takes instead of `BUILD_MATERIALS` (`CONTEXT.md`: Wall / Gate, Wood
/// or stone): Stone, a little more of it than a wooden one takes Wood, so a quarry pays for a
/// stone ring.
pub const STONE_BUILD_MATERIALS: Table<Table<f64>> =
    spec_table!(Table<f64>, |s| opt!(s.build, b => opt!(b.stone, t => Some(t.materials))));

/// Work a stone wall or gate takes instead of `BUILD_WORK`: three times a wooden one's, so a
/// tile of stone wall takes an unskilled resident about a fifth of a game day.
pub const STONE_BUILD_WORK: Table<f64> =
    spec_table!(f64, |s| opt!(s.build, b => opt!(b.stone, t => Some(t.work))));

/// How many times `BUILD_WORK.road` a road tile on Mountain takes (`CONTEXT.md`: Road): the same
/// materials, but building goes at a quarter of the usual speed.
pub const MOUNTAIN_ROAD_WORK_FACTOR: f64 = 4.0;

/// The most tiles one road order along a line may cover (`roadLine`): about a game week of one
/// resident's work, so a long road is a few orders rather than one that runs for months.
pub const ROAD_LINE_MAX_TILES: f64 = 128.0;

/// The Strength at which a resident puts in one unit of building work per tick.
pub const BUILD_STRENGTH_AVERAGE: f64 = 10.0;

/// How much more work each point of Construction skill puts in per tick: 1 % a point.
pub const CONSTRUCTION_SKILL_EFFECT: f64 = 0.01;

/// The furthest Construction skill speeds building work up, as a share of it: +100 %, reached at
/// `CONSTRUCTION_SKILL_MAX` points, beyond which nobody learns.
pub const CONSTRUCTION_SKILL_LIMIT: f64 = 1.0;

/// The most Construction skill a resident can have: where it reaches `CONSTRUCTION_SKILL_LIMIT`.
pub const CONSTRUCTION_SKILL_MAX: f64 = CONSTRUCTION_SKILL_LIMIT / CONSTRUCTION_SKILL_EFFECT;

/// Construction skill a resident of average Intellect gains per game day of building work: the
/// cap takes about a game year (one real week).
pub const CONSTRUCTION_SKILL_PER_DAY: f64 = 100.0 / 420.0;

/// The Intellect at which a resident learns at the usual pace (`CONTEXT.md`: Stats).
pub const INTELLECT_AVERAGE: f64 = 10.0;
}
