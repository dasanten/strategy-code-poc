//! `apps/server/src/traders.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, CARAVAN_FOOD, CARAVAN_SPREAD, TRADERS, TRADER_DRIVE_TRIES,
};
use csp_shared::world::HorseStats;
use serde_json::json;

use super::*;
use crate::capture::capture_city;
use crate::caravans::{hq_end, leave_trade_org};
use crate::carrying::{resolve_carrying, CarryAction, CarryKind};
use crate::hq_fall::nothing_left_of_the_hq;
use crate::invariants::check_all;
use crate::movement_pending::{take_over, Taken};
use crate::queries::driving::drive_off_problem;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::sight::entities_in_sight;
use crate::starting_city::found_starting_city;
use crate::survival::die;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading_posts::found_trading_post;
use crate::walking::Walking;
use crate::world::{create_world, step_world};
use crate::world_index::WorldIndex;
use csp_shared::protocol::{SeenEntity, SeenTrader};
use csp_shared::world::{CrimeKind, Resident};

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
        if reached.len() > world.traders[0].r#loop.len() {
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

// a wandering trader at the HQ

/// A trader come round to the HQ's goods warehouse, its escort armed and its Food topped up.
/// Returns the goods and coin warehouses' indices.
fn come_round(f: &mut Fixture) -> (usize, usize) {
    let world = &mut f.world;
    world.traders.truncate(1);
    let goods = hq_end(world).warehouse.unwrap();
    let hq = f.hq.clone();
    let coins = world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(&hq) && held_in(b.stock.as_ref(), Good::Coins) > 0.0
        })
        .unwrap();
    assert_ne!(coins, goods);
    let (x, y) = (world.buildings[goods].x, world.buildings[goods].y);
    put(world, 0, x, y);
    world.traders[0].post_id = hq;
    world.traders[0].stop = TraderStop::Warehouse;
    for ri in crew_of(world, 0).into_iter().skip(1) {
        world.residents[ri].carried.insert(Good::Spear, 1.0);
    }
    let ki = carriage_of(world, 0);
    world.carriages[ki].load = stock(&[(Good::Food, CARAVAN_FOOD)]);
    (goods, coins)
}

/// The stop after the HQ on a trader's loop.
fn after_hq(t: &Trader, hq: &str) -> String {
    let i = t.r#loop.iter().position(|p| p == hq).unwrap();
    t.r#loop[(i + 1) % t.r#loop.len()].clone()
}

fn drives_to(world: &WorldState, ri: usize, x: f64, y: f64) -> bool {
    matches!(&world.residents[ri].order, Some(ResidentOrder::Drive(d)) if d.target.x == x && d.target.y == y)
}

fn walks_to(world: &WorldState, ri: usize, x: f64, y: f64) -> bool {
    matches!(&world.residents[ri].order, Some(ResidentOrder::WalkTo(w)) if w.target.x == x && w.target.y == y)
}

fn step_once(world: &mut WorldState, terrain: &TerrainMap) {
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    step_world(world, terrain, &mut Scratch::default(), Some(&mut walking), None);
}

#[test]
fn comes_round_to_the_hq_from_the_post_before_it_on_its_loop() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    world.traders.truncate(1);
    let t = &world.traders[0];
    let i = t.r#loop.iter().position(|p| *p == hq).unwrap();
    world.traders[0].post_id = t.r#loop[(i + t.r#loop.len() - 1) % t.r#loop.len()].clone();
    let w = at_warehouse(&mut world, 0);
    world.buildings[w].stock = Some(Stock::new());
    let h = hq.clone();
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id == h, 200);
    assert_eq!(
        (world.traders[0].heading, world.traders[0].stop),
        (Heading::Post, TraderStop::Storage)
    );
    step_traders(&mut world, terrain.size, None);
    let s = hq_end(&world).storage.unwrap();
    let (sx, sy) = (world.buildings[s].x, world.buildings[s].y);
    assert!(drives_to(&world, crew_of(&world, 0)[0], sx, sy));
}

