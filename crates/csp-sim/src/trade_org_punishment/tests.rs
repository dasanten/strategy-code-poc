//! `apps/server/src/trade-org-punishment.test.ts`, ported one to one. Orders go through the order
//! queue as a Player's do; the world steps with the ported `Walking`.

use std::sync::Arc;

use csp_shared::balance::{
    CRIME_STANDING_LOSS, FOOD_PER_DAY, TRADE_ORG_ARMY, TRADE_ORG_PUNISH, TRADE_ORG_PUNISHES_BELOW,
    TRADE_ORG_REFUSES_TRADE_BELOW,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, City, Crime, Good, PunishedWhat, PunishedWhere, PunishmentEnd, PunishmentHeading,
    RealmEventWhat, Resident, ResidentOrder, Stock, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::city_area::in_city_area;
use crate::queries::residents::{carry_capacity, is_armed, stock_weight};
use crate::queries::standing::standing_of;
use crate::queries::trade_org::trade_org_refuses;
use crate::queries::warehouse::{stock_floor, warehouse_keeps};
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trading::refused_trade_nothing;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Where the HQ's town hall stands.
const MID: i32 = 320;
const M: f64 = MID as f64;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: City,
    queue: OrderQueue,
    walking: Walking,
    scratch: Scratch,
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn building(v: Value) -> Building {
    serde_json::from_value(v).unwrap()
}

/// The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 4 soldiers; realm r1 (Player 7,
/// Leader a1) with city c1 south of it, its storage s1 holding `stock`, and a far city c2 east.
fn setup(s1: Stock) -> Setup {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq_id = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), M, M + 88.0, None);
    world.buildings.push(building(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": MID + 4, "y": MID + 88, "stock": s1 }),
    ));
    add_city(&mut world, "c2", Some("r1"), M + 240.0, M, None);
    world.cities.iter_mut().find(|c| c.id == "c2").unwrap().name = "Farhold".into();
    resident(&mut world, "a1", M - 4.0, M + 92.0, Some("c1"));
    let hq = world.cities.iter().find(|c| c.id == hq_id).unwrap().clone();
    for i in hq_people(&world, &hq).into_iter().take(TRADE_ORG_ARMY.guard as usize + 4) {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    let shared = Arc::new(terrain.clone());
    Setup {
        world,
        terrain,
        hq,
        queue: OrderQueue::new(order_kinds(), Some(shared.clone())),
        walking: Walking::new(shared),
        scratch: Scratch::default(),
    }
}

fn default_setup() -> Setup {
    setup(stock(&[(Good::Coins, 1000.0), (Good::Iron, 40.0)]))
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
fn hq_people(world: &WorldState, hq: &City) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none() && r.city_id.as_deref() == Some(hq.id.as_str())
        })
        .collect()
}

/// A1 of r1 stole `goods` from the HQ near c1, and a witness has brought the news home: the Trade
/// Organization knows of it and holds r1 lower for it. Returns the crime's index.
fn theft(world: &mut WorldState, hq: &City, goods: Stock) -> usize {
    let crime: Crime = serde_json::from_value(json!({
        "id": format!("x{}", world.crimes.len() + 1),
        "kind": "theft",
        "tick": world.tick,
        "x": MID,
        "y": MID + 60,
        "culprit": { "residentId": "a1", "name": "Aldo", "org": "r1", "orgName": "the realm of Aldo" },
        "victimOrg": hq.id,
        "goods": goods,
        "witnesses": [],
        "knownBy": [hq.id],
    }))
    .unwrap();
    world.crimes.push(crime);
    change_standing(world, &hq.id, "r1", -CRIME_STANDING_LOSS.theft);
    world.crimes.len() - 1
}

/// The HQ's warehouse that keeps `good`, by index.
fn warehouse_for(world: &WorldState, hq: &City, good: Good) -> usize {
    world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(hq.id.as_str())
                && warehouse_keeps(world, b).contains(&good)
        })
        .unwrap()
}

/// Steps the world, keeping everyone fed, and checks every invariant now and then.
fn run(s: &mut Setup, ticks: usize, until: &dyn Fn(&WorldState) -> bool) {
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

/// Sends an order from the Player, applies it and answers whether it was taken.
fn order(s: &mut Setup, o: Value) -> String {
    let answer = s.queue.receive(&s.world, &OrderSender::player(7, "Mara"), &json!("q"), &o);
    s.queue.apply_all(&mut s.world);
    match answer {
        OrderReply::Ack { .. } => "ack".into(),
        OrderReply::Rejected { reason, .. } => reason,
    }
}

fn at<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn at_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

fn s1(world: &WorldState) -> &Building {
    world.buildings.iter().find(|b| b.id == "s1").unwrap()
}

fn punished(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::Punished { .. }))
        .collect()
}

