use super::*;
use crate::test_world::two_realms_world;

/// The map's side: large enough that no city's control box is wider than the map (on 96 tiles
/// seed 1 breaks `territory-sound` at tick 36: bug #1724).
const SIZE: i32 = 128;
/// Ticks per fixed seed: the four together stay well under 5 s (ADR 0030).
const TICKS: u64 = 75;
/// A generator whose requests are nearly all refused tests little: at least this share is accepted.
const LEAST_ACCEPTED: f64 = 0.1;

/// Runs a fixed seed, failing with its seed, tick and orders when it breaks.
fn fixed_seed(seed: u64) {
    let (mut world, terrain) = two_realms_world(SIZE);
    let outcome = random_run(&mut world, terrain, seed, TICKS).unwrap_or_else(|f| panic!("{f}"));
    eprintln!("{} ({:?})", summary(&outcome), outcome.kinds_accepted());
    let share = outcome.accepted() as f64 / outcome.given.len().max(1) as f64;
    assert!(
        share >= LEAST_ACCEPTED,
        "seed {seed}: only {} of {} requests accepted; the generator's targets are wrong",
        outcome.accepted(),
        outcome.given.len()
    );
}

#[test]
fn seed_1_keeps_the_invariants() {
    fixed_seed(1);
}

#[test]
fn seed_2_keeps_the_invariants() {
    fixed_seed(2);
}

#[test]
fn seed_3_keeps_the_invariants() {
    fixed_seed(3);
}

#[test]
fn seed_4_keeps_the_invariants() {
    fixed_seed(4);
}

#[test]
fn the_same_seed_gives_the_same_run() {
    let run = || {
        let (mut world, terrain) = two_realms_world(SIZE);
        let outcome = random_run(&mut world, terrain, 7, 30).expect("seed 7 runs");
        let given: Vec<(u64, u64, Value, Option<String>)> =
            outcome.given.into_iter().map(|g| (g.tick, g.user_id, g.order, g.refused)).collect();
        (given, serde_json::to_value(&world).expect("a world saves"))
    };
    let (first, second) = (run(), run());
    assert!(!first.0.is_empty());
    assert_eq!(first.0, second.0, "the same orders, answered the same");
    assert!(first.1 == second.1, "the same world at the end");
}

#[test]
fn a_failure_names_its_seed_tick_and_orders() {
    let given = |refused: Option<&str>, x| Given {
        tick: 3,
        user_id: 1,
        order: json!({ "kind": "walkTo", "residentId": "r1", "x": x, "y": 2 }),
        refused: refused.map(str::to_string),
    };
    let failure = Failure {
        seed: 42,
        tick: 4,
        broke: Broke::Invariants(vec![InvariantViolation {
            invariant: "down-do-nothing".into(),
            message: "r1 walks while Down".into(),
            entity_ids: vec!["r1".into()],
        }]),
        given: vec![given(None, 5), given(Some("no such resident"), 6)],
    };
    let text = failure.to_string();
    assert!(text.contains("seed 42 broke at tick 4"), "{text}");
    assert!(text.contains("down-do-nothing: r1 walks while Down"), "{text}");
    assert!(text.contains("replay: the same world, seed 42, 4 ticks"), "{text}");
    assert!(text.contains(r#"tick 3 player 1: {"kind":"walkTo","residentId":"r1","x":5,"y":2}"#));
    assert!(!text.contains(r#""x":6"#), "refused orders are left out: {text}");
}

#[test]
fn a_broken_invariant_ends_the_run() {
    let (mut world, terrain) = two_realms_world(SIZE);
    // A second town hall of no city, as a broken rule might leave one.
    let hall = world.buildings.iter().find(|b| b.id == world.cities[0].town_hall_id);
    let mut hall = hall.cloned().expect("a town hall");
    hall.id = "stray-hall".into();
    hall.city_id = None;
    hall.x += 40.0;
    world.buildings.push(hall);
    let failure = random_run(&mut world, terrain, 1, 5).expect_err("the stray hall is found");
    assert_eq!(failure.tick, 1, "{failure}");
    assert!(failure.to_string().contains("stray-hall makes no city"), "{failure}");
}

#[test]
fn draws_are_the_runs_own() {
    let mut a = Draws::new(5);
    let mut b = Draws::new(5);
    let xs: Vec<usize> = (0..20).map(|_| a.below(1000)).collect();
    let ys: Vec<usize> = (0..20).map(|_| b.below(1000)).collect();
    assert_eq!(xs, ys);
    let mut c = Draws::new(6);
    assert_ne!(xs, (0..20).map(|_| c.below(1000)).collect::<Vec<_>>());
    assert!((0..1000).map(|_| a.between(-3, 3)).all(|v| (-3..=3).contains(&v)));
}