#[test]
fn loads_new_food_and_coins_there_and_carries_them_to_a_post() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Food, 100.0), (Good::Wood, 100.0)]));
    world.buildings[coins].stock = Some(stock(&[(Good::Coins, 4_000.0)]));
    let h = hq.clone();
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != h, 400);
    let ki = carriage_of(&world, 0);
    let l = &world.carriages[ki].load;
    assert_eq!(
        (held(l, Good::Food), held(l, Good::Wood), held(l, Good::Coins)),
        (CARAVAN_FOOD + 50.0, 50.0, 2_000.0)
    );
    let g = world.buildings[goods].stock.as_ref();
    assert_eq!((held_in(g, Good::Food), held_in(g, Good::Wood)), (50.0, 50.0));
    assert_eq!(world.buildings[coins].stock, Some(stock(&[(Good::Coins, 2_000.0)])));
    let t = &world.traders[0];
    assert_eq!((t.heading, t.stop, t.plan.is_none()), (Heading::Post, TraderStop::Storage, true));
    // And on to the next post on its loop, which has none of them.
    let bound = t.post_id.clone();
    assert_eq!(bound, after_hq(t, &hq));
    let post = post_end(&world, &bound).warehouse.unwrap();
    world.buildings[post].stock = Some(Stock::new());
    let (px, py) = (world.buildings[post].x, world.buildings[post].y);
    put(&mut world, 0, px, py);
    world.traders[0].stop = TraderStop::Warehouse;
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != bound, 400);
    let p = world.buildings[post].stock.as_ref();
    assert_eq!(
        (held_in(p, Good::Food), held_in(p, Good::Wood), held_in(p, Good::Coins)),
        (25.0, 25.0, 1_000.0)
    );
    assert!(world.crimes.is_empty());
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn moves_coins_only_at_the_coin_warehouse_and_other_goods_only_at_the_goods_warehouse() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Iron, 0.0)]));
    world.buildings[coins].stock = Some(stock(&[(Good::Coins, 2_000.0)]));
    let ki = carriage_of(&world, 0);
    world.carriages[ki].load =
        stock(&[(Good::Food, CARAVAN_FOOD), (Good::Iron, 40.0), (Good::Coins, 6_000.0)]);
    let before = (total(&world, Good::Iron), total(&world, Good::Coins));
    run_until(&mut world, &terrain, &|w| w.traders[0].stop == TraderStop::CoinWarehouse, 400);
    // The goods are done, and nothing of the Coins has moved.
    assert_eq!(world.buildings[goods].stock, Some(stock(&[(Good::Iron, 20.0)])));
    let l = &world.carriages[ki].load;
    assert_eq!((held(l, Good::Iron), held(l, Good::Coins)), (20.0, 6_000.0));
    assert_eq!(world.buildings[coins].stock, Some(stock(&[(Good::Coins, 2_000.0)])));
    plan_eq(world.traders[0].plan.as_ref().unwrap(), &[(Good::Coins, 2_000.0)], &[]);
    step_once(&mut world, &terrain);
    let (cx, cy) = (world.buildings[coins].x, world.buildings[coins].y);
    assert!(drives_to(&world, crew_of(&world, 0)[0], cx, cy));
    assert_eq!(check_all(&world, &terrain), vec![]);
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != hq, 400);
    assert_eq!(world.buildings[coins].stock, Some(stock(&[(Good::Coins, 4_000.0)])));
    let l = &world.carriages[ki].load;
    assert_eq!((held(l, Good::Iron), held(l, Good::Coins)), (20.0, 4_000.0));
    assert_eq!(world.buildings[goods].stock, Some(stock(&[(Good::Iron, 20.0)])));
    assert_eq!((total(&world, Good::Iron), total(&world, Good::Coins)), before);
    assert!(world.crimes.is_empty());
}

#[test]
fn shares_the_room_on_the_carriage_between_the_goods_and_the_coins() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Wood, 4_000.0), (Good::Stone, 4_000.0)]));
    world.buildings[coins].stock = Some(stock(&[(Good::Coins, 40_000.0)]));
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != hq, 2_000);
    let l = &world.carriages[carriage_of(&world, 0)].load;
    assert!(held(l, Good::Wood) > 0.0);
    assert!(held(l, Good::Coins) > 0.0);
    assert!(stock_weight(l) <= CARRIAGE_CAPACITY);
    assert!(stock_weight(l) > CARRIAGE_CAPACITY - 10.0);
}

#[test]
fn goes_on_from_the_goods_warehouse_with_no_coins_to_move() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Wood, 10.0)]));
    world.buildings[coins].stock = Some(Stock::new());
    let mut stops = Vec::new();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..100 {
        if world.traders[0].post_id != hq {
            break;
        }
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        stops.push(world.traders[0].stop);
    }
    assert_ne!(world.traders[0].post_id, hq);
    assert!(!stops.contains(&TraderStop::CoinWarehouse));
}

#[test]
fn leaves_what_is_kept_for_deliveries_alone_coins_too() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Wood, 100.0)]));
    world.buildings[coins].stock = Some(stock(&[(Good::Coins, 1_000.0)]));
    let wid = world.buildings[goods].id.clone();
    for (id, good, units) in [("d1", "wood", 60), ("d2", "coins", 400)] {
        world.deliveries.push(
            serde_json::from_value(json!({
                "id": id, "kind": "delivery", "realmId": "someone", "warehouseId": wid,
                "cityId": "somewhere", "good": good, "units": units, "fee": 1, "caravanId": null,
            }))
            .unwrap(),
        );
    }
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != hq, 400);
    let l = &world.carriages[carriage_of(&world, 0)].load;
    assert_eq!(held_in(world.buildings[goods].stock.as_ref(), Good::Wood), 80.0);
    assert_eq!(held(l, Good::Wood), 20.0);
    assert_eq!(held_in(world.buildings[coins].stock.as_ref(), Good::Coins), 700.0);
    assert_eq!(held(l, Good::Coins), 300.0);
}

