//! The order-side quotes and checks of trading with an NPC city (`npc-trade.ts`), swapping
//! (`swap.ts`), a wandering trader (`trader-trade.ts`), the horse market (`horse-market.ts`) and
//! buying a city (`city.ts`). Pure: nothing moves; `trading.rs` and `buying.rs` move what they
//! quote.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::{covers, is_at};
use csp_shared::world::{
    Building, BuildingKind, City, Good, Horse, Resident, Stock, TradeSide, Trader, WorldState,
};
use serde_json::Value;

use super::carriages::carriage_capacity;
use super::city::{city_price, for_sale, npc_city_refuses, sells_to, town_hall_of};
use super::command::commands_carriage;
use super::horse_market::{
    npc_horse_buy_price, npc_horse_price, npc_horse_purchase_problem, npc_horse_sale_problem,
};
use super::horses::{owns_horse, HorseOwner};
use super::names::{held, held_in, placed, PRICED_GOODS};
use super::npc_trade::{npc_city_stock, npc_price_for, npc_reserve, standing_swing, NpcCityPrice};
use super::residents::{can_work, good_weight, stock_weight};
use super::trade_org::trade_org_refuses;
use super::trader_trade::{trader_standing, trader_stock};
use super::warehouse::{price_for, stock_floor, trade_coin_warehouse};
use super::warehouse_trade::{
    carriage_named, good_in, hands_of, is_given, is_integer, js_number, quote_at_prices,
    trading_warehouse_at, TradeHolder, TradeLimit, TradeQuote,
};
use csp_shared::balance::{TRADER_FLOOR_SHARE, WAREHOUSE_FLOOR};

use super::names::good_name;

fn at(p: (f64, f64), b: &Building) -> bool {
    is_at((p.0 as i32, p.1 as i32), placed(b), MAP_SIZE)
}

/// The NPC city whose finished storage covers (x, y), with that storage (`npcTradingStorageAt`).
pub fn npc_trading_storage_at(world: &WorldState, x: f64, y: f64) -> Option<(&City, &Building)> {
    let storage = world.buildings.iter().find(|b| {
        b.kind == BuildingKind::Storage
            && b.site.is_none()
            && covers(placed(b), x as i32, y as i32, MAP_SIZE)
    })?;
    let city = world.cities.iter().find(|c| storage.city_id.as_deref() == Some(c.id.as_str()))?;
    for_sale(city).then_some((city, storage))
}

/// What a trade of up to `wanted` units with an NPC city at its `storage` would move
/// (`quoteNpcTrade`).
#[allow(clippy::too_many_arguments)]
pub fn quote_npc_trade(
    world: &WorldState,
    city: &City,
    storage: &Building,
    holder: TradeHolder,
    side: TradeSide,
    good: Good,
    wanted: f64,
    trader_id: Option<&str>,
) -> TradeQuote {
    if !for_sale(city) || storage.city_id.as_deref() != Some(city.id.as_str()) {
        return TradeQuote::NONE;
    }
    let total = held(&npc_city_stock(world, city), good);
    let reserve = npc_reserve(world, city);
    let keep = held(&reserve, good);
    let swing = standing_swing(world, city, trader_id);
    let here = held_in(storage.stock.as_ref(), good);
    let coin_stock = held_in(storage.stock.as_ref(), Good::Coins);
    let held_units = held(holder.stock, good);
    let held_coins = held(holder.stock, Good::Coins);
    let (gw, cw) = (good_weight(good), good_weight(Good::Coins));
    let mut units = 0.0;
    let mut coins = 0.0;
    while units < wanted {
        let n = units + 1.0;
        if side == TradeSide::Sell {
            if n > held_units || total + n > keep {
                break;
            }
            let p = npc_price_for(good, total + n, &reserve, swing).buy;
            let room = holder.room + n * gw - (coins + p) * cw;
            if coins + p > coin_stock || room < -1e-9 {
                break;
            }
            coins += p;
        } else {
            if n > here || total - n < keep {
                break;
            }
            let p = npc_price_for(good, total - units, &reserve, swing).sell;
            let room = holder.room + (coins + p) * cw - n * gw;
            if coins + p > held_coins || room < -1e-9 {
                break;
            }
            coins += p;
        }
        units = n;
    }
    TradeQuote { units, coins, limit: None }
}

