//! Starting sites (`CONTEXT.md`: Starting site, ADR 0035): the places in each heartland where a
//! new Player's starting city can stand, placed when the world is generated and kept in it, free
//! or taken.
//!
//! Each heartland gets `STARTING_SITES_PER_HEARTLAND` of them, grown outwards from its middle: the
//! first as near the middle as one fits, each next one as near the middle as one fits that lies
//! `STARTING_SITE_WALK` from the nearest site already there, so a Player's neighbours are a 20 to
//! 40 minute walk away. A site is a place where a starting city with its farm and stable fits
//! (`site_fits`), on Plains, all of it in the heartland and well away from the heartland's passes
//! and land bridges. Each has a forest, a stone and an iron node within `STARTING_SITE_NODE_REACH`;
//! where the land holds none that near, one is placed on fitting terrain.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};

use csp_shared::balance::{
    MAP_SIZE, NODE_MIN_SPACING, STARTING_SITES_PER_HEARTLAND, STARTING_SITE_NODE_REACH,
    STARTING_SITE_WALK, STARTING_SITE_WAY_DISTANCE, START_CITY_SIZE, TERRAIN_SPEED,
    WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, wrap, wrap_delta, wrap_distance, Terrain, TerrainMap,
    DIAGONAL_STEP,
};
use csp_shared::world::{ResourceKind, ResourceNode, StartingSite, WorldState};
use csp_shared::TICK_MS;

use crate::invariants::checks::node_terrains;
use crate::node_gen::place_resource_nodes_by_region;
use crate::placing::Ground;
use crate::random::hash;
use crate::regions::{Region, RegionKind, Regions};
use crate::starting_city::{site_fits, FARM_RING};

/// The kinds of node every starting site has in reach.
pub const NODES_IN_REACH: [ResourceKind; 3] =
    [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre];

const START_SIZE: i32 = START_CITY_SIZE as i32;

/// The side of the square a starting city takes with its farm and stable round it.
const SITE_SIDE: i32 = START_SIZE + 2 * FARM_RING;

/// The starting-site numbers for a map of `size` tiles: on a full-size map the balance file's; on
/// a smaller one its tiles and minutes scaled with the side, never so small that two sites'
/// squares meet.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SiteRules {
    /// Straight tiles from a site's middle to the nearest other site's, at least and at most.
    pub min_tiles: f64,
    pub max_tiles: f64,
    /// Seconds an unloaded walk from a site to the nearest other one takes, at least and at most.
    pub min_seconds: f64,
    pub max_seconds: f64,
    /// Straight tiles from a site's middle to every pass and land bridge of its heartland.
    pub way_distance: f64,
    /// Straight tiles from a site's middle to its forest, stone and iron node, at most (not
    /// scaled: the land's Hills and Forest are as far apart on a map of any size).
    pub node_reach: f64,
}

impl SiteRules {
    pub fn for_size(size: i32) -> SiteRules {
        let w = STARTING_SITE_WALK;
        let f = (f64::from(size) / f64::from(MAP_SIZE)).min(1.0);
        let min_tiles = (w.min_tiles * f).max(f64::from(SITE_SIDE) + 2.0);
        let max_tiles = (w.max_tiles * f).max(min_tiles * w.max_tiles / w.min_tiles);
        SiteRules {
            min_tiles,
            max_tiles,
            min_seconds: w.min_minutes * 60.0 * min_tiles / w.min_tiles,
            max_seconds: w.max_minutes * 60.0 * max_tiles / w.max_tiles,
            way_distance: STARTING_SITE_WAY_DISTANCE * f,
            node_reach: STARTING_SITE_NODE_REACH,
        }
    }
}

/// Where a site's middle is: the middle of its city's walled square.
pub fn site_middle(site: &StartingSite) -> (i32, i32) {
    middle_of(site.x, site.y)
}

fn middle_of(x: i32, y: i32) -> (i32, i32) {
    (x + START_SIZE / 2, y + START_SIZE / 2)
}

