//! A wandering trader at a stop, read only (`packages/shared/src/trader-trade.ts`, `CONTEXT.md`:
//! Trader stop): where it stands and its prices.

use csp_shared::balance::{TRADER_FLOOR_SHARE, WAREHOUSE_FLOOR};
use csp_shared::protocol::{ShownTraderPrice, StandingTrader};
use csp_shared::world::{Carriage, Good, Stock, Trader, WorldState};

use super::carriages::caravan_food_for;
use super::names::{good_name, held, PRICED_GOODS};
use super::warehouse::{price_for, Price};

/// Where a wandering trader stands at a stop now, if it does (`traderStanding`): it has reached
/// the stop's tile, its time there isn't up, and it still has a driver.
pub fn trader_standing(world: &WorldState, t: &Trader) -> Option<StandingTrader> {
    let s = t.stand.as_ref()?;
    let until = s.until?;
    if world.tick as f64 >= until || t.driver_id.is_none() {
        return None;
    }
    let k = world.carriages.iter().find(|c| c.id == t.carriage_id)?;
    if k.x != s.x || k.y != s.y {
        return None;
    }
    Some(StandingTrader { city_id: s.city_id.clone(), x: s.x, y: s.y, until })
}

/// What a trader has to trade of its load (`traderStock`): all of it but its crew's Food.
pub fn trader_stock(escorts: usize, load: &Stock) -> Stock {
    let mut stock = load.clone();
    let food = (held(load, Good::Food) - caravan_food_for(escorts as f64)).max(0.0);
    stock.insert(Good::Food, food);
    stock
}

/// A wandering trader's price for one unit of a good (`traderPriceFor`): a warehouse's, from a
/// share of a warehouse's floor.
pub fn trader_price_for(good: Good, stock: f64) -> Price {
    let floor = WAREHOUSE_FLOOR.get(good_name(good)).expect("a floor for every good");
    price_for(good, stock, floor * TRADER_FLOOR_SHARE)
}

/// One line of what a wandering trader names (`TraderPrice`).
#[derive(Debug, Clone, PartialEq)]
pub struct TraderPrice {
    pub good: Good,
    pub stock: f64,
    pub buy: f64,
    pub sell: f64,
}

impl TraderPrice {
    /// The line as a side sees it (`Shown<TraderPrice>`): what is held only when it sees inside.
    pub fn shown(&self, inside: bool) -> ShownTraderPrice {
        ShownTraderPrice {
            good: self.good,
            buy: self.buy,
            sell: self.sell,
            stock: inside.then_some(self.stock),
        }
    }
}

/// A wandering trader's prices for every good but coins (`traderPrices`).
pub fn trader_prices(t: &Trader, carriage: &Carriage) -> Vec<TraderPrice> {
    let stock = trader_stock(t.escort_ids.len(), &carriage.load);
    PRICED_GOODS
        .iter()
        .map(|&good| {
            let have = held(&stock, good);
            let p = trader_price_for(good, have);
            TraderPrice { good, stock: have, buy: p.buy, sell: p.sell }
        })
        .collect()
}
