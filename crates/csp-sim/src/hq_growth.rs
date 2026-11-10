//! How the Trade Org HQ grows (`hq-growth.ts`, `CONTEXT.md`: Trade Org HQ): while it is too weak
//! against the strongest Organization and has too few adults to arm, it grows like an NPC city
//! (`city_growth`: pairing and houses), its houses between its rings; with no room left for a
//! house it puts up another round ring of wall `TRADE_ORG_HQ.ring_step` further out, its gates in
//! line with the others, and keeps the old ones. All through the orders a Player's residents take
//! (ADR 0002).

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{TRADE_ORG_ARMY, TRADE_ORG_HQ};
use csp_shared::footprint::{footprint_tiles, middle_of};
use csp_shared::terrain::{wrap, wrap_delta, TerrainMap};
use csp_shared::world::{Building, BuildingKind, City, CityProject, WorldState};

use crate::placing::Ground;
use crate::queries::building::{build_problem, SHARES_A_TILE};
use crate::queries::city::{has_food_surplus, in_city_area, town_hall_of};
use crate::queries::city_area::{city_area_tiles, free_housing};
use crate::queries::names::placed;
use crate::queries::trade_org::{trade_org_army_wanted, trade_org_hq};
use crate::sight::InvariantViolation;
use crate::trade_org::{angle_apart, angle_of, gate_angles, gates_of, round_ring, within, Tile};

/// The radius of the HQ's `k`th outer ring; the one it starts with is ring 0 (`hqRingRadius`).
pub fn hq_ring_radius(k: usize) -> f64 {
    TRADE_ORG_HQ.outer_radius + k as f64 * TRADE_ORG_HQ.ring_step
}

/// A tile of one of the HQ's outer rings, and what stands there (`RingTile`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RingTile {
    pub kind: BuildingKind,
    pub x: i32,
    pub y: i32,
}

/// The tiles of the HQ's `k`th outer ring round the middle of its town hall, on a map of `size`
/// tiles (`hqRingTiles`): its gates first, evenly round it like the others' (`gates_of`), then
/// outward from them.
pub fn hq_ring_tiles(hall: &Building, k: usize, size: i32) -> Vec<RingTile> {
    let (cx, cy) = middle_of(placed(hall), size);
    let ring = round_ring(cx, cy, hq_ring_radius(k));
    let gates = gates_of(cx, cy, &ring);
    let to_gate = |(x, y): Tile| {
        gates
            .iter()
            .map(|&(gx, gy)| f64::from(x - gx).hypot(f64::from(y - gy)))
            .fold(f64::INFINITY, f64::min)
    };
    let mut keyed: Vec<(f64, Tile)> = ring.into_iter().map(|t| (to_gate(t), t)).collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
    keyed
        .into_iter()
        .map(|(d, (x, y))| RingTile {
            kind: if d == 0.0 { BuildingKind::Gate } else { BuildingKind::Wall },
            x: wrap(x, size),
            y: wrap(y, size),
        })
        .collect()
}

/// The buildings and construction sites by the tiles they cover, as `buildingAt` finds them
/// (`buildingsByTile`): looking each ring tile up among all the buildings is too slow for rings of
/// hundreds of tiles. Values index `world.buildings`.
pub fn buildings_by_tile(world: &WorldState, size: i32) -> HashMap<Tile, usize> {
    let mut out = HashMap::new();
    for (i, b) in world.buildings.iter().enumerate() {
        if SHARES_A_TILE.contains(&b.kind) {
            continue;
        }
        for t in footprint_tiles(placed(b), size) {
            out.entry(t).or_insert(i);
        }
    }
    out
}

/// The wall or gate on a tile, finished or begun, if one stands there (`wallAt`).
fn wall_at<'w>(
    world: &'w WorldState,
    by_tile: &HashMap<Tile, usize>,
    t: &RingTile,
) -> Option<&'w Building> {
    let b = &world.buildings[*by_tile.get(&(t.x, t.y))?];
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate).then_some(b)
}

/// The HQ's outer rings (`HqRings`): the farthest that stands, and the one it is putting up beyond
/// it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HqRings {
    pub outermost: usize,
    pub building: Option<usize>,
}

