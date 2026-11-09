//! `demands.test.ts`: sending, answering, accepting a city, lapsing and the invariant. The views
//! of a realm's diplomacy (`diplomacyFor`) come with the server.

use super::*;
use crate::invariants::{check_invariants, world_invariants};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::demand::realms_known_to;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_support::{add_city, plains};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};
use csp_shared::world::{DeathCause, Realm};
use serde_json::json;
use std::sync::Arc;

const SIZE: i32 = 256;

fn mara() -> OrderSender {
    OrderSender::player(7, "Mara")
}
fn tobin() -> OrderSender {
    OrderSender::player(8, "Tobin")
}
fn wren() -> OrderSender {
    OrderSender::player(9, "Wren")
}

fn resident(world: &mut WorldState, id: &str, owner: &str, x: f64, y: f64) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some(owner), city_id: None, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

/// What Mara's Player remembers of Tobin's city c2.
fn c2_seen(name: &str, realm_id: Option<&str>) -> Remembered {
    serde_json::from_value(json!({
        "is": "city", "id": "c2", "name": name, "realmId": realm_id, "townHallId": "c2-hall",
        "occupation": null, "hire": null, "seenAt": 0,
    }))
    .unwrap()
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    queue: OrderQueue,
}

/// Realm r1 (Player 7) with city c1 and realm r2 (Player 8) with city c2, far apart, and r1's
/// Player remembers c2; realm r3 (Player 9) that nobody knows of.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    for (id, user, leader, name) in
        [("r1", 7, "a1", "Mara"), ("r2", 8, "b1", "Tobin"), ("r3", 9, "w1", "Wren")]
    {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader, "name": name });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0);
    add_city(&mut world, "c2", Some("r2"), 160.0, 160.0);
    add_city(&mut world, "c3", Some("r3"), 100.0, 220.0);
    resident(&mut world, "a1", "r1", 40.0, 44.0);
    resident(&mut world, "b1", "r2", 160.0, 164.0);
    resident(&mut world, "w1", "r3", 100.0, 224.0);
    world.last_seen.insert(7, vec![c2_seen("Ashford", Some("r2"))]);
    let terrain = Arc::new(terrain);
    Setup { world, queue: OrderQueue::new(order_kinds(), Some(terrain.clone())), terrain }
}

fn goods_demand() -> Value {
    json!({
        "kind": "sendDemand", "realmId": "r2",
        "terms": { "kind": "goods", "goods": { "coins": 50, "food": 5 } },
        "note": "Pay what you owe, or we come for it.", "days": 3,
    })
}

fn city_demand() -> Value {
    json!({
        "kind": "sendDemand", "realmId": "r2", "terms": { "kind": "city", "cityId": "c2" },
        "note": "Give up Ashford or we take it.", "days": 3,
    })
}

fn with(mut order: Value, k: &str, v: Value) -> Value {
    order[k] = v;
    order
}

impl Setup {
    /// Sends an order from a Player and applies it; the reason it was refused, if it was.
    fn order(&mut self, from: &OrderSender, o: Value) -> Option<String> {
        let answer = self.queue.receive(&self.world, from, &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => Some(reason),
            _ => None,
        }
    }

    fn events(&self, user_id: u64) -> Vec<Value> {
        self.world
            .events
            .iter()
            .filter(|e| e.user_id == user_id)
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == "demand")
            .collect()
    }

    fn whats(&self, user_id: u64) -> Vec<String> {
        self.events(user_id).iter().map(|e| e["what"].as_str().unwrap().to_string()).collect()
    }

    fn sound(&self) -> Vec<String> {
        demands_sound(&self.world).into_iter().map(|v| v.message).collect()
    }

    fn step(&mut self) {
        let terrain = self.terrain.clone();
        step_world(&mut self.world, &terrain, &mut Scratch::default(), None, None);
    }
}

