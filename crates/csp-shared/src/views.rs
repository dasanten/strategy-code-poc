//! The request, reply and view types the client imports from `packages/shared` that have no other
//! home in Rust (T88.1, ADR 0030): the HTTP API's request bodies (`api.ts`), the script-language
//! tables' shapes (`script-api.ts`, `script-views.ts`) and the admin map's views (`admin-map.ts`).
//! They are written so that `ts-rs` generates the TypeScript the client already uses; the server
//! parses and writes the same JSON with plain `serde_json` values today, so these describe the
//! wire rather than carrying it.
//!
//! A type the TypeScript builds with `Omit`, `Pick` or an intersection is a [`ts_type!`]: the
//! TypeScript text itself, with the imports it needs added when the files are written.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::world::{ScriptMemory, ScriptRunError, ScriptRunSteps};

/// A resident or army's run-script state the Player watching it sees (`ScriptRunSeen`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRunSeen {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_error: Option<ScriptRunError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_run: Option<ScriptRunSteps>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub waiting_since: Option<f64>,
}

/// A TypeScript type written out, for one the Rust types can't spell (`Omit`, `Pick`,
/// intersections): a unit struct that exists only to be exported under its name.
macro_rules! ts_type {
    ($(#[$doc:meta])* $name:ident = $ts:literal) => {
        $(#[$doc])*
        #[derive(TS)]
        #[ts(type = $ts)]
        pub struct $name;
    };
}

// ---- api.ts: request bodies ----

/// POST `/api/login` (`LoginRequest`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct LoginRequest {
    pub name: String,
    pub password: String,
}

/// POST `/api/signup` (`SignUpRequest`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SignUpRequest {
    pub name: String,
    pub password: String,
    pub invite_code: String,
}

/// An admin made an invite (`InviteCreated`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InviteCreated {
    pub code: String,
}

/// An admin set an account's password (`ResetPasswordRequest`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResetPasswordRequest {
    pub name: String,
    pub password: String,
}

/// A new script in the Player's library (`CreateScriptRequest`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CreateScriptRequest {
    pub name: String,
    pub source: String,
}

/// An admin re-opens Horse offers (`ReopenHorseOffersRequest`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ReopenHorseOffersRequest {
    /// The one account to re-open it for; without one, every Player.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
}

/// How many Horse offers an admin re-opened (`HorseOffersReopened`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HorseOffersReopened {
    pub reopened: u32,
}

/// What a directive's buy-off costs, set by an admin (`DirectivePriceRequest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DirectivePriceRequest {
    pub price: Option<f64>,
}

/// A goal an admin sets a directive (`DirectiveGoalRequest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DirectiveGoalRequest {
    City { city_id: String },
    Soldiers { count: f64 },
    SoldierShare { percent: f64 },
}

/// An admin gives a directive (`GiveDirectiveRequest`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GiveDirectiveRequest {
    /// The Organization it names: a realm's or an NPC city's id.
    pub target: String,
    pub with_alliance: bool,
    pub reason: String,
    /// What ends it, at least one (`MAX_DIRECTIVE_GOALS` at most).
    pub goals: Vec<DirectiveGoalRequest>,
    /// The Coins to buy it off with, or null when the target can't.
    pub price: Option<f64>,
}

// ---- protocol.ts ----

/// The map a Player plays on (`MapInfo`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct MapInfo {
    pub seed: f64,
    /// Tiles along each side of the map; its opposite sides join.
    pub size: f64,
}

/// A wandering trader standing at one of a realm's cities (`TraderVisit`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TraderVisit {
    pub city_id: String,
    pub x: f64,
    pub y: f64,
    pub until: f64,
    pub trader_id: String,
    pub city: String,
}

// ---- world.ts and carriages.ts ----

/// A weapon (`Weapon`: `WEAPONS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Weapon {
    Spear,
    Sword,
}

ts_type!(
    /// `CarriageHorse`: a horse in a carriage's pull, without its hunger and health.
    CarriageHorse = "Omit<Horse, 'hunger' | 'health'> & { down?: true }"
);
ts_type!(
    /// `CarriagePlace`: where a carriage is and whose it is.
    CarriagePlace = "Pick<Carriage, 'horseId' | 'x' | 'y' | 'realmId' | 'cityId'>"
);

// ---- script-api.ts and script-views.ts ----

/// What a `param` line declares (`ScriptParamType`: `SCRIPT_PARAM_TYPES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ScriptParamType {
    Building,
    Storage,
    Number,
    Choice,
    Waypoint,
}

/// The param types whose value is picked on the map (`PickedParamType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PickedParamType {
    Building,
    Storage,
    Waypoint,
}

/// A script's `param` line (`ScriptParam`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScriptParam {
    pub name: String,
    pub r#type: ScriptParamType,
    /// The words a `choice` param is one of, in order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub choices: Option<Vec<String>>,
    /// A `number` param's default, or a `choice` param's word.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number | string")]
    pub default: Option<serde_json::Value>,
    /// The `//` comment at the end of its line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

