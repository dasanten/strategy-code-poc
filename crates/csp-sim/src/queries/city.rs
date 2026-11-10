//! City queries of `packages/shared/src/city.ts`: its town hall and residents, what it eats, and
//! buying an NPC city (`CONTEXT.md`: Buying a city, NPC city reaction).

use csp_shared::balance::{
    CITY_AREA_MARGIN, CITY_PRICE_BY_BUILDING, CITY_PRICE_PER_RESIDENT, CITY_PRICE_STANDING_SWING,
    FOOD_PER_DAY, NPC_CITY_REFUSES_STANDING, NPC_CITY_WONT_SELL_STANDING, STANDING_RANGE,
};
use csp_shared::footprint::near_footprint;
use csp_shared::world::{Building, BuildingKind, City, Resident, WorldState};

use super::js_round;
use super::names::{kind_name, placed};
use super::residents::hunger_factor;
use super::standing::standing_of;

/// A city's town hall, if it stands (`townHallOf`).
pub fn town_hall_of<'w>(world: &'w WorldState, city: &City) -> Option<&'w Building> {
    crate::world_index::building_by_id(world, &city.town_hall_id)
}

/// The residents who live in a city, wherever they stand (`cityResidents`).
pub fn city_residents<'w>(world: &'w WorldState, city_id: &str) -> Vec<&'w Resident> {
    world.residents.iter().filter(|r| r.city_id.as_deref() == Some(city_id)).collect()
}

/// Food all of a city's residents eat in `days` game days, by their Endurance (`cityFoodUse`).
pub fn city_food_use(world: &WorldState, city: &City, days: f64) -> f64 {
    city_residents(world, &city.id)
        .iter()
        .fold(0.0, |food, r| food + FOOD_PER_DAY * hunger_factor(r, world.tick as f64) * days)
}

/// Whether a city can be bought (`forSale`): an NPC city, never the Trade Organization's nor a
/// Player's.
pub fn for_sale(city: &City) -> bool {
    city.realm_id.is_none() && city.trade_org.is_none()
}

/// Whether an NPC city refuses an Organization (`npcCityRefuses`): its standing toward it is
/// below `NPC_CITY_REFUSES_STANDING`.
pub fn npc_city_refuses(world: &WorldState, city: &City, org: &str) -> bool {
    for_sale(city) && standing_of(world, &city.id, org) < NPC_CITY_REFUSES_STANDING
}

/// Whether an NPC city sells itself to a realm (`sellsTo`): for sale, and its standing toward
/// the realm not below `NPC_CITY_WONT_SELL_STANDING`.
pub fn sells_to(world: &WorldState, city: &City, realm_id: &str) -> bool {
    for_sale(city) && standing_of(world, &city.id, realm_id) >= NPC_CITY_WONT_SELL_STANDING
}

/// The price in Coins an NPC city names (`cityPrice`): from its residents and finished buildings,
/// moved by its standing toward the buyer, if one is named.
pub fn city_price(world: &WorldState, city: &City, buyer_id: Option<&str>) -> f64 {
    let residents = city_residents(world, &city.id).len() as f64;
    let buildings = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city.id.as_str()) && b.site.is_none())
        .fold(0.0, |sum, b| sum + CITY_PRICE_BY_BUILDING.get(kind_name(b.kind)).unwrap_or(0.0));
    let worth = js_round(residents * CITY_PRICE_PER_RESIDENT + buildings);
    let Some(buyer) = buyer_id else {
        return worth;
    };
    let standing = standing_of(world, &city.id, buyer);
    js_round(worth * (1.0 - (CITY_PRICE_STANDING_SWING * standing) / STANDING_RANGE))
}

/// The kinds that make a city's shape (`CITY_BUILDINGS`).
pub const CITY_BUILDINGS: [BuildingKind; 6] = [
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Warehouse,
    BuildingKind::Wall,
    BuildingKind::Gate,
];

/// Whether a building counts toward a city's shape: a finished city building (`isCityBuilding`).
pub fn is_city_building(b: &Building) -> bool {
    CITY_BUILDINGS.contains(&b.kind) && b.site.is_none()
}

/// Whether a tile lies in a city's area (`inCityArea`, `CONTEXT.md`: City area): within
/// `CITY_AREA_MARGIN` of the footprint of one of its finished city buildings, the footprints
/// included. `size` is the map's.
pub fn in_city_area(world: &WorldState, city_id: &str, x: i32, y: i32, size: i32) -> bool {
    world.buildings.iter().any(|b| {
        b.city_id.as_deref() == Some(city_id)
            && is_city_building(b)
            && near_footprint(placed(b), (x, y), CITY_AREA_MARGIN as i32, size)
    })
}

/// The realm a building belongs to (`buildingRealm`): its city's realm, or an outpost storage's
/// own (`CONTEXT.md`: Outpost storage); `None` for one of no realm. A construction site laid out
/// by a realm's resident is that realm's until it is finished.
pub fn building_realm<'w>(world: &'w WorldState, b: &'w Building) -> Option<&'w str> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.as_deref();
    }
    if let Some(city_id) = &b.city_id {
        return world.cities.iter().find(|c| &c.id == city_id).and_then(|c| c.realm_id.as_deref());
    }
    b.realm_id.as_deref()
}

/// Whether a building is an outpost storage (`isOutpostStorage`, `CONTEXT.md`: Outpost storage):
/// a finished storage of no city.
pub fn is_outpost_storage(b: &Building) -> bool {
    b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.is_none()
}

/// Food in a city's finished storages that is not set aside for an offer (`storedFood`).
pub fn stored_food(world: &WorldState, city: &City) -> f64 {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        })
        .map(|b| {
            super::names::held(
                &super::offers::free_stock(world, &b.id, b.stock.as_ref()),
                csp_shared::world::Good::Food,
            )
        })
        .fold(0.0, |food, n| food + n)
}

/// Food all of a city's residents eat in `FOOD_SURPLUS_DAYS` game days (`surplusFoodLine`).
pub fn surplus_food_line(world: &WorldState, city: &City) -> f64 {
    city_food_use(world, city, csp_shared::balance::FOOD_SURPLUS_DAYS)
}

/// Whether a city has a food surplus (`hasFoodSurplus`, `CONTEXT.md`: Food surplus): its storages
/// hold more Food than all its residents eat in `FOOD_SURPLUS_DAYS` game days.
pub fn has_food_surplus(world: &WorldState, city: &City) -> bool {
    stored_food(world, city) > surplus_food_line(world, city)
}
