//! Coarse levels of explored terrain (ADR 0034, T99.5): a square shows only what the Player
//! explored of it.

use csp_shared::chunks::{decode_chunk_batch, level_chunks_across, squares_across};
use csp_shared::terrain::{Terrain, TerrainMap};

use super::*;
use crate::random::Mulberry32;

const PLAYER: u64 = 7;

fn map(size: i32, at: impl Fn(i32, i32) -> Terrain) -> TerrainMap {
    let tiles = (0..size * size).map(|t| at(t % size, t / size) as u8).collect();
    TerrainMap { size, tiles }
}

/// The byte for square (sx, sy) of `level`, from the coarse chunk holding it.
fn square(explored: &ExploredTerrain, level: u8, sx: i32, sy: i32) -> Option<u8> {
    let (cx, cy) = (sx / CHUNK_SIZE, sy / CHUNK_SIZE);
    let chunk = explored.coarse_chunk(PLAYER, level, cx, cy)?;
    Some(chunk[((sy % CHUNK_SIZE) * CHUNK_SIZE + sx % CHUNK_SIZE) as usize])
}

#[test]
fn a_square_is_the_most_common_terrain_the_player_explored_in_it_the_lower_code_on_a_tie() {
    // Square (0, 0) of level 1: Forest and Hills on the diagonals.
    let terrain = map(64, |x, y| if (x + y) % 2 == 0 { Terrain::Forest } else { Terrain::Hills });
    let mut explored = ExploredTerrain::new(terrain, &[]);
    explored.explore(PLAYER, 0, 0, 0);
    explored.explore(PLAYER, 1, 0, 0);
    // One Forest, one Hills: the lower code.
    assert_eq!(square(&explored, 1, 0, 0), Some(Terrain::Forest as u8));
    explored.explore(PLAYER, 0, 1, 0);
    assert_eq!(square(&explored, 1, 0, 0), Some(Terrain::Hills as u8));
    // The square beside it: nothing explored.
    assert_eq!(square(&explored, 1, 1, 0), Some(UNEXPLORED));
    // Only what was explored counts, not the square's whole terrain: a lone Plains tile among
    // Sea shows Plains at every level.
    let sea = map(64, |x, y| if (x, y) == (5, 9) { Terrain::Plains } else { Terrain::Sea });
    let mut lone = ExploredTerrain::new(sea, &[]);
    lone.explore(PLAYER, 5, 9, 0);
    for level in 1..=TERRAIN_LEVEL_MAX {
        assert_eq!(square(&lone, level, 5 >> level, 9 >> level), Some(Terrain::Plains as u8));
    }
}

#[test]
fn a_single_explored_tile_colours_its_square_at_every_level_and_nothing_else() {
    let codes = [Terrain::Plains, Terrain::Forest, Terrain::Lake];
    let terrain = map(256, |x, y| codes[((x * 7 + y * 3) % 3) as usize]);
    let (x, y) = (200, 77);
    let expected = terrain.tiles[(y * 256 + x) as usize];
    let mut explored = ExploredTerrain::new(terrain, &[]);
    explored.explore(PLAYER, x, y, 0);
    for level in 1..=TERRAIN_LEVEL_MAX {
        let (sx, sy) = (x >> level, y >> level);
        let (cx, cy) = (sx / CHUNK_SIZE, sy / CHUNK_SIZE);
        let chunk = explored.coarse_chunk(PLAYER, level, cx, cy).unwrap();
        for (i, &b) in chunk.iter().enumerate() {
            let i = i as i32;
            let here = (cx * CHUNK_SIZE + i % CHUNK_SIZE, cy * CHUNK_SIZE + i / CHUNK_SIZE);
            let want = if here == (sx, sy) { expected } else { UNEXPLORED };
            assert_eq!(b, want, "level {level} square {here:?}");
        }
    }
}

#[test]
fn the_last_chunks_of_a_level_are_padded_not_joined() {
    // 150 tiles across: the last level-5 square holds 22 columns of Sea, and the Mountain across
    // the join is not in it.
    let size = 150;
    let terrain = map(size, |x, _| if x >= 128 { Terrain::Sea } else { Terrain::Mountain });
    let mut whole = ExploredTerrain::new(terrain.clone(), &[]);
    whole.explore_all(PLAYER);
    // The same through squares counted tile by tile: every chunk misses a tile in its corner.
    let mut partly = ExploredTerrain::new(terrain, &[]);
    partly.explore_all(PLAYER);
    let mut bits = partly.bitmap(PLAYER).unwrap().to_vec();
    for cy in 0..5 {
        for cx in 0..5 {
            let t = (cy * 32 * size + cx * 32) as usize;
            bits[t >> 3] &= !(1 << (t & 7));
        }
    }
    let partly = ExploredTerrain::from_bitmaps(partly.terrain.clone(), &[], [(PLAYER, bits)]);
    for explored in [&whole, &partly] {
        for level in 3..=TERRAIN_LEVEL_MAX {
            let squares = squares_across(size, level);
            let across = level_chunks_across(size, level);
            assert!(across * CHUNK_SIZE > squares, "level {level} has padding");
            let last = squares - 1;
            assert_eq!(square(explored, level, last, 0), Some(Terrain::Sea as u8), "{level}");
            assert_eq!(square(explored, level, 0, last), Some(Terrain::Mountain as u8));
            for (sx, sy) in [(squares, 0), (0, squares), (across * CHUNK_SIZE - 1, last)] {
                assert_eq!(square(explored, level, sx, sy), Some(UNEXPLORED), "level {level}");
            }
        }
    }
    assert_eq!(whole.tiles_read(), 0);
    assert!(partly.tiles_read() > 0);
}

