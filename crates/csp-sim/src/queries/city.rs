//! City queries of `packages/shared/src/city.ts`: its town hall and residents, what it eats, and
//! buying an NPC city (`CONTEXT.md`: Buying a city, NPC city reaction).

use csp_shared::balance::{
    CITY_PRICE_BY_BUILDING, CITY_PRICE_PER_RESIDENT, CITY_PRICE_STANDING_SWING, FOOD_PER_DAY,
    NPC_CITY_REFUSES_STANDING, NPC_CITY_WONT_SELL_STANDING, STANDING_RANGE,
};
use csp_shared::world::{Building, City, Resident, WorldState};

use super::js_round;
use super::names::kind_name;
use super::residents::hunger_factor;
use super::standing::standing_of;

/// A city's town hall, if it stands (`townHallOf`).
pub fn town_hall_of<'w>(world: &'w WorldState, city: &City) -> Option<&'w Building> {
    world.buildings.iter().find(|b| b.id == city.town_hall_id)
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
