//! `apps/server/src/defence.test.ts`: the defence invariants. The rest of that file runs the Defend
//! default and Players' defence scripts through the script runner, T86.12's; `start_defence` and
//! the drivers' and passengers' reactions are covered by `combat`'s tests.

use csp_shared::world::{
    DriveOrder, Interrupted, ResidentOrder, RunningScript, Struck, Tile, WorldState,
};

use super::*;
use crate::test_world::{add_city, empty_world, live_mut, realm, resident};

/// Realm r1 (Player 7, Leader w1 at (6, 6) of city c1) and realm r2 (Player 8), whose x1 stands
/// next to w1.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "w1");
    realm(&mut world, "r2", 8, "l2");
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0, None);
    resident(&mut world, "w1", Some("r1"), 6.0, 6.0);
    live_mut(&mut world, "w1").city_id = Some("c1".into());
    resident(&mut world, "x1", Some("r2"), 7.0, 6.0);
    resident(&mut world, "l2", Some("r2"), 28.0, 28.0);
    world.tick = 100;
    world
}

fn script(id: u64) -> RunningScript {
    serde_json::from_value(serde_json::json!({ "scriptId": id, "task": "defend", "memory": {} }))
        .unwrap()
}

fn ids(v: Vec<InvariantViolation>) -> Vec<(String, Vec<String>)> {
    v.into_iter().map(|v| (v.invariant, v.entity_ids)).collect()
}

#[test]
fn flags_a_driver_struck_who_no_longer_holds_their_drive_before_defend_decides() {
    let mut world = setup();
    let order = ResidentOrder::Drive(DriveOrder {
        carriage_id: "k1".into(),
        target: Tile { x: 6.0, y: 24.0 },
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    });
    let tick = world.tick as f64;
    let r = live_mut(&mut world, "w1");
    r.order = Some(order.clone());
    r.interrupted = Some(Interrupted { order: Some(order), script: None, alarm: None });
    r.script = Some(script(0));
    r.struck = Some(Struck { by: "x1".into(), tick: tick - 1.0 });
    assert!(struck_driver_drives_on(&world).is_empty());
    live_mut(&mut world, "w1").order = None;
    assert_eq!(
        ids(struck_driver_drives_on(&world)),
        vec![("struck-driver-drives-on".into(), vec!["w1".into()])]
    );
    // A tick on, something else may have ended the drive with their script not run yet.
    live_mut(&mut world, "w1").struck = Some(Struck { by: "x1".into(), tick: tick - 2.0 });
    assert!(struck_driver_drives_on(&world).is_empty());
    live_mut(&mut world, "w1").struck = Some(Struck { by: "x1".into(), tick: tick - 1.0 });
    // Once a defence script has run, it decides.
    live_mut(&mut world, "w1").script = Some(script(707));
    assert!(struck_driver_drives_on(&world).is_empty());
}

#[test]
fn flags_an_order_standing_with_a_defence_script_running_or_anything_interrupted() {
    let mut world = setup();
    live_mut(&mut world, "w1").given_under_attack = Some(GivenUnderAttack::UntilDone);
    assert!(given_under_attack_sound(&world).is_empty());
    live_mut(&mut world, "w1").script = Some(script(0));
    assert_eq!(
        ids(given_under_attack_sound(&world)),
        vec![("given-under-attack-sound".into(), vec!["w1".into()])]
    );
    let r = live_mut(&mut world, "w1");
    r.script = None;
    r.interrupted = Some(Interrupted { order: None, script: None, alarm: None });
    assert_eq!(
        ids(given_under_attack_sound(&world)),
        vec![("given-under-attack-sound".into(), vec!["w1".into()])]
    );
}

#[test]
fn flags_something_interrupted_with_no_defence_script_running() {
    let mut world = setup();
    live_mut(&mut world, "w1").interrupted =
        Some(Interrupted { order: None, script: None, alarm: None });
    assert_eq!(
        ids(interrupted_sound(&world)),
        vec![("interrupted-runs-defence".into(), vec!["w1".into()])]
    );
    live_mut(&mut world, "w1").script = Some(script(0));
    assert!(interrupted_sound(&world).is_empty());
}

#[test]
fn flags_a_defence_script_that_is_no_script_id() {
    let mut world = setup();
    live_mut(&mut world, "w1").defence_script_id = Some(0);
    assert_eq!(
        ids(defence_script_sound(&world)),
        vec![("defence-script-sound".into(), vec!["w1".into()])]
    );
    live_mut(&mut world, "w1").defence_script_id = Some(750);
    assert!(defence_script_sound(&world).is_empty());
}
