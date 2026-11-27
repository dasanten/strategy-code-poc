use std::collections::BTreeMap;
use std::sync::LazyLock;

use super::*;
use crate::order_meta::ORDER_METAS;
use crate::test_world::two_realms_world;

/// The map's side of the small world of the tests that need no random world.
const SIZE: i32 = 128;
/// Ticks per fixed seed: the four, run side by side, stay well under 5 s (ADR 0030).
const TICKS: u64 = 75;
/// The fixed seeds of every check.
const SEEDS: [u64; 4] = [1, 2, 3, 4];
/// A generator whose requests are nearly all refused tests little: at least this share is accepted.
const LEAST_ACCEPTED: f64 = 0.1;

/// The runs of the fixed seeds on the random world, side by side, once for all the tests here.
static RUNS: LazyLock<Vec<Result<Outcome, Box<Failure>>>> = LazyLock::new(|| {
    std::thread::scope(|s| {
        let runs: Vec<_> = SEEDS
            .iter()
            .map(|&seed| {
                s.spawn(move || {
                    let (mut world, terrain) = world::random_world();
                    random_run(&mut world, terrain, seed, TICKS)
                })
            })
            .collect();
        runs.into_iter().map(|r| r.join().expect("a run")).collect()
    })
});

/// The run of a fixed seed, failing with its seed, tick and orders when it broke.
fn fixed_seed(seed: u64) -> &'static Outcome {
    let i = SEEDS.iter().position(|s| *s == seed).expect("a fixed seed");
    let outcome = RUNS[i].as_ref().unwrap_or_else(|f| panic!("{f}"));
    eprintln!("{} ({:?})", summary(outcome), outcome.busy);
    let share = outcome.accepted() as f64 / outcome.given.len().max(1) as f64;
    assert!(
        share >= LEAST_ACCEPTED,
        "seed {seed}: only {} of {} requests accepted; the generator's targets are wrong",
        outcome.accepted(),
        outcome.given.len()
    );
    outcome
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

/// The order kinds of the run's registry: the game's (`order_kinds`) and the script orders its
/// host adds.
fn registry() -> Vec<&'static str> {
    let (world, terrain) = two_realms_world(SIZE);
    let users: Vec<u64> = world.realms.iter().map(|r| r.user_id).collect();
    let kinds = run_kinds(Arc::new(terrain), &users).kinds;
    ORDER_METAS.iter().map(|m| m.kind).filter(|k| kinds.contains(k)).collect()
}

#[test]
fn every_order_kind_has_a_generator_entry() {
    let kinds = registry();
    let missing: Vec<&str> =
        kinds.iter().copied().filter(|k| !GENERATORS.iter().any(|(g, _)| g == k)).collect();
    assert!(
        missing.is_empty(),
        "the random-order run never gives {missing:?}: add an entry for each to GENERATORS in \
         crates/csp-sim/src/random_orders/generators.rs (who the request is for and what its \
         fields name; see the entries of kinds like it), and what it needs to the world in \
         random_orders/world.rs"
    );
    let unknown: Vec<&str> =
        GENERATORS.iter().map(|(g, _)| *g).filter(|g| !kinds.contains(g)).collect();
    assert!(unknown.is_empty(), "GENERATORS has entries of no order kind: {unknown:?}");
    let mut names: Vec<&str> = GENERATORS.iter().map(|(g, _)| *g).collect();
    names.sort();
    let before = names.len();
    names.dedup();
    assert_eq!(names.len(), before, "a kind has two entries in GENERATORS");
}

#[test]
fn every_order_kind_is_accepted() {
    let mut reasons: BTreeMap<&str, BTreeMap<String, usize>> = BTreeMap::new();
    let mut accepted: Vec<String> = Vec::new();
    for seed in SEEDS {
        let outcome = fixed_seed(seed);
        accepted.extend(outcome.kinds_accepted());
        for g in &outcome.given {
            if let (Some(kind), Some(why)) = (g.order["kind"].as_str(), &g.refused) {
                let kind = GENERATORS.iter().map(|(k, _)| *k).find(|k| *k == kind);
                if let Some(kind) = kind {
                    *reasons.entry(kind).or_default().entry(why.clone()).or_default() += 1;
                }
            }
        }
    }
    let never: Vec<String> = GENERATORS
        .iter()
        .map(|(k, _)| *k)
        .filter(|k| !accepted.iter().any(|a| a == k))
        .map(|k| {
            let mut why: Vec<(&String, &usize)> = reasons.get(k).into_iter().flatten().collect();
            why.sort_by_key(|(_, n)| std::cmp::Reverse(**n));
            let why: Vec<&String> = why.into_iter().take(2).map(|(w, _)| w).collect();
            format!("{k} (refused: {why:?})")
        })
        .collect();
    assert!(
        never.is_empty(),
        "never accepted over seeds {SEEDS:?}: {never:#?}\nits entry's targets are wrong, or the \
         world lacks what it needs (random_orders/generators.rs, random_orders/world.rs)"
    );
}

#[test]
fn queues_and_default_scripts_run_and_random_orders_interrupt_them() {
    for seed in SEEDS {
        let busy = fixed_seed(seed).busy;
        assert!(busy.queued > 0, "seed {seed}: nobody ran a queue: {busy:?}");
        assert!(busy.scripted > 0, "seed {seed}: nobody ran a script: {busy:?}");
        assert!(busy.interrupted > 0, "seed {seed}: no queue or script was interrupted: {busy:?}");
    }
}

#[test]
fn the_same_seed_gives_the_same_run() {
    let run = || {
        let (mut world, terrain) = world::random_world();
        let outcome = random_run(&mut world, terrain, 7, 30).expect("seed 7 runs");
        let given: Vec<(u64, u64, Value, Option<String>)> =
            outcome.given.into_iter().map(|g| (g.tick, g.user_id, g.order, g.refused)).collect();
        (given, serde_json::to_value(&world).expect("a world saves"))
    };
    let (first, second) = std::thread::scope(|s| {
        let a = s.spawn(run);
        let b = s.spawn(run);
        (a.join().expect("a run"), b.join().expect("a run"))
    });
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
