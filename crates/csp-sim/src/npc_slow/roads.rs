//! `npc-roads.test.ts`, its slow simulations: an NPC city's road crew on the map (`CONTEXT.md`: NPC
//! road, Spare hands' work).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use csp_shared::balance::{
    NpcCitySize, BUILD_MATERIALS, NPC_RESIDENTS_PER_NEEDS_STEP, NPC_SURPLUS_CAP, NPC_TOWN,
    NPC_VILLAGE,
};
use csp_shared::terrain::{terrain_at, tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, CityJobKind, CityLayout, CityPlan, Good, ResourceKind, WorldState,
};

use super::big_city_fixture::big_city;
use super::{add_workplace, home_mut, unhurried_walking, wrap_distance_f};
use crate::city_layout::{streets_owed, GateAt, CITY_LAYOUTS};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_founding::{founding_materials, founding_party, full_but_materials};
use crate::npc_growth::wall_rings;
use crate::npc_plan::plan_city;
use crate::npc_roads::WayFinder;
use crate::npc_test_world::{plains, Runner};
use crate::pathfinding::{PathFinder, PathOptions, PathResult, Point, WALKING_COSTS};
use crate::queries::building::{road_at, road_tiles};
use crate::queries::city::{city_residents, in_city_area};
use crate::queries::npc_trade::{npc_full_days, npc_reserve};
use crate::random::{new_id, Mulberry32};
use crate::tick::Scratch;
use crate::trading_posts::found_trading_post;
use crate::walls::wall_map;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

fn stone_per_road() -> f64 {
    BUILD_MATERIALS.get("road").and_then(|m| m.get("stone")).unwrap_or(0.0)
}

/// How far from the home the workplace of `town` lies, past the wall.
const FAR: f64 = 60.0;

/// A city big enough to go further (`isBigNpcCity`; `BIG`).
const BIG: NpcCitySize =
    NpcCitySize { residents: 2.0 * NPC_RESIDENTS_PER_NEEDS_STEP + 10.0, farms: 8.0, ..NPC_TOWN };

fn stock(world: &WorldState, city: &str, good: Good) -> f64 {
    let home = npc_home(world, city).expect("a home");
    home.stock.as_ref().and_then(|s| s.get(&good)).copied().unwrap_or(0.0)
}

fn reserve(world: &WorldState, city: &str, good: Good) -> f64 {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    npc_reserve(world, c).get(&good).copied().unwrap_or(0.0)
}

/// A lumber camp of the city's on a forest node, `dx` tiles east of its home (`camp`).
fn camp(world: &mut WorldState, terrain: &mut TerrainMap, city: &str, dx: f64) -> String {
    let home = npc_home(world, city).expect("a home");
    let (x, y) = (home.x + dx, home.y);
    add_workplace(world, terrain, city, BuildingKind::LumberCamp, Some(ResourceKind::Forest), x, y)
}

/// The city holds its reserve, its Food cap and Wood cap above that, and `past` above it
/// (`setStock`).
fn set_stock(world: &mut WorldState, city: &str, past: &[(Good, f64)]) {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let mut stock = npc_reserve(world, c);
    let mut all: Vec<(Good, f64)> = vec![
        (Good::Food, NPC_SURPLUS_CAP.get("food").unwrap_or(0.0)),
        (Good::Wood, NPC_SURPLUS_CAP.get("wood").unwrap_or(0.0)),
    ];
    for (good, n) in past {
        match all.iter_mut().find(|(g, _)| g == good) {
            Some(slot) => slot.1 = *n,
            None => all.push((*good, *n)),
        }
    }
    for (good, n) in all {
        *stock.entry(good).or_insert(0.0) += n;
    }
    home_mut(world, city).stock = Some(stock);
}

/// The street tiles the city wants as road now (`owedBy`).
fn owed_by(world: &WorldState, terrain: &TerrainMap, city: &str) -> Vec<(i32, i32)> {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let home = npc_home(world, city).expect("a home");
    let gate = wall_rings(world, c, home, terrain.size)
        .map(|r| GateAt { dx: r.new_gate.dx, dy: r.new_gate.dy });
    streets_owed(world, c, home, gate, terrain, &road_tiles(world, terrain.size))
}

