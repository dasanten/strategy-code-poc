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

/// What accepting an offer some times comes to (`OfferQuote`): how many times, what it gives and
/// wants in all, and what held it below `wanted`, if anything.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OfferQuote {
    pub times: f64,
    pub gives: f64,
    pub wants: f64,
    pub limit: Option<OfferLimit>,
}

/// What held an offer quote below what was wanted (`OfferQuote.limit`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfferLimit {
    Stock,
    Coins,
    Held,
    Room,
}

/// Whether an offer gives for nothing (`wantsNothing`).
pub fn wants_nothing(o: &Offer) -> bool {
    o.wants_units == 0.0
}

/// How many times `holder` can accept the offer, up to `wanted` (`quoteOffer`): as often as it has
/// left with `available` units of what it gives in its storage, as `holder` can pay for, and as
/// what it gains in weight fits in their room.
pub fn quote_offer(
    offer: &Offer,
    holder: &crate::queries::warehouse_trade::TradeHolder<'_>,
    wanted: f64,
    available: f64,
) -> OfferQuote {
    use crate::queries::residents::good_weight;
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
    let mut quote = OfferQuote {
        times,
        gives: times * offer.gives_units,
        wants: times * offer.wants_units,
        limit: None,
    };
    quote.limit = if times == wanted {
        None
    } else if times == left {
        Some(OfferLimit::Stock)
    } else if times == paid {
        Some(if offer.wants == csp_shared::world::Good::Coins {
            OfferLimit::Coins
        } else {
            OfferLimit::Held
        })
    } else {
        Some(OfferLimit::Room)
    };
    quote
}
