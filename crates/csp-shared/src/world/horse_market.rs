//! The world-state types of `packages/shared/src/horse-market.ts`.

use serde::{Deserialize, Serialize};

use super::HorseStats;

/// A horse an NPC city sells or buys, as a Player saw it at its stable (`NpcHorseOffer`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcHorseOffer {
    pub horse_id: String,
    pub stable_id: String,
    pub name: String,
    pub stats: HorseStats,
    pub born_at: f64,
    pub price: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}
