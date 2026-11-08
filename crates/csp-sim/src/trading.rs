//! Trading (`apps/server/src/trading.ts`, `CONTEXT.md`: Trading with the Trade Organization,
//! Trading with an NPC city, Trader stop, Swap, Horse market, Delivery): the buy, sell, swap and
//! horse orders, carried out the tick they are given, and the invariants over this tick's trades.

use csp_shared::balance::{
    DELIVERY_LOAD, GOOD_WEIGHT, MAP_SIZE, NPC_HORSES_KEPT, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Delivery, DeliveryKind, Good, HandInOrder, HorseTradeOrder, OrderRequest, RealmEventWhat,
    ResidentOrder, Stock, SwapOrder, SwapPlace, TradeOrder, TradeSide, WorldState,
};
use serde_json::Value;

use crate::goods_deps::{
    end_breeding_of, hand_in, new_id, raise_standing_both_ways, raise_standing_by_trade, realm_of,
    record_event, OrderSender,
};
use crate::holders::{move_between, total, Holder};
use crate::queries::carriages::caravan_food_for;
use crate::queries::city::npc_city_refuses;
use crate::queries::command::{commander_of_resident, commands, commands_carriage};
use crate::queries::goods::{free_stock, goods_capacity};
use crate::queries::horse_market::{npc_horse_buy_price, npc_horse_price, npc_horses_of};
use crate::queries::names::{good_name, held, held_in, placed};
use crate::queries::npc_trade::{npc_city_stock, npc_horses_wanted, npc_reserve, npc_storages};
use crate::queries::standing::{standing_organization, TRADE_ORG};
use crate::queries::trade_org::{trade_org_hq, trade_org_refuses};
use crate::queries::trade_quotes::{
    buy_horse_problem, npc_horse_at, npc_horse_buyer_at, npc_trade_problem, npc_trading_storage_at,
    quote_npc_swap, quote_npc_trade, quote_swap, quote_with_trader, sell_horse_problem,
    swap_problem, trader_standing_at, trader_trade_problem,
};
use crate::queries::warehouse::trade_coin_warehouse;
use crate::queries::warehouse_trade::{
    delivery_storage, hands_of, load_of, owed_by, quote_delivery, quote_pick_up, quote_trade,
    trade_problem, trading_warehouse_at, TradeHolder,
};
use crate::sight::InvariantViolation;

fn resident_named(world: &WorldState, id: Option<&Value>) -> Option<usize> {
    let id = id?.as_str()?;
    world.residents.iter().position(|r| r.id == id)
}

/// Checks a buy or sell order (`tradeOrder(side).validate`): at a trader standing at a stop with
/// it, on an NPC city's storage with that city, else at a Trade Org warehouse.
pub fn validate_trade(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    side: TradeSide,
) -> Option<String> {
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let ri = resident_named(world, o.get("residentId"));
    let r = ri.map(|i| &world.residents[i]);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    let r = r.expect("commanded");
    let args = (o.get("good"), o.get("units"), o.get("carriageId"), o.get("cityId"));
    if trader_standing_at(world, r.x, r.y).is_some() {
        trader_trade_problem(world, &realm.id, r, side, args.0, args.1, args.2, args.3)
    } else if npc_trading_storage_at(world, r.x, r.y).is_some() {
        npc_trade_problem(world, &realm.id, r, side, args.0, args.1, args.2, args.3)
    } else {
        trade_problem(world, &realm.id, r, side, args.0, args.1, args.2, args.3)
    }
}

/// Gives a buy or sell order (`tradeOrder(side).apply`).
pub fn apply_trade(
    world: &mut WorldState,
    _sender: &OrderSender,
    order: &OrderRequest,
    side: TradeSide,
) {
    let o = &order.fields;
    let Some(ri) = resident_named(world, o.get("residentId")) else { return };
    let good = o.get("good").and_then(Value::as_str).and_then(crate::queries::names::good_of);
    let Some(good) = good else { return };
    let city_id = o.get("cityId").and_then(Value::as_str).filter(|s| !s.is_empty());
    world.residents[ri].order = Some(ResidentOrder::Trade(TradeOrder {
        side,
        good,
        units: o.get("units").and_then(Value::as_f64).unwrap_or(0.0),
        carriage_id: o.get("carriageId").and_then(Value::as_str).map(str::to_string),
        city_id: city_id.map(str::to_string),
    }));
}

/// Checks a swap order (`swap.validate`).
pub fn validate_swap(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let r = resident_named(world, o.get("residentId")).map(|i| &world.residents[i]);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    let r = r.expect("commanded");
    swap_problem(
        world,
        &realm.id,
        r,
        o.get("give"),
        o.get("want"),
        o.get("units"),
        o.get("carriageId"),
    )
}

/// Gives a swap order (`swap.apply`).
pub fn apply_swap(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let o = &order.fields;
    let Some(ri) = resident_named(world, o.get("residentId")) else { return };
    let good = |k: &str| o.get(k).and_then(Value::as_str).and_then(crate::queries::names::good_of);
    let (Some(give), Some(want)) = (good("give"), good("want")) else { return };
    world.residents[ri].order = Some(ResidentOrder::Swap(SwapOrder {
        give,
        want,
        units: o.get("units").and_then(Value::as_f64).unwrap_or(0.0),
        carriage_id: o.get("carriageId").and_then(Value::as_str).map(str::to_string),
    }));
}

