//! The setup the NPC cities' tests share (`apps/server/src/npc-growth.fixture.ts`): a village
//! alone on a Plains map with a forest node east of it, and helpers to fill it and run it.
//! Test-only.

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{MAP_SIZE, NPC_VILLAGE, NPC_WALL_STEP};
use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::{tile_index, wrap_delta, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, CityLayout, ResourceKind, ResourceNode, WorldState,
};

use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::{new_wall, wall_rings};
use crate::queries::building::building_at;
use crate::queries::city_area::free_housing;
use crate::queries::names::placed;
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

pub use crate::test_support::plains;

/// How far the village's wall stands from its home, along each direction (`WALL`).
pub const WALL: i32 = (NPC_VILLAGE.size / 2.0) as i32;

/// Where the forest node lies: east of the village, beyond where its next wall would stand
/// (`FOREST`).
pub const FOREST: (i32, i32) = (34 + 40, 34);

/// A village and where it stands (`village()`).
pub struct Village {
    pub world: WorldState,
    pub terrain: TerrainMap,
    pub city: String,
    pub home: Building,
}

impl Village {
    /// The village's city as it is now.
    pub fn city(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the village")
    }

    /// The village's city, to change.
    pub fn city_mut(&mut self) -> &mut City {
        let id = self.city.clone();
        self.world.cities.iter_mut().find(|c| c.id == id).expect("the village")
    }

    /// Where in `world.buildings` the village's storage stands (`storageOf`).
    pub fn storage(&self) -> usize {
        storage_of(&self.world, &self.city)
    }
}

/// A village alone on a Plains map, its top-left wall tile at (20, 20) and its home (the storage)
/// at (34, 34), `WALL` tiles from its wall, with a forest node east of it (`village`). It follows
/// `layout` from here on, if given.
pub fn village(layout: Option<CityLayout>) -> Village {
    let mut terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    if let Some(layout) = layout {
        world.cities.iter_mut().find(|c| c.id == city).expect("the village").layout = Some(layout);
    }
    world.nodes.push(ResourceNode {
        id: "forest".into(),
        kind: ResourceKind::Forest,
        x: f64::from(FOREST.0),
        y: f64::from(FOREST.1),
    });
    terrain.tiles[tile_index(terrain.size, FOREST.0, FOREST.1)] = Terrain::Forest as u8;
    let home = npc_home(&world, &city).expect("a home").clone();
    Village { world, terrain, city, home }
}

/// The ring round the home that the nearest tile of a footprint lies on (`nearRing`).
pub fn near_ring(home: &Building, b: &Building) -> i32 {
    footprint_tiles(placed(b), MAP_SIZE)
        .into_iter()
        .map(|(x, y)| (x - home.x as i32).abs().max((y - home.y as i32).abs()))
        .min()
        .expect("a tile")
}

/// Rock fills the rest of the inside of the village's wall, so it has no room left there
/// (`fillInside`).
pub fn fill_inside(world: &mut WorldState, terrain: &mut TerrainMap, home: &Building) {
    let (hx, hy) = (home.x as i32, home.y as i32);
    for dy in -(WALL - 1)..=WALL - 1 {
        for dx in -(WALL - 1)..=WALL - 1 {
            let (x, y) = (hx + dx, hy + dy);
            if building_at(world, x, y, MAP_SIZE).is_some() {
                continue;
            }
            world.nodes.push(ResourceNode {
                id: format!("rock{x},{y}"),
                kind: ResourceKind::Stone,
                x: f64::from(x),
                y: f64::from(y),
            });
            terrain.tiles[tile_index(terrain.size, x, y)] = Terrain::Hills as u8;
        }
    }
}

/// Adds adults to the city until its houses are full (`fillHouses`).
pub fn fill_houses(world: &mut WorldState, city: &str, home: &Building) {
    let mut m = Mulberry32::new(3.0);
    while free_housing(world, city) > 0.0 {
        let id = new_id("r", &mut world.next_id);
        let fields = NewResident {
            id: &id,
            owner: None,
            city_id: Some(city),
            x: home.x,
            y: home.y,
            tick: world.tick as f64,
        };
        let r = new_resident(&mut || m.next(), &fields, None);
        world.residents.push(r);
    }
}

/// Where in `world.buildings` the city's storage stands (`storageOf`).
pub fn storage_of(world: &WorldState, city: &str) -> usize {
    world
        .buildings
        .iter()
        .position(|b| b.city_id.as_deref() == Some(city) && b.kind == BuildingKind::Storage)
        .expect("a storage")
}

/// The city's finished walls and gates `d` tiles out from its home (`ring`).
pub fn ring<'w>(
    world: &'w WorldState,
    city: &str,
    home: &Building,
    size: i32,
    d: i32,
) -> Vec<&'w Building> {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_deref() == Some(city)
                && (b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
                && b.site.is_none()
                && wrap_delta(home.x as i32, b.x as i32, size)
                    .abs()
                    .max(wrap_delta(home.y as i32, b.y as i32, size).abs())
                    == d
        })
        .collect()
}

/// A world stepped as the game steps it, with walking, its scratch kept across ticks.
pub struct Runner {
    pub walking: Walking,
    pub scratch: Scratch,
}

impl Runner {
    pub fn new(terrain: &TerrainMap) -> Self {
        Runner { walking: Walking::new(Arc::new(terrain.clone())), scratch: Scratch::default() }
    }

    /// One `stepWorld`.
    pub fn step(&mut self, world: &mut WorldState, terrain: &TerrainMap) {
        step_world(world, terrain, &mut self.scratch, Some(&mut self.walking), None);
    }
}

/// Runs the world for up to `ticks`, or until `done`, checking the invariants every game day and,
/// every tick until it happens, that the old wall (`old_ids`) stands whole while any tile of the
/// new wall is unfinished (`run`).
pub fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    city: &str,
    home: &Building,
    old_ids: &HashSet<String>,
    ticks: usize,
    done: &dyn Fn(&WorldState) -> bool,
) {
    let mut runner = Runner::new(terrain);
    let mut coming_down = false;
    for _ in 0..ticks {
        if done(world) {
            break;
        }
        runner.step(world, terrain);
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(world, terrain), []);
        }
        if coming_down {
            continue;
        }
        let old: Vec<&Building> =
            world.buildings.iter().filter(|b| old_ids.contains(&b.id)).collect();
        if old.len() == old_ids.len() && old.iter().all(|b| b.teardown.is_none()) {
            continue;
        }
        // The first stretch of the old wall is coming down: the new one is finished.
        let c = world.cities.iter().find(|c| c.id == city).expect("the city").clone();
        let rings = wall_rings(world, &c, home, terrain.size).expect("rings");
        assert_eq!(rings.outer, rings.inner + NPC_WALL_STEP as i32);
        assert!(new_wall(world, home, terrain, &rings).iter().all(|w| w.done));
        coming_down = true;
    }
}
