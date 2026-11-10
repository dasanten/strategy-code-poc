//! `apps/server/src/npc-revive.test.ts`, ported (T86.17, part 5): an NPC city revives its own
//! (`CONTEXT.md`: Reviving), one grown resident per Down resident in or near its area, never a
//! soldier and a spare hand first, while its storage holds Food.

use std::collections::BTreeMap;

use csp_shared::balance::{CITY_AREA_MARGIN, NPC_REVIVE_REACH, NPC_TOWN};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::goods::WEAPONS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CityJobKind, Good, ResidentOrder, ResourceKind, ResourceNode, Stock,
    WorldState,
};
use serde_json::{json, Value};

use super::npc_revivers;
use crate::invariants::check_all;
use crate::npc_behaviour::{npc_home, put_to_work, step_npc_cities, stop_work};
use crate::npc_cities::found_npc_city;
use crate::npc_plan::{farmers_wanted, plan_city};
use crate::npc_test_world::{plains, Runner};
use crate::queries::names::kind_name;
use crate::queries::residents::can_work;
use crate::random::Mulberry32;
use crate::survival::go_down;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// A contains B as `toMatchObject` reads it (objects by their fields, numbers by value).
fn contains(got: &Value, want: &Value) -> bool {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => {
            w.iter().all(|(k, v)| g.get(k).is_some_and(|x| contains(x, v)))
        }
        (Value::Number(g), Value::Number(w)) => g.as_f64() == w.as_f64(),
        _ => got == want,
    }
}

struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    /// Where in `world.buildings` the storage stands.
    storage: usize,
    /// Where in `world.residents` the adults of the town stand.
    adults: Vec<usize>,
}

/// A town alone on Plains with plenty of Food, and its adults, nobody armed.
fn town() -> Town {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let home = npc_home(&world, &city).unwrap().id.clone();
    let storage = world.buildings.iter().position(|b| b.id == home).unwrap();
    set_food(&mut world, storage, 1000.0);
    let tick = world.tick as f64;
    let adults: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.city_id.as_deref() == Some(city.as_str()) && can_work(r.born_at, tick)
        })
        .collect();
    for &i in &adults {
        for w in WEAPONS {
            world.residents[i].carried.shift_remove(&from::<Good>(json!(w)));
        }
    }
    Town { world, terrain, city, storage, adults }
}

/// The storage's Food set to `food`, its other goods kept.
fn set_food(world: &mut WorldState, storage: usize, food: f64) {
    world.buildings[storage].stock.get_or_insert_with(Stock::new).insert(Good::Food, food);
}

/// Those a plan sends to revive, as resident id → Down resident's id.
fn revivers(world: &WorldState, city: &str) -> BTreeMap<String, String> {
    let Some(plan) = world.city_plans.get(city) else { return BTreeMap::new() };
    plan.jobs
        .iter()
        .filter(|(_, j)| j.kind == CityJobKind::Revive)
        .map(|(id, j)| (id.clone(), j.target_id.clone().unwrap()))
        .collect()
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

fn id(world: &WorldState, i: usize) -> String {
    world.residents[i].id.clone()
}

fn plan(t: &mut Town) {
    plan_city(&mut t.world, &t.city, None, None, None);
}

fn step_cities(t: &mut Town) {
    step_npc_cities(&mut t.world, t.terrain.size, None, None);
}

/// Arms all of `people`, so they are soldiers.
fn arm(world: &mut WorldState, people: &[usize]) {
    for &i in people {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
}

/// Lays resident `i` Down `tiles` outside the edge of the town's area, due east of its easternmost
/// building.
fn laid_outside(world: &mut WorldState, city: &str, i: usize, tiles: f64) {
    let edge = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city))
        .map(|b| {
            b.x + f64::from(FOOTPRINT.get(kind_name(b.kind)).unwrap()) - 1.0 + CITY_AREA_MARGIN
        })
        .fold(f64::MIN, f64::max);
    let home_y = npc_home(world, city).unwrap().y;
    world.residents[i].x = edge + tiles;
    world.residents[i].y = home_y;
    go_down(world, i);
}

fn is_down(world: &WorldState, i: usize) -> bool {
    world.residents[i].down_until.is_some()
}

fn index_of(world: &WorldState, id: &str) -> usize {
    world.residents.iter().position(|r| r.id == id).unwrap()
}

