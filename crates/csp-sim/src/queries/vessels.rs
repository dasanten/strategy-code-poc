//! Vessels on the water (`CONTEXT.md`: Water, Vessel, Building a boat, Beside a vessel): where
//! one stands, where a finished boat floats, what one holds, who is aboard and where they get off.
//! Read-only, like the other queries.

use std::collections::{HashSet, VecDeque};

use csp_shared::balance::{BOAT_CAPACITY, MAP_SIZE, PASSENGER_WEIGHT};
use csp_shared::protocol::LoadLevel;
use csp_shared::terrain::{
    is_passable_terrain, is_water, terrain_at, wrap, wrap_distance, TerrainMap,
};
use csp_shared::world::{Building, BuildingKind, Good, Resident, Vessel, VesselKind, WorldState};

use super::building::building_at;
use super::carriages::load_level;
use super::combat::in_contact;
use super::driving::carriage_of_resident;
use super::residents::{good_weight, stock_weight};
use crate::walls::is_wall_or_gate;

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

/// The vessel of an id (`CONTEXT.md`: Vessel).
pub fn vessel_by_id<'w>(world: &'w WorldState, id: &str) -> Option<&'w Vessel> {
    world.vessels.iter().find(|v| v.id == id)
}

/// The vessel a resident is aboard, if it is one rather than a carriage (`CONTEXT.md`: Passenger,
/// Beside a vessel).
pub fn vessel_aboard<'w>(world: &'w WorldState, r: &Resident) -> Option<&'w Vessel> {
    vessel_by_id(world, r.aboard.as_deref()?)
}

/// The residents aboard a vessel (`CONTEXT.md`: Passenger).
pub fn vessel_passengers<'w>(world: &'w WorldState, vessel_id: &str) -> Vec<&'w Resident> {
    world.residents.iter().filter(|r| r.aboard.as_deref() == Some(vessel_id)).collect()
}

/// What a vessel still holds, in kg (`CONTEXT.md`: Beside a vessel): its capacity less its goods
/// and a fixed weight for each passenger, as on a carriage.
pub fn vessel_room(world: &WorldState, v: &Vessel) -> f64 {
    let people = vessel_passengers(world, &v.id).len() as f64;
    vessel_capacity(v) - stock_weight(&v.load) - people * PASSENGER_WEIGHT
}

/// How many more whole units of a good fit on a vessel.
pub fn units_that_fit_vessel(world: &WorldState, v: &Vessel, good: Good) -> f64 {
    0f64.max((vessel_room(world, v) / good_weight(good) + 1e-9).floor())
}

/// Whether a vessel is of the resident's realm. One of nobody, or a resident of no Player, is of
/// no one's.
pub fn vessel_of_resident(v: &Vessel, r: &Resident) -> bool {
    carriage_of_resident(&v.realm_id, &None, r)
}

/// Whether (x, y) is beside the vessel (`CONTEXT.md`: Beside a vessel): touching its water tile,
/// straight or diagonally. The vessel's own tile is not beside it.
pub fn beside_vessel(v: &Vessel, x: f64, y: f64) -> bool {
    let (vx, vy) = (v.x as i32, v.y as i32);
    let (x, y) = (x as i32, y as i32);
    (x, y) != (vx, vy) && in_contact(MAP_SIZE, (x, y), (vx, vy))
}

/// Whether a resident stands beside the vessel on land, not aboard it.
pub fn resident_beside_vessel(v: &Vessel, r: &Resident) -> bool {
    r.aboard.as_deref() != Some(v.id.as_str()) && beside_vessel(v, r.x, r.y)
}

/// Why a passenger can't get off onto (x, y) (`CONTEXT.md`: Beside a vessel: a free land tile
/// beside it): it must touch the vessel's tile and be land anyone can stand on, with no wall or
/// gate on it.
pub fn shore_problem(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    x: i32,
    y: i32,
) -> Option<&'static str> {
    let (x, y) = (wrap(x, map.size), wrap(y, map.size));
    if !beside_vessel(v, f64::from(x), f64::from(y)) {
        return Some("that tile is not beside the boat");
    }
    if !is_passable_terrain(terrain_at(map, x, y)) {
        return Some("nobody can stand there");
    }
    if building_at(world, x, y, map.size).is_some_and(is_wall_or_gate) {
        return Some("a wall or gate stands there");
    }
    None
}

/// The free land tiles beside a vessel a passenger can get off onto, the straight ones first.
pub fn shore_tiles(world: &WorldState, map: &TerrainMap, v: &Vessel) -> Vec<(i32, i32)> {
    let (vx, vy) = (v.x as i32, v.y as i32);
    AROUND
        .iter()
        .map(|(dx, dy)| (wrap(vx + dx, map.size), wrap(vy + dy, map.size)))
        .filter(|&(x, y)| shore_problem(world, map, v, x, y).is_none())
        .collect()
}

/// Where a passenger gets off a vessel when they don't say where: the free land tile beside it
/// nearest `toward` (a straight one before a diagonal one as near), else the first straight one.
/// `None` with no shore beside it (`CONTEXT.md`: Beside a vessel).
pub fn landing_tile(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    toward: Option<(i32, i32)>,
) -> Option<(i32, i32)> {
    let tiles = shore_tiles(world, map, v);
    let Some(to) = toward else { return tiles.first().copied() };
    let mut best: Option<((i32, i32), f64)> = None;
    for t in tiles {
        let d = wrap_distance(map.size, t, to);
        if best.is_none_or(|(_, b)| d < b - 1e-9) {
            best = Some((t, d));
        }
    }
    best.map(|(t, _)| t)
}

/// Why a resident can't board a vessel now (`CONTEXT.md`: Beside a vessel, Passenger, What
/// vessels carry): a vessel of their realm beside them, with room for one more passenger; not a
/// rider (no horse goes aboard) or a driver.
pub fn board_vessel_problem(world: &WorldState, r: &Resident, v: &Vessel) -> Option<String> {
    let problem = if r.aboard.as_deref() == Some(v.id.as_str()) {
        "already aboard that boat"
    } else if r.aboard.is_some() {
        "already aboard another carriage or boat"
    } else if !vessel_of_resident(v, r) {
        "not a boat of your realm"
    } else if !beside_vessel(v, r.x, r.y) {
        "that boat is not beside the resident"
    } else if super::carriages::driven_carriage_id(r).is_some() {
        "the driver can’t board"
    } else if r.riding.is_some() {
        "no horse goes aboard: dismount first"
    } else if vessel_room(world, v) < PASSENGER_WEIGHT - 1e-9 {
        "the boat is full"
    } else {
        return None;
    };
    Some(problem.to_string())
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
