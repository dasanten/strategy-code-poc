//! `npc-trader.test.ts`: the NPC trader (`CONTEXT.md`: NPC trader): a city with a full load of
//! surplus sends a spare hand to a Trade Org warehouse in reach, who sells it, buys what the city
//! is short of and has no node for, and walks home. A village sends one at a time, a bigger city
//! more by its size.
//!
//! Not ported here: "a trader out in the old format carries on after the migration", which needs
//! the world format's migrations (`csp-server`'s `world_format`, which this crate can't reach).

use std::collections::HashSet;

use csp_shared::balance::{
    NpcCitySize, NPC_RESIDENTS_PER_TRADER, NPC_TOWN, NPC_TRADER_GIVE_UP_DAYS, NPC_VILLAGE,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, CityJobKind, CityTrader, Good, Stock, WorldState};

use super::{npc_traders_sound, traders_wanted};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::city::city_residents;
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::{npc_reserve, NPC_SMITHY_WEAPON};
use crate::queries::residents::can_work;
use crate::random::Mulberry32;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

/// A city and the trading post it trades with.
struct Fixture {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    warehouse: String,
}

impl Fixture {
    fn building(&self, id: &str) -> usize {
        self.world.buildings.iter().position(|b| b.id == id).expect("the building")
    }

    fn stock_mut(&mut self) -> &mut Stock {
        let i = self.building(&self.storage.clone());
        self.world.buildings[i].stock.get_or_insert_with(Stock::new)
    }

    fn held(&self, id: &str, good: Good) -> f64 {
        self.world.buildings[self.building(id)].stock.as_ref().map_or(0.0, |s| held(s, good))
    }

