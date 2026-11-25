//! Horses, the breedings a stable keeps, and the carriages horses pull.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Stock;

/// A horse's stats (`HorseStats`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct HorseStats {
    pub speed: f64,
    pub strength: f64,
    pub endurance: f64,
}

/// The breeding progress a stable keeps for two horses in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeptBreeding {
    pub horse_ids: [String; 2],
    pub progress: f64,
}

/// An animal that pulls a carriage (`CONTEXT.md`: Horse).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Horse {
    pub id: String,
    pub name: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub hunger: f64,
    pub health: f64,
    pub stats: HorseStats,
    pub born_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub down_until: Option<f64>,
}

/// A horse-drawn cart (`CONTEXT.md`: Carriage).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Carriage {
    pub id: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub horse_id: Option<String>,
    pub load: Stock,
}
