//! A worker of an NPC city at a workplace beyond its node reach goes home for Food while they
//! still have what the walk home eats (`CONTEXT.md`: Crew food; Daniel, #1379): Larkspur's quarry
//! workers 270 tiles out set off home with none and went Down on the way.

use csp_shared::balance::{road_crew_food, GET_FOOD_AT, MAX_HUNGER, NPC_NODE_REACH, NPC_VILLAGE};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Good, Resident, Stat, Stock, WorldState};
use serde_json::json;

use super::{npc_far_workers_go_home_fed, put_to_work};
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::names::held;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::walk_time::walk_time;
use crate::world::create_world;

/// Tiles from the village's storage to its lumber camp: well past its node reach.
const OUT: i32 = 300;

struct Camp {
    world: WorldState,
    terrain: TerrainMap,
    camp: Building,
    storage: (f64, f64),
}

/// A village with plenty of Food, a lumber camp of no city `OUT` tiles east that it works, and
/// one adult of it working the camp, at it, with `food` on them and a full hunger meter.
fn camp_worker(food: f64) -> Camp {
    let mut terrain = plains(800);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 40, 40, &mut || m.next(), None);
    let si = world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(city.as_str()) && b.kind == BuildingKind::Storage
        })
        .unwrap();
    world.buildings[si].stock = Some(Stock::from([(Good::Food, 2000.0)]));
    let (sx, sy) = (world.buildings[si].x, world.buildings[si].y);
    let at = (sx as i32 + OUT, sy as i32);
    terrain.tiles[(at.1 * terrain.size + at.0) as usize] = Terrain::Forest as u8;
    world.nodes.push(
        serde_json::from_value(json!({ "id": "n-camp", "kind": "forest", "x": at.0, "y": at.1 }))
            .unwrap(),
    );
    let camp: Building = serde_json::from_value(
        json!({ "id": "camp", "kind": "lumberCamp", "cityId": null, "x": at.0, "y": at.1 }),
    )
    .unwrap();
    world.buildings.push(camp.clone());
    let ci = world.cities.iter().position(|c| c.id == city).unwrap();
    world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push("camp".into());
    let mut m = Mulberry32::new(11.0);
    let fields = NewResident {
        id: "w1",
        owner: None,
        city_id: Some(&city),
        x: f64::from(at.0),
        y: f64::from(at.1),
        tick: 0.0,
    };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.stats.agility = Stat { base: 10.0, trained: 0.0 };
    r.carried = Stock::from([(Good::Food, food)]);
    r.hunger = MAX_HUNGER;
    put_to_work(&mut r, &camp);
    world.residents.push(r);
    Camp { world, terrain, camp, storage: (sx, sy) }
}

fn worker(world: &WorldState) -> &Resident {
    world.residents.iter().find(|r| r.id == "w1").expect("the worker")
}

/// Food the walk from the camp home eats, in whole units.
fn walk_home_food(c: &Camp) -> f64 {
    let r = worker(&c.world);
    let from = (c.storage.0 as i32, c.storage.1 as i32);
    let walk =
        walk_time(&c.world, &c.terrain, &|_, _| true, r, from, (c.camp.x as i32, c.camp.y as i32));
    road_crew_food(walk) - GET_FOOD_AT
}

#[test]
fn a_far_worker_goes_home_for_food_while_they_still_have_what_the_walk_home_eats() {
    let probe = camp_worker(0.0);
    let home_food = walk_home_food(&probe);
    // The default's `foodAt` of one unit would keep them at the camp on this much.
    assert!(home_food >= GET_FOOD_AT, "{home_food}");
    let mut c = camp_worker(home_food);
    let mut runner = Runner::new(&c.terrain);
    runner.step(&mut c.world, &c.terrain);
    let r = worker(&c.world);
    let memory = &r.script.as_ref().expect("the Work default").memory;
    let food_at = memory["foodAt"].as_f64().expect("foodAt set");
    assert!(food_at > home_food, "foodAt {food_at}, the walk home eats {home_food}");
    // Within a game hour they set off home for Food, with the walk home's on them.
    let mut left = false;
    for _ in 0..60 {
        runner.step(&mut c.world, &c.terrain);
        let r = worker(&c.world);
        if r.script.as_ref().is_some_and(|s| s.memory.get("food").is_some_and(|f| !f.is_null())) {
            assert!(held(&r.carried, Good::Food) >= home_food - 1.0, "{:?}", r.carried);
            left = true;
            break;
        }
    }
    assert!(left, "still at the camp: {:?}", worker(&c.world).order);
    assert_eq!(check_all(&c.world, &c.terrain), []);
}

#[test]
fn a_far_worker_with_the_defaults_food_at_breaks_the_invariant_until_the_city_sets_it() {
    let mut c = camp_worker(5.0);
    let broken = npc_far_workers_go_home_fed(&c.world, &c.terrain);
    assert_eq!(broken.len(), 1, "{broken:?}");
    assert_eq!(broken[0].entity_ids, ["w1"]);
    // The city sets it on its next step, as for a worker sent out before the rule (#1379).
    let mut runner = Runner::new(&c.terrain);
    runner.step(&mut c.world, &c.terrain);
    assert_eq!(npc_far_workers_go_home_fed(&c.world, &c.terrain), []);
    // A worker near home keeps the default's.
    let near = NPC_NODE_REACH as i32 / 2;
    let mut c = camp_worker(5.0);
    let camp = c.world.buildings.iter_mut().find(|b| b.id == "camp").unwrap();
    camp.x = c.storage.0 + f64::from(near);
    assert_eq!(npc_far_workers_go_home_fed(&c.world, &c.terrain), []);
}
