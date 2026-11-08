//! An NPC city's road crew (`apps/server/src/npc-roads.ts`, `CONTEXT.md`: NPC road, City layout,
//! Spare hands' work; ADR 0026): with nothing short, up to `npc_road_crew` of its spare hands build
//! its layout's streets beside the buildings that stand, then road from its home to each of its
//! workplaces outside its area, nearest first, then on to the nearest Trade Org warehouse in its
//! trader's reach and the edge of its nearest neighbour's area. A way is worked out once and kept
//! in the plan as plain data (`CityPlan.roads`); its streets are worked out each pass.

use std::collections::HashSet;

use csp_shared::balance::{
    road_crew_food, set_out_food, CITY_AREA_MARGIN, NPC_ROAD_CREW, NPC_ROAD_LONGEST,
    NPC_TRADER_REACH, TRADE_ORG_HQ, WALK_TICKS_PER_TILE,
};
use csp_shared::footprint::{footprint_tiles, is_at, middle_of};
use csp_shared::terrain::{tile_index, wrap_delta, wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, CityRoad, Good, GoodsSpot, PickUpOrder,
    ResidentOrder, Stock, Task, TradeOrgCity, WorldState,
};
use serde_json::json;

use crate::city_layout::{streets_owed, GateAt};
use crate::npc_behaviour::{default_script, walk_to};
use crate::npc_chain::{holds_batch, own_workplaces, project_needs};
use crate::npc_founding::{founding_materials, full_but_materials};
use crate::npc_growth::wall_rings;
use crate::pathfinding::{PathResult, Point};
use crate::queries::building::{build_materials, road_tiles};
use crate::queries::city::{in_city_area, is_city_building};
use crate::queries::goods::carried_food;
use crate::queries::names::{held, held_in, placed};
use crate::queries::npc_trade::{is_big_npc_city, npc_needs_scale, npc_reserve};
use crate::queries::residents::{carry_capacity, stock_weight};
use crate::sight::InvariantViolation;
use crate::terrain_gen::js_hypot;
use crate::walking::Walking;

/// What a road crew asks for a way (`WayFinder`): `Walking` in the game, a found path a little at
/// a time.
pub trait WayFinder {
    /// The way a resident of `side` would walk; asked again until it is settled. `key` names it.
    fn way(&mut self, key: &str, from: Point, to: Point, side: Option<&str>, area: Option<HashSet<usize>>) -> PathResult;
}

/// The way finder for one call, borrowed again from an optional one (as `tick::reborrow`).
pub fn reborrow<'s>(ways: &'s mut Option<&mut dyn WayFinder>) -> Option<&'s mut dyn WayFinder> {
    match ways {
        Some(w) => Some(&mut **w),
        None => None,
    }
}

impl WayFinder for Walking {
    fn way(&mut self, key: &str, from: Point, to: Point, side: Option<&str>, area: Option<HashSet<usize>>) -> PathResult {
        Walking::way(self, key, from, to, side, area)
    }
}

/// What one tile of road takes (`roadMaterials`).
fn road_materials() -> Stock {
    build_materials(BuildingKind::Road)
}

/// What the city keeps from its crew (`keeps`): its reserve, what its project still needs, and
/// once it would otherwise be full a town hall's and a storage's materials.
fn keeps(world: &WorldState, city: &City) -> Stock {
    let mut want = npc_reserve(world, city);
    let plan = world.city_plans.get(&city.id);
    let mut add = |goods: Stock| {
        for (good, n) in goods {
            *want.entry(good).or_insert(0.0) += n;
        }
    };
    add(project_needs(world, plan.and_then(|p| p.project.as_ref())));
    if plan.is_some_and(|p| full_but_materials(world, city, p)) {
        add(founding_materials(None));
    }
    want
}

/// Whole tiles of road the goods make (`tilesIn`); 0 when they lack some or are below 0.
fn tiles_in(goods: &Stock) -> f64 {
    let mut tiles = f64::INFINITY;
    for (good, n) in road_materials() {
        tiles = tiles.min((held(goods, good) / n).floor());
    }
    if tiles == f64::INFINITY {
        0.0
    } else {
        tiles.max(0.0)
    }
}

/// What a store holds above what the city keeps, by the goods a road takes (`aboveKept`).
fn above_kept(world: &WorldState, city: &City, store: &Building) -> Stock {
    let want = keeps(world, city);
    road_materials()
        .keys()
        .map(|good| (*good, held_in(store.stock.as_ref(), *good) - held(&want, *good)))
        .collect()
}

