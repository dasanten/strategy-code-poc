//! Regions (`CONTEXT.md`: Region, Heartland, Frontier, Island; ADR 0035): every land tile lies in
//! one region. The mainland is cut into `HEARTLAND_COUNT` heartlands and `FRONTIER_REGION_COUNT`
//! frontier regions of roughly even size; each island is a region of its own. Mainland regions are
//! parted by Mountain ranges and arms of the Sea and joined only by **passes** (a gap of Hills in a
//! range) and **land bridges** (a neck of land between two arms of the Sea), together the **ways**
//! between two regions.
//!
//! Regions are part of the terrain: [`Regions::of`] works them out from the world's seed and its
//! terrain, the same every time, so nothing about them is stored. The mainland's regions are laid
//! out from the seed alone ([`Layout`]: sites on the mainland's shape, each tile in the region of
//! the nearest site, its borders bent by noise); which tiles are land, and the islands, come from
//! the terrain. The generator (`terrain_gen`) raises the ranges and cuts the arms along the borders
//! of the same layout ([`raise_borders`]) and keeps the mainland joined for a carriage
//! ([`join_for_carriages`]); a way is then wherever a carriage can step from one region into
//! another, which is only through the gaps the generator left.
//!
//! In the game, read them from the map's shared terrain, which works them out once and keeps them:
//! `MapTerrain::regions(world.seed)`; then [`Regions::region_at`], [`Regions::of_kind`],
//! [`Regions::ways_between`] and the rest. The admin map shows them (`admin_map::admin_land`).

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use serde::Serialize;
use ts_rs::TS;

use csp_shared::balance::{
    FRONTIER_REGION_COUNT, HEARTLAND_COUNT, PASS_WIDTH, REGION_BORDER_WIDTH, SEA_ARM_SHARE,
    SECOND_WAY_SHARE,
};
use csp_shared::terrain::{Terrain, TerrainMap};

use crate::land::Land;
use crate::random::hash;
use crate::terrain_gen::{fbm, neighbours, MainlandShape};

/// No region: water, or a tile off the mainland in a mainland-only table.
pub(crate) const NONE: u8 = u8::MAX;

/// What a region is (`CONTEXT.md`: Region).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RegionKind {
    Heartland,
    Frontier,
    Island,
}

/// One region: its kind, a name from the game, how many land tiles it has and a tile of it near
/// its middle, to point at it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub id: u32,
    pub kind: RegionKind,
    pub name: String,
    pub tiles: u32,
    pub x: i32,
    pub y: i32,
}

/// What a way between two mainland regions is (`CONTEXT.md`: Region).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WayKind {
    /// A gap of Hills in a Mountain range.
    Pass,
    /// A neck of land between two arms of the Sea.
    LandBridge,
}

/// A pass or a land bridge: the two regions it joins (the lower id first), a tile in its middle
/// and how many tiles wide it is along its border.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Way {
    pub kind: WayKind,
    pub between: [u32; 2],
    pub x: i32,
    pub y: i32,
    pub width: u32,
    /// The tiles a carriage crosses the border from, on either side: closing these closes the way.
    #[serde(skip)]
    #[ts(skip)]
    pub tiles: Vec<usize>,
}

/// The regions of a map: which region each land tile is in, the regions, and the ways between
/// them (`Regions::of`).
#[derive(Debug, Clone, PartialEq)]
pub struct Regions {
    pub size: i32,
    /// Each tile's region id, `NONE` on water.
    of_tile: Vec<u8>,
    /// By id: the mainland's regions first, then the islands.
    pub regions: Vec<Region>,
    /// Ordered by their first tile.
    pub ways: Vec<Way>,
}

impl Regions {
    /// The regions of `map`, generated from `seed` (the world's): the same for the same seed and
    /// terrain.
    pub fn of(seed: i64, map: &TerrainMap) -> Regions {
        let layout = Layout::new(seed, map.size);
        let land = Land::of(map);
        let size = map.size;
        let n = map.tiles.len();
        let mainland_count = layout.sites.len();
        // Islands get the ids after the mainland's, in the order of their groups.
        let mut island_id = vec![NONE; land.sizes.len()];
        let mut next = mainland_count;
        for g in land.islands() {
            if next < NONE as usize {
                island_id[g as usize] = next as u8;
                next += 1;
            }
        }
        let mut of_tile = vec![NONE; n];
        let mut tiles = vec![0u32; next];
        let mut sum = vec![(0f64, 0f64); next];
        for (t, region) in of_tile.iter_mut().enumerate() {
            let g = land.group[t];
            if g == -1 {
                continue;
            }
            let (x, y) = ((t as i32) % size, (t as i32) / size);
            let id = if land.is_mainland(t) { layout.cell(x, y) } else { island_id[g as usize] };
            if id == NONE {
                continue;
            }
            *region = id;
            tiles[id as usize] += 1;
            sum[id as usize].0 += f64::from(x);
            sum[id as usize].1 += f64::from(y);
        }
        // A tile to point at: the region's tile nearest its site (a mainland region) or its
        // middle (an island).
        let aim: Vec<(f64, f64)> = (0..next)
            .map(|id| match layout.tile_sites.get(id) {
                Some(&site) => site,
                None => {
                    let c = f64::from(tiles[id].max(1));
                    (sum[id].0 / c, sum[id].1 / c)
                }
            })
            .collect();
        let mut middle = vec![(f64::INFINITY, 0i32, 0i32); next];
        for (t, &id) in of_tile.iter().enumerate() {
            if id == NONE {
                continue;
            }
            let (x, y) = ((t as i32) % size, (t as i32) / size);
            let (ax, ay) = aim[id as usize];
            let d = (f64::from(x) - ax).powi(2) + (f64::from(y) - ay).powi(2);
            if d < middle[id as usize].0 {
                middle[id as usize] = (d, x, y);
            }
        }
        let names = region_names(seed, next);
        let regions = (0..next)
            .map(|id| Region {
                id: id as u32,
                kind: layout.kinds.get(id).copied().unwrap_or(RegionKind::Island),
                name: names[id].clone(),
                tiles: tiles[id],
                x: middle[id].1,
                y: middle[id].2,
            })
            .collect();
        let ways = find_ways(map, &layout, &of_tile, mainland_count);
        Regions { size, of_tile, regions, ways }
    }

