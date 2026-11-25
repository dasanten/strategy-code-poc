//! What the game has the cities it runs do: their plans, jobs, projects, scouts, traders and
//! marches, and the admin directives.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{BuildingKind, Good, Stock, Tile, TilePath, TrainingSubject, WallMaterial};

/// What a game-run city's plan has one of its residents do (`CityJob.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CityJobKind {
    Soldier,
    Teach,
    Train,
    Farm,
    Work,
    Build,
    Road,
    Trade,
    Found,
    Revive,
    Scout,
    Feed,
    Idle,
}

/// A resident's job in a city plan (`CityJob`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityJob {
    pub kind: CityJobKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub building_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stable_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ground_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub subject: Option<TrainingSubject>,
}

/// A road a game-run city builds (`CONTEXT.md`: NPC road).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CityRoad {
    pub to: String,
    pub tiles: TilePath,
}

/// What a game-run city builds or takes down next (`CityProject`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CityProject {
    Build {
        building: BuildingKind,
        x: f64,
        y: f64,
        /// Stone for a stone wall or gate, over a wooden one or new; none is wood (`CONTEXT.md`:
        /// Wood or stone).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        material: Option<WallMaterial>,
    },
    TearDown {
        building_id: String,
    },
}

/// Where a trader is in a run to an offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TraderLeg {
    Load,
    SetOff,
    Walking,
}

/// A trader's run to a Player's offer (`CONTEXT.md`: NPC cities at an offer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityTraderOffer {
    pub offer_id: String,
    pub times: f64,
    pub pays: Good,
    pub units: f64,
    pub leg: TraderLeg,
}

/// A game-run city's trade run under way (`CONTEXT.md`: NPC trader).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityTrader {
    pub resident_id: String,
    pub warehouse_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub visiting_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub loaded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offer: Option<CityTraderOffer>,
    pub sells: Stock,
    pub buys: Stock,
    pub since: f64,
    /// The city's soldiers who walk with this trader and guard them (`CONTEXT.md`: Escort). Left
    /// out while none do.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub escort_ids: Vec<String>,
}

/// What a scout out has seen and not brought home yet (`CONTEXT.md`: Scout).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScoutTrip {
    pub saw: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub no_way: Option<Vec<f64>>,
}

/// What an NPC city's scouts have brought home (`CONTEXT.md`: Scout).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityScouted {
    pub sectors: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub no_way: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub done: Option<bool>,
}

/// What a city the game runs decided at its last planning pass (`CityPlan`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityPlan {
    pub planned_at: f64,
    pub jobs: IndexMap<String, CityJob>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project: Option<CityProject>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub roads: Option<Vec<CityRoad>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub streets: Option<TilePath>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub traders: Option<Vec<CityTrader>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub full_since: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub short_since: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub founding_site: Option<Tile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scouts: Option<IndexMap<String, ScoutTrip>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub patrols: Option<Vec<CityPatrol>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub patrolled_last: Option<String>,
    /// Its soldiers out after thieves (`CONTEXT.md`: Acting first).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hunts: Option<Vec<CityHunt>>,
    /// When it last sent a demand to each Organization, by its id (`CONTEXT.md`: NPC demand), so
    /// it doesn't send the next too soon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub demanded: Option<IndexMap<String, f64>>,
    /// Its soldiers out to take a node another Organization holds (`CONTEXT.md`: Taking a node).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub taking: Option<NodeTaking>,
    /// The soldiers it sent along with the crew building on a node out of its City area
    /// (`CONTEXT.md`: Taking a node), by resident id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub site_escort: Option<Vec<String>>,
    /// Its soldiers marching on a city of the Organization it retaliates against
    /// (`CONTEXT.md`: Retaliating).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub march: Option<CityMarch>,
}

/// An NPC city's soldiers out to take a workplace on a node another Organization holds
/// (`CONTEXT.md`: Taking a node): they drive its workers and guards off, then it is the city's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeTaking {
    pub building_id: String,
    /// The Organization that held it.
    pub holder: String,
    pub soldier_ids: Vec<String>,
}

/// An NPC city's soldiers marching on a city to take it (`CityPlan.march`, `CONTEXT.md`: Retaliating).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityMarch {
    pub city_id: String,
    pub resident_ids: Vec<String>,
}

/// A soldier of an NPC city out after a thief it knows of, to take back what was taken
/// (`CONTEXT.md`: Acting first). While the thief lives they go after them; once the thief has
/// fallen, they take the goods from the pile where they fell and carry them home.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityHunt {
    pub resident_id: String,
    pub thief_id: String,
    /// What the thief took from the city, as far as it knows: what the soldier takes back.
    pub goods: Stock,
    /// Where the thief was last seen: once they have fallen, where.
    pub last_at: Tile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub fell: Option<bool>,
    /// The goods are picked up and on their way home.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub home: Option<bool>,
}

/// A soldier of an NPC city walking a round (`CONTEXT.md`: Soldier posts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CityPatrol {
    pub resident_id: String,
    pub stops: Vec<Tile>,
}

/// An admin's order to the Trade Organization to weaken an Organization (`Directive`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Directive {
    pub id: String,
    pub target: String,
    pub with_alliance: bool,
    pub reason: String,
    pub given_by: String,
    pub given_at: f64,
    pub goals: Vec<DirectiveGoal>,
    pub soldiers_killed: f64,
    pub price: Option<f64>,
}

/// A goal of an admin directive (`DirectiveGoal`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DirectiveGoal {
    City {
        city_id: String,
        city: String,
        met: bool,
    },
    Soldiers {
        count: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        percent: Option<f64>,
    },
}
