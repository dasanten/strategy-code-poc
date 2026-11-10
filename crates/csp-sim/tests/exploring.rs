//! `apps/server/src/exploring.test.ts`, ported one to one.
//!
//! Explore (`CONTEXT.md`: Explore): a resident given the task sets out with as much Food as they
//! can carry, walks to the edge of their Player's explored terrain the way asked, turns back while
//! the Food on them still covers the way home plus a margin, refills and goes back out to where
//! they turned. With nothing unexplored in reach they end.

mod default_scripts_host;

use std::sync::{Arc, Mutex};

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER, SIGHT_RANGE, WAYPOINTS_MAX,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, Good, Horse, HorseStats, ResidentOrder, ResourceKind, ResourceNode, Stat, Waypoint,
    WorldState,
};
use serde_json::{json, Value};

use csp_sim::explored::ExploredTerrain;
use csp_sim::explored_edge::{explored_edge, EdgeSearch};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use default_scripts_host::{default_scripts, DefaultScripts};

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

struct Setup {
    world: WorldState,
    explored: Arc<Mutex<ExploredTerrain>>,
    tasks: DefaultScripts,
    queue: OrderQueue,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1 and a storage s1 holding 100 Food at `home`; resident w1 on
/// it with no Food and `stone` units of stone, so only so much Food fits in their hands. What
/// they see they explore, as the game's sight does (`setup`).
fn setup(terrain: &TerrainMap, home: (f64, f64), stone: f64) -> Setup {
    let explored = Arc::new(Mutex::new(ExploredTerrain::new(terrain.clone(), &[])));
    let seen = explored.clone();
    let tasks = default_scripts(
        terrain,
        vec![me()],
        Some(Arc::new(move |user, x, y| seen.lock().unwrap().is_explored(user, x, y))),
    );
    let mut world = create_world(terrain, 1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "w1" })).unwrap(),
    );
    add_city(&mut world, "c1", "r1", home.0 + 4.0, home.1 + 4.0);
    world.buildings.push(storage("s1", home.0, home.1, 100.0));
    let mut m = Mulberry32::new(1.0);
    let fields = NewResident {
        id: "w1",
        owner: Some("r1"),
        city_id: Some("c1"),
        x: home.0,
        y: home.1,
        tick: 0.0,
    };
    let mut w1 = new_resident(&mut || m.next(), &fields, None);
    let ten = Stat { base: 10.0, trained: 0.0 };
    w1.stats.strength = ten.clone();
    w1.stats.endurance = ten.clone();
    w1.stats.agility = ten;
    w1.carried = [(Good::Stone, stone)].into_iter().collect();
    world.residents.push(w1);
    let queue = OrderQueue::new(tasks.kinds.clone(), None);
    Setup { world, explored, tasks, queue, scratch: Scratch::default() }
}

fn storage(id: &str, x: f64, y: f64, food: f64) -> Building {
    serde_json::from_value(json!({
        "id": id, "kind": "storage", "cityId": "c1", "x": x, "y": y, "stock": { "food": food },
    }))
    .unwrap()
}

/// `addCity` of `test-terrain.ts`: a city of the realm with only its town hall at (x, y).
fn add_city(world: &mut WorldState, id: &str, realm: &str, x: f64, y: f64) {
    let hall = format!("{id}-hall");
    world.buildings.push(
        serde_json::from_value(json!({
            "id": hall, "kind": "townHall", "cityId": id, "x": x, "y": y,
        }))
        .unwrap(),
    );
    world.cities.push(
        serde_json::from_value(json!({
            "id": id, "name": "Ashford", "realmId": realm, "townHallId": hall, "occupation": null,
        }))
        .unwrap(),
    );
}

fn give(s: &mut Setup, params: Value) -> OrderReply {
    let order = json!({ "kind": "task", "task": "explore", "residentId": "w1", "params": params });
    let answer = s.queue.receive(&s.world, &me(), &json!("q"), &order);
    s.queue.apply_all(&mut s.world);
    answer
}

fn w1(s: &Setup) -> &csp_shared::world::Resident {
    s.world.residents.iter().find(|r| r.id == "w1").expect("w1 is alive")
}

