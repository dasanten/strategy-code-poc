//! `apps/server/src/trade-org-buying.test.ts`, ported one to one. Taking a Player's Food offer is
//! ignored: `acceptOffer` comes with `offers.ts`, which no ticket ports yet.

use std::sync::Arc;

use csp_shared::balance::{CRIME_STANDING_LOSS, NPC_VILLAGE, TRADE_ORG_ARMY};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{PunishmentHeading, ResidentOrder, SupplyWagon, WorldState};
use serde_json::json;

use super::*;
use crate::caravans::new_caravan_carriage;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_defence::attackers_of;
use crate::queries::standing::standing_of;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_punishment::{taken_by, took_so_far};
use crate::trading::{resolve_trades, TradeLedger};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const MID: f64 = 320.0;
/// Where the soldier is staged, on the road south of the HQ, and the target city far beyond them.
const ROAD: (f64, f64) = (MID + 2.0, MID + 100.0);
const TARGET_Y: f64 = MID + 280.0;
/// A place near the soldier on the road.
const NEAR: (f64, f64) = (ROAD.0 + 16.0, ROAD.1);

/// The grown Leader of a realm, far from everything.
fn add_leader(world: &mut WorldState, id: &str, owner: &str, city: &str) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident {
        id,
        owner: Some(owner),
        city_id: Some(city),
        x: MID - 200.0,
        y: MID - 200.0,
        tick: 0.0,
    };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

struct Staged {
    world: WorldState,
    terrain: TerrainMap,
    hq: City,
    walking: Walking,
    scratch: Scratch,
    /// The punishment and the soldier's resident id.
    p: String,
    r: String,
}

impl Staged {
    fn r(&self) -> &csp_shared::world::Resident {
        self.world.residents.iter().find(|x| x.id == self.r).unwrap()
    }
    fn r_mut(&mut self) -> &mut csp_shared::world::Resident {
        let id = self.r.clone();
        self.world.residents.iter_mut().find(|x| x.id == id).unwrap()
    }
    fn p(&self) -> &Punishment {
        self.world.punishments.iter().find(|x| x.id == self.p).unwrap()
    }
    fn p_mut(&mut self) -> &mut Punishment {
        let id = self.p.clone();
        self.world.punishments.iter_mut().find(|x| x.id == id).unwrap()
    }
    fn food(&self) -> f64 {
        held(&self.r().carried, Good::Food)
    }
    fn coins(&self) -> f64 {
        held(&self.r().carried, Good::Coins)
    }
    fn bought(&self) -> bool {
        self.food() >= 1.0
    }
    fn building(&self, id: &str) -> &csp_shared::world::Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }
}

fn crime(world: &mut WorldState, hq: &City, y: f64) {
    world.crimes.push(
        serde_json::from_value(json!({
            "id": "x1", "kind": "theft", "tick": world.tick, "x": MID, "y": y,
            "culprit": { "residentId": "a1", "name": "Aldo", "org": "r1", "orgName": "the realm of Aldo" },
            "victimOrg": hq.id, "goods": { "iron": 10 }, "witnesses": [], "knownBy": [hq.id],
        }))
        .unwrap(),
    );
    change_standing(world, &hq.id, "r1", -CRIME_STANDING_LOSS.theft);
}

