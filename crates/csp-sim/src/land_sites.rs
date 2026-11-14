//! Where the Trade Organization and the NPC cities stand on the land (`CONTEXT.md`: Heartland,
//! Frontier, Island, Trade Org HQ, Trading post, NPC city; ADR 0035): all of them on the mainland,
//! none on an island, a starting site, a pass or a land bridge.
//!
//! - The HQ stands in a frontier region, as far from every starting site as the mainland allows.
//! - Every heartland has a trading post near its middle; the frontier gets the others, one in
//!   each square of the `TRADING_POST_REGION` grid that has frontier land with room.
//! - NPC towns stand in frontier regions, villages in frontier regions and heartlands, by the
//!   counts per region in the balance file.
//! - Caravans and wandering traders drive between them over the passes and land bridges: a post
//!   the HQ has no carriage way to is a generation error (`check_on_the_land`).
//!
//! The regions come from `Regions::of` once for the whole placing (`LandSites`).

use std::collections::HashSet;

use csp_shared::balance::{
    NpcCitySize, NPC_STARTING_SITE_CLEARANCE, NPC_TOWN, NPC_TOWNS_PER_FRONTIER, NPC_VILLAGE,
    NPC_VILLAGES_PER_FRONTIER, NPC_VILLAGES_PER_HEARTLAND, NPC_WAY_CLEARANCE, TRADING_POST,
};
use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::{
    is_passable_terrain, tile_index, wrap, wrap_delta, wrap_distance, TerrainMap,
};
use csp_shared::world::{City, WorldState};

use crate::caravans::place_caravans;
use crate::npc_cities::{
    found_npc_city, give_npc_horses, npc_site_fits_among, taken_ground, SiteWorld, FARM_RING,
};
use crate::queries::city::town_hall_of;
use crate::queries::names::placed;
use crate::queries::trade_org::trade_org_hq;
use crate::random::Mulberry32;
use crate::regions::{drivable, RegionKind, Regions};
use crate::residents::Rand;
use crate::terrain_gen::neighbours;
use crate::trade_org::{found_trade_org_hq, hq_footprint, hq_site_fits, side};
use crate::traders::place_traders;
use crate::trading_posts::{
    common_resource, find_trading_post_site_where, found_trading_post, in_region, regions,
    trading_posts, Region as Square,
};

/// A region's id (`Regions`).
pub type RegionId = u32;

/// The middles of the world's starting sites (`CONTEXT.md`: Starting site), as tiles.
pub fn starting_site_middles(world: &WorldState) -> Vec<(f64, f64)> {
    world
        .starting_sites
        .iter()
        .map(|s| {
            let (x, y) = crate::starting_sites::site_middle(s);
            (f64::from(x), f64::from(y))
        })
        .collect()
}

/// A box of tiles, `[x0, x1) × [y0, y1)`.
type Box = (i32, i32, i32, i32);

/// The land as the placing reads it: the regions, the starting sites to keep clear of, and a box
/// round each pass and land bridge and each region.
pub struct LandSites {
    pub regions: Regions,
    starting: Vec<(f64, f64)>,
    /// Round each way's tiles, by its middle tile and the box round its tiles as seen from it
    /// the short way round the map (which may reach past a side).
    ways: Vec<((i32, i32), Box)>,
    /// Round each region's tiles, by id; none for a region with no land.
    boxes: Vec<Option<Box>>,
}

impl LandSites {
    /// The land of a world on `terrain`: its regions and its starting sites.
    pub fn of(world: &WorldState, terrain: &TerrainMap) -> LandSites {
        LandSites::new(Regions::of(world.seed, terrain), starting_site_middles(world))
    }

