//! `apps/server/src/npc-standing-idle.test.ts`: Standing idle (`CONTEXT.md`): an NPC city's idle
//! adults wait at its houses, not on its storage.

mod ts_match;

use std::sync::Arc;

use csp_shared::balance::{ticks_for_age, NPC_VILLAGE, OWN_FOOD};
use csp_shared::footprint::{is_at, Placed};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityJob, Good, Resident, ResidentOrder, TradeOrgCity, WorldState,
};
use csp_sim::invariants::{check_all, invariant_named};
use csp_sim::npc_behaviour::{npc_home, step_npc_cities};
use csp_sim::npc_cities::found_npc_city;
use csp_sim::npc_plan::plan_city;
use csp_sim::random::Mulberry32;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::json;
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 128;

/// A village alone on an open map, its residents free and on its storage.
struct Village {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: Building,
}

fn village() -> Village {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    let storage = npc_home(&world, &city).expect("a storage").clone();
    for r in &mut world.residents {
        (r.x, r.y) = (storage.x, storage.y);
        r.order = None;
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.script = None;
    }
    Village { world, terrain, city, storage }
}

fn job(kind: serde_json::Value) -> CityJob {
    serde_json::from_value(kind).expect("a job")
}

/// The pass just ran and left all of the city's adults with nothing to do (`allIdle`).
fn all_idle(world: &mut WorldState, city: &str) {
    plan_city(world, city, None, None, None);
    let ids: Vec<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    let plan = world.city_plans.get_mut(city).expect("a plan");
    plan.jobs = ids.into_iter().map(|id| (id, job(json!({ "kind": "idle" })))).collect();
}

fn houses_of(world: &WorldState, city: &str) -> Vec<Building> {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::House && b.city_id.as_deref() == Some(city))
        .cloned()
        .collect()
}

fn placed(b: &Building) -> Placed<'static> {
    Placed { kind: kind_name(b.kind), x: b.x as i32, y: b.y as i32 }
}

fn kind_name(kind: BuildingKind) -> &'static str {
    match json_of(&kind).as_str().expect("a kind name") {
        "house" => "house",
        "storage" => "storage",
        other => panic!("no footprint wanted for {other}"),
    }
}

fn on(at: (f64, f64), b: &Building) -> bool {
    is_at((at.0 as i32, at.1 as i32), placed(b), SIZE)
}

fn walk_target(r: &Resident) -> Option<(f64, f64)> {
    match &r.order {
        Some(ResidentOrder::WalkTo(w)) => Some((w.target.x, w.target.y)),
        _ => None,
    }
}

fn stand(r: &mut Resident, at: (f64, f64)) {
    (r.x, r.y) = at;
    r.order = None;
}

fn npc_step(world: &mut WorldState) {
    step_npc_cities(world, SIZE, None, None);
}

fn at_a_house(world: &WorldState, city: &str, t: Option<(f64, f64)>) -> bool {
    let t = t.expect("a walk");
    houses_of(world, city).iter().any(|h| on(t, h))
}

#[test]
fn idle_adults_walk_to_a_house_spread_over_the_houses_and_stay_there() {
    let Village { mut world, city, .. } = village();
    assert!(houses_of(&world, &city).len() > 1);
    all_idle(&mut world, &city);
    npc_step(&mut world);
    let targets: Vec<Option<(f64, f64)>> = world.residents.iter().map(walk_target).collect();
    for t in &targets {
        assert!(at_a_house(&world, &city, *t));
    }
    let spots: std::collections::HashSet<String> =
        targets.iter().map(|t| format!("{:?}", t.unwrap())).collect();
    assert!(spots.len() > 1);

    // There, the next passes leave them be: one walk, then nothing.
    for (r, t) in world.residents.iter_mut().zip(&targets) {
        stand(r, t.unwrap());
    }
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(world.residents.iter().all(|r| r.order.is_none()));
}