/// The Trade Org HQ at (MID, MID) with soldiers, realm r1 (Leader a1) with city c1 far south of it
/// to be punished, and realm r2 with city c2 elsewhere. One soldier is under way on the road with
/// nothing to eat and a purse, with no supply wagon.
fn setup(terrain: TerrainMap) -> Staged {
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID as i32, MID as i32, &mut || m.next());
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "a2")] {
        world.realms.push(
            serde_json::from_value(json!({ "id": id, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
    }
    add_city(&mut world, "c1", Some("r1"), MID, TARGET_Y, None);
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "s1", "kind": "storage", "cityId": "c1", "x": MID + 4.0, "y": TARGET_Y,
            "stock": { "coins": 1000 },
        }))
        .unwrap(),
    );
    add_city(&mut world, "c2", Some("r2"), NEAR.0 + 200.0, NEAR.1, None);
    add_leader(&mut world, "a1", "r1", "c1");
    add_leader(&mut world, "a2", "r2", "c2");
    let hq = world.cities.iter().find(|c| c.id == hq).unwrap().clone();
    let people: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none()
                && world.residents[i].city_id.as_deref() == Some(hq.id.as_str())
        })
        .take(TRADE_ORG_ARMY.guard as usize + 4)
        .collect();
    for i in people {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    crime(&mut world, &hq, TARGET_Y - 20.0);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    // One soldier on the road, the rest and the wagon out of it.
    let rest: Vec<String> =
        world.punishments[0].members[1..].iter().map(|m| m.resident_id.clone()).collect();
    for id in &rest {
        world.residents.iter_mut().find(|x| &x.id == id).unwrap().order = None;
    }
    world.punishments[0].members.truncate(1);
    for w in std::mem::take(&mut world.supply_wagons) {
        if let Some(d) = world.residents.iter_mut().find(|r| w.driver_id.as_ref() == Some(&r.id)) {
            d.order = None;
        }
        world.carriages.retain(|k| k.id != w.carriage_id);
    }
    let purse: Stock =
        [(Good::Spear, 1.0), (Good::Coins, TRADE_ORG_PUNISH.purse)].into_iter().collect();
    let p = world.punishments[0].id.clone();
    let m = &mut world.punishments[0].members[0];
    m.packed = Some(true);
    m.own = purse.clone();
    let r = m.resident_id.clone();
    let res = world.residents.iter_mut().find(|x| x.id == r).unwrap();
    res.x = ROAD.0;
    res.y = ROAD.1;
    res.order = None;
    res.carried = purse;
    Staged { world, terrain, hq, walking, scratch, p, r }
}

fn open() -> TerrainMap {
    plains(640)
}

/// Steps the world, keeping everyone fed, and checks every invariant now and then.
fn run(s: &mut Staged, ticks: usize, until: &mut dyn FnMut(&Staged) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 100 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), vec![]);
        }
        if until(s) {
            break;
        }
    }
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

fn never(_: &Staged) -> bool {
    false
}

/// A trading post with a warehouse of Food near the soldier.
fn post(world: &mut WorldState, food: f64) {
    add_city(
        world,
        "post",
        None,
        NEAR.0,
        NEAR.1 + 8.0,
        Some(csp_shared::world::TradeOrgCity::Post),
    );
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "pw", "kind": "warehouse", "cityId": "post", "x": NEAR.0, "y": NEAR.1,
            "stock": { "food": food },
        }))
        .unwrap(),
    );
}

/// An NPC city with a storage of Food near the soldier, and nobody to feed.
fn npc_city(world: &mut WorldState, food: f64) {
    add_city(world, "n1", None, NEAR.0, NEAR.1 + 8.0, None);
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "ns", "kind": "storage", "cityId": "n1", "x": NEAR.0, "y": NEAR.1,
            "stock": { "food": food },
        }))
        .unwrap(),
    );
}

/// A storage of `realm` near the soldier with a Food offer, 2 Food for `coins` Coins, 10 times.
fn food_offer(world: &mut WorldState, realm: &str, coins: f64) {
    add_city(world, "c3", Some(realm), NEAR.0, NEAR.1 + 8.0, None);
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "off", "kind": "storage", "cityId": "c3", "x": NEAR.0, "y": NEAR.1,
            "stock": { "food": 20 },
        }))
        .unwrap(),
    );
    world.offers.push(
        serde_json::from_value(json!({
            "id": "o1", "realmId": realm, "storageId": "off", "x": NEAR.0, "y": NEAR.1,
            "gives": "food", "givesUnits": 2, "wants": "coins", "wantsUnits": coins, "times": 10,
        }))
        .unwrap(),
    );
}

/// A walled NPC village with its gate near the soldier and plenty of Food in its storage, which
/// lies east of them, walls and all between. Returns (city, storage, gate) ids.
fn gated_city(s: &mut Staged) -> (String, String, String) {
    let mut m = Mulberry32::new(7.0);
    let (x, y) = (ROAD.0 as i32 + 20, ROAD.1 as i32 - 14);
    let city = found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, x, y, &mut || m.next(), None);
    let find = |w: &WorldState, kind: BuildingKind| {
        w.buildings
            .iter()
            .find(|b| b.city_id.as_ref() == Some(&city) && b.kind == kind)
            .unwrap()
            .id
            .clone()
    };
    let storage = find(&s.world, BuildingKind::Storage);
    let gate = find(&s.world, BuildingKind::Gate);
    let st = s.world.buildings.iter_mut().find(|b| b.id == storage).unwrap();
    st.stock.get_or_insert_with(Stock::new).insert(Good::Food, 1000.0);
    (city, storage, gate)
}

