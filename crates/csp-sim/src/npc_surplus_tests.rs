//! `npc-surplus.test.ts`'s slow simulation (#1038): spare hands kept working on the map. The
//! file's other cases are not ported yet.

use csp_shared::balance::{NPC_SURPLUS_CAP, NPC_TOWN};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, CityPlan, Good, ResourceKind, ResourceNode, WorldState};
use serde_json::json;

use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;
use crate::random::{new_id, Mulberry32};
use crate::world::create_world;

/// A finished workplace of `kind` of the city, on a node of `resource` (`workplace`). Its id.
fn workplace(
    world: &mut WorldState,
    terrain: &mut TerrainMap,
    city: &str,
    kind: &str,
    resource: ResourceKind,
) -> String {
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
    world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push(id.clone());
    id
}

/// Those the plan puts at a building (`at`).
fn at(plan: &CityPlan, b: &str) -> usize {
    plan.jobs.values().filter(|j| j.building_id.as_deref() == Some(b)).count()
}

#[test]
#[ignore = "timed in the PR"]
fn keep_a_big_city_working_within_its_caps_on_the_map() {
    // `town()`: a town alone on Plains with a lumber camp and a quarry, its Food at its cap, the
    // rest at its reserve, its limit known.
    let mut terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let camp = workplace(&mut world, &mut terrain, &city, "lumberCamp", ResourceKind::Forest);
    let quarry = workplace(&mut world, &mut terrain, &city, "quarry", ResourceKind::Stone);
    let storage = npc_home(&world, &city).unwrap().id.clone();
    let ci = world.cities.iter().position(|c| c.id == city).unwrap();
    let mut stock = npc_reserve(&world, &world.cities[ci]);
    stock.insert(Good::Food, held(&stock, Good::Food) + NPC_SURPLUS_CAP.get("food").unwrap());
    world.buildings.iter_mut().find(|b| b.id == storage).unwrap().stock = Some(stock);
    world.cities[ci].scouted =
        Some(serde_json::from_value(json!({ "sectors": [], "done": true })).unwrap());

    let mut runner = Runner::new(&terrain);
    let mut working = 0;
    for t in 0..5 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut world, &terrain);
        if t % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        if let Some(plan) = world.city_plans.get(&city) {
            working = working.max(at(plan, &camp) + at(plan, &quarry));
        }
    }
    assert!(working > 0);
}