/// The free starting sites of a heartland (`region`), in the order they were placed: nearest its
/// middle first.
pub fn free_starting_sites(world: &WorldState, region: u32) -> impl Iterator<Item = &StartingSite> {
    world.starting_sites.iter().filter(move |s| s.region == region && s.city_id.is_none())
}

/// Places the world's resource nodes by region and then each heartland's starting sites
/// (`CONTEXT.md`: Starting site), with the nodes they lack in reach. Run once, when the world is
/// generated, before any city stands.
pub fn place_starting_sites(world: &mut WorldState, terrain: &TerrainMap) {
    let regions = Regions::of(world.seed, terrain);
    world.nodes = place_resource_nodes_by_region(terrain, world.seed, &regions);
    world.starting_sites.clear();
    let rules = SiteRules::for_size(terrain.size);
    let heartlands: Vec<Region> = regions.of_kind(RegionKind::Heartland).cloned().collect();
    // Where each kind of node it needs could lie, for every heartland alike.
    let fitting = NODES_IN_REACH.map(|kind| Coarse::of(terrain, node_terrains(kind)));
    for h in &heartlands {
        place_in_heartland(world, terrain, &regions, h, &rules, &fitting);
    }
}

/// A place a site may go, before the nodes and the walk are looked at.
struct Candidate {
    x: i32,
    y: i32,
    middle: (i32, i32),
}

fn place_in_heartland(
    world: &mut WorldState,
    terrain: &TerrainMap,
    regions: &Regions,
    h: &Region,
    rules: &SiteRules,
    fitting: &[Coarse; 3],
) {
    let size = terrain.size;
    let ways: Vec<(i32, i32)> =
        regions.ways.iter().filter(|w| w.between.contains(&h.id)).map(|w| (w.x, w.y)).collect();
    let whole_in = |x: i32, y: i32| {
        (y - FARM_RING..y + START_SIZE + FARM_RING).all(|ty| {
            (x - FARM_RING..x + START_SIZE + FARM_RING)
                .all(|tx| regions.id_at(tx, ty) == Some(h.id))
        })
    };
    let step = ((rules.min_tiles / 20.0) as i32).max(2);
    let mut candidates = Vec::new();
    for gy in (0..size).step_by(step as usize) {
        for gx in (0..size).step_by(step as usize) {
            if regions.id_at(gx, gy) != Some(h.id)
                || terrain_at(terrain, gx, gy) != Terrain::Plains as u8
            {
                continue;
            }
            let (x, y) = (gx - START_SIZE / 2, gy - START_SIZE / 2);
            if ways.iter().any(|&w| wrap_distance(size, w, (gx, gy)) < rules.way_distance) {
                continue;
            }
            if !fitting.iter().all(|f| f.any_near((gx, gy), rules.node_reach)) {
                continue;
            }
            if !whole_in(x, y) {
                continue;
            }
            candidates.push(Candidate { x, y, middle: (gx, gy) });
        }
    }
    let to_middle = |c: &Candidate| wrap_distance(size, c.middle, (h.x, h.y));
    candidates.sort_by(|a, b| to_middle(a).partial_cmp(&to_middle(b)).unwrap_or(Ordering::Equal));

    // A candidate with no room, too near a site or with no tile for a node it lacks only gets
    // worse as sites and nodes are added: it is not looked at again. One no walk reaches a site
    // from is walked again only to the sites placed since (`walked`).
    let mut dead = vec![false; candidates.len()];
    let mut walked = vec![0usize; candidates.len()];
    let mut checked = vec![false; candidates.len()];
    let mut here: Vec<(i32, i32)> = Vec::new();
    // Sites that began a group of their own and no walk from another site reaches yet.
    let mut lone: Vec<usize> = Vec::new();
    let wanted = STARTING_SITES_PER_HEARTLAND as usize;
    while here.len() - lone.len() < wanted {
        let ground = Ground::new(world, terrain, []);
        let fits = |c: &Candidate| {
            if !site_fits(terrain, &ground, c.x, c.y) {
                return Err(true);
            }
            nodes_for(world, terrain, c, rules).ok_or(true)
        };
        // Grow from the sites there are; when none can, begin a new group of sites elsewhere.
        // Room and nodes are looked at once before the first walk, and again (as sites and nodes
        // may have come since) only for the candidate a walk reaches, which is then taken or dead.
        let grown = pick(size, rules, &candidates, &mut dead, &here, true, |i, c| {
            if here.is_empty() {
                return fits(c);
            }
            if !checked[i] {
                fits(c)?;
                checked[i] = true;
            }
            let since = &here[walked[i]..];
            walked[i] = here.len();
            if walk_seconds(terrain, c.middle, since, rules.max_seconds).is_none() {
                return Err(false);
            }
            fits(c)
        });
        let (c, nodes, alone) = match grown {
            Some((c, nodes)) => (c, nodes, here.is_empty()),
            None => {
                let begun = pick(size, rules, &candidates, &mut dead, &here, false, |_, c| fits(c));
                let Some((c, nodes)) = begun else { break };
                (c, nodes, true)
            }
        };
        for (kind, (x, y)) in nodes {
            let id = format!("n{}", world.nodes.len() + 1);
            world.nodes.push(ResourceNode { id, kind, x: f64::from(x), y: f64::from(y) });
        }
        if alone {
            lone.push(here.len());
        } else {
            lone.retain(|&l| {
                walk_seconds(terrain, c.middle, &[here[l]], rules.max_seconds).is_none()
            });
        }
        here.push(c.middle);
        world.starting_sites.push(StartingSite { x: c.x, y: c.y, region: h.id, city_id: None });
    }
    // A site no other one is a walk away from is no starting site (its nodes stay).
    let first = world.starting_sites.len() - here.len();
    for &l in lone.iter().rev() {
        world.starting_sites.remove(first + l);
        here.remove(l);
    }
    // A group joining another can bring one site too many: the latest one the others can spare.
    while here.len() > wanted {
        let Some(j) = (0..here.len()).rev().find(|&j| {
            let mut rest = here.clone();
            rest.remove(j);
            all_paired(terrain, &rest, rules)
        }) else {
            break;
        };
        here.remove(j);
        world.starting_sites.remove(first + j);
    }
}