/// Runs a soldier with no seller to go to, and sees they go on towards the city with nothing bought.
fn expect_goes_on(s: &mut Staged, ticks: usize) {
    let start_y = s.r().y;
    run(s, ticks, &mut never);
    assert_eq!(s.food(), 0.0);
    assert_eq!(s.coins(), TRADE_ORG_PUNISH.purse);
    assert!(s.r().y > start_y + 5.0);
    assert!(s.r().x < NEAR.0);
}

#[test]
fn packs_coins_at_the_hq_its_own_and_no_taking() {
    let terrain = open();
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID as i32, MID as i32, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), MID, MID + 88.0, None);
    add_leader(&mut world, "a1", "r1", "c1");
    world.buildings.push(
        serde_json::from_value(json!({
            "id": "s1", "kind": "storage", "cityId": "c1", "x": MID + 4.0, "y": MID + 88.0, "stock": {},
        }))
        .unwrap(),
    );
    let hq = world.cities.iter().find(|c| c.id == hq).unwrap().clone();
    let people: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none()
                && world.residents[i].city_id.as_deref() == Some(hq.id.as_str())
        })
        .take(TRADE_ORG_ARMY.guard as usize + 1)
        .collect();
    for i in people {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    let coin_house = world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(hq.id.as_str())
                && warehouse_keeps(&world, b).contains(&Good::Coins)
        })
        .unwrap();
    world.buildings[coin_house].stock.get_or_insert_with(Stock::new).insert(Good::Coins, 1000.0);
    crime(&mut world, &hq, MID + 60.0);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    for _ in 0..1500 {
        if world.punishments[0].members[0].packed == Some(true) {
            break;
        }
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    }
    let p = &world.punishments[0];
    let soldier = world.residents.iter().find(|r| r.id == p.members[0].resident_id).unwrap();
    assert_eq!(held(&soldier.carried, Good::Coins), TRADE_ORG_PUNISH.purse);
    assert!(!taken_by(soldier, &p.members[0].own).contains_key(&Good::Coins));
    assert_eq!(took_so_far(&world, p), 0.0);
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn buys_at_a_trading_post_it_passes_by_the_same_trade_coins_go_into_its_warehouse() {
    let mut s = setup(open());
    post(&mut s.world, 50.0);
    run(&mut s, 400, &mut |s| s.bought());
    assert!(s.food() >= 1.0);
    let pw = s.building("pw");
    assert!(held_in(pw.stock.as_ref(), Good::Food) < 50.0);
    assert_eq!(held_in(pw.stock.as_ref(), Good::Coins), TRADE_ORG_PUNISH.purse - s.coins());
    assert!(s.coins() < TRADE_ORG_PUNISH.purse);
    let thefts = s.world.crimes.iter().filter(|c| c.kind == csp_shared::world::CrimeKind::Theft);
    assert_eq!(thefts.count(), 1);
    assert_eq!(taken_by(s.r(), &s.p().members[0].own), Stock::new());
}

#[test]
fn buys_from_an_npc_city_it_passes_which_raises_its_standing_like_any_trade() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    run(&mut s, 400, &mut |s| s.bought());
    let ns = s.building("ns");
    assert!(held_in(ns.stock.as_ref(), Good::Food) < 50.0);
    assert_eq!(held_in(ns.stock.as_ref(), Good::Coins), TRADE_ORG_PUNISH.purse - s.coins());
    assert!(standing_of(&s.world, "n1", TRADE_ORG) > 0.0);
    assert_eq!(taken_by(s.r(), &s.p().members[0].own), Stock::new());
}

#[test]
#[ignore = "accepting an offer comes with `offers.ts`, which no ticket ports yet"]
fn takes_a_players_food_offer_it_passes_and_the_player_hears_of_it() {
    let mut s = setup(open());
    food_offer(&mut s.world, "r2", 4.0);
    run(&mut s, 400, &mut |s| s.bought());
    let offer = s.world.offers.iter().find(|o| o.id == "o1").unwrap();
    assert!(offer.times < 10.0);
    let place = s.building("off");
    assert_eq!(held_in(place.stock.as_ref(), Good::Coins), TRADE_ORG_PUNISH.purse - s.coins());
    assert_eq!(s.food() % 2.0, 0.0);
    assert!(standing_of(&s.world, "r2", TRADE_ORG) > 0.0);
    assert_eq!(taken_by(s.r(), &s.p().members[0].own), Stock::new());
}