fn refused(reason: Option<String>, part: &str) {
    let reason = reason.unwrap_or_default();
    assert!(reason.contains(part), "{reason:?} does not say {part:?}");
}

#[test]
fn a_demand_arrives_at_once_far_away_in_both_logs() {
    let mut s = setup();
    assert_eq!(s.order(&mara(), city_demand()), None);
    let d = &s.world.demands[0];
    assert_eq!((d.from_id.as_str(), d.to_id.as_str()), ("r1", "r2"));
    assert_eq!(d.terms, DemandTerms::City { city_id: "c2".into(), city_name: "Ashford".into() });
    assert_eq!(d.note, "Give up Ashford or we take it.");
    let tick = s.world.tick as f64;
    assert_eq!((d.sent_at, d.deadline), (tick, tick + 3.0 * TICKS_PER_GAME_DAY));
    let sent = &s.events(7)[0];
    assert_eq!(
        (sent["what"].as_str(), sent["mine"].as_bool(), sent["other"].as_str()),
        (Some("sent"), Some(true), Some("Tobin"))
    );
    let got = &s.events(8)[0];
    assert_eq!(
        (got["what"].as_str(), got["mine"].as_bool(), got["other"].as_str()),
        (Some("received"), Some(false), Some("Mara"))
    );
    // The note stays out of the log.
    assert!(!serde_json::to_string(&s.world.events).unwrap().contains("Give up Ashford"));
    assert_eq!(s.sound(), Vec::<String>::new());
}

#[test]
fn a_demand_asks_for_goods_and_coins_keeping_only_what_the_terms_should_hold() {
    let mut s = setup();
    let terms = json!({ "kind": "goods", "goods": { "coins": 50 }, "stolen": "everything" });
    assert_eq!(s.order(&mara(), with(goods_demand(), "terms", terms)), None);
    let goods: Stock = [(Good::Coins, 50.0)].into_iter().collect();
    assert_eq!(s.world.demands[0].terms, DemandTerms::Goods { goods });
}

#[test]
fn a_demand_refuses_terms_it_cant_take() {
    for (terms, part) in [
        (Value::Null, "city, or goods"),
        (json!({ "kind": "favour" }), "city, or goods"),
        (json!({ "kind": "goods", "goods": {} }), "name the goods"),
        (json!({ "kind": "goods", "goods": ["food"] }), "name the goods"),
        (json!({ "kind": "goods", "goods": { "gold": 1 } }), "no such good"),
        (json!({ "kind": "goods", "goods": { "__proto__": 1 } }), "no such good"),
        (json!({ "kind": "goods", "goods": { "food": 1.5 } }), "whole number"),
        (json!({ "kind": "goods", "goods": { "food": 0 } }), "whole number"),
        (json!({ "kind": "goods", "goods": { "food": 2f64.powi(60) } }), "whole number"),
        (json!({ "kind": "city", "cityId": "c3" }), "know of that city"),
        (json!({ "kind": "city", "cityId": "c1" }), "isn’t theirs"),
    ] {
        let mut s = setup();
        refused(s.order(&mara(), with(goods_demand(), "terms", terms)), part);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(s.world.events, vec![]);
    }
}

#[test]
fn a_city_counts_as_the_sender_last_saw_it() {
    let mut s = setup();
    // Another city of r2 keeps r2 known.
    let mut c9 = c2_seen("Ashford", Some("r2"));
    if let Remembered::City(c) = &mut c9 {
        c.id = "c9".into();
    }
    s.world.last_seen.insert(7, vec![c2_seen("Ashford", Some("r3")), c9]);
    refused(s.order(&mara(), city_demand()), "isn’t theirs");
    // Only memory counts: c2 is r2's in truth, and the name is the one Mara knows.
    s.world.last_seen.insert(7, vec![c2_seen("Old Ashford", Some("r2"))]);
    s.world.cities[1].name = "New Ashford".into();
    assert_eq!(s.order(&mara(), city_demand()), None);
    assert!(
        matches!(&s.world.demands[0].terms, DemandTerms::City { city_name, .. } if city_name == "Old Ashford")
    );
}