#[test]
fn takes_those_carrying_a_child_and_children_there_too() {
    let Village { mut world, city, .. } = village();
    let tick = world.tick as f64;
    world.residents[0].carrying = Some(
        // The TypeScript gives only these two; the rest is what the type needs.
        serde_json::from_value(json!({
            "partnerId": "nobody", "since": tick - 2.0, "partnerName": "Nobody",
            "partnerBase": { "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 }
        }))
        .expect("carrying"),
    );
    world.residents[1].born_at = tick - ticks_for_age(1.0);
    all_idle(&mut world, &city);
    npc_step(&mut world);
    for r in &world.residents[0..2] {
        assert!(at_a_house(&world, &city, walk_target(r)));
    }
}

#[test]
fn a_new_house_moves_nobody() {
    let Village { mut world, city, .. } = village();
    let house = houses_of(&world, &city)[0].clone();
    for r in &mut world.residents {
        stand(r, (house.x, house.y));
    }
    world.buildings.push(Building {
        id: "new-house".into(),
        x: house.x + 4.0,
        y: house.y + 4.0,
        ..house
    });
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(world.residents.iter().all(|r| r.order.is_none()));
}

#[test]
fn sets_off_when_the_pass_runs_but_at_once_from_outside_the_city() {
    let Village { mut world, city, .. } = village();
    all_idle(&mut world, &city);
    world.tick += 1;
    stand(&mut world.residents[1], (110.0, 110.0));
    npc_step(&mut world);
    assert!(world.residents[0].order.is_none());
    assert!(at_a_house(&world, &city, walk_target(&world.residents[1])));
}

#[test]
fn doesnt_walk_back_to_the_storage_for_food_once_it_has_eaten() {
    let Village { mut world, city, .. } = village();
    let house = houses_of(&world, &city)[0].clone();
    let r = &mut world.residents[0];
    r.carried.insert(Good::Food, OWN_FOOD - 1.0);
    stand(r, (house.x, house.y));
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(world.residents[0].order.is_none());
}

#[test]
fn stands_at_a_house_for_days_eating_and_leaves_when_given_a_job() {
    let Village { mut world, terrain, city, storage } = village();
    let map = Arc::new(terrain.clone());
    let mut walking = Walking::new(map);
    world
        .buildings
        .iter_mut()
        .find(|b| b.id == storage.id)
        .unwrap()
        .stock
        .get_or_insert_with(Default::default)
        .insert(Good::Food, 5000.0);
    let house = houses_of(&world, &city)[0].clone();
    let id = world.residents[0].id.clone();
    stand(&mut world.residents[0], (house.x, house.y));
    let before = world.residents[0].carried.get(&Good::Food).copied().unwrap_or(0.0);
    assert!(before > 0.0);
    let mut scratch = Scratch::default();
    for _ in 0..2 * TICKS_PER_GAME_DAY as usize {
        // Keeping them idle by hand, as the planner would find them work in a village this
        // small.
        if let Some(plan) = world.city_plans.get_mut(&city) {
            plan.jobs.insert(id.clone(), job(json!({ "kind": "idle" })));
        }
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        let r = &mut world.residents[0];
        if matches!(r.order, Some(ResidentOrder::WalkTo(_))) {
            r.order = None;
        }
        assert!(on((r.x, r.y), &house));
    }
    let r = &world.residents[0];
    assert!(r.health > 0.0);
    assert!(r.carried.get(&Good::Food).copied().unwrap_or(0.0) > 0.0);

    let farm = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str()))
        .expect("a farm")
        .id
        .clone();
    plan_city(&mut world, &city, None, None, None);
    let plan = world.city_plans.get_mut(&city).expect("a plan");
    plan.jobs.insert(id, job(json!({ "kind": "farm", "buildingId": farm })));
    let r = &mut world.residents[0];
    r.order = None;
    r.script = None;
    r.carried.insert(Good::Food, OWN_FOOD);
    npc_step(&mut world);
    // Fetching what they lack to set out with comes first; either way they are off.
    let r = &world.residents[0];
    assert!(json_of(&r.script)["task"] == "work" || r.order.is_some());
}

