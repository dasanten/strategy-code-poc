//! `apps/server/src/city-layout.test.ts`, ported one to one.

use std::collections::{HashMap, HashSet};
use std::f64::consts::{FRAC_1_SQRT_2, PI};

use csp_shared::balance::{
    NpcCitySize, CITY_GRID_BLOCK, CITY_RING_STEP, CITY_SIDE_LANE_GAP, NPC_TOWN, NPC_VILLAGE,
    NPC_WALL_STEP,
};
use csp_shared::footprint::{footprint_tiles, middle_of, Placed, FOOTPRINT};
use csp_shared::terrain::{is_passable_terrain, terrain_at, tile_index, wrap, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityLayout, CityProject, TradeOrgCity, WorldState,
};

use super::*;
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::{house_tile, new_wall, next_project, wall_rings, Rings};
use crate::npc_test_world::{fill_houses, plains, storage_of, village, Village, WALL};
use crate::queries::building::{build_problem, building_at, TerrainLookup};
use crate::queries::names::{kind_name, placed};
use crate::random::{new_id, Mulberry32};
use crate::walls::{may_step, wall_map};
use crate::world::create_world;

const STEP: i32 = NPC_WALL_STEP as i32;

fn city_of<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).expect("the city")
}

fn city_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut City {
    world.cities.iter_mut().find(|c| c.id == id).expect("the city")
}

fn gate_of(rings: Option<&Rings>) -> Option<GateAt> {
    rings.map(|r| GateAt { dx: r.new_gate.dx, dy: r.new_gate.dy })
}

/// What the city's layout says now, for a city with a plan for its wall (`planOf`).
fn plan_of(world: &WorldState, city: &str, home: &Building, size: i32) -> LayoutPlan {
    let c = city_of(world, city);
    let rings = wall_rings(world, c, home, size);
    layout_plan(world, c, home, gate_of(rings.as_ref()), size).expect("a plan")
}

/// The Grid's plan for a city with no layout yet (`planOfGrid`).
fn plan_of_grid(world: &WorldState, city: &str, home: &Building, size: i32) -> LayoutPlan {
    let mut c = city_of(world, city).clone();
    let rings = wall_rings(world, &c, home, size);
    c.layout = Some(CityLayout::Grid);
    layout_plan(world, &c, home, gate_of(rings.as_ref()), size).expect("a plan")
}

fn tiles_of(kind: BuildingKind, x: i32, y: i32, size: i32) -> Vec<(i32, i32)> {
    footprint_tiles(Placed { kind: kind_name(kind), x, y }, size)
}

/// Expects a building of `kind` at (x, y) to follow the city's layout (`expectFollows`).
fn expect_follows(
    world: &WorldState,
    city: &str,
    home: &Building,
    kind: BuildingKind,
    (x, y): (i32, i32),
    size: i32,
) {
    let plan = plan_of(world, city, home, size);
    assert!(plan.spot(kind, x, y), "{kind:?} at ({x}, {y}) on no spot");
    for (tx, ty) in tiles_of(kind, x, y, size) {
        assert!(!plan.street(tx, ty), "{kind:?} at ({x}, {y}) on a street at ({tx}, {ty})");
    }
}

/// Puts up a building where it stands, finished, as the city's (`put`).
fn put(world: &mut WorldState, city: &str, kind: BuildingKind, x: i32, y: i32) -> Building {
    let id = new_id("b", &mut world.next_id);
    let b: Building = serde_json::from_value(serde_json::json!({
        "id": id, "kind": kind_name(kind), "cityId": city, "x": x, "y": y,
    }))
    .expect("a building");
    world.buildings.push(b.clone());
    b
}

/// Where the city puts its next `kind`, with its rings as they stand now.
fn next_tile(
    world: &WorldState,
    city: &str,
    home: &Building,
    terrain: &TerrainMap,
    kind: BuildingKind,
) -> Option<(i32, i32)> {
    let c = city_of(world, city);
    let rings = wall_rings(world, c, home, terrain.size);
    house_tile(world, c, home, terrain, rings.as_ref(), kind)
}

fn no_build_problem(world: &WorldState, (x, y): (i32, i32), kind: BuildingKind, t: &TerrainMap) {
    let p = build_problem(world, x, y, kind, Some(t as &dyn TerrainLookup));
    assert_eq!(p, None, "{kind:?} at ({x}, {y})");
}

fn ring_from(home: &Building, x: i32, y: i32) -> i32 {
    (x - home.x as i32).abs().max((y - home.y as i32).abs())
}

