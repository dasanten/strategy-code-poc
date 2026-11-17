//! NPC cities building towers (T109.3, `CONTEXT.md`: Tower, NPC city): a city whose outer wall is
//! all of stone builds a stone tower by each of its gates, then one in each corner of that wall,
//! as it can spare the Stone. Each tower stands just inside the wall, touching it, so its top is
//! part of the wall walk; one by a gate leaves the way in through the gate free. A city that moves
//! its wall out builds them again on the new one, and tears the old ones down with the old wall.

use csp_shared::footprint::{covers, footprint_tiles, near_footprint};
use csp_shared::terrain::{wrap, wrap_delta, TerrainMap};
use csp_shared::world::{Building, BuildingKind, City, CityProject, WallMaterial, WorldState};

use crate::npc_inner_wall::{holds_above_reserve, outer_walls};
use crate::npc_stone_walls::{is_npc_town, outer_ring_of_stone};
use crate::queries::building::{build_materials_of, build_problem};
use crate::queries::names::placed;

/// How far a tower may stand from its gate or corner and still be "by" it.
const BY: i32 = 2;

fn is_wall(b: &Building) -> bool {
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
}

/// The city's towers, finished or begun: a site laid out in its area is its own before it is
/// finished and joins it.
fn towers_of<'w>(world: &'w WorldState, city: &City, size: i32) -> Vec<&'w Building> {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Tower
                && (b.city_id.as_ref() == Some(&city.id)
                    || (b.site.is_some()
                        && b.city_id.is_none()
                        && crate::queries::city::in_city_area(
                            world, &city.id, b.x as i32, b.y as i32, size,
                        )))
        })
        .collect()
}

/// Steps from the home along the larger of the two directions, the short way round: the ring a
/// tile lies on.
fn ring_of(home: (i32, i32), (x, y): (i32, i32), size: i32) -> i32 {
    wrap_delta(home.0, x, size).abs().max(wrap_delta(home.1, y, size).abs())
}

/// Where the city wants its towers, in the order it builds them (`CONTEXT.md`: Tower): by each gate
/// of its outer wall, then in each of that wall's corners, by the north-west tile of each tower's
/// footprint. A gate or corner with a tower of the city by it already is skipped; so is one with no
/// free spot for it just inside the wall.
pub fn tower_spots(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: Option<&TerrainMap>,
    size: i32,
) -> Vec<(i32, i32)> {
    let home_at = (home.x as i32, home.y as i32);
    let walls: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_ref() == Some(&city.id) && is_wall(b) && b.site.is_none())
        .collect();
    let outer = outer_walls(&walls, |b| (b.x as i32, b.y as i32), home_at, size);
    let Some(r) = outer.iter().map(|b| ring_of(home_at, (b.x as i32, b.y as i32), size)).max()
    else {
        return Vec::new();
    };
    let on_ring: Vec<(i32, i32)> = outer
        .iter()
        .map(|b| (b.x as i32, b.y as i32))
        .filter(|t| ring_of(home_at, *t, size) == r)
        .collect();
    let mut gates: Vec<&&Building> =
        outer.iter().filter(|b| b.kind == BuildingKind::Gate).collect();
    gates.sort_by(|a, b| a.id.cmp(&b.id));
    let mut anchors: Vec<((i32, i32), bool)> =
        gates.iter().map(|g| ((g.x as i32, g.y as i32), true)).collect();
    for (dx, dy) in [(-r, -r), (r, -r), (r, r), (-r, r)] {
        let corner = (wrap(home_at.0 + dx, size), wrap(home_at.1 + dy, size));
        if on_ring.contains(&corner) {
            anchors.push((corner, false));
        }
    }
    let towers = towers_of(world, city, size);
    let mut planned: Vec<(i32, i32)> = Vec::new();
    for (at, gate) in anchors {
        let by = |nw: (i32, i32)| {
            let p = csp_shared::footprint::Placed { kind: "tower", x: nw.0, y: nw.1 };
            near_footprint(p, at, BY, size)
        };
        if towers.iter().any(|t| near_footprint(placed(t), at, BY, size))
            || planned.iter().any(|nw| by(*nw))
        {
            continue;
        }
        if let Some(nw) = spot_by(world, home_at, at, r, gate, terrain, size) {
            planned.push(nw);
        }
    }
    planned
}

