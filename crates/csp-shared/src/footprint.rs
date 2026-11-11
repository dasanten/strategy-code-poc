//! Footprints (`CONTEXT.md`: Footprint, At a building): the square of tiles a building covers. A
//! building's `x`, `y` is the north-west tile of its footprint; the footprint runs east and south
//! from there, across the map's joins like everything else, and is never turned.
//!
//! Ported from `packages/shared/src/footprint.ts`. A building kind is its TypeScript name for now
//! (`"farm"`): the `BuildingKind` enum comes with the world types. The map's `size` is always
//! passed, where TypeScript defaults it to `MAP_SIZE`.

use crate::balance::Table;
use crate::terrain::{wrap, wrap_delta};

/// Tiles along each side of each kind's footprint (`CONTEXT.md`: Footprint).
pub const FOOTPRINT: Table<i32> = Table(&[
    ("wall", 1),
    ("gate", 1),
    ("road", 1),
    ("carriage", 1),
    ("house", 2),
    ("storage", 2),
    ("smelter", 2),
    ("mint", 2),
    ("smithy", 2),
    ("mine", 2),
    ("quarry", 2),
    ("lumberCamp", 2),
    ("townHall", 3),
    ("warehouse", 3),
    ("stable", 3),
    ("trainingGround", 3),
    ("haven", 3),
    ("farm", 4),
]);

/// What a footprint is worked out from: a building's kind and its north-west tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placed<'a> {
    pub kind: &'a str,
    pub x: i32,
    pub y: i32,
}

/// The side of a kind's footprint. Panics on a kind that has none: the TypeScript type rules that
/// out, and the `BuildingKind` enum will here.
fn side_of(kind: &str) -> i32 {
    FOOTPRINT.get(kind).unwrap_or_else(|| panic!("no footprint for building kind {kind:?}"))
}

/// Whether the footprint of `b` covers tile (x, y) (`CONTEXT.md`: Footprint). `size` is the map's;
/// it only matters for a footprint across a join.
pub fn covers(b: Placed, x: i32, y: i32, size: i32) -> bool {
    let side = side_of(b.kind);
    wrap(x - b.x, size) < side && wrap(y - b.y, size) < side
}

/// Whether `p` stands at the building `b`: on any tile of its footprint (`CONTEXT.md`: At a building).
pub fn is_at(p: (i32, i32), b: Placed, size: i32) -> bool {
    covers(b, p.0, p.1, size)
}

/// The tiles a footprint covers, north-west first and then row by row.
pub fn footprint_tiles(b: Placed, size: i32) -> Vec<(i32, i32)> {
    let side = side_of(b.kind);
    let mut out = Vec::new();
    for dy in 0..side {
        for dx in 0..side {
            out.push((wrap(b.x + dx, size), wrap(b.y + dy, size)));
        }
    }
    out
}

/// The footprint's tiles as "x,y" keys.
pub fn footprint_keys(b: Placed, size: i32) -> Vec<String> {
    footprint_tiles(b, size).into_iter().map(|(x, y)| format!("{x},{y}")).collect()
}

/// How many steps a tile is from a footprint along each direction, the short way round: 0 along a
/// direction where it is in line with the footprint, 1 right next to it.
pub fn gap_to(b: Placed, p: (i32, i32), size: i32) -> (i32, i32) {
    let side = side_of(b.kind);
    let along = |from: i32, to: i32| {
        let d = wrap_delta(from, to, size);
        if d < 0 {
            -d
        } else {
            (d - (side - 1)).max(0)
        }
    };
    (along(b.x, p.0), along(b.y, p.1))
}

/// Whether a tile lies within `reach` tiles of a footprint along each direction (0: on it), the
/// short way round.
pub fn near_footprint(b: Placed, p: (i32, i32), reach: i32, size: i32) -> bool {
    let (gx, gy) = gap_to(b, p, size);
    gx <= reach && gy <= reach
}

/// Whether two footprints come within `reach` steps of each other along each direction, from the
/// edge of one to the edge of the other (0: they overlap or are in line, 1: they touch), the short
/// way round.
pub fn footprints_near(a: Placed, b: Placed, reach: i32, size: i32) -> bool {
    let sa = side_of(a.kind);
    let sb = side_of(b.kind);
    footprint_gap(a.x, b.x, sa, sb, size) <= reach && footprint_gap(a.y, b.y, sa, sb, size) <= reach
}

/// The steps between footprints of sides `sa` (from `from`) and `sb` (from `to`) along one
/// direction (`footprints_near`).
fn footprint_gap(from: i32, to: i32, sa: i32, sb: i32, size: i32) -> i32 {
    let d = wrap_delta(from, to, size);
    if d < 0 {
        (-d - (sb - 1)).max(0)
    } else {
        (d - (sa - 1)).max(0)
    }
}

