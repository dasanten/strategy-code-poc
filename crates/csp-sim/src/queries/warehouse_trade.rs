//! The trade half of `packages/shared/src/warehouse.ts` (`CONTEXT.md`: Trading with the Trade
//! Organization, Warehouse prices, Delivery, Trade Org debt): quotes and the checks of trade,
//! buy-off and pay-debt orders. Pure: nothing moves; `trading.rs` moves what they quote.

use csp_shared::balance::{DELIVERY_FEE_BASE, DELIVERY_FEE_PER_KG_TILE, DELIVERY_LOAD, MAP_SIZE};
use csp_shared::footprint::{covers, is_at};
use csp_shared::world::{
    Building, CaravanJobStep, Carriage, DeliveryKind, Good, Resident, Stock, TradeSide,
    TransferJobStep, WorldState,
};
use serde_json::Value;

use super::building::KEEPS_GOODS;
use super::command::commands_carriage;
use super::goods::{carry_capacity, free_stock};
use super::names::{held, held_in, placed, PRICED_GOODS};
use super::residents::{can_work, good_weight, stock_weight};
use super::trade_org::{trade_org_hq, trade_org_refuses, NO_CARAVANS};
use super::warehouse::{price_for, stock_floor, trade_coin_warehouse, warehouse_keeps};

/// The Trade Org warehouse a resident on (x, y) can trade at (`tradingWarehouseAt`): a finished
/// one covering the tile that prices goods and has its coins at hand.
pub fn trading_warehouse_at(world: &WorldState, x: f64, y: f64) -> Option<&Building> {
    world.buildings.iter().find(|b| {
        KEEPS_GOODS.contains(&b.kind)
            && covers(placed(b), x as i32, y as i32, MAP_SIZE)
            && trade_coin_warehouse(world, b).is_some()
    })
}

/// What a trader trades with (`TradeHolder`): the goods in their hands or on their carriage, and
/// the room left, in kg.
#[derive(Debug, Clone, Copy)]
pub struct TradeHolder<'s> {
    pub stock: &'s Stock,
    pub room: f64,
}

/// A resident's hands as a trade holder (`handsOf`).
pub fn hands_of(r: &Resident, tick: f64) -> TradeHolder<'_> {
    TradeHolder { stock: &r.carried, room: carry_capacity(r, tick) - stock_weight(&r.carried) }
}

/// A carriage as a trade holder (`loadOf`): its load and the room left on it.
pub fn load_of(carriage: &Carriage, capacity: f64) -> TradeHolder<'_> {
    TradeHolder { stock: &carriage.load, room: capacity - stock_weight(&carriage.load) }
}

/// What stops a trade short of the units wanted (`TradeLimit`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TradeLimit {
    Coins,
    Held,
    Room,
    Stock,
    TheirCoins,
    TheirRoom,
    Unwanted,
    Refused,
}

/// What a trade moves (`TradeQuote`): `units` of the good one way, `coins` the other, and what
/// stopped it short.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TradeQuote {
    pub units: f64,
    pub coins: f64,
    pub limit: Option<TradeLimit>,
}

impl TradeQuote {
    pub const NONE: TradeQuote = TradeQuote { units: 0.0, coins: 0.0, limit: None };
}

/// What a trade of up to `wanted` units at a warehouse would move (`quoteTrade`), the `owed`
/// units it keeps for deliveries aside.
pub fn quote_trade(
    world: &WorldState,
    warehouse: &Building,
    holder: TradeHolder,
    side: TradeSide,
    good: Good,
    wanted: f64,
    owed: f64,
) -> TradeQuote {
    let floor = stock_floor(world, warehouse).get(&good).copied();
    let coin_warehouse = trade_coin_warehouse(world, warehouse);
    let (Some(floor), Some(coin_warehouse)) = (floor, coin_warehouse) else {
        return TradeQuote::NONE;
    };
    let coin_stock = held_in(coin_warehouse.stock.as_ref(), Good::Coins);
    let stock = held_in(warehouse.stock.as_ref(), good);
    quote_at_prices(stock, floor, coin_stock, holder, side, good, wanted, owed, f64::INFINITY)
}