#[test]
fn calls_off_the_walk_to_a_house_when_the_pass_finds_them_a_job() {
    let Village { mut world, city, storage, .. } = village();
    let farm = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str()))
        .expect("a farm")
        .id
        .clone();
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(walk_target(&world.residents[0]).is_some());
    world.tick += 1;
    plan_city(&mut world, &city, None, None, None);
    let id = world.residents[0].id.clone();
    let plan = world.city_plans.get_mut(&city).expect("a plan");
    plan.jobs = [(id, job(json!({ "kind": "farm", "buildingId": farm })))].into_iter().collect();
    npc_step(&mut world);
    let r = &world.residents[0];
    assert_matches(&r.script, json!({ "task": "work", "memory": { "workplaceId": farm } }));
    assert!(on((r.x, r.y), &storage));
}

#[test]
fn leaves_soldiers_to_come_home_as_before() {
    let Village { mut world, city, storage, .. } = village();
    let house = houses_of(&world, &city)[0].clone();
    let r = &mut world.residents[0];
    r.carried.insert(Good::Food, OWN_FOOD - 1.0);
    stand(r, (house.x, house.y));
    let id = r.id.clone();
    all_idle(&mut world, &city);
    world.city_plans.get_mut(&city).unwrap().jobs.insert(id, job(json!({ "kind": "soldier" })));
    npc_step(&mut world);
    // Their Food from the storage, and no house after: they stay where the food fetch left them.
    assert_eq!(walk_target(&world.residents[0]), Some((storage.x, storage.y)));
    let r = &mut world.residents[0];
    stand(r, (storage.x, storage.y));
    r.carried.insert(Good::Food, OWN_FOOD);
    npc_step(&mut world);
    assert!(world.residents[0].order.is_none());
}

#[test]
fn a_city_with_no_house_stands_at_its_home_as_before() {
    let Village { mut world, city, storage, .. } = village();
    world.buildings.retain(|b| b.kind != BuildingKind::House);
    stand(&mut world.residents[1], (110.0, 110.0));
    let tick = world.tick as f64;
    world.residents[2].born_at = tick - ticks_for_age(1.0);
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(world.residents[0].order.is_none());
    assert_eq!(walk_target(&world.residents[1]), Some((storage.x, storage.y)));
    assert!(world.residents[2].order.is_none());
}

#[test]
fn leaves_a_trade_org_city_as_it_was() {
    let Village { mut world, city, .. } = village();
    world.cities.iter_mut().find(|c| c.id == city).unwrap().trade_org = Some(TradeOrgCity::Post);
    let tick = world.tick as f64;
    world.residents[1].born_at = tick - ticks_for_age(1.0);
    all_idle(&mut world, &city);
    npc_step(&mut world);
    assert!(world.residents[0].order.is_none());
    assert!(world.residents[1].order.is_none());
}

#[test]
fn has_an_invariant_against_a_crowd_of_idle_on_the_storage() {
    let Village { mut world, terrain, city, storage } = village();
    all_idle(&mut world, &city);
    let mut i = 0;
    while world.residents.len() < 14 {
        let mut extra = world.residents[0].clone();
        extra.id = format!("extra{i}");
        extra.carried.clear();
        world.residents.push(extra);
        i += 1;
    }
    all_idle(&mut world, &city);
    let idle = |w: &WorldState| {
        (invariant_named("npc-idle-off-the-storage").expect("an invariant").check)(w, &terrain)
    };
    assert_eq!(idle(&world).len(), 1);
    assert!(check_all(&world, &terrain).iter().any(|v| v.invariant == "npc-idle-off-the-storage"));
    // Sent on their way, they aren't one.
    npc_step(&mut world);
    assert!(idle(&world).is_empty());
    // Nor is a city with no house.
    for r in &mut world.residents {
        stand(r, (storage.x, storage.y));
    }
    world.buildings.retain(|b| b.kind != BuildingKind::House);
    assert!(idle(&world).is_empty());
}