/// The free spot just inside the wall by `at`, a gate or a corner of the ring `r` round the home:
/// a 2×2 footprint wholly inside the ring, touching it, nearest `at` first; by a gate, clear of
/// the tile inside it, the way in.
fn spot_by(
    world: &WorldState,
    home: (i32, i32),
    at: (i32, i32),
    r: i32,
    gate: bool,
    terrain: Option<&TerrainMap>,
    size: i32,
) -> Option<(i32, i32)> {
    let inward =
        (-wrap_delta(home.0, at.0, size).signum(), -wrap_delta(home.1, at.1, size).signum());
    // The way in through a gate: the tile inside it.
    let way_in = if gate {
        let along_x = wrap_delta(home.0, at.0, size).abs() == r;
        Some(if along_x {
            (wrap(at.0 + inward.0, size), at.1)
        } else {
            (at.0, wrap(at.1 + inward.1, size))
        })
    } else {
        None
    };
    let mut best: Option<((i32, i32), (i32, i32))> = None;
    for dy in -BY - 1..=BY {
        for dx in -BY - 1..=BY {
            let nw = (wrap(at.0 + dx, size), wrap(at.1 + dy, size));
            let p = csp_shared::footprint::Placed { kind: "tower", x: nw.0, y: nw.1 };
            let tiles = footprint_tiles(p, size);
            let rings: Vec<i32> = tiles.iter().map(|t| ring_of(home, *t, size)).collect();
            // Wholly inside the ring, and touching it.
            if rings.iter().any(|&n| n >= r) || !rings.contains(&(r - 1)) {
                continue;
            }
            if way_in.is_some_and(|w| covers(p, w.0, w.1, size)) {
                continue;
            }
            if build_problem(world, nw.0, nw.1, BuildingKind::Tower, terrain.map(|t| t as _))
                .is_some()
            {
                continue;
            }
            let far = tiles
                .iter()
                .map(|t| wrap_delta(at.0, t.0, size).abs() + wrap_delta(at.1, t.1, size).abs())
                .min()
                .unwrap_or(i32::MAX);
            let key = (far, nw.1 * size + nw.0);
            if best.is_none_or(|(k, _)| key < k) {
                best = Some((key, nw));
            }
        }
    }
    best.map(|(_, nw)| nw)
}

fn stone_tower(x: f64, y: f64) -> CityProject {
    CityProject::Build { building: BuildingKind::Tower, x, y, material: Some(WallMaterial::Stone) }
}

/// The next tower the city builds (`CONTEXT.md`: Tower), if it is time for one: the tower it has
/// begun first; else, once it is a town whose outer wall is all of stone and isn't moving out, the
/// first of `tower_spots` once it holds a stone tower's Stone beyond its reserve. None while its full
/// wait is under way, so founding a daughter comes first (`CONTEXT.md`: Full city).
pub fn tower_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: Option<&TerrainMap>,
    size: i32,
    expanding: bool,
) -> Option<CityProject> {
    if !is_npc_town(world, city) {
        return None;
    }
    if let Some(site) = towers_of(world, city, size).into_iter().find(|t| t.site.is_some()) {
        return Some(stone_tower(site.x, site.y));
    }
    let waiting_to_found = world.city_plans.get(&city.id).is_some_and(|p| p.full_since.is_some());
    if expanding || waiting_to_found || !outer_ring_of_stone(world, city, home, size) {
        return None;
    }
    let materials = build_materials_of(BuildingKind::Tower, Some(WallMaterial::Stone));
    if !holds_above_reserve(world, city, &materials) {
        return None;
    }
    let next = *tower_spots(world, city, home, terrain, size).first()?;
    Some(stone_tower(f64::from(next.0), f64::from(next.1)))
}

/// Whether a town with its outer wall all of stone still wants a tower, so wants Stone for it: a
/// quarry when it has none, as for its stone wall (`CONTEXT.md`: Wood or stone). Counted cheaply,
/// one by each gate and one in each corner.
pub fn wants_stone_for_towers(world: &WorldState, city: &City, home: &Building, size: i32) -> bool {
    if !is_npc_town(world, city) || !outer_ring_of_stone(world, city, home, size) {
        return false;
    }
    let gates = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Gate && b.site.is_none() && b.city_id.as_ref() == Some(&city.id)
        })
        .count();
    towers_of(world, city, size).len() < gates + 4
}

/// A tower of the city's old wall, to tear down with it once the new one stands
/// (`CONTEXT.md`: Tower: the old ones go with the old wall): one lying just inside the old ring
/// `inner`, nowhere near the new one `outer`.
pub fn old_tower(
    world: &WorldState,
    city: &City,
    home: &Building,
    inner: i32,
    outer: i32,
    size: i32,
) -> Option<String> {
    if inner >= outer {
        return None;
    }
    let home_at = (home.x as i32, home.y as i32);
    let mut old: Vec<&Building> = towers_of(world, city, size)
        .into_iter()
        .filter(|t| {
            let rings: Vec<i32> = footprint_tiles(placed(t), size)
                .into_iter()
                .map(|tile| ring_of(home_at, tile, size))
                .collect();
            let far = rings.iter().copied().max().unwrap_or(0);
            far <= inner && far >= inner - 1
        })
        .collect();
    old.sort_by(|a, b| a.id.cmp(&b.id));
    old.first().map(|t| t.id.clone())
}

#[cfg(test)]
mod tests;
