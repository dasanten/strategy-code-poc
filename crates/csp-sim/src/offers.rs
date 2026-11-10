//! Offers and Direct offers (`apps/server/src/offers.ts`, `CONTEXT.md`: Offer, Direct offer): the
//! orders that post, send, accept, decline and take down offers, accepting them as the world
//! steps, and offers following their storages at the end of each tick.

use csp_shared::balance::{DIRECT_OFFER_DAYS, MAP_SIZE, WAREHOUSE_BASE_PRICE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    AcceptOfferOrder, Building, CarriedFeeBy, CarriedNote, CarriedOfferTerms, CarriedTransfer,
    DirectOfferTerms, DirectOfferWhat, Good, Offer, OfferEnd, OrderRequest, RealmEventWhat,
    ResidentOrder, Stock, Transfer, WorldState,
};
use serde_json::{Map, Value};

use crate::events::record_event;
use crate::goods_deps::new_id;
use crate::invariants::InvariantViolation;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::OrderKind;
use crate::queries::alliance::{carriage_commander_of, commander_of};
use crate::queries::demand::answered_by_game;
use crate::queries::direct_offer::{
    accept_carried_problem, carried_offer_fees, carried_offer_problem, carried_unload_shares,
    decline_offer_problem, direct_offer_problem, realms_to_offer_to, CarriedRequest, OfferGoods,
};
use crate::queries::goods::goods_capacity;
use crate::queries::names::{good_name, good_of, placed};
use crate::queries::offers::{
    accept_offer_problem, offer_open_to, offer_storage, post_offer_problem, quote_offer,
    times_to_post, wants_nothing,
};
use crate::queries::standing::{organization_label, TRADE_ORG};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::transfer::{nearest_warehouse, transfer_load};
use crate::queries::warehouse_trade::{delivery_storage, hands_of, load_of};
use crate::sight::{sight_of, Spot};
use crate::standing::raise_standing_by_trade;
use crate::world_index::WorldIndex;

fn text<'o>(f: &'o Map<String, Value>, k: &str) -> Option<&'o str> {
    f.get(k).and_then(Value::as_str)
}

fn num(f: &Map<String, Value>, k: &str) -> f64 {
    f.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}

/// The Player's realm id (`realmOf`).
fn realm_id_of(world: &WorldState, sender: &OrderSender) -> Option<String> {
    world.realms.iter().find(|r| r.user_id == sender.user_id).map(|r| r.id.clone())
}

/// When a Direct offer sent now lapses.
fn lapses_at(world: &WorldState) -> f64 {
    world.tick as f64 + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY
}

/// The terms of an offer as the realm log tells them (`terms`).
struct Terms {
    gives: Good,
    gives_units: f64,
    wants: Good,
    wants_units: f64,
    x: f64,
    y: f64,
}

fn terms(o: &Offer) -> Terms {
    Terms {
        gives: o.gives,
        gives_units: o.gives_units,
        wants: o.wants,
        wants_units: o.wants_units,
        x: o.x,
        y: o.y,
    }
}

/// The checked terms of an offer, from an order's fields.
fn checked_goods(f: &Map<String, Value>) -> OfferGoods {
    let good = |k: &str| text(f, k).and_then(good_of).expect("checked");
    OfferGoods {
        gives: good("gives"),
        gives_units: num(f, "givesUnits"),
        wants: good("wants"),
        wants_units: num(f, "wantsUnits"),
        times: num(f, "times"),
    }
}

/// A new offer on checked terms at the realm's storage, its goods set aside from now on
/// (`standOffer`); its index in `world.offers`.
fn stand_offer(
    world: &mut WorldState,
    realm_id: &str,
    f: &Map<String, Value>,
    direct: Option<DirectOfferTerms>,
) -> usize {
    let storage =
        offer_storage(world, realm_id, text(f, "storageId").unwrap_or_default()).expect("checked");
    let g = checked_goods(f);
    let times = times_to_post(world, storage, g.gives, g.gives_units, g.times);
    let (storage_id, x, y) = (storage.id.clone(), storage.x, storage.y);
    let offer = Offer {
        id: new_id(world, "offer"),
        realm_id: realm_id.to_string(),
        storage_id,
        x,
        y,
        gives: g.gives,
        gives_units: g.gives_units,
        wants: g.wants,
        wants_units: g.wants_units,
        times,
        direct,
    };
    world.offers.push(offer);
    world.offers.len() - 1
}