/// Whether a walk from each of `sites` reaches another within the rules' `max_seconds`.
fn all_paired(terrain: &TerrainMap, sites: &[(i32, i32)], rules: &SiteRules) -> bool {
    (0..sites.len()).all(|i| {
        let others: Vec<(i32, i32)> =
            sites.iter().enumerate().filter(|&(j, _)| j != i).map(|(_, &s)| s).collect();
        walk_seconds(terrain, sites[i], &others, rules.max_seconds).is_some()
    })
}

/// The first live candidate, nearest the heartland's middle first, whose nearest site lies at
/// least `min_tiles` away (and, when `grow`, at most `max_tiles`) and that `try_it` takes; a
/// candidate it turns down with `Err(true)`, or one too near a site, is dead from then on.
fn pick<'c, T>(
    size: i32,
    rules: &SiteRules,
    candidates: &'c [Candidate],
    dead: &mut [bool],
    here: &[(i32, i32)],
    grow: bool,
    mut try_it: impl FnMut(usize, &Candidate) -> Result<T, bool>,
) -> Option<(&'c Candidate, T)> {
    for (i, c) in candidates.iter().enumerate() {
        if dead[i] {
            continue;
        }
        let nearest =
            here.iter().map(|&s| wrap_distance(size, s, c.middle)).fold(f64::INFINITY, f64::min);
        if nearest < rules.min_tiles {
            dead[i] = true;
            continue;
        }
        if grow && !here.is_empty() && nearest > rules.max_tiles {
            continue;
        }
        match try_it(i, c) {
            Ok(t) => return Some((c, t)),
            Err(true) => dead[i] = true,
            Err(false) => {}
        }
    }
    None
}

/// Which cells of `CELL` × `CELL` tiles hold some tile of a set of terrains, summed so a square of
/// cells is asked at once: a quick no for a site with no fitting terrain for a node anywhere near.
struct Coarse {
    cells: i32,
    /// `sum[(cy) * (cells + 1) + cx]`: the cells with such a tile above and left of (cx, cy).
    sum: Vec<u32>,
}

