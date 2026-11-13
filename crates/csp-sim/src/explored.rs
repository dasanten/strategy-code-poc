//! Every Player's explored terrain (`CONTEXT.md`: Explored terrain), one bit per tile, kept in
//! memory: the in-memory half of `apps/server/src/explored.ts`. The database comes with Epic 87,
//! so the bitmaps go in and out as `Vec<u8>` ([`ExploredTerrain::from_bitmaps`],
//! [`ExploredTerrain::bitmap`]) and [`ExploredTerrain::take_dirty`] says which to write.
//!
//! The bit layout is the TypeScript's: tile `t = y * size + x` is bit `t & 7` of byte `t >> 3`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use csp_shared::chunks::{
    chunks_across, encode_chunk, encode_chunk_batch, level_chunks_across, squares_across,
    KnownNode, CHUNK_SIZE, CHUNK_TILES, OVERVIEW_SCALE, TERRAIN_LEVEL_MAX, UNEXPLORED,
};
use csp_shared::terrain::{tile_index, wrap, TerrainMap};
use csp_shared::world::ResourceNode;

/// The map's terrain and what is made from it alone, held once and shared (ADR 0034): the game,
/// the explored terrain and the HTTP workers that read terrain all hold the same copy. None of it
/// ever changes, so it needs no lock; what is made on first use is made once.
#[derive(Debug)]
pub struct MapTerrain {
    terrain: Arc<TerrainMap>,
    /// Resource nodes by chunk index; nodes never move, so this is built once.
    nodes_by_chunk: HashMap<u32, Vec<KnownNode>>,
    overview: OnceLock<Vec<u8>>,
    /// Per coarse level (1 to `TERRAIN_LEVEL_MAX`), the most common terrain of every square of
    /// the whole map, as `coarse_squares` makes it: made once, when first asked for, and used for
    /// every fully explored chunk.
    squares: [OnceLock<Vec<u8>>; TERRAIN_LEVEL_MAX as usize],
}

impl MapTerrain {
    pub fn new(terrain: impl Into<Arc<TerrainMap>>, nodes: &[ResourceNode]) -> Self {
        let terrain = terrain.into();
        let n = chunks_across(terrain.size);
        let mut nodes_by_chunk: HashMap<u32, Vec<KnownNode>> = HashMap::new();
        for node in nodes {
            let (x, y) = (node.x.floor() as i32, node.y.floor() as i32);
            let c = y.div_euclid(CHUNK_SIZE) * n + x.div_euclid(CHUNK_SIZE);
            nodes_by_chunk.entry(c as u32).or_default().push(KnownNode { kind: node.kind, x, y });
        }
        MapTerrain {
            terrain,
            nodes_by_chunk,
            overview: OnceLock::new(),
            squares: Default::default(),
        }
    }

    /// The map's terrain, the one copy.
    pub fn terrain(&self) -> &Arc<TerrainMap> {
        &self.terrain
    }

    /// The most common terrain of every square of `level` (1 to `TERRAIN_LEVEL_MAX`) across the
    /// whole map, row-major, `squares_across(size, level)` a side: made on first use and kept. A
    /// reader can make it before taking the explored terrain's lock, so no tick waits for it.
    pub fn coarse_squares(&self, level: u8) -> &[u8] {
        self.squares[usize::from(level) - 1]
            .get_or_init(|| most_common_squares(&self.terrain, 1 << level))
    }

    /// The whole map for the admin map's far zoom (`terrain_overview`). Terrain never changes once
    /// generated (roads lie on top of it), so this is built on first request and kept.
    pub fn overview(&self) -> &[u8] {
        self.overview.get_or_init(|| terrain_overview(&self.terrain))
    }

    /// One chunk of terrain as it is, for admins only (`CONTEXT.md`: admin map): every tile and
    /// every resource node, explored or not. None for a chunk off the map.
    pub fn whole_chunk(&self, cx: i32, cy: i32) -> Option<Vec<u8>> {
        self.encode(cx, cy, |_, _| true)
    }

    /// A chunk with the tiles and nodes `known` lets through; None if none or off the map.
    fn encode(&self, cx: i32, cy: i32, known: impl Fn(i32, i32) -> bool) -> Option<Vec<u8>> {
        let n = chunks_across(self.terrain.size);
        if cx < 0 || cy < 0 || cx >= n || cy >= n {
            return None;
        }
        let TerrainMap { size, tiles } = &*self.terrain;
        let size = *size;
        let mut out = vec![UNEXPLORED; CHUNK_TILES];
        let mut any = false;
        for dy in 0..CHUNK_SIZE {
            let y = cy * CHUNK_SIZE + dy;
            if y >= size {
                break;
            }
            for dx in 0..CHUNK_SIZE {
                let x = cx * CHUNK_SIZE + dx;
                // A map whose side isn't a whole number of chunks leaves its last chunks part
                // empty; those tiles stay UNEXPLORED.
                if x < size && known(x, y) {
                    out[(dy * CHUNK_SIZE + dx) as usize] = tiles[(y * size + x) as usize];
                    any = true;
                }
            }
        }
        if !any {
            return None;
        }
        let nodes: Vec<KnownNode> = self
            .nodes_by_chunk
            .get(&((cy * n + cx) as u32))
            .map(|v| v.iter().copied().filter(|k| known(k.x, k.y)).collect())
            .unwrap_or_default();
        Some(encode_chunk(&out, &nodes, cx, cy))
    }
}