/// The script views by name (`ScriptViewName`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ScriptViewName {
    Resident,
    Army,
    Stats,
    Stat,
    Skills,
    Goods,
    ResidentOrder,
    OrderEnded,
    Queue,
    ArmyOrder,
    Tile,
    Pair,
    Carrying,
    RunningScript,
    Building,
    Site,
    Price,
    Offer,
    DirectOffer,
    CarriedOffer,
    City,
    Occupation,
    Alarm,
    Hire,
    Horse,
    HorseStats,
    HorseOffer,
    Carriage,
    Pile,
    Node,
    LastSeen,
    Directive,
    DirectiveGoal,
    Material,
    LineTile,
    WorkSettings,
    Waypoint,
    Trader,
    TraderStand,
    Demand,
}

ts_type!(
    /// `StartParamValues`: the values a script's params get when it starts, by name.
    StartParamValues = "{ [name: string]: ScriptParamValue | null }"
);

// ---- admin-map.ts ----

/// What an admin can inspect (`AdminInspectKind`: `ADMIN_INSPECT_KINDS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AdminInspectKind {
    Resident,
    Building,
    City,
    Horse,
    Carriage,
    Pile,
    Army,
    Caravan,
    Trader,
}

/// What an admin asks to inspect (`AdminInspectTarget`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdminInspectTarget {
    pub kind: AdminInspectKind,
    pub id: String,
}

/// An id and a name (`AdminNamed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdminNamed {
    pub id: String,
    pub name: String,
}

/// What kind of Organization it is (`AdminOrganization.is`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AdminOrgIs {
    Realm,
    City,
    TradeOrg,
}

/// An alliance by id and name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdminAlliance {
    pub id: String,
    pub name: String,
}

/// An Organization on the admin map (`AdminOrganization`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AdminOrganization {
    pub id: String,
    pub is: AdminOrgIs,
    /// A realm by its realm name, an NPC city by its own, the Trade Organization by its.
    pub name: String,
    /// A realm's Player's account name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account: Option<String>,
    /// The alliance a realm or NPC city is a member of.
    pub alliance: Option<AdminAlliance>,
}

/// The script a resident or army runs, as an admin sees it (`AdminScript`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AdminScript {
    pub script_id: u64,
    /// The script's name in its Player's library; null once it was deleted.
    pub name: Option<String>,
    pub memory: ScriptMemory,
}

ts_type!(
    /// `AdminEntity`: anything on the admin map, with the Organization it belongs to.
    AdminEntity = "{ org: string | null } & (
  | ({ is: 'resident' } & Omit<Resident, 'script'> & { script?: AdminScript })
  | ({ is: 'building' } & Building)
  | ({ is: 'city' } & City & { x: number; y: number; houses: number })
  | ({ is: 'horse' } & Horse)
  | ({ is: 'carriage' } & Carriage)
  | ({ is: 'pile' } & Pile)
  | ({ is: 'army' } & Omit<Army, 'script'> & { script?: AdminScript })
  | ({ is: 'caravan' } & Caravan)
  | ({ is: 'trader' } & Trader)
)"
);

ts_type!(
    /// `AdminInspection`: everything an admin sees of one entity.
    AdminInspection = "{ tick: number; org: AdminOrganization | null } & (
  | {
      is: 'resident'
      resident: Omit<Resident, 'script'> & { script?: AdminScript }
      city: AdminNamed | null
      army: AdminNamed | null
      caravan: AdminNamed | null
      trader?: AdminNamed
      leader: boolean
    }
  | {
      is: 'city'
      city: City & { x: number; y: number }
      residents: AdminNamed[]
      buildings: [BuildingKind, number][]
      storage: Stock
      gates: { open: number; shut: number }
      soldiers: number
    }
  | { is: 'building'; building: Building; city: AdminNamed | null }
  | { is: 'horse'; horse: Horse }
  | {
      is: 'carriage'
      carriage: Carriage
      driver: AdminNamed | null
      caravan: AdminNamed | null
      trader?: AdminNamed
    }
  | { is: 'pile'; pile: Pile }
  | {
      is: 'army'
      army: Omit<Army, 'script'> & { script?: AdminScript }
      members: (AdminNamed & { x: number; y: number })[]
    }
  | {
      is: 'caravan'
      caravan: Caravan
      post: AdminNamed | null
      carriage: Carriage | null
      crew: AdminNamed[]
    }
  | {
      is: 'trader'
      trader: Trader
      post: AdminNamed | null
      loop: AdminNamed[]
      carriage: Carriage | null
      crew: AdminNamed[]
    }
)"
);

/// The Organizations and entities in view of the admin map (`AdminWorldView`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct AdminWorldView {
    pub tick: f64,
    pub orgs: Vec<AdminOrganization>,
    #[ts(as = "Vec<AdminEntity>")]
    pub entities: Vec<serde_json::Value>,
}

/// How a demand's goods are handed over (`DemandHandOver`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "way", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DemandHandOver {
    SetAside { storage_id: String },
    Transfer { from_city_id: String, to_city_id: String },
}