/// Whether someone of the city can walk from `from` to a tile beyond its walls, four ways, through
/// its gate (`canWalkOut`).
fn can_walk_out(
    world: &WorldState,
    terrain: &TerrainMap,
    city: &str,
    from: (i32, i32),
    out: i32,
    home: &Building,
) -> bool {
    let size = terrain.size;
    let walls = wall_map(world, terrain);
    let (hx, hy) = (home.x as i32, home.y as i32);
    let mut seen = HashSet::from([tile_index(size, from.0, from.1)]);
    let mut todo = vec![from];
    while let Some((tx, ty)) = todo.pop() {
        if (tx - hx).abs().max((ty - hy).abs()) > out {
            return true;
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (x, y) = (wrap(tx + dx, size), wrap(ty + dy, size));
            let i = tile_index(size, x, y);
            if seen.contains(&i) || !is_passable_terrain(terrain_at(terrain, x, y)) {
                continue;
            }
            if !may_step(&walls, Some(city), tile_index(size, tx, ty), i, false, false) {
                continue;
            }
            seen.insert(i);
            todo.push((x, y));
        }
    }
    false
}

/// A new city of `kind` that picked `layout`, which goes by the world's seed (`newCity`).
/// `prepare` readies the ground first.
fn new_city(
    layout: CityLayout,
    kind: &NpcCitySize,
    prepare: Option<&dyn Fn(&mut TerrainMap)>,
) -> Village {
    for seed in 1.. {
        let mut terrain = plains(200);
        if let Some(p) = prepare {
            p(&mut terrain);
        }
        let mut world = create_world(&terrain, seed);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, kind, 20, 20, &mut || m.next(), None);
        if city_of(&world, &city).layout == Some(layout) {
            let home = npc_home(&world, &city).expect("a home").clone();
            return Village { world, terrain, city, home };
        }
    }
    unreachable!()
}

/// Expects a new city's houses to follow its layout, and its whole wall to be part of it
/// (`expectSoundNewCity`).
fn expect_sound_new_city(v: &Village, kind: &NpcCitySize) {
    let Village { world, terrain, city, home } = v;
    let houses: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::House && b.city_id.as_deref() == Some(city))
        .collect();
    assert_eq!(houses.len() as f64, kind.houses);
    for h in houses {
        expect_follows(world, city, home, BuildingKind::House, (h.x as i32, h.y as i32), 200);
    }
    // The whole ring, so it knows its wall as rings (`wallRings`) and builds by it.
    let walls: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
        .collect();
    assert!(walls.iter().all(|b| b.city_id.as_deref() == Some(city.as_str())));
    let rings = wall_rings(world, city_of(world, city), home, terrain.size);
    assert_eq!(rings.map(|r| r.inner), Some((kind.size / 2.0).floor() as i32));
    assert_eq!(check_all(world, terrain), vec![]);
}

const LAYOUT_KINDS: [BuildingKind; 6] = [
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Smelter,
    BuildingKind::Mint,
    BuildingKind::Smithy,
    BuildingKind::Stable,
];

fn hall_at(world: &mut WorldState, x: f64, y: f64) -> usize {
    let id = new_id("b", &mut world.next_id);
    world.buildings.push(
        serde_json::from_value(serde_json::json!({
            "id": id, "kind": "townHall", "cityId": null, "x": x, "y": y,
        }))
        .expect("a hall"),
    );
    world.buildings.len() - 1
}

// picking a city layout

#[test]
fn a_seed_gives_a_stable_pick_one_of_the_layouts() {
    for id in ["city1", "city2", "city99"] {
        assert_eq!(pick_layout(7, id), pick_layout(7, id));
        assert!(CITY_LAYOUTS.contains(&pick_layout(7, id)));
    }
}