const CELL: i32 = 8;

impl Coarse {
    fn of(terrain: &TerrainMap, terrains: &[Terrain]) -> Coarse {
        let cells = (terrain.size + CELL - 1) / CELL;
        let n = cells as usize;
        let mut has = vec![false; n * n];
        for (t, &tile) in terrain.tiles.iter().enumerate() {
            if terrains.iter().any(|k| *k as u8 == tile) {
                let (x, y) = (t as i32 % terrain.size, t as i32 / terrain.size);
                has[(y / CELL) as usize * n + (x / CELL) as usize] = true;
            }
        }
        let w = n + 1;
        let mut sum = vec![0u32; w * w];
        for cy in 0..n {
            for cx in 0..n {
                sum[(cy + 1) * w + cx + 1] =
                    u32::from(has[cy * n + cx]) + sum[cy * w + cx + 1] + sum[(cy + 1) * w + cx]
                        - sum[cy * w + cx];
            }
        }
        Coarse { cells, sum }
    }

    /// Whether a cell within `reach` tiles of (x, y) along each direction holds such a tile (the
    /// map's joins aside: heartlands lie well inside it).
    fn any_near(&self, (x, y): (i32, i32), reach: f64) -> bool {
        let r = reach.ceil() as i32;
        let lo = |v: i32| ((v - r) / CELL).clamp(0, self.cells) as usize;
        let hi = |v: i32| ((v + r) / CELL + 1).clamp(0, self.cells) as usize;
        let (x0, x1, y0, y1) = (lo(x), hi(x), lo(y), hi(y));
        let w = self.cells as usize + 1;
        self.sum[y1 * w + x1] + self.sum[y0 * w + x0]
            > self.sum[y0 * w + x1] + self.sum[y1 * w + x0]
    }
}

/// Whether (x, y) lies on the square of a starting site at (sx, sy), its farm ring included.
#[cfg(test)]
fn on_site(size: i32, (sx, sy): (i32, i32), (x, y): (i32, i32)) -> bool {
    let dx = wrap_delta(sx - FARM_RING, x, size);
    let dy = wrap_delta(sy - FARM_RING, y, size);
    (0..SITE_SIDE).contains(&dx) && (0..SITE_SIDE).contains(&dy)
}

