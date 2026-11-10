//! `apps/server/src/supply-wagons.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{wagon_food_for, CRIME_STANDING_LOSS, TRADE_ORG_ARMY};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{CrimeKind, Resident, WorldState};
use serde_json::{json, Value};

use super::*;
use crate::horses::horses_down_lie_still;
use crate::invariants::check_all;
use crate::queries::names::held_in;
use crate::queries::residents::stock_weight;
use crate::queries::trade_org::punishers;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_punishment::{step_punishments, took_so_far, waiting_on_the_road};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 640;
const MID: f64 = 320.0;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: City,
    walking: Walking,
    scratch: Scratch,
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// A grown resident of realm r1.
fn resident(world: &mut WorldState, id: &str, x: f64, y: f64, city: Option<&str>) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some("r1"), city_id: city, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

/// The HQ's own residents, by index.
fn hq_people(world: &WorldState, hq: &str) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none() && world.residents[i].city_id.as_deref() == Some(hq)
        })
        .collect()
}

/// The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 4 soldiers and the rest of its
/// people at hand; realm r1 (Leader a1) with city c1 south of it, its storage s1 holding `s1`.
fn setup(s1: Stock) -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID as i32, MID as i32, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), MID, MID + 88.0, None);
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "s1", "kind": "storage", "cityId": "c1", "x": MID + 4.0, "y": MID + 88.0, "stock": s1,
        }))
        .unwrap(),
    );
    resident(&mut world, "a1", MID - 4.0, MID + 92.0, Some("c1"));
    for i in hq_people(&world, &hq).into_iter().take(TRADE_ORG_ARMY.guard as usize + 4) {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    let hq = world.cities.iter().find(|c| c.id == hq).unwrap().clone();
    let walking = Walking::new(Arc::new(terrain.clone()));
    Setup { world, terrain, hq, walking, scratch: Scratch::default() }
}

fn default_setup() -> Setup {
    setup(stock(&[(Good::Coins, 1000.0)]))
}

/// A1 of r1 stole `goods` from the HQ, and the Trade Organization knows it and holds it lower.
fn theft(world: &mut WorldState, hq: &City, goods: Stock) {
    world.crimes.push(
        serde_json::from_value(json!({
            "id": format!("x{}", world.crimes.len() + 1), "kind": "theft", "tick": world.tick,
            "x": MID, "y": MID + 60.0,
            "culprit": { "residentId": "a1", "name": "Aldo", "org": "r1", "orgName": "the realm of Aldo" },
            "victimOrg": hq.id, "goods": goods, "witnesses": [], "knownBy": [hq.id],
        }))
        .unwrap(),
    );
    change_standing(world, &hq.id, "r1", -CRIME_STANDING_LOSS.theft);
}

/// Steps the world, keeping everyone fed, and checks every invariant now and then.
fn run(s: &mut Setup, ticks: usize, until: &mut dyn FnMut(&WorldState) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 200 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), vec![]);
        }
        if until(&s.world) {
            break;
        }
    }
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

fn never(_: &WorldState) -> bool {
    false
}

fn at<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn at_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

/// The ids of the world's only supply wagon, its carriage and the punishment it follows.
struct Off {
    p: String,
    wagon: String,
    carriage: String,
}

impl Off {
    fn wagon<'w>(&self, w: &'w WorldState) -> &'w SupplyWagon {
        w.supply_wagons.iter().find(|x| x.id == self.wagon).unwrap()
    }
    fn wagon_mut<'w>(&self, w: &'w mut WorldState) -> &'w mut SupplyWagon {
        w.supply_wagons.iter_mut().find(|x| x.id == self.wagon).unwrap()
    }
    fn carriage<'w>(&self, w: &'w WorldState) -> &'w csp_shared::world::Carriage {
        w.carriages.iter().find(|k| k.id == self.carriage).unwrap()
    }
    fn carriage_mut<'w>(&self, w: &'w mut WorldState) -> &'w mut csp_shared::world::Carriage {
        w.carriages.iter_mut().find(|k| k.id == self.carriage).unwrap()
    }
    fn p<'w>(&self, w: &'w WorldState) -> &'w Punishment {
        w.punishments.iter().find(|x| x.id == self.p).unwrap()
    }
    fn p_mut<'w>(&self, w: &'w mut WorldState) -> &'w mut Punishment {
        w.punishments.iter_mut().find(|x| x.id == self.p).unwrap()
    }
    fn members(&self, w: &WorldState) -> Vec<String> {
        self.p(w).members.iter().map(|m| m.resident_id.clone()).collect()
    }
    fn driver(&self, w: &WorldState) -> String {
        self.wagon(w).driver_id.clone().unwrap()
    }
    fn horse<'w>(&self, w: &'w mut WorldState) -> &'w mut csp_shared::world::Horse {
        let id = self.carriage(w).horse_id.clone();
        w.horses.iter_mut().find(|h| Some(&h.id) == id.as_ref()).unwrap()
    }
}

