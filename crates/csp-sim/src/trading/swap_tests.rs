//! `swap.test.ts`: a swap (`CONTEXT.md`: Swap): goods for goods in person at a warehouse or an NPC
//! city's storage, a sale and a purchase at once, rounded up on the side given, with what is over
//! back in Coins as far as the place holds them.

use std::sync::Arc;

use csp_shared::balance::{
    GOOD_WEIGHT, MAX_HUNGER, STANDING_NPC_TRADE_COINS_PER_POINT, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, Carriage, City, Good, Realm, Resident, ResourceKind, Stock, WorldState,
};
use serde_json::{json, Value};

use super::trades_keep_goods;
use crate::invariants::{check_invariants_with, world_invariants, Ledgers};
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_prices, npc_reserve, NpcCityPrice};
use crate::queries::residents::{carry_capacity, stock_weight};
use crate::queries::standing::{standing_of, TRADE_ORG};
use crate::queries::trade_quotes::{npc_swap_rates, quote_npc_swap, quote_swap, SwapRate};
use crate::queries::warehouse::{price_for, stock_floor};
use crate::queries::warehouse_trade::{TradeHolder, TradeLimit};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::trading_posts::found_trading_post;
use crate::world::{create_world, step_world};

const SIZE: i32 = 128;

fn player() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn resident(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    (x, y): (f64, f64),
    city_id: Option<&str>,
) {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
}

fn realm_r1(world: &mut WorldState) {
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "a1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scratch: Scratch,
    /// The warehouse's or the NPC city's storage's id.
    place: String,
}

/// Realm r1 (Player 7, Leader a1 far away) and its p1 standing on a trading post's warehouse
/// (`post`).
fn post() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    realm_r1(&mut world);
    let mut m = Mulberry32::new(3.0);
    let city =
        found_trading_post(&mut world, &terrain, 20, 20, Some(ResourceKind::Stone), &mut || {
            m.next()
        });
    let w = world.buildings.iter().position(|b| {
        b.kind == csp_shared::world::BuildingKind::Warehouse && b.city_id.as_deref() == Some(&city)
    });
    let w = w.expect("the post's warehouse");
    let (x, y) = (world.buildings[w].x, world.buildings[w].y);
    resident(&mut world, "a1", Some("r1"), (110.0, 110.0), None);
    resident(&mut world, "p1", Some("r1"), (x, y), None);
    let s = world.buildings[w].stock.get_or_insert_with(Stock::new);
    s.insert(Good::Wood, 50.0);
    s.insert(Good::Stone, 50.0);
    s.insert(Good::Coins, 1000.0);
    let place = world.buildings[w].id.clone();
    Setup { world, terrain: Arc::new(terrain), scratch: Scratch::default(), place }
}

/// Realm r1 and the NPC city npc, with a storage at (23, 20) that holds no stock yet and six of
/// its residents; r1's p1 stands on the storage (`npcCity`).
fn npc_city() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    realm_r1(&mut world);
    add_city(&mut world, "npc", None, 20.0, 20.0);
    world.cities.last_mut().unwrap().name = "Dunmere".into();
    let store =
        json!({ "id": "store", "kind": "storage", "cityId": "npc", "x": 23, "y": 20, "stock": {} });
    world.buildings.push(serde_json::from_value::<Building>(store).unwrap());
    resident(&mut world, "a1", Some("r1"), (110.0, 110.0), None);
    for i in 1..=6 {
        resident(&mut world, &format!("n{i}"), None, (20.0, 21.0), Some("npc"));
    }
    resident(&mut world, "p1", Some("r1"), (23.0, 20.0), None);
    Setup { world, terrain: Arc::new(terrain), scratch: Scratch::default(), place: "store".into() }
}

impl Setup {
    fn p1(&self) -> &Resident {
        self.world.residents.iter().find(|r| r.id == "p1").unwrap()
    }

