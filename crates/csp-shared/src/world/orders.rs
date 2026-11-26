//! The orders a resident can have (`ResidentOrder`): one struct each with its progress, and how
//! the last one ended.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    BuildingKind, EquipSlot, Good, GoodsPlace, GoodsSpot, GoodsWanted, PricedGood, Stock, Tile,
    TilePath, TrainingSubject, WallMaterial,
};

/// Swapping an item into a slot or taking one off (`CONTEXT.md`: Equipment): it takes
/// `EQUIP_TICKS`, and the resident strikes no blows meanwhile. `good` is what goes into `slot`,
/// `None` to take its item off (it stays carried). `progress` counts the ticks spent on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EquipOrder {
    pub slot: EquipSlot,
    pub good: Option<Good>,
    pub progress: f64,
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

/// Strolling to a tile (trial).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrollOrder {
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
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

/// Which kind of order ended (`OrderEnded.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OrderEndedKind {
    Store,
    Fetch,
    Relocate,
    /// Gathering by hand (`CONTEXT.md`: Gathering): ended with full hands or a picked-over tile.
    Gather,
}

/// How a resident's last store, fetch, relocate or gather order ended.
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
    /// What a wall or gate is built of; none is wood (`CONTEXT.md`: Wall / Gate, Wood or stone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub material: Option<WallMaterial>,
}

/// Gathering a good by hand from the patch of the tile the resident stands on (`CONTEXT.md`:
/// Gathering, Patch): `progress` is their share of the next unit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatherOrder {
    pub good: Good,
    pub at: Tile,
    pub progress: f64,
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
    /// At a smithy, mending worn gear instead of making anything (`CONTEXT.md`: Mending).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub mends: bool,
}

/// Repairing a worn building (`CONTEXT.md`: Repairing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairOrder {
    pub building_id: String,
    pub at: Tile,
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
/// the boat goes a Step at a time over water along `path`. Sailing a ship (`Sail`) holds the same:
/// the captain is one of its crew, and the ship goes over Sea only (`CONTEXT.md`: Sailing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowOrder {
    pub vessel_id: String,
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// Walking to a siege machine to join its crew (`CONTEXT.md`: Siege machine): once on its tile the
/// resident is one of its crew and the order is done.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrewOrder {
    pub machine_id: String,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// Pushing a siege machine to a tile (`CONTEXT.md`: Siege machine): the pusher is one of its crew,
/// and the machine goes a Step at a time along a way a carriage could take, its crew with it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushOrder {
    pub machine_id: String,
    pub target: Tile,
    pub path: Option<TilePath>,
    pub progress: f64,
}

/// Ramming a wall or gate (`CONTEXT.md`: Ram): one of a ram's crew swings it, with its whole crew,
/// at the wall or gate next to it; `progress` builds up to its next strike.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RamOrder {
    pub machine_id: String,
    pub target_id: String,
    pub progress: f64,
}

/// Throwing Stone at a wall, gate or tower (`CONTEXT.md`: Catapult): one of a catapult's crew aims
/// it, with its whole crew, at a building in its reach; `progress` builds up to its next shot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThrowOrder {
    pub machine_id: String,
    pub target_id: String,
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
    /// What a wall line builds of; none is wood (`CONTEXT.md`: Wall / Gate, Wood or stone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub material: Option<WallMaterial>,
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
    Stroll(StrollOrder),
    Drive(DriveOrder),
    Haul(HaulOrder),
    PickUp(PickUpOrder),
    Drop(DropOrder),
    Store(StoreOrder),
    Fetch(FetchOrder),
    Build(BuildOrder),
    TearDown(TearDownOrder),
    Repair(RepairOrder),
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
    /// Sailing a ship to a Sea tile or a haven, its captain one of its crew (`CONTEXT.md`: Sailing).
    Sail(RowOrder),
    /// Swapping or taking off gear (`CONTEXT.md`: Equipment).
    Equip(EquipOrder),
    /// Walking to a siege machine of the realm to join its crew (`CONTEXT.md`: Siege machine).
    Crew(CrewOrder),
    /// Pushing a siege machine to a tile, as one of its crew (`CONTEXT.md`: Siege machine).
    Push(PushOrder),
    /// Swinging a ram at the wall or gate next to it, as one of its crew (`CONTEXT.md`: Ram).
    Ram(RamOrder),
    /// Throwing Stone with a catapult at a wall, gate or tower in its reach, as one of its crew
    /// (`CONTEXT.md`: Catapult).
    Throw(ThrowOrder),
    /// Gathering by hand on a Forest or Hills tile (`CONTEXT.md`: Gathering).
    Gather(GatherOrder),
    /// The Leader rallying the crew of the workplace or site they are at (`CONTEXT.md`: Rallying
    /// the crew). Given by the Player by hand only (ADR 0042).
    Rally(RallyOrder),
}

/// Rallying the crew of a workplace or construction site (`CONTEXT.md`: Rallying the crew).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RallyOrder {
    /// The workplace or site the Leader stands at.
    pub building_id: String,
    /// The last tick somebody of the realm worked there at the rallied pace, for the drain: Zeal
    /// drains only while somebody is being rallied. None until then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worked_at: Option<f64>,
}