fn last_punished(world: &WorldState) -> &RealmEventWhat {
    punished(world).last().expect("a punished line")
}

fn punished_what(e: &RealmEventWhat) -> PunishedWhat {
    match e {
        RealmEventWhat::Punished { what, .. } => *what,
        _ => panic!("no punished line"),
    }
}

fn punishment<'w>(world: &'w WorldState, id: &str) -> &'w Punishment {
    world.punishments.iter().find(|p| p.id == id).expect("the punishment under way")
}

// the Trade Organization refusing trade

/// A1 standing on the HQ's goods warehouse with coins to buy iron.
fn at_warehouse() -> Setup {
    let mut s = default_setup();
    let w = warehouse_for(&s.world, &s.hq, Good::Iron);
    let (x, y) = (s.world.buildings[w].x, s.world.buildings[w].y);
    let a1 = at_mut(&mut s.world, "a1");
    a1.x = x;
    a1.y = y;
    a1.carried.insert(Good::Coins, 200.0);
    s
}

fn buy_iron(kind: &str) -> Value {
    json!({ "kind": kind, "residentId": "a1", "good": "iron", "units": 1 })
}

const REFUSES: &str = "the Trade Organization won’t trade with you";

#[test]
fn trades_no_more_once_it_holds_the_realm_below_its_threshold() {
    let mut s = at_warehouse();
    change_standing(&mut s.world, TRADE_ORG, "r1", TRADE_ORG_REFUSES_TRADE_BELOW);
    assert!(!trade_org_refuses(&s.world, "r1"));
    assert_eq!(order(&mut s, buy_iron("buy")), "ack");
    // One theft known to it is enough.
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 1.0)]));
    assert!(trade_org_refuses(&s.world, "r1"));
    assert_eq!(order(&mut s, buy_iron("buy")), REFUSES);
    assert_eq!(order(&mut s, buy_iron("sell")), REFUSES);
}

#[test]
fn carries_out_no_trade_ordered_before_it_came_to_refuse_the_realm() {
    let mut s = at_warehouse();
    assert_eq!(order(&mut s, buy_iron("buy")), "ack");
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 1.0)]));
    run(&mut s, 1, &never);
    assert_eq!(held(&at(&s.world, "a1").carried, Good::Coins), 200.0);
    assert!(!at(&s.world, "a1").carried.contains_key(&Good::Iron));
}

#[test]
fn hires_out_no_soldiers_to_the_realm_and_asks_none_of_its_residents() {
    let mut s = at_warehouse();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 1.0)]));
    // Over the threshold for punishing, so the army stays home.
    change_standing(&mut s.world, TRADE_ORG, "r1", 3.0);
    let coins = s.world.buildings[warehouse_for(&s.world, &hq, Good::Coins)].id.clone();
    let offer = json!({
        "kind": "offerContract",
        "realmId": TRADE_ORG,
        "soldiers": 1,
        "days": 7,
        "pricePerWeek": TRADE_ORG_ARMY.price_per_soldier_week,
        "storageId": coins,
    });
    assert_eq!(order(&mut s, offer), "ack");
    run(&mut s, 1, &never);
    assert!(s.world.contracts.is_empty());
    let last = &s.world.events.last().unwrap().what;
    assert!(
        matches!(
            last,
            RealmEventWhat::Contract { what: csp_shared::world::ContractWhat::Declined, .. }
        ),
        "{last:?}"
    );
}

#[test]
fn reports_a_trade_by_a_realm_it_refuses() {
    let mut s = at_warehouse();
    assert_eq!(order(&mut s, buy_iron("buy")), "ack");
    run(&mut s, 1, &never);
    assert_eq!(refused_trade_nothing(&s.scratch.trades), vec![]);
    s.scratch.trades.records[0].refused = true;
    assert_eq!(refused_trade_nothing(&s.scratch.trades).len(), 1);
}

// the Trade Organization punishing

