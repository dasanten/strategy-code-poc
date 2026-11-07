//! The world-state types of `packages/shared/src/protocol.ts`: an order request as a queue step
//! keeps it, and what a Player remembers of buildings and cities (`WorldState.lastSeen`). The
//! wire messages themselves come with the protocol port.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::horse_market::NpcHorseOffer;
use super::npc_trade::ShownNpcCityPrice;
use super::offers::SeenOffer;
use super::warehouse::ShownWarehousePrice;
use super::{
    BuildingKind, CityLayout, CityScouted, ConstructionSite, FormerPlayer, KeptBreeding,
    Occupation, Stock, TradeOrgCity,
};

/// An order from the UI or a script (`OrderRequest`): `kind` picks the order, the rest is its
/// plain-data input, open by design (`[key: string]: unknown`), so it takes any field and keeps
/// them in order. The order's own checks validate it when it is given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderRequest {
    pub kind: String,
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

/// A building, construction site or city as the Player last saw it (`Remembered`), tagged by
/// `is`, with the tick they last had it in sight.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "is", rename_all = "camelCase")]
pub enum Remembered {
    Building(RememberedBuilding),
    City(RememberedCity),
}

/// `SeenBuilding & { seenAt }`: the fields of `Building`, what a Player sees on top of them, and
/// `seenAt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RememberedBuilding {
    pub id: String,
    pub kind: BuildingKind,
    pub city_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stock: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<ConstructionSite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teardown: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breedings: Option<Vec<KeptBreeding>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prices: Option<Vec<ShownWarehousePrice>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offers: Option<Vec<SeenOffer>>,
    pub seen_at: f64,
}

/// What an NPC city would lend a Player (`SeenCity.hire`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hire {
    pub spare: f64,
    pub price_per_resident_week: f64,
}

/// `SeenCity & { seenAt }`: the fields of `City`, what a Player sees on top of them, and
/// `seenAt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RememberedCity {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_name: Option<bool>,
    pub realm_id: Option<String>,
    pub town_hall_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trade_org: Option<TradeOrgCity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workplace_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scouted: Option<CityScouted>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub former_player: Option<FormerPlayer>,
    pub occupation: Option<Occupation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outsiders: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alarmed_attackers: Option<IndexMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<CityLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wont_sell: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refuses: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hire: Option<Hire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trade: Option<Vec<ShownNpcCityPrice>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horses: Option<Vec<NpcHorseOffer>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horses_to_sell: Option<Vec<NpcHorseOffer>>,
    pub seen_at: f64,
}
