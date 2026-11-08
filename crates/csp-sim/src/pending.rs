//! Minimal stand-ins for helpers other rule tickets own, so the conflict rules (T86.7) can call
//! them before those land. Each says whose it is; the ticket that ports the real one replaces the
//! call sites and deletes the stand-in here.

use csp_shared::world::WorldState;

/// A city the Trade Organization took (`CityTaken` of `trade-org-takes.ts`, TODO(T86.9)).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CityTaken {
    pub city_id: String,
    pub org: String,
    pub trips: f64,
    pub enough_trips: bool,
}

/// `noteCityTaken` (TODO(T86.9), `trade-org-takes.ts`): the ledger lives beside the world there.
pub(crate) fn note_city_taken(_world: &mut WorldState, _taken: CityTaken) {}

/// `workplacesOfCity` (TODO(T86.9), `trade-org-wrecks.ts`): building ids. None until it lands.
pub(crate) fn workplaces_of_city(_world: &WorldState, _city_id: &str, _size: i32) -> Vec<String> {
    Vec::new()
}

/// `joinTradeOrg` (TODO(T86.9), `caravans.ts`).
pub(crate) fn join_trade_org(_world: &mut WorldState, _city_id: &str, _size: i32) {}

/// `leaveTradeOrg` (TODO(T86.9), `caravans.ts`): a post stops being one. Only a post does
/// anything there, and none of this ticket's tests has one.
pub(crate) fn leave_trade_org(_world: &mut WorldState, _city_id: &str) {}

/// `rejoinTradeOrg` (TODO(T86.9), `caravans.ts`).
pub(crate) fn rejoin_trade_org(_world: &mut WorldState, _city_id: &str, _size: i32) {}

/// `hqFalls` (TODO(T86.9), `hq-fall.ts`).
pub(crate) fn hq_falls(_world: &mut WorldState, _city_id: &str) {}
