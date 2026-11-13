//! Path finding across the map (`CONTEXT.md`: Step, Road, Walls in combat), ported from
//! `apps/server/src/pathfinding.ts` so residents and carriages find the same paths, not just paths
//! of the same cost (ADR 0030).
//!
//! What keeps a path the same path as the TypeScript's:
//! - `MinHeap` is the same binary heap with the same sift rules (`<=` stops a push, the right
//!   child only wins when strictly lower, `>=` stops a pop), so equal priorities leave it in the
//!   same order.
//! - The eight neighbours are visited in the same order: E, W, S, N, SE, SW, NE, NW.
//! - Costs so far are kept in `f32` and rounded like `Math.fround(g + step)`; priorities and the
//!   detour limit are `f64` sums in the same order, and `cheapest` is the same minimum.
//! - No result depends on a map's iteration order. `WallMap::tiles` and `inside` are only asked
//!   whether they hold a tile; the region fill, `shut_in` and `stranded_on_wall` are reachability
//!   checks whose answer is the same in any order; the results map is only looked up by id.
//! - `advance` reads its clock exactly where the TypeScript reads `now()`, so with the same clock
//!   a request answers `searching` on the same ticks.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, LazyLock};
use std::time::Instant;

use csp_shared::balance::{
    TerrainTable, CARRIAGE_SPEED, PATH_DETOUR_LIMIT, PATH_DETOUR_SLACK, TERRAIN_SPEED,
    WALL_ENCLOSES_MAX,
};
use csp_shared::terrain::{
    is_passable_terrain, tile_index, wrap, wrap_delta, Terrain, TerrainMap, DIAGONAL_STEP,
};

use crate::walls::{may_step, stranded_on_wall, WallMap};

/// What crossing one tile of each terrain costs, in plains-tiles, by terrain byte; infinity can't
/// be entered. A tile with a road costs `Terrain::Road`'s, whatever the terrain beneath.
#[derive(Debug, Clone, PartialEq)]
pub struct TerrainCosts(pub [f64; 256]);

impl TerrainCosts {
    /// From a speed per terrain: the inverse of each speed, infinity where there is none.
    pub fn from_speeds(speeds: TerrainTable) -> TerrainCosts {
        let mut costs = [f64::INFINITY; 256];
        for (t, cost) in costs.iter_mut().enumerate() {
            match speeds.get(t as u8) {
                Some(speed) if speed != 0.0 && !speed.is_nan() => *cost = 1.0 / speed,
                _ => {}
            }
        }
        TerrainCosts(costs)
    }

    /// What one tile of terrain byte `t` costs.
    pub fn get(&self, t: u8) -> f64 {
        self.0[t as usize]
    }
}

/// Costs for someone on foot: the inverse of each terrain's speed. Lake and Sea are impassable.
pub static WALKING_COSTS: LazyLock<TerrainCosts> =
    LazyLock::new(|| TerrainCosts::from_speeds(TERRAIN_SPEED));

/// Costs for a carriage, from its speed on each terrain (`CONTEXT.md`: Carriage): cheap on plains,
/// dear in forest and hills; lakes, sea and mountains can't be entered, mountains except on a road.
pub static CARRIAGE_COSTS: LazyLock<TerrainCosts> =
    LazyLock::new(|| TerrainCosts::from_speeds(CARRIAGE_SPEED));

/// Costs for a boat (`CONTEXT.md`: Rowing): Lake and Sea alike, and no land at all. A diagonal
/// step goes only where both straight tiles beside it are water too, so it never squeezes between
/// two land tiles.
pub static WATER_COSTS: LazyLock<TerrainCosts> = LazyLock::new(|| {
    let mut costs = [f64::INFINITY; 256];
    costs[Terrain::Lake as usize] = 1.0;
    costs[Terrain::Sea as usize] = 1.0;
    TerrainCosts(costs)
});

/// Costs for a ship (`CONTEXT.md`: Sailing): Sea only, never Lake and no land at all; diagonal
/// steps as for a boat.
pub static SEA_COSTS: LazyLock<TerrainCosts> = LazyLock::new(|| {
    let mut costs = [f64::INFINITY; 256];
    costs[Terrain::Sea as usize] = 1.0;
    TerrainCosts(costs)
});

