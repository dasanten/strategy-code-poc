//! Realms and what is between them: join requests, demands, alliances and their members.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Stock;

/// An NPC city asking a realm to join it (`CONTEXT.md`: Persuading a city).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinRequest {
    pub city_id: String,
    pub realm_id: String,
    pub at: f64,
    pub declined: bool,
}

/// Everything one Player controls through their Leader (`CONTEXT.md`: Realm).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Realm {
    pub id: String,
    /// The Player's account: the integer primary key of the `users` table.
    pub user_id: u64,
    pub leader_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub demands_sent_at: Option<Vec<f64>>,
    /// The resident the Player named to carry the realm on (`CONTEXT.md`: Heir); none until named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub heir_id: Option<String>,
    /// The tick the realm began, for its shelter (`CONTEXT.md`: New realm's shelter). Left out for
    /// a realm from before it was kept, which is past its shelter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub founded_at: Option<f64>,
}

/// Why a realm's heir lapsed (`CONTEXT.md`: Heir).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HeirLapse {
    /// They died.
    Died,
    /// They belong to another realm or to nobody now (their city changed hands, they were handed
    /// over).
    LeftRealm,
    /// They live in no city of the realm.
    Homeless,
    /// A mercenary contract in force lends them out.
    Lent,
    /// They were handed over to the alliance army.
    AllianceArmy,
    /// A Leader handover made them the Leader.
    BecameLeader,
}

/// What a demand asks for (`DemandTerms`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DemandTerms {
    City { city_id: String, city_name: String },
    Goods { goods: Stock },
}

/// How the goods of an accepted demand change hands (`DemandHandedOver`), tagged by `way`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "way",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DemandHandedOver {
    SetAside { goods: Stock, x: f64, y: f64 },
    Transfer { goods: Stock, from_city: String, to_city: String },
}

/// A demand waiting for its answer (`CONTEXT.md`: Demand).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Demand {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub terms: DemandTerms,
    pub note: String,
    pub sent_at: f64,
    pub deadline: f64,
}

/// A group of Organizations that agreed to join (`CONTEXT.md`: Alliance).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alliance {
    pub id: String,
    pub name: String,
    pub leader_id: String,
    pub members: Vec<AllianceMember>,
    pub invites: Vec<String>,
    pub army: Vec<AllianceArmyPart>,
}

/// What was handed over to an alliance's army.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AllianceArmyPartIs {
    Resident,
    Carriage,
}

/// A soldier or carriage handed over to an alliance's army.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllianceArmyPart {
    pub is: AllianceArmyPartIs,
    pub id: String,
    pub recall_at: Option<f64>,
}

/// A member leaving an alliance (`AllianceMember.leaving`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Leaving {
    pub at: f64,
    pub removed: bool,
}

/// An Organization's membership in an alliance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllianceMember {
    pub realm_id: String,
    pub joined_at: f64,
    pub leaving: Option<Leaving>,
}
