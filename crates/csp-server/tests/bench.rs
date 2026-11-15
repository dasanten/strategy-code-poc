//! The benchmarks build their worlds and step them (`bench-world`, `bench-sim`; T87.8).
use csp_server::bench::{
    bench_sim, bench_world, hq, save_from, village, villages, Scene, SceneName,
};
use csp_server::db::open_db;
use csp_server::saves::{save_terrain, save_world};
use csp_sim::terrain_gen::generate_terrain;
use csp_sim::tick::TICK_PHASES;
use csp_sim::world::create_world;

fn lines(run: impl FnOnce(&mut dyn FnMut(&str))) -> Vec<String> {
    let mut lines = Vec::new();
    run(&mut |l: &str| lines.push(l.to_string()));
    lines
}

#[test]
fn bench_world_times_every_stage_and_prints_both_tables() {
    let mut made = None;
    let out = lines(|out| made = Some(bench_world(64, 1, out)));
    let made = made.unwrap();
    fn stages(s: &[(&'static str, f64)]) -> Vec<&'static str> {
        s.iter().map(|(n, _)| *n).collect()
    }
    assert_eq!(
        stages(&made.terrain_stages),
        ["mainland", "lakes", "islands", "relief", "forest", "joining", "regions"]
    );
    assert_eq!(
        stages(&made.world_stages),
        ["nodes", "land", "HQ", "trading posts", "NPC cities", "caravans"]
    );
    assert!(out[0].starts_with("world 64x64, seed 1: "), "{}", out[0]);
    assert!(out.iter().any(|l| l.starts_with("| generateTerrain stage |")));
    assert!(out.iter().any(|l| l.starts_with("| generateWorld stage ")));
    assert!(out.last().unwrap().starts_with(&format!("made: {} nodes, ", made.world.nodes.len())));
}

/// Steps a scene a few ticks and checks the table `bench_sim` prints.
fn steps_a_few_ticks(name: SceneName, scene: Scene) {
    let size = scene.terrain.size;
    let start = scene.world.tick;
    assert!(!scene.world.cities.is_empty(), "the {} scene has its cities", name.name());
    let mut ran = None;
    let out = lines(|out| ran = Some(bench_sim(name, scene, 3, out)));
    let ran = ran.unwrap();
    assert_eq!(ran.totals.len(), 3);
    assert_eq!(ran.phases.len(), TICK_PHASES.len());
    assert!(ran.phases.iter().all(|(_, xs)| xs.len() == 3));
    let head = format!("sim {}, 3 ticks, invariants off, {size}x{size} map, ", name.name());
    assert!(out[0].starts_with(&head), "{}", out[0]);
    // One row per phase, the total, the header and the rule.
    let rows = out.iter().filter(|l| l.starts_with('|')).count();
    assert_eq!(rows, TICK_PHASES.len() + 3);
    assert!(out.iter().any(|l| l.starts_with("| tick (total) |")));
    assert_eq!(start, 0);
}

// bench-ts.test.ts: sim village 10 runs and prints every phase
#[test]
fn the_village_scene_builds_and_steps_a_few_ticks() {
    steps_a_few_ticks(SceneName::Village, village());
}

/// Four villages rather than the bench's 60, which take too long in a debug build.
#[test]
fn the_villages_scene_builds_and_steps_a_few_ticks() {
    let scene = villages(4);
    assert_eq!(scene.world.cities.len(), 4);
    steps_a_few_ticks(SceneName::Villages, scene);
}

#[test]
fn the_hq_scene_builds_and_steps_a_few_ticks() {
    steps_a_few_ticks(SceneName::Hq, hq());
}

#[test]
fn the_save_scene_reads_the_newest_save_from_a_copy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("world.db");
    let conn = open_db(&path, None).unwrap();
    let terrain = generate_terrain(5, 64);
    save_terrain(&conn, 5, &terrain).unwrap();
    let mut world = create_world(&terrain, 5);
    world.tick = 42;
    save_world(&conn, &world).unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();

    let scene = save_from(&path).unwrap();
    assert_eq!(scene.world.tick, 42);
    assert_eq!(scene.terrain.size, 64);
    assert_eq!(std::fs::read(&path).unwrap(), before, "the original is left alone");
    let ran = bench_sim(SceneName::Save, scene, 2, &mut |_| {});
    assert_eq!(ran.totals.len(), 2);
}