/// Side of the window that short paths are searched in (`PathFinder`), in tiles. A path whose ends
/// lie within a quarter of it along each direction counts as short.
pub const LOCAL_SIDE: i32 = 1024;

/// A tile on the map, (x, y).
pub type Point = (i32, i32);

/// How a path request stands: still searching, a path found, or no path at all.
#[derive(Debug, Clone, PartialEq)]
pub enum PathResult {
    Searching,
    Found { path: Vec<Point>, cost: f64 },
    Unreachable,
}

impl PathResult {
    /// `searching`, `found` or `unreachable`, as the TypeScript's `status`.
    pub fn status(&self) -> &'static str {
        match self {
            PathResult::Searching => "searching",
            PathResult::Found { .. } => "found",
            PathResult::Unreachable => "unreachable",
        }
    }
}

/// Who is going, for the walls and gates on the way (`may_step`), and where to stop.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PathOptions {
    /// The side of the one going (`wallSide`): their realm, or their NPC city. They may pass their
    /// own gates and stand on their own walls.
    pub realm_id: Option<String>,
    /// On foot, so they may go onto their own walls; a carriage never does.
    pub on_walls: bool,
    /// Stop on any tile in contact with the goal (`inContact`) rather than on it: to attack.
    pub near: bool,
    /// Stop on the first of these tiles (tile indices) rather than at the goal, which then only
    /// says which way to go: to the edge of a city's area, whatever stands inside it.
    pub area: Option<HashSet<usize>>,
}

/// A request waiting for or under search, with what `check` worked out for it.
#[derive(Debug, Clone)]
struct Request {
    options: PathOptions,
    id: String,
    from: Point,
    to: Point,
    /// Which of the finder's cost tables (`PathFinder::tables`) it goes by.
    table: usize,
    /// The cheapest a step can cost, for the heuristic.
    cheapest: f64,
    /// The start's tile index.
    start: usize,
    /// Whether the search starts stuck on a wall (`stranded_on_wall`).
    stranded: bool,
    /// Whether the quick checks before any search (`check`) have run.
    checked: bool,
}

/// `Ground::flags` bits.
const ROAD: u8 = 1;
const WALL: u8 = 2;

/// What the searches step across: the terrain, its roads, and the walls and gates on it.
struct Ground {
    size: i32,
    terrain: Arc<TerrainMap>,
    /// Per tile: `ROAD` where a finished road is, `WALL` where a wall or gate stands.
    flags: Vec<u8>,
    walls: Option<Arc<WallMap>>,
    road_list: Vec<usize>,
    wall_list: Vec<usize>,
}

impl Ground {
    fn new(terrain: Arc<TerrainMap>) -> Ground {
        let n = (terrain.size * terrain.size) as usize;
        Ground {
            size: terrain.size,
            terrain,
            flags: vec![0; n],
            walls: None,
            road_list: Vec::new(),
            wall_list: Vec::new(),
        }
    }

    fn set_roads(&mut self, roads: impl IntoIterator<Item = usize>) {
        for &t in &self.road_list {
            self.flags[t] &= !ROAD;
        }
        self.road_list = roads.into_iter().collect();
        for &t in &self.road_list {
            self.flags[t] |= ROAD;
        }
    }

    fn has_roads(&self) -> bool {
        !self.road_list.is_empty()
    }

    fn set_walls(&mut self, walls: Option<Arc<WallMap>>) {
        match (&walls, &self.walls) {
            (None, None) => return,
            (Some(a), Some(b)) if Arc::ptr_eq(a, b) => return,
            _ => {}
        }
        for &t in &self.wall_list {
            self.flags[t] &= !WALL;
        }
        self.wall_list =
            walls.as_ref().map(|w| w.tiles.keys().copied().collect()).unwrap_or_default();
        for &t in &self.wall_list {
            self.flags[t] |= WALL;
        }
        self.walls = walls;
    }

    /// What is underfoot on tile index `t`: a road, or the terrain.
    #[inline]
    fn at(&self, t: usize) -> u8 {
        if self.flags[t] & ROAD != 0 {
            Terrain::Road as u8
        } else {
            self.terrain.tiles[t]
        }
    }

