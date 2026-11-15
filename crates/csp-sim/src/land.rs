//! The land (`CONTEXT.md`: The land, Island): one **mainland** and, off its coasts, **islands**,
//! with Sea all around. The mainland is the largest land group (`land_groups`): any of its tiles is
//! reached on foot from any other. Every other land group is an island, reached only by vessel: at
//! least `NARROWEST_STRAIT` tiles of water from the mainland, with room for a haven on its shore.
//!
//! The generator (`terrain_gen`) makes the map keep these rules and `check_terrain` reports where
//! one doesn't; later steps (regions, starting sites, NPC cities) ask [`Land`] which tiles are
//! mainland and which island.

use csp_shared::balance::NARROWEST_STRAIT;
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{is_passable_terrain, is_sea, TerrainMap};

use crate::terrain_gen::{land_groups, neighbours};

/// Which land group each tile belongs to, and which group is the mainland.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Land {
    /// Each passable tile's group, -1 on water (`land_groups`).
    pub group: Vec<i32>,
    /// Tiles in each group.
    pub sizes: Vec<usize>,
    /// The mainland's group: the largest (the first of the largest), none on a map without land.
    pub mainland: Option<i32>,
}

impl Land {
    /// The land of a map.
    pub fn of(map: &TerrainMap) -> Land {
        let (group, sizes) = land_groups(map);
        let largest = sizes.iter().copied().max();
        let mainland = largest.and_then(|l| sizes.iter().position(|&s| s == l)).map(|g| g as i32);
        Land { group, sizes, mainland }
    }

    /// Whether tile `t` is mainland.
    pub fn is_mainland(&self, t: usize) -> bool {
        self.mainland.is_some_and(|m| self.group[t] == m)
    }

    /// Whether tile `t` is land off the mainland: an island's, on a map that keeps the rules.
    pub fn is_island(&self, t: usize) -> bool {
        self.group[t] != -1 && !self.is_mainland(t)
    }

    /// The groups that are not the mainland: the islands, on a map that keeps the rules.
    pub fn islands(&self) -> impl Iterator<Item = i32> + '_ {
        (0..self.sizes.len() as i32).filter(move |&g| Some(g) != self.mainland)
    }

    /// The first tile (by index) of each group: where to point at it.
    pub fn first_tiles(&self) -> Vec<usize> {
        let mut first = vec![usize::MAX; self.sizes.len()];
        for (t, &g) in self.group.iter().enumerate() {
            if g != -1 && first[g as usize] == usize::MAX {
                first[g as usize] = t;
            }
        }
        first
    }
}

/// Which groups other than the mainland lie less than `NARROWEST_STRAIT` tiles of water from it
/// (4 neighbours, across the joins): land the mainland is split from, not an island. Searched
/// outwards from the mainland's coast, only as far as the strait.
pub fn near_the_mainland(map: &TerrainMap, land: &Land) -> Vec<bool> {
    let mut near = vec![false; land.sizes.len()];
    let Some(main) = land.mainland else { return near };
    const UNSEEN: u8 = u8::MAX;
    let reach = u8::try_from(NARROWEST_STRAIT).expect("the strait fits a byte");
    let mut dist = vec![UNSEEN; map.tiles.len()];
    let mut frontier: Vec<u32> = Vec::new();
    for (t, &g) in land.group.iter().enumerate() {
        if g == main {
            dist[t] = 0;
            if neighbours(map.size, t).iter().any(|&nb| land.group[nb] != main) {
                frontier.push(t as u32);
            }
        }
    }
    let mut next = Vec::new();
    // A land tile `d` steps out has `d - 1` tiles between it and the mainland.
    for d in 1..=reach {
        for &t in &frontier {
            for nb in neighbours(map.size, t as usize) {
                if dist[nb] != UNSEEN {
                    continue;
                }
                dist[nb] = d;
                let g = land.group[nb];
                if g != -1 {
                    near[g as usize] = true;
                }
                next.push(nb as u32);
            }
        }
        std::mem::swap(&mut frontier, &mut next);
        next.clear();
    }
    near
}