/// Every Player's explored terrain, by account id (`Realm::user_id`). It grows as the Player's
/// residents see new tiles (sight).
#[derive(Debug, Clone)]
pub struct ExploredTerrain {
    map: Arc<MapTerrain>,
    bits: HashMap<u64, Vec<u8>>,
    /// Per Player, the chunks in which they explored at least one tile, each with how many of its
    /// tiles they explored: kept beside the bitmap so a welcome looks them up instead of scanning
    /// every tile of the map, and a coarse chunk knows which chunks are fully explored. Scratch
    /// memory, rebuilt from the bitmap on load.
    chunks: HashMap<u64, BTreeMap<u32, u16>>,
    dirty: BTreeSet<u64>,
    /// Tiles read one by one to answer coarse chunks, for the tests to count.
    tiles_read: TilesRead,
}

/// A count of tiles read, cloned as its value.
#[derive(Debug, Default)]
struct TilesRead(AtomicU64);

impl Clone for TilesRead {
    fn clone(&self) -> Self {
        TilesRead(AtomicU64::new(self.0.load(Ordering::Relaxed)))
    }
}

impl ExploredTerrain {
    /// No one's explored terrain yet, on `terrain` (an `Arc` to share the game's copy).
    pub fn new(terrain: impl Into<Arc<TerrainMap>>, nodes: &[ResourceNode]) -> Self {
        Self {
            map: Arc::new(MapTerrain::new(terrain, nodes)),
            bits: HashMap::new(),
            chunks: HashMap::new(),
            dirty: BTreeSet::new(),
            tiles_read: TilesRead::default(),
        }
    }

    /// The map's terrain and what is made from it alone, shared: read without this lock.
    pub fn map(&self) -> &Arc<MapTerrain> {
        &self.map
    }

    /// The map's terrain, the one copy the game also holds.
    pub fn terrain(&self) -> &TerrainMap {
        &self.map.terrain
    }

    /// Explored terrain as saved: each Player's bitmap, as [`ExploredTerrain::bitmap`] gave it.
    pub fn from_bitmaps(
        terrain: impl Into<Arc<TerrainMap>>,
        nodes: &[ResourceNode],
        bitmaps: impl IntoIterator<Item = (u64, Vec<u8>)>,
    ) -> Self {
        let mut explored = Self::new(terrain, nodes);
        for (id, bits) in bitmaps {
            explored.chunks.insert(id, explored.chunks_in(&bits));
            explored.bits.insert(id, bits);
        }
        explored
    }

    /// The chunks with an explored tile in a bitmap, with how many: only its non-zero bytes are
    /// looked at.
    fn chunks_in(&self, bits: &[u8]) -> BTreeMap<u32, u16> {
        let size = self.terrain().size as usize;
        let n = chunks_across(self.terrain().size) as usize;
        let chunk = CHUNK_SIZE as usize;
        let last = size * size - 1;
        let chunk_of = |t: usize| (t / size / chunk) * n + (t % size) / chunk;
        let mut found: BTreeMap<u32, u16> = BTreeMap::new();
        for (i, &byte) in bits.iter().enumerate() {
            if byte == 0 {
                continue;
            }
            let first = i * 8;
            let c = chunk_of(first);
            // On a map whose side is a whole number of bytes, a byte's eight tiles share one chunk.
            if c == chunk_of((first + 7).min(last)) {
                *found.entry(c as u32).or_default() += byte.count_ones() as u16;
                continue;
            }
            for b in 0..8 {
                if byte & (1 << b) != 0 {
                    *found.entry(chunk_of(first + b) as u32).or_default() += 1;
                }
            }
        }
        found
    }

    /// How many tiles of a chunk lie on the map: all of them but at the edge of a map whose side
    /// isn't a whole number of chunks.
    fn tiles_on_map(&self, chunk: u32) -> u16 {
        let size = self.terrain().size;
        let n = chunks_across(size) as u32;
        let (cx, cy) = ((chunk % n) as i32, (chunk / n) as i32);
        let w = (size - cx * CHUNK_SIZE).min(CHUNK_SIZE);
        let h = (size - cy * CHUNK_SIZE).min(CHUNK_SIZE);
        (w * h) as u16
    }

    /// The Player's bitmap, to save: `ceil(size² / 8)` bytes. None if they explored nothing.
    pub fn bitmap(&self, user_id: u64) -> Option<&[u8]> {
        self.bits.get(&user_id).map(Vec::as_slice)
    }

