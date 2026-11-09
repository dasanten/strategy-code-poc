//! `apps/server/src/trade-org-debt.test.ts`, ported one to one, but for "shows in the Player's
//! diplomacy, and only theirs": `diplomacyFor` (the sync view) is not ported yet.

use std::sync::Arc;

use csp_shared::balance::{
    CRIME_STANDING_LOSS, TRADE_ORG_ARMY, TRADE_ORG_LOSS, TRADE_ORG_PUNISH,
    TRADE_ORG_REFUSES_TRADE_BELOW,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, City, CrimeKind, PunishedWhat, PunishmentEnd, PunishmentHeading, Stock,
    WorldState,
};

use super::*;
use crate::capture::capture_city;
use crate::directives::give_directive;
use crate::hq_fall::nothing_left_of_the_hq;
use crate::invariants::check_all;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::city::town_hall_of;
use crate::queries::names::held_in;
use crate::queries::trade_org::trade_org_refuses;
use crate::queries::warehouse::warehouse_keeps;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_punishment::{loss_of, step_punishments, worth_of};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 640;
/// Where the HQ's town hall stands.
const MID: f64 = 320.0;

/// What the army comes for after a theft of 10 Iron.
fn worth() -> f64 {
    TRADE_ORG_PUNISH.times * worth_of(&[(Good::Iron, 10.0)].into_iter().collect())
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: City,
    queue: OrderQueue,
    walking: Walking,
    scratch: Scratch,
}

fn mara() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// The Trade Org HQ; realm r1 (Player 7, Leader a1) with city c1, its storage s1 holding `stock`.
fn setup(stock: Stock) -> Setup {
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
            "id": "s1", "kind": "storage", "cityId": "c1", "x": MID + 4.0, "y": MID + 88.0, "stock": stock,
        }))
        .unwrap(),
    );
    let mut m1 = Mulberry32::new(1.0);
    let fields = NewResident {
        id: "a1",
        owner: Some("r1"),
        city_id: Some("c1"),
        x: MID - 4.0,
        y: MID + 92.0,
        tick: 0.0,
    };
    let mut a1 = new_resident(&mut || m1.next(), &fields, None);
    a1.born_at = -20.0 * 24.0 * 3600.0;
    a1.lifespan = 60.0;
    world.residents.push(a1);
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
    let hq = world.cities.iter().find(|c| c.id == hq).unwrap().clone();
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

fn a1(world: &mut WorldState) -> &mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == "a1").unwrap()
}

/// A1 of r1 stole `goods` from the HQ, and the Trade Organization knows of it. Returns the crime's
/// index.
fn theft(world: &mut WorldState, hq: &City, goods: Stock) -> usize {
    world.crimes.push(
        serde_json::from_value(json!({
            "id": format!("x{}", world.crimes.len() + 1),
            "kind": "theft",
            "tick": world.tick,
            "x": MID,
            "y": MID + 60.0,
            "culprit": { "residentId": "a1", "name": "Aldo", "org": "r1", "orgName": "the realm of Aldo" },
            "victimOrg": hq.id,
            "goods": goods,
            "witnesses": [],
            "knownBy": [hq.id],
        }))
        .unwrap(),
    );
    change_standing(world, &hq.id, "r1", -CRIME_STANDING_LOSS.theft);
    world.crimes.len() - 1
}

fn iron(n: f64) -> Stock {
    [(Good::Iron, n)].into_iter().collect()
}

/// Sends the army out for a theft and stands it in the city, ready to look in its storages.
/// Returns its id.
fn army_at_the_city(world: &mut WorldState, hq: &City) -> String {
    theft(world, hq, iron(10.0));
    step_punishments(world, SIZE);
    let c1 = world.cities.iter().find(|c| c.id == "c1").unwrap();
    let hall = town_hall_of(world, c1).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let ids: Vec<String> =
        world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        let r = world.residents.iter_mut().find(|x| &x.id == id).unwrap();
        r.x = hx;
        r.y = hy;
        world.punishments[0].members[mi].packed = Some(true);
    }
    world.punishments[0].id.clone()
}

