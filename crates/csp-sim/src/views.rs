//! The views the client imports that a query in this crate builds (T88.1, ADR 0030): a Player's
//! diplomacy card and its parts (`alliance.ts`, `direct-offer.ts`, `warehouse.ts`,
//! `persuasion.ts`, `demand.ts`), the admin's directives and places (`api.ts`, `admin-map.ts`) and
//! the quotes the trade screens show (`offers.ts`, `swap.ts`). Written so `ts-rs` generates the
//! TypeScript the client already uses; the queries that fill them come with the Rust server's
//! protocol port, until then the server sends these as plain JSON values.

use csp_shared::world::{AllianceArmyPart, DeliveryKind, DemandTerms, Heading, PricedGood};
use ts_rs::TS;

use crate::admin_map::AdminPlace;
use crate::directive::DirectiveView;
use crate::directives::{AdminDirectiveView, DirectiveTarget};
use crate::queries::contract::{ContractView, RealmLabel};
use crate::queries::standing::StandingView;
use crate::queries::warehouse_trade::TradeLimit;

/// An alliance by id and name (`{ id, name }` in `AdminPlaces`).
#[derive(Debug, Clone, PartialEq, Eq, TS)]
pub struct AllianceName {
    pub id: String,
    pub name: String,
}

/// A way a Direct offer can be carried (`CarriedWay`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct CarriedWay {
    pub from_city_id: String,
    pub to_city_id: String,
    pub sender_tiles: f64,
    pub other_tiles: f64,
}

/// A delivery or pick-up not yet done, as the realm sees it (`DeliveryView`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct DeliveryView {
    pub id: String,
    pub kind: DeliveryKind,
    #[ts(as = "PricedGood")]
    pub good: csp_shared::world::Good,
    pub units: f64,
    pub city_id: String,
    pub city: String,
    /// The warehouse it was ordered at.
    pub x: f64,
    pub y: f64,
    /// Whether a caravan is on its way with it; else it waits for one at the warehouse.
    pub underway: bool,
}

/// A demand the realm sent or was sent (`DemandView`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct DemandView {
    pub id: String,
    pub from: RealmLabel,
    pub to: RealmLabel,
    pub terms: DemandTerms,
    /// The sender's words: plain text, never markup.
    pub note: String,
    pub sent_at: f64,
    pub deadline: f64,
}

/// An NPC city asking the realm to join it (`JoinRequestView`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct JoinRequestView {
    pub city_id: String,
    pub city: String,
    pub at: f64,
    pub x: f64,
    pub y: f64,
}

/// A Direct offer the realm sent or was sent, still standing (`DirectOfferView`): the offer as
/// seen, with its terms, both sides, the storage's city and, for a carried one, where it goes.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(type = "SeenOffer & {
  direct: DirectOfferTerms
  from: RealmLabel
  to: RealmLabel
  city: string | null
  toCity?: string
}")]
pub struct DirectOfferView;

/// A member of the Player's alliance (`Diplomacy.alliance.members`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AllianceMemberView {
    #[ts(flatten)]
    pub label: RealmLabel,
    pub joined_at: f64,
    pub leaves_at: Option<f64>,
}

/// A part of the alliance army with its realm (`Diplomacy.alliance.army`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AllianceArmyPartView {
    #[ts(flatten)]
    pub label: RealmLabel,
    #[ts(flatten)]
    pub part: AllianceArmyPart,
}

/// The Player's alliance (`Diplomacy.alliance`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AllianceCard {
    pub id: String,
    pub name: String,
    pub leader_id: String,
    /// In the order they joined.
    pub members: Vec<AllianceMemberView>,
    pub invites: Vec<RealmLabel>,
    /// The alliance army: each part with its realm, and when a recall brings it back.
    pub army: Vec<AllianceArmyPartView>,
}

/// An alliance whose leader invited the Player's realm (`Diplomacy.invitations`).
#[derive(Debug, Clone, PartialEq, Eq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AllianceInvitation {
    pub alliance_id: String,
    pub name: String,
    pub leader: String,
}