#[test]
fn a_demand_goes_only_to_another_realm_they_know_of() {
    let mut s = setup();
    refused(s.order(&mara(), with(goods_demand(), "realmId", json!("r1"))), "another realm");
    refused(s.order(&mara(), with(goods_demand(), "realmId", json!("r9"))), "to a realm");
    refused(s.order(&mara(), with(goods_demand(), "realmId", json!("c2"))), "to a realm");
    refused(s.order(&mara(), with(goods_demand(), "realmId", json!(7))), "to a realm");
    refused(s.order(&mara(), with(goods_demand(), "realmId", json!("r3"))), "know of");
    assert_eq!(s.world.demands, vec![]);
}

#[test]
fn a_realm_with_residents_in_sight_counts_as_known() {
    let mut s = setup();
    resident(&mut s.world, "w2", "r3", 42.0, 44.0);
    assert_eq!(realms_known_to(&s.world, "r1", []), vec!["r2"]);
    assert_eq!(realms_known_to(&s.world, "r1", ["r3"]), vec!["r2", "r3"]);
    assert_eq!(s.order(&mara(), with(goods_demand(), "realmId", json!("r3"))), None);
}

#[test]
fn a_demand_needs_a_deadline_ahead_and_within_the_cap() {
    let mut s = setup();
    for days in
        [json!(0), json!(-1), json!(1.5), json!(DEMAND_MAX_DAYS + 1.0), json!("3"), Value::Null]
    {
        refused(s.order(&mara(), with(goods_demand(), "days", days)), "deadline");
    }
    assert_eq!(s.order(&mara(), with(goods_demand(), "days", json!(DEMAND_MAX_DAYS))), None);
}

#[test]
fn a_note_is_capped_trimmed_and_free_of_control_characters() {
    let mut s = setup();
    let long = "x".repeat(DEMAND_NOTE_MAX_LENGTH as usize + 1);
    refused(s.order(&mara(), with(goods_demand(), "note", json!(long))), "at most");
    refused(s.order(&mara(), with(goods_demand(), "note", json!("   "))), "needs a note");
    refused(s.order(&mara(), with(goods_demand(), "note", Value::Null)), "needs a note");
    refused(s.order(&mara(), with(goods_demand(), "note", json!(42))), "needs a note");
    refused(s.order(&mara(), with(goods_demand(), "note", json!("a\u{0}b"))), "control");
    assert_eq!(s.world.demands, vec![]);
    let fits = "y".repeat(DEMAND_NOTE_MAX_LENGTH as usize);
    assert_eq!(s.order(&mara(), with(goods_demand(), "note", json!(format!("  {fits}\n")))), None);
    assert_eq!(s.world.demands[0].note, fits);
}

#[test]
fn demands_are_limited_per_realm_over_any_one_game_day() {
    let mut s = setup();
    s.world.last_seen.insert(9, vec![c2_seen("Ashford", Some("r2"))]);
    for _ in 0..DEMANDS_PER_GAME_DAY as usize {
        assert_eq!(s.order(&mara(), goods_demand()), None);
    }
    refused(s.order(&mara(), goods_demand()), "at most");
    assert_eq!(s.world.demands.len(), DEMANDS_PER_GAME_DAY as usize);
    // Another realm's limit is its own.
    assert_eq!(s.order(&wren(), goods_demand()), None);
    // A refused one doesn't count, and answered ones still do.
    s.world.demands.retain(|d| d.from_id != "r1");
    refused(s.order(&mara(), goods_demand()), "at most");
    s.world.tick += TICKS_PER_GAME_DAY as u64 - 1;
    refused(s.order(&mara(), goods_demand()), "at most");
    s.world.tick += 1;
    assert_eq!(s.order(&mara(), goods_demand()), None);
    // Only what still counts is kept.
    assert_eq!(s.world.realms[0].demands_sent_at, Some(vec![s.world.tick as f64]));
}