/// The next tile still to build that no other of the crew took, and how many are left
/// (`nextTile`): of its streets first, then of its roads in order.
fn next_tile(
    world: &WorldState,
    streets: &[(f64, f64)],
    roads: &[CityRoad],
    size: i32,
    taken: &HashSet<(i32, i32)>,
) -> Option<((i32, i32), usize)> {
    let built = road_tiles(world, size);
    let mut tile = None;
    let mut left = 0;
    let all = std::iter::once(streets).chain(roads.iter().map(|r| r.tiles.as_slice()));
    for tiles in all {
        for t in tiles {
            let at = (t.0 as i32, t.1 as i32);
            if built.contains(&tile_index(size, at.0, at.1)) {
                continue;
            }
            left += 1;
            if tile.is_none() && !taken.contains(&at) {
                tile = Some(at);
            }
        }
    }
    tile.map(|t| (t, left))
}

/// The tiles of a city's area, as tile indices, for a way's search (`areaTiles`).
fn area_tiles(world: &WorldState, city_id: &str, size: i32) -> HashSet<usize> {
    let m = CITY_AREA_MARGIN as i32;
    let mut tiles = HashSet::new();
    for b in &world.buildings {
        if b.city_id.as_deref() != Some(city_id) || !is_city_building(b) {
            continue;
        }
        for (x, y) in footprint_tiles(placed(b), size) {
            for dy in -m..=m {
                for dx in -m..=m {
                    tiles.insert(tile_index(size, x + dx, y + dy));
                }
            }
        }
    }
    tiles
}

/// Whether a tile lies in the HQ's inner ring round its hall (`inInnerRingAround`).
fn in_inner_ring_around(hall: &Building, at: (i32, i32), size: i32) -> bool {
    let c = middle_of(placed(hall), size);
    let d = js_hypot(f64::from(wrap_delta(c.0, at.0, size)), f64::from(wrap_delta(c.1, at.1, size)));
    d <= TRADE_ORG_HQ.inner_radius + 0.5
}

/// Whether a building is a finished Trade Org warehouse a road can lead to (`isPost`): not one in
/// the HQ's inner ring.
fn is_post(world: &WorldState, b: &Building, size: i32) -> bool {
    if b.kind != BuildingKind::Warehouse || b.site.is_some() {
        return false;
    }
    let Some(owner) = world.cities.iter().find(|c| Some(&c.id) == b.city_id.as_ref()) else { return false };
    let Some(trade_org) = owner.trade_org else { return false };
    let hall = if trade_org == TradeOrgCity::Hq {
        world.buildings.iter().find(|x| x.id == owner.town_hall_id)
    } else {
        None
    };
    hall.is_none_or(|h| !in_inner_ring_around(h, (b.x as i32, b.y as i32), size))
}

/// A place a road goes on to past its workplaces (`RoadOn`).
struct RoadOn {
    to: String,
    at: Point,
    distance: f64,
    /// The neighbour, for a road to the edge of its area.
    city: Option<String>,
}

/// Warehouses that are posts within its trader's reach of `home`, nearest first (`postsInReach`).
fn posts_in_reach(world: &WorldState, home: &Building, size: i32) -> Vec<RoadOn> {
    let home_at = (home.x as i32, home.y as i32);
    let mut posts: Vec<RoadOn> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Warehouse)
        .filter_map(|b| {
            let at = (b.x as i32, b.y as i32);
            let distance = wrap_distance(size, home_at, at);
            (distance <= NPC_TRADER_REACH && is_post(world, b, size))
                .then(|| RoadOn { to: b.id.clone(), at, distance, city: None })
        })
        .collect();
    posts.sort_by(|a, b| a.distance.total_cmp(&b.distance));
    posts
}

/// The cities, by their town halls, nearest `home` first; not the Trade Org's (`neighbours`).
fn neighbours(world: &WorldState, city: &City, home: &Building, size: i32) -> Vec<RoadOn> {
    let home_at = (home.x as i32, home.y as i32);
    let mut out: Vec<RoadOn> = world
        .cities
        .iter()
        .filter(|o| o.id != city.id && o.trade_org.is_none())
        .filter_map(|o| {
            let hall = world.buildings.iter().find(|b| b.id == o.town_hall_id)?;
            let at = (hall.x as i32, hall.y as i32);
            Some(RoadOn { to: o.id.clone(), at, distance: wrap_distance(size, home_at, at), city: Some(o.id.clone()) })
        })
        .collect();
    out.sort_by(|a, b| a.distance.total_cmp(&b.distance));
    out
}