    /// The id of the region tile (x, y) is in; none on water. Coordinates past a side continue on
    /// the other.
    pub fn id_at(&self, x: i32, y: i32) -> Option<u32> {
        let id = self.of_tile[csp_shared::terrain::tile_index(self.size, x, y)];
        (id != NONE).then_some(u32::from(id))
    }

    /// The region tile (x, y) is in; none on water.
    pub fn region_at(&self, x: i32, y: i32) -> Option<&Region> {
        self.id_at(x, y).map(|id| &self.regions[id as usize])
    }

    /// The region of an id.
    pub fn region(&self, id: u32) -> Option<&Region> {
        self.regions.get(id as usize)
    }

    /// The region of each tile by tile index, `None` on water.
    pub fn id_of_tile(&self, t: usize) -> Option<u32> {
        let id = self.of_tile[t];
        (id != NONE).then_some(u32::from(id))
    }

    /// The regions of one kind.
    pub fn of_kind(&self, kind: RegionKind) -> impl Iterator<Item = &Region> + '_ {
        self.regions.iter().filter(move |r| r.kind == kind)
    }

    /// The ways between regions `a` and `b`, either way round.
    pub fn ways_between(&self, a: u32, b: u32) -> impl Iterator<Item = &Way> + '_ {
        let pair = [a.min(b), a.max(b)];
        self.ways.iter().filter(move |w| w.between == pair)
    }
}

/// Tiles across the band along a border (`REGION_BORDER_WIDTH`), narrower on a small map.
pub(crate) fn border_width(size: i32) -> i32 {
    (size / 64).clamp(2, REGION_BORDER_WIDTH)
}

/// Tiles along its border a pass or a land bridge is wide (`PASS_WIDTH`), narrower on a small map.
pub(crate) fn pass_width(size: i32) -> i32 {
    (border_width(size) * 2 / 3).clamp(2, PASS_WIDTH)
}

/// How far from the mainland's middle the sites of its regions lie, at most, in the units of
/// [`MainlandShape::unit`] (the coast lies about 1 away).
const SITE_REACH: f64 = 0.72;

/// Candidates drawn for each site; the one farthest from the sites before it is taken.
const SITE_CANDIDATES: u32 = 24;

/// How far noise bends the borders between regions, as a share of the mainland's reach.
const BORDER_BEND: f64 = 0.5;

/// Where the mainland's land may lie at most, in the units of [`MainlandShape::unit`]: regions
/// that touch within it count as neighbours when heartlands are picked.
const MAINLAND_ENVELOPE: f64 = 1.7;

/// The mainland's regions laid out from the seed alone: a site per region on the mainland's shape,
/// the kind of each, and the noise that bends their borders. A mainland tile is in the region of
/// the nearest site ([`Layout::cell`]).
pub(crate) struct Layout {
    seed: f64,
    shape: MainlandShape,
    /// Each region's site, in the shape's units.
    sites: Vec<(f64, f64)>,
    /// The same sites as tiles.
    tile_sites: Vec<(f64, f64)>,
    kinds: Vec<RegionKind>,
    bend: [CoarseNoise; 2],
    /// How far, in tiles, the noise bends a border at most either way.
    bend_tiles: f64,
}

impl Layout {
    pub(crate) fn new(seed: i64, size: i32) -> Layout {
        let seed = seed as f64;
        let shape = MainlandShape::of(seed, size);
        let count = (HEARTLAND_COUNT + FRONTIER_REGION_COUNT) as usize;
        let mut s = 0.0;
        let mut rand = || {
            let v = hash(s, 17.0, seed);
            s += 1.0;
            v
        };
        // Sites spread over the shape (best of several candidates each), compared as tiles so
        // the regions come out about the same size whatever the stretch.
        let mut sites: Vec<(f64, f64)> = Vec::with_capacity(count);
        let mut tile_sites: Vec<(f64, f64)> = Vec::with_capacity(count);
        for _ in 0..count {
            // The candidate farthest from the sites so far, in the shape's units, and how far.
            let mut best = (f64::NEG_INFINITY, (0.0, 0.0));
            for _ in 0..SITE_CANDIDATES {
                let r = SITE_REACH * rand().sqrt();
                let a = rand() * std::f64::consts::TAU;
                let unit = (r * a.cos(), r * a.sin());
                let tile = shape.tile(unit.0, unit.1);
                let d = tile_sites
                    .iter()
                    .map(|&(x, y)| (x - tile.0).hypot(y - tile.1))
                    .fold(f64::INFINITY, f64::min);
                if d > best.0 {
                    best = (d, unit);
                }
            }
            sites.push(best.1);
            tile_sites.push(shape.tile(best.1 .0, best.1 .1));
        }
        let spacing = (shape.reach / 2.0).max(4.0);
        let step = (size / 96).max(1);
        let bend = [
            CoarseNoise::new(size, step, spacing, seed + 41.0),
            CoarseNoise::new(size, step, spacing, seed + 43.0),
        ];
        let mut layout = Layout {
            seed,
            shape,
            sites,
            tile_sites,
            kinds: vec![RegionKind::Frontier; count],
            bend,
            bend_tiles: BORDER_BEND * shape.reach,
        };
        layout.kinds = layout.pick_heartlands(size);
        layout
    }

