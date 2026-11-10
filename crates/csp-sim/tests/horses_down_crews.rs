//! `horses-down-crews.test.ts`, one test per `it`: caravans and wandering traders whose horse is
//! Down (`CONTEXT.md`: Down; bug #993) stand on the road with their load, their drivers given no
//! drive order, and give up nothing for the drives they don't make.

mod common;
mod goods_support;
mod transfers_fixture;

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, MAX_HUNGER, NPC_VILLAGE};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    CaravanJobStep, CaravanStop, Good, Heading, Stock, TraderStand, TraderStop, WorldState,
};
use csp_sim::caravans::{leave_trade_org, place_caravans, route_end};
use csp_sim::goods_deps::drop_goods;
use csp_sim::horses::horses_down_lie_still;
use csp_sim::invariants::check_all;
use csp_sim::npc_cities::found_npc_city;
use csp_sim::npc_roads::WayFinder;
use csp_sim::random::Mulberry32;
use csp_sim::tick::{Scratch, Walk};
use csp_sim::trade_org::found_trade_org_hq;
use csp_sim::traders::place_traders;
use csp_sim::trading_posts::found_trading_post;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use goods_support::open;
use serde_json::json;

/// Walking in a busy world (bug #993): the pathfinder's time for this tick (`PATH_BUDGET_MS`)
/// goes on others' searches, so a search started now doesn't settle within the tick
/// (`busyWalking`).
struct Busy(Walking);

impl Walk for Busy {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.0.request_steps(world, scratch, 0.0);
        self.0.resolve(world, scratch, &steps);
        steps.len()
    }

    fn ways(&mut self) -> Option<&mut dyn WayFinder> {
        Some(&mut self.0)
    }
}

/// A convoy: a caravan or a wandering trader, by its place in the world's list.
#[derive(Clone, Copy)]
enum Convoy {
    Caravan(usize),
    Trader(usize),
}

/// The Trade Org HQ, a far trading post, its caravan and the HQ's traders (`fixture`).
struct World {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scratch: Scratch,
    post: String,
}

fn fixture() -> World {
    let terrain = open(1024);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    found_trade_org_hq(&mut world, &terrain, 128, 128, &mut rand);
    let post = found_trading_post(&mut world, &terrain, 700, 700, None, &mut rand);
    place_caravans(&mut world);
    place_traders(&mut world, terrain.size);
    let s = AVERAGE_HORSE_STATS;
    for h in &mut world.horses {
        h.stats.speed = s.speed;
        h.stats.strength = s.strength;
        h.stats.endurance = s.endurance;
    }
    World { world, terrain: Arc::new(terrain), scratch: Scratch::default(), post }
}

/// The convoy's carriage, horse and crew (driver first), by index.
struct Parts {
    carriage: usize,
    horse: usize,
    driver: usize,
}

fn crew_of(world: &WorldState, convoy: Convoy) -> (String, Vec<String>) {
    let (carriage, driver, escorts) = match convoy {
        Convoy::Caravan(i) => {
            let c = &world.caravans[i];
            (c.carriage_id.clone(), c.driver_id.clone(), c.escort_ids.clone())
        }
        Convoy::Trader(i) => {
            let t = &world.traders[i];
            (t.carriage_id.clone(), t.driver_id.clone(), t.escort_ids.clone())
        }
    };
    let mut crew = vec![driver.expect("a driver")];
    crew.extend(escorts);
    (carriage, crew)
}

/// A convoy's carriage, hitched horse and crew all stand on (x, y), with `load` on board
/// (`standOn`).
fn stand_on(world: &mut WorldState, convoy: Convoy, x: f64, y: f64, load: Stock) -> Parts {
    let (carriage_id, crew) = crew_of(world, convoy);
    let carriage = world.carriages.iter().position(|k| k.id == carriage_id).unwrap();
    let horse_id = world.carriages[carriage].horse_id.clone().expect("a hitched horse");
    let horse = world.horses.iter().position(|h| h.id == horse_id).unwrap();
    world.carriages[carriage].x = x;
    world.carriages[carriage].y = y;
    world.carriages[carriage].load = load;
    world.horses[horse].x = x;
    world.horses[horse].y = y;
    for id in &crew {
        let r = world.residents.iter_mut().find(|r| &r.id == id).unwrap();
        r.x = x;
        r.y = y;
        r.order = None;
    }
    let driver = world.residents.iter().position(|r| r.id == crew[0]).unwrap();
    Parts { carriage, horse, driver }
}

