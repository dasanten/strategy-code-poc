//! Standing queries of `packages/shared/src/standing.ts` (`CONTEXT.md`: Standing).

use csp_shared::world::WorldState;

/// The Trade Organization's id as a side in standings, contracts and trades (`TRADE_ORG`).
pub const TRADE_ORG: &str = "trade-org";

/// The Organization an id names for standing (`standingOrganization`): a Trade Org city is the
/// Trade Organization, anything else itself.
pub fn standing_organization<'a>(world: &WorldState, org: &'a str) -> &'a str {
    if world.cities.iter().any(|c| c.id == org && c.trade_org.is_some()) {
        TRADE_ORG
    } else {
        org
    }
}

/// How `of` regards `toward` (`standingOf`); 0 is neutral, also for an Organization itself.
pub fn standing_of(world: &WorldState, of: &str, toward: &str) -> f64 {
    let a = standing_organization(world, of);
    let b = standing_organization(world, toward);
    world.standings.iter().find(|s| s.of == a && s.toward == b).map_or(0.0, |s| s.value)
}
