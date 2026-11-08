//! Trade Organization queries of `packages/shared/src/trade-org.ts` (`CONTEXT.md`: Trade Org HQ).

use csp_shared::world::{City, Resident, TradeOrgCity, WorldState};

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
