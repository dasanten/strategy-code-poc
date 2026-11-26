//! The world state (ADR 0006, ADR 0030): `WorldState` here, the types its fields are made of in
//! one module per domain, re-exported so that each is `world::Name`. A new type goes into the
//! module of its domain; only `WorldState` stays in this file. Plain serialisable data in the JSON
//! shape the TypeScript `WorldState` had. No rules live here: nothing changes a world.
//!
//! How the TypeScript maps onto serde, everywhere in this module tree:
//! - Every struct has `deny_unknown_fields`, so a field the port missed fails loudly.
//! - `x: T | null` is `Option<T>` written as `null`; `x?: T` is `Option<T>` with the key left
//!   out while `None` (the `opt` fields below carry `default, skip_serializing_if`).
//! - `x?: true` is `Option<bool>`: the TypeScript only ever writes `true`.
//! - Unions tagged by `kind` (or `is`, `way`) are internally tagged enums.
//! - A `number` is `f64` unless every writer provably writes a whole number; the few integer
//!   fields say why next to them.
//! - `Record<string, T>` is an `IndexMap` (JavaScript iterates string keys in insertion order);
//!   `Record<number, T>` is a `BTreeMap` with integer keys (JavaScript iterates integer-like keys
//!   in ascending order, and so does a `BTreeMap`).

mod buildings;
mod cities;
mod city_plans;
mod crimes;
pub mod default_scripts;
mod event_kinds;
mod events;
mod fighting;
mod goods;
pub mod horse_market;
mod horses;
mod map;
mod nodes;
pub mod npc_trade;
pub mod offers;
mod orders;
pub mod protocol;
mod queue;
mod realms;
mod residents;
mod scripts;
mod trade;
mod vessels;
pub mod warehouse;
pub mod world_format;

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use buildings::*;
pub use cities::*;
pub use city_plans::*;
pub use crimes::*;
pub use default_scripts::Task;
pub use event_kinds::*;
pub use events::*;
pub use fighting::*;
pub use goods::*;
pub use horses::*;
pub use map::*;
pub use nodes::*;
pub use orders::*;
pub use protocol::{OrderRequest, Remembered};
pub use queue::*;
pub use realms::*;
pub use residents::*;
pub use scripts::*;
pub use trade::*;
pub use vessels::*;
pub use world_format::{parse_save, SaveError, WORLD_FORMAT_VERSION};