/// Checks a buy horse order (`buyHorse.validate`).
pub fn validate_buy_horse(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let r = resident_named(world, o.get("residentId")).map(|i| &world.residents[i]);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    buy_horse_problem(world, &realm.id, r.expect("commanded"), o.get("horseId"))
}

/// Checks a sell horse order (`sellHorse.validate`).
pub fn validate_sell_horse(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let r = resident_named(world, o.get("residentId")).map(|i| &world.residents[i]);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    sell_horse_problem(world, &realm.id, r.expect("commanded"), o.get("horseId"))
}

/// Gives a buy horse order (`buyHorse.apply`).
pub fn apply_buy_horse(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    horse_order(world, order, true);
}

/// Gives a sell horse order (`sellHorse.apply`).
pub fn apply_sell_horse(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    horse_order(world, order, false);
}

fn horse_order(world: &mut WorldState, order: &OrderRequest, buy: bool) {
    let o = &order.fields;
    let Some(ri) = resident_named(world, o.get("residentId")) else { return };
    let horse_id = o.get("horseId").and_then(Value::as_str).unwrap_or_default().to_string();
    let t = HorseTradeOrder { horse_id };
    world.residents[ri].order =
        Some(if buy { ResidentOrder::BuyHorse(t) } else { ResidentOrder::SellHorse(t) });
}

/// One trade carried out this tick, with the goods and coins of everyone in it before and after
/// (`TradeRecord`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TradeRecord {
    pub resident_id: String,
    pub realm: Option<String>,
    pub refused: bool,
    pub before: Stock,
    pub after: Stock,
    pub npc_city_id: Option<String>,
    pub kept_reserve: Option<bool>,
    pub trader_id: Option<String>,
    pub kept_food: Option<bool>,
    pub horse_id: Option<String>,
    pub kept_pair: Option<bool>,
    pub wanted: Option<bool>,
}

/// The trades of the latest `resolve_trades` (the TypeScript's `ledger`, kept beside the world),
/// for the invariants over them.
#[derive(Debug, Clone, Default)]
pub struct TradeLedger {
    pub records: Vec<TradeRecord>,
}

fn building_index(world: &WorldState, id: &str) -> usize {
    world.buildings.iter().position(|b| b.id == id).expect("a building of the world")
}

fn carriage_index(world: &WorldState, id: Option<&str>) -> Option<usize> {
    let id = id?;
    world.carriages.iter().position(|k| k.id == id)
}

/// The trader's holder and its room: their carriage's load, or their hands.
fn holder_of(world: &WorldState, ri: usize, carriage: Option<usize>) -> (Holder, f64) {
    match carriage {
        Some(k) => {
            let c = &world.carriages[k];
            (Holder::Carriage(k), load_of(c, goods_capacity(world, c)).room)
        }
        None => (Holder::Resident(ri), hands_of(&world.residents[ri], world.tick as f64).room),
    }
}

fn holder_stock(world: &WorldState, h: Holder) -> &Stock {
    match h {
        Holder::Carriage(k) => &world.carriages[k].load,
        Holder::Resident(i) => &world.residents[i].carried,
        _ => unreachable!("a trader holds goods in hands or on a carriage"),
    }
}

fn ensure_stock(world: &mut WorldState, b: usize) {
    world.buildings[b].stock.get_or_insert_with(Stock::new);
}

