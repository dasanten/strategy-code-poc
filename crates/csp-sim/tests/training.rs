//! `apps/server/src/training.test.ts`, ported (T86.6). Left for the tickets whose parts they need:
//! "refills from Food on the ground's tile" (`refillSource`, T86.3), `training in scripts` and
//! `the Train default` (T86.12), `trainees sound` and the invariant checks of the long run
//! (T86.13). The tests' `step` also runs the default scripts, which none of these give.

mod build_common;

use build_common::*;
use csp_shared::balance::{
    trained_cap, SKILL_MAX, TRAINING_GROUND_MAX_TRAINEES, TRAIN_SKILL_FACTOR, TRAIN_STAT_PER_TICK,
    WORK_SKILL_PER_DAY,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{
    BuildingKind, ConstructionSite, ResidentOrder, SkillName, Stat, StatName, Stock,
    TrainingSubject, WorldState,
};
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::balance::skill_of;
use csp_sim::queries::building::trainees_of;
use csp_sim::queries::residents::stat_value;
use csp_sim::world::create_world;
use serde_json::{json, Value};

const WEEK: f64 = 7.0 * TICKS_PER_GAME_DAY;

fn me() -> OrderSender {
    player(7)
}

fn add(world: &mut WorldState, id: &str, name: &str, x: f64, y: f64) {
    let i = resident(world, id, x, y);
    let r = &mut world.residents[i];
    r.name = name.into();
    r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
    r.lifespan = 60.0;
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.stats.intellect = Stat { base: 10.0, trained: 0.0 };
    r.skills.clear();
}

/// Realm r1 (Player 7) with a finished training ground g1 on (3, 3) to (5, 5); on it the teacher
/// Tea (t1, Strength 15) and the trainees Ann (a1), Bo (a2) and Cy (a3), Strength and Intellect
/// 10. Dee (a4) stands on it too.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let terrain = plains(16);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "t1"));
    world.buildings.push(building("g1", BuildingKind::TrainingGround, 3.0, 3.0));
    add(&mut world, "t1", "Tea", 4.0, 4.0);
    world.residents[0].stats.strength = Stat { base: 15.0, trained: 0.0 };
    add(&mut world, "a1", "Ann", 3.0, 3.0);
    add(&mut world, "a2", "Bo", 5.0, 5.0);
    add(&mut world, "a3", "Cy", 3.0, 5.0);
    add(&mut world, "a4", "Dee", 5.0, 3.0);
    (world, terrain, Orders::default())
}

/// Enough more residents on the ground that one more wants to train than it has room for;
/// answers the ids of all who could train, the one too many last.
fn crowd(world: &mut WorldState) -> Vec<String> {
    let mut ids: Vec<String> = ["a1", "a2", "a3", "a4"].map(String::from).to_vec();
    while ids.len() as f64 <= TRAINING_GROUND_MAX_TRAINEES {
        let id = format!("a{}", ids.len() + 1);
        add(world, &id, &id, 4.0, 3.0);
        ids.push(id);
    }
    ids
}

fn send(world: &mut WorldState, t: &TerrainMap, orders: &mut Orders, o: Value) -> String {
    let answer = orders.receive(world, &me(), o, t);
    orders.apply_all(world, t);
    answer.err().unwrap_or_else(|| "ack".into())
}

fn train(resident_id: &str, building_id: &str) -> Value {
    json!({ "kind": "train", "residentId": resident_id, "buildingId": building_id })
}

fn teach(subject: &str) -> Value {
    json!({ "kind": "teach", "residentId": "t1", "buildingId": "g1", "subject": subject })
}

fn trained(world: &mut WorldState, id: &str) -> f64 {
    at(world, id).stats.strength.trained
}

fn strength(world: &mut WorldState, id: &str) -> f64 {
    let tick = world.tick as f64;
    stat_value(at(world, id), StatName::Strength, tick)
}

fn learning(world: &mut WorldState, id: &str) -> Option<Option<TrainingSubject>> {
    match &at(world, id).order {
        Some(ResidentOrder::Train(o)) => Some(o.learning),
        _ => None,
    }
}

fn near(got: f64, want: f64, digits: i32) {
    assert!((got - want).abs() < 10f64.powi(-digits) / 2.0, "{got} is not close to {want}");
}