#[test]
fn makes_up_a_lost_escort_there_each_time_round_but_not_at_a_post() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(stock(&[(Good::Spear, 10.0)]));
    world.buildings[coins].stock = Some(Stock::new());
    let next = after_hq(&world.traders[0], &hq);
    let post = post_end(&world, &next).warehouse.unwrap();
    world.traders[0].post_id = next;
    let (px, py) = (world.buildings[post].x, world.buildings[post].y);
    put(&mut world, 0, px, py);
    let escort = world.residents[crew_of(&world, 0)[1]].id.clone();
    die(&mut world, &escort);
    assert_eq!(world.traders[0].escort_ids.len() as f64, TRADER_ESCORTS - 1.0);
    step_traders(&mut world, terrain.size, None);
    assert_eq!(world.traders[0].escort_ids.len() as f64, TRADER_ESCORTS - 1.0);
    // Back at the HQ.
    world.traders[0].post_id = hq.clone();
    let (gx, gy) = (world.buildings[goods].x, world.buildings[goods].y);
    put(&mut world, 0, gx, gy);
    world.traders[0].plan = None;
    let left: HashSet<String> = world.traders[0].escort_ids.iter().cloned().collect();
    step_traders(&mut world, terrain.size, None);
    assert_eq!(world.traders[0].escort_ids.len() as f64, TRADER_ESCORTS);
    assert_eq!(world.traders[0].post_id, hq);
    // The new one is armed before it goes on.
    let joined = world.traders[0].escort_ids.iter().find(|id| !left.contains(*id)).unwrap().clone();
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id != hq, 400);
    let r = world.residents.iter().find(|r| r.id == joined).unwrap();
    assert_eq!(held(&r.carried, Good::Spear), 1.0);
}