    fn p1_mut(&mut self) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == "p1").unwrap()
    }

    fn carried(&self, g: Good) -> f64 {
        held(&self.p1().carried, g)
    }

    fn set_carried(&mut self, s: Stock) {
        self.p1_mut().carried = s;
    }

    fn place(&self) -> &Building {
        self.world.buildings.iter().find(|b| b.id == self.place).unwrap()
    }

    fn place_stock(&mut self) -> &mut Stock {
        let id = self.place.clone();
        let b = self.world.buildings.iter_mut().find(|b| b.id == id).unwrap();
        b.stock.get_or_insert_with(Stock::new)
    }

    fn held(&self, g: Good) -> f64 {
        held(self.place().stock.as_ref().unwrap(), g)
    }

    fn npc(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == "npc").unwrap()
    }

    fn reserve(&self, g: Good) -> f64 {
        held(&npc_reserve(&self.world, self.npc()), g)
    }

    fn carriage(&mut self, load: Stock) {
        let (x, y) = (self.place().x, self.place().y);
        let k = Carriage {
            id: "k1".into(),
            realm_id: Some("r1".into()),
            city_id: None,
            x,
            y,
            horse_id: None,
            load,
        };
        self.world.carriages.push(k);
    }

    fn load(&self, g: Good) -> f64 {
        held(&self.world.carriages.iter().find(|k| k.id == "k1").unwrap().load, g)
    }

    /// Sends a swap from the Player, applies it and answers whether it was taken (`swap`).
    fn swap(&mut self, give: &str, want: &str, units: Value, extra: Value) -> String {
        let mut o = json!({ "kind": "swap", "residentId": "p1", "give": give, "want": want, "units": units });
        if let Value::Object(more) = extra {
            o.as_object_mut().unwrap().extend(more);
        }
        let mut queue = OrderQueue::new(order_kinds(), Some(self.terrain.clone()));
        let answer = queue.receive(&self.world, &player(), &json!("q"), &o);
        queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    fn swap5(&mut self) -> String {
        self.swap("wood", "stone", json!(5), Value::Null)
    }

    /// Steps the world once, keeping residents fed, and checks every invariant (`run`).
    fn run(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        step_world(&mut self.world, &self.terrain, &mut self.scratch, None, None);
        let ledgers = Ledgers { trades: Some(&self.scratch.trades), ..Ledgers::default() };
        let broken =
            check_invariants_with(&self.world, &self.terrain, &world_invariants(), &ledgers);
        assert_eq!(broken, []);
    }

    fn last_event(&self) -> Value {
        serde_json::to_value(self.world.events.last().expect("an event")).unwrap()
    }
}

/// What a warehouse's prices make of `want` units wanted: the units given and the Coins over
/// (`worked`).
struct Worked {
    gives: f64,
    over: f64,
    bought: f64,
    sold: f64,
}

fn worked(floor_wood: f64, floor_stone: f64, wood: f64, stone: f64, want: u32) -> Worked {
    let mut bought = 0.0;
    for n in 1..=want {
        bought += price_for(Good::Stone, stone - f64::from(n - 1), floor_stone).sell;
    }
    let (mut sold, mut gives) = (0.0, 0.0);
    while sold < bought {
        gives += 1.0;
        sold += price_for(Good::Wood, wood + gives, floor_wood).buy;
    }
    Worked { gives, over: sold - bought, bought, sold }
}

fn worked_at(s: &Setup, want: u32) -> Worked {
    let floor = stock_floor(&s.world, s.place());
    worked(held(&floor, Good::Wood), held(&floor, Good::Stone), 50.0, 50.0, want)
}

// a swap at a warehouse

