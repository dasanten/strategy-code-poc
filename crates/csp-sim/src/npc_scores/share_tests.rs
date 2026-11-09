//! The rest of `npc-scores.test.ts`: a city shares out its adults by the scores.

use csp_shared::balance::NPC_BUILDERS;
use csp_shared::world::{
    BuildingKind, CityJob, CityJobKind, CityScouted, Good, RunningScript, Stock,
};
use indexmap::IndexMap;
use serde_json::json;

use crate::npc_plan::{farmers_wanted, plan_city};
use crate::npc_test_world::{fill_houses, village, Village, FOREST};
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;

/// The village, full, with all its adults free at home, a lumber camp and a smithy
/// (`workshop`).
fn workshop() -> Village {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    let (hx, hy) = (v.home.x, v.home.y);
    for r in &mut v.world.residents {
        (r.x, r.y, r.order, r.script) = (hx, hy, None, None);
    }
    let (fx, fy) = (f64::from(FOREST.0), f64::from(FOREST.1));
    let b = crate::test_support::building;
    v.world.buildings.push(b("camp", BuildingKind::LumberCamp, None, fx, fy));
    v.world.buildings.push(b("smithy", BuildingKind::Smithy, None, fx, fy + 10.0));
    let city = v.city_mut();
    city.workplace_ids = Some(vec!["camp".into(), "smithy".into()]);
    // It knows its limit, so nobody goes scouting (`CONTEXT.md`: Scout).
    city.scouted = Some(CityScouted { sectors: vec![], no_way: None, done: Some(true) });
    v
}

/// How many of the jobs work `id` (`at`).
fn at(jobs: &IndexMap<String, CityJob>, id: &str) -> usize {
    jobs.values().filter(|j| j.building_id.as_deref() == Some(id)).count()
}

fn set_stock(v: &mut Village, stock: Stock) {
    let i = v.storage();
    v.world.buildings[i].stock = Some(stock);
}

fn at_camp() -> RunningScript {
    serde_json::from_value(
        json!({ "scriptId": 0, "task": "work", "memory": { "workplaceId": "camp" } }),
    )
    .unwrap()
}

fn plan(v: &mut Village) -> IndexMap<String, CityJob> {
    let city = v.city.clone();
    plan_city(&mut v.world, &city, Some(&v.terrain), None, None);
    v.world.city_plans[&city].jobs.clone()
}

#[test]
fn picks_farmers_while_food_is_short() {
    let mut v = workshop();
    set_stock(&mut v, Stock::new());
    v.world.residents[0].script = Some(at_camp());
    let jobs = plan(&mut v);
    // Everyone goes to the farm, its room being enough: the worker off the camp too.
    let kinds: Vec<CityJobKind> = jobs.values().map(|j| j.kind).collect();
    assert_eq!(kinds, vec![CityJobKind::Farm; v.world.residents.len()]);
}

#[test]
fn picks_what_is_shortest_next_filling_its_crew_before_the_next_good() {
    let mut v = workshop();
    let wood = (held(&npc_reserve(&v.world, v.city()), Good::Wood) / 2.0).ceil();
    set_stock(&mut v, Stock::from([(Good::Food, 1000.0), (Good::Wood, wood), (Good::Iron, 10.0)]));
    let jobs = plan(&mut v);
    let farmers = jobs.values().filter(|j| j.kind == CityJobKind::Farm).count();
    let builders = jobs.values().filter(|j| j.kind == CityJobKind::Build).count();
    assert_eq!(farmers as f64, farmers_wanted(&v.world, v.city()));
    assert_eq!(builders as f64, NPC_BUILDERS);
    // Spears lack all of what it wants, Wood half: the rest smith, and the camp gets nobody yet.
    assert_eq!(at(&jobs, "smithy"), jobs.len() - farmers - builders);
    assert_eq!(at(&jobs, "camp"), 0);
}

#[test]
fn doesnt_move_a_worker_for_a_small_difference() {
    let mut v = workshop();
    let reserve = npc_reserve(&v.world, v.city());
    let wood = reserve.get(&Good::Wood).copied().unwrap_or(1.0) - 1.0;
    set_stock(&mut v, Stock::from([(Good::Food, 1000.0), (Good::Wood, wood), (Good::Iron, 10.0)]));
    v.world.residents[0].script = Some(at_camp());
    let worker = v.world.residents[0].id.clone();
    let jobs = plan(&mut v);
    // Spears are shorter by far, and their smithy has room; the one on Wood stays there all the
    // same.
    let job = &jobs[&worker];
    assert_eq!((job.kind, job.building_id.as_deref()), (CityJobKind::Work, Some("camp")));
    assert!(at(&jobs, "smithy") > 0);
}

#[test]
fn moves_a_worker_for_what_beats_theirs_by_the_margin_a_farm_lacking_farmers() {
    let mut v = workshop();
    set_stock(&mut v, Stock::from([(Good::Food, 1000.0), (Good::Wood, 0.0)]));
    v.world.residents[0].script = Some(at_camp());
    let worker = v.world.residents[0].id.clone();
    // Everyone else is armed, so the farm has nobody free to take but the worker.
    for r in v.world.residents.iter_mut().skip(1) {
        r.carried.insert(Good::Spear, 1.0);
    }
    let jobs = plan(&mut v);
    assert_eq!(jobs[&worker].kind, CityJobKind::Farm);
}
