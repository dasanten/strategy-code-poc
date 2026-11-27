use std::path::{Path, PathBuf};

use csp_shared::world::{ResidentOrder, WorldState};

use super::*;
use crate::random_orders::random_run_with;
use crate::test_world::two_realms_world;

/// The map of the random run's tests (`random_orders/tests.rs`).
const SIZE: i32 = 128;

/// The replay files of the suite.
fn replays() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/src/random_orders/replays"))
}

/// The example replay, made from [`walkers_leave_a_stray_hall`].
fn example() -> PathBuf {
    replays().join("example-stray-hall.json")
}

/// A rule broken on purpose, in the tests only: while residents of two realms both walk, a
/// town hall of no city appears (`cities-from-buildings`: "makes no city"). Two orders break it, of
/// residents of each realm.
fn walkers_leave_a_stray_hall(world: &mut WorldState) {
    let mut walking_realms: Vec<&str> = world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::WalkTo(_))))
        .filter_map(|r| r.owner.as_deref())
        .collect();
    walking_realms.sort_unstable();
    walking_realms.dedup();
    if walking_realms.len() < 2 || world.buildings.iter().any(|b| b.id == "stray-hall") {
        return;
    }
    let hall = world.buildings.iter().find(|b| b.id == world.cities[0].town_hall_id);
    let mut hall = hall.cloned().expect("a town hall");
    hall.id = "stray-hall".into();
    hall.city_id = None;
    hall.x += 40.0;
    world.buildings.push(hall);
}

fn broken_run(seed: u64) -> Box<Failure> {
    let (mut world, terrain) = two_realms_world(SIZE);
    random_run_with(&mut world, terrain, seed, 75, &mut walkers_leave_a_stray_hall)
        .expect_err("the broken rule breaks the run")
}

#[test]
fn smallest_keeps_only_what_breaks() {
    let items: Vec<u32> = (0..100).collect();
    let mut tries = 0;
    let kept = smallest(items, &mut |xs| {
        tries += 1;
        xs.contains(&17) && xs.contains(&63)
    });
    assert_eq!(kept, vec![17, 63]);
    assert!(tries < 100, "{tries} tries for two of 100");
    assert_eq!(smallest(vec![1, 2, 3], &mut |_| true), Vec::<u32>::new());
}

/// One test, as shrinking takes a second or two: what it finds, and what it prints and writes.
#[test]
fn a_failure_shrinks_to_the_orders_that_break_it_and_prints_them() {
    let failure = broken_run(1);
    let rule = &mut walkers_leave_a_stray_hall;
    let text = report(&failure, "twoRealms", SIZE, rule);
    assert!(text.contains("random-order run of seed 1 broke at tick"), "{text}");
    assert!(text.contains("stray-hall makes no city"), "{text}");
    assert!(text.contains("to 2 over"), "{text}");
    assert_eq!(text.matches(r#"{"kind":"walkTo""#).count(), 2, "{text}");
    let path = text.lines().find_map(|l| l.strip_prefix("replay file: ")).expect("a file");
    let shrunk = Replay::read(Path::new(path));
    assert_eq!(shrunk.seed, 1);

    let walks = |r: &Replay| r.orders.iter().filter(|s| s.order["kind"] == "walkTo").count();
    assert_eq!(shrunk.orders.len(), 2, "{shrunk:#?}");
    assert_eq!(walks(&shrunk), 2, "two walks, one of each realm: {shrunk:#?}");
    assert!(shrunk.ticks < failure.tick, "ticks dropped too: {} of {}", shrunk.ticks, failure.tick);
    let name = "cities-from-buildings";
    assert!(matches!(&shrunk.broke, Broken::Invariant { name: n, .. } if n == name), "{text}");
    let again = replay(&shrunk, rule).expect_err("the shrunk replay breaks");
    assert!(shrunk.broke.is_broken_by(&again), "{again}");
    assert_eq!(again.tick - shrunk.start().0.tick, shrunk.ticks, "it breaks on its last tick");
    for i in 0..shrunk.orders.len() {
        let mut less = shrunk.clone();
        less.orders.remove(i);
        assert!(replay(&less, rule).is_ok(), "order {i} is needed");
    }
    assert!(replay(&shrunk, &mut |_| {}).is_ok(), "the orders break nothing on their own");
}

#[test]
fn the_example_replay_breaks_the_same_way() {
    let example = Replay::read(&example());
    let failure = replay(&example, &mut walkers_leave_a_stray_hall)
        .expect_err("the example breaks with its rule broken (if not, the world or the orders changed: write it again from `a_failure_shrinks_to_the_orders_that_break_it_and_prints_them`'s file)");
    assert!(example.broke.is_broken_by(&failure), "{failure}");
    assert!(failure.to_string().contains("stray-hall makes no city"), "{failure}");
}

#[test]
fn every_replay_keeps_the_invariants() {
    let mut files: Vec<PathBuf> = std::fs::read_dir(replays())
        .expect("the replays are in git")
        .map(|e| e.expect("a replay file").path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(files.contains(&example()), "{files:?}");
    for file in files {
        let r = Replay::read(&file);
        if let Err(f) = replay(&r, &mut |_| {}) {
            panic!("the replay {} breaks again:\n{f}", file.display());
        }
    }
}

#[test]
fn a_replay_file_reads_back_as_written() {
    let r = Replay {
        note: Some("bug #1".into()),
        world: "twoRealms".into(),
        size: SIZE,
        seed: 9,
        ticks: 3,
        broke: Broken::Panic { message: "tick panicked: index 4".into() },
        orders: vec![Step {
            tick: 1,
            user_id: 2,
            order: serde_json::json!({ "kind": "walkTo", "residentId": "r1", "x": 3, "y": 4 }),
        }],
    };
    let text = serde_json::to_string(&r).expect("data");
    assert!(text.contains(r#""userId":2"#) && text.contains(r#""broke":{"panic""#), "{text}");
    assert_eq!(serde_json::from_str::<Replay>(&text).expect("reads back"), r);
}