fn debt_events(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::Debt { .. } | RealmEventWhat::DebtPaid { .. }))
        .collect()
}

fn heading(world: &WorldState, id: &str) -> Option<PunishmentHeading> {
    world.punishments.iter().find(|p| p.id == id).map(|p| p.heading)
}

fn debt(org: &str, coins: f64) -> Debt {
    Debt { org: org.into(), coins, step: None, deadline: None, trips: None, city_id: None }
}

// what the army can't take

#[test]
fn stays_owed_after_an_empty_trip_from_when_it_heads_home() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    let p = army_at_the_city(&mut s.world, &hq);
    assert!(s.world.debts.is_empty());
    step_punishments(&mut s.world, SIZE);
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    let mut want = debt("r1", worth());
    want.city_id = Some("c1".into());
    assert_eq!(s.world.debts, vec![want]);
    let n = s.world.events.len();
    assert!(matches!(
        &s.world.events[n - 1].what,
        RealmEventWhat::Debt { what: DebtWhat::Owed, coins, owed } if *coins == worth() && *owed == worth()
    ));
    assert!(matches!(
        &s.world.events[n - 2].what,
        RealmEventWhat::Punished { what: PunishedWhat::Left, why: Some(PunishmentEnd::Empty), .. }
    ));
    assert_eq!(debts_sound(&s.world), vec![]);
}

#[test]
fn leaves_only_what_it_didnt_take() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    let p = army_at_the_city(&mut s.world, &hq);
    let id = s.world.punishments[0].members[0].resident_id.clone();
    let member = s.world.residents.iter_mut().find(|r| r.id == id).unwrap();
    let had = held(&member.carried, Good::Coins);
    member.carried.insert(Good::Coins, had + 30.0);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments.iter().find(|x| x.id == p).unwrap().took, 30.0);
    assert_eq!(debt_of(&s.world, "r1"), worth() - 30.0);
}

#[test]
fn leaves_nothing_once_it_got_what_it_came_for() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    let p = army_at_the_city(&mut s.world, &hq);
    let id = s.world.punishments[0].members[0].resident_id.clone();
    let member = s.world.residents.iter_mut().find(|r| r.id == id).unwrap();
    let had = held(&member.carried, Good::Coins);
    member.carried.insert(Good::Coins, had + worth());
    step_punishments(&mut s.world, SIZE);
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    assert!(s.world.debts.is_empty());
    assert!(debt_events(&s.world).is_empty());
}

#[test]
fn leaves_all_of_it_when_it_turned_back_on_the_road() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    theft(&mut s.world, &hq, iron(10.0));
    step_punishments(&mut s.world, SIZE);
    let p = s.world.punishments[0].id.clone();
    s.world.punishments[0].started_at = s.world.tick as f64 - 100_000_000.0;
    step_punishments(&mut s.world, SIZE);
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    assert!(s.world.events.iter().any(|e| matches!(
        e.what,
        RealmEventWhat::Punished { what: PunishedWhat::TurnedBack, .. }
    )));
    assert_eq!(debt_of(&s.world, "r1"), worth());
}

#[test]
fn leaves_all_of_it_when_the_army_is_lost_before_it_heads_home_once_when_lost_after() {
    let mut lost = setup(Stock::new());
    let hq = lost.hq.clone();
    army_at_the_city(&mut lost.world, &hq);
    let ids: Vec<String> =
        lost.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    lost.world.residents.retain(|r| !ids.contains(&r.id));
    step_punishments(&mut lost.world, SIZE);
    assert_eq!(debt_of(&lost.world, "r1"), worth());

    let mut home = setup(Stock::new());
    let hq = home.hq.clone();
    let p = army_at_the_city(&mut home.world, &hq);
    step_punishments(&mut home.world, SIZE);
    assert_eq!(heading(&home.world, &p), Some(PunishmentHeading::Home));
    let ids: Vec<String> =
        home.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    home.world.residents.retain(|r| !ids.contains(&r.id));
    step_punishments(&mut home.world, SIZE);
    assert!(home.world.punishments.is_empty());
    assert_eq!(debt_of(&home.world, "r1"), worth());
}