    /// The Players whose explored terrain changed since the last call, by id.
    pub fn take_dirty(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.dirty).into_iter().collect()
    }

    /// Marks every tile within `radius` of (x, y) as explored by the Player, across the joins.
    /// Returns the chunks (sorted, once each) in which tiles were newly explored; this allocates
    /// only when there are some.
    pub fn explore(&mut self, user_id: u64, x: i32, y: i32, radius: i32) -> Vec<u32> {
        let size = self.terrain().size;
        let bits = self
            .bits
            .entry(user_id)
            .or_insert_with(|| vec![0; (size as usize * size as usize).div_ceil(8)]);
        let counts = self.chunks.entry(user_id).or_default();
        let n = chunks_across(size);
        let mut grown: Vec<u32> = Vec::new();
        let r2 = radius * radius;
        for dy in -radius..=radius {
            // The disc's row: every tile with dx² + dy² ≤ radius².
            let mut w = f64::from(r2 - dy * dy).sqrt().floor() as i32;
            while w * w + dy * dy > r2 {
                w -= 1;
            }
            let row = wrap(y + dy, size);
            let chunk_row = row.div_euclid(CHUNK_SIZE) * n;
            let mut tx = x - w;
            while tx <= x + w {
                let col = wrap(tx, size);
                let t = row as usize * size as usize + col as usize;
                let i = t >> 3;
                if bits[i] == 0xff {
                    // Eight tiles already explored: skip to the byte's end, or the row's if that
                    // comes first.
                    tx += (8 - (t as i32 & 7)).min(size - col);
                    continue;
                }
                let bit = 1u8 << (t & 7);
                if bits[i] & bit == 0 {
                    bits[i] |= bit;
                    let c = (chunk_row + col.div_euclid(CHUNK_SIZE)) as u32;
                    *counts.entry(c).or_default() += 1;
                    // Rows come in chunk order, so a repeat is almost always the last one.
                    if grown.last() != Some(&c) {
                        grown.push(c);
                    }
                }
                tx += 1;
            }
        }
        if grown.is_empty() {
            return grown;
        }
        grown.sort_unstable();
        grown.dedup();
        self.dirty.insert(user_id);
        grown
    }

    /// Marks every tile of the map as explored by the Player (`csp-admin explore --all`, a dev
    /// tool for staging a far-explored Player).
    pub fn explore_all(&mut self, user_id: u64) {
        let tiles = self.terrain().size as usize * self.terrain().size as usize;
        let mut bits = vec![0xff; tiles.div_ceil(8)];
        // Bits past the last tile stay clear, as `explore` leaves them.
        if !tiles.is_multiple_of(8) {
            *bits.last_mut().expect("a map has tiles") = (1u8 << (tiles % 8)) - 1;
        }
        let n = chunks_across(self.terrain().size) as u32;
        let counts = (0..n * n).map(|c| (c, self.tiles_on_map(c))).collect();
        self.chunks.insert(user_id, counts);
        self.bits.insert(user_id, bits);
        self.dirty.insert(user_id);
    }

    /// How many tiles the Player has explored.
    pub fn explored_tiles(&self, user_id: u64) -> usize {
        self.bits.get(&user_id).map_or(0, |b| b.iter().map(|b| b.count_ones() as usize).sum())
    }

    pub fn is_explored(&self, user_id: u64, x: i32, y: i32) -> bool {
        let t = tile_index(self.terrain().size, x, y);
        self.bits.get(&user_id).and_then(|b| b.get(t >> 3)).is_some_and(|b| b & (1 << (t & 7)) != 0)
    }

    /// One chunk of terrain as the Player knows it, encoded as `encode_chunk` describes: tiles
    /// they haven't explored are `UNEXPLORED`, and only resource nodes on explored tiles are
    /// included (they stay known like the terrain). None when they have explored nothing in it.
    pub fn chunk(&self, user_id: u64, cx: i32, cy: i32) -> Option<Vec<u8>> {
        let bits = self.bits.get(&user_id);
        self.map.encode(cx, cy, |x, y| {
            let t = tile_index(self.terrain().size, x, y);
            bits.and_then(|b| b.get(t >> 3)).is_some_and(|b| b & (1 << (t & 7)) != 0)
        })
    }

    /// The chunks among `indices` (see `chunks_across`) in which the Player explored something,
    /// each with its index and encoded as `chunk` does, in the order asked and once each. Anything
    /// else asked for (unexplored, off the map, not an index) is left out.
    pub fn chunk_batch(&self, user_id: u64, indices: &[i64]) -> Vec<(u32, Vec<u8>)> {
        let n = i64::from(chunks_across(self.terrain().size));
        let Some(known) = self.chunks.get(&user_id) else {
            return Vec::new();
        };
        let mut out: Vec<(u32, Vec<u8>)> = Vec::new();
        for &i in indices {
            let Ok(i) = u32::try_from(i) else { continue };
            if !known.contains_key(&i) || out.iter().any(|(seen, _)| *seen == i) {
                continue;
            }
            let (cx, cy) = (i64::from(i) % n, i64::from(i) / n);
            if let Some(bytes) = self.chunk(user_id, cx as i32, cy as i32) {
                out.push((i, bytes));
            }
        }
        out
    }

    /// The body that answers a batch request (`TERRAIN_BATCH_PATH`): `chunk_batch` encoded by
    /// `encode_chunk_batch`. The caller refuses more than `TERRAIN_BATCH_MAX` indices.
    pub fn chunks(&self, user_id: u64, indices: &[i64]) -> Vec<u8> {
        encode_chunk_batch(&self.chunk_batch(user_id, indices))
    }

    /// The body that answers a batch request at `level` (ADR 0034): `chunks` at level 0, else
    /// the coarse chunks among `indices` (see `level_chunks_across`) in which the Player explored
    /// something, in the order asked and once each, encoded by `encode_chunk_batch`. The caller
    /// refuses a level above `TERRAIN_LEVEL_MAX`.
    pub fn chunks_at(&self, user_id: u64, level: u8, indices: &[i64]) -> Vec<u8> {
        if level == 0 {
            return self.chunks(user_id, indices);
        }
        let n = i64::from(level_chunks_across(self.terrain().size, level));
        let mut out: Vec<(u32, Vec<u8>)> = Vec::new();
        for &i in indices {
            let Ok(i) = u32::try_from(i) else { continue };
            if out.iter().any(|(seen, _)| *seen == i) {
                continue;
            }
            let (cx, cy) = (i64::from(i) % n, i64::from(i) / n);
            if let Some(bytes) = self.coarse_chunk(user_id, level, cx as i32, cy as i32) {
                out.push((i, bytes));
            }
        }
        encode_chunk_batch(&out)
    }

    /// One chunk of `level` (1 to `TERRAIN_LEVEL_MAX`) as the Player knows it (ADR 0034;
    /// `CONTEXT.md`: Explored terrain): `CHUNK_TILES` bytes, one a square of `2^level` tiles a
    /// side, each the most common terrain among the tiles of the square the Player explored (the
    /// lower code on a tie), `UNEXPLORED` where they explored none of it and past the map's side.
    /// No resource nodes. None when they explored nothing in it, or for a chunk off the level.
    ///
    /// A square lies inside one chunk of level 0. Where they explored all of that chunk the
    /// square is looked up in `coarse_squares`, worked out once for the whole map; only the
    /// squares of partly explored chunks are counted tile by tile.
    pub fn coarse_chunk(&self, user_id: u64, level: u8, cx: i32, cy: i32) -> Option<Vec<u8>> {
        let size = self.terrain().size;
        let across = level_chunks_across(size, level);
        if level == 0 || level > TERRAIN_LEVEL_MAX || cx < 0 || cy < 0 {
            return None;
        }
        if cx >= across || cy >= across {
            return None;
        }
        let known = self.chunks.get(&user_id)?;
        let side = 1 << level;
        let squares = squares_across(size, level);
        // Squares a side of one level-0 chunk.
        let per = CHUNK_SIZE / side;
        let n = chunks_across(size);
        let bits = self.bits.get(&user_id).map(Vec::as_slice).unwrap_or_default();
        let mut whole: Option<&[u8]> = None;
        let mut tally = Tally::new();
        let mut out = vec![UNEXPLORED; CHUNK_TILES];
        let mut any = false;
        for qy in 0..CHUNK_SIZE {
            let sy = cy * CHUNK_SIZE + qy;
            if sy >= squares {
                break;
            }
            for qx in 0..CHUNK_SIZE {
                let sx = cx * CHUNK_SIZE + qx;
                if sx >= squares {
                    break;
                }
                let c = ((sy / per) * n + sx / per) as u32;
                let Some(&count) = known.get(&c) else { continue };
                let t = if count == self.tiles_on_map(c) {
                    let whole = *whole.get_or_insert_with(|| self.map.coarse_squares(level));
                    whole[(sy * squares + sx) as usize]
                } else {
                    self.explored_square(bits, side, sx, sy, &mut tally)
                };
                if t != UNEXPLORED {
                    out[(qy * CHUNK_SIZE + qx) as usize] = t;
                    any = true;
                }
            }
        }
        any.then_some(out)
    }

    /// The most common terrain among the tiles of square (sx, sy), `side` tiles a side, that the
    /// bitmap marks explored; `UNEXPLORED` if none.
    fn explored_square(&self, bits: &[u8], side: i32, sx: i32, sy: i32, tally: &mut Tally) -> u8 {
        let TerrainMap { size, tiles } = self.terrain();
        let size = *size;
        let mut read = 0;
        for y in sy * side..size.min((sy + 1) * side) {
            for x in sx * side..size.min((sx + 1) * side) {
                let t = (y * size + x) as usize;
                read += 1;
                if bits.get(t >> 3).is_some_and(|b| b & (1 << (t & 7)) != 0) {
                    tally.add(tiles[t]);
                }
            }
        }
        self.tiles_read.0.fetch_add(read, Ordering::Relaxed);
        tally.take().unwrap_or(UNEXPLORED)
    }

    /// Tiles read one by one to answer coarse chunks so far.
    pub fn tiles_read(&self) -> u64 {
        self.tiles_read.0.load(Ordering::Relaxed)
    }

    /// What is wrong with a coarse chunk sent to the Player (ADR 0004, ADR 0034), worked out tile
    /// by tile from their bitmap: a square shows a terrain only if one of their explored tiles in
    /// it has that terrain, and is `UNEXPLORED` exactly when none is explored (and past the map's
    /// side). Empty when it is sound.
    pub fn coarse_chunk_unsound(
        &self,
        user_id: u64,
        level: u8,
        cx: i32,
        cy: i32,
        bytes: &[u8],
    ) -> Vec<String> {
        let TerrainMap { size, tiles } = self.terrain();
        let size = *size;
        let side = 1 << level;
        let squares = squares_across(size, level);
        let mut wrong = Vec::new();
        for qy in 0..CHUNK_SIZE {
            for qx in 0..CHUNK_SIZE {
                let (sx, sy) = (cx * CHUNK_SIZE + qx, cy * CHUNK_SIZE + qy);
                let shown = bytes.get((qy * CHUNK_SIZE + qx) as usize).copied();
                let mut known = BTreeSet::new();
                if sx < squares && sy < squares {
                    for y in sy * side..size.min((sy + 1) * side) {
                        for x in sx * side..size.min((sx + 1) * side) {
                            if self.is_explored(user_id, x, y) {
                                known.insert(tiles[(y * size + x) as usize]);
                            }
                        }
                    }
                }
                let sound = match shown {
                    Some(UNEXPLORED) => known.is_empty(),
                    Some(t) => known.contains(&t),
                    None => false,
                };
                if !sound {
                    wrong.push(format!(
                        "level {level} square ({sx}, {sy}) shows {shown:?}, the Player knows {known:?} there"
                    ));
                }
            }
        }
        wrong
    }

    /// One chunk of terrain as it is, for admins only: [`MapTerrain::whole_chunk`].
    pub fn whole_chunk(&self, cx: i32, cy: i32) -> Option<Vec<u8>> {
        self.map.whole_chunk(cx, cy)
    }

    /// The whole map for the admin map's far zoom: [`MapTerrain::overview`].
    pub fn overview(&self) -> &[u8] {
        self.map.overview()
    }

    /// The chunks in which the Player has explored at least one tile (see `chunks_across`), sorted.
    pub fn explored_chunks(&self, user_id: u64) -> Vec<u32> {
        self.chunks.get(&user_id).map(|s| s.keys().copied().collect()).unwrap_or_default()
    }

    /// The chunks in which the Player has explored at least one tile, each with how many of its
    /// tiles they explored, sorted (ADR 0034: the client keeps chunks by this count).
    pub fn explored_counts(&self, user_id: u64) -> Vec<(u32, u16)> {
        self.chunks
            .get(&user_id)
            .map(|s| s.iter().map(|(&c, &n)| (c, n)).collect())
            .unwrap_or_default()
    }

    /// How many tiles of the chunk the Player has explored.
    pub fn explored_count(&self, user_id: u64, chunk: u32) -> u16 {
        self.chunks.get(&user_id).and_then(|s| s.get(&chunk)).copied().unwrap_or(0)
    }
}