/// Which groups have room for a haven on their shore (`CONTEXT.md`: Haven): a haven's footprint
/// wholly on the group's tiles, touching the Sea straight or diagonally, so a vessel from the
/// mainland can land there. The mainland is not asked (false). A haven's room holds a mine or a
/// storage too, both smaller.
pub fn fits_a_haven(map: &TerrainMap, land: &Land) -> Vec<bool> {
    let side = FOOTPRINT.get("haven").expect("a haven has a footprint");
    let size = map.size;
    let at = |x: i32, y: i32| {
        let (x, y) = (x.rem_euclid(size), y.rem_euclid(size));
        (y * size + x) as usize
    };
    let mut fits = vec![false; land.sizes.len()];
    for (t, &g) in land.group.iter().enumerate() {
        if g == -1 || Some(g) == land.mainland || fits[g as usize] {
            continue;
        }
        let (x, y) = ((t as i32) % size, (t as i32) / size);
        let mut whole = true;
        let mut by_sea = false;
        'square: for dy in -1..=side {
            for dx in -1..=side {
                let tile = map.tiles[at(x + dx, y + dy)];
                let inside = (0..side).contains(&dx) && (0..side).contains(&dy);
                if inside {
                    if land.group[at(x + dx, y + dy)] != g || !is_passable_terrain(tile) {
                        whole = false;
                        break 'square;
                    }
                } else if is_sea(tile) {
                    by_sea = true;
                }
            }
        }
        fits[g as usize] = whole && by_sea;
    }
    fits
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::terrain::Terrain;

    /// A map of Sea with plains rectangles `(x, y, w, h)`.
    pub(crate) fn sea_with(size: i32, land: &[(i32, i32, i32, i32)]) -> TerrainMap {
        let mut tiles = vec![Terrain::Sea as u8; (size * size) as usize];
        for &(x, y, w, h) in land {
            for ty in y..y + h {
                for tx in x..x + w {
                    tiles[(ty * size + tx) as usize] = Terrain::Plains as u8;
                }
            }
        }
        TerrainMap { size, tiles }
    }

    #[test]
    fn tells_the_mainland_from_the_islands() {
        let map = sea_with(64, &[(10, 10, 20, 20), (50, 50, 5, 5)]);
        let land = Land::of(&map);
        assert!(land.is_mainland(15 * 64 + 15));
        assert!(!land.is_island(15 * 64 + 15));
        assert!(land.is_island(52 * 64 + 52));
        assert!(!land.is_island(0) && !land.is_mainland(0));
        assert_eq!(land.islands().count(), 1);
        assert_eq!(Land::of(&sea_with(8, &[])).mainland, None);
    }

    #[test]
    fn finds_land_split_from_the_mainland_by_less_than_the_strait() {
        let strait = NARROWEST_STRAIT;
        // A piece one tile off the mainland, and an island just the strait away.
        let map = sea_with(128, &[(10, 10, 30, 30), (41, 10, 5, 5), (40 + strait, 30, 5, 5)]);
        let land = Land::of(&map);
        let near = near_the_mainland(&map, &land);
        let g = |x: i32, y: i32| land.group[(y * 128 + x) as usize] as usize;
        assert!(near[g(42, 12)]);
        assert!(!near[g(41 + strait, 32)]);
        // One tile closer and it is split land.
        let map = sea_with(128, &[(10, 10, 30, 30), (39 + strait, 30, 5, 5)]);
        let land = Land::of(&map);
        assert!(
            near_the_mainland(&map, &land)[land.group[30 * 128 + 40 + strait as usize] as usize]
        );
    }

    #[test]
    fn finds_room_for_a_haven_on_an_islands_shore() {
        // A 3 × 3 island fits one; a 2 × 5 sliver doesn't; a 3 × 3 island in a lake doesn't.
        let mut map =
            sea_with(64, &[(0, 0, 20, 20), (40, 40, 3, 3), (40, 50, 2, 5), (48, 48, 11, 11)]);
        for y in 51..56 {
            for x in 51..56 {
                map.tiles[y * 64 + x] = Terrain::Lake as u8;
            }
        }
        for y in 52..55 {
            for x in 52..55 {
                map.tiles[y * 64 + x] = Terrain::Plains as u8;
            }
        }
        let land = Land::of(&map);
        let fits = fits_a_haven(&map, &land);
        let g = |x: usize, y: usize| land.group[y * 64 + x] as usize;
        assert!(fits[g(41, 41)]);
        assert!(!fits[g(40, 52)]);
        assert!(!fits[g(53, 53)]);
        assert!(fits[g(48, 48)], "the ring round the lake touches the Sea");
        assert!(!fits[g(5, 5)], "the mainland isn't asked");
    }
}