    /// Whether the request may step from tile index `t` to the next tile `nt`, walls and gates
    /// aside.
    #[inline]
    fn may_step(&self, req: &Request, t: usize, nt: usize) -> bool {
        let Some(walls) = &self.walls else {
            return true;
        };
        if (self.flags[t] | self.flags[nt]) & WALL == 0 {
            return true;
        }
        let stranded = req.stranded && t == req.start;
        may_step(walls, req.options.realm_id.as_deref(), t, nt, req.options.on_walls, stranded)
    }
}

/// A region label for land that falls into too many small regions to label each.
const MANY: u16 = 0xffff;

/// A set of costs the finder has seen, with its region labels once worked out (`regions_of`).
struct CostTable {
    costs: TerrainCosts,
    regions: Option<Vec<u16>>,
}

/// Labels each tile with the stretch of land it lies in for a traveller with these costs: tiles
/// with the same label reach each other, walls and gates aside, tiles with different ones never.
/// 0 can't be entered. Where these costs let a road be crossed, any passable land counts as
/// entered, road or not yet: a road on Mountain joins a carriage's stretches, and roads come and
/// go (`CONTEXT.md`: Road). Diagonal steps don't join stretches, as they never cut a corner. The
/// terrain never changes, so the labels are worked out once per map and set of costs.
fn regions_of(terrain: &TerrainMap, table: &TerrainCosts) -> Vec<u16> {
    let size = terrain.size as usize;
    let tiles = &terrain.tiles;
    let n = size * size;
    let road = table.get(Terrain::Road as u8) < f64::INFINITY;
    let passable = |t: usize| {
        let terrain = tiles[t];
        table.get(terrain) < f64::INFINITY || (road && is_passable_terrain(terrain))
    };
    let mut labels = vec![0u16; n];
    let mut stack: Vec<usize> = Vec::with_capacity(1024);
    let mut next: u16 = 1;
    for s in 0..n {
        if labels[s] != 0 || !passable(s) {
            continue;
        }
        let label = if next < MANY {
            next += 1;
            next - 1
        } else {
            MANY
        };
        labels[s] = label;
        stack.push(s);
        while let Some(t) = stack.pop() {
            let x = t % size;
            let row = t - x;
            let ns = [
                row + if x + 1 == size { 0 } else { x + 1 },
                row + if x == 0 { size - 1 } else { x - 1 },
                (t + size) % n,
                (t + n - size) % n,
            ];
            for nt in ns {
                if labels[nt] != 0 || !passable(nt) {
                    continue;
                }
                labels[nt] = label;
                stack.push(nt);
            }
        }
    }
    labels
}

/// How far the goal is in straight steps, the short way round the map, going diagonally as far as
/// that helps (a diagonal step counting `DIAGONAL_STEP`); for a `near` request, to the nearest tile
/// in contact with it.
#[inline]
fn steps_to(req: &Request, size: i32, x: i32, y: i32) -> f64 {
    let mut dx = wrap_delta(x, req.to.0, size).abs();
    let mut dy = wrap_delta(y, req.to.1, size).abs();
    if req.options.near {
        dx = (dx - 1).max(0);
        dy = (dy - 1).max(0);
    }
    let (dx, dy) = (f64::from(dx), f64::from(dy));
    if dx > dy {
        dx + (DIAGONAL_STEP - 1.0) * dy
    } else {
        dy + (DIAGONAL_STEP - 1.0) * dx
    }
}

/// Whether a search may stop on (x, y): the goal, for a `near` request beside it, or its `area`.
#[inline]
fn reached(req: &Request, size: i32, x: i32, y: i32) -> bool {
    if let Some(area) = &req.options.area {
        return area.contains(&tile_index(size, x, y));
    }
    if !req.options.near {
        return x == req.to.0 && y == req.to.1;
    }
    wrap_delta(x, req.to.0, size).abs() <= 1 && wrap_delta(y, req.to.1, size).abs() <= 1
}

/// `Math.round` of JavaScript: halves round up, towards +∞.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// One A* search at a time over a square window of the map, the whole map or a smaller one, kept
/// in arrays the size of the window and reused from search to search. Tiles outside the window
/// can't be entered. A search gives up once every way left would cost more than
/// `PATH_DETOUR_LIMIT` allows.
struct Search {
    side: i32,
    /// Whether the window is the whole map, so its sides join.
    full: bool,
    /// Cost so far to each tile, in single precision, as the TypeScript's `Float32Array`.
    g: Vec<f32>,
    came_from: Vec<i32>,
    /// `2 * search` on tiles this search has reached, one more once they are closed.
    stamp: Vec<u32>,
    search: u32,
    heap: MinHeap,
    /// The window's north-west corner on the map.
    x0: i32,
    y0: i32,
    limit: f64,
    /// Whether the search came up against a side of its window, so a way may lie beyond it.
    clipped: bool,
}

