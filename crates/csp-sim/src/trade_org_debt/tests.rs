//! `trade-org-debt.test.ts`: paying the debt, the end of a debt and the invariants. What the army
//! can't take and later crimes need `trade-org-punishment.ts` (T86.9), and the debt's end with
//! the Fall of the HQ needs `hq-fall.ts` (T86.9); their cases come with those.

use std::sync::Arc;

use super::*;
use crate::invariants::{check_invariants, world_invariants};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::trade_org::trade_org_refuses;
use crate::queries::warehouse::warehouse_keeps;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_support::{add_city, building, plains};
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::world::{create_world, step_world};
use csp_shared::balance::TRADE_ORG_REFUSES_TRADE_BELOW;
use csp_shared::world::{BuildingKind, Carriage, Realm, Stock};
use serde_json::json;

const MID: i32 = 320;

fn player() -> OrderSender {
    OrderSender::player(7, "Mara")
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    hq: String,
    queue: OrderQueue,
    scratch: Scratch,
}

/// The Trade Org HQ; realm r1 (Player 7, Leader a1) with city c1, its storage s1.
fn setup() -> Setup {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "a1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    let mid = f64::from(MID);
    add_city(&mut world, "c1", Some("r1"), mid, mid + 88.0);
    let mut s1 = building("s1", BuildingKind::Storage, Some("c1"), mid + 4.0, mid + 88.0);
    s1.stock = Some(Stock::new());
    world.buildings.push(s1);
    let mut r = Mulberry32::new(1.0);
    let fields = NewResident {
        id: "a1",
        owner: Some("r1"),
        city_id: Some("c1"),
        x: mid - 4.0,
        y: mid + 92.0,
        tick: 0.0,
    };
    let mut a1 = new_resident(&mut || r.next(), &fields, None);
    a1.born_at = -20.0 * 24.0 * 3600.0;
    a1.lifespan = 60.0;
    world.residents.push(a1);
    let terrain = Arc::new(terrain);
    Setup {
        world,
        queue: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        terrain,
        hq,
        scratch: Scratch::default(),
    }
}

/// R1 owing `owed`, and a1 on the HQ's goods warehouse with `held` coins of their own: the
/// setup, and the coin and goods warehouses' indices.
fn at_warehouse(owed: f64, held: f64) -> (Setup, usize, usize) {
    let mut s = setup();
    s.world.debts = vec![debt("r1", owed)];
    let warehouses: Vec<usize> = (0..s.world.buildings.len())
        .filter(|&i| {
            let b = &s.world.buildings[i];
            b.city_id.as_deref() == Some(s.hq.as_str()) && b.kind == BuildingKind::Warehouse
        })
        .collect();
    let keeps_coins =
        |i: usize| warehouse_keeps(&s.world, &s.world.buildings[i]).contains(&Good::Coins);
    let coins = *warehouses.iter().find(|&&i| keeps_coins(i)).unwrap();
    let goods = *warehouses.iter().find(|&&i| !keeps_coins(i)).unwrap();
    s.stand_on(goods);
    s.a1().carried =
        if held > 0.0 { [(Good::Coins, held)].into_iter().collect() } else { Stock::new() };
    (s, coins, goods)
}

fn debt(org: &str, coins: f64) -> Debt {
    Debt { org: org.into(), coins, step: None, deadline: None, trips: None, city_id: None }
}

fn pay(coins: Value, carriage_id: Value) -> Value {
    json!({ "kind": "payDebt", "residentId": "a1", "coins": coins, "carriageId": carriage_id })
}

impl Setup {
    fn a1(&mut self) -> &mut csp_shared::world::Resident {
        self.world.residents.iter_mut().find(|r| r.id == "a1").unwrap()
    }

    fn stand_on(&mut self, b: usize) {
        let (x, y) = (self.world.buildings[b].x, self.world.buildings[b].y);
        let a1 = self.a1();
        a1.x = x;
        a1.y = y;
    }

    fn ask(&self, order: Value) -> OrderReply {
        let mut queue = OrderQueue::new(order_kinds(), Some(self.terrain.clone()));
        queue.receive(&self.world, &player(), &json!("q"), &order)
    }

    fn give(&mut self, order: Value) {
        let reply = self.queue.receive(&self.world, &player(), &json!("q"), &order);
        assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
    }