    /// The mainland region of tile (x, y), were it mainland: the nearest site's, after the noise
    /// moves the tile.
    pub(crate) fn cell(&self, x: i32, y: i32) -> u8 {
        let bx = f64::from(x) + (self.bend[0].at(x, y) - 0.5) * self.bend_tiles;
        let by = f64::from(y) + (self.bend[1].at(x, y) - 0.5) * self.bend_tiles;
        let mut best = (f64::INFINITY, NONE);
        for (i, &(sx, sy)) in self.tile_sites.iter().enumerate() {
            let d = (bx - sx) * (bx - sx) + (by - sy) * (by - sy);
            if d < best.0 {
                best = (d, i as u8);
            }
        }
        best.1
    }

    /// The kind of mainland region `id`.
    pub(crate) fn kind(&self, id: u8) -> RegionKind {
        self.kinds.get(id as usize).copied().unwrap_or(RegionKind::Island)
    }

    /// Whether the border between regions `a` and `b` is an arm of the Sea (else a range).
    fn sea_arm(&self, a: u8, b: u8) -> bool {
        hash(f64::from(a.min(b)), f64::from(a.max(b)) + 100.0, self.seed + 23.0) < SEA_ARM_SHARE
    }

    /// Whether the border between regions `a` and `b` has two ways through.
    fn second_way(&self, a: u8, b: u8) -> bool {
        hash(f64::from(a.min(b)), f64::from(a.max(b)) + 200.0, self.seed + 29.0) < SECOND_WAY_SHARE
    }

    /// The heartlands: sites nearest the mainland's middle first, each only if its region touches
    /// no heartland picked before it, anywhere the mainland may reach; if that leaves too few, the
    /// nearest of the rest.
    fn pick_heartlands(&self, size: i32) -> Vec<RegionKind> {
        let count = self.sites.len();
        let wanted = (HEARTLAND_COUNT as usize).min(count);
        let touching = self.neighbours_in_envelope(size);
        let mut order: Vec<usize> = (0..count).collect();
        order.sort_by(|&a, &b| {
            let ra = self.sites[a].0.hypot(self.sites[a].1);
            let rb = self.sites[b].0.hypot(self.sites[b].1);
            ra.total_cmp(&rb)
        });
        let mut kinds = vec![RegionKind::Frontier; count];
        let mut picked = Vec::new();
        for &i in &order {
            if picked.len() < wanted
                && picked.iter().all(|&p: &usize| !touching.contains(&pair(i, p)))
            {
                picked.push(i);
            }
        }
        for &i in &order {
            if picked.len() < wanted && !picked.contains(&i) {
                picked.push(i);
            }
        }
        for i in picked {
            kinds[i] = RegionKind::Heartland;
        }
        kinds
    }

    /// Which regions touch, sampled every few tiles over where the mainland may reach.
    fn neighbours_in_envelope(&self, size: i32) -> HashSet<(usize, usize)> {
        let step = (size / 1024).max(1);
        let side = (size + step - 1) / step;
        let mut cells = vec![NONE; (side * side) as usize];
        for cy in 0..side {
            for cx in 0..side {
                let (x, y) = (cx * step, cy * step);
                let (u, v) = self.shape.unit(f64::from(x), f64::from(y));
                if u.hypot(v) < MAINLAND_ENVELOPE {
                    cells[(cy * side + cx) as usize] = self.cell(x, y);
                }
            }
        }
        let mut touching = HashSet::new();
        for cy in 0..side {
            for cx in 0..side {
                let a = cells[(cy * side + cx) as usize];
                if a == NONE {
                    continue;
                }
                for (nx, ny) in [(cx + 1, cy), (cx, cy + 1)] {
                    if nx < side && ny < side {
                        let b = cells[(ny * side + nx) as usize];
                        if b != NONE && b != a {
                            touching.insert(pair(a as usize, b as usize));
                        }
                    }
                }
            }
        }
        touching
    }
}

fn pair<T: Ord + Copy>(a: T, b: T) -> (T, T) {
    (a.min(b), a.max(b))
}

/// Noise worked out every `step` tiles and blended in between: smooth and cheap, for bending
/// borders. Not seamless across the joins, which lie in the Sea.
struct CoarseNoise {
    step: i32,
    side: usize,
    values: Vec<f32>,
}