/// The goods of an accepted demand, set aside at a storage of the realm that accepted it, for the
/// demand's sender alone to fetch (`setAsideForDemand`, `CONTEXT.md`: Demand). They stand as a
/// Direct offer in person for each good, wanting nothing back, one unit at a time. Returns the
/// offers' ids.
pub fn set_aside_for_demand(
    world: &mut WorldState,
    realm_id: &str,
    to_id: &str,
    storage: &Building,
    goods: &Stock,
) -> Vec<String> {
    let lapses_at = lapses_at(world);
    let mut ids = Vec::new();
    for (&good, &units) in goods {
        let id = new_id(world, "offer");
        world.offers.push(Offer {
            id: id.clone(),
            realm_id: realm_id.to_string(),
            storage_id: storage.id.clone(),
            x: storage.x,
            y: storage.y,
            gives: good,
            gives_units: 1.0,
            // It wants none of this: an offer's two goods just always differ.
            wants: if good == Good::Coins { Good::Food } else { Good::Coins },
            wants_units: 0.0,
            times: units,
            direct: Some(DirectOfferTerms { to_id: to_id.to_string(), lapses_at, carried: None }),
        });
        ids.push(id);
    }
    ids
}

/// The post-offer order (`postOffer`, `CONTEXT.md`: Offer): a Player posts an offer at a storage
/// of their realm, wherever their residents are, up to `times` over.
pub struct PostOffer;

impl OrderKind for PostOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_id_of(world, sender) else {
            return Some("you have no realm".into());
        };
        post_offer_problem(world, &realm, &order.fields).map(str::to_string)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let Some(realm) = realm_id_of(world, sender) else { return };
        // Something may have taken the goods or the storage since the order came.
        if post_offer_problem(world, &realm, &order.fields).is_some() {
            return;
        }
        stand_offer(world, &realm, &order.fields, None);
    }
}

/// Whether the realm has anyone of `other_id`'s in sight (`seesResidentsOf`).
fn sees_residents_of(world: &WorldState, realm_id: &str, other_id: &str, size: i32) -> bool {
    let index = WorldIndex::new(world, size);
    let eyes = sight_of(world, &index, realm_id, None);
    world
        .residents
        .iter()
        .any(|r| r.owner.as_deref() == Some(other_id) && eyes.sees(Spot { x: r.x, y: r.y }))
}

/// Whether the realm sees the storage of a city it would send goods to (`seesStorageOf`).
pub fn sees_storage_of(
    world: &WorldState,
    realm_id: &str,
    city_id: Option<&str>,
    size: i32,
) -> bool {
    let Some(storage) = city_id.and_then(|id| delivery_storage(world, id)) else { return false };
    let index = WorldIndex::new(world, size);
    sight_of(world, &index, realm_id, None).sees(Spot { x: storage.x, y: storage.y })
}

/// Whether the realm knows of `to_id`, as sending it a Direct offer needs (`knowsOf`).
fn knows_of(world: &WorldState, realm_id: &str, to_id: Option<&str>, size: Option<i32>) -> bool {
    let Some(to_id) = to_id else { return false };
    realms_to_offer_to(world, realm_id, []).iter().any(|r| r == to_id)
        || size.is_some_and(|size| sees_residents_of(world, realm_id, to_id, size))
}

/// Why the realm can't send this Direct offer (`sendProblem`).
fn send_problem(
    world: &WorldState,
    realm_id: &str,
    f: &Map<String, Value>,
    size: Option<i32>,
) -> Option<String> {
    let to_id = text(f, "toId");
    if let Some(p) = direct_offer_problem(world, realm_id, to_id, f) {
        return Some(p);
    }
    (!knows_of(world, realm_id, to_id, size)).then(|| "you don’t know of that realm".into())
}

fn carried_request(f: &Map<String, Value>) -> CarriedRequest<'_> {
    CarriedRequest {
        from_city_id: f.get("fromCityId"),
        to_city_id: f.get("toCityId"),
        fee_by: f.get("feeBy"),
    }
}

/// Why the realm can't send this carried Direct offer (`sendCarriedProblem`).
fn send_carried_problem(
    world: &WorldState,
    realm_id: &str,
    f: &Map<String, Value>,
    size: Option<i32>,
) -> Option<String> {
    let to_id = text(f, "toId");
    if let Some(p) = carried_offer_problem(world, realm_id, to_id, &carried_request(f), f) {
        return Some(p);
    }
    if size.is_some_and(|size| !sees_storage_of(world, realm_id, text(f, "toCityId"), size)) {
        return Some("you don’t see that city’s storage".into());
    }
    (!knows_of(world, realm_id, to_id, size)).then(|| "you don’t know of that realm".into())
}

/// The send-direct-offer order (`sendDirectOffer`, `CONTEXT.md`: Direct offer): an offer at a
/// storage of the Player's realm that only the named realm can accept until it lapses. The other
/// side hears at once.
pub struct SendDirectOffer;

impl OrderKind for SendDirectOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_id_of(world, sender) else {
            return Some("you have no realm".into());
        };
        send_problem(world, &realm, &order.fields, terrain.map(|t| t.size))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let Some(realm) = realm_id_of(world, sender) else { return };
        // Something may have taken the goods, the storage or the other realm since the order came.
        if send_problem(world, &realm, f, terrain.map(|t| t.size)).is_some() {
            return;
        }
        let to_id = text(f, "toId").expect("checked").to_string();
        let direct =
            DirectOfferTerms { to_id: to_id.clone(), lapses_at: lapses_at(world), carried: None };
        let i = stand_offer(world, &realm, f, Some(direct));
        let t = terms(&world.offers[i]);
        let times = world.offers[i].times;
        let from = organization_label(world, &realm);
        record_event(
            world,
            Some(&to_id),
            direct_offer_event(DirectOfferWhat::Received, from, None, Some(times), None, t),
        );
    }
}

