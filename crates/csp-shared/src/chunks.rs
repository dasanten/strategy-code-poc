//! Terrain served to clients in chunks (ADR 0006): the constants and sizes of
//! `packages/shared/src/chunks.ts` and `terrain.ts`. The chunk encoding (`encodeChunk`,
//! `decodeChunk`) comes with the wire protocol, and its test with it.

/// Terrain is served to clients in square chunks of this many tiles a side (ADR 0006).
pub const CHUNK_SIZE: i32 = 32;

/// The byte for a tile in a served chunk that the Player hasn't explored.
pub const UNEXPLORED: u8 = 254;

/// Tiles a side that one byte of the admin terrain overview stands for.
pub const OVERVIEW_SCALE: i32 = 8;

/// Resource node kinds by the byte that stands for them in a served chunk. Only add to the end.
pub const NODE_KINDS: [&str; 4] = ["forest", "stone", "ironOre", "goldOre"];

/// Where an admin loads the whole map's terrain for the far zoom: `overview_across(size)`² bytes,
/// row-major, each the most common terrain of its `OVERVIEW_SCALE`² tiles.
pub const ADMIN_TERRAIN_OVERVIEW_PATH: &str = "/api/admin/terrain/overview";

/// How many chunks fit across the map. Chunk `i` is at `(i % n, ⌊i / n⌋)`.
pub fn chunks_across(size: i32) -> i32 {
    (size + CHUNK_SIZE - 1).div_euclid(CHUNK_SIZE)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance::MAP_SIZE;

    #[test]
    fn keeps_the_served_sizes() {
        assert_eq!(CHUNK_SIZE, 32);
        assert_eq!(UNEXPLORED, 254);
        assert_eq!(OVERVIEW_SCALE, 8);
        assert_eq!(NODE_KINDS, ["forest", "stone", "ironOre", "goldOre"]);
    }

    #[test]
    fn counts_chunks_and_overview_bytes_across_the_map() {
        assert_eq!(chunks_across(MAP_SIZE), 180);
        assert_eq!(chunks_across(33), 2);
        assert_eq!(chunks_across(32), 1);
        assert_eq!(overview_across(MAP_SIZE), 720);
        assert_eq!(overview_across(9), 2);
    }

    #[test]
    fn names_the_paths() {
        assert_eq!(terrain_chunk_path(2, 3), "/api/terrain/2/3");
        assert_eq!(admin_terrain_chunk_path(0, 1), "/api/admin/terrain/0/1");
    }
}
