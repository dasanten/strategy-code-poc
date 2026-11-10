//! `orders.ts` has no test file of its own: the TypeScript tests it through every order kind's
//! tests. These check the queue itself (`receive`, `applyAll`) with the queue tests' stand-in
//! kinds.

use super::*;
use crate::queues::tests::{me, setup};
use csp_shared::world::{Army, GivenUnderAttack, ResidentOrder};
use serde_json::json;

fn rejected(reason: &str) -> OrderReply {
    OrderReply::Rejected { request_id: "q".into(), reason: reason.into() }
}

#[test]
fn turns_down_a_malformed_or_unknown_order() {
    let mut s = setup();
    let world = &s.world;
    let none = s.orders.receive(world, &me(), &json!(""), &json!({ "kind": "walkTo" }));
    assert_eq!(
        none,
        OrderReply::Rejected { request_id: "".into(), reason: "malformed order".into() }
    );
    assert_eq!(s.orders.receive(world, &me(), &json!("q"), &json!(3)), rejected("malformed order"));
    assert_eq!(
        s.orders.receive(world, &me(), &json!("q"), &json!({ "kind": "fly" })),
        rejected("unknown order: fly")
    );
    // Only the kinds' own entries count.
    assert_eq!(
        s.orders.receive(world, &me(), &json!("q"), &json!({ "kind": "constructor" })),
        rejected("unknown order: constructor")
    );
    assert_eq!(
        s.orders.receive(world, &me(), &json!("q"), &json!({ "kind": 4 })),
        rejected("unknown order: 4")
    );
    assert!(s.orders.is_empty());
}

#[test]
fn turns_down_an_order_for_someone_down_and_drops_one_given_before_they_went_down() {
    let mut s = setup();
    s.world.residents[0].down_until = Some(50.0);
    let name = s.world.residents[0].name.clone();
    assert_eq!(
        s.give(json!({ "kind": "walkTo", "x": 9, "y": 9 })),
        rejected(&format!("{name} is Down and takes no orders"))
    );
    s.world.residents[0].down_until = None;
    assert_eq!(
        s.give(json!({ "kind": "walkTo", "x": 9, "y": 9 })),
        OrderReply::Ack { request_id: "q".into() }
    );
    assert_eq!((s.orders.len(), s.orders.pending_for(7), s.orders.pending_for(8)), (1, 1, 0));
    s.world.residents[0].down_until = Some(50.0);
    s.orders.apply_all(&mut s.world);
    assert!(s.world.residents[0].order.is_none());
    assert!(s.orders.is_empty());
}

#[test]
fn an_order_ends_the_queue_and_leaves_the_army_and_gets_a_passenger_off_first() {
    let mut s = setup();
    s.give(
        json!({ "kind": "queue", "steps": [{ "order": { "kind": "walkTo", "x": 20, "y": 6 } }] }),
    );
    s.orders.apply_all(&mut s.world);
    let army: Army = serde_json::from_value(json!({ "id": "a1", "name": "Guard", "realmId": "r1",
        "memberIds": ["w1"], "order": null }))
    .unwrap();
    s.world.armies.push(army);
    s.world.residents[0].aboard = Some("k1".into());
    s.give(json!({ "kind": "walkTo", "x": 9, "y": 9 }));
    s.orders.apply_all(&mut s.world);
    let r = &s.world.residents[0];
    assert!(r.queue.is_none());
    assert!(r.aboard.is_none());
    assert!(matches!(r.order, Some(ResidentOrder::WalkTo(_))));
    assert!(s.world.armies.is_empty());
}

#[test]
fn an_order_that_keeps_scripts_running_leaves_the_queue_alone() {
    let mut s = setup();
    s.give(
        json!({ "kind": "queue", "steps": [{ "order": { "kind": "walkTo", "x": 20, "y": 6 } }] }),
    );
    s.orders.apply_all(&mut s.world);
    s.give(json!({ "kind": "rename", "name": "Ada" }));
    s.orders.apply_all(&mut s.world);
    assert!(s.world.residents[0].queue.is_some());
    assert!(keeps_script("editQueue") && keeps_script("removeWaypoint") && !keeps_script("walkTo"));
}

#[test]
fn notes_an_order_given_under_attack() {
    let mut s = setup();
    s.world.tick = 10;
    s.world.residents[0].struck = Some(csp_shared::world::Struck { by: "x1".into(), tick: 5.0 });
    s.give(json!({ "kind": "walkTo", "x": 9, "y": 9 }));
    s.orders.apply_all(&mut s.world);
    assert_eq!(s.world.residents[0].given_under_attack, Some(GivenUnderAttack::UntilDone));
}
