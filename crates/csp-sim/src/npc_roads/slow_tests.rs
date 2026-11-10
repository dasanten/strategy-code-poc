//! `npc-roads.test.ts`'s slow simulations (#1038). The file's other cases are not ported yet.

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{
    build_materials, NpcCitySize, NPC_RESIDENTS_PER_NEEDS_STEP, NPC_SURPLUS_CAP, NPC_TOWN,
    NPC_VILLAGE,
};
use csp_shared::terrain::{terrain_at, tile_index, wrap_distance, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, CityLayout, CityPlan, Good, ResourceKind,
    ResourceNode, Stock, WorldState,
};
use serde_json::json;

use super::WayFinder;
use crate::city_layout::{streets_owed, GateAt};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_big_city::{big_city, Unhurried};
use crate::npc_cities::found_npc_city;
use crate::npc_founding::{founding_materials, founding_party, full_but_materials};
use crate::npc_growth::wall_rings;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::pathfinding::{PathFinder, PathOptions, PathResult, Point, WALKING_COSTS};
use crate::queries::building::{road_at, road_tiles};
use crate::queries::city::in_city_area;
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_full_days, npc_reserve};
use crate::queries::residents::is_down;
use crate::random::{new_id, Mulberry32};
use crate::tick::Scratch;
use crate::trading_posts::found_trading_post;
use crate::walls::wall_map;
use crate::world::{create_world, step_world};

/// How far from the home the workplace of `town` lies, past the wall.
const FAR: i32 = 60;

fn stone_per_tile() -> f64 {
    held(&build_materials(BuildingKind::Road), Good::Stone)
}

/// A town with more residents than two needs steps (`BIG`).
fn big() -> NpcCitySize {
    NpcCitySize { residents: 2.0 * NPC_RESIDENTS_PER_NEEDS_STEP + 10.0, farms: 8.0, ..NPC_TOWN }
}

fn home_of(world: &WorldState, city: &str) -> Building {
    npc_home(world, city).expect("a home").clone()
}

fn city_of<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

/// A lumber camp of the city's on a forest node, `dx` tiles east of its home (`camp`).
fn camp(world: &mut WorldState, terrain: &mut TerrainMap, city: &str, dx: i32) -> Building {
    let home = home_of(world, city);
    let at = (home.x as i32 + dx, home.y as i32);
    let id = new_id("n", &mut world.next_id);
    world.nodes.push(ResourceNode {
        id,
        kind: ResourceKind::Forest,
        x: at.0 as f64,
        y: at.1 as f64,
    });
    terrain.tiles[tile_index(terrain.size, at.0, at.1)] = Terrain::Forest as u8;
    let id = new_id("b", &mut world.next_id);
    let place: Building = serde_json::from_value(
        json!({ "id": id, "kind": "lumberCamp", "x": at.0, "y": at.1, "cityId": null }),
    )
    .unwrap();
    world.buildings.push(place.clone());
    let ci = world.cities.iter().position(|c| c.id == city).unwrap();
    world.cities[ci].workplace_ids.get_or_insert_with(Vec::new).push(id);
    place
}

/// The city holds its reserve, its Food cap and Wood cap above that, and `past` above it.
fn set_stock(world: &mut WorldState, city: &str, past: &[(Good, f64)]) {
    let mut stock = npc_reserve(world, city_of(world, city));
    let mut all: Vec<(Good, f64)> = vec![
        (Good::Food, NPC_SURPLUS_CAP.get("food").unwrap()),
        (Good::Wood, NPC_SURPLUS_CAP.get("wood").unwrap()),
    ];
    for (g, n) in past {
        match all.iter_mut().find(|(x, _)| x == g) {
            Some(e) => e.1 = *n,
            None => all.push((*g, *n)),
        }
    }
    for (g, n) in all {
        stock.insert(g, held(&stock, g) + n);
    }
    let home = home_of(world, city).id;
    world.buildings.iter_mut().find(|b| b.id == home).unwrap().stock = Some(stock);
}

/// The street tiles the city wants as road now (`owedBy`).
fn owed_by(world: &WorldState, terrain: &TerrainMap, city: &str) -> Vec<(i32, i32)> {
    let home = home_of(world, city);
    let c = city_of(world, city);
    let gate = wall_rings(world, c, &home, terrain.size)
        .map(|r| GateAt { dx: r.new_gate.dx, dy: r.new_gate.dy });
    streets_owed(world, c, &home, gate, terrain, &road_tiles(world, terrain.size))
}

