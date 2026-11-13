//! Terrain served to clients in chunks (ADR 0006): the constants, sizes and the chunk encoding of
//! `packages/shared/src/chunks.ts` and `terrain.ts`, byte for byte.

use crate::world::ResourceKind;
use ts_rs::TS;

/// Terrain is served to clients in square chunks of this many tiles a side (ADR 0006).
pub const CHUNK_SIZE: i32 = 32;

/// Tiles in one chunk.
pub const CHUNK_TILES: usize = (CHUNK_SIZE * CHUNK_SIZE) as usize;

/// The byte for a tile in a served chunk that the Player hasn't explored.
pub const UNEXPLORED: u8 = 254;

/// Tiles a side that one byte of the admin terrain overview stands for.
pub const OVERVIEW_SCALE: i32 = 8;

/// Resource node kinds by the byte that stands for them in a served chunk. Only add to the end.
pub const NODE_KINDS: [&str; 4] = ["forest", "stone", "ironOre", "goldOre"];

/// Where the client loads many chunks of explored terrain in one request: a `POST` whose JSON body
/// is `{ chunks: number[] }`, chunk indices as in [`chunks_across`], at most [`TERRAIN_BATCH_MAX`]
/// of them. The answer is [`encode_chunk_batch`]: the explored ones among them, unexplored left out.
pub const TERRAIN_BATCH_PATH: &str = "/api/terrain/chunks";

/// The most chunks one [`TERRAIN_BATCH_PATH`] request may ask for.
pub const TERRAIN_BATCH_MAX: usize = 64;

/// The coarsest level explored terrain is served at (ADR 0034). At level `k` one byte stands for
/// a square of `2^k × 2^k` tiles and a chunk is `CHUNK_SIZE × CHUNK_SIZE` such squares; level 0 is
/// one byte a tile. A [`TERRAIN_BATCH_PATH`] request names its level as `level`, 0 if none.
pub const TERRAIN_LEVEL_MAX: u8 = 5;

/// Where an admin loads the whole map's terrain for the far zoom: `overview_across(size)`² bytes,
/// row-major, each the most common terrain of its `OVERVIEW_SCALE`² tiles.
pub const ADMIN_TERRAIN_OVERVIEW_PATH: &str = "/api/admin/terrain/overview";

/// How many chunks fit across the map. Chunk `i` is at `(i % n, ⌊i / n⌋)`.
pub fn chunks_across(size: i32) -> i32 {
    (size + CHUNK_SIZE - 1).div_euclid(CHUNK_SIZE)
}

/// A Player's explored chunks with how many of each one's tiles they explored, as the welcome and
/// the tick send them (ADR 0034): for each chunk in index order, the step from the index before
/// (from 0 for the first) and its count, flat in one list. Terrain never changes and explored
/// terrain only grows, so a chunk at the same count is the same bytes, and the client's cache
/// keys on it. A coarse chunk's count is the sum over the level-0 chunks in it.
pub fn encode_explored_counts(counts: impl IntoIterator<Item = (u32, u16)>) -> Vec<u32> {
    let mut out = Vec::new();
    let mut last = 0;
    for (index, count) in counts {
        out.push(index - last);
        out.push(u32::from(count));
        last = index;
    }
    out
}

/// The chunks and counts of an [`encode_explored_counts`] list.
pub fn decode_explored_counts(list: &[u32]) -> Vec<(u32, u16)> {
    let mut at = 0;
    list.as_chunks::<2>()
        .0
        .iter()
        .map(|&[step, count]| {
            at += step;
            (at, count as u16)
        })
        .collect()
}

/// How many squares of `level` fit across the map: the last one may reach past its side.
pub fn squares_across(size: i32, level: u8) -> i32 {
    let side = 1 << level;
    (size + side - 1).div_euclid(side)
}

/// How many chunks of `level` fit across the map (level 0 is [`chunks_across`]). Chunk `i` of a
/// level is at `(i % n, ⌊i / n⌋)`; squares past the map's side are padding.
pub fn level_chunks_across(size: i32, level: u8) -> i32 {
    (squares_across(size, level) + CHUNK_SIZE - 1).div_euclid(CHUNK_SIZE)
}

/// How many overview bytes fit across the map.
pub fn overview_across(size: i32) -> i32 {
    (size + OVERVIEW_SCALE - 1).div_euclid(OVERVIEW_SCALE)
}

