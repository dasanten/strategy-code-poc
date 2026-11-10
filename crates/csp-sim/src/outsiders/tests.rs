//! `outsiders.test.ts`: who is in a City area, the alarm raised once for each who comes in, and
//! the `outsiders-sound` invariant. The tests that tick the whole game to watch the Alarm default
//! script and the `outsidersIn`/`cityAreaAt` script calls run here on `step_outsiders`, where what
//! they look at is what it decides: the list and the alarm it starts.

use super::*;
use crate::combat::attack_order;
use crate::test_world::{add_city, building, empty_world, live, live_mut, realm, resident};
use csp_shared::balance::{OWN_FOOD, SIGHT_RANGE};
use csp_shared::world::{AlarmKind, BuildingKind, Good, ResidentOrder, TradeOrgCity};
use serde_json::json;

const SIZE: i32 = 256;

/// Realm r1 with city c1, its town hall at (9, 3): w1, armed, on farm f1 at (6, 6). Realm r2: x1,
/// armed, far off, its Leader l2 further off still.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "w1");
    realm(&mut world, "r2", 8, "l2");
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0, None);
    building(&mut world, "f1", BuildingKind::Farm, Some("c1"), 6.0, 6.0);
    let w1 = resident(&mut world, "w1", Some("r1"), 6.0, 6.0);
    world.residents[w1].city_id = Some("c1".into());
    world.residents[w1].carried =
        [(Good::Food, OWN_FOOD), (Good::Spear, 1.0)].into_iter().collect();
    let x1 = resident(&mut world, "x1", Some("r2"), 200.0, 200.0);
    world.residents[x1].carried = [(Good::Sword, 1.0)].into_iter().collect();
    resident(&mut world, "l2", Some("r2"), 220.0, 220.0);
    world
}

/// `who` stands in the area at (x, y) and stays there.
fn enter(world: &mut WorldState, who: &str, x: f64, y: f64) {
    let r = live_mut(world, who);
    (r.x, r.y, r.order) = (x, y, None);
}

/// `who` goes off out of the area.
fn leave(world: &mut WorldState, who: &str) {
    enter(world, who, 200.0, 200.0);
}

fn city<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut City {
    world.cities.iter_mut().find(|c| c.id == id).expect("the city")
}

fn outsiders(world: &WorldState, id: &str) -> Option<Vec<String>> {
    city(world, id).outsiders.clone()
}

fn ids(list: &[&str]) -> Option<Vec<String>> {
    Some(list.iter().map(|s| s.to_string()).collect())
}

/// The alarm `id`'s script runs for, if it runs one.
fn alarm_of(world: &WorldState, id: &str) -> Option<csp_shared::world::Alarm> {
    live(world, id)?.script.as_ref()?.alarm.clone()
}

/// The alarm script ends, and what it interrupted goes on, as when it calls `end`.
fn alarm_ends(world: &mut WorldState, id: &str) {
    let r = live_mut(world, id);
    let was = r.interrupted.take().expect("what the alarm interrupted");
    (r.order, r.script) = (was.order, was.script);
}

#[test]
fn raises_the_alarm_once_on_entering_not_every_tick() {
    let mut world = setup();
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["x1"]));
    let script = live(&world, "w1").unwrap().script.clone().expect("the alarm script");
    assert_eq!(script.task, Some(csp_shared::world::Task::Alarm));
    let alarm = script.alarm.expect("an alarm");
    assert_eq!(alarm.kind, AlarmKind::Outsider);
    assert_eq!((alarm.city_id.as_str(), alarm.about.as_str()), ("c1", "x1"));
    assert_eq!(alarm.realm_id.as_deref(), Some("r2"));
    assert_eq!((alarm.x, alarm.y), (12.0, 9.0));
    alarm_ends(&mut world, "w1");
    for _ in 0..5 {
        step_outsiders(&mut world, SIZE);
    }
    assert!(live(&world, "w1").unwrap().script.is_none());
}

#[test]
fn raises_it_again_if_they_leave_and_come_back() {
    let mut world = setup();
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    assert!(alarm_of(&world, "w1").is_some());
    alarm_ends(&mut world, "w1");
    leave(&mut world, "x1");
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(alarm_of(&world, "w1").map(|a| a.about), Some("x1".into()));
}

#[test]
fn raises_it_once_for_each_who_comes_in_the_armed_first() {
    let mut world = setup();
    let a0 = resident(&mut world, "a0", Some("r2"), 11.0, 9.0);
    let walker = world.residents.remove(a0);
    world.residents.insert(0, walker);
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["a0", "x1"]));
    // The unarmed one stands first in the world, and one alarm doesn't interrupt another.
    assert_eq!(alarm_of(&world, "w1").map(|a| a.about), Some("x1".into()));
}