fn the_wagon(world: &WorldState) -> Off {
    let w = &world.supply_wagons[0];
    Off {
        p: w.punishment_id.clone().unwrap_or_default(),
        wagon: w.id.clone(),
        carriage: w.carriage_id.clone(),
    }
}

/// Sets a punishment off and runs it until its wagon has set off after its soldiers.
fn set_off(s: &mut Setup, goods: Stock) -> Off {
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, goods);
    run(s, 1, &mut never);
    let off = the_wagon(&s.world);
    let (w, p) = (off.wagon.clone(), off.p.clone());
    run(s, 2000, &mut |world| {
        let loaded =
            world.supply_wagons.iter().find(|x| x.id == w).is_some_and(|x| x.loaded == Some(true));
        let packed = world
            .punishments
            .iter()
            .find(|x| x.id == p)
            .is_some_and(|x| x.members.iter().all(|m| m.packed == Some(true)));
        loaded && packed
    });
    run(s, 2 * TRADE_ORG_PUNISH.wagon_retry_ticks as usize, &mut never);
    off
}

fn iron(n: f64) -> Stock {
    stock(&[(Good::Iron, n)])
}

fn order_of(v: Value) -> ResidentOrder {
    serde_json::from_value(v).unwrap()
}

fn dist_to(w: &WorldState, id: &str, to: (f64, f64)) -> f64 {
    let r = at(w, id);
    wrap_distance(SIZE, tile(r.x, r.y), tile(to.0, to.1))
}

#[test]
fn sets_out_with_the_army_a_carriage_of_the_hq_a_driver_of_its_own_and_food() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let w = &s.world;
    assert_eq!(off.wagon(w).punishment_id.as_ref(), Some(&off.p));
    let k = off.carriage(w);
    assert_eq!((k.realm_id.as_deref(), k.city_id.as_deref()), (None, Some(s.hq.id.as_str())));
    assert!(k.horse_id.is_some());
    let driver = off.driver(w);
    assert!(!off.members(w).contains(&driver));
    assert!(punishers(w).contains(&driver));
    assert!(held(&k.load, Good::Food) > 0.0);
    assert_eq!(off.wagon(w).own_food, held(&k.load, Good::Food));
    // What it set out with is its own, not what it came to take.
    assert_eq!(took_so_far(w, off.p(w)), 0.0);
}

#[test]
fn keeps_room_free_of_food_for_what_the_army_takes_however_far_it_goes() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, iron(10.0));
    run(&mut s, 1, &mut never);
    let off = the_wagon(&s.world);
    off.wagon_mut(&mut s.world).food = wagon_food_for(4000.0, 8.0);
    assert!(off.wagon(&s.world).food > carriage_capacity(&s.world, off.carriage(&s.world)));
    let storage = s
        .world
        .buildings
        .iter_mut()
        .find(|b| b.city_id.as_ref() == Some(&hq.id) && b.kind == BuildingKind::Storage)
        .unwrap();
    storage.stock.get_or_insert_with(Stock::new).insert(Good::Food, 1000.0);
    let w = off.wagon.clone();
    run(&mut s, 2000, &mut |world| {
        world.supply_wagons.iter().find(|x| x.id == w).is_some_and(|x| x.loaded == Some(true))
    });
    let k = off.carriage(&s.world);
    assert!(carriage_capacity(&s.world, k) - stock_weight(&k.load) >= TRADE_ORG_PUNISH.wagon_room);
    assert!(held(&k.load, Good::Food) > 0.0);
}

#[test]
fn goes_without_when_the_hq_has_nobody_free_to_drive_it() {
    let mut s = default_setup();
    s.world.residents.retain(|r| r.owner.is_some() || r.carried.contains_key(&Good::Spear));
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, iron(10.0));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments.len(), 1);
    assert!(s.world.supply_wagons.is_empty());
}

#[test]
#[ignore = "6.1 s alone; see #1092"]
fn follows_the_army_along_the_road() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let p = off.p.clone();
    run(&mut s, 2000, &mut |w| {
        w.punishments.iter().find(|x| x.id == p).is_some_and(|x| x.arrived_at.is_some())
    });
    assert!(off.p(&s.world).arrived_at.is_some());
    let driver = off.driver(&s.world);
    let o = &at(&s.world, &driver).order;
    assert!(matches!(o, Some(ResidentOrder::Drive(d)) if d.army.as_ref() == Some(&p)), "{o:?}");
    run(&mut s, 60, &mut never);
    let k = off.carriage(&s.world);
    let kxy = (k.x, k.y);
    let near = off
        .members(&s.world)
        .iter()
        .map(|id| dist_to(&s.world, id, kxy))
        .fold(f64::INFINITY, f64::min);
    assert!(near <= 8.0, "{near}");
    let c1 = s.world.cities.iter().find(|c| c.id == "c1").unwrap();
    let hall = town_hall_of(&s.world, c1).unwrap();
    assert!(wrap_distance(SIZE, tile(k.x, k.y), tile(hall.x, hall.y)) < 40.0);
}

