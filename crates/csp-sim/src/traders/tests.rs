//! `apps/server/src/traders.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, CARAVAN_FOOD, CARAVAN_SPREAD, TRADERS, TRADER_DRIVE_TRIES,
};
use csp_shared::world::HorseStats;
use serde_json::json;

use super::*;
use crate::caravans::hq_end;
use crate::invariants::check_all;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Where the fixture's trading posts stand, in the order they are founded.
const SITES: [(i32, i32); 3] = [(220, 128), (220, 220), (128, 220)];

pub(crate) struct Fixture {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub hq: String,
    pub posts: Vec<String>,
    pub traders: Vec<String>,
}

/// The Trade Org HQ at (128, 128) and a trading post on each of `sites`, with the HQ's traders.
pub(crate) fn fixture_at(sites: &[(i32, i32)]) -> Fixture {
    let terrain = plains(512);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut world, &terrain, 128, 128, &mut || m.next());
    let posts: Vec<String> = sites
        .iter()
        .map(|&(x, y)| found_trading_post(&mut world, &terrain, x, y, None, &mut || m.next()))
        .collect();
    let traders = place_traders(&mut world, terrain.size);
    for h in &mut world.horses {
        h.stats = HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        };
    }
    Fixture { world, terrain, hq, posts, traders }
}

pub(crate) fn fixture() -> Fixture {
    fixture_at(&SITES)
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

/// Stands a trader's carriage, its hitched horse and its crew on tile (x, y), out on its loop.
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
    world.traders[t].heading = Heading::Post;
}

/// Stands a trader at the warehouse of the post it is bound for, its Food topped up. Returns the
/// warehouse's index.
fn at_warehouse(world: &mut WorldState, t: usize) -> usize {
    let w = post_end(world, &world.traders[t].post_id).warehouse.unwrap();
    let (x, y) = (world.buildings[w].x, world.buildings[w].y);
    put(world, t, x, y);
    world.traders[t].stop = TraderStop::Warehouse;
    let ki = carriage_of(world, t);
    world.carriages[ki].load = Stock::from([(Good::Food, CARAVAN_FOOD)]);
    w
}

/// Every unit of a good in the world: in buildings, on carriages, carried and on the ground.
fn total(world: &WorldState, good: Good) -> f64 {
    let b = world.buildings.iter().map(|b| held_in(b.stock.as_ref(), good)).sum::<f64>();
    let k = world.carriages.iter().map(|k| held(&k.load, good)).sum::<f64>();
    let r = world.residents.iter().map(|r| held(&r.carried, good)).sum::<f64>();
    let p = world.piles.iter().map(|p| held(&p.goods, good)).sum::<f64>();
    b + k + r + p
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
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
    }
    assert!(done(world));
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

// placing wandering traders

