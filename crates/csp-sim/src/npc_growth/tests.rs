//! `npc-growth.test.ts` and `npc-growth-village.test.ts`, over the shared village
//! (`npc_test_world`).

use std::collections::HashSet;

use csp_shared::balance::{
    BUILD_MATERIALS, CITY_AREA_MARGIN, NPC_ADULTS_PER_PAIR, NPC_VILLAGE, NPC_WALL_STEP,
};
use csp_shared::terrain::{tile_index, Terrain};
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{
    Building, BuildingKind, Carrying, CityProject, Good, Pair, Resident, ResidentOrder, StatRecord,
    Stock, Task, WorldState,
};
use serde_json::{json, Value};

use super::{next_project, wall_rings};
use crate::building::{request_building, resolve_building};
use crate::carrying::{request_carrying, resolve_carrying};
use crate::invariants::check_all;
use crate::npc_behaviour::step_npc_cities;
use crate::npc_plan::{farmers_wanted, plan_city};
use crate::npc_test_world::{
    fill_houses, fill_inside, near_ring, ring, run, village, Runner, Village, FOREST, WALL,
};
use crate::queries::building::{build_problem, max_workers, TerrainLookup};
use crate::queries::city::city_residents;
use crate::queries::city_area::city_area_tiles;
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::walls::{may_step, wall_map, wall_side};

const DAY: usize = TICKS_PER_GAME_DAY as usize;

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

fn set_stock(v: &mut Village, goods: &[(Good, f64)]) {
    let i = v.storage();
    v.world.buildings[i].stock = Some(stock(goods));
}

/// Every resident at the home with no order (`Object.assign(r, { x, y, order: null })`).
fn all_home(v: &mut Village) {
    let (x, y) = (v.home.x, v.home.y);
    for r in &mut v.world.residents {
        r.x = x;
        r.y = y;
        r.order = None;
    }
}

fn plan(v: &mut Village) {
    let city = v.city.clone();
    plan_city(&mut v.world, &city, Some(&v.terrain), None, None);
}

fn paired(world: &WorldState) -> Vec<&Resident> {
    world.residents.iter().filter(|r| r.pair.is_some()).collect()
}

fn busy(r: &Resident) -> bool {
    r.order.is_some() || r.script.is_some()
}

fn project(v: &Village) -> Option<CityProject> {
    next_project(&v.world, v.city(), &v.home, &v.terrain)
}

fn build_at(p: &Option<CityProject>, kind: BuildingKind) -> (f64, f64) {
    match p {
        Some(CityProject::Build { building, x, y }) if *building == kind => (*x, *y),
        other => panic!("not a {kind:?} to build: {other:?}"),
    }
}

fn placed(kind: BuildingKind, (x, y): (f64, f64)) -> Building {
    crate::test_support::building("p", kind, None, x, y)
}

fn houses(world: &WorldState, city: &str) -> usize {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::House && b.city_id.as_deref() == Some(city))
        .count()
}

fn wall_ids(v: &Village) -> HashSet<String> {
    ring(&v.world, &v.city, &v.home, v.terrain.size, WALL)
        .into_iter()
        .map(|b| b.id.clone())
        .collect()
}

/// A JavaScript truthy value.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

#[test]
#[ignore = "13.1 s alone; see #1132"]
fn tears_the_old_wall_down_only_after_the_new_one_is_finished() {
    let mut v = village(None);
    let size = v.terrain.size;
    fill_inside(&mut v.world, &mut v.terrain, &v.home);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, &[(Good::Food, 400.0), (Good::Wood, 600.0)]);
    let old_ids = wall_ids(&v);
    let Village { world, terrain, city, home } = &mut v;
    let gone = |w: &WorldState| w.buildings.iter().all(|b| !old_ids.contains(&b.id));
    run(world, terrain, city, home, &old_ids, 180 * DAY, &gone);
    assert!(gone(world));
    // The gate stands in line with the old one, further out.
    let gate = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str()))
        .expect("a gate");
    assert_eq!((gate.x - home.x, gate.y - home.y), (0.0, f64::from(WALL) + NPC_WALL_STEP));
    // The houses inside are still the city's, with the one it built on its edge.
    assert_eq!(houses(world, city), NPC_VILLAGE.houses as usize + 1);
    let _ = size;
}