#[test]
fn drives_to_where_the_army_is_when_far_behind_and_goes_after_it_step_by_step_once_near() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let driver = off.driver(&s.world);
    let (kx, ky) = (off.carriage(&s.world).x, off.carriage(&s.world).y);
    let members = off.members(&s.world);
    let reach = TRADE_ORG_PUNISH.wagon_follow_reach;
    // Fallen far behind every soldier, while going after them step by step.
    for id in &members {
        let r = at_mut(&mut s.world, id);
        r.x = kx + 3.0 * reach;
        r.y = ky;
    }
    let (mx, my) = (at(&s.world, &members[0]).x, at(&s.world, &members[0]).y);
    let d = at_mut(&mut s.world, &driver);
    d.x = kx;
    d.y = ky;
    let horse = off.horse(&mut s.world);
    horse.x = kx;
    horse.y = ky;
    at_mut(&mut s.world, &driver).order = Some(order_of(json!({
        "kind": "drive", "carriageId": off.carriage, "target": { "x": mx, "y": my },
        "path": null, "progress": 0, "army": off.p,
    })));
    step_punishments(&mut s.world, SIZE);
    let o = &at(&s.world, &driver).order;
    assert!(
        matches!(o, Some(ResidentOrder::Drive(d)) if d.target.x == mx && d.target.y == my && d.army.is_none()),
        "{o:?}"
    );
    // Caught up: the army's own soldiers are near again.
    for id in &members {
        let r = at_mut(&mut s.world, id);
        r.x = kx + 4.0;
        r.y = ky;
    }
    step_punishments(&mut s.world, SIZE);
    let o = &at(&s.world, &driver).order;
    assert!(matches!(o, Some(ResidentOrder::Drive(d)) if d.army.as_ref() == Some(&off.p)), "{o:?}");
}

/// A busy world's pathfinder (bug #993): the walking with no budget a tick, so no search settles
/// within the tick it starts (`requestSteps(world, 0)`).
struct Busy<'a>(&'a mut Walking);

impl crate::tick::Walk for Busy<'_> {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.0.request_steps(world, scratch, 0.0);
        self.0.resolve(world, scratch, &steps);
        steps.len()
    }

    fn ways(&mut self) -> Option<&mut dyn crate::npc_roads::WayFinder> {
        Some(&mut *self.0)
    }
}

#[test]
fn stands_where_it_is_while_its_horse_is_down_its_driver_given_no_drive_order() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let driver = off.driver(&s.world);
    // Nothing on board for the horse, which goes Down next tick.
    off.carriage_mut(&mut s.world).load.shift_remove(&Good::Food);
    off.wagon_mut(&mut s.world).own_food = 0.0;
    let horse = off.horse(&mut s.world);
    horse.hunger = 0.0;
    horse.health = 1e-9;
    let from = (off.carriage(&s.world).x, off.carriage(&s.world).y);
    let mut busy = Busy(&mut s.walking);
    for _ in 0..3 * TRADE_ORG_PUNISH.wagon_retry_ticks as usize {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut busy), None);
        let o = &at(&s.world, &driver).order;
        assert!(o.is_none(), "{o:?}");
        assert_eq!(horses_down_lie_still(&s.world), vec![]);
    }
    assert!(off.horse(&mut s.world).down_until.is_some());
    assert_eq!((off.carriage(&s.world).x, off.carriage(&s.world).y), from);
}

#[test]
fn feeds_its_soldiers_and_its_driver_on_the_way() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let m = off.members(&s.world)[0].clone();
    let driver = off.driver(&s.world);
    // Out on the road, far from any storage of the HQ.
    let road = (MID + 200.0, MID);
    let k = off.carriage_mut(&mut s.world);
    k.x = road.0;
    k.y = road.1;
    let horse = off.horse(&mut s.world);
    horse.x = road.0;
    horse.y = road.1;
    for id in [&driver, &m] {
        let r = at_mut(&mut s.world, id);
        r.x = road.0;
        r.y = road.1;
        r.order = None;
    }
    at_mut(&mut s.world, &m).carried.insert(Good::Food, 0.0);
    off.p_mut(&mut s.world).members[0].own.insert(Good::Food, 0.0);
    let ki = s.world.carriages.iter().position(|k| k.id == off.carriage).unwrap();
    let mi = s.world.residents.iter().position(|r| r.id == m).unwrap();
    let di = s.world.residents.iter().position(|r| r.id == driver).unwrap();
    assert_eq!(wagon_food(&s.world, mi, SIZE), Some(ki));
    assert_eq!(wagon_food(&s.world, di, SIZE), Some(ki));
    let before = held(&off.carriage(&s.world).load, Good::Food);
    run(&mut s, 2, &mut never);
    assert!(held(&at(&s.world, &m).carried, Good::Food) > 0.0);
    assert!(held(&off.carriage(&s.world).load, Good::Food) < before);
    // A meal from it is no theft, and doesn't look like what it came to take.
    assert!(s.world.crimes.iter().all(|c| c.culprit.resident_id != m));
    assert_eq!(took_so_far(&s.world, off.p(&s.world)), 0.0);
    // Anyone else eats nothing from it.
    let other = resident(&mut s.world, "a2", road.0, road.1, Some("c1"));
    assert_eq!(wagon_food(&s.world, other, SIZE), None);
}