/// Carries out buy, sell, swap, horse and hand-in orders (`resolveTrades`). Returns how many
/// trades moved anything; this tick's trades go into `ledger`. `size` is the map's.
pub fn resolve_trades(world: &mut WorldState, size: i32, ledger: &mut TradeLedger) -> usize {
    ledger.records.clear();
    let records = &mut ledger.records;
    let mut traded = 0;
    for ri in 0..world.residents.len() {
        let Some(order) = world.residents[ri].order.clone() else { continue };
        match order {
            ResidentOrder::Swap(o) => {
                world.residents[ri].order = None;
                if swap_here(world, ri, &o, records) {
                    traded += 1;
                }
                continue;
            }
            ResidentOrder::BuyHorse(o) => {
                world.residents[ri].order = None;
                if buy_horse_here(world, ri, &o, records) {
                    traded += 1;
                }
                continue;
            }
            ResidentOrder::SellHorse(o) => {
                world.residents[ri].order = None;
                if sell_horse_here(world, ri, &o, records) {
                    traded += 1;
                }
                continue;
            }
            ResidentOrder::Trade(_) | ResidentOrder::HandIn(_) => {}
            _ => continue,
        }
        world.residents[ri].order = None;
        let (x, y) = (world.residents[ri].x, world.residents[ri].y);
        if let ResidentOrder::Trade(o) = &order {
            if let Some(t) = trader_standing_at(world, x, y) {
                let t = t.id.clone();
                if trade_with_trader(world, ri, o, &t, records) {
                    traded += 1;
                }
                continue;
            }
            // A transfer is handed in only at a Trade Org warehouse.
            if let Some((city, storage)) = npc_trading_storage_at(world, x, y) {
                let (city, storage) = (city.id.clone(), storage.id.clone());
                if trade_with_city(world, ri, o, &city, &storage, records) {
                    traded += 1;
                }
                continue;
            }
        }
        let Some(warehouse) = trading_warehouse_at(world, x, y) else { continue };
        let Some(coin_warehouse) = trade_coin_warehouse(world, warehouse) else { continue };
        let w = building_index(world, &warehouse.id);
        let cw = building_index(world, &coin_warehouse.id);
        let realm = commander_of_resident(world, &world.residents[ri]);
        // The Trade Organization may have come to refuse the realm since the order was given.
        if realm.as_deref().is_some_and(|realm| trade_org_refuses(world, realm)) {
            continue;
        }
        let carriage_id = match &order {
            ResidentOrder::Trade(o) => o.carriage_id.clone(),
            ResidentOrder::HandIn(o) => o.carriage_id.clone(),
            _ => unreachable!(),
        };
        let carriage = carriage_index(world, carriage_id.as_deref());
        if carriage_id.is_some() {
            let k = carriage.map(|k| &world.carriages[k]);
            let Some(realm) = realm.as_deref() else { continue };
            if !commands_carriage(world, realm, k) {
                continue;
            }
            let k = k.expect("commanded");
            if !is_at((k.x as i32, k.y as i32), placed(&world.buildings[w]), MAP_SIZE) {
                continue;
            }
        }
        let (holder, room) = holder_of(world, ri, carriage);
        ensure_stock(world, w);
        ensure_stock(world, cw);
        let parties = [holder, Holder::Storage(w), Holder::Storage(cw)];
        let before = total(world, &parties);
        let delivery = match &order {
            ResidentOrder::HandIn(_) => true,
            ResidentOrder::Trade(o) => o.city_id.is_some(),
            _ => false,
        };
        if delivery {
            let Some(realm) = realm else { continue };
            let ordered = match &order {
                ResidentOrder::HandIn(o) => hand_in_order(world, size, ri, &realm, o, w, holder),
                ResidentOrder::Trade(o) => order_delivery(world, size, ri, &realm, o, w, holder),
                _ => unreachable!(),
            };
            if ordered {
                traded += 1;
            }
            let refused = trade_org_refuses(world, &realm);
            let after = total(world, &parties);
            records.push(TradeRecord {
                resident_id: world.residents[ri].id.clone(),
                realm: Some(realm),
                refused,
                before,
                after,
                ..Default::default()
            });
            continue;
        }
        let ResidentOrder::Trade(o) = &order else { unreachable!() };
        let owed = owed_by(world, &world.buildings[w].id, o.good);
        let hold = TradeHolder { stock: holder_stock(world, holder), room };
        let q = quote_trade(world, &world.buildings[w], hold, o.side, o.good, o.units, owed);
        let (goods_from, goods_to) = match o.side {
            TradeSide::Buy => (Holder::Storage(w), holder),
            TradeSide::Sell => (holder, Holder::Storage(w)),
        };
        move_between(world, goods_from, goods_to, o.good, q.units);
        let (coins_from, coins_to) = match o.side {
            TradeSide::Buy => (holder, Holder::Storage(cw)),
            TradeSide::Sell => (Holder::Storage(cw), holder),
        };
        move_between(world, coins_from, coins_to, Good::Coins, q.coins);
        let refused = realm.as_deref().is_some_and(|realm| trade_org_refuses(world, realm));
        let after = total(world, &parties);
        records.push(TradeRecord {
            resident_id: world.residents[ri].id.clone(),
            realm: realm.clone(),
            refused,
            before,
            after,
            ..Default::default()
        });
        if q.units > 0.0 {
            traded += 1;
        }
        let moved = match realm.as_deref() {
            Some(realm) if q.coins > 0.0 => {
                raise_standing_by_trade(world, realm, TRADE_ORG, q.coins)
            }
            _ => None,
        };
        let r = &world.residents[ri];
        let (bx, by) = (world.buildings[w].x, world.buildings[w].y);
        let what = RealmEventWhat::Traded {
            resident_id: r.id.clone(),
            name: r.name.clone(),
            side: o.side,
            good: o.good,
            units: q.units,
            wanted: o.units,
            coins: q.coins,
            x: bx,
            y: by,
            with_trader: None,
            at_storage: None,
            standing: moved,
        };
        record_event(world, realm.as_deref(), what);
    }
    traded
}

/// `resolve_trades` on a map of `MAP_SIZE` tiles.
pub fn resolve_trades_default(world: &mut WorldState, ledger: &mut TradeLedger) -> usize {
    resolve_trades(world, MAP_SIZE, ledger)
}

