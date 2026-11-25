//! Fighting in groups: armies and their orders, and mercenary contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{RunningScript, Tile};

/// A side of a mercenary contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ContractSide {
    Lender,
    Hirer,
}

/// A mercenary contract (`CONTEXT.md`: Mercenary contract).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MercenaryContract {
    pub id: String,
    pub lender_id: String,
    pub hirer_id: String,
    pub offered_by: ContractSide,
    pub resident_ids: Vec<String>,
    pub days: f64,
    pub price_per_week: f64,
    pub storage_id: String,
    pub started_at: Option<f64>,
    pub paid_weeks: f64,
}

/// A named group of a realm's residents moving and fighting together (`CONTEXT.md`: Army).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Army {
    pub id: String,
    pub name: String,
    pub realm_id: String,
    pub member_ids: Vec<String>,
    pub order: Option<ArmyOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
}

/// An army's order (`ArmyOrder`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ArmyOrder {
    WalkTo { target: Tile, started: bool },
    Attack { target_id: String, started: bool },
    Guard { at: Tile, started: bool },
    Follow { target_id: String, started: bool },
}
