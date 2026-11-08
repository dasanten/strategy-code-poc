//! Minimal private stand-ins for helpers other tickets of Epic 86 port, so building and work
//! (T86.6) compile and test on their own. Each says which ticket replaces it; once that lands,
//! its callers switch over and the stand-in goes.

use csp_shared::world::{Building, CrimeKind, WorldState};

use crate::crimes::{building_organization, commit_crime, CrimeAgainst};

pub(crate) use crate::cities::update_city_membership;

/// Founds a city around the finished town hall `town_hall_id` (`foundCity` of `cities.ts`).
pub(crate) fn found_city(world: &mut WorldState, town_hall_id: &str, realm_id: Option<&str>) {
    if let Some(hall) = world.buildings.iter().position(|b| b.id == town_hall_id) {
        crate::cities::found_city(world, hall, realm_id);
    }
}

pub(crate) use crate::cities::dissolve_city;

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