#[test]
fn needs_no_coins_in_hand_rounds_up_what_is_given_and_gives_what_is_over_back_in_coins() {
    let mut s = post();
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let w = worked_at(&s, 5);
    let floor = stock_floor(&s.world, s.place());
    assert!(w.over >= 0.0);
    assert!(w.over < price_for(Good::Wood, 50.0 + w.gives, held(&floor, Good::Wood)).buy);
    assert_eq!(s.swap5(), "ack");
    s.run();
    assert_eq!(s.p1().order, None);
    let mut want = stock(&[(Good::Stone, 5.0)]);
    if w.gives < 20.0 {
        want.insert(Good::Wood, 20.0 - w.gives);
    }
    if w.over > 0.0 {
        want.insert(Good::Coins, w.over);
    }
    assert_eq!(s.p1().carried, want);
    assert_eq!(s.held(Good::Wood), 50.0 + w.gives);
    assert_eq!(s.held(Good::Stone), 45.0);
    assert_eq!(s.held(Good::Coins), 1000.0 - w.over);
    let e = s.last_event();
    assert_eq!(e["kind"], "swapped");
    assert_eq!(e["place"], "warehouse");
    assert_eq!(e["give"], "wood");
    assert_eq!(e["gave"], json!(w.gives));
    assert_eq!(e["want"], "stone");
    assert_eq!(e["units"], json!(5.0));
    assert_eq!(e["wanted"], json!(5.0));
    assert_eq!(e["coins"], json!(w.over));
}

#[test]
fn moves_the_rate_with_the_stock_as_it_goes() {
    let mut s = post();
    // Little of what is wanted and much of what is given: each unit asks more for less.
    *s.place_stock() = stock(&[(Good::Wood, 400.0), (Good::Stone, 8.0), (Good::Coins, 1000.0)]);
    s.set_carried(Stock::new());
    let held_stock = stock(&[(Good::Wood, 1000.0)]);
    let q = |n: f64| {
        let holder = TradeHolder { stock: &held_stock, room: 1e6 };
        quote_swap(&s.world, s.place(), holder, Good::Wood, Good::Stone, n, 0.0)
    };
    assert!(q(1.0).gives > 0.0);
    assert!(q(6.0).gives > q(1.0).gives * 6.0);
}

#[test]
fn is_cut_down_by_what_the_trader_holds() {
    let mut s = post();
    s.set_carried(stock(&[(Good::Wood, 3.0)]));
    let floor = stock_floor(&s.world, s.place());
    let carried = s.p1().carried.clone();
    let holder = TradeHolder { stock: &carried, room: 1e6 };
    let q = quote_swap(&s.world, s.place(), holder, Good::Wood, Good::Stone, 40.0, 0.0);
    assert_eq!(q.limit, Some(TradeLimit::Held));
    assert!(q.units < 40.0);
    assert!(q.gives <= 3.0);
    // One unit more would take more wood than they hold.
    let more =
        worked(held(&floor, Good::Wood), held(&floor, Good::Stone), 50.0, 50.0, q.units as u32 + 1);
    assert!(more.gives > 3.0);
    s.swap("wood", "stone", json!(40), Value::Null);
    s.run();
    assert_eq!(s.carried(Good::Stone), q.units);
    let e = s.last_event();
    assert_eq!(e["kind"], "swapped");
    assert_eq!(e["units"], json!(q.units));
    assert_eq!(e["wanted"], json!(40.0));
}

#[test]
fn is_cut_down_by_what_the_warehouse_holds_and_keeps_what_is_owed_for_deliveries() {
    let mut s = post();
    s.place_stock().insert(Good::Stone, 3.0);
    let load = stock(&[(Good::Wood, 100.0)]);
    s.carriage(load.clone());
    let quote = |owed: f64| {
        let holder = TradeHolder { stock: &load, room: 1e6 };
        quote_swap(&s.world, s.place(), holder, Good::Wood, Good::Stone, 10.0, owed)
    };
    for (owed, units) in [(0.0, 3.0), (2.0, 1.0), (3.0, 0.0)] {
        let q = quote(owed);
        assert_eq!((q.units, q.limit), (units, Some(TradeLimit::Stock)), "owing {owed}");
    }
    s.swap("wood", "stone", json!(10), json!({ "carriageId": "k1" }));
    s.run();
    assert_eq!(s.load(Good::Stone), 3.0);
    assert_eq!(s.held(Good::Stone), 0.0);
}