/// A finished road on each of the tiles (`layAll`).
fn lay_all(world: &mut WorldState, tiles: &[(i32, i32)]) {
    for &(x, y) in tiles {
        let id = new_id("b", &mut world.next_id);
        let road: Building =
            serde_json::from_value(json!({ "id": id, "kind": "road", "x": x, "y": y, "cityId": null }))
                .unwrap();
        world.buildings.push(road);
    }
}

/// A finished road on each of the tiles that has none yet, once each (`layNew`).
fn lay_new(world: &mut WorldState, tiles: &[(f64, f64)]) {
    let mut seen = HashSet::new();
    let fresh: Vec<(i32, i32)> = tiles
        .iter()
        .map(|&(x, y)| (x as i32, y as i32))
        .filter(|t| seen.insert(*t))
        .filter(|&(x, y)| road_at(world, x, y).is_none())
        .collect();
    lay_all(world, &fresh);
}

/// The finished road of a way's tile (`finished`).
fn finished(world: &WorldState, (x, y): (f64, f64)) -> bool {
    road_at(world, x as i32, y as i32).is_some_and(|r| r.site.is_none())
}

struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    place: Building,
}

/// A town alone on Plains with a far lumber camp, holding its reserve and `past` above it, its
/// streets laid (`town`).
fn town(past: &[(Good, f64)], size: i32, kind: &NpcCitySize) -> Town {
    let mut terrain = plains(size);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, kind, 60, 60, &mut || m.next(), None);
    let place = camp(&mut world, &mut terrain, &city, FAR);
    set_stock(&mut world, &city, past);
    let owed = owed_by(&world, &terrain, &city);
    lay_all(&mut world, &owed);
    Town { world, terrain, city, place }
}

/// A second town `dx` tiles east of the first, holding its reserve and `past` above it
/// (`neighbour`).
fn neighbour(t: &mut Town, dx: i32, past: &[(Good, f64)], kind: &NpcCitySize) -> String {
    let mut m = Mulberry32::new(6.0);
    let city = found_npc_city(&mut t.world, &t.terrain, kind, 60 + dx, 60, &mut || m.next(), None);
    set_stock(&mut t.world, &city, past);
    let owed = owed_by(&t.world, &t.terrain, &city);
    lay_all(&mut t.world, &owed);
    city
}

/// Ways found at once with the walls as they stand when the plan is made (`waysOf`): the plan
/// changes no walls while it asks.
struct Ways {
    finder: PathFinder,
}

impl Ways {
    fn new(terrain: &TerrainMap) -> Self {
        Ways { finder: PathFinder::new(Arc::new(terrain.clone())) }
    }

    /// Plans the city with these ways (`planCity(world, city, terrain, undefined, ways)`).
    fn plan(&mut self, world: &mut WorldState, terrain: &TerrainMap, city: &str) -> CityPlan {
        self.finder.set_walls(Some(Arc::new(wall_map(world, terrain))));
        plan_city(world, city, Some(terrain), None, Some(self as &mut dyn WayFinder));
        world.city_plans[city].clone()
    }
}

impl WayFinder for Ways {
    fn way(
        &mut self,
        _key: &str,
        from: Point,
        to: Point,
        side: Option<&str>,
        area: Option<HashSet<usize>>,
    ) -> PathResult {
        let options =
            PathOptions { realm_id: side.map(str::to_string), on_walls: false, near: false, area };
        self.finder.find_path(from, to, &WALKING_COSTS, options)
    }
}

fn road_tiles_of(plan: &CityPlan) -> Vec<(f64, f64)> {
    plan.roads.iter().flatten().flat_map(|r| r.tiles.clone()).collect()
}

fn road_to(world: &WorldState, city: &str, to: &str) -> Option<Vec<(f64, f64)>> {
    world.city_plans.get(city)?.roads.as_ref()?.iter().find(|r| r.to == to).map(|r| r.tiles.clone())
}

fn built(world: &WorldState, tiles: Option<&Vec<(f64, f64)>>) -> bool {
    tiles.is_some_and(|t| !t.is_empty() && t.iter().all(|&x| finished(world, x)))
}

