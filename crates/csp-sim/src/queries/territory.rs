//! Territory queries of `packages/shared/src/territory.ts` (`CONTEXT.md`: Territory): what
//! projects control, how far, and who holds each tile.

use csp_shared::balance::{
    TERRITORY_CITY_BASE, TERRITORY_MAX_REACH, TERRITORY_PER_ARMED, TERRITORY_PER_RESIDENT,
    TERRITORY_REACH_PER_ROOT, TERRITORY_WORKPLACE_BASE, WORKPLACE_MAX_WORKERS,
};
use csp_shared::footprint::{footprint_tiles, near_footprint};
use csp_shared::terrain::{wrap, wrap_delta};
use csp_shared::world::{City, WorldState};
use indexmap::IndexMap;

use super::names::{kind_name, placed};
use super::npc_trade::locale_compare;
use super::residents::is_armed;
use crate::queries::building::workers_of;
use crate::queries::city_area::{in_city_area, is_city_building};

/// The Trade Organization's id as an Organization projecting control (`TRADE_ORGANIZATION`).
/// Not the same string as [`super::standing::TRADE_ORG`], as in the TypeScript.
pub const TRADE_ORGANIZATION: &str = "tradeOrg";

/// The Organization a city projects control for (`cityOrganization`): the Trade Organization
/// for its cities, else its realm, or itself when it has none.
pub fn city_organization(city: &City) -> &str {
    if city.trade_org.is_some() {
        TRADE_ORGANIZATION
    } else {
        city.realm_id.as_deref().unwrap_or(&city.id)
    }
}

/// Something that projects control (`ControlSource`): a city, or a guarded workplace for one of
/// its holders. Control reaches out from each of `tiles`.
#[derive(Debug, Clone, PartialEq)]
pub struct ControlSource {
    pub id: String,
    pub owner: String,
    pub strength: f64,
    pub reach: f64,
    pub tiles: Vec<(i32, i32)>,
}

/// The area Organizations control, as worked out at `tick` (`Territory`). Derived, never stored:
/// `owners` maps tile indices (y * size + x) to the Organization holding the tile, in the order
/// the TypeScript `Map` keeps them. A tile nobody holds, or where the strongest tie, is missing.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Territory {
    pub tick: u64,
    pub size: i32,
    pub owners: IndexMap<usize, String>,
}

/// How far control of the given strength reaches, in tiles (`controlReach`).
pub fn control_reach(strength: f64) -> f64 {
    TERRITORY_MAX_REACH.min((TERRITORY_REACH_PER_ROOT * strength.sqrt()).floor())
}

/// The control a source projects onto a tile `d` tiles from it (`controlAt`): its full strength
/// on its own tiles, fading to nothing just past its reach.
pub fn control_at(strength: f64, reach: f64, d: f64) -> f64 {
    if d > reach {
        return 0.0;
    }
    strength * (1.0 - d / (reach + 1.0))
}

fn source(id: &str, owner: &str, strength: f64, tiles: Vec<(i32, i32)>) -> ControlSource {
    ControlSource {
        id: id.to_string(),
        owner: owner.to_string(),
        strength,
        reach: control_reach(strength),
        tiles,
    }
}

/// Everything projecting control (`controlSources`): each city from its finished city buildings,
/// by its residents and its armed residents in its area; each finished workplace for each holder
/// guarding it, by the holder's workers there and those guards. `size` is the map's.
pub fn control_sources(world: &WorldState, size: i32) -> Vec<ControlSource> {
    let mut out = Vec::new();
    for city in &world.cities {
        let tiles: Vec<(i32, i32)> = world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_ref() == Some(&city.id) && is_city_building(b))
            .flat_map(|b| footprint_tiles(placed(b), size))
            .collect();
        if tiles.is_empty() {
            continue;
        }
        let mut strength = TERRITORY_CITY_BASE;
        for r in &world.residents {
            if r.city_id.as_ref() != Some(&city.id) {
                continue;
            }
            strength += TERRITORY_PER_RESIDENT;
            if is_armed(&r.carried) && in_city_area(world, &city.id, r.x, r.y, size) {
                strength += TERRITORY_PER_ARMED;
            }
        }
        out.push(source(&city.id, city_organization(city), strength, tiles));
    }
    for b in &world.buildings {
        if WORKPLACE_MAX_WORKERS.get(kind_name(b.kind)).is_none() || b.site.is_some() {
            continue;
        }
        let mut guards: IndexMap<&str, f64> = IndexMap::new();
        for r in &world.residents {
            let Some(owner) = r.owner.as_deref() else { continue };
            if !is_armed(&r.carried)
                || !near_footprint(placed(b), (r.x as i32, r.y as i32), 1, size)
            {
                continue;
            }
            *guards.entry(owner).or_insert(0.0) += 1.0;
        }
        if guards.is_empty() {
            continue;
        }
        let mut workers: IndexMap<&str, f64> = IndexMap::new();
        for r in workers_of(world, b) {
            if let Some(owner) = r.owner.as_deref() {
                *workers.entry(owner).or_insert(0.0) += 1.0;
            }
        }
        let mut holders: Vec<(&str, f64)> = workers.into_iter().collect();
        holders.sort_by(|a, b| locale_compare(a.0, b.0));
        // Only holders (realms working it) can guard it; a passing soldier of another realm can not.
        for (owner, n) in holders {
            let g = guards.get(owner).copied().unwrap_or(0.0);
            if g == 0.0 {
                continue;
            }
            let strength =
                TERRITORY_WORKPLACE_BASE + n * TERRITORY_PER_RESIDENT + g * TERRITORY_PER_ARMED;
            out.push(source(&b.id, owner, strength, footprint_tiles(placed(b), size)));
        }
    }
    out
}

