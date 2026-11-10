//! Cities as places (`CONTEXT.md`: City building, Outpost storage, Town hall), ported from
//! `apps/server/src/cities.ts`.

use std::collections::{HashMap, HashSet};

use csp_shared::world::{BuildingKind, City, WorldState};

use crate::names::unique_name;
use crate::random::hash_str;

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

/// City names (`CITY_NAMES`). Only flavour, like resident names.
pub const CITY_NAMES: [&str; 20] = [
    "Ashford",
    "Brackenholt",
    "Coldwater",
    "Dunmere",
    "Eastwick",
    "Fallowby",
    "Greyhaven",
    "Hartwell",
    "Ironside",
    "Juniper",
    "Kettleby",
    "Larkspur",
    "Millbrook",
    "Northam",
    "Oakhurst",
    "Pinecrest",
    "Quarrytown",
    "Redbank",
    "Stonebridge",
    "Thornbury",
];

/// The name the game gives a new city (`givenCityName`): `drawn`, or the next one of
/// `CITY_NAMES` no city has, or with a numeral once the list runs dry; marked as the game's.
pub fn given_city_name(world: &WorldState, drawn: &str) -> String {
    let taken: HashSet<String> = world.cities.iter().map(|c| c.name.clone()).collect();
    unique_name(drawn, &taken, &CITY_NAMES)
}

pub use crate::city_layout::pick_layout;

/// Founds a city around the town hall at `hall` just finished (`foundCity`), belonging to
/// `realm_id`. Its name is drawn from its id; one of no realm gets a layout. Returns the city's
/// index.
pub fn found_city(world: &mut WorldState, hall: usize, realm_id: Option<&str>) -> usize {
    let id = format!("city{}", world.next_id);
    world.next_id += 1;
    let drawn = CITY_NAMES[hash_str(&format!("{}:{id}", world.seed)) as usize % CITY_NAMES.len()];
    let name = given_city_name(world, drawn);
    let layout = realm_id.is_none().then(|| pick_layout(world.seed, &id));
    world.cities.push(City {
        id: id.clone(),
        name,
        game_name: Some(true),
        realm_id: realm_id.map(str::to_string),
        town_hall_id: world.buildings[hall].id.clone(),
        trade_org: None,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        layout,
    });
    world.buildings[hall].city_id = Some(id);
    world.cities.len() - 1
}

/// Dissolves a city whose town hall is gone (`dissolveCity`): its buildings and residents stay
/// (its storages as outpost storages of its realm), its residents are homeless and their pairs
/// end; horses and carriages of an NPC city belong to nobody.
pub fn dissolve_city(world: &mut WorldState, city_id: &str) {
    let Some(ci) = world.cities.iter().position(|c| c.id == city_id) else { return };
    let city = world.cities.remove(ci);
    for b in &mut world.buildings {
        if b.city_id.as_deref() == Some(city_id)
            && b.kind == BuildingKind::Storage
            && b.site.is_none()
        {
            if let Some(realm) = &city.realm_id {
                b.realm_id = Some(realm.clone());
            }
        }
    }
    for r in &mut world.residents {
        if r.city_id.as_deref() == Some(city_id) {
            r.city_id = None;
            r.pair = None;
        }
    }
    for h in &mut world.horses {
        if h.city_id.as_deref() == Some(city_id) {
            h.city_id = None;
        }
    }
    for k in &mut world.carriages {
        if k.city_id.as_deref() == Some(city_id) {
            k.city_id = None;
        }
    }
}

#[cfg(test)]
mod tests;
