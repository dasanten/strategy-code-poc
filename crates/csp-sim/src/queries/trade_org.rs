//! Trade Organization queries of `packages/shared/src/trade-org.ts` and `tradeOrgRefuses` of
//! `standing.ts` (`CONTEXT.md`: Trade Organization, Trade Org reaction).

use csp_shared::balance::TRADE_ORG_REFUSES_TRADE_BELOW;
use csp_shared::world::{City, Resident, TradeOrgCity, WorldState};

use super::directive::directive_against;
use super::standing::{standing_of, standing_organization, TRADE_ORG};

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
