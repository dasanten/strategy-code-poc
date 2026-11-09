//! Minimal stand-ins for helpers other rule tickets own, so the conflict rules (T86.7) can call
//! them before those land. Each says whose it is; the ticket that ports the real one replaces the
//! call sites and deletes the stand-in here.

use csp_shared::world::WorldState;

/// `workplacesOfCity` (TODO(T86.9), `trade-org-wrecks.ts`): building ids. None until it lands.
pub(crate) fn workplaces_of_city(_world: &WorldState, _city_id: &str, _size: i32) -> Vec<String> {
    Vec::new()
}

/// `joinTradeOrg`, in `caravans.rs`.
pub(crate) fn join_trade_org(world: &mut WorldState, city_id: &str, size: i32) {
    crate::caravans::join_trade_org(world, city_id, size);
}

/// `leaveTradeOrg`, in `caravans.rs`.
pub(crate) fn leave_trade_org(world: &mut WorldState, city_id: &str) {
    crate::caravans::leave_trade_org(world, city_id);
}

/// `rejoinTradeOrg`, in `caravans.rs`.
pub(crate) fn rejoin_trade_org(world: &mut WorldState, city_id: &str, size: i32) {
    crate::caravans::rejoin_trade_org(world, city_id, size);
}

/// `hqFalls` (TODO(T86.9), `hq-fall.ts`).
pub(crate) fn hq_falls(_world: &mut WorldState, _city_id: &str) {}