fn gold_ore() -> Stock {
    Stock::from([(Good::GoldOre, 40.0)])
}

/// The horse goes Down next tick: its meter is empty and its health all but gone (`starving`).
fn starving(world: &mut WorldState, horse: usize) {
    world.horses[horse].hunger = 0.0;
    world.horses[horse].health = 1e-9;
}

/// Steps the world `ticks` times with its people fed, checking the invariant after each tick
/// (`run`).
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    walking: &mut dyn Walk,
    ticks: usize,
) {
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        step_world(world, terrain, scratch, Some(&mut *walking), None);
        assert_eq!(horses_down_lie_still(world), vec![]);
    }
}

/// More drives than any crew tries before it gives a stop up.
const TICKS: usize = 30;

fn walking(terrain: &Arc<TerrainMap>) -> Walking {
    Walking::new(terrain.clone())
}

fn busy(terrain: &Arc<TerrainMap>) -> Busy {
    Busy(walking(terrain))
}

// a caravan whose horse is Down (`CONTEXT.md`: Down; bug #993)

#[test]
fn stands_on_the_road_with_its_load_its_driver_given_no_drive_order() {
    let World { mut world, terrain, mut scratch, .. } = fixture();
    let p = stand_on(&mut world, Convoy::Caravan(0), 400.0, 400.0, gold_ore());
    world.caravans[0].heading = Heading::Post;
    world.caravans[0].stop = CaravanStop::Storage;
    starving(&mut world, p.horse);
    run(&mut world, &terrain, &mut scratch, &mut busy(&terrain), TICKS);
    assert!(world.horses[p.horse].down_until.is_some());
    assert!(world.residents[p.driver].order.is_none());
    let k = &world.carriages[p.carriage];
    assert_eq!((k.x, k.y), (400.0, 400.0));
    assert_eq!(k.horse_id.as_deref(), Some(world.horses[p.horse].id.as_str()));
    assert_eq!(k.load, gold_ore());
    assert_eq!(world.caravans[0].heading, Heading::Post);
    assert_eq!(world.caravans[0].stop, CaravanStop::Storage);
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn still_loads_at_a_stop_so_food_put_on_board_wakes_the_horse_and_it_drives_on() {
    let World { mut world, terrain, mut scratch, .. } = fixture();
    let post_id = world.caravans[0].post_id.clone();
    let storage = route_end(&world, &post_id, Heading::Hq).storage.unwrap();
    let stock = world.buildings[storage].stock.get_or_insert_with(Stock::new);
    stock.insert(Good::Food, 500.0);
    let (x, y) = (world.buildings[storage].x, world.buildings[storage].y);
    let p = stand_on(&mut world, Convoy::Caravan(0), x, y, Stock::new());
    world.caravans[0].heading = Heading::Hq;
    world.caravans[0].stop = CaravanStop::Storage;
    starving(&mut world, p.horse);
    let mut walking = walking(&terrain);
    run(&mut world, &terrain, &mut scratch, &mut walking, 3);
    assert!(world.carriages[p.carriage].load.get(&Good::Food).copied().unwrap_or(0.0) > 0.0);
    assert!(world.horses[p.horse].down_until.is_none());
    let from = (world.carriages[p.carriage].x, world.carriages[p.carriage].y);
    run(&mut world, &terrain, &mut scratch, &mut walking, 400);
    assert_ne!((world.carriages[p.carriage].x, world.carriages[p.carriage].y), from);
}

#[test]
fn drives_on_once_the_horse_has_eaten_where_it_lay() {
    let World { mut world, terrain, mut scratch, .. } = fixture();
    let p = stand_on(&mut world, Convoy::Caravan(0), 400.0, 400.0, gold_ore());
    world.caravans[0].heading = Heading::Post;
    world.caravans[0].stop = CaravanStop::Storage;
    starving(&mut world, p.horse);
    let mut walking = walking(&terrain);
    run(&mut world, &terrain, &mut scratch, &mut walking, TICKS);
    assert!(world.residents[p.driver].order.is_none());
    drop_goods(&mut world, 400.0, 400.0, &Stock::from([(Good::Food, 2.0)]), terrain.size);
    run(&mut world, &terrain, &mut scratch, &mut walking, 200);
    assert!(world.horses[p.horse].down_until.is_none());
    assert!(world.carriages[p.carriage].x > 400.0);
}

#[test]
fn keeps_its_delivery_no_drive_counts_as_ending_short_so_it_doesnt_turn_back() {
    let mut f = transfers_fixture::deliveries();
    let city = f.city.clone();
    let o = json!({ "kind": "buy", "good": "iron", "units": 4, "cityId": city });
    assert_eq!(f.order(o), "ack");
    let terrain = f.terrain.clone();
    let mut walking = walking(&terrain);
    run(&mut f.world, &terrain, &mut f.scratch, &mut walking, 1);
    let from_id = f.world.deliveries[0].warehouse_id.clone();
    let from = f.world.buildings.iter().position(|b| b.id == from_id).unwrap();
    let (x, y) = (f.world.buildings[from].x, f.world.buildings[from].y);
    let p = stand_on(&mut f.world, Convoy::Caravan(0), x, y, Stock::new());
    let post_id = f.world.caravans[0].post_id.clone();
    let at_hq = route_end(&f.world, &post_id, Heading::Hq).warehouse == Some(from);
    f.world.caravans[0].heading = if at_hq { Heading::Hq } else { Heading::Post };
    f.world.caravans[0].stop = CaravanStop::Warehouse;
    for _ in 0..100 {
        if f.world.caravans[0].job.as_ref().map(|j| j.step) == Some(CaravanJobStep::Deliver) {
            break;
        }
        run(&mut f.world, &terrain, &mut f.scratch, &mut walking, 1);
    }
    let job = f.world.caravans[0].job.clone().expect("a job");
    assert_eq!(job.step, CaravanJobStep::Deliver);
    f.world.carriages[p.carriage].load.shift_remove(&Good::Food);
    starving(&mut f.world, p.horse);
    run(&mut f.world, &terrain, &mut f.scratch, &mut walking, 1);
    let misses = f.world.caravans[0].job.as_ref().expect("the job").misses;
    run(&mut f.world, &terrain, &mut f.scratch, &mut walking, TICKS);
    assert!(f.world.horses[p.horse].down_until.is_some());
    let now = f.world.caravans[0].job.as_ref().expect("the job kept");
    assert_eq!(now.delivery_id, job.delivery_id);
    assert_eq!(now.step, CaravanJobStep::Deliver);
    assert_eq!(now.misses, misses);
    assert_eq!(f.world.deliveries[0].caravan_id.as_deref(), Some(f.world.caravans[0].id.as_str()));
    assert!(f.world.residents[p.driver].order.is_none());
}

#[test]
fn keeps_its_transfer_no_drive_counts_as_ending_short_so_it_doesnt_turn_back() {
    let mut f = transfers_fixture::setup();
    let storage = f.storage.clone();
    f.set(&storage, Good::Iron, Some(100.0));
    let transfer = json!({
        "kind": "transfer", "fromCityId": f.city, "toCityId": f.to_city, "good": "iron", "units": 12,
    });
    assert_eq!(f.order(transfer), "ack");
    let (x, y) = (f.warehouse().x, f.warehouse().y);
    let p = stand_on(&mut f.world, Convoy::Caravan(0), x, y, Stock::new());
    f.world.caravans[0].heading = Heading::Post;
    f.world.caravans[0].stop = CaravanStop::Warehouse;
    let terrain = f.terrain.clone();
    let mut walking = walking(&terrain);
    for _ in 0..100 {
        if f.world.caravans[0].transfer.is_some() {
            break;
        }
        run(&mut f.world, &terrain, &mut f.scratch, &mut walking, 1);
    }
    let job = f.world.caravans[0].transfer.clone().expect("a transfer");
    f.world.carriages[p.carriage].load.shift_remove(&Good::Food);
    starving(&mut f.world, p.horse);
    run(&mut f.world, &terrain, &mut f.scratch, &mut walking, 1);
    let kept = f.world.caravans[0].transfer.clone().expect("the transfer");
    run(&mut f.world, &terrain, &mut f.scratch, &mut walking, TICKS);
    assert!(f.world.horses[p.horse].down_until.is_some());
    let now = f.world.caravans[0].transfer.as_ref().expect("the transfer kept");
    assert_eq!(now.transfer_id, job.transfer_id);
    assert_eq!((now.step, now.misses), (kept.step, kept.misses));
    assert_eq!(f.world.transfers[0].caravan_id.as_deref(), Some(f.world.caravans[0].id.as_str()));
    assert!(f.world.residents[p.driver].order.is_none());
}

// a wandering trader whose horse is Down (`CONTEXT.md`: Down; bug #993)

#[test]
fn stands_on_the_road_and_doesnt_give_up_its_next_stop() {
    let World { mut world, terrain, mut scratch, post } = fixture();
    let p = stand_on(&mut world, Convoy::Trader(0), 400.0, 400.0, gold_ore());
    let t = &mut world.traders[0];
    t.post_id = post.clone();
    t.heading = Heading::Post;
    t.stop = TraderStop::Storage;
    t.misses = 0.0;
    starving(&mut world, p.horse);
    run(&mut world, &terrain, &mut scratch, &mut walking(&terrain), TICKS);
    assert!(world.horses[p.horse].down_until.is_some());
    let t = &world.traders[0];
    assert_eq!(t.post_id, post);
    assert_eq!(t.heading, Heading::Post);
    assert_eq!(t.stop, TraderStop::Storage);
    assert_eq!(t.misses, 0.0);
    assert!(world.residents[p.driver].order.is_none());
    let k = &world.carriages[p.carriage];
    assert_eq!((k.x, k.y), (400.0, 400.0));
}

#[test]
fn doesnt_give_up_a_stop_at_a_city_on_its_way() {
    let World { mut world, terrain, mut scratch, .. } = fixture();
    let mut m = Mulberry32::new(9.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 500, 400, &mut || m.next(), None);
    let p = stand_on(&mut world, Convoy::Trader(0), 400.0, 400.0, gold_ore());
    let t = &mut world.traders[0];
    t.heading = Heading::Post;
    t.stop = TraderStop::Storage;
    t.misses = 0.0;
    t.calls = Some(Vec::new());
    t.stand = Some(TraderStand { city_id: city.clone(), x: 490.0, y: 410.0, until: None });
    starving(&mut world, p.horse);
    run(&mut world, &terrain, &mut scratch, &mut walking(&terrain), TICKS);
    let stand = world.traders[0].stand.as_ref().expect("its stand kept");
    assert_eq!(stand.city_id, city);
    assert_eq!(stand.until, None);
    assert_eq!(world.traders[0].misses, 0.0);
    assert!(world.residents[p.driver].order.is_none());
}

#[test]
fn doesnt_give_up_driving_to_a_lost_post() {
    let World { mut world, terrain, mut scratch, post } = fixture();
    let p = stand_on(&mut world, Convoy::Trader(0), 400.0, 400.0, gold_ore());
    let t = &mut world.traders[0];
    t.post_id = post.clone();
    t.heading = Heading::Post;
    t.misses = 0.0;
    leave_trade_org(&mut world, &post);
    starving(&mut world, p.horse);
    run(&mut world, &terrain, &mut scratch, &mut walking(&terrain), TICKS);
    let t = &world.traders[0];
    assert_eq!(t.post_id, post);
    assert_eq!(t.heading, Heading::Post);
    assert_eq!(t.misses, 0.0);
    assert!(world.residents[p.driver].order.is_none());
}