impl CoarseNoise {
    fn new(size: i32, step: i32, spacing: f64, seed: f64) -> CoarseNoise {
        let side = (size / step + 2) as usize;
        let sz = f64::from(size);
        let mut values = vec![0f32; side * side];
        for cy in 0..side {
            for cx in 0..side {
                let (x, y) = ((cx as i32 * step) as f64, (cy as i32 * step) as f64);
                values[cy * side + cx] = fbm(x, y, sz, spacing, 3, seed) as f32;
            }
        }
        CoarseNoise { step, side, values }
    }

    fn at(&self, x: i32, y: i32) -> f64 {
        let last = self.side as i32 - 2;
        let (fx, fy) = (x.rem_euclid(self.step), y.rem_euclid(self.step));
        let (cx, cy) = ((x / self.step).clamp(0, last), (y / self.step).clamp(0, last));
        let (tx, ty) = (f64::from(fx) / f64::from(self.step), f64::from(fy) / f64::from(self.step));
        let v = |cx: i32, cy: i32| f64::from(self.values[cy as usize * self.side + cx as usize]);
        let top = v(cx, cy) * (1.0 - tx) + v(cx + 1, cy) * tx;
        let bottom = v(cx, cy + 1) * (1.0 - tx) + v(cx + 1, cy + 1) * tx;
        top * (1.0 - ty) + bottom * ty
    }
}

/// Names of regions (`REGION_NAMES`): only flavour, like city names.
pub const REGION_NAMES: [&str; 32] = [
    "Ashvale",
    "Brackenmoor",
    "Coldwater",
    "Dunmarch",
    "Eastreach",
    "Fallowmere",
    "Greywold",
    "Harrowdene",
    "Ironfell",
    "Juniper Downs",
    "Kestrel Heath",
    "Longacre",
    "Mirefield",
    "Northwatch",
    "Oakhollow",
    "Pinecrest",
    "Quarrymoor",
    "Redmarsh",
    "Saltmere",
    "Thornfield",
    "Underhill",
    "Vale of Wren",
    "Westerling",
    "Yarrowby",
    "Amberlea",
    "Blackscar",
    "Copperdale",
    "Driftholm",
    "Emberly",
    "Foxmoor",
    "Galeholt",
    "Highcombe",
];

/// A name for each of `count` regions, drawn from `REGION_NAMES` in an order the seed picks; once
/// the list runs dry, again with a numeral.
fn region_names(seed: i64, count: usize) -> Vec<String> {
    let seed = seed as f64;
    let mut order: Vec<usize> = (0..REGION_NAMES.len()).collect();
    order.sort_by(|&a, &b| {
        hash(a as f64, 31.0, seed).total_cmp(&hash(b as f64, 31.0, seed)).then(a.cmp(&b))
    });
    (0..count)
        .map(|i| {
            let name = REGION_NAMES[order[i % order.len()]];
            match i / order.len() {
                0 => name.to_string(),
                round => format!("{name} {}", round + 1),
            }
        })
        .collect()
}

/// Whether a carriage drives on the terrain (`can_drive`): Plains, Forest, Hills. Roads are never
/// stored in the map.
fn drivable(tile: u8) -> bool {
    matches!(Terrain::from_byte(tile), Some(Terrain::Plains | Terrain::Forest | Terrain::Hills))
}

/// The ways between mainland regions: every group of tiles where a carriage steps from one region
/// into another (the gaps the generator left in the borders), as one way each.
fn find_ways(map: &TerrainMap, layout: &Layout, of_tile: &[u8], mainland: usize) -> Vec<Way> {
    let size = map.size;
    let tiles = &map.tiles;
    let on_mainland = |t: usize| of_tile[t] != NONE && (of_tile[t] as usize) < mainland;
    let mut crossing: Vec<usize> = Vec::new();
    for t in 0..tiles.len() {
        if !on_mainland(t) || !drivable(tiles[t]) {
            continue;
        }
        let other = neighbours(size, t)
            .iter()
            .any(|&nb| on_mainland(nb) && drivable(tiles[nb]) && of_tile[nb] != of_tile[t]);
        if other {
            crossing.push(t);
        }
    }
    let is_crossing: HashSet<usize> = crossing.iter().copied().collect();
    let mut seen: HashSet<usize> = HashSet::new();
    let reach = border_width(size) + pass_width(size);
    let mut ways = Vec::new();
    for &start in &crossing {
        if !seen.insert(start) {
            continue;
        }
        let mut group = vec![start];
        let mut i = 0;
        while i < group.len() {
            let t = group[i];
            i += 1;
            let (x, y) = ((t as i32) % size, (t as i32) / size);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let nb = csp_shared::terrain::tile_index(size, x + dx, y + dy);
                    if is_crossing.contains(&nb) && seen.insert(nb) {
                        group.push(nb);
                    }
                }
            }
        }
        group.sort_unstable();
        // The two regions most of its tiles are in.
        let mut counts: BTreeMap<u8, u32> = BTreeMap::new();
        for &t in &group {
            *counts.entry(of_tile[t]).or_default() += 1;
        }
        let mut by_count: Vec<(u8, u32)> = counts.into_iter().collect();
        by_count.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let (a, b) = match by_count.as_slice() {
            [(a, _), (b, _), ..] => (*a, *b),
            _ => continue,
        };
        let (cx, cy) = group.iter().fold((0.0, 0.0), |(sx, sy), &t| {
            (sx + f64::from((t as i32) % size), sy + f64::from((t as i32) / size))
        });
        let (cx, cy) = (cx / group.len() as f64, cy / group.len() as f64);
        let middle = *group
            .iter()
            .min_by(|&&p, &&q| {
                let d = |t: usize| {
                    (f64::from((t as i32) % size) - cx).powi(2)
                        + (f64::from((t as i32) / size) - cy).powi(2)
                };
                d(p).total_cmp(&d(q))
            })
            .expect("a tile");
        let (mx, my) = ((middle as i32) % size, (middle as i32) / size);
        let by_sea = layout.sea_arm(a, b) && sea_within(map, mx, my, reach);
        ways.push(Way {
            kind: if by_sea { WayKind::LandBridge } else { WayKind::Pass },
            between: [u32::from(a.min(b)), u32::from(a.max(b))],
            x: mx,
            y: my,
            width: span(size, &group),
            tiles: group,
        });
    }
    ways
}