/// A finished road on each of the tiles (`layAll`).
fn lay_all(world: &mut WorldState, tiles: &[(i32, i32)]) {
    for (x, y) in tiles {
        let id = new_id("b", &mut world.next_id);
        world.buildings.push(crate::test_support::building(
            &id,
            BuildingKind::Road,
            None,
            f64::from(*x),
            f64::from(*y),
        ));
    }
}

/// A finished road on each of the tiles that has none yet, once each (`layNew`).
fn lay_new(world: &mut WorldState, tiles: &[(f64, f64)]) {
    let mut seen = HashSet::new();
    let fresh: Vec<(i32, i32)> = tiles
        .iter()
        .map(|(x, y)| (*x as i32, *y as i32))
        .filter(|t| seen.insert(*t))
        .filter(|(x, y)| road_at(world, *x, *y).is_none())
        .collect();
    lay_all(world, &fresh);
}

/// Its streets laid, so its crew goes on to its other roads (`layStreets`).
fn lay_streets(world: &mut WorldState, terrain: &TerrainMap, city: &str) {
    let owed = owed_by(world, terrain, city);
    lay_all(world, &owed);
}

/// A town alone on a Plains map of `size` with a far lumber camp, holding its reserve and `past`
/// above it, its streets laid (`town`); returns its id and its camp's.
fn town(
    past: &[(Good, f64)],
    size: i32,
    kind: &NpcCitySize,
) -> (WorldState, TerrainMap, String, String) {
    let mut terrain = plains(size);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, kind, 60, 60, &mut || m.next(), None);
    let place = camp(&mut world, &mut terrain, &city, FAR);
    set_stock(&mut world, &city, past);
    lay_streets(&mut world, &terrain, &city);
    (world, terrain, city, place)
}

/// A second town `dx` tiles east of the first, holding its reserve and `past` above it
/// (`neighbour`).
fn neighbour(
    world: &mut WorldState,
    terrain: &TerrainMap,
    dx: i32,
    past: &[(Good, f64)],
) -> String {
    let mut m = Mulberry32::new(6.0);
    let city = found_npc_city(world, terrain, &NPC_TOWN, 60 + dx, 60, &mut || m.next(), None);
    set_stock(world, &city, past);
    lay_streets(world, terrain, &city);
    city
}

/// Ways found at once with the walls as they stood when the pass began (`waysOf`). The TypeScript
/// takes the walls afresh for each way; a pass builds no wall, so they are the same.
struct Ways {
    finder: PathFinder,
}

impl Ways {
    fn new(terrain: &TerrainMap) -> Self {
        Ways { finder: PathFinder::new(Arc::new(terrain.clone())) }
    }

    /// `planCity(world, city, terrain, undefined, ways)`.
    fn plan(&mut self, world: &mut WorldState, terrain: &TerrainMap, city: &str) -> CityPlan {
        self.finder.set_walls(Some(Arc::new(wall_map(world, terrain))));
        plan_city(world, city, Some(terrain), None, Some(self));
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
            PathOptions { realm_id: side.map(str::to_string), area, ..Default::default() };
        self.finder.find_path(from, to, &WALKING_COSTS, options)
    }
}

fn all_tiles(plan: &CityPlan) -> Vec<(f64, f64)> {
    plan.roads.iter().flatten().flat_map(|r| r.tiles.iter().copied()).collect()
}

/// Plans the city `passes` times more, laying at once all it wants built (`joinAll`).
fn join_all(
    world: &mut WorldState,
    terrain: &TerrainMap,
    city: &str,
    ways: &mut Ways,
    passes: usize,
) -> CityPlan {
    let mut plan = ways.plan(world, terrain, city);
    for _ in 0..passes {
        lay_new(world, &all_tiles(&plan));
        plan = ways.plan(world, terrain, city);
    }
    plan
}

/// Those a plan puts on the road crew (`crewOf`).
fn crew_of(world: &WorldState, plan: &CityPlan) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            plan.jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Road)
        })
        .collect()
}

/// Whether a way's tile has its finished road (`finished`).
fn finished(world: &WorldState, (x, y): (f64, f64)) -> bool {
    road_at(world, x as i32, y as i32).is_some_and(|r| r.site.is_none())
}

fn road_to(world: &WorldState, city: &str, to: &str) -> Option<Vec<(f64, f64)>> {
    let roads = world.city_plans.get(city)?.roads.as_ref()?;
    roads.iter().find(|r| r.to == to).map(|r| r.tiles.clone())
}

