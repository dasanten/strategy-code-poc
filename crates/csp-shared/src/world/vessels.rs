//! Vessels on the water and siege machines in the field.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Stock;

/// The kinds of vessel (`CONTEXT.md`: Vessel): a rowed boat, on Lake and Sea, or a sailed ship, on
/// Sea only (`CONTEXT.md`: Ship).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum VesselKind {
    Boat,
    Ship,
}

/// A boat or ship (`CONTEXT.md`: Vessel): always on a water tile, one vessel per tile, with the
/// goods it carries. Those aboard are residents (`Resident::aboard`, from T90.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Vessel {
    pub id: String,
    pub kind: VesselKind,
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub load: Stock,
    /// The one aboard at its oars, who rowed it last or rows it now (`CONTEXT.md`: Rowing): no
    /// passenger, so not counted against what it holds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rower_id: Option<String>,
    /// Those aboard a ship as its crew rather than as passengers (`CONTEXT.md`: Crew): of its
    /// realm, aboard it, and not counted against what it holds. A boat has none. Left out of a
    /// save while empty (format 117).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crew_ids: Vec<String>,
}

/// The kinds of siege machine (`CONTEXT.md`: Siege machine): a ram and a catapult.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SiegeMachineKind {
    Ram,
    Catapult,
}

/// A siege machine (`CONTEXT.md`: Siege machine, ADR 0037): a machine of a realm, built in the
/// field from a site of its kind, standing on a tile a carriage could. Its crew are residents of
/// its realm on its tile; with enough of them one pushes it (`ResidentOrder::Push`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiegeMachine {
    pub id: String,
    pub kind: SiegeMachineKind,
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    /// Damage taken from blows; at its strength it breaks (`CONTEXT.md`: Siege machine).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub damage: Option<f64>,
    /// Work put into tearing it down so far (`CONTEXT.md`: Tearing down).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub teardown: Option<f64>,
    /// Its crew, in the order they joined: residents of its realm on its tile.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crew_ids: Vec<String>,
}
