//! `apps/server/src/crew-tile.test.ts`, ported one to one.
//!
//! Crews spread over the footprint (`CONTEXT.md`: Spreading over the footprint): the Work, Build
//! and Breed horses defaults send each resident to the footprint tile with the fewest of the crew
//! on it, the nearest on ties, through `crewTile`. Which tile they stand on changes nothing else.

mod default_scripts_host;

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER};
use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, Good, Horse, HorseStats, Resident, ResidentOrder, WorldState};
use serde_json::{json, Value};

use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::queries::goods::pile_at;
use csp_sim::queries::names::placed;
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use default_scripts_host::{default_scripts, DefaultScripts};

const SIZE: i32 = 16;
/// A Player's version of a task's default, as `defaultScripts` numbers them.
const WORK: u64 = 701;
const BUILD: u64 = 702;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

struct Play {
    world: WorldState,
    terrain: TerrainMap,
    tasks: DefaultScripts,
    queue: OrderQueue,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with a 2x2 iron mine finished on an iron node, its north-west tile at
/// (5, 5), and its city off to the side (`setup`).
fn setup() -> Play {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    world.nodes =
        vec![serde_json::from_value(json!({ "id": "n1", "kind": "ironOre", "x": 5, "y": 5 }))
            .unwrap()];
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "w1" })).unwrap(),
    );
    world.buildings.push(
        serde_json::from_value(
            json!({ "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": 12, "y": 12 }),
        )
        .unwrap(),
    );
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "c1-hall", "occupation": null,
        }))
        .unwrap(),
    );
    world
        .buildings
        .push(building(json!({ "id": "mine", "kind": "mine", "cityId": "c1", "x": 5, "y": 5 })));
    let tasks = default_scripts(&terrain, vec![me()], None);
    let queue = OrderQueue::new(tasks.kinds.clone(), Some(Arc::new(terrain.clone())));
    let walking = Walking::new(Arc::new(terrain.clone()));
    Play { world, terrain, tasks, queue, walking, scratch: Scratch::default() }
}

fn building(v: Value) -> Building {
    serde_json::from_value(v).unwrap()
}

impl Play {
    fn add_resident(&mut self, id: &str, x: f64, y: f64) -> usize {
        let mut m = Mulberry32::new(self.world.residents.len() as f64 + 1.0);
        let fields = NewResident { id, owner: Some("r1"), city_id: None, x, y, tick: 0.0 };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.carried = [(Good::Food, 20.0)].into_iter().collect();
        self.world.residents.push(r);
        self.world.residents.len() - 1
    }

    /// Runs the scripts and steps the world `ticks` times, nobody going hungry; the invariants
    /// the scripts check hold (`play`).
    fn play(&mut self, ticks: usize) {
        for _ in 0..ticks {
            for r in &mut self.world.residents {
                r.hunger = MAX_HUNGER;
            }
            assert_eq!(self.tasks.run_all(&mut self.world, &mut self.scratch), vec![]);
            step_world(
                &mut self.world,
                &self.terrain,
                &mut self.scratch,
                Some(&mut self.walking),
                None,
            );
        }
    }

    fn give(&mut self, order: Value) {
        let answer = self.queue.receive(&self.world, &me(), &json!("q"), &order);
        assert_eq!(answer, OrderReply::Ack { request_id: "q".into() }, "{order}");
    }

    fn apply(&mut self) {
        self.queue.apply_all(&mut self.world);
    }

    fn b(&self, id: &str) -> Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap().clone()
    }

    /// How many of the residents stand on each footprint tile of `b`, in the footprint's order
    /// (`perTile`).
    fn per_tile(&self, b: &Building) -> Vec<usize> {
        let tiles = footprint_tiles(placed(b), SIZE);
        let mut counts: BTreeMap<usize, usize> = (0..tiles.len()).map(|i| (i, 0)).collect();
        for r in &self.world.residents {
            let i = tiles.iter().position(|&(x, y)| (x, y) == (r.x as i32, r.y as i32));
            let i = i.unwrap_or_else(|| panic!("{} at ({}, {}) off the footprint", r.id, r.x, r.y));
            *counts.get_mut(&i).unwrap() += 1;
        }
        counts.into_values().collect()
    }
}

fn sorted(mut v: Vec<usize>) -> Vec<usize> {
    v.sort();
    v
}

fn order_json(r: &Resident) -> Value {
    serde_json::to_value(&r.order).unwrap()
}

#[track_caller]
fn has(actual: &Value, key: &str, want: Value) {
    assert_eq!(actual[key], want, "{actual}");
}