#[test]
fn has_a_soldier_out_of_food_go_to_meet_it_when_it_is_out_of_reach() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let members = off.members(&s.world);
    let (kx, ky) = (off.carriage(&s.world).x, off.carriage(&s.world).y);
    off.p_mut(&mut s.world).members[0].own.insert(Good::Food, 0.0);
    for id in &members {
        let r = at_mut(&mut s.world, id);
        r.x = kx + 30.0;
        r.y = ky;
    }
    let r = at_mut(&mut s.world, &members[0]);
    r.carried.insert(Good::Food, 0.0);
    r.order = None;
    step_punishments(&mut s.world, SIZE);
    let o = &at(&s.world, &members[0]).order;
    assert!(
        matches!(o, Some(ResidentOrder::WalkTo(w)) if w.target.x == kx && w.target.y == ky),
        "{o:?}"
    );
}

#[test]
fn keeps_its_soldiers_together_on_the_road_at_the_pace_of_the_slowest() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let members = off.members(&s.world);
    let (a, b) = (members[0].clone(), members[1].clone());
    let c1 = s.world.cities.iter().find(|c| c.id == "c1").unwrap();
    let hall = town_hall_of(&s.world, c1).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let walk = |n: usize| {
        order_of(json!({
            "kind": "walkTo", "target": { "x": hx, "y": hy },
            "path": vec![[1, 1]; n], "progress": 0,
        }))
    };
    for id in &members {
        at_mut(&mut s.world, id).order = None;
    }
    at_mut(&mut s.world, &a).order = Some(walk(10));
    at_mut(&mut s.world, &b).order = Some(walk(40));
    assert_eq!(waiting_on_the_road(&s.world, SIZE), HashSet::from([a.clone()]));
    at_mut(&mut s.world, &a).order = Some(walk(38));
    assert!(waiting_on_the_road(&s.world, SIZE).is_empty());
    // Not at the city, where each goes their own way.
    at_mut(&mut s.world, &a).order = Some(walk(10));
    let tick = s.world.tick as f64;
    off.p_mut(&mut s.world).arrived_at = Some(tick);
    assert!(waiting_on_the_road(&s.world, SIZE).is_empty());
}

#[test]
fn takes_on_what_the_soldiers_take_and_carries_more_home_than_they_could() {
    // More than four soldiers could ever carry at once, so what they take goes on the wagon.
    let mut s = setup(iron(300.0));
    let hq = s.hq.id.clone();
    let warehouse = s
        .world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_ref() == Some(&hq) && warehouse_keeps(&s.world, b).contains(&Good::Iron)
        })
        .unwrap();
    // Nobody at work at the HQ but those on the trip, so its own chain leaves its Iron be.
    let off = set_off(&mut s, iron(100.0));
    let driver = off.driver(&s.world);
    s.world
        .residents
        .retain(|r| r.owner.is_some() || r.carried.contains_key(&Good::Spear) || r.id == driver);
    let before = held_in(s.world.buildings[warehouse].stock.as_ref(), Good::Iron);
    let worth = TRADE_ORG_PUNISH.times * worth_of(&iron(100.0));
    let mut most: f64 = 0.0;
    let (p, k) = (off.p.clone(), off.carriage.clone());
    run(&mut s, (10.0 * TICKS_PER_GAME_DAY) as usize, &mut |w| {
        if let Some(k) = w.carriages.iter().find(|x| x.id == k) {
            most = most.max(held(&k.load, Good::Iron));
        }
        w.punishments
            .iter()
            .find(|x| x.id == p)
            .is_some_and(|x| x.heading == PunishmentHeading::Home)
    });
    assert_eq!(off.p(&s.world).heading, PunishmentHeading::Home);
    assert_eq!(off.p(&s.world).took, worth);
    assert!(most > 0.0);
    assert!(took_so_far(&s.world, off.p(&s.world)) >= worth);
    run(&mut s, (10.0 * TICKS_PER_GAME_DAY) as usize, &mut |w| w.supply_wagons.is_empty());
    assert!(s.world.punishments.is_empty());
    assert!(s.world.supply_wagons.is_empty());
    // All of it reached the warehouse, and the carriage and horse went back into the HQ's stock.
    assert_eq!(held_in(s.world.buildings[warehouse].stock.as_ref(), Good::Iron) - before, 200.0);
    let s1 = s.world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(held_in(s1.stock.as_ref(), Good::Iron), 100.0);
    assert!(!s.world.carriages.iter().any(|x| x.id == off.carriage));
    // Its driver is back with the HQ.
    assert!(!punishers(&s.world).contains(&driver));
    let d = at(&s.world, &driver);
    assert!(crate::queries::city_area::in_city_area(&s.world, &hq, d.x, d.y, SIZE));
}

