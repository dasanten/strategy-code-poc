//! Vessels on the water (`CONTEXT.md`: Water, Vessel, Building a boat): where one stands, where a
//! finished boat floats, what one holds. Read-only, like the other queries.

use std::collections::{HashSet, VecDeque};

use csp_shared::balance::BOAT_CAPACITY;
use csp_shared::protocol::LoadLevel;
use csp_shared::terrain::{is_water, terrain_at, wrap, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Vessel, VesselKind, WorldState};

use super::building::building_at;
use super::carriages::load_level;

/// The eight tiles around one, the four straight ones first, so the nearest come first.
const AROUND: [(i32, i32); 8] =
    [(0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1)];

/// The most water tiles `launch_tile` looks through for a free one: a crowded shore, not a sea.
const LAUNCH_SEARCH: usize = 1024;

/// The vessel on a tile, if there is one (`CONTEXT.md`: Vessel: one vessel per tile).
pub fn vessel_at(world: &WorldState, x: i32, y: i32) -> Option<&Vessel> {
    world.vessels.iter().find(|v| v.x as i32 == x && v.y as i32 == y)
}

/// Most weight a vessel carries, in kg (`CONTEXT.md`: Boat).
pub fn vessel_capacity(v: &Vessel) -> f64 {
    match v.kind {
        VesselKind::Boat => BOAT_CAPACITY,
    }
}

/// How heavily a vessel looks loaded to a Player who can't see its load.
pub fn vessel_load_level(v: &Vessel) -> LoadLevel {
    load_level(&v.load, vessel_capacity(v))
}

/// The finished haven a boat site on (x, y) is laid out on (`CONTEXT.md`: Building a boat): one
/// whose footprint covers the tile.
pub fn haven_for(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    building_at(world, x, y, size).filter(|b| b.kind == BuildingKind::Haven && b.site.is_none())
}

/// Where a boat finished at a site on (x, y) floats (`CONTEXT.md`: Building a boat): the nearest
/// free water tile next to the site, a straight one before a diagonal one. With every water tile
/// next to it taken, the nearest free one further out over the water they join. `None` if there
/// is none within `LAUNCH_SEARCH` water tiles, or the site touches no water.
pub fn launch_tile(world: &WorldState, map: &TerrainMap, x: i32, y: i32) -> Option<(i32, i32)> {
    let size = map.size;
    let taken: HashSet<(i32, i32)> =
        world.vessels.iter().map(|v| (v.x as i32, v.y as i32)).collect();
    let mut seen: HashSet<(i32, i32)> = HashSet::from([(x, y)]);
    let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
    let push = |t: (i32, i32), seen: &mut HashSet<(i32, i32)>, q: &mut VecDeque<_>| {
        let t = (wrap(t.0, size), wrap(t.1, size));
        if seen.insert(t) && is_water(terrain_at(map, t.0, t.1)) {
            q.push_back(t);
        }
    };
    for (dx, dy) in AROUND {
        push((x + dx, y + dy), &mut seen, &mut queue);
    }
    let mut looked = 0;
    while let Some(t) = queue.pop_front() {
        if !taken.contains(&t) {
            return Some(t);
        }
        looked += 1;
        if looked >= LAUNCH_SEARCH {
            return None;
        }
        for (dx, dy) in AROUND {
            push((t.0 + dx, t.1 + dy), &mut seen, &mut queue);
        }
    }
    None
}