/// Where the client loads one chunk of explored terrain: `CHUNK_SIZE`² bytes, row-major.
pub fn terrain_chunk_path(cx: i32, cy: i32) -> String {
    format!("/api/terrain/{cx}/{cy}")
}

/// Where an admin loads any chunk of terrain, explored or not (`CONTEXT.md`: admin map): the same
/// format as `terrain_chunk_path`, with every tile and every resource node in it.
pub fn admin_terrain_chunk_path(cx: i32, cy: i32) -> String {
    format!("/api/admin/terrain/{cx}/{cy}")
}

/// A resource node as a Player knows it from explored terrain, in map coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, TS)]
pub struct KnownNode {
    pub kind: ResourceKind,
    pub x: i32,
    pub y: i32,
}

/// One chunk of explored terrain as the client gets it.
#[derive(Debug, Clone, PartialEq, Eq, TS)]
pub struct TerrainChunk {
    pub cx: i32,
    pub cy: i32,
    /// `CHUNK_TILES` terrain bytes, row-major; `UNEXPLORED` where the Player hasn't been.
    #[ts(type = "Uint8Array")]
    pub tiles: Vec<u8>,
    /// Resource nodes on explored tiles of this chunk, in map coordinates.
    pub nodes: Vec<KnownNode>,
}

/// The index of a node kind in [`NODE_KINDS`], the byte that stands for it in a chunk.
pub fn node_kind_index(kind: ResourceKind) -> u8 {
    match kind {
        ResourceKind::Forest => 0,
        ResourceKind::Stone => 1,
        ResourceKind::IronOre => 2,
        ResourceKind::GoldOre => 3,
    }
}

fn node_kind_from_index(index: u8) -> Option<ResourceKind> {
    Some(match index {
        0 => ResourceKind::Forest,
        1 => ResourceKind::Stone,
        2 => ResourceKind::IronOre,
        3 => ResourceKind::GoldOre,
        _ => return None,
    })
}

/// A chunk as served from [`terrain_chunk_path`]: the `CHUNK_TILES` terrain bytes, then three bytes
/// per resource node (x and y within the chunk, and its kind's index in [`NODE_KINDS`]).
pub fn encode_chunk(tiles: &[u8], nodes: &[KnownNode], cx: i32, cy: i32) -> Vec<u8> {
    let mut out = Vec::with_capacity(tiles.len() + nodes.len() * 3);
    out.extend_from_slice(tiles);
    for n in nodes {
        // Like a `Uint8Array` store: a coordinate outside the chunk keeps its low byte.
        out.push((n.x - cx * CHUNK_SIZE) as u8);
        out.push((n.y - cy * CHUNK_SIZE) as u8);
        out.push(node_kind_index(n.kind));
    }
    out
}