#[test]
fn is_cut_down_by_what_fits_counting_what_is_given_what_is_got_and_the_coins_back() {
    let mut s = post();
    // Shields are plenty here and cheap, so a shield is heavier than the gold ore that pays for
    // it: each swapped adds to the load.
    assert!(GOOD_WEIGHT.get("shield").unwrap() > GOOD_WEIGHT.get("goldOre").unwrap());
    s.place_stock().insert(Good::Shield, 32.0);
    s.place_stock().insert(Good::GoldOre, 20.0);
    let capacity = carry_capacity(s.p1(), s.world.tick as f64);
    s.set_carried(stock(&[(Good::GoldOre, capacity - 2.0)]));
    let carried = s.p1().carried.clone();
    let room = capacity - stock_weight(&carried);
    let holder = TradeHolder { stock: &carried, room };
    let q = quote_swap(&s.world, s.place(), holder, Good::GoldOre, Good::Shield, 5.0, 0.0);
    assert_eq!(q.limit, Some(TradeLimit::Room));
    assert!(q.units > 0.0);
    assert!(q.units < 5.0);
    s.swap("goldOre", "shield", json!(5), Value::Null);
    s.run();
    assert_eq!(s.carried(Good::Shield), q.units);
    assert!(stock_weight(&s.p1().carried) <= capacity + 1e-9);
}

#[test]
fn gives_coins_back_only_as_far_as_the_place_holds_them_the_coins_left_stay() {
    let mut s = post();
    s.place_stock().insert(Good::Coins, 0.0);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let w = worked_at(&s, 5);
    s.swap5();
    s.run();
    assert_eq!(s.carried(Good::Stone), 5.0);
    assert_eq!(s.carried(Good::Coins), 0.0);
    assert_eq!(s.carried(Good::Wood), 20.0 - w.gives);
    assert_eq!(s.held(Good::Coins), 0.0);
}

#[test]
fn swaps_from_the_load_of_a_carriage_on_the_tile() {
    let mut s = post();
    s.carriage(stock(&[(Good::Wood, 40.0)]));
    s.set_carried(Stock::new());
    assert_eq!(s.swap("wood", "stone", json!(2), json!({ "carriageId": "k1" })), "ack");
    s.run();
    assert_eq!(s.load(Good::Stone), 2.0);
    assert!(s.load(Good::Wood) < 40.0);
    assert_eq!(s.p1().carried, Stock::new());
}

#[test]
fn raises_standing_both_ways_by_the_sale_and_the_purchase() {
    let mut s = post();
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let w = worked_at(&s, 5);
    let before = standing_of(&s.world, "r1", TRADE_ORG);
    s.swap5();
    s.run();
    let now = standing_of(&s.world, "r1", TRADE_ORG);
    let raised = before + (w.bought + w.sold) / STANDING_TRADE_COINS_PER_POINT;
    assert!((now - raised).abs() < 0.005, "{now} vs {raised}");
}

#[test]
fn turns_down_what_is_no_swap() {
    let mut s = post();
    s.set_carried(Stock::new());
    assert_eq!(s.swap5(), "none of that good to give");
    s.set_carried(stock(&[(Good::Wood, 5.0)]));
    assert_eq!(s.swap("wood", "wood", json!(5), Value::Null), "a swap takes two different goods");
    assert_eq!(s.swap("coins", "wood", json!(5), Value::Null), "not goods that can be swapped");
    assert_eq!(s.swap("wood", "stone", json!(1.5), Value::Null), "units must be a whole number");
    let x = s.place().x;
    s.p1_mut().x = x + 20.0;
    assert_eq!(s.swap5(), "not at a Trade Org warehouse or an NPC city\u{2019}s storage");
}

#[test]
fn swaps_nothing_with_a_realm_the_trade_organization_has_come_to_refuse() {
    let mut s = post();
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    assert_eq!(s.swap5(), "ack");
    change_standing(&mut s.world, TRADE_ORG, "r1", -1000.0);
    s.run();
    assert_eq!(s.p1().carried, stock(&[(Good::Wood, 20.0)]));
    assert_eq!(s.held(Good::Stone), 50.0);
}

// a swap with an NPC city

