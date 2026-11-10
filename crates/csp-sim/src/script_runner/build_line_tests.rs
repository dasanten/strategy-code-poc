//! `build-line.test.ts`: Build line (`CONTEXT.md`: Build line; ADR 0018), a task with its own
//! default script, given with the line's two picked ends. The builder walks to the line, builds
//! each tile still to build with what they carry first and stone fetched from storage when it
//! runs out; with none in any storage they lay out every tile's site and end, saying why. Started
//! without a line it ends.

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{ticks_for_age, BUILD_MATERIALS, MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, Good, Realm, Resident, RunningScript, Stat, Stock, Task, WorldState,
};
use serde_json::{json, Value};

use super::default_host::{default_script_id, DefaultScripts};
use super::{line_builders_apart, line_builders_on_their_line};
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::queries::building::{line_to_build, BuildLine};
use crate::queries::names::held;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::sight::{seen_script, InvariantViolation};
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 32;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// Player 7's version of the Build line default (`defaultScripts`).
fn build_line_id() -> u64 {
    default_script_id(7, Task::BuildLine)
}

fn stone_per_tile() -> f64 {
    BUILD_MATERIALS.get("road").unwrap().get("stone").unwrap()
}

/// A 5-tile road line, east from (10, 12) to (14, 12).
fn line() -> Value {
    json!({ "building": "road", "from": { "x": 10, "y": 12 }, "to": { "x": 14, "y": 12 } })
}

fn plains() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

fn builder(id: &str, seed: f64, x: f64, carried: Stock) -> Resident {
    let mut m = Mulberry32::new(seed);
    let fields = NewResident { id, owner: Some("r1"), city_id: None, x, y: 20.0, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.city_id = Some("c1".into());
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.carried = carried;
    r
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scripts: DefaultScripts,
    orders: OrderQueue,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1, resident w1 standing at (4, 20) away from the line, carrying
/// their own food and stone for two tiles, and storage s1 at (12, 26) holding `stock` (`setup`).
fn setup_on(terrain: TerrainMap, stock: Value) -> Setup {
    let mut world = create_world(&terrain, 1);
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "w1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    let storage =
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 12, "y": 26, "stock": stock });
    world.buildings.push(serde_json::from_value::<Building>(storage).unwrap());
    let carried = Stock::from([(Good::Food, OWN_FOOD), (Good::Stone, 2.0 * stone_per_tile())]);
    world.residents.push(builder("w1", 1.0, 4.0, carried));
    let terrain = Arc::new(terrain);
    let scripts = DefaultScripts::new(terrain.clone(), &[me()]);
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
    let walking = Walking::new(terrain.clone());
    Setup { world, terrain, scripts, orders, walking, scratch: Scratch::default() }
}

fn setup(stock: Value) -> Setup {
    setup_on(plains(), stock)
}