/// What of an offer an NPC city would take, as `npcOfferTimes` names its parts.
pub struct OfferTerms<'a> {
    pub realm_id: &'a str,
    pub gives: Good,
    pub gives_units: f64,
    pub wants: Good,
    pub wants_units: f64,
}

/// How many times over, up to `wanted`, an offer is at a rate at least as good as an NPC city's
/// own prices (`npcOfferTimes`).
pub fn npc_offer_times(world: &WorldState, city: &City, offer: &OfferTerms, wanted: f64) -> f64 {
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let swing = standing_swing(world, city, Some(offer.realm_id));
    let gives_stock = held(&stock, offer.gives);
    let wants_stock = held(&stock, offer.wants);
    let (mut got, mut paid, mut got_units, mut paid_units, mut times) = (0.0, 0.0, 0.0, 0.0, 0.0);
    while times < wanted {
        let mut i = 0.0;
        while i < offer.gives_units {
            got_units += 1.0;
            got += if offer.gives == Good::Coins {
                1.0
            } else {
                npc_price_for(offer.gives, gives_stock + got_units, &reserve, swing).buy
            };
            i += 1.0;
        }
        let mut i = 0.0;
        while i < offer.wants_units {
            paid += if offer.wants == Good::Coins {
                1.0
            } else {
                npc_price_for(offer.wants, wants_stock - paid_units, &reserve, swing).sell
            };
            paid_units += 1.0;
            i += 1.0;
        }
        if got < paid {
            break;
        }
        times += 1.0;
    }
    times
}

/// The stock a trader trades from: their hands, or a carriage of theirs at the place (`ok`
/// says whether it stands there); a reason when the carriage won't do.
fn trader_stock_from(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    carriage_id: Option<&Value>,
    there: impl Fn(&csp_shared::world::Carriage) -> bool,
    not_there: &str,
) -> Result<Stock, String> {
    if !is_given(carriage_id) {
        return Ok(resident.carried.clone());
    }
    let k = carriage_named(world, carriage_id);
    if !commands_carriage(world, realm_id, k) {
        return Err("not one of your carriages".into());
    }
    let k = k.expect("commanded");
    if !there(k) {
        return Err(not_there.into());
    }
    Ok(k.load.clone())
}

fn sale_or_coins(side: TradeSide, stock: &Stock, good: Good) -> Option<String> {
    if side == TradeSide::Sell && held(stock, good) <= 0.0 {
        return Some("none of that good to sell".into());
    }
    if side == TradeSide::Buy && held(stock, Good::Coins) <= 0.0 {
        return Some("no coins to buy with".into());
    }
    None
}

fn whole_units(units: Option<&Value>) -> bool {
    is_integer(units) && units.and_then(Value::as_f64).unwrap_or(0.0) > 0.0
}

/// Why a resident can't trade with an NPC city now (`npcTradeProblem`), or `None`.
#[allow(clippy::too_many_arguments)]
pub fn npc_trade_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    side: TradeSide,
    good: Option<&Value>,
    units: Option<&Value>,
    carriage_id: Option<&Value>,
    city_id: Option<&Value>,
) -> Option<String> {
    let Some((city, storage)) = npc_trading_storage_at(world, resident.x, resident.y) else {
        return Some("not at an NPC city’s storage".into());
    };
    if npc_city_refuses(world, city, realm_id) {
        return Some(format!("{} won’t trade with you", city.name));
    }
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t trade".into());
    }
    let Some(good) = good_in(good, &PRICED_GOODS) else {
        return Some("not a good cities trade".into());
    };
    if !whole_units(units) {
        return Some("units must be a whole number".into());
    }
    if is_given(city_id) {
        return Some("only the Trade Organization delivers".into());
    }
    let stock = match trader_stock_from(
        world,
        realm_id,
        resident,
        carriage_id,
        |k| at((k.x, k.y), storage),
        "that carriage is not at the storage",
    ) {
        Ok(s) => s,
        Err(e) => return Some(e),
    };
    sale_or_coins(side, &stock, good)
}

/// What a swap moves, from the trader's side (`SwapQuote`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwapQuote {
    pub units: f64,
    pub gives: f64,
    pub coins: f64,
    pub bought: f64,
    pub sold: f64,
    pub limit: Option<TradeLimit>,
}