#[test]
fn unloads_its_leftover_food_at_home_too() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let members = off.members(&s.world);
    off.wagon_mut(&mut s.world).punishment_id = None;
    s.world.punishments.retain(|x| x.id != off.p);
    for id in &members {
        at_mut(&mut s.world, id).order = None;
    }
    let hq = s.hq.id.clone();
    let food = |w: &WorldState| -> f64 {
        w.buildings
            .iter()
            .filter(|b| b.city_id.as_ref() == Some(&hq) && b.kind == BuildingKind::Warehouse)
            .map(|b| held_in(b.stock.as_ref(), Good::Food))
            .sum()
    };
    let on = held(&off.carriage(&s.world).load, Good::Food);
    let before = food(&s.world);
    run(&mut s, 3000, &mut |w| w.supply_wagons.is_empty());
    assert!(s.world.supply_wagons.is_empty());
    assert!(food(&s.world) >= before + on - 40.0);
}

#[test]
fn is_robbed_like_a_caravan_a_crime_and_its_soldiers_go_after_the_thief() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let (kx, ky) = (off.carriage(&s.world).x, off.carriage(&s.world).y);
    let thief = resident(&mut s.world, "a2", kx, ky, Some("c1"));
    let pick = order_of(json!({
        "kind": "pickUp", "from": { "kind": "carriage", "carriageId": off.carriage },
        "goods": { "food": 5 },
    }));
    s.world.residents[thief].order = Some(pick.clone());
    let before = held(&off.carriage(&s.world).load, Good::Food);
    step_punishments(&mut s.world, SIZE);
    for id in off.members(&s.world) {
        let o = &at(&s.world, &id).order;
        assert!(matches!(o, Some(ResidentOrder::Attack(a)) if a.target_id == "a2"), "{o:?}");
    }
    // The carriage moves on, so the thief keeps up with it until they get a hold of something.
    for _ in 0..30 {
        if held(&at(&s.world, "a2").carried, Good::Food) > 0.0 {
            break;
        }
        let (kx, ky) = (off.carriage(&s.world).x, off.carriage(&s.world).y);
        let t = at_mut(&mut s.world, "a2");
        t.x = kx;
        t.y = ky;
        t.order = Some(pick.clone());
        run(&mut s, 1, &mut never);
    }
    assert!(held(&off.carriage(&s.world).load, Good::Food) < before);
    assert!(held(&at(&s.world, "a2").carried, Good::Food) > 0.0);
    let last = s.world.crimes.last().unwrap();
    assert_eq!(last.kind, CrimeKind::Theft);
    assert_eq!(last.victim_org, s.hq.id);
    assert_eq!(last.culprit.resident_id, "a2");
}

#[test]
fn counts_no_more_than_is_left_on_it_so_a_robbed_army_takes_again() {
    let mut s = setup(iron(100.0));
    let off = set_off(&mut s, iron(10.0));
    off.carriage_mut(&mut s.world).load.insert(Good::Iron, 10.0);
    assert_eq!(took_so_far(&s.world, off.p(&s.world)), worth_of(&iron(10.0)));
    off.carriage_mut(&mut s.world).load.shift_remove(&Good::Iron);
    assert_eq!(took_so_far(&s.world, off.p(&s.world)), 0.0);
    assert_eq!(off.wagon(&s.world).own_food, held(&off.carriage(&s.world).load, Good::Food));
}