fn direct_offer_event(
    what: DirectOfferWhat,
    from: String,
    from_city: Option<bool>,
    times: Option<f64>,
    carried: Option<CarriedNote>,
    t: Terms,
) -> RealmEventWhat {
    RealmEventWhat::DirectOffer {
        what,
        from,
        from_city,
        gives: t.gives,
        gives_units: t.gives_units,
        wants: t.wants,
        wants_units: t.wants_units,
        times,
        carried,
        x: t.x,
        y: t.y,
    }
}

/// A city's name for the realm log (`cityName`).
fn city_name(world: &WorldState, city_id: &str) -> String {
    world
        .cities
        .iter()
        .find(|c| c.id == city_id)
        .map_or_else(|| "a lost city".into(), |c| c.name.clone())
}

/// A carried offer's cities and what `fee` a side pays, as its log line tells them
/// (`carriedLine`).
fn carried_line(world: &WorldState, c: &CarriedOfferTerms, fee: f64) -> CarriedNote {
    CarriedNote {
        from_city: city_name(world, &c.from_city_id),
        to_city: city_name(world, &c.to_city_id),
        fee,
    }
}

/// A new carried Direct offer on checked terms (`standCarried`), its fees worked out for all of
/// its goods and nothing set aside, and the other side told at once.
fn stand_carried(world: &mut WorldState, realm_id: &str, f: &Map<String, Value>, size: i32) {
    let to_id = text(f, "toId").expect("checked").to_string();
    let lapses_at = lapses_at(world);
    let from_city_id = text(f, "fromCityId").expect("checked").to_string();
    let to_city_id = text(f, "toCityId").expect("checked").to_string();
    let fee_by =
        if text(f, "feeBy") == Some("sender") { CarriedFeeBy::Sender } else { CarriedFeeBy::Split };
    let storage = delivery_storage(world, &from_city_id).expect("checked");
    let (storage_id, x, y) = (storage.id.clone(), storage.x, storage.y);
    let g = checked_goods(f);
    let fees = carried_offer_fees(world, size, &from_city_id, &to_city_id, fee_by, g);
    let (sender_fee, other_fee) = fees.unwrap_or((0.0, 0.0));
    let carried = CarriedOfferTerms { from_city_id, to_city_id, fee_by, sender_fee, other_fee };
    let line = carried_line(world, &carried, other_fee);
    let offer = Offer {
        id: new_id(world, "offer"),
        realm_id: realm_id.to_string(),
        storage_id,
        x,
        y,
        gives: g.gives,
        gives_units: g.gives_units,
        wants: g.wants,
        wants_units: g.wants_units,
        times: g.times,
        direct: Some(DirectOfferTerms { to_id: to_id.clone(), lapses_at, carried: Some(carried) }),
    };
    let t = terms(&offer);
    world.offers.push(offer);
    let from = organization_label(world, realm_id);
    let what =
        direct_offer_event(DirectOfferWhat::Received, from, None, Some(g.times), Some(line), t);
    record_event(world, Some(&to_id), what);
}

/// The send-carried-offer order (`sendCarriedOffer`, `CONTEXT.md`: Direct offer): a Direct offer
/// the Trade Organization will carry between a city of the Player's realm and one of the named
/// realm's.
pub struct SendCarriedOffer;

impl OrderKind for SendCarriedOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_id_of(world, sender) else {
            return Some("you have no realm".into());
        };
        send_carried_problem(world, &realm, &order.fields, terrain.map(|t| t.size))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(realm) = realm_id_of(world, sender) else { return };
        // Something may have taken a city, the HQ or the other realm since the order came.
        if send_carried_problem(world, &realm, &order.fields, terrain.map(|t| t.size)).is_some() {
            return;
        }
        // An unknown size is the TypeScript's `Infinity`: no map wraps.
        stand_carried(world, &realm, &order.fields, terrain.map_or(i32::MAX, |t| t.size));
    }
}

/// One of a carried offer's two Transfers, waiting for a caravan of the warehouse nearest its
/// pick-up (`carriedTransfer`).
#[allow(clippy::too_many_arguments)]
fn carried_transfer(
    world: &mut WorldState,
    size: i32,
    from: (&str, &str),
    to: (&str, &str),
    good: Good,
    units: f64,
    unload_share: f64,
) {
    let storage = delivery_storage(world, from.1).expect("checked");
    let warehouse = nearest_warehouse(world, (storage.x, storage.y), size).expect("checked");
    let warehouse_id = warehouse.id.clone();
    let id = new_id(world, "transfer");
    world.transfers.push(Transfer {
        id,
        realm_id: from.0.to_string(),
        to_realm_id: to.0.to_string(),
        to_city_id: to.1.to_string(),
        warehouse_id,
        from_city_id: Some(from.1.to_string()),
        good,
        units,
        fee: 0.0,
        back: false,
        caravan_id: None,
        carried_offer: Some(CarriedTransfer { unload_share, due: 0.0 }),
        debt: None,
    });
}