/// Carries out a trade order on the storage of an NPC city (`tradeWithCity`). Returns whether it
/// moved anything.
fn trade_with_city(
    world: &mut WorldState,
    ri: usize,
    o: &TradeOrder,
    city_id: &str,
    storage_id: &str,
    records: &mut Vec<TradeRecord>,
) -> bool {
    let r = &world.residents[ri];
    let realm = commander_of_resident(world, r);
    // A resident of the Trade Organization trades for it, like a realm's for theirs (its army
    // buying Food, `CONTEXT.md`: Trade Org debt); another NPC city's residents trade for nobody.
    let of_trade_org =
        r.city_id.as_deref().is_some_and(|c| standing_organization(world, c) == TRADE_ORG);
    let trader = realm.clone().or_else(|| of_trade_org.then(|| TRADE_ORG.to_string()));
    if o.city_id.is_some() {
        return false;
    }
    let ci = world.cities.iter().position(|c| c.id == city_id).expect("a city");
    // The city may have come to refuse the realm since the order was given.
    if trader.as_deref().is_some_and(|t| npc_city_refuses(world, &world.cities[ci], t)) {
        return false;
    }
    let s = building_index(world, storage_id);
    let carriage = carriage_index(world, o.carriage_id.as_deref());
    if o.carriage_id.is_some() {
        let k = carriage.map(|k| &world.carriages[k]);
        let Some(realm) = realm.as_deref() else { return false };
        if !commands_carriage(world, realm, k) {
            return false;
        }
        let k = k.expect("commanded");
        if !is_at((k.x as i32, k.y as i32), placed(&world.buildings[s]), MAP_SIZE) {
            return false;
        }
    }
    let (holder, room) = holder_of(world, ri, carriage);
    ensure_stock(world, s);
    let parties = [holder, Holder::Storage(s)];
    let before = total(world, &parties);
    let hold = TradeHolder { stock: holder_stock(world, holder), room };
    let city = &world.cities[ci];
    let q = quote_npc_trade(
        world,
        city,
        &world.buildings[s],
        hold,
        o.side,
        o.good,
        o.units,
        trader.as_deref(),
    );
    let (goods_from, goods_to) = match o.side {
        TradeSide::Buy => (Holder::Storage(s), holder),
        TradeSide::Sell => (holder, Holder::Storage(s)),
    };
    move_between(world, goods_from, goods_to, o.good, q.units);
    move_between(world, goods_to, goods_from, Good::Coins, q.coins);
    let city = &world.cities[ci];
    let have = held(&npc_city_stock(world, city), o.good);
    let keep = held(&npc_reserve(world, city), o.good);
    let refused = trader.as_deref().is_some_and(|t| npc_city_refuses(world, city, t));
    let kept_reserve = q.units == 0.0
        || match o.side {
            TradeSide::Buy => have >= keep,
            TradeSide::Sell => have <= keep,
        };
    records.push(TradeRecord {
        resident_id: world.residents[ri].id.clone(),
        realm: trader.clone(),
        refused,
        before,
        after: total(world, &parties),
        npc_city_id: Some(city_id.to_string()),
        kept_reserve: Some(kept_reserve),
        ..Default::default()
    });
    let moved = match trader.as_deref() {
        Some(t) if q.coins > 0.0 => raise_standing_by_trade(world, t, city_id, q.coins),
        _ => None,
    };
    let r = &world.residents[ri];
    let (bx, by) = (world.buildings[s].x, world.buildings[s].y);
    let what = RealmEventWhat::Traded {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        side: o.side,
        good: o.good,
        units: q.units,
        wanted: o.units,
        coins: q.coins,
        x: bx,
        y: by,
        with_trader: None,
        at_storage: Some(true),
        standing: moved,
    };
    record_event(world, realm.as_deref(), what);
    q.units > 0.0
}

/// Carries out a trade order on the tile of a wandering trader standing at a stop
/// (`tradeWithTrader`). Returns whether it moved anything.
fn trade_with_trader(
    world: &mut WorldState,
    ri: usize,
    o: &TradeOrder,
    trader_id: &str,
    records: &mut Vec<TradeRecord>,
) -> bool {
    let realm = commander_of_resident(world, &world.residents[ri]);
    if o.city_id.is_some() {
        return false;
    }
    if realm.as_deref().is_some_and(|realm| trade_org_refuses(world, realm)) {
        return false;
    }
    let ti = world.traders.iter().position(|t| t.id == trader_id).expect("a trader");
    let Some(wagon) = carriage_index(world, Some(&world.traders[ti].carriage_id)) else {
        return false;
    };
    let carriage = carriage_index(world, o.carriage_id.as_deref());
    if o.carriage_id.is_some() {
        let k = carriage.map(|k| &world.carriages[k]);
        let Some(realm) = realm.as_deref() else { return false };
        if !commands_carriage(world, realm, k) {
            return false;
        }
        let k = k.expect("commanded");
        if k.x != world.carriages[wagon].x || k.y != world.carriages[wagon].y {
            return false;
        }
    }
    let (holder, room) = holder_of(world, ri, carriage);
    let parties = [holder, Holder::Carriage(wagon)];
    let before = total(world, &parties);
    let hold = TradeHolder { stock: holder_stock(world, holder), room };
    let t = &world.traders[ti];
    let q = quote_with_trader(world, t, &world.carriages[wagon], hold, o.side, o.good, o.units);
    let (goods_from, goods_to) = match o.side {
        TradeSide::Buy => (Holder::Carriage(wagon), holder),
        TradeSide::Sell => (holder, Holder::Carriage(wagon)),
    };
    move_between(world, goods_from, goods_to, o.good, q.units);
    move_between(world, goods_to, goods_from, Good::Coins, q.coins);
    let keep = caravan_food_for(world.traders[ti].escort_ids.len() as f64);
    let refused = realm.as_deref().is_some_and(|realm| trade_org_refuses(world, realm));
    let kept_food = q.units == 0.0
        || o.good != Good::Food
        || o.side == TradeSide::Sell
        || held(&world.carriages[wagon].load, Good::Food) >= keep;
    records.push(TradeRecord {
        resident_id: world.residents[ri].id.clone(),
        realm: realm.clone(),
        refused,
        before,
        after: total(world, &parties),
        trader_id: Some(trader_id.to_string()),
        kept_food: Some(kept_food),
        ..Default::default()
    });
    let moved = match realm.as_deref() {
        Some(realm) if q.coins > 0.0 => raise_standing_by_trade(world, realm, TRADE_ORG, q.coins),
        _ => None,
    };
    let r = &world.residents[ri];
    let (kx, ky) = (world.carriages[wagon].x, world.carriages[wagon].y);
    let what = RealmEventWhat::Traded {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        side: o.side,
        good: o.good,
        units: q.units,
        wanted: o.units,
        coins: q.coins,
        x: kx,
        y: ky,
        with_trader: Some(true),
        at_storage: None,
        standing: moved,
    };
    record_event(world, realm.as_deref(), what);
    q.units > 0.0
}