/// Works out territory (`computeTerritory`): each tile goes to the Organization projecting the
/// most control onto it; a tie between Organizations leaves it to nobody. `size` is the map's.
pub fn compute_territory(world: &WorldState, size: i32) -> Territory {
    let mut best: IndexMap<usize, (Option<String>, f64)> = IndexMap::new();
    for s in control_sources(world, size) {
        // A source with several tiles projects from the nearest of them.
        nearest_within(&s.tiles, s.reach, size, &mut |i, d| {
            let c = control_at(s.strength, s.reach, d);
            if c <= 0.0 {
                return;
            }
            match best.get_mut(&i) {
                None => {
                    best.insert(i, (Some(s.owner.clone()), c));
                }
                Some(here) if c > here.1 => *here = (Some(s.owner.clone()), c),
                Some(here) if c == here.1 && here.0.as_deref() != Some(s.owner.as_str()) => {
                    here.0 = None
                }
                Some(_) => {}
            }
        });
    }
    let owners = best.into_iter().filter_map(|(i, (owner, _))| owner.map(|o| (i, o))).collect();
    Territory { tick: world.tick, size, owners }
}

/// Hands `reached` every tile within `reach` of the nearest of `tiles` (straight line, the short
/// way round), by index, with that distance, each tile once (`nearestWithin`): an exact distance
/// transform over the box round the tiles.
fn nearest_within(
    tiles: &[(i32, i32)],
    reach: f64,
    size: i32,
    reached: &mut dyn FnMut(usize, f64),
) {
    let Some(&first) = tiles.first() else { return };
    let reach_i = reach as i32;
    let at: Vec<(i32, i32)> = tiles
        .iter()
        .map(|t| (wrap_delta(first.0, t.0, size), wrap_delta(first.1, t.1, size)))
        .collect();
    let x0 = at.iter().map(|p| p.0).min().expect("a tile") - reach_i;
    let y0 = at.iter().map(|p| p.1).min().expect("a tile") - reach_i;
    let w = size.min(at.iter().map(|p| p.0).max().expect("a tile") + reach_i - x0 + 1);
    let h = size.min(at.iter().map(|p| p.1).max().expect("a tile") + reach_i - y0 + 1);
    let (wu, hu) = (w as usize, h as usize);
    let far = f64::from(w + h).powi(2);
    let mut grid = vec![far; wu * hu];
    for &(x, y) in &at {
        let (gx, gy) = (x - x0, y - y0);
        if gx >= 0 && gy >= 0 && gx < w && gy < h {
            grid[gy as usize * wu + gx as usize] = 0.0;
        }
    }
    // Squared distances along each column, then along each row (Felzenszwalb and Huttenlocher).
    let mut column = vec![0.0; wu.max(hu)];
    for x in 0..wu {
        for y in 0..hu {
            column[y] = grid[y * wu + x];
        }
        let d = transform_1d(&column, hu);
        for y in 0..hu {
            grid[y * wu + x] = d[y];
        }
    }
    for y in 0..hu {
        let d = transform_1d(&grid[y * wu..(y + 1) * wu], wu);
        for (x, &sq) in d.iter().enumerate() {
            let dist = sq.sqrt();
            if dist <= reach {
                let ty = wrap(first.1 + y0 + y as i32, size);
                let tx = wrap(first.0 + x0 + x as i32, size);
                reached((ty * size + tx) as usize, dist);
            }
        }
    }
}

/// The 1D squared distance transform of the first `n` values of `f` (`transform1d`).
fn transform_1d(f: &[f64], n: usize) -> Vec<f64> {
    let mut d = vec![0.0; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f64; n + 1];
    let mut k = 0usize;
    z[0] = f64::NEG_INFINITY;
    if n > 0 {
        z[1] = f64::INFINITY;
    }
    let sq = |i: usize| (i * i) as f64;
    for q in 1..n {
        let mut s = (f[q] + sq(q) - (f[v[k]] + sq(v[k]))) / (2.0 * q as f64 - 2.0 * v[k] as f64);
        while s <= z[k] {
            k -= 1;
            s = (f[q] + sq(q) - (f[v[k]] + sq(v[k]))) / (2.0 * q as f64 - 2.0 * v[k] as f64);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    k = 0;
    for (q, out) in d.iter_mut().enumerate() {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        *out = (q as f64 - v[k] as f64).powi(2) + f[v[k]];
    }
    d
}

/// The Organization holding a tile, if any (`territoryOwner`).
pub fn territory_owner(territory: &Territory, x: i32, y: i32) -> Option<&str> {
    let size = territory.size;
    territory.owners.get(&((wrap(y, size) * size + wrap(x, size)) as usize)).map(String::as_str)
}