impl Search {
    fn new(map_size: i32, side: i32) -> Search {
        let n = (side * side) as usize;
        Search {
            side,
            full: side == map_size,
            g: vec![0.0; n],
            came_from: vec![0; n],
            stamp: vec![0; n],
            search: 0,
            heap: MinHeap::default(),
            x0: 0,
            y0: 0,
            limit: f64::INFINITY,
            clipped: false,
        }
    }

    /// Starts on a checked request, with the window centred between its ends.
    fn begin(&mut self, req: &Request, size: i32, table: &TerrainCosts) {
        let (fx, fy) = req.from;
        let (tx, ty) = req.to;
        let half = self.side / 2;
        let centre = |f: i32, t: i32| js_round(f64::from(wrap_delta(f, t, size)) / 2.0) as i32;
        self.x0 = if self.full { 0 } else { wrap(fx + centre(fx, tx) - half, size) };
        self.y0 = if self.full { 0 } else { wrap(fy + centre(fy, ty) - half, size) };
        if self.search >= u32::MAX / 2 - 1 {
            // Stamps would run out: start them over, as a fresh array would.
            self.stamp.fill(0);
            self.search = 0;
        }
        self.search += 1;
        self.heap.clear();
        self.clipped = false;
        let l = (wrap(fy - self.y0, size) * self.side + wrap(fx - self.x0, size)) as usize;
        self.stamp[l] = 2 * self.search;
        self.g[l] = 0.0;
        self.came_from[l] = -1;
        let best = steps_to(req, size, fx, fy) * req.cheapest;
        self.limit =
            PATH_DETOUR_LIMIT * best + PATH_DETOUR_SLACK * table.get(Terrain::Plains as u8);
        self.heap.push(l as i32, best);
    }

    /// Expands up to `count` tiles; returns the result once the search ends.
    fn expand(
        &mut self,
        req: &Request,
        ground: &Ground,
        table: &TerrainCosts,
        count: usize,
    ) -> Option<PathResult> {
        let size = ground.size;
        let side = self.side;
        let closed = 2 * self.search + 1;
        for _ in 0..count {
            if self.heap.top() > self.limit {
                return Some(PathResult::Unreachable);
            }
            let Some(l) = self.heap.pop() else {
                return Some(PathResult::Unreachable);
            };
            let l = l as usize;
            if self.stamp[l] == closed {
                continue;
            }
            self.stamp[l] = closed;
            let lx = l as i32 % side;
            let ly = (l as i32 - lx) / side;
            let x = if self.x0 + lx < size { self.x0 + lx } else { self.x0 + lx - size };
            let y = if self.y0 + ly < size { self.y0 + ly } else { self.y0 + ly - size };
            if reached(req, size, x, y) {
                return Some(PathResult::Found {
                    path: self.path_to(l, size),
                    cost: f64::from(self.g[l]),
                });
            }
            let t = (y * size + x) as usize;
            // Past a side of the map, the step continues on the opposite side.
            let e = if x + 1 == size { 0 } else { x + 1 };
            let w = if x == 0 { size - 1 } else { x - 1 };
            let s = if y + 1 == size { 0 } else { y + 1 };
            let n = if y == 0 { size - 1 } else { y - 1 };
            self.visit(req, ground, table, t, l, e, y, lx + 1, ly, false);
            self.visit(req, ground, table, t, l, w, y, lx - 1, ly, false);
            self.visit(req, ground, table, t, l, x, s, lx, ly + 1, false);
            self.visit(req, ground, table, t, l, x, n, lx, ly - 1, false);
            self.visit(req, ground, table, t, l, e, s, lx + 1, ly + 1, true);
            self.visit(req, ground, table, t, l, w, s, lx - 1, ly + 1, true);
            self.visit(req, ground, table, t, l, e, n, lx + 1, ly - 1, true);
            self.visit(req, ground, table, t, l, w, n, lx - 1, ly - 1, true);
        }
        None
    }