/// Carries out a swap order on the warehouse or NPC city's storage the resident stands on
/// (`swapHere`). Returns whether it moved anything.
fn swap_here(
    world: &mut WorldState,
    ri: usize,
    o: &SwapOrder,
    records: &mut Vec<TradeRecord>,
) -> bool {
    let r = &world.residents[ri];
    let realm = commander_of_resident(world, r);
    let npc = npc_trading_storage_at(world, r.x, r.y).map(|(c, s)| (c.id.clone(), s.id.clone()));
    let warehouse = match npc {
        Some(_) => None,
        None => trading_warehouse_at(world, r.x, r.y).map(|b| b.id.clone()),
    };
    let place = npc.as_ref().map(|(_, s)| s.clone()).or(warehouse.clone());
    let coin_place = match &warehouse {
        Some(w) => trade_coin_warehouse(world, &world.buildings[building_index(world, w)])
            .map(|b| b.id.clone()),
        None => place.clone(),
    };
    let (Some(place), Some(coin_place)) = (place, coin_place) else { return false };
    let city =
        npc.as_ref().map(|(c, _)| world.cities.iter().position(|x| &x.id == c).expect("a city"));
    // The place may have come to refuse the realm since the order was given.
    let refuses = |world: &WorldState| {
        realm.as_deref().is_some_and(|realm| match city {
            Some(ci) => npc_city_refuses(world, &world.cities[ci], realm),
            None => trade_org_refuses(world, realm),
        })
    };
    if refuses(world) {
        return false;
    }
    let p = building_index(world, &place);
    let cp = building_index(world, &coin_place);
    let carriage = carriage_index(world, o.carriage_id.as_deref());
    if o.carriage_id.is_some() {
        let k = carriage.map(|k| &world.carriages[k]);
        let Some(realm) = realm.as_deref() else { return false };
        if !commands_carriage(world, realm, k) {
            return false;
        }
        let k = k.expect("commanded");
        if !is_at((k.x as i32, k.y as i32), placed(&world.buildings[p]), MAP_SIZE) {
            return false;
        }
    }
    let (holder, room) = holder_of(world, ri, carriage);
    ensure_stock(world, p);
    ensure_stock(world, cp);
    let parties = [holder, Holder::Storage(p), Holder::Storage(cp)];
    let before = total(world, &parties);
    let hold = TradeHolder { stock: holder_stock(world, holder), room };
    let q = match city {
        Some(ci) => quote_npc_swap(
            world,
            &world.cities[ci],
            &world.buildings[p],
            hold,
            o.give,
            o.want,
            o.units,
            realm.as_deref(),
        ),
        None => {
            let owed = owed_by(world, &place, o.want);
            quote_swap(world, &world.buildings[p], hold, o.give, o.want, o.units, owed)
        }
    };
    move_between(world, holder, Holder::Storage(p), o.give, q.gives);
    move_between(world, Holder::Storage(p), holder, o.want, q.units);
    move_between(world, Holder::Storage(cp), holder, Good::Coins, q.coins);
    let mut record = TradeRecord {
        resident_id: world.residents[ri].id.clone(),
        realm: realm.clone(),
        refused: refuses(world),
        before,
        after: total(world, &parties),
        ..Default::default()
    };
    if let Some(ci) = city {
        let c = &world.cities[ci];
        let have = npc_city_stock(world, c);
        let keep = npc_reserve(world, c);
        record.npc_city_id = Some(c.id.clone());
        record.kept_reserve = Some(
            q.units == 0.0
                || (held(&have, o.want) >= held(&keep, o.want)
                    && held(&have, o.give) <= held(&keep, o.give)),
        );
    }
    records.push(record);
    let org = match city {
        Some(ci) => world.cities[ci].id.clone(),
        None => TRADE_ORG.to_string(),
    };
    let moved = match realm.as_deref() {
        Some(realm) if q.units > 0.0 => {
            raise_standing_by_trade(world, realm, &org, q.bought + q.sold)
        }
        _ => None,
    };
    let r = &world.residents[ri];
    let (bx, by) = (world.buildings[p].x, world.buildings[p].y);
    let what = RealmEventWhat::Swapped {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        place: if city.is_some() { SwapPlace::Storage } else { SwapPlace::Warehouse },
        give: o.give,
        gave: q.gives,
        want: o.want,
        units: q.units,
        wanted: o.units,
        coins: q.coins,
        x: bx,
        y: by,
        standing: moved,
    };
    record_event(world, realm.as_deref(), what);
    q.units > 0.0
}

