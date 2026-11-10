//! `poc.test.ts` (#1038): the PoC check (`CONTEXT.md`: Haul route; epic 6). A Player's starting
//! city builds an iron mine on a far node, sets residents to work it and a carriage to haul its ore
//! home, and leaves the realm running overnight. Everything happens through orders, as the Player
//! would give them.

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, HAUL_KEEP_FOOD, MAX_HEALTH};
use csp_shared::terrain::{terrain_at, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, ResourceKind, StatName, WorldState};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::pathfinding::{PathFinder, PathOptions, PathResult, CARRIAGE_COSTS};
use crate::queries::goods::{pile_at, units_that_fit};
use crate::queries::names::held;
use crate::queries::residents::stat_value;
use crate::test_support::world_with_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

/// Ticks in a real hour: walking and driving take real time.
const REAL_HOUR: usize = 3600;
/// How long the Player sleeps: a real night, eight hours, is 20 game days.
const NIGHT: u64 = 8 * REAL_HOUR as u64;
/// The iron mine is at least this far from home, in tiles along the carriage's road.
const FAR: usize = 80;
/// Food each miner takes along for the walk out and the building: nine game days.
const MINER_FOOD: f64 = 18.0;
/// Food the driver takes along for the trip out.
const DRIVER_FOOD: f64 = 30.0;
/// Food that goes out on the carriage for the miners' night, left at the mine.
const MINERS_NIGHT_FOOD: f64 = 270.0;
/// Food for the horse on the carriage: about 15 game days.
const HORSE_FOOD: f64 = 60.0;
/// Iron ore that is home by morning at the least.
const MORNING_ORE: f64 = 30.0;

struct Scenario {
    world: WorldState,
    terrain: TerrainMap,
    queue: OrderQueue,
    walking: Walking,
    scratch: Scratch,
    requests: usize,
    storage: String,
    stable: (f64, f64),
    carriage: String,
    node: (f64, f64),
    driver: String,
    miners: Vec<String>,
}

impl Scenario {
    fn me() -> OrderSender {
        OrderSender::player(1, "Mara")
    }

    fn order(&mut self, o: Value) {
        let id = format!("q{}", self.requests);
        self.requests += 1;
        let answer = self.queue.receive(&self.world, &Self::me(), &json!(id), &o);
        assert!(matches!(answer, OrderReply::Ack { .. }), "{o}: {answer:?}");
    }

    /// Runs the world tick by tick, at least one so the orders given take effect, until `done`
    /// holds, checking the invariants every game hour (`runUntil`).
    fn run_until(&mut self, ticks: usize, done: impl Fn(&Scenario) -> bool) {
        for _ in 0..ticks {
            self.queue.apply_all(&mut self.world);
            step_world(&mut self.world, &self.terrain, &mut self.scratch, Some(&mut self.walking), None);
            if self.world.tick.is_multiple_of(150) {
                assert_eq!(check_all(&self.world, &self.terrain), []);
            }
            if done(self) {
                break;
            }
        }
        assert!(done(self), "not done by tick {}", self.world.tick);
    }

    fn r(&self, id: &str) -> &csp_shared::world::Resident {
        self.world.residents.iter().find(|r| r.id == id).expect("alive")
    }

    fn idle(&self, ids: &[String]) -> bool {
        ids.iter().all(|id| self.r(id).order.is_none())
    }

    fn at(&self, id: &str, p: (f64, f64)) -> bool {
        let r = self.r(id);
        (r.x, r.y) == p
    }

    fn crew(&self) -> Vec<String> {
        std::iter::once(self.driver.clone()).chain(self.miners.iter().cloned()).collect()
    }

    fn storage_xy(&self) -> (f64, f64) {
        let b = self.world.buildings.iter().find(|b| b.id == self.storage).unwrap();
        (b.x, b.y)
    }

    /// `r` moves `goods` from one spot on their tile to another, as many trips as it takes.
    fn shift(&mut self, r: &str, goods: &[(Good, f64)], from: Value, to: Value) {
        for &(good, units) in goods {
            let mut left = units;
            let name = serde_json::to_value(good).unwrap();
            while left > 0.0 {
                let before = held(&self.r(r).carried, good);
                let take = left.min(units_that_fit(self.r(r), good, self.world.tick as f64));
                let mut goods = serde_json::Map::new();
                goods.insert(name.as_str().unwrap().into(), json!(take));
                self.order(json!({ "kind": "pickUp", "residentId": r, "spot": from, "goods": goods }));
                let one = [r.to_string()];
                self.run_until(10, |s| s.idle(&one));
                self.order(json!({ "kind": "drop", "residentId": r, "spot": to, "goods": goods }));
                self.run_until(10, |s| s.idle(&one));
                assert_eq!(held(&self.r(r).carried, good), before);
                left -= take;
            }
        }
    }
}

