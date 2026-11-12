//! The world state (ADR 0006, ADR 0030): the Rust twin of `packages/shared/src/world.ts` and the
//! types it pulls in from the other files of `packages/shared/src`, one module per file. Plain
//! serialisable data in the same JSON shape as the TypeScript `WorldState`, so a save written by
//! either server loads into the other. No rules live here: nothing changes a world.
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

pub mod default_scripts;
pub mod horse_market;
pub mod npc_trade;
pub mod offers;
pub mod protocol;
pub mod warehouse;
pub mod world_format;

use std::collections::BTreeMap;
use ts_rs::TS;

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub use default_scripts::Task;
pub use protocol::{OrderRequest, Remembered};
pub use world_format::{parse_save, SaveError, WORLD_FORMAT_VERSION};

/// A tile's coordinates as `{ x, y }`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Tile {
    pub x: f64,
    pub y: f64,
}

/// Tiles as `[x, y]` pairs, in order (a path, a line, a road's way).
pub type TilePath = Vec<(f64, f64)>;

/// Goods by kind, as unit counts; a missing good is 0 (`Stock`).
pub type Stock = IndexMap<Good, f64>;

/// A script value as plain data (`MemoryValue`): any JSON value.
pub type MemoryValue = serde_json::Value;

/// A running script's memory (`ScriptMemory`): plain JSON, key order kept.
pub type ScriptMemory = serde_json::Map<String, serde_json::Value>;

/// The goods a store or fetch order moves (`GoodsWanted`): units of each, or `null` for as many as
/// there are.
pub type GoodsWanted = IndexMap<Good, Option<f64>>;

/// A resident's picked script parameter values (`ScriptParamValues`): script id, then param
/// name. Script ids are whole numbers, so JavaScript iterates them in ascending order.
pub type ScriptParamValues = BTreeMap<u64, IndexMap<String, ScriptParamValue>>;

/// The PoC goods (`GOODS`, `CONTEXT.md`: Good). `Exclude<Good, 'coins'>` in the TypeScript is
/// this type too; the rules check it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Good {
    Food,
    Wood,
    Stone,
    IronOre,
    Iron,
    GoldOre,
    Coins,
    Spear,
    Sword,
    Shield,
    Armour,
}

/// `PricedGood`: every good but Coins (`Exclude<Good, 'coins'>`), the goods with a price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PricedGood {
    Food,
    Wood,
    Stone,
    IronOre,
    Iron,
    GoldOre,
    Spear,
    Sword,
    Shield,
    Armour,
}

/// A resident's stats (`STAT_NAMES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum StatName {
    Strength,
    Endurance,
    Agility,
    Intellect,
}

/// `Record<StatName, T>`: one value per stat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StatRecord<T> {
    pub strength: T,
    pub endurance: T,
    pub agility: T,
    pub intellect: T,
}

/// A stat: what the resident was born with, plus what training added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Stat {
    pub base: f64,
    pub trained: f64,
}

/// A horse's stats (`HorseStats`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct HorseStats {
    pub speed: f64,
    pub strength: f64,
    pub endurance: f64,
}

/// Something learned by doing or training (`SkillName`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SkillName {
    Mining,
    Woodcutting,
    Smelting,
    Smithing,
    Construction,
    Farming,
    Combat,
    Driving,
    Seafaring,
}

/// What a training ground teaches (`TrainingSubject`): a stat or a skill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TrainingSubject {
    Strength,
    Endurance,
    Agility,
    Intellect,
    Mining,
    Woodcutting,
    Smelting,
    Smithing,
    Construction,
    Farming,
    Combat,
    Driving,
}

/// A person living in the world (`CONTEXT.md`: Resident).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resident {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub game_name: Option<bool>,
    pub owner: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub stats: StatRecord<Stat>,
    pub skills: IndexMap<SkillName, f64>,
    pub health: f64,
    pub hunger: f64,
    pub born_at: f64,
    pub lifespan: f64,
    pub carried: Stock,
    pub order: Option<ResidentOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub order_ended: Option<OrderEnded>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub struck: Option<Struck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interrupted: Option<Interrupted>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub given_under_attack: Option<GivenUnderAttack>,
    /// A script id (see `RunningScript::script_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub defence_script_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm_script_id: Option<AlarmScriptId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_params: Option<ScriptParamValues>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_log: Option<Vec<ScriptLogLine>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub queue: Option<Queue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pair: Option<Pair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub carrying: Option<Carrying>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub riding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub aboard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub down_until: Option<f64>,
}