/// Carries out a buy horse order (`buyHorseHere`). Returns whether it moved anything.
fn buy_horse_here(
    world: &mut WorldState,
    ri: usize,
    o: &HorseTradeOrder,
    records: &mut Vec<TradeRecord>,
) -> bool {
    let r = &world.residents[ri];
    let realm = commander_of_resident(world, r);
    let Some(hi) = world.horses.iter().position(|h| h.id == o.horse_id) else { return false };
    let Some(realm) = realm else { return false };
    let Some((city, stable)) = npc_horse_at(world, r, &world.horses[hi]) else { return false };
    let (ci, sx, sy) =
        (world.cities.iter().position(|c| c.id == city.id).expect("a city"), stable.x, stable.y);
    let horse = &world.horses[hi];
    let (horse_id, horse_name) = (horse.id.clone(), horse.name.clone());
    let (resident_id, name) = (r.id.clone(), r.name.clone());
    let city_name = world.cities[ci].name.clone();
    let event = |coins: f64, problem: Option<String>| RealmEventWhat::HorseBought {
        resident_id: resident_id.clone(),
        name: name.clone(),
        horse_id: horse_id.clone(),
        horse: horse_name.clone(),
        city: city_name.clone(),
        coins,
        x: sx,
        y: sy,
        problem,
    };
    if let Some(problem) =
        buy_horse_problem(world, &realm, r, Some(&Value::String(horse_id.clone())))
    {
        record_event(world, Some(&realm), event(0.0, Some(problem)));
        return false;
    }
    let city = &world.cities[ci];
    let coins = npc_horse_price(world, city, &world.horses[hi], Some(&realm));
    let storage = npc_storages(world, city)[0].id.clone();
    let s = building_index(world, &storage);
    ensure_stock(world, s);
    let parties = [Holder::Resident(ri), Holder::Storage(s)];
    let before = total(world, &parties);
    move_between(world, Holder::Resident(ri), Holder::Storage(s), Good::Coins, coins);
    world.horses[hi].realm_id = Some(realm.clone());
    world.horses[hi].city_id = None;
    end_breeding_of(world, &horse_id);
    let city = &world.cities[ci];
    let refused = npc_city_refuses(world, city, &realm);
    let kept_pair = npc_horses_of(world, city).len() as f64 >= NPC_HORSES_KEPT;
    let city_id = city.id.clone();
    records.push(TradeRecord {
        resident_id: resident_id.clone(),
        realm: Some(realm.clone()),
        refused,
        before,
        after: total(world, &parties),
        npc_city_id: Some(city_id.clone()),
        kept_reserve: Some(true),
        horse_id: Some(horse_id.clone()),
        kept_pair: Some(kept_pair),
        ..Default::default()
    });
    raise_standing_both_ways(world, &realm, &city_id, coins / STANDING_TRADE_COINS_PER_POINT);
    record_event(world, Some(&realm), event(coins, None));
    true
}

