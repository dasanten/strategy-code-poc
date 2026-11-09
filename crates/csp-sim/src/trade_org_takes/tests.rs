//! `apps/server/src/trade-org-takes.test.ts`, ported one to one. The traders' loops are not
//! checked: `traders.ts` is not ported yet (`world.rs` keeps `place_traders` a stand-in).

use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, NPC_VILLAGE, TRADE_ORG_ARMY, TRADE_ORG_DEBT_TRIPS};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CrimeKind, Debt, DebtStep, DebtWhat, Good, HorseStats,
    Occupation, PunishedWhat, PunishmentEnd, PunishmentHeading, RealmEventWhat, ResidentOrder,
    Stock, TradeOrgCity, TradeSide, WorldState,
};
use serde_json::json;

use super::*;
use crate::caravans::place_caravans;
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::city_area::{occupier_of, OCCUPATION_TICKS};
use crate::queries::names::{held, held_in};
use crate::queries::warehouse::{warehouse_keeps, warehouse_prices};
use crate::queries::warehouse_trade::debt_of;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::starting_city::found_starting_city;
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_punishment::{punishments_sound, step_punishments};
use crate::trading_posts::{found_trading_post, storages_become_warehouses};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 512;

struct Fixture {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    realm: String,
    leader: String,
    city: String,
    storage: String,
    walking: Walking,
    scratch: Scratch,
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// The HQ with a trading post, their caravan; Player 7's realm owing `coins` after `trips` trips.
fn fixture(coins: f64, trips: f64) -> Fixture {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let hq = found_trade_org_hq(&mut world, &terrain, 128, 128, &mut || m.next());
    found_trading_post(&mut world, &terrain, 220, 128, None, &mut || m.next());
    place_caravans(&mut world);
    for h in &mut world.horses {
        h.stats = HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        };
    }
    let soldiers: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none()
                && world.residents[i].city_id.as_deref() == Some(hq.as_str())
        })
        .take(TRADE_ORG_ARMY.guard as usize + 4)
        .collect();
    for i in soldiers {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms[ri].id.clone();
    let leader = world.realms[ri].leader_id.clone();
    let city =
        world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm)).unwrap().id.clone();
    world.debts.push(Debt {
        org: realm.clone(),
        coins,
        step: Some(DebtStep::Wrecks),
        deadline: None,
        trips: Some(trips),
        city_id: Some(city.clone()),
    });
    let si = world
        .buildings
        .iter()
        .position(|b| b.city_id.as_ref() == Some(&city) && b.kind == BuildingKind::Storage)
        .unwrap();
    let st = world.buildings[si].stock.get_or_insert_with(Stock::new);
    st.insert(Good::Iron, 40.0);
    st.insert(Good::Coins, 300.0);
    let storage = world.buildings[si].id.clone();
    let walking = Walking::new(Arc::new(terrain.clone()));
    Fixture {
        world,
        terrain,
        hq,
        realm,
        leader,
        city,
        storage,
        walking,
        scratch: Scratch::default(),
    }
}

