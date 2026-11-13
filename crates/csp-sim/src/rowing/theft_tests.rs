//! Stealing and fighting at a vessel (`CONTEXT.md`: Stealing a carriage or horse, its vessel
//! part; Fighting at a vessel; T90.5): rowing off in another organization's boat takes it with its
//! load as one theft, unless someone rows it, is aboard or guards it from beside; those aboard are
//! fought from beside it and stay aboard, Down or dead; nobody reaches a boat away from every
//! shore, and there are no fights between vessels.

use csp_shared::balance::{LIFESPAN_MAX, MAX_HEALTH, OWN_FOOD};
use csp_shared::world::{CrimeKind, Good, RealmEventWhat, ResidentOrder, Stock};
use serde_json::json;

use super::tests::{boat, game_on, lake, until_done, v1};
use crate::combat::attack_order;
use crate::events::events_for;
use crate::game_test_world::Game;
use crate::movement_test_world::resident;
use crate::queries::names::held;
use crate::test_support::add_city;
use csp_shared::world::Resident;

/// Realm r1's game on the lake (w1, p1, p2 at (1, 4), its boat v1 at (2, 4), loaded with 5 Food),
/// with realm r2 (Player 8): its thief x1 at (1, 3), beside the boat too, and its Leader l2 far
/// off at (18, 18).
fn game() -> Game {
    let mut game = game_on(lake(), (1.0, 4.0), (2.0, 4.0));
    game.world.vessels[0].load = Stock::from([(Good::Food, 5.0)]);
    game.world.realms.push(
        serde_json::from_value(json!({"id": "r2", "userId": 8, "leaderId": "l2"})).expect("r2"),
    );
    for (id, x, y) in [("x1", 1.0, 3.0), ("l2", 18.0, 18.0)] {
        let mut r = rival(id, x, y);
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        game.world.residents.push(r);
    }
    game
}

/// Player 8's x1 rows v1 off to (x, y).
fn row_off(game: &mut Game, x: i32, y: i32) -> String {
    let o = json!({"kind": "row", "residentId": "x1", "vesselId": "v1", "x": x, "y": y});
    game.order(8, o)
}

fn arm(game: &mut Game, id: &str) {
    game.r_mut(id).carried.insert(Good::Spear, 1.0);
}

fn attack(game: &mut Game, user: u64, id: &str, target: &str) -> String {
    game.order(user, json!({"kind": "attack", "residentId": id, "targetId": target}))
}

#[test]
fn rowing_off_in_a_rivals_boat_takes_it_with_its_load_as_one_theft() {
    let mut game = game();
    assert_eq!(row_off(&mut game, 12, 4), "ack");
    let v = v1(&game);
    assert_eq!(v.realm_id.as_deref(), Some("r2"));
    assert_eq!(v.rower_id.as_deref(), Some("x1"));
    assert_eq!(held(&v.load, Good::Food), 5.0, "with its load");
    assert_eq!(game.r("x1").aboard.as_deref(), Some("v1"));
    let thefts: Vec<_> = game.world.crimes.iter().filter(|c| c.kind == CrimeKind::Theft).collect();
    assert_eq!(thefts.len(), 1);
    let theft = thefts[0];
    assert_eq!((theft.boat, theft.carriage, theft.horse.as_deref()), (Some(true), None, None));
    assert_eq!(theft.victim_org, "r1");
    assert_eq!(theft.goods.as_ref().map(|g| held(g, Good::Food)), Some(5.0));
    assert!(theft.witnesses.contains(&"w1".to_string()), "seen from the shore");
    // The owner learns at once it is gone and where, without the thief; the thief's realm what it took.
    let gone = events_for(&game.world, 7, 0)
        .into_iter()
        .any(|e| matches!(e.what, RealmEventWhat::TransportGone { boat: Some(true), x, y, .. } if (x, y) == (2.0, 4.0)));
    assert!(gone);
    let taken = events_for(&game.world, 8, 0).into_iter().any(|e| {
        matches!(&e.what, RealmEventWhat::TransportTaken { boat: Some(true), goods: Some(g), .. }
            if held(g, Good::Food) == 5.0)
    });
    assert!(taken);
    // From then on it is an ordinary boat of r2's, rowed across, every invariant kept.
    until_done(&mut game, "x1", 400);
    assert_eq!((v1(&game).x, v1(&game).y), (12.0, 4.0));
    assert_eq!(game.world.crimes.len(), 1, "one theft, not one per step");
}