/// The nodes a site at `c` would need placed to have each of [`NODES_IN_REACH`] in reach: none for
/// a kind already there, else a tile of fitting terrain in reach, off every site and at least
/// `NODE_MIN_SPACING` from every node. None when some kind has no such tile.
fn nodes_for(
    world: &WorldState,
    terrain: &TerrainMap,
    c: &Candidate,
    rules: &SiteRules,
) -> Option<Vec<(ResourceKind, (i32, i32))>> {
    let size = terrain.size;
    let reach = rules.node_reach;
    let near: Vec<(ResourceKind, (i32, i32))> = world
        .nodes
        .iter()
        .map(|n| (n.kind, (n.x as i32, n.y as i32)))
        .filter(|&(_, at)| wrap_distance(size, at, c.middle) <= reach + NODE_MIN_SPACING)
        .collect();
    let lacking: Vec<ResourceKind> = NODES_IN_REACH
        .into_iter()
        .filter(|&kind| {
            !near.iter().any(|&(k, at)| k == kind && wrap_distance(size, at, c.middle) <= reach)
        })
        .collect();
    if lacking.is_empty() {
        return Some(Vec::new());
    }
    // The tiles round the site's middle no new node may take: on a site, or within
    // `NODE_MIN_SPACING` of a node, along each direction.
    let r = reach as i32;
    let side = 2 * r + 1;
    let mut blocked = vec![false; (side * side) as usize];
    let block = |blocked: &mut [bool], (x, y): (i32, i32), (w, h): (i32, i32)| {
        let (lx, ly) = (wrap_delta(c.middle.0, x, size) + r, wrap_delta(c.middle.1, y, size) + r);
        for by in (ly).max(0)..(ly + h).min(side) {
            for bx in (lx).max(0)..(lx + w).min(side) {
                blocked[(by * side + bx) as usize] = true;
            }
        }
    };
    let spacing = NODE_MIN_SPACING as i32;
    let around = (2 * spacing - 1, 2 * spacing - 1);
    for s in world.starting_sites.iter().map(|s| (s.x, s.y)).chain([(c.x, c.y)]) {
        block(&mut blocked, (s.0 - FARM_RING, s.1 - FARM_RING), (SITE_SIDE, SITE_SIDE));
    }
    for &(_, (nx, ny)) in &near {
        block(&mut blocked, (nx - spacing + 1, ny - spacing + 1), around);
    }
    let mut placed: Vec<(ResourceKind, (i32, i32))> = Vec::new();
    for kind in lacking {
        let fits = node_terrains(kind);
        let seed = world.seed as f64 + 104_729.0 * (kind as u8 as f64 + 1.0);
        let fit: Vec<u8> = fits.iter().map(|t| *t as u8).collect();
        let reach2 = reach * reach;
        let mut best: Option<(f64, (i32, i32))> = None;
        for dy in -r..=r {
            let y = wrap(c.middle.1 + dy, size);
            let row = &terrain.tiles[(y * size) as usize..((y + 1) * size) as usize];
            for dx in -r..=r {
                let x = wrap(c.middle.0 + dx, size);
                if !fit.contains(&row[x as usize])
                    || f64::from(dx * dx + dy * dy) > reach2
                    || blocked[((dy + r) * side + dx + r) as usize]
                {
                    continue;
                }
                let h = hash(f64::from(x), f64::from(y), seed);
                if best.is_none_or(|(b, _)| h < b) {
                    best = Some((h, (x, y)));
                }
            }
        }
        let at = best?.1;
        block(&mut blocked, (at.0 - spacing + 1, at.1 - spacing + 1), around);
        placed.push((kind, at));
    }
    Some(placed)
}

/// Seconds an unloaded resident of average Agility takes to walk from `from` to the nearest of
/// `to` over the bare terrain (`walk_speed`: Plains at `WALK_TICKS_PER_TILE` a tile, the other
/// terrains slower; diagonal steps `DIAGONAL_STEP` as long and only where both straight tiles
/// beside them can be walked), if that is at most `limit`.
pub fn walk_seconds(
    terrain: &TerrainMap,
    from: (i32, i32),
    to: &[(i32, i32)],
    limit: f64,
) -> Option<f64> {
    let size = terrain.size;
    let second = TICK_MS as f64 / 1000.0;
    let plains = WALK_TICKS_PER_TILE * second;
    let r = ((limit / plains).ceil() as i32 + 2).min(size / 2 - 1);
    let side = 2 * r + 1;
    let local = |x: i32, y: i32| -> Option<usize> {
        let (lx, ly) = (wrap_delta(from.0, x, size) + r, wrap_delta(from.1, y, size) + r);
        ((0..side).contains(&lx) && (0..side).contains(&ly)).then(|| (ly * side + lx) as usize)
    };
    let goals: HashSet<usize> = to.iter().filter_map(|&(x, y)| local(x, y)).collect();
    if goals.is_empty() {
        return None;
    }
    let cost = |x: i32, y: i32| -> Option<f64> {
        let t = terrain_at(terrain, x, y);
        if !is_passable_terrain(t) {
            return None;
        }
        TERRAIN_SPEED.get(t).filter(|s| *s > 0.0).map(|s| plains / s)
    };
    #[derive(PartialEq)]
    struct Open(f64, i32, i32);
    impl Eq for Open {}
    impl PartialOrd for Open {
        fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
            Some(self.cmp(o))
        }
    }
    impl Ord for Open {
        fn cmp(&self, o: &Self) -> Ordering {
            o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
        }
    }
    let mut best = vec![f64::INFINITY; (side * side) as usize];
    let mut open = BinaryHeap::new();
    best[local(from.0, from.1)?] = 0.0;
    open.push(Open(0.0, from.0, from.1));
    while let Some(Open(d, x, y)) = open.pop() {
        if d > limit {
            return None;
        }
        let l = local(x, y)?;
        if d > best[l] {
            continue;
        }
        if goals.contains(&l) {
            return Some(d);
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)] {
            let (nx, ny) = (wrap(x + dx, size), wrap(y + dy, size));
            let Some(nl) = local(nx, ny) else { continue };
            let Some(step) = cost(nx, ny) else { continue };
            let diagonal = dx != 0 && dy != 0;
            if diagonal && (cost(x + dx, y).is_none() || cost(x, y + dy).is_none()) {
                continue;
            }
            let nd = d + if diagonal { step * DIAGONAL_STEP } else { step };
            if nd < best[nl] {
                best[nl] = nd;
                open.push(Open(nd, nx, ny));
            }
        }
    }
    None
}

