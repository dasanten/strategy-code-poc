//! `apps/server/src/teaching.test.ts`, ported (T86.6). Left for the tickets whose parts they need:
//! `teaching in scripts` (the game API, T86.12), `teachers sound` and the invariant checks
//! (T86.13); in "ends on leaving the ground or taking another order" the walk order (T86.4) is
//! given by setting it directly.

mod build_common;

use build_common::*;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{BuildingKind, ConstructionSite, ResidentOrder, Stock, WorldState};
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::building::teacher_at;
use csp_sim::world::create_world;
use serde_json::{json, Value};

fn me() -> OrderSender {
    player(7)
}

/// Realm r1 (Player 7) with a finished training ground g1 on (3, 3) to (5, 5), and grown
/// residents Ann (a1) and Bo (a2) standing on it.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let terrain = plains(16);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    world.buildings.push(building("g1", BuildingKind::TrainingGround, 3.0, 3.0));
    for (id, name, x, y) in [("a1", "Ann", 3.0, 3.0), ("a2", "Bo", 5.0, 5.0)] {
        let i = resident(&mut world, id, x, y);
        let r = &mut world.residents[i];
        r.name = name.into();
        r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
        r.lifespan = 60.0;
    }
    (world, terrain, Orders::default())
}

/// Sends an order and, if accepted, applies it; answers "ack" or why it was rejected.
fn send(world: &mut WorldState, t: &TerrainMap, orders: &mut Orders, o: Value) -> String {
    let answer = orders.receive(world, &me(), o, t);
    orders.apply_all(world, t);
    answer.err().unwrap_or_else(|| "ack".into())
}

fn teach(resident_id: &str, subject: &str, building_id: &str) -> Value {
    json!({ "kind": "teach", "residentId": resident_id, "buildingId": building_id, "subject": subject })
}

fn order_of(world: &mut WorldState, id: &str) -> Value {
    serde_json::to_value(&at(world, id).order).unwrap()
}

fn teacher(world: &WorldState) -> Option<String> {
    teacher_at(&world.buildings[0], &world.residents, 5760).map(|r| r.id.clone())
}

#[test]
fn sets_a_grown_resident_on_the_ground_to_teach_a_stat_or_a_skill_until_ordered_otherwise() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(send(&mut world, &t, &mut orders, teach("a1", "strength", "g1")), "ack");
    let teaching = json!({ "kind": "teach", "buildingId": "g1", "subject": "strength" });
    assert_eq!(order_of(&mut world, "a1"), teaching);
    assert_eq!(teacher(&world).as_deref(), Some("a1"));
    run(&mut world, &t, 5);
    assert_eq!(order_of(&mut world, "a1"), teaching);
    // The teacher may switch subjects; a skill is a subject too.
    assert_eq!(send(&mut world, &t, &mut orders, teach("a1", "combat", "g1")), "ack");
    assert_eq!(order_of(&mut world, "a1")["subject"], "combat");
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a1", "combat", "g1")),
        "already teaching here"
    );
}

#[test]
fn is_refused_for_a_child_off_the_ground_at_another_building_a_site_or_for_no_subject() {
    let (mut world, t, mut orders) = setup();
    let tick = world.tick as f64;
    at(&mut world, "a1").born_at = tick;
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a1", "strength", "g1")),
        "children can’t teach"
    );
    at(&mut world, "a2").x = 8.0;
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "strength", "g1")),
        "there is no training ground here"
    );
    world.buildings.push(building("f1", BuildingKind::Farm, 8.0, 5.0));
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "strength", "f1")),
        "there is no training ground here"
    );
    at(&mut world, "a2").x = 5.0;
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "cooking", "g1")),
        "teach a stat or a skill"
    );
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "strength", "f1")),
        "stand on the training ground to teach there"
    );
    world.buildings[0].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "strength", "g1")),
        "it is still a construction site"
    );
    assert!(at(&mut world, "a2").order.is_none());
}

#[test]
fn is_refused_for_another_realms_resident_and_for_a_citys_sender_not_its_own() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "a2").owner = Some("r2".into());
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "strength", "g1")),
        "not one of your residents"
    );
    let npc = OrderSender { npc_city_id: Some("c9".into()), ..OrderSender::player(0, "Elm") };
    assert!(orders.receive(&world, &npc, teach("a2", "strength", "g1"), &t).is_err());
}

#[test]
fn refuses_a_second_teacher_at_the_ground_naming_the_first() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(send(&mut world, &t, &mut orders, teach("a1", "strength", "g1")), "ack");
    assert_eq!(
        send(&mut world, &t, &mut orders, teach("a2", "combat", "g1")),
        "Ann teaches Strength here"
    );
    assert!(at(&mut world, "a2").order.is_none());
    assert!(matches!(at(&mut world, "a1").order, Some(ResidentOrder::Teach(_))));
}

#[test]
fn lets_only_the_first_of_two_teach_orders_in_one_tick_teach() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(orders.receive(&world, &me(), teach("a1", "strength", "g1"), &t), Ok(()));
    assert_eq!(orders.receive(&world, &me(), teach("a2", "combat", "g1"), &t), Ok(()));
    orders.apply_all(&mut world, &t);
    assert!(matches!(at(&mut world, "a1").order, Some(ResidentOrder::Teach(_))));
    assert!(at(&mut world, "a2").order.is_none());
}

#[test]
fn ends_on_leaving_the_ground_or_taking_another_order_and_the_ground_teaches_nothing_then() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(send(&mut world, &t, &mut orders, teach("a1", "strength", "g1")), "ack");
    // TODO(T86.4): the walk order; given here as its order state.
    at(&mut world, "a1").order = Some(
        serde_json::from_value(json!({
            "kind": "walkTo", "target": { "x": 10, "y": 10 }, "path": null, "progress": 0
        }))
        .unwrap(),
    );
    assert!(teacher(&world).is_none());
    // Bo can teach now; pushed off the footprint, Bo's teaching ends too.
    assert_eq!(send(&mut world, &t, &mut orders, teach("a2", "strength", "g1")), "ack");
    at(&mut world, "a2").x = 9.0;
    run(&mut world, &t, 1);
    assert!(at(&mut world, "a2").order.is_none());
    assert!(teacher(&world).is_none());
}

#[test]
fn ends_when_the_ground_is_gone() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(send(&mut world, &t, &mut orders, teach("a1", "strength", "g1")), "ack");
    world.buildings.clear();
    run(&mut world, &t, 1);
    assert!(at(&mut world, "a1").order.is_none());
}
