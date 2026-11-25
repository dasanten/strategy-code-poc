//! Crimes and what follows from them: debts to the Trade Organization and their collection,
//! punishments and their supply wagons.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{BuildingKind, GoodsSpot, Stock};

/// Where a caravan collects a debt's Coins (`DebtCollection`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebtCollection {
    pub storage_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offer_id: Option<String>,
}

/// What a crime was (`CrimeKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CrimeKind {
    Theft,
    Attack,
    Killing,
    TearDown,
    Capture,
}

/// Why a punishment headed home (`PunishmentEnd`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PunishmentEnd {
    Enough,
    Empty,
    GaveUp,
    CityLost,
    DirectiveLifted,
    NoWay,
    Paid,
    NoWorkplaces,
    TookCity,
}

/// Out to the city or home.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PunishmentHeading {
    Out,
    Home,
}

/// A soldier of a punishment (`Punishment.members`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PunishmentMember {
    pub resident_id: String,
    pub own: Stock,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub packed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub seller: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub no_way: Option<Vec<String>>,
}

/// The Trade Org army out to punish an Organization (`CONTEXT.md`: Trade Org reaction).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Punishment {
    pub id: String,
    pub culprit_org: String,
    pub city_id: String,
    pub worth: f64,
    pub members: Vec<PunishmentMember>,
    pub heading: PunishmentHeading,
    pub took: f64,
    pub started_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub arrived_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub directive_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub wrecks: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub takes: Option<bool>,
}

/// Goods in a supply wagon driver's hands to put down next, and where.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct WagonHolding {
    pub goods: Stock,
    pub to: GoodsSpot,
}

/// The supply wagon of a punishment (`CONTEXT.md`: Trade Org debt, Supply line).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupplyWagon {
    pub id: String,
    pub punishment_id: Option<String>,
    pub carriage_id: String,
    pub driver_id: Option<String>,
    pub food: f64,
    pub own_food: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub loaded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub sent_out: Option<bool>,
    pub holding: Option<WagonHolding>,
}

/// How far up its steps the Trade Organization has gone with a debt (`Debt.step`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DebtStep {
    Demanded,
    Wrecks,
}

/// What an Organization owes the Trade Organization (`CONTEXT.md`: Trade Org debt).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Debt {
    pub org: String,
    pub coins: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub step: Option<DebtStep>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub deadline: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub trips: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub city_id: Option<String>,
}

/// Who did a crime (`Crime.culprit`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Culprit {
    pub resident_id: String,
    pub name: String,
    pub org: String,
    pub org_name: String,
}

/// The resident a crime was done to (`Crime.victim`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Victim {
    pub resident_id: String,
    pub name: String,
}

/// A crime against another Organization (`CONTEXT.md`: Crime, Witness).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crime {
    pub id: String,
    pub kind: CrimeKind,
    pub tick: f64,
    pub x: f64,
    pub y: f64,
    pub culprit: Culprit,
    pub victim_org: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub victim: Option<Victim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub goods: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub carriage: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub horse: Option<String>,
    /// A boat taken, as `carriage` (`CONTEXT.md`: Stealing a carriage or horse, its vessel part).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub boat: Option<bool>,
    /// The boat taken is a ship (`CONTEXT.md`: Sailing), so the log names it one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub ship: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub building: Option<BuildingKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub post: Option<String>,
    pub witnesses: Vec<String>,
    pub known_by: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub heard_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub punished: Option<bool>,
}
