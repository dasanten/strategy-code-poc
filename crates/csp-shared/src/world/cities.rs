//! Cities: `City` and the types of its fields. What a game-run city plans is in `city_plans`.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CityScouted, DangerPlace};

/// Which of the Trade Organization's cities a city is (`City.tradeOrg`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TradeOrgCity {
    Hq,
    Post,
}

/// The Player of a self-managed city (`City.formerPlayer`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormerPlayer {
    /// An account id (see `Realm::user_id`).
    pub user_id: u64,
    pub tick: f64,
}

/// A settlement (`CONTEXT.md`: City).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct City {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub game_name: Option<bool>,
    pub realm_id: Option<String>,
    pub town_hall_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub trade_org: Option<TradeOrgCity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workplace_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scouted: Option<CityScouted>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub former_player: Option<FormerPlayer>,
    pub occupation: Option<Occupation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub outsiders: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarmed_attackers: Option<IndexMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub layout: Option<CityLayout>,
    /// For an NPC city, the realms whose fighters near it have outweighed it without a break, and
    /// since when (`CONTEXT.md`: Respect; ADR 0033), as of its last planning pass. Left out while
    /// there are none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub outweighed: Option<Vec<Outweighed>>,
    /// For an NPC city, how dangerous it thinks each Organization is, by its id (`CONTEXT.md`:
    /// Threat), apart from Standing. Its own mind: nobody else sees it. Left out while there are
    /// none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub threats: Option<IndexMap<String, f64>>,
    /// For an NPC city, the places where it lost people, to anyone (`CONTEXT.md`: Threat). Its own
    /// mind too. Left out while there are none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub danger_places: Option<Vec<DangerPlace>>,
    /// For an NPC city, what it is like (`CONTEXT.md`: Temperament), fixed when it comes into
    /// being. Left out for a trading post and a city founded by a Player.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub temperament: Option<Temperament>,
    /// For an NPC city, what it is after for now (`CONTEXT.md`: Stance), picked again each game day.
    /// Left out while it grows, and for a trading post and a city a Player holds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stance: Option<Stance>,
    /// For an NPC city in Retaliate, the Organization it turned on (`CONTEXT.md`: Retaliating).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub retaliating: Option<String>,
}

/// What an NPC city is like (`City.temperament`, `CONTEXT.md`: Temperament).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Temperament {
    Merchant,
    Militarist,
    Settler,
}

/// What an NPC city is after for now (`City.stance`, `CONTEXT.md`: Stance). Retaliate comes with
/// T98.8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Stance {
    Grow,
    Fortify,
    Trade,
    Expand,
    Retaliate,
}

/// Since when a realm's fighters near an NPC city have outweighed it without a break
/// (`City.outweighed`, `CONTEXT.md`: Respect, Persuading a city, Demand; ADR 0033).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outweighed {
    pub realm_id: String,
    /// The planning pass from which they have outweighed its own side (enough to persuade it).
    pub since: f64,
    /// The planning pass from which they have far outweighed it (enough for a demand), if they
    /// do now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub far_since: Option<f64>,
}

/// The layouts an NPC city can get (`CITY_LAYOUTS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CityLayout {
    Grid,
    Rings,
    MainStreet,
    Quarters,
}

/// A realm occupying a city's town hall.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Occupation {
    pub realm_id: String,
    pub since: f64,
}