impl SwapQuote {
    /// A swap that moves nothing (`noSwap`).
    pub const NONE: SwapQuote =
        SwapQuote { units: 0.0, gives: 0.0, coins: 0.0, bought: 0.0, sold: 0.0, limit: None };
}

/// What a place swaps on (`SwapTerms`).
pub struct SwapTerms<'h, W: Fn(f64) -> f64, G: Fn(f64) -> f64> {
    pub give: Good,
    pub want: Good,
    pub wanted: f64,
    pub holder: TradeHolder<'h>,
    pub spare: f64,
    pub takes: f64,
    pub place_coins: f64,
    pub want_price: W,
    pub give_price: G,
}

/// Works a swap out unit by unit (`cutSwap`).
pub fn cut_swap<W: Fn(f64) -> f64, G: Fn(f64) -> f64>(terms: SwapTerms<W, G>) -> SwapQuote {
    let held_units = held(terms.holder.stock, terms.give);
    let mut best = SwapQuote::NONE;
    let (mut bought, mut sold, mut gives) = (0.0, 0.0, 0.0);
    let mut limit = None;
    let mut n = 1.0;
    while n <= terms.wanted && limit.is_none() {
        if n > terms.spare {
            limit = Some(TradeLimit::Stock);
            break;
        }
        bought += (terms.want_price)(n);
        while sold < bought && limit.is_none() {
            let g = gives + 1.0;
            if g > held_units {
                limit = Some(TradeLimit::Held);
            } else if g > terms.takes {
                limit = Some(TradeLimit::Unwanted);
            } else {
                sold += (terms.give_price)(g);
                gives = g;
            }
        }
        if limit.is_some() {
            break;
        }
        let coins = (sold - bought).min(terms.place_coins);
        let room = terms.holder.room + gives * good_weight(terms.give)
            - n * good_weight(terms.want)
            - coins * good_weight(Good::Coins);
        if room < -1e-9 {
            limit = Some(TradeLimit::Room);
        } else {
            best = SwapQuote { units: n, gives, coins, bought, sold, limit: None };
        }
        n += 1.0;
    }
    SwapQuote { limit, ..best }
}

/// What a swap at a Trade Org warehouse would move (`quoteSwap`).
#[allow(clippy::too_many_arguments)]
pub fn quote_swap(
    world: &WorldState,
    warehouse: &Building,
    holder: TradeHolder,
    give: Good,
    want: Good,
    wanted: f64,
    owed: f64,
) -> SwapQuote {
    let floor = stock_floor(world, warehouse);
    let (Some(&give_floor), Some(&want_floor)) = (floor.get(&give), floor.get(&want)) else {
        return SwapQuote::NONE;
    };
    let Some(coin_warehouse) = trade_coin_warehouse(world, warehouse) else {
        return SwapQuote::NONE;
    };
    let give_stock = held_in(warehouse.stock.as_ref(), give);
    let want_stock = held_in(warehouse.stock.as_ref(), want);
    cut_swap(SwapTerms {
        give,
        want,
        wanted,
        holder,
        spare: want_stock - owed,
        takes: f64::INFINITY,
        place_coins: held_in(coin_warehouse.stock.as_ref(), Good::Coins),
        want_price: |n| price_for(want, want_stock - (n - 1.0), want_floor).sell,
        give_price: |n| price_for(give, give_stock + n, give_floor).buy,
    })
}

/// What a swap with an NPC city at its `storage` would move (`quoteNpcSwap`).
#[allow(clippy::too_many_arguments)]
pub fn quote_npc_swap(
    world: &WorldState,
    city: &City,
    storage: &Building,
    holder: TradeHolder,
    give: Good,
    want: Good,
    wanted: f64,
    trader_id: Option<&str>,
) -> SwapQuote {
    if storage.city_id.as_deref() != Some(city.id.as_str()) {
        return SwapQuote::NONE;
    }
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let swing = standing_swing(world, city, trader_id);
    let give_stock = held(&stock, give);
    let want_stock = held(&stock, want);
    cut_swap(SwapTerms {
        give,
        want,
        wanted,
        holder,
        spare: held_in(storage.stock.as_ref(), want).min(want_stock - held(&reserve, want)),
        takes: held(&reserve, give) - give_stock,
        place_coins: held_in(storage.stock.as_ref(), Good::Coins),
        want_price: |n| npc_price_for(want, want_stock - (n - 1.0), &reserve, swing).sell,
        give_price: |n| npc_price_for(give, give_stock + n, &reserve, swing).buy,
    })
}

