//! Trade Org warehouse queries of `packages/shared/src/warehouse.ts`, read only (`CONTEXT.md`:
//! Warehouse, Stock floor, Warehouse prices).

use csp_shared::balance::{
    BUY_SHARE, HQ_FLOOR_FACTOR, HQ_FOOD_FLOOR_FACTOR, PRICE_ELASTICITY, PRICE_RANGE,
    PRICE_REFERENCE_FLOORS, WAREHOUSE_BASE_PRICE, WAREHOUSE_FLOOR,
};
use csp_shared::world::warehouse::ShownWarehousePrice;
use csp_shared::world::{Building, BuildingKind, Good, Stock, TradeOrgCity, WorldState};

use super::city::town_hall_of;
use super::js_round;
use super::names::{good_name, held_in, ALL_GOODS, PRICED_GOODS};

/// Where the HQ's coin warehouse stands from its town hall, north-west tile from north-west tile
/// (`HQ_COIN_WAREHOUSE`).
pub const HQ_COIN_WAREHOUSE: (f64, f64) = (4.0, -4.0);

/// The goods a finished Trade Org warehouse keeps (`warehouseKeeps`): a post's every good, the
/// HQ's coin warehouse its coins and its other warehouse every other good; none otherwise.
pub fn warehouse_keeps(world: &WorldState, b: &Building) -> Vec<Good> {
    if b.kind != BuildingKind::Warehouse || b.site.is_some() {
        return Vec::new();
    }
    let Some(city_id) = b.city_id.as_deref() else {
        return Vec::new();
    };
    let city = world.cities.iter().find(|c| c.id == city_id);
    match city.and_then(|c| c.trade_org) {
        Some(TradeOrgCity::Post) => ALL_GOODS.to_vec(),
        Some(TradeOrgCity::Hq) => {
            let Some(hall) = town_hall_of(world, city.expect("an HQ")) else {
                return Vec::new();
            };
            let coins = b.x == hall.x + HQ_COIN_WAREHOUSE.0 && b.y == hall.y + HQ_COIN_WAREHOUSE.1;
            if coins {
                vec![Good::Coins]
            } else {
                PRICED_GOODS.to_vec()
            }
        }
        None => Vec::new(),
    }
}

/// A warehouse's stock floor (`stockFloor`): `WAREHOUSE_FLOOR` of every good it keeps, more at
/// the HQ; empty for any building that is not a Trade Org warehouse.
pub fn stock_floor(world: &WorldState, b: &Building) -> Stock {
    let keeps = warehouse_keeps(world, b);
    let hq = world
        .cities
        .iter()
        .find(|c| b.city_id.as_deref() == Some(c.id.as_str()))
        .is_some_and(|c| c.trade_org == Some(TradeOrgCity::Hq));
    let factor = |g: Good| {
        if !hq {
            1.0
        } else if g == Good::Food {
            HQ_FOOD_FLOOR_FACTOR
        } else {
            HQ_FLOOR_FACTOR
        }
    };
    keeps
        .into_iter()
        .map(|g| {
            (g, WAREHOUSE_FLOOR.get(good_name(g)).expect("a floor for every good") * factor(g))
        })
        .collect()
}

/// What a warehouse pays for (`buy`) and asks for (`sell`) one unit of a good (`Price`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Price {
    pub buy: f64,
    pub sell: f64,
}

/// A warehouse's price for one good from its stock and floor (`priceFor`): the base price at
/// `PRICE_REFERENCE_FLOORS` floors of stock, within `PRICE_RANGE`; it buys at `BUY_SHARE` of
/// that, at least a coin lower. Whole coins.
pub fn price_for(good: Good, stock: f64, floor: f64) -> Price {
    let base =
        WAREHOUSE_BASE_PRICE.get(good_name(good)).expect("a base price for every priced good");
    let reference = 1f64.max(floor * PRICE_REFERENCE_FLOORS);
    let factor = PRICE_RANGE
        .max
        .min(PRICE_RANGE.min.max((reference / 1f64.max(stock)).powf(PRICE_ELASTICITY)));
    let sell = 2f64.max(js_round(base * factor));
    let buy = 1f64.max((sell - 1.0).min((sell * BUY_SHARE).floor()));
    Price { buy, sell }
}

/// One line of a warehouse's prices (`WarehousePrice`): the good, how much it holds, its price.
#[derive(Debug, Clone, PartialEq)]
pub struct WarehousePrice {
    pub good: Good,
    pub stock: f64,
    pub buy: f64,
    pub sell: f64,
}

impl WarehousePrice {
    /// The line as a side sees it (`Shown<WarehousePrice>`): what is held only when it sees inside.
    pub fn shown(&self, inside: bool) -> ShownWarehousePrice {
        ShownWarehousePrice {
            good: self.good,
            buy: self.buy,
            sell: self.sell,
            stock: inside.then_some(self.stock),
        }
    }
}

/// A Trade Org warehouse's prices (`warehousePrices`): every good it keeps but coins, from its
/// own stock; empty for any other building and for the HQ's coin warehouse.
pub fn warehouse_prices(world: &WorldState, b: &Building) -> Vec<WarehousePrice> {
    let floor = stock_floor(world, b);
    PRICED_GOODS
        .iter()
        .filter_map(|&good| {
            let f = *floor.get(&good)?;
            let stock = held_in(b.stock.as_ref(), good);
            let p = price_for(good, stock, f);
            Some(WarehousePrice { good, stock, buy: p.buy, sell: p.sell })
        })
        .collect()
}

/// Where a Trade Org warehouse's coins are when someone trades there (`tradeCoinWarehouse`): a
/// post's own warehouse, at the HQ its coin warehouse; none for a building that prices nothing or
/// when the coin warehouse is gone.
pub fn trade_coin_warehouse<'w>(
    world: &'w WorldState,
    warehouse: &'w Building,
) -> Option<&'w Building> {
    let keeps = warehouse_keeps(world, warehouse);
    if !keeps.iter().any(|g| *g != Good::Coins) {
        return None;
    }
    if keeps.contains(&Good::Coins) {
        return Some(warehouse);
    }
    world.buildings.iter().find(|b| {
        b.city_id == warehouse.city_id && warehouse_keeps(world, b).contains(&Good::Coins)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_rise_as_stock_falls_and_buy_below_sell() {
        let low = price_for(Good::Wood, 10.0, 100.0);
        let high = price_for(Good::Wood, 1000.0, 100.0);
        assert!(low.sell > high.sell);
        for p in [low, high] {
            assert!(p.buy < p.sell && p.buy >= 1.0 && p.sell >= 2.0);
            assert_eq!(p.sell.fract(), 0.0);
        }
    }
}
