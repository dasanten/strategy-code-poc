//! The Trade Organization and the NPC cities on the new land (T100.5; ADR 0004).

use std::sync::{Arc, OnceLock};

use csp_shared::balance::{MAP_SIZE, NPC_STARTING_SITE_CLEARANCE, NPC_VILLAGE};
use csp_shared::terrain::{Terrain, TerrainMap};

use super::*;
use crate::pathfinding::{PathFinder, PathOptions, PathResult, CARRIAGE_COSTS};
use crate::terrain_gen::generate_terrain;
use crate::world::{create_world, generate_world};

/// Seeds and sizes the rules are checked on: big enough for the HQ and a post in every region.
const MAPS: [(i64, i32); 2] = [(1, 1536), (3, 1536)];

/// The worlds `generate_world` makes on `MAPS`, made once, with their land.
fn generated() -> &'static Vec<(TerrainMap, WorldState, LandSites)> {
    static WORLDS: OnceLock<Vec<(TerrainMap, WorldState, LandSites)>> = OnceLock::new();
    WORLDS.get_or_init(|| {
        MAPS.iter()
            .map(|&(seed, size)| {
                let terrain = generate_terrain(seed, size);
                let world = generate_world(&terrain, seed);
                let land = LandSites::of(&world, &terrain);
                (terrain, world, land)
            })
            .collect()
    })
}

fn hall(world: &WorldState, c: &City) -> (i32, i32) {
    let h = town_hall_of(world, c).expect("a town hall");
    (h.x as i32, h.y as i32)
}

#[test]
fn every_heartland_has_a_post_the_hq_stands_in_the_frontier_and_none_on_an_island_or_a_way() {
    for (terrain, world, land) in generated() {
        let seed = world.seed;
        assert_eq!(check_on_the_land(world, terrain, land), [], "seed {seed}");
        assert!(trade_org_hq(world).is_some(), "seed {seed}");
        let heartlands = land.ids_of(RegionKind::Heartland);
        let posts = trading_posts(world);
        for id in &heartlands {
            let here: Vec<_> = posts
                .iter()
                .filter(|p| {
                    let (x, y) = hall(world, p);
                    land.id_at(x, y) == Some(*id)
                })
                .collect();
            assert_eq!(here.len(), 1, "seed {seed}: heartland {id}");
        }
        // No town stands in a heartland (these maps are small for NPC cities: `npc_cities` checks
        // them on a bigger one).
        let npc: Vec<&City> = world.cities.iter().filter(|c| c.trade_org.is_none()).collect();
        for c in npc {
            let (x, y) = hall(world, c);
            let residents = world.residents.iter().filter(|r| r.city_id.as_deref() == Some(&c.id));
            if residents.count() > NPC_VILLAGE.residents as usize {
                assert_eq!(land.kind_at(x, y), Some(RegionKind::Frontier), "seed {seed}: {}", c.id);
            }
        }
    }
}

#[test]
fn every_caravan_route_and_trader_loop_has_a_carriage_path_and_one_crosses_a_way() {
    let (terrain, world, land) = &generated()[0];
    let mut finder = PathFinder::new(Arc::new(terrain.clone()));
    let mut path = |a: (i32, i32), b: (i32, i32)| match finder.find_path(
        a,
        b,
        &CARRIAGE_COSTS,
        PathOptions::default(),
    ) {
        PathResult::Found { path, .. } => path,
        other => panic!("no carriage path from {a:?} to {b:?}: {}", other.status()),
    };
    let hq = trade_org_hq(world).expect("an HQ");
    let from = hall(world, hq);
    let mut crossed = false;
    for c in &world.caravans {
        let post = world.cities.iter().find(|p| p.id == c.post_id).expect("its post");
        let way = path(from, hall(world, post));
        let regions: Vec<_> = way.iter().filter_map(|&(x, y)| land.id_at(x, y)).collect();
        crossed |= regions.windows(2).any(|w| w[0] != w[1]);
    }
    assert!(crossed, "no caravan goes from one region into another");
    let trader = world.traders.first().expect("a wandering trader");
    let stops: Vec<(i32, i32)> = trader
        .r#loop
        .iter()
        .map(|id| hall(world, world.cities.iter().find(|c| &c.id == id).expect("a stop")))
        .collect();
    for (i, &a) in stops.iter().enumerate() {
        path(a, stops[(i + 1) % stops.len()]);
    }
}

#[test]
fn keeps_clear_of_the_starting_sites() {
    let (seed, size) = MAPS[0];
    let terrain = generate_terrain(seed, size);
    let mut world = create_world(&terrain, seed);
    // A starting site on the middle of every heartland, where its post would stand without one.
    let regions = Regions::of(seed, &terrain);
    let starting: Vec<(f64, f64)> =
        regions.of_kind(RegionKind::Heartland).map(|r| (f64::from(r.x), f64::from(r.y))).collect();
    let land = LandSites::new(regions, starting.clone());
    place_trade_org_hq_on(&mut world, &terrain, &land);
    place_trading_posts_on(&mut world, &terrain, &land);
    place_npc_cities_on(&mut world, &terrain, &land);
    assert!(trading_posts(&world).len() >= starting.len());
    for c in &world.cities {
        let (x, y) = hall(&world, c);
        for s in &starting {
            let d = (f64::from(x) - s.0).hypot(f64::from(y) - s.1);
            let clearance = starting_site_clearance(size);
            assert!(d >= clearance - TRADING_POST.size, "{} is {d} away", c.id);
        }
    }
    assert!(check_on_the_land(&world, &terrain, &land).iter().all(|p| p.rule != ROUTE_RULE));
}

#[test]
fn a_walker_reaches_the_land_they_stand_on_and_never_across_the_sea() {
    // Two Plains blocks with a strait of Sea between them.
    let size = 64;
    let mut tiles = vec![Terrain::Sea as u8; (size * size) as usize];
    for y in 4..60 {
        for x in (4..28).chain(36..60) {
            tiles[(y * size + x) as usize] = Terrain::Plains as u8;
        }
    }
    let terrain = TerrainMap { size, tiles };
    let reach = FootReach::from(&terrain, (10, 10), 40);
    assert!(reach.reaches(27, 59));
    assert!(!reach.reaches(36, 10));
    assert!(!reach.reaches(30, 10), "Sea");
    // Outside its square it reaches nothing.
    let near = FootReach::from(&terrain, (10, 10), 5);
    assert!(near.reaches(15, 15));
    assert!(!near.reaches(20, 10));
}

#[test]
fn a_tile_is_near_a_starting_site_the_short_way_round_the_map() {
    let starting = [(2.0, 2.0)];
    assert!(near_a_starting_site(&starting, 1000, (998.0, 2.0)));
    assert!(!near_a_starting_site(&starting, 1000, (2.0 + starting_site_clearance(1000), 2.0)));
    assert_eq!(starting_site_clearance(MAP_SIZE), NPC_STARTING_SITE_CLEARANCE);
}