/// How many tiles long a group of tiles is: the farthest two lie this far apart, plus one.
fn span(size: i32, group: &[usize]) -> u32 {
    let at = |t: usize| (f64::from(t as i32 % size), f64::from(t as i32 / size));
    let mut far = 0f64;
    for (i, &p) in group.iter().enumerate() {
        for &q in &group[i + 1..] {
            let (a, b) = (at(p), at(q));
            far = far.max((a.0 - b.0).hypot(a.1 - b.1));
        }
    }
    far as u32 + 1
}

/// Whether a Sea tile lies within `r` tiles of (x, y).
fn sea_within(map: &TerrainMap, x: i32, y: i32, r: i32) -> bool {
    (-r..=r).any(|dy| {
        (-r..=r).any(|dx| {
            dx * dx + dy * dy <= r * r
                && csp_shared::terrain::terrain_at(map, x + dx, y + dy) == Terrain::Sea as u8
        })
    })
}

/// Raises the borders between the mainland's regions (`cells`: each mainland tile's, `NONE` elsewhere): along
/// each border a band `border_width` tiles wide becomes Mountain or, on an arm of the Sea, Sea,
/// except at the gaps it keeps as ways. Each stretch of a border keeps one gap (the longest stretch
/// between two regions one or two), `pass_width` tiles wide and clear of other borders where that
/// fits, all Hills: a pass in a range, a land bridge between two arms. A stretch too short for a
/// whole gap keeps none. An arm that reaches no open Sea becomes Mountain, and a lake it touches
/// joins the Sea.
pub(crate) fn raise_borders(map: &mut TerrainMap, layout: &Layout, cells: &[u8]) {
    let size = map.size;
    let n = map.tiles.len();
    let depth = (border_width(size) + 1) / 2;
    let gap_radius = f64::from(pass_width(size)) / 2.0 + 0.5;
    // The tiles on a border, each with the pair of regions it parts.
    let mut pair_of: HashMap<usize, (u8, u8)> = HashMap::new();
    let mut by_pair: BTreeMap<(u8, u8), Vec<usize>> = BTreeMap::new();
    for t in 0..n {
        let c = cells[t];
        if c == NONE {
            continue;
        }
        let other =
            neighbours(size, t).iter().map(|&nb| cells[nb]).filter(|&d| d != NONE && d != c).min();
        if let Some(d) = other {
            let p = pair(c, d);
            pair_of.insert(t, p);
            by_pair.entry(p).or_default().push(t);
        }
    }
    // The band: each tile within `depth` steps of a border, inside its own region, with the
    // border tile it is nearest.
    let mut source: HashMap<usize, usize> = pair_of.keys().map(|&t| (t, t)).collect();
    let mut frontier: Vec<usize> = pair_of.keys().copied().collect();
    frontier.sort_unstable();
    for _ in 1..depth {
        let mut next = Vec::new();
        for &t in &frontier {
            let s = source[&t];
            for nb in neighbours(size, t) {
                if cells[nb] == cells[t] && !source.contains_key(&nb) {
                    source.insert(nb, s);
                    next.push(nb);
                }
            }
        }
        frontier = next;
    }
    // The gaps: border tiles near a gap's middle are open, and so is the band they lead into.
    let mut open: HashSet<usize> = HashSet::new();
    let clear = f64::from(2 * depth) + gap_radius * 2.0;
    for (&p, border) in &by_pair {
        let stretches = stretches_of(size, border);
        let longest = stretches.iter().map(Stretch::len).max().unwrap_or(0);
        let mut long_done = false;
        for stretch in &stretches {
            let two = !long_done
                && stretch.len() == longest
                && layout.second_way(p.0, p.1)
                && stretch.len() as f64 >= 8.0 * gap_radius * 2.0;
            long_done |= stretch.len() == longest;
            // A stretch too short for a whole gap (where two regions meet at a corner) is closed:
            // a carriage goes round by other regions.
            if (stretch.len() as f64) < 4.0 * gap_radius - 2.0 {
                continue;
            }
            // An arm of the Sea keeps its gap away from the coast it opens onto, so most of the
            // arm is joined to the open Sea (the rest becomes a range).
            let from_coast = |share: f64| {
                if !layout.sea_arm(p.0, p.1) {
                    return share;
                }
                let by_sea =
                    |t: usize| sea_within(map, t as i32 % size, t as i32 / size, 2 * depth + 2);
                let (first, last) = (stretch.along[0], stretch.along[stretch.len() - 1]);
                match (by_sea(first), by_sea(last)) {
                    (true, false) => 0.5 + share * 0.4,
                    (false, true) => 0.5 - share * 0.4,
                    _ => share,
                }
            };
            let wanted: Vec<f64> = if two { vec![0.25, 0.75] } else { vec![0.5] }
                .into_iter()
                .map(from_coast)
                .collect();
            for (i, &at) in wanted.iter().enumerate() {
                let jitter =
                    hash(f64::from(p.0) * 16.0 + f64::from(p.1), i as f64, layout.seed) * 0.2 - 0.1;
                let (middle, radius) =
                    gap_middle(size, stretch, at + jitter, clear, gap_radius, |t| {
                        pair_of.get(&t).is_some_and(|&q| q != p)
                    });
                let (mx, my) = (middle as i32 % size, middle as i32 / size);
                for &t in &stretch.along {
                    let (x, y) = (t as i32 % size, t as i32 / size);
                    if f64::from(x - mx).hypot(f64::from(y - my)) <= radius {
                        open.insert(t);
                    }
                }
            }
        }
    }
    let tiles = &mut map.tiles;
    let mut arm = Vec::new();
    for (&t, &s) in &source {
        let p = pair_of[&s];
        let sea = layout.sea_arm(p.0, p.1);
        if open.contains(&s) {
            tiles[t] = Terrain::Hills as u8;
        } else if sea {
            tiles[t] = Terrain::Sea as u8;
            arm.push(t);
        } else {
            tiles[t] = Terrain::Mountain as u8;
        }
    }
    // Sea not joined to the open Sea along the map's joins is no arm of it: a range instead.
    let open_sea = open_sea(map);
    for t in arm {
        if !open_sea[t] {
            map.tiles[t] = Terrain::Mountain as u8;
        }
    }
    lakes_on_the_sea_join_it(map);
}

