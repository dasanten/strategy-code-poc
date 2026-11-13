//! `apps/server/src/trading.test.ts`, one test per `it`. The post is laid out by hand as
//! `foundTradingPost` (T86.9) leaves its warehouse: a Trade Org post city with a warehouse holding
//! `TRADING_POST`'s coins and goods; the HQ is the one the TypeScript founded in the `hq-0`
//! fixture. Each step checks `goodsOnlyFromNothingAtTheFloor`; `checkInvariants` comes with T86.13.

mod common;
#[macro_use]
mod goods_support;

use csp_shared::balance::{CARRIAGE_CAPACITY, STANDING_TRADE_COINS_PER_POINT, TRADING_POST};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, Good, RealmEventWhat, Resident, Stock, TradeSide, WorldState};
use csp_sim::goods_made::tally_goods;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::js_round;
use csp_sim::queries::residents::carry_capacity;
use csp_sim::queries::residents::{good_weight, stock_weight};
use csp_sim::queries::standing::{standing_of, TRADE_ORG};
use csp_sim::queries::warehouse::{price_for, stock_floor, HQ_COIN_WAREHOUSE};
use csp_sim::tick::{goods_only_from_nothing_at_the_floor, Scratch};
use csp_sim::trading::trades_keep_goods;
use goods_support::{building, new_resident, open, player, realm, step, stock, Queue};
use serde_json::{json, Value};

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
    /// Where the warehouse is in `world.buildings`.
    w: usize,
}

/// A resident of r1 as the test's `resident` makes them, drawn from `mulberry32(seed)`.
fn add(world: &mut WorldState, id: &str, x: f64, y: f64, seed: f64) {
    let mut r: Resident = new_resident(seed, id, Some("r1"), x, y);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
}

/// A trading post and its warehouse, realm r1 (Player 7) with its Leader a1 far away, and r1's
/// p1 standing on the warehouse (`post`).
fn post() -> Setup {
    let terrain = open(128);
    let mut world = goods_support::world_on(&terrain);
    world.realms.push(realm("r1", 7, "a1"));
    world.buildings.push(building(
        json!({ "id": "post-hall", "kind": "townHall", "cityId": "post", "x": 34, "y": 34 }),
    ));
    world.cities.push(
        serde_json::from_value(json!({
            "id": "post", "name": "Stonecross", "realmId": null, "townHallId": "post-hall",
            "occupation": null, "tradeOrg": "post",
        }))
        .unwrap(),
    );
    let mut goods = json!({ "coins": TRADING_POST.coins });
    for (g, n) in TRADING_POST.goods.0 {
        goods[*g] = json!(n);
    }
    world.buildings.push(building(json!({ "id": "wh", "kind": "warehouse", "cityId": "post", "x": 37, "y": 34, "stock": goods })));
    // `foundTradingPost` gives the post its residents first, so the seeds follow theirs.
    let first = TRADING_POST.residents + 1.0;
    add(&mut world, "a1", 110.0, 110.0, first);
    add(&mut world, "p1", 37.0, 34.0, first + 1.0);
    let w = world.buildings.len() - 1;
    Setup { world, terrain, scratch: Scratch::default(), w }
}

impl Setup {
    fn p1(&self) -> &Resident {
        self.world.residents.iter().find(|r| r.id == "p1").unwrap()
    }
    fn p1_mut(&mut self) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == "p1").unwrap()
    }
    fn warehouse(&self) -> &Building {
        &self.world.buildings[self.w]
    }
    fn wh(&self, g: Good) -> f64 {
        self.warehouse().stock.as_ref().unwrap().get(&g).copied().unwrap_or(0.0)
    }
    fn set_wh(&mut self, g: Good, n: f64) {
        self.world.buildings[self.w].stock.as_mut().unwrap().insert(g, n);
    }
    fn carry(&mut self, s: Value) {
        self.p1_mut().carried = stock(s);
    }
    fn held(&self, g: Good) -> Option<f64> {
        self.p1().carried.get(&g).copied()
    }
    /// Sends an order from the trader, applies it and answers whether it was taken (`order`).
    fn order(&mut self, o: Value) -> String {
        let mut o = o;
        o["residentId"] = json!("p1");
        let mut q = Queue::new(&self.terrain);
        let answer = q.receive(&self.world, &player(7), o);
        q.apply_all(&mut self.world);
        answer.err().unwrap_or_else(|| "ack".into())
    }
    /// Steps the world once, keeping residents fed, and checks that goods came only from nothing
    /// at the floor (`run`).
    fn run(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        let before = tally_goods(&self.world);
        self.scratch.made.take();
        step(&mut self.world, &self.terrain, &mut self.scratch);
        let made = self.scratch.made.take();
        assert_eq!(goods_only_from_nothing_at_the_floor(&before, &self.world, &made), vec![]);
    }
    fn last_event(&self) -> &RealmEventWhat {
        &self.world.events.last().unwrap().what
    }
}

