//! What a Player sees (`CONTEXT.md`: Sight): the `Seen*` views of `packages/shared/src/protocol.ts`
//! and `world.ts` that sight hands out and sync sends. They serialise to the JSON the TypeScript
//! server sends, field for field, since the client reads them unchanged until the cutover
//! (ADR 0030). A field the TypeScript leaves out is an `Option` skipped when `None`; one it sends
//! as `null` is an `Option` without the skip.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::world::horse_market::NpcHorseOffer;
use crate::world::npc_trade::ShownNpcCityPrice;
use crate::world::offers::SeenOffer;
use crate::world::protocol::Hire;
use crate::world::warehouse::ShownWarehousePrice;
use crate::world::{
    AlarmScriptId, ArmyOrder, Building, BuildingKind, Carrying, City, Good, Heading, HorseStats,
    OrderEnded, Pair, Pile, PricedGood, Queue, ResidentOrder, ScriptParamValue, ScriptParamValues,
    SkillName, Stat, StatRecord, Stock, Struck, Task, Tile, VesselKind,
};

/// How heavily a carriage looks loaded to a Player who can't see its load (`LoadLevel`,
/// `CONTEXT.md`: Seeing inside a storage).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum LoadLevel {
    Empty,
    Light,
    Half,
    Heavy,
    Full,
}

/// The line a Build line task builds (`BuildLine`, `TaskMemory`): a road or wall from one tile to
/// another.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct BuildLine {
    /// Only a road or a wall is built along a line.
    #[ts(type = "\"road\" | \"wall\"")]
    pub building: BuildingKind,
    pub from: Tile,
    pub to: Tile,
}

/// What a Player sees of the script a resident runs (`SeenScript`): which one, and for the owning
/// Player what goes into the resident's Doing line (`CONTEXT.md`: Doing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenScript {
    pub script_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub task: Option<Task>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub building: Option<BuildingKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub doing: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<BuildLine>,
    /// Always `true` when present (`waiting?: true`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub waiting: Option<bool>,
    /// Always `true` when present (`site?: true`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub site: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub params: Option<IndexMap<String, ScriptParamValue>>,
}

impl SeenScript {
    /// Which script it is and nothing more: what anyone but the owning Player sees.
    pub fn only(script_id: u64) -> Self {
        SeenScript {
            script_id,
            task: None,
            building: None,
            doing: None,
            line: None,
            waiting: None,
            site: None,
            settings_from: None,
            params: None,
        }
    }
}

/// What a defence script interrupted, as the owning Player sees it (`SeenInterrupted`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SeenInterrupted {
    pub order: Option<ResidentOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<SeenScript>,
}

/// A resident as Players see them (`SeenResident`): the fields of `Resident` but their script's
/// memory, script log and whether an order stands against blows; how they fare (hunger, health,
/// when a strike or Down ends) only for their own realm and allies, their script params only for
/// the realm commanding them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenResident {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub health: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hunger: Option<f64>,
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
    pub script: Option<SeenScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interrupted: Option<SeenInterrupted>,
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
    /// Set (to `true`) while they are Down, which anyone in sight sees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub down: Option<bool>,
}

/// A building as Players see it (`SeenBuilding`): its stock and a stable's breeding progress only
/// when they see inside, a Trade Org warehouse's prices and a storage's offers either way.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SeenBuilding {
    #[serde(flatten)]
    pub building: Building,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prices: Option<Vec<ShownWarehousePrice>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offers: Option<Vec<SeenOffer>>,
}

/// A city as Players see it (`SeenCity`): the fields of `City` but what its scouts brought home,
/// who is in its area and whom it is alarmed by; who occupies it only with its town hall in sight;
/// for an NPC city its price or that it won't sell, that it refuses them, what it would lend and
/// its trade prices, and its horses in sight at its stables.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SeenCity {
    #[serde(flatten)]
    pub city: City,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub price: Option<f64>,
    /// Always `true` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub wont_sell: Option<bool>,
    /// Always `true` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub refuses: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hire: Option<Hire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub trade: Option<Vec<ShownNpcCityPrice>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub horses: Option<Vec<NpcHorseOffer>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub horses_to_sell: Option<Vec<NpcHorseOffer>>,
}

/// A horse as Players see it (`SeenHorse`): its hunger and health, and when its Down ends, only for
/// its own realm and allies; that it is Down for anyone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenHorse {
    pub id: String,
    pub name: String,
    pub realm_id: Option<String>,
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hunger: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub health: Option<f64>,
    pub stats: HorseStats,
    pub born_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub down_until: Option<f64>,
    /// Set (to `true`) while it is Down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub down: Option<bool>,
}

/// What `SeenCarriage` is in TypeScript, written out: `Carriage` with a load or a load level, and
/// `loadLevel`, `passengerIds` and `standsStill` optional as the TypeScript has them, though the
/// server always sends them.
#[derive(TS)]
#[ts(
    type = "(Carriage & { loadLevel?: LoadLevel } | Omit<Carriage, 'load'> & { load?: undefined, loadLevel: LoadLevel }) & { passengerIds?: string[], standsStill?: boolean }",
    rename = "SeenCarriage"
)]
struct SeenCarriageTwin;

/// A carriage as Players see it (`SeenCarriage`): how heavily it is loaded, its load only for
/// those who see inside, who is aboard and whether anything moves it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(as = "SeenCarriageTwin")]
pub struct SeenCarriage {
    pub id: String,
    #[serde(rename = "realmId")]
    pub realm_id: Option<String>,
    #[serde(rename = "cityId")]
    pub city_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "horseId")]
    pub horse_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub load: Option<Stock>,
    #[serde(rename = "loadLevel")]
    pub load_level: LoadLevel,
    #[serde(rename = "passengerIds")]
    pub passenger_ids: Vec<String>,
    #[serde(rename = "standsStill")]
    pub stands_still: bool,
}

