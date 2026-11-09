//! World queries about Direct offers (`packages/shared/src/direct-offer.ts`, `CONTEXT.md`: Direct
//! offer). The views a Player's client gets (`directOffersFor`, `carriedWaysFor`) come with the
//! server.

use csp_shared::balance::DIRECT_OFFERS_TO_ONE_REALM;
use csp_shared::world::{CarriedFeeBy, City, Good, WorldState};
use serde_json::{Map, Value};

use super::demand::realms_known_to;
use super::offers::{offer_terms_problem, post_offer_problem, wants_nothing};
use super::residents::good_weight;
use super::trade_org::{trade_org_hq, trade_org_refuses, NO_CARAVANS};
use super::transfer::{
    fee_at_pick_up, nearest_warehouse, pick_up_transfer_problem, transfer_fee, transfer_tiles,
};
use super::warehouse_trade::delivery_storage;

/// The realms a realm can send a Direct offer to (`realmsToOfferTo`): those it knows of.
pub fn realms_to_offer_to<'a>(
    world: &WorldState,
    realm_id: &str,
    seen_realms: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    realms_known_to(world, realm_id, seen_realms)
}

/// Why the realm can't send a Direct offer to `to_id` (`sendingProblem`): another realm, with
/// fewer than `DIRECT_OFFERS_TO_ONE_REALM` standing to it.
fn sending_problem(world: &WorldState, realm_id: &str, to_id: Option<&str>) -> Option<String> {
    if to_id == Some(realm_id) {
        return Some("send a direct offer to another realm".into());
    }
    let Some(to_id) = to_id.filter(|t| world.realms.iter().any(|r| r.id == *t)) else {
        return Some("send a direct offer to a realm".into());
    };
    // Goods set aside on accepting a demand were asked for: they use up none of the limit.
    let standing = world
        .offers
        .iter()
        .filter(|o| {
            o.realm_id == realm_id
                && o.direct.as_ref().is_some_and(|d| d.to_id == to_id)
                && !wants_nothing(o)
        })
        .count();
    if standing as f64 >= DIRECT_OFFERS_TO_ONE_REALM {
        return Some(format!(
            "at most {DIRECT_OFFERS_TO_ONE_REALM} direct offers can stand to one realm"
        ));
    }
    None
}

/// Why the realm can't send this Direct offer in person (`directOfferProblem`): to another realm,
/// on terms it could post as an offer.
pub fn direct_offer_problem(
    world: &WorldState,
    realm_id: &str,
    to_id: Option<&str>,
    terms: &Map<String, Value>,
) -> Option<String> {
    sending_problem(world, realm_id, to_id)
        .or_else(|| post_offer_problem(world, realm_id, terms).map(str::to_string))
}

/// What share of each Transfer's fee is taken where it unloads (`carriedUnloadShares`): the
/// sender's and the other side's.
pub fn carried_unload_shares(fee_by: CarriedFeeBy) -> (f64, f64) {
    match fee_by {
        CarriedFeeBy::Sender => (0.0, 1.0),
        CarriedFeeBy::Split => (0.5, 0.5),
    }
}

/// The two ways of a carried offer (`CarriedWay`): its tiles from each side's nearest warehouse.
#[derive(Debug, Clone, PartialEq)]
pub struct CarriedWay {
    pub sender_tiles: f64,
    pub other_tiles: f64,
}

/// The ways between two cities' storages (`carriedWay`), `None` without a storage or warehouse.
fn carried_way(
    world: &WorldState,
    size: i32,
    from_city_id: &str,
    to_city_id: &str,
) -> Option<CarriedWay> {
    let from = delivery_storage(world, from_city_id)?;
    let to = delivery_storage(world, to_city_id)?;
    let (from, to) = ((from.x, from.y), (to.x, to.y));
    let sender_warehouse = nearest_warehouse(world, from, size)?;
    let other_warehouse = nearest_warehouse(world, to, size)?;
    Some(CarriedWay {
        sender_tiles: transfer_tiles(
            size,
            (sender_warehouse.x, sender_warehouse.y),
            Some(from),
            to,
        ),
        other_tiles: transfer_tiles(size, (other_warehouse.x, other_warehouse.y), Some(to), from),
    })
}

/// The goods of a carried offer, as its fees need them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OfferGoods {
    pub gives: Good,
    pub gives_units: f64,
    pub wants: Good,
    pub wants_units: f64,
    pub times: f64,
}

/// What each side of a carried offer pays over these ways (`carriedFeesOver`): the sender's and
/// the other side's fee.
pub fn carried_fees_over(way: &CarriedWay, fee_by: CarriedFeeBy, goods: OfferGoods) -> (f64, f64) {
    let fee = |good: Good, units: f64, tiles: f64| transfer_fee(units * good_weight(good), tiles);
    let senders = fee(goods.gives, goods.gives_units * goods.times, way.sender_tiles);
    let others = fee(goods.wants, goods.wants_units * goods.times, way.other_tiles);
    let (sender_share, other_share) = carried_unload_shares(fee_by);
    let senders_at_pick_up = fee_at_pick_up(senders, sender_share);
    let others_at_pick_up = fee_at_pick_up(others, other_share);
    (
        senders_at_pick_up + others - others_at_pick_up,
        senders - senders_at_pick_up + others_at_pick_up,
    )
}

/// What each side of a carried offer pays (`carriedOfferFees`), `None` without a way.
pub fn carried_offer_fees(
    world: &WorldState,
    size: i32,
    from_city_id: &str,
    to_city_id: &str,
    fee_by: CarriedFeeBy,
    goods: OfferGoods,
) -> Option<(f64, f64)> {
    carried_way(world, size, from_city_id, to_city_id).map(|w| carried_fees_over(&w, fee_by, goods))
}