    /// Considers the step from tile `t` (window tile `l`) to (nx, ny), window tile (nlx, nly). A
    /// `diagonal` step costs `DIAGONAL_STEP` times as much, and only goes where both straight
    /// tiles beside it could be stepped onto too (`CONTEXT.md`: Step).
    #[allow(clippy::too_many_arguments)]
    #[inline]
    fn visit(
        &mut self,
        req: &Request,
        ground: &Ground,
        table: &TerrainCosts,
        t: usize,
        l: usize,
        nx: i32,
        ny: i32,
        mut nlx: i32,
        mut nly: i32,
        diagonal: bool,
    ) {
        let side = self.side;
        if nlx < 0 || nlx >= side || nly < 0 || nly >= side {
            if !self.full {
                self.clipped = true;
                return;
            }
            nlx = nx;
            nly = ny;
        }
        let size = ground.size;
        let nt = (ny * size + nx) as usize;
        let mut step = table.get(ground.at(nt));
        if step == f64::INFINITY {
            return;
        }
        let nl = (nly * side + nlx) as usize;
        let stamp = self.stamp[nl];
        if stamp == 2 * self.search + 1 {
            return;
        }
        if !ground.may_step(req, t, nt) {
            return;
        }
        if diagonal {
            let tx = t % size as usize;
            let a = t - tx + nx as usize;
            let b = nt - nx as usize + tx;
            if table.get(ground.at(a)) == f64::INFINITY || table.get(ground.at(b)) == f64::INFINITY
            {
                return;
            }
            if !ground.may_step(req, t, a) || !ground.may_step(req, t, b) {
                return;
            }
            step *= DIAGONAL_STEP;
        }
        // `Math.fround(g[l] + step)`: the sum in f64, rounded to the nearest f32.
        let g = (f64::from(self.g[l]) + step) as f32;
        if stamp == 2 * self.search && g >= self.g[nl] {
            return;
        }
        self.stamp[nl] = 2 * self.search;
        self.g[nl] = g;
        self.came_from[nl] = l as i32;
        self.heap.push(nl as i32, f64::from(g) + steps_to(req, size, nx, ny) * req.cheapest);
    }

    fn path_to(&self, goal: usize, size: i32) -> Vec<Point> {
        let side = self.side as usize;
        let mut path = Vec::new();
        let mut l = goal;
        while self.came_from[l] != -1 {
            path.push(((self.x0 + (l % side) as i32) % size, (self.y0 + (l / side) as i32) % size));
            l = self.came_from[l] as usize;
        }
        path.reverse();
        path
    }
}

/// Requests waiting for one `Search`, and the one it is working on.
struct Lane {
    search: Search,
    queue: VecDeque<Request>,
    current: Option<Request>,
}

/// The id `find_path` searches under.
const NOW_ID: &str = "\0now";

/// Finds paths across the map with A*, a little at a time (T4.1): `advance` works through the
/// waiting requests until its time budget for this tick runs out and carries on next tick, so a
/// path across the whole map never stalls the tick. Moves go to the eight tiles around, across
/// the map's joins too; a diagonal one costs `DIAGONAL_STEP` times as much and never cuts a corner
/// (`CONTEXT.md`: Step). Tiles with a finished road (`set_roads`) cost a road's step, so paths
/// prefer roads (`CONTEXT.md`: Road). Walls and gates (`set_walls`) block the way as `may_step`
/// says, for the realm a request names (`CONTEXT.md`: Walls in combat).
///
/// Short paths go in their own lane, searched in a `LOCAL_SIDE` window, so a long search under
/// way never holds them up; one that finds no way within its window tries the whole map. A goal
/// on land the start can't reach (`regions_of`), or shut in by walls the one going can't pass, is
/// unreachable before any search.
///
/// The search state is scratch memory, not world state; requests lost on a restart are simply
/// asked for again.
pub struct PathFinder {
    ground: Ground,
    /// The lanes: one when the local window is the whole map, else the local one and the global.
    lanes: Vec<Lane>,
    local: usize,
    global: usize,
    /// Every set of costs requested so far, with its region labels; `Request::table` indexes it.
    tables: Vec<CostTable>,
    results: HashMap<String, PathResult>,
    /// The clock `advance` reads when given none.
    epoch: Instant,
}