#[test]
fn an_npc_city_gets_one_when_it_comes_to_be_a_trading_post_none() {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    assert_eq!(city_of(&world, &city).layout, Some(pick_layout(world.seed, &city)));
    let mut m = Mulberry32::new(8.0);
    let post = crate::trading_posts::found_trading_post(
        &mut world,
        &terrain,
        200,
        200,
        None,
        &mut || m.next(),
    );
    assert_eq!(city_of(&world, &post).trade_org, Some(TradeOrgCity::Post));
    assert_eq!(city_of(&world, &post).layout, None);
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn a_daughter_gets_one_when_its_town_hall_founds_it_a_players_city_none() {
    let terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let a = hall_at(&mut world, 20.0, 20.0);
    let c = crate::cities::found_city(&mut world, a, None);
    assert!(world.cities[c].layout.is_some());
    let b = hall_at(&mut world, 40.0, 20.0);
    let c = crate::cities::found_city(&mut world, b, Some("r1"));
    assert_eq!(world.cities[c].layout, None);
}

#[test]
fn a_self_managed_city_gets_one_when_its_leader_dies_and_loses_it_when_it_joins_a_realm() {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let ri = crate::starting_city::found_starting_city(&mut world, &terrain, 1, None);
    let realm = world.realms[ri].id.clone();
    let city = world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm)).unwrap().id.clone();
    assert_eq!(city_of(&world, &city).layout, None);
    crate::survival::end_realm(&mut world, &realm, terrain.size);
    assert_eq!(city_of(&world, &city).layout, Some(pick_layout(world.seed, &city)));
    assert_eq!(city_layouts_sound(&world), vec![]);
    let mut m = Mulberry32::new(7.0);
    let npc = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 200, 200, &mut || m.next(), None);
    crate::capture::join_realm(&mut world, &npc, &realm, terrain.size);
    assert_eq!(city_of(&world, &npc).layout, None);
    assert_eq!(city_layouts_sound(&world), vec![]);
}

#[test]
fn catches_a_layout_on_the_wrong_city_and_an_npc_city_without_one() {
    let mut v = village(None);
    v.city_mut().layout = None;
    assert_eq!(city_layouts_sound(&v.world).len(), 1);
    v.city_mut().layout = Some(CityLayout::Grid);
    v.city_mut().trade_org = Some(TradeOrgCity::Post);
    assert_eq!(city_layouts_sound(&v.world).len(), 1);
}

// the Grid layout

#[test]
fn a_new_villages_houses_stand_in_its_blocks_and_its_wall_stays_part_of_it() {
    expect_sound_new_city(&new_city(CityLayout::Grid, &NPC_VILLAGE, None), &NPC_VILLAGE);
}

#[test]
fn a_new_towns_houses_stand_in_its_blocks_and_its_wall_stays_part_of_it() {
    expect_sound_new_city(&new_city(CityLayout::Grid, &NPC_TOWN, None), &NPC_TOWN);
}

#[test]
fn puts_houses_storages_workshops_and_stables_in_spots_of_its_blocks() {
    let Village { world, terrain, city, home } = village(Some(CityLayout::Grid));
    for kind in LAYOUT_KINDS {
        let t = next_tile(&world, &city, &home, &terrain, kind).expect("a spot");
        expect_follows(&world, &city, &home, kind, t, terrain.size);
    }
}

#[test]
fn every_kind_that_goes_by_the_layout_fits_a_block_whole() {
    for kind in LAYOUT_KINDS {
        assert!(FOOTPRINT.get(kind_name(kind)).unwrap_or(1) as f64 <= CITY_GRID_BLOCK);
    }
}

#[test]
fn skips_a_spot_that_doesnt_fit() {
    let Village { mut world, mut terrain, city, home } = village(Some(CityLayout::Grid));
    let size = terrain.size;
    let rings = wall_rings(&world, city_of(&world, &city), &home, size);
    let tile = |w: &WorldState, t: &TerrainMap| {
        house_tile(w, city_of(w, &city), &home, t, rings.as_ref(), BuildingKind::House)
    };
    let first = tile(&world, &terrain).unwrap();
    terrain.tiles[tile_index(size, first.0, first.1)] = Terrain::Mountain as u8;
    let next = tile(&world, &terrain).unwrap();
    assert_ne!(next, first);
    expect_follows(&world, &city, &home, BuildingKind::House, next, size);
    // Something standing there goes the same way.
    terrain.tiles[tile_index(size, first.0, first.1)] = Terrain::Plains as u8;
    put(&mut world, &city, BuildingKind::Wall, first.0 + 1, first.1 + 1);
    assert_eq!(tile(&world, &terrain), Some(next));
}

#[test]
fn keeps_the_way_out_of_its_gate_free() {
    let Village { world, terrain, city, home } = village(Some(CityLayout::Grid));
    let plan = plan_of(&world, &city, &home, terrain.size);
    for dy in -WALL - STEP..=WALL + STEP {
        assert!(plan.street(home.x as i32, home.y as i32 + dy));
    }
}

/// Moves the city's gate to (x, y), swapping it with the wall standing there.
fn move_gate(world: &mut WorldState, city: &str, (x, y): (f64, f64)) -> (f64, f64) {
    let g = world
        .buildings
        .iter()
        .position(|b| b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city))
        .unwrap();
    let was = (world.buildings[g].x, world.buildings[g].y);
    let w = world.buildings.iter().position(|b| b.x == x && b.y == y).unwrap();
    (world.buildings[w].x, world.buildings[w].y) = was;
    (world.buildings[g].x, world.buildings[g].y) = (x, y);
    was
}

