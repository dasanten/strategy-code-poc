//! The Gather task (`CONTEXT.md`: Gather; T114.2): a resident given it walks to the nearest tile
//! that gives the good and isn't picked over, gathers until their hands are full or the patch is
//! gone, goes on to the next tile, stores each load and comes back; with nothing in reach they end.

mod default_scripts_host;

use std::sync::Arc;

use csp_shared::balance::GATHER_REACH;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, Good, ResidentOrder, SkillName, Stat, WorldState};
use serde_json::{json, Value};

use csp_sim::gathering::{gather_tile, TileSearch};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use default_scripts_host::{default_scripts, DefaultScripts};

const SIZE: i32 = 64;
const HOME: (f64, f64) = (20.0, 20.0);

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// Plains, with a forest strip three tiles wide east of the storage, from x 23 to x 25.
fn terrain() -> TerrainMap {
    let mut t =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    for y in 18..23 {
        for x in 23..26 {
            t.tiles[(y * SIZE + x) as usize] = Terrain::Forest as u8;
        }
    }
    t
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    tasks: DefaultScripts,
    queue: OrderQueue,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1 and a storage s1 at `HOME` holding `food` Food; residents
/// `ids` on it, strong, skilled and carrying Tools so a load comes quickly, and 3 Food each. The
/// whole map is explored.
fn setup(terrain: TerrainMap, ids: &[&str], food: f64) -> Setup {
    let tasks = default_scripts(&terrain, vec![me()], Some(Arc::new(|_, _, _| true)));
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": ids[0] })).unwrap(),
    );
    world.buildings.push(building(json!({
        "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": HOME.0 - 6.0, "y": HOME.1 - 6.0,
    })));
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "c1-hall", "occupation": null,
        }))
        .unwrap(),
    );
    world.buildings.push(building(json!({
        "id": "s1", "kind": "storage", "cityId": "c1", "x": HOME.0, "y": HOME.1, "stock": { "food": food },
    })));
    let mut m = Mulberry32::new(1.0);
    for id in ids {
        let fields = NewResident {
            id,
            owner: Some("r1"),
            city_id: Some("c1"),
            x: HOME.0,
            y: HOME.1,
            tick: 0.0,
        };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.stats.strength = Stat { base: 20.0, trained: 0.0 };
        r.stats.endurance = Stat { base: 10.0, trained: 0.0 };
        r.stats.agility = Stat { base: 10.0, trained: 0.0 };
        r.skills.insert(SkillName::Woodcutting, 100.0);
        r.carried = [(Good::Tools, 1.0), (Good::Food, 3.0)].into_iter().collect();
        world.residents.push(r);
    }
    let queue = OrderQueue::new(tasks.kinds.clone(), Some(Arc::new(terrain.clone())));
    Setup { world, terrain, tasks, queue, scratch: Scratch::default() }
}

fn building(v: Value) -> Building {
    serde_json::from_value(v).unwrap()
}

fn give(s: &mut Setup, id: &str, params: Value) -> OrderReply {
    let order = json!({ "kind": "task", "task": "gather", "residentId": id, "params": params });
    let answer = s.queue.receive(&s.world, &me(), &json!("q"), &order);
    s.queue.apply_all(&mut s.world);
    answer
}

fn acked(reply: &OrderReply) -> bool {
    matches!(reply, OrderReply::Ack { .. })
}

/// Runs scripts and steps the world until `until` holds, which it must within `ticks`; every
/// invariant holds at the end.
fn run(s: &mut Setup, ticks: usize, mut until: impl FnMut(&Setup) -> bool) {
    let mut walking = Walking::new(Arc::new(s.terrain.clone()));
    let mut held = false;
    for _ in 0..ticks {
        assert_eq!(s.tasks.run_all(&mut s.world, &mut s.scratch), vec![]);
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut walking), None);
        if until(s) {
            held = true;
            break;
        }
    }
    assert!(held, "the condition never held at tick {}", s.world.tick);
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

fn resident<'s>(s: &'s Setup, id: &str) -> &'s csp_shared::world::Resident {
    s.world.residents.iter().find(|r| r.id == id).unwrap()
}