#[test]
fn three_trainees_gain_over_a_game_week_at_the_pace_their_intellect_sets() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "a3").stats.intellect = Stat { base: 15.0, trained: 0.0 };
    assert_eq!(send(&mut world, &t, &mut orders, teach("strength")), "ack");
    for id in ["a1", "a2", "a3"] {
        assert_eq!(send(&mut world, &t, &mut orders, train(id, "g1")), "ack");
    }
    assert_eq!(
        serde_json::to_value(&at(&mut world, "a1").order).unwrap(),
        json!({ "kind": "train", "buildingId": "g1", "learning": "strength" })
    );
    run(&mut world, &t, WEEK as usize);
    let week = WEEK * TRAIN_STAT_PER_TICK;
    near(trained(&mut world, "a1"), week, 6);
    near(trained(&mut world, "a2"), week, 6);
    // Cy's Intellect of 15 learns half again as fast.
    near(trained(&mut world, "a3"), week * 1.5, 6);
    // The teacher gains nothing.
    assert_eq!(trained(&mut world, "t1"), 0.0);
    assert_eq!(learning(&mut world, "a1"), Some(Some(TrainingSubject::Strength)));
}

#[test]
fn a_trainee_stops_at_their_cap_and_at_the_teachers_value_and_waits() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "a1").stats.strength =
        Stat { base: 8.0, trained: trained_cap(8.0) - 100.0 * TRAIN_STAT_PER_TICK };
    at(&mut world, "a2").stats.strength = Stat { base: 14.0, trained: 0.0 };
    at(&mut world, "t1").stats.strength = Stat { base: 14.0, trained: 300.0 * TRAIN_STAT_PER_TICK };
    send(&mut world, &t, &mut orders, teach("strength"));
    send(&mut world, &t, &mut orders, train("a1", "g1"));
    send(&mut world, &t, &mut orders, train("a2", "g1"));
    run(&mut world, &t, 500);
    assert_eq!(trained(&mut world, "a1"), trained_cap(8.0));
    near(strength(&mut world, "a2"), strength(&mut world, "t1"), 9);
    assert_eq!(learning(&mut world, "a1"), Some(None));
    assert_eq!(learning(&mut world, "a2"), Some(None));
    run(&mut world, &t, 100);
    assert_eq!(trained(&mut world, "a1"), trained_cap(8.0));
    assert!(strength(&mut world, "a2") <= strength(&mut world, "t1") + 1e-9);
}

#[test]
fn teaches_nothing_without_a_teacher_nor_a_stronger_trainee() {
    let (mut world, t, mut orders) = setup();
    send(&mut world, &t, &mut orders, train("a1", "g1"));
    run(&mut world, &t, 100);
    assert_eq!(trained(&mut world, "a1"), 0.0);
    assert_eq!(learning(&mut world, "a1"), Some(None));
    at(&mut world, "t1").stats.strength = Stat { base: 8.0, trained: 0.0 };
    send(&mut world, &t, &mut orders, teach("strength"));
    send(&mut world, &t, &mut orders, train("a2", "g1"));
    run(&mut world, &t, 100);
    assert_eq!(trained(&mut world, "a1"), 0.0);
    assert_eq!(trained(&mut world, "a2"), 0.0);
}

#[test]
fn trains_a_skill_toward_the_teachers_faster_than_by_doing_never_past_its_maximum() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "t1").skills = [(SkillName::Mining, 50.0)].into_iter().collect();
    send(&mut world, &t, &mut orders, teach("mining"));
    send(&mut world, &t, &mut orders, train("a1", "g1"));
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize);
    near(
        skill_of(at(&mut world, "a1"), SkillName::Mining),
        WORK_SKILL_PER_DAY * TRAIN_SKILL_FACTOR,
        6,
    );
    // A veteran past Combat's most takes a recruit only up to it.
    at(&mut world, "t1").skills =
        [(SkillName::Combat, SKILL_MAX.combat + 10.0)].into_iter().collect();
    at(&mut world, "a2").skills =
        [(SkillName::Combat, SKILL_MAX.combat - 0.001)].into_iter().collect();
    send(&mut world, &t, &mut orders, teach("combat"));
    send(&mut world, &t, &mut orders, train("a2", "g1"));
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize);
    assert_eq!(skill_of(at(&mut world, "a2"), SkillName::Combat), SKILL_MAX.combat);
    assert!(skill_of(at(&mut world, "a1"), SkillName::Combat) > 0.0);
    assert_eq!(learning(&mut world, "a2"), Some(None));
}