/// A vessel as Players see it (`CONTEXT.md`: Vessel, Vessels in sight): how heavily it is loaded,
/// its load only for those who see inside (its own realm and allies, as for a carriage).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenVessel {
    pub id: String,
    pub kind: VesselKind,
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub load: Option<Stock>,
    pub load_level: LoadLevel,
    /// The residents aboard it as passengers (`CONTEXT.md`: Beside a vessel).
    pub passenger_ids: Vec<String>,
    /// The one aboard at its oars, no passenger (`CONTEXT.md`: Rowing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rower_id: Option<String>,
    /// A ship's crew aboard, no passengers (`CONTEXT.md`: Crew); a boat has none.
    pub crew_ids: Vec<String>,
    /// The haven a ship is docked at (`CONTEXT.md`: Docked); none for a boat or a ship at sea.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub docked_at: Option<String>,
}

/// Which script an army runs, without its memory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptIdOnly {
    pub script_id: u64,
}

/// An army as its Player sees it (`SeenArmy`): which script it runs, not its memory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenArmy {
    pub id: String,
    pub name: String,
    pub realm_id: String,
    pub member_ids: Vec<String>,
    pub order: Option<ArmyOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<ScriptIdOnly>,
}

/// A caravan as Players see it while its carriage or any of its crew is in sight (`SeenCaravan`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenCaravan {
    pub id: String,
    pub post_id: String,
    pub carriage_id: String,
    pub driver_id: Option<String>,
    pub escort_ids: Vec<String>,
    pub heading: Heading,
}

/// Where a wandering trader stands at a stop, and until when (`StandingTrader`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandingTrader {
    pub city_id: String,
    pub x: f64,
    pub y: f64,
    pub until: f64,
}

/// A wandering trader's price line as a Player saw it (`Shown<TraderPrice>`): what it holds only
/// when they see inside its carriage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ShownTraderPrice {
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub buy: f64,
    pub sell: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stock: Option<f64>,
}

/// A wandering trader as Players see it (`SeenTrader`): where it stands and its prices while it
/// stands at a stop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenTrader {
    pub id: String,
    pub post_id: String,
    pub carriage_id: String,
    pub driver_id: Option<String>,
    pub escort_ids: Vec<String>,
    pub heading: Heading,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub standing: Option<StandingTrader>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prices: Option<Vec<ShownTraderPrice>>,
}

/// Something a Player sees (`SeenEntity`), tagged by `is`. Ids are unique across all of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "is", rename_all = "camelCase")]
pub enum SeenEntity {
    /// Boxed: a resident carries far more than anything else seen.
    Resident(Box<SeenResident>),
    Building(SeenBuilding),
    City(SeenCity),
    Horse(SeenHorse),
    Carriage(SeenCarriage),
    Pile(Pile),
    /// One of the Player's own armies; its members are what is seen of it.
    Army(SeenArmy),
    /// A Trade Org caravan; its carriage and crew are what is seen of it.
    Caravan(SeenCaravan),
    /// A wandering trader, seen the same way.
    Trader(SeenTrader),
    /// A boat (later a ship) on the water.
    Vessel(SeenVessel),
}

impl SeenEntity {
    /// Its id.
    pub fn id(&self) -> &str {
        match self {
            SeenEntity::Resident(e) => &e.id,
            SeenEntity::Building(e) => &e.building.id,
            SeenEntity::City(e) => &e.city.id,
            SeenEntity::Horse(e) => &e.id,
            SeenEntity::Carriage(e) => &e.id,
            SeenEntity::Pile(e) => &e.id,
            SeenEntity::Army(e) => &e.id,
            SeenEntity::Caravan(e) => &e.id,
            SeenEntity::Trader(e) => &e.id,
            SeenEntity::Vessel(e) => &e.id,
        }
    }

    /// What it is: its `is` tag.
    pub fn is(&self) -> &'static str {
        match self {
            SeenEntity::Resident(_) => "resident",
            SeenEntity::Building(_) => "building",
            SeenEntity::City(_) => "city",
            SeenEntity::Horse(_) => "horse",
            SeenEntity::Carriage(_) => "carriage",
            SeenEntity::Pile(_) => "pile",
            SeenEntity::Army(_) => "army",
            SeenEntity::Caravan(_) => "caravan",
            SeenEntity::Trader(_) => "trader",
            SeenEntity::Vessel(_) => "vessel",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_seen_building_is_its_building_with_the_tag_and_prices() {
        let b: Building = serde_json::from_value(json!({
            "id": "b1", "kind": "storage", "cityId": "c1", "x": 3, "y": 4, "stock": { "food": 2 }
        }))
        .unwrap();
        let mut seen = SeenBuilding { building: b, prices: None, offers: None };
        seen.building.stock = None;
        let e = SeenEntity::Building(seen);
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({ "is": "building", "id": "b1", "kind": "storage", "cityId": "c1", "x": 3.0, "y": 4.0 })
        );
        let back: SeenEntity = serde_json::from_value(serde_json::to_value(&e).unwrap()).unwrap();
        assert_eq!(back, e);
        assert_eq!(e.id(), "b1");
        assert_eq!(e.is(), "building");
    }

    #[test]
    fn a_load_level_is_its_name() {
        assert_eq!(serde_json::to_value(LoadLevel::Heavy).unwrap(), json!("heavy"));
    }
}
