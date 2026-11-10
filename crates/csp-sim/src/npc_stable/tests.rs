//! `npc-stable.test.ts`: an NPC city feeds its stable (`CONTEXT.md`: NPC horses, NPC reserve,
//! Feeding the stable): one resident at a time runs the game's default, from what is above the
//! reserve for its people, or below that a little while its horses are hungry.

use csp_shared::balance::{
    HORSE_FOOD_PER_DAY, HORSE_HUNGRY_SHARE, HORSE_WAKE_HEALTH, MAX_HEALTH, MAX_HUNGER,
    NPC_PLAN_TICKS, NPC_STABLE_HUNGRY_DAYS, NPC_STABLE_REFILL_DAYS, NPC_TRADE, OWN_FOOD,
    STABLE_FEED_DAYS,
};
use csp_shared::footprint::{footprint_tiles, Placed};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, City, CityJobKind, Good, Horse, Resident, RunningScript, Stock, TradeOrgCity,
    WorldState,
};
use serde_json::json;

use super::npc_one_feeder;
use crate::horses::{new_horse, NewHorse, HORSE_DOWN_TICKS};
use crate::invariants::check_all;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{storage_of, village, Runner};
use crate::queries::building::building_at;
use crate::queries::city::city_food_use;
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_prices, npc_reserve};
use crate::random::Mulberry32;

const DAY: f64 = TICKS_PER_GAME_DAY;

/// Two horses' Food for `STABLE_FEED_DAYS`.
const KEEP: f64 = 2.0 * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY;

/// What the city lets go below its people's reserve for two hungry horses.
fn meals() -> f64 {
    (2.0 * NPC_STABLE_HUNGRY_DAYS * HORSE_FOOD_PER_DAY).ceil()
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

/// A village with a finished stable holding `food` on free ground by its home, and two horses in
/// it (`setup`).
fn setup(food: f64, storage_food: f64) -> Setup {
    let v = village(None);
    let (mut world, terrain, city, home) = (v.world, v.terrain, v.city, v.home);
    let (x, y) = free_spot(&world, &home, terrain.size);
    let stable = json!({
        "id": "stable1", "kind": "stable", "cityId": city, "x": x, "y": y, "stock": { "food": food },
    });
    world.buildings.push(serde_json::from_value::<Building>(stable).unwrap());
    let mut m = Mulberry32::new(5.0);
    for id in ["h1", "h2"] {
        let fields = NewHorse {
            id: id.into(),
            realm_id: None,
            city_id: Some(city.clone()),
            x: f64::from(x),
            y: f64::from(y),
            tick: world.tick as f64,
        };
        let mut h = new_horse(&mut || m.next(), fields);
        h.stats.endurance = 10.0; // the average horse's appetite
        world.horses.push(h);
    }
    let s = storage_of(&world, &city);
    world.buildings[s].stock = Some(Stock::from([(Good::Food, storage_food)]));
    for r in &mut world.residents {
        r.carried.insert(Good::Food, OWN_FOOD);
    }
    Setup { world, terrain, city }
}

/// A spot for a stable by the home, with nothing on its footprint (`freeSpot`).
fn free_spot(world: &WorldState, home: &Building, size: i32) -> (i32, i32) {
    let (hx, hy) = (home.x as i32, home.y as i32);
    for y in hy - 8..=hy + 8 {
        for x in hx - 8..=hx + 8 {
            let tiles = footprint_tiles(Placed { kind: "stable", x, y }, size);
            let free = tiles.iter().all(|&(tx, ty)| {
                building_at(world, tx, ty, size).is_none()
                    && !world.nodes.iter().any(|n| n.x as i32 == tx && n.y as i32 == ty)
            });
            if free {
                return (x, y);
            }
        }
    }
    panic!("no room for a stable")
}

fn is_feeder(r: &Resident) -> bool {
    r.script.as_ref().is_some_and(|s| {
        s.script_id == 0 && serde_json::to_value(s.task).unwrap() == json!("feedStable")
    })
}

fn feeders(world: &WorldState) -> Vec<&Resident> {
    world.residents.iter().filter(|r| is_feeder(r)).collect()
}

/// The Food a feeder's fetch order takes, if that is what they do.
fn fetching(r: &Resident) -> Option<f64> {
    let order = serde_json::to_value(r.order.as_ref()?).unwrap();
    (order["kind"] == "fetch").then(|| order["goods"]["food"].as_f64().unwrap_or(0.0))
}

fn order_kind(r: &Resident) -> Option<String> {
    let order = serde_json::to_value(r.order.as_ref()?).unwrap();
    order["kind"].as_str().map(str::to_string)
}

fn hungry(h: &Horse) -> bool {
    h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER
}

impl Setup {
    fn city(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == self.city).unwrap()
    }

    fn stable(&self) -> &Building {
        self.world.buildings.iter().find(|b| b.id == "stable1").unwrap()
    }

    fn stable_food(&self) -> f64 {
        self.stable().stock.as_ref().map_or(0.0, |s| held(s, Good::Food))
    }

    fn set_stable_food(&mut self, food: f64) {
        let b = self.world.buildings.iter_mut().find(|b| b.id == "stable1").unwrap();
        b.stock = Some(Stock::from([(Good::Food, food)]));
    }

    fn set_storage(&mut self, stock: Stock) {
        let s = storage_of(&self.world, &self.city);
        self.world.buildings[s].stock = Some(stock);
    }

    fn horse(&mut self, id: &str) -> &mut Horse {
        self.world.horses.iter_mut().find(|h| h.id == id).unwrap()
    }

    fn people_reserve(&self) -> f64 {
        city_food_use(&self.world, self.city(), NPC_TRADE.reserve_food_days)
    }

    fn reserve_food(&self) -> f64 {
        held(&npc_reserve(&self.world, self.city()), Good::Food)
    }

    /// The kinds of job the city plans now.
    fn job_kinds(&mut self) -> Vec<CityJobKind> {
        let city = self.city.clone();
        plan_city(&mut self.world, &city, Some(&self.terrain), None, None);
        self.world.city_plans[&city].jobs.values().map(|j| j.kind).collect()
    }

    /// Runs the world, with `each` seeing every tick and the invariants checked every game day
    /// (`run`).
    fn run(&mut self, ticks: f64, mut each: impl FnMut(&WorldState)) {
        let mut runner = Runner::new(&self.terrain);
        for _ in 0..ticks as u64 {
            runner.step(&mut self.world, &self.terrain);
            each(&self.world);
            if self.world.tick.is_multiple_of(DAY as u64) {
                assert_eq!(check_all(&self.world, &self.terrain), []);
            }
        }
        assert_eq!(check_all(&self.world, &self.terrain), []);
    }
}