impl PathFinder {
    /// A finder with the usual `LOCAL_SIDE` window for short paths.
    pub fn new(terrain: Arc<TerrainMap>) -> PathFinder {
        PathFinder::with_local_side(terrain, LOCAL_SIDE)
    }

    /// A finder whose short paths are searched in a window `local_side` tiles across.
    pub fn with_local_side(terrain: Arc<TerrainMap>, local_side: i32) -> PathFinder {
        let size = terrain.size;
        let mut lanes =
            vec![Lane { search: Search::new(size, size), queue: VecDeque::new(), current: None }];
        let local = if local_side < size {
            lanes.push(Lane {
                search: Search::new(size, local_side),
                queue: VecDeque::new(),
                current: None,
            });
            1
        } else {
            0
        };
        let mut finder = PathFinder {
            ground: Ground::new(terrain),
            lanes,
            local,
            global: 0,
            tables: Vec::new(),
            results: HashMap::new(),
            epoch: Instant::now(),
        };
        // Labelled up front for the usual travellers, so no tick waits on it.
        for costs in [&*WALKING_COSTS, &*CARRIAGE_COSTS, &*WATER_COSTS] {
            let i = finder.table_of(costs);
            finder.regions(i);
        }
        finder
    }

    /// The index of these costs in `tables`, adding them when new.
    fn table_of(&mut self, costs: &TerrainCosts) -> usize {
        if let Some(i) = self.tables.iter().position(|t| t.costs == *costs) {
            return i;
        }
        self.tables.push(CostTable { costs: costs.clone(), regions: None });
        self.tables.len() - 1
    }

    /// The region labels for the costs `tables[i]`, worked out the first time they are asked for.
    fn regions(&mut self, i: usize) -> &[u16] {
        let terrain = &self.ground.terrain;
        let table = &mut self.tables[i];
        table.regions.get_or_insert_with(|| regions_of(terrain, &table.costs))
    }

    /// The tiles with a finished road, as tile indices (`roadTiles`). Searches use them from the
    /// next step they take; one under way keeps its heuristic.
    pub fn set_roads(&mut self, roads: impl IntoIterator<Item = usize>) {
        self.ground.set_roads(roads);
    }

    /// The walls and gates on the map (`wallMap`); searches use them from the next step they take.
    pub fn set_walls(&mut self, walls: Option<Arc<WallMap>>) {
        self.ground.set_walls(walls);
    }

    /// Asks for a path from one tile to another; replaces an earlier request with the same id.
    pub fn request(
        &mut self,
        id: &str,
        from: Point,
        to: Point,
        costs: &TerrainCosts,
        options: PathOptions,
    ) {
        self.cancel(id);
        let size = self.ground.size;
        let reach = f64::from(self.lanes[self.local].search.side) / 4.0;
        let short = f64::from(wrap_delta(from.0, to.0, size).abs()) <= reach
            && f64::from(wrap_delta(from.1, to.1, size).abs()) <= reach;
        let table = self.table_of(costs);
        let lane = if short { self.local } else { self.global };
        self.lanes[lane].queue.push_back(Request {
            options,
            id: id.to_string(),
            from,
            to,
            table,
            cheapest: f64::INFINITY,
            start: 0,
            stranded: false,
            checked: false,
        });
        self.results.insert(id.to_string(), PathResult::Searching);
    }

    /// Forgets a request and its result.
    pub fn cancel(&mut self, id: &str) {
        for lane in &mut self.lanes {
            lane.queue.retain(|r| r.id != id);
            if lane.current.as_ref().is_some_and(|r| r.id == id) {
                lane.current = None;
            }
        }
        self.results.remove(id);
    }

    /// The request's result so far; a found or unreachable result is handed out once.
    pub fn result(&mut self, id: &str) -> Option<PathResult> {
        match self.results.get(id) {
            Some(PathResult::Searching) => Some(PathResult::Searching),
            Some(_) => self.results.remove(id),
            None => None,
        }
    }

    /// How many requests are still being searched.
    pub fn pending(&self) -> usize {
        self.lanes.iter().map(|l| l.queue.len() + usize::from(l.current.is_some())).sum()
    }