#[test]
fn cant_be_stolen_while_its_driver_or_soldiers_hold_it_and_is_gone_for_them_once_it_is() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    // Off on its own, with the soldiers out of its way, and stopped for a moment.
    let park = (MID + 200.0, MID);
    let k = off.carriage_mut(&mut s.world);
    (k.x, k.y) = park;
    let horse = off.horse(&mut s.world);
    (horse.x, horse.y) = park;
    resident(&mut s.world, "a2", park.0, park.1, Some("c1"));
    let driver = off.driver(&s.world);
    let d = at_mut(&mut s.world, &driver);
    (d.x, d.y) = park;
    let problem = |w: &WorldState| {
        crate::queries::driving::drive_off_problem(w, at(w, "a2"), off.carriage(w), "r1", SIZE)
    };
    assert_eq!(problem(&s.world).as_deref(), Some("someone is driving that carriage"));
    at_mut(&mut s.world, &driver).order = None;
    assert_eq!(problem(&s.world).as_deref(), Some("its driver is still with that supply wagon"));
    at_mut(&mut s.world, &driver).x = park.0 - 100.0;
    let soldier = off.members(&s.world)[0].clone();
    let r = at_mut(&mut s.world, &soldier);
    let was = (r.x, r.y);
    (r.x, r.y) = park;
    assert_eq!(problem(&s.world).as_deref(), Some("its escort guards that supply wagon"));
    let r = at_mut(&mut s.world, &soldier);
    (r.x, r.y) = was;
    assert_eq!(problem(&s.world), None);
    let load = off.carriage(&s.world).load.clone();
    let ki = s.world.carriages.iter().position(|k| k.id == off.carriage).unwrap();
    let hid = off.carriage(&s.world).horse_id.clone();
    let hi = s.world.horses.iter().position(|h| Some(&h.id) == hid.as_ref());
    crate::movement_pending::take_over(
        &mut s.world,
        "a2",
        "r1",
        crate::movement_pending::Taken { carriage: Some(ki), horse: hi },
        SIZE,
    );
    assert_eq!(off.carriage(&s.world).realm_id.as_deref(), Some("r1"));
    assert_eq!(off.carriage(&s.world).load, load);
    assert!(s.world.supply_wagons.is_empty());
    let last = s.world.crimes.last().unwrap();
    assert_eq!((last.kind, last.carriage), (CrimeKind::Theft, Some(true)));
    assert!(!punishers(&s.world).contains(&driver));
    // Its soldiers go on with what they carry.
    assert_eq!(
        s.world.punishments.iter().map(|x| x.id.clone()).collect::<Vec<_>>(),
        std::slice::from_ref(&off.p)
    );
    let p = off.p.clone();
    run(&mut s, 2000, &mut |w| {
        w.punishments.iter().find(|x| x.id == p).is_some_and(|x| x.arrived_at.is_some())
    });
    assert!(off.p(&s.world).arrived_at.is_some());
}

#[test]
fn has_a_soldier_take_over_from_a_driver_who_died_bringing_on_board_what_they_took() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let driver = off.driver(&s.world);
    s.world.residents.retain(|r| r.id != driver);
    let (kx, ky) = (off.carriage(&s.world).x, off.carriage(&s.world).y);
    let members = off.members(&s.world);
    // `reduce` keeping `a` while it is no farther: the first of the nearest.
    let mut taker = members[0].clone();
    for id in &members[1..] {
        if dist_to(&s.world, &taker, (kx, ky)) > dist_to(&s.world, id, (kx, ky)) {
            taker = id.clone();
        }
    }
    at_mut(&mut s.world, &taker).carried.insert(Good::Iron, 3.0);
    let soldiers = members.len();
    step_punishments(&mut s.world, SIZE);
    assert_eq!(off.wagon(&s.world).driver_id.as_ref(), Some(&taker));
    assert_eq!(off.p(&s.world).members.len(), soldiers - 1);
    assert!(!off.members(&s.world).contains(&taker));
    let k = off.carriage.clone();
    run(&mut s, 400, &mut |w| {
        w.carriages.iter().find(|x| x.id == k).is_some_and(|x| held(&x.load, Good::Iron) == 3.0)
    });
    assert_eq!(held(&off.carriage(&s.world).load, Good::Iron), 3.0);
    assert_eq!(held(&at(&s.world, &taker).carried, Good::Iron), 0.0);
}

#[test]
fn leaves_the_last_soldier_a_soldier_and_the_hq_sends_a_new_driver_who_packs_for_the_walk() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let members = off.members(&s.world);
    let last = members[0].clone();
    let old = off.driver(&s.world);
    s.world.residents.retain(|r| !members[1..].contains(&r.id) && r.id != old);
    let hq = s.hq.id.clone();
    for i in hq_people(&s.world, &hq) {
        if s.world.residents[i].id != last {
            s.world.residents[i].carried = Stock::new();
        }
    }
    // Stood far out on the road, so the walk asks for more than a meal.
    let far = ((MID + 320.0) % 640.0, (MID + 320.0) % 640.0);
    let k = off.carriage_mut(&mut s.world);
    k.x = far.0;
    k.y = far.1;
    let horse = off.horse(&mut s.world);
    horse.x = far.0;
    horse.y = far.1;
    step_punishments(&mut s.world, SIZE);
    assert!(off.members(&s.world).contains(&last));
    let driver = off.wagon(&s.world).driver_id.clone().unwrap();
    assert!(driver != old && driver != last);
    assert_eq!(off.wagon(&s.world).sent_out, Some(true));
    let w = off.wagon.clone();
    run(&mut s, 400, &mut |world| {
        world.supply_wagons.iter().find(|x| x.id == w).is_some_and(|x| x.sent_out.is_none())
    });
    run(&mut s, 2, &mut never);
    assert!(held(&at(&s.world, &driver).carried, Good::Food) >= 2.0);
}