    /// The land of `regions` with starting sites whose middles are `starting`.
    pub fn new(regions: Regions, starting: Vec<(f64, f64)>) -> LandSites {
        let size = regions.size;
        let grow = |b: &mut Option<Box>, x: i32, y: i32| {
            let g = b.get_or_insert((x, y, x + 1, y + 1));
            *g = (g.0.min(x), g.1.min(y), g.2.max(x + 1), g.3.max(y + 1));
        };
        let ways = regions
            .ways
            .iter()
            .map(|w| {
                let mut b = None;
                for &t in &w.tiles {
                    let (x, y) = (t as i32 % size, t as i32 / size);
                    grow(&mut b, w.x + wrap_delta(w.x, x, size), w.y + wrap_delta(w.y, y, size));
                }
                ((w.x, w.y), b.unwrap_or((w.x, w.y, w.x + 1, w.y + 1)))
            })
            .collect();
        let mut boxes = vec![None; regions.regions.len()];
        for t in 0..(size * size) as usize {
            if let Some(id) = regions.id_of_tile(t) {
                grow(&mut boxes[id as usize], t as i32 % size, t as i32 / size);
            }
        }
        LandSites { regions, starting, ways, boxes }
    }

    /// The region (x, y) is in, none on water.
    pub fn id_at(&self, x: i32, y: i32) -> Option<RegionId> {
        self.regions.id_at(x, y)
    }

    /// The kind of region (x, y) is in, none on water.
    pub fn kind_at(&self, x: i32, y: i32) -> Option<RegionKind> {
        self.regions.region_at(x, y).map(|r| r.kind)
    }

    /// The box round region `id`'s tiles.
    fn region_box(&self, id: RegionId) -> Option<Box> {
        self.boxes.get(id as usize).copied().flatten()
    }

    /// Whether a city's square of `side` tiles with its top-left tile at (x, y), and the `ring`
    /// round it, is clear of the starting sites (`NPC_STARTING_SITE_CLEARANCE` from its middle)
    /// and of the passes and land bridges (`NPC_WAY_CLEARANCE` past the ring).
    pub fn clear(&self, x: i32, y: i32, side: i32, ring: i32) -> bool {
        let middle = (f64::from(x) + f64::from(side) / 2.0, f64::from(y) + f64::from(side) / 2.0);
        if self.near_a_starting_site(middle) {
            return false;
        }
        let reach = ring + NPC_WAY_CLEARANCE;
        let size = self.regions.size;
        let span = side + 2 * reach;
        !self.ways.iter().any(|&((wx, wy), w)| {
            // The square as seen from the way, the short way round the map.
            let x0 = wx + wrap_delta(wx, x - reach, size);
            let y0 = wy + wrap_delta(wy, y - reach, size);
            x0 < w.2 && w.0 < x0 + span && y0 < w.3 && w.1 < y0 + span
        })
    }

    /// Whether a tile lies closer than `NPC_STARTING_SITE_CLEARANCE` to a starting site's middle.
    pub fn near_a_starting_site(&self, at: (f64, f64)) -> bool {
        near_a_starting_site(&self.starting, self.regions.size, at)
    }

    /// Whether an NPC city or trading post of `side` with its top-left wall tile at (x, y) may
    /// stand there: its middle in region `id`, clear of the starting sites and ways.
    pub fn allows(&self, id: RegionId, x: i32, y: i32, side: i32) -> bool {
        self.id_at(x + side / 2, y + side / 2) == Some(id) && self.clear(x, y, side, FARM_RING)
    }

    /// The ids of the regions of `kind`.
    fn ids_of(&self, kind: RegionKind) -> Vec<RegionId> {
        self.regions.of_kind(kind).filter(|r| r.tiles > 0).map(|r| r.id).collect()
    }
}

/// Whether `at` lies closer than `NPC_STARTING_SITE_CLEARANCE` to one of `starting`, the short way
/// round a map of `size`.
pub fn near_a_starting_site(starting: &[(f64, f64)], size: i32, at: (f64, f64)) -> bool {
    let d = |p: f64, q: f64| {
        let s = f64::from(size);
        let v = (q - p).rem_euclid(s);
        v.min(s - v)
    };
    starting.iter().any(|s| d(s.0, at.0).hypot(d(s.1, at.1)) < NPC_STARTING_SITE_CLEARANCE)
}

