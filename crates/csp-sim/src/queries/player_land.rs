//! The land as a Player knows it (`CONTEXT.md`: Region, Explored terrain): a Player knows the
//! region of every tile they have explored, so the map writes the names of the regions they have
//! explored part of, marks the passes and land bridges they have explored, and the tile card names
//! a tile's region. Nothing of land they have not explored goes to them: no region's name, no way.
//!
//! It travels per chunk, as the Region map does (`RegionChunk`): runs of one region along each
//! chunk's rows, by region id, `-1` for water and for tiles the Player hasn't explored.

use std::collections::BTreeSet;

use csp_shared::chunks::chunks_across;
use csp_shared::terrain::tile_index;
use serde::Serialize;
use ts_rs::TS;

use super::region_map::{chunk_box, RegionChunk};
use crate::regions::{RegionKind, Regions, WayKind};

/// Where a Player loads the land they know (`PlayerLand`): `POST` with `chunks`, the chunk
/// indices to send, or without it for every chunk they explored part of.
pub const LAND_PATH: &str = "/api/land";

/// A region a Player explored part of: its id (as the runs name it), kind and name.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LandRegion {
    pub id: u32,
    pub kind: RegionKind,
    pub name: String,
}

/// A pass or land bridge a Player explored part of: where to mark it (its middle tile when they
/// explored that, else the first of its tiles they did) and the tiles of it they explored, by
/// `y * size + x`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LandWay {
    pub kind: WayKind,
    pub x: i32,
    pub y: i32,
    pub tiles: Vec<u32>,
}

/// The land a Player knows in some chunks (`PlayerLand`): each chunk's regions as runs, the
/// regions those runs name, and every pass and land bridge they explored part of.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLand {
    pub regions: Vec<LandRegion>,
    pub ways: Vec<LandWay>,
    pub chunks: Vec<RegionChunk>,
}

/// The land a Player knows in `chunks` (`playerLand`), by whether they explored a tile: a chunk
/// they explored nothing of is left out.
pub fn player_land(
    regions: &Regions,
    explored: &dyn Fn(i32, i32) -> bool,
    chunks: &[u32],
) -> PlayerLand {
    let size = regions.size;
    let across = chunks_across(size) as u32;
    let mut named = BTreeSet::new();
    let mut out = Vec::new();
    for &chunk in chunks.iter().filter(|&&c| c < across * across) {
        let chunk = chunk as i32;
        let (x0, y0, w, h) = chunk_box(chunk, size);
        let mut runs: Vec<i32> = Vec::new();
        let mut any = false;
        for i in 0..w * h {
            let (x, y) = (x0 + i % w, y0 + i / w);
            let id = match explored(x, y) {
                true => regions.id_at(x, y).map_or(-1, |id| id as i32),
                false => -1,
            };
            if id >= 0 {
                any = true;
                named.insert(id as u32);
            }
            match runs.as_mut_slice() {
                [.., len, last] if *last == id => *len += 1,
                _ => runs.extend([1, id]),
            }
        }
        if any {
            out.push(RegionChunk { chunk, runs });
        }
    }
    let regions_named = named
        .into_iter()
        .filter_map(|id| regions.region(id))
        .map(|r| LandRegion { id: r.id, kind: r.kind, name: r.name.clone() })
        .collect();
    PlayerLand { regions: regions_named, ways: known_ways(regions, explored), chunks: out }
}

/// Every pass and land bridge the Player explored part of.
fn known_ways(regions: &Regions, explored: &dyn Fn(i32, i32) -> bool) -> Vec<LandWay> {
    let size = regions.size;
    let mut out = Vec::new();
    for way in &regions.ways {
        let tiles: Vec<u32> = way
            .tiles
            .iter()
            .map(|&t| t as u32)
            .filter(|&t| explored(t as i32 % size, t as i32 / size))
            .collect();
        let Some(&first) = tiles.first() else { continue };
        let (x, y) = match explored(way.x, way.y) {
            true => (way.x, way.y),
            false => (first as i32 % size, first as i32 / size),
        };
        out.push(LandWay { kind: way.kind, x, y, tiles });
    }
    out
}