// who goes

#[test]
fn sends_one_reviver_who_wakes_a_down_resident_near_the_area() {
    let mut t = town();
    let down = t.adults[0];
    laid_outside(&mut t.world, &t.city, down, 10.0);
    let mut runner = Runner::new(&t.terrain);
    for _ in 0..600 {
        if !is_down(&t.world, down) {
            break;
        }
        runner.step(&mut t.world, &t.terrain);
        assert_eq!(check_all(&t.world, &t.terrain), []);
    }
    assert!(!is_down(&t.world, down));
    assert!(t.world.residents[down].health > 0.0);
}

#[test]
fn fetches_one_near_its_area_but_not_one_far_out() {
    let mut t = town();
    let (near, far) = (t.adults[0], t.adults[1]);
    laid_outside(&mut t.world, &t.city, near, NPC_REVIVE_REACH);
    laid_outside(&mut t.world, &t.city, far, NPC_REVIVE_REACH + 1.0);
    plan(&mut t);
    let sent: Vec<String> = revivers(&t.world, &t.city).into_values().collect();
    assert_eq!(sent, vec![id(&t.world, near)]);
}

#[test]
fn sends_nobody_with_no_food_in_the_storage_whatever_they_carry() {
    let mut t = town();
    set_food(&mut t.world, t.storage, 0.0);
    go_down(&mut t.world, t.adults[0]);
    plan(&mut t);
    assert!(revivers(&t.world, &t.city).is_empty());
}

#[test]
fn gets_two_revivers_for_two_down_and_keeps_them_from_pass_to_pass() {
    let mut t = town();
    let (a, b) = (t.adults[0], t.adults[1]);
    go_down(&mut t.world, a);
    go_down(&mut t.world, b);
    plan(&mut t);
    let first = revivers(&t.world, &t.city);
    let targets: Vec<String> = first.values().cloned().collect();
    assert_eq!(sorted(targets.clone()), sorted(vec![id(&t.world, a), id(&t.world, b)]));
    assert_eq!(targets.iter().collect::<std::collections::HashSet<_>>().len(), 2);
    t.world.tick += 1;
    plan(&mut t);
    assert_eq!(revivers(&t.world, &t.city), first);
}

#[test]
fn replaces_a_reviver_who_goes_down_and_gets_one_for_them_too() {
    let mut t = town();
    let down = t.adults[0];
    go_down(&mut t.world, down);
    plan(&mut t);
    let sent = revivers(&t.world, &t.city);
    let reviver = t.world.residents.iter().position(|r| sent.contains_key(&r.id)).unwrap();
    go_down(&mut t.world, reviver);
    t.world.tick += 1;
    plan(&mut t);
    let now = revivers(&t.world, &t.city);
    let reviver_id = id(&t.world, reviver);
    assert!(!now.contains_key(&reviver_id));
    assert_eq!(sorted(now.into_values().collect()), sorted(vec![id(&t.world, down), reviver_id]));
}

#[test]
fn replaces_a_reviver_who_is_killed() {
    let mut t = town();
    let down = t.adults[0];
    go_down(&mut t.world, down);
    plan(&mut t);
    let reviver_id = revivers(&t.world, &t.city).into_keys().next().unwrap();
    t.world.residents.retain(|r| r.id != reviver_id);
    t.world.tick += 1;
    plan(&mut t);
    let now = revivers(&t.world, &t.city);
    assert_eq!(
        now.values().cloned().collect::<Vec<_>>(),
        vec![t.world.residents[down_index(&t, down)].id.clone()]
    );
    assert!(!now.contains_key(&reviver_id));
}

/// Where the Down resident stands after residents were removed from the list.
fn down_index(t: &Town, _was: usize) -> usize {
    t.world.residents.iter().position(|r| r.down_until.is_some()).unwrap()
}

#[test]
fn never_sends_a_soldier() {
    let mut t = town();
    let (down, others) = (t.adults[0], t.adults[1..].to_vec());
    arm(&mut t.world, &others);
    go_down(&mut t.world, down);
    plan(&mut t);
    assert!(revivers(&t.world, &t.city).is_empty());
}