#[test]
fn is_owed_in_whole_coins() {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    army_at_the_city(&mut s.world, &hq);
    s.world.punishments[0].worth = worth() + 0.5;
    step_punishments(&mut s.world, SIZE);
    assert_eq!(debt_of(&s.world, "r1"), worth() + 1.0);
}

#[test]
fn is_nothing_for_an_army_sent_by_admin_directive() {
    let mut s = setup(Stock::new());
    let d = give_directive(
        &mut s.world,
        &json!({
            "target": "r1",
            "withAlliance": false,
            "reason": "farms new Players",
            "price": null,
            "goals": [{ "kind": "soldiers", "count": 1000 }],
        }),
        "Daniel",
    )
    .unwrap();
    step_punishments(&mut s.world, SIZE);
    let p = s.world.punishments[0].id.clone();
    assert_eq!(s.world.punishments[0].directive_id.as_ref(), Some(&d.id));
    let c1 = s.world.cities.iter().find(|c| c.id == "c1").unwrap();
    let hall = town_hall_of(&s.world, c1).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let ids: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        let r = s.world.residents.iter_mut().find(|x| &x.id == id).unwrap();
        r.x = hx;
        r.y = hy;
        s.world.punishments[0].members[mi].packed = Some(true);
    }
    step_punishments(&mut s.world, SIZE);
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    assert!(s.world.debts.is_empty());
}

// later crimes

/// R1 owing what an empty trip left, with that army gone.
fn owing() -> Setup {
    let mut s = setup(Stock::new());
    let hq = s.hq.clone();
    army_at_the_city(&mut s.world, &hq);
    step_punishments(&mut s.world, SIZE);
    s.world.punishments.clear();
    s
}

#[test]
fn add_what_they_cost_once_and_send_no_army() {
    let mut s = owing();
    let hq = s.hq.clone();
    let c = theft(&mut s.world, &hq, iron(5.0));
    let loss = loss_of(&s.world.crimes[c]);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(debt_of(&s.world, "r1"), worth() + loss);
    assert_eq!(s.world.crimes[c].punished, Some(true));
    assert!(s.world.punishments.is_empty());
    assert!(matches!(
        &s.world.events.last().unwrap().what,
        RealmEventWhat::Debt { what: DebtWhat::Rose, coins, owed } if *coins == loss && *owed == worth() + loss
    ));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(debt_of(&s.world, "r1"), worth() + loss);
}

#[test]
fn count_other_crimes_too_at_what_they_cost() {
    let mut s = owing();
    let hq = s.hq.clone();
    let c = theft(&mut s.world, &hq, iron(10.0));
    s.world.crimes[c].kind = CrimeKind::Killing;
    s.world.crimes[c].goods = None;
    step_punishments(&mut s.world, SIZE);
    assert_eq!(debt_of(&s.world, "r1"), worth() + TRADE_ORG_LOSS.killing);
}

#[test]
fn wait_until_the_trade_organization_knows_of_them() {
    let mut s = owing();
    let hq = s.hq.clone();
    let c = theft(&mut s.world, &hq, iron(5.0));
    s.world.crimes[c].known_by.clear();
    step_punishments(&mut s.world, SIZE);
    assert_eq!(debt_of(&s.world, "r1"), worth());
    s.world.crimes[c].known_by = vec![hq.id.clone()];
    step_punishments(&mut s.world, SIZE);
    let loss = loss_of(&s.world.crimes[c]);
    assert_eq!(debt_of(&s.world, "r1"), worth() + loss);
}