// a Work crew

fn work_task(id: &str) -> Value {
    json!({ "kind": "task", "task": "work", "residentId": id, "workplaceId": "mine" })
}

#[test]
fn spreads_six_sent_to_a_2x2_mine_over_its_tiles_at_most_two_to_a_tile() {
    let mut p = setup();
    for i in 1..=6 {
        let id = format!("w{i}");
        p.add_resident(&id, 5.0, 5.0);
        p.give(work_task(&id));
    }
    p.apply();
    p.play(40);
    for r in &p.world.residents {
        has(&order_json(r), "kind", json!("workAt"));
        has(&order_json(r), "buildingId", json!("mine"));
    }
    assert_eq!(sorted(p.per_tile(&p.b("mine"))), [1, 1, 2, 2]);
}

#[test]
fn stands_four_at_a_2x2_mine_one_to_a_tile_and_they_stay_put_once_there() {
    let mut p = setup();
    for i in 1..=4 {
        let id = format!("w{i}");
        p.add_resident(&id, 5.0, 5.0);
        p.give(work_task(&id));
    }
    p.apply();
    p.play(40);
    assert_eq!(p.per_tile(&p.b("mine")), [1, 1, 1, 1]);
    let standing: Vec<(f64, f64)> = p.world.residents.iter().map(|r| (r.x, r.y)).collect();
    p.play(30);
    assert_eq!(p.world.residents.iter().map(|r| (r.x, r.y)).collect::<Vec<_>>(), standing);
    for r in &p.world.residents {
        assert!(matches!(r.order, Some(ResidentOrder::WorkAt(_))), "{:?}", r.order);
    }
}

#[test]
fn sends_a_lone_worker_to_the_footprint_tile_nearest_them() {
    let mut p = setup();
    let w1 = p.add_resident("w1", 9.0, 6.0);
    p.world.residents[w1].script = Some(
        serde_json::from_value(json!({ "scriptId": WORK, "memory": { "workplaceId": "mine" } }))
            .unwrap(),
    );
    p.play(40);
    let r = &p.world.residents[w1];
    assert_eq!((r.x, r.y), (6.0, 6.0));
    has(&order_json(r), "kind", json!("workAt"));
    has(&order_json(r), "buildingId", json!("mine"));
    let at = r.script.as_ref().and_then(|s| s.memory.get("at")).cloned();
    assert_eq!(at, Some(json!({ "x": 6, "y": 6, "region": null, "regionKind": null })));
}

#[test]
fn leaves_a_resident_already_on_the_footprint_where_they_are() {
    let mut p = setup();
    let w1 = p.add_resident("w1", 6.0, 6.0);
    p.give(work_task("w1"));
    p.apply();
    for _ in 0..40 {
        p.play(1);
        let r = &p.world.residents[w1];
        assert_eq!((r.x, r.y), (6.0, 6.0));
    }
    let o = order_json(&p.world.residents[w1]);
    has(&o, "kind", json!("workAt"));
    has(&o, "buildingId", json!("mine"));
    assert_eq!(o["at"], json!({ "x": 6.0, "y": 6.0 }));
}

#[test]
fn makes_the_same_output_on_the_same_pile_with_as_many_workers_as_a_crew_on_one_corner() {
    /// Six at work on the mine for a while: the ore on its pile and the workers counted.
    fn outcome(spread: bool) -> (f64, usize, usize) {
        let mut p = setup();
        for i in 1..=6 {
            let id = format!("w{i}");
            let ri = p.add_resident(&id, 5.0, 5.0);
            if spread {
                p.give(work_task(&id));
            } else {
                // Already at work on the corner, their tile picked: nobody moves.
                let r = &mut p.world.residents[ri];
                r.order = Some(
                    serde_json::from_value(json!({
                        "kind": "workAt", "buildingId": "mine", "at": { "x": 5, "y": 5 },
                        "progress": 0,
                    }))
                    .unwrap(),
                );
                r.script = Some(
                    serde_json::from_value(json!({
                        "scriptId": WORK, "memory": { "workplaceId": "mine", "at": { "x": 5, "y": 5 } },
                    }))
                    .unwrap(),
                );
            }
        }
        p.apply();
        // The spread crew spends a while walking a tile; both work the same stretch after that.
        p.play(40);
        let ore = |w: &WorldState| {
            pile_at(w, 5.0, 5.0).and_then(|pl| pl.goods.get(&Good::IronOre).copied()).unwrap_or(0.0)
        };
        let before = ore(&p.world);
        p.play(TICKS_PER_GAME_DAY as usize);
        let workers = p
            .world
            .residents
            .iter()
            .filter(|r| matches!(r.order, Some(ResidentOrder::WorkAt(_))))
            .count();
        let tiles: HashSet<(i64, i64)> =
            p.world.residents.iter().map(|r| (r.x as i64, r.y as i64)).collect();
        (ore(&p.world) - before, workers, tiles.len())
    }
    let spread = outcome(true);
    let corner = outcome(false);
    assert_eq!(spread.2, 4);
    assert_eq!(corner.2, 1);
    assert_eq!(spread.1, 6);
    assert!(spread.0 > 0.0);
    assert_eq!((spread.0, spread.1), (corner.0, corner.1));
}