impl Setup {
    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    /// One tick as the game runs it: orders, scripts (with invariants), the world steps.
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        self.orders.apply_all(&mut self.world);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), []);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
    }

    /// Ticks until w1's script ends, at most 5000 ticks (`runOut`).
    fn run_out(&mut self) {
        self.tick(); // the task order applies
        for _ in 0..5000 {
            if self.r("w1").script.is_none() {
                break;
            }
            self.tick();
        }
        assert_eq!(self.r("w1").script, None);
    }

    /// Gives an order to a resident (w1 unless the order names one): `ack`, or why not.
    fn give(&mut self, order: Value) -> String {
        let mut o = json!({ "residentId": "w1" });
        o.as_object_mut().unwrap().extend(order.as_object().unwrap().clone());
        match self.orders.receive(&self.world, &me(), &json!("q"), &o) {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    fn build_line(&mut self, line: Value) -> String {
        let mut o = json!({ "kind": "task", "task": "buildLine" });
        o.as_object_mut().unwrap().extend(line.as_object().unwrap().clone());
        self.give(o)
    }

    fn stopped(&self) -> Vec<String> {
        let events = self.world.events.iter().map(|e| serde_json::to_value(e).unwrap());
        let stopped = events.filter(|e| e["kind"] == "scriptStopped");
        stopped.map(|e| e["reason"].as_str().unwrap().to_string()).collect()
    }

    fn roads(&self) -> Vec<&Building> {
        self.world.buildings.iter().filter(|b| b.kind == BuildingKind::Road).collect()
    }

    fn log(&self, id: &str) -> Vec<String> {
        let log = self.r(id).script_log.iter().flatten();
        log.map(|l| l.text.clone()).collect()
    }
}

fn running(memory: Value) -> Option<RunningScript> {
    Some(serde_json::from_value(json!({ "scriptId": build_line_id(), "memory": memory })).unwrap())
}

// Build line

#[test]
fn builds_a_5_tile_road_line_away_from_the_resident_fetching_stone_when_it_runs_out() {
    let mut s = setup(json!({ "stone": 50 }));
    assert_eq!(s.build_line(line()), "ack");
    s.tick();
    // The line is in task memory alone; Build line has no target param.
    let script = s.r("w1").script.clone().expect("a script");
    assert_eq!(script.memory.get("line"), Some(&line()));
    let params = s.r("w1").script_params.as_ref().and_then(|p| p.get(&build_line_id()));
    assert!(params.is_none_or(|p| p.is_empty()));
    // The Doing line names the line's road or wall (`CONTEXT.md`: Doing).
    assert_eq!(seen_script(&s.world, &script, true).building, Some(BuildingKind::Road));
    s.run_out();
    assert_eq!(s.roads().len(), 5);
    assert!(s
        .roads()
        .iter()
        .all(|b| b.site.is_none() && b.y == 12.0 && (10.0..=14.0).contains(&b.x)));
    // Two tiles' stone carried, three fetched; no more taken than the line needed.
    let store = s.world.buildings.iter().find(|b| b.id == "s1").unwrap();
    let left = held(store.stock.as_ref().unwrap(), Good::Stone);
    assert_eq!(50.0 - left - held(&s.r("w1").carried, Good::Stone), 3.0 * stone_per_tile());
    assert_eq!(s.stopped(), Vec::<String>::new());
    let log = s.log("w1");
    assert!(log.contains(&"laying out a road at 10,12".to_string()), "{log:?}");
    assert!(
        log.iter()
            .any(|l| l.starts_with("fetching ") && l.ends_with(" stone at the storage at 12,26")),
        "{log:?}"
    );
    assert!(log.contains(&"the road line is finished".to_string()), "{log:?}");
}

#[test]
fn skips_tiles_that_have_a_road_already_or_cant_take_one() {
    let mut terrain = plains();
    terrain.tiles[(12 * SIZE + 13) as usize] = Terrain::Lake as u8;
    let mut s = setup_on(terrain, json!({ "stone": 50 }));
    let road = json!({ "id": "rd", "kind": "road", "cityId": null, "x": 12, "y": 12 });
    s.world.buildings.push(serde_json::from_value::<Building>(road).unwrap());
    let l = BuildLine { building: BuildingKind::Road, from: (10, 12), to: (14, 12) };
    let xs: Vec<i32> = line_to_build(&s.world, &l, Some(&s.terrain)).iter().map(|t| t.x).collect();
    assert_eq!(xs, [10, 11, 14]);
    assert_eq!(s.build_line(line()), "ack");
    s.run_out();
    let mut built: Vec<f64> = s.roads().iter().map(|b| b.x).collect();
    built.sort_by(f64::total_cmp);
    assert_eq!(built, [10.0, 11.0, 12.0, 14.0]);
    assert_eq!(s.stopped(), Vec::<String>::new());
}

#[test]
fn with_no_stone_in_any_storage_lays_out_the_whole_line_as_sites_and_ends_saying_why() {
    let mut s = setup(json!({}));
    s.r_mut("w1").carried = Stock::from([(Good::Food, OWN_FOOD)]);
    assert_eq!(s.build_line(line()), "ack");
    s.run_out();
    assert_eq!(s.roads().len(), 5);
    assert!(s.roads().iter().all(|b| b.site.is_some()));
    assert_eq!(s.stopped(), ["no stone in any storage"]);
}

#[test]
fn started_without_a_line_ends_no_line_given() {
    let mut s = setup(json!({ "stone": 50 }));
    assert_eq!(s.give(json!({ "kind": "runScript", "scriptId": build_line_id() })), "ack");
    s.tick();
    assert_eq!(s.r("w1").script, None);
    assert_eq!(s.r("w1").order, None);
    assert_eq!(s.stopped(), ["no line given"]);
}

#[test]
fn is_refused_for_a_child_a_line_of_no_road_or_wall_or_nothing_to_build() {
    let mut s = setup(json!({ "stone": 50 }));
    let mut house = line();
    house["building"] = json!("house");
    assert_eq!(s.build_line(house), "a line is of road or wall");
    let half = json!({ "building": "wall", "from": { "x": 10, "y": 12 } });
    assert_eq!(s.build_line(half), "the line must run between two tiles");
    for x in 10..=14 {
        let road =
            json!({ "id": format!("rd{x}"), "kind": "road", "cityId": null, "x": x, "y": 12 });
        s.world.buildings.push(serde_json::from_value::<Building>(road).unwrap());
    }
    assert_eq!(s.build_line(line()), "no road to build on that line");
    let tick = s.world.tick as f64;
    s.r_mut("w1").born_at = tick - ticks_for_age(5.0);
    let mut wall = line();
    wall["building"] = json!("wall");
    assert_eq!(s.build_line(wall), "children can\u{2019}t build");
}

// A crew on one line

#[test]
fn three_residents_on_a_9_tile_line_never_build_the_same_tile_build_all_of_it_and_end() {
    let long =
        json!({ "building": "road", "from": { "x": 10, "y": 12 }, "to": { "x": 18, "y": 12 } });
    let mut s = setup(json!({ "stone": 100 }));
    s.r_mut("w1").carried = Stock::from([(Good::Food, OWN_FOOD)]);
    let mut crew = vec!["w1".to_string()];
    for (id, x) in [("w2", 5.0), ("w3", 20.0)] {
        let r = builder(id, crew.len() as f64 + 1.0, x, Stock::from([(Good::Food, OWN_FOOD)]));
        s.world.residents.push(r);
        crew.push(id.into());
    }
    for id in &crew {
        let mut o = json!({ "kind": "task", "task": "buildLine", "residentId": id });
        o.as_object_mut().unwrap().extend(long.as_object().unwrap().clone());
        assert_eq!(s.give(o), "ack");
    }
    // The most of them building a tile of the line at once.
    let mut at_once = 0;
    for i in 0..5000 {
        if i > 0 && crew.iter().all(|id| s.r(id).script.is_none()) {
            break;
        }
        s.tick();
        // Never two on one tile: what they took, and the tile their build order is on.
        let took: Vec<String> = crew
            .iter()
            .filter_map(|id| {
                let at = s.r(id).script.as_ref()?.memory.get("at")?.clone();
                (!at.is_null()).then(|| format!("{},{}", at["x"], at["y"]))
            })
            .collect();
        assert_eq!(took.iter().collect::<HashSet<_>>().len(), took.len());
        let building: Vec<String> = crew
            .iter()
            .filter_map(|id| {
                let o = serde_json::to_value(s.r(id).order.as_ref()?).unwrap();
                (o["kind"] == "build").then(|| format!("{},{}", o["at"]["x"], o["at"]["y"]))
            })
            .collect();
        assert_eq!(building.iter().collect::<HashSet<_>>().len(), building.len());
        at_once = at_once.max(building.len());
    }
    assert!(crew.iter().all(|id| s.r(id).script.is_none()));
    assert_eq!(s.roads().len(), 9);
    assert!(s
        .roads()
        .iter()
        .all(|b| b.site.is_none() && b.y == 12.0 && (10.0..=18.0).contains(&b.x)));
    assert_eq!(at_once, 3);
    assert_eq!(s.stopped(), Vec::<String>::new());
    for id in &crew {
        assert!(s.log(id).contains(&"the road line is finished".to_string()));
    }
}

// line-builders-apart invariant

fn violation(invariant: &str, message: &str, ids: &[&str]) -> InvariantViolation {
    InvariantViolation {
        invariant: invariant.into(),
        message: message.into(),
        entity_ids: ids.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn flags_two_residents_of_a_realm_on_one_line_who_took_the_same_tile() {
    let mut s = setup(json!({ "stone": 50 }));
    let mut w2 = builder("w2", 2.0, 4.0, Stock::new());
    w2.city_id = None;
    s.world.residents.push(w2);
    let task = |_: &Resident| Some(Task::BuildLine);
    s.r_mut("w1").script = running(json!({ "line": line(), "at": { "x": 12, "y": 12 } }));
    s.r_mut("w2").script = running(json!({ "line": line(), "at": { "x": 13, "y": 12 } }));
    assert_eq!(line_builders_apart(&s.world, &task), []);
    s.r_mut("w2").script = running(json!({ "line": line(), "at": { "x": 12, "y": 12 } }));
    assert_eq!(
        line_builders_apart(&s.world, &task),
        [violation(
            "line-builders-apart",
            "w1 and w2 both took (12, 12) of their road line",
            &["w1", "w2"]
        )]
    );
    // Another line, or another realm's resident, may take that tile.
    let mut other = line();
    other["to"] = json!({ "x": 15, "y": 12 });
    s.r_mut("w2").script = running(json!({ "line": other, "at": { "x": 12, "y": 12 } }));
    assert_eq!(line_builders_apart(&s.world, &task), []);
    s.r_mut("w2").script = running(json!({ "line": line(), "at": { "x": 12, "y": 12 } }));
    s.r_mut("w2").owner = Some("r2".into());
    assert_eq!(line_builders_apart(&s.world, &task), []);
}

// line-builders-on-their-line invariant

#[test]
fn flags_a_build_line_builder_who_took_or_builds_a_tile_off_their_line() {
    let mut s = setup(json!({ "stone": 50 }));
    let task = |_: &Resident| Some(Task::BuildLine);
    s.r_mut("w1").script = running(json!({ "line": line(), "at": { "x": 12, "y": 12 } }));
    assert_eq!(line_builders_on_their_line(&s.world, &task, SIZE), []);
    s.r_mut("w1").script = running(json!({ "line": line(), "at": { "x": 12, "y": 13 } }));
    let build =
        json!({ "kind": "build", "building": "road", "at": { "x": 3, "y": 3 }, "siteId": null });
    s.r_mut("w1").order = Some(serde_json::from_value(build).unwrap());
    assert_eq!(
        line_builders_on_their_line(&s.world, &task, SIZE),
        [
            violation(
                "line-builders-on-their-line",
                "w1 took (12, 13), off their road line",
                &["w1"]
            ),
            violation(
                "line-builders-on-their-line",
                "w1 builds on (3, 3), off their road line",
                &["w1"]
            ),
        ]
    );
    // Only those running the Build line default count.
    assert_eq!(line_builders_on_their_line(&s.world, &|_| Some(Task::Build), SIZE), []);
}