fn built(world: &WorldState, tiles: Option<&Vec<(f64, f64)>>) -> bool {
    tiles.is_some_and(|t| !t.is_empty() && t.iter().all(|tile| finished(world, *tile)))
}

/// Each step of a way is one Step: it hangs together.
fn hangs_together(size: i32, way: &[(f64, f64)]) {
    for w in way.windows(2) {
        assert!(wrap_distance_f(size, w[0], w[1]) < 2.0, "{:?} to {:?}", w[0], w[1]);
    }
}

/// Runs the world until `done` or `days` pass, checking the invariants every game day (`run`).
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    days: usize,
    done: &dyn Fn(&WorldState) -> bool,
) {
    let mut runner = Runner::new(terrain);
    let mut t = 0;
    while t < days * DAY && !done(world) {
        runner.step(world, terrain);
        if t % DAY == 0 {
            assert_eq!(check_all(world, terrain), []);
        }
        t += 1;
    }
    eprintln!("ran to tick {}", world.tick);
    assert_eq!(check_all(world, terrain), []);
}

#[test]
#[ignore = "26.8 s alone; see #1132"]
fn on_the_map_stands_down_for_the_founding_with_a_further_road_unfinished_and_then_founds() {
    let mut s = big_city(None, 1300);
    let city = s.city.clone();
    let mut m = Mulberry32::new(40.0);
    found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, 380, 60, &mut || m.next(), None);
    let mut m = Mulberry32::new(41.0);
    let far =
        found_npc_city(&mut s.world, &s.terrain, &NPC_VILLAGE, 580, 60, &mut || m.next(), None);
    let hall_and_storage = founding_materials(None).get(&Good::Stone).copied().unwrap_or(0.0);
    let (wood, food, stone) = (
        reserve(&s.world, &city, Good::Wood) + 800.0,
        reserve(&s.world, &city, Good::Food) + 3000.0,
        reserve(&s.world, &city, Good::Stone) + 400.0,
    );
    let home = s.home_mut().stock.get_or_insert_with(Default::default);
    home.insert(Good::Wood, wood);
    home.insert(Good::Food, food);
    home.insert(Good::Stone, stone);
    let further = |world: &WorldState| road_to(world, &city, &far);
    let unfinished = |world: &WorldState| {
        further(world).unwrap_or_default().into_iter().filter(|t| !finished(world, *t)).count()
    };
    // Lays at once all it wants ahead of the further road, so its crew comes to that road.
    let lay_ahead = |world: &mut WorldState, plan: &CityPlan| {
        let mut ahead: Vec<(f64, f64)> = plan.streets.clone().unwrap_or_default();
        for r in plan.roads.iter().flatten().filter(|r| r.to != far) {
            ahead.extend(r.tiles.iter().copied());
        }
        lay_new(world, &ahead);
    };
    let mut ways = Ways::new(&s.terrain);
    let mut i = 0;
    while i < 40 && further(&s.world).is_none() {
        let plan = ways.plan(&mut s.world, &s.terrain, &city);
        lay_ahead(&mut s.world, &plan);
        i += 1;
    }
    assert!(unfinished(&s.world) > 0);

    // It has waited its time, and Stone holds it back and nothing else: the rule has to leave what
    // the quarry brings in until the party's share is there.
    let kept = reserve(&s.world, &city, Good::Stone) + hall_and_storage;
    s.home_mut().stock.get_or_insert_with(Default::default).insert(Good::Stone, kept - 30.0);
    let waited = npc_full_days(city_residents(&s.world, &city).len() as f64) * TICKS_PER_GAME_DAY;
    let tick = s.world.tick as f64;
    s.world.city_plans.get_mut(&city).expect("a plan").full_since = Some(tick - waited);

    let mut runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
    let (mut stood_down, mut took_kept, mut others_took) = (0, 0, 0.0);
    let mut before = stock(&s.world, &city, Good::Stone);
    let mut last_pass = None;
    let mut held: HashMap<String, f64> = HashMap::new();
    let mut set_out: Option<(f64, usize, f64)> = None;
    while s.world.tick < 20 * DAY as u64 && set_out.is_none() {
        runner.step(&mut s.world, &s.terrain);
        let plan = s.world.city_plans[&city].clone();
        let new_pass = Some(plan.planned_at) != last_pass;
        last_pass = Some(plan.planned_at);
        if new_pass {
            lay_ahead(&mut s.world, &plan);
        }
        // Those sent out at first don't count as spare hands yet, which would start its wait over.
        if s.world.tick < DAY as u64 {
            let tick = s.world.tick as f64;
            s.world.city_plans.get_mut(&city).expect("a plan").full_since = Some(tick - waited);
        }
        let plan = s.world.city_plans[&city].clone();
        let stone = stock(&s.world, &city, Good::Stone);
        let c = s.world.cities.iter().find(|c| c.id == city).expect("the city");
        if !founding_party(Some(&plan)).is_empty() {
            set_out =
                Some((s.world.tick as f64 / TICKS_PER_GAME_DAY, unfinished(&s.world), before));
        } else if full_but_materials(&s.world, c, &plan) {
            // What others take isn't the crew's: its project is built from the store as ever.
            let crew = crew_of(&s.world, &plan);
            let mut crew_took = false;
            for &i in &crew {
                let r = &s.world.residents[i];
                let now = r.carried.get(&Good::Stone).copied().unwrap_or(0.0);
                if now > held.get(&r.id).copied().unwrap_or(0.0) {
                    crew_took = true;
                }
                held.insert(r.id.clone(), now);
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
        if s.world.tick.is_multiple_of(DAY as u64) {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
    }
    let set_out = set_out.expect("a party set out");

    // The party fetches its share, as a road crew free of the rule may fetch at the same time.
    let fetched = |world: &WorldState| -> f64 {
        let plan = world.city_plans.get(&city);
        world
            .residents
            .iter()
            .filter(|r| {
                plan.and_then(|p| p.jobs.get(&r.id)).is_some_and(|j| j.kind == CityJobKind::Found)
            })
            .map(|r| r.carried.get(&Good::Stone).copied().unwrap_or(0.0))
            .sum()
    };
    let last_tick = s.world.tick + DAY as u64;
    let mut lowest = stock(&s.world, &city, Good::Stone);
    while s.world.tick < last_tick && fetched(&s.world) < hall_and_storage {
        runner.step(&mut s.world, &s.terrain);
        lowest = lowest.min(stock(&s.world, &city, Good::Stone));
    }
    eprintln!(
        "Further road and the founding: stood down {stood_down} passes, others took {others_took} Stone, set out {set_out:?} of {:?} tiles, kept {kept}; the party holds {} Stone, the store fell to {lowest}, reserve {}",
        further(&s.world).map(|t| t.len()),
        fetched(&s.world),
        reserve(&s.world, &city, Good::Stone)
    );
    assert!(stood_down > 0);
    assert_eq!(took_kept, 0);
    // Founding came before the road, the city held the party's Stone, and the party has it.
    assert!(set_out.1 > 0);
    assert!(set_out.2 >= kept, "{} < {kept}", set_out.2);
    assert!(fetched(&s.world) >= hall_and_storage);
}

#[test]
#[ignore = "33.4 s alone; see #1132"]
fn a_big_city_lays_a_road_to_its_second_neighbour_on_the_map() {
    let (mut world, terrain, city, _) = town(&[(Good::Stone, 400.0)], 500, &BIG);
    let near = neighbour(&mut world, &terrain, 100, &[(Good::Stone, 400.0)]);
    let far = neighbour(&mut world, &terrain, 170, &[(Good::Stone, 400.0)]);
    let mut runner = Runner::new(&terrain);
    let mut t = 0;
    while t < 30 * DAY && !built(&world, road_to(&world, &city, &far).as_ref()) {
        runner.step(&mut world, &terrain);
        if t % DAY == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        t += 1;
    }
    eprintln!("ran to tick {}", world.tick);
    assert!(built(&world, road_to(&world, &city, &near).as_ref()));
    assert!(built(&world, road_to(&world, &city, &far).as_ref()));
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn on_the_map_finishes_a_road_to_a_far_workplace_round_a_lake() {
    let (mut world, mut terrain, city, place) = town(&[(Good::Stone, 400.0)], 300, &NPC_TOWN);
    let home = npc_home(&world, &city).expect("a home");
    // A lake right across the straight way there.
    let (lx, ly) = (home.x as i32 + 35, home.y as i32);
    for dy in -14..=14 {
        for dx in 0..4 {
            terrain.tiles[tile_index(terrain.size, lx + dx, ly + dy)] = Terrain::Lake as u8;
        }
    }
    let to = |world: &WorldState| road_to(world, &city, &place);
    let done =
        |world: &WorldState| to(world).is_some_and(|t| t.iter().all(|tile| finished(world, *tile)));
    run(&mut world, &terrain, 20, &done);
    assert!(done(&world));
    let tiles = to(&world).expect("a way");
    let p = world.buildings.iter().find(|b| b.id == place).expect("the camp");
    assert_eq!(tiles.last(), Some(&(p.x, p.y)));
    assert!(tiles.len() as f64 > FAR);
    for (x, y) in &tiles {
        assert_ne!(terrain_at(&terrain, *x as i32, *y as i32), Terrain::Lake as u8);
    }
    hangs_together(terrain.size, &tiles);
}

#[test]
#[ignore = "18.9 s alone; see #1132"]
fn on_the_map_joins_two_cities_with_one_road_and_reaches_a_post_on_the_way() {
    // Past what they keep from their crews once they would be full (`CONTEXT.md`: NPC road).
    let (mut world, terrain, city, _) = town(&[(Good::Stone, 500.0)], 500, &NPC_TOWN);
    let next = neighbour(&mut world, &terrain, 130, &[(Good::Stone, 500.0)]);
    let mut m = Mulberry32::new(3.0);
    let post = found_trading_post(&mut world, &terrain, 60, 150, None, &mut || m.next());
    let warehouse = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(post.as_str()))
        .expect("a warehouse")
        .id
        .clone();
    let between =
        |world: &WorldState| road_to(world, &city, &next).or_else(|| road_to(world, &next, &city));
    let done = |world: &WorldState| {
        built(world, between(world).as_ref())
            && (built(world, road_to(world, &city, &warehouse).as_ref())
                || built(world, road_to(world, &next, &warehouse).as_ref()))
    };
    run(&mut world, &terrain, 40, &done);
    assert!(done(&world));
    // One road between them, not one from each side.
    assert!(!(road_to(&world, &city, &next).is_some() && road_to(&world, &next, &city).is_some()));
    let way = between(&world).expect("a way");
    let far = if road_to(&world, &city, &next).is_some() { &next } else { &city };
    let (x, y) = *way.last().expect("a tile");
    assert!(in_city_area(&world, far, x as i32, y as i32, terrain.size));
    hangs_together(terrain.size, &way);
}

#[test]
#[ignore = "7.8 s alone; see #1132"]
fn on_the_map_does_not_starve_its_crew_on_a_long_road() {
    let far = 700.0;
    let mut terrain = plains(1600);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let place = camp(&mut world, &mut terrain, &city, far);
    set_stock(&mut world, &city, &[(Good::Stone, 200.0)]);
    lay_streets(&mut world, &terrain, &city);
    let mut ways = Ways::new(&terrain);
    // All of it laid but the far end, so the crew walks a long way for each load.
    let mut plan = join_all(&mut world, &terrain, &city, &mut ways, 0);
    let mut i = 0;
    while i < 8 && !plan.roads.iter().flatten().any(|r| r.to == place) {
        lay_new(&mut world, &all_tiles(&plan));
        plan = ways.plan(&mut world, &terrain, &city);
        i += 1;
    }
    let tiles = plan.roads.iter().flatten().find(|r| r.to == place).expect("a way").tiles.clone();
    assert!(tiles.len() as f64 > far - 1.0);
    let cut = tiles.len() - 25;
    let left = tiles[cut..].to_vec();
    lay_new(&mut world, &tiles[..cut]);
    let mut runner = Runner::new(&terrain);
    let count =
        world.residents.iter().filter(|r| r.city_id.as_deref() == Some(city.as_str())).count();
    let mut lowest = f64::INFINITY;
    let mut on_crew = 0;
    for _ in 0..40 * DAY {
        runner.step(&mut world, &terrain);
        let crew = world.city_plans.get(&city).map(|p| crew_of(&world, p)).unwrap_or_default();
        on_crew = on_crew.max(crew.len());
        for i in crew {
            lowest = lowest.min(world.residents[i].hunger);
        }
        if left.iter().all(|t| finished(&world, *t)) {
            break;
        }
    }
    eprintln!("ran to tick {}", world.tick);
    assert!(on_crew > 0);
    assert!(left.iter().all(|t| finished(&world, *t)));
    assert!(lowest > 0.0, "{lowest}");
    let down: Vec<&str> =
        world.residents.iter().filter(|r| r.down_until.is_some()).map(|r| r.id.as_str()).collect();
    assert_eq!(down, Vec::<&str>::new());
    // Streets come first, so it can take long enough for the city to found a daughter: count hers.
    assert!(world.residents.len() >= count);
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn on_the_map_never_takes_its_stone_below_the_reserve_and_goes_back_to_other_work() {
    let (mut world, terrain, city, _) = town(&[(Good::Stone, 3.0)], 300, &NPC_TOWN);
    let mut runner = Runner::new(&terrain);
    let roads = |world: &WorldState| {
        world.buildings.iter().filter(|b| b.kind == BuildingKind::Road).count()
    };
    let before = roads(&world);
    let mut lowest = f64::INFINITY;
    let mut on_crew = 0;
    for _ in 0..3 * DAY {
        runner.step(&mut world, &terrain);
        lowest =
            lowest.min(stock(&world, &city, Good::Stone) - reserve(&world, &city, Good::Stone));
        if let Some(plan) = world.city_plans.get(&city) {
            on_crew = on_crew.max(crew_of(&world, plan).len());
        }
    }
    assert!(on_crew > 0);
    assert!(lowest >= 0.0, "{lowest}");
    let laid = roads(&world) - before;
    assert!(laid > 0);
    assert!(laid as f64 <= 3.0 / stone_per_road(), "{laid}");
    assert_eq!(crew_of(&world, &world.city_plans[&city]), Vec::<usize>::new());
}

/// A new town that picked `layout`, with a far lumber camp, its streets not laid yet (`unlaid`).
fn unlaid(layout: CityLayout, past: &[(Good, f64)]) -> (WorldState, TerrainMap, String) {
    let mut seed = 1;
    let (mut world, mut terrain, city) = loop {
        let terrain = plains(300);
        let mut world = create_world(&terrain, seed);
        let mut m = Mulberry32::new(5.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
        if world.cities.iter().find(|c| c.id == city).and_then(|c| c.layout) == Some(layout) {
            break (world, terrain, city);
        }
        seed += 1;
    };
    camp(&mut world, &mut terrain, &city, FAR);
    set_stock(&mut world, &city, past);
    (world, terrain, city)
}

/// `the streets of <layout>`: `goes up on the map, tile by tile, never below the reserve`.
fn streets_go_up_tile_by_tile(layout: CityLayout) {
    let (mut world, terrain, city) = unlaid(layout, &[(Good::Stone, 30.0)]);
    let owed = owed_by(&world, &terrain, &city);
    let wanted = owed.len().min(8);
    assert!(wanted > 0);
    let mut runner = Runner::new(&terrain);
    let laid = |world: &WorldState| {
        owed.iter().filter(|(x, y)| finished(world, (f64::from(*x), f64::from(*y)))).count()
    };
    let mut lowest = f64::INFINITY;
    let mut t = 0;
    while t < 10 * DAY && laid(&world) < wanted {
        runner.step(&mut world, &terrain);
        lowest =
            lowest.min(stock(&world, &city, Good::Stone) - reserve(&world, &city, Good::Stone));
        if t % DAY == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        t += 1;
    }
    eprintln!("{} of {wanted} laid by tick {}", laid(&world), world.tick);
    assert!(laid(&world) >= wanted);
    assert!(lowest >= 0.0, "{lowest}");
    assert_eq!(check_all(&world, &terrain), []);
}

#[test]
fn the_streets_of_grid_go_up_on_the_map_tile_by_tile_never_below_the_reserve() {
    assert_eq!(CITY_LAYOUTS[0], CityLayout::Grid);
    streets_go_up_tile_by_tile(CityLayout::Grid);
}

#[test]
fn the_streets_of_rings_go_up_on_the_map_tile_by_tile_never_below_the_reserve() {
    streets_go_up_tile_by_tile(CityLayout::Rings);
}

#[test]
fn the_streets_of_main_street_go_up_on_the_map_tile_by_tile_never_below_the_reserve() {
    streets_go_up_tile_by_tile(CityLayout::MainStreet);
}

#[test]
fn the_streets_of_quarters_go_up_on_the_map_tile_by_tile_never_below_the_reserve() {
    streets_go_up_tile_by_tile(CityLayout::Quarters);
}