#[test]
fn leaves_a_lane_through_a_gate_wherever_it_stands() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Grid));
    let (hx, hy) = (home.x as i32, home.y as i32);
    // A gate on the east side, as a Player may have built one: a row through it.
    let g = world
        .buildings
        .iter()
        .position(|b| b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str()))
        .unwrap();
    let (ex, ey) = (f64::from(hx + WALL), f64::from(hy + 2));
    let w = world.buildings.iter().position(|b| b.x == ex && b.y == ey).unwrap();
    (world.buildings[g].x, world.buildings[g].y) = (ex, ey);
    world.buildings[w].x = home.x;
    let plan = plan_of(&world, &city, &home, terrain.size);
    for dx in -WALL + 1..=WALL + STEP {
        assert!(plan.street(hx + dx, hy + 2));
    }
}

/// The world as `migrateWorld` 102 → 103 leaves it for an NPC city without a layout: the layout
/// its seed picks, and nothing else changed. That step stays in the TypeScript, which migrates
/// saves older than the freeze (`FREEZE_FORMAT_VERSION`, ADR 0030), so here it is applied by hand.
fn given_its_layout(world: &mut WorldState, city: &str) {
    let seed = world.seed;
    city_mut(world, city).layout = Some(pick_layout(seed, city));
}

#[test]
fn a_migrated_city_loses_nothing_and_follows_the_layout_around_what_stands() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Grid));
    city_mut(&mut world, &city).layout = None;
    // A house as a city put it before layouts, on what is now a street.
    let plan = plan_of_grid(&world, &city, &home, terrain.size);
    let lane = (home.x as i32, home.y as i32 - 3);
    assert!(plan.street(lane.0, lane.1));
    let old = put(&mut world, &city, BuildingKind::House, lane.0, lane.1);
    let before = world.buildings.clone();
    let residents = world.residents.clone();
    given_its_layout(&mut world, &city);
    assert_eq!(world.buildings, before);
    assert_eq!(world.residents, residents);
    assert_eq!(city_of(&world, &city).layout, Some(pick_layout(world.seed, &city)));
    assert_eq!(building_at(&world, lane.0, lane.1, terrain.size).map(|b| b.id.clone()), Some(old.id));
    assert_eq!(check_all(&world, &terrain), vec![]);
    let home = npc_home(&world, &city).unwrap().clone();
    let t = next_tile(&world, &city, &home, &terrain, BuildingKind::House).unwrap();
    expect_follows(&world, &city, &home, BuildingKind::House, t, terrain.size);
}

#[test]
fn the_migration_leaves_players_cities_and_the_trade_organizations_without_one() {
    // The 102 → 103 step stays in the TypeScript (see `given_its_layout`); what it leaves alone
    // is what a Player's city and a trading post have from the start: no layout.
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let ri = crate::starting_city::found_starting_city(&mut world, &terrain, 1, None);
    let realm = world.realms[ri].id.clone();
    let city = world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm)).unwrap().id.clone();
    let mut m = Mulberry32::new(8.0);
    let post = crate::trading_posts::found_trading_post(
        &mut world,
        &terrain,
        200,
        200,
        None,
        &mut || m.next(),
    );
    assert_eq!(city_of(&world, &city).layout, None);
    assert_eq!(city_of(&world, &post).layout, None);
}

// whichever layout

#[test]
fn a_daughter_with_just_its_town_hall_finds_room_for_its_storage_then_a_house() {
    for layout in CITY_LAYOUTS {
        let terrain = plains(200);
        let mut world = create_world(&terrain, 1);
        let h = hall_at(&mut world, 100.0, 100.0);
        let c = crate::cities::found_city(&mut world, h, None);
        world.cities[c].layout = Some(layout);
        let city = world.cities[c].id.clone();
        let hall = world.buildings[h].clone();
        let storage = house_tile(&world, &world.cities[c], &hall, &terrain, None, BuildingKind::Storage)
            .expect("room for a storage");
        expect_follows(&world, &city, &hall, BuildingKind::Storage, storage, terrain.size);
        put(&mut world, &city, BuildingKind::Storage, storage.0, storage.1);
        let home = npc_home(&world, &city).unwrap().clone();
        let house = house_tile(&world, city_of(&world, &city), &home, &terrain, None, BuildingKind::House)
            .expect("room for a house");
        expect_follows(&world, &city, &home, BuildingKind::House, house, terrain.size);
    }
}

