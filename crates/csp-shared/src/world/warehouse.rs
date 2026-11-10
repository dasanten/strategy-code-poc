//! The world-state types of `packages/shared/src/warehouse.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Good, PricedGood};

/// A warehouse's price line as a Player saw it (`Shown<WarehousePrice>`): its stock only when
/// they saw inside.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ShownWarehousePrice {
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub buy: f64,
    pub sell: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<f64>,
}
