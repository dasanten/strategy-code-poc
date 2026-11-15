use super::*;
use crate::test_support::{add_city, building, plains, resident};
use crate::world::create_world;
use csp_shared::time::TICKS_PER_GAME_HOUR;
use csp_shared::world::{Carriage, ConstructionSite, Good, Pile, Realm, Vessel, VesselKind};
use serde_json::json;

/// Realm r1 with city c1, resident w1 of it at (5, 5), and realm r2 with city c2. c1 has a
/// storage `s1` holding 20 Wood, a lumber camp `l1` with 3 Wood on its pile and a site `t1` with
/// 4 Stone delivered; c2 has a storage `s2`.
fn world() -> WorldState {
    let mut w = create_world(&plains(32), 1);
    for (id, user) in [("r1", 1), ("r2", 2)] {
        w.realms.push(Realm {
            id: id.into(),
            user_id: user,
            leader_id: "w1".into(),
            name: None,
            demands_sent_at: None,
            heir_id: None,
        });
    }
    add_city(&mut w, "c1", Some("r1"), 2.0, 2.0);
    add_city(&mut w, "c2", Some("r2"), 20.0, 20.0);
    let mut s1 = building("s1", BuildingKind::Storage, Some("c1"), 8.0, 2.0);
    s1.stock = Some(Stock::from([(Good::Wood, 20.0)]));
    let mut t1 = building("t1", BuildingKind::House, Some("c1"), 12.0, 2.0);
    t1.site = Some(ConstructionSite { delivered: Stock::from([(Good::Stone, 4.0)]), work: 0.0 });
    w.buildings.extend([
        s1,
        building("l1", BuildingKind::LumberCamp, Some("c1"), 2.0, 8.0),
        t1,
        building("h1", BuildingKind::House, Some("c1"), 8.0, 8.0),
        building("s2", BuildingKind::Storage, Some("c2"), 24.0, 20.0),
    ]);
    w.piles.push(Pile { id: "p1".into(), x: 2.0, y: 8.0, goods: Stock::from([(Good::Wood, 3.0)]) });
    let mut r = resident("w1");
    r.owner = Some("r1".into());
    r.x = 5.0;
    r.y = 5.0;
    w.residents.push(r);
    w
}

fn cond(v: serde_json::Value) -> Condition {
    condition_of(Some(&v)).unwrap()
}

fn asks(w: &WorldState, v: serde_json::Value) -> Holds {
    condition_holds(w, 0, "r1", &cond(v))
}

#[test]
fn what_they_carry_at_least_or_less_than_full_or_empty() {
    let mut w = world();
    let at_least = json!({ "kind": "carries", "good": "wood", "compare": "atLeast", "amount": 2 });
    let less = json!({ "kind": "carries", "good": "wood", "compare": "lessThan", "amount": 2 });
    let empty = json!({ "kind": "load", "load": "empty" });
    let full = json!({ "kind": "load", "load": "full" });
    assert_eq!(asks(&w, at_least.clone()), Holds::No);
    assert_eq!(asks(&w, less.clone()), Holds::Yes);
    assert_eq!(asks(&w, empty.clone()), Holds::Yes);
    assert_eq!(asks(&w, full.clone()), Holds::No);
    w.residents[0].carried = Stock::from([(Good::Wood, 2.0)]);
    assert_eq!(asks(&w, at_least), Holds::Yes);
    assert_eq!(asks(&w, less), Holds::No);
    assert_eq!(asks(&w, empty), Holds::No);
    assert_eq!(asks(&w, full.clone()), Holds::No);
    // Full: less room left than one more unit weighs.
    let capacity = carry_capacity(&w.residents[0], 0.0);
    let units = (capacity / good_weight(Good::Wood)).floor();
    w.residents[0].carried = Stock::from([(Good::Wood, units)]);
    assert_eq!(asks(&w, full), Holds::Yes);
}

#[test]
fn what_the_carriage_or_vessel_they_drive_carries() {
    let mut w = world();
    let full = json!({ "kind": "load", "vehicle": true, "load": "full" });
    let stone = json!({ "kind": "carries", "vehicle": true, "good": "stone", "compare": "atLeast", "amount": 5 });
    // With no carriage or boat to ask about, it is false.
    assert_eq!(asks(&w, json!({ "kind": "load", "vehicle": true, "load": "empty" })), Holds::No);
    // A carriage of their realm on their tile.
    w.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 5.0,
        y: 5.0,
        horse_id: None,
        load: Stock::from([(Good::Stone, 5.0)]),
    });
    assert_eq!(asks(&w, stone.clone()), Holds::Yes);
    assert_eq!(asks(&w, full.clone()), Holds::No);
    // Another realm's carriage there isn't theirs to ask about.
    w.carriages[0].realm_id = Some("r2".into());
    assert_eq!(asks(&w, stone.clone()), Holds::No);
    // Aboard a boat, the boat is asked.
    w.vessels.push(Vessel {
        id: "v1".into(),
        kind: VesselKind::Boat,
        realm_id: Some("r1".into()),
        x: 5.0,
        y: 5.0,
        load: Stock::from([(Good::Stone, 1000.0)]),
        rower_id: Some("w1".into()),
        crew_ids: vec![],
    });
    w.residents[0].aboard = Some("v1".into());
    assert_eq!(asks(&w, stone), Holds::Yes);
    assert_eq!(asks(&w, full), Holds::Yes);
}