fn scenario() -> Scenario {
    let (mut world, terrain) = world_with_city();
    // An average horse, so the carriage holds the `CARRIAGE_CAPACITY` the loads below are sized
    // for.
    for h in &mut world.horses {
        h.stats.speed = AVERAGE_HORSE_STATS.speed;
        h.stats.strength = AVERAGE_HORSE_STATS.strength;
        h.stats.endurance = AVERAGE_HORSE_STATS.endurance;
    }
    let realm = world.realms[0].id.clone();
    let si = world.buildings.iter().position(|b| b.kind == csp_shared::world::BuildingKind::Storage).unwrap();
    let stable = world.buildings.iter().find(|b| b.kind == csp_shared::world::BuildingKind::Stable).unwrap();
    let stable = (stable.x, stable.y);
    let carriage = world.carriages[0].id.clone();
    // Stand-in for the lumber camp and quarry the realm would have run first, and for the
    // harvests of the farms it would run: a night is 20 game days of eating for the whole realm.
    let stock = world.buildings[si].stock.get_or_insert_with(Default::default);
    stock.insert(Good::Wood, 40.0);
    stock.insert(Good::Stone, 20.0);
    stock.insert(Good::Food, held(stock, Good::Food) + 400.0);
    let (sx, sy) = (world.buildings[si].x, world.buildings[si].y);

    // The far node: the nearest iron-ore node on Hills that a carriage reaches, FAR tiles out or
    // more.
    let mut finder = PathFinder::new(Arc::new(terrain.clone()));
    let mut roads: Vec<((f64, f64), usize)> = world
        .nodes
        .iter()
        .filter(|n| {
            n.kind == ResourceKind::IronOre
                && terrain_at(&terrain, n.x as i32, n.y as i32) == Terrain::Hills as u8
        })
        .filter_map(|n| {
            let found = finder.find_path(
                (sx as i32, sy as i32),
                (n.x as i32, n.y as i32),
                &CARRIAGE_COSTS,
                PathOptions { realm_id: None, on_walls: false, near: false, area: None },
            );
            match found {
                PathResult::Found { path, .. } => Some(((n.x, n.y), path.len())),
                _ => None,
            }
        })
        .filter(|r| r.1 >= FAR)
        .collect();
    roads.sort_by_key(|r| r.1);
    let node = roads[0].0;

    // The Leader stays home on the farm. The five strongest of the rest go: the strongest drives;
    // the others mine.
    let mut rest: Vec<&csp_shared::world::Resident> =
        world.residents.iter().filter(|r| r.owner.as_deref() == Some(realm.as_str())).skip(1).collect();
    rest.sort_by(|a, b| {
        stat_value(b, StatName::Strength, 0.0).total_cmp(&stat_value(a, StatName::Strength, 0.0))
    });
    let five: Vec<String> = rest.iter().take(5).map(|r| r.id.clone()).collect();
    let terrain_arc = Arc::new(terrain.clone());
    Scenario {
        queue: OrderQueue::new(order_kinds(), Some(terrain_arc.clone())),
        walking: Walking::new(terrain_arc),
        scratch: Scratch::default(),
        requests: 0,
        storage: world.buildings[si].id.clone(),
        stable,
        carriage,
        node,
        driver: five[0].clone(),
        miners: five[1..].to_vec(),
        world,
        terrain,
    }
}

