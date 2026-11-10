//! `apps/server/src/carrying-output.test.ts`. Carrying the output (`CONTEXT.md`: Carrying the
//! output, Own food): the Work default carries a workplace's output to the nearest storage of the
//! realm once its pile holds a full load, one worker at a time, each keeping their own food:
//! `foodTake`, by default `GET_FOOD_TAKE`.

mod build_common;
mod ts_match;

use std::sync::Arc;

use build_common::{add_city, building, new_resident, realm};
use csp_shared::balance::{GET_FOOD_TAKE, MAX_HUNGER, OWN_FOOD, WORK_FOOD_KEPT};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, ConstructionSite, Good, Pile, Resident, ResourceKind,
    ResourceNode, Stat, Stock, Task, WorldState,
};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::queries::goods::{pile_at, units_that_fit};
use csp_sim::script_runner::{one_carrier_at_a_time, ScriptHost, ScriptRunner};
use csp_sim::script_tables::DEFAULT_SCRIPTS;
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 32;
const WORK: u64 = 1;

fn plains() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// Mara's realm r1 with city c1, a farm at (6, 6) and workers w1–w3 on it, running Work
/// (`farmWorld`).
fn farm_world() -> (WorldState, TerrainMap, Building) {
    let terrain = plains();
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 1, "w1"));
    add_city(&mut world, "c1", Some("r1"), 20.0, 6.0);
    let mut farm = building("farm", BuildingKind::Farm, 6.0, 6.0);
    farm.city_id = Some("c1".into());
    world.buildings.push(farm.clone());
    for id in ["w1", "w2", "w3"] {
        add_worker(&mut world, id, &farm);
    }
    (world, terrain, farm)
}

fn add_worker(world: &mut WorldState, id: &str, place: &Building) -> usize {
    let mut r = new_resident(id, Some("r1"), place.x, place.y);
    r.city_id = Some("c1".into());
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.carried = stock(&[(Good::Food, OWN_FOOD)]);
    r.order = Some(
        serde_json::from_value(json!({
            "kind": "workAt", "buildingId": place.id, "at": { "x": place.x, "y": place.y },
            "progress": 0
        }))
        .unwrap(),
    );
    r.script = Some(
        serde_json::from_value(json!({ "scriptId": WORK, "memory": { "workplaceId": place.id } }))
            .unwrap(),
    );
    world.residents.push(r);
    world.residents.len() - 1
}

fn storage(world: &mut WorldState, id: &str, x: f64, y: f64, goods: Stock) {
    let mut b = building(id, BuildingKind::Storage, x, y);
    b.city_id = Some("c1".into());
    b.stock = Some(goods);
    world.buildings.push(b);
}

/// The Work default, unedited, as every script of Player 1; `default_script` names its id.
struct Host(Option<u64>);