#[test]
fn leaves_out_an_ally_someone_hired_by_the_realm_and_its_own_from_another_city() {
    let mut world = setup();
    world.alliances.push(
        serde_json::from_value(json!({
            "id": "al", "name": "Friends", "leaderId": "r1", "invites": [], "army": [],
            "members": [
                { "realmId": "r1", "joinedAt": 0, "leaving": null },
                { "realmId": "r3", "joinedAt": 0, "leaving": null }
            ]
        }))
        .expect("an alliance"),
    );
    let ally = resident(&mut world, "y1", Some("r3"), 8.0, 9.0);
    world.residents[ally].carried = [(Good::Sword, 1.0)].into_iter().collect();
    let hired = resident(&mut world, "h1", Some("r2"), 8.0, 8.0);
    world.residents[hired].carried = [(Good::Sword, 1.0)].into_iter().collect();
    world.contracts.push(
        serde_json::from_value(json!({
            "id": "k1", "lenderId": "r2", "hirerId": "r1", "offeredBy": "lender",
            "residentIds": ["h1"], "days": 7, "pricePerWeek": 10, "storageId": "s",
            "startedAt": 0, "paidWeeks": 0
        }))
        .expect("a contract"),
    );
    let own = resident(&mut world, "o1", Some("r1"), 9.0, 9.0);
    world.residents[own].carried = [(Good::Sword, 1.0)].into_iter().collect();
    world.residents[own].city_id = Some("elsewhere".into());
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    assert!(live(&world, "w1").unwrap().script.is_none());
}

#[test]
fn leaves_out_the_crews_of_a_caravan_and_of_a_wandering_trader() {
    let mut world = setup();
    for (id, y) in [("s1", 7.0), ("d1", 8.0), ("e1", 9.0), ("d2", 10.0), ("e2", 11.0)] {
        let c = resident(&mut world, id, None, 12.0, y);
        world.residents[c].city_id = Some("hq".into());
        world.residents[c].carried = [(Good::Sword, 1.0)].into_iter().collect();
    }
    world.caravans.push(
        serde_json::from_value(json!({
            "id": "cv", "postId": "p1", "carriageId": "k", "driverId": "d1", "escortIds": ["e1"],
            "heading": "post", "stop": "storage", "toLoad": null, "holding": null, "job": null,
            "transfer": null
        }))
        .expect("a caravan"),
    );
    world.traders.push(
        serde_json::from_value(json!({
            "id": "tr", "carriageId": "k2", "driverId": "d2", "escortIds": ["e2"], "loop": ["p1"],
            "postId": "p1", "heading": "post", "stop": "warehouse", "plan": null, "holding": null,
            "misses": 0, "robberies": 0, "calls": null, "stand": null
        }))
        .expect("a trader"),
    );
    step_outsiders(&mut world, SIZE);
    // A Trade Organization soldier who is on no caravan is no such crew: only they count.
    assert_eq!(outsiders(&world, "c1"), ids(&["s1"]));
}

#[test]
fn reaches_only_those_at_home_who_see_them() {
    let mut world = setup();
    // The city reaches further east: a storage there, with w2 standing by it, out of sight of x1.
    let far = f64::from(SIGHT_RANGE) + 20.0;
    building(&mut world, "st", BuildingKind::Storage, Some("c1"), 12.0 + far, 9.0);
    let faraway = resident(&mut world, "w2", Some("r1"), 12.0 + far, 9.0);
    world.residents[faraway].carried = [(Good::Spear, 1.0)].into_iter().collect();
    world.residents[faraway].city_id = Some("c1".into());
    // And someone armed of the realm who stands in sight, but outside the area.
    let outside = resident(&mut world, "w3", Some("r1"), 12.0, 30.0);
    world.residents[outside].carried = [(Good::Spear, 1.0)].into_iter().collect();
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    assert!(alarm_of(&world, "w1").is_some());
    assert!(live(&world, "w2").unwrap().script.is_none());
    assert!(live(&world, "w3").unwrap().script.is_none());
}

#[test]
fn leaves_someone_already_attacking_at_it() {
    let mut world = setup();
    live_mut(&mut world, "w1").order =
        Some(ResidentOrder::Attack(attack_order("l2", false, false)));
    enter(&mut world, "x1", 12.0, 9.0);
    step_outsiders(&mut world, SIZE);
    let w1 = live(&world, "w1").unwrap();
    assert!(matches!(&w1.order, Some(ResidentOrder::Attack(a)) if a.target_id == "l2"));
    assert!(w1.script.is_none());
    assert!(w1.interrupted.is_none());
}

#[test]
fn counts_for_an_npc_city_too_whose_armed_residents_run_the_alarm_default() {
    let mut world = setup();
    add_city(&mut world, "n1", None, 120.0, 120.0, None);
    let home = resident(&mut world, "n", None, 121.0, 118.0);
    world.residents[home].city_id = Some("n1".into());
    world.residents[home].carried = [(Good::Spear, 1.0)].into_iter().collect();
    enter(&mut world, "x1", 122.0, 119.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "n1"), ids(&["x1"]));
    let script = live(&world, "n").unwrap().script.clone().expect("the Alarm default");
    assert_eq!(script.script_id, 0);
    assert_eq!(script.task, Some(csp_shared::world::Task::Alarm));
    assert_eq!(script.alarm.map(|a| a.about), Some("x1".into()));
}

