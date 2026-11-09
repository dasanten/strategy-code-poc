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
    assert_eq!(differential("village", &[1, 60, 1440, 10080]), None);
}

#[test]
fn the_trade_org_hq_steps_as_the_typescript_did() {
    assert_eq!(differential("hq", &[1, 60, 1440, 10080]), None);
}

#[test]
#[ignore]
fn debug_village_10080() {
    let (mut world, terrain) = load("village-0");
    let mut walking = Unhurried(Walking::new(terrain.clone()));
    let mut scratch = Scratch::default();
    while world.tick < 10080 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    }
    let want = normalised(&read_json("worlds/village-10080.json")["world"]);
    let got = normalised(&serde_json::to_value(&world).unwrap());
    for (k, v) in want.as_object().unwrap() {
        let g = &got[k];
        if v != g {
            let ids = |x: &serde_json::Value| -> Vec<String> {
                x.as_array()
                    .map(|a| {
                        a.iter()
                            .map(|e| e.get("id").map_or(e.to_string(), |i| i.to_string()))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            println!("DIFF {k}: want {} got {}", ids(v).join(" "), ids(g).join(" "));
            println!("  first: {:?}", first_difference(v, g, k));
        }
    }
}

#[test]
#[ignore]
fn debug_village_ids() {
    let (mut world, terrain) = load("village-0");
    let mut walking = Unhurried(Walking::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let mut last = world.next_id;
    while world.tick < 3888 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if world.tick >= 3878 && world.tick <= 3887 {
            if world.tick == 3885 {
                for r in world.residents.iter().filter(|x| {
                    x.script.as_ref().is_some_and(|s| {
                        s.memory.get("workplaceId") == Some(&serde_json::json!("b125"))
                    })
                }) {
                    println!(
                        "W {} {:?} {:?} {:?} {} {} {:?}",
                        r.id,
                        r.owner,
                        r.city_id,
                        r.order.as_ref().map(|o| serde_json::to_value(o).unwrap()["kind"].clone()),
                        r.x,
                        r.y,
                        r.down_until
                    );
                }
                for id in ["r123", "r124"] {
                    let r = world.residents.iter().find(|r| r.id == id).unwrap();
                    println!(
                        "FIT {} {} carried={} cap={} city={:?} owner={:?}",
                        id,
                        csp_sim::queries::goods::units_that_fit(
                            r,
                            csp_shared::world::Good::Wood,
                            world.tick as f64
                        ),
                        serde_json::to_string(&r.carried).unwrap(),
                        csp_sim::queries::balance::carry_capacity(r, world.tick as f64),
                        r.city_id,
                        r.owner
                    );
                }
                let st: Vec<_> = world
                    .buildings
                    .iter()
                    .filter(|b| b.kind == csp_shared::world::BuildingKind::Storage)
                    .map(|b| (b.id.clone(), b.city_id.clone(), b.site.is_some()))
                    .collect();
                println!(
                    "STORAGES {:?} seed={} rnd={}",
                    st,
                    world.seed,
                    csp_sim::script_bindings::tick_random(&world)
                );
            }
            let r = world.residents.iter().find(|r| r.id == "r123").unwrap();
            println!(
                "R {} {} {} {} {} {}",
                world.tick,
                r.x,
                r.y,
                serde_json::to_string(&r.carried).unwrap(),
                serde_json::to_string(&r.order).unwrap().chars().take(150).collect::<String>(),
                serde_json::to_string(&r.script.as_ref().map(|s| &s.memory)).unwrap()
            );
        }
        if world.next_id != last {
            println!("IDS {} {}", world.tick, world.next_id);
            last = world.next_id;
        }
    }
}