/// A carried offer's request: its cities and who pays, as the order or offer gives them.
pub struct CarriedRequest<'a> {
    pub from_city_id: Option<&'a Value>,
    pub to_city_id: Option<&'a Value>,
    pub fee_by: Option<&'a Value>,
}

/// Why the Trade Organization won't carry these goods between these sides (`carriedProblem`);
/// `asking` is who asks, for the wording. `goods` holds `gives`, `givesUnits`, `wants`,
/// `wantsUnits` and `times`.
fn carried_problem(
    world: &WorldState,
    sender_id: &str,
    to_id: &str,
    carried: &CarriedRequest<'_>,
    goods: &Map<String, Value>,
    asking: &str,
) -> Option<String> {
    if trade_org_hq(world).is_none() {
        return Some(NO_CARAVANS.into());
    }
    for id in [sender_id, to_id] {
        if trade_org_refuses(world, id) {
            let whom = if id == asking { "you" } else { "them" };
            return Some(format!("the Trade Organization won’t carry for {whom}"));
        }
    }
    if let Some(p) = offer_terms_problem(goods) {
        return Some(p.into());
    }
    let fee_by = carried.fee_by.and_then(Value::as_str);
    if fee_by != Some("sender") && fee_by != Some("split") {
        return Some("the fee is paid by the sender or split".into());
    }
    let city = |v: Option<&Value>| -> Option<&City> {
        let id = v.and_then(Value::as_str)?;
        world.cities.iter().find(|c| c.id == id)
    };
    let realm = |c: Option<&City>| c.and_then(|c| c.realm_id.clone());
    if realm(city(carried.from_city_id)).as_deref() != Some(sender_id) {
        return Some("the goods are picked up at a city of the sender".into());
    }
    if realm(city(carried.to_city_id)).as_deref() != Some(to_id) {
        return Some("the goods go to a city of the realm it is sent to".into());
    }
    let num = |k: &str| goods.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let times = num("times");
    let units = |k: &str| Value::from(num(k) * times);
    pick_up_transfer_problem(
        world,
        sender_id,
        carried.from_city_id,
        goods.get("gives"),
        Some(&units("givesUnits")),
        carried.to_city_id,
    )
    .or_else(|| {
        pick_up_transfer_problem(
            world,
            to_id,
            carried.to_city_id,
            goods.get("wants"),
            Some(&units("wantsUnits")),
            carried.from_city_id,
        )
    })
}

/// Why the realm can't send this carried Direct offer (`carriedOfferProblem`).
pub fn carried_offer_problem(
    world: &WorldState,
    realm_id: &str,
    to_id: Option<&str>,
    carried: &CarriedRequest<'_>,
    goods: &Map<String, Value>,
) -> Option<String> {
    sending_problem(world, realm_id, to_id).or_else(|| {
        carried_problem(world, realm_id, to_id.unwrap_or_default(), carried, goods, realm_id)
    })
}

/// An offer's goods as the fields of an order.
pub fn offer_goods_fields(o: &csp_shared::world::Offer) -> Map<String, Value> {
    let mut m = Map::new();
    let good = |g: Good| serde_json::to_value(g).expect("serialisable");
    m.insert("gives".into(), good(o.gives));
    m.insert("givesUnits".into(), Value::from(o.gives_units));
    m.insert("wants".into(), good(o.wants));
    m.insert("wantsUnits".into(), Value::from(o.wants_units));
    m.insert("times".into(), Value::from(o.times));
    m
}

/// Why the realm can't accept this carried Direct offer now (`acceptCarriedProblem`).
pub fn accept_carried_problem(
    world: &WorldState,
    realm_id: &str,
    offer_id: Option<&str>,
) -> Option<String> {
    let Some(offer) = world.offers.iter().find(|o| Some(o.id.as_str()) == offer_id) else {
        return Some("that offer is gone".into());
    };
    let Some(direct) = offer.direct.as_ref().filter(|d| d.to_id == realm_id) else {
        return Some("that offer wasn’t sent to you".into());
    };
    let Some(c) = &direct.carried else {
        return Some("that offer is fetched in person".into());
    };
    let (from, to) = (Value::from(c.from_city_id.as_str()), Value::from(c.to_city_id.as_str()));
    let fee_by = serde_json::to_value(c.fee_by).expect("serialisable");
    let request =
        CarriedRequest { from_city_id: Some(&from), to_city_id: Some(&to), fee_by: Some(&fee_by) };
    let goods = offer_goods_fields(offer);
    carried_problem(world, &offer.realm_id, realm_id, &request, &goods, realm_id)
}

/// The realm's cities a carried offer can pick up at or deliver to (`citiesToCarryAt`): those
/// with a storage.
pub fn cities_to_carry_at<'w>(world: &'w WorldState, realm_id: &str) -> Vec<&'w City> {
    world
        .cities
        .iter()
        .filter(|c| {
            c.realm_id.as_deref() == Some(realm_id) && delivery_storage(world, &c.id).is_some()
        })
        .collect()
}

/// Why the realm can't decline this offer (`declineOfferProblem`): it is a Direct offer to it.
pub fn decline_offer_problem(
    world: &WorldState,
    realm_id: &str,
    offer_id: Option<&str>,
) -> Option<String> {
    let Some(offer) = world.offers.iter().find(|o| Some(o.id.as_str()) == offer_id) else {
        return Some("that offer is gone".into());
    };
    if offer.direct.as_ref().is_some_and(|d| d.to_id == realm_id) {
        None
    } else {
        Some("that offer wasn’t sent to you".into())
    }
}