#[test]
fn grows_out_through_a_new_wall_and_nobody_is_walled_in() {
    for layout in CITY_LAYOUTS {
        let Village { mut world, terrain, city, home } = village(Some(layout));
        let size = terrain.size;
        let rings = wall_rings(&world, city_of(&world, &city), &home, size).unwrap();
        assert_eq!(rings.inner, WALL);
        let mut broke = false;
        // House after house until it has broken out through its wall and filled the new one.
        for _ in 0..400 {
            let Some(t) = next_tile(&world, &city, &home, &terrain, BuildingKind::House) else {
                break;
            };
            expect_follows(&world, &city, &home, BuildingKind::House, t, size);
            no_build_problem(&world, t, BuildingKind::House, &terrain);
            let b = put(&mut world, &city, BuildingKind::House, t.0, t.1);
            broke |= ring_from(&home, b.x as i32, b.y as i32) >= WALL;
        }
        assert!(broke, "{layout:?}");
        let rings = wall_rings(&world, city_of(&world, &city), &home, size).unwrap();
        assert_eq!((rings.inner, rings.outer, rings.expanding), (WALL, WALL + STEP, true));
        // The new wall goes up, its gate in line with the old one and free.
        let tiles = new_wall(&world, &home, &terrain, &rings);
        let gates: Vec<(i32, i32)> =
            tiles.iter().filter(|t| t.kind == BuildingKind::Gate).map(|t| (t.x, t.y)).collect();
        assert_eq!(gates, vec![(home.x as i32, home.y as i32 + WALL + STEP)]);
        for t in &tiles {
            put(&mut world, &city, t.kind, t.x, t.y);
        }
        let inside = (home.x as i32, home.y as i32 + 2);
        assert!(can_walk_out(&world, &terrain, &city, inside, WALL + STEP, &home));
        // The old wall comes down: the city holds, and it goes on building inside the new wall.
        world.buildings.retain(|b| {
            !((b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
                && ring_from(&home, b.x as i32, b.y as i32) == WALL)
        });
        let rings = wall_rings(&world, city_of(&world, &city), &home, size).unwrap();
        assert_eq!(rings.inner, WALL + STEP);
        assert!(can_walk_out(&world, &terrain, &city, inside, WALL + STEP, &home));
        if let Some(next) = next_tile(&world, &city, &home, &terrain, BuildingKind::House) {
            expect_follows(&world, &city, &home, BuildingKind::House, next, size);
        }
        assert_eq!(check_all(&world, &terrain), vec![], "{layout:?}");
    }
}

#[test]
fn still_has_its_project_go_to_the_edge_with_no_room_inside() {
    for layout in CITY_LAYOUTS {
        let Village { mut world, mut terrain, city, home } = village(Some(layout));
        let size = terrain.size;
        fill_houses(&mut world, &city, &home);
        let s = storage_of(&world, &city);
        world.buildings[s].stock = Some(
            [(csp_shared::world::Good::Food, 400.0), (csp_shared::world::Good::Wood, 100.0)]
                .into_iter()
                .collect(),
        );
        // Rock on every spot inside the wall.
        let plan = plan_of(&world, &city, &home, size);
        let (hx, hy) = (home.x as i32, home.y as i32);
        for dy in -(WALL - 1)..=WALL - 1 {
            for dx in -(WALL - 1)..=WALL - 1 {
                let (x, y) = (hx + dx, hy + dy);
                if plan.street(x, y) || building_at(&world, x, y, size).is_some() {
                    continue;
                }
                terrain.tiles[tile_index(size, x, y)] = Terrain::Mountain as u8;
            }
        }
        let p = next_project(&world, city_of(&world, &city), &home, &terrain);
        let Some(CityProject::Build { building: BuildingKind::House, x, y }) = p else {
            panic!("{layout:?}: {p:?}");
        };
        let (x, y) = (x as i32, y as i32);
        expect_follows(&world, &city, &home, BuildingKind::House, (x, y), size);
        let ring = ring_from(&home, x, y);
        assert!(ring > WALL - 2 && ring < WALL + STEP, "{layout:?}: ring {ring}");
    }
}

// the Rings layout

fn hall_of(world: &WorldState, city: &str, size: i32) -> (i32, i32) {
    let c = city_of(world, city);
    middle_of(placed(crate::queries::city::town_hall_of(world, c).unwrap()), size)
}

/// How far the middle of a footprint lies from the middle of the town hall (`farOf`).
fn far_of(hall: (i32, i32), kind: BuildingKind, (x, y): (i32, i32)) -> f64 {
    let middle = f64::from(FOOTPRINT.get(kind_name(kind)).unwrap_or(1) as i32 - 1) / 2.0;
    (f64::from(x) + middle - f64::from(hall.0)).hypot(f64::from(y) + middle - f64::from(hall.1))
}

/// Which circle that is: 1 between the first lane and the second (`circleOf`).
fn circle_of(far: f64) -> i32 {
    (far / CITY_RING_STEP).floor() as i32
}

/// Puts up `n` more houses where the city says, and gives them back (`build`).
fn build(
    world: &mut WorldState,
    terrain: &TerrainMap,
    city: &str,
    home: &Building,
    n: usize,
) -> Vec<Building> {
    let mut out = Vec::new();
    for _ in 0..n {
        let t = next_tile(world, city, home, terrain, BuildingKind::House).expect("a spot");
        no_build_problem(world, t, BuildingKind::House, terrain);
        expect_follows(world, city, home, BuildingKind::House, t, terrain.size);
        out.push(put(world, city, BuildingKind::House, t.0, t.1));
    }
    out
}

/// The tiles reached from `from` along streets, side to side, within `reach` of it
/// (`alongStreets`).
fn along_streets(plan: &LayoutPlan, from: (i32, i32), reach: i32) -> HashSet<(i32, i32)> {
    let mut seen = HashSet::from([from]);
    let mut todo = vec![from];
    while let Some((tx, ty)) = todo.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (tx + dx, ty + dy);
            if seen.contains(&n) || !plan.street(n.0, n.1) {
                continue;
            }
            if (n.0 - from.0).abs().max((n.1 - from.1).abs()) > reach {
                continue;
            }
            seen.insert(n);
            todo.push(n);
        }
    }
    seen
}

