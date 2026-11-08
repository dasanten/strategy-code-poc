//! Cities as places (`CONTEXT.md`: City building, Outpost storage, Town hall), ported from
//! `apps/server/src/cities.ts`.

use std::collections::HashMap;

use csp_shared::world::{BuildingKind, WorldState};

use crate::queries::city_area::{city_membership, is_city_building};

/// Brings every building's city up to date with where the buildings stand
/// (`updateCityMembership`): each finished city building belongs to the city whose chain it is
/// part of, or to none. A farm or stable keeps the city it was laid out for while that city
/// exists. A storage a city takes in is that city's; one cut off from its city stays its realm's,
/// as an outpost storage. `size` is the map's.
pub fn update_city_membership(world: &mut WorldState, size: i32) {
    let members = city_membership(world, size);
    let realms: HashMap<String, Option<String>> =
        world.cities.iter().map(|c| (c.id.clone(), c.realm_id.clone())).collect();
    for b in &mut world.buildings {
        if is_city_building(b) {
            let city_id = members.get(&b.id).cloned();
            if b.kind == BuildingKind::Storage {
                let last_realm = b.city_id.as_ref().and_then(|c| realms.get(c).cloned().flatten());
                if city_id.is_some() {
                    b.realm_id = None;
                } else if last_realm.is_some() {
                    b.realm_id = last_realm;
                }
            }
            b.city_id = city_id;
        } else if b.city_id.as_ref().is_some_and(|c| !realms.contains_key(c)) {
            b.city_id = None;
        }
    }
}
