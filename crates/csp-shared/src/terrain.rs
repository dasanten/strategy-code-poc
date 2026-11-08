//! Terrain (`CONTEXT.md`: Terrain, Map): the byte stored per tile and the helpers that take
//! coordinates round the map's joins. Ported from `packages/shared/src/terrain.ts`.
//!
//! Tile coordinates and the map's size are `i32`: a grid of whole tiles, which may be negative
//! before `wrap` brings them back. The speeds and food costs per terrain are in
//! [`crate::balance`] (`TERRAIN_SPEED`, `TERRAIN_FOOD`, `CARRIAGE_SPEED`), where `balance.ts`
//! has them.

use std::collections::HashSet;

/// Terrain types (`CONTEXT.md`: Terrain) as the byte stored per tile. These codes are persisted,
/// so never renumber them; only add new ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Terrain {
    Plains = 0,
    Forest = 1,
    Hills = 2,
    Mountain = 3,
    Lake = 4,
    Sea = 5,
    /// A finished road (`CONTEXT.md`: Road). Never stored in the map: roads are built on top of the
    /// terrain, and `ground_at` gives this for a tile with a road on it.
    Road = 6,
}

impl Terrain {
    /// The terrain a stored byte stands for, if it is one of the codes above.
    pub fn from_byte(byte: u8) -> Option<Terrain> {
        Some(match byte {
            0 => Terrain::Plains,
            1 => Terrain::Forest,
            2 => Terrain::Hills,
            3 => Terrain::Mountain,
            4 => Terrain::Lake,
            5 => Terrain::Sea,
            6 => Terrain::Road,
            _ => return None,
        })
    }
}

/// The map's terrain (`CONTEXT.md`: Map): a `size` × `size` grid, row-major
/// (`tiles[y * size + x]`), whose opposite sides join. Every tile exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainMap {
    pub size: i32,
    pub tiles: Vec<u8>,
}

/// A coordinate brought back onto the map: the sides join, so -1 is `size - 1`.
pub fn wrap(v: i32, size: i32) -> i32 {
    v.rem_euclid(size)
}

/// The shortest signed step from `a` to `b` along one direction of the map, the short way round.
pub fn wrap_delta(a: i32, b: i32, size: i32) -> i32 {
    let d = wrap(b - a, size);
    // `d > size / 2` of the TypeScript, on whole tiles.
    if 2 * d > size {
        d - size
    } else {
        d
    }
}

/// How far a diagonal step is next to a straight one (`CONTEXT.md`: Step).
pub const DIAGONAL_STEP: f64 = std::f64::consts::SQRT_2;

/// How far the step from (ax, ay) to (bx, by) is, the short way round (`CONTEXT.md`: Step): 1
/// straight, `DIAGONAL_STEP` diagonal, and 0 when (bx, by) isn't one of the eight tiles around.
pub fn step_length(size: i32, ax: i32, ay: i32, bx: i32, by: i32) -> f64 {
    let dx = wrap_delta(ax, bx, size).abs();
    let dy = wrap_delta(ay, by, size).abs();
    if dx > 1 || dy > 1 || dx + dy == 0 {
        return 0.0;
    }
    if dx + dy == 2 {
        DIAGONAL_STEP
    } else {
        1.0
    }
}

/// The two straight tiles beside the diagonal step from (ax, ay) to (bx, by), as tile indices:
/// the step can't squeeze between two corners, so both must be steppable too (`CONTEXT.md`: Step).
/// None for a straight step.
pub fn beside_step(size: i32, ax: i32, ay: i32, bx: i32, by: i32) -> Vec<usize> {
    if step_length(size, ax, ay, bx, by) != DIAGONAL_STEP {
        return Vec::new();
    }
    vec![tile_index(size, bx, ay), tile_index(size, ax, by)]
}

/// Straight-line distance between two tiles, the short way round.
pub fn wrap_distance(size: i32, a: (i32, i32), b: (i32, i32)) -> f64 {
    f64::from(wrap_delta(a.0, b.0, size)).hypot(f64::from(wrap_delta(a.1, b.1, size)))
}

/// The index of a tile in `TerrainMap::tiles`, for any coordinates.
pub fn tile_index(size: i32, x: i32, y: i32) -> usize {
    (wrap(y, size) * size + wrap(x, size)) as usize
}