/// The HQ's outer rings round its town hall (`hqRings`): the farthest ring with a wall or gate on
/// it, begun or finished, is the one it is putting up until every tile of it that can take one has
/// a finished wall or gate. `by_tile` is `buildings_by_tile`, made here when not given.
pub fn hq_rings(
    world: &WorldState,
    hall: &Building,
    terrain: &TerrainMap,
    by_tile: Option<&HashMap<Tile, usize>>,
) -> HqRings {
    let made;
    let by_tile = match by_tile {
        Some(b) => b,
        None => {
            made = buildings_by_tile(world, terrain.size);
            &made
        }
    };
    let mut k = 0;
    while hq_ring_tiles(hall, k + 1, terrain.size)
        .iter()
        .any(|t| wall_at(world, by_tile, t).is_some())
    {
        k += 1;
    }
    if k == 0 {
        return HqRings { outermost: 0, building: None };
    }
    let done =
        hq_ring_tiles(hall, k, terrain.size).iter().all(|t| match wall_at(world, by_tile, t) {
            Some(b) => b.site.is_none(),
            None => build_problem(world, t.x, t.y, t.kind, Some(terrain)).is_some(),
        });
    if done {
        HqRings { outermost: k, building: None }
    } else {
        HqRings { outermost: k - 1, building: Some(k) }
    }
}

/// Whether the HQ grows (`hqGrows`, `CONTEXT.md`: Trade Org HQ): it wants more soldiers
/// (`trade_org_army_wanted`) than it can arm from its `adults` while keeping its workers.
pub fn hq_grows(world: &WorldState, adults: &[usize]) -> bool {
    adults.len() as f64 - TRADE_ORG_ARMY.workers < trade_org_army_wanted(world)
}