#[test]
fn leaves_out_unexplored_coarse_chunks_and_refuses_unknown_levels() {
    let terrain = map(512, |_, _| Terrain::Plains);
    let mut explored = ExploredTerrain::new(terrain, &[]);
    explored.explore(PLAYER, 10, 10, 3);
    let n = i64::from(level_chunks_across(512, 1));
    let body = explored.chunks_at(PLAYER, 1, &[n * n - 1, 0, 5, n * n, -1, 0]);
    let batch = decode_chunk_batch(&body);
    assert_eq!(batch.iter().map(|(i, b)| (*i, b.len())).collect::<Vec<_>>(), [(0, CHUNK_TILES)]);
    assert!(explored.chunks_at(8, 1, &[0]).is_empty());
    assert_eq!(explored.coarse_chunk(PLAYER, 0, 0, 0), None);
    assert_eq!(explored.coarse_chunk(PLAYER, TERRAIN_LEVEL_MAX + 1, 0, 0), None);
    assert_eq!(explored.coarse_chunk(PLAYER, 1, n as i32, 0), None);
    // Level 0 is today's batch.
    assert_eq!(explored.chunks_at(PLAYER, 0, &[0]), explored.chunks(PLAYER, &[0]));
}

#[test]
fn coarse_chunks_are_sound_on_random_explored_terrain() {
    let mut rand = Mulberry32::new(99.0);
    let size = 200;
    let codes = [Terrain::Plains, Terrain::Forest, Terrain::Hills, Terrain::Mountain, Terrain::Sea];
    let tiles = (0..size * size).map(|_| codes[(rand.next() * 5.0) as usize] as u8).collect();
    let mut explored = ExploredTerrain::new(TerrainMap { size, tiles }, &[]);
    for _ in 0..12 {
        let (x, y) = ((rand.next() * 200.0) as i32, (rand.next() * 200.0) as i32);
        explored.explore(PLAYER, x, y, (rand.next() * 40.0) as i32);
    }
    let mut served = 0;
    for level in 1..=TERRAIN_LEVEL_MAX {
        let across = level_chunks_across(size, level);
        for cy in 0..across {
            for cx in 0..across {
                let bytes = match explored.coarse_chunk(PLAYER, level, cx, cy) {
                    Some(bytes) => {
                        served += 1;
                        bytes
                    }
                    // Left out: nothing in it may be explored.
                    None => vec![UNEXPLORED; CHUNK_TILES],
                };
                let wrong = explored.coarse_chunk_unsound(PLAYER, level, cx, cy, &bytes);
                assert!(wrong.is_empty(), "{wrong:?}");
            }
        }
    }
    assert!(served > 5);
    // A square showing terrain where nothing was explored is caught.
    let mut bad = explored.coarse_chunk(PLAYER, 5, 0, 0).unwrap();
    let i = bad.iter().position(|&b| b == UNEXPLORED).unwrap();
    bad[i] = Terrain::Plains as u8;
    assert!(!explored.coarse_chunk_unsound(PLAYER, 5, 0, 0, &bad).is_empty());
}

#[test]
fn a_batch_over_fully_explored_chunks_reads_no_tiles() {
    let terrain =
        map(320, |x, y| if (x / 7 + y / 5) % 2 == 0 { Terrain::Forest } else { Terrain::Lake });
    let mut explored = ExploredTerrain::new(terrain, &[]);
    explored.explore_all(PLAYER);
    for level in 1..=TERRAIN_LEVEL_MAX {
        let n = i64::from(level_chunks_across(320, level));
        let all: Vec<i64> = (0..n * n).collect();
        for batch in all.chunks(64) {
            let body = explored.chunks_at(PLAYER, level, batch);
            assert_eq!(decode_chunk_batch(&body).len(), batch.len());
        }
    }
    assert_eq!(explored.tiles_read(), 0);
    // Partly explored chunks are counted tile by tile, and agree with the bitmap.
    let mut partly = ExploredTerrain::new(explored.terrain.clone(), &[]);
    partly.explore(PLAYER, 100, 100, 120);
    for level in 1..=TERRAIN_LEVEL_MAX {
        let across = level_chunks_across(320, level);
        for c in 0..across * across {
            let (cx, cy) = (c % across, c / across);
            let bytes =
                partly.coarse_chunk(PLAYER, level, cx, cy).unwrap_or(vec![UNEXPLORED; CHUNK_TILES]);
            assert!(partly.coarse_chunk_unsound(PLAYER, level, cx, cy, &bytes).is_empty());
        }
    }
    assert!(partly.tiles_read() > 0);
}
