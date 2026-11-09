//! `apps/server/src/trader-stops.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, CARAVAN_ESCORTS, CARAVAN_FOOD, NPC_VILLAGE, TRADER_STOP_REACH,
};
use csp_shared::footprint::covers;
use csp_shared::world::{Good, Heading, HorseStats, Stock, TradeSide, WorldState};

use super::*;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::queries::carriages::crew_ids_of;
use crate::queries::names::{held, held_in};
use crate::queries::trade_quotes::{quote_trader_trade, trader_standing_at};
use crate::queries::trader_trade::{trader_price_for, trader_prices, trader_stock};
use crate::queries::warehouse_trade::{TradeHolder, TradeLimit};
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::starting_city::found_starting_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::traders::{place_traders, step_traders};
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

pub(crate) struct Fixture {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub hq: String,
    pub post: String,
}

/// The Trade Org HQ and one trading post far apart, with one trader, out and bound for the post.
pub(crate) fn fixture() -> Fixture {
    let terrain = plains(2048);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut world, &terrain, 100, 500, &mut || m.next());
    let post = found_trading_post(&mut world, &terrain, 700, 500, None, &mut || m.next());
    place_traders(&mut world, terrain.size);
    for h in &mut world.horses {
        h.stats = HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        };
    }
    world.traders[0].heading = Heading::Post;
    world.traders[0].post_id = post.clone();
    Fixture { world, terrain, hq, post }
}

pub(crate) fn carriage_of(world: &WorldState, t: usize) -> usize {
    world.carriages.iter().position(|k| k.id == world.traders[t].carriage_id).unwrap()
}

pub(crate) fn crew_of(world: &WorldState, t: usize) -> Vec<usize> {
    let tr = &world.traders[t];
    crew_ids_of(tr.driver_id.as_deref(), &tr.escort_ids)
        .iter()
        .map(|id| world.residents.iter().position(|r| &r.id == id).unwrap())
        .collect()
}

/// Stands a trader's carriage, its hitched horse and its crew on tile (x, y).
pub(crate) fn put(world: &mut WorldState, t: usize, x: f64, y: f64) {
    let ki = carriage_of(world, t);
    world.carriages[ki].x = x;
    world.carriages[ki].y = y;
    let horse = world.carriages[ki].horse_id.clone();
    if let Some(h) = world.horses.iter_mut().find(|h| Some(&h.id) == horse.as_ref()) {
        h.x = x;
        h.y = y;
    }
    for ri in crew_of(world, t) {
        let r = &mut world.residents[ri];
        r.x = x;
        r.y = y;
        r.order = None;
    }
}

/// Stands a trader at a stop by `city`, with `ticks` left there.
pub(crate) fn stand_at(world: &mut WorldState, t: usize, city: &str, x: f64, y: f64, ticks: f64) {
    put(world, t, x, y);
    let until = world.tick as f64 + ticks;
    let tr = &mut world.traders[t];
    tr.calls = Some(Vec::new());
    tr.stand = Some(TraderStand { city_id: city.into(), x, y, until: Some(until) });
}

pub(crate) fn resident(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id: None, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

pub(crate) fn run_until(
    world: &mut WorldState,
    terrain: &TerrainMap,
    done: &dyn Fn(&WorldState) -> bool,
    ticks: usize,
) {
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        if done(world) {
            break;
        }
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
    }
    assert!(done(world));
}

fn village(world: &mut WorldState, terrain: &TerrainMap, x: i32, y: i32, seed: f64) -> String {
    let mut m = Mulberry32::new(seed);
    found_npc_city(world, terrain, &NPC_VILLAGE, x, y, &mut || m.next(), None)
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

// which cities a wandering trader stops at

#[test]
fn those_within_reach_of_its_way_in_the_order_it_passes_them_not_the_rest() {
    let Fixture { mut world, terrain, .. } = fixture();
    let mut m = Mulberry32::new(9.0);
    let mut found = |world: &mut WorldState, x: i32, y: i32| {
        found_npc_city(world, &terrain, &NPC_VILLAGE, x, y, &mut || m.next(), None)
    };
    let reach = TRADER_STOP_REACH as i32;
    let near = found(&mut world, 500, 500 + reach - 40);
    let nearer = found(&mut world, 300, 500 - 60);
    let far = found(&mut world, 500, 500 - reach - 80);
    let behind = found(&mut world, 900, 500);
    let calls = calls_on_the_way(&world, (100.0, 500.0), (700.0, 500.0), terrain.size);
    assert_eq!(calls, vec![nearer, near]);
    assert!(!calls.contains(&far));
    assert!(!calls.contains(&behind));
}

#[test]
fn never_the_trade_organizations_which_are_stops_of_their_own_and_none_on_no_way_at_all() {
    let Fixture { mut world, terrain, hq, post } = fixture();
    let calls = calls_on_the_way(&world, (100.0, 500.0), (700.0, 500.0), terrain.size);
    assert!(!calls.contains(&hq) && !calls.contains(&post));
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    assert!(calls_on_the_way(&world, (300.0, 500.0), (302.0, 500.0), terrain.size).is_empty());
    assert_eq!(calls_on_the_way(&world, (100.0, 500.0), (700.0, 500.0), terrain.size), vec![c]);
}

#[test]
fn a_players_too_and_it_reckons_across_the_maps_joins() {
    let Fixture { mut world, terrain, .. } = fixture();
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    let c = world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm)).unwrap().clone();
    let hall = town_hall_of(&world, &c).unwrap();
    let from = ((hall.x + 2000.0) % 2048.0, hall.y);
    let to = ((hall.x + 50.0) % 2048.0, hall.y);
    assert!(calls_on_the_way(&world, from, to, terrain.size).contains(&c.id));
}