/// The whole map downsampled for the admin map (`ADMIN_TERRAIN_OVERVIEW_PATH`): one byte per
/// `OVERVIEW_SCALE`² tiles, the terrain most of them have (the lower code on a tie). A square at
/// the edge of a map whose side isn't a whole number of squares counts only the tiles it has.
pub fn terrain_overview(terrain: &TerrainMap) -> Vec<u8> {
    most_common_squares(terrain, OVERVIEW_SCALE)
}

/// The whole map in squares of `side` tiles a side, row-major: each the terrain most of its
/// tiles have (the lower code on a tie), a square at the edge of a map whose side isn't a whole
/// number of squares counting only the tiles it has.
pub fn most_common_squares(terrain: &TerrainMap, side: i32) -> Vec<u8> {
    let TerrainMap { size, tiles } = terrain;
    let size = *size;
    let n = (size + side - 1).div_euclid(side);
    let mut out = vec![0u8; (n * n) as usize];
    let mut tally = Tally::new();
    for sy in 0..n {
        for sx in 0..n {
            for y in sy * side..size.min((sy + 1) * side) {
                for x in sx * side..size.min((sx + 1) * side) {
                    tally.add(tiles[(y * size + x) as usize]);
                }
            }
            out[(sy * n + sx) as usize] = tally.take().unwrap_or(0);
        }
    }
    out
}