/// What a trade of up to `wanted` units would move with a side holding `stock` of the good and
/// `coin_stock` coins, priced from `floor` (`quoteAtPrices`). `their_room` is the room that side
/// has for what the trade adds to it, in kg.
#[allow(clippy::too_many_arguments)]
pub fn quote_at_prices(
    stock: f64,
    floor: f64,
    coin_stock: f64,
    holder: TradeHolder,
    side: TradeSide,
    good: Good,
    wanted: f64,
    owed: f64,
    their_room: f64,
) -> TradeQuote {
    let held_units = held(holder.stock, good);
    let held_coins = held(holder.stock, Good::Coins);
    let gw = good_weight(good);
    let cw = good_weight(Good::Coins);
    let mut units = 0.0;
    let mut coins = 0.0;
    let mut limit = None;
    while units < wanted {
        let n = units + 1.0;
        match side {
            TradeSide::Sell => {
                if n > held_units {
                    limit = Some(TradeLimit::Held);
                } else {
                    let p = price_for(good, stock + n, floor).buy;
                    let room = holder.room + n * gw - (coins + p) * cw;
                    let added = n * gw - (coins + p) * cw;
                    if coins + p > coin_stock {
                        limit = Some(TradeLimit::TheirCoins);
                    } else if room < -1e-9 {
                        limit = Some(TradeLimit::Room);
                    } else if added > their_room + 1e-9 {
                        limit = Some(TradeLimit::TheirRoom);
                    } else {
                        coins += p;
                    }
                }
            }
            TradeSide::Buy => {
                if n > stock - owed {
                    limit = Some(TradeLimit::Stock);
                } else {
                    let p = price_for(good, stock - units, floor).sell;
                    let room = holder.room + (coins + p) * cw - n * gw;
                    let added = (coins + p) * cw - n * gw;
                    if coins + p > held_coins {
                        limit = Some(TradeLimit::Coins);
                    } else if room < -1e-9 {
                        limit = Some(TradeLimit::Room);
                    } else if added > their_room + 1e-9 {
                        limit = Some(TradeLimit::TheirRoom);
                    } else {
                        coins += p;
                    }
                }
            }
        }
        if limit.is_some() {
            break;
        }
        units = n;
    }
    TradeQuote { units, coins, limit }
}

/// Whether a plain value is set: neither missing nor `null` (`x !== null && x !== undefined`).
pub fn is_given(v: Option<&Value>) -> bool {
    v.is_some_and(|v| !v.is_null())
}

/// `Number.isInteger(v)`.
pub fn is_integer(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).is_some_and(|n| n.is_finite() && n.fract() == 0.0)
}

/// The good a plain value names, if it is one of `goods`.
pub fn good_in(v: Option<&Value>, goods: &[Good]) -> Option<Good> {
    let name = v?.as_str()?;
    goods.iter().copied().find(|g| super::names::good_name(*g) == name)
}

/// The carriage a plain id names (`world.carriages.find((x) => x.id === id)`).
pub fn carriage_named<'w>(world: &'w WorldState, id: Option<&Value>) -> Option<&'w Carriage> {
    let id = id?.as_str()?;
    world.carriages.iter().find(|k| k.id == id)
}

fn at_building(k: &Carriage, b: &Building) -> bool {
    is_at((k.x as i32, k.y as i32), placed(b), MAP_SIZE)
}

/// Why a resident can't trade at a warehouse now (`tradeProblem`), or `None` when they can. With
/// `city_id`, a delivery or pick-up for that city of the realm.
#[allow(clippy::too_many_arguments)]
pub fn trade_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    side: TradeSide,
    good: Option<&Value>,
    units: Option<&Value>,
    carriage_id: Option<&Value>,
    city_id: Option<&Value>,
) -> Option<String> {
    let tick = world.tick as f64;
    if trade_org_refuses(world, realm_id) {
        return Some("the Trade Organization won’t trade with you".into());
    }
    if !can_work(resident.born_at, tick) {
        return Some("children can’t trade".into());
    }
    let Some(warehouse) = trading_warehouse_at(world, resident.x, resident.y) else {
        return Some("not at a Trade Org warehouse".into());
    };
    let Some(good) = good_in(good, &PRICED_GOODS) else {
        return Some("not a good warehouses trade".into());
    };
    if !stock_floor(world, warehouse).contains_key(&good) {
        return Some("this warehouse doesn’t trade that good".into());
    }
    if !is_integer(units) || units.and_then(Value::as_f64).unwrap_or(0.0) <= 0.0 {
        return Some("units must be a whole number".into());
    }
    let mut stock = resident.carried.clone();
    if is_given(carriage_id) {
        let k = carriage_named(world, carriage_id);
        if !commands_carriage(world, realm_id, k) {
            return Some("not one of your carriages".into());
        }
        let k = k.expect("commanded");
        if !at_building(k, warehouse) {
            return Some("that carriage is not at the warehouse".into());
        }
        stock = k.load.clone();
    }
    if is_given(city_id) {
        if trade_org_hq(world).is_none() {
            return Some(NO_CARAVANS.into());
        }
        let city =
            city_id.and_then(Value::as_str).and_then(|id| world.cities.iter().find(|c| c.id == id));
        let Some(city) = city.filter(|c| c.realm_id.as_deref() == Some(realm_id)) else {
            return Some("not one of your cities".into());
        };
        let Some(storage) = delivery_storage(world, &city.id) else {
            return Some("that city has no storage".into());
        };
        if side == TradeSide::Sell {
            if is_given(carriage_id) {
                return Some("a pick-up comes from the city’s storage, not a carriage".into());
            }
            stock = free_stock(world, &storage.id, storage.stock.as_ref());
        }
    }
    if side == TradeSide::Sell && held(&stock, good) <= 0.0 {
        return Some("none of that good to sell".into());
    }
    if side == TradeSide::Buy && held(&stock, Good::Coins) <= 0.0 {
        return Some("no coins to buy with".into());
    }
    None
}

