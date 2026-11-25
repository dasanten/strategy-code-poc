//! Fighting: blows, shots, walls, towers and siege engines.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallStrength {
    pub wall: f64,
    pub gate: f64,
    /// A whole tower (`CONTEXT.md`: Tower): three tiles of its wall's worth, so it holds out longer.
    pub tower: f64,
}

balance! {
/// Ticks between two blows of a resident in a fight (`CONTEXT.md`: Combat): a blow every two
/// seconds, so a fight between two unarmed residents lasts about a minute.
pub const STRIKE_TICKS: f64 = 2.0;

/// Damage a blow does before Strength, weapon and Combat skill: a little even from the weakest.
pub const BLOW_BASE: f64 = 1.0;

/// Damage each point of Strength adds to a blow: an average resident's fist does 4.
pub const BLOW_PER_STRENGTH: f64 = 0.3;

/// How much harder each point of Combat skill makes a blow, as a share of it.
pub const COMBAT_SKILL_EFFECT: f64 = 0.05;

/// The furthest Combat skill raises a blow, as a share of it: at most twice as hard.
pub const COMBAT_SKILL_LIMIT: f64 = 1.0;

/// The least damage a blow that lands does, however well the one hit is protected.
pub const MIN_BLOW_DAMAGE: f64 = 1.0;

/// What a blow that lands does to a defender standing on their own city's wall, as a share of its
/// damage (`CONTEXT.md`: Walls in combat): a quarter, so a wall's defenders hold out four times
/// as long.
pub const WALL_DEFENCE: f64 = 0.25;

/// Damage a wall or gate takes from blows before it falls (`CONTEXT.md`: Walls in combat,
/// broken). An average unarmed resident (4 a blow, one blow every `STRIKE_TICKS`) breaks a stretch
/// of wall alone in about 25 minutes, one with a Spear in about 12. A gate holds out half as long
/// again. Long enough that a starting city's defenders get from their town hall up onto the wall
/// and beat the breakers first, at twice their numbers too (T105.6).
pub const WALL_STRENGTH: WallStrength = WallStrength { wall: 3000.0, gate: 4500.0, tower: 9000.0 };

/// Damage a stone wall or gate takes before it falls: four times a wooden one's (`CONTEXT.md`:
/// Wall / Gate, Wood or stone), so a Spear breaks a tile of stone wall alone in about 50 minutes.
pub const STONE_WALL_STRENGTH: WallStrength =
    WallStrength { wall: 12000.0, gate: 18000.0, tower: 36000.0 };

/// Share of a broken wall's or gate's materials left on its tile, rounded down to whole units:
/// less than tearing it down leaves (`TEARDOWN_MATERIALS_RETURNED`), as much of it is splintered;
/// enough that a tile of wall leaves a unit of Wood.
pub const BROKEN_MATERIALS_RETURNED: f64 = 0.34;

/// How many residents a tower holds up on top at once (`CONTEXT.md`: Tower: a few): one to each
/// of its four tiles, so a small realm can man one; more wait on the walk or below.
pub const TOWER_ROOM: f64 = 4.0;

/// How far, in tiles, a resident up on a tower sees (`CONTEXT.md`: Tower, Sight): half as far
/// again as `SIGHT_RANGE`, so a tower warns of an army well before it reaches the wall. At most
/// twice `SIGHT_RANGE`, which the sight squares are cut for.
pub const TOWER_SIGHT_RANGE: f64 = 72.0;

/// How much further, in tiles, an archer up on a tower shoots than on the ground
/// (`CONTEXT.md`: Tower, Ranged combat): beyond a wall archer's `WALL_SHOT_REACH_BONUS`.
pub const TOWER_SHOT_REACH_BONUS: f64 = 7.0;

/// The fewest crew on a ram's tile for it to be pushed (`CONTEXT.md`: Siege machine): a few
/// residents, as many as a ship's, so a ram takes a realm's hands from other work.
pub const RAM_CREW: f64 = 4.0;

/// How fast a crewed siege machine is pushed, as a share of a carriage's pace on the same ground
/// (`CONTEXT.md`: Siege machine: slowly, like a carriage with no horse): half of walking on Plains,
/// a crawl in Forest and Hills, a little faster on a road, and onto Mountain only by road.
pub const SIEGE_PUSH_SHARE: f64 = 0.25;

/// Damage a ram takes from blows before it breaks (`CONTEXT.md`: Siege machine): twice a tile of
/// wooden wall, so defenders who come out need a while at it, but less than a stone wall tile.
pub const RAM_STRENGTH: f64 = 6000.0;

/// Ticks between a crewed ram's strikes at the wall, gate or tower next to it (`CONTEXT.md`: Ram):
/// a heavy beam swung back and forth by its crew, slower than a resident's blows.
pub const RAM_STRIKE_TICKS: f64 = 10.0;

/// Damage each strike of a ram does to the wall, gate or tower it is at (`CONTEXT.md`: Ram: many
/// times harder than a blow): it breaks a tile of wooden wall in 20 strikes, a little over three
/// minutes, and one of stone in about thirteen, where a Spear alone takes 12 and 50.
pub const RAM_BLOW: f64 = 150.0;

/// The fewest crew on a catapult's tile for it to be pushed or to shoot (`CONTEXT.md`: Catapult): one
/// fewer than a ram's, a lighter frame to push and an arm to wind and load.
pub const CATAPULT_CREW: f64 = 3.0;

/// Damage a catapult takes from blows before it breaks (`CONTEXT.md`: Siege machine): a tile of
/// wooden wall's, half a ram's, having no roof of planks over it.
pub const CATAPULT_STRENGTH: f64 = 3000.0;

/// How far a catapult throws, in tiles (`CONTEXT.md`: Catapult: beyond a bow's from a wall): a Bow
/// reaches 8, 12 from up on a wall, so a catapult shoots from well out of any archer's reach.
pub const CATAPULT_REACH: f64 = 20.0;

/// Ticks between a crewed catapult's shots (`CONTEXT.md`: Catapult): its arm wound down and a
/// Stone loaded each time, six times a ram's strikes, so it does less to a wall a minute than a
/// ram at it.
pub const CATAPULT_SHOT_TICKS: f64 = 60.0;

/// Damage each Stone a catapult throws does to the wall, gate or tower it hits (`CONTEXT.md`:
/// Catapult): a tile of wooden wall falls to 5 in five minutes, one of stone to 20 in twenty,
/// slower than a ram at the wall but from out of reach.
pub const CATAPULT_BLOW: f64 = 600.0;

/// Ticks it takes to climb over a wall or gate (`CONTEXT.md`: Walls in combat, climbed): six
/// minutes, all the while unable to dodge or strike back, so a starting city's defenders get up
/// onto its wall and strike the climbers down before they are over (T105.6).
pub const CLIMB_TICKS: f64 = 360.0;

/// Ticks it takes to get up onto a wall walk from the ground next to the wall, and as long again to
/// get down (`CONTEXT.md`: Wall walk): twenty seconds, as long as walking about three tiles of
/// plains, so nobody goes up on the way somewhere else.
pub const WALL_WALK_TICKS: f64 = 20.0;

/// Health someone up on a wall or gate tile loses when the tile breaks under them and they fall to
/// the ground (`CONTEXT.md`: A tile breaks), of `MAX_HEALTH`: about as much as a few good blows,
/// so a fall hurts but kills only those already low on health.
pub const FALL_DAMAGE: f64 = 30.0;

/// Chance of dodging a blow for each point of Agility: an average resident dodges one in five.
pub const DODGE_PER_AGILITY: f64 = 0.02;

/// However agile a resident is, they dodge at most this share of blows.
pub const DODGE_LIMIT: f64 = 0.5;

/// Combat skill a resident of average Intellect learns from each blow they strike or that is
/// struck at them (`CONTEXT.md`: Combat, fighting teaches Combat): a point every 50 blows.
pub const COMBAT_SKILL_PER_BLOW: f64 = 0.02;
}