#[test]
fn pairs_adults_while_it_has_a_food_surplus_and_ends_pairs_when_food_runs_short() {
    let mut v = village(None);
    all_home(&mut v);
    set_stock(&mut v, &[(Good::Food, 400.0)]);
    // The city decides in its planning pass (ADR 0016) and hands the jobs out in the tick.
    plan(&mut v);
    step_npc_cities(&mut v.world, v.terrain.size, Some(&v.terrain), None);
    let pairs = paired(&v.world);
    assert_eq!(pairs.len(), 2 * (NPC_VILLAGE.residents / NPC_ADULTS_PER_PAIR).floor() as usize);
    assert_eq!(pairs[0].pair, Some(Pair { partner_id: pairs[1].id.clone(), since: 0.0 }));
    // Pairing stops nobody: the pair are put to work like everyone else.
    assert!(pairs.iter().all(|r| busy(r)));
    set_stock(&mut v, &[(Good::Food, 1.0)]);
    plan(&mut v);
    assert!(paired(&v.world).is_empty());
}

#[test]
fn keeps_a_resident_carrying_a_child_out_of_work_at_a_house_the_partner_works() {
    let mut v = village(None);
    all_home(&mut v);
    set_stock(&mut v, &[(Good::Food, 400.0)]);
    plan(&mut v);
    let ids: Vec<usize> = (0..v.world.residents.len())
        .filter(|&i| v.world.residents[i].pair.is_some())
        .take(2)
        .collect();
    let (a, b) = (ids[0], ids[1]);
    for i in [a, b] {
        v.world.residents[i].order = None;
        v.world.residents[i].script = None;
    }
    let (b_id, b_name) = (v.world.residents[b].id.clone(), v.world.residents[b].name.clone());
    let a_id = v.world.residents[a].id.clone();
    v.world.residents[a].carrying = Some(Carrying {
        since: v.world.tick as f64,
        partner_id: b_id.clone(),
        partner_name: b_name,
        partner_base: StatRecord {
            strength: 10.0,
            endurance: 10.0,
            agility: 10.0,
            intellect: 10.0,
        },
    });
    plan(&mut v);
    step_npc_cities(&mut v.world, v.terrain.size, Some(&v.terrain), None);
    assert!(matches!(v.world.residents[a].order, Some(ResidentOrder::WalkTo(_))));
    assert!(v.world.residents[a].script.is_none());
    assert!(busy(&v.world.residents[b]));
    // Food running short doesn't end a pair with a child on the way.
    set_stock(&mut v, &[(Good::Food, 1.0)]);
    plan(&mut v);
    let partner = |i: usize| v.world.residents[i].pair.as_ref().map(|p| p.partner_id.clone());
    assert_eq!((partner(a), partner(b)), (Some(b_id), Some(a_id)));
}

#[test]
fn builds_a_house_inside_its_wall_when_it_has_a_food_surplus_and_no_free_housing() {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, &[(Good::Food, 400.0), (Good::Wood, 100.0)]);
    let (x, y) = build_at(&project(&v), BuildingKind::House);
    assert!(((x - v.home.x).abs().max((y - v.home.y).abs())) < f64::from(WALL - 1));
    // With room in its houses it builds none.
    v.world.residents.pop();
    assert_eq!(project(&v), None);
}