/// Where the coins go when a directive is bought off or debt paid on (x, y)
/// (`buyOffCoinWarehouseAt`): the warehouse there that keeps its city's coins.
pub fn buy_off_coin_warehouse_at(world: &WorldState, x: f64, y: f64) -> Option<&Building> {
    let here = world.buildings.iter().find(|b| {
        covers(placed(b), x as i32, y as i32, MAP_SIZE) && !warehouse_keeps(world, b).is_empty()
    })?;
    if warehouse_keeps(world, here).contains(&Good::Coins) {
        return Some(here);
    }
    trade_coin_warehouse(world, here)
}

/// The Trade Org warehouse covering a resident's tile, if any, whatever it keeps.
fn keeping_warehouse_at<'w>(world: &'w WorldState, r: &Resident) -> Option<&'w Building> {
    world.buildings.iter().find(|b| {
        covers(placed(b), r.x as i32, r.y as i32, MAP_SIZE) && !warehouse_keeps(world, b).is_empty()
    })
}

/// The stock a payer pays from: their hands, or a carriage of theirs at `at`; a reason when the
/// carriage won't do.
fn payer_stock(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    carriage_id: Option<&Value>,
    at: &Building,
) -> Result<Stock, String> {
    if !is_given(carriage_id) {
        return Ok(resident.carried.clone());
    }
    let k = carriage_named(world, carriage_id);
    if !commands_carriage(world, realm_id, k) {
        return Err("not one of your carriages".into());
    }
    let k = k.expect("commanded");
    if !at_building(k, at) {
        return Err("that carriage is not at the warehouse".into());
    }
    Ok(k.load.clone())
}

/// Why a resident can't buy off a directive now (`buyOffProblem`), or `None`.
pub fn buy_off_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    directive_id: Option<&Value>,
    carriage_id: Option<&Value>,
) -> Option<String> {
    let d = directive_id
        .and_then(Value::as_str)
        .and_then(|id| world.directives.iter().find(|d| d.id == id));
    let Some(d) = d.filter(|d| d.target == realm_id) else {
        return Some("no directive names your realm by that id".into());
    };
    let Some(price) = d.price else {
        return Some("this directive can’t be bought off".into());
    };
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t pay".into());
    }
    let at = keeping_warehouse_at(world, resident);
    let Some(at) =
        at.filter(|_| buy_off_coin_warehouse_at(world, resident.x, resident.y).is_some())
    else {
        return Some("not at a Trade Org warehouse".into());
    };
    let stock = match payer_stock(world, realm_id, resident, carriage_id, at) {
        Ok(s) => s,
        Err(e) => return Some(e),
    };
    if held(&stock, Good::Coins) < price {
        return Some(format!("it costs {} coins", js_number(price)));
    }
    None
}

/// A number as JavaScript prints it in a template string, for whole and simple numbers.
pub fn js_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// The Coins an Organization owes the Trade Organization (`debtOf`), or 0.
pub fn debt_of(world: &WorldState, org: &str) -> f64 {
    world.debts.iter().find(|d| d.org == org).map_or(0.0, |d| d.coins)
}

/// Why a resident can't pay `coins` of the realm's Trade Org debt now (`payDebtProblem`), or `None`.
pub fn pay_debt_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    coins: Option<&Value>,
    carriage_id: Option<&Value>,
) -> Option<String> {
    if debt_of(world, realm_id) <= 0.0 {
        return Some("your realm owes the Trade Organization nothing".into());
    }
    if !is_integer(coins) || coins.and_then(Value::as_f64).unwrap_or(0.0) <= 0.0 {
        return Some("pay a whole number of coins".into());
    }
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t pay".into());
    }
    let at = keeping_warehouse_at(world, resident);
    let Some(at) =
        at.filter(|_| buy_off_coin_warehouse_at(world, resident.x, resident.y).is_some())
    else {
        return Some("not at a Trade Org warehouse".into());
    };
    let stock = match payer_stock(world, realm_id, resident, carriage_id, at) {
        Ok(s) => s,
        Err(e) => return Some(e),
    };
    if held(&stock, Good::Coins) < 1.0 {
        return Some("no coins to pay with".into());
    }
    None
}