#[test]
fn send_an_army_again_once_the_debt_is_paid() {
    let mut s = owing();
    let hq = s.hq.clone();
    s.world.debts.clear();
    theft(&mut s.world, &hq, iron(5.0));
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments.len(), 1);
}

// paying the debt

/// R1 owing `owed`, and a1 on the HQ's goods warehouse with `held` Coins of their own. Returns the
/// coin and the goods warehouse, by index.
fn at_warehouse(owed: f64, coins_held: f64) -> (Setup, usize, usize) {
    let mut s = setup(Stock::new());
    s.world.debts = vec![debt("r1", owed)];
    let hq = s.hq.id.clone();
    let warehouses: Vec<usize> = (0..s.world.buildings.len())
        .filter(|&i| {
            let b = &s.world.buildings[i];
            b.city_id.as_deref() == Some(hq.as_str()) && b.kind == BuildingKind::Warehouse
        })
        .collect();
    let keeps_coins =
        |i: usize| warehouse_keeps(&s.world, &s.world.buildings[i]).contains(&Good::Coins);
    let coins = *warehouses.iter().find(|&&i| keeps_coins(i)).unwrap();
    let goods = *warehouses.iter().find(|&&i| !keeps_coins(i)).unwrap();
    let (x, y) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    let a = a1(&mut s.world);
    a.x = x;
    a.y = y;
    a.carried = if coins_held > 0.0 {
        [(Good::Coins, coins_held)].into_iter().collect()
    } else {
        Stock::new()
    };
    (s, coins, goods)
}

fn pay(coins: Value, carriage: Option<&str>) -> Value {
    json!({ "kind": "payDebt", "residentId": "a1", "coins": coins, "carriageId": carriage })
}

fn send(s: &mut Setup, o: Value) -> OrderReply {
    s.queue.receive(&s.world, &mara(), &json!("q"), &o)
}

fn tick(s: &mut Setup) {
    s.queue.apply_all(&mut s.world);
    step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
}

fn acked(r: &OrderReply) -> bool {
    matches!(r, OrderReply::Ack { .. })
}