#[test]
fn gives_each_a_carriage_a_horse_and_a_crew_of_the_hq_at_its_goods_warehouse() {
    let Fixture { world, terrain, hq, traders, .. } = fixture();
    assert_eq!(world.traders.iter().map(|t| t.id.clone()).collect::<Vec<_>>(), traders);
    let hall = town_hall_of(&world, world.cities.iter().find(|c| c.id == hq).unwrap()).unwrap();
    let (x, y) = hq_layout(hall.x as i32 + 1, hall.y as i32 + 1).goods_warehouse;
    let (x, y) = (f64::from(x), f64::from(y));
    for t in 0..world.traders.len() {
        let tr = &world.traders[t];
        assert_eq!(tr.escort_ids.len() as f64, TRADER_ESCORTS);
        assert_eq!(tr.heading, Heading::Hq);
        let k = &world.carriages[carriage_of(&world, t)];
        assert_eq!(
            (k.realm_id.as_deref(), k.city_id.as_deref(), k.x, k.y, k.load.is_empty()),
            (None, Some(hq.as_str()), x, y, true)
        );
        let horse = world.horses.iter().find(|h| k.horse_id.as_ref() == Some(&h.id)).unwrap();
        assert_eq!(horse.city_id.as_deref(), Some(hq.as_str()));
        for ri in crew_of(&world, t) {
            let r = &world.residents[ri];
            assert_eq!(
                (r.owner.as_deref(), r.city_id.as_deref(), r.x, r.y),
                (None, Some(hq.as_str()), x, y)
            );
        }
    }
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn sends_them_round_one_loop_of_all_the_posts_and_the_hq_each_bound_for_a_different_post() {
    let Fixture { world, hq, posts, .. } = fixture();
    let mut all = posts.clone();
    all.sort();
    assert_eq!(world.traders.len(), posts.len());
    let mut with_hq = all.clone();
    with_hq.push(hq);
    with_hq.sort();
    for t in &world.traders {
        let mut stops = t.r#loop.clone();
        stops.sort();
        assert_eq!(stops, with_hq);
    }
    let loops: HashSet<String> = world.traders.iter().map(|t| t.r#loop.join(",")).collect();
    assert_eq!(loops.len(), 1);
    let mut bound: Vec<String> = world.traders.iter().map(|t| t.post_id.clone()).collect();
    bound.sort();
    assert_eq!(bound, all);
}

#[test]
fn sends_no_more_than_the_balance_says_however_many_posts_there_are() {
    let sites = [
        (220, 128),
        (220, 220),
        (128, 220),
        (320, 128),
        (320, 220),
        (320, 320),
        (220, 320),
        (128, 320),
    ];
    assert!(sites.len() as f64 > TRADERS);
    let Fixture { world, posts, .. } = fixture_at(&sites);
    assert_eq!(world.traders.len() as f64, TRADERS);
    let bound: HashSet<&String> = world.traders.iter().map(|t| &t.post_id).collect();
    assert_eq!(bound.len() as f64, TRADERS);
    assert_eq!(world.traders[0].r#loop.len(), posts.len() + 1);
}

#[test]
fn goes_round_without_crossing_itself_on_a_square_of_the_hq_and_its_posts() {
    let Fixture { world, terrain, .. } = fixture();
    let places: Vec<(f64, f64)> = world.traders[0]
        .r#loop
        .iter()
        .map(|id| {
            let h =
                town_hall_of(&world, world.cities.iter().find(|c| &c.id == id).unwrap()).unwrap();
            (h.x, h.y)
        })
        .collect();
    let longest = (0..places.len())
        .map(|i| dist(terrain.size, places[i], places[(i + 1) % places.len()]))
        .fold(0.0, f64::max);
    // The corners of a square: four sides, whichever way round, and no diagonal.
    assert!(longest < 120.0, "{longest}");
}

#[test]
fn places_none_twice_and_none_without_an_hq_or_with_no_post() {
    let Fixture { mut world, terrain, .. } = fixture();
    assert!(place_traders(&mut world, terrain.size).is_empty());
    let mut bare = create_world(&terrain, 1);
    let mut m = Mulberry32::new(1.0);
    found_trading_post(&mut bare, &terrain, 320, 320, None, &mut || m.next());
    assert!(place_traders(&mut bare, terrain.size).is_empty());
    let mut lonely = create_world(&terrain, 1);
    let mut m = Mulberry32::new(1.0);
    found_trade_org_hq(&mut lonely, &terrain, 128, 128, &mut || m.next());
    assert!(place_traders(&mut lonely, terrain.size).is_empty());
}

#[test]
fn comes_with_a_generated_world() {
    let terrain = crate::test_world::city_terrain();
    let mut world = crate::world::generate_world(terrain, 1);
    crate::starting_city::found_starting_city(&mut world, terrain, 1, None);
    let posts = trading_posts(&world).len();
    assert!(posts > 0);
    assert_eq!(world.traders.len(), (TRADERS as usize).min(posts));
    assert_eq!(check_all(&world, terrain), vec![]);
}

// evening out a load

#[test]
fn leaves_half_of_what_the_load_has_more_of_and_takes_half_of_what_it_has_less_of() {
    let plan = even_out_load(
        &stock(&[
            (Good::Wood, 100.0),
            (Good::Iron, 2.0),
            (Good::Coins, 2_000.0),
            (Good::Spear, 11.0),
        ]),
        &stock(&[(Good::Iron, 30.0), (Good::Stone, 20.0), (Good::Coins, 400.0)]),
        0.0,
        CARRIAGE_CAPACITY,
        0.0,
    );
    let sorted = |s: &Stock| {
        let mut v: Vec<(Good, f64)> = s.iter().map(|(&g, &n)| (g, n)).collect();
        v.sort_by_key(|(g, _)| good_name_of(*g));
        v
    };
    assert_eq!(sorted(&plan.leave), sorted(&stock(&[(Good::Iron, 14.0), (Good::Stone, 10.0)])));
    assert_eq!(
        sorted(&plan.take),
        sorted(&stock(&[(Good::Wood, 50.0), (Good::Coins, 800.0), (Good::Spear, 5.0)]))
    );
}

fn good_name_of(g: Good) -> &'static str {
    crate::queries::names::good_name(g)
}

fn plan_eq(plan: &TraderPlan, leave: &[(Good, f64)], take: &[(Good, f64)]) {
    let as_set = |s: &Stock| {
        let mut v: Vec<(&'static str, f64)> =
            s.iter().map(|(&g, &n)| (good_name_of(g), n)).collect();
        v.sort_by(|a, b| a.0.cmp(b.0));
        v
    };
    assert_eq!(as_set(&plan.leave), as_set(&stock(leave)), "leave");
    assert_eq!(as_set(&plan.take), as_set(&stock(take)), "take");
}

#[test]
fn evens_out_food_like_any_good_but_keeps_the_food_the_crew_keep_on_board() {
    let food = |n: f64| stock(&[(Good::Food, n)]);
    plan_eq(
        &even_out_load(&food(60.0), &food(72.0), 72.0, CARRIAGE_CAPACITY, 0.0),
        &[],
        &[(Good::Food, 30.0)],
    );
    plan_eq(
        &even_out_load(&food(10.0), &food(102.0), 72.0, CARRIAGE_CAPACITY, 0.0),
        &[(Good::Food, 10.0)],
        &[],
    );
    // Short of its own Food it leaves none, and takes as if it had no load of it.
    plan_eq(
        &even_out_load(&food(10.0), &food(40.0), 72.0, CARRIAGE_CAPACITY, 0.0),
        &[],
        &[(Good::Food, 5.0)],
    );
}

#[test]
fn makes_room_for_food_and_coins_on_a_carriage_full_of_goods_the_place_has_as_much_of() {
    let there = stock(&[
        (Good::Wood, 200.0),
        (Good::Stone, 200.0),
        (Good::Food, 300.0),
        (Good::Coins, 5_000.0),
    ]);
    let load = stock(&[(Good::Wood, 200.0), (Good::Stone, 200.0), (Good::Food, CARAVAN_FOOD)]);
    let TraderPlan { leave, take } =
        even_out_load(&there, &load, CARAVAN_FOOD, CARRIAGE_CAPACITY, 0.0);
    assert!(held(&take, Good::Food) > 50.0);
    assert!(held(&take, Good::Coins) > 1_000.0);
    assert_eq!(held(&leave, Good::Wood), held(&leave, Good::Stone));
    assert!(held(&leave, Good::Wood) > 0.0);
    let after = 400.0 - held(&leave, Good::Wood) - held(&leave, Good::Stone)
        + held(&take, Good::Food)
        + held(&take, Good::Coins) * 0.02
        + CARAVAN_FOOD;
    assert!(after <= CARRIAGE_CAPACITY && after > CARRIAGE_CAPACITY - 10.0, "{after}");
}

#[test]
fn takes_only_what_the_carriage_holds_cutting_every_good_by_the_same_share() {
    let there = stock(&[(Good::Wood, 2_000.0), (Good::Stone, 2_000.0), (Good::Spear, 400.0)]);
    let load = stock(&[(Good::Food, CARAVAN_FOOD)]);
    let TraderPlan { take, .. } =
        even_out_load(&there, &load, CARAVAN_FOOD, CARRIAGE_CAPACITY, 0.0);
    let weight = stock_weight(&take) + CARAVAN_FOOD;
    assert!(weight <= CARRIAGE_CAPACITY && weight > CARRIAGE_CAPACITY - 10.0, "{weight}");
    assert_eq!(held(&take, Good::Wood), held(&take, Good::Stone));
    assert!(held(&take, Good::Spear) > 0.0);
}

#[test]
fn counts_on_the_room_what_it_leaves_there() {
    let plan = even_out_load(
        &stock(&[(Good::Stone, 100.0)]),
        &stock(&[(Good::Wood, 400.0)]),
        0.0,
        400.0,
        0.0,
    );
    plan_eq(&plan, &[(Good::Wood, 200.0)], &[(Good::Stone, 50.0)]);
}

#[test]
fn leaves_what_is_over_with_a_load_more_than_its_horse_can_pull() {
    let TraderPlan { leave, take } = even_out_load(
        &stock(&[(Good::Wood, 100.0)]),
        &stock(&[(Good::Stone, 500.0)]),
        0.0,
        100.0,
        0.0,
    );
    assert!(500.0 - held(&leave, Good::Stone) + held(&take, Good::Wood) <= 100.0);
    assert!(held(&take, Good::Wood) > 0.0);
}

#[test]
fn takes_nothing_with_no_room_beside_the_food_the_crew_keep_on_board() {
    let plan = even_out_load(
        &stock(&[(Good::Wood, 100.0)]),
        &stock(&[(Good::Food, 100.0)]),
        100.0,
        100.0,
        0.0,
    );
    plan_eq(&plan, &[], &[]);
}

// a wandering trader at a post

#[test]
fn evens_out_with_the_warehouse_every_good_and_goes_on_to_the_next_post() {
    let Fixture { mut world, terrain, .. } = fixture();
    let bound = world.traders[0].post_id.clone();
    let w = at_warehouse(&mut world, 0);
    let ki = carriage_of(&world, 0);
    world.buildings[w].stock = Some(stock(&[
        (Good::Wood, 100.0),
        (Good::Stone, 10.0),
        (Good::Coins, 2_000.0),
        (Good::Food, 40.0),
    ]));
    world.carriages[ki].load =
        stock(&[(Good::Food, CARAVAN_FOOD), (Good::Stone, 30.0), (Good::Iron, 30.0)]);
    let before = (total(&world, Good::Wood), total(&world, Good::Coins));
    let b = bound.clone();
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != b, 200);
    let st = world.buildings[w].stock.clone().unwrap_or_default();
    for (g, n) in [
        (Good::Wood, 50.0),
        (Good::Stone, 20.0),
        (Good::Iron, 15.0),
        (Good::Coins, 1_000.0),
        (Good::Food, 20.0),
    ] {
        assert_eq!(held(&st, g), n, "warehouse {g:?}");
    }
    let l = &world.carriages[ki].load;
    for (g, n) in [
        (Good::Wood, 50.0),
        (Good::Stone, 20.0),
        (Good::Iron, 15.0),
        (Good::Coins, 1_000.0),
        (Good::Food, CARAVAN_FOOD + 20.0),
    ] {
        assert_eq!(held(l, g), n, "load {g:?}");
    }
    let t = &world.traders[0];
    let next = &t.r#loop[(t.r#loop.iter().position(|p| *p == bound).unwrap() + 1) % t.r#loop.len()];
    assert_eq!(&t.post_id, next);
    assert_eq!((t.heading, t.stop, t.plan.is_none()), (Heading::Post, TraderStop::Storage, true));
    // Nothing was made or lost, and moving its own stock is no theft.
    assert_eq!((total(&world, Good::Wood), total(&world, Good::Coins)), before);
    assert!(world.crimes.is_empty());
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn leaves_what_the_warehouse_keeps_for_a_delivery_alone() {
    let Fixture { mut world, terrain, .. } = fixture();
    let bound = world.traders[0].post_id.clone();
    let w = at_warehouse(&mut world, 0);
    world.buildings[w].stock = Some(stock(&[(Good::Wood, 100.0)]));
    let wid = world.buildings[w].id.clone();
    world.deliveries.push(
        serde_json::from_value(json!({
            "id": "d", "kind": "delivery", "realmId": "someone", "warehouseId": wid,
            "cityId": "somewhere", "good": "wood", "units": 60, "fee": 1, "caravanId": null,
        }))
        .unwrap(),
    );
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != bound, 200);
    assert_eq!(held_in(world.buildings[w].stock.as_ref(), Good::Wood), 80.0);
    assert_eq!(held(&world.carriages[carriage_of(&world, 0)].load, Good::Wood), 20.0);
}

#[test]
fn tops_up_its_food_at_the_storage_first_then_goes_to_the_warehouse() {
    let Fixture { mut world, terrain, .. } = fixture();
    let end = post_end(&world, &world.traders[0].post_id);
    let (s, w) = (end.storage.unwrap(), end.warehouse.unwrap());
    let (sx, sy) = (world.buildings[s].x, world.buildings[s].y);
    put(&mut world, 0, sx, sy);
    world.traders[0].stop = TraderStop::Storage;
    world.buildings[s].stock = Some(stock(&[(Good::Food, 200.0)]));
    run_until(&mut world, &terrain, &|w| w.traders[0].stop == TraderStop::Warehouse, 200);
    assert_eq!(held(&world.carriages[carriage_of(&world, 0)].load, Good::Food), CARAVAN_FOOD);
    assert_eq!(held_in(world.buildings[s].stock.as_ref(), Good::Food), 200.0 - CARAVAN_FOOD);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    step_world(&mut world, &terrain, &mut Scratch::default(), Some(&mut walking), None);
    let (wx, wy) = (world.buildings[w].x, world.buildings[w].y);
    let o = &world.residents[crew_of(&world, 0)[0]].order;
    assert!(
        matches!(o, Some(ResidentOrder::Drive(d)) if d.target.x == wx && d.target.y == wy),
        "{o:?}"
    );
}

#[test]
fn waits_at_the_hq_until_its_escort_is_armed_as_it_wont_be_back_there_soon() {
    let Fixture { mut world, terrain, .. } = fixture();
    let w = hq_end(&world).warehouse.unwrap();
    let st = world.buildings[w].stock.get_or_insert_with(Stock::new);
    st.insert(Good::Spear, 0.0);
    st.insert(Good::Sword, 0.0);
    let (wx, wy) = (world.buildings[w].x, world.buildings[w].y);
    put(&mut world, 0, wx, wy);
    world.traders[0].heading = Heading::Hq;
    world.traders[0].stop = TraderStop::Warehouse;
    let ki = carriage_of(&world, 0);
    world.carriages[ki].load = stock(&[(Good::Food, CARAVAN_FOOD)]);
    let crew = crew_of(&world, 0);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..10 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    }
    assert_eq!(
        (world.traders[0].heading, world.traders[0].stop),
        (Heading::Hq, TraderStop::Warehouse)
    );
    assert!(!world.residents[crew[1]].carried.contains_key(&Good::Spear));
    world.buildings[w].stock.as_mut().unwrap().insert(Good::Spear, 2.0);
    run_until(&mut world, &terrain, &|w| w.traders[0].heading == Heading::Post, 200);
    assert!(crew[1..].iter().all(|&ri| held(&world.residents[ri].carried, Good::Spear) == 1.0));
    assert_eq!(held_in(world.buildings[w].stock.as_ref(), Good::Spear), 0.0);
}

#[test]
fn goes_on_after_too_many_drives_that_end_short_so_one_post_cant_hold_up_the_loop() {
    let Fixture { mut world, terrain, .. } = fixture();
    let bound = world.traders[0].post_id.clone();
    put(&mut world, 0, 300.0, 300.0);
    world.traders[0].misses = TRADER_DRIVE_TRIES;
    step_traders(&mut world, terrain.size, None);
    let t = &world.traders[0];
    assert_ne!(t.post_id, bound);
    assert_eq!(t.misses, 0.0);
    assert!(t.r#loop.contains(&bound));
}

#[test]
#[ignore = "slow in the TypeScript too (`tags: ['slow']`): a trader's whole loop, T86.14's long simulations"]
fn is_sent_from_the_hq_armed_goes_round_its_loop_the_hq_and_all_and_supplies_the_posts() {
    let Fixture { mut world, terrain, posts, .. } = fixture();
    world.traders.truncate(1);
    let warehouses: Vec<usize> =
        posts.iter().map(|p| post_end(&world, p).warehouse.unwrap()).collect();
    for &w in &warehouses {
        world.buildings[w].stock = Some(Stock::new());
    }
    let arms = hq_end(&world).warehouse.unwrap();
    let st = world.buildings[arms].stock.get_or_insert_with(Stock::new);
    st.insert(Good::Spear, 10.0);
    st.insert(Good::Food, 400.0);
    let start = world.traders[0].post_id.clone();
    let ki = carriage_of(&world, 0);
    let mut reached: Vec<String> = Vec::new();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let mut farthest: f64 = 0.0;
    for t in 0..30_000 {
        if reached.len() >= world.traders[0].r#loop.len() + 1 {
            break;
        }
        let was =
            (world.traders[0].heading == Heading::Post).then(|| world.traders[0].post_id.clone());
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if let Some(was) = was {
            if world.traders[0].post_id != was {
                reached.push(was);
            }
        }
        if world.traders[0].heading == Heading::Post {
            let k = (world.carriages[ki].x, world.carriages[ki].y);
            for id in world.traders[0].escort_ids.clone() {
                let r = world.residents.iter().find(|x| x.id == id).unwrap();
                farthest = farthest.max(dist(terrain.size, (r.x, r.y), k));
            }
        }
        if t % 500 == 0 {
            assert_eq!(check_all(&world, &terrain), vec![]);
        }
    }
    // Round the whole loop, in its order, and to the first post again.
    let stops = world.traders[0].r#loop.clone();
    let i = stops.iter().position(|p| *p == start).unwrap();
    let mut in_order: Vec<String> =
        (0..stops.len()).map(|n| stops[(i + n) % stops.len()].clone()).collect();
    in_order.push(start);
    assert_eq!(reached, in_order);
    // What it took at the HQ has reached every post, Food and Coins too.
    for &w in &warehouses {
        let st = world.buildings[w].stock.as_ref();
        assert!(
            held_in(st, Good::GoldOre) > 0.0
                && held_in(st, Good::Coins) > 0.0
                && held_in(st, Good::Food) > 0.0
        );
    }
    let crew = crew_of(&world, 0);
    assert!(crew[1..].iter().all(|&ri| {
        let c = &world.residents[ri].carried;
        held(c, Good::Spear) + held(c, Good::Sword) > 0.0
    }));
    assert!(farthest <= CARAVAN_SPREAD + 3.0);
    assert!(world.crimes.is_empty());
    assert_eq!(check_all(&world, &terrain), vec![]);
}
