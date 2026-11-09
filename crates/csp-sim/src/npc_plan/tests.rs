//! `npc-plan.test.ts`.

use std::collections::HashSet;

use csp_shared::balance::{NPC_BUILDERS, NPC_PLAN_TICKS, NPC_SURPLUS_CAP, NPC_VILLAGE, OWN_FOOD};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CityJob, CityJobKind, CityProject, CityScouted, Good, RunningScript,
    Stock, Task, WorldState,
};
use serde_json::json;

use super::{city_plans_sound, farmers_wanted, npc_farmers_kept, plan_city, plan_due};
use crate::invariants::check_all;
use crate::npc_behaviour::step_npc_cities;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{fill_houses, plains, village, Runner, Village, FOREST};
use crate::queries::building::max_workers;
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;
use crate::random::Mulberry32;
use crate::world::create_world;

/// The budget for the game-run cities' planning, in milliseconds per tick, averaged over two game
/// hours of 60 villages (ADR 0016; ADR 0004): a smoke check against a regression, not a hard gate.
/// The TypeScript's is 10 ms; the same run measured 6.2 ms there on a dev machine (2026-11-09).
/// The Rust measured 1.5–1.8 ms on that machine, and 3.6 ms with other test runs loading it; 6 ms
/// leaves room for a CI runner and still catches planning that gets much slower.
const PLAN_BUDGET_MS: f64 = 6.0;

const PLAN_TICKS: usize = NPC_PLAN_TICKS as usize;

/// `n` villages in a grid on a Plains map, each with its own town hall and farm (`villages`).
fn villages(n: usize) -> (WorldState, TerrainMap, Vec<String>) {
    let side = (n as f64).sqrt().ceil() as i32;
    let step = NPC_VILLAGE.size as i32 + 20;
    let terrain = plains(side * step + 40);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(11.0);
    let mut cities = Vec::new();
    for i in 0..n as i32 {
        let x = 20 + (i % side) * step;
        let y = 20 + (i / side) * step;
        cities.push(found_npc_city(
            &mut world,
            &terrain,
            &NPC_VILLAGE,
            x,
            y,
            &mut || m.next(),
            None,
        ));
    }
    (world, terrain, cities)
}

fn set_stock(v: &mut Village, stock: Stock) {
    let i = v.storage();
    v.world.buildings[i].stock = Some(stock);
}

fn plan(v: &mut Village) {
    let city = v.city.clone();
    plan_city(&mut v.world, &city, Some(&v.terrain), None, None);
}

fn jobs(v: &Village) -> &indexmap::IndexMap<String, CityJob> {
    &v.world.city_plans[&v.city].jobs
}

fn job(kind: CityJobKind, building: Option<&str>) -> CityJob {
    serde_json::from_value(json!({ "kind": kind, "buildingId": building })).unwrap()
}

fn farm_of(v: &Village) -> String {
    v.world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(v.city.as_str()))
        .expect("a farm")
        .id
        .clone()
}

fn lumber_camp() -> Option<CityProject> {
    Some(CityProject::Build {
        building: BuildingKind::LumberCamp,
        x: f64::from(FOREST.0),
        y: f64::from(FOREST.1),
    })
}

fn step(v: &mut Village) -> f64 {
    step_npc_cities(&mut v.world, v.terrain.size, Some(&v.terrain), None)
}

// planCity

#[test]
fn gives_every_adult_a_job_soldiers_stand_farmers_feed_the_city_two_build_one_scouts_the_rest_wait()
{
    let mut v = village(None);
    let (hx, hy) = (v.home.x, v.home.y);
    for r in &mut v.world.residents {
        (r.x, r.y, r.order, r.script) = (hx, hy, None, None);
    }
    v.world.residents[0].carried.insert(Good::Spear, 1.0);
    // Food at its cap past the reserve, so nobody farms for surplus (`CONTEXT.md`: Spare hands'
    // work).
    let food = held(&npc_reserve(&v.world, v.city()), Good::Food)
        + NPC_SURPLUS_CAP.get("food").unwrap_or(0.0);
    let i = v.storage();
    v.world.buildings[i].stock.get_or_insert_with(Stock::new).insert(Good::Food, food);
    plan(&mut v);
    let plan = &v.world.city_plans[&v.city];
    assert_eq!(plan.planned_at, v.world.tick as f64);
    let farm = farm_of(&v);
    let jobs: Vec<Option<&CityJob>> =
        v.world.residents.iter().map(|r| plan.jobs.get(&r.id)).collect();
    assert_eq!(jobs[0], Some(&job(CityJobKind::Soldier, None)));
    // As many farmers as feed the village, which has a food surplus: no more.
    let count = |k: CityJobKind| jobs.iter().filter(|j| j.is_some_and(|j| j.kind == k)).count();
    let farmers = count(CityJobKind::Farm);
    assert_eq!(farmers as f64, farmers_wanted(&v.world, v.city()));
    assert!((farmers as f64) < NPC_VILLAGE.residents - 1.0);
    for j in jobs.iter().flatten().filter(|j| j.kind == CityJobKind::Farm) {
        assert_eq!(*j, &job(CityJobKind::Farm, Some(&farm)));
    }
    // Its reserve lacks Wood: two build the lumber camp; the last scouts, and any more wait.
    assert_eq!(plan.project, lumber_camp());
    assert_eq!(count(CityJobKind::Build) as f64, NPC_BUILDERS);
    let scouts = count(CityJobKind::Scout);
    assert!(scouts <= 1);
    assert_eq!(
        count(CityJobKind::Idle) as f64,
        NPC_VILLAGE.residents - 1.0 - farmers as f64 - NPC_BUILDERS - scouts as f64
    );
    assert_eq!(check_all(&v.world, &v.terrain), []);
}