fn crew_of(world: &WorldState, plan: &CityPlan) -> Vec<String> {
    world
        .residents
        .iter()
        .filter(|r| plan.jobs.get(&r.id).is_some_and(|j| j.kind == CityJobKind::Road))
        .map(|r| r.id.clone())
        .collect()
}

fn joined_up(tiles: &[(f64, f64)], size: i32) {
    for w in tiles.windows(2) {
        let (a, b) = ((w[0].0 as i32, w[0].1 as i32), (w[1].0 as i32, w[1].1 as i32));
        assert!(wrap_distance(size, a, b) < 2.0, "{a:?} to {b:?}");
    }
}

/// Runs the world until `done` or `days` have passed, checking the invariants every game day
/// (`run` of "on the map").
fn run(world: &mut WorldState, terrain: &TerrainMap, days: usize, done: impl Fn(&WorldState) -> bool) {
    let mut runner = Runner::new(terrain);
    let mut t = 0;
    while t < days * TICKS_PER_GAME_DAY as usize && !done(world) {
        runner.step(world, terrain);
        if t % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(world, terrain), []);
        }
        t += 1;
    }
    assert_eq!(check_all(world, terrain), []);
}

#[test]
#[ignore = "timed in the PR"]
fn on_the_map_stands_down_for_the_founding_with_a_further_road_unfinished_and_then_founds() {
    let mut s = big_city(1300);
    let mut m = Mulberry32::new(40.0);
    found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, 380, 60, &mut || m.next(), None);
    let mut m = Mulberry32::new(41.0);
    let far = found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, 580, 60, &mut || m.next(), None);
    let hall_and_storage = held(&founding_materials(None), Good::Stone);
    let reserve = npc_reserve(&s.world, s.city());
    let hi = s.world.buildings.iter().position(|b| b.id == s.home).unwrap();
    let stock = s.world.buildings[hi].stock.get_or_insert_with(Stock::new);
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + 800.0);
    stock.insert(Good::Food, held(&reserve, Good::Food) + 3000.0);
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + 400.0);
    let city = s.city.clone();
    let further = |w: &WorldState| road_to(w, &city, &far);
    let unfinished = |w: &WorldState| {
        further(w).unwrap_or_default().into_iter().filter(|&t| !finished(w, t)).count()
    };
    // Lays at once all it wants ahead of the further road, so its crew comes to that road.
    let lay_ahead = |w: &mut WorldState, plan: &CityPlan| {
        let mut tiles: Vec<(f64, f64)> = plan.streets.clone().unwrap_or_default();
        for r in plan.roads.iter().flatten().filter(|r| r.to != far) {
            tiles.extend(r.tiles.iter().copied());
        }
        lay_new(w, &tiles);
    };
    let mut ways = Ways::new(&s.terrain);
    let mut i = 0;
    while i < 40 && further(&s.world).is_none() {
        let plan = ways.plan(&mut s.world, &s.terrain, &city);
        lay_ahead(&mut s.world, &plan);
        i += 1;
    }
    assert!(unfinished(&s.world) > 0);

    // It has waited its time, and Stone holds it back and nothing else: the rule has to leave
    // what the quarry brings in until the party's share is there.
    let kept = held(&npc_reserve(&s.world, s.city()), Good::Stone) + hall_and_storage;
    s.world.buildings[hi].stock.as_mut().unwrap().insert(Good::Stone, kept - 30.0);
    let people = s.world.residents.iter().filter(|r| r.city_id.as_deref() == Some(city.as_str())).count();
    let waited = npc_full_days(people as f64) * TICKS_PER_GAME_DAY;
    let tick = s.world.tick as f64;
    s.world.city_plans.get_mut(&city).unwrap().full_since = Some(tick - waited);

    let mut walking = Unhurried::new(&s.terrain);
    let mut scratch = Scratch::default();
    let (mut stood_down, mut took_kept, mut others_took) = (0, 0, 0.0);
    let stone_now = |w: &WorldState| w.buildings[hi].stock.as_ref().map_or(0.0, |st| held(st, Good::Stone));
    let mut before = stone_now(&s.world);
    let mut last_pass: Option<f64> = None;
    let mut holding: std::collections::HashMap<String, f64> = Default::default();
    let mut set_out: Option<(f64, usize, f64)> = None;
    while (s.world.tick as f64) < 20.0 * TICKS_PER_GAME_DAY && set_out.is_none() {
        step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        let plan = s.world.city_plans[&city].clone();
        let new_pass = Some(plan.planned_at) != last_pass;
        last_pass = Some(plan.planned_at);
        if new_pass {
            lay_ahead(&mut s.world, &plan);
        }
        // Those sent out at first don't count as spare hands yet, which would start its wait over.
        if (s.world.tick as f64) < TICKS_PER_GAME_DAY {
            let tick = s.world.tick as f64;
            s.world.city_plans.get_mut(&city).unwrap().full_since = Some(tick - waited);
        }
        let plan = s.world.city_plans[&city].clone();
        let stone = stone_now(&s.world);
        if !founding_party(Some(&plan)).is_empty() {
            set_out = Some((s.world.tick as f64 / TICKS_PER_GAME_DAY, unfinished(&s.world), before));
        } else if full_but_materials(&s.world, city_of(&s.world, &city), &plan) {
            // What others take isn't the crew's: its project is built from the store as ever.
            let crew = crew_of(&s.world, &plan);
            let mut crew_took = false;
            for id in &crew {
                let r = s.world.residents.iter().find(|r| &r.id == id).unwrap();
                let now = held(&r.carried, Good::Stone);
                if now > holding.get(id).copied().unwrap_or(0.0) {
                    crew_took = true;
                }
                holding.insert(id.clone(), now);
            }
            if crew_took && stone < kept {
                took_kept += 1;
            }
            if !crew_took && stone < before {
                others_took += before - stone;
            }
            if new_pass && stone < kept && crew.is_empty() {
                stood_down += 1;
            }
        }
        before = stone;
        if s.world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
    }
    let set_out = set_out.expect("a party set out");

    // The party fetches its share, as a road crew free of the rule may fetch at the same time.
    let fetched = |w: &WorldState| -> f64 {
        let plan = w.city_plans.get(&city);
        w.residents
            .iter()
            .filter(|r| plan.and_then(|p| p.jobs.get(&r.id)).is_some_and(|j| j.kind == CityJobKind::Found))
            .map(|r| held(&r.carried, Good::Stone))
            .sum()
    };
    let last_tick = s.world.tick as f64 + TICKS_PER_GAME_DAY;
    let mut lowest = stone_now(&s.world);
    while (s.world.tick as f64) < last_tick && fetched(&s.world) < hall_and_storage {
        step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        lowest = lowest.min(stone_now(&s.world));
    }
    println!(
        "stood down {stood_down} passes, others took {others_took} Stone, set out {set_out:?}, kept {kept}; the party holds {}, the store fell to {lowest}",
        fetched(&s.world)
    );
    assert!(stood_down > 0);
    assert_eq!(took_kept, 0);
    // Founding came before the road, the city held the party's Stone, and the party has it.
    assert!(set_out.1 > 0);
    assert!(set_out.2 >= kept);
    assert!(fetched(&s.world) >= hall_and_storage);
}

