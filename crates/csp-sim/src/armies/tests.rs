//! `apps/server/src/armies.test.ts`, the fast parts: the army orders and what the army gives its
//! members. Where the TypeScript then walks them about it needs walking (T86.4); the Player's own
//! `walkTo` and `stop` orders are the order queue's (T86.2), so a member's own order is set
//! here between `member_orders` and `leave_on_own_orders`, as the queue does.

use csp_shared::world::{Army, ResidentOrder, Tile, WalkOrder, WorldState};

use super::*;
use crate::test_world::{empty_world, live, live_mut, realm, resident, run};

const SIZE: i32 = 64;
const ME: u64 = 7;

/// Realm r1 (Player 7, Leader a1) and realm r2 (Player 8, Leader b1).
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "b1", Some("r2"), 30.0, 30.0);
    world
}

fn send(world: &mut WorldState, kind: ArmyOrderKind, request: ArmyRequest) -> String {
    if let Some(reason) = validate_army_order(world, kind, ME, &request, Some(SIZE)) {
        return reason;
    }
    apply_army_order(world, kind, ME, &request);
    "ack".into()
}

fn form(world: &mut WorldState, name: &str, ids: &[&str]) -> String {
    let request = ArmyRequest {
        name: Some(name.into()),
        resident_ids: Some(ids.iter().map(|s| s.to_string()).collect()),
        ..Default::default()
    };
    send(world, ArmyOrderKind::FormArmy, request)
}

fn at_army(army: &str) -> ArmyRequest {
    ArmyRequest { army_id: Some(army.into()), ..Default::default() }
}

#[test]
fn forms_an_army_of_the_realms_own_residents_only() {
    let mut world = setup();
    resident(&mut world, "a2", Some("r1"), 10.0, 11.0);
    assert_eq!(form(&mut world, " ", &["a2"]), "the army needs a name");
    assert_eq!(form(&mut world, "Foot", &["b1"]), "not all of them are your residents");
    assert_eq!(form(&mut world, "Foot", &["a2"]), "ack");
    assert_eq!(
        world.armies,
        vec![Army {
            id: world.armies[0].id.clone(),
            name: "Foot".into(),
            realm_id: "r1".into(),
            member_ids: vec!["a2".into()],
            order: None,
            script: None,
        }]
    );
    // Joining a new army takes them out of the old one, which is gone with nobody left.
    assert_eq!(form(&mut world, "Horse", &["a2"]), "ack");
    assert_eq!(world.armies.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), vec!["Horse"]);
    assert!(armies_sound(&world).is_empty());
}

#[test]
#[ignore = "needs walking (T86.4)"]
fn moves_at_the_pace_of_its_slowest_and_keeps_together() {}

#[test]
fn loses_a_resident_who_is_given_an_order_of_their_own() {
    let mut world = setup();
    resident(&mut world, "a2", Some("r1"), 10.0, 12.0);
    resident(&mut world, "a3", Some("r1"), 10.0, 13.0);
    form(&mut world, "Foot", &["a2", "a3"]);
    let army = world.armies[0].id.clone();
    let walk = ArmyRequest { x: Some(30.0), y: Some(12.0), ..at_army(&army) };
    assert_eq!(send(&mut world, ArmyOrderKind::ArmyWalkTo, walk), "ack");
    run(&mut world, SIZE, 3);
    assert!(
        matches!(&live(&world, "a2").unwrap().order, Some(ResidentOrder::WalkTo(w)) if w.army.as_deref() == Some(army.as_str()))
    );
    // The Player's walkTo for a2, as the order queue applies it.
    let before = member_orders(&world);
    live_mut(&mut world, "a2").order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: 5.0, y: 5.0 },
        path: None,
        progress: 0.0,
        army: None,
    }));
    leave_on_own_orders(&mut world, &before);
    assert_eq!(world.armies[0].member_ids, vec!["a3".to_string()]);
    assert!(matches!(&live(&world, "a2").unwrap().order,
        Some(ResidentOrder::WalkTo(w)) if w.target == Tile { x: 5.0, y: 5.0 } && w.army.is_none()));
    run(&mut world, SIZE, 1);
    // The last member leaving ends the army (their `stop`).
    let before = member_orders(&world);
    live_mut(&mut world, "a3").order = None;
    leave_on_own_orders(&mut world, &before);
    assert!(world.armies.is_empty());
}

/// The first half of the TypeScript test; walking after b1 until they fall is T86.4's.
#[test]
fn attacks_a_resident_in_sight_together_but_not_one_of_its_own() {
    let mut world = setup();
    resident(&mut world, "a2", Some("r1"), 28.0, 28.0);
    resident(&mut world, "a3", Some("r1"), 28.0, 29.0);
    form(&mut world, "Foot", &["a2", "a3"]);
    let army = world.armies[0].id.clone();
    let attack = |target: &str| ArmyRequest { target_id: Some(target.into()), ..at_army(&army) };
    assert_eq!(
        send(&mut world, ArmyOrderKind::ArmyAttack, attack("a1")),
        "that is one of your own residents"
    );
    assert_eq!(send(&mut world, ArmyOrderKind::ArmyAttack, attack("b1")), "ack");
    run(&mut world, SIZE, 1);
    for id in ["a2", "a3"] {
        assert!(matches!(&live(&world, id).unwrap().order,
            Some(ResidentOrder::Attack(o)) if o.target_id == "b1" && o.army.as_deref() == Some(army.as_str())));
    }
}

#[test]
#[ignore = "needs walking (T86.4)"]
fn guards_a_tile_a_member_who_wandered_off_and_is_idle_walks_back() {}

/// The checks and the end of the TypeScript test; the following is walking's (T86.4).
#[test]
fn follows_a_resident_and_stops_once_they_are_gone() {
    let mut world = setup();
    resident(&mut world, "a2", Some("r1"), 10.0, 12.0);
    resident(&mut world, "a3", Some("r1"), 10.0, 13.0);
    form(&mut world, "Guard", &["a2", "a3"]);
    let army = world.armies[0].id.clone();
    let follow = |target: &str| ArmyRequest { target_id: Some(target.into()), ..at_army(&army) };
    assert_eq!(
        send(&mut world, ArmyOrderKind::ArmyFollow, follow("a2")),
        "that is one of the army"
    );
    assert_eq!(send(&mut world, ArmyOrderKind::ArmyFollow, follow("a1")), "ack");
    run(&mut world, SIZE, 1);
    world.residents.retain(|r| r.id != "a1");
    world.realms[0].leader_id = "a2".into();
    run(&mut world, SIZE, 1);
    assert_eq!(world.armies[0].order, None);
}

#[test]
fn flags_an_army_with_a_member_of_another_realm() {
    let mut world = setup();
    world.armies.push(Army {
        id: "army1".into(),
        name: "X".into(),
        realm_id: "r1".into(),
        member_ids: vec!["b1".into()],
        order: None,
        script: None,
    });
    let messages: Vec<String> = armies_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(messages, vec!["army army1 has member b1 another realm commands"]);
}