#[test]
fn builds_the_house_by_the_build_default_one_builder_fetching_its_wood_from_the_storage() {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, &[(Good::Food, 400.0), (Good::Wood, 100.0)]);
    let storage = v.storage();
    let before = houses(&v.world, &v.city);
    let mut runner = Runner::new(&v.terrain);
    let mut fetched = false;
    for _ in 0..10 * DAY {
        if houses(&v.world, &v.city) != before {
            break;
        }
        runner.step(&mut v.world, &v.terrain);
        let fetchers = v
            .world
            .residents
            .iter()
            .filter(|r| {
                r.script.as_ref().is_some_and(|s| {
                    s.task == Some(Task::Build) && s.memory.get("fetch").is_some_and(truthy)
                })
            })
            .count();
        assert!(fetchers <= 1);
        fetched |= fetchers > 0;
        if v.world.tick.is_multiple_of(DAY as u64) {
            assert_eq!(check_all(&v.world, &v.terrain), []);
        }
    }
    assert_eq!(houses(&v.world, &v.city), before + 1);
    assert!(fetched);
    let wood = BUILD_MATERIALS.get("house").and_then(|m| m.get("wood")).expect("house wood");
    let held = v.world.buildings[storage].stock.as_ref().and_then(|s| s.get(&Good::Wood).copied());
    assert_eq!(held, Some(100.0 - wood));
}

#[test]
fn with_no_room_left_inside_builds_on_its_edge_then_puts_up_a_new_wall_from_its_gate() {
    let mut v = village(None);
    fill_inside(&mut v.world, &mut v.terrain, &v.home);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, &[(Good::Food, 400.0), (Good::Wood, 100.0)]);
    let edge = build_at(&project(&v), BuildingKind::House);
    // Its footprint just outside the wall.
    assert_eq!(near_ring(&v.home, &placed(BuildingKind::House, edge)), WALL + 1);
    let size = v.terrain.size;
    assert!(!wall_rings(&v.world, v.city(), &v.home, size).expect("rings").expanding);
    let mut h = placed(BuildingKind::House, edge);
    h.id = "h".into();
    h.city_id = Some(v.city.clone());
    v.world.buildings.push(h);
    let rings = wall_rings(&v.world, v.city(), &v.home, size).expect("rings");
    assert_eq!(
        (rings.inner, rings.outer, rings.expanding),
        (WALL, WALL + NPC_WALL_STEP as i32, true)
    );
    assert_eq!(
        project(&v),
        Some(CityProject::Build {
            building: BuildingKind::Gate,
            x: v.home.x,
            y: v.home.y + f64::from(WALL) + NPC_WALL_STEP,
        })
    );
}

#[test]
fn builds_a_lumber_camp_on_the_nearest_forest_when_it_needs_wood_and_makes_none() {
    let mut v = village(None);
    fill_houses(&mut v.world, &v.city, &v.home);
    set_stock(&mut v, &[(Good::Food, 400.0)]);
    assert_eq!(
        project(&v),
        Some(CityProject::Build {
            building: BuildingKind::LumberCamp,
            x: f64::from(FOREST.0),
            y: f64::from(FOREST.1),
        })
    );
}

#[test]
fn builds_a_farm_beyond_its_next_wall_when_the_farmers_it_wants_do_not_fit() {
    let mut v = village(None);
    let farm = v
        .world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(v.city.as_str()))
        .expect("a farm")
        .clone();
    let mut m = Mulberry32::new(5.0);
    let most = max_workers(BuildingKind::Farm).expect("farm workers");
    while farmers_wanted(&v.world, v.city()) <= most {
        let id = new_id("r", &mut v.world.next_id);
        let fields = NewResident {
            id: &id,
            owner: None,
            city_id: Some(&v.city),
            x: farm.x,
            y: farm.y,
            tick: 0.0,
        };
        let r = new_resident(&mut || m.next(), &fields, None);
        v.world.residents.push(r);
    }
    let at = build_at(&project(&v), BuildingKind::Farm);
    assert!(near_ring(&v.home, &placed(BuildingKind::Farm, at)) > WALL + NPC_WALL_STEP as i32);
    // Out of the way of the gate.
    assert_ne!(at.0, v.home.x);
}