#[test]
#[ignore = "timed in the PR"]
fn lays_a_road_to_its_second_neighbour_on_the_map() {
    let stone = [(Good::Stone, 400.0)];
    let mut t = town(&stone, 500, &big());
    let near = neighbour(&mut t, 100, &stone, &NPC_TOWN);
    let far = neighbour(&mut t, 170, &stone, &NPC_TOWN);
    let city = t.city.clone();
    let mut runner = Runner::new(&t.terrain);
    let mut i = 0;
    while i < 30 * TICKS_PER_GAME_DAY as usize && !built(&t.world, road_to(&t.world, &city, &far).as_ref()) {
        runner.step(&mut t.world, &t.terrain);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&t.world, &t.terrain), []);
        }
        i += 1;
    }
    assert!(built(&t.world, road_to(&t.world, &city, &near).as_ref()));
    assert!(built(&t.world, road_to(&t.world, &city, &far).as_ref()));
    assert_eq!(check_all(&t.world, &t.terrain), []);
}

#[test]
#[ignore = "timed in the PR"]
fn finishes_a_road_to_a_far_workplace_round_a_lake() {
    let mut t = town(&[(Good::Stone, 400.0)], 300, &NPC_TOWN);
    let home = home_of(&t.world, &t.city);
    // A lake right across the straight way there.
    let lake = (home.x as i32 + 35, home.y as i32);
    for dy in -14..=14 {
        for dx in 0..4 {
            t.terrain.tiles[tile_index(t.terrain.size, lake.0 + dx, lake.1 + dy)] = Terrain::Lake as u8;
        }
    }
    let (city, place) = (t.city.clone(), t.place.id.clone());
    let done = |w: &WorldState| {
        road_to(w, &city, &place).is_some_and(|tiles| tiles.iter().all(|&x| finished(w, x)))
    };
    run(&mut t.world, &t.terrain, 20, done);
    assert!(done(&t.world));
    let tiles = road_to(&t.world, &city, &place).unwrap();
    assert_eq!(tiles.last(), Some(&(t.place.x, t.place.y)));
    assert!(tiles.len() as i32 > FAR);
    for &(x, y) in &tiles {
        assert_ne!(terrain_at(&t.terrain, x as i32, y as i32), Terrain::Lake as u8);
    }
    // The way hangs together, a Step at a time.
    joined_up(&tiles, t.terrain.size);
}