/// Carries out a sell horse order (`sellHorseHere`). Returns whether it moved anything.
fn sell_horse_here(
    world: &mut WorldState,
    ri: usize,
    o: &HorseTradeOrder,
    records: &mut Vec<TradeRecord>,
) -> bool {
    let r = &world.residents[ri];
    let realm = commander_of_resident(world, r);
    let Some(hi) = world.horses.iter().position(|h| h.id == o.horse_id) else { return false };
    let Some(realm) = realm else { return false };
    let Some((city, stable)) = npc_horse_buyer_at(world, r, &world.horses[hi], &realm) else {
        return false;
    };
    let (ci, sx, sy) =
        (world.cities.iter().position(|c| c.id == city.id).expect("a city"), stable.x, stable.y);
    let horse = &world.horses[hi];
    let (horse_id, horse_name) = (horse.id.clone(), horse.name.clone());
    let (resident_id, name) = (r.id.clone(), r.name.clone());
    let city_name = world.cities[ci].name.clone();
    let event = |coins: f64, problem: Option<String>| RealmEventWhat::HorseSold {
        resident_id: resident_id.clone(),
        name: name.clone(),
        horse_id: horse_id.clone(),
        horse: horse_name.clone(),
        city: city_name.clone(),
        coins,
        x: sx,
        y: sy,
        problem,
    };
    if let Some(problem) =
        sell_horse_problem(world, &realm, r, Some(&Value::String(horse_id.clone())))
    {
        record_event(world, Some(&realm), event(0.0, Some(problem)));
        return false;
    }
    let city = &world.cities[ci];
    let coins = npc_horse_buy_price(world, city, &world.horses[hi], Some(&realm));
    let storages: Vec<usize> =
        npc_storages(world, city).iter().map(|b| building_index(world, &b.id)).collect();
    for &s in &storages {
        ensure_stock(world, s);
    }
    let mut parties = vec![Holder::Resident(ri)];
    parties.extend(storages.iter().map(|&s| Holder::Storage(s)));
    let before = total(world, &parties);
    let mut owed = coins;
    for &s in &storages {
        let paid = owed.min(held_in(world.buildings[s].stock.as_ref(), Good::Coins));
        move_between(world, Holder::Storage(s), Holder::Resident(ri), Good::Coins, paid);
        owed -= paid;
    }
    world.horses[hi].realm_id = None;
    world.horses[hi].city_id = Some(world.cities[ci].id.clone());
    end_breeding_of(world, &horse_id);
    let city = &world.cities[ci];
    let refused = npc_city_refuses(world, city, &realm);
    let wanted = npc_horses_of(world, city).len() as f64 <= npc_horses_wanted(world, city);
    let city_id = city.id.clone();
    records.push(TradeRecord {
        resident_id: resident_id.clone(),
        realm: Some(realm.clone()),
        refused,
        before,
        after: total(world, &parties),
        npc_city_id: Some(city_id.clone()),
        kept_reserve: Some(true),
        horse_id: Some(horse_id.clone()),
        kept_pair: Some(true),
        wanted: Some(wanted),
        ..Default::default()
    });
    raise_standing_both_ways(world, &realm, &city_id, coins / STANDING_TRADE_COINS_PER_POINT);
    record_event(world, Some(&realm), event(coins, None));
    true
}

/// Hands in a transfer (`handIn`), in `transfers.rs` (T86.9).
#[allow(clippy::too_many_arguments)]
fn hand_in_order(
    world: &mut WorldState,
    size: i32,
    ri: usize,
    realm: &str,
    o: &HandInOrder,
    warehouse: usize,
    payer: Holder,
) -> bool {
    hand_in(world, size, ri, realm, o, warehouse, payer)
}

/// Orders a delivery or pick-up for a trade order with a city (`orderDelivery`), paying from
/// `payer`. Returns whether a delivery was ordered.
#[allow(clippy::too_many_arguments)]
fn order_delivery(
    world: &mut WorldState,
    size: i32,
    ri: usize,
    realm: &str,
    o: &TradeOrder,
    w: usize,
    payer: Holder,
) -> bool {
    let city = o.city_id.as_deref().and_then(|id| world.cities.iter().position(|c| c.id == id));
    let storage = city
        .filter(|&ci| world.cities[ci].realm_id.as_deref() == Some(realm))
        .and_then(|ci| delivery_storage(world, &world.cities[ci].id))
        .map(|b| b.id.clone());
    let coin_warehouse = trade_coin_warehouse(world, &world.buildings[w]).map(|b| b.id.clone());
    // No caravan would ever come, should the HQ have fallen since the order was given.
    let (Some(ci), Some(storage), Some(coin_warehouse)) = (city, storage, coin_warehouse) else {
        return false;
    };
    if trade_org_hq(world).is_none() {
        return false;
    }
    let s = building_index(world, &storage);
    let cw = building_index(world, &coin_warehouse);
    let (wb, sb) = (&world.buildings[w], &world.buildings[s]);
    let tiles = wrap_distance(size, (wb.x as i32, wb.y as i32), (sb.x as i32, sb.y as i32));
    let q = match o.side {
        TradeSide::Buy => {
            let owed = owed_by(world, &wb.id, o.good);
            quote_delivery(world, wb, holder_stock(world, payer), o.good, o.units, tiles, owed)
        }
        TradeSide::Sell => {
            let free = held(&free_stock(world, &sb.id, sb.stock.as_ref()), o.good);
            let budget = held_in(world.buildings[cw].stock.as_ref(), Good::Coins);
            quote_pick_up(world, wb, o.good, o.units, free, tiles, budget)
        }
    };
    let weight = GOOD_WEIGHT.get(good_name(o.good)).expect("a weight for every good");
    let units = if o.side == TradeSide::Buy || q.units == 0.0 {
        q.units
    } else {
        o.units.min((DELIVERY_LOAD / weight + 1e-9).floor())
    };
    if o.side == TradeSide::Buy {
        ensure_stock(world, cw);
        move_between(world, payer, Holder::Storage(cw), Good::Coins, q.coins + q.fee);
    }
    if o.side == TradeSide::Buy && q.coins > 0.0 {
        raise_standing_both_ways(world, realm, TRADE_ORG, q.coins / STANDING_TRADE_COINS_PER_POINT);
    }
    let city_id = world.cities[ci].id.clone();
    if units > 0.0 {
        let id = new_id(world, "delivery");
        world.deliveries.push(Delivery {
            id,
            kind: if o.side == TradeSide::Buy {
                DeliveryKind::Delivery
            } else {
                DeliveryKind::PickUp
            },
            realm_id: realm.to_string(),
            warehouse_id: world.buildings[w].id.clone(),
            city_id: city_id.clone(),
            good: o.good,
            units,
            fee: if o.side == TradeSide::Buy { q.fee } else { 0.0 },
            caravan_id: None,
        });
    }
    let r = &world.residents[ri];
    let what = RealmEventWhat::DeliveryOrdered {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        side: o.side,
        good: o.good,
        units,
        wanted: o.units,
        coins: q.coins,
        fee: q.fee,
        city_id,
        city: world.cities[ci].name.clone(),
        x: world.buildings[w].x,
        y: world.buildings[w].y,
    };
    record_event(world, Some(realm), what);
    units > 0.0
}

