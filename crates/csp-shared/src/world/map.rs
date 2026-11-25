//! Places on the map: tiles and paths, a Player's waypoints, the starting sites and the places
//! people were lost at. The nodes on it are in `nodes`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A tile's coordinates as `{ x, y }`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Tile {
    pub x: f64,
    pub y: f64,
}

/// Tiles as `[x, y]` pairs, in order (a path, a line, a road's way).
pub type TilePath = Vec<(f64, f64)>;

/// A place in a heartland where a starting city can stand (`CONTEXT.md`: Starting site): the
/// north-west tile of the city's walled square, as `found_starting_city` lays it out there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartingSite {
    pub x: i32,
    pub y: i32,
    /// The heartland it lies in (its region's id).
    pub region: u32,
    /// The city standing on it once a Player has been given it; free while there is none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub city_id: Option<String>,
}

/// A named marker a Player put on a tile (`CONTEXT.md`: Waypoint).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Waypoint {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

/// A place where an NPC city lost people (`City.danger_places`, `CONTEXT.md`: Threat). How much it
/// still fears it fades over game days.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DangerPlace {
    pub x: f64,
    pub y: f64,
    /// About one for each person lost there, fading.
    pub weight: f64,
}