#[test]
fn never_sends_one_carrying_a_child() {
    let mut t = town();
    let (down, parent, others) = (t.adults[0], t.adults[1], t.adults[2..].to_vec());
    arm(&mut t.world, &others);
    t.world.residents[parent].carrying = Some(from(json!({
        "since": t.world.tick, "partnerId": "someone", "partnerName": "Someone",
        "partnerBase": { "strength": 10, "endurance": 10, "agility": 10, "intellect": 10 }
    })));
    go_down(&mut t.world, down);
    plan(&mut t);
    assert!(revivers(&t.world, &t.city).is_empty());
}

// whom it takes

struct Crew {
    t: Town,
    farms: Vec<usize>,
    spare: usize,
    worker: usize,
    farmers: Vec<usize>,
}

/// A worker at a workplace, a builder and farmers, the rest armed.
fn crew() -> Crew {
    let mut t = town();
    let city = t.city.clone();
    let farms: Vec<usize> = (0..t.world.buildings.len())
        .filter(|&i| {
            let b = &t.world.buildings[i];
            b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str())
        })
        .collect();
    // A town is founded with its first adults at the farms.
    for &i in &t.adults {
        stop_work(&mut t.world.residents[i]);
    }
    let adults = t.adults.clone();
    let (down, spare, worker, others) = (adults[0], adults[1], adults[2], adults[3..].to_vec());
    let wanted =
        farmers_wanted(&t.world, t.world.cities.iter().find(|c| c.id == city).unwrap()) as usize;
    let farmers: Vec<usize> = others.iter().copied().take(wanted).collect();
    for (n, &i) in farmers.iter().enumerate() {
        let place = t.world.buildings[farms[n % farms.len()]].clone();
        put_to_work(&mut t.world.residents[i], &place);
    }
    arm(&mut t.world, &others[wanted.min(others.len())..]);
    go_down(&mut t.world, down);
    Crew { t, farms, spare, worker, farmers }
}

/// A lumber camp of the city, with Wood short so that its worker stays a worker.
fn camp(world: &mut WorldState, city: &str) -> Building {
    let (hx, hy) = {
        let h = npc_home(world, city).unwrap();
        (h.x, h.y)
    };
    let place: Building = from(json!({
        "id": "camp", "kind": "lumberCamp", "x": hx + 30.0, "y": hy + 30.0, "cityId": city
    }));
    world.buildings.push(place.clone());
    world.nodes.push(ResourceNode {
        id: "wood".into(),
        kind: ResourceKind::Forest,
        x: place.x,
        y: place.y,
    });
    let home = npc_home(world, city).unwrap().id.clone();
    let i = world.buildings.iter().position(|b| b.id == home).unwrap();
    world.buildings[i].stock.get_or_insert_with(Stock::new).insert(Good::Wood, 0.0);
    place
}

fn sent_ids(t: &Town) -> Vec<String> {
    revivers(&t.world, &t.city).into_keys().collect()
}

#[test]
fn takes_a_spare_hand_first() {
    let Crew { mut t, spare, worker, .. } = crew();
    let place = camp(&mut t.world, &t.city);
    put_to_work(&mut t.world.residents[worker], &place);
    plan(&mut t);
    assert_eq!(sent_ids(&t), vec![id(&t.world, spare)]);
}

#[test]
fn takes_a_worker_when_no_spare_hand_is_left_and_they_leave_off_at_once() {
    let Crew { mut t, spare, worker, .. } = crew();
    arm(&mut t.world, &[spare]);
    let place = camp(&mut t.world, &t.city);
    put_to_work(&mut t.world.residents[worker], &place);
    plan(&mut t);
    assert_eq!(sent_ids(&t), vec![id(&t.world, worker)]);
    step_cities(&mut t);
    assert!(t.world.residents[worker].script.is_none());
}

#[test]
fn takes_a_builder_after_the_workers_and_they_leave_off_at_once() {
    let Crew { mut t, spare, worker, .. } = crew();
    arm(&mut t.world, &[spare]);
    t.world.residents[worker].script =
        Some(from(json!({ "scriptId": 0, "task": "build", "memory": {} })));
    plan(&mut t);
    assert_eq!(sent_ids(&t), vec![id(&t.world, worker)]);
    step_cities(&mut t);
    assert!(t.world.residents[worker].script.is_none());
}