/// What a resident runs when an alarm reaches them (`Resident.alarmScriptId`): a script id, or
/// `"none"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum AlarmScriptId {
    Script(u64),
    Off(NoScript),
}

/// The literal `"none"` of `AlarmScriptId`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub enum NoScript {
    #[serde(rename = "none")]
    None,
}

/// A queue (`CONTEXT.md`: Queue): steps done one after another.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    pub realm_id: String,
    pub steps: Vec<QueueStep>,
    /// An index into `steps`; the server's invariant checks `Number.isInteger`.
    pub current: u32,
    pub started_at: Option<f64>,
    pub r#loop: bool,
    /// Step ids: counted up from `steps.length + 1` with `++` only.
    pub next_step_id: u32,
}

/// One step of a queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct QueueStep {
    /// From `nextStepId++`, or an id already in the queue (checked on editing).
    pub id: u32,
    pub order: OrderRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub minutes: Option<f64>,
}

/// Pairing (`CONTEXT.md`: Pairing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pair {
    pub partner_id: String,
    pub since: f64,
}

/// Carrying a child (`CONTEXT.md`: Carrying).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Carrying {
    pub since: f64,
    pub partner_id: String,
    pub partner_name: String,
    pub partner_base: StatRecord<f64>,
}

/// One line of a resident's script log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScriptLogLine {
    pub tick: f64,
    pub text: String,
}

/// A picked script parameter value: a building or carriage id, or a number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum ScriptParamValue {
    Id(String),
    Number(f64),
}

/// A realm's own settings for one workplace (`CONTEXT.md`: Workplace settings).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkplaceSettings {
    /// A script id (see `RunningScript::script_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub params: Option<IndexMap<String, ScriptParamValue>>,
}

/// A resident's or army's run-script order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunningScript {
    /// The id of a row of the `scripts` table (SQLite integer key), or 0 for a task's default:
    /// every writer copies one of those, an order naming any other is refused.
    pub script_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub task: Option<Task>,
    pub memory: ScriptMemory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_logged_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_logged_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_error: Option<ScriptRunError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_run: Option<ScriptRunSteps>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub waiting_since: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm: Option<Alarm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm_under: Option<Alarm>,
}

/// What raised an alarm (`Alarm.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AlarmKind {
    Occupied,
    Outsider,
    Theft,
    Attacked,
}

/// Something that happened in a City area, as an Alarm script reads it (`CONTEXT.md`: Alarm).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alarm {
    pub kind: AlarmKind,
    pub city_id: String,
    pub about: String,
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub tick: f64,
}

/// A script's last runtime error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScriptRunError {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub column: Option<f64>,
    pub tick: f64,
    /// A script version: an integer column of `script_versions`.
    pub version: u64,
}

/// Whose step budget a script ran out of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OutOfSteps {
    Own,
    Realm,
}

/// The steps a script used the last tick it ran.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptRunSteps {
    pub steps: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub out_of_steps: Option<OutOfSteps>,
}

/// A place on the resident's own tile that goods are taken from or put (`GoodsSpot`), or a vessel
/// beside them (`CONTEXT.md`: Beside a vessel).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GoodsSpot {
    Ground,
    Storage { storage_id: String },
    Site { site_id: String },
    Carriage { carriage_id: String },
    Resident { resident_id: String },
    Vessel { vessel_id: String },
}

/// Where a store or fetch order takes goods to or from (`GoodsPlace`): a storage, a carriage, or a
/// vessel, loaded from beside it (`CONTEXT.md`: Beside a vessel).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GoodsPlace {
    Storage { storage_id: String },
    Carriage { carriage_id: String },
    Vessel { vessel_id: String },
}

/// Walking to a tile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalkOrder {
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub army: Option<String>,
}

/// Picking up goods on the resident's tile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PickUpOrder {
    pub from: GoodsSpot,
    pub goods: Stock,
}

/// Putting down carried goods on the resident's tile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DropOrder {
    pub to: GoodsSpot,
    pub goods: Stock,
}

/// Where a store order is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum StorePhase {
    Walking,
    Putting,
    Refilling,
}

/// Storing (`CONTEXT.md`: Store).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreOrder {
    pub goods: GoodsWanted,
    pub to: GoodsPlace,
    pub phase: StorePhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub own_food: Option<f64>,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// Where a fetch order is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FetchPhase {
    Walking,
    Taking,
}