/// Where a road goes on to once its workplaces are joined, in order (`placesOn`): the nearest post,
/// the nearest neighbour, and for a big city then the other posts and neighbours, nearest first. A
/// neighbour who keeps the road between them is left out.
fn places_on(world: &WorldState, city: &City, home: &Building, size: i32) -> Vec<RoadOn> {
    let mut posts = posts_in_reach(world, home, size).into_iter();
    let mut others = neighbours(world, city, home, size).into_iter();
    let (post, next) = (posts.next(), others.next());
    let mut further: Vec<RoadOn> = if is_big_npc_city(world, city) { posts.chain(others).collect() } else { Vec::new() };
    further.sort_by(|a, b| a.distance.total_cmp(&b.distance));
    post.into_iter()
        .chain(next)
        .chain(further)
        .filter(|p| {
            !world
                .city_plans
                .get(&p.to)
                .and_then(|pl| pl.roads.as_ref())
                .is_some_and(|roads| roads.iter().any(|r| r.to == city.id))
        })
        .collect()
}

/// Whether a road's far end still stands, for one that isn't to a workplace (`leadsOn`).
fn leads_on(world: &WorldState, to: &str, size: i32) -> bool {
    if world.cities.iter().any(|c| c.id == to && c.trade_org.is_none()) {
        return true;
    }
    world.buildings.iter().find(|b| b.id == to).is_some_and(|b| is_post(world, b, size))
}

/// Brings its streets and ways up to date and says whether it has a road to build now
/// (`planRoads`). The plan is `world.city_plans[city.id]`.
fn plan_roads(world: &mut WorldState, city: &City, home: &Building, ways: &mut dyn WayFinder, terrain: &TerrainMap) -> bool {
    let size = terrain.size;
    let gate = wall_rings(world, city, home, size).map(|r| GateAt { dx: r.new_gate.dx, dy: r.new_gate.dy });
    let roads_now = road_tiles(world, size);
    let streets: Vec<(f64, f64)> = streets_owed(world, city, home, gate, terrain, &roads_now)
        .into_iter()
        .map(|(x, y)| (f64::from(x), f64::from(y)))
        .collect();
    let plan = world.city_plans.get_mut(&city.id).expect("a plan");
    plan.streets = (!streets.is_empty()).then(|| streets.clone());
    let old_roads = plan.roads.clone().unwrap_or_default();
    let (hx, hy) = (home.x as i32, home.y as i32);
    let fewest_tiles = |x: i32, y: i32| wrap_delta(hx, x, size).abs().max(wrap_delta(hy, y, size).abs());
    let mut settle = |to: &str, at: Point, area: Option<HashSet<usize>>| -> Option<CityRoad> {
        let ends: Vec<(i32, i32)> = match &area {
            Some(a) => a.iter().map(|&t| (t as i32 % size, t as i32 / size)).collect(),
            None => vec![at],
        };
        if ends.iter().all(|&(x, y)| f64::from(fewest_tiles(x, y)) > NPC_ROAD_LONGEST) {
            return Some(CityRoad { to: to.to_string(), tiles: Vec::new() });
        }
        let found = ways.way(&format!("{}:{to}", city.id), (hx, hy), at, Some(&city.id), area);
        let tiles = match found {
            PathResult::Searching => return None,
            PathResult::Found { path, .. } if path.len() as f64 <= NPC_ROAD_LONGEST => path,
            _ => Vec::new(),
        };
        Some(CityRoad { to: to.to_string(), tiles: tiles.into_iter().map(|(x, y)| (f64::from(x), f64::from(y))).collect() })
    };
    let mut places: Vec<&Building> = own_workplaces(world, city)
        .into_iter()
        .filter(|b| b.site.is_none() && !in_city_area(world, &city.id, b.x as i32, b.y as i32, size))
        .collect();
    let d = |b: &Building| wrap_distance(size, (hx, hy), (b.x as i32, b.y as i32));
    places.sort_by(|a, b| d(a).total_cmp(&d(b)));
    let place_ids: HashSet<String> = places.iter().map(|b| b.id.clone()).collect();
    let places: Vec<(String, Point)> = places.iter().map(|b| (b.id.clone(), (b.x as i32, b.y as i32))).collect();
    let mut roads: Vec<CityRoad> = Vec::new();
    let mut searching = false;
    for (id, at) in places {
        let mut road = old_roads.iter().find(|r| r.to == id).cloned();
        if road.is_none() && !searching {
            road = settle(&id, at, None);
            searching = road.is_none();
        }
        roads.extend(road);
    }
    for road in &old_roads {
        if !place_ids.contains(&road.to) && leads_on(world, &road.to, size) {
            roads.push(road.clone());
        }
    }
    let none = HashSet::new();
    if !searching && next_tile(world, &streets, &roads, size, &none).is_none() {
        for place in places_on(world, city, home, size) {
            if roads.iter().any(|r| r.to == place.to) {
                continue;
            }
            let area = place.city.as_ref().map(|c| area_tiles(world, c, size));
            let Some(road) = settle(&place.to, place.at, area) else { break };
            roads.push(road);
            if next_tile(world, &streets, &roads, size, &none).is_some() {
                break;
            }
        }
    }
    let has_next = next_tile(world, &streets, &roads, size, &none).is_some();
    let plan = world.city_plans.get_mut(&city.id).expect("a plan");
    plan.roads = (!roads.is_empty()).then_some(roads);
    has_next
}