fn xy(b: &Building) -> (i32, i32) {
    (b.x as i32, b.y as i32)
}

#[test]
fn a_new_villages_houses_stand_on_its_circles_and_its_wall_stays_part_of_it() {
    expect_sound_new_city(&new_city(CityLayout::Rings, &NPC_VILLAGE, None), &NPC_VILLAGE);
}

#[test]
fn a_new_towns_houses_stand_on_its_circles_and_its_wall_stays_part_of_it() {
    expect_sound_new_city(&new_city(CityLayout::Rings, &NPC_TOWN, None), &NPC_TOWN);
}

#[test]
fn puts_houses_in_circles_round_the_town_hall_with_lanes_free_between_them() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Rings));
    let hall = hall_of(&world, &city, terrain.size);
    let houses = build(&mut world, &terrain, &city, &home, 60);
    for h in &houses {
        let far = far_of(hall, BuildingKind::House, xy(h));
        // Its middle lies on the line halfway between two lanes, not just anywhere between them.
        let line = (f64::from(circle_of(far)) + 0.5) * CITY_RING_STEP;
        assert!(circle_of(far) > 0);
        assert!((far - line).abs() <= FRAC_1_SQRT_2);
        // No tile of it on a lane, counted without the plan.
        for (x, y) in footprint_tiles(placed(h), terrain.size) {
            let d = f64::from(x - hall.0).hypot(f64::from(y - hall.1));
            let off = (d - crate::queries::js_round(d / CITY_RING_STEP) * CITY_RING_STEP).abs();
            assert!(off > FRAC_1_SQRT_2);
        }
    }
    let circles: HashSet<i32> =
        houses.iter().map(|h| circle_of(far_of(hall, BuildingKind::House, xy(h)))).collect();
    assert!(circles.len() > 1);
}

#[test]
fn goes_all_the_way_round_the_first_circle_closes_up() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    let houses = build(&mut world, &terrain, &city, &home, 60);
    let side = |(x, y): (i32, i32)| {
        let a = (f64::from(y) + 0.5 - f64::from(hall.1)).atan2(f64::from(x) + 0.5 - f64::from(hall.0));
        (((a + PI) / PI) * 4.0).floor() as i32
    };
    let first: HashSet<i32> = houses
        .iter()
        .filter(|h| circle_of(far_of(hall, BuildingKind::House, xy(h))) == 1)
        .map(|h| side(xy(h)))
        .collect();
    assert_eq!(first.len(), 8);
    // Nothing more fits on that circle: the rest of it is the way to the gate.
    let plan = plan_of(&world, &city, &home, size);
    let ground = |x: i32, y: i32| {
        plan.spot(BuildingKind::House, x, y)
            && circle_of(far_of(hall, BuildingKind::House, (x, y))) == 1
            && tiles_of(BuildingKind::House, x, y, size)
                .iter()
                .all(|&(tx, ty)| !plan.street(tx, ty) && building_at(&world, tx, ty, size).is_none())
    };
    let reach = 2 * CITY_RING_STEP as i32;
    let mut left = Vec::new();
    for y in hall.1 - reach..=hall.1 + reach {
        for x in hall.0 - reach..=hall.0 + reach {
            if ground(x, y) {
                left.push((x, y));
            }
        }
    }
    assert_eq!(left, vec![]);
}