/// Many chunks in one body, as served from [`TERRAIN_BATCH_PATH`]: for each, its index (see
/// [`chunks_across`]) and the length of its bytes, both unsigned 32-bit little-endian, then the
/// bytes [`encode_chunk`] gives.
pub fn encode_chunk_batch(chunks: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(chunks.iter().map(|(_, b)| 8 + b.len()).sum());
    for (index, bytes) in chunks {
        out.extend_from_slice(&index.to_le_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(bytes);
    }
    out
}

/// The chunks of an [`encode_chunk_batch`] body, each as its index and its [`encode_chunk`] bytes.
/// A truncated last chunk is dropped, like the TypeScript does.
pub fn decode_chunk_batch(body: &[u8]) -> Vec<(u32, Vec<u8>)> {
    let mut chunks = Vec::new();
    let mut at = 0usize;
    while at + 8 <= body.len() {
        let index = u32::from_le_bytes(body[at..at + 4].try_into().unwrap());
        let length = u32::from_le_bytes(body[at + 4..at + 8].try_into().unwrap()) as usize;
        if at + 8 + length > body.len() {
            break;
        }
        chunks.push((index, body[at + 8..at + 8 + length].to_vec()));
        at += 8 + length;
    }
    chunks
}

/// Reads an [`encode_chunk`] chunk. Nodes of an unknown kind are skipped.
pub fn decode_chunk(cx: i32, cy: i32, bytes: &[u8]) -> TerrainChunk {
    let mut nodes = Vec::new();
    let mut at = CHUNK_TILES;
    while at + 2 < bytes.len() {
        if let Some(kind) = node_kind_from_index(bytes[at + 2]) {
            nodes.push(KnownNode {
                kind,
                x: cx * CHUNK_SIZE + i32::from(bytes[at]),
                y: cy * CHUNK_SIZE + i32::from(bytes[at + 1]),
            });
        }
        at += 3;
    }
    TerrainChunk { cx, cy, tiles: bytes[..CHUNK_TILES.min(bytes.len())].to_vec(), nodes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance::MAP_SIZE;
    use crate::terrain::Terrain;

    #[test]
    fn keeps_the_served_sizes() {
        assert_eq!(CHUNK_SIZE, 32);
        assert_eq!(UNEXPLORED, 254);
        assert_eq!(OVERVIEW_SCALE, 8);
        assert_eq!(NODE_KINDS, ["forest", "stone", "ironOre", "goldOre"]);
        assert_eq!(TERRAIN_BATCH_MAX, 64);
        assert_eq!(TERRAIN_LEVEL_MAX, 5);
    }

    #[test]
    fn counts_chunks_and_overview_bytes_across_the_map() {
        assert_eq!(chunks_across(MAP_SIZE), 180);
        assert_eq!(chunks_across(33), 2);
        assert_eq!(chunks_across(32), 1);
        assert_eq!(overview_across(MAP_SIZE), 720);
        assert_eq!(overview_across(9), 2);
        assert_eq!(level_chunks_across(MAP_SIZE, 0), 180);
        assert_eq!(level_chunks_across(MAP_SIZE, 3), 23);
        assert_eq!(level_chunks_across(MAP_SIZE, 5), 6);
        assert_eq!(squares_across(MAP_SIZE, 5), 180);
        assert_eq!(squares_across(9, 1), 5);
    }

    #[test]
    fn explored_counts_go_as_steps_and_come_back() {
        let counts = [(3, 1024), (4, 12), (180, 1), (32_399, 1024)];
        let list = encode_explored_counts(counts);
        assert_eq!(list, [3, 1024, 1, 12, 176, 1, 32_219, 1024]);
        assert_eq!(decode_explored_counts(&list), counts);
        assert!(encode_explored_counts([]).is_empty());
    }

    #[test]
    fn names_the_paths() {
        assert_eq!(terrain_chunk_path(2, 3), "/api/terrain/2/3");
        assert_eq!(admin_terrain_chunk_path(0, 1), "/api/admin/terrain/0/1");
        assert_eq!(TERRAIN_BATCH_PATH, "/api/terrain/chunks");
    }

    #[test]
    fn node_kind_indices_follow_node_kinds() {
        for (i, name) in NODE_KINDS.iter().enumerate() {
            let kind: ResourceKind = serde_json::from_str(&format!("\"{name}\"")).unwrap();
            assert_eq!(usize::from(node_kind_index(kind)), i);
        }
    }

    #[test]
    fn round_trips_terrain_and_resource_nodes() {
        let mut tiles = vec![Terrain::Forest as u8; CHUNK_TILES];
        tiles[5] = Terrain::Hills as u8;
        let nodes = [
            KnownNode { kind: ResourceKind::Forest, x: 64, y: 96 },
            KnownNode { kind: ResourceKind::GoldOre, x: 95, y: 127 },
        ];
        let bytes = encode_chunk(&tiles, &nodes, 2, 3);
        assert_eq!(bytes.len(), CHUNK_TILES + 6);
        // The layout the TypeScript writes: x and y within the chunk, then the kind's index.
        assert_eq!(bytes[CHUNK_TILES..], [0, 0, 0, 31, 31, 3]);
        assert_eq!(
            decode_chunk(2, 3, &bytes),
            TerrainChunk { cx: 2, cy: 3, tiles, nodes: nodes.to_vec() }
        );
    }

    #[test]
    fn reads_a_chunk_without_nodes() {
        let tiles = vec![0u8; CHUNK_TILES];
        assert!(decode_chunk(0, 0, &tiles).nodes.is_empty());
    }

    #[test]
    fn puts_many_chunks_in_one_body_each_with_its_index_and_length_in_front() {
        let a = vec![1u8, 2, 3];
        let b = vec![7u8; CHUNK_TILES + 3];
        let body = encode_chunk_batch(&[(70000, a.clone()), (5, b.clone())]);
        assert_eq!(body.len(), 8 + 3 + 8 + b.len());
        // Little-endian: index 70000 is 0x00011170.
        assert_eq!(body[..11], [0x70, 0x11, 0x01, 0, 3, 0, 0, 0, 1, 2, 3]);
        assert_eq!(decode_chunk_batch(&body), vec![(70000, a), (5, b)]);
        assert!(decode_chunk_batch(&[]).is_empty());
    }
}
