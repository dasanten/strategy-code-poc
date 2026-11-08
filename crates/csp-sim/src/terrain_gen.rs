//! Terrain generation (`CONTEXT.md`: Map, Terrain), ported bit for bit from the frozen
//! `apps/server/src/terrain-gen.ts` (ADR 0030): the same seed gives the same map, byte for byte.
//!
//! Float parity, made explicit:
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

use csp_shared::balance::{MAP_SIZE, SEA_COUNT, TERRAIN_SHARES};
use csp_shared::terrain::{is_passable_terrain, Terrain, TerrainMap};

use crate::random::hash;

/// Told how long each stage of generation took (`StageTimer` of `terrain-gen.ts`): the stage's
/// name and its time. `generate_terrain` names `seas`, `lakes`, `relief`, `forest`, `joining`;
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

/// `wrapDelta` of `terrain.ts` on JavaScript numbers (the seas' centres are not whole tiles).
#[inline]
fn wrap_delta_f(a: f64, b: f64, size: f64) -> f64 {
    let d = wrap_f(b - a, size);
    if d > size / 2.0 {
        d - size
    } else {
        d
    }
}

/// `Math.hypot(a, b)` as V8 computes it (`MathHypot` in `builtins/math.tq`): both values scaled
/// by the larger, their squares Kahan-summed, then `sqrt(sum) * max`. Not the same rounding as
/// `f64::hypot`, and the sea score depends on the last bit.
#[inline]
fn js_hypot(a: f64, b: f64) -> f64 {
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
fn fbm(x: f64, y: f64, size: f64, spacing: f64, octaves: u32, seed: f64) -> f64 {
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

/// Generates the map from a seed (`generateTerrain`, `CONTEXT.md`: Map, Terrain): a square whose
/// opposite sides join. A few large seas, small lakes inland, mountains in ranges with hills around
/// them, forests in patches and plains in between. Land cut off from the rest becomes water, so all
/// land stays joined. Shares come from the balance file.
pub fn generate_terrain_timed(seed: i64, size: i32, timer: &mut StageTimer<'_>) -> TerrainMap {
    let n = (size as usize) * (size as usize);
    let su = size as usize;
    let sz = f64::from(size);
    let nf = n as f64;
    let seed = seed as f64;
    let mut tiles = vec![Terrain::Plains as u8; n];
    // Buffers shared by the stages: two fields, the values a cut is taken from, the noise lattice.
    let mut field_a = vec![0f32; n];
    let mut field_b = vec![0f32; n];
    let mut values: Vec<f32> = Vec::with_capacity(n);
    let mut coarse = Vec::new();

    // Seas: a few large blobs with ragged coasts. Each tile scores by how deep it lies inside the
    // nearest blob; the deepest share becomes sea.
    timed(timer, "seas", || {
        let mut s = 0.0;
        let mut rand = || {
            let v = hash(s, 11.0, seed);
            s += 1.0;
            v
        };
        let seas: Vec<(f64, f64, f64)> = (0..SEA_COUNT as usize)
            .map(|_| {
                let x = rand() * sz;
                let y = rand() * sz;
                let r = sz * (0.12 + rand() * 0.08);
                (x, y, r)
            })
            .collect();
        // The coast field, overwritten by the sea score tile by tile.
        let score = &mut field_a;
        fbm_field(score, &mut coarse, size, 240.0, 4, seed + 5.0);
        for y in 0..su {
            let yf = y as f64;
            let dys: Vec<f64> = seas.iter().map(|sea| wrap_delta_f(sea.1, yf, sz)).collect();
            for x in 0..su {
                let xf = x as f64;
                let mut deepest = f64::NEG_INFINITY;
                for (sea, dy) in seas.iter().zip(&dys) {
                    let d = js_hypot(wrap_delta_f(sea.0, xf, sz), *dy);
                    deepest = deepest.max(1.0 - d / sea.2);
                }
                let t = y * su + x;
                score[t] = (deepest + (f64::from(score[t]) - 0.5) * 0.6) as f32;
            }
        }
        values.clear();
        values.extend_from_slice(score);
        let cut = quantile(&mut values, 1.0 - TERRAIN_SHARES.sea);
        for (tile, &v) in tiles.iter_mut().zip(score.iter()) {
            if v >= cut {
                *tile = Terrain::Sea as u8;
            }
        }
    });

    // Lakes: the lowest spots of a blobby field, only well away from the sea.
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
        let cut = quantile(&mut values, (TERRAIN_SHARES.lake * nf) / lakes as f64);
        // Turning a tile into a lake doesn't change whether another one may become one.
        for t in 0..n {
            if far[t] && tiles[t] != Terrain::Sea as u8 && noise[t] < cut {
                tiles[t] = Terrain::Lake as u8;
            }
        }
    });

    let is_land = |tile: u8| tile != Terrain::Sea as u8 && tile != Terrain::Lake as u8;

    // Mountains and hills: ridges of a noise field, strongest where a coarse mask lets ranges form.
    // The highest ridge tiles are mountains, the band below them hills. The relief overwrites the
    // ridge field; off land it is 0, as in a fresh typed array.
    let (mountain_cut, hills_cut) = timed(timer, "relief", || {
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
            relief[t] = (ridge * ridge * mask) as f32;
            values.push(relief[t]);
        }
        let land = values.len() as f64;
        let mountain = quantile(&mut values, 1.0 - (TERRAIN_SHARES.mountain * nf) / land);
        let hills = quantile(
            &mut values,
            1.0 - ((TERRAIN_SHARES.mountain + TERRAIN_SHARES.hills) * nf) / land,
        );
        (mountain, hills)
    });

    // Forest: patches of a separate field among the remaining land; plains everywhere else.
    timed(timer, "forest", || {
        let relief = &field_a;
        let growth = &mut field_b;
        fbm_field(growth, &mut coarse, size, 280.0, 4, seed + 4.0);
        values.clear();
        for t in 0..n {
            if is_land(tiles[t]) && relief[t] < hills_cut {
                values.push(growth[t]);
            }
        }
        let flat = values.len() as f64;
        let forest_cut = quantile(&mut values, 1.0 - (TERRAIN_SHARES.forest * nf) / flat);
        for t in 0..n {
            if !is_land(tiles[t]) {
                continue;
            }
            tiles[t] = if relief[t] >= mountain_cut {
                Terrain::Mountain
            } else if relief[t] >= hills_cut {
                Terrain::Hills
            } else if growth[t] >= forest_cut {
                Terrain::Forest
            } else {
                Terrain::Plains
            } as u8;
        }
    });
    drop((field_a, field_b, values, coarse));

    // All land joined: land cut off from the largest stretch becomes water as a whole, sea if it
    // touches the sea anywhere, lake otherwise.
    let mut map = TerrainMap { size, tiles };
    timed(timer, "joining", || join_land(&mut map));
    map
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