/// Everything in the world that changes, saved as snapshots (ADR 0006).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldState {
    /// Starts at 0 and only ever goes up by `world.tick++`.
    pub tick: u64,
    /// The map seed: the server's `newSeed` (1) or a stored terrain's seed, whole numbers that
    /// `mulberry32` takes as `seed >>> 0`. Signed so any whole number a save may hold loads.
    pub seed: i64,
    pub residents: Vec<Resident>,
    pub nodes: Vec<ResourceNode>,
    /// Only ever changed by `nextId++`.
    pub next_id: u64,
    pub realms: Vec<Realm>,
    pub cities: Vec<City>,
    pub buildings: Vec<Building>,
    pub horses: Vec<Horse>,
    pub carriages: Vec<Carriage>,
    /// Boats (and later ships) on the water (`CONTEXT.md`: Vessel). Left out of a save while there
    /// are none, so a world from before format 113 reads as having none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vessels: Vec<Vessel>,
    /// Siege machines in the field (`CONTEXT.md`: Siege machine). Left out of a save while there
    /// are none, so a world from before format 134 reads as having none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub siege_machines: Vec<SiegeMachine>,
    pub piles: Vec<Pile>,
    pub events: Vec<RealmEvent>,
    pub alliances: Vec<Alliance>,
    pub armies: Vec<Army>,
    pub crimes: Vec<Crime>,
    pub standings: Vec<Standing>,
    pub contracts: Vec<MercenaryContract>,
    pub demands: Vec<Demand>,
    pub join_requests: Vec<JoinRequest>,
    pub caravans: Vec<Caravan>,
    pub traders: Vec<Trader>,
    pub deliveries: Vec<Delivery>,
    pub transfers: Vec<Transfer>,
    pub offers: Vec<Offer>,
    pub route_robberies: IndexMap<String, f64>,
    pub punishments: Vec<Punishment>,
    pub supply_wagons: Vec<SupplyWagon>,
    pub directives: Vec<Directive>,
    pub debts: Vec<Debt>,
    /// By account id (see `Realm::user_id`).
    pub last_seen: BTreeMap<u64, Vec<Remembered>>,
    pub script_view_changes: f64,
    /// Account ids (see `Realm::user_id`).
    pub horse_offers_claimed: Vec<u64>,
    /// By account id (see `Realm::user_id`).
    pub waypoints: BTreeMap<u64, Vec<Waypoint>>,
    pub city_plans: IndexMap<String, CityPlan>,
    pub workplace_settings: IndexMap<String, IndexMap<String, WorkplaceSettings>>,
    /// The heartlands' starting sites (`CONTEXT.md`: Starting site), placed when the world is
    /// generated, free or taken. Left out of a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub starting_sites: Vec<StartingSite>,
    /// The heartlands (region ids) open to new Players, in the order they opened (`CONTEXT.md`:
    /// Starting site). Left out of a save while none is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opened_heartlands: Vec<u32>,
    /// The nodes that ran dry (`CONTEXT.md`: Running dry), for the Players who still remember
    /// them. Left out of a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dry_nodes: Vec<DryNode>,
    /// The new nodes some Players had explored the tile of before they came into being and have
    /// not seen since (`CONTEXT.md`: Running dry): their map shows no node there yet. Left out of
    /// a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub new_veins: Vec<NewVein>,
    /// The nodes waiting to come back where they ran dry, as no fitting tile was found for them
    /// elsewhere (`CONTEXT.md`: Running dry). Left out of a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waiting_veins: Vec<WaitingVein>,
    /// The wear of used gear (`CONTEXT.md`: Wear), by the id of the resident, building, carriage,
    /// vessel or pile keeping it. Gear nobody has used is in no entry. Left out of a save while
    /// all gear is as new, so a world from before format 136 reads as all gear in good condition.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    #[ts(optional, as = "Option<IndexMap<String, Wear>>")]
    pub wear: IndexMap<String, Wear>,
    /// The Zeal of each Player whose pool is not full, by account id (see `Realm::user_id`), in
    /// game hours of rallying (`CONTEXT.md`: Zeal). A Player with no entry has a full pool, so a
    /// new Player and one from before format 148 start full. Kept by account, not by realm, so a
    /// Leader handover or death keeps it. Left out of a save while every pool is full.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(optional, as = "Option<BTreeMap<u64, f64>>")]
    pub zeal: BTreeMap<u64, f64>,
    /// The patches of the Forest and Hills tiles that aren't full (`CONTEXT.md`: Patch), sorted
    /// by tile, row (`y`) first; a full tile is in no entry, so the list stays small on a big map.
    /// Left out of a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<Patch>>")]
    pub patches: Vec<Patch>,
    /// How long each Player's realm has waited for its next drifter (`CONTEXT.md`: Drifter), in
    /// ticks, by realm id; the wait counts only while a drifter may come. A realm that has not
    /// waited is in no entry. Left out of a save while none has.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    #[ts(optional, as = "Option<IndexMap<String, f64>>")]
    pub drifter_waits: IndexMap<String, f64>,
    /// The drifters on their way to a city, or turned away from one (`CONTEXT.md`: Drifter).
    /// Left out of a save while there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drifters: Vec<Drifter>,
}

impl WorldState {
    /// Every node the map's terrain lists (`MapTerrain`): those in the world and those that ran
    /// dry, which the Players who explored them remember until they see their tiles again.
    pub fn nodes_ever(&self) -> Vec<ResourceNode> {
        self.nodes.iter().cloned().chain(self.dry_nodes.iter().map(DryNode::as_node)).collect()
    }
}