/// Why a resident can't swap now (`swapProblem`), or `None`.
pub fn swap_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    give: Option<&Value>,
    want: Option<&Value>,
    units: Option<&Value>,
    carriage_id: Option<&Value>,
) -> Option<String> {
    let npc = npc_trading_storage_at(world, resident.x, resident.y);
    let warehouse =
        if npc.is_some() { None } else { trading_warehouse_at(world, resident.x, resident.y) };
    let Some(place) = npc.map(|(_, s)| s).or(warehouse) else {
        return Some("not at a Trade Org warehouse or an NPC city’s storage".into());
    };
    if let Some((city, _)) = npc {
        if npc_city_refuses(world, city, realm_id) {
            return Some(format!("{} won’t trade with you", city.name));
        }
    }
    if npc.is_none() && trade_org_refuses(world, realm_id) {
        return Some("the Trade Organization won’t trade with you".into());
    }
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t trade".into());
    }
    let (Some(given), Some(got)) = (good_in(give, &PRICED_GOODS), good_in(want, &PRICED_GOODS))
    else {
        return Some("not goods that can be swapped".into());
    };
    if given == got {
        return Some("a swap takes two different goods".into());
    }
    if let Some(w) = warehouse {
        let floor = stock_floor(world, w);
        if !floor.contains_key(&given) || !floor.contains_key(&got) {
            return Some("this warehouse doesn’t trade that good".into());
        }
    }
    if !whole_units(units) {
        return Some("units must be a whole number".into());
    }
    let stock = match trader_stock_from(
        world,
        realm_id,
        resident,
        carriage_id,
        |k| at((k.x, k.y), place),
        "that carriage is not there",
    ) {
        Ok(s) => s,
        Err(e) => return Some(e),
    };
    if held(&stock, given) <= 0.0 {
        return Some("none of that good to give".into());
    }
    if let Some((city, _)) = npc {
        let have = npc_city_stock(world, city);
        let reserve = npc_reserve(world, city);
        if held(&have, given) >= held(&reserve, given) {
            return Some(format!("{} isn’t short of that good", city.name));
        }
        if held(&have, got) <= held(&reserve, got) || held_in(place.stock.as_ref(), got) <= 0.0 {
            return Some(format!("{} has none of that good to spare", city.name));
        }
    }
    None
}

/// The wandering trader standing at a stop on (x, y), if one is (`traderStandingAt`).
pub fn trader_standing_at(world: &WorldState, x: f64, y: f64) -> Option<&Trader> {
    world.traders.iter().find(|t| trader_standing(world, t).is_some_and(|s| s.x == x && s.y == y))
}

/// What a trade of up to `wanted` units with a wandering trader would move (`quoteTraderTrade`).
#[allow(clippy::too_many_arguments)]
pub fn quote_trader_trade(
    escorts: usize,
    load: &Stock,
    capacity: f64,
    holder: TradeHolder,
    side: TradeSide,
    good: Good,
    wanted: f64,
) -> TradeQuote {
    let stock = held(&trader_stock(escorts, load), good);
    let room = 0f64.max(capacity - stock_weight(load));
    let floor = WAREHOUSE_FLOOR.get(good_name(good)).expect("a floor for every good");
    quote_at_prices(
        stock,
        floor * TRADER_FLOOR_SHARE,
        held(load, Good::Coins),
        holder,
        side,
        good,
        wanted,
        0.0,
        room,
    )
}

/// `quote_trader_trade` on the world as it is (`quoteWithTrader`).
pub fn quote_with_trader(
    world: &WorldState,
    t: &Trader,
    carriage: &csp_shared::world::Carriage,
    holder: TradeHolder,
    side: TradeSide,
    good: Good,
    wanted: f64,
) -> TradeQuote {
    let capacity = carriage_capacity(world, carriage);
    quote_trader_trade(t.escort_ids.len(), &carriage.load, capacity, holder, side, good, wanted)
}