/// The storage deliveries go to and pick-ups come from (`deliveryStorage`): the city's first
/// finished one.
pub fn delivery_storage<'w>(world: &'w WorldState, city_id: &str) -> Option<&'w Building> {
    world.buildings.iter().find(|b| {
        b.city_id.as_deref() == Some(city_id)
            && b.kind == csp_shared::world::BuildingKind::Storage
            && b.site.is_none()
    })
}

/// A delivery's fee, in coins (`deliveryFee`).
pub fn delivery_fee(kg: f64, tiles: f64) -> f64 {
    DELIVERY_FEE_BASE + (kg * tiles * DELIVERY_FEE_PER_KG_TILE - 1e-9).ceil()
}

/// The units of a good a warehouse keeps for deliveries and transfers (`owedBy`).
pub fn owed_by(world: &WorldState, warehouse_id: &str, good: Good) -> f64 {
    let mut owed = 0.0;
    for d in &world.deliveries {
        if d.kind != DeliveryKind::Delivery || d.warehouse_id != warehouse_id || d.good != good {
            continue;
        }
        let job = world
            .caravans
            .iter()
            .find(|c| d.caravan_id.as_deref() == Some(c.id.as_str()))
            .and_then(|c| c.job.as_ref());
        match job {
            Some(j) if j.delivery_id == d.id => {
                if j.step == CaravanJobStep::Load {
                    owed += 0f64.max(d.units - j.units);
                }
            }
            _ => owed += d.units,
        }
    }
    for t in &world.transfers {
        if t.from_city_id.is_some() || t.warehouse_id != warehouse_id || t.good != good {
            continue;
        }
        let job = world
            .caravans
            .iter()
            .find(|c| t.caravan_id.as_deref() == Some(c.id.as_str()))
            .and_then(|c| c.transfer.as_ref());
        match job {
            Some(j) if j.transfer_id == t.id => {
                if j.step == TransferJobStep::Load {
                    owed += 0f64.max(t.units - j.units);
                }
            }
            _ => owed += t.units,
        }
    }
    owed
}

/// What a delivery or pick-up moves (`DeliveryQuote`): units, the coins paid for them, the fee.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeliveryQuote {
    pub units: f64,
    pub coins: f64,
    pub fee: f64,
}

const NO_DELIVERY: DeliveryQuote = DeliveryQuote { units: 0.0, coins: 0.0, fee: 0.0 };

/// What buying up to `wanted` units for delivery `tiles` away would take (`quoteDelivery`).
pub fn quote_delivery(
    world: &WorldState,
    warehouse: &Building,
    payer: &Stock,
    good: Good,
    wanted: f64,
    tiles: f64,
    owed: f64,
) -> DeliveryQuote {
    let Some(floor) = stock_floor(world, warehouse).get(&good).copied() else {
        return NO_DELIVERY;
    };
    if trade_coin_warehouse(world, warehouse).is_none() {
        return NO_DELIVERY;
    }
    let stock = held_in(warehouse.stock.as_ref(), good);
    let held_coins = held(payer, Good::Coins);
    let mut best = NO_DELIVERY;
    let mut coins = 0.0;
    let mut n = 1.0;
    while n <= wanted {
        let kg = n * good_weight(good);
        if n > stock - owed || kg > DELIVERY_LOAD + 1e-9 {
            break;
        }
        coins += price_for(good, stock - (n - 1.0), floor).sell;
        let fee = delivery_fee(kg, tiles);
        if coins + fee > held_coins {
            break;
        }
        best = DeliveryQuote { units: n, coins, fee };
        n += 1.0;
    }
    best
}

/// What a pick-up of up to `wanted` units `tiles` away would pay (`quotePickUp`).
#[allow(clippy::too_many_arguments)]
pub fn quote_pick_up(
    world: &WorldState,
    warehouse: &Building,
    good: Good,
    wanted: f64,
    held_units: f64,
    tiles: f64,
    budget: f64,
) -> DeliveryQuote {
    let Some(floor) = stock_floor(world, warehouse).get(&good).copied() else {
        return NO_DELIVERY;
    };
    if trade_coin_warehouse(world, warehouse).is_none() {
        return NO_DELIVERY;
    }
    let stock = held_in(warehouse.stock.as_ref(), good);
    let mut best = NO_DELIVERY;
    let mut price = 0.0;
    let mut n = 1.0;
    while n <= wanted {
        let kg = n * good_weight(good);
        if n > held_units || kg > DELIVERY_LOAD + 1e-9 {
            break;
        }
        price += price_for(good, stock + n, floor).buy;
        let fee = delivery_fee(kg, tiles);
        if price - fee > budget {
            break;
        }
        if price > fee {
            best = DeliveryQuote { units: n, coins: price - fee, fee };
        }
        n += 1.0;
    }
    best
}