/// The accept order of a carried Direct offer (`acceptCarriedOffer`, `CONTEXT.md`: Direct offer):
/// the realm it was sent to takes it whole, from anywhere, and it becomes two Transfers. No
/// standing changes.
pub struct AcceptCarriedOffer;

impl OrderKind for AcceptCarriedOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_id_of(world, sender) else {
            return Some("you have no realm".into());
        };
        accept_carried_problem(world, &realm, text(&order.fields, "offerId"))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let offer_id = text(&order.fields, "offerId");
        let size = terrain.map_or(i32::MAX, |t| t.size);
        let Some(realm) = realm_id_of(world, sender) else { return };
        if accept_carried_problem(world, &realm, offer_id).is_some() {
            return;
        }
        let i = world.offers.iter().position(|o| Some(o.id.as_str()) == offer_id).expect("checked");
        let offer = world.offers[i].clone();
        let carried = offer.direct.as_ref().and_then(|d| d.carried.clone()).expect("checked");
        let (sender_share, other_share) = carried_unload_shares(carried.fee_by);
        let senders = (offer.realm_id.as_str(), carried.from_city_id.as_str());
        let others = (realm.as_str(), carried.to_city_id.as_str());
        let gives = offer.gives_units * offer.times;
        let wants = offer.wants_units * offer.times;
        carried_transfer(world, size, senders, others, offer.gives, gives, sender_share);
        carried_transfer(world, size, others, senders, offer.wants, wants, other_share);
        world.offers.remove(i);
        let told = |world: &WorldState, what, from: &str, fee| {
            direct_offer_event(
                what,
                organization_label(world, from),
                None,
                Some(offer.times),
                Some(carried_line(world, &carried, fee)),
                terms(&offer),
            )
        };
        let to_sender = told(world, DirectOfferWhat::CarriedAccepted, &realm, carried.sender_fee);
        record_event(world, Some(&offer.realm_id), to_sender);
        let to_other =
            told(world, DirectOfferWhat::YouAccepted, &offer.realm_id, carried.other_fee);
        record_event(world, Some(&realm), to_other);
    }
}

/// The decline order (`declineOffer`, `CONTEXT.md`: Direct offer): the realm it was sent to turns
/// it down.
pub struct DeclineOffer;

impl OrderKind for DeclineOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_id_of(world, sender) else {
            return Some("you have no realm".into());
        };
        decline_offer_problem(world, &realm, text(&order.fields, "offerId"))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let offer_id = text(&order.fields, "offerId");
        let Some(realm) = realm_id_of(world, sender) else { return };
        if decline_offer_problem(world, &realm, offer_id).is_some() {
            return;
        }
        end_offer(world, offer_id.expect("checked"), OfferEnd::Declined);
    }
}

/// The offer `offer_id` if it is the sender's realm's (`ownOffer`).
fn own_offer<'w>(
    world: &'w WorldState,
    sender: &OrderSender,
    offer_id: Option<&str>,
) -> Option<&'w Offer> {
    let realm = realm_id_of(world, sender)?;
    world.offers.iter().find(|o| Some(o.id.as_str()) == offer_id && o.realm_id == realm)
}

/// The take-down order (`takeDownOffer`, `CONTEXT.md`: Offer): a Player takes down an offer of
/// their realm, and what it set aside is ordinary goods of the storage again.
pub struct TakeDownOffer;

impl OrderKind for TakeDownOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let offer_id = text(&order.fields, "offerId");
        own_offer(world, sender, offer_id).is_none().then(|| "not an offer of yours".into())
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let offer_id = text(&order.fields, "offerId");
        if let Some(id) = own_offer(world, sender, offer_id).map(|o| o.id.clone()) {
            end_offer(world, &id, OfferEnd::TakenDown);
        }
    }
}

/// The accept order (`acceptOffer`, `CONTEXT.md`: Offer): one of the side's residents, on the
/// storage's tile, gets the order to take an offer up to `times` over, which happens this tick
/// (`resolve_offers`). A Player's realm or an NPC city's default can give it.
pub struct AcceptOffer;

impl OrderKind for AcceptOffer {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let r = ordered_resident(world, sender, text(f, "residentId"));
        let side = sender.npc_city_id.clone().or_else(|| realm_id_of(world, sender));
        let (Some(i), Some(side)) = (r, side) else {
            return Some("not one of your residents".into());
        };
        let r = &world.residents[i];
        accept_offer_problem(world, &side, r, f.get("offerId"), f.get("times"), f.get("carriageId"))
            .map(str::to_string)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = text(f, "residentId");
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        r.order = Some(ResidentOrder::AcceptOffer(AcceptOfferOrder {
            offer_id: text(f, "offerId").unwrap_or_default().to_string(),
            times: num(f, "times"),
            carriage_id: text(f, "carriageId").map(str::to_string),
        }));
    }
}