    fn reserve(&self) -> Stock {
        npc_reserve(&self.world, self.city())
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    fn plan(&mut self) {
        let city = self.city.clone();
        plan_city(&mut self.world, &city, Some(&self.terrain), None, None);
    }

    /// A city's trade runs under way (`runs`).
    fn runs(&self) -> Vec<CityTrader> {
        self.world.city_plans.get(&self.city).and_then(|p| p.traders.clone()).unwrap_or_default()
    }

    fn runs_mut(&mut self) -> &mut Vec<CityTrader> {
        let plan = self.world.city_plans.get_mut(&self.city).expect("a plan");
        plan.traders.get_or_insert_with(Vec::new)
    }

    /// The ids of the city's residents its plan gives the `trade` job (`traders`).
    fn traders(&self) -> Vec<String> {
        self.world
            .city_plans
            .get(&self.city)
            .map(|p| {
                p.jobs
                    .iter()
                    .filter(|(_, j)| j.kind == CityJobKind::Trade)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn post_east(world: &mut WorldState, terrain: &TerrainMap, x: f64, y: i32) -> String {
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(world, terrain, x as i32 + 500 - 14, y, None, &mut || m.next());
    world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(post.as_str()) && b.kind == BuildingKind::Warehouse)
        .expect("a warehouse")
        .id
        .clone()
}

/// A village on a Plains map with no nodes at all, and a trading post 500 tiles east of it
/// (`villageAndPost`). The village's storage holds its reserve and 60 Wood over it, Food and Stone
/// a little over; `iron_short` leaves it short of Iron (the only good short of its reserve but
/// weapons), else it holds a spear for each soldier it lacks, so nothing is short but coins.
fn village_and_post(iron_short: bool) -> Fixture {
    let terrain = plains(1200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a storage").clone();
    let warehouse = post_east(&mut world, &terrain, home.x, 20);
    let mut f = Fixture { world, terrain, city, storage: home.id, warehouse };
    *f.stock_mut() = Stock::from([(Good::Food, 400.0)]);
    let reserve = f.reserve();
    let stock = f.stock_mut();
    stock.insert(Good::Food, held(&reserve, Good::Food) + 5.0);
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + 60.0);
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + 10.0);
    stock.insert(Good::Coins, held(&reserve, Good::Coins));
    if !iron_short {
        stock.insert(NPC_SMITHY_WEAPON, held(&reserve, NPC_SMITHY_WEAPON));
    }
    f
}

/// A city of `residents` on a Plains map with no nodes at all and a trading post `tiles` east of
/// it, all at home with nothing to do (`cityAndPost`). Its storage holds its reserve of
/// everything, and `over` past it.
fn city_and_post(residents: f64, over: &[(Good, f64)], tiles: f64) -> Fixture {
    let terrain = plains(1200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let kind = NpcCitySize { residents, ..NPC_TOWN };
    let city = found_npc_city(&mut world, &terrain, &kind, 40, 40, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a storage").clone();
    let warehouse = post_east(&mut world, &terrain, home.x + tiles - 500.0, 40);
    for r in world.residents.iter_mut().filter(|r| r.city_id.as_deref() == Some(city.as_str())) {
        (r.x, r.y, r.order, r.script) = (home.x, home.y, None, None);
    }
    for b in world.buildings.iter_mut().filter(|b| {
        b.city_id.as_deref() == Some(city.as_str())
            && b.kind == BuildingKind::Storage
            && b.site.is_none()
    }) {
        b.stock = Some(Stock::new());
    }
    let mut f = Fixture { world, terrain, city, storage: home.id, warehouse };
    // Twice: with its spears in the storage, its reserve no longer asks for what makes them.
    *f.stock_mut() = f.reserve();
    let mut stock = f.reserve();
    for (good, n) in over {
        *stock.entry(*good).or_insert(0.0) += n;
    }
    *f.stock_mut() = stock;
    f
}

/// Runs the world tick by tick until `each` or `days` pass, checking the invariants each day
/// (`run`).
fn run(f: &mut Fixture, days: usize, each: &mut dyn FnMut(&Fixture) -> bool) {
    let mut runner = Runner::new(&f.terrain);
    for t in 0..days * DAY {
        runner.step(&mut f.world, &f.terrain);
        if t % DAY == 0 {
            assert_eq!(check_all(&f.world, &f.terrain), []);
        }
        if each(f) {
            break;
        }
    }
    assert_eq!(check_all(&f.world, &f.terrain), []);
}

fn at_storage(f: &Fixture, id: &str) -> bool {
    let r = f.world.residents.iter().find(|r| r.id == id).expect("the resident");
    let s = &f.world.buildings[f.building(&f.storage)];
    is_at((r.x as i32, r.y as i32), placed(s), f.terrain.size)
}

/// Sends the village's trader and follows them until their run is over: one trader at a time,
/// never a second while one is out (`followRun`). Returns the trader, and what they carried as
/// they came home to the storage, before putting it away.
fn follow_run(f: &mut Fixture) -> (Option<String>, Option<Stock>) {
    let mut trader: Option<String> = None;
    let mut home: Option<Stock> = None;
    let mut left = false;
    run(f, 12, &mut |f| {
        let t = f.runs().into_iter().next();
        assert!(f.traders().len() <= 1);
        if let Some(t) = &t {
            let id = trader.get_or_insert_with(|| t.resident_id.clone());
            assert_eq!(&t.resident_id, id);
            if !at_storage(f, id) {
                left = true;
            } else if left && home.is_none() && t.sells.is_empty() {
                let r = f.world.residents.iter().find(|r| &r.id == id).unwrap();
                home = Some(r.carried.clone());
            }
        }
        trader.is_some() && t.is_none()
    });
    (trader, home)
}

#[test]
#[ignore = "a trade run of 8 game days walked tick by tick: the NPC scripts cost ~70 µs a run to bind and interpret; T86.14 makes it fast"]
fn a_village_with_60_surplus_wood_sends_one_resident_who_comes_back_with_iron_when_iron_is_short()
{
    let mut f = village_and_post(true);
    let wood_before = f.held(&f.warehouse.clone(), Good::Wood);
    let (trader, home) = follow_run(&mut f);
    let trader = trader.expect("a trader");
    assert!(f.runs().is_empty());
    // 500 tiles there and back: days on the road.
    assert!(f.world.tick > 4 * DAY as u64);
    // They sold Wood there and brought Iron home, now in the storage.
    assert!(f.held(&f.warehouse.clone(), Good::Wood) > wood_before);
    assert!(home.as_ref().map_or(0.0, |h| held(h, Good::Iron)) > 0.0);
    assert!(f.held(&f.storage.clone(), Good::Iron) > 0.0);
    let r = f.world.residents.iter().find(|r| r.id == trader).unwrap();
    assert!(r.health > 0.0);
    assert_eq!(held(&r.carried, Good::Wood), 0.0);
}

#[test]
#[ignore = "a trade run of 8 game days walked tick by tick: the NPC scripts cost ~70 µs a run to bind and interpret; T86.14 makes it fast"]
fn with_nothing_short_it_has_no_node_for_the_trader_comes_back_with_coins() {
    let mut f = village_and_post(false);
    let coins_before = f.held(&f.storage.clone(), Good::Coins);
    let (trader, home) = follow_run(&mut f);
    assert!(trader.is_some());
    let home = home.unwrap_or_default();
    assert!(held(&home, Good::Coins) > 0.0);
    assert_eq!(held(&home, Good::Iron), 0.0);
    assert!(f.held(&f.storage.clone(), Good::Coins) > coins_before);
}

#[test]
fn a_trader_who_dies_is_replaced_only_after_the_give_up_time() {
    let mut f = village_and_post(true);
    f.plan();
    let first = f.runs()[0].resident_id.clone();
    assert_eq!(f.traders(), [first.clone()]);
    // Two traders never: the next pass keeps the one out.
    f.plan();
    assert_eq!(f.traders(), [first.clone()]);
    f.world.residents.retain(|r| r.id != first);
    f.world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY / 2.0) as u64;
    f.plan();
    assert_eq!(f.runs().first().map(|t| t.resident_id.clone()), Some(first.clone()));
    assert!(f.traders().is_empty());
    f.world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) as u64;
    f.plan();
    let next = f.runs().into_iter().next().expect("a new trader");
    assert_ne!(next.resident_id, first);
    assert_eq!(next.since, f.world.tick as f64);
}

#[test]
fn sells_a_full_load_of_its_surplus_and_plans_to_buy_the_iron_it_has_no_node_for() {
    let mut f = village_and_post(true);
    f.plan();
    let t = f.runs()[0].clone();
    assert_eq!(t.warehouse_id.as_deref(), Some(f.warehouse.as_str()));
    assert_eq!(t.sells.keys().copied().collect::<Vec<_>>(), [Good::Wood]);
    let wood = held(&t.sells, Good::Wood);
    assert!(wood > 0.0 && wood <= 60.0, "{wood}");
    assert_eq!(t.buys.keys().copied().collect::<Vec<_>>(), [Good::Iron]);
    let r = f.world.residents.iter().find(|r| r.id == t.resident_id).unwrap();
    assert!(can_work(r.born_at, f.world.tick as f64));
    let job = &f.world.city_plans[&f.city].jobs[&r.id];
    assert_eq!((job.kind, &job.building_id), (CityJobKind::Trade, &None));
}

#[test]
fn sends_no_trader_while_food_is_short_with_too_little_surplus_or_with_no_warehouse_in_reach() {
    let none = |f: &mut Fixture| {
        f.plan();
        f.runs().is_empty()
    };
    let mut short = village_and_post(true);
    short.stock_mut().insert(Good::Food, 0.0);
    assert!(none(&mut short));
    let mut little = village_and_post(true);
    let wood = held(&little.reserve(), Good::Wood) + 3.0;
    little.stock_mut().insert(Good::Wood, wood);
    assert!(none(&mut little));
    let mut far = village_and_post(true);
    far.world.buildings.retain(|b| b.kind != BuildingKind::Warehouse);
    assert!(none(&mut far));
    // Nor with an armed outsider in its area.
    let mut watched = village_and_post(true);
    let mut outsider = city_residents(&watched.world, &watched.city)[0].clone();
    let s = &watched.world.buildings[watched.building(&watched.storage)];
    outsider.id = "outsider".into();
    outsider.owner = Some("realm-x".into());
    outsider.city_id = None;
    (outsider.x, outsider.y) = (s.x, s.y);
    outsider.carried = Stock::from([(Good::Spear, 1.0)]);
    watched.world.residents.push(outsider);
    assert!(none(&mut watched));
    // And never a soldier: with every adult armed there is nobody to send.
    let mut armed = village_and_post(true);
    let city = armed.city.clone();
    for r in armed.world.residents.iter_mut().filter(|r| r.city_id.as_deref() == Some(&city)) {
        r.carried.insert(Good::Spear, 1.0);
    }
    assert!(none(&mut armed));
}

// more traders from a bigger city

/// More of each than any one load, so the number of traders is all that holds them back
/// (`plenty`). The TypeScript's also has 500 `planks`, which is no good: a Rust `Stock` can't
/// hold it, and nothing reads it.
const PLENTY: [(Good, f64); 3] = [(Good::Wood, 500.0), (Good::Stone, 500.0), (Good::Iron, 500.0)];

#[test]
fn goes_by_its_residents_and_a_village_keeps_one() {
    let count = |residents: f64| {
        let f = city_and_post(residents, &[], 500.0);
        traders_wanted(&f.world, f.city())
    };
    assert_eq!(count(NPC_VILLAGE.residents), 1);
    assert_eq!(count(NPC_TOWN.residents), 1);
    assert_eq!(count(2.0 * NPC_RESIDENTS_PER_TRADER - 1.0), 1);
    assert_eq!(count(2.0 * NPC_RESIDENTS_PER_TRADER), 2);
    assert_eq!(count(3.0 * NPC_RESIDENTS_PER_TRADER + 10.0), 3);
}

#[test]
fn a_village_with_goods_for_several_still_sends_one() {
    let mut f = city_and_post(NPC_VILLAGE.residents, &PLENTY, 500.0);
    f.plan();
    assert_eq!(f.runs().len(), 1);
    assert_eq!(f.traders().len(), 1);
    // And keeps to one on the next pass.
    f.plan();
    assert_eq!(f.runs().len(), 1);
    assert_eq!(npc_traders_sound(&f.world), []);
}

#[test]
fn a_big_city_sends_as_many_as_the_number_each_with_their_own_load_of_their_own_good() {
    let mut f = city_and_post(3.0 * NPC_RESIDENTS_PER_TRADER, &PLENTY, 500.0);
    f.plan();
    let out = f.runs();
    assert_eq!(out.len(), 3);
    let mut jobbed = f.traders();
    jobbed.sort();
    let mut ids: Vec<String> = out.iter().map(|t| t.resident_id.clone()).collect();
    ids.sort();
    assert_eq!(jobbed, ids);
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 3);
    assert!(out.iter().all(|t| t.sells.len() == 1));
    let goods: HashSet<Good> = out.iter().flat_map(|t| t.sells.keys().copied()).collect();
    assert_eq!(goods.len(), 3);
    assert!(out.iter().all(|t| t.warehouse_id.as_deref() == Some(f.warehouse.as_str())));
    assert_eq!(npc_traders_sound(&f.world), []);
    // The next pass keeps them and sends nobody more.
    f.plan();
    let again: Vec<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
    assert_eq!(again, out.iter().map(|t| t.resident_id.clone()).collect::<Vec<_>>());
    assert_eq!(f.traders().len(), 3);
}

#[test]
fn sends_no_more_than_it_has_goods_to_sell() {
    let size = 3.0 * NPC_RESIDENTS_PER_TRADER;
    let mut first = city_and_post(size, &[(Good::Wood, 500.0)], 500.0);
    first.plan();
    // With only Wood to sell and plenty of it, they all take Wood.
    let sells: Vec<Vec<Good>> =
        first.runs().iter().map(|t| t.sells.keys().copied().collect()).collect();
    assert_eq!(sells, vec![vec![Good::Wood]; 3]);
    // Each carries what fits in their own arms.
    let loads: Vec<f64> = first.runs().iter().map(|t| held(&t.sells, Good::Wood)).collect();
    let (one, two) = (loads[0], loads[1]);
    let sent = |wood: f64| {
        let mut f = city_and_post(size, &[(Good::Wood, wood)], 500.0);
        f.plan();
        f.runs().iter().map(|t| held(&t.sells, Good::Wood)).collect::<Vec<_>>()
    };
    assert_eq!(sent(one - 1.0), Vec::<f64>::new());
    assert_eq!(sent(one), [one]);
    // Less than a second load more sends no second: the first isn't fetched yet, and it is spoken
    // for.
    assert_eq!(sent(one + two - 1.0), [one]);
    assert_eq!(sent(one + two), [one, two]);
}

#[test]
fn counts_a_load_already_fetched_as_gone_from_the_storage_not_as_spoken_for() {
    let mut f = city_and_post(3.0 * NPC_RESIDENTS_PER_TRADER, &[(Good::Wood, 500.0)], 500.0);
    f.plan();
    let loads: Vec<f64> = f.runs().iter().map(|t| held(&t.sells, Good::Wood)).collect();
    let (one, two) = (loads[0], loads[1]);
    let reserve = held(&f.reserve(), Good::Wood);
    f.runs_mut().truncate(1);
    let trader = f.runs()[0].resident_id.clone();
    // Not quite both loads past the reserve: while the first is theirs to fetch, nobody else goes.
    f.stock_mut().insert(Good::Wood, reserve + one + two - 1.0);
    f.plan();
    assert_eq!(f.runs().len(), 1);
    // Fetched, it has left the storage, and what is there now makes the next one's load.
    let r = f.world.residents.iter_mut().find(|r| r.id == trader).unwrap();
    r.carried.insert(Good::Wood, one);
    f.plan();
    assert_eq!(f.runs().len(), 2);
}

#[test]
fn buys_what_is_short_only_once_between_them() {
    let mut f = city_and_post(3.0 * NPC_RESIDENTS_PER_TRADER, &PLENTY, 500.0);
    f.stock_mut().shift_remove(&NPC_SMITHY_WEAPON);
    f.stock_mut().insert(Good::Iron, 0.0);
    f.plan();
    assert!(f.runs().len() > 1);
    assert_eq!(f.runs().iter().filter(|t| held(&t.buys, Good::Iron) != 0.0).count(), 1);
}

#[test]
fn never_makes_a_trader_of_a_soldier() {
    let mut f = city_and_post(3.0 * NPC_RESIDENTS_PER_TRADER, &PLENTY, 500.0);
    let city = f.city.clone();
    let everyone: Vec<usize> = (0..f.world.residents.len())
        .filter(|&i| f.world.residents[i].city_id.as_deref() == Some(city.as_str()))
        .collect();
    for &i in &everyone {
        f.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    f.plan();
    assert!(f.runs().is_empty());
    let cut = everyone.len() - 40;
    for &i in &everyone[cut..] {
        f.world.residents[i].carried.shift_remove(&Good::Spear);
    }
    f.plan();
    let armed: HashSet<String> =
        everyone[..cut].iter().map(|&i| f.world.residents[i].id.clone()).collect();
    assert!(!f.runs().is_empty());
    assert!(f.runs().iter().all(|t| !armed.contains(&t.resident_id)));
}

#[test]
fn replaces_a_dead_trader_after_the_give_up_time_and_only_them() {
    let mut f = city_and_post(3.0 * NPC_RESIDENTS_PER_TRADER + 10.0, &PLENTY, 500.0);
    f.plan();
    let out = f.runs();
    let (dead, rest) = (out[0].resident_id.clone(), out[1..].to_vec());
    assert_eq!(rest.len(), 2);
    f.world.residents.retain(|r| r.id != dead);
    let half = (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY / 2.0) as u64;
    f.world.tick += half;
    let tick = f.world.tick as f64;
    for t in f.runs_mut().iter_mut().skip(1) {
        t.since = tick;
    }
    // Not before then: the city doesn't know.
    f.plan();
    assert!(f.runs().iter().any(|t| t.resident_id == dead));
    assert_eq!(f.traders().len(), 2);
    f.world.tick += half + 1;
    f.plan();
    let now: Vec<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
    assert_eq!(now.len(), 3);
    assert!(!now.contains(&dead));
    for t in &rest {
        assert!(now.contains(&t.resident_id));
    }
    assert_eq!(f.runs().last().unwrap().since, f.world.tick as f64);
}

#[test]
#[ignore = "two trade runs of 2 game days walked tick by tick: the NPC scripts cost ~70 µs a run to bind and interpret; T86.14 makes it fast"]
fn two_traders_walk_out_at_once_sell_their_own_loads_and_come_home() {
    let over = [(Good::Wood, 500.0), (Good::Stone, 500.0)];
    let mut f = city_and_post(2.0 * NPC_RESIDENTS_PER_TRADER, &over, 150.0);
    let warehouse = f.warehouse.clone();
    let before = (f.held(&warehouse, Good::Wood), f.held(&warehouse, Good::Stone));
    f.plan();
    let first: Vec<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
    assert_eq!(first.len(), 2);
    let mut both = false;
    run(&mut f, 6, &mut |f| {
        let out: Vec<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
        assert!(out.len() <= 2);
        if first.iter().filter(|id| !at_storage(f, id)).count() == 2 {
            both = true;
        }
        !first.iter().any(|id| out.contains(id))
    });
    assert!(both);
    let out: Vec<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
    assert!(!out.contains(&first[0]) && !out.contains(&first[1]));
    assert!(f.held(&warehouse, Good::Wood) > before.0);
    assert!(f.held(&warehouse, Good::Stone) > before.1);
}

// the invariant

/// A city with two traders out, its plan sound (`staged`).
fn staged() -> Fixture {
    let over = [(Good::Wood, 500.0), (Good::Stone, 500.0)];
    let mut f = city_and_post(2.0 * NPC_RESIDENTS_PER_TRADER, &over, 500.0);
    f.plan();
    assert_eq!(npc_traders_sound(&f.world), []);
    f
}

#[test]
fn flags_a_trade_job_with_no_run() {
    let mut f = staged();
    f.runs_mut().pop();
    assert_eq!(npc_traders_sound(&f.world).len(), 1);
}

#[test]
fn flags_one_resident_on_two_runs() {
    let mut f = staged();
    let id = f.runs()[0].resident_id.clone();
    f.runs_mut()[1].resident_id = id;
    assert!(!npc_traders_sound(&f.world).is_empty());
}

#[test]
fn flags_more_sent_than_its_size_allows_past_one_for_a_death() {
    let mut f = staged();
    let jobs = f.world.city_plans[&f.city].jobs.clone();
    let others: Vec<String> = f
        .world
        .residents
        .iter()
        .filter(|r| jobs.get(&r.id).is_none_or(|j| j.kind != CityJobKind::Trade))
        .map(|r| r.id.clone())
        .collect();
    let extra = |f: &Fixture, id: &str| CityTrader { resident_id: id.into(), ..f.runs()[0].clone() };
    let one = extra(&f, &others[0]);
    f.runs_mut().push(one);
    assert_eq!(npc_traders_sound(&f.world), []);
    let two = extra(&f, &others[1]);
    f.runs_mut().push(two);
    assert!(!npc_traders_sound(&f.world).is_empty());
}

#[test]
fn does_not_flag_more_out_than_its_size_allows_now_sent_before_it_shrank() {
    let mut f = staged();
    let kept: HashSet<String> = f.runs().iter().map(|t| t.resident_id.clone()).collect();
    let city = f.city.clone();
    f.world.residents.retain(|r| r.city_id.as_deref() != Some(city.as_str()) || kept.contains(&r.id));
    f.world.tick += 1;
    assert_eq!(npc_traders_sound(&f.world), []);
}