#[test]
fn the_limit_holds_for_orders_that_all_came_in_during_one_tick() {
    let mut s = setup();
    for i in 0..DEMANDS_PER_GAME_DAY as usize + 2 {
        let reply = s.queue.receive(&s.world, &mara(), &json!(format!("q{i}")), &goods_demand());
        assert!(matches!(reply, OrderReply::Ack { .. }));
    }
    s.queue.apply_all(&mut s.world);
    assert_eq!(s.world.demands.len(), DEMANDS_PER_GAME_DAY as usize);
    assert_eq!(s.sound(), Vec::<String>::new());
}

#[test]
fn sending_a_demand_needs_a_realm() {
    let mut s = setup();
    refused(s.order(&OrderSender::player(99, "Nobody"), goods_demand()), "no realm");
}

fn sent() -> (Setup, String) {
    let mut s = setup();
    s.order(&mara(), city_demand());
    let id = s.world.demands[0].id.clone();
    (s, id)
}

#[test]
fn an_answer_is_recorded_in_both_logs_at_once() {
    for (kind, what) in [("acceptDemand", "accepted"), ("declineDemand", "declined")] {
        let (mut s, id) = sent();
        assert_eq!(s.order(&tobin(), json!({ "kind": kind, "demandId": id })), None);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(s.whats(7), vec!["sent", what]);
        assert_eq!(s.whats(8), vec!["received", what]);
        let last = s.events(7).pop().unwrap();
        assert_eq!((last["mine"].as_bool(), last["other"].as_str()), (Some(true), Some("Tobin")));
        assert_eq!(last["terms"]["cityName"], "Ashford");
        assert_eq!(s.sound(), Vec::<String>::new());
    }
}

#[test]
fn accepting_goods_needs_to_know_how_they_go() {
    let mut s = setup();
    s.order(&mara(), goods_demand());
    let id = s.world.demands[0].id.clone();
    refused(
        s.order(&tobin(), json!({ "kind": "acceptDemand", "demandId": id })),
        "set the goods aside",
    );
    assert_eq!(s.world.demands.len(), 1);
}

#[test]
fn an_answer_is_only_for_the_realm_it_was_sent_to_and_only_once() {
    let (mut s, id) = sent();
    for kind in ["acceptDemand", "declineDemand"] {
        refused(s.order(&mara(), json!({ "kind": kind, "demandId": id })), "only the realm");
        refused(s.order(&wren(), json!({ "kind": kind, "demandId": id })), "no such demand");
    }
    assert_eq!(s.world.demands.len(), 1);
    assert_eq!(s.order(&tobin(), json!({ "kind": "declineDemand", "demandId": id })), None);
    refused(s.order(&tobin(), json!({ "kind": "acceptDemand", "demandId": id })), "no such");
}

#[test]
fn one_answer_is_taken_when_two_come_in_during_one_tick() {
    let (mut s, id) = sent();
    s.queue.receive(
        &s.world,
        &tobin(),
        &json!("a"),
        &json!({ "kind": "acceptDemand", "demandId": id }),
    );
    s.queue.receive(
        &s.world,
        &tobin(),
        &json!("b"),
        &json!({ "kind": "declineDemand", "demandId": id }),
    );
    s.queue.apply_all(&mut s.world);
    assert_eq!(s.whats(8), vec!["received", "accepted"]);
}

/// `setup` with Mara's demand for c2 sent, where b2 lives; Tobin's Leader b1 lives far away.
fn demanded() -> (Setup, String) {
    let (mut s, id) = sent();
    let b2 = resident(&mut s.world, "b2", "r2", 160.0, 165.0);
    s.world.residents[b2].city_id = Some("c2".into());
    (s, id)
}