fn default_fixture() -> Fixture {
    fixture(500.0, TRADE_ORG_DEBT_TRIPS)
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut City {
    world.cities.iter_mut().find(|c| c.id == id).unwrap()
}

fn building<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

/// Stands a city's way clear: nobody of it is armed.
fn disarm(world: &mut WorldState, city: &str) {
    for r in &mut world.residents {
        if r.city_id.as_deref() == Some(city) {
            r.carried.shift_remove(&Good::Spear);
        }
    }
}

/// Sends out the army for the debt and stands it on the city's town hall. Returns its id.
fn army_on_the_hall(world: &mut WorldState, city_id: &str) -> String {
    step_punishments(world, SIZE);
    let pi = world.punishments.iter().position(|x| x.city_id == city_id).unwrap();
    let hall = town_hall_of(world, city(world, city_id)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let ids: Vec<String> =
        world.punishments[pi].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        let r = world.residents.iter_mut().find(|x| &x.id == id).unwrap();
        r.x = hx;
        r.y = hy;
        r.order = None;
        world.punishments[pi].members[mi].packed = Some(true);
    }
    world.punishments[pi].id.clone()
}

/// Steps the world, keeping everyone fed, with every invariant checked now and then.
fn run(s: &mut Fixture, ticks: usize, until: &dyn Fn(&WorldState) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 50 == 0 {
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

fn punishment<'w>(world: &'w WorldState, id: &str) -> Option<&'w csp_shared::world::Punishment> {
    world.punishments.iter().find(|p| p.id == id)
}

/// The army holds the hall of the Player's city almost to the end, and runs out the time.
fn take_it(s: &mut Fixture) -> String {
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    run(s, 1, &never);
    assert_eq!(
        city(&s.world, &c).occupation.as_ref().map(|o| o.realm_id.as_str()),
        Some(TRADE_ORG)
    );
    let tick = s.world.tick as f64;
    city_mut(&mut s.world, &c).occupation.as_mut().unwrap().since = tick - OCCUPATION_TICKS + 3.0;
    let c2 = c.clone();
    run(s, 10, &move |w| city(w, &c2).trade_org == Some(TradeOrgCity::Post));
    assert_eq!(city(&s.world, &c).trade_org, Some(TradeOrgCity::Post));
    p
}

/// The events the Player's realm reads.
fn events(world: &WorldState) -> Vec<&RealmEventWhat> {
    world.events.iter().filter(|e| e.user_id == 7).map(|e| &e.what).collect()
}

fn read(world: &WorldState, pick: impl Fn(&RealmEventWhat) -> bool) -> bool {
    events(world).into_iter().any(pick)
}

fn last_event(world: &WorldState) -> &RealmEventWhat {
    events(world).into_iter().last().unwrap()
}

// its trips

#[test]
fn sends_armies_for_workplaces_until_the_set_number_of_them_reached_a_city() {
    for trips in 0..TRADE_ORG_DEBT_TRIPS as usize {
        let mut s = fixture(500.0, trips as f64);
        step_punishments(&mut s.world, SIZE);
        assert_eq!(s.world.punishments[0].wrecks, Some(vec![]));
        assert_eq!(s.world.punishments[0].takes, None);
    }
    let mut s = fixture(500.0, TRADE_ORG_DEBT_TRIPS);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments[0].takes, Some(true));
    assert_eq!(s.world.punishments[0].wrecks, None);
    assert!(matches!(
        last_event(&s.world),
        RealmEventWhat::Punished { what: PunishedWhat::Coming, takes: Some(true), .. }
    ));
}

#[test]
fn counts_a_trip_once_when_its_army_reaches_the_city() {
    let mut s = fixture(500.0, 0.0);
    let c = s.city.clone();
    let p = army_on_the_hall(&mut s.world, &c);
    assert_eq!(s.world.debts[0].trips, Some(0.0));
    step_punishments(&mut s.world, SIZE);
    assert!(punishment(&s.world, &p).unwrap().arrived_at.is_some());
    assert_eq!(s.world.debts[0].trips, Some(1.0));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.debts[0].trips, Some(1.0));
}

#[test]
fn counts_none_for_an_army_lost_on_the_road() {
    let mut s = fixture(500.0, 0.0);
    step_punishments(&mut s.world, SIZE);
    let lost: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    s.world.residents.retain(|r| !lost.contains(&r.id));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.debts[0].trips, Some(0.0));
}

#[test]
fn goes_from_wrecking_to_taking_by_itself_once_the_last_wrecking_army_is_home() {
    let mut s = fixture(500.0, TRADE_ORG_DEBT_TRIPS - 1.0);
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    assert_eq!(punishment(&s.world, &p).unwrap().wrecks, Some(vec![]));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.debts[0].trips, Some(TRADE_ORG_DEBT_TRIPS));
    assert_eq!(s.world.punishments.len(), 1);
    assert_eq!(s.world.punishments[0].id, p);
    s.world.punishments.clear();
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments[0].takes, Some(true));
}

// holding the town hall

#[test]
fn is_an_occupation_only_for_the_army_come_to_take_the_city() {
    let mut wrecking = fixture(500.0, 0.0);
    let c = wrecking.city.clone();
    disarm(&mut wrecking.world, &c);
    army_on_the_hall(&mut wrecking.world, &c);
    assert_eq!(occupier_of(&wrecking.world, city(&wrecking.world, &c), SIZE), None);

    let mut taking = default_fixture();
    let c = taking.city.clone();
    disarm(&mut taking.world, &c);
    army_on_the_hall(&mut taking.world, &c);
    assert_eq!(
        occupier_of(&taking.world, city(&taking.world, &c), SIZE).as_deref(),
        Some(TRADE_ORG)
    );
}