/// One offer accepted this tick, with the goods of everyone in it before and after (`Accepted`).
#[derive(Debug, Clone, PartialEq)]
pub struct Accepted {
    pub resident_id: String,
    pub before: Stock,
    pub after: Stock,
    /// Whether the offer gave Food for Coins.
    pub food_for_coins: bool,
}

/// The offers accepted by the latest `resolve_offers`, for the invariants over them (`ledger`).
#[derive(Debug, Clone, Default)]
pub struct OfferLedger {
    pub records: Vec<Accepted>,
}

/// The goods of two stocks added up (`total`).
fn total(a: &Stock, b: &Stock) -> Stock {
    let mut sum = a.clone();
    for (&good, &n) in b {
        *sum.entry(good).or_insert(0.0) += n;
    }
    sum
}

/// Moves units of one good between two stocks, dropping a good that reaches 0 (`move`).
fn move_good(from: &mut Stock, to: &mut Stock, good: Good, units: f64) {
    if units <= 0.0 {
        return;
    }
    let left = from.get(&good).copied().unwrap_or(0.0) - units;
    if left > 0.0 {
        from.insert(good, left);
    } else {
        from.shift_remove(&good);
    }
    *to.entry(good).or_insert(0.0) += units;
}

/// What a stock is worth at warehouse base prices, Coins as themselves (`worthOf`).
fn worth_of(stock: &[(Good, f64)]) -> f64 {
    stock.iter().fold(0.0, |worth, &(good, n)| {
        let price = if good == Good::Coins {
            1.0
        } else {
            WAREHOUSE_BASE_PRICE.get(good_name(good)).unwrap_or(0.0)
        };
        worth + n * price
    })
}

/// What an offer accepted moved, in Coins, for standing as a trade raises it (`offerWorth`): the
/// Coins that changed hands, or for goods for goods, both goods at warehouse base prices.
fn offer_worth(offer: &Offer, gives: f64, wants: f64) -> f64 {
    if offer.gives == Good::Coins {
        return gives;
    }
    if offer.wants == Good::Coins {
        return wants;
    }
    worth_of(&[(offer.gives, gives), (offer.wants, wants)])
}

/// Carries out accept orders (`resolveOffers`, `CONTEXT.md`: Offer): where the offer stands and
/// the trader and any carriage are still on its storage's tile, it is taken as many times as they
/// can pay and carry. It raises standing both ways, like a trade. An offer used up ends. Either
/// way the order is done. Returns how many moved anything.
pub fn resolve_offers(world: &mut WorldState, ledger: &mut OfferLedger) -> usize {
    ledger.records.clear();
    let mut done = 0;
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::AcceptOffer(o)) = world.residents[i].order.clone() else {
            continue;
        };
        world.residents[i].order = None;
        let Some(offer) = world.offers.iter().position(|x| x.id == o.offer_id) else { continue };
        if accept_now(world, i, offer, o.times, o.carriage_id.as_deref(), ledger) {
            done += 1;
        }
    }
    done
}

/// Whose stock pays and receives in an accept: the trader's hands or a carriage.
#[derive(Clone, Copy)]
enum Holder {
    Hands(usize),
    Carriage(usize),
}

