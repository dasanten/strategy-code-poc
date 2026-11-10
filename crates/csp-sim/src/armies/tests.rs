//! `apps/server/src/armies.test.ts`: the army orders and what the army gives its members, with
//! the conflict phases stepping; the cases where the army walks step the running game
//! (`game_test_world`). Elsewhere a member's own order is set between `member_orders` and
//! `leave_on_own_orders`, as the order queue does.

use csp_shared::balance::{ARMY_SPREAD, WALK_TICKS_PER_TILE};
use csp_shared::world::{Army, ArmyOrder, ResidentOrder, Tile, WalkOrder, WorldState};
use serde_json::json;

use super::*;
use crate::game_test_world::Game;
use crate::test_world::{empty_world, live, live_mut, realm, resident, run};

const SIZE: i32 = 64;
const ME: u64 = 7;

/// Realm r1 (Player 7, Leader a1) and realm r2 (Player 8, Leader b1), every stat 10.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    agile(&mut world, "a1", Some("r1"), 10.0, 10.0, 10.0);
    agile(&mut world, "b1", Some("r2"), 30.0, 30.0, 10.0);
    world
}

/// A grown resident of `owner` at (x, y) with every stat 10, or `agility` for Agility, as the
/// TypeScript's `resident` makes them.
fn agile(world: &mut WorldState, id: &str, owner: Option<&str>, x: f64, y: f64, agility: f64) {
    resident(world, id, owner, x, y);
    live_mut(world, id).stats.agility.base = agility;
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

/// The whole running world, as the TypeScript steps it: walking, no scripts.
fn game(world: WorldState) -> Game {
    let mut game = Game::new(world, crate::test_support::plains(SIZE));
    game.scripts_run = false;
    game
}

/// The ticks until `fast` and `slow` each stand on x 30 (`arrivals`); kept `together`, they are
/// never further apart than the army's spread.
fn arrivals(game: &mut Game, together: bool) -> (usize, usize) {
    let (mut fast, mut slow) = (None, None);
    for t in 1..=1000 {
        if fast.is_some() && slow.is_some() {
            break;
        }
        game.tick();
        for (id, got) in [("fast", &mut fast), ("slow", &mut slow)] {
            if got.is_none() && game.r(id).x == 30.0 {
                *got = Some(t);
            }
        }
        let (f, s) = (game.r("fast"), game.r("slow"));
        let gap = crate::npc_slow::wrap_distance_f(SIZE, (f.x, f.y), (s.x, s.y));
        if together {
            assert!(gap <= ARMY_SPREAD + 1.0, "{gap} apart at tick {t}");
        }
    }
    (fast.expect("fast arrives"), slow.expect("slow arrives"))
}

#[test]
fn moves_at_the_pace_of_its_slowest_and_keeps_together() {
    let mut world = setup();
    agile(&mut world, "fast", Some("r1"), 10.0, 12.0, 25.0);
    agile(&mut world, "slow", Some("r1"), 10.0, 12.0, 1.0);
    // On their own, the fast one gets there well before the slow one.
    let mut alone = game(world.clone());
    for id in ["fast", "slow"] {
        let walk = json!({ "kind": "walkTo", "residentId": id, "x": 30, "y": 12 });
        assert_eq!(alone.order(ME, walk), "ack");
    }
    let apart = arrivals(&mut alone, false);
    assert!((apart.1 - apart.0) as f64 > 3.0 * WALK_TICKS_PER_TILE, "{apart:?}");

    let mut game = game(world);
    let form = json!({ "kind": "formArmy", "name": "Foot", "residentIds": ["fast", "slow"] });
    assert_eq!(game.order(ME, form), "ack");
    let army = game.world.armies[0].id.clone();
    let walk = json!({ "kind": "armyWalkTo", "armyId": army, "x": 30, "y": 12 });
    assert_eq!(game.order(ME, walk), "ack");
    let together = arrivals(&mut game, true);
    // The army arrives when its slowest does, and its fast member barely before.
    assert!(together.1 <= apart.1 + 5, "{together:?} against {apart:?}");
    assert!(together.1 - together.0 < apart.1 - apart.0, "{together:?} against {apart:?}");
    game.tick();
    assert_eq!(game.world.armies[0].order, None);
}

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
fn guards_a_tile_a_member_who_wandered_off_and_is_idle_walks_back() {
    let mut world = setup();
    agile(&mut world, "a2", Some("r1"), 10.0, 12.0, 10.0);
    agile(&mut world, "a3", Some("r1"), 11.0, 12.0, 10.0);
    let mut game = game(world);
    let form = json!({ "kind": "formArmy", "name": "Watch", "residentIds": ["a2", "a3"] });
    assert_eq!(game.order(ME, form), "ack");
    let army = game.world.armies[0].id.clone();
    let guard = json!({ "kind": "armyGuard", "armyId": army, "x": 14, "y": 12 });
    assert_eq!(game.order(ME, guard), "ack");
    game.run(300);
    for id in ["a2", "a3"] {
        assert_eq!((game.r(id).x, game.r(id).y), (14.0, 12.0), "{id}");
    }
    game.r_mut("a3").x = 12.0;
    game.run(150);
    assert_eq!((game.r("a3").x, game.r("a3").y), (14.0, 12.0));
    assert!(matches!(game.world.armies[0].order, Some(ArmyOrder::Guard { .. })));
}

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