// where a wandering trader stands at a city

#[test]
fn beside_the_town_hall_on_a_free_tile_on_the_side_it_comes_from() {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 300, 9.0);
    world.buildings.retain(|b| {
        b.city_id.as_ref() != Some(&c) || !matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
    });
    let hall = town_hall_of(&world, city(&world, &c)).unwrap();
    let (hx, hy) = (hall.x as i32, hall.y as i32);
    let (x, y) = stop_tile(&world, &terrain, city(&world, &c), (0.0, f64::from(hy))).unwrap();
    assert!(!world
        .buildings
        .iter()
        .any(|b| b.kind != BuildingKind::Road && covers(placed(b), x, y, terrain.size)));
    assert!(wrap_distance(terrain.size, (x, y), (hx + 1, hy + 1)) < 12.0);
}

#[test]
fn outside_any_ring_of_walls_so_a_closed_gate_doesnt_stop_it() {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    let gates: Vec<String> = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_ref() == Some(&c) && b.kind == BuildingKind::Gate)
        .map(|b| b.id.clone())
        .collect();
    assert!(!gates.is_empty());
    for b in &mut world.buildings {
        if gates.contains(&b.id) {
            b.closed = Some(true);
        }
    }
    let hall = town_hall_of(&world, city(&world, &c)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let inside = wall_map(&world, &terrain).inside;
    let home = crate::npc_behaviour::npc_home(&world, &c).unwrap();
    assert!(inside.contains(&tile_index(terrain.size, home.x as i32, home.y as i32)));
    let (x, y) = stop_tile(&world, &terrain, city(&world, &c), (100.0, 500.0)).unwrap();
    assert!(!inside.contains(&tile_index(terrain.size, x, y)));
    // And it gets there with its armed escort, the city shutting its gates against them.
    put(&mut world, 0, hx - 25.0, hy);
    for ri in crew_of(&world, 0) {
        world.residents[ri].carried = Stock::from([(Good::Spear, 1.0)]);
    }
    world.traders[0].calls = Some(vec![c.clone()]);
    run_until(
        &mut world,
        &terrain,
        &|w| w.traders[0].stand.as_ref().is_some_and(|s| s.until.is_some()),
        4000,
    );
    let s = world.traders[0].stand.clone().unwrap();
    assert_eq!(
        trader_standing_at(&world, s.x, s.y).map(|t| t.id.clone()),
        Some(world.traders[0].id.clone())
    );
    assert!(world
        .buildings
        .iter()
        .filter(|b| gates.contains(&b.id))
        .all(|g| g.closed == Some(true)));
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn not_on_a_tile_another_trader_stands_on_or_is_bound_for() {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 300, 9.0);
    let first = stop_tile(&world, &terrain, city(&world, &c), (0.0, 300.0)).unwrap();
    world.traders[0].stand = Some(TraderStand {
        city_id: c.clone(),
        x: f64::from(first.0),
        y: f64::from(first.1),
        until: None,
    });
    assert_ne!(stop_tile(&world, &terrain, city(&world, &c), (0.0, 300.0)), Some(first));
}

// a wandering trader on its way