#[test]
fn goes_home_by_itself_when_its_army_is_lost_and_what_it_took_leaves_less_owed() {
    let mut s = setup(stock(&[(Good::Coins, 1000.0)]));
    let off = set_off(&mut s, iron(10.0));
    let tick = s.world.tick as f64;
    let p = off.p_mut(&mut s.world);
    p.arrived_at = Some(tick);
    p.took = 15.0;
    let (worth, city) = (p.worth, p.city_id.clone());
    off.carriage_mut(&mut s.world).load.insert(Good::Coins, 15.0);
    let members = off.members(&s.world);
    s.world.residents.retain(|r| !members.contains(&r.id));
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.punishments.is_empty());
    assert_eq!(off.wagon(&s.world).punishment_id, None);
    assert_eq!(s.world.debts.len(), 1);
    let d = &s.world.debts[0];
    assert_eq!((d.org.as_str(), d.coins, d.city_id.as_ref()), ("r1", worth - 15.0, Some(&city)));
    let hq = s.hq.id.clone();
    let coins = s
        .world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_ref() == Some(&hq) && warehouse_keeps(&s.world, b).contains(&Good::Coins)
        })
        .unwrap();
    let before = held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins);
    run(&mut s, 3000, &mut |w| w.supply_wagons.is_empty());
    assert!(s.world.supply_wagons.is_empty());
    assert_eq!(held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins), before + 15.0);
}

#[test]
fn ends_standing_where_it_is_when_its_horse_dies() {
    let mut s = default_setup();
    let off = set_off(&mut s, iron(10.0));
    let driver = off.driver(&s.world);
    let horse = off.carriage(&s.world).horse_id.clone();
    s.world.horses.retain(|h| Some(&h.id) != horse.as_ref());
    off.carriage_mut(&mut s.world).horse_id = None;
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.supply_wagons.is_empty());
    assert!(s.world.carriages.iter().any(|k| k.id == off.carriage));
    assert!(!punishers(&s.world).contains(&driver));
}

#[test]
fn reports_a_wagon_that_doesnt_hold_together() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, iron(10.0));
    step_punishments(&mut s.world, SIZE);
    let off = the_wagon(&s.world);
    assert_eq!(supply_wagons_sound(&s.world), vec![]);
    let soldier = s.world.punishments[0].members[0].resident_id.clone();
    let mut w2 = off.wagon(&s.world).clone();
    w2.id = "w2".into();
    w2.driver_id = Some(soldier.clone());
    w2.punishment_id = Some("gone".into());
    s.world.supply_wagons.push(w2);
    off.wagon_mut(&mut s.world).own_food = -1.0;
    off.carriage_mut(&mut s.world).realm_id = Some("r1".into());
    let messages: Vec<String> =
        supply_wagons_sound(&s.world).into_iter().map(|v| v.message).collect();
    for want in [
        format!(
            "supply wagon {} has carriage {}, which isn't the Trade Org HQ's",
            off.wagon, off.carriage
        ),
        format!("supply wagon {} calls -1 Food its own", off.wagon),
        "supply wagon w2 follows gone, which is no punishment under way".to_string(),
        format!("supply wagon w2 is driven by its soldier {soldier}"),
    ] {
        assert!(messages.contains(&want), "{want} among {messages:?}");
    }
}

#[test]
fn ends_with_the_hq() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, iron(10.0));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.supply_wagons.len(), 1);
    s.world.cities.retain(|c| c.id != hq.id);
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.supply_wagons.is_empty());
}

// the Trade Org army's longest trip