fn stored(s: &Setup, good: Good) -> f64 {
    let b = s.world.buildings.iter().find(|b| b.id == "s1").unwrap();
    b.stock.as_ref().and_then(|st| st.get(&good).copied()).unwrap_or(0.0)
}

fn logged(s: &Setup, id: &str) -> Vec<String> {
    resident(s, id).script_log.iter().flatten().map(|l| l.text.clone()).collect()
}

fn memory_at(s: &Setup, id: &str) -> Option<(i64, i64)> {
    let m = &resident(s, id).script.as_ref()?.memory;
    let at = m.get("at")?;
    Some((at["x"].as_i64()?, at["y"].as_i64()?))
}

fn running(s: &Setup, id: &str) -> bool {
    resident(s, id).script.is_some()
}

#[test]
fn brings_load_after_load_to_the_storage_moving_outward_as_tiles_empty() {
    let mut s = setup(terrain(), &["w1"], 50.0);
    assert!(acked(&give(&mut s, "w1", json!({ "good": "wood" }))));
    // The first tile is the nearest forest tile to where they started.
    run(&mut s, 400, |s| matches!(resident(s, "w1").order, Some(ResidentOrder::Gather(_))));
    assert_eq!((resident(&s, "w1").x, resident(&s, "w1").y), (23.0, 20.0));
    // Two loads stored: they emptied the nearest tiles and went on to farther ones.
    run(&mut s, 30_000, |s| stored(s, Good::Wood) >= 2.0 * 40.0);
    assert!(s.world.patches.iter().any(|p| (p.x, p.y) == (23, 20)), "the first tile was gathered");
    // One tile holds less than a load: they went on to the next ones (and back to the first once
    // it had grown some back).
    assert!(s.world.patches.len() >= 3, "{:?}", s.world.patches);
    assert!(logged(&s, "w1").iter().any(|l| l.starts_with("storing")), "{:?}", logged(&s, "w1"));
    assert!(running(&s, "w1"));
}

#[test]
fn two_gatherers_take_different_tiles() {
    let mut s = setup(terrain(), &["w1", "w2"], 50.0);
    assert!(acked(&give(&mut s, "w1", json!({ "good": "wood" }))));
    assert!(acked(&give(&mut s, "w2", json!({ "good": "wood" }))));
    run(&mut s, 400, |s| {
        ["w1", "w2"]
            .iter()
            .all(|id| matches!(resident(s, id).order, Some(ResidentOrder::Gather(_))))
    });
    let (a, b) = (memory_at(&s, "w1"), memory_at(&s, "w2"));
    assert!(a.is_some() && a != b, "{a:?} {b:?}");
    let tile = |id| (resident(&s, id).x, resident(&s, id).y);
    assert_ne!(tile("w1"), tile("w2"));
}

#[test]
fn ends_saying_why_with_nothing_in_reach() {
    let plains =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut s = setup(plains, &["w1"], 50.0);
    assert!(acked(&give(&mut s, "w1", json!({ "good": "stone" }))));
    run(&mut s, 5, |s| !running(s, "w1"));
    assert!(
        logged(&s, "w1").iter().any(|l| l.contains("no stone left to gather within reach")),
        "{:?}",
        logged(&s, "w1")
    );
}

#[test]
fn stores_what_it_carries_and_ends_once_the_land_in_reach_is_picked_over() {
    let mut s = setup(terrain(), &["w1"], 50.0);
    // Every forest tile but one is picked over, and that one holds 5.
    for y in 18..23 {
        for x in 23..26 {
            let left = if (x, y) == (23, 20) { 5.0 } else { 0.0 };
            s.world.patches.push(csp_shared::world::Patch { x, y, left, at: 0 });
        }
    }
    s.world.patches.sort_by_key(|p| (p.y, p.x));
    assert!(acked(&give(&mut s, "w1", json!({ "good": "wood" }))));
    run(&mut s, 5_000, |s| !running(s, "w1"));
    assert_eq!(stored(&s, Good::Wood), 5.0);
    let log = logged(&s, "w1");
    assert!(log.iter().any(|l| l.contains("no wood left to gather within reach")), "{log:?}");
}