/// Fetching (`CONTEXT.md`: Fetch).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FetchOrder {
    pub goods: GoodsWanted,
    pub from: GoodsPlace,
    pub phase: FetchPhase,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// What a defence or Alarm script interrupted (`Resident.interrupted`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Interrupted {
    pub order: Option<ResidentOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm: Option<InterruptedAlarm>,
}

/// The Alarm script a blow interrupted in turn, with its order (`Interrupted.alarm`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct InterruptedAlarm {
    pub order: Option<ResidentOrder>,
    pub script: RunningScript,
}

/// How long what a Player gave a resident under attack holds (`GivenUnderAttack`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum GivenUnderAttack {
    UntilDone,
    UntilCalm,
}

/// Who last struck a resident, and the tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Struck {
    pub by: String,
    pub tick: f64,
}

/// Which kind of order ended (`OrderEnded.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OrderEndedKind {
    Store,
    Fetch,
    Relocate,
}

/// How a resident's last store, fetch or relocate order ended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct OrderEnded {
    pub kind: OrderEndedKind,
    pub tick: f64,
    pub reason: Option<String>,
}

/// Building (`CONTEXT.md`: Building, Road).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildOrder {
    pub building: BuildingKind,
    pub at: Tile,
    pub site_id: Option<String>,
}

/// Working at a workplace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkOrder {
    pub building_id: String,
    pub at: Tile,
    pub progress: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub makes: Option<Good>,
}

/// Tearing down.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TearDownOrder {
    pub building_id: String,
    pub at: Tile,
}

/// Driving a carriage to a tile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DriveOrder {
    pub carriage_id: String,
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub army: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub near: Option<bool>,
}

/// Rowing a boat to a water tile (`CONTEXT.md`: Rowing): the rower is aboard and at its oars, and
/// the boat goes a Step at a time over water along `path`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowOrder {
    pub vessel_id: String,
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// A haul route's stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HaulStop {
    From,
    To,
}

/// Loading and unloading at the stop, or driving to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HaulPhase {
    Loading,
    Driving,
}

/// Where goods in hand go: onto the carriage, or at the stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Onto {
    Carriage,
    Stop,
}

/// Goods the resident took last tick for a haul route (`HaulOrder.moving`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct HaulMoving {
    pub good: Good,
    pub before: f64,
    pub onto: Onto,
}

/// A haul route (`CONTEXT.md`: Haul route).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HaulOrder {
    pub carriage_id: String,
    pub from: Tile,
    pub to: Tile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub to_army: Option<String>,
    pub goods: Vec<Good>,
    pub return_goods: Vec<Good>,
    pub keep_food: f64,
    pub stop: HaulStop,
    pub phase: HaulPhase,
    pub path: Option<TilePath>,
    pub progress: f64,
    pub moving: Option<HaulMoving>,
}

/// A haul route by water (`CONTEXT.md`: Haul route by water): the rower rows a vessel between
/// two stops on land, havens or shore tiles, again and again. At a stop they stand on it, beside
/// the vessel, and load by hand like a carriage's driver; leaving, they board, take the oars and
/// row to the free water tile beside the other stop (`water`). Its phase `driving` is the rowing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaterHaulOrder {
    pub vessel_id: String,
    pub from: Tile,
    pub to: Tile,
    pub goods: Vec<Good>,
    pub return_goods: Vec<Good>,
    /// Food kept on board for the rower.
    pub keep_food: f64,
    pub stop: HaulStop,
    pub phase: HaulPhase,
    /// The water tile beside the stop it is rowed to, set as it leaves a stop.
    pub water: Option<Tile>,
    pub path: Option<TilePath>,
    pub progress: f64,
    pub moving: Option<HaulMoving>,
}

/// Attacking a resident, wall or gate (`CONTEXT.md`: Combat).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttackOrder {
    pub target_id: String,
    pub path: Option<TilePath>,
    pub progress: f64,
    pub strike: f64,
    pub started: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub defending: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub army: Option<String>,
}

/// Where a line order is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum LinePhase {
    Walking,
    Building,
}

/// Building a road or wall along a line (`roadLine`, `wallLine`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineOrder {
    pub tiles: TilePath,
    pub phase: LinePhase,
    pub path: Option<TilePath>,
    pub progress: f64,
    pub site_id: Option<String>,
}

/// Climbing a wall or gate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClimbOrder {
    pub wall_id: String,
    pub at: Tile,
    pub progress: f64,
}