#[test]
fn takes_twice_the_loss_from_the_culprits_nearest_city_and_goes_home_without_capturing_it() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    let coins = warehouse_for(&s.world, &hq, Good::Coins);
    let before = held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins);
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    let worth = TRADE_ORG_PUNISH.times * worth_of(&stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 1, &never);
    let p = s.world.punishments[0].clone();
    assert_eq!((p.culprit_org.as_str(), p.city_id.as_str(), p.worth), ("r1", "c1", worth));
    assert_eq!(p.heading, PunishmentHeading::Out);
    assert_eq!(p.members.len(), 4);
    let last = &s.world.events.last().unwrap().what;
    assert!(
        matches!(last, RealmEventWhat::Punished { what: PunishedWhat::Coming, city, .. } if city == "Ashford"),
        "{last:?}"
    );
    let ids: Vec<String> = p.members.iter().map(|m| m.resident_id.clone()).collect();
    run(&mut s, (4.0 * TICKS_PER_GAME_DAY) as usize, &|w| w.punishments.is_empty());
    assert!(s.world.punishments.is_empty());
    // It never captured the city, and its soldiers are home again.
    let c1 = s.world.cities.iter().find(|c| c.id == "c1").unwrap();
    assert_eq!(c1.realm_id.as_deref(), Some("r1"));
    for id in &ids {
        let r = at(&s.world, id);
        assert!(in_city_area(&s.world, &hq.id, r.x, r.y, 160));
    }
    // What went on its supply wagon comes in just behind them.
    run(&mut s, TICKS_PER_GAME_DAY as usize, &|w| w.supply_wagons.is_empty());
    assert!(s.world.supply_wagons.is_empty());
    // Coins first: the storage had enough, so it took nothing else.
    assert_eq!(
        s1(&s.world).stock,
        Some(stock(&[(Good::Coins, 1000.0 - worth), (Good::Iron, 40.0)]))
    );
    assert_eq!(held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins), before + worth);
    let last = &s.world.events.last().unwrap().what;
    assert!(
        matches!(last, RealmEventWhat::Punished { what: PunishedWhat::Left, took: Some(t), .. } if *t == worth),
        "{last:?}"
    );
    // The crime is punished: it doesn't come again.
    run(&mut s, 1, &never);
    assert!(s.world.punishments.is_empty());
}

#[test]
fn takes_goods_once_the_coins_run_out_the_most_worth_first() {
    let mut s = setup(stock(&[(Good::Coins, 30.0), (Good::Wood, 50.0), (Good::Iron, 40.0)]));
    let hq = s.hq.clone();
    let goods = warehouse_for(&s.world, &hq, Good::Iron);
    // Nobody but its soldiers, and at its floor in every good, so its own chain leaves its Iron
    // be for as long as the trip takes.
    s.world.residents.retain(|r| r.owner.is_some() || is_armed(&r.carried));
    let mut full = stock_floor(&s.world, &s.world.buildings[goods]);
    for (&g, &n) in s.world.buildings[goods].stock.iter().flatten() {
        full.insert(g, n);
    }
    s.world.buildings[goods].stock = Some(full);
    let iron = held_in(s.world.buildings[goods].stock.as_ref(), Good::Iron);
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 4.0)]));
    run(&mut s, (4.0 * TICKS_PER_GAME_DAY) as usize, &|w| {
        w.punishments.is_empty() && w.supply_wagons.is_empty()
    });
    // 80 coins' worth: the 30 coins, then 5 iron.
    assert_eq!(s1(&s.world).stock, Some(stock(&[(Good::Wood, 50.0), (Good::Iron, 35.0)])));
    assert_eq!(held_in(s.world.buildings[goods].stock.as_ref(), Good::Iron), iron + 5.0);
}

#[test]
fn sends_nobody_while_it_holds_the_culprit_above_its_threshold_for_punishing() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    change_standing(&mut s.world, TRADE_ORG, "r1", 5.0);
    assert!(standing_of(&s.world, TRADE_ORG, "r1") >= TRADE_ORG_PUNISHES_BELOW);
    step_punishments(&mut s.world, 160);
    assert!(s.world.punishments.is_empty());
}

#[test]
fn waits_while_it_has_no_soldier_to_spare() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    for i in hq_people(&s.world, &hq).into_iter().skip(TRADE_ORG_ARMY.guard as usize) {
        s.world.residents[i].carried.shift_remove(&Good::Spear);
    }
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    step_punishments(&mut s.world, 160);
    assert!(s.world.punishments.is_empty());
    assert_eq!(s.world.crimes[0].punished, None);
}