#[test]
fn buys_on_the_way_home_too() {
    let mut s = setup(open());
    post(&mut s.world, 50.0);
    let tick = s.world.tick as f64;
    let p = s.p_mut();
    p.heading = PunishmentHeading::Home;
    p.arrived_at = Some(tick);
    run(&mut s, 400, &mut |s| s.bought());
    assert!(s.food() >= 1.0);
    assert_eq!(taken_by(s.r(), &s.p().members[0].own), Stock::new());
}

#[test]
fn with_no_seller_near_goes_on_hungry() {
    let mut s = setup(open());
    expect_goes_on(&mut s, 120);
    assert!(matches!(s.r().order, Some(ResidentOrder::WalkTo(_))));
}

#[test]
fn with_no_coins_goes_on_hungry_past_a_seller() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    let spear: Stock = [(Good::Spear, 1.0)].into_iter().collect();
    s.r_mut().carried = spear.clone();
    s.p_mut().members[0].own = spear;
    run(&mut s, 120, &mut never);
    assert_eq!(s.food(), 0.0);
    assert!(s.r().x < NEAR.0);
}

#[test]
fn walks_through_an_npc_citys_gate_buys_at_its_storage_and_walks_on() {
    let mut s = setup(open());
    let (_, storage, gate) = gated_city(&mut s);
    let g = gate.clone();
    run(&mut s, 800, &mut |s| {
        assert_eq!(s.building(&g).closed, None);
        s.bought()
    });
    assert!(s.bought());
    assert!(s.coins() < TRADE_ORG_PUNISH.purse);
    assert!(held_in(s.building(&storage).stock.as_ref(), Good::Food) < 1000.0);
    // Bought, they leave by the gate and carry on south, past the city's walls.
    run(&mut s, 1500, &mut |s| s.r().y > ROAD.1 + 30.0);
    assert!(s.r().y > ROAD.1 + 30.0);
}

#[test]
fn is_not_fought_by_the_city_while_it_buys_armed_as_they_are() {
    let mut s = setup(open());
    let (city, _, _) = gated_city(&mut s);
    let people: Vec<String> = s
        .world
        .residents
        .iter()
        .filter(|r| r.owner.is_none() && r.city_id.as_ref() == Some(&city))
        .map(|r| r.id.clone())
        .collect();
    for r in &mut s.world.residents {
        if people.contains(&r.id) {
            r.carried.insert(Good::Spear, 1.0);
        }
    }
    let health = s.r().health;
    run(&mut s, 800, &mut |s| {
        for r in s.world.residents.iter().filter(|r| people.contains(&r.id)) {
            assert!(!matches!(r.order, Some(ResidentOrder::Attack(_))));
        }
        let c = s.world.cities.iter().find(|c| c.id == city).unwrap();
        assert!(attackers_of(&s.world, c, s.terrain.size).is_empty());
        s.bought()
    });
    assert!(s.bought());
    assert_eq!(s.r().health, health);
}

#[test]
fn is_shut_out_by_a_gated_city_that_refuses_the_trade_organization_and_goes_on() {
    let mut s = setup(open());
    let (city, _, gate) = gated_city(&mut s);
    change_standing(&mut s.world, &city, TRADE_ORG, -60.0);
    let (gx, gy) = (s.building(&gate).x, s.building(&gate).y);
    let r = s.r_mut();
    r.x = gx;
    r.y = gy + 10.0;
    run(&mut s, 1, &mut never);
    assert_eq!(s.building(&gate).closed, Some(true));
    let start_y = s.r().y;
    run(&mut s, 120, &mut never);
    assert_eq!(s.food(), 0.0);
    assert_eq!(s.coins(), TRADE_ORG_PUNISH.purse);
    assert!(s.r().y > start_y + 5.0);
}