/// Breeding (`CONTEXT.md`: Breeding).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BreedOrder {
    pub stable_id: String,
    pub horse_ids: [String; 2],
    pub at: Tile,
    pub progress: f64,
}

/// Teaching (`CONTEXT.md`: Teacher).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeachOrder {
    pub building_id: String,
    pub subject: TrainingSubject,
}

/// Training (`CONTEXT.md`: Trainee, Training).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrainOrder {
    pub building_id: String,
    pub learning: Option<TrainingSubject>,
}

/// Relocating (`CONTEXT.md`: Relocate).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelocateOrder {
    pub city_id: String,
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// Feeding a Down resident or a horse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedOrder {
    pub target_id: String,
    pub units: f64,
}

/// Paying for a mercenary contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayOrder {
    pub contract_id: String,
    pub weeks: f64,
}

/// Buying an NPC city.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuyCityOrder {
    pub city_id: String,
}

/// Buying or selling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TradeSide {
    Buy,
    Sell,
}

/// Trading at a Trade Org warehouse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TradeOrder {
    pub side: TradeSide,
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub units: f64,
    pub carriage_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub city_id: Option<String>,
}

/// A swap at a Trade Org warehouse or an NPC city's storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwapOrder {
    #[ts(as = "PricedGood")]
    pub give: Good,
    #[ts(as = "PricedGood")]
    pub want: Good,
    pub units: f64,
    pub carriage_id: Option<String>,
}

/// Buying or selling a horse at an NPC city's stable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HorseTradeOrder {
    pub horse_id: String,
}

/// Handing in a transfer at a Trade Org warehouse.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandInOrder {
    pub good: Good,
    pub units: f64,
    pub carriage_id: Option<String>,
    pub to_city_id: String,
}

/// Buying off an admin directive.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuyOffOrder {
    pub directive_id: String,
    pub carriage_id: Option<String>,
}

/// Paying the Trade Org debt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayDebtOrder {
    pub coins: f64,
    pub carriage_id: Option<String>,
}

/// Accepting an offer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptOfferOrder {
    pub offer_id: String,
    pub times: f64,
    pub carriage_id: Option<String>,
}

/// Any order a resident can hold (`ResidentOrder`), tagged by `kind`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResidentOrder {
    WalkTo(WalkOrder),
    Drive(DriveOrder),
    Haul(HaulOrder),
    PickUp(PickUpOrder),
    Drop(DropOrder),
    Store(StoreOrder),
    Fetch(FetchOrder),
    Build(BuildOrder),
    TearDown(TearDownOrder),
    WorkAt(WorkOrder),
    Breed(BreedOrder),
    Attack(AttackOrder),
    Climb(ClimbOrder),
    Teach(TeachOrder),
    Train(TrainOrder),
    RoadLine(LineOrder),
    WallLine(LineOrder),
    Pay(PayOrder),
    BuyCity(BuyCityOrder),
    Trade(TradeOrder),
    Swap(SwapOrder),
    BuyHorse(HorseTradeOrder),
    SellHorse(HorseTradeOrder),
    HandIn(HandInOrder),
    BuyOff(BuyOffOrder),
    PayDebt(PayDebtOrder),
    AcceptOffer(AcceptOfferOrder),
    Relocate(RelocateOrder),
    Feed(FeedOrder),
    Row(RowOrder),
    HaulByWater(WaterHaulOrder),
}

/// Everything in the world that changes, saved as snapshots (ADR 0006).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
}

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
    Build { building: BuildingKind, x: f64, y: f64 },
    TearDown { building_id: String },
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

/// Where a caravan collects a debt's Coins (`DebtCollection`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebtCollection {
    pub storage_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offer_id: Option<String>,
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

/// An NPC city asking a realm to join it (`CONTEXT.md`: Persuading a city).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinRequest {
    pub city_id: String,
    pub realm_id: String,
    pub at: f64,
    pub declined: bool,
}

/// A side of a mercenary contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ContractSide {
    Lender,
    Hirer,
}

/// A mercenary contract (`CONTEXT.md`: Mercenary contract).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MercenaryContract {
    pub id: String,
    pub lender_id: String,
    pub hirer_id: String,
    pub offered_by: ContractSide,
    pub resident_ids: Vec<String>,
    pub days: f64,
    pub price_per_week: f64,
    pub storage_id: String,
    pub started_at: Option<f64>,
    pub paid_weeks: f64,
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