/// A stretch of a border: tiles of it (both sides) that touch, straight or diagonally.
struct Stretch {
    /// From one end to the other: in the order a search from the farthest tile reaches them.
    along: Vec<usize>,
    /// The same tiles in tile order, to look one up.
    sorted: Vec<usize>,
}

impl Stretch {
    fn len(&self) -> usize {
        self.along.len()
    }
}

/// The tiles of `all` reached from `start` (8 neighbours), in the order reached.
fn reached_from(size: i32, all: &HashSet<usize>, start: usize) -> Vec<usize> {
    let mut seen = HashSet::from([start]);
    let mut group = vec![start];
    let mut i = 0;
    while i < group.len() {
        let (x, y) = (group[i] as i32 % size, group[i] as i32 / size);
        i += 1;
        for dy in -1..=1 {
            for dx in -1..=1 {
                let nb = csp_shared::terrain::tile_index(size, x + dx, y + dy);
                if all.contains(&nb) && seen.insert(nb) {
                    group.push(nb);
                }
            }
        }
    }
    group
}

/// The stretches of a border (its tiles, both sides), each from one end to the other.
fn stretches_of(size: i32, border: &[usize]) -> Vec<Stretch> {
    let all: HashSet<usize> = border.iter().copied().collect();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut out = Vec::new();
    for &start in border {
        if seen.contains(&start) {
            continue;
        }
        let first = reached_from(size, &all, start);
        seen.extend(first.iter().copied());
        let end = *first.last().expect("the start");
        let along = reached_from(size, &all, end);
        let mut sorted = along.clone();
        sorted.sort_unstable();
        out.push(Stretch { along, sorted });
    }
    out
}

/// The middle tile of a gap in `stretch`: the one at share `at` along it, or the nearest share to
/// it whose gap (`radius` tiles round it) lies whole on the stretch and has no tile of another
/// border (`other`) within `clear` tiles, so the gap leads into no other range; failing that, the
/// best spot, its gap opened wider until it is whole. Gives the middle and the gap's radius.
fn gap_middle(
    size: i32,
    stretch: &Stretch,
    at: f64,
    clear: f64,
    radius: f64,
    other: impl Fn(usize) -> bool,
) -> (usize, f64) {
    let len = stretch.len();
    let pick =
        |share: f64| stretch.along[((share.clamp(0.0, 1.0) * len as f64) as usize).min(len - 1)];
    // Tiles of the stretch within `r` of tile `t`.
    let along = |t: usize, r: f64| {
        let (x, y) = (t as i32 % size, t as i32 / size);
        let g = r.floor() as i32;
        (-g..=g)
            .flat_map(|dy| (-g..=g).map(move |dx| (dx, dy)))
            .filter(|&(dx, dy)| f64::from(dx).hypot(f64::from(dy)) <= r)
            .filter(|&(dx, dy)| {
                let nb = csp_shared::terrain::tile_index(size, x + dx, y + dy);
                stretch.sorted.binary_search(&nb).is_ok()
            })
            .count()
    };
    let is_clear = |t: usize| {
        let (x, y) = (t as i32 % size, t as i32 / size);
        let c = clear.ceil() as i32;
        !(-c..=c).any(|dy| {
            (-c..=c).any(|dx| {
                f64::from(dx).hypot(f64::from(dy)) <= clear
                    && other(csp_shared::terrain::tile_index(size, x + dx, y + dy))
            })
        })
    };
    // Both sides of a straight border, `2 * radius` tiles along.
    let whole = (4.0 * radius - 2.0) as usize;
    let mut best: Option<((bool, usize), usize)> = None;
    for k in 0..=40 {
        let off = f64::from(k) * 0.025;
        for share in [at - off, at + off] {
            let t = pick(share);
            let key = (is_clear(t), along(t, radius).min(whole));
            if key == (true, whole) {
                return (t, radius);
            }
            if best.is_none_or(|(b, _)| key > b) {
                best = Some((key, t));
            }
        }
    }
    // No spot fits a whole gap: the best one, opened wider until it does, up to twice as wide.
    let (_, t) = best.expect("a stretch has tiles");
    let mut r = radius;
    while along(t, r) < whole && r < 2.0 * radius {
        r += 0.5;
    }
    (t, r)
}