/// One accept order of resident `ri` carried out (`acceptNow`); whether it moved anything.
fn accept_now(
    world: &mut WorldState,
    ri: usize,
    oi: usize,
    wanted: f64,
    carriage_id: Option<&str>,
    ledger: &mut OfferLedger,
) -> bool {
    let r = &world.residents[ri];
    let commander = commander_of(world, &r.id, r.owner.as_deref());
    let side = commander.clone().or_else(|| r.city_id.clone());
    let offer = &world.offers[oi];
    let Some(side) = side.filter(|s| *s != offer.realm_id && offer_open_to(offer, s)) else {
        return false;
    };
    let Some(si) = world.buildings.iter().position(|b| b.id == offer.storage_id) else {
        return false;
    };
    let at = |x: f64, y: f64| is_at((x as i32, y as i32), placed(&world.buildings[si]), MAP_SIZE);
    if !at(r.x, r.y) {
        return false;
    }
    let holder = match carriage_id {
        None => Holder::Hands(ri),
        Some(id) => {
            let Some(ki) = world.carriages.iter().position(|k| k.id == id) else { return false };
            let k = &world.carriages[ki];
            if carriage_commander_of(world, k).as_deref() != Some(side.as_str()) || !at(k.x, k.y) {
                return false;
            }
            Holder::Carriage(ki)
        }
    };
    let tick = world.tick as f64;
    let stock_of_storage = world.buildings[si].stock.clone().unwrap_or_default();
    let q = {
        let h = match holder {
            Holder::Hands(i) => hands_of(&world.residents[i], tick),
            Holder::Carriage(i) => {
                let k = &world.carriages[i];
                load_of(k, goods_capacity(world, k))
            }
        };
        quote_offer(offer, &h, wanted, stock_of_storage.get(&offer.gives).copied().unwrap_or(0.0))
    };
    let offer = offer.clone();
    let resident_id = world.residents[ri].id.clone();
    let name = world.residents[ri].name.clone();
    // The storage's stock exists from now on, if empty (`stock ??= {}`).
    let mut stock = world.buildings[si].stock.take().unwrap_or_default();
    let mut held = match holder {
        Holder::Hands(i) => std::mem::take(&mut world.residents[i].carried),
        Holder::Carriage(i) => std::mem::take(&mut world.carriages[i].load),
    };
    let before = total(&held, &stock);
    move_good(&mut stock, &mut held, offer.gives, q.gives);
    move_good(&mut held, &mut stock, offer.wants, q.wants);
    let after = total(&held, &stock);
    world.buildings[si].stock = Some(stock);
    match holder {
        Holder::Hands(i) => world.residents[i].carried = held,
        Holder::Carriage(i) => world.carriages[i].load = held,
    }
    ledger.records.push(Accepted {
        resident_id: resident_id.clone(),
        before,
        after,
        food_for_coins: offer.gives == Good::Food && offer.wants == Good::Coins,
    });
    world.offers[oi].times -= q.times;
    let t = || terms(&offer);
    if q.times > 0.0 {
        // Goods handed over on a demand are no trade: fetching them raises no standing.
        let moved = if wants_nothing(&offer) {
            None
        } else {
            let worth = offer_worth(&offer, q.gives, q.wants);
            raise_standing_by_trade(world, &offer.realm_id, &side, worth)
        };
        let t = t();
        let what = RealmEventWhat::OfferTaken {
            by: organization_label(world, &side),
            gives: t.gives,
            gives_units: q.gives,
            wants: t.wants,
            wants_units: q.wants,
            times: q.times,
            x: t.x,
            y: t.y,
            standing: moved,
        };
        record_event(world, Some(&offer.realm_id), what);
    }
    let t = t();
    let what = RealmEventWhat::OfferAccepted {
        resident_id,
        name,
        realm: organization_label(world, &offer.realm_id),
        gives: t.gives,
        gives_units: q.gives,
        wants: t.wants,
        wants_units: q.wants,
        times: q.times,
        wanted,
        x: t.x,
        y: t.y,
    };
    record_event(world, commander.as_deref(), what);
    if world.offers[oi].times <= 0.0 {
        let id = offer.id.clone();
        end_offer(world, &id, OfferEnd::UsedUp);
    }
    q.times > 0.0
}

fn direct_what(why: OfferEnd) -> DirectOfferWhat {
    match why {
        OfferEnd::TakenDown => DirectOfferWhat::TakenDown,
        OfferEnd::StorageLost => DirectOfferWhat::StorageLost,
        OfferEnd::GoodsGone => DirectOfferWhat::GoodsGone,
        OfferEnd::Declined => DirectOfferWhat::Declined,
        OfferEnd::Lapsed => DirectOfferWhat::Lapsed,
        OfferEnd::NoCaravans => DirectOfferWhat::NoCaravans,
        OfferEnd::UsedUp => unreachable!("the other side already heard"),
    }
}

/// Takes an offer out of the world (`endOffer`), with a line in its realm's log and, for a Direct
/// offer, in the log of the realm it was sent to, who already heard if they used it up.
pub fn end_offer(world: &mut WorldState, offer_id: &str, why: OfferEnd) {
    let Some(i) = world.offers.iter().position(|o| o.id == offer_id) else { return };
    let offer = world.offers.remove(i);
    let to_id = offer.direct.as_ref().map(|d| d.to_id.clone());
    let t = terms(&offer);
    let what = RealmEventWhat::OfferEnded {
        gives: t.gives,
        gives_units: t.gives_units,
        wants: t.wants,
        wants_units: t.wants_units,
        why,
        to: to_id.as_deref().map(|id| organization_label(world, id)),
        carried: offer.direct.as_ref().and_then(|d| d.carried.as_ref()).map(|_| true),
        x: t.x,
        y: t.y,
    };
    record_event(world, Some(&offer.realm_id), what);
    let Some(to_id) = to_id.filter(|_| why != OfferEnd::UsedUp) else { return };
    let from_city = answered_by_game(world, &offer.realm_id).map(|_| true);
    let from = organization_label(world, &offer.realm_id);
    let what = direct_offer_event(direct_what(why), from, from_city, None, None, terms(&offer));
    record_event(world, Some(&to_id), what);
}

/// Whether a Direct offer's time is up, or the realm it was sent to is gone, or for the Trade
/// Organization, the HQ that sends its caravans (`lapsed`).
fn lapsed(world: &WorldState, direct: &DirectOfferTerms) -> bool {
    world.tick as f64 >= direct.lapses_at
        || if direct.to_id == TRADE_ORG {
            trade_org_hq(world).is_none()
        } else {
            !world.realms.iter().any(|r| r.id == direct.to_id)
        }
}