#[test]
fn goes_for_the_culprits_city_nearest_the_crime() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    let c = theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    s.world.crimes[c].x = M + 220.0;
    s.world.crimes[c].y = M;
    step_punishments(&mut s.world, 160);
    assert_eq!(s.world.punishments[0].city_id, "c2");
}

#[test]
fn fights_whoever_attacks_its_soldiers() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    step_punishments(&mut s.world, 160);
    let target = s.world.punishments[0].members[0].resident_id.clone();
    let d = resident(&mut s.world, "d1", M, M + 80.0, Some("c1"));
    s.world.residents[d].carried.insert(Good::Spear, 1.0);
    s.world.residents[d].order = Some(ResidentOrder::Attack(attack_order(&target, false, false)));
    step_punishments(&mut s.world, 160);
    for m in &s.world.punishments[0].members {
        let o = &at(&s.world, &m.resident_id).order;
        assert!(matches!(o, Some(ResidentOrder::Attack(a)) if a.target_id == "d1"), "{o:?}");
    }
}

#[test]
fn leaves_the_members_of_a_punishment_to_it_not_to_the_hq() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 2, &never);
    for m in &s.world.punishments[0].members {
        let o = &at(&s.world, &m.resident_id).order;
        assert!(matches!(o, Some(ResidentOrder::WalkTo(_))), "{o:?}");
    }
}

#[test]
fn reports_a_punishment_that_doesnt_hold_together() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    step_punishments(&mut s.world, 160);
    assert_eq!(punishments_sound(&s.world), vec![]);
    let mut p2 = s.world.punishments[0].clone();
    p2.id = "p2".into();
    p2.members = vec![s.world.punishments[0].members[0].clone()];
    let first = p2.members[0].resident_id.clone();
    let pid = s.world.punishments[0].id.clone();
    s.world.punishments.push(p2);
    s.world.punishments[0].members.push(PunishmentMember {
        resident_id: "a1".into(),
        own: Stock::new(),
        packed: None,
        seller: None,
        no_way: None,
    });
    s.world.cities[0].realm_id = Some(TRADE_ORG.into());
    let city = s.world.cities[0].id.clone();
    let messages: Vec<String> =
        punishments_sound(&s.world).into_iter().map(|v| v.message).collect();
    for want in [
        "r1 is punished twice at once".to_string(),
        format!("{first} is in two punishments"),
        format!("punishment {pid} sends a1, who is not of the Trade Org HQ"),
        format!("the Trade Organization holds city {city}"),
    ] {
        assert!(messages.contains(&want), "{want} among {messages:?}");
    }
}

// the Trade Organization's punishment trip

