//! The WebSocket messages (`ServerMessage` and `ClientMessage` of `packages/shared/src/protocol.ts`,
//! ADR 0006), as types, so `ts-rs` can write the client's twin of them (T88.1, ADR 0030).
//!
//! `realtime.rs` builds the same JSON with `json!` today; these describe it field for field and
//! are not what it serialises through, so a change to a message there needs the matching change
//! here (the generated package is checked against these, not against `realtime.rs`).

use csp_shared::protocol::SeenEntity;
use csp_shared::views::{MapInfo, ScriptRunSeen, TraderVisit};
use csp_shared::world::{
    OrderRequest, RealmEvent, Remembered, ScriptLogLine, ScriptMemory, Waypoint, WorkplaceSettings,
};
use csp_sim::queries::region_map::RegionMap;
use csp_sim::views::Diplomacy;
use indexmap::IndexMap;
use ts_rs::TS;

use crate::app::Account;
use crate::first_day::FirstDay;

/// The realm and the city the view starts on (`welcome.home`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct WelcomeHome {
    pub realm_id: String,
    pub leader_id: String,
    /// The realm's own name, null while it has none.
    pub realm_name: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
}

/// The Last seen that changed out of sight (`tick.lastSeen`).
#[derive(Debug, Clone, PartialEq, TS)]
pub struct LastSeenChange {
    pub changed: Vec<Remembered>,
    pub gone: Vec<String>,
}

/// Messages the server pushes over the WebSocket (`ServerMessage`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerMessage {
    /// On connect, to a Player without a realm: they name the realm and their Leader with a
    /// `found` request before the world shows.
    Founding {
        account: Account,
        leader_name: String,
    },
    /// On connect: who you are, the map and everything in your sight.
    Welcome {
        account: Account,
        tick: u64,
        map: MapInfo,
        /// Chunks with explored terrain, to load from `TERRAIN_BATCH_PATH`.
        explored_chunks: Vec<i32>,
        home: WelcomeHome,
        /// Everything the Player's residents see.
        entities: Vec<SeenEntity>,
        /// What the Player remembers and is out of their sight now.
        last_seen: Vec<Remembered>,
        /// The Player's realm log as kept, oldest first.
        events: Vec<RealmEvent>,
        diplomacy: Diplomacy,
        /// The Region map over their explored terrain; null until territory is first worked out.
        region: Option<RegionMap>,
        /// Whether the Player may still claim their Horse offer.
        horse_offer: bool,
        waypoints: Vec<Waypoint>,
        trader_visits: Vec<TraderVisit>,
        first_day: FirstDay,
        /// The realm's Workplace settings by building id; only its own.
        work_settings: IndexMap<String, WorkplaceSettings>,
    },
    /// Every tick: what changed in sight, and what else changed for the Player.
    Tick {
        tick: u64,
        changed: Vec<SeenEntity>,
        gone: Vec<String>,
        #[ts(optional)]
        last_seen: Option<LastSeenChange>,
        explored: Vec<i32>,
        events: Vec<RealmEvent>,
        #[ts(optional)]
        diplomacy: Option<Diplomacy>,
        #[ts(optional)]
        region: Option<RegionMap>,
        #[ts(optional)]
        leader_id: Option<String>,
        #[ts(optional)]
        realm_name: Option<String>,
        #[ts(optional)]
        horse_offer: Option<bool>,
        #[ts(optional)]
        work_settings: Option<IndexMap<String, WorkplaceSettings>>,
        #[ts(optional)]
        waypoints: Option<Vec<Waypoint>>,
        #[ts(optional)]
        trader_visits: Option<Vec<TraderVisit>>,
    },
    /// The memory of the script run by a watched resident or army.
    ScriptMemory {
        id: String,
        memory: Option<ScriptMemory>,
    },
    /// How the script run by a watched resident or army last ran.
    ScriptRun {
        id: String,
        run: Option<ScriptRunSeen>,
    },
    /// The script log of a watched resident.
    ScriptLog {
        id: String,
        lines: Option<Vec<ScriptLogLine>>,
    },
    /// The Player's first-day card, when an order of theirs ticked one of its lines.
    FirstDay {
        first_day: FirstDay,
    },
    Ack {
        request_id: String,
    },
    Rejected {
        request_id: String,
        reason: String,
    },
}

/// Messages the client sends over the WebSocket (`ClientMessage`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientMessage {
    Order {
        request_id: String,
        order: OrderRequest,
    },
    /// Founds the Player's realm and starting city with these names.
    Found {
        request_id: String,
        realm_name: String,
        leader_name: String,
    },
    /// The residents and armies whose cards show their Script tab now.
    Watch {
        ids: Vec<String>,
    },
}
