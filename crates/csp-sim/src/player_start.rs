//! Where a new Leader's starting city goes (`CONTEXT.md`: Starting site, ADR 0035): a free
//! starting site in the open heartland with the most Players' cities, so Players start as
//! neighbours.
//!
//! - **Picking:** among the open heartlands with a free site, the one holding the most cities of
//!   Players' realms; on a tie, the one opened first. In it, the free site nearest another Player's
//!   city (with none anywhere, the one nearest the heartland's middle).
//! - **Opening:** the world's first Player opens a heartland picked by the seed; when no open
//!   heartland has a free site, the heartland nearest an open one opens.
//! - **Freed sites:** a site is free while a starting city fits on it: no building (a road
//!   included) of anyone's on its square or the farm ring round it. So it is free again once
//!   nothing of the city that stood there is left, and never while someone else built on it.
//! - **The world full:** with no free site anywhere, the place nearest an open heartland's middle
//!   that a starting city fits on, whatever stands near it.

use csp_shared::balance::START_CITY_SIZE;
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::world::{BuildingKind, StartingSite, WorldState};

use crate::invariants::InvariantViolation;
use crate::placing::Ground;
use crate::queries::city::town_hall_of;
use crate::random::hash;
use crate::regions::{RegionKind, Regions};
use crate::starting_city::{site_fits, FARM_RING};
use crate::starting_sites::site_middle;

const START_SIZE: i32 = START_CITY_SIZE as i32;

/// Where a new starting city goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartPlace {
    /// The starting site `site` (an index into `world.starting_sites`), in heartland `heartland`.
    Site { site: usize, heartland: u32 },
    /// Every site of every heartland taken: the north-west tile of the walled square of the free
    /// place nearest an open heartland's middle.
    WorldFull { x: i32, y: i32 },
}

/// The ground as starting sites see it: every building's footprint taken, roads too, since a
/// starting city goes on none of them.
fn site_ground<'t>(world: &WorldState, terrain: &'t TerrainMap) -> Ground<'t> {
    let roads: Vec<(i32, i32)> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Road)
        .map(|b| (b.x as i32, b.y as i32))
        .collect();
    Ground::new(world, terrain, roads)
}

/// Whether a starting city could be given this site now: one fits on it, with nothing of
/// anyone's on its square or its farm ring.
fn is_free(terrain: &TerrainMap, ground: &Ground, site: &StartingSite) -> bool {
    site_fits(terrain, ground, site.x, site.y)
}

/// Which of the world's starting sites are free, by index.
pub fn free_sites(world: &WorldState, terrain: &TerrainMap) -> Vec<bool> {
    let ground = site_ground(world, terrain);
    world.starting_sites.iter().map(|s| is_free(terrain, &ground, s)).collect()
}

/// The heartlands that have starting sites, by region id, lowest first.
fn heartlands_with_sites(world: &WorldState) -> Vec<u32> {
    let mut ids: Vec<u32> = world.starting_sites.iter().map(|s| s.region).collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// The heartland to open next, of those with a free site not open yet: the world's first one by
/// its seed, then the one whose middle is nearest an open one's (on a tie, the lowest id).
fn next_to_open(world: &WorldState, regions: &Regions, free: &[bool]) -> Option<u32> {
    let closed: Vec<u32> = heartlands_with_sites(world)
        .into_iter()
        .filter(|h| !world.opened_heartlands.contains(h))
        .filter(|&h| world.starting_sites.iter().zip(free).any(|(s, &f)| f && s.region == h))
        .collect();
    if closed.is_empty() {
        return None;
    }
    if world.opened_heartlands.is_empty() {
        let pick = hash(world.seed as f64, 7_717.0, 1_257.0) * closed.len() as f64;
        return Some(closed[(pick as usize).min(closed.len() - 1)]);
    }
    let middle = |id: u32| regions.region(id).map(|r| (r.x, r.y));
    let to_open = |id: u32| {
        let Some(at) = middle(id) else { return f64::INFINITY };
        world
            .opened_heartlands
            .iter()
            .filter_map(|&o| middle(o))
            .map(|o| wrap_distance(regions.size, o, at))
            .fold(f64::INFINITY, f64::min)
    };
    let mut best: Option<(f64, u32)> = None;
    for id in closed {
        let d = to_open(id);
        if best.is_none_or(|(b, _)| d < b) {
            best = Some((d, id));
        }
    }
    best.map(|(_, id)| id)
}

/// The town halls of every city of a Player's realm.
fn player_halls(world: &WorldState) -> Vec<(f64, f64)> {
    world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_some())
        .filter_map(|c| town_hall_of(world, c).map(|h| (h.x, h.y)))
        .collect()
}