    /// Works on waiting requests for `budget_ms` of wall-clock time.
    pub fn advance(&mut self, budget_ms: f64) {
        let epoch = self.epoch;
        let mut now = move || epoch.elapsed().as_secs_f64() * 1000.0;
        self.advance_with(budget_ms, &mut now);
    }

    /// Works on waiting requests until `budget_ms` has passed on `now` (milliseconds): short ones
    /// first, but while long ones wait, they get at least half the budget.
    pub fn advance_with(&mut self, budget_ms: f64, now: &mut dyn FnMut() -> f64) {
        let deadline = now() + budget_ms;
        if self.local != self.global {
            let global = &self.lanes[self.global];
            let long_waiting = global.current.is_some() || !global.queue.is_empty();
            let until = if long_waiting { now() + budget_ms / 2.0 } else { deadline };
            self.work(self.local, until, now);
        }
        self.work(self.global, deadline, now);
        if self.local != self.global {
            self.work(self.local, deadline, now);
        }
    }

    /// Searches to the end in one go, for tests and short paths.
    pub fn find_path(
        &mut self,
        from: Point,
        to: Point,
        costs: &TerrainCosts,
        options: PathOptions,
    ) -> PathResult {
        self.request(NOW_ID, from, to, costs, options);
        while self.results.get(NOW_ID) == Some(&PathResult::Searching) {
            self.advance(f64::INFINITY);
        }
        self.result(NOW_ID).expect("find_path's request has a result")
    }

    /// Works through one lane's requests until `deadline`.
    fn work(&mut self, lane: usize, deadline: f64, now: &mut dyn FnMut() -> f64) {
        while now() < deadline {
            if self.lanes[lane].current.is_none() {
                let Some(mut next) = self.lanes[lane].queue.pop_front() else {
                    return;
                };
                if !next.checked {
                    next.checked = true;
                    if let Some(settled) = self.check(&mut next) {
                        self.results.insert(next.id, settled);
                        continue;
                    }
                }
                let table = &self.tables[next.table].costs;
                self.lanes[lane].search.begin(&next, self.ground.size, table);
                self.lanes[lane].current = Some(next);
            }
            let l = &mut self.lanes[lane];
            let req = l.current.as_ref().expect("a current request");
            let table = &self.tables[req.table].costs;
            let Some(done) = l.search.expand(req, &self.ground, table, 1024) else {
                continue;
            };
            let clipped = l.search.clipped;
            let req = l.current.take().expect("a current request");
            // No way within the window; there may be one round outside it.
            if done == PathResult::Unreachable && clipped {
                self.lanes[self.global].queue.push_back(req);
            } else {
                self.results.insert(req.id, done);
            }
        }
    }