#[test]
fn is_refused_while_someone_is_aboard_or_rows_it() {
    let mut game = game();
    let board = json!({"kind": "board", "residentId": "p1", "vesselId": "v1"});
    assert_eq!(game.order(7, board), "ack");
    assert_eq!(row_off(&mut game, 12, 4), "someone is aboard that boat");
    assert_eq!(game.order(7, json!({"kind": "getOff", "residentId": "p1"})), "ack");
    let row = json!({"kind": "row", "residentId": "w1", "vesselId": "v1", "x": 3, "y": 4});
    assert_eq!(game.order(7, row), "ack");
    assert_eq!(row_off(&mut game, 12, 4), "someone is rowing that boat");
    assert_eq!(v1(&game).realm_id.as_deref(), Some("r1"));
    assert!(game.world.crimes.is_empty());
}

#[test]
fn is_refused_while_an_armed_resident_of_its_owner_guards_it_from_beside() {
    let mut game = game();
    arm(&mut game, "w1");
    assert_eq!(row_off(&mut game, 12, 4), "an armed resident guards that boat");
    // An armed one of the thief's realm beside it too, here the thief, breaks the guard.
    arm(&mut game, "x1");
    assert_eq!(row_off(&mut game, 12, 4), "ack");
    assert_eq!(v1(&game).realm_id.as_deref(), Some("r2"));
}

#[test]
fn an_armed_owner_away_from_the_shore_guards_nothing() {
    let mut game = game();
    arm(&mut game, "w1");
    game.r_mut("w1").x = 0.0;
    assert_eq!(row_off(&mut game, 12, 4), "ack");
}

#[test]
fn takes_a_boat_of_nobody_with_no_crime() {
    let mut game = game();
    game.world.vessels[0].realm_id = None;
    assert_eq!(row_off(&mut game, 12, 4), "ack");
    assert_eq!(v1(&game).realm_id.as_deref(), Some("r2"));
    assert!(game.world.crimes.is_empty());
}

#[test]
fn needs_a_grown_thief_beside_it() {
    let mut game = game();
    game.r_mut("x1").born_at = game.world.tick as f64;
    assert_eq!(row_off(&mut game, 12, 4), "children can’t steal");
    game.r_mut("x1").born_at = 0.0 - 1e12;
    game.r_mut("x1").x = 0.0;
    assert_eq!(row_off(&mut game, 12, 4), "that boat is not beside the resident");
    // Another Player's residents are no thieves of Player 7's.
    let o = json!({"kind": "row", "residentId": "x1", "vesselId": "v1", "x": 12, "y": 4});
    assert_eq!(game.order(7, o), "not one of your residents");
}

#[test]
fn those_aboard_are_fought_from_beside_it_and_fight_back_staying_aboard() {
    let mut game = game();
    let board = json!({"kind": "board", "residentId": "p1", "vesselId": "v1"});
    assert_eq!(game.order(7, board), "ack");
    arm(&mut game, "p1");
    arm(&mut game, "x1");
    assert_eq!(attack(&mut game, 8, "x1", "p1"), "ack");
    assert!(game.until_hit("p1", 50).is_some(), "struck from the shore");
    assert!(game.until_hit("x1", 50).is_some(), "and struck back from aboard");
    let p1 = game.r("p1");
    assert_eq!((p1.aboard.as_deref(), p1.x, p1.y), (Some("v1"), 2.0, 4.0));
    assert!(game.world.crimes.iter().any(|c| c.kind == CrimeKind::Attack));
}

#[test]
fn one_killed_aboard_stays_aboard_what_they_carried_going_into_the_boat() {
    let mut game = game();
    let board = json!({"kind": "board", "residentId": "p1", "vesselId": "v1"});
    assert_eq!(game.order(7, board), "ack");
    game.r_mut("p1").health = 1.0;
    game.r_mut("p1").carried.insert(Good::Wood, 2.0);
    arm(&mut game, "x1");
    assert_eq!(attack(&mut game, 8, "x1", "p1"), "ack");
    game.until_hit("p1", 50).expect("struck");
    assert!(game.world.residents.iter().all(|r| r.id != "p1"), "killed");
    assert_eq!(held(&v1(&game).load, Good::Wood), 2.0);
    assert!(game.world.piles.is_empty(), "nothing lies on the water");
}