#[test]
#[ignore = "slow in the TypeScript too (`tags: ['slow']`): a trip across the full-size map, 10.5 s in release"]
fn reaches_the_farthest_city_on_a_real_size_map_and_gets_home_fed_with_no_food_but_its_own() {
    use csp_shared::balance::{FOOD_PER_DAY, MAP_SIZE, WALK_TICKS_PER_TILE};
    use csp_shared::world::Stat;
    const HQ: f64 = 200.0;
    let far = f64::from(MAP_SIZE / 2);
    // As large as the real map, all Plains.
    let big = plains(MAP_SIZE);
    let mut world = create_world(&big, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &big, HQ as i32, HQ as i32, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), HQ + far, HQ + far, None);
    // Coins and no Food: nothing to refill from at the city, and no posts on the way.
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "s1", "kind": "storage", "cityId": "c1", "x": HQ + far + 4.0, "y": HQ + far,
            "stock": { "coins": 1000 },
        }))
        .unwrap(),
    );
    resident(&mut world, "a1", HQ + far - 4.0, HQ + far + 4.0, Some("c1"));
    let people: Vec<String> =
        hq_people(&world, &hq).into_iter().map(|i| world.residents[i].id.clone()).collect();
    let guard = TRADE_ORG_ARMY.guard as usize;
    let soldiers: Vec<String> = people[..guard + 4].to_vec();
    let driver_to_be: Vec<String> = people[guard + 4..guard + 5].to_vec();
    world.residents.retain(|r| {
        r.city_id.as_deref() != Some(hq.as_str())
            || soldiers.contains(&r.id)
            || driver_to_be.contains(&r.id)
    });
    world.caravans.clear();
    for r in &mut world.residents {
        if !soldiers.contains(&r.id) && !driver_to_be.contains(&r.id) {
            continue;
        }
        r.carried =
            if soldiers.contains(&r.id) { stock(&[(Good::Spear, 1.0)]) } else { Stock::new() };
        let average = Stat { base: 10.0, trained: 0.0 };
        // Weak: they can't pack what the way there and back eats.
        r.stats.strength = Stat { base: 5.0, trained: 0.0 };
        r.stats.endurance = average.clone();
        r.stats.agility = average;
        r.born_at = -20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
    }
    // An HQ that has had time to fill its storage: it can pack for all of them.
    let store = world
        .buildings
        .iter_mut()
        .find(|b| b.city_id.as_deref() == Some(hq.as_str()) && b.kind == BuildingKind::Storage)
        .unwrap();
    store.stock.get_or_insert_with(Stock::new).insert(Good::Food, 1000.0);
    let hq_city = world.cities.iter().find(|c| c.id == hq).unwrap().clone();
    theft(&mut world, &hq_city, iron(10.0));
    let worth = TRADE_ORG_PUNISH.times * worth_of(&iron(10.0));
    let mut walking = Walking::new(Arc::new(big.clone()));
    let mut scratch = Scratch::default();
    let mut step_until =
        |world: &mut WorldState, until: &dyn Fn(&WorldState) -> bool, most: usize| {
            for _ in 0..most {
                if until(world) {
                    break;
                }
                step_world(world, &big, &mut scratch, Some(&mut walking), None);
            }
        };
    step_until(&mut world, &|w| !w.punishments.is_empty(), 2);
    let off = the_wagon(&world);
    let ids = off.members(&world);
    let driver = off.driver(&world);
    let (wid, pid) = (off.wagon.clone(), off.p.clone());
    step_until(
        &mut world,
        &|w| {
            let loaded = w
                .supply_wagons
                .iter()
                .find(|x| x.id == wid)
                .is_some_and(|x| x.loaded == Some(true));
            let packed = w
                .punishments
                .iter()
                .find(|x| x.id == pid)
                .is_some_and(|x| x.members.iter().all(|m| m.packed == Some(true)));
            loaded && packed
        },
        2000,
    );
    step_until(&mut world, &|_| false, 2);
    assert!(held(&off.carriage(&world).load, Good::Food) > 0.0);
    // The way there and back eats more than any of them could pack.
    let days = (2.0 * far * std::f64::consts::SQRT_2 * WALK_TICKS_PER_TILE) / TICKS_PER_GAME_DAY;
    for id in &ids {
        assert!(held(&at(&world, id).carried, Good::Food) < days * FOOD_PER_DAY);
    }
    let arrived = |w: &WorldState| {
        w.punishments.iter().find(|x| x.id == pid).is_none_or(|x| x.arrived_at.is_some())
    };
    step_until(&mut world, &arrived, 120_000);
    assert!(off.p(&world).arrived_at.is_some());
    let c1 = world.cities.iter().find(|c| c.id == "c1").unwrap();
    let hall = town_hall_of(&world, c1).unwrap();
    let k = off.carriage(&world);
    assert!(wrap_distance(MAP_SIZE, tile(k.x, k.y), tile(hall.x, hall.y)) < 100.0);
    let home_fed = |w: &WorldState, id: &str| {
        let r = at(w, id);
        assert!(r.health > 0.0);
        assert_eq!(r.down_until, None);
        assert!(in_city_area(w, &hq, r.x, r.y, MAP_SIZE));
    };
    step_until(&mut world, &|w| w.punishments.is_empty(), 140_000);
    assert!(world.punishments.is_empty());
    for id in &ids {
        home_fed(&world, id);
    }
    step_until(&mut world, &|w| w.supply_wagons.is_empty(), 40_000);
    assert!(world.supply_wagons.is_empty());
    home_fed(&world, &driver);
    let s1 = world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(held_in(s1.stock.as_ref(), Good::Coins), 1000.0 - worth);
    assert_eq!(check_all(&world, &big), vec![]);
}
