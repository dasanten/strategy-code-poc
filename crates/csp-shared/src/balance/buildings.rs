//! Buildings: materials, work and construction skill.

use super::*;
use crate::time::TICKS_PER_GAME_DAY;

balance! {
/// Materials each kind of building needs before its construction site can become the building
/// (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
/// the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
/// the smelter's iron goes into the mint and the smithy.
pub const BUILD_MATERIALS: Table<Table<f64>> = Table(&[
    ("lumberCamp", Table(&[])),
    ("quarry", Table(&[("wood", 30.0)])),
    ("mine", Table(&[("wood", 40.0), ("stone", 20.0)])),
    ("stable", Table(&[("wood", 40.0)])),
    ("smelter", Table(&[("stone", 40.0), ("wood", 20.0)])),
    ("mint", Table(&[("stone", 40.0), ("iron", 10.0)])),
    ("smithy", Table(&[("stone", 30.0), ("wood", 20.0), ("iron", 10.0)])),
    ("townHall", Table(&[("wood", 60.0), ("stone", 40.0)])),
    // A tile of wall: about a quarter of what a 40 m stretch took.
    ("wall", Table(&[("wood", 3.0)])),
    // A tower (`CONTEXT.md`: Tower): a 2×2 timber keep with room on top, about seven tiles of wall.
    ("tower", Table(&[("wood", 20.0)])),
    // A gate, of a wall's tile.
    ("gate", Table(&[("wood", 4.0)])),
    // A tile of road (`CONTEXT.md`: Road): a little Stone, so a quarry pays for a long road; about a
    // quarter of what a 40 m tile took.
    ("road", Table(&[("stone", 1.0)])),
    // A house (`CONTEXT.md`: House): timber for four residents' room.
    ("house", Table(&[("wood", 20.0)])),
    // A storage (`CONTEXT.md`: Storage): a timber store on a stone floor, a little more than a house.
    ("storage", Table(&[("wood", 30.0), ("stone", 10.0)])),
    // A farm is fields on Plains: work, but no materials, so a city can always feed itself.
    ("farm", Table(&[])),
    // A training ground (`CONTEXT.md`: Training ground): a fenced yard with posts and racks on a
    // few paving stones, so mostly Wood and a little Stone, no iron; a bit more timber than a
    // stable, and buildable before any smelter.
    ("trainingGround", Table(&[("wood", 50.0), ("stone", 10.0)])),
    // A haven (`CONTEXT.md`: Haven): timber jetties and slipways on stone footings at the shore, so
    // mostly Wood and some Stone; a little more timber than a town hall, which covers as much.
    ("haven", Table(&[("wood", 70.0), ("stone", 20.0)])),
    // A carriage, built at a stable (`CONTEXT.md`: Carriage): a wooden cart with iron fittings, so a
    // realm needs a smelter's iron for its second carriage.
    ("carriage", Table(&[("wood", 30.0), ("iron", 5.0)])),
    // A boat, built at a haven (`CONTEXT.md`: Building a boat): planks, a thwart and oars, pegged
    // rather than nailed, so all Wood and buildable before any smelter; two thirds of a carriage's
    // timber.
    ("boat", Table(&[("wood", 20.0)])),
    // A ship, built at a haven on the Sea (`CONTEXT.md`: Building a ship): a hull, a mast and
    // rigging, iron-fastened, so Wood and some Iron; six boats' timber.
    ("ship", Table(&[("wood", 120.0), ("iron", 15.0)])),
    // A ram (`CONTEXT.md`: Siege machine, Ram): a roofed frame on wheels round a heavy beam with an
    // iron head, so a little more timber than a carriage and as much Iron; built in the field.
    ("ram", Table(&[("wood", 40.0), ("iron", 5.0)])),
    // A catapult (`CONTEXT.md`: Siege machine, Catapult): a timber frame and throwing arm on wheels,
    // iron-bound, weighted with Stone for its counterweight; a little less timber than a ram.
    ("catapult", Table(&[("wood", 30.0), ("iron", 5.0), ("stone", 10.0)])),
]);

/// Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
/// lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
/// a mint 5, a smithy 5, a town hall 6, a training ground 3 (about a stable), a haven 4. A tile of wooden
/// wall takes a sixteenth of a game day, a gate an eighth, a tile of road a sixteenth (a quarter of
/// what a 40 m tile took), a house one game day, a storage two and a farm half of one; a carriage
/// two, a boat one, a ship ten, a ram two, a catapult two. More or stronger workers finish it
/// sooner (`buildWork`).
pub const BUILD_WORK: Table<f64> = Table(&[
    ("lumberCamp", 2.0 * TICKS_PER_GAME_DAY),
    ("quarry", 3.0 * TICKS_PER_GAME_DAY),
    ("mine", 4.0 * TICKS_PER_GAME_DAY),
    ("stable", 3.0 * TICKS_PER_GAME_DAY),
    ("smelter", 4.0 * TICKS_PER_GAME_DAY),
    ("mint", 5.0 * TICKS_PER_GAME_DAY),
    ("smithy", 5.0 * TICKS_PER_GAME_DAY),
    ("townHall", 6.0 * TICKS_PER_GAME_DAY),
    ("wall", TICKS_PER_GAME_DAY / 16.0),
    ("tower", TICKS_PER_GAME_DAY / 2.0),
    ("gate", TICKS_PER_GAME_DAY / 8.0),
    ("road", TICKS_PER_GAME_DAY / 16.0),
    ("house", TICKS_PER_GAME_DAY),
    ("storage", 2.0 * TICKS_PER_GAME_DAY),
    ("farm", TICKS_PER_GAME_DAY / 2.0),
    ("trainingGround", 3.0 * TICKS_PER_GAME_DAY),
    ("haven", 4.0 * TICKS_PER_GAME_DAY),
    ("carriage", 2.0 * TICKS_PER_GAME_DAY),
    ("boat", TICKS_PER_GAME_DAY),
    ("ship", 10.0 * TICKS_PER_GAME_DAY),
    ("ram", 2.0 * TICKS_PER_GAME_DAY),
    ("catapult", 2.0 * TICKS_PER_GAME_DAY),
]);

/// What a stone wall or gate takes instead of `BUILD_MATERIALS` (`CONTEXT.md`: Wall / Gate, Wood
/// or stone): Stone, a little more of it than a wooden one takes Wood, so a quarry pays for a
/// stone ring.
pub const STONE_BUILD_MATERIALS: Table<Table<f64>> = Table(&[
    ("wall", Table(&[("stone", 4.0)])),
    ("gate", Table(&[("stone", 6.0)])),
    ("tower", Table(&[("stone", 28.0)])),
]);

/// Work a stone wall or gate takes instead of `BUILD_WORK`: three times a wooden one's, so a
/// tile of stone wall takes an unskilled resident about a fifth of a game day.
pub const STONE_BUILD_WORK: Table<f64> = Table(&[
    ("wall", 3.0 * TICKS_PER_GAME_DAY / 16.0),
    ("gate", 3.0 * TICKS_PER_GAME_DAY / 8.0),
    ("tower", 3.0 * TICKS_PER_GAME_DAY / 2.0),
]);

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