#[test]
fn runs_as_anyones_the_realms_log_says_so_and_the_city_falls_only_at_the_end() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    army_on_the_hall(&mut s.world, &c);
    run(&mut s, 1, &never);
    assert!(read(&s.world, |e| matches!(
        e,
        RealmEventWhat::HallOccupied { other: Some(other), .. } if other == "the Trade Organization"
    )));
    run(&mut s, 20, &never);
    assert_eq!(city(&s.world, &c).realm_id.as_ref(), Some(&s.realm));
    assert_eq!(city(&s.world, &c).trade_org, None);
    assert_eq!(s.world.debts.len(), 1);
}

#[test]
fn fights_whoever_armed_stands_on_the_hall_who_breaks_it_meanwhile() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    run(&mut s, 1, &never);
    let hall = town_hall_of(&s.world, city(&s.world, &c)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let leader = s.world.residents.iter_mut().find(|r| r.id == s.leader).unwrap();
    leader.x = hx;
    leader.y = hy;
    leader.carried.insert(Good::Spear, 1.0);
    leader.order = None;
    assert_eq!(occupier_of(&s.world, city(&s.world, &c), SIZE), None);
    step_punishments(&mut s.world, SIZE);
    let first = punishment(&s.world, &p).unwrap().members[0].resident_id.clone();
    let soldier = s.world.residents.iter().find(|r| r.id == first).unwrap();
    assert_eq!(soldier.order, Some(ResidentOrder::Attack(attack_order(&s.leader, false, false))));
}

#[test]
fn keeps_one_soldier_on_it_while_the_others_go_for_food() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    step_punishments(&mut s.world, SIZE);
    let pi = s.world.punishments.iter().position(|x| x.id == p).unwrap();
    let ids: Vec<String> =
        s.world.punishments[pi].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        let r = s.world.residents.iter_mut().find(|x| &x.id == id).unwrap();
        r.carried.insert(Good::Food, 0.0);
        r.order = None;
        s.world.punishments[pi].members[mi].own.insert(Good::Food, 0.0);
    }
    step_punishments(&mut s.world, SIZE);
    let orders: Vec<&Option<ResidentOrder>> = ids
        .iter()
        .map(|id| &s.world.residents.iter().find(|x| &x.id == id).unwrap().order)
        .collect();
    assert_eq!(orders[0], &None);
    assert!(orders[1..].iter().any(|o| o.is_some()));
    assert_eq!(punishment(&s.world, &p).unwrap().heading, PunishmentHeading::Out);
}

#[test]
fn doesnt_give_up_with_its_occupation_running_and_does_with_it_broken() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    step_punishments(&mut s.world, SIZE);
    let tick = s.world.tick as f64;
    city_mut(&mut s.world, &c).occupation =
        Some(Occupation { realm_id: TRADE_ORG.into(), since: tick });
    s.world.punishments.iter_mut().find(|x| x.id == p).unwrap().arrived_at =
        Some(tick - 10_000_000.0);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(punishment(&s.world, &p).unwrap().heading, PunishmentHeading::Out);
    city_mut(&mut s.world, &c).occupation = None;
    step_punishments(&mut s.world, SIZE);
    assert_eq!(punishment(&s.world, &p).unwrap().heading, PunishmentHeading::Home);
    assert!(matches!(
        last_event(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::GaveUp),
            takes: Some(true),
            ..
        }
    ));
    // It leaves no more debt behind it, and the next one comes for the city again.
    assert_eq!(debt_of(&s.world, &s.realm), 500.0);
}

// the city it takes