/// A named group of a realm's residents moving and fighting together (`CONTEXT.md`: Army).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Army {
    pub id: String,
    pub name: String,
    pub realm_id: String,
    pub member_ids: Vec<String>,
    pub order: Option<ArmyOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
}

/// An army's order (`ArmyOrder`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ArmyOrder {
    WalkTo { target: Tile, started: bool },
    Attack { target_id: String, started: bool },
    Guard { at: Tile, started: bool },
    Follow { target_id: String, started: bool },
}

/// What a resident died of (`DeathCause`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DeathCause {
    Starved,
    OldAge,
    Killed,
}

/// What a punishment did, in a `punished` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PunishedWhat {
    Coming,
    Arrived,
    Left,
    TurnedBack,
    Lost,
}

/// Where a punishment was lost, in a `punished` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PunishedWhere {
    WayThere,
    AtCity,
    WayHome,
}

/// How a debt changed, in a `debt` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DebtWhat {
    Owed,
    PostOwed,
    Rose,
    Collected,
    PostReturned,
    CityTaken,
    Overdue,
    Ended,
}

/// What happened to a Direct offer, in a `directOffer` event: `received`, `carriedAccepted`,
/// `youAccepted`, or any `OfferEnd` but `usedUp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DirectOfferWhat {
    Received,
    CarriedAccepted,
    YouAccepted,
    TakenDown,
    StorageLost,
    GoodsGone,
    Declined,
    Lapsed,
    NoCaravans,
}

/// A carried Direct offer, in a `directOffer` event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarriedNote {
    pub from_city: String,
    pub to_city: String,
    pub fee: f64,
}

/// Where a swap was, in a `swapped` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SwapPlace {
    Warehouse,
    Storage,
}

/// Why a transfer didn't get on, in a `transferStuck` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TransferStuckWhy {
    TurnedBack,
    Cancelled,
    Kept,
    Nothing,
    NothingCame,
    Robbed,
}

/// The order the Fall of the HQ ended, in an `orderEndedWithHq` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EndedWithHq {
    Delivery,
    PickUp,
    Transfer,
}

/// A city of a realm that ended, in a `selfManaged` event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfManagedCity {
    pub city_id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub residents: f64,
}

/// Where granted or claimed horses arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum HorsesWhere {
    Stable,
    Storage,
    Leader,
}

/// Why a member left an alliance, in an `allianceLeft` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AllianceLeftWhy {
    Left,
    Removed,
    LeaderDied,
}

/// A script that read a dropped field, in a `scriptFieldDropped` event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DroppedFieldScript {
    /// A script id (see `RunningScript::script_id`).
    pub script_id: u64,
    pub name: String,
}

/// How a mercenary contract changed, in a `contract` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ContractWhat {
    Offered,
    Started,
    Paid,
    Ended,
    Broken,
    Declined,
}

/// How a demand changed, in a `demand` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DemandWhat {
    Sent,
    Received,
    Accepted,
    Declined,
    Lapsed,
}

/// What the other side of a demand is when it is no realm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DemandOtherIs {
    City,
    TradeOrg,
}

/// A side of a demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DemandSide {
    Sender,
    Receiver,
}