fn ceil(x: f64) -> f64 {
    (x - 1e-9).ceil()
}

#[test]
fn keeps_what_the_stable_lacks_in_its_reserve_and_the_stables_food_counts() {
    let mut s = setup(0.0, 1000.0);
    let people = s.people_reserve();
    assert_eq!(s.reserve_food(), ceil(people + KEEP));
    s.set_stable_food(KEEP / 2.0);
    assert_eq!(s.reserve_food(), ceil(people + KEEP / 2.0));
    s.set_stable_food(KEEP * 2.0);
    assert_eq!(s.reserve_food(), ceil(people));
    // A stable still being built holds none and keeps none.
    s.set_stable_food(0.0);
    let b = s.world.buildings.iter_mut().find(|b| b.id == "stable1").unwrap();
    b.site = Some(serde_json::from_value(json!({ "delivered": {}, "work": 0 })).unwrap());
    assert_eq!(s.reserve_food(), ceil(people));
}

#[test]
fn sells_none_of_what_the_stable_lacks() {
    let mut s = setup(0.0, 1000.0);
    let line = |s: &Setup| {
        let prices = npc_city_prices(&s.world, s.city(), None);
        prices.iter().find(|p| p.good == Good::Food).unwrap().for_sale
    };
    let before = line(&s);
    s.set_stable_food(KEEP);
    assert_eq!(line(&s), before + KEEP.ceil());
}