#[test]
fn nobody_reaches_a_boat_away_from_every_shore() {
    // (5, 5): every tile around it is water.
    let mut game = game_on(lake(), (1.0, 4.0), (5.0, 5.0));
    game.world.realms.push(
        serde_json::from_value(json!({"id": "r2", "userId": 8, "leaderId": "x1"})).expect("r2"),
    );
    game.world.residents.push(rival("x1", 1.0, 4.0));
    arm(&mut game, "x1");
    game.r_mut("p1").aboard = Some("v1".into());
    (game.r_mut("p1").x, game.r_mut("p1").y) = (5.0, 5.0);
    assert_eq!(attack(&mut game, 8, "x1", "p1"), "ack");
    game.run(60);
    assert!(game.r("x1").order.is_none(), "no way to it");
    assert_eq!(game.r("p1").health, MAX_HEALTH);
    assert!(game.world.crimes.is_empty());
}

#[test]
fn there_are_no_fights_between_vessels() {
    let mut game = game_on(lake(), (1.0, 4.0), (5.0, 5.0));
    game.world.realms.push(
        serde_json::from_value(json!({"id": "r2", "userId": 8, "leaderId": "x1"})).expect("r2"),
    );
    let mut v2 = boat("v2", 6.0, 5.0);
    v2.realm_id = Some("r2".into());
    game.world.vessels.push(v2);
    let mut x1 = rival("x1", 6.0, 5.0);
    x1.aboard = Some("v2".into());
    game.world.residents.push(x1);
    arm(&mut game, "x1");
    game.r_mut("p1").aboard = Some("v1".into());
    (game.r_mut("p1").x, game.r_mut("p1").y) = (5.0, 5.0);
    // Ordered, they would have to get off first, and no shore is beside their boat.
    assert_eq!(attack(&mut game, 8, "x1", "p1"), "no shore beside the boat to get off onto");
    // Given the attack anyway, as a script might have it, it strikes nothing from boat to boat.
    game.r_mut("x1").order = Some(ResidentOrder::Attack(attack_order("p1", false, false)));
    game.run(20);
    assert_eq!(game.r("x1").aboard.as_deref(), Some("v2"));
    assert_eq!(game.r("p1").health, MAX_HEALTH);
    assert!(game.world.crimes.is_empty());
}

#[test]
fn the_alarm_at_home_goes_after_a_boat_thief_who_rows_out_of_reach() {
    let mut game = game();
    // r1's city c1, its town hall east of the lake: across the map's edge, the theft is in its area.
    add_city(&mut game.world, "c1", Some("r1"), 17.0, 4.0);
    for id in ["w1", "p1", "p2"] {
        game.r_mut(id).city_id = Some("c1".into());
    }
    // w1 is armed but not beside the boat, so guards nothing; x1 is armed too.
    arm(&mut game, "w1");
    (game.r_mut("w1").x, game.r_mut("w1").y) = (0.0, 8.0);
    arm(&mut game, "x1");
    assert_eq!(row_off(&mut game, 5, 5), "ack");
    let alarmed = game.r("w1").script.as_ref().and_then(|s| s.alarm.as_ref()).map(|a| a.kind);
    assert!(alarmed.is_some(), "the theft raises the alarm for w1, who saw it");
    until_done(&mut game, "x1", 400);
    assert_eq!((v1(&game).x, v1(&game).y), (5.0, 5.0));
    // Out on the lake nobody reaches the thief, and the alarm settles without them.
    let health = game.r("x1").health;
    game.run(200);
    assert_eq!(game.r("x1").health, health);
    assert_eq!(game.r("x1").aboard.as_deref(), Some("v1"));
    let w1 = game.r("w1");
    assert!(w1.aboard.is_none());
    assert!(!matches!(w1.order, Some(ResidentOrder::Attack(_))), "no endless attack");
}

/// A grown resident of realm r2 at (x, y).
fn rival(id: &str, x: f64, y: f64) -> Resident {
    let mut r = resident(id, Some("r2"), x, y);
    r.lifespan = LIFESPAN_MAX;
    r
}