#[test]
fn becomes_a_working_post() {
    let mut s = default_fixture();
    let food = held_in(building(&s.world, &s.storage).stock.as_ref(), Good::Food);
    let c = s.city.clone();
    s.world.residents.iter_mut().find(|r| r.id == s.leader).unwrap().city_id = Some(c.clone());
    let people: Vec<String> = s
        .world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(c.as_str()) && r.id != s.leader)
        .map(|r| r.id.clone())
        .collect();
    assert!(!people.is_empty());
    take_it(&mut s);
    let w = &s.world;
    assert_eq!(city(w, &c).realm_id, None);
    assert!(w.cities.iter().any(|x| x.id == c && x.trade_org == Some(TradeOrgCity::Post)));
    // The storage is a warehouse with its goods, which it prices; the Food is in a new storage.
    let storage = building(w, &s.storage);
    assert_eq!(storage.kind, BuildingKind::Warehouse);
    assert_eq!(held_in(storage.stock.as_ref(), Good::Iron), 40.0);
    assert_eq!(held_in(storage.stock.as_ref(), Good::Coins), 300.0);
    assert_eq!(held_in(storage.stock.as_ref(), Good::Food), 0.0);
    assert!(!warehouse_keeps(w, storage).is_empty());
    let iron = warehouse_prices(w, storage).into_iter().find(|l| l.good == Good::Iron);
    assert_eq!(iron.map(|l| l.stock), Some(40.0));
    let eats: Vec<&Building> = w
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(c.as_str()) && b.kind == BuildingKind::Storage)
        .collect();
    assert_eq!(eats.len(), 1);
    let eaten = held_in(eats[0].stock.as_ref(), Good::Food);
    assert!(eaten > 0.0 && eaten <= food, "{eaten} of {food}");
    // Its people are the post's, and the Leader stays in their realm, homeless.
    for id in &people {
        if let Some(now) = w.residents.iter().find(|r| &r.id == id) {
            assert_eq!((now.owner.as_deref(), now.city_id.as_deref()), (None, Some(c.as_str())));
        }
    }
    let leader = w.residents.iter().find(|r| r.id == s.leader).unwrap();
    assert_eq!((leader.owner.as_ref(), leader.city_id.as_ref()), (Some(&s.realm), None));
    // A caravan; the traders' loops come with the traders' port.
    assert_eq!(w.caravans.iter().filter(|k| k.post_id == c).count(), 1);
    run(&mut s, 100, &never);
    let w = &s.world;
    assert!(w.cities.iter().any(|x| x.id == c && x.trade_org == Some(TradeOrgCity::Post)));
    // Its people are at work, the game running them now.
    let at_work = w
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(c.as_str()) && r.owner.is_none())
        .any(|r| r.order.is_some());
    assert!(at_work);
}

#[test]
fn sells_to_anyone_as_a_post_does() {
    let mut s = default_fixture();
    take_it(&mut s);
    let ri = found_starting_city(&mut s.world, &s.terrain, 8, None);
    let leader = s.world.realms[ri].leader_id.clone();
    let (x, y) = (building(&s.world, &s.storage).x, building(&s.world, &s.storage).y);
    let buyer = s.world.residents.iter_mut().find(|r| r.id == leader).unwrap();
    buyer.x = x;
    buyer.y = y;
    buyer.carried = stock(&[(Good::Coins, 500.0)]);
    buyer.order = Some(ResidentOrder::Trade(csp_shared::world::TradeOrder {
        side: TradeSide::Buy,
        good: Good::Iron,
        units: 3.0,
        carriage_id: None,
        city_id: None,
    }));
    step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
    let buyer = s.world.residents.iter().find(|r| r.id == leader).unwrap();
    assert_eq!(held(&buyer.carried, Good::Iron), 3.0);
    assert!(held(&buyer.carried, Good::Coins) < 500.0);
}

#[test]
fn opens_its_gates_to_those_who_come_to_trade() {
    let mut s = default_fixture();
    let c = s.city.clone();
    let gates: Vec<String> = s
        .world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(c.as_str()) && b.kind == BuildingKind::Gate)
        .map(|b| b.id.clone())
        .collect();
    assert!(!gates.is_empty());
    for b in &mut s.world.buildings {
        if gates.contains(&b.id) {
            b.closed = Some(true);
        }
    }
    take_it(&mut s);
    for g in &gates {
        assert_eq!(building(&s.world, g).closed, None);
    }
}

#[test]
fn settles_the_whole_debt_and_the_army_goes_home() {
    let mut s = fixture(9_000.0, TRADE_ORG_DEBT_TRIPS);
    let p = take_it(&mut s);
    assert_eq!(debt_of(&s.world, &s.realm), 0.0);
    assert!(read(&s.world, |e| matches!(
        e,
        RealmEventWhat::Debt { what: DebtWhat::CityTaken, coins, owed } if *coins == 9_000.0 && *owed == 0.0
    )));
    assert!(read(&s.world, |e| matches!(
        e,
        RealmEventWhat::CityCaptured { other: Some(o), .. } if o == "the Trade Organization"
    )));
    run(&mut s, 1, &never);
    assert_eq!(punishment(&s.world, &p).map(|x| x.heading), Some(PunishmentHeading::Home));
    assert!(read(&s.world, |e| matches!(
        e,
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::TookCity),
            takes: Some(true),
            ..
        }
    )));
    assert!(s.world.demands.iter().all(|d| d.to_id != s.realm));
}