#[test]
fn takes_a_farmer_last_while_food_is_not_short() {
    let Crew { mut t, spare, worker, farmers, .. } = crew();
    arm(&mut t.world, &[spare, worker]);
    plan(&mut t);
    let sent = sent_ids(&t);
    assert_eq!(sent.len(), 1);
    let farmer_ids: Vec<String> = farmers.iter().map(|&i| id(&t.world, i)).collect();
    assert!(farmer_ids.contains(&sent[0]));
}

#[test]
fn leaves_the_farmers_while_food_is_short() {
    let Crew { mut t, spare, worker, .. } = crew();
    arm(&mut t.world, &[spare, worker]);
    set_food(&mut t.world, t.storage, 1.0);
    plan(&mut t);
    assert!(revivers(&t.world, &t.city).is_empty());
}

#[test]
fn still_takes_a_spare_hand_while_food_is_short_once_the_farms_have_theirs() {
    let Crew { mut t, farms, spare, worker, farmers } = crew();
    arm(&mut t.world, &[worker]);
    // Enough farmers for the one more it wants with no surplus, so the spare hand is left over.
    let farm = t.world.buildings[farms[0]].clone();
    put_to_work(&mut t.world.residents[spare], &farm);
    let city = t.city.clone();
    let extra = (0..t.world.residents.len())
        .find(|&i| {
            let r = &t.world.residents[i];
            r.city_id.as_deref() == Some(city.as_str())
                && r.carried.contains_key(&Good::Spear)
                && i != worker
        })
        .unwrap();
    t.world.residents[extra].carried.shift_remove(&Good::Spear);
    set_food(&mut t.world, t.storage, 1.0);
    plan(&mut t);
    let sent = sent_ids(&t);
    let farmer_ids: Vec<String> = farmers.iter().map(|&i| id(&t.world, i)).collect();
    assert!(!sent.iter().all(|s| farmer_ids.contains(s)));
    assert_eq!(sent, vec![id(&t.world, extra)]);
}

#[test]
fn gives_those_down_no_job() {
    let mut t = town();
    let down = t.adults[0];
    go_down(&mut t.world, down);
    plan(&mut t);
    let did = id(&t.world, down);
    assert!(!t.world.city_plans[&t.city].jobs.contains_key(&did));
}

// the reviver

struct Sent {
    t: Town,
    down: usize,
    reviver: usize,
}

/// A town with one Down resident outside its area and the reviver its pass picked.
fn sent() -> Sent {
    let mut t = town();
    let down = t.adults[0];
    laid_outside(&mut t.world, &t.city, down, 10.0);
    plan(&mut t);
    let jobs = revivers(&t.world, &t.city);
    let reviver = t.world.residents.iter().position(|r| jobs.contains_key(&r.id)).unwrap();
    Sent { t, down, reviver }
}

fn order_json(world: &WorldState, i: usize) -> Value {
    serde_json::to_value(&world.residents[i].order).unwrap()
}

#[test]
fn takes_the_food_they_give_from_the_storage_on_top_of_their_own() {
    let Sent { mut t, reviver, .. } = sent();
    let (x, y) = (t.world.buildings[t.storage].x, t.world.buildings[t.storage].y);
    t.world.residents[reviver].x = x;
    t.world.residents[reviver].y = y;
    t.world.residents[reviver].carried.insert(Good::Food, 2.0);
    step_cities(&mut t);
    assert!(
        contains(
            &order_json(&t.world, reviver),
            &json!({ "kind": "pickUp", "goods": { "food": 2 } })
        ),
        "{:?}",
        t.world.residents[reviver].order
    );
}

#[test]
fn feeds_them_on_arrival_and_is_called_off_when_someone_else_got_there_first() {
    let Sent { mut t, down, reviver } = sent();
    let (dx, dy) = (t.world.residents[down].x, t.world.residents[down].y);
    t.world.residents[reviver].x = dx;
    t.world.residents[reviver].y = dy;
    t.world.residents[reviver].carried.insert(Good::Food, 4.0);
    step_cities(&mut t);
    let down_id = id(&t.world, down);
    assert!(contains(
        &order_json(&t.world, reviver),
        &json!({ "kind": "feed", "targetId": down_id })
    ));

    t.world.residents[reviver].order = Some(from(
        json!({ "kind": "walkTo", "target": { "x": 0, "y": 0 }, "path": null, "progress": 0 }),
    ));
    t.world.residents[down].down_until = None;
    t.world.residents[down].health = 10.0;
    step_cities(&mut t);
    let now = order_json(&t.world, reviver);
    assert_ne!(now["kind"], "feed");
    assert!(!contains(&now, &json!({ "target": { "x": 0, "y": 0 } })));
}