#[test]
fn leaves_the_trade_organizations_cities_to_grow_their_own_way() {
    let mut v = village(None);
    v.city_mut().trade_org = Some(serde_json::from_value(json!("post")).unwrap());
    all_home(&mut v);
    set_stock(&mut v, &[(Good::Food, 400.0)]);
    plan(&mut v);
    assert!(paired(&v.world).is_empty());
}

// houses, farms and NPC walls

fn problem(v: &Village, x: f64, y: f64, kind: BuildingKind) -> Option<String> {
    build_problem(&v.world, x as i32, y as i32, kind, Some(&v.terrain as &dyn TerrainLookup))
}

#[test]
fn a_house_goes_only_in_a_citys_area_a_farm_only_on_plains() {
    let mut v = village(None);
    let (hx, hy) = (v.home.x, v.home.y);
    assert_eq!(problem(&v, hx + 4.0, hy, BuildingKind::House), None);
    // Every tile of its footprint in the area, which ends `CITY_AREA_MARGIN` past the wall.
    let edge = hx + f64::from(WALL) + CITY_AREA_MARGIN;
    assert_eq!(problem(&v, edge - 1.0, hy, BuildingKind::House), None);
    assert_eq!(
        problem(&v, edge, hy, BuildingKind::House).as_deref(),
        Some("a house goes in a city’s area")
    );
    assert_eq!(problem(&v, hx + 8.0, hy, BuildingKind::Farm), None);
    let t = tile_index(v.terrain.size, hx as i32 + 11, hy as i32 + 3);
    v.terrain.tiles[t] = Terrain::Forest as u8;
    assert_eq!(
        problem(&v, hx + 8.0, hy, BuildingKind::Farm).as_deref(),
        Some("a farm goes wholly on Plains, off any resource node")
    );
}

#[test]
fn a_farm_is_laid_out_for_its_builders_city_an_npc_citys_lumber_camp_is_one_of_its_own() {
    let mut v = village(None);
    let order = |kind: &str, x: i32, y: i32| -> ResidentOrder {
        serde_json::from_value(
            json!({ "kind": "build", "building": kind, "at": { "x": x, "y": y }, "siteId": null }),
        )
        .unwrap()
    };
    let farmer = &mut v.world.residents[0];
    (farmer.x, farmer.y) = (40.0, 40.0);
    farmer.order = Some(order("farm", 40, 40));
    let woodcutter = &mut v.world.residents[1];
    (woodcutter.x, woodcutter.y) = (f64::from(FOREST.0), f64::from(FOREST.1));
    woodcutter.order = Some(order("lumberCamp", FOREST.0, FOREST.1));
    let actions = request_building(&v.world);
    resolve_building(&mut v.world, &actions, Some(&v.terrain));
    let at = |x: f64, y: f64| v.world.buildings.iter().find(|b| b.x == x && b.y == y).unwrap();
    let farm = at(40.0, 40.0);
    let camp = at(f64::from(FOREST.0), f64::from(FOREST.1));
    assert_eq!((farm.kind, farm.city_id.as_deref()), (BuildingKind::Farm, Some(v.city.as_str())));
    assert_eq!((camp.kind, camp.city_id.as_deref()), (BuildingKind::LumberCamp, None));
    assert_eq!(v.city().workplace_ids, Some(vec![camp.id.clone()]));
    assert_eq!(check_all(&v.world, &v.terrain), []);
}

