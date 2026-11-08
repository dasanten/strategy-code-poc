//! The one query of `packages/shared/src/territory.ts` sight needs.

use csp_shared::world::City;

/// The Trade Organization's id as an Organization projecting control (`TRADE_ORGANIZATION`).
/// Not the same string as [`super::standing::TRADE_ORG`], as in the TypeScript.
pub const TRADE_ORGANIZATION: &str = "tradeOrg";

/// The Organization a city projects control for (`cityOrganization`): the Trade Organization
/// for its cities, else its realm, or itself when it has none.
pub fn city_organization(city: &City) -> &str {
    if city.trade_org.is_some() {
        TRADE_ORGANIZATION
    } else {
        city.realm_id.as_deref().unwrap_or(&city.id)
    }
}