/// Everything a Player sees of their dealings with other realms (`Diplomacy`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct Diplomacy {
    /// The Player's alliance; null when in none.
    pub alliance: Option<AllianceCard>,
    pub invitations: Vec<AllianceInvitation>,
    /// Realms outside their alliance the Player sees residents of, and NPC cities outside it they
    /// see, who could be invited.
    pub realms_in_sight: Vec<RealmLabel>,
    /// Mercenary contracts the realm is a side of, offered or in force.
    pub contracts: Vec<ContractView>,
    /// Demands the realm sent or was sent, waiting for an answer.
    pub demands: Vec<DemandView>,
    /// The other realms it knows of, whom it can send a demand.
    pub known_realms: Vec<RealmLabel>,
    /// The Trade Organization and the NPC cities it knows of, whom it can too.
    pub known_npc_orgs: Vec<RealmLabel>,
    /// Direct offers the realm sent or was sent, still standing.
    pub direct_offers: Vec<DirectOfferView>,
    /// The other realms it knows of, whom it can send a Direct offer.
    pub direct_offer_realms: Vec<RealmLabel>,
    /// The ways it can name for a carried Direct offer, when it sees a storage to go to.
    #[ts(optional)]
    pub carried_ways: Option<Vec<CarriedWay>>,
    /// The realm's deliveries and pick-ups not yet done.
    pub deliveries: Vec<DeliveryView>,
    /// Standing between the realm and other Organizations, shown only.
    pub standings: Vec<StandingView>,
    /// NPC cities asking the realm to join it.
    pub join_requests: Vec<JoinRequestView>,
    /// Admin directives in force: their targets and reasons, never who gave them.
    pub directives: Vec<DirectiveView>,
    /// The Trade Org HQ has fallen, so no caravans run and nobody can order a delivery or transfer.
    #[ts(optional, type = "true")]
    pub no_caravans: Option<bool>,
    /// The Coins the realm owes the Trade Organization; none when none.
    #[ts(optional)]
    pub debt: Option<f64>,
}

/// The admin's list of directives and whom they can name (`AdminDirectives`).
#[derive(Debug, Clone, PartialEq, TS)]
pub struct AdminDirectives {
    pub directives: Vec<AdminDirectiveView>,
    pub targets: Vec<DirectiveTarget>,
}

/// A realm on the admin's jump list (`AdminPlaces.realms`).
#[derive(Debug, Clone, PartialEq, TS)]
pub struct AdminRealmPlaces {
    pub id: String,
    /// The Player's account name; null if the account is gone.
    pub account: Option<String>,
    /// The realm by its realm name.
    pub name: String,
    pub alliance: Option<AllianceName>,
    /// Where its Leader stands; null while it has none.
    pub leader: Option<AdminPlace>,
    pub cities: Vec<AdminPlace>,
}

/// An NPC city on the admin's jump list (`AdminPlaces.npcCities`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AdminNpcCityPlace {
    #[ts(flatten)]
    pub place: AdminPlace,
    /// Once a Player's, left without a Leader.
    pub self_managed: bool,
    pub alliance: Option<AllianceName>,
}

/// A caravan on the admin's jump list: where its carriage is, named after its trading post.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AdminCaravanPlace {
    #[ts(flatten)]
    pub place: AdminPlace,
    pub post_id: String,
    pub heading: Heading,
}

/// The Trade Organization on the admin's jump list (`AdminPlaces.tradeOrg`).
#[derive(Debug, Clone, PartialEq, TS)]
pub struct AdminTradeOrgPlaces {
    pub hq: Option<AdminPlace>,
    pub posts: Vec<AdminPlace>,
    /// Each where its carriage is, named after its trading post.
    pub caravans: Vec<AdminCaravanPlace>,
    /// Each where its carriage is, named after the post it goes to next.
    pub traders: Vec<AdminPlace>,
}

/// An army on the admin's jump list: where one of its members stands.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AdminArmyPlace {
    #[ts(flatten)]
    pub place: AdminPlace,
    pub realm_id: String,
    pub realm: String,
}

/// Where everything an admin might jump to stands (`AdminPlaces`).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AdminPlaces {
    pub tick: f64,
    pub realms: Vec<AdminRealmPlaces>,
    pub npc_cities: Vec<AdminNpcCityPlace>,
    pub trade_org: AdminTradeOrgPlaces,
    /// Each where one of its members stands; an army with none left is not listed.
    pub armies: Vec<AdminArmyPlace>,
}

/// What a swap or a set of offers would do (`OfferQuote`).
#[derive(Debug, Clone, Copy, PartialEq, TS)]
pub struct OfferQuote {
    pub times: f64,
    pub gives: f64,
    pub wants: f64,
    /// What cut it short of the times wanted, if anything did.
    #[ts(optional)]
    pub limit: Option<TradeLimit>,
}

/// What a swap trades at the place's prices (`SwapRate`).
#[derive(Debug, Clone, Copy, PartialEq, TS)]
pub struct SwapRate {
    pub give: PricedGood,
    pub gives: f64,
    pub want: PricedGood,
    pub units: f64,
}