#[test]
fn what_a_storage_workplace_pile_or_site_of_the_realm_holds() {
    let w = world();
    let stock = |place: &str, good: &str, compare: &str, amount: u32| {
        asks(
            &w,
            json!({ "kind": "stock", "placeId": place, "good": good, "compare": compare,
            "amount": amount }),
        )
    };
    assert_eq!(stock("s1", "wood", "atLeast", 20), Holds::Yes);
    assert_eq!(stock("s1", "wood", "atLeast", 21), Holds::No);
    assert_eq!(stock("s1", "wood", "lessThan", 21), Holds::Yes);
    assert_eq!(stock("l1", "wood", "atLeast", 3), Holds::Yes);
    assert_eq!(stock("l1", "wood", "lessThan", 3), Holds::No);
    assert_eq!(stock("t1", "stone", "atLeast", 4), Holds::Yes);
    assert_eq!(stock("t1", "food", "atLeast", 1), Holds::No);
}

#[test]
fn a_place_gone_or_no_longer_the_realms_counts_as_false() {
    let mut w = world();
    let ask = json!({ "kind": "stock", "placeId": "s1", "good": "wood", "compare": "lessThan",
        "amount": 100 });
    assert_eq!(asks(&w, ask.clone()), Holds::Yes);
    w.cities.iter_mut().find(|c| c.id == "c1").unwrap().realm_id = Some("r2".into());
    assert_eq!(asks(&w, ask.clone()), Holds::PlaceGone("s1".into()));
    w.buildings.retain(|b| b.id != "s1");
    assert_eq!(asks(&w, ask), Holds::PlaceGone("s1".into()));
}

#[test]
fn nothing_about_another_realm_can_be_asked() {
    let w = world();
    let on = |place: &str| {
        cond(json!({ "kind": "stock", "placeId": place, "good": "wood", "compare": "atLeast",
            "amount": 1 }))
    };
    let problem = Some("not a storage, workplace or site of your realm");
    assert_eq!(condition_place_problem(&w, "r1", &on("s2")), problem);
    assert_eq!(condition_place_problem(&w, "r1", &on("nowhere")), problem);
    // A house is no place goods are kept.
    assert_eq!(condition_place_problem(&w, "r1", &on("h1")), problem);
    assert_eq!(condition_place_problem(&w, "r1", &on("s1")), None);
    assert_eq!(condition_place_problem(&w, "r2", &on("s2")), None);
}

#[test]
fn their_hunger_and_health_above_or_below_a_share() {
    let mut w = world();
    w.residents[0].hunger = MAX_HUNGER * 0.3;
    w.residents[0].health = MAX_HEALTH * 0.8;
    let need = |need: &str, side: &str, share: f64| {
        asks(&w, json!({ "kind": "need", "need": need, "side": side, "share": share }))
    };
    assert_eq!(need("hunger", "below", 0.5), Holds::Yes);
    assert_eq!(need("hunger", "above", 0.5), Holds::No);
    assert_eq!(need("health", "above", 0.5), Holds::Yes);
    assert_eq!(need("health", "below", 0.5), Holds::No);
}

#[test]
fn mounted_or_aboard_or_not() {
    let mut w = world();
    let ask = |w: &WorldState, kind: &str, is: bool| asks(w, json!({ "kind": kind, "is": is }));
    assert_eq!(ask(&w, "mounted", true), Holds::No);
    assert_eq!(ask(&w, "mounted", false), Holds::Yes);
    assert_eq!(ask(&w, "aboard", true), Holds::No);
    assert_eq!(ask(&w, "aboard", false), Holds::Yes);
    w.residents[0].riding = Some("h1".into());
    w.residents[0].aboard = Some("v1".into());
    assert_eq!(ask(&w, "mounted", true), Holds::Yes);
    assert_eq!(ask(&w, "mounted", false), Holds::No);
    assert_eq!(ask(&w, "aboard", true), Holds::Yes);
    assert_eq!(ask(&w, "aboard", false), Holds::No);
}

#[test]
fn the_game_hour_before_or_after_an_hour() {
    let mut w = world();
    w.tick = (7.0 * TICKS_PER_GAME_HOUR) as u64;
    let hour = |w: &WorldState, side: &str, hour: u32| {
        asks(w, json!({ "kind": "hour", "side": side, "hour": hour }))
    };
    assert_eq!(hour(&w, "before", 8), Holds::Yes);
    assert_eq!(hour(&w, "after", 8), Holds::No);
    assert_eq!(hour(&w, "after", 7), Holds::Yes);
    assert_eq!(hour(&w, "before", 7), Holds::No);
}

#[test]
fn a_condition_is_checked_when_given() {
    let problem = |v: serde_json::Value| condition_of(Some(&v)).err();
    assert_eq!(condition_of(None).err().as_deref(), Some("needs a condition"));
    assert_eq!(problem(json!({ "kind": "weather" })).as_deref(), Some("that is no condition"));
    assert_eq!(
        problem(json!({ "kind": "carries", "good": "wood", "compare": "atLeast", "amount": 1.5 }))
            .as_deref(),
        Some("a condition's amount is a whole number from 0")
    );
    assert_eq!(
        problem(json!({ "kind": "need", "need": "health", "side": "above", "share": 2 }))
            .as_deref(),
        Some("a condition's share is from 0 to 1")
    );
    assert_eq!(
        problem(json!({ "kind": "hour", "side": "after", "hour": 24 })).as_deref(),
        Some("a condition's hour is a whole number from 0 to 23")
    );
    assert_eq!(
        problem(json!({ "kind": "stock", "placeId": "", "good": "wood", "compare": "atLeast",
            "amount": 1 }))
        .as_deref(),
        Some("a condition on stock needs a place")
    );
    assert_eq!(
        problem(json!({ "kind": "mounted", "is": true, "also": 1 })).as_deref(),
        Some("that is no condition")
    );
}
