//! The events a Player is told of: `RealmEvent` and the details its kinds carry. The kinds
//! themselves are in `event_kinds`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

use super::RealmEventWhat;

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