/// Places the Trade Organization and the NPC cities on a new world's land
/// (`CONTEXT.md`: Heartland, Frontier): the HQ, the trading posts, the NPC cities with their
/// first horses, a caravan for each post and the wandering traders. Returns what breaks the rules
/// it keeps (`check_on_the_land`); a broken carriage way is for the caller to fail on.
pub fn place_on_the_land(world: &mut WorldState, terrain: &TerrainMap) -> Vec<LandProblem> {
    let land = LandSites::of(world, terrain);
    place_trade_org_hq_on(world, terrain, &land);
    place_trading_posts_on(world, terrain, &land);
    place_npc_cities_on(world, terrain, &land);
    place_caravans(world);
    place_traders(world, terrain.size);
    check_on_the_land(world, terrain, &land)
}

// ---- The HQ. ----

/// How far apart candidate sites for the HQ lie, as `find_hq_site`'s.
const HQ_SITE_STEP: usize = 24;

/// Places the Trade Org HQ in a frontier region (`place_trade_org_hq` on the land), unless the
/// world has one. Returns its id; none when no frontier region has room.
pub fn place_trade_org_hq_on(
    world: &mut WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
) -> Option<String> {
    if let Some(hq) = trade_org_hq(world) {
        return Some(hq.id.clone());
    }
    let mut rand = Mulberry32::new(world.seed as f64 * 7919.0 + 17.0);
    let mut next = || rand.next();
    let site = find_hq_site_on(world, terrain, land, &mut next)?;
    Some(found_trade_org_hq(world, terrain, site.0, site.1, &mut next))
}

/// The HQ's site (`find_hq_site` on the land): its middle in a frontier region, its ground and
/// farm ring clear of every way, as far from the nearest starting site (or, with none, the nearest
/// heartland's middle) and city as the mainland allows, by a random pick among the equally far.
fn find_hq_site_on(
    world: &WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
    rand: &mut Rand,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let reach = hq_footprint() as i32;
    let edge = reach + side("farm");
    let mut from: Vec<(f64, f64)> = if land.starting.is_empty() {
        land.regions
            .of_kind(RegionKind::Heartland)
            .map(|r| (f64::from(r.x), f64::from(r.y)))
            .collect()
    } else {
        land.starting.clone()
    };
    from.extend(world.cities.iter().filter_map(|c| town_hall_of(world, c)).map(|h| (h.x, h.y)));
    let mut candidates: Vec<((i32, i32), f64, f64)> = Vec::new();
    for y in (edge..size - edge).step_by(HQ_SITE_STEP) {
        for x in (edge..size - edge).step_by(HQ_SITE_STEP) {
            if land.kind_at(x, y) != Some(RegionKind::Frontier)
                || !land.clear(x - reach, y - reach, 2 * reach, side("farm"))
            {
                continue;
            }
            let far = from
                .iter()
                .map(|f| wrap_distance(size, (f.0 as i32, f.1 as i32), (x, y)))
                .fold(f64::INFINITY, f64::min);
            candidates.push(((x, y), far, rand()));
        }
    }
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.2.total_cmp(&b.2)));
    let ground = taken_ground(world, terrain);
    candidates
        .into_iter()
        .find(|c| hq_site_fits(world, terrain, c.0 .0, c.0 .1, &ground))
        .map(|c| c.0)
}

// ---- The trading posts. ----