/// What `units` units sold into (or bought out of) a warehouse come to (`sum`).
fn sum(units: u32, price: impl Fn(f64) -> f64) -> f64 {
    (1..=units).map(|n| price(n as f64)).sum()
}

#[test]
fn sells_the_goods_go_into_the_warehouse_and_its_buy_price_per_unit_into_the_hands() {
    let mut s = post();
    s.carry(json!({ "iron": 10 }));
    let stock_before = s.wh(Good::Iron);
    let coins = s.wh(Good::Coins);
    let floor = stock_floor(&s.world, s.warehouse())[&Good::Iron];
    assert_eq!(s.order(json!({ "kind": "sell", "good": "iron", "units": 4 })), "ack");
    s.run();
    let paid = sum(4, |n| price_for(Good::Iron, stock_before + n, floor).buy);
    assert!(paid > 0.0);
    assert_stock!(s.p1().carried, { "iron": 6, "coins": paid });
    assert_eq!(s.wh(Good::Iron), stock_before + 4.0);
    assert_eq!(s.wh(Good::Coins), coins - paid);
    assert_eq!(s.p1().order, None);
    // The trade raises standing both ways with the Trade Organization, by the coins it moved.
    let raised = paid / STANDING_TRADE_COINS_PER_POINT;
    let close = |a: f64, b: f64| (a - b).abs() < 0.005;
    assert!(close(standing_of(&s.world, TRADE_ORG, "r1"), raised));
    assert!(close(standing_of(&s.world, "r1", TRADE_ORG), raised));
    // Named by any of its cities, the Trade Organization is one.
    assert!(close(standing_of(&s.world, "post", "r1"), raised));
    // Its number is not an NPC city's, and the log says how far the trade moved it.
    assert_eq!(STANDING_TRADE_COINS_PER_POINT, 50.0);
    let RealmEventWhat::Traded { standing: Some(m), .. } = s.last_event() else {
        panic!("traded with standing")
    };
    assert_eq!((m.org.as_str(), m.by), (TRADE_ORG, js_round(raised * 100.0) / 100.0));
}

#[test]
fn buys_the_coins_go_into_the_warehouse_and_the_goods_into_the_hands_at_its_sell_price() {
    let mut s = post();
    s.carry(json!({ "coins": 500 }));
    let stock_before = s.wh(Good::Wood);
    let coins = s.wh(Good::Coins);
    let floor = stock_floor(&s.world, s.warehouse())[&Good::Wood];
    assert_eq!(s.order(json!({ "kind": "buy", "good": "wood", "units": 3 })), "ack");
    s.run();
    let cost = sum(3, |n| price_for(Good::Wood, stock_before - n + 1.0, floor).sell);
    assert_stock!(s.p1().carried, { "coins": 500.0 - cost, "wood": 3 });
    assert_eq!(s.wh(Good::Wood), stock_before - 3.0);
    assert_eq!(s.wh(Good::Coins), coins + cost);
}

#[test]
fn cuts_a_purchase_down_to_what_fits_in_their_hands_and_to_the_coins_they_have() {
    let mut s = post();
    s.carry(json!({ "coins": 1000 }));
    s.set_wh(Good::Stone, 10_000.0);
    s.order(json!({ "kind": "buy", "good": "stone", "units": 10000 }));
    s.run();
    let stone = s.held(Good::Stone).unwrap();
    assert!(stone > 0.0 && stone < 10_000.0);
    let capacity = carry_capacity(s.p1(), s.world.tick as f64);
    assert!(stock_weight(&s.p1().carried) <= capacity);
    // One more stone would not have fitted.
    assert!(stock_weight(&s.p1().carried) + good_weight(Good::Stone) > capacity);

    let mut poor = post();
    poor.carry(json!({ "coins": 5 }));
    poor.order(json!({ "kind": "buy", "good": "iron", "units": 10 }));
    poor.run();
    assert_stock!(poor.p1().carried, { "coins": 5 });
}

