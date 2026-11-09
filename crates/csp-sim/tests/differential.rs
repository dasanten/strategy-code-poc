//! The differential run (T86.14, ADR 0030): the stepped-world fixtures reproduced tick for tick
//! from their `-0` world by the Rust `step_world`, with an unhurried walking (path searches run to
//! the end within the tick, as the dumper's `UnhurriedWalking`), compared as parsed JSON.

mod common;

use std::sync::Arc;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use csp_sim::tick::{Scratch, Walk};
use csp_sim::walking::Walking;
use csp_sim::world::step_world;

use common::{first_difference, normalised, read_json};

/// Standard base64, as `Buffer.toString('base64')` writes it.
fn base64(text: &str) -> Vec<u8> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => panic!("not base64: {c}"),
    };
    let bytes: Vec<u8> = text.bytes().filter(|c| *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, c)| n | u32::from(value(*c)) << (18 - 6 * i));
        out.extend_from_slice(&n.to_be_bytes()[1..chunk.len()]);
    }
    out
}

/// `UnhurriedWalking` of the dumper: path searches never run out of time.
struct Unhurried(Walking);

impl Walk for Unhurried {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.0.request_steps(world, scratch, f64::INFINITY);
        self.0.resolve(world, scratch, &steps);
        steps.len()
    }
}

fn load(name: &str) -> (WorldState, Arc<TerrainMap>) {
    let mut file = read_json(&format!("worlds/{name}.json"));
    let t = &file["terrain"];
    let terrain = TerrainMap {
        size: t["size"].as_i64().unwrap() as i32,
        tiles: base64(t["tiles"].as_str().unwrap()),
    };
    let world = serde_json::from_value(file["world"].take()).unwrap();
    (world, Arc::new(terrain))
}

/// Steps `name-0` to each of `ticks` and compares with `name-<tick>`; the first difference, if any.
fn differential(name: &str, ticks: &[u64]) -> Option<String> {
    let (mut world, terrain) = load(&format!("{name}-0"));
    let mut walking = Unhurried(Walking::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for &at in ticks {
        while world.tick < at {
            step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        }
        let want = normalised(&read_json(&format!("worlds/{name}-{at}.json"))["world"]);
        let got = normalised(&serde_json::to_value(&world).unwrap());
        if let Some(d) = first_difference(&want, &got, "world") {
            return Some(format!("{name} at tick {at}: {d}"));
        }
    }
    None
}

#[test]
fn the_village_steps_as_the_typescript_did() {
    assert_eq!(differential("village", &[1, 60, 1440]), None);
}

/// The village's long run, a game week: about 5 s alone and 8 s on a busy machine (2026-11-09),
/// over the 5 s a test may take, so it stays out of the default suite with the HQ's.
#[test]
#[ignore = "5 to 8 s: the village's NPC default scripts over a game week"]
fn the_village_steps_as_the_typescript_did_over_a_game_week() {
    assert_eq!(differential("village", &[10080]), None);
}

#[test]
fn the_trade_org_hq_steps_as_the_typescript_did() {
    assert_eq!(differential("hq", &[1, 60]), None);
}

/// The HQ's long run, a game week: 25 to 40 s depending on the machine's load (2026-11-09), most
/// of it the NPC default scripts, so it stays out of the default suite until they are faster.
/// Run it with `cargo nextest run -p csp-sim --run-ignored only`.
#[test]
#[ignore = "25 to 40 s: the HQ's NPC default scripts over a game week"]
fn the_trade_org_hq_steps_as_the_typescript_did_over_a_game_week() {
    assert_eq!(differential("hq", &[1440, 10080]), None);
}