/// What happened, by kind (`RealmEventWhat`); the rest of a `RealmEvent` says when and for whom.
/// Script events name who ran the script by `resident_id` or `army_id` (`ScriptRunBy`), exactly
/// one of the two.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RealmEventWhat {
    Hungry {
        resident_id: String,
        name: String,
    },
    Down {
        resident_id: String,
        name: String,
        until: f64,
    },
    Woke {
        resident_id: String,
        name: String,
        by: String,
    },
    Died {
        resident_id: String,
        name: String,
        cause: DeathCause,
        leader: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by: Option<String>,
    },
    Fight {
        resident_id: String,
        name: String,
        other_id: String,
        other: String,
        attacker: bool,
    },
    CrimeKnown {
        crime_id: String,
        crime: CrimeKind,
        at: f64,
        x: f64,
        y: f64,
        culprit_id: String,
        culprit: String,
        culprit_org: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        victim: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        goods: Option<Stock>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        carriage: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        horse: Option<String>,
        /// A boat, stolen like a carriage (`CONTEXT.md`: Stealing a carriage or horse).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        boat: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        building: Option<BuildingKind>,
    },
    TransportGone {
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        carriage: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        horse: Option<String>,
        /// A boat, stolen like a carriage (`CONTEXT.md`: Stealing a carriage or horse).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        boat: Option<bool>,
    },
    TransportTaken {
        resident_id: String,
        name: String,
        x: f64,
        y: f64,
        from: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        carriage: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        horse: Option<String>,
        /// A boat, stolen like a carriage (`CONTEXT.md`: Stealing a carriage or horse).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        boat: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        goods: Option<Stock>,
    },
    Punished {
        what: PunishedWhat,
        city_id: String,
        city: String,
        worth: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        took: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        why: Option<PunishmentEnd>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        r#where: Option<PunishedWhere>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        directive: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        wrecks: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        takes: Option<bool>,
    },
    Wrecked {
        building: BuildingKind,
        x: f64,
        y: f64,
        city_id: String,
        city: String,
        coins: f64,
        owed: f64,
    },
    Debt {
        what: DebtWhat,
        coins: f64,
        owed: f64,
    },
    DebtPaid {
        resident_id: String,
        name: String,
        coins: f64,
        owed: f64,
        x: f64,
        y: f64,
    },
    BoughtOff {
        resident_id: String,
        name: String,
        reason: String,
        coins: f64,
        x: f64,
        y: f64,
    },
    DirectiveEnded {
        reason: String,
    },
    Fled {
        resident_id: String,
        name: String,
    },
    CityCaptured {
        city_id: String,
        city: String,
        other: Option<String>,
        captor: bool,
        residents: f64,
    },
    HallOccupied {
        city_id: String,
        city: String,
        other: Option<String>,
        occupier: bool,
        days: f64,
        x: f64,
        y: f64,
    },
    OccupationBroken {
        city_id: String,
        city: String,
        other: Option<String>,
        occupier: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        x: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        y: Option<f64>,
    },
    CityBought {
        city_id: String,
        city: String,
        price: f64,
        residents: f64,
        x: f64,
        y: f64,
    },
    CityNotBought {
        city_id: String,
        city: String,
        price: f64,
        coins: f64,
    },
    JoinAsked {
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    CityPersuaded {
        city_id: String,
        city: String,
        residents: f64,
        x: f64,
        y: f64,
    },
    JoinWithdrawn {
        city_id: String,
        city: String,
    },
    Traded {
        resident_id: String,
        name: String,
        side: TradeSide,
        #[ts(as = "PricedGood")]
        good: Good,
        units: f64,
        wanted: f64,
        coins: f64,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        with_trader: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        at_storage: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        standing: Option<StandingMove>,
    },
    OfferAccepted {
        resident_id: String,
        name: String,
        realm: String,
        gives: Good,
        gives_units: f64,
        wants: Good,
        wants_units: f64,
        times: f64,
        wanted: f64,
        x: f64,
        y: f64,
    },
    OfferTaken {
        by: String,
        gives: Good,
        gives_units: f64,
        wants: Good,
        wants_units: f64,
        times: f64,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        standing: Option<StandingMove>,
    },
    OfferCutDown {
        gives: Good,
        gives_units: f64,
        wants: Good,
        wants_units: f64,
        times: f64,
        x: f64,
        y: f64,
    },
    OfferEnded {
        gives: Good,
        gives_units: f64,
        wants: Good,
        wants_units: f64,
        why: OfferEnd,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        to: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        carried: Option<bool>,
        x: f64,
        y: f64,
    },
    DirectOffer {
        what: DirectOfferWhat,
        from: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        from_city: Option<bool>,
        gives: Good,
        gives_units: f64,
        wants: Good,
        wants_units: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        times: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        carried: Option<CarriedNote>,
        x: f64,
        y: f64,
    },
    Swapped {
        resident_id: String,
        name: String,
        place: SwapPlace,
        #[ts(as = "PricedGood")]
        give: Good,
        gave: f64,
        #[ts(as = "PricedGood")]
        want: Good,
        units: f64,
        wanted: f64,
        coins: f64,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        standing: Option<StandingMove>,
    },
    HorseBought {
        resident_id: String,
        name: String,
        horse_id: String,
        horse: String,
        city: String,
        coins: f64,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        problem: Option<String>,
    },
    HorseSold {
        resident_id: String,
        name: String,
        horse_id: String,
        horse: String,
        city: String,
        coins: f64,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        problem: Option<String>,
    },
    DeliveryOrdered {
        resident_id: String,
        name: String,
        side: TradeSide,
        #[ts(as = "PricedGood")]
        good: Good,
        units: f64,
        wanted: f64,
        coins: f64,
        fee: f64,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    Delivered {
        delivery: DeliveryKind,
        #[ts(as = "PricedGood")]
        good: Good,
        units: f64,
        coins: f64,
        fee: f64,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    DeliveryStuck {
        delivery: DeliveryKind,
        #[ts(as = "PricedGood")]
        good: Good,
        units: f64,
        city_id: String,
        city: String,
        cancelled: bool,
    },
    DeliveryRobbed {
        #[ts(as = "PricedGood")]
        good: Good,
        units: f64,
        city_id: String,
        city: String,
    },
    TransferOrdered {
        good: Good,
        units: f64,
        wanted: f64,
        fee: f64,
        from_city: Option<String>,
        name: Option<String>,
        to_realm_id: String,
        to_realm: String,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    Transferred {
        good: Good,
        units: f64,
        fee: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        carried: Option<bool>,
        from_realm_id: String,
        from_realm: String,
        to_realm_id: String,
        to_realm: String,
        back: bool,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    TransferStuck {
        why: TransferStuckWhy,
        good: Good,
        units: f64,
        city_id: String,
        city: String,
    },
    OrderEndedWithHq {
        order: EndedWithHq,
        good: Good,
        units: f64,
        city_id: String,
        city: String,
    },
    SelfManaged {
        cities: Vec<SelfManagedCity>,
    },
    Founded {
        resident_id: String,
        name: String,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    LeaderHandedOver {
        from_id: String,
        from: String,
        to_id: String,
        to: String,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
    },
    FoodSpoiled {
        units: f64,
    },
    Born {
        resident_id: String,
        name: String,
        parents: [String; 2],
    },
    GrownUp {
        resident_id: String,
        name: String,
    },
    HorseDied {
        horse_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
    },
    HorseDown {
        horse_id: String,
        name: String,
        until: f64,
    },
    HorseHungry {
        horse_id: String,
        resident_id: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        horse_name: Option<String>,
    },
    HorsesGranted {
        horse_ids: Vec<String>,
        r#where: HorsesWhere,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        city: Option<String>,
        x: f64,
        y: f64,
    },
    HorsesClaimed {
        horse_ids: Vec<String>,
        r#where: HorsesWhere,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        city: Option<String>,
        x: f64,
        y: f64,
    },
    Foaled {
        horse_id: String,
        stable_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
    },
    AllianceInvited {
        alliance_id: String,
        name: String,
    },
    AllianceJoined {
        alliance_id: String,
        name: String,
        realm_id: String,
        realm: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        city: Option<bool>,
    },
    AllianceLeft {
        alliance_id: String,
        name: String,
        realm_id: String,
        realm: String,
        why: AllianceLeftWhy,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        city: Option<bool>,
    },
    AllianceDeclined {
        alliance_id: String,
        name: String,
        realm_id: String,
        realm: String,
    },
    AllianceLeader {
        alliance_id: String,
        name: String,
        realm_id: String,
        realm: String,
    },
    ScriptError {
        name: String,
        /// A script id (see `RunningScript::script_id`).
        script_id: u64,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        line: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        column: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        resident_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        army_id: Option<String>,
    },
    ScriptOutOfSteps {
        name: String,
        script_id: u64,
        realm: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        resident_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        army_id: Option<String>,
    },
    ScriptEnded {
        name: String,
        script_id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        resident_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        army_id: Option<String>,
    },
    DefenceScriptGone {
        resident_id: String,
        name: String,
        script_id: u64,
    },
    AlarmScriptGone {
        resident_id: String,
        name: String,
        script_id: u64,
    },
    ScriptStopped {
        name: String,
        script_id: u64,
        script: String,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        resident_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        army_id: Option<String>,
    },
    WaypointAdded {
        name: String,
        waypoint: String,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        resident_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        army_id: Option<String>,
    },
    ScriptFieldDropped {
        field: String,
        scripts: Vec<DroppedFieldScript>,
    },
    QueueStepSkipped {
        resident_id: String,
        name: String,
        step: f64,
        order: String,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        queue_ended: Option<bool>,
    },
    RelocateFailed {
        resident_id: String,
        name: String,
        city_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        city: Option<String>,
        reason: String,
    },
    Contract {
        contract_id: String,
        what: ContractWhat,
        lender: bool,
        other: String,
        residents: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        weeks: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        leader_died: Option<ContractSide>,
    },
    Demand {
        demand_id: String,
        what: DemandWhat,
        mine: bool,
        other: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        other_is: Option<DemandOtherIs>,
        terms: DemandTerms,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        leader_died: Option<DemandSide>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        handed_over: Option<DemandHandedOver>,
    },
}

/// Something that happened in a Player's realm, for their log (`RealmEvent`): what happened,
/// plus when and for whom. In JSON these are the fields of `what` with `seq`, `tick` and `userId`
/// beside them, as `{ ...what, seq, tick, userId }` writes them.
/// The TypeScript twin is `RealmEventWhat & { seq, tick, userId }`, so ts-rs describes it through
/// the flattened shape `RealmEventShape` (the serde impls below are hand-written).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(as = "RealmEventShape")]
pub struct RealmEvent {
    /// From `world.nextId++`.
    pub seq: u64,
    /// `world.tick` when it happened.
    pub tick: u64,
    /// The Player's account id (see `Realm::user_id`).
    pub user_id: u64,
    pub what: RealmEventWhat,
}

/// What `RealmEvent` looks like on the wire, for ts-rs only.
#[derive(Serialize, TS)]
#[ts(rename = "RealmEvent")]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct RealmEventShape {
    seq: u64,
    tick: u64,
    user_id: u64,
    #[serde(flatten)]
    what: RealmEventWhat,
}

impl Serialize for RealmEvent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let mut value = serde_json::to_value(&self.what).map_err(S::Error::custom)?;
        let map = value
            .as_object_mut()
            .ok_or_else(|| S::Error::custom("a realm event's `what` is not an object"))?;
        map.insert("seq".into(), self.seq.into());
        map.insert("tick".into(), self.tick.into());
        map.insert("userId".into(), self.user_id.into());
        value.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for RealmEvent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let mut map = serde_json::Map::deserialize(deserializer)?;
        let mut take = |key: &str| -> Result<u64, D::Error> {
            let value = map
                .remove(key)
                .ok_or_else(|| D::Error::custom(format!("missing field `{key}`")))?;
            u64::deserialize(value).map_err(D::Error::custom)
        };
        let seq = take("seq")?;
        let tick = take("tick")?;
        let user_id = take("userId")?;
        let what = RealmEventWhat::deserialize(serde_json::Value::Object(map))
            .map_err(D::Error::custom)?;
        Ok(RealmEvent { seq, tick, user_id, what })
    }
}

/// A named marker a Player put on a tile (`CONTEXT.md`: Waypoint).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Waypoint {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

/// Goods lying on the ground on one tile (`CONTEXT.md`: Pile).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Pile {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub goods: Stock,
}

/// How far a trade moved an Organization's regard for the realm.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct StandingMove {
    pub org: String,
    pub name: String,
    pub by: f64,
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

/// The kinds of building (`BuildingKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum BuildingKind {
    TownHall,
    House,
    Storage,
    Warehouse,
    Wall,
    Gate,
    Farm,
    Stable,
    Mine,
    Quarry,
    LumberCamp,
    Smelter,
    Mint,
    Smithy,
    TrainingGround,
    Road,
    Carriage,
    Haven,
    /// A boat site (`CONTEXT.md`: Building a boat): finished, it is gone and a boat floats.
    Boat,
    /// A ship site (`CONTEXT.md`: Building a ship): finished, it is gone and a ship floats on Sea.
    Ship,
}