/// The terrain byte at (x, y); coordinates past a side continue on the other.
pub fn terrain_at(map: &TerrainMap, x: i32, y: i32) -> u8 {
    map.tiles[tile_index(map.size, x, y)]
}

/// Lake and Sea can't be entered.
pub fn is_passable_terrain(t: u8) -> bool {
    matches!(
        Terrain::from_byte(t),
        Some(
            Terrain::Plains | Terrain::Forest | Terrain::Hills | Terrain::Mountain | Terrain::Road
        )
    )
}

/// What is underfoot on (x, y) (`CONTEXT.md`: Road): `Terrain::Road` where `roads` (tile indices,
/// from `roadTiles`) holds a finished road, whatever the terrain beneath; elsewhere the terrain.
/// Speed and food use go by this.
pub fn ground_at(map: &TerrainMap, roads: &HashSet<usize>, x: i32, y: i32) -> u8 {
    if roads.contains(&tile_index(map.size, x, y)) {
        Terrain::Road as u8
    } else {
        terrain_at(map, x, y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_never_move() {
        let codes = [
            (Terrain::Plains, 0),
            (Terrain::Forest, 1),
            (Terrain::Hills, 2),
            (Terrain::Mountain, 3),
            (Terrain::Lake, 4),
            (Terrain::Sea, 5),
            (Terrain::Road, 6),
        ];
        for (terrain, byte) in codes {
            assert_eq!(terrain as u8, byte);
            assert_eq!(Terrain::from_byte(byte), Some(terrain));
        }
        assert_eq!(Terrain::from_byte(7), None);
    }

    #[test]
    fn wraps_coordinates_across_the_joins() {
        assert_eq!(wrap(-1, 32), 31);
        assert_eq!(wrap(32, 32), 0);
        assert_eq!(wrap(70, 32), 6);
        assert_eq!(wrap(-33, 32), 31);
    }

    #[test]
    fn takes_the_short_way_round() {
        assert_eq!(wrap_delta(1, 30, 32), -3);
        assert_eq!(wrap_delta(30, 1, 32), 3);
        assert_eq!(wrap_delta(0, 16, 32), 16);
        assert_eq!(wrap_delta(16, 0, 32), 16);
        assert_eq!(wrap_delta(0, 17, 32), -15);
        // An odd size: 3 of 5 is past the half, so the way back is shorter.
        assert_eq!(wrap_delta(0, 2, 5), 2);
        assert_eq!(wrap_delta(0, 3, 5), -2);
    }

    #[test]
    fn measures_distance_and_steps_across_the_joins() {
        assert_eq!(wrap_distance(32, (0, 0), (31, 0)), 1.0);
        assert_eq!(wrap_distance(32, (0, 0), (3, 4)), 5.0);
        assert_eq!(step_length(32, 0, 0, 31, 0), 1.0);
        assert_eq!(step_length(32, 0, 0, 31, 31), DIAGONAL_STEP);
        assert_eq!(step_length(32, 0, 0, 0, 0), 0.0);
        assert_eq!(step_length(32, 0, 0, 2, 0), 0.0);
        assert_eq!(beside_step(32, 0, 0, 1, 1), vec![tile_index(32, 1, 0), tile_index(32, 0, 1)]);
        assert!(beside_step(32, 0, 0, 1, 0).is_empty());
    }

    #[test]
    fn finds_tiles_and_ground() {
        let mut tiles = vec![Terrain::Plains as u8; 16];
        tiles[tile_index(4, 3, 3)] = Terrain::Sea as u8;
        let map = TerrainMap { size: 4, tiles };
        assert_eq!(tile_index(4, -1, -1), 15);
        assert_eq!(terrain_at(&map, -1, -1), Terrain::Sea as u8);
        let roads = HashSet::from([tile_index(4, 3, 3)]);
        assert_eq!(ground_at(&map, &roads, 3, 3), Terrain::Road as u8);
        assert_eq!(ground_at(&map, &roads, 0, 0), Terrain::Plains as u8);
    }

    #[test]
    fn lets_nobody_into_water() {
        for t in
            [Terrain::Plains, Terrain::Forest, Terrain::Hills, Terrain::Mountain, Terrain::Road]
        {
            assert!(is_passable_terrain(t as u8));
        }
        assert!(!is_passable_terrain(Terrain::Lake as u8));
        assert!(!is_passable_terrain(Terrain::Sea as u8));
    }
}