/// Counts terrain codes to find the most common, the lower code on a tie; reset by `take`, which
/// clears only the codes it saw.
struct Tally {
    counts: [u32; 256],
    seen: Vec<u8>,
}

impl Tally {
    fn new() -> Self {
        Tally { counts: [0; 256], seen: Vec::new() }
    }

    fn add(&mut self, t: u8) {
        let c = &mut self.counts[usize::from(t)];
        if *c == 0 {
            self.seen.push(t);
        }
        *c += 1;
    }

    /// The most common code counted since the last call, none if none.
    fn take(&mut self) -> Option<u8> {
        let mut best: Option<(u32, u8)> = None;
        for &t in &self.seen {
            let c = std::mem::take(&mut self.counts[usize::from(t)]);
            if best.is_none_or(|(bc, bt)| c > bc || (c == bc && t < bt)) {
                best = Some((c, t));
            }
        }
        self.seen.clear();
        best.map(|(_, t)| t)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use csp_shared::balance::{MAP_SIZE, SIGHT_RANGE};
    use csp_shared::chunks::{decode_chunk, decode_chunk_batch, overview_across};
    use csp_shared::terrain::{terrain_at, Terrain};
    use csp_shared::world::ResourceKind;

    use super::*;

    const PLAYER: u64 = 7;
    const OTHER: u64 = 8;

    /// A 128 × 128 map of varied terrain (the TypeScript tests use a generated one; the terrain
    /// generator is ported separately, and these tests only need tiles that differ).
    fn small_terrain() -> TerrainMap {
        let size = 128;
        let tiles = (0..size * size).map(|t| ((t % size * 7 + t / size * 3) % 6) as u8).collect();
        TerrainMap { size, tiles }
    }

    fn node(id: &str, kind: ResourceKind, x: f64, y: f64) -> ResourceNode {
        ResourceNode { id: id.to_string(), kind, x, y }
    }

    /// 32-bit FNV-1a, to compare bytes with what the TypeScript gives.
    fn fnv1a(bytes: &[u8]) -> u32 {
        bytes.iter().fold(0x811c_9dc5u32, |h, &b| (h ^ u32::from(b)).wrapping_mul(0x0100_0193))
    }

    #[test]
    fn knows_only_what_a_player_explored_and_reports_newly_explored_chunks() {
        let terrain = small_terrain();
        let mut explored = ExploredTerrain::new(terrain.clone(), &[]);
        assert!(!explored.is_explored(PLAYER, 60, 60));
        let n = chunks_across(terrain.size) as u32;
        assert_eq!(explored.explore(PLAYER, 60, 60, 3), vec![n + 1]);
        // Nothing new the second time.
        assert_eq!(explored.explore(PLAYER, 60, 60, 3), Vec::<u32>::new());
        assert!(explored.is_explored(PLAYER, 60, 60));
        assert!(explored.is_explored(PLAYER, 63, 60));
        assert!(!explored.is_explored(PLAYER, 63, 63));
        assert!(!explored.is_explored(OTHER, 60, 60));
        assert!(explored.explored_chunks(OTHER).is_empty());
        // Exploring near a side reaches across the join.
        explored.explore(PLAYER, 0, 60, 2);
        assert!(explored.is_explored(PLAYER, terrain.size - 2, 60));
        assert!(explored.is_explored(PLAYER, -2, 60));
    }

    #[test]
    fn serves_explored_chunks_with_unexplored_tiles_hidden_and_refuses_others() {
        let terrain = small_terrain();
        let mut explored = ExploredTerrain::new(terrain.clone(), &[]);
        explored.explore(PLAYER, 40, 40, 2);
        let n = chunks_across(terrain.size) as u32;
        assert_eq!(explored.explored_chunks(PLAYER), vec![n + 1]);
        assert!(explored.chunk(PLAYER, 0, 0).is_none());
        assert!(explored.chunk(PLAYER, 99, 0).is_none());
        assert!(explored.chunk(PLAYER, -1, 1).is_none());

        let chunk = explored.chunk(PLAYER, 1, 1).unwrap();
        assert_eq!(chunk.len(), CHUNK_TILES);
        let at =
            |x: i32, y: i32| chunk[((y - CHUNK_SIZE) * CHUNK_SIZE + (x - CHUNK_SIZE)) as usize];
        assert_eq!(at(40, 40), terrain_at(&terrain, 40, 40));
        assert_eq!(at(50, 50), UNEXPLORED);
    }

    #[test]
    fn saves_what_changed_and_loads_it_back() {
        let terrain = small_terrain();
        let mut explored = ExploredTerrain::new(terrain.clone(), &[]);
        explored.explore(PLAYER, 60, 60, 5);
        assert_eq!(explored.take_dirty(), vec![PLAYER]);
        assert!(explored.take_dirty().is_empty());
        explored.explore(PLAYER, 20, 60, 1);
        assert_eq!(explored.take_dirty(), vec![PLAYER]);
        // Nothing new is nothing to save.
        explored.explore(PLAYER, 20, 60, 1);
        assert!(explored.take_dirty().is_empty());

        let saved = explored.bitmap(PLAYER).unwrap().to_vec();
        assert_eq!(saved.len(), (128 * 128) / 8);
        let loaded = ExploredTerrain::from_bitmaps(terrain, &[], [(PLAYER, saved)]);
        assert!(loaded.is_explored(PLAYER, 60, 65));
        assert!(loaded.is_explored(PLAYER, 20, 60));
        assert!(!loaded.is_explored(PLAYER, 40, 60));
        assert!(loaded.dirty.is_empty());
    }

    /// The chunks with an explored tile, found by asking every tile: what `explored_chunks`
    /// replaced.
    fn scanned_chunks(explored: &ExploredTerrain, size: i32) -> Vec<u32> {
        let n = chunks_across(size);
        let mut found = BTreeSet::new();
        for y in 0..size {
            for x in 0..size {
                let c = (y / CHUNK_SIZE * n + x / CHUNK_SIZE) as u32;
                if !found.contains(&c) && explored.is_explored(PLAYER, x, y) {
                    found.insert(c);
                }
            }
        }
        found.into_iter().collect()
    }

    /// Every tile within `radius` of (x, y), across the joins: the disc `explore` marks.
    fn disc(size: i32, x: i32, y: i32, radius: i32) -> HashSet<(i32, i32)> {
        let mut tiles = HashSet::new();
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx * dx + dy * dy <= radius * radius {
                    tiles.insert((wrap(x + dx, size), wrap(y + dy, size)));
                }
            }
        }
        tiles
    }

    /// A few scattered looks, some across the joins and over each other.
    const LOOKS: [(i32, i32, i32); 6] =
        [(5, 5, 3), (60, 60, 7), (127, 64, 9), (64, 0, 12), (62, 58, 10), (100, 100, 1)];

    #[test]
    fn explored_chunks_agree_with_a_scan_grow_after_explore_and_come_back_after_a_load() {
        let terrain = small_terrain();
        let mut explored = ExploredTerrain::new(terrain.clone(), &[]);
        assert!(explored.explored_chunks(PLAYER).is_empty());
        let mut seen: Vec<Vec<u32>> = Vec::new();
        for (x, y, r) in LOOKS {
            explored.explore(PLAYER, x, y, r);
            let chunks = explored.explored_chunks(PLAYER);
            assert_eq!(chunks, scanned_chunks(&explored, terrain.size));
            seen.push(chunks);
        }
        assert!(seen.last().unwrap().len() > seen[0].len());

        let saved = explored.bitmap(PLAYER).unwrap().to_vec();
        let loaded = ExploredTerrain::from_bitmaps(terrain, &[], [(PLAYER, saved)]);
        assert_eq!(loaded.explored_chunks(PLAYER), explored.explored_chunks(PLAYER));
    }

    #[test]
    fn explored_chunks_come_back_the_same_on_a_map_whose_side_is_not_a_whole_number_of_bytes() {
        let odd = TerrainMap { size: 77, tiles: vec![0; 77 * 77] };
        let mut fresh = ExploredTerrain::new(odd.clone(), &[]);
        for (x, y, r) in LOOKS {
            fresh.explore(PLAYER, x, y, r);
        }
        let saved = fresh.bitmap(PLAYER).unwrap().to_vec();
        let loaded = ExploredTerrain::from_bitmaps(odd.clone(), &[], [(PLAYER, saved)]);
        assert_eq!(loaded.explored_chunks(PLAYER), fresh.explored_chunks(PLAYER));
        assert_eq!(loaded.explored_chunks(PLAYER), scanned_chunks(&fresh, odd.size));
    }

    #[test]
    fn explore_marks_exactly_the_disc_skipping_what_is_already_explored() {
        for map in [small_terrain(), TerrainMap { size: 77, tiles: vec![0; 77 * 77] }] {
            let size = map.size;
            let mut explored = ExploredTerrain::new(map, &[]);
            let mut expected = HashSet::new();
            for (x, y, r) in LOOKS {
                expected.extend(disc(size, x, y, r));
                explored.explore(PLAYER, x, y, r);
            }
            for y in 0..size {
                for x in 0..size {
                    assert_eq!(explored.is_explored(PLAYER, x, y), expected.contains(&(x, y)));
                }
            }
        }
    }

    #[test]
    fn ten_welcomes_on_a_full_size_map_take_well_under_a_second() {
        let full = TerrainMap { size: MAP_SIZE, tiles: vec![0; (MAP_SIZE * MAP_SIZE) as usize] };
        let mut before = ExploredTerrain::new(full.clone(), &[]);
        for i in 0..40 {
            before.explore(PLAYER, (i * 977) % MAP_SIZE, (i * 1931) % MAP_SIZE, SIGHT_RANGE as i32);
        }
        let saved = before.bitmap(PLAYER).unwrap().to_vec();
        // The fastest of three tries of each: a moment of load on a busy machine slows one try,
        // not all three (T89.6), so the times stay a check of the work.
        let fastest = |run: &mut dyn FnMut()| {
            (0..3)
                .map(|_| {
                    let start = std::time::Instant::now();
                    run();
                    start.elapsed().as_millis()
                })
                .min()
                .expect("three tries")
        };
        let mut copies: Vec<_> = (0..3).map(|_| (full.clone(), saved.clone())).collect();
        let mut explored = None;
        let loaded_in = fastest(&mut || {
            let (terrain, bits) = copies.pop().expect("a copy for each try");
            explored = Some(ExploredTerrain::from_bitmaps(terrain, &[], [(PLAYER, bits)]));
        });
        let explored = explored.expect("loaded");
        let welcomed_in = fastest(&mut || {
            for _ in 0..10 {
                std::hint::black_box(explored.explored_chunks(PLAYER));
            }
        });
        assert!(welcomed_in < 100, "{welcomed_in} ms");
        assert!(loaded_in < 1000, "{loaded_in} ms");
        assert_eq!(explored.explored_chunks(PLAYER), before.explored_chunks(PLAYER));
    }

    #[test]
    fn chunks_include_only_nodes_on_tiles_the_player_explored() {
        let nodes = [
            node("n1", ResourceKind::Stone, 40.0, 40.0),
            node("n2", ResourceKind::GoldOre, 50.0, 50.0),
        ];
        let mut explored = ExploredTerrain::new(small_terrain(), &nodes);
        explored.explore(PLAYER, 40, 40, 2);
        let got = decode_chunk(1, 1, &explored.chunk(PLAYER, 1, 1).unwrap()).nodes;
        assert_eq!(got, vec![KnownNode { kind: ResourceKind::Stone, x: 40, y: 40 }]);
        explored.explore(PLAYER, 50, 50, 1);
        assert_eq!(decode_chunk(1, 1, &explored.chunk(PLAYER, 1, 1).unwrap()).nodes.len(), 2);
    }

    #[test]
    fn admin_terrain_gives_any_chunk_whole_with_every_resource_node() {
        let terrain = small_terrain();
        let nodes = [node("n1", ResourceKind::GoldOre, 70.0, 100.0)];
        let explored = ExploredTerrain::new(terrain.clone(), &nodes);
        let chunk = decode_chunk(2, 3, &explored.whole_chunk(2, 3).unwrap());
        assert_eq!(chunk.nodes, vec![KnownNode { kind: ResourceKind::GoldOre, x: 70, y: 100 }]);
        for dy in 0..CHUNK_SIZE {
            for dx in 0..CHUNK_SIZE {
                assert_eq!(
                    chunk.tiles[(dy * CHUNK_SIZE + dx) as usize],
                    terrain_at(&terrain, 64 + dx, 96 + dy)
                );
            }
        }
        assert!(explored.whole_chunk(chunks_across(terrain.size), 0).is_none());
        assert!(explored.whole_chunk(-1, 0).is_none());
    }

    #[test]
    fn downsamples_the_map_to_the_most_common_terrain_of_each_square() {
        // 10 × 10: the overview is 2 × 2, its right and bottom squares only 2 tiles wide or tall.
        let mut tiles = vec![Terrain::Plains as u8; 100];
        for y in 0..8 {
            for x in 0..5 {
                tiles[y * 10 + x] = Terrain::Forest as u8;
            }
        }
        for x in 0..10 {
            tiles[9 * 10 + x] = Terrain::Sea as u8;
        }
        tiles[8 * 10 + 9] = Terrain::Sea as u8;
        assert_eq!(overview_across(10), 2);
        // Top left: 40 forest, 24 plains. Top right: plains. Bottom left: 8 sea and 8 plains, a
        // tie the lower code wins. Bottom right: 3 sea, 1 plains.
        assert_eq!(
            terrain_overview(&TerrainMap { size: 10, tiles }),
            [
                Terrain::Forest as u8,
                Terrain::Plains as u8,
                Terrain::Plains as u8,
                Terrain::Sea as u8
            ]
        );
        let explored = ExploredTerrain::new(small_terrain(), &[]);
        assert_eq!(
            explored.overview().len(),
            (overview_across(128) * overview_across(128)) as usize
        );
    }

    #[test]
    fn answers_many_explored_chunks_in_one_body_and_leaves_the_unexplored_ones_out() {
        let terrain = small_terrain();
        let mut explored = ExploredTerrain::new(terrain.clone(), &[]);
        // Around (32, 32): tiles in chunks (0, 0), (1, 0), (0, 1) and (1, 1) of the 4-across map.
        explored.explore(PLAYER, 32, 32, 2);
        let n = i64::from(chunks_across(terrain.size));
        // Asked in this order, with an unexplored chunk, one off the map, a negative and a repeat.
        let body = explored.chunks(PLAYER, &[n + 1, 0, 2 * n + 2, n * n, -1, n + 1]);
        let batch = decode_chunk_batch(&body);
        assert_eq!(batch.iter().map(|(i, _)| i64::from(*i)).collect::<Vec<_>>(), [n + 1, 0]);
        assert_eq!(Some(&batch[0].1), explored.chunk(PLAYER, 1, 1).as_ref());
        assert_eq!(Some(&batch[1].1), explored.chunk(PLAYER, 0, 0).as_ref());

        assert!(explored.chunks(PLAYER, &[2 * n + 2]).is_empty());
        assert!(explored.chunks(OTHER, &[0]).is_empty());
    }

    /// Bytes the TypeScript `ExploredTerrain` gives for the same map, nodes and looks (the
    /// `scripts` one-off in the PR body): `(x * 7 + y * 3) % 6` terrain, 128 across.
    #[test]
    fn serves_the_bytes_the_typescript_serves() {
        let nodes = [
            node("n1", ResourceKind::Stone, 40.0, 40.0),
            node("n2", ResourceKind::GoldOre, 50.0, 50.0),
        ];
        let mut explored = ExploredTerrain::new(small_terrain(), &nodes);
        explored.explore(PLAYER, 40, 40, 2);
        explored.explore(PLAYER, 50, 50, 1);
        explored.explore(PLAYER, 127, 64, 9);
        let chunk = explored.chunk(PLAYER, 1, 1).unwrap();
        assert_eq!((chunk.len(), fnv1a(&chunk)), (CHUNK_TILES + 6, TS_CHUNK_HASH));
        assert_eq!(chunk[CHUNK_TILES..], [8, 8, 1, 18, 18, 3]);
        assert_eq!(fnv1a(&explored.whole_chunk(3, 2).unwrap()), TS_WHOLE_HASH);
        assert_eq!(fnv1a(explored.bitmap(PLAYER).unwrap()), TS_BITMAP_HASH);
        assert_eq!(explored.explored_chunks(PLAYER), TS_CHUNKS);
        let body = explored.chunks(PLAYER, &[5, 0, 12, 3]);
        assert_eq!(fnv1a(&body), TS_BATCH_HASH);
    }

    const TS_CHUNK_HASH: u32 = 2_719_346_921;
    const TS_WHOLE_HASH: u32 = 1_407_139_589;
    const TS_BITMAP_HASH: u32 = 3_245_298_367;
    const TS_BATCH_HASH: u32 = 4_241_600_182;
    const TS_CHUNKS: [u32; 5] = [4, 5, 7, 8, 11];
}

#[cfg(test)]
mod coarse_tests;