/// Runs scripts and steps the world, w1 exploring as they see, for `ticks`, or with `until`
/// until it holds, which it must within them (`run`).
fn run(
    s: &mut Setup,
    terrain: &TerrainMap,
    ticks: usize,
    until: Option<&mut dyn FnMut(&Setup) -> bool>,
) {
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut until = until;
    let mut held = false;
    for _ in 0..ticks {
        {
            let mut explored = s.explored.lock().unwrap();
            for r in &s.world.residents {
                explored.explore(7, r.x as i32, r.y as i32, SIGHT_RANGE as i32);
            }
        }
        assert_eq!(s.tasks.run_all(&mut s.world, &mut s.scratch), vec![]);
        step_world(&mut s.world, terrain, &mut s.scratch, Some(&mut walking), None);
        // Never starving: alive, with health left.
        assert!(w1(s).health > 0.0);
        if let Some(u) = until.as_deref_mut() {
            if u(s) {
                held = true;
                break;
            }
        }
    }
    if until.is_some() {
        assert!(held, "the condition never held");
    }
    assert_eq!(check_all(&s.world, terrain), vec![]);
}

fn logged(s: &Setup) -> Vec<String> {
    w1(s).script_log.iter().flatten().map(|l| l.text.clone()).collect()
}

fn memory(s: &Setup, key: &str) -> Option<Value> {
    w1(s).script.as_ref().and_then(|sc| sc.memory.get(key).cloned())
}

fn tile_of(v: &Value) -> (f64, f64) {
    (v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap())
}

fn walking_to(s: &Setup) -> Option<(f64, f64)> {
    match &w1(s).order {
        Some(ResidentOrder::WalkTo(w)) => Some((w.target.x, w.target.y)),
        _ => None,
    }
}

fn fetching_from(s: &Setup) -> Option<String> {
    let o = serde_json::to_value(&w1(s).order).unwrap();
    (o["kind"] == "fetch").then(|| o["from"]["storageId"].as_str().unwrap_or_default().to_string())
}

/// A horse of r1's on w1's tile, which w1 gets on (`mounted`).
fn mounted(world: &mut WorldState) {
    let w = world.residents.iter_mut().find(|r| r.id == "w1").unwrap();
    let (x, y) = (w.x, w.y);
    w.riding = Some("h1".into());
    world.horses.push(Horse {
        id: "h1".into(),
        name: "Rowan".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x,
        y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        },
        born_at: 0.0,
        down_until: None,
    });
}

// the edge of explored terrain

fn disc() -> ExploredTerrain {
    let mut d = ExploredTerrain::new(plains(64), &[]);
    d.explore(7, 32, 32, 10);
    d
}

/// How far a tile lies from the middle of the explored disc, and at what angle off north
/// (`where`).
fn where_is((x, y): (i32, i32)) -> (i64, f64) {
    let (dx, dy) = (f64::from(x - 32), f64::from(y - 32));
    (dx.hypot(dy).round() as i64, f64::from(x - 32).atan2(f64::from(32 - y)).to_degrees())
}

fn edge(
    d: &ExploredTerrain,
    toward: Option<&str>,
    skip: &[(i32, i32)],
    can_enter: &dyn Fn(i32, i32) -> bool,
) -> Option<(i32, i32)> {
    let explored = |x: i32, y: i32| d.is_explored(7, x, y);
    explored_edge(&EdgeSearch {
        size: 64,
        explored: &explored,
        can_enter,
        from: (32, 32),
        toward,
        skip,
    })
}

#[test]
fn is_the_nearest_explored_tile_beside_an_unexplored_one_the_way_asked() {
    let d = disc();
    let any = |_: i32, _: i32| true;
    // The disc's rim lies 9 to 10 tiles out; the nearest of it that way comes first.
    let north = where_is(edge(&d, Some("north"), &[], &any).unwrap());
    assert_eq!(north.0, 9);
    assert!(north.1.abs() < 10.0);
    let east = where_is(edge(&d, Some("east"), &[], &any).unwrap());
    assert!((east.1 - 90.0).abs() < 10.0);
    let southwest = where_is(edge(&d, Some("southwest"), &[], &any).unwrap());
    assert!(southwest.1 >= -180.0 && southwest.1 <= -90.0);
    // Explored all round, a tile out on the rim: never one inside.
    assert_eq!(where_is(edge(&d, None, &[], &any).unwrap()).0, 9);
}

