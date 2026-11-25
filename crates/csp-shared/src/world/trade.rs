//! Trade: caravans, deliveries, transfers, traders, offers on the market, and an Organization's
//! standing with a realm.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{DebtCollection, Good, Onto, PricedGood, Stock};

/// Which end of a route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Heading {
    Hq,
    Post,
}

/// Where at an end of its route a caravan stands or is going.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CaravanStop {
    Storage,
    Warehouse,
}

/// Goods a driver took last tick to put down, and where they go.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Holding {
    pub goods: Stock,
    pub onto: Onto,
}

/// A Trade Org caravan (`CONTEXT.md`: Caravan).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Caravan {
    pub id: String,
    pub post_id: String,
    pub carriage_id: String,
    pub driver_id: Option<String>,
    pub escort_ids: Vec<String>,
    pub heading: Heading,
    pub stop: CaravanStop,
    pub to_load: Option<Stock>,
    pub holding: Option<Holding>,
    pub job: Option<CaravanJob>,
    pub transfer: Option<TransferJob>,
}

/// A delivery or a pick-up (`Delivery.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryKind {
    Delivery,
    PickUp,
}

/// A delivery or pick-up the Trade Organization owes a realm (`CONTEXT.md`: Delivery).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Delivery {
    pub id: String,
    pub kind: DeliveryKind,
    pub realm_id: String,
    pub warehouse_id: String,
    pub city_id: String,
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub units: f64,
    pub fee: f64,
    pub caravan_id: Option<String>,
}

/// A step of a caravan's delivery job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CaravanJobStep {
    Load,
    Deliver,
    Collect,
    Pay,
    Return,
    ReturnCoins,
}

/// What a caravan does for a delivery it took on (`CaravanJob`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaravanJob {
    pub delivery_id: String,
    pub kind: DeliveryKind,
    pub warehouse_id: String,
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub step: CaravanJobStep,
    pub units: f64,
    pub coins: f64,
    pub target: Option<f64>,
    pub to_pay: f64,
    pub paid: f64,
    pub fee: f64,
    pub misses: f64,
    pub robbed: f64,
}

/// A transfer between realms (`CONTEXT.md`: Transfer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transfer {
    pub id: String,
    pub realm_id: String,
    pub to_realm_id: String,
    pub to_city_id: String,
    pub warehouse_id: String,
    pub from_city_id: Option<String>,
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub units: f64,
    pub fee: f64,
    pub back: bool,
    pub caravan_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub carried_offer: Option<CarriedTransfer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub debt: Option<DebtCollection>,
}

/// How a carried Direct offer's Transfer is paid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarriedTransfer {
    pub unload_share: f64,
    pub due: f64,
}

/// A step of a caravan's transfer job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TransferJobStep {
    Collect,
    Fee,
    Load,
    Deliver,
    UnloadFee,
    Return,
}

/// What a caravan does for a transfer it took on (`TransferJob`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferJob {
    pub transfer_id: String,
    pub warehouse_id: String,
    pub good: Good,
    pub step: TransferJobStep,
    pub units: f64,
    pub coins: f64,
    pub target: Option<f64>,
    pub fee: f64,
    pub misses: f64,
    pub robbed: f64,
    pub from_city_id: Option<String>,
}

/// Where at a place a wandering trader stands or is going.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TraderStop {
    Storage,
    Warehouse,
    CoinWarehouse,
}

/// What a wandering trader still has to leave and take at a stop (`Trader.plan`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TraderPlan {
    pub leave: Stock,
    pub take: Stock,
}

/// A wandering trader (`CONTEXT.md`: Wandering trader).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trader {
    pub id: String,
    pub carriage_id: String,
    pub driver_id: Option<String>,
    pub escort_ids: Vec<String>,
    pub r#loop: Vec<String>,
    pub post_id: String,
    pub heading: Heading,
    pub stop: TraderStop,
    pub plan: Option<TraderPlan>,
    pub holding: Option<Holding>,
    pub misses: f64,
    pub robberies: f64,
    pub calls: Option<Vec<String>>,
    pub stand: Option<TraderStand>,
}

/// A wandering trader's stop at a city (`CONTEXT.md`: Trader stop).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraderStand {
    pub city_id: String,
    pub x: f64,
    pub y: f64,
    pub until: Option<f64>,
}

/// What a Player posts at a storage of their realm (`CONTEXT.md`: Offer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Offer {
    pub id: String,
    pub realm_id: String,
    pub storage_id: String,
    pub x: f64,
    pub y: f64,
    pub gives: Good,
    pub gives_units: f64,
    pub wants: Good,
    pub wants_units: f64,
    pub times: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub direct: Option<DirectOfferTerms>,
}

/// Who a Direct offer is for, and the tick it lapses at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectOfferTerms {
    pub to_id: String,
    pub lapses_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub carried: Option<CarriedOfferTerms>,
}

/// Who pays a carried Direct offer's fee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CarriedFeeBy {
    Sender,
    Split,
}

/// A carried Direct offer (`CONTEXT.md`: Direct offer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarriedOfferTerms {
    pub from_city_id: String,
    pub to_city_id: String,
    pub fee_by: CarriedFeeBy,
    pub sender_fee: f64,
    pub other_fee: f64,
}

/// What ended a realm's offer (`OfferEnd`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OfferEnd {
    UsedUp,
    TakenDown,
    StorageLost,
    GoodsGone,
    Declined,
    Lapsed,
    NoCaravans,
}

/// How the Organization `of` regards `toward` (`CONTEXT.md`: Standing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Standing {
    pub of: String,
    pub toward: String,
    pub value: f64,
}

/// How far a trade moved an Organization's regard for the realm.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StandingMove {
    pub org: String,
    pub name: String,
    pub by: f64,
}