#[test]
fn the_last_materials_carried_to_a_site_with_all_its_work_finish_it() {
    let mut v = village(None);
    let (hx, hy) = (v.home.x, v.home.y);
    let r = &mut v.world.residents[0];
    (r.x, r.y) = (hx + 4.0, hy);
    r.carried = stock(&[(Good::Wood, 25.0)]);
    let site: Building = serde_json::from_value(json!({
        "id": "h", "kind": "house", "cityId": null, "x": hx + 4.0, "y": hy,
        "site": { "delivered": {}, "work": TICKS_PER_GAME_DAY },
    }))
    .unwrap();
    v.world.buildings.push(site);
    r.order = Some(
        serde_json::from_value(json!({
            "kind": "drop", "to": { "kind": "site", "siteId": "h" }, "goods": { "wood": 25 },
        }))
        .unwrap(),
    );
    let actions = request_carrying(&v.world);
    resolve_carrying(&mut v.world, &actions, v.terrain.size);
    let site = v.world.buildings.iter().find(|b| b.id == "h").unwrap();
    assert!(site.site.is_none());
    assert_eq!(site.city_id.as_deref(), Some(v.city.as_str()));
    assert_eq!(v.world.residents[0].carried.get(&Good::Wood).copied(), Some(5.0));
}

#[test]
fn catches_a_city_working_one_of_its_farms_as_its_own_workplace() {
    let mut v = village(None);
    let farm = v.world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap().id.clone();
    v.city_mut().workplace_ids = Some(vec![farm]);
    assert!(check_all(&v.world, &v.terrain).iter().any(|x| x.invariant == "city-workplaces-sound"));
}

#[test]
fn an_npc_citys_residents_stand_on_its_walls_others_dont() {
    let v = village(None);
    let walls = wall_map(&v.world, &v.terrain);
    let size = v.terrain.size;
    let (hx, hy) = (v.home.x as i32, v.home.y as i32);
    let inside = tile_index(size, hx, hy - WALL + 1);
    let wall = tile_index(size, hx, hy - WALL);
    let own = &v.world.residents[0];
    assert_eq!(wall_side(own), Some(v.city.as_str()));
    assert!(may_step(&walls, wall_side(own), inside, wall, true, false));
    assert!(!may_step(&walls, None, inside, wall, true, false));
    assert!(!may_step(&walls, Some("realm1"), inside, wall, true, false));
}

// npc-growth-village.test.ts

#[test]
#[ignore = "24.2 s alone; see #1132"]
fn a_village_grows_in_residents_and_area_over_game_weeks() {
    let mut v = village(None);
    let size = v.terrain.size;
    fill_inside(&mut v.world, &mut v.terrain, &v.home);
    fill_houses(&mut v.world, &v.city, &v.home);
    let people = city_residents(&v.world, &v.city).len();
    let area = city_area_tiles(&v.world, &v.city, size).len();
    let old_ids = wall_ids(&v);
    let Village { world, terrain, city, home } = &mut v;
    // Each resident's first pair counts as paired a game year ago, so its first child comes as
    // soon as the city has room and Food for it, not a year into the run (the year's wait is the
    // pairing tests' business). It runs until its wall has moved out, for at most as many ticks as
    // four old game years.
    let moved_out = |w: &WorldState| {
        ring(w, city, home, size, WALL).is_empty()
            && ring(w, city, home, size, WALL + NPC_WALL_STEP as i32).len() > 120
    };
    let mut paired = HashSet::new();
    for _ in 0..240 {
        if moved_out(world) {
            break;
        }
        run(world, terrain, city, home, &old_ids, DAY, &|_| false);
        for r in &mut world.residents {
            let Some(p) = &mut r.pair else { continue };
            if !paired.insert(r.id.clone()) {
                continue;
            }
            p.since -= TICKS_PER_GAME_YEAR;
        }
    }
    assert!(city_residents(world, city).len() > people);
    assert!(city_area_tiles(world, city, size).len() > area);
    // It built its own lumber camp for the wood, and moved its wall out.
    assert!(world.buildings.iter().any(|b| b.kind == BuildingKind::LumberCamp && b.site.is_none()));
    assert!(ring(world, city, home, size, WALL).is_empty());
    assert!(ring(world, city, home, size, WALL + NPC_WALL_STEP as i32).len() > 120);
}