/// Whether both cities of a carried offer are still their sides', each with a storage
/// (`carriedCitiesHold`).
fn carried_cities_hold(world: &WorldState, offer: &Offer, c: &CarriedOfferTerms) -> bool {
    let holds = |city_id: &str, realm_id: Option<&str>| {
        world.cities.iter().find(|x| x.id == city_id).and_then(|x| x.realm_id.as_deref())
            == realm_id
            && delivery_storage(world, city_id).is_some()
    };
    holds(&c.from_city_id, Some(&offer.realm_id))
        && holds(&c.to_city_id, offer.direct.as_ref().map(|d| d.to_id.as_str()))
}

/// Offers follow their storages at the end of each tick (`stepOffers`, `CONTEXT.md`: Offer): one
/// whose storage is torn down or no longer its realm's ends, and goods gone from the storage cut
/// it down, the newest at a storage first. A Direct offer lapses at its time, or when the realm
/// it was sent to is gone. A carried one ends with the HQ, its time, or either city.
pub fn step_offers(world: &mut WorldState) {
    if world.offers.is_empty() {
        return;
    }
    let mut left: std::collections::HashMap<String, Stock> = std::collections::HashMap::new();
    let ids: Vec<String> = world.offers.iter().map(|o| o.id.clone()).collect();
    for id in ids {
        let Some(offer) = world.offers.iter().find(|o| o.id == id).cloned() else { continue };
        if let Some(direct) = offer.direct.as_ref().filter(|d| d.carried.is_some()) {
            let carried = direct.carried.as_ref().expect("filtered");
            if trade_org_hq(world).is_none() {
                end_offer(world, &id, OfferEnd::NoCaravans);
            } else if lapsed(world, direct) {
                end_offer(world, &id, OfferEnd::Lapsed);
            } else if !carried_cities_hold(world, &offer, carried) {
                end_offer(world, &id, OfferEnd::StorageLost);
            }
            continue;
        }
        let Some(storage) = offer_storage(world, &offer.realm_id, &offer.storage_id) else {
            end_offer(world, &id, OfferEnd::StorageLost);
            continue;
        };
        if offer.direct.as_ref().is_some_and(|d| lapsed(world, d)) {
            end_offer(world, &id, OfferEnd::Lapsed);
            continue;
        }
        let stock = left
            .entry(storage.id.clone())
            .or_insert_with(|| storage.stock.clone().unwrap_or_default());
        let held = stock.get(&offer.gives).copied().unwrap_or(0.0);
        let times = offer.times.min((held / offer.gives_units).floor());
        stock.insert(offer.gives, held - times * offer.gives_units);
        if times == offer.times {
            continue;
        }
        if let Some(o) = world.offers.iter_mut().find(|o| o.id == id) {
            o.times = times;
        }
        if times == 0.0 {
            end_offer(world, &id, OfferEnd::GoodsGone);
        } else {
            let t = terms(&offer);
            let what = RealmEventWhat::OfferCutDown {
                gives: t.gives,
                gives_units: t.gives_units,
                wants: t.wants,
                wants_units: t.wants_units,
                times,
                x: t.x,
                y: t.y,
            };
            record_event(world, Some(&offer.realm_id), what);
        }
    }
}

fn violation(invariant: &str, o: &Offer, message: String) -> InvariantViolation {
    InvariantViolation {
        invariant: invariant.into(),
        message: format!("offer {} {message}", o.id),
        entity_ids: vec![o.id.clone(), o.storage_id.clone()],
    }
}

fn whole(units: &[f64]) -> bool {
    units.iter().all(|n| n.fract() == 0.0 && *n > 0.0 && n.is_finite())
}

/// An offer's storage exists and is its realm's, its terms are whole and positive, and what its
/// storage's offers set aside never exceeds what the storage holds (`offers-sound`). A Direct
/// offer goes to a realm other than its own that is still there, and hasn't outlived its time.
pub fn offers_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |o: &Offer, m: String| out.push(violation("offers-sound", o, m));
    let mut aside: std::collections::HashMap<&str, Stock> = std::collections::HashMap::new();
    for o in &world.offers {
        if let Some(c) = o.direct.as_ref().and_then(|d| d.carried.as_ref()) {
            sound_carried(world, o, c, &mut fail);
            continue;
        }
        let storage = offer_storage(world, &o.realm_id, &o.storage_id);
        if storage.is_none() {
            fail(o, format!("stands at {}, no finished storage of {}", o.storage_id, o.realm_id));
        }
        // Only goods set aside on accepting a demand can want nothing, and for one realm alone.
        let asked: &[f64] =
            if o.direct.is_some() && wants_nothing(o) { &[] } else { &[o.wants_units] };
        if !whole(&[o.gives_units, o.times]) || !whole(asked) {
            fail(o, "has terms that aren’t whole and positive".into());
        }
        if o.gives == o.wants {
            fail(o, format!("wants the {} it gives", good_name(o.gives)));
        }
        if o.direct.as_ref().is_some_and(|d| d.to_id == o.realm_id) {
            fail(o, "was sent to its own realm".into());
        }
        if let Some(d) = o.direct.as_ref().filter(|d| lapsed(world, d)) {
            fail(o, format!("outlived its time for {}", d.to_id));
        }
        let stock = aside.entry(&o.storage_id).or_default();
        let set = stock.entry(o.gives).or_insert(0.0);
        *set += o.times * o.gives_units;
        let set = *set;
        if let Some(s) = storage {
            let holds = s.stock.as_ref().and_then(|x| x.get(&o.gives)).copied().unwrap_or(0.0);
            if set > holds + 1e-6 {
                fail(
                    o,
                    format!(
                        "has {} {} set aside where {} are held",
                        crate::queries::warehouse_trade::js_number(set),
                        good_name(o.gives),
                        crate::queries::warehouse_trade::js_number(holds)
                    ),
                );
            }
        }
    }
    out
}

