//! The slow simulations of `apps/server/src/npc-*.test.ts` (`tags: ['slow']`), one file per test
//! file, kept apart from the modules' own tests so their ports don't collide. Each runs game days
//! or weeks of `stepWorld`. Those over 5 s here are ignored with their time alone (#1092); the few under it run.
//! Test-only.

use std::sync::Arc;

use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, ResourceKind, ResourceNode, Stock, WorldState};

use crate::queries::npc_trade::npc_reserve;
use crate::random::new_id;
use crate::walking::Walking;

mod big_city;
mod big_city_fixture;
mod far_nodes;
mod inner_wall;
mod roads;
mod scouts;
mod surplus;
mod training;

/// The terrain a node of `kind` lies on (`NODE_TERRAINS[kind][0]`).
pub fn node_terrain(kind: ResourceKind) -> Terrain {
    match kind {
        ResourceKind::Forest => Terrain::Forest,
        ResourceKind::Stone | ResourceKind::IronOre => Terrain::Hills,
        ResourceKind::GoldOre => Terrain::Mountain,
    }
}

/// A node of `kind` at (x, y), its tile turned to its terrain; returns its id.
pub fn add_node(
    world: &mut WorldState,
    terrain: &mut TerrainMap,
    kind: ResourceKind,
    x: f64,
    y: f64,
) -> String {
    let id = new_id("n", &mut world.next_id);
    world.nodes.push(ResourceNode { id: id.clone(), kind, x, y });
    terrain.tiles[tile_index(terrain.size, x as i32, y as i32)] = node_terrain(kind) as u8;
    id
}

/// A finished workplace of `kind` of `city` at (x, y), on a new node of `resource` when given;
/// returns its id.
pub fn add_workplace(
    world: &mut WorldState,
    terrain: &mut TerrainMap,
    city: &str,
    kind: BuildingKind,
    resource: Option<ResourceKind>,
    x: f64,
    y: f64,
) -> String {
    if let Some(resource) = resource {
        add_node(world, terrain, resource, x, y);
    }
    let id = new_id("b", &mut world.next_id);
    world.buildings.push(crate::test_support::building(&id, kind, None, x, y));
    let c = world.cities.iter_mut().find(|c| c.id == city).expect("the city");
    c.workplace_ids.get_or_insert_with(Vec::new).push(id.clone());
    id
}

/// The city's reserve and `past` of each good above it (`pastReserve`).
pub fn past_reserve(
    world: &WorldState,
    city: &str,
    past: &[(csp_shared::world::Good, f64)],
) -> Stock {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let mut stock = npc_reserve(world, c);
    for (good, n) in past {
        *stock.entry(*good).or_insert(0.0) += n;
    }
    stock
}

/// Walking whose pathfinder finishes every search it is given (`unhurriedWalking`): a clock that
/// never moves leaves it all the time it wants, so a run comes out the same however busy the
/// machine is.
pub fn unhurried_walking(terrain: &TerrainMap) -> Walking {
    Walking::with_clock(Arc::new(terrain.clone()), Box::new(|| 0.0))
}

/// `wrapDistance` on positions that may lie between tiles, as a resident's do.
pub fn wrap_distance_f(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    let size = f64::from(size);
    let delta = |a: f64, b: f64| {
        let d = (b - a).rem_euclid(size);
        if d > size / 2.0 {
            d - size
        } else {
            d
        }
    };
    delta(a.0, b.0).hypot(delta(a.1, b.1))
}

/// The city's storage (its home), to change.
pub fn home_mut<'w>(world: &'w mut WorldState, city: &str) -> &'w mut Building {
    let id = crate::npc_behaviour::npc_home(world, city).expect("a home").id.clone();
    world.buildings.iter_mut().find(|b| b.id == id).expect("the home")
}