#[test]
fn finds_a_gated_city_shut_while_another_armed_outsider_is_near_and_goes_on() {
    let mut s = setup(open());
    let (_, storage, gate) = gated_city(&mut s);
    let other = add_leader(&mut s.world, "b1", "r2", "c2");
    let (gx, gy) = (s.building(&gate).x, s.building(&gate).y);
    let o = &mut s.world.residents[other];
    o.x = gx;
    o.y = gy + 3.0;
    o.order = None;
    o.carried = [(Good::Spear, 1.0)].into_iter().collect();
    let (g, st) = (gate.clone(), storage.clone());
    run(&mut s, 800, &mut |s| {
        assert_eq!(s.building(&g).closed, Some(true));
        s.p().members[0].no_way.as_ref().is_some_and(|w| w.contains(&st))
    });
    assert!(s.p().members[0].no_way.as_ref().unwrap().contains(&storage));
    assert_eq!(s.food(), 0.0);
    assert_eq!(s.coins(), TRADE_ORG_PUNISH.purse);
    let start_y = s.r().y;
    run(&mut s, 120, &mut never);
    assert!(s.r().y > start_y);
}

#[test]
fn passes_by_an_npc_city_that_refuses_the_trade_organization() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    change_standing(&mut s.world, "n1", TRADE_ORG, -60.0);
    expect_goes_on(&mut s, 120);
}

#[test]
fn is_refused_at_the_storage_by_a_city_that_has_come_to_refuse_it_since() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    change_standing(&mut s.world, "n1", TRADE_ORG, -60.0);
    let (x, y) = (s.building("ns").x, s.building("ns").y);
    let r = s.r_mut();
    r.x = x;
    r.y = y;
    r.order = Some(
        serde_json::from_value(json!({
            "kind": "trade", "side": "buy", "good": "food", "units": 3, "carriageId": null,
        }))
        .unwrap(),
    );
    assert_eq!(resolve_trades(&mut s.world, s.terrain.size, &mut TradeLedger::default()), 0);
    assert_eq!(s.food(), 0.0);
    assert_eq!(s.coins(), TRADE_ORG_PUNISH.purse);
    assert_eq!(held_in(s.building("ns").stock.as_ref(), Good::Food), 50.0);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn passes_by_an_offer_asking_too_much() {
    let mut s = setup(open());
    food_offer(&mut s.world, "r2", 2.0 * TRADE_ORG_PUNISH.offer_food_price + 2.0);
    expect_goes_on(&mut s, 120);
}

#[test]
fn buys_nothing_from_the_one_it_is_punishing() {
    let mut s = setup(open());
    food_offer(&mut s.world, "r1", 4.0);
    expect_goes_on(&mut s, 120);
}

#[test]
fn buys_nothing_from_an_organization_the_trade_organization_refuses() {
    let mut s = setup(open());
    food_offer(&mut s.world, "r2", 4.0);
    let hq = s.hq.id.clone();
    change_standing(&mut s.world, &hq, "r2", -60.0);
    expect_goes_on(&mut s, 120);
}

#[test]
fn leaves_a_direct_offer_alone() {
    let mut s = setup(open());
    food_offer(&mut s.world, "r2", 4.0);
    let tick = s.world.tick as f64;
    s.world.offers[0].direct = Some(
        serde_json::from_value(json!({ "toId": "r1", "lapsesAt": tick + 100_000.0 })).unwrap(),
    );
    expect_goes_on(&mut s, 120);
}

/// A supply wagon beside the soldier with `load` Food on it and nobody driving yet.
fn wagon_with(s: &mut Staged, load: f64) {
    let (x, y) = (s.r().x, s.r().y);
    let hq = s.hq.id.clone();
    let carriage_id = new_caravan_carriage(&mut s.world, &hq, x, y, "test:wagon-horse");
    s.world.carriages.iter_mut().find(|k| k.id == carriage_id).unwrap().load =
        [(Good::Food, load)].into_iter().collect();
    s.world.supply_wagons.push(SupplyWagon {
        id: "w1".into(),
        punishment_id: Some(s.p.clone()),
        carriage_id,
        driver_id: None,
        food: load,
        own_food: load,
        loaded: Some(true),
        sent_out: None,
        holding: None,
    });
}

#[test]
fn is_not_short_with_its_share_of_the_wagon_however_little_it_carries() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    wagon_with(&mut s, 100.0);
    run(&mut s, 60, &mut never);
    assert_eq!(held_in(s.building("ns").stock.as_ref(), Good::Food), 50.0);
    assert_eq!(s.coins(), TRADE_ORG_PUNISH.purse);
}

#[test]
fn buys_when_its_wagon_set_out_short_from_a_poor_hq_without_turning_back_for_it() {
    let mut s = setup(open());
    npc_city(&mut s.world, 50.0);
    wagon_with(&mut s, 2.0);
    run(&mut s, 400, &mut |s| held_in(s.building("ns").stock.as_ref(), Good::Food) < 50.0);
    assert!(held_in(s.building("ns").stock.as_ref(), Good::Food) < 50.0);
    assert!(s.coins() < TRADE_ORG_PUNISH.purse);
}

