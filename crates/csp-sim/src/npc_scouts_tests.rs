//! `npc-scouts.test.ts`'s slow simulation (#1038): a scout out past the set reach and home again.
//! The file's other cases are not ported yet.

use csp_shared::balance::{
    NPC_NODE_REACH, NPC_SCOUT_LIMIT, NPC_SCOUT_SECTOR, NPC_SURPLUS_CAP, NPC_TOWN, SIGHT_RANGE,
};
use csp_shared::terrain::{tile_index, wrap_distance, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, Good, ResourceKind, ResourceNode, WorldState};
use serde_json::json;

use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;
use crate::random::{new_id, Mulberry32};
use crate::world::create_world;

/// A finished workplace of `kind` of the city, on a node of `resource` (`workplace`).
fn workplace(world: &mut WorldState, terrain: &mut TerrainMap, city: &str, kind: &str, resource: ResourceKind) {
    let home = npc_home(world, city).unwrap().clone();
    let at = (home.x as i32 + 40 + world.nodes.len() as i32 * 6, home.y as i32 + 40);
    let id = new_id("n", &mut world.next_id);
    world.nodes.push(ResourceNode { id, kind: resource, x: at.0 as f64, y: at.1 as f64 });
    let ground = if resource == ResourceKind::Forest { Terrain::Forest } else { Terrain::Hills };
    terrain.tiles[tile_index(terrain.size, at.0, at.1)] = ground as u8;
    let id = new_id("b", &mut world.next_id);
    let place: Building = serde_json::from_value(
        json!({ "id": id, "kind": kind, "x": at.0, "y": at.1, "cityId": null }),
    )
    .unwrap();
    world.buildings.push(place);
    let ci = world.cities.iter().position(|c| c.id == city).unwrap();
    world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push(id);
}

#[test]
#[ignore = "timed in the PR"]
fn a_scout_walks_out_past_the_set_reach_and_brings_what_they_saw_there_home() {
    // `town()`: a town alone on Plains, nothing short of its reserve, with a lumber camp and a
    // quarry.
    let mut terrain = plains(1300);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    workplace(&mut world, &mut terrain, &city, "lumberCamp", ResourceKind::Forest);
    workplace(&mut world, &mut terrain, &city, "quarry", ResourceKind::Stone);
    let storage = npc_home(&world, &city).unwrap().clone();
    let c = world.cities.iter().find(|c| c.id == city).unwrap();
    let mut stock = npc_reserve(&world, c);
    stock.insert(Good::Food, held(&stock, Good::Food) + NPC_SURPLUS_CAP.get("food").unwrap());
    world.buildings.iter_mut().find(|b| b.id == storage.id).unwrap().stock = Some(stock);
    let home = (storage.x as i32, storage.y as i32);

    let size = terrain.size;
    let across = (f64::from(size) / NPC_SCOUT_SECTOR).ceil() as i64;
    // A sector the city knows that nobody sees from anywhere near its set reach.
    let far_off = |sector: f64| {
        let sector = sector as i64;
        let half = NPC_SCOUT_SECTOR / 2.0;
        let middle = (
            ((sector % across) as f64 * NPC_SCOUT_SECTOR + half) as i32,
            ((sector / across) as f64 * NPC_SCOUT_SECTOR + half) as i32,
        );
        wrap_distance(size, home, middle) > NPC_NODE_REACH + SIGHT_RANGE
    };
    let brought_home = |w: &WorldState| {
        let c = w.cities.iter().find(|c| c.id == city).unwrap();
        let scouted = serde_json::to_value(&c.scouted).unwrap();
        scouted["sectors"].as_array().is_some_and(|s| s.iter().filter_map(|x| x.as_f64()).any(far_off))
    };
    let mut runner = Runner::new(&terrain);
    let mut furthest = 0f64;
    let mut tick = 0;
    while tick < 120 * TICKS_PER_GAME_DAY as usize && !brought_home(&world) {
        runner.step(&mut world, &terrain);
        if tick % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        let out: Vec<String> = world
            .city_plans
            .get(&city)
            .and_then(|p| p.scouts.as_ref())
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default();
        for id in out {
            if let Some(r) = world.residents.iter().find(|p| p.id == id) {
                furthest = furthest.max(wrap_distance(size, home, (r.x as i32, r.y as i32)));
            }
        }
        tick += 1;
    }
    assert!(furthest > NPC_NODE_REACH, "{furthest}");
    assert!(furthest <= NPC_SCOUT_LIMIT + 64.0, "{furthest}");
    assert!(brought_home(&world));
    assert_eq!(check_all(&world, &terrain), []);
}
