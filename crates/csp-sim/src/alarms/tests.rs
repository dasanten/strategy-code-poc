//! `alarms.test.ts`, the cases over the alarm rules themselves: who an alarm reaches and what it
//! starts. The TypeScript runs each through the whole tick (orders, queues, the default scripts,
//! combat); those end-to-end cases (the Alarm default going after the occupier, back to work, the
//! defence script handing back) need the default scripts running on every rule and come with
//! T86.14.

use super::*;
use crate::queues::tests::resident;
use crate::world::create_world;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Good, Realm};
use serde_json::json;

const SIZE: i32 = 256;

fn from<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// Realm r1 (Player 7) with city c1, its town hall at (9, 3), a farm at (6, 6) with armed w1 on
/// it; realm r2's armed x1 far away.
fn setup() -> WorldState {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(from::<Realm>(json!({ "id": "r1", "userId": 7, "leaderId": "w1" })));
    world.realms.push(from::<Realm>(json!({ "id": "r2", "userId": 8, "leaderId": "l2" })));
    world.cities.push(from(json!({ "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "c1-hall", "occupation": null })));
    world
        .buildings
        .push(from(json!({ "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": 9, "y": 3 })));
    world
        .buildings
        .push(from(json!({ "id": "f1", "kind": "farm", "cityId": "c1", "x": 6, "y": 6 })));
    let mut w1 = resident("w1", Some("r1"), 6.0, 6.0);
    w1.city_id = Some("c1".into());
    w1.carried = [(Good::Food, 2.0), (Good::Spear, 1.0)].into_iter().collect();
    w1.order = from(
        json!({ "kind": "workAt", "buildingId": "f1", "at": { "x": 6, "y": 6 }, "progress": 0 }),
    );
    let mut x1 = resident("x1", Some("r2"), 200.0, 200.0);
    x1.carried = [(Good::Sword, 1.0)].into_iter().collect();
    world.residents.push(w1);
    world.residents.push(x1);
    world
}

fn w1(world: &WorldState) -> &Resident {
    &world.residents[0]
}

/// x1 stands on the town hall; the occupation starts.
fn occupy(world: &mut WorldState) {
    world.residents[1].x = 9.0;
    world.residents[1].y = 3.0;
    raise_occupied(world, "c1", "r2", SIZE);
}

#[test]
fn the_town_hall_occupied_starts_the_alarm_script_of_armed_residents_at_home() {
    let mut world = setup();
    let before = w1(&world).order.clone();
    occupy(&mut world);
    let r = w1(&world);
    let s = r.script.as_ref().unwrap();
    assert_eq!(s.task, Some(Task::Alarm));
    assert_eq!(s.script_id, 0);
    let alarm = s.alarm.as_ref().unwrap();
    assert_eq!(
        (alarm.kind, alarm.about.as_str(), alarm.realm_id.as_deref()),
        (AlarmKind::Occupied, "x1", Some("r2"))
    );
    // What they were doing is kept aside, and they stop it.
    assert_eq!(r.interrupted.as_ref().unwrap().order, before);
    assert!(r.order.is_none());
    assert_eq!(alarms_sound(&world), vec![]);
}

#[test]
fn the_town_hall_occupied_reaches_them_once_not_again_while_it_runs() {
    let mut world = setup();
    occupy(&mut world);
    let first = w1(&world).clone();
    occupy(&mut world);
    assert_eq!(w1(&world).interrupted, first.interrupted);
    assert_eq!(w1(&world).script, first.script);
}

#[test]
fn the_town_hall_occupied_doesnt_reach_those_away_from_the_city() {
    let mut world = setup();
    world.residents[0].x = 100.0;
    world.residents[0].y = 100.0;
    occupy(&mut world);
    assert!(w1(&world).script.is_none());
}

#[test]
fn the_town_hall_occupied_leaves_someone_unarmed_as_they_were_unless_the_player_picked_a_script() {
    let mut world = setup();
    world.residents[0].carried = [(Good::Food, 2.0)].into_iter().collect();
    occupy(&mut world);
    assert!(w1(&world).script.is_none());
    world.residents[0].alarm_script_id = Some(AlarmScriptId::Script(12));
    occupy(&mut world);
    assert_eq!(w1(&world).script.as_ref().map(|s| s.script_id), Some(12));
}

#[test]
fn the_town_hall_occupied_leaves_someone_set_to_none_as_they_were_armed_too() {
    let mut world = setup();
    world.residents[0].alarm_script_id = Some(from(json!("none")));
    occupy(&mut world);
    assert!(w1(&world).script.is_none());
}

#[test]
fn the_town_hall_occupied_reaches_no_army_member_no_driver_and_nobody_down() {
    let mut world = setup();
    world.armies.push(from(
        json!({ "id": "a1", "name": "Guard", "realmId": "r1", "memberIds": ["w1"], "order": null }),
    ));
    occupy(&mut world);
    assert!(w1(&world).script.is_none());
    world.armies.clear();
    world.residents[0].down_until = Some(500.0);
    occupy(&mut world);
    assert!(w1(&world).script.is_none());
}

#[test]
fn a_neighbour_attacked_brings_armed_ones_in_sight_once_per_attacker() {
    let mut world = setup();
    let mut w2 = resident("w2", Some("r1"), 7.0, 6.0);
    w2.city_id = Some("c1".into());
    world.residents.push(w2);
    world.residents[1].x = 8.0;
    world.residents[1].y = 6.0;
    raise_resident_attacked(&mut world, "x1", "w2", SIZE);
    let s = w1(&world).script.as_ref().unwrap();
    assert_eq!(
        s.alarm.as_ref().map(|a| (a.kind, a.about.clone())),
        Some((AlarmKind::Attacked, "x1".to_string()))
    );
    // The one struck answers by their defence script, not this alarm.
    assert!(world.residents[2].script.is_none());
    // Raised once per attacker: while their blows keep coming, the rest raise nothing.
    let alarmed = world.cities[0].alarmed_attackers.clone().unwrap();
    assert_eq!(alarmed.get("x1"), Some(&0.0));
    world.residents[0].script = None;
    world.residents[0].interrupted = None;
    world.tick = 5;
    raise_resident_attacked(&mut world, "x1", "w2", SIZE);
    assert!(w1(&world).script.is_none());
    assert_eq!(world.cities[0].alarmed_attackers.as_ref().unwrap().get("x1"), Some(&5.0));
    assert_eq!(alarmed_attackers_sound(&world), vec![]);
}

#[test]
fn a_blow_struck_by_someone_of_the_realm_or_in_fighting_back_raises_nothing() {
    let mut world = setup();
    let mut w2 = resident("w2", Some("r1"), 7.0, 6.0);
    w2.city_id = Some("c1".into());
    world.residents.push(w2);
    raise_resident_attacked(&mut world, "w2", "w1", SIZE);
    assert!(world.cities[0].alarmed_attackers.is_none());
    world.residents[1].x = 8.0;
    world.residents[1].y = 6.0;
    world.residents[1].order = from(
        json!({ "kind": "attack", "targetId": "w2", "path": null, "progress": 0, "strike": 0, "started": true, "defending": true }),
    );
    raise_resident_attacked(&mut world, "x1", "w2", SIZE);
    assert!(w1(&world).script.is_none());
}

#[test]
fn an_alarm_script_answers_the_attack_it_runs_for() {
    let mut world = setup();
    world.residents[1].x = 7.0;
    world.residents[1].y = 6.0;
    let mut w2 = resident("w2", Some("r1"), 6.0, 7.0);
    w2.city_id = Some("c1".into());
    world.residents.push(w2);
    raise_resident_attacked(&mut world, "x1", "w2", SIZE);
    assert!(answers_attack(w1(&world), "x1"));
    assert!(!answers_attack(w1(&world), "w2"));
}

#[test]
fn back_to_an_outsider_alarm_goes_on_for_it() {
    let mut world = setup();
    world.residents[1].x = 7.0;
    world.residents[1].y = 7.0;
    raise_outsider(&mut world, "c1", "x1", SIZE);
    assert_eq!(
        w1(&world).script.as_ref().unwrap().alarm.as_ref().unwrap().kind,
        AlarmKind::Outsider
    );
    occupy(&mut world);
    let s = w1(&world).script.as_ref().unwrap();
    assert_eq!(s.alarm.as_ref().unwrap().kind, AlarmKind::Occupied);
    assert_eq!(s.alarm_under.as_ref().unwrap().kind, AlarmKind::Outsider);
    assert!(back_to_outsider_alarm(&mut world.residents[0]));
    let s = w1(&world).script.as_ref().unwrap();
    assert_eq!(s.alarm.as_ref().unwrap().kind, AlarmKind::Outsider);
    assert!(s.alarm_under.is_none());
    assert!(!back_to_outsider_alarm(&mut world.residents[0]));
    assert_eq!(alarms_sound(&world), vec![]);
}

#[test]
fn invariants_flag_an_alarm_script_with_no_alarm_or_nothing_kept_aside() {
    let mut world = setup();
    world.residents[0].script = Some(from(json!({ "scriptId": 0, "task": "alarm", "memory": {} })));
    let messages: Vec<String> = alarms_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "w1 runs an Alarm script with no alarm",
            "w1 runs an Alarm script with nothing kept aside"
        ]
    );
}

#[test]
fn invariants_flag_a_picked_alarm_script_that_cant_be_one() {
    let mut world = setup();
    world.residents[0].alarm_script_id = Some(AlarmScriptId::Script(0));
    assert_eq!(alarm_script_sound(&world).len(), 1);
    world.residents[0].alarm_script_id = Some(AlarmScriptId::Script(4));
    assert_eq!(alarm_script_sound(&world), vec![]);
}
