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
use crate::queries::names::held;
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