#[test]
#[ignore = "10.4 s alone; see #1132"]
fn walks_to_a_city_farther_than_its_time_there_robs_it_and_comes_home_alive() {
    use csp_shared::balance::{MAP_SIZE, WALK_TICKS_PER_TILE};
    // As large as the real map, all Plains.
    let big = plains(MAP_SIZE);
    // The HQ's town hall, and the farthest a city can be: half the map away on both axes.
    let (hq_at, far) = (200, MAP_SIZE / 2);
    let mut world = create_world(&big, 1);
    let mut m = Mulberry32::new(7.0);
    let hq_id = found_trade_org_hq(&mut world, &big, hq_at, hq_at, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    let c = f64::from(hq_at + far);
    add_city(&mut world, "c1", Some("r1"), c, c, None);
    world.buildings.push(building(json!({
        "id": "s1", "kind": "storage", "cityId": "c1", "x": hq_at + far + 4, "y": hq_at + far,
        "stock": { "coins": 1000, "food": 200 },
    })));
    resident(&mut world, "a1", c - 4.0, c + 4.0, Some("c1"));
    let hq = world.cities.iter().find(|x| x.id == hq_id).unwrap().clone();
    // Nobody but `TRADE_ORG_ARMY.guard` + 4 soldiers of average Strength and Endurance.
    let keep: Vec<String> = hq_people(&world, &hq)
        .into_iter()
        .take(TRADE_ORG_ARMY.guard as usize + 4)
        .map(|i| world.residents[i].id.clone())
        .collect();
    world
        .residents
        .retain(|r| r.city_id.as_deref() != Some(hq.id.as_str()) || keep.contains(&r.id));
    world.caravans.clear();
    for r in world.residents.iter_mut().filter(|r| keep.contains(&r.id)) {
        r.carried = stock(&[(Good::Spear, 1.0)]);
        let average: csp_shared::world::Stat =
            serde_json::from_value(json!({ "base": 10, "trained": 0 })).unwrap();
        r.stats.strength = average.clone();
        r.stats.endurance = average.clone();
        r.stats.agility = average;
        r.born_at = -20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
    }
    let mut walking = Walking::new(Arc::new(big.clone()));
    let mut scratch = Scratch::default();
    let mut run_big = |world: &mut WorldState, until: &dyn Fn(&WorldState) -> bool, most: usize| {
        for _ in 0..most {
            if until(world) {
                break;
            }
            step_world(world, &big, &mut scratch, Some(&mut walking), None);
        }
    };
    assert!(
        f64::from(far) * std::f64::consts::SQRT_2 * WALK_TICKS_PER_TILE
            > TRADE_ORG_PUNISH.give_up_days * TICKS_PER_GAME_DAY
    );
    theft(&mut world, &hq, stock(&[(Good::Iron, 10.0)]));
    let worth = TRADE_ORG_PUNISH.times * worth_of(&stock(&[(Good::Iron, 10.0)]));
    run_big(&mut world, &|w| !w.punishments.is_empty(), 2);
    let pid = world.punishments[0].id.clone();
    let ids: Vec<String> =
        world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    // At average Strength, what they pack lasts the longest way there and back over Plains.
    let id = pid.clone();
    run_big(
        &mut world,
        &move |w| {
            w.punishments
                .iter()
                .find(|p| p.id == id)
                .is_some_and(|p| p.members.iter().all(|m| m.packed == Some(true)))
        },
        2000,
    );
    run_big(&mut world, &never, 2);
    let flat_walk = (2.0 * f64::from(far) * std::f64::consts::SQRT_2 * WALK_TICKS_PER_TILE)
        / TICKS_PER_GAME_DAY;
    for id in &ids {
        assert!(held(&at(&world, id).carried, Good::Food) >= flat_walk * FOOD_PER_DAY);
    }
    let id = pid.clone();
    run_big(
        &mut world,
        &move |w| w.punishments.iter().find(|p| p.id == id).is_none_or(|p| p.arrived_at.is_some()),
        70_000,
    );
    assert!(world.punishments.iter().find(|p| p.id == pid).is_some_and(|p| p.arrived_at.is_some()));
    assert!(ids.iter().any(|id| {
        let r = at(&world, id);
        in_city_area(&world, "c1", r.x, r.y, MAP_SIZE)
    }));
    run_big(&mut world, &|w| w.punishments.is_empty(), 70_000);
    assert!(world.punishments.is_empty());
    assert_eq!(held_in(s1(&world).stock.as_ref(), Good::Coins), 1000.0 - worth);
    for id in &ids {
        let r = at(&world, id);
        assert!(r.health > 0.0);
        assert_eq!(r.down_until, None);
        assert!(in_city_area(&world, &hq.id, r.x, r.y, MAP_SIZE));
    }
    let whats: Vec<PunishedWhat> = punished(&world).into_iter().map(punished_what).collect();
    assert_eq!(whats, vec![PunishedWhat::Coming, PunishedWhat::Arrived, PunishedWhat::Left]);
    assert!(matches!(
        last_punished(&world),
        RealmEventWhat::Punished { what: PunishedWhat::Left, took: Some(t), .. } if *t == worth
    ));
    assert_eq!(check_all(&world, &big), vec![]);
}

#[test]
#[ignore = "40.5 s alone; see #1132"]
fn sets_out_however_empty_the_storages_are_as_it_leaves_and_looks_when_it_arrives() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 3, &never);
    let pid = s.world.punishments[0].id.clone();
    assert_eq!(s.world.punishments[0].heading, PunishmentHeading::Out);
    assert_eq!(s.world.punishments[0].arrived_at, None);
    let mut arrived = false;
    let mut left = None;
    for _ in 0..(4.0 * TICKS_PER_GAME_DAY) as usize {
        run(&mut s, 1, &never);
        let Some(p) = s.world.punishments.iter().find(|p| p.id == pid) else { break };
        arrived |= p.arrived_at.is_some();
        if p.heading == PunishmentHeading::Home {
            left = Some(p.clone());
            break;
        }
    }
    assert!(arrived && left.is_some_and(|p| p.arrived_at.is_some()));
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished { what: PunishedWhat::Left, why: Some(PunishmentEnd::Empty), took: Some(t), .. } if *t == 0.0
    ));
    assert!(punished(&s.world).iter().any(|e| punished_what(e) == PunishedWhat::Arrived));
}

