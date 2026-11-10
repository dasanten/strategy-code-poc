//! `apps/server/src/trading-posts.test.ts`, ported one to one.

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use csp_shared::balance::{NPC_CITY_MIN_DISTANCE, TRADING_POST};
use csp_shared::terrain::{tile_index, wrap_distance, Terrain};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::ResourceNode;
use serde_json::json;

use super::*;
use crate::invariants::check_all;
use crate::queries::city::{in_city_area, is_city_building, stored_food};
use crate::realm_test_world::plains;
use crate::sight::entities_in_sight;
use crate::starting_city::found_starting_city;
use crate::terrain_gen::generate_terrain;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, generate_world, step_world};
use crate::world_index::WorldIndex;

/// Resource nodes east of the post's square: two of stone, one of each other kind nearer.
const NODES: [(ResourceKind, i32, i32); 4] = [
    (ResourceKind::Forest, 64, 28),
    (ResourceKind::Stone, 76, 24),
    (ResourceKind::Stone, 70, 40),
    (ResourceKind::IronOre, 62, 12),
];

/// A trading post alone on a Plains map 128 across, its square's top-left at (20, 20).
fn post() -> (WorldState, TerrainMap, String) {
    let mut terrain = plains(128);
    for (kind, x, y) in NODES {
        terrain.tiles[tile_index(terrain.size, x, y)] =
            if kind == ResourceKind::Forest { Terrain::Forest as u8 } else { Terrain::Hills as u8 };
    }
    let mut world = create_world(&terrain, 1);
    world.nodes = NODES
        .iter()
        .enumerate()
        .map(|(i, &(kind, x, y))| {
            serde_json::from_value::<ResourceNode>(
                json!({ "id": format!("n{i}"), "kind": kind, "x": x, "y": y }),
            )
            .unwrap()
        })
        .collect();
    let region = Region { x: 0.0, y: 0.0, width: 128.0, height: 128.0 };
    let resource = common_resource(&world, &region);
    let mut m = Mulberry32::new(3.0);
    let city = found_trading_post(&mut world, &terrain, 20, 20, resource, &mut || m.next());
    (world, terrain, city)
}

fn city_of<'w>(world: &'w WorldState, id: &str) -> &'w City {
    world.cities.iter().find(|c| c.id == id).unwrap()
}

// regions

#[test]
fn cuts_a_full_size_map_into_4_by_4_regions_a_small_one_into_one() {
    assert_eq!(regions(5760).len(), 16);
    assert!(regions(5760).iter().all(|r| r.width == 1440.0 && r.height == 1440.0));
    assert_eq!(regions(128), vec![Region { x: 0.0, y: 0.0, width: 128.0, height: 128.0 }]);
}

#[test]
fn covers_the_map_once() {
    let size = 1000;
    let mut covered = vec![0u8; size * size];
    for r in regions(size as i32) {
        for y in r.y as usize..(r.y + r.height) as usize {
            for x in r.x as usize..(r.x + r.width) as usize {
                covered[y * size + x] += 1;
            }
        }
    }
    assert!(covered.iter().all(|&n| n == 1));
}

// a trading post

#[test]
fn is_a_small_walled_city_of_the_trade_organization_with_a_warehouse() {
    let (world, terrain, id) = post();
    let city = city_of(&world, &id);
    assert_eq!(city.realm_id, None);
    assert_eq!(city.trade_org, Some(TradeOrgCity::Post));
    assert_eq!(
        trading_posts(&world).iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        vec![id.clone()]
    );
    let own: Vec<&Building> =
        world.buildings.iter().filter(|b| b.city_id.as_deref() == Some(id.as_str())).collect();
    let count = |k: BuildingKind| own.iter().filter(|b| b.kind == k).count() as f64;
    assert_eq!(count(BuildingKind::TownHall), 1.0);
    assert_eq!(count(BuildingKind::Storage), 1.0);
    assert_eq!(count(BuildingKind::House), TRADING_POST.houses);
    assert_eq!(count(BuildingKind::Farm), TRADING_POST.farms);
    assert_eq!(count(BuildingKind::Gate), 1.0);
    let people = world.residents.iter().filter(|r| r.city_id.as_deref() == Some(id.as_str()));
    assert_eq!(people.count() as f64, TRADING_POST.residents);
    let warehouse = own.iter().find(|b| b.kind == BuildingKind::Warehouse).unwrap();
    let mut want = Stock::new();
    want.insert(good_of("coins").unwrap(), TRADING_POST.coins);
    want.extend(TRADING_POST.goods.0.iter().map(|(g, n)| (good_of(g).unwrap(), *n)));
    assert_eq!(warehouse.stock.as_ref(), Some(&want));
    for b in &own {
        let inside = in_city_area(&world, &id, b.x as i32, b.y as i32, terrain.size);
        assert_eq!(inside, is_city_building(b), "{} {:?}", b.id, b.kind);
    }
    assert_eq!(check_all(&world, &terrain), vec![]);
}