#[test]
fn gets_food_below_food_at_as_work_does() {
    let mut s = setup(terrain(), &["w1"], 50.0);
    s.world.residents[0].carried.remove(&Good::Food);
    assert!(acked(&give(&mut s, "w1", json!({ "good": "wood", "foodAt": 2, "foodTake": 6 }))));
    run(&mut s, 400, |s| matches!(resident(s, "w1").order, Some(ResidentOrder::Gather(_))));
    assert_eq!(resident(&s, "w1").carried.get(&Good::Food).copied(), Some(6.0));
    assert!(
        logged(&s, "w1").iter().any(|l| l.starts_with("low on Food")),
        "{:?}",
        logged(&s, "w1")
    );
    assert_eq!(stored(&s, Good::Food), 44.0);
    // foodAt 0 never fetches.
    let mut s = setup(terrain(), &["w1"], 50.0);
    s.world.residents[0].carried.remove(&Good::Food);
    assert!(acked(&give(&mut s, "w1", json!({ "good": "wood", "foodAt": 0 }))));
    run(&mut s, 400, |s| matches!(resident(s, "w1").order, Some(ResidentOrder::Gather(_))));
    // (A meal taken at the storage on the way out is survival's, not a fetch.)
    assert!(
        !logged(&s, "w1").iter().any(|l| l.starts_with("low on Food")),
        "{:?}",
        logged(&s, "w1")
    );
}

#[test]
fn a_child_cant_be_given_gather() {
    let mut s = setup(terrain(), &["w1"], 50.0);
    s.world.residents[0].born_at = s.world.tick as f64;
    let reply = give(&mut s, "w1", json!({ "good": "wood" }));
    assert!(
        matches!(reply, OrderReply::Rejected { ref reason, .. } if reason == "children can’t gather")
    );
}

#[test]
fn the_tile_search_skips_taken_built_and_seen_picked_over_tiles_and_keeps_to_its_reach() {
    let t = terrain();
    let mut world = create_world(&t, 1);
    world.nodes.clear();
    let all = |_: i32, _: i32| true;
    let none = |_: i32, _: i32| false;
    let search = |world: &WorldState, skip: &[(i32, i32)], sight: &dyn Fn(i32, i32) -> bool| {
        gather_tile(
            world,
            &t,
            &TileSearch { good: Good::Wood, from: (20, 20), skip, explored: &all, in_sight: sight },
        )
    };
    assert_eq!(search(&world, &[], &all), Some((23, 20)));
    assert_eq!(search(&world, &[(23, 20)], &all), Some((23, 19)));
    world.patches.push(csp_shared::world::Patch { x: 23, y: 20, left: 0.0, at: 0 });
    assert_eq!(search(&world, &[], &all), Some((23, 19)), "seen picked over");
    assert_eq!(search(&world, &[], &none), Some((23, 20)), "out of sight it may still hold some");
    world.buildings.push(building(json!({ "id": "rd", "kind": "road", "x": 23, "y": 19 })));
    assert_eq!(search(&world, &[], &all), Some((23, 21)));
    // Stone: no hills at all. Out of reach: nothing.
    let stone =
        TileSearch { good: Good::Stone, from: (20, 20), skip: &[], explored: &all, in_sight: &all };
    assert_eq!(gather_tile(&world, &t, &stone), None);
    // On this 64-tile map, which wraps, (55, 20) is 30 tiles from the strip either way.
    let far = (55, 20);
    assert!(30 > GATHER_REACH as i32);
    let wood =
        TileSearch { good: Good::Wood, from: far, skip: &[], explored: &all, in_sight: &all };
    assert_eq!(gather_tile(&world, &t, &wood), None);
    // Unexplored tiles are left out.
    let unexplored =
        TileSearch { good: Good::Wood, from: (20, 20), skip: &[], explored: &none, in_sight: &all };
    assert_eq!(gather_tile(&world, &t, &unexplored), None);
}