/// Places the trading posts (`place_trading_posts` on the land): one near the middle of every
/// heartland that has none, then one on frontier land in every square of the
/// `TRADING_POST_REGION` grid that has none yet, where one fits. Returns their ids.
pub fn place_trading_posts_on(
    world: &mut WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
) -> Vec<String> {
    let mut m = Mulberry32::new((world.seed * 15_485_863 + 47) as f64);
    let side = TRADING_POST.size as i32;
    let mut placed_posts = Vec::new();
    for id in land.ids_of(RegionKind::Heartland) {
        if post_halls(world).iter().any(|h| land.id_at(h.0 as i32, h.1 as i32) == Some(id)) {
            continue;
        }
        let (Some(b), Some(r)) = (land.region_box(id), land.regions.region(id)) else { continue };
        let square = square_of(b);
        let middle = (f64::from(r.x), f64::from(r.y));
        let allowed = |x: i32, y: i32| land.allows(id, x, y, side);
        let site =
            find_trading_post_site_where(world, terrain, &square, middle, None, false, &allowed);
        let Some((x, y)) = site else { continue };
        let resource = common_resource(world, &square);
        placed_posts.push(found_trading_post(world, terrain, x, y, resource, &mut || m.next()));
    }
    for square in regions(terrain.size) {
        if post_halls(world).iter().any(|&h| in_region(&square, h)) {
            continue;
        }
        let middle = (square.x + square.width / 2.0, square.y + square.height / 2.0);
        let allowed = |x: i32, y: i32| {
            land.kind_at(x + side / 2, y + side / 2) == Some(RegionKind::Frontier)
                && land.clear(x, y, side, FARM_RING)
        };
        let site =
            find_trading_post_site_where(world, terrain, &square, middle, None, true, &allowed);
        let Some((x, y)) = site else { continue };
        let resource = common_resource(world, &square);
        placed_posts.push(found_trading_post(world, terrain, x, y, resource, &mut || m.next()));
    }
    placed_posts
}

/// Where every trading post's town hall stands.
fn post_halls(world: &WorldState) -> Vec<(f64, f64)> {
    trading_posts(world)
        .into_iter()
        .filter_map(|c| town_hall_of(world, c))
        .map(|h| (h.x, h.y))
        .collect()
}

/// A box as a square of the trading posts' grid.
fn square_of(b: Box) -> Square {
    Square {
        x: f64::from(b.0),
        y: f64::from(b.1),
        width: f64::from(b.2 - b.0),
        height: f64::from(b.3 - b.1),
    }
}

// ---- The NPC cities. ----

/// Places the NPC cities (`place_npc_cities` on the land): `NPC_TOWNS_PER_FRONTIER` towns in each
/// frontier region, then `NPC_VILLAGES_PER_FRONTIER` villages in each, then
/// `NPC_VILLAGES_PER_HEARTLAND` in each heartland, each on a site `find_npc_city_site_in` picks
/// and with its first horses. Fewer where a region has no room left. Returns their ids.
pub fn place_npc_cities_on(
    world: &mut WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
) -> Vec<String> {
    let mut m = Mulberry32::new((world.seed * 104_729 + 31) as f64);
    let mut rand = || m.next();
    let frontier = land.ids_of(RegionKind::Frontier);
    let heartlands = land.ids_of(RegionKind::Heartland);
    let mut plan: Vec<(NpcCitySize, RegionId)> = Vec::new();
    let mut add = |kind: NpcCitySize, count: f64, ids: &[RegionId]| {
        for &id in ids {
            plan.extend(std::iter::repeat_n((kind, id), count as usize));
        }
    };
    add(NPC_TOWN, NPC_TOWNS_PER_FRONTIER, &frontier);
    add(NPC_VILLAGE, NPC_VILLAGES_PER_FRONTIER, &frontier);
    add(NPC_VILLAGE, NPC_VILLAGES_PER_HEARTLAND, &heartlands);
    let mut placed = Vec::new();
    for (kind, id) in &plan {
        if let Some((x, y)) = find_npc_city_site_in(world, terrain, land, kind, *id, &mut rand) {
            placed.push(found_npc_city(world, terrain, kind, x, y, &mut rand, None));
        }
    }
    for id in &placed {
        give_npc_horses(world, terrain, id);
    }
    placed
}

/// A site for an NPC city of `kind` in region `id` (`find_npc_city_site` there): of 3,000 random
/// tiles in the region's box, the first where its middle is in the region, clear of the starting
/// sites and ways, and the city fits (`npc_site_fits`). None when the region has no room.
pub fn find_npc_city_site_in(
    world: &WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
    kind: &NpcCitySize,
    id: RegionId,
    rand: &mut Rand,
) -> Option<(i32, i32)> {
    let (x0, y0, x1, y1) = land.region_box(id)?;
    let side = kind.size as i32;
    let (span_x, span_y) = (x1 - x0 - side - 2 * FARM_RING, y1 - y0 - side - 2 * FARM_RING);
    if span_x <= 0 || span_y <= 0 {
        return None;
    }
    let ground = taken_ground(world, terrain);
    let among = SiteWorld::new(world);
    for _ in 0..3000 {
        let x = x0 + FARM_RING + (rand() * f64::from(span_x)).floor() as i32;
        let y = y0 + FARM_RING + (rand() * f64::from(span_y)).floor() as i32;
        if land.allows(id, x, y, side)
            && npc_site_fits_among(&among, terrain, kind, x, y, &ground, true)
        {
            return Some((x, y));
        }
    }
    None
}