#[test]
fn has_room_for_a_kind_all_the_way_round_every_circle() {
    for kind in LAYOUT_KINDS {
        let Village { world, terrain, city, home } = village(Some(CityLayout::Rings));
        let size = terrain.size;
        let hall = hall_of(&world, &city, size);
        let plan = plan_of(&world, &city, &home, size);
        let middle = f64::from(FOOTPRINT.get(kind_name(kind)).unwrap_or(1) as i32 - 1) / 2.0;
        let mut sides: HashMap<i32, HashSet<i32>> = HashMap::new();
        let reach = 4 * CITY_RING_STEP as i32;
        for y in hall.1 - reach..=hall.1 + reach {
            for x in hall.0 - reach..=hall.0 + reach {
                if !plan.spot(kind, x, y) {
                    continue;
                }
                if tiles_of(kind, x, y, size).iter().any(|&(tx, ty)| plan.street(tx, ty)) {
                    continue;
                }
                let circle = circle_of(far_of(hall, kind, (x, y)));
                let angle = (f64::from(y) + middle - f64::from(hall.1))
                    .atan2(f64::from(x) + middle - f64::from(hall.0));
                let s = ((((angle + PI) / PI) * 4.0).floor() as i32) % 8;
                sides.entry(circle).or_default().insert(s);
            }
        }
        for circle in [1, 2, 3] {
            assert_eq!(sides.get(&circle).map(HashSet::len), Some(8), "{kind:?} circle {circle}");
        }
    }
}

#[test]
fn puts_houses_workshops_and_stables_on_its_circles() {
    let Village { world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    for kind in [
        BuildingKind::House,
        BuildingKind::Smelter,
        BuildingKind::Mint,
        BuildingKind::Smithy,
        BuildingKind::Stable,
    ] {
        let t = next_tile(&world, &city, &home, &terrain, kind).expect("a spot");
        expect_follows(&world, &city, &home, kind, t, size);
        assert!(circle_of(far_of(hall, kind, t)) > 0);
    }
}

#[test]
fn puts_a_storage_inside_the_first_lane_while_there_is_room_then_on_its_circles() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    let mut circles = Vec::new();
    for _ in 0..30 {
        let t = next_tile(&world, &city, &home, &terrain, BuildingKind::Storage).expect("a spot");
        expect_follows(&world, &city, &home, BuildingKind::Storage, t, size);
        circles.push(circle_of(far_of(hall, BuildingKind::Storage, t)));
        put(&mut world, &city, BuildingKind::Storage, t.0, t.1);
    }
    assert_eq!(circles[0], 0);
    assert!(circles.iter().any(|&c| c > 0));
}

#[test]
fn a_lake_by_the_town_hall_leaves_a_daughter_room_for_its_storage_on_the_other_sides() {
    let mut terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let h = hall_at(&mut world, 100.0, 100.0);
    let c = crate::cities::found_city(&mut world, h, None);
    world.cities[c].layout = Some(CityLayout::Rings);
    let city = world.cities[c].id.clone();
    let middle = hall_of(&world, &city, terrain.size);
    // Water all along its north and its east.
    for y in middle.1 - 8..=middle.1 + 8 {
        for x in middle.0 - 8..=middle.0 + 8 {
            if y < middle.1 - 1 || x > middle.0 + 1 {
                terrain.tiles[tile_index(terrain.size, x, y)] = Terrain::Lake as u8;
            }
        }
    }
    let hall = world.buildings[h].clone();
    let t = house_tile(&world, &world.cities[c], &hall, &terrain, None, BuildingKind::Storage)
        .expect("room for a storage");
    no_build_problem(&world, t, BuildingKind::Storage, &terrain);
    expect_follows(&world, &city, &hall, BuildingKind::Storage, t, terrain.size);
}

#[test]
fn keeps_a_way_free_from_its_gate_to_the_middle_and_leaves_the_far_side_alone() {
    let Village { world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    let plan = plan_of(&world, &city, &home, size);
    let gate = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str()))
        .unwrap();
    let (gx, gy) = xy(gate);
    assert_eq!(gx, hall.0);
    assert!(gy > hall.1);
    // On out past the gate too, to where the next one goes.
    for y in hall.1..=gy + STEP {
        assert!(plan.street(gx, y));
    }
    // Between the lanes on the far side of the town hall, a circle runs on unbroken.
    let line = (1.5 * CITY_RING_STEP).floor() as i32;
    assert!(!plan.street(hall.0, hall.1 - line));
    assert!(!plan.street(hall.0 - line, hall.1));
}

