//! The world-state types of `packages/shared/src/npc-trade.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Good, PricedGood};

/// An NPC city's price line as a Player saw it (`Shown<NpcCityPrice>`): its stock only when they
/// saw inside.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShownNpcCityPrice {
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub buy: f64,
    pub sell: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<f64>,
    pub for_sale: f64,
    pub wanted: f64,
}