/// Why a resident can't trade with a wandering trader now (`traderTradeProblem`), or `None`.
#[allow(clippy::too_many_arguments)]
pub fn trader_trade_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    side: TradeSide,
    good: Option<&Value>,
    units: Option<&Value>,
    carriage_id: Option<&Value>,
    city_id: Option<&Value>,
) -> Option<String> {
    if trade_org_refuses(world, realm_id) {
        return Some("the Trade Organization won’t trade with you".into());
    }
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t trade".into());
    }
    if trader_standing_at(world, resident.x, resident.y).is_none() {
        return Some("no wandering trader stands here".into());
    }
    let Some(good) = good_in(good, &PRICED_GOODS) else {
        return Some("not a good traders trade".into());
    };
    if !whole_units(units) {
        return Some("units must be a whole number".into());
    }
    if is_given(city_id) {
        return Some("a wandering trader delivers nothing".into());
    }
    let stock = match trader_stock_from(
        world,
        realm_id,
        resident,
        carriage_id,
        |k| k.x == resident.x && k.y == resident.y,
        "that carriage is not at the trader",
    ) {
        Ok(s) => s,
        Err(e) => return Some(e),
    };
    sale_or_coins(side, &stock, good)
}

/// Why a resident can't pay for a horse now (`horseBuyerProblem`), or `None`.
pub fn horse_buyer_problem(resident: &Resident, price: f64, tick: f64) -> Option<String> {
    if !can_work(resident.born_at, tick) {
        return Some("children can’t trade".into());
    }
    let coins = held(&resident.carried, Good::Coins).floor();
    if coins < price {
        return Some(format!(
            "it costs {} coins and they hold {}",
            js_number(price),
            js_number(coins)
        ));
    }
    None
}

/// Why a resident can't take the Coins for a horse now (`horseSellerProblem`), or `None`.
pub fn horse_seller_problem(resident: &Resident, price: f64, tick: f64) -> Option<String> {
    if !can_work(resident.born_at, tick) {
        return Some("children can’t trade".into());
    }
    if hands_of(resident, tick).room - price * good_weight(Good::Coins) < -1e-9 {
        return Some(format!("they can’t carry the {} coins", js_number(price)));
    }
    None
}

/// The NPC city whose finished stable covers the resident's tile and has the horse in it
/// (`npcStableWith`).
fn npc_stable_with<'w>(
    world: &'w WorldState,
    resident: &Resident,
    horse: &Horse,
) -> Option<(&'w City, &'w Building)> {
    let stable = world.buildings.iter().find(|b| {
        b.kind == BuildingKind::Stable
            && b.site.is_none()
            && at((resident.x, resident.y), b)
            && at((horse.x, horse.y), b)
    })?;
    let city = world.cities.iter().find(|c| stable.city_id.as_deref() == Some(c.id.as_str()))?;
    for_sale(city).then_some((city, stable))
}

/// Whom a horse is bought from where a resident stands (`npcHorseAt`).
pub fn npc_horse_at<'w>(
    world: &'w WorldState,
    resident: &Resident,
    horse: &Horse,
) -> Option<(&'w City, &'w Building)> {
    npc_stable_with(world, resident, horse)
        .filter(|(city, _)| owns_horse(HorseOwner::City(&city.id), horse))
}

/// Whom a horse of the realm is sold to where a resident stands (`npcHorseBuyerAt`).
pub fn npc_horse_buyer_at<'w>(
    world: &'w WorldState,
    resident: &Resident,
    horse: &Horse,
    realm_id: &str,
) -> Option<(&'w City, &'w Building)> {
    if !owns_horse(HorseOwner::Realm(realm_id), horse) {
        return None;
    }
    npc_stable_with(world, resident, horse)
}

fn horse_named<'w>(world: &'w WorldState, id: Option<&Value>) -> Option<&'w Horse> {
    let id = id?.as_str()?;
    world.horses.iter().find(|h| h.id == id)
}

/// Why a resident can't buy a horse for the realm now (`buyHorseProblem`), or `None`.
pub fn buy_horse_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    horse_id: Option<&Value>,
) -> Option<String> {
    let Some(horse) = horse_named(world, horse_id) else {
        return Some("no such horse".into());
    };
    let Some((city, _)) = npc_horse_at(world, resident, horse) else {
        return Some("not at the NPC city’s stable with that horse".into());
    };
    npc_horse_sale_problem(world, city, horse, realm_id).or_else(|| {
        let price = npc_horse_price(world, city, horse, Some(realm_id));
        horse_buyer_problem(resident, price, world.tick as f64)
    })
}

