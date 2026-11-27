//! `csp-admin new-world` (T117.7, `CONTEXT.md`: Creative mode, Test worlds): a small world by the
//! live generator, into a database of its own, that the server starts on and that runs.
use std::sync::Arc;

use csp_server::db::open_db;
use csp_server::new_world::{
    generate, new_world, parse, Made, NewWorld, DEFAULT_SIZE, MIN_SIZE, USAGE,
};
use csp_server::saves::{latest_save, load_or_create_world, load_terrain};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_sim::invariants::check_all;
use csp_sim::land_sites::{check_on_the_land, LandSites};
use csp_sim::regions::{check_regions, Regions};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;

/// A small world that has it all at the size `new-world` makes without `--size`, with few enough
/// NPC cities (three) for a game day to run in a few seconds.
const SEED: i64 = 5;

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn reads_its_arguments_with_a_default_size_and_a_random_seed() {
    let order = parse(&args(&["--db", "t.db", "--size", "640", "--seed", "9"])).unwrap();
    assert_eq!(order, NewWorld { db: "t.db".into(), size: 640, seed: 9 });
    let order = parse(&args(&["--db", "t.db"])).unwrap();
    assert_eq!(order.size, DEFAULT_SIZE);
    assert!(order.seed > 0);
    assert_eq!(parse(&args(&["--size", "768"])), Err(USAGE.to_owned()), "no --db");
    assert_eq!(parse(&args(&["--db", "t.db", "--big"])), Err(USAGE.to_owned()));
    assert_eq!(parse(&args(&["--db", "t.db", "--seed", "0"])), Err(USAGE.to_owned()));
    for size in ["512", "700", "6000"] {
        let refused = parse(&args(&["--db", "t.db", "--size", size])).unwrap_err();
        assert!(refused.contains(&format!("from {MIN_SIZE}")), "{size}: {refused}");
    }
}

#[test]
fn refuses_a_database_that_exists() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("world.db");
    std::fs::write(&db, b"").unwrap();
    let refused = new_world(&NewWorld { db: db.clone(), size: DEFAULT_SIZE, seed: SEED });
    assert!(refused.unwrap_err().contains("exists"));
    assert_eq!(std::fs::read(&db).unwrap(), b"", "left alone");
}

#[test]
fn a_small_world_has_npc_cities_the_trade_org_and_posts_and_keeps_the_rules() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test-worlds").join("small.db");
    let said = new_world(&NewWorld { db: db.clone(), size: DEFAULT_SIZE, seed: SEED }).unwrap();
    assert!(said.contains("seed 5"), "{said}");

    // The server's way in: the stored terrain and the first save, the world as generated.
    let conn = open_db(&db, None).unwrap();
    let (seed, stored) = load_terrain(&conn).unwrap().expect("terrain stored");
    assert_eq!((seed, stored.size), (SEED, DEFAULT_SIZE));
    assert!(latest_save(&conn).unwrap().is_some());
    let never = |_| panic!("the terrain is stored");
    let never_world = |_: &_, _| panic!("the world is saved");
    let (world, terrain) = load_or_create_world(&conn, never, never_world, 1).unwrap();
    let (_, generated) = generate(DEFAULT_SIZE, SEED);
    assert_eq!(world, generated);

    let made = Made::of(&world);
    assert!(made.whole(), "{made:?}");
    assert!(made.npc_cities >= 2, "{made:?}");
    assert!(made.traders > 0 && made.starting_sites > 0, "{made:?}");
    let regions = check_regions(&terrain, &Regions::of(SEED, &terrain));
    assert!(regions.is_empty(), "{:?}", regions.iter().map(|p| &p.message).collect::<Vec<_>>());
    let land = LandSites::of(&world, &terrain);
    let problems = check_on_the_land(&world, &terrain, &land);
    assert!(problems.is_empty(), "{:?}", problems.iter().map(|p| &p.message).collect::<Vec<_>>());
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn a_small_world_runs_a_game_day_keeping_the_invariants() {
    let (terrain, mut world) = generate(DEFAULT_SIZE, SEED);
    // A game day as the server runs it, the invariants held every three game hours.
    let mut walking = Walking::without_budget(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let people = world.residents.len();
    for t in 1..=TICKS_PER_GAME_DAY as u64 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if t % 180 == 0 {
            assert_eq!(check_all(&world, &terrain), [], "tick {t}");
        }
    }
    assert_eq!(world.tick as f64, TICKS_PER_GAME_DAY);
    assert!(world.residents.len() >= people * 9 / 10, "{people} to {}", world.residents.len());
}

#[test]
fn refuses_a_world_without_room_and_writes_nothing() {
    // The smallest size on a seed whose frontier has no room for the HQ.
    let (_, world) = generate(MIN_SIZE, 5);
    assert!(!Made::of(&world).hq, "seed 5 at {MIN_SIZE} has an HQ after all: pick another");
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("none.db");
    let refused = new_world(&NewWorld { db: db.clone(), size: MIN_SIZE, seed: 5 }).unwrap_err();
    assert!(refused.contains("the Trade Org HQ"), "{refused}");
    assert!(!db.exists());
}