#[test]
fn takes_one_city_for_a_realm_with_two_which_keeps_the_other() {
    let mut s = default_fixture();
    let realm = s.realm.clone();
    add_city(&mut s.world, "c9", Some(&realm), 400.0, 400.0, None);
    take_it(&mut s);
    assert_eq!(city(&s.world, "c9").realm_id.as_ref(), Some(&s.realm));
    assert_eq!(city(&s.world, &s.city).trade_org, Some(TradeOrgCity::Post));
}

#[test]
fn is_captured_later_as_any_post_is() {
    let mut s = default_fixture();
    take_it(&mut s);
    run(&mut s, 400, &|w| w.punishments.is_empty());
    let c = s.city.clone();
    let hall = town_hall_of(&s.world, city(&s.world, &c)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let ri = found_starting_city(&mut s.world, &s.terrain, 8, None);
    let (taker_id, realm) = (s.world.realms[ri].leader_id.clone(), s.world.realms[ri].id.clone());
    for r in &mut s.world.residents {
        if r.city_id.as_deref() == Some(c.as_str()) {
            r.carried.shift_remove(&Good::Spear);
        }
    }
    let taker = s.world.residents.iter_mut().find(|r| r.id == taker_id).unwrap();
    taker.x = hx;
    taker.y = hy;
    taker.carried.insert(Good::Spear, 1.0);
    taker.order = None;
    run(&mut s, 1, &never);
    assert_eq!(city(&s.world, &c).occupation.as_ref().map(|o| &o.realm_id), Some(&realm));
    let tick = s.world.tick as f64;
    city_mut(&mut s.world, &c).occupation.as_mut().unwrap().since = tick - OCCUPATION_TICKS + 2.0;
    let taker = s.world.residents.iter_mut().find(|r| r.id == taker_id).unwrap();
    taker.x = hx;
    taker.y = hy;
    let (c2, r2) = (c.clone(), realm.clone());
    run(&mut s, 10, &move |w| city(w, &c2).realm_id.as_ref() == Some(&r2));
    let w = &s.world;
    assert_eq!(city(w, &c).realm_id.as_ref(), Some(&realm));
    assert_eq!(city(w, &c).trade_org, None);
    assert_eq!(building(w, &s.storage).kind, BuildingKind::Storage);
    assert_eq!(w.caravans.iter().filter(|k| k.post_id == c).count(), 0);
    let captures = w
        .crimes
        .iter()
        .filter(|x| x.kind == CrimeKind::Capture && x.post.as_deref() == Some(c.as_str()));
    assert_eq!(captures.count(), 1);
}

#[test]
fn takes_an_npc_city_that_owes_and_the_invariants_hold() {
    let mut s = default_fixture();
    let mut m = Mulberry32::new(9.0);
    let npc =
        found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, 380, 128, &mut || m.next(), None);
    city_mut(&mut s.world, &npc).former_player =
        Some(serde_json::from_value(json!({ "userId": 99, "tick": 0 })).unwrap());
    s.world.debts = vec![Debt {
        org: npc.clone(),
        coins: 500.0,
        step: Some(DebtStep::Wrecks),
        deadline: None,
        trips: Some(2.0),
        city_id: Some(npc.clone()),
    }];
    disarm(&mut s.world, &npc);
    let p = army_on_the_hall(&mut s.world, &npc);
    run(&mut s, 1, &never);
    assert_eq!(
        city(&s.world, &npc).occupation.as_ref().map(|o| o.realm_id.as_str()),
        Some(TRADE_ORG)
    );
    let tick = s.world.tick as f64;
    city_mut(&mut s.world, &npc).occupation.as_mut().unwrap().since = tick - OCCUPATION_TICKS + 3.0;
    let n2 = npc.clone();
    run(&mut s, 10, &move |w| city(w, &n2).trade_org == Some(TradeOrgCity::Post));
    assert_eq!(city(&s.world, &npc).trade_org, Some(TradeOrgCity::Post));
    assert_eq!(city(&s.world, &npc).former_player, None);
    assert!(s.world.debts.is_empty());
    // Its army punished what is the Trade Organization's own now, on its way home.
    run(&mut s, 100, &never);
    assert_eq!(punishment(&s.world, &p).map(|x| x.heading), Some(PunishmentHeading::Home));
}