#[test]
fn lays_the_way_from_a_gate_out_of_line_with_the_middle_straight_in_then_along_to_it() {
    let Village { mut world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    // A gate on the east side, as a Player may have built one.
    let east = (f64::from(home.x as i32 + WALL), home.y + 2.0);
    move_gate(&mut world, &city, east);
    let gate = (east.0 as i32, east.1 as i32);
    let plan = plan_of(&world, &city, &home, size);
    for x in hall.0..=gate.0 + STEP {
        assert!(plan.street(x, gate.1));
    }
    let down = (hall.1 - gate.1).signum();
    let mut y = gate.1;
    while y != hall.1 {
        assert!(plan.street(hall.0, y));
        y += down;
    }
    assert!(along_streets(&plan, gate, 40).contains(&hall));
}

#[test]
fn joins_every_lane_to_its_gate_side_to_side_so_a_road_can_run_along_them() {
    let Village { world, terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    let plan = plan_of(&world, &city, &home, size);
    let gate = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str()))
        .unwrap();
    let reached = along_streets(&plan, xy(gate), 60);
    for y in hall.1 - 25..=hall.1 + 25 {
        for x in hall.0 - 25..=hall.0 + 25 {
            if plan.street(x, y) {
                assert!(reached.contains(&(x, y)), "({x}, {y})");
            }
        }
    }
}

#[test]
fn a_lake_leaves_a_gap_in_a_circle_which_goes_on_beyond_it() {
    let Village { mut world, mut terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    // A pond on the first circle, north-east of the town hall.
    let pond = (hall.0 + 6, hall.1 - 5);
    let water = |x: i32, y: i32| f64::from(x - pond.0).hypot(f64::from(y - pond.1)) <= 2.5;
    for y in pond.1 - 3..=pond.1 + 3 {
        for x in pond.0 - 3..=pond.0 + 3 {
            if water(x, y) {
                terrain.tiles[tile_index(size, x, y)] = Terrain::Lake as u8;
            }
        }
    }
    let houses = build(&mut world, &terrain, &city, &home, 60);
    for h in &houses {
        for (x, y) in footprint_tiles(placed(h), size) {
            assert!(!water(x, y));
        }
    }
    // The circle stands on both sides of it, no nearer the town hall or further out for it.
    let first: Vec<&Building> = houses
        .iter()
        .filter(|h| circle_of(far_of(hall, BuildingKind::House, xy(h))) == 1)
        .collect();
    let angle = |h: &Building| {
        (h.y + 0.5 - f64::from(pond.1)).atan2(h.x + 0.5 - f64::from(pond.0))
    };
    let (px, py) = (f64::from(pond.0), f64::from(pond.1));
    assert!(first.iter().any(|h| h.x < px && h.y < py && angle(h) < 0.0));
    assert!(first.iter().any(|h| h.x > px && h.y > py));
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn a_lake_over_a_whole_circle_sends_it_on_to_the_next_and_the_lanes_stay_where_they_are() {
    let Village { mut world, mut terrain, city, home } = village(Some(CityLayout::Rings));
    let size = terrain.size;
    let hall = hall_of(&world, &city, size);
    let before = plan_of(&world, &city, &home, size);
    let mut lanes = Vec::new();
    for y in hall.1 - 20..=hall.1 + 20 {
        for x in hall.0 - 20..=hall.0 + 20 {
            lanes.push(before.street(x, y));
            let d = f64::from(x - hall.0).hypot(f64::from(y - hall.1));
            if d > CITY_RING_STEP
                && d < 2.0 * CITY_RING_STEP
                && building_at(&world, x, y, size).is_none()
            {
                terrain.tiles[tile_index(size, x, y)] = Terrain::Lake as u8;
            }
        }
    }
    let houses = build(&mut world, &terrain, &city, &home, 10);
    for h in &houses {
        assert!(circle_of(far_of(hall, BuildingKind::House, xy(h))) > 1);
    }
    let after = plan_of(&world, &city, &home, size);
    let mut i = 0;
    for y in hall.1 - 20..=hall.1 + 20 {
        for x in hall.0 - 20..=hall.0 + 20 {
            assert_eq!(after.street(x, y), lanes[i], "({x}, {y})");
            i += 1;
        }
    }
}