#[test]
fn swaps_its_surplus_for_what_it_is_short_of_at_its_prices() {
    let mut s = npc_city();
    let stone = s.reserve(Good::Stone);
    // Short of wood, with stone over its reserve and coins enough.
    *s.place_stock() =
        stock(&[(Good::Stone, stone + 20.0), (Good::Wood, 0.0), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let prices = npc_city_prices(&s.world, s.npc(), Some("r1"));
    assert!(prices.iter().find(|p| p.good == Good::Wood).unwrap().wanted > 0.0);
    assert_eq!(s.swap("wood", "stone", json!(2), Value::Null), "ack");
    s.run();
    assert_eq!(s.carried(Good::Stone), 2.0);
    assert!(s.carried(Good::Wood) < 20.0);
    assert_eq!(s.held(Good::Stone), stone + 18.0);
    let e = s.last_event();
    assert_eq!(e["kind"], "swapped");
    assert_eq!(e["place"], "storage");
    assert_eq!(e["units"], json!(2.0));
    assert!(standing_of(&s.world, "r1", "npc") > 0.0);
}

#[test]
fn raises_standing_both_ways_by_an_npc_citys_own_number_and_the_log_says_how_far() {
    let mut s = npc_city();
    let stone = s.reserve(Good::Stone);
    *s.place_stock() =
        stock(&[(Good::Stone, stone + 20.0), (Good::Wood, 0.0), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let carried = s.p1().carried.clone();
    let holder = TradeHolder { stock: &carried, room: 100.0 };
    let q = quote_npc_swap(
        &s.world,
        s.npc(),
        s.place(),
        holder,
        Good::Wood,
        Good::Stone,
        2.0,
        Some("r1"),
    );
    s.swap("wood", "stone", json!(2), Value::Null);
    s.run();
    let raised = (q.bought + q.sold) / STANDING_NPC_TRADE_COINS_PER_POINT;
    assert!(raised > 0.0);
    assert!((standing_of(&s.world, "npc", "r1") - raised).abs() < 0.005);
    assert!((standing_of(&s.world, "r1", "npc") - raised).abs() < 0.005);
    let e = s.last_event();
    assert_eq!(e["kind"], "swapped");
    let by = (raised * 100.0).round() / 100.0;
    assert_eq!(e["standing"], json!({ "org": "npc", "name": "Dunmere", "by": by }));
}

#[test]
fn refuses_a_good_it_isnt_short_of() {
    let mut s = npc_city();
    let (stone, wood) = (s.reserve(Good::Stone), s.reserve(Good::Wood));
    *s.place_stock() =
        stock(&[(Good::Stone, stone + 20.0), (Good::Wood, wood), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let answer = s.swap("wood", "stone", json!(2), Value::Null);
    assert_eq!(answer, "Dunmere isn\u{2019}t short of that good");
    assert_eq!(s.p1().order, None);
}

#[test]
fn refuses_to_part_with_what_it_has_no_surplus_of() {
    let mut s = npc_city();
    let stone = s.reserve(Good::Stone);
    *s.place_stock() = stock(&[(Good::Stone, stone), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let answer = s.swap("wood", "stone", json!(2), Value::Null);
    assert_eq!(answer, "Dunmere has none of that good to spare");
}

#[test]
fn is_cut_down_to_what_it_lacks_of_its_reserve_and_its_surplus_and_keeps_its_reserve() {
    let mut s = npc_city();
    let (stone, wood) = (s.reserve(Good::Stone), s.reserve(Good::Wood));
    // It lacks only so much wood of its reserve: that is all it takes.
    assert!(wood > 6.0);
    *s.place_stock() =
        stock(&[(Good::Stone, stone + 20.0), (Good::Wood, wood - 6.0), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let carried = s.p1().carried.clone();
    let holder = TradeHolder { stock: &carried, room: 1e6 };
    let q = quote_npc_swap(
        &s.world,
        s.npc(),
        s.place(),
        holder,
        Good::Wood,
        Good::Stone,
        20.0,
        Some("r1"),
    );
    assert_eq!(q.limit, Some(TradeLimit::Unwanted));
    assert_eq!(s.swap("wood", "stone", json!(20), Value::Null), "ack");
    s.run();
    assert!(s.carried(Good::Wood) >= 14.0);
    assert!(s.carried(Good::Stone) > 0.0);
    assert!(s.carried(Good::Stone) < 20.0);
    assert!(s.held(Good::Wood) <= wood);
    assert!(s.held(Good::Stone) >= stone);
    assert_eq!(s.scratch.trades.records.last().unwrap().kept_reserve, Some(true));
}

#[test]
fn moves_nothing_when_what_it_lacks_cant_pay_for_a_single_unit() {
    let mut s = npc_city();
    let (stone, wood) = (s.reserve(Good::Stone), s.reserve(Good::Wood));
    // One wood fetches less than one stone costs, and it takes no more than one.
    *s.place_stock() =
        stock(&[(Good::Stone, stone + 20.0), (Good::Wood, wood - 1.0), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    assert_eq!(s.swap("wood", "stone", json!(1), Value::Null), "ack");
    s.run();
    assert_eq!(s.p1().carried, stock(&[(Good::Wood, 20.0)]));
    let e = s.last_event();
    assert_eq!(e["kind"], "swapped");
    assert_eq!(
        (e["units"].as_f64(), e["gave"].as_f64(), e["wanted"].as_f64()),
        (Some(0.0), Some(0.0), Some(1.0))
    );
}

#[test]
fn swaps_nothing_once_it_refuses_the_realm() {
    let mut s = npc_city();
    let stone = s.reserve(Good::Stone);
    *s.place_stock() = stock(&[(Good::Stone, stone + 20.0), (Good::Coins, 500.0)]);
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    assert_eq!(s.swap("wood", "stone", json!(2), Value::Null), "ack");
    change_standing(&mut s.world, "npc", "r1", -1000.0);
    s.run();
    assert_eq!(s.p1().carried, stock(&[(Good::Wood, 20.0)]));
    let answer = s.swap("wood", "stone", json!(2), Value::Null);
    assert_eq!(answer, "Dunmere won\u{2019}t trade with you");
}

// an NPC city's rates

fn line(good: Good, for_sale: f64, wanted: f64, buy: f64, sell: f64) -> NpcCityPrice {
    NpcCityPrice { good, stock: 0.0, for_sale, wanted, buy, sell }
}

fn rate(give: Good, gives: f64, want: Good, units: f64) -> SwapRate {
    SwapRate { give, gives, want, units }
}

#[test]
fn sets_each_good_it_is_short_of_against_each_it_has_spare_in_small_whole_units() {
    let rates = npc_swap_rates(&[
        line(Good::Wood, 0.0, 9.0, 4.0, 6.0),
        line(Good::Iron, 0.0, 9.0, 20.0, 30.0),
        line(Good::Food, 10.0, 0.0, 1.0, 3.0),
        line(Good::Stone, 10.0, 0.0, 5.0, 9.0),
    ]);
    assert_eq!(
        rates,
        [
            // A wood fetches 4 and a food costs 3; a stone costs 9, so it takes 3 wood, rounded up.
            rate(Good::Wood, 1.0, Good::Food, 1.0),
            rate(Good::Wood, 3.0, Good::Stone, 1.0),
            // An iron fetches 20: that pays for 6 food or 2 stone.
            rate(Good::Iron, 1.0, Good::Food, 6.0),
            rate(Good::Iron, 1.0, Good::Stone, 2.0),
        ]
    );
}

#[test]
fn stays_within_what_it_has_spare_and_what_it_is_short_of() {
    // One iron would pay for 6 food, but it has only 2 to spare.
    let rates = npc_swap_rates(&[
        line(Good::Iron, 0.0, 9.0, 20.0, 30.0),
        line(Good::Food, 2.0, 0.0, 1.0, 3.0),
    ]);
    assert_eq!(rates, [rate(Good::Iron, 1.0, Good::Food, 2.0)]);
    // A stone takes 3 wood and it lacks only 2: no swap of them can go, so no rate.
    let rates = npc_swap_rates(&[
        line(Good::Wood, 0.0, 2.0, 4.0, 6.0),
        line(Good::Stone, 10.0, 0.0, 5.0, 9.0),
    ]);
    assert_eq!(rates, []);
    // Less than a whole unit either way is nothing to swap.
    let rates = npc_swap_rates(&[
        line(Good::Wood, 0.0, 0.5, 4.0, 6.0),
        line(Good::Food, 10.0, 0.0, 1.0, 3.0),
    ]);
    assert_eq!(rates, []);
    let rates = npc_swap_rates(&[
        line(Good::Wood, 0.0, 9.0, 4.0, 6.0),
        line(Good::Food, 0.5, 0.0, 1.0, 3.0),
    ]);
    assert_eq!(rates, []);
}

#[test]
fn has_none_when_nothing_is_spare_or_nothing_is_short() {
    let mut s = npc_city();
    let reserve = npc_reserve(&s.world, s.npc());
    let rates = |s: &Setup| npc_swap_rates(&npc_city_prices(&s.world, s.npc(), Some("r1")));
    // Holding nothing, it is short of everything it keeps and has nothing to spare.
    assert_eq!(rates(&s), []);
    // Exactly its reserve of everything, and a surplus of nothing.
    *s.place_stock() = reserve.clone();
    assert_eq!(rates(&s), []);
    // A surplus, with nothing it is short of.
    let mut more = reserve.clone();
    more.insert(Good::Stone, held(&reserve, Good::Stone) + 20.0);
    *s.place_stock() = more;
    assert_eq!(rates(&s), []);
}

#[test]
fn comes_from_its_stock_and_goes_as_a_swap_does_keeping_nothing_new() {
    let mut s = npc_city();
    let reserve = npc_reserve(&s.world, s.npc());
    // At its reserve of everything but wood, which it is short of, and stone, which it has spare.
    let mut at = reserve.clone();
    at.insert(Good::Wood, 0.0);
    at.insert(Good::Stone, held(&reserve, Good::Stone) + 20.0);
    at.insert(Good::Coins, 500.0);
    *s.place_stock() = at;
    let before = s.world.clone();
    let prices = npc_city_prices(&s.world, s.npc(), Some("r1"));
    let rates = npc_swap_rates(&prices);
    assert_eq!(s.world, before);
    // Wood is all it is short of. Holding its weapons, it needs less iron too, so that is spare.
    assert!(rates.iter().all(|r| r.give == Good::Wood), "{rates:?}");
    let rate = rates.iter().find(|r| r.want == Good::Stone).expect("a rate for stone");
    let wood = prices.iter().find(|p| p.good == Good::Wood).unwrap();
    let stone = prices.iter().find(|p| p.good == Good::Stone).unwrap();
    assert!(rate.gives * wood.buy >= rate.units * stone.sell);
    let load = stock(&[(Good::Wood, 100.0)]);
    let holder = TradeHolder { stock: &load, room: 1e6 };
    let quote = quote_npc_swap(
        &s.world,
        s.npc(),
        s.place(),
        holder,
        Good::Wood,
        Good::Stone,
        rate.units,
        Some("r1"),
    );
    assert_eq!(quote.units, rate.units);
    assert!(quote.gives >= rate.gives);
}

// a swap keeps every good (ADR 0004)

#[test]
fn creates_and_loses_nothing_and_the_invariant_catches_a_swap_that_does() {
    let mut s = post();
    s.set_carried(stock(&[(Good::Wood, 20.0)]));
    let coins_before = s.held(Good::Coins);
    s.swap5();
    s.run();
    assert_eq!(trades_keep_goods(&s.scratch.trades), []);
    let total = |s: &Setup, g: Good| s.carried(g) + s.held(g);
    assert_eq!(total(&s, Good::Wood), 70.0);
    assert_eq!(total(&s, Good::Stone), 50.0);
    assert_eq!(total(&s, Good::Coins), coins_before);
    let record = s.scratch.trades.records.last_mut().unwrap();
    let stone = held(&record.after, Good::Stone);
    record.after.insert(Good::Stone, stone + 1.0);
    let broken: Vec<String> =
        trades_keep_goods(&s.scratch.trades).into_iter().map(|v| v.invariant).collect();
    assert_eq!(broken, ["trades-keep-goods"]);
}
