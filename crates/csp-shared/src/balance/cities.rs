//! A city's area and distances, and how far a resident sees.

balance! {
/// Starting cities lie at least this many tiles apart (about 2.5 hours' walk on plains), when the
/// map has room; otherwise as far apart as it allows.
pub const CITY_MIN_DISTANCE: f64 = 1200.0;

/// How near a city building must stand to the city's town hall, or to another building already
/// part of that city, to be part of it too (`CONTEXT.md`: City building), in tiles along each
/// direction from footprint to footprint. A wall with gaps of up to eleven tiles still holds
/// together.
pub const CITY_BUILDING_REACH: f64 = 12.0;

/// How far around each of its buildings' footprints a city's area reaches (`CONTEXT.md`: City
/// area), in tiles along each direction: about the old 40 m tile right next to them.
pub const CITY_AREA_MARGIN: f64 = 4.0;

/// Most tiles a ring of walls and gates can shut in (`CONTEXT.md`: Walls in combat): ground cut
/// off by walls from more than this, a square of 400 tiles along each side, counts as outside.
pub const WALL_ENCLOSES_MAX: f64 = 160_000.0;

/// How far a resident sees, in tiles (`CONTEXT.md`: Sight).
pub const SIGHT_RANGE: f64 = 48.0;

/// How often each realm's Last seen is brought up to date, in ticks (`CONTEXT.md`: Last seen).
/// Realms are staggered by their id, so about one in this many refreshes on a tick; a building
/// that leaves sight between two refreshes is remembered as it was up to this many ticks earlier.
pub const LAST_SEEN_EVERY_TICKS: f64 = 5.0;
}
