//! Minimal stand-ins for helpers other rule tickets own, so the conflict rules (T86.7) can call
//! them before those land. Each says whose it is; the ticket that ports the real one replaces the
//! call sites and deletes the stand-in here.

use csp_shared::world::WorldState;

/// `joinTradeOrg`, in `caravans.rs`.
pub(crate) fn join_trade_org(
    world: &mut WorldState,
    city_id: &str,
    size: i32,
    terrain: Option<&csp_shared::terrain::TerrainMap>,
) {
    crate::caravans::join_trade_org(world, city_id, size, terrain);
}

/// `leaveTradeOrg`, in `caravans.rs`.
pub(crate) fn leave_trade_org(world: &mut WorldState, city_id: &str) {
    crate::caravans::leave_trade_org(world, city_id);
}

/// `rejoinTradeOrg`, in `caravans.rs`.
pub(crate) fn rejoin_trade_org(world: &mut WorldState, city_id: &str, size: i32) {
    crate::caravans::rejoin_trade_org(world, city_id, size);
}