/// Picks where a new Leader's starting city goes, opening heartlands as the rule says (so it
/// changes `world.opened_heartlands`). None for a world without starting sites (one made before
/// them, as many tests' worlds are): the starting city then goes where `find_city_site` finds room.
pub fn pick_start(
    world: &mut WorldState,
    terrain: &TerrainMap,
    regions: &Regions,
) -> Option<StartPlace> {
    if world.starting_sites.is_empty() {
        return None;
    }
    let free = free_sites(world, terrain);
    let has_free = |world: &WorldState, h: u32| {
        world.starting_sites.iter().zip(&free).any(|(s, &f)| f && s.region == h)
    };
    while !world.opened_heartlands.iter().any(|&h| has_free(world, h)) {
        let Some(next) = next_to_open(world, regions, &free) else { break };
        world.opened_heartlands.push(next);
    }
    let halls = player_halls(world);
    let cities_in = |h: u32| {
        halls.iter().filter(|&&(x, y)| regions.id_at(x as i32, y as i32) == Some(h)).count()
    };
    // Open heartlands in the order they opened: a later one wins only with more cities.
    let mut best: Option<(usize, u32)> = None;
    for &h in &world.opened_heartlands {
        if !has_free(world, h) {
            continue;
        }
        let n = cities_in(h);
        if best.is_none_or(|(b, _)| n > b) {
            best = Some((n, h));
        }
    }
    let Some((_, heartland)) = best else {
        return world_full_place(world, terrain, regions)
            .map(|(x, y)| StartPlace::WorldFull { x, y });
    };
    let size = terrain.size;
    let to_nearest_player = |s: &StartingSite| {
        let (mx, my) = site_middle(s);
        let at = (f64::from(mx), f64::from(my));
        halls.iter().map(|&h| wrap_distance_f(size, h, at)).fold(f64::INFINITY, f64::min)
    };
    let mut pick: Option<(f64, usize)> = None;
    for (i, s) in world.starting_sites.iter().enumerate() {
        if !free[i] || s.region != heartland {
            continue;
        }
        let d = to_nearest_player(s);
        if pick.is_none_or(|(b, _)| d < b) {
            pick = Some((d, i));
        }
    }
    pick.map(|(_, site)| StartPlace::Site { site, heartland })
}

fn wrap_distance_f(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    let s = f64::from(size);
    let d = |a: f64, b: f64| {
        let d = (b - a).rem_euclid(s);
        if d > s / 2.0 {
            s - d
        } else {
            d
        }
    };
    d(a.0, b.0).hypot(d(a.1, b.1))
}

/// With every site taken: the north-west tile of the walled square nearest an open heartland's
/// middle (every heartland with sites, if none is open) that a starting city fits on. None if no
/// place on the map fits one.
fn world_full_place(
    world: &WorldState,
    terrain: &TerrainMap,
    regions: &Regions,
) -> Option<(i32, i32)> {
    let ground = site_ground(world, terrain);
    let open: Vec<u32> = if world.opened_heartlands.is_empty() {
        heartlands_with_sites(world)
    } else {
        world.opened_heartlands.clone()
    };
    let mut best: Option<(i32, (i32, i32))> = None;
    for h in open {
        let Some(r) = regions.region(h).filter(|r| r.kind == RegionKind::Heartland) else {
            continue;
        };
        if let Some(found) = nearest_fit(terrain, &ground, (r.x, r.y)) {
            if best.is_none_or(|(b, _)| found.0 < b) {
                best = Some(found);
            }
        }
    }
    best.map(|(_, at)| at)
}

/// The place nearest `middle` (by squared distance between the squares' middles) where a starting
/// city fits, within the map's edges as `find_city_site` keeps them, searched ring by ring.
fn nearest_fit(
    terrain: &TerrainMap,
    ground: &Ground,
    middle: (i32, i32),
) -> Option<(i32, (i32, i32))> {
    let size = terrain.size;
    let (lo, hi) = (FARM_RING, size - START_SIZE - FARM_RING);
    let fits = |x: i32, y: i32| {
        (lo..hi).contains(&x) && (lo..hi).contains(&y) && site_fits(terrain, ground, x, y)
    };
    let (cx, cy) = (middle.0 - START_SIZE / 2, middle.1 - START_SIZE / 2);
    let mut best: Option<(i32, (i32, i32))> = None;
    // Once a fit is found on ring r, a nearer one can still lie on a ring up to r·√2 out.
    let mut last = size;
    let mut r = 0;
    while r <= last && r < size {
        for (dx, dy) in ring(r) {
            let (x, y) = (cx + dx, cy + dy);
            let d = dx * dx + dy * dy;
            if best.is_some_and(|(b, _)| d >= b) || !fits(x, y) {
                continue;
            }
            best = Some((d, (x, y)));
            last = last.min((f64::from(r) * std::f64::consts::SQRT_2).ceil() as i32);
        }
        r += 1;
    }
    best
}

/// The offsets on the square ring `r` out from (0, 0).
fn ring(r: i32) -> Vec<(i32, i32)> {
    if r == 0 {
        return vec![(0, 0)];
    }
    let mut out = Vec::with_capacity(8 * r as usize);
    for i in -r..r {
        out.push((i, -r));
        out.push((r, i));
        out.push((-i, r));
        out.push((-r, -i));
    }
    out
}

/// A rule of the opened heartlands and the starting sites' cities, broken (ADR 0004).
pub fn starting_sites_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut broken = Vec::new();
    let with_sites = heartlands_with_sites(world);
    for (i, h) in world.opened_heartlands.iter().enumerate() {
        if world.opened_heartlands[..i].contains(h) {
            broken.push(format!("heartland {h} opened twice"));
        }
        if !with_sites.contains(h) {
            broken.push(format!("heartland {h} opened but has no starting sites"));
        }
    }
    for (i, s) in world.starting_sites.iter().enumerate() {
        let Some(city) = &s.city_id else { continue };
        if world.starting_sites[..i].iter().any(|o| o.city_id.as_ref() == Some(city)) {
            broken.push(format!("{city} was given two starting sites"));
        }
        if !world.opened_heartlands.contains(&s.region) {
            broken.push(format!("{city} was given a site in heartland {}, never opened", s.region));
        }
    }
    broken
        .into_iter()
        .map(|message| InvariantViolation {
            invariant: "starting-sites-sound".into(),
            message,
            entity_ids: Vec::new(),
        })
        .collect()
}

#[cfg(test)]
#[path = "player_start_tests.rs"]
mod tests;