#[test]
fn keeps_a_worker_where_they_are_and_sends_at_most_two_spare_hands_to_build() {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    // Food plenty, and below its cap (`CONTEXT.md`: Spare hands' work).
    let food = held(&npc_reserve(&v.world, v.city()), Good::Food) + 1.0;
    set_stock(&mut v, Stock::from([(Good::Food, food)]));
    // It knows its limit, so nobody leaves the farm to scout (`CONTEXT.md`: Scout).
    v.city_mut().scouted = Some(CityScouted { sectors: vec![], no_way: None, done: Some(true) });
    plan(&mut v);
    // Everyone from the founding still works the farm; two newcomers build the lumber camp the
    // house wants Wood from, and the rest take the farm's places left, or wait for the next pass.
    let farm = farm_of(&v);
    let kinds: Vec<CityJobKind> = jobs(&v).values().map(|j| j.kind).collect();
    let count = |k: CityJobKind| kinds.iter().filter(|x| **x == k).count() as f64;
    assert_eq!(count(CityJobKind::Build), NPC_BUILDERS);
    assert!(count(CityJobKind::Farm) <= max_workers(BuildingKind::Farm).unwrap());
    assert!(kinds
        .iter()
        .all(|k| matches!(k, CityJobKind::Farm | CityJobKind::Build | CityJobKind::Idle)));
    assert_eq!(v.world.city_plans[&v.city].project, lumber_camp());
    for r in v.world.residents.iter().take(NPC_VILLAGE.residents as usize) {
        assert_eq!(jobs(&v).get(&r.id), Some(&job(CityJobKind::Farm, Some(&farm))));
    }
}

#[test]
fn hands_idle_residents_their_planned_job_in_the_tick_and_picks_the_next_project_once_one_is_done()
{
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, Stock::from([(Good::Food, 400.0), (Good::Wood, 100.0)]));
    // Carrying their own Food, so nobody fetches or stores Food first.
    for r in &mut v.world.residents {
        r.carried.insert(Good::Food, OWN_FOOD);
    }
    plan(&mut v);
    let planned_at = v.world.city_plans[&v.city].planned_at;
    let house = v.world.city_plans[&v.city].project.clone();
    let Some(CityProject::Build { building: BuildingKind::House, x, y }) = house else {
        panic!("a house to build: {house:?}");
    };
    assert!(step(&mut v) >= 0.0);
    let builders: Vec<usize> = (0..v.world.residents.len())
        .filter(|&i| {
            v.world.residents[i]
                .script
                .as_ref()
                .is_some_and(|s| s.script_id == 0 && s.task == Some(Task::Build))
        })
        .collect();
    assert_eq!(builders.len() as f64, NPC_BUILDERS);
    // The house stands: the builders are free, and the city picks its next project without
    // waiting for the next pass.
    let built = crate::test_support::building("built", BuildingKind::House, Some(&v.city), x, y);
    v.world.buildings.push(built);
    for i in builders {
        v.world.residents[i].order = None;
        v.world.residents[i].script = None;
    }
    v.world.tick += 1;
    assert!(!plan_due(&v.world, &v.city));
    step(&mut v);
    assert_ne!(v.world.city_plans[&v.city].project, house);
    assert_eq!(v.world.city_plans[&v.city].planned_at, planned_at);
}

#[test]
fn moves_workers_off_the_other_workplaces_to_the_farms_while_food_runs_short() {
    let mut v = village(None);
    let farm = farm_of(&v);
    let camp = crate::test_support::building(
        "camp",
        BuildingKind::LumberCamp,
        Some(&v.city),
        f64::from(FOREST.0),
        f64::from(FOREST.1),
    );
    v.world.buildings.push(camp);
    let work: RunningScript = serde_json::from_value(
        json!({ "scriptId": 0, "task": "work", "memory": { "workplaceId": "camp" } }),
    )
    .unwrap();
    for i in [0, 1] {
        v.world.residents[i].order = None;
        v.world.residents[i].script = Some(work.clone());
    }
    let (a, b) = (v.world.residents[0].id.clone(), v.world.residents[1].id.clone());
    set_stock(&mut v, Stock::from([(Good::Food, 1000.0)]));
    plan(&mut v);
    assert_eq!(jobs(&v).get(&a), Some(&job(CityJobKind::Work, Some("camp"))));
    set_stock(&mut v, Stock::new());
    plan(&mut v);
    // The farm has room for two more: both move.
    assert_eq!(jobs(&v).get(&a), Some(&job(CityJobKind::Farm, Some(&farm))));
    assert_eq!(jobs(&v).get(&b), Some(&job(CityJobKind::Farm, Some(&farm))));
    // In the next tick they leave the camp for the farm.
    step(&mut v);
    for i in [0, 1] {
        let place = v.world.residents[i].script.as_ref().and_then(|s| s.memory.get("workplaceId"));
        assert_eq!(place, Some(&json!(farm)));
    }
}