/// A rule the starting sites of a generated world must keep, broken (`check_starting_sites`, ADR
/// 0004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteProblem {
    pub rule: &'static str,
    pub message: String,
}

/// Checks the rules the starting sites of a newly generated world keep (ADR 0004): every site lies
/// whole in its heartland, on Plains; no two sites' middles closer than the rules' `min_tiles`; a
/// walk from each to the nearest other site in its heartland takes `min_seconds` to `max_seconds`; each has
/// a forest, stone and iron node in reach; and a starting city fits on each free one.
pub fn check_starting_sites(
    world: &WorldState,
    terrain: &TerrainMap,
    regions: &Regions,
) -> Vec<SiteProblem> {
    let size = terrain.size;
    let rules = SiteRules::for_size(size);
    let ground = Ground::new(world, terrain, []);
    let mut problems = Vec::new();
    let mut fail = |rule, message| problems.push(SiteProblem { rule, message });
    let sites = &world.starting_sites;
    for (i, s) in sites.iter().enumerate() {
        let at = format!("site at ({}, {})", s.x, s.y);
        let m = site_middle(s);
        let heartland = regions.region(s.region).is_some_and(|r| r.kind == RegionKind::Heartland);
        let whole = (s.y - FARM_RING..s.y + START_SIZE + FARM_RING).all(|ty| {
            (s.x - FARM_RING..s.x + START_SIZE + FARM_RING)
                .all(|tx| regions.id_at(tx, ty) == Some(s.region))
        });
        if !heartland || !whole {
            fail("site-in-heartland", format!("{at} is not whole in heartland {}", s.region));
        }
        if terrain_at(terrain, m.0, m.1) != Terrain::Plains as u8 {
            fail("site-on-plains", format!("{at} is not on Plains"));
        }
        if let Some(o) =
            sites[i + 1..].iter().find(|o| wrap_distance(size, m, site_middle(o)) < rules.min_tiles)
        {
            fail("sites-apart", format!("{at} is too near the site at ({}, {})", o.x, o.y));
        }
        let others: Vec<(i32, i32)> = sites
            .iter()
            .enumerate()
            .filter(|&(j, o)| j != i && o.region == s.region)
            .map(|(_, o)| site_middle(o))
            .collect();
        if !others.is_empty() {
            match walk_seconds(terrain, m, &others, rules.max_seconds) {
                None => fail(
                    "site-neighbour-walk",
                    format!("{at} is a longer walk from every other site"),
                ),
                Some(s) if s < rules.min_seconds => {
                    fail("site-neighbour-walk", format!("{at} is only {s:.0} s from another site"))
                }
                Some(_) => {}
            }
        }
        for kind in NODES_IN_REACH {
            let near = world.nodes.iter().any(|n| {
                n.kind == kind
                    && wrap_distance(size, (n.x as i32, n.y as i32), m) <= rules.node_reach
            });
            if !near {
                fail("site-nodes-in-reach", format!("{at} has no {kind:?} node in reach"));
            }
        }
        if s.city_id.is_none() && !site_fits(terrain, &ground, s.x, s.y) {
            fail("site-has-room", format!("{at} has no room for a starting city"));
        }
    }
    problems
}

#[cfg(test)]
#[path = "starting_sites_tests.rs"]
mod tests;