/// A building or construction site (`Building`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Building {
    pub id: String,
    pub kind: BuildingKind,
    pub city_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub site: Option<ConstructionSite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub teardown: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub closed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub damage: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub breedings: Option<Vec<KeptBreeding>>,
}

/// The breeding progress a stable keeps for two horses in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeptBreeding {
    pub horse_ids: [String; 2],
    pub progress: f64,
}

/// How far a construction site has come (`CONTEXT.md`: Construction site).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ConstructionSite {
    pub delivered: Stock,
    pub work: f64,
}

/// An animal that pulls a carriage (`CONTEXT.md`: Horse).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Horse {
    pub id: String,
    pub name: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub hunger: f64,
    pub health: f64,
    pub stats: HorseStats,
    pub born_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub down_until: Option<f64>,
}

/// A horse-drawn cart (`CONTEXT.md`: Carriage).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Carriage {
    pub id: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub horse_id: Option<String>,
    pub load: Stock,
}

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
}

/// What a resource node yields once worked (`ResourceKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Forest,
    Stone,
    IronOre,
    GoldOre,
}

/// A spot on the map that never runs out (`ResourceNode`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResourceNode {
    pub id: String,
    pub kind: ResourceKind,
    pub x: f64,
    pub y: f64,
}
