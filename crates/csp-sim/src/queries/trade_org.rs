//! Trade Organization queries of `packages/shared/src/trade-org.ts` and `tradeOrgRefuses` of
//! `standing.ts` (`CONTEXT.md`: Trade Organization, Trade Org HQ, Trade Org reaction).

use csp_shared::balance::{TRADE_ORG_HQ, TRADE_ORG_REFUSES_TRADE_BELOW};
use csp_shared::footprint::middle_of;
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{City, Resident, TradeOrgCity, WorldState};

use super::city::town_hall_of;
use super::names::placed;
use super::standing::{standing_of, standing_organization, TRADE_ORG};
use crate::directive::directive_against;

/// Why nothing goes by caravan once the HQ is gone (`NO_CARAVANS`).
pub const NO_CARAVANS: &str = "no caravans run since the Trade Org HQ fell";

/// The Trade Org HQ, if the world has one (`tradeOrgHq`).
pub fn trade_org_hq(world: &WorldState) -> Option<&City> {
    world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq))
}

/// Whether the resident is one of the HQ's own residents (`ofTradeOrgHq`).
pub fn of_trade_org_hq(world: &WorldState, r: &Resident) -> bool {
    r.owner.is_none()
        && r.city_id.is_some()
        && trade_org_hq(world).is_some_and(|hq| r.city_id.as_deref() == Some(hq.id.as_str()))
}

/// Whether the Trade Organization refuses to trade with an Organization (`tradeOrgRefuses`): it
/// holds it below `TRADE_ORG_REFUSES_TRADE_BELOW`, or a directive has it punish it.
pub fn trade_org_refuses(world: &WorldState, org: &str) -> bool {
    standing_of(world, TRADE_ORG, org) < TRADE_ORG_REFUSES_TRADE_BELOW
        || (standing_organization(world, org) != TRADE_ORG
            && directive_against(world, org).is_some())
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