    fn tick(&mut self) {
        self.queue.apply_all(&mut self.world);
        let terrain = self.terrain.clone();
        step_world(&mut self.world, &terrain, &mut self.scratch, None, None);
    }

    fn sound(&self) {
        assert_eq!(check_invariants(&self.world, &self.terrain, &world_invariants()), vec![]);
        assert_eq!(debt_payments_sound(&self.scratch.debt_payments), vec![]);
    }

    fn coins(&mut self) -> Option<f64> {
        self.a1().carried.get(&Good::Coins).copied()
    }

    fn events(&self, kind: &str) -> Vec<Value> {
        self.world
            .events
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == kind)
            .collect()
    }
}

fn reason(reply: OrderReply) -> String {
    match reply {
        OrderReply::Rejected { reason, .. } => reason,
        other => panic!("not rejected: {other:?}"),
    }
}

#[test]
fn paying_in_part_leaves_the_rest_owed_and_the_coins_go_into_the_coin_warehouse() {
    let (mut s, coins, goods) = at_warehouse(100.0, 70.0);
    let held = |s: &Setup, b: usize| {
        s.world.buildings[b].stock.as_ref().and_then(|x| x.get(&Good::Coins)).copied()
    };
    let before = held(&s, coins).unwrap_or(0.0);
    s.give(pay(json!(30), Value::Null));
    s.tick();
    assert_eq!((s.world.debts[0].org.as_str(), s.world.debts[0].coins), ("r1", 70.0));
    assert_eq!(s.coins(), Some(40.0));
    assert!(s.a1().order.is_none());
    assert_eq!(held(&s, coins), Some(before + 30.0));
    assert_eq!(held(&s, goods), None);
    let paid = s.events("debtPaid");
    assert_eq!(paid.len(), 1);
    let (gx, gy) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    assert_eq!(
        (
            paid[0]["coins"].as_f64(),
            paid[0]["owed"].as_f64(),
            paid[0]["x"].as_f64(),
            paid[0]["y"].as_f64()
        ),
        (Some(30.0), Some(70.0), Some(gx), Some(gy))
    );
    assert_eq!(s.scratch.debt_payments.records.len(), 1);
    s.sound();
}

#[test]
fn paying_in_full_ends_it_and_takes_no_more_than_is_owed() {
    let (mut s, _, _) = at_warehouse(100.0, 150.0);
    s.give(pay(json!(500), Value::Null));
    s.tick();
    assert_eq!(s.world.debts, vec![]);
    assert_eq!(s.coins(), Some(50.0));
    let paid = s.events("debtPaid").pop().unwrap();
    assert_eq!((paid["coins"].as_f64(), paid["owed"].as_f64()), (Some(100.0), Some(0.0)));
    s.sound();
}

#[test]
fn paying_takes_what_they_hold_when_it_is_less_than_they_offer() {
    let (mut s, _, _) = at_warehouse(100.0, 40.0);
    s.give(pay(json!(90), Value::Null));
    s.tick();
    assert_eq!(debt_of(&s.world, "r1"), 60.0);
    assert_eq!(s.coins(), None);
}

#[test]
fn paying_can_come_from_a_carriage_there() {
    let (mut s, _, goods) = at_warehouse(100.0, 0.0);
    let (x, y) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    let k = json!({ "id": "k1", "realmId": "r1", "cityId": null, "x": x, "y": y, "horseId": null, "load": { "coins": 100 } });
    s.world.carriages.push(serde_json::from_value::<Carriage>(k).unwrap());
    s.give(pay(json!(100), json!("k1")));
    s.tick();
    assert_eq!(s.world.debts, vec![]);
    assert_eq!(s.world.carriages[0].load.get(&Good::Coins), None);
    assert_eq!(s.coins(), None);
}

#[test]
fn paying_works_at_the_coin_warehouse_itself_and_from_a_realm_it_refuses_to_trade_with() {
    let (mut s, coins, _) = at_warehouse(100.0, 100.0);
    s.stand_on(coins);
    change_standing(&mut s.world, TRADE_ORG, "r1", TRADE_ORG_REFUSES_TRADE_BELOW - 1.0);
    assert!(trade_org_refuses(&s.world, "r1"));
    s.give(pay(json!(100), Value::Null));
    s.tick();
    assert_eq!(s.world.debts, vec![]);
}