#[test]
fn cuts_a_sale_down_to_what_they_hold_and_to_the_coins_the_warehouse_has() {
    let mut s = post();
    s.carry(json!({ "iron": 3 }));
    s.order(json!({ "kind": "sell", "good": "iron", "units": 50 }));
    s.run();
    assert_eq!(s.held(Good::Iron), None);
    assert!(s.held(Good::Coins).unwrap() > 0.0);

    let mut broke = post();
    broke.carry(json!({ "iron": 3 }));
    broke.set_wh(Good::Coins, 0.0);
    broke.order(json!({ "kind": "sell", "good": "iron", "units": 3 }));
    broke.run();
    assert_stock!(broke.p1().carried, { "iron": 3 });
    let RealmEventWhat::Traded { units, wanted, .. } = broke.last_event() else { panic!("traded") };
    assert_eq!((*units, *wanted), (0.0, 3.0));
}

#[test]
fn logs_each_trade_in_the_realm_log() {
    let mut s = post();
    s.carry(json!({ "iron": 10 }));
    s.order(json!({ "kind": "sell", "good": "iron", "units": 2 }));
    s.run();
    let e = s.world.events.last().unwrap();
    assert_eq!(e.user_id, 7);
    let RealmEventWhat::Traded { resident_id, side, good, units, wanted, coins, x, y, .. } =
        &e.what
    else {
        panic!("traded")
    };
    assert_eq!(
        (resident_id.as_str(), *side, *good, *units, *wanted),
        ("p1", TradeSide::Sell, Good::Iron, 2.0, 2.0)
    );
    assert_eq!(Some(*coins), s.held(Good::Coins));
    assert_eq!((*x, *y), (s.warehouse().x, s.warehouse().y));
}

#[test]
fn trades_from_and_into_a_carriage_of_theirs_on_the_tile() {
    let mut s = post();
    let (x, y) = (s.warehouse().x, s.warehouse().y);
    s.world.carriages.push(
        serde_json::from_value(json!({
            "id": "k1", "realmId": "r1", "cityId": null, "x": x, "y": y, "horseId": null,
            "load": { "stone": 100 },
        }))
        .unwrap(),
    );
    let stone = s.wh(Good::Stone);
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "stone", "units": 100, "carriageId": "k1" })),
        "ack"
    );
    s.run();
    let k = &s.world.carriages[0];
    assert_eq!(k.load.get(&Good::Stone), None);
    assert!(k.load[&Good::Coins] > 0.0);
    assert_eq!(s.wh(Good::Stone), stone + 100.0);
    assert!(s.p1().carried.is_empty());
    assert!(stock_weight(&k.load) <= CARRIAGE_CAPACITY);
}

#[test]
fn at_the_hq_takes_and_pays_coins_from_its_coin_warehouse() {
    let (mut world, size, _) = common::load_world("worlds/hq-0.json");
    let terrain = open(size);
    let hq = world.cities.iter().find(|c| c.trade_org.is_some()).unwrap().clone();
    let hall = town_hall_of(&world, &hq).unwrap().clone();
    let is_coins =
        |b: &Building| b.x == hall.x + HQ_COIN_WAREHOUSE.0 && b.y == hall.y + HQ_COIN_WAREHOUSE.1;
    let coins_at = world
        .buildings
        .iter()
        .position(|b| b.kind == csp_shared::world::BuildingKind::Warehouse && is_coins(b))
        .unwrap();
    let goods_at = world
        .buildings
        .iter()
        .position(|b| b.kind == csp_shared::world::BuildingKind::Warehouse && !is_coins(b))
        .unwrap();
    world.realms.push(realm("r1", 7, "a1"));
    let first = world.residents.len() as f64 + 1.0;
    add(&mut world, "a1", 10.0, 10.0, first);
    let (gx, gy) = (world.buildings[goods_at].x, world.buildings[goods_at].y);
    add(&mut world, "p1", gx, gy, first + 1.0);
    let mut s = Setup { world, terrain, scratch: Scratch::default(), w: goods_at };
    s.carry(json!({ "iron": 5 }));
    let coins = |s: &Setup, i: usize| {
        s.world.buildings[i].stock.as_ref().and_then(|x| x.get(&Good::Coins).copied())
    };
    let before = coins(&s, coins_at).unwrap();
    assert_eq!(s.order(json!({ "kind": "sell", "good": "iron", "units": 5 })), "ack");
    s.run();
    assert_eq!(s.held(Good::Iron), None);
    assert_eq!(coins(&s, coins_at), Some(before - s.held(Good::Coins).unwrap()));
    assert_eq!(coins(&s, goods_at), None);

    // Its coin warehouse prices nothing: nobody trades on it.
    let (cx, cy) = (s.world.buildings[coins_at].x, s.world.buildings[coins_at].y);
    s.p1_mut().x = cx;
    s.p1_mut().y = cy;
    s.carry(json!({ "iron": 5 }));
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "iron", "units": 5 })),
        "not at a Trade Org warehouse"
    );
}