/// Where the HQ puts its next house, by the north-west tile of its footprint (`hqHouseTile`):
/// wholly in its area between its inner ring and its outermost ring, off its rings and clear of the
/// straight ways in from its gates (as in `hq_layout`), nearest the town hall first. Another `kind`
/// of building that goes there like a house (a smithy, say) the same way.
pub fn hq_house_tile(
    world: &WorldState,
    hall: &Building,
    terrain: &TerrainMap,
    outermost: usize,
    kind: BuildingKind,
) -> Option<Tile> {
    let size = terrain.size;
    let (cx, cy) = middle_of(placed(hall), size);
    let radius = hq_ring_radius(outermost);
    let mut rings: HashSet<Tile> = HashSet::new();
    for k in 0..=outermost {
        rings.extend(hq_ring_tiles(hall, k, size).iter().map(|t| (t.x, t.y)));
    }
    let area: HashSet<Tile> =
        match world.cities.iter().find(|c| hall.city_id.as_deref() == Some(c.id.as_str())) {
            Some(hq) => city_area_tiles(world, &hq.id, size).into_iter().collect(),
            None => HashSet::new(),
        };
    let ground = Ground::new(world, terrain, []);
    let gates = gate_angles(TRADE_ORG_HQ.gates as usize);
    let fine = |x: i32, y: i32| {
        let dx = wrap_delta(cx, x, size);
        let dy = wrap_delta(cy, y, size);
        if !within(dx, dy, radius) || within(dx, dy, TRADE_ORG_HQ.inner_radius) {
            return false;
        }
        let clear = (1.5 / f64::from(dx).hypot(f64::from(dy))).min(1.0).asin();
        let angle = angle_of(0, 0, (dx, dy));
        if gates.iter().any(|&a| angle_apart(angle, a) <= clear) {
            return false;
        }
        !rings.contains(&(x, y)) && area.contains(&(x, y))
    };
    let mut free: Vec<(i32, i32, f64)> = Vec::new();
    let r = radius.ceil() as i32;
    for dy in -r..=r {
        for dx in -r..=r {
            let x = wrap(cx + dx, size);
            let y = wrap(cy + dy, size);
            if ground.fits(kind, x, y, Some(&fine)) {
                free.push((x, y, f64::from(dx).hypot(f64::from(dy))));
            }
        }
    }
    free.sort_by(|a, b| a.2.total_cmp(&b.2).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
    free.first().map(|&(x, y, _)| (x, y))
}

/// A building project (`BuildProject`).
fn build(building: BuildingKind, x: i32, y: i32) -> CityProject {
    CityProject::Build { building, x: f64::from(x), y: f64::from(y) }
}

/// What the HQ builds next, if anything (`hqProject`, `CONTEXT.md`: Trade Org HQ): a house or a
/// tile of its new ring it has begun; else a house when it has a food surplus and no free housing
/// (`hq_house_tile`), or with no room left for one, the next tile of a new ring; else the next tile
/// of the ring it is putting up.
pub fn hq_project(world: &WorldState, hq: &City, terrain: &TerrainMap) -> Option<CityProject> {
    let hall = town_hall_of(world, hq)?;
    let size = terrain.size;
    let by_tile = buildings_by_tile(world, size);
    let rings = hq_rings(world, hall, terrain, Some(&by_tile));
    let ring = hq_ring_tiles(hall, rings.building.unwrap_or(rings.outermost + 1), size);
    let begun = world
        .buildings
        .iter()
        .find(|b| {
            b.site.is_some()
                && b.kind == BuildingKind::House
                && in_city_area(world, &hq.id, b.x as i32, b.y as i32, size)
        })
        .or_else(|| {
            ring.iter().filter_map(|t| wall_at(world, &by_tile, t)).find(|b| b.site.is_some())
        });
    if let Some(b) = begun {
        return Some(build(b.kind, b.x as i32, b.y as i32));
    }
    let next_of_ring = ring.iter().find(|t| {
        wall_at(world, &by_tile, t).is_none()
            && build_problem(world, t.x, t.y, t.kind, Some(terrain)).is_none()
    });
    if has_food_surplus(world, hq) && free_housing(world, &hq.id) <= 0.0 {
        if let Some((x, y)) =
            hq_house_tile(world, hall, terrain, rings.outermost, BuildingKind::House)
        {
            return Some(build(BuildingKind::House, x, y));
        }
        if let Some(t) = next_of_ring {
            return Some(build(t.kind, t.x, t.y));
        }
    }
    match (rings.building, next_of_ring) {
        (Some(_), Some(t)) => Some(build(t.kind, t.x, t.y)),
        _ => None,
    }
}

/// The HQ's rings hold together (`hqRingsSound`, `CONTEXT.md`: Trade Org HQ; ADR 0004): each of
/// its walls and gates stands on its inner ring or one of its outer rings, and each of its houses
/// between its inner ring and its farthest ring.
pub fn hq_rings_sound(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let Some(hq) = trade_org_hq(world) else { return out };
    let Some(hall) = town_hall_of(world, hq) else { return out };
    let mut fail = |message: String, b: &Building| {
        out.push(InvariantViolation {
            invariant: "hq-rings-sound".into(),
            message,
            entity_ids: vec![b.id.clone()],
        })
    };
    let size = terrain.size;
    let rings = hq_rings(world, hall, terrain, None);
    let top = rings.building.unwrap_or(rings.outermost);
    let (cx, cy) = middle_of(placed(hall), size);
    let mut on_ring: HashSet<Tile> = round_ring(cx, cy, TRADE_ORG_HQ.inner_radius)
        .into_iter()
        .map(|(x, y)| (wrap(x, size), wrap(y, size)))
        .collect();
    for k in 0..=top {
        on_ring.extend(hq_ring_tiles(hall, k, size).iter().map(|t| (t.x, t.y)));
    }
    for b in &world.buildings {
        if b.city_id.as_deref() != Some(hq.id.as_str()) {
            continue;
        }
        let wall = matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate);
        if wall && !on_ring.contains(&(b.x as i32, b.y as i32)) {
            let kind = if b.kind == BuildingKind::Wall { "wall" } else { "gate" };
            fail(format!("{kind} {} of the Trade Org HQ stands on none of its rings", b.id), b);
        }
        if b.kind != BuildingKind::House {
            continue;
        }
        let outside = footprint_tiles(placed(b), size).into_iter().any(|(x, y)| {
            let d = f64::from(wrap_delta(cx, x, size)).hypot(f64::from(wrap_delta(cy, y, size)));
            d <= TRADE_ORG_HQ.inner_radius + 0.5 || d > hq_ring_radius(top) + 0.5
        });
        if outside {
            fail(format!("house {} of the Trade Org HQ stands outside its rings", b.id), b);
        }
    }
    out
}

#[cfg(test)]
mod tests;