/// A carried Direct offer stands only while the HQ does, to another realm, between a city of each
/// side, for no more than one load each way, with fees whole and at least 0 (`soundCarried`).
fn sound_carried(
    world: &WorldState,
    o: &Offer,
    c: &CarriedOfferTerms,
    fail: &mut impl FnMut(&Offer, String),
) {
    if trade_org_hq(world).is_none() {
        fail(o, "is carried with the HQ fallen".into());
    }
    if !carried_cities_hold(world, o, c) {
        fail(o, "is carried between cities not its sides’".into());
    }
    if o.direct.as_ref().is_some_and(|d| d.to_id == o.realm_id) {
        fail(o, "was sent to its own realm".into());
    }
    if let Some(d) = o.direct.as_ref().filter(|d| lapsed(world, d)) {
        fail(o, format!("outlived its time for {}", d.to_id));
    }
    if o.gives == o.wants {
        fail(o, format!("wants the {} it gives", good_name(o.gives)));
    }
    if !whole(&[o.gives_units, o.wants_units, o.times]) {
        fail(o, "has terms that aren’t whole and positive".into());
    }
    if o.gives_units * o.times > transfer_load(o.gives) {
        fail(o, "gives more than one load".into());
    }
    if o.wants_units * o.times > transfer_load(o.wants) {
        fail(o, "wants more than one load".into());
    }
    let fees = [c.sender_fee, c.other_fee];
    if !fees.iter().all(|n| n.fract() == 0.0 && *n >= 0.0) {
        fail(o, "has fees that aren’t whole".into());
    }
}

/// Accepting an offer moves goods and creates none (`offers-keep-goods`).
pub fn offers_keep_goods(ledger: &OfferLedger) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for t in &ledger.records {
        let mut goods: Vec<Good> = t.before.keys().copied().collect();
        goods.extend(t.after.keys().copied().filter(|g| !t.before.contains_key(g)));
        for g in goods {
            let b = t.before.get(&g).copied().unwrap_or(0.0);
            let a = t.after.get(&g).copied().unwrap_or(0.0);
            if (b - a).abs() > 1e-6 {
                out.push(InvariantViolation {
                    invariant: "offers-keep-goods".into(),
                    message: format!(
                        "an offer accepted by {} turned {} {} into {}",
                        t.resident_id,
                        crate::queries::warehouse_trade::js_number(b),
                        good_name(g),
                        crate::queries::warehouse_trade::js_number(a)
                    ),
                    entity_ids: vec![t.resident_id.clone()],
                });
            }
        }
    }
    out
}

/// The Trade Organization accepts offers only for its army to buy Food on the way
/// (`trade-org-only-buys-food`): only a soldier of a punishment, only Food for Coins.
pub fn trade_org_only_buys_food(
    world: &WorldState,
    ledger: &OfferLedger,
) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for t in &ledger.records {
        let r = world.residents.iter().find(|x| x.id == t.resident_id);
        let city = r
            .filter(|r| r.owner.is_none())
            .and_then(|r| world.cities.iter().find(|c| Some(&c.id) == r.city_id.as_ref()));
        let Some(city) = city.filter(|c| c.trade_org.is_some()) else { continue };
        let soldier = world
            .punishments
            .iter()
            .any(|p| p.members.iter().any(|m| m.resident_id == t.resident_id));
        if soldier && t.food_for_coins {
            continue;
        }
        out.push(InvariantViolation {
            invariant: "trade-org-only-buys-food".into(),
            message: format!(
                "{} of {}, the Trade Organization's, accepted an offer that is no army buying Food",
                t.resident_id, city.id
            ),
            entity_ids: vec![t.resident_id.clone(), city.id.clone()],
        });
    }
    out
}

/// Every accept order is done the tick it is given (`accept-orders-done`).
pub fn accept_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::AcceptOffer(_))))
        .map(|r| InvariantViolation {
            invariant: "accept-orders-done".into(),
            message: format!("resident {} still holds an accept order after the tick", r.id),
            entity_ids: vec![r.id.clone()],
        })
        .collect()
}

#[cfg(test)]
mod tests;