#[test]
fn accepting_a_city_joins_it_at_once_with_its_people() {
    let (mut s, id) = demanded();
    assert_eq!(s.order(&tobin(), json!({ "kind": "acceptDemand", "demandId": id })), None);
    assert_eq!(s.world.cities[1].realm_id.as_deref(), Some("r1"));
    let b2 = s.world.residents.iter().find(|r| r.id == "b2").unwrap();
    assert_eq!((b2.owner.as_deref(), b2.city_id.as_deref()), (Some("r1"), Some("c2")));
    assert_eq!(s.world.demands, vec![]);
    assert_eq!(s.whats(7), vec!["sent", "accepted"]);
    assert_eq!(s.whats(8), vec!["received", "accepted"]);
    let events = serde_json::to_value(&s.world.events).unwrap();
    assert!(events.as_array().unwrap().iter().all(|e| e["kind"] != "cityCaptured"));
    assert_eq!(check_invariants(&s.world, &s.terrain, &world_invariants()), vec![]);
}

#[test]
fn accepting_a_city_costs_no_standing_and_is_no_crime() {
    let (mut s, id) = demanded();
    s.order(&tobin(), json!({ "kind": "acceptDemand", "demandId": id }));
    for _ in 0..3 {
        s.step();
    }
    assert_eq!(s.world.crimes, vec![]);
    assert_eq!(s.world.standings, vec![]);
}

#[test]
fn a_city_already_gone_is_refused_and_the_demand_stays_to_decline() {
    let (mut s, id) = demanded();
    s.world.cities[1].realm_id = Some("r3".into());
    let accept = json!({ "kind": "acceptDemand", "demandId": id });
    refused(s.order(&tobin(), accept.clone()), "Ashford is no longer yours");
    assert_eq!(s.world.cities[1].realm_id.as_deref(), Some("r3"));
    assert_eq!(s.world.demands.len(), 1);
    s.world.cities.retain(|c| c.id != "c2");
    refused(s.order(&tobin(), accept), "no longer yours");
    assert_eq!(s.order(&tobin(), json!({ "kind": "declineDemand", "demandId": id })), None);
    assert_eq!(s.world.demands, vec![]);
}

#[test]
fn the_first_of_two_demands_accepted_in_one_tick_gets_the_city() {
    let (mut s, id) = demanded();
    s.world.last_seen.insert(9, vec![c2_seen("Ashford", Some("r2"))]);
    assert_eq!(s.order(&wren(), city_demand()), None);
    let other = s.world.demands.iter().find(|d| d.id != id).unwrap().id.clone();
    s.queue.receive(
        &s.world,
        &tobin(),
        &json!("a"),
        &json!({ "kind": "acceptDemand", "demandId": id }),
    );
    s.queue.receive(
        &s.world,
        &tobin(),
        &json!("b"),
        &json!({ "kind": "acceptDemand", "demandId": other }),
    );
    s.queue.apply_all(&mut s.world);
    assert_eq!(s.world.cities[1].realm_id.as_deref(), Some("r1"));
    assert_eq!(s.world.demands.iter().map(|d| d.id.clone()).collect::<Vec<_>>(), vec![other]);
    assert_eq!(s.whats(9), vec!["sent"]);
}

#[test]
fn a_demand_lapses_at_its_deadline_and_says_so_to_both() {
    let mut s = setup();
    s.order(&mara(), with(city_demand(), "days", json!(1)));
    let deadline = s.world.demands[0].deadline;
    s.world.tick = deadline as u64 - 1;
    step_demands(&mut s.world);
    assert_eq!(s.world.demands.len(), 1);
    assert_eq!(s.sound(), Vec::<String>::new());
    s.world.tick = deadline as u64;
    step_demands(&mut s.world);
    assert_eq!(s.world.demands, vec![]);
    assert_eq!(s.whats(7), vec!["sent", "lapsed"]);
    assert_eq!(s.whats(8), vec!["received", "lapsed"]);
    assert_eq!(s.sound(), Vec::<String>::new());
}