#[test]
#[ignore = "timed in the PR"]
fn joins_two_cities_with_one_road_and_reaches_a_post_on_the_way() {
    // Past what they keep from their crews once they would be full.
    let stone = [(Good::Stone, 500.0)];
    let mut t = town(&stone, 500, &NPC_TOWN);
    let next = neighbour(&mut t, 130, &stone, &NPC_TOWN);
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(&mut t.world, &t.terrain, 60, 150, None, &mut || m.next());
    let warehouse = t
        .world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(post.as_str()))
        .unwrap()
        .id
        .clone();
    let city = t.city.clone();
    let between = |w: &WorldState| road_to(w, &city, &next).or_else(|| road_to(w, &next, &city));
    let done = |w: &WorldState| {
        built(w, between(w).as_ref())
            && (built(w, road_to(w, &city, &warehouse).as_ref())
                || built(w, road_to(w, &next, &warehouse).as_ref()))
    };
    run(&mut t.world, &t.terrain, 40, done);
    assert!(done(&t.world));
    // One road between them, not one from each side.
    assert!(!(road_to(&t.world, &city, &next).is_some() && road_to(&t.world, &next, &city).is_some()));
    let way = between(&t.world).unwrap();
    let far = if road_to(&t.world, &city, &next).is_some() { &next } else { &city };
    let (x, y) = *way.last().unwrap();
    assert!(in_city_area(&t.world, far, x as i32, y as i32, t.terrain.size));
    joined_up(&way, t.terrain.size);
}

