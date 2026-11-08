//! The Horse market, read only (`packages/shared/src/horse-market.ts`, `CONTEXT.md`: Horse
//! market): what an NPC city asks for a horse or pays for one, and whether it sells or buys it.

use csp_shared::balance::{
    HORSE_PRICE_AGE_FLOOR, HORSE_PRICE_AGE_PER_YEAR, HORSE_PRICE_BASE, HORSE_PRICE_GLUT,
    HORSE_PRICE_PAID_SHARE, HORSE_PRICE_PER_STAT, HORSE_PRICE_SCARCITY, HORSE_PRICE_STATS_FLOOR,
    HORSE_STAT_AVERAGE, NPC_HORSES_KEPT,
};
use csp_shared::world::horse_market::NpcHorseOffer;
use csp_shared::world::{Building, City, Good, Horse, WorldState};

use super::carriages::carriage_pulled_by;
use super::city::npc_city_refuses;
use super::horses::{horses_in, owns_horse, rider_of, HorseOwner};
use super::js_round;
use super::names::held;
use super::npc_trade::{npc_city_stock, npc_horses_wanted, npc_storages, standing_swing};
use super::residents::{horse_age_in_years, is_down};

/// What a horse is worth for its stats and age, as a share of `HORSE_PRICE_BASE` (`horseWorth`).
pub fn horse_worth(horse: &Horse, tick: f64) -> f64 {
    let s = &horse.stats;
    let mean = (s.speed + s.strength + s.endurance) / 3.0;
    let stats =
        HORSE_PRICE_STATS_FLOOR.max(1.0 + HORSE_PRICE_PER_STAT * (mean - HORSE_STAT_AVERAGE));
    let age =
        HORSE_PRICE_AGE_FLOOR.max(1.0 - HORSE_PRICE_AGE_PER_YEAR * horse_age_in_years(horse, tick));
    stats * age
}

/// How an NPC city's stock of horses moves its price, as a share (`horseStockFactor`).
pub fn horse_stock_factor(has: f64, wanted: f64) -> f64 {
    let short = (wanted - has) / 1f64.max(wanted - NPC_HORSES_KEPT);
    1.0 + HORSE_PRICE_SCARCITY * (-HORSE_PRICE_GLUT).max(1f64.min(short))
}

/// The horses an NPC city has, wherever they stand (`npcHorsesOf`).
pub fn npc_horses_of<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Horse> {
    world.horses.iter().filter(|h| owns_horse(HorseOwner::City(&city.id), h)).collect()
}

/// A horse's price at an NPC city with `has` horses, before standing moves it
/// (`horseBasePrice`).
fn horse_base_price(world: &WorldState, city: &City, horse: &Horse, has: f64) -> f64 {
    let stock = horse_stock_factor(has, npc_horses_wanted(world, city));
    HORSE_PRICE_BASE * horse_worth(horse, world.tick as f64) * stock
}

/// What an NPC city asks for a horse (`npcHorsePrice`). Whole Coins, at least one.
pub fn npc_horse_price(
    world: &WorldState,
    city: &City,
    horse: &Horse,
    trader_id: Option<&str>,
) -> f64 {
    let base = horse_base_price(world, city, horse, npc_horses_of(world, city).len() as f64);
    let swing = standing_swing(world, city, trader_id);
    1f64.max(js_round(base * (1.0 - swing)))
}

/// What an NPC city pays for a horse (`npcHorseBuyPrice`): at least a Coin lower than it would
/// ask for it back. Whole Coins, at least one.
pub fn npc_horse_buy_price(
    world: &WorldState,
    city: &City,
    horse: &Horse,
    trader_id: Option<&str>,
) -> f64 {
    let base = horse_base_price(world, city, horse, npc_horses_of(world, city).len() as f64 + 1.0);
    let swing = standing_swing(world, city, trader_id);
    let asks = js_round(base * (1.0 - swing));
    1f64.max((asks - 1.0).min(js_round(base * HORSE_PRICE_PAID_SHARE * (1.0 + swing))))
}

