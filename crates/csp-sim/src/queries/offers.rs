//! Offer queries of `packages/shared/src/offers.ts` (`CONTEXT.md`: Offer).

use csp_shared::world::offers::SeenOffer;
use csp_shared::world::{Offer, Stock, WorldState};

/// What an offer wants for one unit it gives (`offerRate`).
pub fn offer_rate(o: &Offer) -> f64 {
    o.wants_units / o.gives_units
}

/// An offer as anyone in sight sees it (`seenOffer`): with its rate.
pub fn seen_offer(o: &Offer) -> SeenOffer {
    SeenOffer {
        id: o.id.clone(),
        realm_id: o.realm_id.clone(),
        storage_id: o.storage_id.clone(),
        x: o.x,
        y: o.y,
        gives: o.gives,
        gives_units: o.gives_units,
        wants: o.wants,
        wants_units: o.wants_units,
        times: o.times,
        direct: o.direct.clone(),
        rate: offer_rate(o),
    }
}

/// The offers standing at a storage, oldest first (`offersAt`); a carried Direct offer stands at
/// none.
pub fn offers_at<'w>(world: &'w WorldState, storage_id: &str) -> Vec<&'w Offer> {
    world
        .offers
        .iter()
        .filter(|o| {
            o.storage_id == storage_id && !o.direct.as_ref().is_some_and(|d| d.carried.is_some())
        })
        .collect()
}

/// The goods its offers set aside at a storage (`setAsideAt`).
pub fn set_aside_at(world: &WorldState, storage_id: &str) -> Stock {
    let mut aside = Stock::new();
    for o in offers_at(world, storage_id) {
        *aside.entry(o.gives).or_insert(0.0) += o.times * o.gives_units;
    }
    aside
}

/// The goods of a storage that aren't set aside for its offers (`freeStock`, `CONTEXT.md`: Offer):
/// what workers, builders, Fetch, pick-ups and refills may take. Without offers it is the stock
/// itself.
pub fn free_stock(world: &WorldState, storage_id: &str, stock: Option<&Stock>) -> Stock {
    let stock = stock.cloned().unwrap_or_default();
    if world.offers.is_empty() {
        return stock;
    }
    let aside = set_aside_at(world, storage_id);
    if aside.is_empty() {
        return stock;
    }
    let mut free = stock.clone();
    for (good, n) in aside {
        let left = stock.get(&good).copied().unwrap_or(0.0) - n;
        if left > 0.0 {
            free.insert(good, left);
        } else {
            free.shift_remove(&good);
        }
    }
    free
}

/// The finished storage `storage_id` if it is the realm's, or by its id an NPC city's
/// (`offerStorage`).
pub fn offer_storage<'w>(
    world: &'w WorldState,
    realm_id: &str,
    storage_id: &str,
) -> Option<&'w csp_shared::world::Building> {
    let b = world.buildings.iter().find(|x| x.id == storage_id)?;
    if b.kind != csp_shared::world::BuildingKind::Storage || b.site.is_some() {
        return None;
    }
    let owner = super::city::building_realm(world, b).or(b.city_id.as_deref());
    (owner == Some(realm_id)).then_some(b)
}

/// Whether an offer wants nothing back: a gift (`wantsNothing`).
pub fn wants_nothing(o: &Offer) -> bool {
    o.wants_units == 0.0
}

fn is_good(v: Option<&serde_json::Value>) -> Option<csp_shared::world::Good> {
    v.and_then(serde_json::Value::as_str).and_then(super::names::good_of)
}

/// A whole number above 0 that JavaScript holds exactly (`isCount`).
pub fn is_count(v: Option<&serde_json::Value>) -> bool {
    v.and_then(serde_json::Value::as_f64)
        .is_some_and(|n| n.fract() == 0.0 && n > 0.0 && n <= 9_007_199_254_740_991.0)
}

/// How many times over an offer of `gives_units` a time can be posted at a storage, of the
/// `times` asked for (`timesToPost`): as many as there are goods not yet set aside.
pub fn times_to_post(
    world: &WorldState,
    storage: &csp_shared::world::Building,
    gives: csp_shared::world::Good,
    gives_units: f64,
    times: f64,
) -> f64 {
    let free = free_stock(world, &storage.id, storage.stock.as_ref());
    times.min((free.get(&gives).copied().unwrap_or(0.0) / gives_units).floor())
}

/// Why an offer's terms won't do (`offerTermsProblem`): a good for a different good, in whole
/// units. `fields` holds `gives`, `givesUnits`, `wants`, `wantsUnits` and `times`.
pub fn offer_terms_problem(
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Option<&'static str> {
    let (Some(gives), Some(wants)) = (is_good(fields.get("gives")), is_good(fields.get("wants")))
    else {
        return Some("gives and wants must be goods");
    };
    if gives == wants {
        return Some("an offer wants a different good than it gives");
    }
    if !["givesUnits", "wantsUnits", "times"].iter().all(|k| is_count(fields.get(*k))) {
        return Some("units and times must be whole numbers");
    }
    None
}