/// The last step of `generateTerrain`: every passable group but the largest (the first of the
/// largest) becomes sea if any of its tiles touches the sea, lake otherwise.
fn join_land(map: &mut TerrainMap) {
    let mut group = Vec::new();
    let sizes = land_groups_into(map, &mut group, &mut Vec::new());
    let Some(&largest) = sizes.iter().max() else { return };
    let main = sizes.iter().position(|&s| s == largest).unwrap_or(0) as i32;
    let size = map.size;
    let tiles = &mut map.tiles;
    let mut by_sea = vec![false; sizes.len()];
    for (t, &g) in group.iter().enumerate() {
        if g != -1
            && g != main
            && !by_sea[g as usize]
            && neighbours(size, t).iter().any(|&nb| tiles[nb] == Terrain::Sea as u8)
        {
            by_sea[g as usize] = true;
        }
    }
    for (t, &g) in group.iter().enumerate() {
        if g == -1 || g == main {
            continue;
        }
        tiles[t] = if by_sea[g as usize] { Terrain::Sea } else { Terrain::Lake } as u8;
    }
}

/// A rule a generated map must keep, broken (`TerrainProblem`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainProblem {
    pub rule: &'static str,
    pub message: String,
}

/// Checks the rules every generated map keeps (`checkTerrain`, ADR 0004): every tile holds a known
/// terrain, no lake touches the sea, and all land is joined.
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
    let (_, sizes) = land_groups(map);
    if sizes.len() > 1 {
        let mut largest = sizes.clone();
        largest.sort_unstable_by(|a, b| b.cmp(a));
        let largest: Vec<String> = largest.iter().take(5).map(ToString::to_string).collect();
        problems.push(TerrainProblem {
            rule: "land-joined",
            message: format!("land falls into {} parts ({}, â€¦)", sizes.len(), largest.join(", ")),
        });
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::terrain::terrain_at;

    fn fixture(name: &str) -> Vec<u8> {
        let path = format!("{}/fixtures/terrain/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
    }

    fn assert_fixture(seed: i64, size: i32) {
        let map = generate_terrain(seed, size);
        let expected = fixture(&format!("{seed}-{size}.bin"));
        assert_eq!(map.tiles.len(), expected.len());
        let wrong: Vec<usize> =
            (0..expected.len()).filter(|&t| map.tiles[t] != expected[t]).collect();
        assert!(
            wrong.is_empty(),
            "{seed}-{size}: {} tiles differ, first at {:?}",
            wrong.len(),
            wrong.first().map(|&t| (t % size as usize, t / size as usize)),
        );
        assert_eq!(check_terrain(&map), []);
    }

    #[test]
    fn matches_the_typescript_maps() {
        assert_fixture(1, 64);
        assert_fixture(1, 256);
        assert_fixture(42, 256);
        assert_fixture(1, 512);
    }

    #[test]
    fn matches_the_typescript_map_1024() {
        assert_fixture(7, 1024);
    }

    #[test]
    fn makes_the_same_map_from_the_same_seed_and_another_from_another() {
        let a = generate_terrain(42, 256);
        assert_eq!(generate_terrain(42, 256), a);
        assert_ne!(generate_terrain(43, 256).tiles, a.tiles);
    }

    #[test]
    fn reports_every_stage_to_the_timer() {
        let mut stages = Vec::new();
        generate_terrain_timed(1, 64, &mut |stage, _| stages.push(stage));
        assert_eq!(stages, ["seas", "lakes", "relief", "forest", "joining"]);
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

    #[test]
    fn reports_cut_off_land_a_lake_on_the_sea_and_unknown_terrain() {
        let size = 8;
        let mut tiles = vec![Terrain::Plains as u8; 64];
        // A ring of sea around one plains tile cuts it off.
        for (x, y) in [(3, 2), (2, 3), (4, 3), (3, 4)] {
            tiles[y * 8 + x] = Terrain::Sea as u8;
        }
        tiles[6 * 8 + 6] = Terrain::Lake as u8;
        tiles[6 * 8 + 7] = Terrain::Sea as u8;
        tiles[0] = 99;
        let mut rules: Vec<&str> =
            check_terrain(&TerrainMap { size, tiles }).iter().map(|p| p.rule).collect();
        rules.sort_unstable();
        assert_eq!(rules, ["known-terrain", "lakes-inland", "land-joined"]);
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

    /// Share of neighbouring tile pairs that differ across one column boundary (`x`) or row's.
    fn change_across(map: &TerrainMap, along_x: bool, at: i32) -> f64 {
        let changed = (0..map.size)
            .filter(|&i| {
                let (a, b) = if along_x {
                    (terrain_at(map, at - 1, i), terrain_at(map, at, i))
                } else {
                    (terrain_at(map, i, at - 1), terrain_at(map, i, at))
                };
                a != b
            })
            .count();
        changed as f64 / f64::from(map.size)
    }

    /// The full-size map: the TypeScript's hash, its time in release, and the tests of
    /// `terrain-gen.test.ts` that need it. Run with `cargo test --release -- --ignored`.
    #[test]
    #[ignore = "generates the full-size map; run with --release -- --ignored"]
    fn generates_the_full_size_map_as_the_typescript_does() {
        use sha2::{Digest, Sha256};
        let from = Instant::now();
        let mut stages = Vec::new();
        let map =
            generate_terrain_timed(1, MAP_SIZE, &mut |stage, took| stages.push((stage, took)));
        let took = from.elapsed();
        eprintln!("generate_terrain(1, {MAP_SIZE}): {took:?} {stages:?}");

        let digest: String =
            Sha256::digest(&map.tiles).iter().map(|b| format!("{b:02x}")).collect();
        let expected = String::from_utf8(fixture("1-5760.sha256")).expect("utf-8");
        assert_eq!(digest, expected.trim());

        // A 5,760 Ã— 5,760 square whose coordinates run on past every side.
        assert_eq!(map.size, 5760);
        assert_eq!(map.tiles.len(), 5760 * 5760);
        assert_eq!(terrain_at(&map, -1, 5), terrain_at(&map, 5759, 5));
        assert_eq!(terrain_at(&map, 5760, 5), terrain_at(&map, 0, 5));
        assert_eq!(terrain_at(&map, 7, -1), terrain_at(&map, 7, 5759));

        // No seams where the sides join.
        let inside = (change_across(&map, true, 2880) + change_across(&map, false, 2880)) / 2.0;
        for across in [change_across(&map, true, 0), change_across(&map, false, 0)] {
            assert!(across < inside * 2.0 + 0.02, "{across} across a join, {inside} inside");
        }

        // The terrain shares from the balance file.
        let share = |t: Terrain| {
            map.tiles.iter().filter(|&&x| x == t as u8).count() as f64 / map.tiles.len() as f64
        };
        let s = TERRAIN_SHARES;
        let rest = 1.0 - (s.sea + s.lake + s.mountain + s.hills + s.forest);
        for (t, wanted) in [
            (Terrain::Sea, s.sea),
            (Terrain::Lake, s.lake),
            (Terrain::Mountain, s.mountain),
            (Terrain::Hills, s.hills),
            (Terrain::Forest, s.forest),
            (Terrain::Plains, rest),
        ] {
            assert!((share(t) - wanted).abs() < 0.005, "{t:?}: {} of {wanted}", share(t));
        }

        // A few large seas, not scattered puddles.
        let mut seas = group_sizes(&map, Terrain::Sea);
        seas.sort_unstable_by(|a, b| b.cmp(a));
        let total: usize = seas.iter().sum();
        let big: usize = seas.iter().take(SEA_COUNT as usize).sum();
        assert!(big as f64 / total as f64 > 0.95);

        // Mountains form ranges.
        let sizes = group_sizes(&map, Terrain::Mountain);
        let total: usize = sizes.iter().sum();
        let in_ranges: usize = sizes.iter().filter(|&&s| s >= 3200).sum();
        assert!(in_ranges as f64 / total as f64 > 0.7);

        // All land joined and lakes inland.
        assert_eq!(land_groups(&map).1.len(), 1);
        assert_eq!(check_terrain(&map), []);
        assert!(group_sizes(&map, Terrain::Lake).len() > 3);

        assert!(took < Duration::from_secs(10), "took {took:?}");
    }
}