/// The road crew of this planning pass (`roadCrew`), from `unneeded`, the spare hands nothing short
/// has a use for: none at a Trade Org city, or while what a road takes is short or neither the
/// storage nor the crew has any to spare, or with no road to build. Those on the crew stay on it;
/// next come those free of any workplace, then those who would go back to one, and last a scout
/// out. `old_jobs` are the plan's jobs from its last pass.
#[allow(clippy::too_many_arguments)]
pub fn road_crew(
    world: &mut WorldState,
    city: &City,
    unneeded: &[usize],
    returning: &HashSet<String>,
    store: Option<usize>,
    home: Option<&Building>,
    ways: Option<&mut dyn WayFinder>,
    terrain: Option<&TerrainMap>,
) -> Vec<usize> {
    let (Some(ways), Some(terrain), Some(store), Some(home)) = (ways, terrain, store, home) else {
        return Vec::new();
    };
    if city.trade_org.is_some() || unneeded.is_empty() {
        return Vec::new();
    }
    let plan = world.city_plans.get(&city.id).expect("a plan");
    let on_crew = |i: usize| plan.jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Road);
    let above = above_kept(world, city, &world.buildings[store]);
    if above.values().any(|n| *n < 0.0) {
        return Vec::new();
    }
    let in_hand: f64 = unneeded.iter().filter(|&&i| on_crew(i)).map(|&i| tiles_in(&world.residents[i].carried)).sum();
    if tiles_in(&above) + in_hand < 1.0 {
        return Vec::new();
    }
    let ranks: Vec<(usize, u8)> = unneeded
        .iter()
        .map(|&i| {
            let id = &world.residents[i].id;
            let scout = plan.scouts.as_ref().is_some_and(|s| s.contains_key(id));
            let rank = if on_crew(i) {
                0
            } else if scout {
                3
            } else if returning.contains(id) {
                2
            } else {
                1
            };
            (i, rank)
        })
        .collect();
    if !plan_roads(world, city, home, ways, terrain) {
        return Vec::new();
    }
    let mut sorted = ranks;
    sorted.sort_by_key(|(_, r)| *r);
    let most = npc_road_crew(world, city);
    sorted.into_iter().take(most.max(0.0) as usize).map(|(i, _)| i).collect()
}

/// Most of an NPC city's spare hands on its road crew (`npcRoadCrew`): more as it grows.
pub fn npc_road_crew(world: &WorldState, city: &City) -> f64 {
    NPC_ROAD_CREW * npc_needs_scale(world, city)
}

/// Whether a resident is running the Build default on a tile of road (`onRoadWork`).
pub fn on_road_work(r: &csp_shared::world::Resident) -> bool {
    r.script.as_ref().is_some_and(|s| {
        s.script_id == 0
            && s.task == Some(Task::Build)
            && s.memory.get("building").and_then(|v| v.as_str()) == Some("road")
    })
}