#[test]
fn a_demand_lapses_as_the_world_ticks_on() {
    let mut s = setup();
    s.order(&mara(), with(goods_demand(), "days", json!(1)));
    s.world.tick = s.world.demands[0].deadline as u64 - 2;
    s.step();
    assert_eq!(s.world.demands.len(), 1);
    s.step();
    assert_eq!(s.world.demands, vec![]);
    assert_eq!(s.sound(), Vec::<String>::new());
    let id = "demand-gone";
    refused(s.order(&tobin(), json!({ "kind": "acceptDemand", "demandId": id })), "no such");
}

#[test]
fn a_demand_lapses_when_a_sides_leader_dies_telling_both_which_side() {
    let mut s = setup();
    s.order(&mara(), goods_demand());
    crate::survival::die_all(&mut s.world, &["b1".to_string()], DeathCause::Killed, SIZE, None);
    let realms: Vec<&str> = s.world.realms.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(realms, vec!["r1", "r3"]);
    assert_eq!(s.world.demands, vec![]);
    let to_mara = s.events(7).pop().unwrap();
    assert_eq!(
        (to_mara["what"].as_str(), to_mara["other"].as_str(), to_mara["leaderDied"].as_str()),
        (Some("lapsed"), Some("Tobin"), Some("receiver"))
    );
    let to_tobin = s.events(8).pop().unwrap();
    assert_eq!(to_tobin["leaderDied"], "receiver");
    s.step();
    assert_eq!(s.sound(), Vec::<String>::new());
}

fn demand(world: &WorldState) -> Demand {
    let tick = world.tick as f64;
    Demand {
        id: "d1".into(),
        from_id: "r1".into(),
        to_id: "r2".into(),
        terms: DemandTerms::Goods { goods: [(Good::Food, 1.0)].into_iter().collect() },
        note: "Food".into(),
        sent_at: tick,
        deadline: tick + 10.0,
    }
}

#[test]
fn demands_sound_passes_a_sound_demand() {
    let mut s = setup();
    let d = demand(&s.world);
    s.world.demands.push(d);
    assert_eq!(s.sound(), Vec::<String>::new());
}

#[test]
fn demands_sound_catches_parties_that_are_gone_or_the_same() {
    let mut s = setup();
    let d = demand(&s.world);
    s.world.demands.push(Demand { from_id: "gone".into(), ..d.clone() });
    s.world.demands.push(Demand { id: "d2".into(), to_id: "r1".into(), ..d });
    let all = s.sound().join(",");
    assert!(all.contains("realm gone, which does not exist"), "{all}");
    assert!(all.contains("d2 is sent to its own sender"), "{all}");
}

#[test]
fn demands_sound_catches_an_open_demand_whose_deadline_doesnt_lie_ahead() {
    let mut s = setup();
    s.world.tick = 50;
    let d = demand(&s.world);
    s.world.demands.push(Demand { deadline: 50.0, ..d });
    assert!(s.sound().join(",").contains("not ahead of 50"));
}

#[test]
fn demands_sound_catches_a_note_and_terms_the_order_wouldnt_take_and_a_broken_limit() {
    let mut s = setup();
    let d = demand(&s.world);
    let long = "x".repeat(DEMAND_NOTE_MAX_LENGTH as usize + 1);
    s.world.demands.push(Demand { note: long, ..d.clone() });
    s.world.demands.push(Demand {
        id: "d2".into(),
        terms: DemandTerms::Goods { goods: Stock::new() },
        ..d
    });
    let tick = s.world.tick as f64;
    s.world.realms[0].demands_sent_at = Some(vec![tick; DEMANDS_PER_GAME_DAY as usize + 1]);
    let all = s.sound().join(",");
    assert!(all.contains("d1 has a note"), "{all}");
    assert!(all.contains("d2 asks for no goods"), "{all}");
    assert!(all.contains("realm r1 sent more"), "{all}");
}