#[test]
fn robs_storages_filled_again_while_it_was_on_the_way() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 3, &never);
    s.world.buildings.iter_mut().find(|b| b.id == "s1").unwrap().stock =
        Some(stock(&[(Good::Coins, 1000.0)]));
    run(&mut s, (4.0 * TICKS_PER_GAME_DAY) as usize, &|w| w.punishments.is_empty());
    assert!(held_in(s1(&s.world).stock.as_ref(), Good::Coins) < 1000.0);
}

#[test]
fn turns_back_on_the_road_when_the_city_is_no_longer_the_culprits_and_says_so() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 3, &never);
    let pid = s.world.punishments[0].id.clone();
    s.world.cities.iter_mut().find(|c| c.id == "c1").unwrap().realm_id = None;
    step_punishments(&mut s.world, 640);
    let p = punishment(&s.world, &pid);
    assert_eq!((p.heading, p.took, p.arrived_at), (PunishmentHeading::Home, 0.0, None));
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished { what: PunishedWhat::TurnedBack, why: Some(PunishmentEnd::CityLost), city, .. } if city == "Ashford"
    ));
}

#[test]
fn says_the_army_was_lost_when_every_soldier_falls_on_the_way() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 3, &never);
    let ids: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    s.world.residents.retain(|r| !ids.contains(&r.id));
    run(&mut s, 1, &never);
    assert!(s.world.punishments.is_empty());
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Lost,
            r#where: Some(PunishedWhere::WayThere),
            ..
        }
    ));
}

#[test]
fn turns_back_when_it_cant_get_there_rather_than_walking_forever() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    step_punishments(&mut s.world, 640);
    let pid = s.world.punishments[0].id.clone();
    s.world.tick = (s.world.punishments[0].started_at
        + TRADE_ORG_PUNISH.give_up_days * TICKS_PER_GAME_DAY) as u64;
    step_punishments(&mut s.world, 640);
    assert_eq!(punishment(&s.world, &pid).heading, PunishmentHeading::Home);
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::TurnedBack,
            why: Some(PunishmentEnd::NoWay),
            ..
        }
    ));
}

#[test]
fn packs_food_for_the_way_there_and_back_at_the_hq_leaving_room_to_carry_goods_home() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    let c = theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    s.world.crimes[c].x = M + 220.0;
    s.world.crimes[c].y = M;
    let before = held_in(hq_storage(&s.world, &hq).stock.as_ref(), Good::Food);
    run(&mut s, 1, &never);
    let pid = s.world.punishments[0].id.clone();
    assert_eq!(s.world.punishments[0].city_id, "c2");
    run(&mut s, 2000, &|w| {
        w.punishments
            .iter()
            .find(|p| p.id == pid)
            .is_some_and(|p| p.members.iter().all(|m| m.packed == Some(true)))
    });
    run(&mut s, 2, &never);
    let wanted =
        csp_shared::balance::trip_food(2.0 * 240.0) + TRADE_ORG_PUNISH.give_up_days * FOOD_PER_DAY;
    for m in &punishment(&s.world, &pid).members {
        let r = at(&s.world, &m.resident_id);
        assert!(held(&r.carried, Good::Food) >= wanted - 1.0, "{} carries {:?}", r.id, r.carried);
        assert!(
            carry_capacity(r, s.world.tick as f64) - stock_weight(&r.carried)
                >= TRADE_ORG_PUNISH.pack_room
        );
    }
    assert!(held_in(hq_storage(&s.world, &hq).stock.as_ref(), Good::Food) < before);
    // What they packed is theirs, not what they came to take.
    assert_eq!(took_so_far(&s.world, punishment(&s.world, &pid)), 0.0);
}

/// The HQ's storage.
fn hq_storage<'w>(world: &'w WorldState, hq: &City) -> &'w Building {
    world
        .buildings
        .iter()
        .find(|b| {
            b.city_id.as_deref() == Some(hq.id.as_str())
                && b.kind == csp_shared::world::BuildingKind::Storage
        })
        .unwrap()
}