/// Why `realm_id` can't post an offer on these terms (`postOfferProblem`, `CONTEXT.md`: Offer):
/// at a finished storage of its own, on sound terms, with the goods for it once there and not
/// already set aside.
pub fn post_offer_problem(
    world: &WorldState,
    realm_id: &str,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Option<&'static str> {
    let storage_id = fields.get("storageId").and_then(serde_json::Value::as_str).unwrap_or("");
    let Some(storage) = offer_storage(world, realm_id, storage_id) else {
        return Some("not a finished storage of yours");
    };
    if let Some(problem) = offer_terms_problem(fields) {
        return Some(problem);
    }
    let gives = is_good(fields.get("gives")).expect("checked");
    let num = |k: &str| fields.get(k).and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    if times_to_post(world, storage, gives, num("givesUnits"), num("times")) == 0.0 {
        return Some("not enough of that good here that isn’t set aside");
    }
    None
}

/// Whether `side` may accept an offer in person, its own aside (`offerOpenTo`): anyone, unless it
/// is a Direct offer to another realm or a carried one.
pub fn offer_open_to(o: &Offer, side: &str) -> bool {
    match &o.direct {
        None => true,
        Some(d) => d.to_id == side && d.carried.is_none(),
    }
}

/// What accepting an offer moves (`OfferQuote`): `times` over, `gives` to the trader and `wants`
/// from them, and what cut it short of the times wanted, if anything did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OfferQuote {
    pub times: f64,
    pub gives: f64,
    pub wants: f64,
    pub limit: Option<super::warehouse_trade::TradeLimit>,
}

/// What accepting an offer up to `wanted` times moves (`quoteOffer`): as many times as it still
/// stands (`available` units of what it gives are in the storage), as the trader can pay, and as
/// fits them, what they hand over making room. Pure: nothing moves.
pub fn quote_offer(
    offer: &Offer,
    holder: &super::warehouse_trade::TradeHolder<'_>,
    wanted: f64,
    available: f64,
) -> OfferQuote {
    use super::residents::good_weight;
    use super::warehouse_trade::TradeLimit;
    let left = offer.times.min((available / offer.gives_units).floor());
    let paid = if wants_nothing(offer) {
        f64::INFINITY
    } else {
        (holder.stock.get(&offer.wants).copied().unwrap_or(0.0) / offer.wants_units).floor()
    };
    let gain =
        offer.gives_units * good_weight(offer.gives) - offer.wants_units * good_weight(offer.wants);
    let fits =
        if gain > 0.0 { ((holder.room.max(0.0) + 1e-9) / gain).floor() } else { f64::INFINITY };
    let times = wanted.min(left).min(paid).min(fits);
    let quote = |limit| OfferQuote {
        times,
        gives: times * offer.gives_units,
        wants: times * offer.wants_units,
        limit,
    };
    if times == wanted {
        return quote(None);
    }
    if times == left {
        return quote(Some(TradeLimit::Stock));
    }
    if times == paid {
        let coins = offer.wants == csp_shared::world::Good::Coins;
        return quote(Some(if coins { TradeLimit::Coins } else { TradeLimit::Held }));
    }
    quote(Some(TradeLimit::Room))
}

/// Why `resident` of `side` can't accept an offer (`acceptOfferProblem`, `CONTEXT.md`: Offer):
/// they are grown up and on its storage's tile, it isn't their own side's or a Direct offer to
/// another realm, `times` is whole and positive, and they hold something to pay with in their
/// hands or on `carriage_id`, a carriage on the tile that `side` commands.
pub fn accept_offer_problem(
    world: &WorldState,
    side: &str,
    resident: &csp_shared::world::Resident,
    offer_id: Option<&serde_json::Value>,
    times: Option<&serde_json::Value>,
    carriage_id: Option<&serde_json::Value>,
) -> Option<&'static str> {
    use csp_shared::footprint::{covers, is_at};
    let offer_id = offer_id.and_then(serde_json::Value::as_str);
    let Some(offer) = world.offers.iter().find(|o| Some(o.id.as_str()) == offer_id) else {
        return Some("that offer is gone");
    };
    if offer.realm_id == side {
        return Some("that offer is your own");
    }
    if offer.direct.as_ref().is_some_and(|d| d.carried.is_some() && d.to_id == side) {
        return Some("a carried offer is accepted from anywhere");
    }
    if !offer_open_to(offer, side) {
        return Some("that offer is for another realm");
    }
    if !super::residents::can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t trade");
    }
    let storage = world.buildings.iter().find(|b| b.id == offer.storage_id);
    let size = csp_shared::balance::MAP_SIZE;
    let Some(storage) = storage
        .filter(|s| covers(super::names::placed(s), resident.x as i32, resident.y as i32, size))
    else {
        return Some("not at that offer’s storage");
    };
    if !is_count(times) {
        return Some("times must be a whole number");
    }
    let mut stock = &resident.carried;
    if let Some(id) = carriage_id.filter(|v| !v.is_null()) {
        let k = world.carriages.iter().find(|x| Some(x.id.as_str()) == id.as_str());
        if !super::command::commands_carriage(world, side, k) {
            return Some("not one of your carriages");
        }
        let k = k.expect("commanded");
        if !is_at((k.x as i32, k.y as i32), super::names::placed(storage), size) {
            return Some("that carriage is not at the storage");
        }
        stock = &k.load;
    }
    if stock.get(&offer.wants).copied().unwrap_or(0.0) < offer.wants_units {
        return Some("not enough to pay for it even once");
    }
    None
}