// ---- Founding on the mainland. ----

/// The land tiles a walker reaches from a tile without leaving a square `2 × radius` across round
/// it (4 neighbours, across the map's joins): whether a founding party can walk to a site, so a
/// daughter stays on its mother's land, the mainland, and never on an island.
pub struct FootReach {
    x0: i32,
    y0: i32,
    side: i32,
    size: i32,
    reached: Vec<bool>,
}

impl FootReach {
    /// What a walker reaches from (x, y) within `radius` tiles along each direction.
    pub fn from(terrain: &TerrainMap, (x, y): (i32, i32), radius: i32) -> FootReach {
        let size = terrain.size;
        let side = (2 * radius + 1).min(size);
        let (x0, y0) = (x - side / 2, y - side / 2);
        let mut reach =
            FootReach { x0, y0, side, size, reached: vec![false; (side * side) as usize] };
        let start = (x, y);
        let Some(s) = reach.local(start.0, start.1) else { return reach };
        if !is_passable_terrain(terrain.tiles[tile_index(size, x, y)]) {
            return reach;
        }
        reach.reached[s] = true;
        let mut stack = vec![(x, y)];
        while let Some((cx, cy)) = stack.pop() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (cx + dx, cy + dy);
                let Some(l) = reach.local(nx, ny) else { continue };
                if reach.reached[l] || !is_passable_terrain(terrain.tiles[tile_index(size, nx, ny)])
                {
                    continue;
                }
                reach.reached[l] = true;
                stack.push((nx, ny));
            }
        }
        reach
    }

    /// The index of (x, y) in the square, none outside it.
    fn local(&self, x: i32, y: i32) -> Option<usize> {
        let dx = wrap(x - self.x0, self.size);
        let dy = wrap(y - self.y0, self.size);
        (dx < self.side && dy < self.side).then_some((dy * self.side + dx) as usize)
    }

    /// Whether the walker reaches (x, y).
    pub fn reaches(&self, x: i32, y: i32) -> bool {
        self.local(x, y).is_some_and(|l| self.reached[l])
    }
}

// ---- The rules, checked. ----

/// A rule the Trade Organization and NPC cities on a new world's land break (`check_on_the_land`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandProblem {
    pub rule: &'static str,
    pub message: String,
}

/// The rule a post or trader stop with no carriage way to the HQ breaks: a generation error.
pub const ROUTE_RULE: &str = "route-drivable";

