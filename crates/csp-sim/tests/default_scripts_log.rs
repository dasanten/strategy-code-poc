//! `apps/server/src/default-scripts-log.test.ts`, ported (T86.17): the defaults' script log
//! (`CONTEXT.md`: Script log). The game's default scripts log their decisions and turns, such as
//! carrying a load off or getting Food, never every tick.

mod build_common;

use build_common::*;
use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Resident, ResidentOrder, Task, WorldState};
use csp_sim::default_scripts::default_script;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::script_runner::{ScriptHost, ScriptRunner};
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use std::sync::Arc;

const SIZE: i32 = 32;
const SCRIPT: u64 = 1;

/// Mara's realm r1 with city c1 at (14, 10), a lumber camp at (6, 10) and storage s1 at (12, 10).
fn camp_world() -> (WorldState, TerrainMap, Building) {
    let mut terrain = plains(SIZE);
    let (cx, cy) = (6, 10);
    terrain.tiles[(cy * SIZE + cx) as usize] = Terrain::Forest as u8;
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 1, "w1"));
    add_city(&mut world, "c1", Some("r1"), 14.0, 10.0);
    world.nodes.push(
        serde_json::from_value(json!({ "id": "n", "kind": "forest", "x": cx, "y": cy })).unwrap(),
    );
    let camp = building("camp", BuildingKind::LumberCamp, cx as f64, cy as f64);
    world.buildings.push(camp.clone());
    let mut storage = building("s1", BuildingKind::Storage, 12.0, 10.0);
    storage.city_id = Some("c1".into());
    storage.stock = Some(serde_json::from_value(json!({ "food": 50 })).unwrap());
    world.buildings.push(storage);
    (world, terrain, camp)
}

fn add_worker(world: &mut WorldState, camp: &Building, food: f64) {
    let mut r = new_resident("w1", Some("r1"), camp.x, camp.y);
    r.city_id = Some("c1".into());
    r.stats.strength.base = 10.0;
    r.carried = serde_json::from_value(json!({ "food": food })).unwrap();
    r.order = Some(
        serde_json::from_value::<ResidentOrder>(json!({
            "kind": "workAt", "buildingId": camp.id, "at": { "x": camp.x, "y": camp.y }, "progress": 0
        }))
        .unwrap(),
    );
    r.script = Some(
        serde_json::from_value(json!({ "scriptId": SCRIPT, "memory": { "workplaceId": camp.id } }))
            .unwrap(),
    );
    r.script_params = Some(
        serde_json::from_value(json!({ "1": { "foodAt": 4, "foodTake": 12, "crewFood": 0 } }))
            .unwrap(),
    );
    world.residents.push(r);
}

/// Every script is the Work default (`hostOf('work')`).
struct Host;

impl ScriptHost for Host {
    fn script(&self, _: u64) -> Option<RunnableScript> {
        let (name, source) = default_script(Task::Work);
        Some(RunnableScript {
            user_id: 1,
            name: name.into(),
            version: 1,
            source: source.into(),
            follows_default: true,
            task: None,
        })
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        Some(OrderSender::player(user_id, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

/// Runs the world with the resident never hungry until `done` or the ticks run out; how many
/// ticks it ran.
fn run_script(
    world: &mut WorldState,
    terrain: &TerrainMap,
    done: impl Fn(&Resident) -> bool,
    ticks: usize,
) -> usize {
    let arc = Arc::new(terrain.clone());
    let mut runner = ScriptRunner::new(arc.clone(), Arc::new(Host), order_kinds());
    let mut walking = Walking::new(arc);
    let mut scratch = Scratch::default();
    let mut ran = 0;
    while ran < ticks && !done(&world.residents[0]) {
        world.residents[0].hunger = MAX_HUNGER;
        assert_eq!(runner.run_all(world, &mut scratch, true), vec![]);
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
        ran += 1;
    }
    ran
}

fn lines(r: &Resident) -> Vec<String> {
    r.script_log.iter().flatten().map(|l| l.text.clone()).collect()
}

fn carrying(r: &Resident) -> bool {
    r.script.as_ref().is_some_and(|s| matches!(s.memory.get("carry"), Some(v) if v != &Value::Null))
}

#[test]
fn logs_once_when_getting_food_and_once_when_carrying_a_load_off_not_every_tick() {
    let (mut world, terrain, camp) = camp_world();
    add_worker(&mut world, &camp, 3.0);
    world.piles.push(
        serde_json::from_value(
            json!({ "id": "p", "x": camp.x, "y": camp.y, "goods": { "wood": 100 } }),
        )
        .unwrap(),
    );
    // The TypeScript's `done` sets `carried ||= …` before testing; the same here, in the closure.
    let seen = std::cell::Cell::new(false);
    let ticks = run_script(
        &mut world,
        &terrain,
        |r| {
            if carrying(r) {
                seen.set(true);
            }
            seen.get() && !carrying(r)
        },
        400,
    );
    assert!(seen.get(), "it never carried a load");
    assert!(ticks > 10, "{ticks}");
    let log = lines(&world.residents[0]);
    assert_eq!(log[0], "low on Food (3): fetching 9 at the storage at 12,10");
    let carry = &log[1];
    let load = carry
        .strip_prefix("pile full: carrying ")
        .and_then(|t| t.strip_suffix(" wood to the storage at 12,10"));
    assert!(
        load.is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())),
        "{carry}"
    );
    assert_eq!(log.len(), 2, "{log:?}");
    assert_sound(&world, &terrain);
}

#[test]
fn logs_nothing_while_it_just_works() {
    let (mut world, terrain, camp) = camp_world();
    add_worker(&mut world, &camp, 12.0);
    assert_eq!(run_script(&mut world, &terrain, |_| false, 50), 50);
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::WorkAt(_))));
    assert_eq!(lines(&world.residents[0]), Vec::<String>::new());
}