#[test]
fn works_the_nearest_node_of_its_regions_most_common_resource() {
    let (world, _, id) = post();
    let ids = city_of(&world, &id).workplace_ids.clone().unwrap();
    assert_eq!(ids.len(), 1);
    let workplace = world.buildings.iter().find(|b| b.id == ids[0]).unwrap();
    // Stone is the most common; of the two stone nodes, (70, 40) is nearer the town hall.
    assert_eq!(workplace.kind, node_workplace(ResourceKind::Stone));
    assert_eq!(workplace.city_id, None);
    assert_eq!((workplace.x, workplace.y), (70.0, 40.0));
}

#[test]
#[ignore = "16.8 s alone; see #1092"]
fn left_alone_keeps_its_size_and_keeps_itself_fed() {
    let (mut world, terrain, id) = post();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    let without_stock = |w: &WorldState| {
        w.buildings.iter().map(|b| Building { stock: None, ..b.clone() }).collect::<Vec<_>>()
    };
    let buildings = without_stock(&world);
    let people: Vec<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    for _ in 0..(30.0 * TICKS_PER_GAME_DAY) as usize {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
        if world.tick as f64 % TICKS_PER_GAME_DAY == 0.0 {
            assert_eq!(check_all(&world, &terrain), vec![]);
        }
    }
    assert_eq!(without_stock(&world), buildings);
    let now: HashSet<&str> = world.residents.iter().map(|r| r.id.as_str()).collect();
    assert!(people.iter().all(|p| now.contains(p.as_str())));
    assert!(stored_food(&world, city_of(&world, &id)) > 0.0);
}

// placing trading posts

/// The generated map and world the placing tests share (`beforeAll`).
fn generated() -> &'static (TerrainMap, WorldState) {
    static G: OnceLock<(TerrainMap, WorldState)> = OnceLock::new();
    G.get_or_init(|| {
        let terrain = generate_terrain(1, 2880);
        let world = generate_world(&terrain, 1);
        (terrain, world)
    })
}

fn hall_tile(world: &WorldState, c: &City) -> (i32, i32) {
    let h = town_hall_of(world, c).unwrap();
    (h.x as i32, h.y as i32)
}

#[test]
fn places_about_one_in_every_region_spread_evenly() {
    let (terrain, world) = generated();
    let posts = trading_posts(world);
    let all = regions(terrain.size);
    assert_eq!(all.len(), 4);
    assert!(posts.len() + 1 >= all.len());
    // At most one in each region, and none near another city.
    for r in &all {
        let inside = posts.iter().filter(|c| {
            let h = town_hall_of(world, c).unwrap();
            in_region(r, (h.x, h.y))
        });
        assert!(inside.count() <= 1);
    }
    for p in &posts {
        let hall = hall_tile(world, p);
        for c in world.cities.iter().filter(|o| o.id != p.id) {
            let d = wrap_distance(terrain.size, hall, hall_tile(world, c));
            assert!(d >= NPC_CITY_MIN_DISTANCE - TRADING_POST.size);
        }
    }
    assert_eq!(check_all(world, terrain), vec![]);
}

#[test]
fn keeps_starting_cities_at_a_distance() {
    let (terrain, world) = generated();
    let mut w = world.clone();
    let realm = found_starting_city(&mut w, terrain, 1, None);
    let realm_id = w.realms[realm].id.clone();
    let start = w.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm_id.as_str())).unwrap();
    for p in trading_posts(&w) {
        let d = wrap_distance(terrain.size, hall_tile(&w, p), hall_tile(&w, start));
        assert!(d >= NPC_CITY_MIN_DISTANCE / 2.0);
    }
}

#[test]
fn places_the_same_posts_for_the_same_world_and_no_more_once_each_region_has_one() {
    let (terrain, world) = generated();
    assert_eq!(&generate_world(terrain, 1), world);
    let mut w = world.clone();
    assert_eq!(place_trading_posts(&mut w, terrain), Vec::<String>::new());
    assert_eq!(&w, world);
}

#[test]
fn places_them_out_of_sight_of_every_player() {
    let (terrain, _) = generated();
    let mut w = create_world(terrain, 1);
    let realm = found_starting_city(&mut w, terrain, 1, None);
    let realm_id = w.realms[realm].id.clone();
    place_trading_posts(&mut w, terrain);
    let index = WorldIndex::new(&w, terrain.size);
    let seen: HashSet<String> = entities_in_sight(&w, &index, Some(&realm_id), None)
        .iter()
        .map(|e| e.id().to_string())
        .collect();
    for p in trading_posts(&w) {
        assert!(!seen.contains(&p.id));
    }
}