/// Why an NPC city won't sell its horse to a realm, if it won't (`npcHorseSaleProblem`).
pub fn npc_horse_sale_problem(
    world: &WorldState,
    city: &City,
    horse: &Horse,
    realm_id: &str,
) -> Option<String> {
    if npc_city_refuses(world, city, realm_id) {
        return Some(format!("{} won’t trade with you", city.name));
    }
    if carriage_pulled_by(world, &horse.id).is_some() {
        return Some(format!("{} is hitched to a carriage", horse.name));
    }
    if rider_of(world, &horse.id).is_some() {
        return Some(format!("someone rides {}", horse.name));
    }
    if is_down(horse.down_until) {
        return Some(format!("{} is Down", horse.name));
    }
    if npc_horses_of(world, city).len() as f64 <= NPC_HORSES_KEPT {
        return Some(format!("{} keeps its last {NPC_HORSES_KEPT} horses to breed", city.name));
    }
    if npc_storages(world, city).is_empty() {
        return Some(format!("{} has no storage for the Coins", city.name));
    }
    None
}

/// Why an NPC city won't buy a horse from a realm, if it won't (`npcHorsePurchaseProblem`).
pub fn npc_horse_purchase_problem(
    world: &WorldState,
    city: &City,
    horse: &Horse,
    realm_id: &str,
) -> Option<String> {
    if npc_city_refuses(world, city, realm_id) {
        return Some(format!("{} won’t trade with you", city.name));
    }
    if carriage_pulled_by(world, &horse.id).is_some() {
        return Some(format!("{} is hitched to a carriage", horse.name));
    }
    if let Some(rider) = rider_of(world, &horse.id) {
        return Some(format!("{} has to get off {} first", rider.name, horse.name));
    }
    if is_down(horse.down_until) {
        return Some(format!("{} is Down", horse.name));
    }
    if npc_horses_of(world, city).len() as f64 >= npc_horses_wanted(world, city) {
        return Some(format!("{} has all the horses it wants", city.name));
    }
    let coins = held(&npc_city_stock(world, city), Good::Coins);
    if coins < npc_horse_buy_price(world, city, horse, Some(realm_id)) {
        return Some(format!("{} hasn’t the coins for {}", city.name, horse.name));
    }
    None
}

fn offer(stable: &Building, h: &Horse, price: f64, problem: Option<String>) -> NpcHorseOffer {
    NpcHorseOffer {
        horse_id: h.id.clone(),
        stable_id: stable.id.clone(),
        name: h.name.clone(),
        stats: h.stats.clone(),
        born_at: h.born_at,
        price,
        problem,
    }
}

/// The horses an NPC city would list to a realm, of those standing in its stable, with price and
/// why it won't sell each, if so (`npcHorseOffers`).
pub fn npc_horse_offers(
    world: &WorldState,
    city: &City,
    stable: &Building,
    realm_id: &str,
) -> Vec<NpcHorseOffer> {
    horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(HorseOwner::City(&city.id), h))
        .map(|h| {
            let problem = npc_horse_sale_problem(world, city, h, realm_id);
            offer(stable, h, npc_horse_price(world, city, h, Some(realm_id)), problem)
        })
        .collect()
}

/// A realm's horses standing in an NPC city's stable, with what it pays and why it won't buy
/// each, if so (`horsesToSell`).
pub fn horses_to_sell(
    world: &WorldState,
    city: &City,
    stable: &Building,
    realm_id: &str,
) -> Vec<NpcHorseOffer> {
    horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(HorseOwner::Realm(realm_id), h))
        .map(|h| {
            let problem = npc_horse_purchase_problem(world, city, h, realm_id);
            offer(stable, h, npc_horse_buy_price(world, city, h, Some(realm_id)), problem)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_city_short_of_horses_asks_more() {
        assert!(horse_stock_factor(2.0, 6.0) > horse_stock_factor(6.0, 6.0));
        assert_eq!(horse_stock_factor(6.0, 6.0), 1.0);
        assert!(horse_stock_factor(20.0, 6.0) >= 1.0 - HORSE_PRICE_SCARCITY * HORSE_PRICE_GLUT);
    }
}