#[test]
fn stops_at_a_city_on_its_way_for_its_time_then_goes_on_to_the_post() {
    let Fixture { mut world, terrain, post, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    put(&mut world, 0, 270.0, 500.0);
    let ki = carriage_of(&world, 0);
    world.carriages[ki].load = Stock::from([(Good::Food, CARAVAN_FOOD)]);
    world.traders[0].calls = None;
    run_until(
        &mut world,
        &terrain,
        &|w| w.traders[0].stand.as_ref().is_some_and(|s| s.until.is_some()),
        4000,
    );
    let s = world.traders[0].stand.clone().unwrap();
    assert_eq!(s.city_id, c);
    let at = (world.carriages[ki].x, world.carriages[ki].y);
    assert_eq!(at, (s.x, s.y));
    assert!(s.until.unwrap() >= world.tick as f64 + TRADER_STOP_TICKS - 1.0);
    // It stands there with its time left, here cut short so the test needn't wait a game day.
    let until = world.tick as f64 + 30.0;
    world.traders[0].stand.as_mut().unwrap().until = Some(until);
    run_until(&mut world, &terrain, &|w| w.tick as f64 >= until - 1.0, 4000);
    assert_eq!((world.carriages[ki].x, world.carriages[ki].y), at);
    assert!(trader_standing_at(&world, at.0, at.1).is_some());
    // And goes on when it is up, and no trade can be made with it.
    run_until(&mut world, &terrain, &|w| w.traders[0].stand.is_none(), 4000);
    assert!(trader_standing_at(&world, at.0, at.1).is_none());
    run_until(
        &mut world,
        &terrain,
        &|w| {
            let k = &w.carriages[ki];
            (k.x, k.y) != at
        },
        100,
    );
    assert_eq!(world.traders[0].post_id, post);
    assert_eq!(world.traders[0].calls, Some(vec![]));
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn works_out_the_cities_anew_on_each_way() {
    let Fixture { mut world, terrain, post, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    put(&mut world, 0, 200.0, 500.0);
    world.traders[0].calls = None;
    step_traders(&mut world, terrain.size, Some(&terrain));
    assert_eq!(world.traders[0].stand.as_ref().map(|s| s.city_id.clone()), Some(c));
    assert_eq!(world.traders[0].post_id, post);
}

#[test]
fn makes_no_stops_without_terrain_to_look_for_a_tile_on_as_a_test_of_the_loop_alone() {
    let Fixture { mut world, terrain, .. } = fixture();
    village(&mut world, &terrain, 300, 500, 9.0);
    put(&mut world, 0, 200.0, 500.0);
    world.traders[0].calls = None;
    step_traders(&mut world, terrain.size, None);
    assert_eq!(world.traders[0].stand, None);
}

#[test]
fn passes_a_city_by_whose_tile_it_cant_reach_so_one_cant_hold_up_the_loop() {
    let Fixture { mut world, terrain, post, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    put(&mut world, 0, 200.0, 500.0);
    let t = &mut world.traders[0];
    t.stand = Some(TraderStand { city_id: c, x: 310.0, y: 510.0, until: None });
    t.calls = Some(Vec::new());
    t.misses = TRADER_DRIVE_TRIES;
    step_traders(&mut world, terrain.size, Some(&terrain));
    assert_eq!(world.traders[0].stand, None);
    assert_eq!(world.traders[0].misses, 1.0);
    assert_eq!(world.traders[0].post_id, post);
}

#[test]
fn passes_by_a_city_with_no_town_hall_left_and_leaves_one_that_lost_it() {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    put(&mut world, 0, 200.0, 500.0);
    world.traders[0].calls = Some(vec![c.clone()]);
    world.buildings.retain(|b| b.kind != BuildingKind::TownHall || b.city_id.as_ref() != Some(&c));
    step_traders(&mut world, terrain.size, Some(&terrain));
    assert_eq!(world.traders[0].stand, None);
    assert_eq!(world.traders[0].calls, Some(vec![]));
    let until = world.tick as f64 + 100.0;
    world.traders[0].stand =
        Some(TraderStand { city_id: c, x: 200.0, y: 500.0, until: Some(until) });
    world.traders[0].calls = Some(Vec::new());
    put(&mut world, 0, 200.0, 500.0);
    step_traders(&mut world, terrain.size, Some(&terrain));
    assert_eq!(world.traders[0].stand, None);
}

#[test]
fn stolen_it_starts_over_at_the_hq_with_no_stop_to_make() {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    stand_at(&mut world, 0, &c, 290.0, 490.0, 500.0);
    resident(&mut world, "thief", Some("r1"), 290.0, 490.0);
    let ki = carriage_of(&world, 0);
    crate::movement_pending::take_over(
        &mut world,
        "thief",
        "r1",
        crate::movement_pending::Taken { carriage: Some(ki), horse: None },
        terrain.size,
    );
    let t = &world.traders[0];
    assert_eq!(t.stand, None);
    assert_eq!(t.calls, None);
    assert_eq!(t.heading, Heading::Hq);
}

// a wandering trader's prices

fn escorts() -> usize {
    CARAVAN_ESCORTS as usize
}

#[test]
fn come_from_what_it_carries_buying_lower_than_it_sells_rising_as_it_holds_less() {
    let Fixture { mut world, .. } = fixture();
    let ki = carriage_of(&world, 0);
    world.carriages[ki].load = Stock::from([(Good::Wood, 40.0), (Good::Stone, 2.0)]);
    let prices = trader_prices(&world.traders[0], &world.carriages[ki]);
    let wood = prices.iter().find(|p| p.good == Good::Wood).unwrap();
    let stone = prices.iter().find(|p| p.good == Good::Stone).unwrap();
    assert_eq!(wood.stock, 40.0);
    assert!(wood.buy < wood.sell);
    assert!(stone.sell > wood.sell);
    assert!(!prices.iter().any(|p| p.good == Good::Coins));
    let want = trader_price_for(Good::Wood, 40.0);
    assert_eq!((wood.buy, wood.sell), (want.buy, want.sell));
}

#[test]
fn leave_out_the_food_its_crew_keep_on_board() {
    let food = |n: f64| held(&trader_stock(escorts(), &Stock::from([(Good::Food, n)])), Good::Food);
    assert_eq!(food(CARAVAN_FOOD + 5.0), 5.0);
    assert_eq!(food(1.0), 0.0);
}

#[test]
fn moves_the_price_as_a_trade_goes_cut_down_to_what_it_holds_and_its_coins() {
    let load = Stock::from([(Good::Wood, 3.0), (Good::Coins, 10.0)]);
    let coins = Stock::from([(Good::Coins, 1_000.0)]);
    let hands = TradeHolder { stock: &coins, room: 100.0 };
    let buy = quote_trader_trade(escorts(), &load, 400.0, hands, TradeSide::Buy, Good::Wood, 10.0);
    assert_eq!(buy.units, 3.0);
    assert_eq!(buy.limit, Some(TradeLimit::Stock));
    let sum: f64 = [3.0, 2.0, 1.0].iter().map(|&n| trader_price_for(Good::Wood, n).sell).sum();
    assert_eq!(buy.coins, sum);
    let wood = Stock::from([(Good::Wood, 100.0)]);
    let selling = TradeHolder { stock: &wood, room: 100.0 };
    let sell =
        quote_trader_trade(escorts(), &load, 400.0, selling, TradeSide::Sell, Good::Wood, 100.0);
    assert_eq!(sell.limit, Some(TradeLimit::TheirCoins));
    assert!(sell.coins <= 10.0);
}

#[test]
fn takes_goods_only_as_far_as_its_carriage_holds() {
    let load = Stock::from([(Good::Stone, 395.0), (Good::Coins, 100.0)]);
    let wood = Stock::from([(Good::Wood, 100.0)]);
    let selling = TradeHolder { stock: &wood, room: 100.0 };
    let sell =
        quote_trader_trade(escorts(), &load, 400.0, selling, TradeSide::Sell, Good::Wood, 100.0);
    assert_eq!(sell.limit, Some(TradeLimit::TheirRoom));
    assert!(sell.units > 0.0 && sell.units < 10.0);
    // An overloaded carriage may still sell.
    let full = Stock::from([(Good::Stone, 500.0), (Good::Coins, 0.0)]);
    let coins = Stock::from([(Good::Coins, 100.0)]);
    let hands = TradeHolder { stock: &coins, room: 100.0 };
    let buy = quote_trader_trade(escorts(), &full, 400.0, hands, TradeSide::Buy, Good::Stone, 2.0);
    assert_eq!(buy.units, 2.0);
}

#[test]
fn sells_none_of_the_food_on_board() {
    let load = Stock::from([(Good::Food, CARAVAN_FOOD + 2.0)]);
    let coins = Stock::from([(Good::Coins, 1_000.0)]);
    let hands = TradeHolder { stock: &coins, room: 100.0 };
    let buy = quote_trader_trade(escorts(), &load, 400.0, hands, TradeSide::Buy, Good::Food, 50.0);
    assert_eq!(buy.units, 2.0);
}

// trading with a wandering trader at a stop

struct AtStop {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    queue: crate::orders::OrderQueue,
}

/// A trader standing by an NPC village, and p1 of r1 on its tile.
fn at_stop() -> AtStop {
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    world.realms.push(
        serde_json::from_value(serde_json::json!({ "id": "r1", "userId": 7, "leaderId": "a1" }))
            .unwrap(),
    );
    resident(&mut world, "a1", Some("r1"), 900.0, 900.0);
    resident(&mut world, "p1", Some("r1"), 290.0, 490.0);
    stand_at(&mut world, 0, &c, 290.0, 490.0, 500.0);
    let ki = carriage_of(&world, 0);
    world.carriages[ki].load =
        Stock::from([(Good::Food, CARAVAN_FOOD), (Good::Wood, 40.0), (Good::Coins, 200.0)]);
    let queue = crate::orders::OrderQueue::new(
        crate::orders::order_kinds(),
        Some(Arc::new(terrain.clone())),
    );
    AtStop { world, terrain, city: c, queue }
}

fn p1(world: &mut WorldState) -> &mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == "p1").unwrap()
}

fn step_once(s: &mut AtStop) {
    for r in &mut s.world.residents {
        r.hunger = 100.0;
    }
    let mut scratch = Scratch::default();
    step_world(&mut s.world, &s.terrain, &mut scratch, None, None);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

fn order(s: &mut AtStop, mut o: serde_json::Value) -> String {
    o["residentId"] = serde_json::json!("p1");
    let sender = crate::order_sender::OrderSender::player(7, "Mara");
    let answer = s.queue.receive(&s.world, &sender, &serde_json::json!("q"), &o);
    s.queue.apply_all(&mut s.world);
    match answer {
        crate::orders::OrderReply::Ack { .. } => "ack".into(),
        crate::orders::OrderReply::Rejected { reason, .. } => reason,
    }
}

fn load(s: &AtStop) -> Stock {
    s.world.carriages[carriage_of(&s.world, 0)].load.clone()
}

fn trade_org() -> &'static str {
    crate::queries::standing::TRADE_ORG
}

#[test]
fn buys_goods_from_its_load_into_their_hands_coins_the_other_way_with_standing() {
    let mut s = at_stop();
    p1(&mut s.world).carried = Stock::from([(Good::Coins, 100.0)]);
    let price = trader_price_for(Good::Wood, 40.0).sell + trader_price_for(Good::Wood, 39.0).sell;
    let o = serde_json::json!({ "kind": "buy", "good": "wood", "units": 2 });
    assert_eq!(order(&mut s, o), "ack");
    step_once(&mut s);
    let carried = p1(&mut s.world).carried.clone();
    assert_eq!(held(&carried, Good::Wood), 2.0);
    assert_eq!(held(&carried, Good::Coins), 100.0 - price);
    let l = load(&s);
    assert_eq!(held(&l, Good::Food), CARAVAN_FOOD);
    assert_eq!(held(&l, Good::Wood), 38.0);
    assert_eq!(held(&l, Good::Coins), 200.0 + price);
    assert!(crate::queries::standing::standing_of(&s.world, "r1", trade_org()) > 0.0);
    let traded = s.world.events.iter().find_map(|e| match &e.what {
        csp_shared::world::RealmEventWhat::Traded { with_trader, units, side, .. } => {
            Some((*with_trader, *units, *side))
        }
        _ => None,
    });
    assert_eq!(traded, Some((Some(true), 2.0, TradeSide::Buy)));
}

#[test]
fn sells_goods_onto_its_carriage_its_coins_into_their_hands() {
    let mut s = at_stop();
    p1(&mut s.world).carried = Stock::from([(Good::Iron, 2.0)]);
    let o = serde_json::json!({ "kind": "sell", "good": "iron", "units": 2 });
    assert_eq!(order(&mut s, o), "ack");
    step_once(&mut s);
    let carried = p1(&mut s.world).carried.clone();
    assert!(!carried.contains_key(&Good::Iron));
    assert_eq!(held(&load(&s), Good::Iron), 2.0);
    assert!(held(&carried, Good::Coins) > 0.0);
    assert_eq!(held(&load(&s), Good::Coins) + held(&carried, Good::Coins), 200.0);
}

#[test]
fn trades_from_a_carriage_of_theirs_on_the_tile_instead_of_their_hands() {
    let mut s = at_stop();
    s.world.carriages.push(
        serde_json::from_value(serde_json::json!({
            "id": "own", "realmId": "r1", "cityId": null, "x": 290, "y": 490, "horseId": null,
            "load": { "coins": 100 },
        }))
        .unwrap(),
    );
    let o = serde_json::json!({ "kind": "buy", "good": "wood", "units": 1, "carriageId": "own" });
    assert_eq!(order(&mut s, o), "ack");
    step_once(&mut s);
    let own = s.world.carriages.iter().find(|k| k.id == "own").unwrap();
    assert_eq!(held(&own.load, Good::Wood), 1.0);
    assert_eq!(held(&load(&s), Good::Wood), 39.0);
}

#[test]
fn refuses_one_not_on_its_tile_a_delivery_and_those_the_trade_organization_refuses() {
    let mut s = at_stop();
    p1(&mut s.world).carried = Stock::from([(Good::Coins, 100.0)]);
    p1(&mut s.world).x += 1.0;
    let buy = serde_json::json!({ "kind": "buy", "good": "wood", "units": 1 });
    assert_eq!(order(&mut s, buy.clone()), "not at a Trade Org warehouse");
    p1(&mut s.world).x -= 1.0;
    let delivery = serde_json::json!({ "kind": "buy", "good": "wood", "units": 1, "cityId": "c" });
    assert_eq!(order(&mut s, delivery), "a wandering trader delivers nothing");
    let coins = serde_json::json!({ "kind": "buy", "good": "coins", "units": 1 });
    assert_eq!(order(&mut s, coins), "not a good traders trade");
    s.world.standings.push(
        serde_json::from_value(
            serde_json::json!({ "of": trade_org(), "toward": "r1", "value": -100 }),
        )
        .unwrap(),
    );
    let answer = order(&mut s, buy);
    assert!(answer.contains("won\u{2019}t trade"), "{answer}");
}

#[test]
fn doesnt_trade_before_it_stands_there_nor_once_it_goes_on() {
    let mut s = at_stop();
    p1(&mut s.world).carried = Stock::from([(Good::Coins, 100.0)]);
    let buy = serde_json::json!({ "kind": "buy", "good": "wood", "units": 1 });
    s.world.traders[0].stand.as_mut().unwrap().until = None;
    assert_eq!(order(&mut s, buy.clone()), "not at a Trade Org warehouse");
    let tick = s.world.tick as f64;
    s.world.traders[0].stand.as_mut().unwrap().until = Some(tick);
    assert_eq!(order(&mut s, buy), "not at a Trade Org warehouse");
    // Nor with its crew gone.
    s.world.traders[0].stand.as_mut().unwrap().until = Some(tick + 10.0);
    s.world.traders[0].driver_id = None;
    assert!(trader_standing_at(&s.world, 290.0, 490.0).is_none());
}

#[test]
fn sells_none_of_the_food_on_board_and_the_invariant_catches_one_that_did() {
    let mut s = at_stop();
    p1(&mut s.world).carried = Stock::from([(Good::Coins, 500.0)]);
    let o = serde_json::json!({ "kind": "buy", "good": "food", "units": 5 });
    assert_eq!(order(&mut s, o), "ack");
    step_once(&mut s);
    assert_eq!(held(&load(&s), Good::Food), CARAVAN_FOOD);
    assert!(!p1(&mut s.world).carried.contains_key(&Good::Food));
    let mut ledger = crate::trading::TradeLedger::default();
    ledger.records.push(crate::trading::TradeRecord {
        resident_id: "p1".into(),
        realm: Some("r1".into()),
        refused: false,
        before: Stock::new(),
        after: Stock::new(),
        npc_city_id: None,
        kept_reserve: None,
        trader_id: Some("x".into()),
        kept_food: Some(false),
        horse_id: None,
        kept_pair: None,
        wanted: None,
    });
    assert_eq!(crate::trading::trader_trades_keep_food(&ledger).len(), 1);
}

#[test]
fn tells_the_realm_while_one_stands_at_one_of_its_cities_wherever_it_is() {
    use crate::queries::trader_trade::trader_visits_to;
    let mut s = at_stop();
    s.world.realms.push(
        serde_json::from_value(serde_json::json!({ "id": "r2", "userId": 8, "leaderId": "a2" }))
            .unwrap(),
    );
    resident(&mut s.world, "a2", Some("r2"), 900.0, 910.0);
    assert!(trader_visits_to(&s.world, "r1").is_empty());
    let c = s.city.clone();
    s.world.cities.iter_mut().find(|x| x.id == c).unwrap().realm_id = Some("r1".into());
    let visits = trader_visits_to(&s.world, "r1");
    assert_eq!(visits.len(), 1);
    let v = &visits[0];
    let t = &s.world.traders[0];
    assert_eq!(v.trader_id, t.id);
    assert_eq!(v.city_id, c);
    assert_eq!(v.city, city(&s.world, &c).name);
    assert_eq!((v.x, v.y), (290.0, 490.0));
    assert_eq!(Some(v.until), t.stand.as_ref().unwrap().until);
    assert!(trader_visits_to(&s.world, "r2").is_empty());
    // A capture changes whom it tells.
    crate::capture::capture_city(&mut s.world, &c, "r2", s.terrain.size);
    assert!(trader_visits_to(&s.world, "r1").is_empty());
    assert_eq!(trader_visits_to(&s.world, "r2").len(), 1);
}

#[test]
fn names_its_prices_to_those_in_sight_what_it_holds_only_to_those_on_its_tile() {
    use crate::sight::{entities_in_sight, sent_inside_unseen};
    use crate::world_index::WorldIndex;
    use csp_shared::protocol::SeenEntity;
    let mut s = at_stop();
    s.world.realms.push(
        serde_json::from_value(serde_json::json!({ "id": "r3", "userId": 9, "leaderId": "b1" }))
            .unwrap(),
    );
    resident(&mut s.world, "b1", Some("r3"), 300.0, 495.0);
    let tid = s.world.traders[0].id.clone();
    let size = s.terrain.size;
    let seen = |w: &WorldState, realm: &str| {
        let index = WorldIndex::new(w, size);
        entities_in_sight(w, &index, Some(realm), None)
            .iter()
            .find(|e| matches!(e, SeenEntity::Trader(t) if t.id == tid))
            .cloned()
    };
    let wood = |t: &csp_shared::protocol::SeenTrader| {
        t.prices.as_ref().and_then(|p| p.iter().find(|l| l.good == Good::Wood).map(|l| l.stock))
    };
    let here = seen(&s.world, "r1").unwrap();
    let SeenEntity::Trader(h) = &here else { unreachable!() };
    assert_eq!(h.standing.as_ref().map(|s| (s.x, s.y)), Some((290.0, 490.0)));
    assert_eq!(wood(h), Some(Some(40.0)));
    let there = seen(&s.world, "r3").unwrap();
    let SeenEntity::Trader(th) = &there else { unreachable!() };
    assert_eq!(wood(th), Some(None));
    assert!(th.prices.as_ref().is_some_and(|p| !p.is_empty()));
    let index = WorldIndex::new(&s.world, size);
    assert_eq!(sent_inside_unseen(&s.world, &index, "r3", std::slice::from_ref(&there)), vec![]);
    // Sent what only those on its tile may see, the invariant catches it.
    assert_eq!(sent_inside_unseen(&s.world, &index, "r3", std::slice::from_ref(&here)).len(), 1);
    // On the way it names none.
    s.world.traders[0].stand = None;
    let SeenEntity::Trader(gone) = seen(&s.world, "r1").unwrap() else { unreachable!() };
    assert!(gone.prices.is_none() && gone.standing.is_none());
}

// an NPC city and its visiting trader

struct Visited {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    tile: (i32, i32),
}

/// A village with a surplus of Wood, short of Iron, and a trader standing at it.
fn visited(extra: &[(Good, f64)]) -> Visited {
    use crate::queries::npc_trade::npc_reserve;
    let Fixture { mut world, terrain, .. } = fixture();
    let c = village(&mut world, &terrain, 300, 500, 9.0);
    let storage = crate::npc_behaviour::npc_home(&world, &c).unwrap().id.clone();
    let si = world.buildings.iter().position(|b| b.id == storage).unwrap();
    world.buildings[si].stock = Some(Stock::new());
    let reserve = npc_reserve(&world, city(&world, &c));
    world.buildings[si].stock = Some(Stock::from([
        (Good::Food, held(&reserve, Good::Food) + 5.0),
        (Good::Wood, held(&reserve, Good::Wood) + 30.0),
        (Good::Stone, held(&reserve, Good::Stone)),
        (Good::Coins, held(&reserve, Good::Coins)),
    ]));
    let ki = carriage_of(&world, 0);
    let mut l = Stock::from([(Good::Food, CARAVAN_FOOD), (Good::Iron, 20.0), (Good::Coins, 500.0)]);
    for &(g, n) in extra {
        l.insert(g, n);
    }
    world.carriages[ki].load = l;
    let hall = town_hall_of(&world, city(&world, &c)).unwrap();
    let from = (hall.x - 100.0, hall.y);
    let tile = stop_tile(&world, &terrain, city(&world, &c), from).unwrap();
    stand_at(&mut world, 0, &c, f64::from(tile.0), f64::from(tile.1), TRADER_STOP_TICKS);
    Visited { world, terrain, city: c, storage, tile }
}

fn plan(v: &mut Visited) {
    crate::npc_plan::plan_city(&mut v.world, &v.city, Some(&v.terrain), None, None);
}

fn sent(world: &WorldState, c: &str) -> Option<csp_shared::world::CityTrader> {
    world.city_plans.get(c).and_then(|p| p.traders.as_ref()).and_then(|t| t.first().cloned())
}

fn city_stock(world: &WorldState, c: &str, g: Good) -> f64 {
    held(&crate::queries::npc_trade::npc_city_stock(world, city(world, c)), g)
}

fn set_storage(v: &mut Visited, stock: Stock) {
    let si = v.world.buildings.iter().position(|b| b.id == v.storage).unwrap();
    v.world.buildings[si].stock = Some(stock);
}

#[test]
fn sends_a_spare_hand_never_a_soldier_who_sells_its_surplus_and_buys_what_it_is_short_of() {
    let mut v = visited(&[]);
    plan(&mut v);
    let run = sent(&v.world, &v.city).unwrap();
    assert_eq!(run.visiting_id.as_ref(), Some(&v.world.traders[0].id));
    assert_eq!(run.warehouse_id, None);
    assert!(held(&run.sells, Good::Wood) > 0.0);
    assert!(held(&run.buys, Good::Iron) > 0.0);
    let hand = v.world.residents.iter().find(|r| r.id == run.resident_id).unwrap();
    assert!(!crate::queries::residents::is_armed(&hand.carried));
    let ki = carriage_of(&v.world, 0);
    let wood_before = city_stock(&v.world, &v.city, Good::Wood);
    let load_before = held(&v.world.carriages[ki].load, Good::Wood);
    let c = v.city.clone();
    let more_wood = move |w: &WorldState| held(&w.carriages[ki].load, Good::Wood) > load_before;
    run_until(&mut v.world, &v.terrain, &more_wood, 4000);
    let less_iron = move |w: &WorldState| held(&w.carriages[ki].load, Good::Iron) < 20.0;
    run_until(&mut v.world, &v.terrain, &less_iron, 4000);
    run_until(&mut v.world, &v.terrain, &|w| city_stock(w, &c, Good::Iron) > 0.0, 4000);
    assert!(city_stock(&v.world, &v.city, Good::Wood) < wood_before);
    assert_eq!(check_all(&v.world, &v.terrain), vec![]);
}

#[test]
fn counts_the_crew_as_nobody_to_fear_though_they_are_armed() {
    let mut v = visited(&[]);
    for ri in crew_of(&v.world, 0) {
        v.world.residents[ri].carried = Stock::from([(Good::Spear, 1.0)]);
    }
    plan(&mut v);
    let visiting = sent(&v.world, &v.city).and_then(|r| r.visiting_id);
    assert_eq!(visiting, Some(v.world.traders[0].id.clone()));
}

#[test]
fn sends_nobody_with_another_armed_outsider_in_its_area() {
    let mut v = visited(&[]);
    let (x, y) = (f64::from(v.tile.0), f64::from(v.tile.1));
    let raider = resident(&mut v.world, "raider", Some("r9"), x, y);
    v.world.residents[raider].carried = Stock::from([(Good::Spear, 1.0)]);
    plan(&mut v);
    assert_eq!(sent(&v.world, &v.city).and_then(|r| r.visiting_id), None);
}

#[test]
fn makes_no_deal_when_there_is_none_to_make() {
    let mut v = visited(&[(Good::Iron, 0.0), (Good::Coins, 0.0)]);
    let reserve = crate::queries::npc_trade::npc_reserve(&v.world, city(&v.world, &v.city));
    set_storage(&mut v, reserve);
    let ki = carriage_of(&v.world, 0);
    v.world.carriages[ki].load = Stock::from([(Good::Food, CARAVAN_FOOD)]);
    plan(&mut v);
    assert_eq!(sent(&v.world, &v.city).and_then(|r| r.visiting_id), None);
}

#[test]
fn buys_food_from_it_when_food_runs_short_with_the_coins_it_has_above_its_reserve() {
    let mut v = visited(&[(Good::Iron, 0.0), (Good::Food, CARAVAN_FOOD + 40.0)]);
    let mut reserve = crate::queries::npc_trade::npc_reserve(&v.world, city(&v.world, &v.city));
    let coins = held(&reserve, Good::Coins) + 200.0;
    reserve.insert(Good::Food, 0.0);
    reserve.insert(Good::Coins, coins);
    set_storage(&mut v, reserve);
    plan(&mut v);
    assert!(sent(&v.world, &v.city).is_some_and(|r| held(&r.buys, Good::Food) > 0.0));
    let ki = carriage_of(&v.world, 0);
    let sold = move |w: &WorldState| held(&w.carriages[ki].load, Good::Food) < CARAVAN_FOOD + 40.0;
    run_until(&mut v.world, &v.terrain, &sold, 4000);
    assert!(held(&v.world.carriages[ki].load, Good::Food) >= CARAVAN_FOOD);
    assert_eq!(check_all(&v.world, &v.terrain), vec![]);
}

#[test]
fn never_deals_in_weapons_which_would_arm_the_hand() {
    let mut v = visited(&[(Good::Iron, 0.0)]);
    let mut reserve = crate::queries::npc_trade::npc_reserve(&v.world, city(&v.world, &v.city));
    reserve.insert(Good::Sword, 5.0);
    set_storage(&mut v, reserve);
    let ki = carriage_of(&v.world, 0);
    v.world.carriages[ki].load =
        Stock::from([(Good::Food, CARAVAN_FOOD), (Good::Spear, 5.0), (Good::Coins, 500.0)]);
    plan(&mut v);
    if let Some(run) = sent(&v.world, &v.city) {
        let mut dealt = run.sells.keys().chain(run.buys.keys());
        assert!(dealt.all(|g| !matches!(g, Good::Spear | Good::Sword)));
    }
}

#[test]
fn takes_a_hand_home_when_the_trader_goes_on_before_they_get_there() {
    let mut v = visited(&[]);
    plan(&mut v);
    let hand = sent(&v.world, &v.city).unwrap().resident_id;
    v.world.traders[0].stand = None;
    v.world.traders[0].calls = Some(Vec::new());
    let si = v.world.buildings.iter().position(|b| b.id == v.storage).unwrap();
    let wood = held_in(v.world.buildings[si].stock.as_ref(), Good::Wood);
    let (c, h) = (v.city.clone(), hand.clone());
    let home = move |w: &WorldState| sent(w, &c).is_none_or(|r| r.resident_id != h);
    run_until(&mut v.world, &v.terrain, &home, 4000);
    let r = v.world.residents.iter().find(|r| r.id == hand).unwrap();
    assert!(!r.carried.contains_key(&Good::Wood));
    assert_eq!(held_in(v.world.buildings[si].stock.as_ref(), Good::Wood), wood);
    assert_eq!(check_all(&v.world, &v.terrain), vec![]);
}

// what holds trader stops together

fn messages(world: &WorldState) -> String {
    trader_stops_sound(world).into_iter().map(|v| v.message).collect::<Vec<_>>().join(",")
}

fn stand(city: &str, until: f64) -> Option<TraderStand> {
    Some(TraderStand { city_id: city.into(), x: 1.0, y: 1.0, until: Some(until) })
}

#[test]
fn catches_a_city_called_at_twice_too_long_a_stay_and_two_on_one_tile() {
    let Fixture { mut world, post, .. } = fixture();
    world.traders[0].calls = Some(vec!["a".into(), "a".into()]);
    assert!(messages(&world).contains("twice"));
    world.traders[0].calls = Some(Vec::new());
    let tick = world.tick as f64;
    world.traders[0].stand = stand(&post, tick + TRADER_STOP_TICKS + 1.0);
    put(&mut world, 0, 1.0, 1.0);
    assert!(messages(&world).contains("too long"));
    world.traders[0].stand.as_mut().unwrap().until = Some(tick + 5.0);
    let mut other = world.traders[0].clone();
    other.id = "other".into();
    world.traders.push(other);
    assert!(messages(&world).contains("with another trader"));
}

#[test]
fn catches_one_that_left_its_stop_with_time_to_stand() {
    let Fixture { mut world, post, .. } = fixture();
    let tick = world.tick as f64;
    world.traders[0].stand = stand(&post, tick + 5.0);
    put(&mut world, 0, 2.0, 2.0);
    assert!(messages(&world).contains("left its stop"));
}

#[test]
fn is_one_of_the_worlds_invariants() {
    let Fixture { mut world, terrain, post, .. } = fixture();
    let tick = world.tick as f64;
    world.traders[0].stand = stand(&post, tick + 5.0);
    put(&mut world, 0, 2.0, 2.0);
    assert!(check_all(&world, &terrain).iter().any(|v| v.invariant == "trader-stops-sound"));
}