/// Runs until every member of punishment `pid` has packed.
fn until_packed(s: &mut Setup, pid: &str) {
    let pid = pid.to_string();
    run(s, 2000, &move |w| {
        w.punishments
            .iter()
            .find(|p| p.id == pid)
            .is_some_and(|p| p.members.iter().all(|m| m.packed == Some(true)))
    });
    run(s, 2, &never);
}

#[test]
fn packs_from_its_goods_warehouse_when_its_storage_has_no_food() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    let storage = s
        .world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(hq.id.as_str())
                && b.kind == csp_shared::world::BuildingKind::Storage
        })
        .unwrap();
    s.world.buildings[storage].stock = Some(Stock::new());
    let w = warehouse_for(&s.world, &hq, Good::Iron);
    s.world.buildings[w].stock.get_or_insert_with(Stock::new).insert(Good::Food, 200.0);
    run(&mut s, 1, &never);
    let pid = s.world.punishments[0].id.clone();
    until_packed(&mut s, &pid);
    for m in &punishment(&s.world, &pid).members {
        assert!(held(&at(&s.world, &m.resident_id).carried, Good::Food) > OWN_FOOD);
    }
    assert!(held_in(s.world.buildings[w].stock.as_ref(), Good::Food) < 200.0);
}

#[test]
fn sets_out_with_what_it_has_when_the_hq_has_no_food_at_all() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    for b in &mut s.world.buildings {
        if b.city_id.as_deref() == Some(hq.id.as_str()) {
            if let Some(st) = b.stock.as_mut() {
                st.shift_remove(&Good::Food);
            }
        }
    }
    s.world.residents.retain(|r| r.owner.is_some() || is_armed(&r.carried));
    run(&mut s, 1, &never);
    let pid = s.world.punishments[0].id.clone();
    // They fetch their Coins (`pack_purse`), find no Food and go.
    until_packed(&mut s, &pid);
    let p = punishment(&s.world, &pid);
    assert!(p.members.iter().all(|m| m.packed == Some(true)));
    let o = &at(&s.world, &p.members[0].resident_id).order;
    assert!(matches!(o, Some(ResidentOrder::WalkTo(_))), "{o:?}");
}

#[test]
fn never_packs_into_the_room_it_leaves_for_what_it_carries_home() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 1, &never);
    let pid = s.world.punishments[0].id.clone();
    // Weak, and sent so far the walk's Food alone wouldn't fit.
    s.world.punishments[0].city_id = "c2".into();
    let ids: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for id in &ids {
        at_mut(&mut s.world, id).stats.strength =
            serde_json::from_value(json!({ "base": 1, "trained": 0 })).unwrap();
    }
    until_packed(&mut s, &pid);
    for id in &ids {
        let r = at(&s.world, id);
        assert!(
            carry_capacity(r, s.world.tick as f64) - stock_weight(&r.carried)
                >= TRADE_ORG_PUNISH.pack_room
        );
    }
}

#[test]
fn refills_at_a_trading_post_it_passes_which_is_no_theft() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 1, &never);
    let rid = s.world.punishments[0].members[0].resident_id.clone();
    add_city(&mut s.world, "post", None, M, M + 60.0, Some(csp_shared::world::TradeOrgCity::Post));
    s.world.cities.iter_mut().find(|c| c.id == "post").unwrap().name = "Waypost".into();
    s.world.buildings.push(building(
        json!({ "id": "ps", "kind": "storage", "cityId": "post", "x": MID + 8, "y": MID + 60, "stock": { "food": 50 } }),
    ));
    for m in &mut s.world.punishments[0].members {
        m.packed = Some(true);
    }
    s.world.punishments[0].members[0].own.insert(Good::Food, 0.0);
    let r = at_mut(&mut s.world, &rid);
    r.x = M + 2.0;
    r.y = M + 40.0;
    r.carried.insert(Good::Food, 0.0);
    let crimes = s.world.crimes.len();
    let id = rid.clone();
    run(&mut s, 400, &move |w| held(&at(w, &id).carried, Good::Food) >= 2.0);
    let r = at(&s.world, &rid);
    assert!(held(&r.carried, Good::Food) >= 2.0);
    let ps = s.world.buildings.iter().find(|b| b.id == "ps").unwrap();
    assert!(held_in(ps.stock.as_ref(), Good::Food) < 50.0);
    assert_eq!(s.world.crimes.len(), crimes);
    let own = &s.world.punishments[0].members[0].own;
    assert_eq!(taken_by(r, own), Stock::new());
}