#[test]
#[ignore = "timed in the PR"]
fn does_not_starve_its_crew_on_a_long_road() {
    let far = 700;
    let mut terrain = plains(1600);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let place = camp(&mut world, &mut terrain, &city, far);
    set_stock(&mut world, &city, &[(Good::Stone, 200.0)]);
    let owed = owed_by(&world, &terrain, &city);
    lay_all(&mut world, &owed);
    let mut ways = Ways::new(&terrain);
    // All of it laid but the far end, so the crew walks a long way for each load.
    let mut plan = ways.plan(&mut world, &terrain, &city);
    let mut i = 0;
    while i < 8 && !plan.roads.iter().flatten().any(|r| r.to == place.id) {
        lay_new(&mut world, &road_tiles_of(&plan));
        plan = ways.plan(&mut world, &terrain, &city);
        i += 1;
    }
    let tiles = plan.roads.iter().flatten().find(|r| r.to == place.id).unwrap().tiles.clone();
    assert!(tiles.len() as i32 > far - 1);
    let left: Vec<(f64, f64)> = tiles[tiles.len() - 25..].to_vec();
    lay_new(&mut world, &tiles[..tiles.len() - 25]);
    let mut runner = Runner::new(&terrain);
    let count = world.residents.iter().filter(|r| r.city_id.as_deref() == Some(city.as_str())).count();
    let (mut lowest, mut on_crew) = (f64::INFINITY, 0);
    for _ in 0..40 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut world, &terrain);
        let crew = world.city_plans.get(&city).map(|p| crew_of(&world, p)).unwrap_or_default();
        on_crew = on_crew.max(crew.len());
        for id in &crew {
            lowest = lowest.min(world.residents.iter().find(|r| &r.id == id).unwrap().hunger);
        }
        if left.iter().all(|&x| finished(&world, x)) {
            break;
        }
    }
    assert!(on_crew > 0);
    assert!(left.iter().all(|&x| finished(&world, x)));
    assert!(lowest > 0.0);
    let down: Vec<&String> =
        world.residents.iter().filter(|r| is_down(r.down_until)).map(|r| &r.id).collect();
    assert_eq!(down, Vec::<&String>::new());
    // Streets come first, so it can take long enough for the city to found a daughter: count hers.
    assert!(world.residents.len() >= count);
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
#[ignore = "timed in the PR"]
fn never_takes_its_stone_below_the_reserve_and_goes_back_to_other_work() {
    let mut t = town(&[(Good::Stone, 3.0)], 300, &NPC_TOWN);
    let storage = home_of(&t.world, &t.city).id;
    let roads = |w: &WorldState| w.buildings.iter().filter(|b| b.kind == BuildingKind::Road).count();
    let before = roads(&t.world);
    let mut runner = Runner::new(&t.terrain);
    let (mut lowest, mut on_crew) = (f64::INFINITY, 0);
    for _ in 0..3 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut t.world, &t.terrain);
        let reserve = held(&npc_reserve(&t.world, city_of(&t.world, &t.city)), Good::Stone);
        let b = t.world.buildings.iter().find(|b| b.id == storage).unwrap();
        lowest = lowest.min(b.stock.as_ref().map_or(0.0, |s| held(s, Good::Stone)) - reserve);
        if let Some(plan) = t.world.city_plans.get(&t.city) {
            on_crew = on_crew.max(crew_of(&t.world, plan).len());
        }
    }
    assert!(on_crew > 0);
    assert!(lowest >= 0.0);
    let laid = roads(&t.world) - before;
    assert!(laid > 0);
    assert!(laid as f64 <= 3.0 / stone_per_tile());
    assert_eq!(crew_of(&t.world, &t.world.city_plans[&t.city]), Vec::<String>::new());
}

/// `the streets of %s`: goes up on the map, tile by tile, never below the reserve, once for each
/// layout (`CITY_LAYOUTS`).
#[test]
#[ignore = "timed in the PR"]
fn goes_up_on_the_map_tile_by_tile_never_below_the_reserve() {
    for layout in [CityLayout::Grid, CityLayout::Rings, CityLayout::MainStreet, CityLayout::Quarters] {
        // A new town that picked the layout, with a far lumber camp, its streets not laid yet
        // (`unlaid`).
        let (mut world, mut terrain, city) = (1..)
            .find_map(|seed| {
                let terrain = plains(300);
                let mut world = create_world(&terrain, seed);
                let mut m = Mulberry32::new(5.0);
                let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
                (city_of(&world, &city).layout == Some(layout)).then_some((world, terrain, city))
            })
            .unwrap();
        camp(&mut world, &mut terrain, &city, FAR);
        set_stock(&mut world, &city, &[(Good::Stone, 30.0)]);
        let home = home_of(&world, &city).id;
        let owed = owed_by(&world, &terrain, &city);
        let wanted = owed.len().min(8);
        assert!(wanted > 0);
        let built = |w: &WorldState| {
            owed.iter().filter(|&&(x, y)| finished(w, (x as f64, y as f64))).count()
        };
        let mut runner = Runner::new(&terrain);
        let mut lowest = f64::INFINITY;
        let mut t = 0;
        while t < 10 * TICKS_PER_GAME_DAY as usize && built(&world) < wanted {
            runner.step(&mut world, &terrain);
            let b = world.buildings.iter().find(|b| b.id == home).unwrap();
            let reserve = held(&npc_reserve(&world, city_of(&world, &city)), Good::Stone);
            lowest = lowest.min(b.stock.as_ref().map_or(0.0, |s| held(s, Good::Stone)) - reserve);
            if t % TICKS_PER_GAME_DAY as usize == 0 {
                assert_eq!(check_all(&world, &terrain), []);
            }
            t += 1;
        }
        assert!(built(&world) >= wanted, "{layout:?}: {} of {wanted}", built(&world));
        assert!(lowest >= 0.0, "{layout:?}");
        assert_eq!(check_all(&world, &terrain), []);
    }
}
