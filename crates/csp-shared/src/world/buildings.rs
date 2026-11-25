//! Buildings: their kinds, construction sites and wall materials.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::named_enum::named_enum;

use super::{KeptBreeding, Stock};

named_enum! {
// What a kind is and does is its `spec`.
/// The kinds of building (`BuildingKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum BuildingKind {
    TownHall = "townHall",
    House = "house",
    Storage = "storage",
    Warehouse = "warehouse",
    Wall = "wall",
    Gate = "gate",
    /// A 2×2 tower of wood or stone, part of the wall walk (`CONTEXT.md`: Tower).
    Tower = "tower",
    Farm = "farm",
    Stable = "stable",
    Mine = "mine",
    Quarry = "quarry",
    LumberCamp = "lumberCamp",
    Smelter = "smelter",
    Mint = "mint",
    Smithy = "smithy",
    Kiln = "kiln",
    TrainingGround = "trainingGround",
    Road = "road",
    Carriage = "carriage",
    Haven = "haven",
    /// A boat site (`CONTEXT.md`: Building a boat): finished, it is gone and a boat floats.
    Boat = "boat",
    /// A ship site (`CONTEXT.md`: Building a ship): finished, it is gone and a ship floats on Sea.
    Ship = "ship",
    /// A ram site (`CONTEXT.md`: Siege machine, Ram): finished, it is gone and a ram stands there.
    Ram = "ram",
    /// A catapult site (`CONTEXT.md`: Siege machine, Catapult): finished, it is gone and a catapult
    /// stands there.
    Catapult = "catapult",
}
}

/// A building or construction site (`Building`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Building {
    pub id: String,
    pub kind: BuildingKind,
    pub city_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub site: Option<ConstructionSite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub teardown: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub closed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub damage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub breedings: Option<Vec<KeptBreeding>>,
    /// Share of its condition a finished building has lost to decay (`CONTEXT.md`: Decay), from 0
    /// (good, as built) to 1 (nothing left). Left out of a save while it has lost none, so a
    /// building from before format 130 reads as good.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decay: Option<f64>,
    /// A repair under way (`CONTEXT.md`: Repairing): the materials brought and the work put in so
    /// far. Gone once it is done.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub repair: Option<ConstructionSite>,
    /// The tick a building nobody repaired became a ruin (`CONTEXT.md`: Ruin): it stands but does
    /// nothing, and collapses `RUIN_COLLAPSE_DAYS` game days later. Gone once it is rebuilt; left
    /// out of a save while it is none, so a building from before format 135 is no ruin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ruined_at: Option<f64>,
    /// What a wall, gate or tower, or its site, is of; none is wood (`CONTEXT.md`: Wall / Gate,
    /// Wood or stone, Tower). Only walls, gates and towers have one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub material: Option<WallMaterial>,
}

/// What a wall or gate is built of (`CONTEXT.md`: Wall / Gate, Wood or stone): wood from Wood, or
/// stone from Stone with more work, holding out several times longer against blows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WallMaterial {
    #[default]
    Wood,
    Stone,
}

/// How far a construction site has come (`CONTEXT.md`: Construction site).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ConstructionSite {
    pub delivered: Stock,
    pub work: f64,
}
