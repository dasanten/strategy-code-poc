//! Minimal private stand-ins for helpers other tickets of Epic 86 port, so building and work
//! (T86.6) compile and test on their own. Each says which ticket replaces it; once that lands,
//! its callers switch over and the stand-in goes.

use csp_shared::world::{Building, City, WorldState};

/// Founds a city around a finished town hall (`foundCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn found_city(_world: &mut WorldState, _town_hall_id: &str, _realm_id: Option<&str>) {}

/// Brings every city's buildings up to date with where they stand (`updateCityMembership`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn update_city_membership(_world: &mut WorldState, _size: i32) {}

/// Dissolves a city whose town hall is gone (`dissolveCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn dissolve_city(world: &mut WorldState, city_id: &str) {
    world.cities.retain(|c: &City| c.id != city_id);
}

/// Taking down another Organization's building is a crime (`buildingOrganization`,
/// `commitCrime`).
// TODO(T86.7): `crimes.ts`.
pub(crate) fn commit_tear_down_crime(
    _world: &mut WorldState,
    _resident_id: &str,
    _building: &Building,
    _size: i32,
) {
}