#[test]
fn goes_home_when_the_one_they_went_to_has_died() {
    let Sent { mut t, down, reviver } = sent();
    let (dx, dy) = (t.world.residents[down].x, t.world.residents[down].y);
    let down_id = id(&t.world, down);
    let reviver_id = id(&t.world, reviver);
    t.world.residents.retain(|r| r.id != down_id);
    let reviver = index_of(&t.world, &reviver_id);
    t.world.residents[reviver].x = dx + 40.0;
    t.world.residents[reviver].y = dy;
    t.world.residents[reviver].carried.insert(Good::Food, 4.0);
    step_cities(&mut t);
    let now = order_json(&t.world, reviver);
    assert_eq!(now["kind"], "walkTo");
    assert!(!contains(&now, &json!({ "target": { "x": dx, "y": dy } })));
    assert!(matches!(t.world.residents[reviver].order, Some(ResidentOrder::WalkTo(_))));
}

// the Trade Organization

#[test]
fn the_trade_organization_revives_its_own_the_same_way() {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(3.0);
    let city = found_trading_post(&mut world, &terrain, 60, 60, None, &mut || m.next());
    let home = npc_home(&world, &city).unwrap().id.clone();
    let storage = world.buildings.iter().position(|b| b.id == home).unwrap();
    set_food(&mut world, storage, 500.0);
    let tick = world.tick as f64;
    let people: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.city_id.as_deref() == Some(city.as_str()) && can_work(r.born_at, tick)
        })
        .collect();
    let down = people[0];
    let unarmed =
        people.iter().any(|&i| i != down && !world.residents[i].carried.contains_key(&Good::Spear));
    go_down(&mut world, down);
    plan_city(&mut world, &city, None, None, None);
    let sent: Vec<String> = revivers(&world, &city).into_values().collect();
    let want = if unarmed { vec![world.residents[down].id.clone()] } else { vec![] };
    assert_eq!(sent, want);
}

// the npc-revivers invariant

struct Planned {
    t: Town,
}

/// A pass's plan just made with `jobs`.
fn planned(jobs: impl Fn(&str, &str, &str) -> Value) -> Planned {
    let mut t = town();
    let (down, a, b) = (t.adults[0], t.adults[1], t.adults[2]);
    go_down(&mut t.world, down);
    let (d, a, b) = (id(&t.world, down), id(&t.world, a), id(&t.world, b));
    t.world.city_plans.insert(
        t.city.clone(),
        from(json!({ "plannedAt": t.world.tick, "jobs": jobs(&d, &a, &b) })),
    );
    Planned { t }
}

fn revive(target: &str) -> Value {
    json!({ "kind": "revive", "targetId": target })
}

#[test]
fn passes_one_reviver_per_down_resident() {
    let Planned { t } = planned(|d, a, _| json!({ a: revive(d) }));
    assert!(npc_revivers(&t.world, t.terrain.size).is_empty());
}

#[test]
fn finds_two_revivers_of_one() {
    let Planned { t } = planned(|d, a, b| json!({ a: revive(d), b: revive(d) }));
    assert_eq!(npc_revivers(&t.world, t.terrain.size).len(), 1);
}

#[test]
fn finds_a_soldier_sent() {
    let Planned { mut t } = planned(|d, a, _| json!({ a: revive(d) }));
    let a = t.adults[1];
    t.world.residents[a].carried.insert(Good::Spear, 1.0);
    assert_eq!(npc_revivers(&t.world, t.terrain.size).len(), 1);
}

#[test]
fn finds_one_sent_too_far() {
    let Planned { mut t } = planned(|d, a, _| json!({ a: revive(d) }));
    let down = t.adults[0];
    laid_outside(&mut t.world, &t.city, down, NPC_REVIVE_REACH + 1.0);
    assert_eq!(npc_revivers(&t.world, t.terrain.size).len(), 1);
}

#[test]
fn leaves_a_plan_of_an_earlier_tick_alone() {
    let Planned { mut t } = planned(|d, a, b| json!({ a: revive(d), b: revive(d) }));
    t.world.tick += 1;
    assert!(npc_revivers(&t.world, t.terrain.size).is_empty());
}
