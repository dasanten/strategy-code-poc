//! Walking, carriages and driving.

use super::*;
use crate::terrain::Terrain;

balance! {
/// Ticks (real seconds) an unloaded resident of average Agility takes to walk a plains tile
/// (`CONTEXT.md`: Tile). Carriages go at a multiple of this (`CARRIAGE_SPEED`).
pub const WALK_TICKS_PER_TILE: f64 = 7.5;

/// How dear a way may be before a path search gives up on it: this many times the cheapest the
/// way could possibly cost (every step on the cheapest ground), plus `PATH_DETOUR_SLACK`. A goal
/// only behind a longer detour counts as unreachable, so a search for one never crosses the
/// whole map.
pub const PATH_DETOUR_LIMIT: f64 = 8.0;

/// The fixed part of a path search's limit (`PATH_DETOUR_LIMIT`), in plains-tiles on foot.
pub const PATH_DETOUR_SLACK: f64 = 500.0;

/// The Agility at which a resident walks at the usual speed.
pub const AGILITY_AVERAGE: f64 = 10.0;

/// How much faster each point of Agility above average walks (slower below).
pub const AGILITY_SPEED_EFFECT: f64 = 0.02;

/// How much of a terrain's slowdown each point of Agility above average takes away.
pub const AGILITY_TERRAIN_EFFECT: f64 = 0.03;

/// The furthest Agility moves either effect, up or down.
pub const AGILITY_LIMIT: f64 = 0.3;

/// Most weight a carriage carries, in kg (`CONTEXT.md`: Carriage): about thirteen residents of
/// average Strength, so one carriage moves what a whole starting city could carry.
pub const CARRIAGE_CAPACITY: f64 = 400.0;

/// Up to this share of `CARRIAGE_CAPACITY` a carriage whose load a Player can't see looks lightly
/// loaded (`CONTEXT.md`: Seeing inside a storage, `loadLevel`).
pub const CARRIAGE_LIGHT_LOAD: f64 = 1.0 / 3.0;

/// Up to this share of `CARRIAGE_CAPACITY` it looks half loaded; above it, heavily.
pub const CARRIAGE_HALF_LOAD: f64 = 2.0 / 3.0;

/// The most one delivery or pick-up carries, in kg (`CONTEXT.md`: Delivery): a caravan's carriage
/// with room left for the Food it keeps on board (`CARAVAN_FOOD`, a kg a unit).
pub const DELIVERY_LOAD: f64 = CARRIAGE_CAPACITY - CARAVAN_FOOD;

/// The horse's share of the Food a haul route keeps on board, in units (`CONTEXT.md`: Haul route,
/// Refilling from a carriage): five game days (two real hours) of the horse's eating, rounded up.
/// The driver refills from the rest of what is kept, never from this.
pub const HAUL_HORSE_FOOD: f64 = ceil(5.0 * HORSE_FOOD_PER_DAY);

/// Food a haul route keeps on board for its horse and its driver unless the Player picks another
/// amount, in units (`CONTEXT.md`: Haul route, Refilling from a carriage): five game days (two
/// real hours) of the horse's eating and the driver's, topped up at each stop that has Food. A trip
/// takes real time, so this keeps its real-time length; rounded up to whole units.
pub const HAUL_KEEP_FOOD: f64 = ceil(5.0 * (HORSE_FOOD_PER_DAY + FOOD_PER_DAY));

/// How fast a carriage crosses each terrain, relative to an unloaded resident of average Agility on
/// Plains (`CONTEXT.md`: Carriage): twice as fast on Plains, a little slower than walking in Forest
/// and Hills, and faster still on a road. Mountains are missing: a carriage enters them only on a
/// road (`Terrain.Road`).
pub const CARRIAGE_SPEED: TerrainTable = TerrainTable(&[
    (Terrain::Plains as u8, 2.0),
    (Terrain::Forest as u8, 0.6),
    (Terrain::Hills as u8, 0.6),
    // A road, whatever the terrain beneath (`CONTEXT.md`: Road): 1.3 times Plains, as on foot.
    (Terrain::Road as u8, 2.6),
]);

/// How much faster a carriage goes for each point of its driver's Driving skill.
pub const DRIVING_SKILL_EFFECT: f64 = 0.02;

/// The furthest Driving skill speeds a carriage up, as a share of its speed.
pub const DRIVING_SKILL_LIMIT: f64 = 0.5;

/// Driving skill a driver of average Intellect gains per game day of driving.
pub const DRIVING_SKILL_PER_DAY: f64 = 1.0;

/// How fast a hungry horse goes under its rider (`HORSE_HUNGRY_SHARE`), as a share of its pace.
pub const HUNGRY_HORSE_PACE: f64 = 0.5;

/// The most any carriage can hold, behind the strongest horse.
pub const CARRIAGE_MAX_CAPACITY: f64 = CARRIAGE_CAPACITY * (1.0 + HORSE_STRENGTH_LIMIT);

/// What each passenger counts for against what a carriage holds, in kg (`CONTEXT.md`: Passenger),
/// grown-up or child: five fit on a carriage behind an average horse, or four with some Food.
pub const PASSENGER_WEIGHT: f64 = 70.0;
}

/// Whether a carriage can enter ground of the given kind (`groundAt`): passable land or a road, but
/// no bare mountains (`carriageCanGoTo`).
pub fn carriage_can_enter(terrain: u8) -> bool {
    CARRIAGE_SPEED.get(terrain).unwrap_or(0.0) > 0.0
}