#[test]
fn leaves_out_tiles_near_those_to_skip_and_tiles_they_cant_go_onto() {
    let d = disc();
    let any = |_: i32, _: i32| true;
    let north = edge(&d, Some("north"), &[], &any).unwrap();
    let skipped = edge(&d, None, &[north], &any).unwrap();
    assert!(f64::from(skipped.0 - north.0).hypot(f64::from(skipped.1 - north.1)) > 8.0);
    let west_only = |x: i32, _: i32| x < 32;
    assert_eq!(edge(&d, Some("east"), &[], &west_only), None);
}

#[test]
fn is_none_once_all_is_explored() {
    let all = |_: i32, _: i32| true;
    let search = EdgeSearch {
        size: 64,
        explored: &all,
        can_enter: &all,
        from: (32, 32),
        toward: None,
        skip: &[],
    };
    assert_eq!(explored_edge(&search), None);
}

// exploring

const HOME: (f64, f64) = (500.0, 960.0);

#[test]
fn sets_out_with_food_walks_north_and_turns_back_in_time() {
    let terrain = plains(1000);
    let mut s = setup(&terrain, HOME, 26.0);
    assert_eq!(
        give(&mut s, json!({ "toward": "north" })),
        OrderReply::Ack { request_id: "q".into() }
    );
    run(&mut s, &terrain, 1, None);
    // As much Food as fits: 4 units beside 26 stone, from the storage they stand on.
    assert_eq!(logged(&s), ["setting out: fetching 4 Food at the storage at 500,960"]);
    assert_eq!(w1(&s).carried.get(&Good::Food), Some(&4.0));
    // Out north until the Food on them only just covers the way home.
    run(&mut s, &terrain, 20_000, Some(&mut |s| memory(s, "turnedAt").is_some()));
    let turned = tile_of(&memory(&s, "turnedAt").unwrap());
    assert!(turned.1 < HOME.1 - 4.0 * SIGHT_RANGE);
    assert!((turned.0 - HOME.0).abs() < (HOME.1 - turned.1) / 4.0);
    assert_eq!(fetching_from(&s).as_deref(), Some("s1"));
    assert_eq!(logged(&s).last().unwrap(), "turning back with 4 Food to the storage at 500,960");
    // Home, refilled, and out north again. Back to where they turned is as far as a full load
    // takes them and back, so they take the nearest edge north of home instead.
    run(
        &mut s,
        &terrain,
        20_000,
        Some(&mut |s| {
            memory(s, "fetching").is_none_or(|f| f.is_null() || f == false)
                && walking_to(s).is_some()
        }),
    );
    assert_eq!(w1(&s).carried.get(&Good::Food), Some(&4.0));
    let target = walking_to(&s).unwrap();
    assert!(HOME.1 - target.1 >= (target.0 - HOME.0).abs());
    assert!(w1(&s).script.is_some());
}

#[test]
fn goes_back_out_to_where_they_turned_once_refilled() {
    // Room for 6 Food, but only 4 in the storage they stand on: they set out with that and turn
    // back early, to s2 nearby, which holds more.
    let terrain = plains(1000);
    let mut s = setup(&terrain, HOME, 24.0);
    s.world.buildings.iter_mut().find(|b| b.id == "s1").unwrap().stock =
        Some([(Good::Food, 4.0)].into_iter().collect());
    s.world.buildings.push(storage("s2", HOME.0 + 10.0, HOME.1, 100.0));
    give(&mut s, json!({ "toward": "north" }));
    run(&mut s, &terrain, 20_000, Some(&mut |s| memory(s, "turnedAt").is_some()));
    assert_eq!(fetching_from(&s).as_deref(), Some("s2"));
    let turned = tile_of(&memory(&s, "turnedAt").unwrap());
    run(
        &mut s,
        &terrain,
        20_000,
        Some(&mut |s| {
            memory(s, "fetching").is_none_or(|f| f.is_null() || f == false)
                && walking_to(s).is_some()
        }),
    );
    assert_eq!(logged(&s).last().unwrap(), &format!("going back out to {},{}", turned.0, turned.1));
    assert_eq!(walking_to(&s), Some(turned));
    run(&mut s, &terrain, 20_000, Some(&mut |s| (w1(s).x, w1(s).y) == turned));
    // And on from there.
    run(&mut s, &terrain, 2, Some(&mut |s| walking_to(s).is_some()));
    assert!(w1(&s).script.is_some());
}

