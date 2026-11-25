//! The kinds of event (`RealmEventWhat`), one variant each. The types made for its fields are in
//! `events`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    AllianceLeftWhy, BuildingKind, CarriedNote, ContractSide, ContractWhat, CrimeKind, DeathCause,
    DebtWhat, DeliveryKind, DemandHandedOver, DemandOtherIs, DemandSide, DemandTerms, DemandWhat,
    DirectOfferWhat, DroppedFieldScript, EndedWithHq, Good, HeirLapse, HorsesWhere, OfferEnd,
    PricedGood, PunishedWhat, PunishedWhere, PunishmentEnd, ResourceKind, SelfManagedCity,
    StandingMove, Stock, SwapPlace, TradeSide, TransferStuckWhy, VeinWord,
};

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
        /// The heir who takes over the realm of a Leader who died (`CONTEXT.md`: Leader death
        /// with an heir).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        heir: Option<String>,
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
        /// The boat taken is a ship (`CONTEXT.md`: Sailing), so the log names it one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        ship: Option<bool>,
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
        /// The boat taken is a ship (`CONTEXT.md`: Sailing), so the log names it one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        ship: Option<bool>,
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
        /// The boat taken is a ship (`CONTEXT.md`: Sailing), so the log names it one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "true")]
        ship: Option<bool>,
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
        /// The heartland the starting city stands in, if it stands in one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        heartland: Option<String>,
    },
    /// The Leader died and the heir took over the realm, keeping only `city`, the one they live
    /// in; `cities` are the realm's others, now self-managed (`CONTEXT.md`: Leader death with an
    /// heir).
    HeirTookOver {
        heir_id: String,
        heir: String,
        city_id: String,
        city: String,
        x: f64,
        y: f64,
        cities: Vec<SelfManagedCity>,
    },
    /// The heir no longer qualifies and the realm has none (`CONTEXT.md`: Heir).
    HeirLapsed {
        heir_id: String,
        heir: String,
        why: HeirLapse,
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
    /// A drifter stepped into the city the realm's Leader lives in and joined it (`CONTEXT.md`:
    /// Drifter).
    DrifterJoined {
        resident_id: String,
        name: String,
        city: String,
        x: f64,
        y: f64,
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
    /// A workplace's vein ran dry (`CONTEXT.md`: Running dry): it makes nothing from now on.
    VeinRanDry {
        building_id: String,
        node: ResourceKind,
        x: f64,
        y: f64,
    },
    /// The vein of a workplace a realm works turned to thinning or to nearly gone (`CONTEXT.md`:
    /// Running dry): said once at each step.
    VeinTurned {
        building_id: String,
        node: ResourceKind,
        x: f64,
        y: f64,
        vein: VeinWord,
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
    /// A condition of the resident's queue asked about a place that is gone or no longer the
    /// realm's, and counted as false (`CONTEXT.md`: Condition).
    ConditionPlaceGone {
        resident_id: String,
        name: String,
        place_id: String,
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