#[test]
fn what_it_bought_and_spent_counts_for_nothing_against_what_it_came_for_or_the_debt() {
    let mut s = setup(open());
    post(&mut s.world, 50.0);
    run(&mut s, 400, &mut |s| s.bought());
    run(&mut s, 2, &mut never);
    assert_eq!(took_so_far(&s.world, s.p()), 0.0);
    assert_eq!(s.p().took, 0.0);
    // Coins taken later are told from what is left of the purse.
    let spent = TRADE_ORG_PUNISH.purse - s.coins();
    assert!(spent > 0.0);
    assert_eq!(held(&s.p().members[0].own, Good::Coins), s.coins());
    // The city goes: it turns back having taken nothing, so the whole of it stays owed.
    s.world.residents.iter_mut().find(|r| r.id == "a1").unwrap().city_id = None;
    s.world.cities.iter_mut().find(|c| c.id == "c1").unwrap().realm_id = Some("r2".into());
    run(&mut s, 1, &mut never);
    assert_eq!(s.p().heading, PunishmentHeading::Home);
    let owed = s.world.debts.iter().find(|d| d.org == "r1").map(|d| d.coins);
    assert_eq!(owed, Some(s.p().worth));
}

#[test]
fn tells_coins_taken_from_what_is_left_of_its_purse() {
    let mut s = setup(open());
    s.r_mut().carried.insert(Good::Coins, 20.0);
    run(&mut s, 1, &mut never);
    assert_eq!(held(&s.p().members[0].own, Good::Coins), 20.0);
    s.r_mut().carried.insert(Good::Coins, 120.0);
    let want: Stock = [(Good::Coins, 100.0)].into_iter().collect();
    assert_eq!(taken_by(s.r(), &s.p().members[0].own), want);
    assert_eq!(took_so_far(&s.world, s.p()), 100.0);
}

#[test]
fn finds_no_way_to_a_seller_walled_off_from_it_and_goes_on() {
    let mut terrain = open();
    let size = terrain.size;
    for dx in -4i32..=4 {
        for dy in -4i32..=4 {
            if dx.abs().max(dy.abs()) != 4 {
                continue;
            }
            let (x, y) = (NEAR.0 as i32 + dx, NEAR.1 as i32 + dy);
            terrain.tiles[(y * size + x) as usize] = Terrain::Sea as u8;
        }
    }
    let mut s = setup(terrain);
    npc_city(&mut s.world, 50.0);
    run(&mut s, 2000, &mut |s| s.p().members[0].no_way.as_ref().is_some_and(|w| !w.is_empty()));
    assert_eq!(s.p().members[0].no_way, Some(vec!["ns".to_string()]));
    assert_eq!(s.p().members[0].seller, None);
    let y = s.r().y;
    run(&mut s, 120, &mut never);
    assert!(s.r().y > y + 5.0);
    assert_eq!(s.food(), 0.0);
}

#[test]
fn hands_in_what_is_left_of_its_purse_back_home() {
    let mut s = setup(open());
    let hq = s.hq.id.clone();
    let coin_house = s
        .world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(hq.as_str())
                && warehouse_keeps(&s.world, b).contains(&Good::Coins)
        })
        .unwrap();
    let before = held_in(s.world.buildings[coin_house].stock.as_ref(), Good::Coins);
    let (cx, cy) = (s.world.buildings[coin_house].x, s.world.buildings[coin_house].y);
    let tick = s.world.tick as f64;
    let p = s.p_mut();
    p.heading = PunishmentHeading::Home;
    p.arrived_at = Some(tick);
    p.members[0].own.insert(Good::Food, 10.0);
    let r = s.r_mut();
    r.carried.insert(Good::Food, 10.0);
    r.x = cx;
    r.y = cy + 2.0;
    r.order = None;
    run(&mut s, 600, &mut |s| s.world.punishments.is_empty());
    assert!(s.world.punishments.is_empty());
    assert_eq!(held(&s.r().carried, Good::Coins), 0.0);
    assert!(
        held_in(s.world.buildings[coin_house].stock.as_ref(), Good::Coins)
            >= before + TRADE_ORG_PUNISH.purse
    );
}