#[test]
fn riding_counts_the_horses_food_too_and_turns_back_in_time() {
    let terrain = plains(1000);
    let mut s = setup(&terrain, HOME, 22.0);
    mounted(&mut s.world);
    give(&mut s, json!({ "toward": "north" }));
    run(&mut s, &terrain, 20_000, Some(&mut |s| memory(s, "turnedAt").is_some()));
    assert_eq!(w1(&s).riding.as_deref(), Some("h1"));
    let turned = tile_of(&memory(&s, "turnedAt").unwrap());
    assert!(turned.1 < HOME.1 - 4.0 * SIGHT_RANGE);
    // Home, with the horse fed from their Food all the way.
    run(
        &mut s,
        &terrain,
        20_000,
        Some(&mut |s| memory(s, "fetching").is_none_or(|f| f.is_null() || f == false)),
    );
    assert_eq!(w1(&s).riding.as_deref(), Some("h1"));
    let horse = &s.world.horses[0];
    assert!(horse.hunger > 0.0);
    assert_eq!(horse.health, MAX_HEALTH);
}

#[test]
fn ends_saying_so_with_nothing_unexplored_left_in_reach() {
    let small = plains(120);
    let mut s = setup(&small, (60.0, 60.0), 20.0);
    give(&mut s, json!({}));
    run(&mut s, &small, 20_000, Some(&mut |s| w1(s).script.is_none()));
    // Back at the storage first, never out in the wild.
    let log = logged(&s);
    assert_eq!(
        log[log.len() - 2..],
        ["done: walking back to the storage at 60,60", "nothing unexplored in reach"]
    );
    assert_eq!((w1(&s).x, w1(&s).y), (60.0, 60.0));
}

#[test]
fn ends_when_the_edge_is_beyond_the_food_they_can_carry() {
    let terrain = plains(1000);
    let mut s = setup(&terrain, HOME, 27.0);
    // Everything near home explored: the edge lies further than 3 Food takes them and back.
    s.explored.lock().unwrap().explore(7, HOME.0 as i32, HOME.1 as i32, 190);
    give(&mut s, json!({ "toward": "north" }));
    run(&mut s, &terrain, 5_000, Some(&mut |s| w1(s).script.is_none()));
    assert_eq!(logged(&s).last().unwrap(), "nothing unexplored in reach of the Food I can carry");
}

#[test]
fn leaves_out_the_edge_across_a_lake_they_found_no_way_to_and_goes_on() {
    // Lakes right across the map north and south of home, the map joining round: they see the
    // land beyond, but can't get there.
    let mut lake = plains(200);
    for (from, to) in [(0, 20), (100, 140)] {
        for y in from..to {
            lake.tiles[(y * 200) as usize..((y + 1) * 200) as usize].fill(Terrain::Lake as u8);
        }
    }
    let mut s = setup(&lake, (100.0, 180.0), 26.0);
    give(&mut s, json!({ "toward": "north" }));
    run(&mut s, &lake, 8_000, Some(&mut |s| logged(s).iter().any(|l| l.starts_with("no way to"))));
    let skip = memory(&s, "skip").unwrap();
    let skipped = tile_of(&skip[0]);
    assert!(skipped.1 < 100.0);
    // On along the near shore, never across.
    run(&mut s, &lake, 600, Some(&mut |s| walking_to(s).is_some()));
    assert!(walking_to(&s).unwrap().1 >= 140.0);
}

// with find

fn gold(id: &str, y: f64) -> ResourceNode {
    ResourceNode { id: id.into(), kind: ResourceKind::GoldOre, x: 500.0, y }
}

/// Gold ore lies in hills: a hill on each tile a node is put on.
fn hilly() -> TerrainMap {
    let mut t = plains(1000);
    for y in [840, 900] {
        t.tiles[y * 1000 + 500] = Terrain::Hills as u8;
    }
    t
}

fn events(s: &Setup) -> Vec<String> {
    s.world
        .events
        .iter()
        .map(|e| serde_json::to_value(&e.what).unwrap()["kind"].as_str().unwrap().to_string())
        .collect()
}