/// Why a resident can't sell a horse of the realm now (`sellHorseProblem`), or `None`.
pub fn sell_horse_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    horse_id: Option<&Value>,
) -> Option<String> {
    let Some(horse) = horse_named(world, horse_id) else {
        return Some("no such horse".into());
    };
    if !owns_horse(HorseOwner::Realm(realm_id), horse) {
        return Some("not a horse of your realm".into());
    }
    let Some((city, _)) = npc_horse_buyer_at(world, resident, horse, realm_id) else {
        return Some("not at an NPC city’s stable with that horse".into());
    };
    npc_horse_purchase_problem(world, city, horse, realm_id).or_else(|| {
        let price = npc_horse_buy_price(world, city, horse, Some(realm_id));
        horse_seller_problem(resident, price, world.tick as f64)
    })
}

/// The realm's residents standing at a city's town hall (`buyersAtTownHall`), as indices into
/// `world.residents`.
pub fn buyers_at_town_hall(world: &WorldState, city: &City, realm_id: &str) -> Vec<usize> {
    let Some(hall) = town_hall_of(world, city) else {
        return Vec::new();
    };
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.as_deref() == Some(realm_id) && at((r.x, r.y), hall)
        })
        .collect()
}

/// The coins the realm's residents carry on a city's town hall (`coinsAtTownHall`).
pub fn coins_at_town_hall(world: &WorldState, city: &City, realm_id: &str) -> f64 {
    buyers_at_town_hall(world, city, realm_id)
        .into_iter()
        .map(|i| held(&world.residents[i].carried, Good::Coins))
        .sum()
}

/// Why the realm's resident can't buy the city now (`buyProblem`), or `None`.
pub fn buy_problem(
    world: &WorldState,
    realm_id: &str,
    r: &Resident,
    city_id: Option<&Value>,
) -> Option<String> {
    let city =
        city_id.and_then(Value::as_str).and_then(|id| world.cities.iter().find(|c| c.id == id));
    let Some(city) = city else {
        return Some("no such city".into());
    };
    if city.trade_org.is_some() {
        return Some("the Trade Organization doesn’t sell its cities".into());
    }
    if !for_sale(city) {
        return Some("only NPC cities are for sale".into());
    }
    if !sells_to(world, city, realm_id) {
        return Some("it won’t sell to you: it holds you in too low standing".into());
    }
    if r.owner.as_deref() != Some(realm_id) {
        return Some("only a resident of your own realm can buy a city".into());
    }
    let hall = town_hall_of(world, city);
    if !hall.is_some_and(|h| at((r.x, r.y), h)) {
        return Some("the resident must stand at its town hall".into());
    }
    let price = city_price(world, city, Some(realm_id));
    let coins = coins_at_town_hall(world, city, realm_id);
    if coins < price {
        return Some(format!(
            "it costs {} coins; your residents at its town hall carry {}",
            js_number(price),
            js_number(coins)
        ));
    }
    None
}

/// One of an NPC city's swap rates (`SwapRate`): `gives` units of `give` for `units` of `want`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwapRate {
    pub give: Good,
    pub gives: f64,
    pub want: Good,
    pub units: f64,
}

/// An NPC city's swap rates from its prices (`npcSwapRates`, `CONTEXT.md`: Swap): each good it is
/// short of against each it has spare, in small whole units. One unit given when it pays for at
/// least one wanted, else as many as one wanted costs, rounded up; none when that is more than it
/// is short of. The units got are what one given pays for, at least one and no more than is spare.
pub fn npc_swap_rates(prices: &[NpcCityPrice]) -> Vec<SwapRate> {
    let spare: Vec<&NpcCityPrice> = prices.iter().filter(|p| p.for_sale >= 1.0).collect();
    let mut out = Vec::new();
    for give in prices.iter().filter(|p| p.wanted >= 1.0) {
        for want in &spare {
            let one_pays = (give.buy / want.sell).floor();
            let gives = if one_pays >= 1.0 { 1.0 } else { (want.sell / give.buy).ceil() };
            if gives > give.wanted {
                continue;
            }
            let units = one_pays.max(1.0).min(want.for_sale.floor());
            out.push(SwapRate { give: give.good, gives, want: want.good, units });
        }
    }
    out
}