// cities plan once a game hour

fn planned_now(world: &WorldState) -> HashSet<String> {
    world
        .city_plans
        .iter()
        .filter(|(_, p)| p.planned_at == world.tick as f64)
        .map(|(id, _)| id.clone())
        .collect()
}

#[test]
fn plans_each_city_once_a_game_hour_about_one_city_per_tick() {
    let (mut world, terrain, cities) = villages(60);
    let mut per_tick = Vec::new();
    for _ in 0..PLAN_TICKS {
        let before = planned_now(&world).len();
        step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
        per_tick.push(planned_now(&world).len() - before);
        world.tick += 1;
    }
    assert_eq!(per_tick.iter().sum::<usize>(), cities.len());
    assert!(per_tick.iter().max().copied().unwrap_or(0) <= 6);
    let first: Vec<f64> = cities.iter().map(|c| world.city_plans[c].planned_at).collect();
    for _ in 0..PLAN_TICKS {
        step_npc_cities(&mut world, terrain.size, Some(&terrain), None);
        world.tick += 1;
    }
    let again: Vec<f64> = cities.iter().map(|c| world.city_plans[c].planned_at).collect();
    assert_eq!(again, first.iter().map(|t| t + NPC_PLAN_TICKS).collect::<Vec<_>>());
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn keeps_a_full_maps_planning_inside_its_budget() {
    let (mut world, terrain, _) = villages(60);
    // The cities' own step, with the walking's way finder, as `stepWorld` runs it: the rest of the
    // tick (the residents' scripts above all) would take the test past 5 s without adding to
    // `npcPlanMs`.
    let mut runner = Runner::new(&terrain);
    let mut ms = 0.0;
    for _ in 0..2 * PLAN_TICKS {
        let ways: &mut dyn crate::npc_roads::WayFinder = &mut runner.walking;
        ms += step_npc_cities(&mut world, terrain.size, Some(&terrain), Some(ways));
        world.tick += 1;
    }
    let per_tick = ms / (2 * PLAN_TICKS) as f64;
    eprintln!("planning: {per_tick:.3} ms a tick");
    assert!(per_tick < PLAN_BUDGET_MS, "{per_tick} ms a tick");
}

#[test]
fn drops_the_plan_of_a_city_the_game_no_longer_runs() {
    let mut v = village(None);
    plan(&mut v);
    v.city_mut().realm_id = Some("realm1".into());
    assert!(check_all(&v.world, &v.terrain).iter().any(|x| x.invariant == "city-plans-sound"));
    step(&mut v);
    assert!(v.world.city_plans.is_empty());
}

#[test]
fn catches_a_plan_that_works_a_site_or_a_building_that_isnt_a_workplace() {
    let mut v = village(None);
    plan(&mut v);
    let r = v.world.residents[0].id.clone();
    let home = v.home.id.clone();
    let city = v.city.clone();
    let set = |v: &mut Village, j: CityJob| {
        v.world.city_plans.get_mut(&city).unwrap().jobs.insert(r.clone(), j);
    };
    set(&mut v, job(CityJobKind::Work, Some(&home)));
    assert_eq!(city_plans_sound(&v.world).len(), 1);
    // A planned building that is gone is stale, not wrong.
    set(&mut v, job(CityJobKind::Work, Some("gone")));
    assert_eq!(city_plans_sound(&v.world), []);
    // Nor a workplace that isn't the city's.
    let theirs: Building = crate::test_support::building(
        "theirs",
        BuildingKind::LumberCamp,
        None,
        f64::from(FOREST.0),
        f64::from(FOREST.1),
    );
    v.world.buildings.push(theirs);
    set(&mut v, job(CityJobKind::Work, Some("theirs")));
    assert_eq!(city_plans_sound(&v.world).len(), 1);
}

#[test]
fn catches_a_plan_that_leaves_an_adult_idle_while_the_farms_lack_farmers() {
    let mut v = village(None);
    plan(&mut v);
    assert_eq!(npc_farmers_kept(&v.world), []);
    let plan = v.world.city_plans.get_mut(&v.city).unwrap();
    for j in plan.jobs.values_mut() {
        if j.kind == CityJobKind::Farm {
            *j = job(CityJobKind::Idle, None);
        }
    }
    let idle = plan.jobs.values().filter(|j| j.kind == CityJobKind::Idle).count();
    let found = npc_farmers_kept(&v.world).len();
    assert!(found >= 1);
    assert!(found <= idle);
    // A plan of an earlier tick is not held to it: residents come and go since.
    v.world.tick += 1;
    assert_eq!(npc_farmers_kept(&v.world), []);
}