#[test]
fn back_for_a_new_carriage_when_bound_for_the_hq_goes_on_past_it_not_calling_twice() {
    let mut f = fixture();
    let (goods, coins) = come_round(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    world.buildings[goods].stock = Some(Stock::new());
    world.buildings[coins].stock = Some(Stock::new());
    world.traders[0].heading = Heading::Hq;
    run_until(&mut world, &terrain, &|w| w.traders[0].heading == Heading::Post, 200);
    assert_eq!(world.traders[0].post_id, after_hq(&world.traders[0], &hq));
}

#[test]
fn takes_a_load_out_when_it_is_first_sent_as_at_any_stop() {
    let Fixture { mut world, terrain, .. } = fixture();
    world.traders.truncate(1);
    let goods = hq_end(&world).warehouse.unwrap();
    let st = world.buildings[goods].stock.get_or_insert_with(Stock::new);
    st.insert(Good::Wood, 100.0);
    st.insert(Good::Spear, 2.0);
    let (gx, gy) = (world.buildings[goods].x, world.buildings[goods].y);
    put(&mut world, 0, gx, gy);
    world.traders[0].heading = Heading::Hq;
    world.traders[0].stop = TraderStop::Warehouse;
    let bound = world.traders[0].post_id.clone();
    run_until(&mut world, &terrain, &|w| w.traders[0].heading == Heading::Post, 2_000);
    assert_eq!(world.traders[0].post_id, bound);
    let l = &world.carriages[carriage_of(&world, 0)].load;
    assert!(held(l, Good::Wood) > 0.0);
    assert!(held(l, Good::Coins) > 0.0);
}

// a wandering trader losing its crew

#[test]
fn has_a_surviving_escort_take_over_driving_when_its_driver_dies() {
    let Fixture { mut world, terrain, .. } = fixture();
    put(&mut world, 0, 300.0, 300.0);
    let ids: Vec<String> =
        crew_of(&world, 0).iter().map(|&ri| world.residents[ri].id.clone()).collect();
    die(&mut world, &ids[0]);
    assert_eq!(world.traders[0].driver_id.as_ref(), Some(&ids[1]));
    assert_eq!(world.traders[0].escort_ids, vec![ids[2].clone()]);
    step_traders(&mut world, terrain.size, None);
    let next = world.residents.iter().find(|r| r.id == ids[1]).unwrap();
    assert!(matches!(next.order, Some(ResidentOrder::Drive(_))));
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn stands_with_no_crew_left_until_the_hq_sends_a_new_driver_on_foot() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    put(&mut world, 0, 300.0, 300.0);
    let ids: Vec<String> =
        crew_of(&world, 0).iter().map(|&ri| world.residents[ri].id.clone()).collect();
    for id in &ids {
        die(&mut world, id);
    }
    assert_eq!(world.traders[0].driver_id, None);
    let ki = carriage_of(&world, 0);
    // Nobody free at the HQ yet: each of its adults is at the bottom of the list.
    let others: Vec<usize> = (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(&hq))
        .collect();
    let saved: Vec<f64> = others.iter().map(|&i| world.residents[i].health).collect();
    for &i in &others {
        world.residents[i].health = 0.0;
    }
    step_traders(&mut world, terrain.size, None);
    assert_eq!(world.traders[0].driver_id, None);
    for (&i, &h) in others.iter().zip(&saved) {
        world.residents[i].health = h;
    }
    step_traders(&mut world, terrain.size, None);
    let did = world.traders[0].driver_id.clone().unwrap();
    let di = world.residents.iter().position(|r| r.id == did).unwrap();
    assert_eq!(world.residents[di].owner, None);
    assert_eq!(world.residents[di].city_id.as_deref(), Some(hq.as_str()));
    assert!(walks_to(&world, di, 300.0, 300.0));
    assert_eq!((world.carriages[ki].x, world.carriages[ki].y), (300.0, 300.0));
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn has_its_escort_defend_it_against_someone_taking_goods_off_the_carriage() {
    let Fixture { mut world, terrain, .. } = fixture();
    put(&mut world, 0, 300.0, 300.0);
    let eid = world.traders[0].escort_ids[0].clone();
    let ei = world.residents.iter().position(|r| r.id == eid).unwrap();
    world.residents[ei].carried.insert(Good::Sword, 1.0);
    let mut m = Mulberry32::new(9.0);
    let fields =
        NewResident { id: "thief", owner: None, city_id: None, x: 300.0, y: 300.0, tick: 0.0 };
    let mut thief = new_resident(&mut || m.next(), &fields, None);
    let cid = world.traders[0].carriage_id.clone();
    thief.order = Some(
        serde_json::from_value(json!({
            "kind": "pickUp", "from": { "kind": "carriage", "carriageId": cid }, "goods": { "food": 1 },
        }))
        .unwrap(),
    );
    world.residents.push(thief);
    step_traders(&mut world, terrain.size, None);
    let ei = world.residents.iter().position(|r| r.id == eid).unwrap();
    assert!(
        matches!(&world.residents[ei].order, Some(ResidentOrder::Attack(a)) if a.target_id == "thief"),
        "{:?}",
        world.residents[ei].order
    );
}

#[test]
fn counts_the_crew_as_run_by_the_trader_not_by_the_hqs_plans() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    step_once(&mut world, &terrain);
    let crew = crew_of(&world, 0);
    assert!(crew.iter().all(|&ri| world.residents[ri].city_id.as_deref() == Some(hq.as_str())));
    assert!(!crew
        .iter()
        .any(|&ri| matches!(world.residents[ri].order, Some(ResidentOrder::WorkAt(_)))));
}

// robbing a wandering trader

/// A trader out in the open with something on board, and a resident of Mara's on its tile.
/// Returns the realm's id; the thief is `p1`.
fn out_in_the_open(f: &mut Fixture) -> String {
    let world = &mut f.world;
    put(world, 0, 300.0, 300.0);
    let ki = carriage_of(world, 0);
    world.carriages[ki].load = stock(&[(Good::Food, 8.0), (Good::Iron, 4.0)]);
    let ri = found_starting_city(world, &f.terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    let mut m = Mulberry32::new(11.0);
    let fields = NewResident {
        id: "p1",
        owner: Some(&realm),
        city_id: None,
        x: 300.0,
        y: 300.0,
        tick: world.tick as f64,
    };
    let thief = new_resident(&mut || m.next(), &fields, None);
    world.residents.push(thief);
    realm
}

fn take_off(world: &WorldState, who: &str, iron: f64) -> CarryAction {
    CarryAction {
        kind: CarryKind::Take,
        resident_id: who.to_string(),
        spot: GoodsSpot::Carriage { carriage_id: world.traders[0].carriage_id.clone() },
        goods: stock(&[(Good::Iron, iron)]),
    }
}

fn thief(world: &WorldState) -> &Resident {
    world.residents.iter().find(|r| r.id == "p1").unwrap()
}

#[test]
fn is_a_theft_against_the_trade_organization_with_nothing_sent_again() {
    let mut f = fixture();
    out_in_the_open(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    let a = take_off(&world, "p1", 2.0);
    resolve_carrying(&mut world, &[a], terrain.size);
    assert_eq!(held(&thief(&world).carried, Good::Iron), 2.0);
    assert_eq!(world.crimes.len(), 1);
    let c = &world.crimes[0];
    assert_eq!(
        (c.kind, c.victim_org.as_str(), c.goods.clone()),
        (CrimeKind::Theft, hq.as_str(), Some(stock(&[(Good::Iron, 2.0)])))
    );
    assert_eq!(world.traders[0].robberies, 1.0);
    // It owes nobody a delivery, and no caravan's route counts it.
    assert!(world.deliveries.is_empty());
    assert!(world.transfers.is_empty());
    assert!(world.route_robberies.is_empty());
    assert_eq!(held(&world.carriages[carriage_of(&world, 0)].load, Good::Iron), 2.0);
}

#[test]
fn counts_one_robbery_a_tick_however_many_take_from_it() {
    let mut f = fixture();
    out_in_the_open(&mut f);
    let Fixture { mut world, terrain, .. } = f;
    let a = take_off(&world, "p1", 1.0);
    resolve_carrying(&mut world, &[a.clone(), a], terrain.size);
    assert_eq!(world.traders[0].robberies, 1.0);
}

#[test]
fn is_no_robbery_when_one_of_the_trade_orgs_own_takes_from_it() {
    let mut f = fixture();
    out_in_the_open(&mut f);
    let Fixture { mut world, terrain, .. } = f;
    let driver = world.residents[crew_of(&world, 0)[0]].id.clone();
    let a = take_off(&world, &driver, 1.0);
    resolve_carrying(&mut world, &[a], terrain.size);
    assert_eq!(world.traders[0].robberies, 0.0);
    assert!(world.crimes.is_empty());
}

#[test]
fn earns_it_more_escorts_made_up_at_the_hq_once_it_has_a_new_carriage() {
    let mut f = fixture();
    out_in_the_open(&mut f);
    let Fixture { mut world, terrain, .. } = f;
    let w = hq_end(&world).warehouse.unwrap();
    world.traders[0].robberies = 2.0;
    let (wx, wy) = (world.buildings[w].x, world.buildings[w].y);
    put(&mut world, 0, wx, wy);
    world.traders[0].heading = Heading::Hq;
    step_traders(&mut world, terrain.size, None);
    assert_eq!(world.traders[0].escort_ids.len() as f64, TRADER_ESCORTS + 1.0);
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn refuses_to_drive_off_with_its_carriage_while_its_crew_hold_it() {
    let mut f = fixture();
    let realm = out_in_the_open(&mut f);
    let Fixture { mut world, terrain, .. } = f;
    let problem = |w: &WorldState| {
        let k = &w.carriages[carriage_of(w, 0)];
        drive_off_problem(w, thief(w), k, &realm, terrain.size)
    };
    assert_eq!(problem(&world).as_deref(), Some("its driver is still with that trader’s carriage"));
    let crew = crew_of(&world, 0);
    let ids: Vec<String> = crew.iter().map(|&ri| world.residents[ri].id.clone()).collect();
    world.residents[crew[1]].carried.insert(Good::Spear, 1.0);
    world.residents[crew[1]].x += 1.0;
    world.residents[crew[0]].x += 1000.0;
    world.residents[crew[2]].x += 1000.0;
    assert_eq!(problem(&world).as_deref(), Some("its escort guards that trader’s carriage"));
    die(&mut world, &ids[0]);
    die(&mut world, &ids[2]);
    // The one left has taken over driving.
    assert_eq!(world.traders[0].driver_id.as_ref(), Some(&ids[1]));
    die(&mut world, &ids[1]);
    assert_eq!(problem(&world), None);
}

#[test]
fn stolen_it_gets_a_new_carriage_and_horse_at_the_hq_bound_for_the_same_post() {
    let mut f = fixture();
    let realm = out_in_the_open(&mut f);
    let Fixture { mut world, terrain, hq, .. } = f;
    let stolen = world.traders[0].carriage_id.clone();
    let tid = world.traders[0].id.clone();
    let bound = world.traders[0].post_id.clone();
    world.traders[0].stop = TraderStop::Warehouse;
    let crew: Vec<String> =
        crew_of(&world, 0).iter().map(|&ri| world.residents[ri].id.clone()).collect();
    let ki = carriage_of(&world, 0);
    take_over(&mut world, "p1", &realm, Taken { carriage: Some(ki), horse: None }, terrain.size);
    let k = world.carriages.iter().find(|k| k.id == stolen).unwrap();
    assert_eq!(k.realm_id.as_deref(), Some(realm.as_str()));
    assert_eq!(k.city_id, None);
    assert_eq!(k.load, stock(&[(Good::Food, 8.0), (Good::Iron, 4.0)]));
    assert_eq!(world.crimes.len(), 1);
    let c = &world.crimes[0];
    assert_eq!(
        (c.kind, c.victim_org.as_str(), c.carriage),
        (CrimeKind::Theft, hq.as_str(), Some(true))
    );
    assert_eq!(world.traders[0].robberies, 1.0);
    assert!(world.deliveries.is_empty());
    assert!(world.traders.iter().any(|x| x.id == tid));
    let fresh = carriage_of(&world, 0);
    let w = hq_end(&world).warehouse.unwrap();
    let k = &world.carriages[fresh];
    assert_ne!(k.id, stolen);
    assert_eq!((k.realm_id.as_deref(), k.city_id.as_deref()), (None, Some(hq.as_str())));
    assert_eq!((k.x, k.y), (world.buildings[w].x, world.buildings[w].y));
    assert!(k.load.is_empty());
    let horse = world.horses.iter().find(|h| Some(&h.id) == k.horse_id.as_ref()).unwrap();
    assert_eq!(horse.city_id.as_deref(), Some(hq.as_str()));
    let t = &world.traders[0];
    assert_eq!(
        (t.heading, t.stop, &t.post_id, t.plan.is_none()),
        (Heading::Hq, TraderStop::Storage, &bound, true)
    );
    // Its surviving crew walk back to it.
    let (fx, fy) = (k.x, k.y);
    step_traders(&mut world, terrain.size, None);
    for id in &crew {
        let ri = world.residents.iter().position(|r| &r.id == id).unwrap();
        assert!(walks_to(&world, ri, fx, fy), "{:?}", world.residents[ri].order);
    }
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

// a wandering trader's loop

#[test]
fn keeps_a_post_that_leaves_the_trade_organization_until_it_gets_there() {
    let Fixture { mut world, terrain, .. } = fixture();
    let bound = world.traders[0].post_id.clone();
    leave_trade_org(&mut world, &bound);
    assert!(world.traders[0].r#loop.contains(&bound));
    assert_eq!(world.traders[0].post_id, bound);
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn drops_a_post_by_going_on_to_the_one_after_it() {
    let Fixture { mut world, terrain, .. } = fixture();
    let t = &world.traders[0];
    let bound = t.post_id.clone();
    let after =
        t.r#loop[(t.r#loop.iter().position(|p| *p == bound).unwrap() + 1) % t.r#loop.len()].clone();
    world.traders[0].plan =
        Some(TraderPlan { leave: Stock::new(), take: stock(&[(Good::Wood, 1.0)]) });
    world.traders[0].stop = TraderStop::Warehouse;
    leave_trade_org(&mut world, &bound);
    drop_from_loop(&mut world.traders[0], &bound);
    let t = &world.traders[0];
    assert!(!t.r#loop.contains(&bound));
    assert_eq!(t.post_id, after);
    assert_eq!((t.stop, t.plan.is_none()), (TraderStop::Storage, true));
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn keeps_its_way_when_a_post_it_isnt_bound_for_drops_wrapping_round_the_end() {
    let Fixture { mut world, posts, .. } = fixture();
    let bound = world.traders[0].post_id.clone();
    let other = posts.iter().find(|p| **p != bound).unwrap().clone();
    world.traders[0].stop = TraderStop::Warehouse;
    drop_from_loop(&mut world.traders[0], &other);
    assert_eq!(world.traders[0].post_id, bound);
    assert_eq!(world.traders[0].stop, TraderStop::Warehouse);
    // The last of the loop goes: on to the first, the HQ.
    let t = &mut world.traders[0];
    let last = t.r#loop.last().unwrap().clone();
    let first = t.r#loop[0].clone();
    t.post_id = last.clone();
    drop_from_loop(t, &last);
    assert_eq!(t.post_id, first);
    assert!(posts.iter().all(|p| world.cities.iter().any(|c| &c.id == p)));
}

#[test]
fn holds_together_with_a_captured_post_on_it() {
    let Fixture { mut world, terrain, posts, .. } = fixture();
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    capture_city(&mut world, &posts[0], &realm, terrain.size);
    assert!(world.traders[0].r#loop.contains(&posts[0]));
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn takes_in_a_new_post_where_it_adds_the_least_way_the_rest_in_the_same_order() {
    let Fixture { mut world, terrain, .. } = fixture();
    let order = world.traders[0].r#loop.clone();
    let bound = world.traders[0].post_id.clone();
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(&mut world, &terrain, 320, 174, None, &mut || m.next());
    step_traders(&mut world, terrain.size, None);
    let t = &world.traders[0];
    assert_eq!(t.r#loop.len(), order.len() + 1);
    assert_eq!(t.r#loop.iter().filter(|id| **id != post).cloned().collect::<Vec<_>>(), order);
    assert_eq!(t.post_id, bound);
    // Beside the two posts on the east side of the square, so between them.
    let n = t.r#loop.len();
    let i = t.r#loop.iter().position(|p| *p == post).unwrap();
    let mut neighbours = vec![t.r#loop[(i + n - 1) % n].clone(), t.r#loop[(i + 1) % n].clone()];
    neighbours.sort();
    let mut east: Vec<String> = t
        .r#loop
        .iter()
        .filter(|id| {
            let c = world.cities.iter().find(|c| &c.id == *id).unwrap();
            let hall = town_hall_of(&world, c).unwrap();
            hall.x > 200.0 && hall.x < 280.0
        })
        .cloned()
        .collect();
    east.sort();
    assert_eq!(neighbours, east);
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn goes_back_to_the_hq_with_no_post_left_and_out_again_when_there_is_one() {
    let Fixture { mut world, terrain, hq, posts, traders } = fixture_at(&[(220, 128)]);
    assert_eq!(world.traders.iter().map(|t| t.id.clone()).collect::<Vec<_>>(), traders[..1]);
    put(&mut world, 0, 300.0, 300.0);
    leave_trade_org(&mut world, &posts[0]);
    drop_from_loop(&mut world.traders[0], &posts[0]);
    let t = &world.traders[0];
    assert_eq!((&t.r#loop, &t.post_id, t.stop), (&vec![hq.clone()], &hq, TraderStop::Storage));
    assert_eq!(traders_sound(&world, &terrain), vec![]);
    step_traders(&mut world, terrain.size, None);
    let s = hq_end(&world).storage.unwrap();
    let (sx, sy) = (world.buildings[s].x, world.buildings[s].y);
    assert!(drives_to(&world, crew_of(&world, 0)[0], sx, sy));
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(&mut world, &terrain, 128, 320, None, &mut || m.next());
    step_traders(&mut world, terrain.size, None);
    let t = &world.traders[0];
    assert_eq!((&t.r#loop, &t.post_id), (&vec![hq.clone(), post], &hq));
    assert_eq!(traders_sound(&world, &terrain), vec![]);
}

#[test]
fn stays_at_the_hqs_warehouse_with_no_post_left_not_shuttling_to_and_fro() {
    let Fixture { mut world, terrain, hq, posts, .. } = fixture_at(&[(220, 128)]);
    leave_trade_org(&mut world, &posts[0]);
    drop_from_loop(&mut world.traders[0], &posts[0]);
    let w = hq_end(&world).warehouse.unwrap();
    let (wx, wy) = (world.buildings[w].x, world.buildings[w].y);
    put(&mut world, 0, wx, wy);
    world.traders[0].stop = TraderStop::Warehouse;
    for ri in crew_of(&world, 0) {
        world.residents[ri].carried.insert(Good::Spear, 1.0);
    }
    step_traders(&mut world, terrain.size, None);
    let t = &world.traders[0];
    assert_eq!((t.stop, &t.post_id, t.plan.is_none()), (TraderStop::Warehouse, &hq, true));
    assert_eq!(world.residents[crew_of(&world, 0)[0]].order, None);
    // Given a post, it goes on from there.
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(&mut world, &terrain, 128, 320, None, &mut || m.next());
    run_until(&mut world, &terrain, &move |w| w.traders[0].post_id == post, 2_000);
    assert_eq!(world.traders[0].heading, Heading::Post);
}

// wandering traders and the fall of the HQ

#[test]
fn ends_them_crew_carriage_horse_and_load_join_the_captor_where_they_stand() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    put(&mut world, 0, 300.0, 300.0);
    // Bound for the HQ, on its loop, makes no difference.
    assert!(world.traders[0].r#loop.contains(&hq));
    world.traders[0].post_id = hq.clone();
    let ki = carriage_of(&world, 0);
    let kid = world.carriages[ki].id.clone();
    world.carriages[ki].load = stock(&[(Good::Iron, 3.0)]);
    let crew: Vec<String> =
        crew_of(&world, 0).iter().map(|&ri| world.residents[ri].id.clone()).collect();
    let trader = world.traders[0].clone();
    capture_city(&mut world, &hq, &realm, terrain.size);
    assert!(trade_org_hq(&world).is_none());
    assert!(world.traders.is_empty());
    let k = world.carriages.iter().find(|k| k.id == kid).unwrap();
    assert_eq!(k.realm_id.as_deref(), Some(realm.as_str()));
    assert_eq!((k.x, k.y), (300.0, 300.0));
    assert_eq!(k.load, stock(&[(Good::Iron, 3.0)]));
    for id in &crew {
        let r = world.residents.iter().find(|r| &r.id == id).unwrap();
        assert_eq!((r.owner.as_deref(), r.x, r.y), (Some(realm.as_str()), 300.0, 300.0));
    }
    assert_eq!(nothing_left_of_the_hq(&world), vec![]);
    assert_eq!(check_all(&world, &terrain), vec![]);
    // And should one be left, the invariant says so.
    world.traders.push(trader);
    assert_eq!(
        nothing_left_of_the_hq(&world).into_iter().map(|v| v.message).collect::<Vec<_>>(),
        vec!["the world has no Trade Org HQ but still has wandering traders".to_string()]
    );
}

#[test]
fn ends_any_left_with_no_hq_on_the_next_tick() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    world.cities.retain(|c| c.id != hq);
    assert!(!world.traders.is_empty());
    step_traders(&mut world, terrain.size, None);
    assert!(world.traders.is_empty());
}

// what is seen of a wandering trader

#[test]
fn is_what_is_seen_of_a_caravan_seen_through_its_carriage_and_crew() {
    let Fixture { mut world, terrain, .. } = fixture();
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    let size = terrain.size;
    let seen = |w: &WorldState| -> Vec<SeenTrader> {
        let index = WorldIndex::new(w, size);
        entities_in_sight(w, &index, Some(&realm), None)
            .iter()
            .filter_map(|e| match e {
                SeenEntity::Trader(t) => Some(t.clone()),
                _ => None,
            })
            .collect()
    };
    assert_eq!(seen(&world), vec![]);
    let mut m = Mulberry32::new(3.0);
    let fields = NewResident {
        id: "scout",
        owner: Some(&realm),
        city_id: None,
        x: 300.0,
        y: 300.0,
        tick: world.tick as f64,
    };
    let scout = new_resident(&mut || m.next(), &fields, None);
    world.residents.push(scout);
    put(&mut world, 0, 300.0, 300.0);
    let t = &world.traders[0];
    assert_eq!(
        seen(&world),
        vec![SeenTrader {
            id: t.id.clone(),
            carriage_id: t.carriage_id.clone(),
            driver_id: t.driver_id.clone(),
            escort_ids: t.escort_ids.clone(),
            post_id: t.post_id.clone(),
            heading: Heading::Post,
            standing: None,
            prices: None,
        }]
    );
}

// the invariant on wandering traders

fn messages(world: &WorldState, terrain: &TerrainMap) -> Vec<String> {
    traders_sound(world, terrain).into_iter().map(|v| v.message).collect()
}

#[test]
fn allows_the_hq_on_a_loop_but_catches_a_loop_naming_anything_else_or_a_stop_twice() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    assert!(world.traders[0].r#loop.contains(&hq));
    assert_eq!(messages(&world, &terrain), Vec::<String>::new());
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    world.traders[0].r#loop.push(realm.clone());
    let id = world.traders[0].id.clone();
    assert_eq!(
        messages(&world, &terrain),
        vec![format!("trader {id} has {realm} on its loop, which is no city")]
    );
    world.traders[0].r#loop.pop();
    let first = world.traders[0].r#loop[0].clone();
    world.traders[0].r#loop.push(first);
    assert_eq!(
        messages(&world, &terrain),
        vec![format!("trader {id} has a stop twice on its loop")]
    );
}

#[test]
fn catches_a_loop_without_the_hq() {
    let Fixture { mut world, terrain, hq, .. } = fixture();
    world.traders[0].r#loop.retain(|p| *p != hq);
    let id = world.traders[0].id.clone();
    assert_eq!(messages(&world, &terrain), vec![format!("trader {id} has no HQ on its loop")]);
}

#[test]
fn catches_making_for_a_coin_warehouse_at_a_post() {
    let Fixture { mut world, terrain, .. } = fixture();
    world.traders[0].heading = Heading::Post;
    world.traders[0].stop = TraderStop::CoinWarehouse;
    assert!(messages(&world, &terrain)[0].contains("makes for a coin warehouse"));
}

#[test]
fn catches_going_to_a_post_off_its_loop() {
    let Fixture { mut world, terrain, .. } = fixture();
    world.traders[0].post_id = "nowhere".into();
    assert!(messages(&world, &terrain)[0].contains("goes to nowhere"));
}

#[test]
fn catches_crew_who_arent_of_the_hq_and_crew_shared_with_another() {
    let Fixture { mut world, terrain, posts, .. } = fixture();
    let ri = crew_of(&world, 0)[0];
    let rid = world.residents[ri].id.clone();
    world.residents[ri].city_id = Some(posts[0].clone());
    let id = world.traders[0].id.clone();
    assert_eq!(
        messages(&world, &terrain),
        vec![format!("trader {id} has crew {rid}, who isn't of the Trade Org HQ")]
    );
    world.residents[ri].city_id = Some(trade_org_hq(&world).unwrap().id.clone());
    world.traders[1].escort_ids[0] = rid;
    assert!(messages(&world, &terrain)[0].contains("twice or shared"));
}

#[test]
fn catches_a_lost_carriage_a_driverless_crew_too_many_escorts_and_an_oversized_plan() {
    let Fixture { mut world, terrain, .. } = fixture();
    let ki = carriage_of(&world, 0);
    world.carriages[ki].realm_id = Some("someone".into());
    assert!(messages(&world, &terrain)[0].contains("isn't the Trade Org HQ's"));
    world.carriages[ki].realm_id = None;
    let driver = world.traders[0].driver_id.take();
    assert!(messages(&world, &terrain)[0].contains("has no driver"));
    world.traders[0].driver_id = driver;
    world.traders[0].escort_ids.extend(["a", "b", "c"].map(String::from));
    assert!(messages(&world, &terrain).join(",").contains("walks with"));
    let n = world.traders[0].escort_ids.len();
    world.traders[0].escort_ids.truncate(n - 3);
    world.traders[0].plan = Some(TraderPlan {
        leave: Stock::new(),
        take: stock(&[(Good::Stone, CARRIAGE_CAPACITY * 2.0)]),
    });
    assert!(messages(&world, &terrain).join(",").contains("means to take"));
}

#[test]
fn is_one_of_the_worlds_invariants() {
    let Fixture { mut world, terrain, .. } = fixture();
    world.traders[0].post_id = "nowhere".into();
    assert!(check_all(&world, &terrain).iter().any(|v| v.invariant == "traders-sound"));
}