#[test]
fn counts_a_resident_of_another_npc_city_with_no_realm_in_the_alarm() {
    let mut world = setup();
    let stranger = resident(&mut world, "v1", None, 12.0, 9.0);
    world.residents[stranger].city_id = Some("n9".into());
    world.residents[stranger].carried = [(Good::Spear, 1.0)].into_iter().collect();
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["v1"]));
    let alarm = alarm_of(&world, "w1").expect("an alarm");
    assert_eq!((alarm.about.as_str(), alarm.realm_id), ("v1", None));
}

#[test]
fn keeps_no_list_for_a_trading_post_or_the_hq() {
    let mut world = setup();
    add_city(&mut world, "p1", None, 120.0, 120.0, Some(TradeOrgCity::Post));
    enter(&mut world, "x1", 122.0, 119.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "p1"), None);
}

#[test]
fn counts_someone_in_the_area_of_two_cities_in_each() {
    let mut world = setup();
    add_city(&mut world, "c2", Some("r1"), 18.0, 3.0, None);
    enter(&mut world, "x1", 15.0, 4.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["x1"]));
    assert_eq!(outsiders(&world, "c2"), ids(&["x1"]));
}

#[test]
fn finds_them_across_the_maps_joins() {
    let mut world = setup();
    building(&mut world, "st", BuildingKind::Storage, Some("c1"), 1.0, 2.0);
    enter(&mut world, "x1", f64::from(SIZE - 2), 2.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["x1"]));
}

#[test]
fn counts_someone_on_the_areas_very_edge_in_any_square_of_the_index() {
    let mut world = setup();
    // Each corner of the area of a storage on the far side of a square's edge.
    building(&mut world, "st", BuildingKind::Storage, Some("c1"), 31.0, 31.0);
    for (x, y) in [(27.0, 27.0), (36.0, 27.0), (27.0, 36.0), (36.0, 36.0)] {
        enter(&mut world, "x1", x, y);
        step_outsiders(&mut world, SIZE);
        assert_eq!(outsiders(&world, "c1"), ids(&["x1"]), "{x},{y}");
        leave(&mut world, "x1");
        step_outsiders(&mut world, SIZE);
    }
    enter(&mut world, "x1", 37.0, 36.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
}

#[test]
fn follows_the_city_as_it_grows_shrinks_and_changes_hands() {
    let mut world = setup();
    enter(&mut world, "x1", 100.0, 100.0);
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    // A storage goes up beside them: its site doesn't count, finished it does.
    let st = building(&mut world, "st", BuildingKind::Storage, Some("c1"), 100.0, 100.0);
    world.buildings[st].site =
        Some(serde_json::from_value(json!({ "work": 0, "delivered": {} })).expect("a site"));
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    world.buildings[st].site = None;
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["x1"]));
    // It goes to another city, in place.
    add_city(&mut world, "c2", Some("r1"), 180.0, 180.0, None);
    world.buildings[st].city_id = Some("c2".into());
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), None);
    assert_eq!(outsiders(&world, "c2"), ids(&["x1"]));
    // Their own realm takes it over: they are no outsiders any more.
    city_mut(&mut world, "c2").realm_id = Some("r2".into());
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c2"), None);
    // Torn down, the area goes with it.
    city_mut(&mut world, "c2").realm_id = Some("r1".into());
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c2"), ids(&["x1"]));
    world.buildings.retain(|b| b.id != "st");
    step_outsiders(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c2"), None);
}

#[test]
fn puts_those_inside_on_the_list_without_an_alarm_for_a_world_from_before() {
    let mut world = setup();
    enter(&mut world, "x1", 12.0, 9.0);
    note_outsiders_inside(&mut world, SIZE);
    assert_eq!(outsiders(&world, "c1"), ids(&["x1"]));
    assert!(live(&world, "w1").unwrap().script.is_none());
    step_outsiders(&mut world, SIZE);
    assert!(live(&world, "w1").unwrap().script.is_none());
}

#[test]
fn the_invariant_catches_a_list_that_is_wrong() {
    let mut world = setup();
    let wrong = |world: &mut WorldState, list: &[&str]| {
        city_mut(world, "c1").outsiders = ids(list);
        outsiders_sound(world, SIZE).into_iter().map(|v| v.message).collect::<Vec<_>>()
    };
    assert_eq!(wrong(&mut world, &[]), ["c1 keeps an empty list of outsiders"]);
    assert_eq!(wrong(&mut world, &["nobody"]), ["c1 lists nobody, who is gone"]);
    assert_eq!(wrong(&mut world, &["w1"]), ["c1 lists w1, who is no outsider"]);
    assert_eq!(wrong(&mut world, &["x1"]), ["c1 lists x1, who stands outside its area"]);
    enter(&mut world, "x1", 12.0, 9.0);
    assert!(wrong(&mut world, &["x1"]).is_empty());
    assert_eq!(wrong(&mut world, &["x1", "x1"]), ["c1 lists an outsider twice"]);
    city_mut(&mut world, "c1").trade_org = Some(TradeOrgCity::Post);
    assert_eq!(wrong(&mut world, &["x1"]), ["c1 keeps outsiders, but keeps its own rules"]);
}