/// Which tiles are Sea joined to the Sea along the map's joins (4 neighbours).
fn open_sea(map: &TerrainMap) -> Vec<bool> {
    let size = map.size;
    let sea = Terrain::Sea as u8;
    let mut reached = vec![false; map.tiles.len()];
    let mut queue: VecDeque<usize> = VecDeque::new();
    for i in 0..size as usize {
        for t in [i, i * size as usize] {
            if map.tiles[t] == sea && !reached[t] {
                reached[t] = true;
                queue.push_back(t);
            }
        }
    }
    while let Some(t) = queue.pop_front() {
        for nb in neighbours(size, t) {
            if map.tiles[nb] == sea && !reached[nb] {
                reached[nb] = true;
                queue.push_back(nb);
            }
        }
    }
    reached
}

/// Every lake that touches the Sea becomes Sea, as a whole.
fn lakes_on_the_sea_join_it(map: &mut TerrainMap) {
    let size = map.size;
    let (lake, sea) = (Terrain::Lake as u8, Terrain::Sea as u8);
    let mut stack = Vec::new();
    for t in 0..map.tiles.len() {
        if map.tiles[t] == lake && neighbours(size, t).iter().any(|&nb| map.tiles[nb] == sea) {
            map.tiles[t] = sea;
            stack.push(t);
        }
    }
    while let Some(t) = stack.pop() {
        for nb in neighbours(size, t) {
            if map.tiles[nb] == lake {
                map.tiles[nb] = sea;
                stack.push(nb);
            }
        }
    }
}

/// Smaller groups of tiles a carriage can't leave are made Mountain rather than joined.
const POCKET_FILL: usize = 256;

/// Tiles a search for a way out of a pocket looks at, at most.
const POCKET_SEARCH: usize = 4_000_000;

/// Keeps the mainland joined for a carriage (`CONTEXT.md`: The land): each group of tiles a
/// carriage can't drive out of (shut in by Mountain, Lake or a border) gets a way of Hills cut
/// through the Mountain to the largest group, inside its own region and never on a tile beside
/// another region, so no new way across a border opens. A small group none can reach, apart from a
/// gap in a border, becomes Mountain.
pub(crate) fn join_for_carriages(map: &mut TerrainMap, cells: &[u8]) {
    let size = map.size;
    let n = map.tiles.len();
    let on = |tiles: &[u8], t: usize| cells[t] != NONE && drivable(tiles[t]);
    let mut label = vec![u32::MAX; n];
    let mut sizes: Vec<usize> = Vec::new();
    let mut stack = Vec::new();
    for start in 0..n {
        if label[start] != u32::MAX || !on(&map.tiles, start) {
            continue;
        }
        let g = sizes.len() as u32;
        label[start] = g;
        stack.push(start);
        let mut count = 0;
        while let Some(t) = stack.pop() {
            count += 1;
            for nb in neighbours(size, t) {
                if label[nb] == u32::MAX && on(&map.tiles, nb) {
                    label[nb] = g;
                    stack.push(nb);
                }
            }
        }
        sizes.push(count);
    }
    let Some(main) = (0..sizes.len()).max_by(|&a, &b| sizes[a].cmp(&sizes[b]).then(b.cmp(&a)))
    else {
        return;
    };
    let main = main as u32;
    // Each group's tiles, in tile order.
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); sizes.len()];
    for (t, &g) in label.iter().enumerate() {
        if g != u32::MAX && g != main {
            members[g as usize].push(t);
        }
    }
    let beside_other =
        |t: usize| neighbours(size, t).iter().any(|&nb| cells[nb] != NONE && cells[nb] != cells[t]);
    let mut pending: Vec<usize> = (0..sizes.len()).filter(|&g| g as u32 != main).collect();
    pending.sort_by(|&a, &b| sizes[b].cmp(&sizes[a]).then(a.cmp(&b)));
    // A group whose only way out leads through another not yet joined is tried again once that
    // one is.
    loop {
        let mut failed = Vec::new();
        let mut joined = false;
        for g in std::mem::take(&mut pending) {
            let group = &members[g];
            if group.iter().all(|&t| label[t] == main) {
                continue;
            }
            let at_a_gap = group.iter().any(|&t| beside_other(t));
            if group.len() < POCKET_FILL && !at_a_gap {
                for &t in group {
                    map.tiles[t] = Terrain::Mountain as u8;
                    label[t] = u32::MAX;
                }
                continue;
            }
            let Some(path) = way_out(map, cells, &label, main, group, &beside_other) else {
                failed.push(g);
                continue;
            };
            for t in path {
                if map.tiles[t] == Terrain::Mountain as u8 {
                    map.tiles[t] = Terrain::Hills as u8;
                }
                label[t] = main;
            }
            for &t in group {
                label[t] = main;
            }
            joined = true;
        }
        if failed.is_empty() || !joined {
            break;
        }
        pending = failed;
    }
}