#[test]
#[ignore = "10 s alone; see #1092"]
fn keeps_the_stable_fed_for_weeks_with_one_feeder_at_a_time() {
    let mut s = setup(0.0, 1000.0);
    let (mut most, mut lowest, mut feeder_ticks, mut went_hungry) = (0, f64::INFINITY, 0.0, false);
    let ticks = 14.0 * DAY;
    s.run(ticks, |world| {
        let out = feeders(world).len();
        most = most.max(out);
        if out > 0 {
            feeder_ticks += 1.0;
        }
        if world.tick as f64 > DAY {
            let stable = world.buildings.iter().find(|b| b.id == "stable1").unwrap();
            lowest = lowest.min(stable.stock.as_ref().map_or(0.0, |s| held(s, Good::Food)));
            // Foals the city breeds meanwhile eat from the same stable.
            went_hungry |= world.horses.iter().any(hungry);
        }
    });
    assert_eq!(most, 1);
    assert!(!went_hungry);
    assert!(s.world.horses.len() >= 2);
    assert!(lowest > 0.0);
    // They go when it runs low: most of the time they work for the city.
    assert!(feeder_ticks < ticks / 2.0);
}

#[test]
fn sends_one_resident_and_lets_them_go_once_it_is_full() {
    let mut s = setup(0.0, 1000.0);
    let city = s.city.clone();
    plan_city(&mut s.world, &city, Some(&s.terrain), None, None);
    let jobs = &s.world.city_plans[&city].jobs;
    let feed: Vec<_> = jobs.values().filter(|j| j.kind == CityJobKind::Feed).collect();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].stable_id.as_deref(), Some("stable1"));
    assert_eq!(
        serde_json::to_value(feed[0]).unwrap(),
        json!({ "kind": "feed", "stableId": "stable1" })
    );
    // Filled, the next pass lets them go.
    s.run(DAY / 2.0, |_| {});
    assert!(s.stable_food() > NPC_STABLE_REFILL_DAYS * 2.0 * HORSE_FOOD_PER_DAY);
    assert!(feeders(&s.world).is_empty());
}

#[test]
fn sends_a_farmer_when_all_it_has_is_farmers() {
    let mut s = setup(0.0, 1000.0);
    let city = s.city.clone();
    plan_city(&mut s.world, &city, Some(&s.terrain), None, None);
    let idle: Vec<String> = s.world.city_plans[&city]
        .jobs
        .iter()
        .filter(|(_, j)| j.kind == CityJobKind::Idle)
        .map(|(id, _)| id.clone())
        .collect();
    s.world.residents.retain(|r| !idle.contains(&r.id));
    assert!(s.job_kinds().contains(&CityJobKind::Feed));
}

#[test]
fn doesnt_send_one_while_the_stable_holds_enough_for_now() {
    let mut s = setup(NPC_STABLE_REFILL_DAYS * 2.0 * HORSE_FOOD_PER_DAY, 1000.0);
    assert!(!s.job_kinds().contains(&CityJobKind::Feed));
}

#[test]
fn a_short_city_feeds_its_people_first_nothing_goes_to_fed_horses_from_below_its_reserve() {
    let mut s = setup(0.0, 10.0);
    assert!(10.0 < s.people_reserve());
    assert!(!s.job_kinds().contains(&CityJobKind::Feed));
    s.run(NPC_PLAN_TICKS * 2.0, |_| {});
    assert!(feeders(&s.world).is_empty());
    assert_eq!(s.stable_food(), 0.0);
}

#[test]
fn takes_a_little_from_below_its_reserve_while_the_horses_are_hungry() {
    let mut s = setup(0.0, 20.0);
    assert!(20.0 < s.people_reserve());
    for id in ["h1", "h2"] {
        s.horse(id).hunger = HORSE_HUNGRY_SHARE * MAX_HUNGER - 1.0;
    }
    let mut stored: Vec<f64> = Vec::new();
    let mut fetched: f64 = 0.0;
    s.run(DAY / 2.0, |world| {
        if let Some(f) = feeders(world).first().and_then(|f| fetching(f)) {
            fetched = fetched.max(f);
        }
        let stable = world.buildings.iter().find(|b| b.id == "stable1").unwrap();
        stored.push(stable.stock.as_ref().map_or(0.0, |s| held(s, Good::Food)));
    });
    assert_eq!(fetched, meals());
    assert!(!s.world.horses.iter().any(hungry));
    assert!(stored.iter().copied().fold(f64::MIN, f64::max) <= meals());
}

#[test]
fn takes_only_what_is_above_its_peoples_reserve_for_fed_horses() {
    let mut s = setup(0.0, 0.0);
    let spare = 3.0;
    let food = s.people_reserve().ceil() + spare;
    s.set_storage(Stock::from([(Good::Food, food)]));
    let mut fetched: f64 = 0.0;
    s.run(NPC_PLAN_TICKS * 2.0, |world| {
        if let Some(f) = feeders(world).first().and_then(|f| fetching(f)) {
            fetched = fetched.max(f);
        }
    });
    assert!(fetched > 0.0);
    assert!(fetched <= spare);
}