/// Checks what `place_on_the_land` keeps (ADR 0004):
/// - `hq-in-frontier`: the HQ stands with its middle in a frontier region;
/// - `post-in-every-heartland`: every heartland has exactly one trading post;
/// - `on-the-mainland`: no tile of the HQ's, a post's or an NPC city's buildings is on an island
///   or on water;
/// - `clear-of-ways`: none is on a pass's or land bridge's tiles;
/// - `clear-of-starting-sites`: no such city's town hall is within `NPC_STARTING_SITE_CLEARANCE`
///   of a starting site;
/// - `route-drivable`: a carriage drives (on the terrain alone) from the HQ to every post, every
///   wandering trader's stop and every heartland.
pub fn check_on_the_land(
    world: &WorldState,
    terrain: &TerrainMap,
    land: &LandSites,
) -> Vec<LandProblem> {
    let mut problems = Vec::new();
    let mut problem = |rule: &'static str, message: String| {
        problems.push(LandProblem { rule, message });
    };
    let size = terrain.size;
    let hall = |c: &City| town_hall_of(world, c).map(|h| (h.x as i32, h.y as i32));
    let hq = trade_org_hq(world);
    let hq_hall = hq.and_then(hall);
    match hq_hall {
        Some((x, y)) if land.kind_at(x, y) == Some(RegionKind::Frontier) => {}
        Some((x, y)) => problem("hq-in-frontier", format!("the HQ stands at ({x}, {y})")),
        None => problem("hq-in-frontier", "the world has no HQ".into()),
    }
    let posts = trading_posts(world);
    for id in land.ids_of(RegionKind::Heartland) {
        let here =
            posts.iter().filter(|p| hall(p).is_some_and(|h| land.id_at(h.0, h.1) == Some(id)));
        let count = here.count();
        if count != 1 {
            problem("post-in-every-heartland", format!("heartland {id} has {count} trading posts"));
        }
    }
    let way_tiles: HashSet<usize> =
        land.regions.ways.iter().flat_map(|w| w.tiles.iter().copied()).collect();
    let ours: HashSet<&str> =
        world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.as_str()).collect();
    for b in &world.buildings {
        let Some(city) = b.city_id.as_deref().filter(|c| ours.contains(c)) else { continue };
        for (x, y) in footprint_tiles(placed(b), size) {
            match land.kind_at(x, y) {
                Some(RegionKind::Heartland | RegionKind::Frontier) => {}
                kind => problem(
                    "on-the-mainland",
                    format!("{} of {city} stands at ({x}, {y}) on {kind:?}", b.id),
                ),
            }
            if way_tiles.contains(&tile_index(size, x, y)) {
                problem(
                    "clear-of-ways",
                    format!("{} of {city} stands on a way at ({x}, {y})", b.id),
                );
            }
        }
    }
    for c in world.cities.iter().filter(|c| ours.contains(c.id.as_str())) {
        if let Some((x, y)) = hall(c) {
            if land.near_a_starting_site((f64::from(x), f64::from(y))) {
                problem("clear-of-starting-sites", format!("{} stands by a starting site", c.id));
            }
        }
    }
    let Some(from) = hq_hall else { return problems };
    let reached = carriage_reach(terrain, from);
    let reaches = |(x, y): (i32, i32)| reached[tile_index(size, x, y)];
    for p in &posts {
        if !hall(p).is_some_and(reaches) {
            problem(ROUTE_RULE, format!("no carriage way from the HQ to trading post {}", p.id));
        }
    }
    for t in &world.traders {
        for stop in &t.r#loop {
            let stands = world.cities.iter().find(|c| &c.id == stop).and_then(hall);
            if !stands.is_some_and(reaches) {
                problem(
                    ROUTE_RULE,
                    format!("no carriage way from the HQ to {stop} on {}'s loop", t.id),
                );
            }
        }
    }
    let mut heartland_reached = HashSet::new();
    for (t, &r) in reached.iter().enumerate() {
        if r {
            if let Some(id) = land.regions.id_of_tile(t) {
                heartland_reached.insert(id);
            }
        }
    }
    for id in land.ids_of(RegionKind::Heartland) {
        if !heartland_reached.contains(&id) {
            problem(ROUTE_RULE, format!("no carriage way from the HQ to heartland {id}"));
        }
    }
    problems
}

/// The tiles a carriage drives to from `from` on the terrain alone (4 neighbours, Plains, Forest
/// and Hills), by tile index.
pub fn carriage_reach(terrain: &TerrainMap, from: (i32, i32)) -> Vec<bool> {
    let size = terrain.size;
    let mut reached = vec![false; terrain.tiles.len()];
    let s = tile_index(size, from.0, from.1);
    if !drivable(terrain.tiles[s]) {
        return reached;
    }
    reached[s] = true;
    let mut stack = vec![s];
    while let Some(t) = stack.pop() {
        for nb in neighbours(size, t) {
            if !reached[nb] && drivable(terrain.tiles[nb]) {
                reached[nb] = true;
                stack.push(nb);
            }
        }
    }
    reached
}

#[cfg(test)]
#[path = "land_sites_tests.rs"]
mod tests;