impl ScriptHost for Host {
    fn script(&self, _: u64) -> Option<RunnableScript> {
        let (_, name, source) =
            DEFAULT_SCRIPTS.iter().find(|(t, _, _)| *t == Task::Work).expect("Work");
        Some(RunnableScript {
            user_id: 1,
            name: name.to_string(),
            version: 1,
            source: source.to_string(),
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
    fn default_script(&self, _: u64, _: Task) -> Option<u64> {
        self.0
    }
}

fn runner(terrain: &TerrainMap, default: Option<u64>) -> ScriptRunner {
    ScriptRunner::new(Arc::new(terrain.clone()), Arc::new(Host(default)), order_kinds())
}

/// Runs every script once, checking the invariants (`runAll(world, true)`): what broke.
fn run_all(
    runner: &mut ScriptRunner,
    world: &mut WorldState,
    scratch: &mut Scratch,
) -> Vec<String> {
    runner.run_all(world, scratch, true).into_iter().map(|v| v.message).collect()
}

fn carry_of(r: &Resident) -> Option<&Value> {
    r.script.as_ref().and_then(|s| s.memory.get("carry")).filter(|c| !c.is_null())
}

fn carriers(world: &WorldState) -> Vec<&Resident> {
    world.residents.iter().filter(|r| carry_of(r).is_some()).collect()
}

/// A full load of Food for a worker: what fits in their hands beside their own food.
fn full_load(world: &WorldState) -> f64 {
    units_that_fit(&world.residents[0], Good::Food, world.tick as f64)
}

fn elsewhere(world: &mut WorldState) {
    let c2: City = serde_json::from_value(json!({
        "id": "c2", "name": "Elsewhere", "realmId": "r2", "townHallId": "none", "occupation": null
    }))
    .unwrap();
    world.cities.push(c2);
}

fn held(world: &WorldState, id: &str, g: Good) -> f64 {
    let b = world.buildings.iter().find(|b| b.id == id).expect("a building");
    b.stock.as_ref().and_then(|s| s.get(&g)).copied().unwrap_or(0.0)
}

#[test]
fn waits_for_a_full_load_then_sends_one_worker_with_all_but_the_food_the_farm_keeps() {
    let (mut world, terrain, farm) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0, Stock::new());
    let mut runner = runner(&terrain, None);
    let mut scratch = Scratch::default();
    let below = full_load(&world) + WORK_FOOD_KEPT - 1.0;
    world.piles.push(Pile {
        id: "p".into(),
        x: farm.x,
        y: farm.y,
        goods: stock(&[(Good::Food, below)]),
    });
    assert_eq!(run_all(&mut runner, &mut world, &mut scratch), Vec::<String>::new());
    assert!(carriers(&world).is_empty());

    world.piles[0].goods.insert(Good::Food, below + 1.0);
    assert_eq!(run_all(&mut runner, &mut world, &mut scratch), Vec::<String>::new());
    let found = carriers(&world);
    assert_eq!(found.len(), 1);
    let carrier = found[0].id.clone();
    assert_eq!(
        json_of(&found[0].order),
        json!({
            "kind": "pickUp", "from": { "kind": "ground" },
            "goods": { "food": below + 1.0 - WORK_FOOD_KEPT }
        })
    );
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert_eq!(
        pile_at(&world, farm.x, farm.y).and_then(|p| p.goods.get(&Good::Food)).copied(),
        Some(WORK_FOOD_KEPT)
    );
    let c = world.residents.iter().find(|r| r.id == carrier).unwrap();
    assert_eq!(c.carried.get(&Good::Food).copied(), Some(OWN_FOOD + below + 1.0 - WORK_FOOD_KEPT));
}

#[test]
fn goes_to_the_nearest_storage_of_the_realm_by_walking_time_not_by_tiles() {
    let (mut world, mut terrain, farm) = farm_world();
    // Six tiles east through forest, or seven south over Plains.
    let (fx, fy) = (farm.x as i32, farm.y as i32);
    for x in fx + 1..=fx + 6 {
        terrain.tiles[(fy * SIZE + x) as usize] = Terrain::Forest as u8;
    }
    storage(&mut world, "east", farm.x + 6.0, farm.y, Stock::new());
    storage(&mut world, "south", farm.x, farm.y + 7.0, Stock::new());
    // Another realm's storage, nearer still, is not theirs to fill.
    elsewhere(&mut world);
    let mut theirs = building("theirs", BuildingKind::Storage, farm.x + 4.0, farm.y);
    theirs.city_id = Some("c2".into());
    world.buildings.push(theirs);
    world.piles.push(Pile {
        id: "p".into(),
        x: farm.x,
        y: farm.y,
        goods: stock(&[(Good::Food, 100.0)]),
    });
    runner(&terrain, None).run_all(&mut world, &mut Scratch::default(), false);
    let carry: Vec<&Value> = carriers(&world).into_iter().filter_map(carry_of).collect();
    assert_eq!(carry.len(), 1);
    assert_matches(carry[0], json!({ "storageId": "south" }));
}

#[test]
fn stores_the_load_keeps_their_own_food_and_goes_back_to_work_one_carrier_at_a_time() {
    let (mut world, terrain, farm) = farm_world();
    storage(&mut world, "s1", 12.0, 6.0, Stock::new());
    // Several loads already lie there, more than one carrier could take.
    world.piles.push(Pile {
        id: "p".into(),
        x: farm.x,
        y: farm.y,
        goods: stock(&[(Good::Food, 100.0)]),
    });
    let load = full_load(&world);
    let mut runner = runner(&terrain, None);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let (mut trips, mut stored) = (0, 0.0);
    for _ in 0..3000 {
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        assert_eq!(run_all(&mut runner, &mut world, &mut scratch), Vec::<String>::new());
        assert!(carriers(&world).len() <= 1);
        let before = held(&world, "s1", Good::Food);
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        let after = held(&world, "s1", Good::Food);
        if after > before {
            trips += 1;
            stored += after - before;
            // The carrier put away only the load, their own food (foodTake) still in hand.
            let c = carriers(&world);
            assert_eq!(c[0].carried.get(&Good::Food).copied(), Some(GET_FOOD_TAKE));
        }
    }
    assert!(trips > 1);
    assert!(stored > load);
    // Back at work.
    for r in world.residents.iter().filter(|r| carry_of(r).is_none()) {
        assert_matches(&r.order, json!({ "kind": "workAt", "buildingId": farm.id }));
    }
    let broken: Vec<String> = check_all(&world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn refills_from_the_storage_when_low_on_food() {
    let (mut world, mut terrain, _) = farm_world();
    // A woodcutter with no food on them: no Food to keep from the load.
    let (ax, ay) = (6.0, 10.0);
    terrain.tiles[(10 * SIZE + 6) as usize] = Terrain::Forest as u8;
    world.nodes.push(ResourceNode { id: "n".into(), kind: ResourceKind::Forest, x: ax, y: ay });
    let mut camp = building("camp", BuildingKind::LumberCamp, ax, ay);
    camp.city_id = Some("c1".into());
    world.buildings.push(camp.clone());
    world.residents.clear();
    let w = add_worker(&mut world, "w1", &camp);
    world.residents[w].carried.clear();
    // Not getting food on their own: only storing the load tops their food up.
    world.residents[w].script_params =
        Some(serde_json::from_value(json!({ "1": { "foodAt": 0, "crewFood": 0 } })).unwrap());
    storage(&mut world, "s1", ax + 1.0, ay, stock(&[(Good::Food, 50.0)]));
    world.piles.push(Pile { id: "p".into(), x: ax, y: ay, goods: stock(&[(Good::Wood, 100.0)]) });
    let load = units_that_fit(&world.residents[w], Good::Wood, world.tick as f64);
    let mut runner = runner(&terrain, None);
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let mut went = false;
    for _ in 0..200 {
        if went && carry_of(&world.residents[w]).is_none() {
            break;
        }
        world.residents[w].hunger = MAX_HUNGER;
        runner.run_all(&mut world, &mut scratch, false);
        went |= carry_of(&world.residents[w]).is_some();
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    }
    assert!(went);
    assert!(carry_of(&world.residents[w]).is_none());
    assert_eq!(json_of(&world.residents[w].carried), json!({ "food": GET_FOOD_TAKE }));
    let s = world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(json_of(&s.stock), json!({ "food": 50.0 - GET_FOOD_TAKE, "wood": load }));
}

#[test]
fn leaves_the_pile_to_grow_with_no_finished_storage_of_the_realm() {
    let (mut world, terrain, farm) = farm_world();
    // Only another realm's storage, and a site of theirs not yet finished.
    elsewhere(&mut world);
    let mut theirs = building("theirs", BuildingKind::Storage, farm.x + 4.0, farm.y);
    theirs.city_id = Some("c2".into());
    world.buildings.push(theirs);
    let mut site = building("site", BuildingKind::Storage, farm.x + 6.0, farm.y);
    site.city_id = Some("c1".into());
    site.site = Some(ConstructionSite { work: 0.0, delivered: Stock::new() });
    world.buildings.push(site);
    world.piles.push(Pile {
        id: "p".into(),
        x: farm.x,
        y: farm.y,
        goods: stock(&[(Good::Food, 100.0)]),
    });
    runner(&terrain, None).run_all(&mut world, &mut Scratch::default(), false);
    assert!(carriers(&world).is_empty());
    assert!(world.residents.iter().all(|r| json_of(&r.order)["kind"] == "workAt"));
}

#[test]
fn carries_only_the_output_from_a_smelter() {
    let (mut world, terrain, _) = farm_world();
    world.residents.clear();
    world.nodes.push(ResourceNode { id: "n".into(), kind: ResourceKind::IronOre, x: 3.0, y: 12.0 });
    let mut smelter = building("smelter", BuildingKind::Smelter, 3.0, 12.0);
    smelter.city_id = Some("c1".into());
    world.buildings.push(smelter.clone());
    add_worker(&mut world, "w1", &smelter);
    storage(&mut world, "s1", 6.0, 12.0, Stock::new());
    world.piles.push(Pile {
        id: "p".into(),
        x: 3.0,
        y: 12.0,
        goods: stock(&[(Good::IronOre, 40.0), (Good::Iron, 40.0)]),
    });
    runner(&terrain, None).run_all(&mut world, &mut Scratch::default(), false);
    assert_eq!(
        json_of(&world.residents[0].order),
        json!({ "kind": "pickUp", "from": { "kind": "ground" }, "goods": { "iron": 40.0 } })
    );
}

#[test]
fn has_a_starting_citys_farmers_work_by_their_players_work_default() {
    let terrain = csp_sim::terrain_gen::generate_terrain(1, 1536);
    let mut world = create_world(&terrain, 1);
    csp_sim::starting_city::found_starting_city(&mut world, &terrain, 1, None);
    let farm = world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap().id.clone();
    for r in &world.residents {
        assert_eq!(
            json_of(&r.script),
            json!({ "scriptId": 0, "task": "work", "memory": { "workplaceId": farm } })
        );
    }
    let mut runner = runner(&terrain, Some(7));
    assert_eq!(run_all(&mut runner, &mut world, &mut Scratch::default()), Vec::<String>::new());
    for r in &world.residents {
        assert_eq!(r.script.as_ref().map(|s| s.script_id), Some(7));
        assert_matches(&r.order, json!({ "kind": "workAt", "buildingId": farm }));
    }
}

#[test]
fn flags_two_residents_of_a_workplace_away_carrying_at_once_adr_0004() {
    let (mut world, _, _) = farm_world();
    let carry = json!({ "storageId": "s1", "step": "store", "walked": true });
    let set = |r: &mut Resident| {
        r.script.as_mut().unwrap().memory.insert("carry".into(), carry.clone());
    };
    set(&mut world.residents[0]);
    assert!(one_carrier_at_a_time(&world, &|_| true).is_empty());
    set(&mut world.residents[1]);
    let found = one_carrier_at_a_time(&world, &|_| true);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "one-carrier-at-a-time");
    assert_eq!(found[0].entity_ids, ["farm", "w1", "w2"]);
    // NPC cities' residents are checked with the world; a Player's where their scripts run.
    let blank = TerrainMap { size: SIZE, tiles: vec![0; (SIZE * SIZE) as usize] };
    let broken: Vec<String> = check_all(&world, &blank).into_iter().map(|v| v.message).collect();
    assert_eq!(broken, Vec::<String>::new());
}