#[test]
fn wakes_a_horse_that_went_down_in_the_stable() {
    let mut s = setup(0.0, 1000.0);
    let tick = s.world.tick as f64;
    let down = s.horse("h1");
    down.hunger = 0.0;
    down.health = 0.0;
    down.down_until = Some(tick + HORSE_DOWN_TICKS);
    s.run(DAY, |_| {});
    let down = s.horse("h1");
    assert_eq!(down.down_until, None);
    assert!(down.health >= HORSE_WAKE_HEALTH);
    assert_eq!(s.world.horses.len(), 2);
    assert!(s.stable_food() > 0.0);
}

#[test]
fn stands_by_a_down_horse_it_has_no_food_for_which_dies_and_stops_keeping_food_for_it() {
    let mut s = setup(0.0, 0.0);
    let tick = s.world.tick as f64;
    let down = s.horse("h1");
    down.hunger = 0.0;
    down.health = 0.0;
    down.down_until = Some(tick + NPC_PLAN_TICKS);
    s.horse("h2").health = MAX_HEALTH;
    s.run(NPC_PLAN_TICKS * 3.0, |_| {});
    assert!(!s.world.horses.iter().any(|h| h.id == "h1"));
    assert!(feeders(&s.world).is_empty());
    assert_eq!(s.stable_food(), 0.0);
    assert_eq!(s.reserve_food(), ceil(s.people_reserve() + KEEP / 2.0));
}

#[test]
fn the_feeder_goes_on_with_the_food_they_fetched_when_the_city_has_none_left_to_spare() {
    let mut s = setup(0.0, 1000.0);
    let mut runner = Runner::new(&s.terrain);
    while feeders(&s.world).first().and_then(|f| order_kind(f)).as_deref() != Some("store") {
        runner.step(&mut s.world, &s.terrain);
    }
    let feeder = feeders(&s.world)[0].id.clone();
    // On their way with it, the city runs short: no reason to carry it back.
    s.set_storage(Stock::new());
    let city = s.city.clone();
    plan_city(&mut s.world, &city, Some(&s.terrain), None, None);
    assert_eq!(
        s.world.city_plans[&city].jobs.get(&feeder).map(|j| j.kind),
        Some(CityJobKind::Feed)
    );
    s.run(DAY / 4.0, |_| {});
    assert!(s.stable_food() > 0.0);
}

#[test]
fn the_trade_organizations_cities_dont_take_part() {
    let mut s = setup(0.0, 1000.0);
    let people = ceil(s.people_reserve());
    let city = s.city.clone();
    s.world.cities.iter_mut().find(|c| c.id == city).unwrap().trade_org = Some(TradeOrgCity::Post);
    assert_eq!(s.reserve_food(), people);
    assert!(!s.job_kinds().contains(&CityJobKind::Feed));
}

#[test]
fn leaves_another_realms_horses_standing_in_it_out_of_what_it_keeps() {
    let mut s = setup(0.0, 1000.0);
    let h = s.horse("h2");
    h.realm_id = Some("r1".into());
    h.city_id = None;
    assert_eq!(s.reserve_food(), ceil(s.people_reserve() + KEEP / 2.0));
}

#[test]
fn the_invariant_catches_two_feeders_and_a_trade_org_citys() {
    let mut s = setup(0.0, 1000.0);
    let feeding = || -> RunningScript {
        serde_json::from_value(
            json!({ "scriptId": 0, "task": "feedStable", "memory": { "stableId": "stable1" } }),
        )
        .unwrap()
    };
    assert_eq!(npc_one_feeder(&s.world), []);
    s.world.residents[0].script = Some(feeding());
    assert_eq!(npc_one_feeder(&s.world), []);
    s.world.residents[1].script = Some(feeding());
    assert_eq!(npc_one_feeder(&s.world).len(), 1);
    s.world.residents[1].script = None;
    let city = s.city.clone();
    s.world.cities.iter_mut().find(|c| c.id == city).unwrap().trade_org = Some(TradeOrgCity::Post);
    assert_eq!(npc_one_feeder(&s.world).len(), 1);
}
