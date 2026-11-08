//! The Trade Organization queries of `packages/shared/src/trade-org.ts` that combat needs
//! (`CONTEXT.md`: Trade Org HQ, Trade Org army). The rest of the file is T86.9's to add here.

use csp_shared::balance::TRADE_ORG_HQ;
use csp_shared::footprint::middle_of;
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{City, Resident, TradeOrgCity, WorldState};

use super::city::town_hall_of;
use super::names::placed;

/// The Trade Org HQ, if the world has one (`tradeOrgHq`).
pub fn trade_org_hq(world: &WorldState) -> Option<&City> {
    world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq))
}

/// Whether the resident is one of the Trade Org HQ's own residents (`ofTradeOrgHq`).
pub fn of_trade_org_hq(world: &WorldState, r: &Resident) -> bool {
    r.owner.is_none()
        && r.city_id.is_some()
        && r.city_id.as_deref() == trade_org_hq(world).map(|c| c.id.as_str())
}

/// Whether a tile is on or inside the Trade Org HQ's inner ring (`inInnerRing`).
pub fn in_inner_ring(world: &WorldState, at: (f64, f64), size: i32) -> bool {
    let Some(hall) = trade_org_hq(world).and_then(|hq| town_hall_of(world, hq)) else {
        return false;
    };
    let (cx, cy) = middle_of(placed(hall), size);
    let dx = f64::from(wrap_delta(cx, at.0 as i32, size));
    let dy = f64::from(wrap_delta(cy, at.1 as i32, size));
    dx.hypot(dy) <= TRADE_ORG_HQ.inner_radius + 0.5
}