#[test]
#[ignore = "14.9 s alone; see #1092"]
fn runs_a_realm_through_the_night_with_a_far_iron_mine_and_a_haul_route() {
    let mut s = scenario();
    let (driver, miners, crew) = (s.driver.clone(), s.miners.clone(), s.crew());
    let storage = s.storage_xy();
    let (node, carriage) = (s.node, s.carriage.clone());
    let on_carriage = json!({ "kind": "carriage", "carriageId": carriage });
    let in_storage = json!({ "kind": "storage", "storageId": s.storage });

    // Evening. The driver fetches the carriage; the miners walk into the city to the storage.
    s.order(json!({ "kind": "walkTo", "residentId": driver, "x": s.stable.0, "y": s.stable.1 }));
    for m in &miners {
        s.order(json!({ "kind": "walkTo", "residentId": m, "x": storage.0, "y": storage.1 }));
    }
    s.run_until(TICKS_PER_GAME_DAY as usize, |s| s.idle(&crew));
    s.order(json!({ "kind": "drive", "residentId": driver, "carriageId": carriage,
        "x": storage.0, "y": storage.1 }));
    let d = [driver.clone()];
    s.run_until(TICKS_PER_GAME_DAY as usize, |s| s.idle(&d) && s.at(&d[0], storage));

    // The mine's materials go on the carriage, and Food for the horse and the miners' night. The
    // miners take Food for the walk and the building, the driver for the trip out.
    s.shift(&miners[0], &[(Good::Wood, 20.0)], in_storage.clone(), on_carriage.clone());
    s.shift(&miners[1], &[(Good::Wood, 20.0)], in_storage.clone(), on_carriage.clone());
    s.shift(&miners[2], &[(Good::Stone, 20.0)], in_storage.clone(), on_carriage.clone());
    s.shift(&miners[3], &[(Good::Food, HORSE_FOOD + MINERS_NIGHT_FOOD)], in_storage.clone(), on_carriage.clone());
    for m in &miners {
        s.order(json!({ "kind": "pickUp", "residentId": m, "spot": in_storage, "goods": { "food": MINER_FOOD } }));
    }
    s.order(json!({ "kind": "pickUp", "residentId": driver, "spot": in_storage, "goods": { "food": DRIVER_FOOD } }));
    s.run_until(10, |s| s.idle(&crew));

    // Off to the node: the miners walk, the driver drives the materials there.
    s.order(json!({ "kind": "drive", "residentId": driver, "carriageId": carriage, "x": node.0, "y": node.1 }));
    for m in &miners {
        s.order(json!({ "kind": "walkTo", "residentId": m, "x": node.0, "y": node.1 }));
    }
    s.run_until(3 * REAL_HOUR, |s| crew.iter().all(|r| s.r(r).order.is_none() && s.at(r, node)));

    // The miners lay out the mine and build it; the driver unloads the materials onto the site.
    s.order(json!({ "kind": "build", "residentId": miners[0], "building": "mine" }));
    s.run_until(10, |s| s.world.buildings.iter().any(|b| (b.x, b.y) == node));
    let mine = s.world.buildings.iter().find(|b| (b.x, b.y) == node).unwrap().id.clone();
    for m in &miners[1..] {
        s.order(json!({ "kind": "build", "residentId": m, "building": "mine" }));
    }
    let site = json!({ "kind": "site", "siteId": mine });
    s.shift(&driver, &[(Good::Wood, 40.0), (Good::Stone, 20.0)], on_carriage.clone(), site);
    let built = |s: &Scenario| s.world.buildings.iter().any(|b| b.id == mine && b.site.is_none());
    s.run_until(3 * TICKS_PER_GAME_DAY as usize, built);
    s.run_until(10, |s| s.idle(&miners));

    // Night falls: the driver leaves the miners' Food at the mine, where they take their meals;
    // the miners work it and the driver hauls its ore home.
    s.shift(&driver, &[(Good::Food, MINERS_NIGHT_FOOD)], on_carriage, json!({ "kind": "ground" }));
    for m in &miners {
        s.order(json!({ "kind": "workAt", "residentId": m }));
    }
    s.order(json!({ "kind": "haul", "residentId": driver, "carriageId": carriage,
        "x": storage.0, "y": storage.1, "goods": ["ironOre"], "keepFood": HAUL_KEEP_FOOD }));
    let evening = s.world.tick;
    let ore_home = |s: &Scenario| {
        let b = s.world.buildings.iter().find(|b| b.id == s.storage).unwrap();
        b.stock.as_ref().map_or(0.0, |st| held(st, Good::IronOre))
    };
    let dug = |s: &Scenario| {
        let k = s.world.carriages.iter().find(|k| k.id == carriage).unwrap();
        ore_home(s)
            + pile_at(&s.world, node.0, node.1).map_or(0.0, |p| held(&p.goods, Good::IronOre))
            + held(&k.load, Good::IronOre)
            + crew.iter().map(|r| held(&s.r(r).carried, Good::IronOre)).sum::<f64>()
    };

    // The Player sleeps; nobody gives an order all night.
    s.run_until(NIGHT as usize, |s| s.world.tick >= evening + NIGHT);

    // Morning: everyone is alive and still at it, and most of the night's iron ore is home.
    assert_eq!(s.world.realms.len(), 1);
    for r in &crew {
        assert!(s.world.residents.iter().any(|x| &x.id == r), "{r} is gone");
    }
    for m in &miners {
        assert_eq!(s.r(m).health, MAX_HEALTH);
    }
    // A round trip takes about 2.5 game days, so the driver goes a little hungry on the way and
    // heals at home.
    assert!(s.r(&driver).health > 0.9 * MAX_HEALTH);
    for m in &miners {
        let o = serde_json::to_value(&s.r(m).order).unwrap();
        assert_eq!((o["kind"].clone(), o["buildingId"].clone()), (json!("workAt"), json!(mine)));
    }
    let o = serde_json::to_value(&s.r(&driver).order).unwrap();
    assert_eq!((o["kind"].clone(), o["goods"].clone()), (json!("haul"), json!(["ironOre"])));
    let horse = s.world.carriages.iter().find(|k| k.id == carriage).unwrap().horse_id.clone();
    assert!(s.world.horses.iter().any(|h| Some(&h.id) == horse.as_ref()));
    assert!(ore_home(&s) >= MORNING_ORE, "{}", ore_home(&s));
    assert!(ore_home(&s) / dug(&s) > 0.6, "{} of {}", ore_home(&s), dug(&s));
    assert_eq!(check_all(&s.world, &s.terrain), []);
}
