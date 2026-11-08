//! Minimal private stand-ins for helpers other tickets of Epic 86 port, so building and work
//! (T86.6) compile and test on their own. Each says which ticket replaces it; once that lands,
//! its callers switch over and the stand-in goes.

use csp_shared::world::{Building, City, CrimeKind, WorldState};

use crate::crimes::{building_organization, commit_crime, CrimeAgainst};

pub(crate) use crate::cities::update_city_membership;

/// Founds a city around a finished town hall (`foundCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn found_city(_world: &mut WorldState, _town_hall_id: &str, _realm_id: Option<&str>) {}

/// Dissolves a city whose town hall is gone (`dissolveCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn dissolve_city(world: &mut WorldState, city_id: &str) {
    world.cities.retain(|c: &City| c.id != city_id);
}

/// Taking down another Organization's building is a crime (`buildingOrganization`, `commitCrime`
/// of `teardown.ts`), noted before the building goes.
pub(crate) fn commit_tear_down_crime(
    world: &mut WorldState,
    resident_id: &str,
    building: &Building,
    size: i32,
) {
    let victim_org = building_organization(world, building);
    let against =
        CrimeAgainst { victim_org, building: Some(building.kind), ..CrimeAgainst::default() };
    commit_crime(world, size, CrimeKind::TearDown, resident_id, against);
}