    /// Readies a request for its search, and settles it at once if it needs none: already there,
    /// or the goal can't be entered, lies on land the start can't reach, or is shut in.
    fn check(&mut self, req: &mut Request) -> Option<PathResult> {
        let size = self.ground.size;
        req.from = (wrap(req.from.0, size), wrap(req.from.1, size));
        req.to = (wrap(req.to.0, size), wrap(req.to.1, size));
        let s = tile_index(size, req.from.0, req.from.1);
        let goal = tile_index(size, req.to.0, req.to.1);
        req.start = s;
        let to_goal = !req.options.near && req.options.area.is_none();
        {
            let table = &self.tables[req.table].costs;
            let ground = &self.ground;
            if table.get(ground.at(s)) == f64::INFINITY
                || (to_goal && table.get(ground.at(goal)) == f64::INFINITY)
            {
                return Some(PathResult::Unreachable);
            }
        }
        if reached(req, size, req.from.0, req.from.1) {
            return Some(PathResult::Found { path: Vec::new(), cost: 0.0 });
        }
        let regions = self.regions(req.table);
        let region = regions[s];
        if region != MANY {
            let elsewhere = |t: usize| regions[t] != region && regions[t] != MANY;
            let mut all_elsewhere = match &req.options.area {
                Some(area) => area.iter().all(|&t| elsewhere(t)),
                None => elsewhere(goal),
            };
            if req.options.near && all_elsewhere {
                'ring: for dy in -1..=1 {
                    for dx in -1..=1 {
                        if !elsewhere(tile_index(size, req.to.0 + dx, req.to.1 + dy)) {
                            all_elsewhere = false;
                            break 'ring;
                        }
                    }
                }
            }
            if all_elsewhere {
                return Some(PathResult::Unreachable);
            }
        }
        let ground = &self.ground;
        req.stranded = ground
            .walls
            .as_ref()
            .is_some_and(|w| stranded_on_wall(w, req.options.realm_id.as_deref(), s));
        if to_goal
            && ground.walls.as_ref().is_some_and(|w| w.inside.contains(&goal))
            && self.shut_in(req, goal)
        {
            return Some(PathResult::Unreachable);
        }
        // A road is the cheapest ground, but only counts while there are any: the heuristic stays
        // as sharp as it can, so searches stay short.
        let table = &self.tables[req.table].costs;
        let mut cheapest = f64::INFINITY;
        for t in 0..256usize {
            if t != Terrain::Road as usize || self.ground.has_roads() {
                cheapest = cheapest.min(table.0[t]);
            }
        }
        req.cheapest = cheapest;
        None
    }

    /// Whether the goal, inside a ring of walls, can't be reached from the start: going back from
    /// it, every way ends at walls or gates the one going can't pass. Gives up (false) once it is
    /// out of the ring, or past the most a ring can shut in. Going straight is enough: a diagonal
    /// step never cuts a corner, so it never gets out where straight ones can't.
    fn shut_in(&self, req: &Request, goal: usize) -> bool {
        let ground = &self.ground;
        let walls = ground.walls.as_ref().expect("walls to be shut in by");
        let table = &self.tables[req.table].costs;
        let size = ground.size as usize;
        let n = size * size;
        let mut seen = rustc_hash::FxHashSet::from_iter([goal]);
        let mut todo = vec![goal];
        while let Some(t) = todo.pop() {
            let x = t % size;
            let row = t - x;
            let ns = [
                row + if x + 1 == size { 0 } else { x + 1 },
                row + if x == 0 { size - 1 } else { x - 1 },
                (t + size) % n,
                (t + n - size) % n,
            ];
            for p in ns {
                if seen.contains(&p) || table.get(ground.at(p)) == f64::INFINITY {
                    continue;
                }
                if !ground.may_step(req, p, t) {
                    continue;
                }
                if p == req.start || (!walls.inside.contains(&p) && !walls.tiles.contains_key(&p)) {
                    return false;
                }
                seen.insert(p);
                if seen.len() as f64 > WALL_ENCLOSES_MAX {
                    return false;
                }
                todo.push(p);
            }
        }
        true
    }
}

/// A binary min-heap of tile indices by priority, in growable arrays reused across searches.
#[derive(Default)]
struct MinHeap {
    items: Vec<i32>,
    prio: Vec<f64>,
    size: usize,
}

impl MinHeap {
    fn clear(&mut self) {
        self.size = 0;
    }

    /// The lowest priority waiting; infinity when empty.
    #[inline]
    fn top(&self) -> f64 {
        if self.size > 0 {
            self.prio[0]
        } else {
            f64::INFINITY
        }
    }

    fn push(&mut self, item: i32, priority: f64) {
        if self.size == self.items.len() {
            let grown = (self.items.len() * 2).max(1024);
            self.items.resize(grown, 0);
            self.prio.resize(grown, 0.0);
        }
        let mut i = self.size;
        self.size += 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.prio[parent] <= priority {
                break;
            }
            self.items[i] = self.items[parent];
            self.prio[i] = self.prio[parent];
            i = parent;
        }
        self.items[i] = item;
        self.prio[i] = priority;
    }

    fn pop(&mut self) -> Option<i32> {
        if self.size == 0 {
            return None;
        }
        let top = self.items[0];
        self.size -= 1;
        let last_item = self.items[self.size];
        let last_prio = self.prio[self.size];
        let mut i = 0;
        loop {
            let mut child = 2 * i + 1;
            if child >= self.size {
                break;
            }
            if child + 1 < self.size && self.prio[child + 1] < self.prio[child] {
                child += 1;
            }
            if self.prio[child] >= last_prio {
                break;
            }
            self.items[i] = self.items[child];
            self.prio[i] = self.prio[child];
            i = child;
        }
        self.items[i] = last_item;
        self.prio[i] = last_prio;
        Some(top)
    }
}

#[cfg(test)]
mod tests;