/// The tile in the middle of a footprint, rounded to the north-west: where to aim at it.
pub fn middle_of(b: Placed, size: i32) -> (i32, i32) {
    let half = (side_of(b.kind) - 1).div_euclid(2);
    (wrap(b.x + half, size), wrap(b.y + half, size))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: i32 = 32;

    const STORAGE: Placed = Placed { kind: "storage", x: 4, y: 4 };

    fn at(kind: &str, x: i32, y: i32) -> Placed<'_> {
        Placed { kind, x, y }
    }

    #[test]
    fn gives_each_kind_its_square() {
        let side = |kind: &str| FOOTPRINT.get(kind).unwrap();
        assert_eq!([side("wall"), side("gate"), side("road")], [1, 1, 1]);
        assert_eq!([side("house"), side("storage"), side("mine")], [2, 2, 2]);
        assert_eq!(
            [side("townHall"), side("warehouse"), side("stable"), side("trainingGround")],
            [3, 3, 3, 3]
        );
        assert_eq!(side("haven"), 3);
        assert_eq!(side("farm"), 4);
    }

    #[test]
    fn runs_east_and_south_from_the_north_west_tile_row_by_row() {
        assert_eq!(footprint_tiles(STORAGE, SIZE), vec![(4, 4), (5, 4), (4, 5), (5, 5)]);
        assert_eq!(footprint_keys(at("wall", 7, 2), SIZE), vec!["7,2"]);
        assert_eq!(footprint_tiles(at("farm", 0, 0), SIZE).len(), 16);
    }

    #[test]
    fn covers_their_tiles_also_across_the_maps_joins() {
        assert!(covers(STORAGE, 4, 4, SIZE));
        assert!(covers(STORAGE, 5, 5, SIZE));
        assert!(!covers(STORAGE, 6, 5, SIZE));
        assert!(!covers(STORAGE, 3, 4, SIZE));
        let corner = at("townHall", SIZE - 1, SIZE - 1);
        assert!(footprint_keys(corner, SIZE).contains(&"1,1".to_string()));
        assert!(covers(corner, 0, 1, SIZE));
        assert!(!covers(corner, 2, 0, SIZE));
    }

    #[test]
    fn makes_at_a_building_any_tile_of_them() {
        let farm = at("farm", 8, 8);
        assert!(is_at((8, 8), farm, SIZE));
        assert!(is_at((11, 11), farm, SIZE));
        assert!(!is_at((12, 11), farm, SIZE));
    }

    #[test]
    fn measures_gaps_from_their_edges_the_short_way_round() {
        assert_eq!(gap_to(STORAGE, (5, 4), SIZE), (0, 0));
        assert_eq!(gap_to(STORAGE, (6, 4), SIZE), (1, 0));
        assert_eq!(gap_to(STORAGE, (2, 9), SIZE), (2, 4));
        assert_eq!(gap_to(at("wall", 0, 0), (SIZE - 2, 0), SIZE), (2, 0));
        assert!(near_footprint(STORAGE, (7, 7), 2, SIZE));
        assert!(!near_footprint(STORAGE, (8, 7), 2, SIZE));
    }

    #[test]
    fn comes_near_each_other_by_the_steps_between_their_edges() {
        let hall = at("townHall", 10, 10);
        // The hall covers 10–12: a storage over it is 0 steps off, one at 13 touches it (1 step),
        // one at 15 leaves a gap of two tiles (3 steps).
        assert!(footprints_near(hall, at("storage", 12, 10), 0, SIZE));
        assert!(!footprints_near(hall, at("storage", 13, 10), 0, SIZE));
        assert!(footprints_near(hall, at("storage", 13, 10), 1, SIZE));
        assert!(!footprints_near(hall, at("storage", 15, 10), 2, SIZE));
        assert!(footprints_near(hall, at("storage", 15, 10), 3, SIZE));
        // West of it the storage's own width counts: at 7 it covers 7–8, a tile off the hall.
        assert!(footprints_near(hall, at("storage", 7, 10), 2, SIZE));
        assert!(!footprints_near(hall, at("storage", 6, 10), 2, SIZE));
    }

    #[test]
    fn has_a_middle_tile_rounded_to_the_north_west() {
        assert_eq!(middle_of(at("townHall", 10, 10), SIZE), (11, 11));
        assert_eq!(middle_of(at("farm", 10, 10), SIZE), (11, 11));
        assert_eq!(middle_of(at("wall", 10, 10), SIZE), (10, 10));
    }
}