#[test]
fn is_refused_for_a_child_off_the_ground_at_a_site_and_at_a_full_ground() {
    let (mut world, t, mut orders) = setup();
    let tick = world.tick as f64;
    at(&mut world, "a1").born_at = tick;
    assert_eq!(send(&mut world, &t, &mut orders, train("a1", "g1")), "children can’t train");
    at(&mut world, "a2").x = 9.0;
    assert_eq!(
        send(&mut world, &t, &mut orders, train("a2", "g1")),
        "there is no training ground here"
    );
    at(&mut world, "a2").x = 5.0;
    world.buildings.push(building("f1", BuildingKind::Farm, 8.0, 5.0));
    assert_eq!(
        send(&mut world, &t, &mut orders, train("a2", "f1")),
        "stand on the training ground to train there"
    );
    world.buildings[0].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert_eq!(
        send(&mut world, &t, &mut orders, train("a2", "g1")),
        "it is still a construction site"
    );
    world.buildings[0].site = None;
    assert_eq!(send(&mut world, &t, &mut orders, train("a2", "g1")), "ack");
    assert_eq!(send(&mut world, &t, &mut orders, train("a2", "g1")), "already training here");
    assert!(at(&mut world, "a1").order.is_none());
}

#[test]
fn refuses_one_too_many_at_a_full_ground_also_within_one_tick() {
    let (mut world, t, mut orders) = setup();
    let ids = crowd(&mut world);
    let room = &ids[..TRAINING_GROUND_MAX_TRAINEES as usize];
    for id in room {
        assert_eq!(send(&mut world, &t, &mut orders, train(id, "g1")), "ack");
    }
    let last = ids.last().unwrap();
    assert_eq!(
        send(&mut world, &t, &mut orders, train(last, "g1")),
        format!("the training ground has room for {TRAINING_GROUND_MAX_TRAINEES} trainees")
    );
    assert!(at(&mut world, last).order.is_none());
    let (mut fresh, t2, mut fresh_orders) = setup();
    for id in crowd(&mut fresh) {
        assert_eq!(fresh_orders.receive(&fresh, &me(), train(&id, "g1"), &t2), Ok(()));
    }
    fresh_orders.apply_all(&mut fresh, &t2);
    let on: Vec<&str> = trainees_of(&fresh.buildings[0], &fresh.residents, 5760)
        .iter()
        .map(|r| r.id.as_str())
        .collect();
    assert_eq!(on, room);
    assert_eq!(
        trainees_of(&world.buildings[0], &world.residents, 5760).len() as f64,
        TRAINING_GROUND_MAX_TRAINEES
    );
}

#[test]
fn is_refused_for_another_realms_resident_and_for_a_citys_sender_not_its_own() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "a1").owner = Some("r2".into());
    assert_eq!(send(&mut world, &t, &mut orders, train("a1", "g1")), "not one of your residents");
    let npc = OrderSender { npc_city_id: Some("c9".into()), ..OrderSender::player(0, "Elm") };
    assert!(orders.receive(&world, &npc, train("a2", "g1"), &t).is_err());
}

#[test]
fn ends_on_walking_off_the_ground_or_when_it_is_gone() {
    let (mut world, t, mut orders) = setup();
    send(&mut world, &t, &mut orders, train("a1", "g1"));
    send(&mut world, &t, &mut orders, train("a2", "g1"));
    at(&mut world, "a1").x = 9.0;
    run(&mut world, &t, 1);
    assert!(at(&mut world, "a1").order.is_none());
    assert!(learning(&mut world, "a2").is_some());
    world.buildings.clear();
    run(&mut world, &t, 1);
    assert!(at(&mut world, "a2").order.is_none());
}

#[test]
fn keeps_training_over_a_long_run_the_teacher_switching_subjects() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "t1").skills = [(SkillName::Combat, 15.0)].into_iter().collect();
    at(&mut world, "a1").stats.strength.trained = trained_cap(10.0) - 0.01;
    at(&mut world, "a2").skills = [(SkillName::Combat, 14.9)].into_iter().collect();
    at(&mut world, "a3").stats.intellect = Stat { base: 15.0, trained: 7.0 };
    send(&mut world, &t, &mut orders, teach("strength"));
    for id in ["a1", "a2", "a3"] {
        send(&mut world, &t, &mut orders, train(id, "g1"));
    }
    for day in 0..6 {
        if day == 3 {
            send(&mut world, &t, &mut orders, teach("combat"));
        }
        for _ in 0..4 {
            run(&mut world, &t, TICKS_PER_GAME_DAY as usize / 4);
            assert_sound(&world, &t);
        }
    }
    assert_eq!(trained(&mut world, "a1"), trained_cap(10.0));
    assert_eq!(skill_of(at(&mut world, "a2"), SkillName::Combat), 15.0);
    assert!(skill_of(at(&mut world, "a3"), SkillName::Combat) > 0.0);
    assert_eq!(trained(&mut world, "t1"), 0.0);
}