/// Ported as it is: p1 (Strength 6) can't carry 2,000 coins, so the purchase buys nothing, and
/// the test passes in the TypeScript only because survival drops what they can't carry
/// (`stepSurvival`, T86.3), 900 coins of it; `bought` is then undefined and the sale rejected.
#[test]
fn always_costs_coins_to_buy_and_sell_back_or_sell_and_buy_back() {
    let mut s = post();
    for good in ["food", "iron", "goldOre"] {
        let g = csp_sim::queries::names::good_of(good).unwrap();
        s.carry(json!({ "coins": 2000 }));
        s.order(json!({ "kind": "buy", "good": good, "units": 5 }));
        s.run();
        let bought = s.held(g);
        s.order(json!({ "kind": "sell", "good": good, "units": bought }));
        s.run();
        assert!(s.held(Good::Coins).unwrap() < 2000.0);

        let mut c = Stock::new();
        c.insert(g, 5.0);
        s.p1_mut().carried = c;
        s.order(json!({ "kind": "sell", "good": good, "units": 5 }));
        s.run();
        s.order(json!({ "kind": "buy", "good": good, "units": 5 }));
        s.run();
        assert!(s.held(g).unwrap_or(0.0) < 5.0);
    }
}

#[test]
fn rejects_trades_off_a_warehouse_by_children_of_unknown_goods_and_with_others_carriages() {
    let mut s = post();
    s.carry(json!({ "iron": 2, "coins": 50 }));
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "coins", "units": 1 })),
        "not a good warehouses trade"
    );
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "iron", "units": 0 })),
        "units must be a whole number"
    );
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "wood", "units": 1 })),
        "none of that good to sell"
    );
    let (x, y) = (s.warehouse().x, s.warehouse().y);
    s.world.carriages.push(
        serde_json::from_value(json!({
            "id": "k2", "realmId": "r2", "cityId": null, "x": x, "y": y, "horseId": null,
            "load": { "iron": 5 },
        }))
        .unwrap(),
    );
    assert_eq!(
        s.order(json!({ "kind": "sell", "good": "iron", "units": 1, "carriageId": "k2" })),
        "not one of your carriages"
    );
    let tick = s.world.tick as f64;
    s.p1_mut().born_at = tick;
    assert_eq!(
        s.order(json!({ "kind": "buy", "good": "iron", "units": 1 })),
        "children can’t trade"
    );
    s.p1_mut().born_at = -20.0 * 24.0 * 3600.0;
    s.p1_mut().x += FOOTPRINT.get("warehouse").unwrap() as f64;
    assert_eq!(
        s.order(json!({ "kind": "buy", "good": "iron", "units": 1 })),
        "not at a Trade Org warehouse"
    );
}

#[test]
fn has_an_invariant_that_a_trade_never_creates_or_destroys_goods_or_coins() {
    let mut s = post();
    s.carry(json!({ "iron": 4 }));
    s.order(json!({ "kind": "sell", "good": "iron", "units": 4 }));
    s.run();
    assert_eq!(s.scratch.trades.records.len(), 1);
    assert_eq!(trades_keep_goods(&s.scratch.trades), vec![]);
    *s.scratch.trades.records[0].after.entry(Good::Coins).or_insert(0.0) += 1.0;
    let v = trades_keep_goods(&s.scratch.trades);
    assert_eq!(v.len(), 1);
    assert_eq!(
        (v[0].invariant.as_str(), v[0].entity_ids.clone()),
        ("trades-keep-goods", vec!["p1".to_string()])
    );
}