// a Build crew

/// An unfinished 2x2 house of the city, its north-west tile at (5, 5), in place of the mine
/// (`siteWorld`).
fn site_world() -> Play {
    let mut p = setup();
    p.world.nodes.clear();
    p.world.buildings.retain(|b| b.id != "mine");
    p.world.buildings.push(building(json!({
        "id": "h1", "kind": "house", "cityId": "c1", "x": 5, "y": 5,
        "site": { "delivered": {}, "work": 0 },
    })));
    p
}

#[test]
fn spreads_four_joining_the_site_on_their_tile_one_to_a_tile() {
    let mut p = site_world();
    for i in 1..=4 {
        let ri = p.add_resident(&format!("w{i}"), 5.0, 5.0);
        p.world.residents[ri].script =
            Some(serde_json::from_value(json!({ "scriptId": BUILD, "memory": {} })).unwrap());
    }
    p.play(40);
    for r in &p.world.residents {
        has(&order_json(r), "kind", json!("build"));
        has(&order_json(r), "siteId", json!("h1"));
    }
    assert_eq!(p.per_tile(&p.b("h1")), [1, 1, 1, 1]);
}

#[test]
fn spreads_a_group_given_build_the_first_lays_out_the_site_the_next_stands_on_another_tile() {
    let mut p = setup();
    p.world.nodes.clear();
    p.world.buildings.retain(|b| b.id != "mine");
    p.add_resident("w1", 5.0, 5.0);
    p.add_resident("w2", 5.0, 9.0);
    for id in ["w1", "w2"] {
        p.give(json!({
            "kind": "task", "task": "build", "residentId": id, "building": "storage",
            "at": { "x": 5, "y": 5 },
        }));
    }
    p.apply();
    p.play(80);
    let site = p
        .world
        .buildings
        .iter()
        .find(|b| b.kind == csp_shared::world::BuildingKind::Storage)
        .unwrap()
        .clone();
    assert_eq!((site.x, site.y), (5.0, 5.0));
    assert!(site.site.is_some());
    for r in &p.world.residents {
        has(&order_json(r), "kind", json!("build"));
        has(&order_json(r), "siteId", json!(site.id));
    }
    let (w1, w2) = (&p.world.residents[0], &p.world.residents[1]);
    assert_eq!((w1.x, w1.y), (5.0, 5.0));
    assert_ne!((w2.x, w2.y), (5.0, 5.0));
    assert_eq!(sorted(p.per_tile(&site)), [0, 0, 1, 1]);
}

// a Breeding crew

#[test]
fn stands_two_breeders_at_a_3x3_stable_on_different_tiles() {
    let mut p = setup();
    p.world.nodes.clear();
    p.world.buildings.retain(|b| b.id != "mine");
    p.world.buildings.push(building(json!({
        "id": "s1", "kind": "stable", "cityId": "c1", "x": 5, "y": 5, "stock": { "food": 10_000 },
    })));
    for id in ["h1", "h2", "h3", "h4"] {
        p.world.horses.push(Horse {
            id: id.into(),
            name: id.into(),
            realm_id: Some("r1".into()),
            city_id: None,
            x: 6.0,
            y: 6.0,
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
    p.add_resident("w1", 5.0, 5.0);
    p.add_resident("w2", 5.0, 5.0);
    for (id, horses) in [("w1", ["h1", "h2"]), ("w2", ["h3", "h4"])] {
        p.give(json!({
            "kind": "task", "task": "breed", "residentId": id, "stableId": "s1", "horseIds": horses,
        }));
    }
    p.apply();
    p.play(40);
    for r in &p.world.residents {
        has(&order_json(r), "kind", json!("breed"));
        has(&order_json(r), "stableId", json!("s1"));
    }
    assert_eq!(sorted(p.per_tile(&p.b("s1"))), [0, 0, 0, 0, 0, 0, 0, 1, 1]);
}