/// Whether a Player explored tile (x, y), from their explored bitmap (`ExploredTerrain::bitmap`)
/// on a map of `size`.
pub fn explored_in(bitmap: &[u8], size: i32, x: i32, y: i32) -> bool {
    let t = tile_index(size, x, y);
    bitmap.get(t >> 3).is_some_and(|b| b & (1 << (t & 7)) != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain_gen::generate_terrain;

    const SIZE: i32 = 256;

    fn all_chunks() -> Vec<u32> {
        let across = chunks_across(SIZE) as u32;
        (0..across * across).collect()
    }

    /// The tiles within `radius` of (x, y), as a Player's explored land.
    fn around(x: i32, y: i32, radius: i32) -> impl Fn(i32, i32) -> bool {
        move |tx, ty| (tx - x).abs() <= radius && (ty - y).abs() <= radius
    }

    #[test]
    fn sends_only_the_regions_and_ways_of_explored_land() {
        let map = generate_terrain(1, SIZE);
        let regions = Regions::of(1, &map);
        let heartland = regions.of_kind(RegionKind::Heartland).next().expect("a heartland");
        let explored = around(heartland.x, heartland.y, 2);
        let land = player_land(&regions, &explored, &all_chunks());
        assert_eq!(
            land.regions,
            [LandRegion {
                id: heartland.id,
                kind: RegionKind::Heartland,
                name: heartland.name.clone()
            }]
        );
        // One chunk (or a few at a chunk's edge), its explored tiles the heartland's, the rest -1.
        assert!(!land.chunks.is_empty() && land.chunks.len() <= 4);
        let mut named = 0;
        for c in &land.chunks {
            let (x0, y0, w, _) = chunk_box(c.chunk, SIZE);
            let mut at = 0;
            for run in c.runs.chunks(2) {
                for i in at..at + run[0] {
                    let (x, y) = (x0 + i % w, y0 + i / w);
                    let id = if explored(x, y) {
                        regions.id_at(x, y).map_or(-1, |r| r as i32)
                    } else {
                        -1
                    };
                    assert_eq!(run[1], id, "tile ({x}, {y})");
                }
                named += if run[1] >= 0 { run[0] } else { 0 };
                at += run[0];
            }
        }
        let land_tiles = (-2..=2)
            .flat_map(|dy| (-2..=2).map(move |dx| (dx, dy)))
            .filter(|(dx, dy)| regions.id_at(heartland.x + dx, heartland.y + dy).is_some())
            .count();
        assert_eq!(named as usize, land_tiles, "the land of the 5 by 5 tiles around its middle");
        // No pass or land bridge so deep inside a heartland.
        assert_eq!(land.ways, []);
        // Nothing explored, nothing sent.
        let none = player_land(&regions, &|_, _| false, &all_chunks());
        assert_eq!(none, PlayerLand { regions: vec![], ways: vec![], chunks: vec![] });
    }

    #[test]
    fn marks_a_way_once_a_tile_of_it_is_explored() {
        let map = generate_terrain(1, SIZE);
        let regions = Regions::of(1, &map);
        let way = regions.ways.first().expect("a way");
        let explored = around(way.x, way.y, 1);
        let land = player_land(&regions, &explored, &all_chunks());
        let marked: Vec<&LandWay> =
            land.ways.iter().filter(|w| (w.x, w.y) == (way.x, way.y)).collect();
        assert_eq!(marked.len(), 1);
        assert_eq!(marked[0].kind, way.kind);
        assert!(!marked[0].tiles.is_empty());
        assert!(marked[0].tiles.iter().all(|&t| explored(t as i32 % SIZE, t as i32 / SIZE)));
        // Both regions it joins are named, and only regions with an explored tile are.
        for id in way.between {
            assert!(land.regions.iter().any(|r| r.id == id), "region {id}");
        }
        // Asking for some chunks sends only those.
        let one = land.chunks[0].chunk as u32;
        let part = player_land(&regions, &explored, &[one]);
        assert_eq!(part.chunks.len(), 1);
        assert_eq!(part.chunks[0], land.chunks[0]);
    }

    #[test]
    fn reads_a_bitmap() {
        let mut bits = vec![0u8; (SIZE * SIZE / 8) as usize];
        let t = tile_index(SIZE, 3, 2);
        bits[t >> 3] |= 1 << (t & 7);
        assert!(explored_in(&bits, SIZE, 3, 2));
        assert!(!explored_in(&bits, SIZE, 2, 3));
    }
}