#[test]
fn takes_food_for_the_way_back_at_the_city_apart_from_what_it_came_for() {
    let mut s = setup(stock(&[(Good::Coins, 1000.0), (Good::Food, 40.0)]));
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    let worth = TRADE_ORG_PUNISH.times * worth_of(&stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 1, &never);
    let pid = s.world.punishments[0].id.clone();
    let id = pid.clone();
    run(&mut s, (4.0 * TICKS_PER_GAME_DAY) as usize, &move |w| {
        w.punishments.iter().find(|p| p.id == id).is_some_and(|p| p.arrived_at.is_some())
    });
    // Worn down to what they need on the way back: nothing left of what they packed.
    let pi = s.world.punishments.iter().position(|p| p.id == pid).unwrap();
    let ids: Vec<String> =
        s.world.punishments[pi].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        at_mut(&mut s.world, id).carried.insert(Good::Food, 0.0);
        s.world.punishments[pi].members[mi].own.insert(Good::Food, 0.0);
    }
    let id = pid.clone();
    run(&mut s, (4.0 * TICKS_PER_GAME_DAY) as usize, &move |w| {
        w.punishments
            .iter()
            .find(|p| p.id == id)
            .is_some_and(|p| p.heading == PunishmentHeading::Home)
    });
    assert_eq!(punishment(&s.world, &pid).took, worth);
    assert!(held_in(s1(&s.world).stock.as_ref(), Good::Food) < 40.0);
}

#[test]
fn doesnt_walk_back_to_the_city_for_food_once_it_is_far_along_the_way_home() {
    let mut s = setup(stock(&[(Good::Coins, 1000.0), (Good::Food, 40.0)]));
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    run(&mut s, 1, &never);
    let tick = s.world.tick as f64;
    let p = &mut s.world.punishments[0];
    p.heading = PunishmentHeading::Home;
    p.arrived_at = Some(tick);
    p.members[0].packed = Some(true);
    p.members[0].own = stock(&[(Good::Spear, 1.0)]);
    let rid = p.members[0].resident_id.clone();
    // Past `post_reach` from the city's storage and from the HQ's, a meal short of the way home.
    let r = at_mut(&mut s.world, &rid);
    r.x = M + 200.0;
    r.y = M + 88.0;
    r.carried = stock(&[(Good::Spear, 1.0)]);
    r.order = None;
    step_punishments(&mut s.world, 640);
    let (sx, sy) = (s1(&s.world).x, s1(&s.world).y);
    let o = &at(&s.world, &rid).order;
    assert!(
        matches!(o, Some(ResidentOrder::WalkTo(w)) if !(w.target.x == sx && w.target.y == sy)),
        "{o:?}"
    );
}

#[test]
fn reports_a_punishment_that_took_anything_before_it_arrived() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, stock(&[(Good::Iron, 10.0)]));
    step_punishments(&mut s.world, 640);
    assert_eq!(punishments_sound(&s.world), vec![]);
    let pid = s.world.punishments[0].id.clone();
    s.world.punishments[0].took = 5.0;
    let got: Vec<String> = punishments_sound(&s.world).into_iter().map(|v| v.message).collect();
    assert!(got.contains(&format!("punishment {pid} took 5 before it arrived")), "{got:?}");
    let started = s.world.punishments[0].started_at;
    s.world.punishments[0].arrived_at = Some(started - 1.0);
    let got: Vec<String> = punishments_sound(&s.world).into_iter().map(|v| v.message).collect();
    assert!(got.contains(&format!("punishment {pid} arrived before it set out")), "{got:?}");
}

// a caravan

#[test]
fn belongs_to_the_hq_so_robbing_it_is_a_crime_against_the_trade_organization() {
    let mut s = default_setup();
    let hq = s.hq.clone();
    let hall = town_hall_of(&s.world, &hq).unwrap();
    let (x, y) = (hall.x, hall.y);
    s.world.carriages.push(
        serde_json::from_value(json!({
            "id": "k1", "realmId": null, "cityId": hq.id, "x": x, "y": y, "horseId": null, "load": {}
        }))
        .unwrap(),
    );
    let k = s.world.carriages.last().unwrap();
    assert_eq!(crate::crimes::carriage_organization(k), Some(hq.id.as_str()));
}