// where its goods go

#[test]
fn turns_every_storage_with_their_food_all_in_one_new_storage() {
    let mut s = default_fixture();
    let c = s.city.clone();
    let (x, y) = (building(&s.world, &s.storage).x, building(&s.world, &s.storage).y);
    s.world.buildings.push(
        serde_json::from_value(json!({
            "id": "b-second", "kind": "storage", "cityId": c, "x": x + 3.0, "y": y,
            "stock": { "food": 7, "wood": 5 },
        }))
        .unwrap(),
    );
    let food = held_in(building(&s.world, &s.storage).stock.as_ref(), Good::Food) + 7.0;
    city_mut(&mut s.world, &c).trade_org = Some(TradeOrgCity::Post);
    storages_become_warehouses(&mut s.world, &c, SIZE, Some(&s.terrain));
    assert_eq!(building(&s.world, &s.storage).kind, BuildingKind::Warehouse);
    let second = building(&s.world, "b-second");
    assert_eq!(second.kind, BuildingKind::Warehouse);
    assert_eq!(second.stock, Some(stock(&[(Good::Wood, 5.0)])));
    let eats: Vec<&Building> = s
        .world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(c.as_str()) && b.kind == BuildingKind::Storage)
        .collect();
    assert_eq!(eats.len(), 1);
    assert_eq!(eats[0].stock, Some(stock(&[(Good::Food, food)])));
}

#[test]
fn gives_a_city_with_no_storage_an_empty_storage_and_warehouse() {
    let mut s = default_fixture();
    let c = s.city.clone();
    let id = s.storage.clone();
    s.world.buildings.retain(|b| b.id != id);
    city_mut(&mut s.world, &c).trade_org = Some(TradeOrgCity::Post);
    storages_become_warehouses(&mut s.world, &c, SIZE, Some(&s.terrain));
    let own = s.world.buildings.iter().filter(|b| b.city_id.as_deref() == Some(c.as_str()));
    let of = |kind: BuildingKind| -> Vec<Option<Stock>> {
        own.clone().filter(|b| b.kind == kind).map(|b| b.stock.clone()).collect()
    };
    assert_eq!(of(BuildingKind::Storage), vec![Some(Stock::new())]);
    assert_eq!(of(BuildingKind::Warehouse), vec![Some(Stock::new())]);
}

#[test]
fn with_no_room_keeps_the_storage_holding_the_most_food() {
    let water = TerrainMap { size: SIZE, tiles: vec![Terrain::Sea as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&water, 1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", None, 100.0, 100.0, None);
    for (id, x, food) in [("s1", 104, 4), ("s2", 108, 6)] {
        world.buildings.push(
            serde_json::from_value(json!({
                "id": id, "kind": "storage", "cityId": "c1", "x": x, "y": 100,
                "stock": { "food": food, "iron": 2 },
            }))
            .unwrap(),
        );
    }
    city_mut(&mut world, "c1").trade_org = Some(TradeOrgCity::Post);
    storages_become_warehouses(&mut world, "c1", SIZE, Some(&water));
    let s2 = building(&world, "s2");
    assert_eq!(s2.kind, BuildingKind::Storage);
    assert_eq!(s2.stock, Some(stock(&[(Good::Iron, 2.0), (Good::Food, 10.0)])));
    let s1 = building(&world, "s1");
    assert_eq!(s1.kind, BuildingKind::Warehouse);
    assert_eq!(s1.stock, Some(stock(&[(Good::Iron, 2.0)])));
}

// paying first

#[test]
fn stops_it_at_once_and_it_goes_home() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    run(&mut s, 1, &never);
    assert_eq!(
        city(&s.world, &c).occupation.as_ref().map(|o| o.realm_id.as_str()),
        Some(TRADE_ORG)
    );
    s.world.debts.clear();
    assert_eq!(occupier_of(&s.world, city(&s.world, &c), SIZE), None);
    run(&mut s, 1, &never);
    let w = &s.world;
    assert_eq!(city(w, &c).occupation, None);
    assert_eq!(punishment(w, &p).map(|x| x.heading), Some(PunishmentHeading::Home));
    assert_eq!(city(w, &c).realm_id.as_ref(), Some(&s.realm));
    assert_eq!(city(w, &c).trade_org, None);
    assert_eq!(building(w, &s.storage).kind, BuildingKind::Storage);
    assert!(read(w, |e| matches!(
        e,
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::Paid),
            takes: Some(true),
            ..
        }
    )));
    assert!(read(w, |e| matches!(e, RealmEventWhat::OccupationBroken { .. })));
}

