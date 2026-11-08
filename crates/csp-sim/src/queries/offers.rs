//! Offer queries of `packages/shared/src/offers.ts` (`CONTEXT.md`: Offer).

use csp_shared::world::offers::SeenOffer;
use csp_shared::world::{Offer, WorldState};

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