/// The way out of `group` to the largest group (`main`): outwards through Mountain and other
/// groups, each step within its tile's region and onto no Mountain beside another region, as the
/// tiles from the group's edge to the first tile of `main`; none within `POCKET_SEARCH` tiles.
fn way_out(
    map: &TerrainMap,
    cells: &[u8],
    label: &[u32],
    main: u32,
    group: &[usize],
    beside_other: &dyn Fn(usize) -> bool,
) -> Option<Vec<usize>> {
    let mut parent: HashMap<usize, usize> = group.iter().map(|&t| (t, usize::MAX)).collect();
    let mut queue: VecDeque<usize> = group.iter().copied().collect();
    while let Some(t) = queue.pop_front() {
        if parent.len() > POCKET_SEARCH {
            return None;
        }
        for nb in neighbours(map.size, t) {
            if parent.contains_key(&nb) || cells[nb] != cells[t] {
                continue;
            }
            let tile = map.tiles[nb];
            if !(drivable(tile) || (tile == Terrain::Mountain as u8 && !beside_other(nb))) {
                continue;
            }
            parent.insert(nb, t);
            if label[nb] == main {
                let mut path = Vec::new();
                let mut at = t;
                while at != usize::MAX {
                    path.push(at);
                    at = parent[&at];
                }
                return Some(path);
            }
            queue.push_back(nb);
        }
    }
    None
}

/// A rule the regions of a generated map must keep, broken (`check_regions`, ADR 0004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegionProblem {
    pub rule: &'static str,
    pub message: String,
}

/// Checks the rules the regions of every generated map keep (ADR 0004): every land tile has a
/// region; there are `HEARTLAND_COUNT` heartlands and `FRONTIER_REGION_COUNT` frontier regions,
/// each with land; the mainland is joined for a carriage (a path that never needs Mountain); and
/// each way is at least `pass_width` tiles wide and never Mountain.
pub fn check_regions(map: &TerrainMap, regions: &Regions) -> Vec<RegionProblem> {
    let mut problems = Vec::new();
    let size = map.size as usize;
    let at = |t: usize| format!("({}, {})", t % size, t / size);
    let land = Land::of(map);
    if let Some(t) =
        (0..map.tiles.len()).find(|&t| land.group[t] != -1 && regions.id_of_tile(t).is_none())
    {
        problems.push(RegionProblem {
            rule: "region-everywhere",
            message: format!("land at {} has no region", at(t)),
        });
    }
    for (kind, wanted) in
        [(RegionKind::Heartland, HEARTLAND_COUNT), (RegionKind::Frontier, FRONTIER_REGION_COUNT)]
    {
        let with_land = regions.of_kind(kind).filter(|r| r.tiles > 0).count();
        if with_land != wanted as usize {
            problems.push(RegionProblem {
                rule: "region-counts",
                message: format!("{with_land} {kind:?} regions with land, not {wanted}"),
            });
        }
    }
    let mainland = |t: usize| {
        regions
            .id_of_tile(t)
            .is_some_and(|id| regions.regions[id as usize].kind != RegionKind::Island)
    };
    let groups = drive_groups(map, &mainland);
    if groups.len() > 1 {
        problems.push(RegionProblem {
            rule: "mainland-drivable",
            message: format!(
                "the mainland falls into {} groups for a carriage; one of {} tiles at {}",
                groups.len(),
                groups[1].1,
                at(groups[1].0)
            ),
        });
    }
    let narrowest = pass_width(map.size) as u32;
    for way in &regions.ways {
        if way.width < narrowest {
            problems.push(RegionProblem {
                rule: "way-width",
                message: format!(
                    "the way at ({}, {}) between {:?} is {} tiles wide",
                    way.x, way.y, way.between, way.width
                ),
            });
        }
    }
    problems
}

/// The groups a carriage drives between on the tiles `on` lets it (4 neighbours), each as its
/// first tile and size, largest first.
pub(crate) fn drive_groups(map: &TerrainMap, on: &dyn Fn(usize) -> bool) -> Vec<(usize, usize)> {
    let size = map.size;
    let mut seen = vec![false; map.tiles.len()];
    let mut out = Vec::new();
    let mut stack = Vec::new();
    for start in 0..map.tiles.len() {
        if seen[start] || !on(start) || !drivable(map.tiles[start]) {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let mut count = 0;
        while let Some(t) = stack.pop() {
            count += 1;
            for nb in neighbours(size, t) {
                if !seen[nb] && on(nb) && drivable(map.tiles[nb]) {
                    seen[nb] = true;
                    stack.push(nb);
                }
            }
        }
        out.push((start, count));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}

#[cfg(test)]
#[path = "regions_tests.rs"]
mod tests;