/// Gives an idle resident on the road crew their next step, if they have one (`layRoad`): with what
/// a tile takes in hand and the Food to get home from it, the Build default on the next tile still
/// to build that no other of the crew took; else the walk to the storage, and there a pick-up of
/// the Food for the walk and as many tiles' materials as fit and it can spare. False with no tile
/// to go to or nothing to fetch. `crew` are the city's residents on the crew, them too.
pub fn lay_road(world: &mut WorldState, city: &City, i: usize, crew: &[usize], store: Option<usize>, size: i32) -> bool {
    let mut taken = HashSet::new();
    for &o in crew {
        if world.residents[o].id == world.residents[i].id {
            continue;
        }
        let at = world.residents[o].script.as_ref().and_then(|s| s.memory.get("at")).and_then(|v| v.as_object());
        if let Some(at) = at {
            if let (Some(x), Some(y)) = (at.get("x").and_then(|v| v.as_f64()), at.get("y").and_then(|v| v.as_f64())) {
                taken.insert((x as i32, y as i32));
            }
        }
    }
    let plan = world.city_plans.get(&city.id).expect("a plan");
    let streets = plan.streets.clone().unwrap_or_default();
    let roads = plan.roads.clone().unwrap_or_default();
    let Some(((x, y), left)) = next_tile(world, &streets, &roads, size, &taken) else { return false };
    let r = &world.residents[i];
    let holds = holds_batch(Some(&r.carried), &road_materials());
    let store_b = store.map(|s| &world.buildings[s]);
    let walk = store_b.map_or(0.0, |s| wrap_distance(size, (s.x as i32, s.y as i32), (x, y)) * WALK_TICKS_PER_TILE);
    let fed = store_b.is_none_or(|s| held_in(s.stock.as_ref(), Good::Food) < 1.0) || carried_food(r) >= road_crew_food(walk);
    if holds && fed {
        let r = &mut world.residents[i];
        r.order = None;
        r.script = Some(default_script(Task::Build, json!({ "building": "road", "at": { "x": x, "y": y } })));
        return true;
    }
    let Some(store) = store_b else { return false };
    let mut above = above_kept(world, city, store);
    for &o in crew {
        if let Some(ResidentOrder::PickUp(p)) = &world.residents[o].order {
            for (good, n) in above.iter_mut() {
                *n -= held(&p.goods, *good);
            }
        }
    }
    if !holds && tiles_in(&above) < 1.0 {
        return false;
    }
    let (sid, sat) = (store.id.clone(), (store.x, store.y));
    if !is_at((r.x as i32, r.y as i32), placed(store), size) {
        walk_to(&mut world.residents[i], sat);
        return true;
    }
    let tick = world.tick as f64;
    let mut room = carry_capacity(r, tick) - stock_weight(&r.carried);
    let food = held_in(store.stock.as_ref(), Good::Food).min((set_out_food(walk) - carried_food(r)).max(0.0)).min(room.max(0.0));
    room -= stock_weight(&Stock::from([(Good::Food, food)]));
    let tiles = tiles_in(&above).min(left as f64).min((room / stock_weight(&road_materials())).floor());
    // Holding a tile's materials already, they can come for the Food alone.
    if tiles < 1.0 && !(holds && food > 0.0) {
        return false;
    }
    let mut goods = if food > 0.0 { Stock::from([(Good::Food, food)]) } else { Stock::new() };
    if tiles >= 1.0 {
        for (good, n) in road_materials() {
            goods.insert(good, n * tiles);
        }
    }
    let from = GoodsSpot::Storage { storage_id: sid };
    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder { from, goods }));
    true
}

/// Invariant `npc-roads-once` (`CONTEXT.md`: NPC road; ADR 0004): two cities never each keep a road
/// to the other, and no way is longer than `NPC_ROAD_LONGEST`.
pub fn npc_roads_once(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        let roads = world.city_plans.get(&city.id).and_then(|p| p.roads.as_ref());
        for road in roads.into_iter().flatten() {
            if road.tiles.len() as f64 > NPC_ROAD_LONGEST {
                out.push(InvariantViolation {
                    invariant: "npc-roads-once".into(),
                    message: format!("{}'s way to {} is {} tiles long", city.id, road.to, road.tiles.len()),
                    entity_ids: vec![city.id.clone(), road.to.clone()],
                });
            }
            if city.id > road.to {
                continue;
            }
            let back = world.city_plans.get(&road.to).and_then(|p| p.roads.as_ref());
            if back.is_some_and(|rs| rs.iter().any(|r| r.to == city.id)) {
                out.push(InvariantViolation {
                    invariant: "npc-roads-once".into(),
                    message: format!("{} and {} each keep a road to the other", city.id, road.to),
                    entity_ids: vec![city.id.clone(), road.to.clone()],
                });
            }
        }
    }
    out
}
