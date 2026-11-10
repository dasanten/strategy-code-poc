//! Buying an NPC city (`apps/server/src/buying.ts`, `CONTEXT.md`: Buying a city): the buy order,
//! carried out the tick it is given, and its invariants.

use csp_shared::balance::{CITY_PRICE_STANDING_SWING, MAP_SIZE};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    BuyCityOrder, Good, OrderRequest, RealmEventWhat, ResidentOrder, WorldState,
};
use serde_json::Value;

use crate::goods_deps::{join_realm, realm_of, record_event, OrderSender};
use crate::queries::city::{city_price, for_sale, sells_to, town_hall_of};
use crate::queries::command::commands;
use crate::queries::goods::take_out;
use crate::queries::names::{held, placed};
use crate::queries::trade_quotes::{buy_problem, buyers_at_town_hall, coins_at_town_hall};
use crate::sight::InvariantViolation;

/// Checks a buy order (`buyCity.validate`): one of the Player's residents, standing on an NPC
/// city's town hall, buys it with the coins the realm's residents there carry.
pub fn validate_buy_city(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let realm = realm_of(world, sender.user_id);
    let id = order.fields.get("residentId").and_then(Value::as_str);
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    buy_problem(world, &realm.id, r.expect("commanded"), order.fields.get("cityId"))
}

/// Gives a buy order (`buyCity.apply`).
pub fn apply_buy_city(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let id = order.fields.get("residentId").and_then(Value::as_str);
    let city_id =
        order.fields.get("cityId").and_then(Value::as_str).unwrap_or_default().to_string();
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::BuyCity(BuyCityOrder { city_id }));
    }
}

/// Carries out buy orders (`resolvePurchases`). Where the city still sells to the realm, the buyer
/// still stands on its town hall and the realm's residents there carry its price, the coins are
/// used up, the buyer's own first, and the city joins the realm (`join_realm`). Too few coins, and
/// the deal falls through with a line in the realm log. Either way the order is done. Returns how
/// many cities were bought.
pub fn resolve_purchases(world: &mut WorldState, size: i32) -> usize {
    let mut bought = 0;
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::BuyCity(o)) = world.residents[ri].order.clone() else { continue };
        world.residents[ri].order = None;
        let Some(ci) = world.cities.iter().position(|c| c.id == o.city_id) else { continue };
        let city = &world.cities[ci];
        let Some(hall) = town_hall_of(world, city) else { continue };
        let Some(realm) = world.residents[ri].owner.clone() else { continue };
        if !sells_to(world, city, &realm) {
            continue;
        }
        let r = &world.residents[ri];
        if !is_at((r.x as i32, r.y as i32), placed(hall), size) {
            continue;
        }
        let (hx, hy) = (hall.x, hall.y);
        let price = city_price(world, city, Some(&realm));
        let coins = coins_at_town_hall(world, city, &realm);
        let (city_id, name) = (city.id.clone(), city.name.clone());
        if coins < price {
            let what = RealmEventWhat::CityNotBought { city_id, city: name, price, coins };
            record_event(world, Some(&realm), what);
            continue;
        }
        let mut owed = price;
        let mut payers = vec![ri];
        payers.extend(buyers_at_town_hall(world, city, &realm).into_iter().filter(|&p| p != ri));
        for p in payers {
            let carried = &mut world.residents[p].carried;
            let paid = owed.min(held(carried, Good::Coins));
            owed -= paid;
            take_out(carried, Good::Coins, paid);
            if owed == 0.0 {
                break;
            }
        }
        let residents = join_realm(world, ci, &realm, size);
        let what =
            RealmEventWhat::CityBought { city_id, city: name, price, residents, x: hx, y: hy };
        record_event(world, Some(&realm), what);
        bought += 1;
    }
    bought
}

/// `resolve_purchases` on a map of `MAP_SIZE` tiles.
pub fn resolve_purchases_default(world: &mut WorldState) -> usize {
    resolve_purchases(world, MAP_SIZE)
}

/// An NPC city's price to every Organization it holds a standing toward is a whole number of coins
/// within `CITY_PRICE_STANDING_SWING` of what it is worth (`city-prices-sound`).
pub fn city_prices_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        if !for_sale(city) {
            continue;
        }
        let worth = city_price(world, city, None);
        for s in &world.standings {
            if s.of != city.id {
                continue;
            }
            let price = city_price(world, city, Some(&s.toward));
            let low = (worth * (1.0 - CITY_PRICE_STANDING_SWING)).floor();
            let high = (worth * (1.0 + CITY_PRICE_STANDING_SWING)).ceil();
            if price.is_finite() && price.fract() == 0.0 && price >= low && price <= high {
                continue;
            }
            out.push(InvariantViolation {
                invariant: "city-prices-sound".into(),
                message: format!("{} asks {} {} coins, worth {}", city.id, s.toward, price, worth),
                entity_ids: vec![city.id.clone(), s.toward.clone()],
            });
        }
    }
    out
}

/// Every buy order is done the tick it is given: none outlasts a tick (`buy-orders-done`).
pub fn buy_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::BuyCity(_))))
        .map(|r| InvariantViolation {
            invariant: "buy-orders-done".into(),
            message: format!("resident {} still holds a buy order after the tick", r.id),
            entity_ids: vec![r.id.clone()],
        })
        .collect()
}