#[test]
fn paying_is_refused_with_nothing_owed_no_coins_no_whole_number_or_off_a_warehouse() {
    let (mut s, _, goods) = at_warehouse(100.0, 100.0);
    assert!(matches!(s.ask(pay(json!(1), Value::Null)), OrderReply::Ack { .. }));
    for bad in [json!(0), json!(-5), json!(1.5), json!("lots")] {
        assert_eq!(reason(s.ask(pay(bad, Value::Null))), "pay a whole number of coins");
    }
    assert_eq!(reason(s.ask(pay(json!(1), json!("nope")))), "not one of your carriages");
    s.a1().carried = Stock::new();
    assert_eq!(reason(s.ask(pay(json!(1), Value::Null))), "no coins to pay with");
    s.a1().carried = [(Good::Coins, 100.0)].into_iter().collect();
    let (x, y) = (s.world.buildings[goods].x, s.world.buildings[goods].y);
    s.a1().x = x + 30.0;
    s.a1().y = y + 30.0;
    assert_eq!(reason(s.ask(pay(json!(1), Value::Null))), "not at a Trade Org warehouse");
    s.stand_on(goods);
    s.world.debts = vec![];
    assert_eq!(
        reason(s.ask(pay(json!(1), Value::Null))),
        "your realm owes the Trade Organization nothing"
    );
}

#[test]
fn paying_does_nothing_when_the_debt_was_paid_since_the_order() {
    let (mut s, _, _) = at_warehouse(100.0, 100.0);
    s.give(pay(json!(100), Value::Null));
    s.world.debts = vec![];
    s.tick();
    assert_eq!(s.coins(), Some(100.0));
    assert!(s.a1().order.is_none());
    assert_eq!(s.scratch.debt_payments.records, vec![]);
    s.sound();
}

#[test]
fn a_debt_ends_with_the_organization_that_owes_it() {
    let mut s = setup();
    s.world.debts = vec![debt("r1", 100.0)];
    step_debts(&mut s.world);
    assert_eq!(s.world.debts.len(), 1);
    s.world.realms.clear();
    step_debts(&mut s.world);
    assert_eq!(s.world.debts, vec![]);
}

#[test]
fn the_debt_invariants_catch_a_debt_that_isnt_positive_of_an_organization_gone_or_kept_twice() {
    let mut s = setup();
    let messages =
        |w: &WorldState| debts_sound(w).into_iter().map(|v| v.message).collect::<Vec<_>>();
    assert_eq!(messages(&s.world), Vec::<String>::new());
    s.world.debts = vec![debt("r1", 0.0)];
    assert_eq!(messages(&s.world), vec!["the debt of r1 is 0"]);
    s.world.debts = vec![debt("r1", -3.0)];
    assert_eq!(messages(&s.world), vec!["the debt of r1 is -3"]);
    s.world.debts = vec![debt("gone", 5.0)];
    assert_eq!(messages(&s.world), vec!["gone owes a debt but is gone"]);
    s.world.debts = vec![debt(&s.hq, 5.0)];
    assert_eq!(
        messages(&s.world),
        vec![format!("the Trade Organization owes itself, as {}", s.hq)]
    );
    s.world.debts = vec![debt("r1", 5.0), debt("r1", 6.0)];
    assert_eq!(messages(&s.world), vec!["r1 has two debts"]);
}

#[test]
fn the_debt_invariants_catch_a_payment_that_made_or_lost_coins_or_a_debt_that_fell_by_something_else(
) {
    let (mut s, _, _) = at_warehouse(100.0, 50.0);
    s.give(pay(json!(50), Value::Null));
    s.tick();
    assert_eq!(debt_payments_sound(&s.scratch.debt_payments), vec![]);
    let record = &mut s.scratch.debt_payments.records[0];
    record.coins_after += 1.0;
    record.owed_after -= 1.0;
    assert_eq!(debt_payments_sound(&s.scratch.debt_payments).len(), 2);
}

#[test]
fn the_debt_invariants_catch_a_pay_debt_order_that_outlasts_its_tick() {
    let mut s = setup();
    s.a1().order = Some(ResidentOrder::PayDebt(PayDebtOrder { coins: 1.0, carriage_id: None }));
    assert_eq!(debt_orders_done(&s.world).len(), 1);
}