fn violation(invariant: &str, message: String, entity_ids: Vec<String>) -> InvariantViolation {
    InvariantViolation { invariant: invariant.into(), message, entity_ids }
}

/// A trade never creates or destroys goods or coins (`trades-keep-goods`).
pub fn trades_keep_goods(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for t in &ledger.records {
        let mut goods: Vec<Good> = t.before.keys().copied().collect();
        goods.extend(t.after.keys().copied().filter(|g| !t.before.contains_key(g)));
        for g in goods {
            let (b, a) = (held(&t.before, g), held(&t.after, g));
            if b != a {
                out.push(violation(
                    "trades-keep-goods",
                    format!(
                        "a trade by {} turned {} {} into {}",
                        t.resident_id,
                        b,
                        good_name(g),
                        a
                    ),
                    vec![t.resident_id.clone()],
                ));
            }
        }
    }
    out
}

/// Every buy, sell, swap and hand-in order is done the tick it is given (`trade-orders-done`).
pub fn trade_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| {
            matches!(
                r.order,
                Some(
                    ResidentOrder::Trade(_)
                        | ResidentOrder::Swap(_)
                        | ResidentOrder::HandIn(_)
                        | ResidentOrder::BuyHorse(_)
                        | ResidentOrder::SellHorse(_)
                )
            )
        })
        .map(|r| {
            violation(
                "trade-orders-done",
                format!("resident {} still holds a trade order after the tick", r.id),
                vec![r.id.clone()],
            )
        })
        .collect()
}

/// The Trade Organization and NPC cities trade with nobody they refuse (`refused-trade-nothing`).
pub fn refused_trade_nothing(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    ledger
        .records
        .iter()
        .filter(|t| t.refused)
        .map(|t| {
            let with = t.npc_city_id.clone().unwrap_or_else(|| "the Trade Organization".into());
            let realm = t.realm.clone().unwrap_or_else(|| "null".into());
            violation(
                "refused-trade-nothing",
                format!("{} of {} traded with {}, which refuses it", t.resident_id, realm, with),
                vec![t.resident_id.clone()],
            )
        })
        .collect()
}

/// A wandering trader sells only what it has to trade (`trader-trades-keep-food`).
pub fn trader_trades_keep_food(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    ledger
        .records
        .iter()
        .filter(|t| t.trader_id.is_some() && t.kept_food != Some(true))
        .map(|t| {
            let trader = t.trader_id.clone().unwrap_or_default();
            violation(
                "trader-trades-keep-food",
                format!("a trade by {} sold the Food on board of trader {}", t.resident_id, trader),
                vec![t.resident_id.clone(), trader],
            )
        })
        .collect()
}

/// An NPC city keeps a breeding pair (`npc-horse-sales-keep-pair`).
pub fn npc_horse_sales_keep_pair(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    ledger
        .records
        .iter()
        .filter(|t| t.horse_id.is_some() && t.kept_pair != Some(true))
        .map(|t| {
            let (h, c) =
                (t.horse_id.clone().unwrap_or_default(), t.npc_city_id.clone().unwrap_or_default());
            violation(
                "npc-horse-sales-keep-pair",
                format!("{} bought {} out of the pair {} keeps", t.resident_id, h, c),
                vec![t.resident_id.clone(), h, c],
            )
        })
        .collect()
}

/// An NPC city buys a horse only while it has fewer than it wants (`npc-horse-purchases-wanted`).
pub fn npc_horse_purchases_wanted(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    ledger
        .records
        .iter()
        .filter(|t| t.wanted == Some(false))
        .map(|t| {
            let (h, c) =
                (t.horse_id.clone().unwrap_or_default(), t.npc_city_id.clone().unwrap_or_default());
            violation(
                "npc-horse-purchases-wanted",
                format!("{} sold {} to {}, which wanted no more", t.resident_id, h, c),
                vec![t.resident_id.clone(), h, c],
            )
        })
        .collect()
}

/// An NPC city keeps its reserve (`npc-trades-keep-reserve`).
pub fn npc_trades_keep_reserve(ledger: &TradeLedger) -> Vec<InvariantViolation> {
    ledger
        .records
        .iter()
        .filter(|t| t.npc_city_id.is_some() && t.kept_reserve != Some(true))
        .map(|t| {
            let c = t.npc_city_id.clone().unwrap_or_default();
            violation(
                "npc-trades-keep-reserve",
                format!("a trade by {} broke into the reserve of {}", t.resident_id, c),
                vec![t.resident_id.clone(), c],
            )
        })
        .collect()
}