/// Explores north for gold ore till they end, noting the northmost tile they reached
/// (`explore`).
fn explore(s: &mut Setup, terrain: &TerrainMap) -> f64 {
    give(s, json!({ "find": "goldOre", "toward": "north" }));
    let mut northmost = HOME.1;
    run(
        s,
        terrain,
        20_000,
        Some(&mut |s| {
            northmost = northmost.min(w1(s).y);
            w1(s).script.is_none()
        }),
    );
    northmost
}

#[test]
fn marks_a_gold_ore_node_once_in_sight_then_walks_home_and_ends() {
    let terrain = hilly();
    let mut s = setup(&terrain, HOME, 26.0);
    s.world.nodes.push(gold("n1", 840.0));
    let northmost = explore(&mut s, &terrain);
    // Seen on the way out, the tick it came into sight: they turned for home there, without
    // going on to the edge they were walking to.
    assert!(northmost >= 840.0 + SIGHT_RANGE - 2.0);
    let marks = s.world.waypoints.get(&7).cloned().unwrap_or_default();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].name.as_str(), marks[0].x, marks[0].y), ("Gold ore node", 500.0, 840.0));
    assert_eq!((w1(&s).x, w1(&s).y), HOME);
    let log = logged(&s);
    assert_eq!(
        log[log.len() - 3..],
        [
            "found a Gold ore node at 500,840",
            "done: walking back to the storage at 500,960",
            "found a Gold ore node at 500,840",
        ]
    );
    // The realm log says so when they find it, and again as they end.
    assert_eq!(events(&s), ["waypointAdded", "scriptStopped"]);
    let first = serde_json::to_value(&s.world.events[0].what).unwrap();
    assert_eq!(
        (first["name"].clone(), first["waypoint"].clone()),
        (json!(w1(&s).name), json!("Gold ore node"))
    );
}

#[test]
fn passes_a_node_one_of_their_waypoints_already_marks() {
    let terrain = hilly();
    let mut s = setup(&terrain, HOME, 26.0);
    s.world
        .waypoints
        .insert(7, vec![Waypoint { id: "mark".into(), name: "Gold".into(), x: 500.0, y: 900.0 }]);
    s.world.nodes.push(gold("n0", 900.0));
    s.world.nodes.push(gold("n1", 840.0));
    assert!(explore(&mut s, &terrain) < 900.0);
    let marks: Vec<(String, f64)> =
        s.world.waypoints[&7].iter().map(|w| (w.name.clone(), w.y)).collect();
    assert_eq!(marks, [("Gold".to_string(), 900.0), ("Gold ore node".to_string(), 840.0)]);
}

#[test]
fn at_the_waypoint_cap_still_ends_at_home_saying_what_they_found() {
    let terrain = hilly();
    let mut s = setup(&terrain, HOME, 26.0);
    let full: Vec<Waypoint> = (0..WAYPOINTS_MAX as i32)
        .map(|i| Waypoint {
            id: format!("mark{i}"),
            name: format!("Mark {i}"),
            x: f64::from(i),
            y: 0.0,
        })
        .collect();
    s.world.waypoints.insert(7, full.clone());
    s.world.nodes.push(gold("n1", 840.0));
    explore(&mut s, &terrain);
    assert_eq!(s.world.waypoints[&7], full);
    assert_eq!((w1(&s).x, w1(&s).y), HOME);
    let log = logged(&s);
    let cap = format!("no waypoint: you hold {} waypoints already, the most", WAYPOINTS_MAX as i32);
    assert!(log.contains(&cap), "{log:?}");
    assert_eq!(log.last().unwrap(), "found a Gold ore node at 500,840, no waypoint added");
    assert_eq!(events(&s), ["scriptStopped"]);
}

#[test]
fn is_for_grown_residents() {
    let terrain = plains(1000);
    let mut s = setup(&terrain, HOME, 0.0);
    let tick = s.world.tick as f64;
    s.world.residents[0].born_at = tick;
    let answer = give(&mut s, json!({}));
    assert_eq!(
        answer,
        OrderReply::Rejected { request_id: "q".into(), reason: "children can’t explore".into() }
    );
}