#[test]
fn in_part_leaves_the_rest_owed_the_coins_go_into_the_coin_warehouse() {
    let (mut s, coins, goods) = at_warehouse(100.0, 70.0);
    let before = held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins);
    assert!(acked(&send(&mut s, pay(json!(30), None))));
    tick(&mut s);
    assert_eq!(s.world.debts.len(), 1);
    assert_eq!((s.world.debts[0].org.as_str(), s.world.debts[0].coins), ("r1", 70.0));
    let a = a1(&mut s.world);
    assert_eq!(held(&a.carried, Good::Coins), 40.0);
    assert_eq!(a.order, None);
    assert_eq!(held_in(s.world.buildings[coins].stock.as_ref(), Good::Coins), before + 30.0);
    assert!(!s.world.buildings[goods]
        .stock
        .as_ref()
        .is_some_and(|st| st.contains_key(&Good::Coins)));
    let (gx, gy) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    let paid: Vec<&RealmEventWhat> = s
        .world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::DebtPaid { .. }))
        .collect();
    assert_eq!(paid.len(), 1);
    assert!(matches!(
        paid[0],
        RealmEventWhat::DebtPaid { coins, owed, x, y, .. } if *coins == 30.0 && *owed == 70.0 && *x == gx && *y == gy
    ));
    assert_eq!(with_debt_payments(&s.world, |p| p.len()), 1);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn in_full_ends_it_and_takes_no_more_than_is_owed() {
    let (mut s, _, _) = at_warehouse(100.0, 150.0);
    assert!(acked(&send(&mut s, pay(json!(500), None))));
    tick(&mut s);
    assert!(s.world.debts.is_empty());
    assert_eq!(held(&a1(&mut s.world).carried, Good::Coins), 50.0);
    assert!(matches!(
        &s.world.events.last().unwrap().what,
        RealmEventWhat::DebtPaid { coins, owed, .. } if *coins == 100.0 && *owed == 0.0
    ));
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

#[test]
fn takes_what_they_hold_when_it_is_less_than_they_offer() {
    let (mut s, _, _) = at_warehouse(100.0, 40.0);
    send(&mut s, pay(json!(90), None));
    tick(&mut s);
    assert_eq!(debt_of(&s.world, "r1"), 60.0);
    assert!(!a1(&mut s.world).carried.contains_key(&Good::Coins));
}

#[test]
fn can_come_from_a_carriage_there() {
    let (mut s, _, goods) = at_warehouse(100.0, 0.0);
    let (x, y) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    s.world.carriages.push(
        serde_json::from_value(json!({
            "id": "k1", "realmId": "r1", "cityId": null, "x": x, "y": y, "horseId": null,
            "load": { "coins": 100 },
        }))
        .unwrap(),
    );
    assert!(acked(&send(&mut s, pay(json!(100), Some("k1")))));
    tick(&mut s);
    assert!(s.world.debts.is_empty());
    assert!(!s.world.carriages[0].load.contains_key(&Good::Coins));
    assert!(!a1(&mut s.world).carried.contains_key(&Good::Coins));
}

#[test]
fn works_at_the_coin_warehouse_itself_and_from_a_realm_it_refuses_to_trade_with() {
    let (mut s, coins, _) = at_warehouse(100.0, 100.0);
    let (x, y) = (s.world.buildings[coins].x, s.world.buildings[coins].y);
    let a = a1(&mut s.world);
    a.x = x;
    a.y = y;
    change_standing(&mut s.world, TRADE_ORG, "r1", TRADE_ORG_REFUSES_TRADE_BELOW - 1.0);
    assert!(trade_org_refuses(&s.world, "r1"));
    assert!(acked(&send(&mut s, pay(json!(100), None))));
    tick(&mut s);
    assert!(s.world.debts.is_empty());
}

#[test]
fn is_refused_with_nothing_owed_no_coins_no_whole_number_or_off_a_warehouse() {
    let (mut s, _, goods) = at_warehouse(100.0, 100.0);
    let ask = |s: &Setup, o: Value| {
        let mut q = OrderQueue::new(order_kinds(), Some(Arc::new(s.terrain.clone())));
        match q.receive(&s.world, &mara(), &json!("q"), &o) {
            OrderReply::Ack { .. } => "ack".to_string(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    };
    assert_eq!(ask(&s, pay(json!(1), None)), "ack");
    for bad in [json!(0), json!(-5), json!(1.5), json!("lots")] {
        assert_eq!(ask(&s, pay(bad, None)), "pay a whole number of coins");
    }
    assert_eq!(ask(&s, pay(json!(1), Some("nope"))), "not one of your carriages");
    a1(&mut s.world).carried = Stock::new();
    assert_eq!(ask(&s, pay(json!(1), None)), "no coins to pay with");
    let (gx, gy) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    let a = a1(&mut s.world);
    a.carried = [(Good::Coins, 100.0)].into_iter().collect();
    a.x = gx + 30.0;
    a.y = gy + 30.0;
    assert_eq!(ask(&s, pay(json!(1), None)), "not at a Trade Org warehouse");
    let a = a1(&mut s.world);
    a.x = gx;
    a.y = gy;
    s.world.debts.clear();
    assert_eq!(ask(&s, pay(json!(1), None)), "your realm owes the Trade Organization nothing");
}

#[test]
fn does_nothing_when_the_debt_was_paid_since_the_order() {
    let (mut s, _, _) = at_warehouse(100.0, 100.0);
    send(&mut s, pay(json!(100), None));
    s.world.debts.clear();
    tick(&mut s);
    let a = a1(&mut s.world);
    assert_eq!(held(&a.carried, Good::Coins), 100.0);
    assert_eq!(a.order, None);
    assert_eq!(with_debt_payments(&s.world, |p| p.len()), 0);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

// the end of a debt

#[test]
fn comes_with_the_fall_of_the_hq_with_a_line_in_the_log() {
    let mut s = setup(Stock::new());
    s.world.realms.push(
        serde_json::from_value(json!({ "id": "r2", "userId": 8, "leaderId": "b1" })).unwrap(),
    );
    s.world.debts = vec![debt("r1", 100.0)];
    let hq = s.hq.id.clone();
    capture_city(&mut s.world, &hq, "r2", SIZE);
    assert!(s.world.debts.is_empty());
    let debts: Vec<&RealmEventWhat> = s
        .world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::Debt { .. }))
        .collect();
    assert_eq!(debts.len(), 1);
    assert!(matches!(
        debts[0],
        RealmEventWhat::Debt { what: DebtWhat::Ended, coins, owed } if *coins == 100.0 && *owed == 0.0
    ));
    assert_eq!(nothing_left_of_the_hq(&s.world), vec![]);
    s.world.debts = vec![debt("r1", 100.0)];
    assert_eq!(nothing_left_of_the_hq(&s.world).len(), 1);
}

#[test]
fn comes_with_the_end_of_the_organization_that_owes_it() {
    let mut s = setup(Stock::new());
    s.world.debts = vec![debt("r1", 100.0)];
    step_debts(&mut s.world);
    assert_eq!(s.world.debts.len(), 1);
    s.world.realms.clear();
    step_debts(&mut s.world);
    assert!(s.world.debts.is_empty());
}

// the debt invariants

#[test]
fn catch_a_debt_that_isnt_positive_of_an_organization_that_is_gone_or_kept_twice() {
    let mut s = setup(Stock::new());
    let messages =
        |w: &WorldState| -> Vec<String> { debts_sound(w).into_iter().map(|v| v.message).collect() };
    assert!(messages(&s.world).is_empty());
    s.world.debts = vec![debt("r1", 0.0)];
    assert_eq!(messages(&s.world), ["the debt of r1 is 0"]);
    s.world.debts = vec![debt("r1", -3.0)];
    assert_eq!(messages(&s.world), ["the debt of r1 is -3"]);
    s.world.debts = vec![debt("gone", 5.0)];
    assert_eq!(messages(&s.world), ["gone owes a debt but is gone"]);
    let hq = s.hq.id.clone();
    s.world.debts = vec![debt(&hq, 5.0)];
    assert_eq!(messages(&s.world), [format!("the Trade Organization owes itself, as {hq}")]);
    s.world.debts = vec![debt("r1", 5.0), debt("r1", 6.0)];
    assert_eq!(messages(&s.world), ["r1 has two debts"]);
}

#[test]
fn catch_a_payment_that_made_or_lost_coins_or_a_debt_that_fell_by_something_else() {
    let mut s = setup(Stock::new());
    s.world.debts = vec![debt("r1", 100.0)];
    let hq = s.hq.id.clone();
    let w = s
        .world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(hq.as_str()) && b.kind == BuildingKind::Warehouse)
        .unwrap();
    let (x, y) = (w.x, w.y);
    let a = a1(&mut s.world);
    a.x = x;
    a.y = y;
    a.carried = [(Good::Coins, 50.0)].into_iter().collect();
    send(&mut s, pay(json!(50), None));
    tick(&mut s);
    assert_eq!(debt_payments_sound(&s.world), vec![]);
    with_debt_payments(&s.world, |p| {
        p[0].coins_after += 1.0;
        p[0].owed_after -= 1.0;
    });
    assert_eq!(debt_payments_sound(&s.world).len(), 2);
}

#[test]
fn catch_a_pay_debt_order_that_outlasts_its_tick() {
    let mut s = setup(Stock::new());
    a1(&mut s.world).order =
        Some(ResidentOrder::PayDebt(PayDebtOrder { coins: 1.0, carriage_id: None }));
    assert_eq!(debt_orders_done(&s.world).len(), 1);
}
