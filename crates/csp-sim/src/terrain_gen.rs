//! Terrain generation (`CONTEXT.md`: Map, Terrain, The land): the same seed gives the same map,
//! byte for byte. One mainland in the middle of the map, islands off its coast and Sea all round
//! (ADR 0035, T100.1); lakes, relief and forest as the frozen `apps/server/src/terrain-gen.ts`
//! made them (ADR 0030), whose noise and float rules this keeps.
//!
//! Float parity with the TypeScript, kept for the stages ported from it:
//! - Every number of the TypeScript is an `f64` here, every `Float32Array` element an `f32`
//!   (the noise fields, the sea score, the relief and the values the cuts are taken from). Values
//!   are worked out in `f64` and rounded to `f32` on the store, as a typed array does.
//! - Operations keep the TypeScript's order: a different association moves a value across a cut.
//! - `Math.hypot` is V8's (scaled by the larger value, Kahan-summed), see [`js_hypot`].
//! - `quantile` gives the value at place `k` of the sorted values. Which algorithm finds it does
//!   not change the value, so this one uses the standard library's selection, on one copy.
//!
//! Speed: the full map has 33 million tiles. Buffers are reused from stage to stage, the lakes'
//! distance from the sea is a breadth-first search that stops at the margin, and the stages report
//! their time to a [`StageTimer`] with the names `scripts/bench-ts.mts` uses.

use std::time::{Duration, Instant};

use csp_shared::balance::{
    HEARTLAND_TERRAIN, ISLAND_COUNT, ISLAND_OFFSHORE_SHARE, ISLAND_RADIUS, ISLAND_RELIEF,
    JOIN_SEA_SHARE, MAINLAND_SHARE, MAINLAND_STRETCH, MAP_SIZE, NARROWEST_STRAIT, TERRAIN_SHARES,
};
use csp_shared::terrain::{is_passable_terrain, is_water, Terrain, TerrainMap};

use crate::land::{fits_a_haven, near_the_mainland, Land};
use crate::random::hash;
use crate::regions::{join_for_carriages, raise_borders, Layout, RegionKind, NONE};

/// Told how long each stage of generation took (`StageTimer` of `terrain-gen.ts`): the stage's
/// name and its time. `generate_terrain` names `mainland`, `lakes`, `islands`, `relief`, `forest`,
/// `joining`, `regions`;
/// world generation times `nodes` with [`timed`].
pub type StageTimer<'a> = dyn FnMut(&'static str, Duration) + 'a;

/// Runs one stage and tells `timer` how long it took.
pub fn timed<T>(timer: &mut StageTimer<'_>, stage: &'static str, run: impl FnOnce() -> T) -> T {
    let from = Instant::now();
    let out = run();
    timer(stage, from.elapsed());
    out
}