#[test]
fn stops_a_city_falling_in_the_very_tick_the_debt_is_paid() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    army_on_the_hall(&mut s.world, &c);
    run(&mut s, 1, &never);
    let tick = s.world.tick as f64;
    city_mut(&mut s.world, &c).occupation.as_mut().unwrap().since = tick - OCCUPATION_TICKS - 1.0;
    let warehouse = s
        .world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.is_some())
        .unwrap();
    let (x, y) = (warehouse.x, warehouse.y);
    let payer = s.world.residents.iter_mut().find(|r| r.id == s.leader).unwrap();
    payer.x = x;
    payer.y = y;
    payer.carried = stock(&[(Good::Coins, 500.0)]);
    let mut queue = OrderQueue::new(order_kinds(), Some(Arc::new(s.terrain.clone())));
    let said = queue.receive(
        &s.world,
        &OrderSender::player(7, "Mara"),
        &json!("a"),
        &json!({ "kind": "payDebt", "residentId": s.leader, "coins": 500 }),
    );
    assert!(matches!(said, OrderReply::Ack { .. }), "{said:?}");
    queue.apply_all(&mut s.world);
    step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
    assert_eq!(debt_of(&s.world, &s.realm), 0.0);
    assert_eq!(city(&s.world, &c).realm_id.as_ref(), Some(&s.realm));
    assert_eq!(city(&s.world, &c).trade_org, None);
}

#[test]
fn in_part_doesnt_stop_it() {
    let mut s = default_fixture();
    let c = s.city.clone();
    disarm(&mut s.world, &c);
    let p = army_on_the_hall(&mut s.world, &c);
    run(&mut s, 1, &never);
    s.world.debts[0].coins = 100.0;
    run(&mut s, 2, &never);
    assert_eq!(punishment(&s.world, &p).map(|x| x.heading), Some(PunishmentHeading::Out));
    assert_eq!(
        city(&s.world, &c).occupation.as_ref().map(|o| o.realm_id.as_str()),
        Some(TRADE_ORG)
    );
}

// the invariants

#[test]
fn catch_a_city_taken_before_its_trips_were_over() {
    let mut s = default_fixture();
    take_it(&mut s);
    with_cities_taken(&s.world, |t| t[0].enough_trips = false);
    assert_eq!(cities_taken_sound(&s.world).len(), 1);
}

#[test]
fn catch_a_city_taken_with_its_debt_still_owed_or_no_storage_to_eat_from() {
    let mut s = default_fixture();
    take_it(&mut s);
    s.world.debts.push(Debt {
        org: s.realm.clone(),
        coins: 1.0,
        step: None,
        deadline: None,
        trips: None,
        city_id: None,
    });
    assert!(cities_taken_sound(&s.world)[0].message.contains("still owes"));
    s.world.debts.clear();
    let c = s.city.clone();
    s.world
        .buildings
        .retain(|b| !(b.city_id.as_deref() == Some(c.as_str()) && b.kind == BuildingKind::Storage));
    assert!(cities_taken_sound(&s.world)[0].message.contains("no storage"));
}

#[test]
fn catch_an_army_come_to_take_a_city_before_its_trips_are_over() {
    let mut s = default_fixture();
    step_punishments(&mut s.world, SIZE);
    assert_eq!(punishments_sound(&s.world), vec![]);
    s.world.debts[0].trips = Some(0.0);
    assert!(punishments_sound(&s.world)[0].message.contains("after 0 trips"));
}

#[test]
fn catch_a_city_in_the_realm_of_the_trade_organization() {
    let mut s = default_fixture();
    let c = s.city.clone();
    city_mut(&mut s.world, &c).realm_id = Some(TRADE_ORG.into());
    let messages: Vec<String> =
        punishments_sound(&s.world).into_iter().map(|v| v.message).collect();
    assert!(messages.iter().any(|m| m.contains("holds city")), "{messages:?}");
}