/// A timer that ignores every stage (`untimed`).
pub fn untimed(_stage: &'static str, _took: Duration) {}

/// `wrap` of `packages/shared/src/terrain.ts` on JavaScript numbers: `((v % size) + size) % size`.
#[inline]
fn wrap_f(v: f64, size: f64) -> f64 {
    ((v % size) + size) % size
}

/// `Math.hypot(a, b)` as V8 computes it (`MathHypot` in `builtins/math.tq`): both values scaled
/// by the larger, their squares Kahan-summed, then `sqrt(sum) * max`. Not the same rounding as
/// `f64::hypot`, and the frozen city layouts depend on the last bit.
#[inline]
pub(crate) fn js_hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    if a.is_nan() || b.is_nan() {
        return if a == f64::INFINITY || b == f64::INFINITY { f64::INFINITY } else { f64::NAN };
    }
    let mut max = 0.0;
    if a > max {
        max = a;
    }
    if b > max {
        max = b;
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Math.round` for the positive numbers it gets here: halves go up.
#[inline]
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// Smooth value noise in [0, 1) on a lattice of `cells` Ã— `cells` points spread over the map
/// (`valueNoise`). The lattice repeats every `cells` points, so the noise joins seamlessly where
/// the map's sides do.
#[inline]
fn value_noise(x: f64, y: f64, size: f64, cells: f64, seed: f64) -> f64 {
    let fx = (x / size) * cells;
    let fy = (y / size) * cells;
    let ix = fx.floor();
    let iy = fy.floor();
    let tx = fx - ix;
    let ty = fy - iy;
    let sx = tx * tx * (3.0 - 2.0 * tx);
    let sy = ty * ty * (3.0 - 2.0 * ty);
    let x0 = wrap_f(ix, cells);
    let y0 = wrap_f(iy, cells);
    let x1 = wrap_f(ix + 1.0, cells);
    let y1 = wrap_f(iy + 1.0, cells);
    let a = hash(x0, y0, seed);
    let b = hash(x1, y0, seed);
    let c = hash(x0, y1, seed);
    let d = hash(x1, y1, seed);
    let top = a + (b - a) * sx;
    let bottom = c + (d - c) * sx;
    top + (bottom - top) * sy
}

/// Layered seamless noise in [0, 1) (`fbm`): coarse shapes with finer detail on top. Features are
/// about `spacing` tiles apart (rounded so a whole number of them fits around the map).
pub(crate) fn fbm(x: f64, y: f64, size: f64, spacing: f64, octaves: u32, seed: f64) -> f64 {
    let mut cells = js_round(size / spacing).max(1.0);
    let mut sum = 0.0;
    let mut amp = 1.0;
    let mut total = 0.0;
    for o in 0..octaves {
        sum += value_noise(x, y, size, cells, seed + f64::from(o) * 1013.0) * amp;
        total += amp;
        amp *= 0.5;
        cells *= 2.0;
    }
    sum / total
}

/// Tiles apart at which [`fbm_field`] works noise out exactly; in between it blends (`FIELD_STEP`).
pub const FIELD_STEP: i32 = 4;

/// `fbmField` into `out` (one value per tile, by tile index): `fbm` worked out every `FIELD_STEP`
/// tiles along each direction and blended in between, seamless across the joins. A map whose size
/// `FIELD_STEP` doesn't divide gets it worked out on every tile. `coarse` is scratch space.
fn fbm_field(
    out: &mut [f32],
    coarse: &mut Vec<f32>,
    size: i32,
    spacing: f64,
    octaves: u32,
    seed: f64,
) {
    let step = if size % FIELD_STEP == 0 { FIELD_STEP } else { 1 };
    let n = (size / step) as usize;
    let sz = f64::from(size);
    if step == 1 {
        for cy in 0..n {
            for cx in 0..n {
                out[cy * n + cx] = fbm(cx as f64, cy as f64, sz, spacing, octaves, seed) as f32;
            }
        }
        return;
    }
    coarse.clear();
    coarse.resize(n * n, 0.0);
    let stepf = f64::from(step);
    for cy in 0..n {
        for cx in 0..n {
            coarse[cy * n + cx] =
                fbm(cx as f64 * stepf, cy as f64 * stepf, sz, spacing, octaves, seed) as f32;
        }
    }
    let size = size as usize;
    let step = step as usize;
    // The blend weights of the tiles between two lattice points, the same for every row and column.
    let weights: Vec<f64> = (0..step).map(|i| i as f64 / stepf).collect();
    for y in 0..size {
        let y0 = y / step;
        let y1 = (y0 + 1) % n;
        let fy = weights[y % step];
        let row0 = &coarse[y0 * n..y0 * n + n];
        let row1 = &coarse[y1 * n..y1 * n + n];
        let line = &mut out[y * size..y * size + size];
        for (x, cell) in line.iter_mut().enumerate() {
            let x0 = x / step;
            let x1 = if x0 + 1 == n { 0 } else { x0 + 1 };
            let fx = weights[x % step];
            let top = f64::from(row0[x0]) * (1.0 - fx) + f64::from(row0[x1]) * fx;
            let bottom = f64::from(row1[x0]) * (1.0 - fx) + f64::from(row1[x1]) * fx;
            *cell = (top * (1.0 - fy) + bottom * fy) as f32;
        }
    }
}

/// The value below which `share` of `values` lie (`quantile`): the one that would stand at place
/// `k = floor(share * len)` (clamped into the values) if they were sorted. Reorders `values`; the
/// place's value doesn't depend on their order, so asking again of the same values is fine.
/// Infinity when there are none.
fn quantile(values: &mut [f32], share: f64) -> f32 {
    if values.is_empty() {
        return f32::INFINITY;
    }
    let len = values.len() as f64;
    // Math.min(len - 1, Math.max(0, Math.floor(share * len)))
    let k = (len - 1.0).min((share * len).floor().max(0.0)) as usize;
    *values.select_nth_unstable_by(k, f32::total_cmp).1
}

/// The four tiles sharing a side with tile `t`, across the joins (`neighbours`): right, left,
/// down, up.
pub fn neighbours(size: i32, t: usize) -> [usize; 4] {
    let size = size as usize;
    let x = t % size;
    let y = t / size;
    [
        y * size + if x + 1 == size { 0 } else { x + 1 },
        y * size + if x == 0 { size - 1 } else { x - 1 },
        (if y + 1 == size { 0 } else { y + 1 }) * size + x,
        (if y == 0 { size - 1 } else { y - 1 }) * size + x,
    ]
}

/// Each passable tile's connected group (`landGroups`), -1 elsewhere, and the size of each group.
/// Groups are numbered in the order of their first tile.
pub fn land_groups(map: &TerrainMap) -> (Vec<i32>, Vec<usize>) {
    let mut group = Vec::new();
    let sizes = land_groups_into(map, &mut group, &mut Vec::new());
    (group, sizes)
}

fn land_groups_into(map: &TerrainMap, group: &mut Vec<i32>, stack: &mut Vec<u32>) -> Vec<usize> {
    let size = map.size;
    let tiles = &map.tiles;
    let n = tiles.len();
    group.clear();
    group.resize(n, -1);
    stack.clear();
    let mut sizes = Vec::new();
    for start in 0..n {
        if group[start] != -1 || !is_passable_terrain(tiles[start]) {
            continue;
        }
        let g = sizes.len() as i32;
        let mut count = 0;
        group[start] = g;
        stack.push(start as u32);
        while let Some(t) = stack.pop() {
            count += 1;
            for nb in neighbours(size, t as usize) {
                if group[nb] == -1 && is_passable_terrain(tiles[nb]) {
                    group[nb] = g;
                    stack.push(nb as u32);
                }
            }
        }
        sizes.push(count);
    }
    sizes
}

/// Lakes stay at least this many tiles from the sea, so they are inland.
const LAKE_COAST_MARGIN: u8 = 48;

/// `generate_terrain_timed` without a timer, on the full-size map when `size` is `MAP_SIZE`.
pub fn generate_terrain(seed: i64, size: i32) -> TerrainMap {
    generate_terrain_timed(seed, size, &mut untimed)
}

/// The full-size map of a seed.
pub fn generate_full_terrain(seed: i64) -> TerrainMap {
    generate_terrain(seed, MAP_SIZE)
}

/// How ragged the mainland's coast is: how far the coast noise moves it, as a share of the
/// mainland's reach.
const MAINLAND_COAST: f64 = 1.2;

/// How ragged an island's coast is, as a share of its radius: it reaches at most `1 + this / 2`
/// radii from its middle.
const ISLAND_COAST: f64 = 0.8;

/// Tiles along each of the map's joins that stay Sea (`JOIN_SEA_SHARE`), at least two.
pub fn join_sea(size: i32) -> i32 {
    ((JOIN_SEA_SHARE * f64::from(size)).ceil() as i32).max(2)
}

/// The mainland's shape before its coast is made ragged: a disc in the middle of the map,
/// stretched by `stretch` along the direction (`cos`, `sin`), `reach` tiles in radius before the
/// stretch. The same for the same seed and size, so regions (`regions`) are laid out on it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct MainlandShape {
    pub stretch: f64,
    pub sin: f64,
    pub cos: f64,
    /// The map's middle, along each direction.
    pub mid: f64,
    pub reach: f64,
}

impl MainlandShape {
    pub(crate) fn of(seed: f64, size: i32) -> MainlandShape {
        let stretch = 1.0 + hash(0.0, 11.0, seed) * (MAINLAND_STRETCH - 1.0);
        let (sin, cos) = (hash(1.0, 11.0, seed) * std::f64::consts::PI).sin_cos();
        let sz = f64::from(size);
        let mid = (sz - 1.0) / 2.0;
        let reach = (MAINLAND_SHARE * sz * sz / std::f64::consts::PI).sqrt();
        MainlandShape { stretch, sin, cos, mid, reach }
    }

    /// Tile (x, y) in the shape's own units: (along, across) over `reach`, so the unstretched disc
    /// has radius 1.
    pub(crate) fn unit(&self, x: f64, y: f64) -> (f64, f64) {
        let (dx, dy) = (x - self.mid, y - self.mid);
        let along = (dx * self.cos + dy * self.sin) / self.stretch;
        let across = (dy * self.cos - dx * self.sin) * self.stretch;
        (along / self.reach, across / self.reach)
    }

    /// The tile at (u, v) of the shape's own units ([`MainlandShape::unit`] back).
    pub(crate) fn tile(&self, u: f64, v: f64) -> (f64, f64) {
        let a = u * self.reach * self.stretch;
        let b = v * self.reach / self.stretch;
        (self.mid + a * self.cos - b * self.sin, self.mid + a * self.sin + b * self.cos)
    }
}

/// Generates the map from a seed (`CONTEXT.md`: Map, Terrain, The land): a square whose opposite
/// sides join, across Sea only. One mainland in the middle with a ragged coast, islands off it,
/// small lakes inland on the mainland, mountains in ranges with hills around them, forests in
/// patches and plains in between. Shares and counts come from the balance file. Mainland land cut
/// off from the rest becomes water, so the mainland is joined; an island too close to it or too
/// small for a haven becomes water too. The mainland is cut into regions (`regions`, `CONTEXT.md`:
/// Region): heartlands lie low and grow less forest; a Mountain range or an arm of the Sea runs
/// along each border between two, with a few passes and land bridges through it, and the mainland
/// stays joined for a carriage.
pub fn generate_terrain_timed(seed: i64, size: i32, timer: &mut StageTimer<'_>) -> TerrainMap {
    let n = (size as usize) * (size as usize);
    let sz = f64::from(size);
    let nf = n as f64;
    let layout = Layout::new(seed, size);
    let seed = seed as f64;
    let mut tiles = vec![Terrain::Plains as u8; n];
    // Buffers shared by the stages: two fields, the values a cut is taken from, the noise lattice.
    let mut field_a = vec![0f32; n];
    let mut field_b = vec![0f32; n];
    let mut values: Vec<f32> = Vec::with_capacity(n);
    let mut coarse = Vec::new();
    let edge = join_sea(size);

    // The mainland: one blob in the middle of the map, stretched along a direction the seed picks,
    // its coast moved by noise from bays a sixth of the map across down to coves. The highest
    // scoring `MAINLAND_SHARE` of the map is land, the rest Sea. Near the joins the score falls
    // away, and along them it is Sea whatever the noise says.
    let mainland = timed(timer, "mainland", || {
        let MainlandShape { stretch, sin, cos, mid, reach } = MainlandShape::of(seed, size);
        let falloff = f64::from(edge) * 4.0;
        let score = &mut field_a;
        fbm_field(score, &mut coarse, size, sz / 6.0, 6, seed + 5.0);
        values.clear();
        for y in 0..size {
            let dy = f64::from(y) - mid;
            let from_edge_y = y.min(size - 1 - y);
            for x in 0..size {
                let t = (y * size + x) as usize;
                let from_edge = x.min(size - 1 - x).min(from_edge_y);
                if from_edge < edge {
                    score[t] = f32::NEG_INFINITY;
                    continue;
                }
                let dx = f64::from(x) - mid;
                let along = (dx * cos + dy * sin) / stretch;
                let across = (dy * cos - dx * sin) * stretch;
                let deep = 1.0 - along.hypot(across) / reach;
                let near_edge = (1.0 - f64::from(from_edge - edge) / falloff).max(0.0);
                let coast = (f64::from(score[t]) - 0.5) * MAINLAND_COAST;
                score[t] = (deep + coast - near_edge * near_edge) as f32;
                values.push(score[t]);
            }
        }
        let off_the_joins = values.len() as f64;
        let cut = quantile(&mut values, 1.0 - MAINLAND_SHARE * nf / off_the_joins);
        let mut land = 0usize;
        for (tile, &v) in tiles.iter_mut().zip(score.iter()) {
            if v < cut {
                *tile = Terrain::Sea as u8;
            } else {
                land += 1;
            }
        }
        land
    });

    // The mainland's regions (`regions`): each tile of it in the region of its site.
    let mut cells: Vec<u8> = (0..n)
        .map(|t| {
            if tiles[t] == Terrain::Sea as u8 {
                NONE
            } else {
                layout.cell((t as i32) % size, (t as i32) / size)
            }
        })
        .collect();

    // Lakes: the lowest spots of a blobby field, only well away from the sea, so on the mainland.
    timed(timer, "lakes", || {
        let far = far_from_sea(&tiles, size);
        let noise = &mut field_a;
        fbm_field(noise, &mut coarse, size, 360.0, 3, seed + 1.0);
        values.clear();
        for t in 0..n {
            if far[t] && tiles[t] != Terrain::Sea as u8 {
                values.push(noise[t]);
            }
        }
        let lakes = values.len();
        let cut = quantile(&mut values, (TERRAIN_SHARES.lake * mainland as f64) / lakes as f64);
        // Turning a tile into a lake doesn't change whether another one may become one.
        for t in 0..n {
            if far[t] && tiles[t] != Terrain::Sea as u8 && noise[t] < cut {
                tiles[t] = Terrain::Lake as u8;
            }
        }
    });

    // Islands: blobs in the Sea off the mainland's coast, after the lakes so none has a lake.
    timed(timer, "islands", || place_islands(&mut tiles, size, seed, edge));

    let is_land = |tile: u8| tile != Terrain::Sea as u8 && tile != Terrain::Lake as u8;
    // Heartland land (0) has shares of its own (`HEARTLAND_TERRAIN`); the rest of the land (1)
    // makes up the shares of the whole (`TERRAIN_SHARES`).
    let part =
        |cell: u8| usize::from(!(cell != NONE && layout.kind(cell) == RegionKind::Heartland));
    // How much of the rest's land a terrain covers, when heartlands cover `heart` of theirs.
    let rest_share = |whole: f64, heart: f64, counts: [f64; 2]| {
        if counts[1] == 0.0 {
            0.0
        } else {
            ((whole * (counts[0] + counts[1]) - heart * counts[0]) / counts[1]).clamp(0.0, 1.0)
        }
    };

    // Mountains and hills: ridges of a noise field, strongest where a coarse mask lets ranges form.
    // The highest ridge tiles are mountains, the band below them hills; islands' land lies higher
    // (`ISLAND_RELIEF`). The relief overwrites the ridge field; off land it is 0.
    let mut rest: Vec<f32> = Vec::new();
    let (mountain_cut, hills_cut, land) = timed(timer, "relief", || {
        let relief = &mut field_a;
        let masks = &mut field_b;
        fbm_field(relief, &mut coarse, size, 640.0, 4, seed + 2.0);
        fbm_field(masks, &mut coarse, size, 1600.0, 2, seed + 3.0);
        values.clear();
        for t in 0..n {
            if !is_land(tiles[t]) {
                relief[t] = 0.0;
                continue;
            }
            let ridge = 1.0 - (2.0 * f64::from(relief[t]) - 1.0).abs();
            let mask = f64::from(masks[t]);
            let raise = if cells[t] == NONE { ISLAND_RELIEF } else { 1.0 };
            relief[t] = (ridge * ridge * mask * raise) as f32;
            if part(cells[t]) == 0 {
                values.push(relief[t])
            } else {
                rest.push(relief[t])
            }
        }
        let land = [values.len() as f64, rest.len() as f64];
        let (s, h) = (TERRAIN_SHARES, HEARTLAND_TERRAIN);
        let mountain_rest = rest_share(s.mountain, h.mountain, land);
        let high_rest = rest_share(s.mountain + s.hills, h.mountain + h.hills, land);
        let mountain =
            [quantile(&mut values, 1.0 - h.mountain), quantile(&mut rest, 1.0 - mountain_rest)];
        let hills = [
            quantile(&mut values, 1.0 - (h.mountain + h.hills)),
            quantile(&mut rest, 1.0 - high_rest),
        ];
        (mountain, hills, land)
    });

    // Forest: patches of a separate field among the remaining land; plains everywhere else.
    timed(timer, "forest", || {
        let relief = &field_a;
        let growth = &mut field_b;
        fbm_field(growth, &mut coarse, size, 280.0, 4, seed + 4.0);
        values.clear();
        rest.clear();
        for t in 0..n {
            let p = part(cells[t]);
            if is_land(tiles[t]) && relief[t] < hills_cut[p] {
                if p == 0 {
                    values.push(growth[t])
                } else {
                    rest.push(growth[t])
                }
            }
        }
        let flat = [values.len() as f64, rest.len() as f64];
        let heart = HEARTLAND_TERRAIN.forest;
        let rest_forest = rest_share(TERRAIN_SHARES.forest, heart, land) * land[1];
        let forest_cut = [
            quantile(&mut values, 1.0 - heart * land[0] / flat[0].max(1.0)),
            quantile(&mut rest, 1.0 - rest_forest / flat[1].max(1.0)),
        ];
        for t in 0..n {
            if !is_land(tiles[t]) {
                continue;
            }
            let p = part(cells[t]);
            tiles[t] = if relief[t] >= mountain_cut[p] {
                Terrain::Mountain
            } else if relief[t] >= hills_cut[p] {
                Terrain::Hills
            } else if growth[t] >= forest_cut[p] {
                Terrain::Forest
            } else {
                Terrain::Plains
            } as u8;
        }
    });
    drop((field_a, field_b, values, rest, coarse));

    // The mainland joined and every island one to build on (`join_land`).
    let mut map = TerrainMap { size, tiles };
    timed(timer, "joining", || join_land(&mut map));

    // The borders between the mainland's regions raised, a few ways left through them, and the
    // mainland kept joined for a carriage (`regions`).
    timed(timer, "regions", || {
        let land = Land::of(&map);
        for (t, cell) in cells.iter_mut().enumerate() {
            if !land.is_mainland(t) {
                *cell = NONE;
            }
        }
        raise_borders(&mut map, &layout, &cells);
        join_land(&mut map);
        join_for_carriages(&mut map, &cells);
    });
    map
}

/// Places up to `ISLAND_COUNT` islands in the Sea (`CONTEXT.md`: Island): each a blob of a radius
/// from `ISLAND_RADIUS` with a ragged coast, more than `NARROWEST_STRAIT` tiles of water from the
/// land and from every other island, at most `ISLAND_OFFSHORE_SHARE` of the map from the land, and
/// clear of the Sea along the joins. Spots are drawn from the seed until enough islands fit or the
/// tries run out; a small map gets fewer.
fn place_islands(tiles: &mut [u8], size: i32, seed: f64, edge: i32) {
    let sz = f64::from(size);
    let step = if size % FIELD_STEP == 0 { FIELD_STEP } else { 1 };
    let steps = coarse_steps_from_land(tiles, size, step);
    let side = size / step;
    let strait = f64::from(NARROWEST_STRAIT);
    let offshore = ISLAND_OFFSHORE_SHARE * sz;
    let r = ISLAND_RADIUS;
    let (rmin, rmax) = ((r.min * sz).max(r.min_tiles), (r.max * sz).max(r.min_tiles));
    let wanted = ISLAND_COUNT as usize;
    let mut s = 0.0;
    let mut rand = || {
        let v = hash(s, 13.0, seed);
        s += 1.0;
        v
    };
    let mut placed: Vec<(f64, f64, f64)> = Vec::new();
    for _ in 0..wanted * 40 {
        if placed.len() == wanted {
            break;
        }
        let (x, y) = ((rand() * sz).floor(), (rand() * sz).floor());
        let radius = rmin + (rmax - rmin) * rand().powi(2);
        // The farthest any tile of the island can lie from its middle.
        let reach = radius * (1.0 + ISLAND_COAST / 2.0) + 1.0;
        let lo = f64::from(edge) + reach;
        let hi = sz - 1.0 - f64::from(edge) - reach;
        if x < lo || x > hi || y < lo || y > hi {
            continue;
        }
        let cell = (y as i32 / step) * side + x as i32 / step;
        let Some(from_land) = steps[cell as usize].checked_mul(step as u32) else { continue };
        // The coarse search samples every `step`-th tile: land may lie up to two cells nearer.
        // A tile's steps (4 neighbours) can be up to √2 times its straight distance.
        let from_land = f64::from(from_land) - 2.0 * f64::from(step);
        let nearest = strait + reach * std::f64::consts::SQRT_2 + 1.0;
        // On a small map the strait and the island take most of `offshore`: some room is left.
        if from_land < nearest || from_land > offshore.max(nearest + 2.0 * reach + 8.0) {
            continue;
        }
        if placed.iter().any(|&(px, py, pr)| (px - x).hypot(py - y) < pr + reach + strait * 2.0) {
            continue;
        }
        placed.push((x, y, reach));
        let spacing = (radius * 0.8).max(4.0);
        let noise_seed = seed + 6.0 + placed.len() as f64 * 101.0;
        let r = reach.ceil() as i32;
        for ty in y as i32 - r..=y as i32 + r {
            for tx in x as i32 - r..=x as i32 + r {
                let d = f64::from(tx - x as i32).hypot(f64::from(ty - y as i32));
                let noise = fbm(f64::from(tx), f64::from(ty), sz, spacing, 3, noise_seed);
                if 1.0 - d / radius + (noise - 0.5) * ISLAND_COAST > 0.0 {
                    tiles[(ty * size + tx) as usize] = Terrain::Plains as u8;
                }
            }
        }
    }
}

/// Steps (4 neighbours, across the joins) from each cell of a grid of every `step`-th tile to the
/// nearest cell whose tile is land; `u32::MAX` with no land at all.
fn coarse_steps_from_land(tiles: &[u8], size: i32, step: i32) -> Vec<u32> {
    let side = (size / step) as usize;
    let (su, st) = (size as usize, step as usize);
    let mut steps = vec![u32::MAX; side * side];
    let mut frontier = Vec::new();
    for cy in 0..side {
        for cx in 0..side {
            if is_passable_terrain(tiles[cy * st * su + cx * st]) {
                steps[cy * side + cx] = 0;
                frontier.push(cy * side + cx);
            }
        }
    }
    let mut next = Vec::new();
    let mut d = 0;
    while !frontier.is_empty() {
        d += 1;
        for &c in &frontier {
            for nb in neighbours(side as i32, c) {
                if steps[nb] == u32::MAX {
                    steps[nb] = d;
                    next.push(nb);
                }
            }
        }
        std::mem::swap(&mut frontier, &mut next);
        next.clear();
    }
    steps
}

/// Which tiles lie more than `LAKE_COAST_MARGIN` steps (4 neighbours, across the joins) from the
/// nearest sea: `stepsFrom(size, sea)[t] > LAKE_COAST_MARGIN`, searched only as far as the margin.
/// Without any sea, no tile does (the TypeScript's distance stays -1).
fn far_from_sea(tiles: &[u8], size: i32) -> Vec<bool> {
    const UNSEEN: u8 = u8::MAX;
    let n = tiles.len();
    let mut dist = vec![UNSEEN; n];
    let mut frontier: Vec<u32> = Vec::new();
    for (t, &tile) in tiles.iter().enumerate() {
        if tile == Terrain::Sea as u8 {
            dist[t] = 0;
            frontier.push(t as u32);
        }
    }
    if frontier.is_empty() {
        return vec![false; n];
    }
    let mut next = Vec::new();
    for d in 1..=LAKE_COAST_MARGIN {
        for &t in &frontier {
            for nb in neighbours(size, t as usize) {
                if dist[nb] == UNSEEN {
                    dist[nb] = d;
                    next.push(nb as u32);
                }
            }
        }
        std::mem::swap(&mut frontier, &mut next);
        next.clear();
    }
    dist.into_iter().map(|d| d == UNSEEN).collect()
}

/// The last step of generation (`CONTEXT.md`: The land): the mainland is the largest land group
/// (the first of the largest); every other group stays only as an island, more than
/// `NARROWEST_STRAIT` tiles of water from the mainland and with room for a haven on its shore
/// (`land`). Any other group becomes water as a whole: sea if any of its tiles touches the sea,
/// lake otherwise. So the mainland is joined and no walk reaches an island.
fn join_land(map: &mut TerrainMap) {
    let land = Land::of(map);
    let Some(main) = land.mainland else { return };
    let near = near_the_mainland(map, &land);
    let haven = fits_a_haven(map, &land);
    let gone: Vec<bool> =
        (0..land.sizes.len()).map(|g| g as i32 != main && (near[g] || !haven[g])).collect();
    let size = map.size;
    let tiles = &mut map.tiles;
    let mut by_sea = vec![false; land.sizes.len()];
    for (t, &g) in land.group.iter().enumerate() {
        if g != -1
            && gone[g as usize]
            && !by_sea[g as usize]
            && neighbours(size, t).iter().any(|&nb| tiles[nb] == Terrain::Sea as u8)
        {
            by_sea[g as usize] = true;
        }
    }
    for (t, &g) in land.group.iter().enumerate() {
        if g != -1 && gone[g as usize] {
            tiles[t] = if by_sea[g as usize] { Terrain::Sea } else { Terrain::Lake } as u8;
        }
    }
}

/// A rule a generated map must keep, broken (`TerrainProblem`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainProblem {
    pub rule: &'static str,
    pub message: String,
}

/// Checks the rules every generated map keeps (`checkTerrain`, ADR 0004): every tile holds a known
/// terrain, no lake touches the sea, the map's joins cross only water, the mainland is joined (no
/// land split from it by less than the narrowest strait) and every island has room for a haven.
pub fn check_terrain(map: &TerrainMap) -> Vec<TerrainProblem> {
    let size = map.size as usize;
    let tiles = &map.tiles;
    let mut problems = Vec::new();
    for (t, &tile) in tiles.iter().enumerate() {
        let at = || format!("({}, {})", t % size, t / size);
        // A road is never stored in the map (`ground_at`).
        let known = matches!(Terrain::from_byte(tile), Some(k) if k != Terrain::Road);
        if !known {
            problems.push(TerrainProblem {
                rule: "known-terrain",
                message: format!("tile {} holds {tile}", at()),
            });
        }
        if tile == Terrain::Lake as u8
            && neighbours(map.size, t).iter().any(|&nb| tiles[nb] == Terrain::Sea as u8)
        {
            problems.push(TerrainProblem {
                rule: "lakes-inland",
                message: format!("lake at {} touches the sea", at()),
            });
        }
    }
    let last = size - 1;
    let on_joins = (0..size)
        .flat_map(|i| [(0, i), (last, i), (i, 0), (i, last)])
        .find(|&(x, y)| !is_water(tiles[y * size + x]));
    if let Some((x, y)) = on_joins {
        problems.push(TerrainProblem {
            rule: "water-at-joins",
            message: format!("land at ({x}, {y}) lies on the map's joins"),
        });
    }
    let land = Land::of(map);
    let near = near_the_mainland(map, &land);
    let haven = fits_a_haven(map, &land);
    let first = land.first_tiles();
    for g in land.islands() {
        let (gi, t) = (g as usize, first[g as usize]);
        let at = format!("({}, {})", t % size, t / size);
        if near[gi] {
            problems.push(TerrainProblem {
                rule: "mainland-joined",
                message: format!(
                    "land of {} tiles at {at} is split from the mainland by less than {} tiles of water",
                    land.sizes[gi], NARROWEST_STRAIT
                ),
            });
        } else if !haven[gi] {
            problems.push(TerrainProblem {
                rule: "island-room",
                message: format!(
                    "island of {} tiles at {at} has no room for a haven on its shore",
                    land.sizes[gi]
                ),
            });
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::terrain::terrain_at;

    /// What a generated map must show of the land (`CONTEXT.md`: The land, Island), beyond
    /// `check_terrain`: the mainland is one group holding most of the land, each island is its own
    /// group with room for a haven and beyond the strait from every other island, and no land lies
    /// in the Sea along the joins. Returns how many islands there are.
    fn assert_the_land(map: &TerrainMap) -> usize {
        let size = map.size as usize;
        assert_eq!(check_terrain(map), [], "map of {size}");
        let land = Land::of(map);
        let main = land.mainland.expect("a mainland");
        let total: usize = land.sizes.iter().sum();
        let share = land.sizes[main as usize] as f64 / total as f64;
        assert!(share > 0.9, "the mainland holds {share} of the land");
        let of_map = land.sizes[main as usize] as f64 / map.tiles.len() as f64;
        assert!((of_map - MAINLAND_SHARE).abs() < 0.1, "the mainland covers {of_map} of the map");
        let edge = join_sea(map.size) as usize;
        for (t, &g) in land.group.iter().enumerate() {
            let (x, y) = (t % size, t / size);
            let from_edge = x.min(size - 1 - x).min(y).min(size - 1 - y);
            assert!(g == -1 || from_edge >= edge, "land at ({x}, {y}) by the joins");
        }
        let haven = fits_a_haven(map, &land);
        for g in land.islands() {
            assert!(haven[g as usize], "island {g} has room for a haven");
            // Taken as the mainland, the island has no other land within the strait of it.
            let from_g = Land { mainland: Some(g), ..land.clone() };
            let near = near_the_mainland(map, &from_g);
            assert!(near.iter().all(|&n| !n), "land within the strait of island {g}");
        }
        land.islands().count()
    }

    #[test]
    fn makes_one_mainland_with_islands_off_it_over_seeds_and_sizes() {
        for (seed, size) in [(1, 256), (2, 256), (42, 256), (1, 512), (3, 512), (7, 1024)] {
            let islands = assert_the_land(&generate_terrain(seed, size));
            if size >= 512 {
                assert!(islands >= 4, "{seed}-{size}: only {islands} islands");
            }
        }
    }

    #[test]
    fn makes_the_same_map_from_the_same_seed_and_another_from_another() {
        let a = generate_terrain(42, 256);
        assert_eq!(generate_terrain(42, 256), a);
        assert_ne!(generate_terrain(43, 256).tiles, a.tiles);
    }

    #[test]
    fn makes_a_tiny_map_that_keeps_the_rules() {
        let map = generate_terrain(1, 64);
        assert_eq!(check_terrain(&map), []);
        assert!(Land::of(&map).mainland.is_some());
    }

    #[test]
    fn reports_every_stage_to_the_timer() {
        let mut stages = Vec::new();
        generate_terrain_timed(1, 64, &mut |stage, _| stages.push(stage));
        assert_eq!(
            stages,
            ["mainland", "lakes", "islands", "relief", "forest", "joining", "regions"]
        );
    }

    #[test]
    fn computes_hypot_as_v8_does() {
        assert_eq!(js_hypot(3.0, 4.0), 5.0);
        assert_eq!(js_hypot(-3.0, 0.0), 3.0);
        assert_eq!(js_hypot(0.0, -0.0), 0.0);
        assert_eq!(js_hypot(f64::INFINITY, f64::NAN), f64::INFINITY);
        assert!(js_hypot(1.0, f64::NAN).is_nan());
    }

    #[test]
    fn finds_quantiles_with_the_typescript_clamping() {
        let mut v = [5.0, 1.0, 4.0, 2.0, 3.0];
        assert_eq!(quantile(&mut v, 0.0), 1.0);
        assert_eq!(quantile(&mut v, 0.5), 3.0);
        assert_eq!(quantile(&mut v, 0.99), 5.0);
        assert_eq!(quantile(&mut v, 7.0), 5.0);
        assert_eq!(quantile(&mut v, -1.0), 1.0);
        assert_eq!(quantile(&mut [], 0.5), f32::INFINITY);
    }

    /// A 64 × 64 map of Sea with plains rectangles `(x, y, w, h)`.
    fn sea_with(land: &[(usize, usize, usize, usize)]) -> TerrainMap {
        let mut tiles = vec![Terrain::Sea as u8; 64 * 64];
        for &(x, y, w, h) in land {
            for ty in y..y + h {
                for tx in x..x + w {
                    tiles[ty * 64 + tx] = Terrain::Plains as u8;
                }
            }
        }
        TerrainMap { size: 64, tiles }
    }

    fn rules(map: &TerrainMap) -> Vec<&'static str> {
        let mut rules: Vec<&str> = check_terrain(map).iter().map(|p| p.rule).collect();
        rules.sort_unstable();
        rules
    }

    #[test]
    fn passes_a_mainland_with_an_island_off_it() {
        assert_eq!(rules(&sea_with(&[(4, 4, 24, 24), (48, 48, 6, 6)])), Vec::<&str>::new());
    }

    #[test]
    fn reports_a_split_mainland_a_sliver_island_and_land_on_the_joins() {
        // Split: a piece two tiles off the mainland's east coast.
        assert_eq!(rules(&sea_with(&[(4, 4, 24, 24), (30, 4, 6, 6)])), ["mainland-joined"]);
        // A sliver: an island one tile wide, no room for a haven.
        assert_eq!(rules(&sea_with(&[(4, 4, 24, 24), (50, 40, 1, 10)])), ["island-room"]);
        // Land on the joins.
        assert_eq!(rules(&sea_with(&[(0, 4, 24, 24)])), ["water-at-joins"]);
    }

    #[test]
    fn reports_a_lake_on_the_sea_and_unknown_terrain() {
        let mut map = sea_with(&[(4, 4, 24, 24)]);
        map.tiles[10 * 64 + 27] = Terrain::Lake as u8;
        map.tiles[10 * 64 + 10] = 99;
        assert_eq!(rules(&map), ["known-terrain", "lakes-inland"]);
    }

    /// Sizes of the connected groups (4 neighbours, across the joins) of one terrain.
    pub(crate) fn group_sizes(map: &TerrainMap, terrain: Terrain) -> Vec<usize> {
        let tiles = &map.tiles;
        let mut seen = vec![false; tiles.len()];
        let mut sizes = Vec::new();
        let mut stack = Vec::new();
        for start in 0..tiles.len() {
            if tiles[start] != terrain as u8 || seen[start] {
                continue;
            }
            let mut count = 0;
            seen[start] = true;
            stack.push(start);
            while let Some(t) = stack.pop() {
                count += 1;
                for nb in neighbours(map.size, t) {
                    if tiles[nb] == terrain as u8 && !seen[nb] {
                        seen[nb] = true;
                        stack.push(nb);
                    }
                }
            }
            sizes.push(count);
        }
        sizes
    }

    /// The full-size map: its time in release and the rules of the land on it. Run with
    /// `cargo test --release -- --ignored`.
    #[test]
    #[ignore = "several seconds alone: generates the full-size map; see #1132"]
    fn generates_the_full_size_map_as_the_rules_say() {
        let from = Instant::now();
        let mut stages = Vec::new();
        let map =
            generate_terrain_timed(1, MAP_SIZE, &mut |stage, took| stages.push((stage, took)));
        let took = from.elapsed();
        eprintln!("generate_terrain(1, {MAP_SIZE}): {took:?} {stages:?}");

        // A 5,760 × 5,760 square whose coordinates run on past every side.
        assert_eq!(map.size, 5760);
        assert_eq!(map.tiles.len(), 5760 * 5760);
        assert_eq!(terrain_at(&map, -1, 5), terrain_at(&map, 5759, 5));
        assert_eq!(terrain_at(&map, 7, -1), terrain_at(&map, 7, 5759));

        // One mainland, islands off it, the joins in the Sea.
        let islands = assert_the_land(&map);
        assert!(islands >= ISLAND_COUNT as usize / 2, "{islands} islands");

        // The terrain shares of the land from the balance file, before the borders between regions
        // are raised: the ranges along them add Mountain, the passes Hills.
        let land = map.tiles.iter().filter(|&&t| !is_water(t)).count() as f64;
        let share = |t: Terrain| map.tiles.iter().filter(|&&x| x == t as u8).count() as f64 / land;
        let s = TERRAIN_SHARES;
        for (t, wanted, borders) in [
            (Terrain::Mountain, s.mountain, 0.05),
            (Terrain::Hills, s.hills, 0.02),
            (Terrain::Forest, s.forest, 0.0),
        ] {
            let got = share(t);
            assert!(
                got > wanted - 0.03 && got < wanted + borders + 0.01,
                "{t:?}: {got} of {wanted}"
            );
        }
        let regions = crate::regions::Regions::of(1, &map);
        assert_eq!(crate::regions::check_regions(&map, &regions), []);
        // No two heartlands touch, and both kinds of way are there.
        use crate::regions::{RegionKind, WayKind};
        let heart = |t: usize| {
            regions
                .id_of_tile(t)
                .filter(|&id| regions.regions[id as usize].kind == RegionKind::Heartland)
        };
        for t in 0..map.tiles.len() {
            if let Some(a) = heart(t) {
                for nb in neighbours(map.size, t) {
                    assert!(heart(nb).is_none_or(|b| b == a), "heartlands touch at {t}");
                }
            }
        }
        let count = |k: WayKind| regions.ways.iter().filter(|w| w.kind == k).count();
        eprintln!("{} passes, {} land bridges", count(WayKind::Pass), count(WayKind::LandBridge));
        assert!(count(WayKind::Pass) > 0 && count(WayKind::LandBridge) > 0);
        assert!(group_sizes(&map, Terrain::Lake).len() > 3);

        // Mountains form ranges.
        let sizes = group_sizes(&map, Terrain::Mountain);
        let total: usize = sizes.iter().sum();
        let in_ranges: usize = sizes.iter().filter(|&&s| s >= 3200).sum();
        assert!(in_ranges as f64 / total as f64 > 0.7);

        assert!(took < Duration::from_secs(10), "took {took:?}");
    }
}
