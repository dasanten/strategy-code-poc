//! Resource nodes placed when a world is created (`CONTEXT.md`: Resource node), ported bit for bit
//! from the frozen `apps/server/src/node-gen.ts` (ADR 0030).
//!
//! The TypeScript asks every kind of every tile with a closure; here a table from each terrain to
//! the kinds that may lie on it is built once, so most tiles (plains, water) cost one lookup.

use std::collections::HashMap;

use csp_shared::balance::{
    TerrainTable, FRONTIER_NODE_DENSITY, FRONTIER_RICH_NODES, GOLD_NODE_DENSITY,
    ISLAND_NODE_DENSITY, NODE_DENSITY, NODE_MIN_SPACING,
};
use csp_shared::terrain::{tile_index, wrap_distance, TerrainMap};
use csp_shared::world::{ResourceKind, ResourceNode, Richness};

use crate::random::hash;
use crate::regions::{RegionKind, Regions};

/// The kinds in the order of `Object.keys(NODE_DENSITY)`, with their densities. Coal comes last,
/// so a tile where an older kind falls keeps it, and the nodes of a world without coal stay as
/// they were.
fn kinds() -> [(ResourceKind, TerrainTable); 5] {
    [
        (ResourceKind::Forest, NODE_DENSITY.forest),
        (ResourceKind::Stone, NODE_DENSITY.stone),
        (ResourceKind::IronOre, NODE_DENSITY.iron_ore),
        (ResourceKind::GoldOre, NODE_DENSITY.gold_ore),
        (ResourceKind::Coal, NODE_DENSITY.coal),
    ]
}

/// Whether a node of `kind` may lie on a tile of terrain `tile` (`CONTEXT.md`: Resource node): its
/// terrain gives that kind a chance in `NODE_DENSITY`.
pub fn fits_terrain(kind: ResourceKind, tile: u8) -> bool {
    kinds()
        .into_iter()
        .any(|(k, densities)| k == kind && densities.get(tile).is_some_and(|d| d > 0.0))
}

/// One kind a terrain may hold: the kind, the seed offset of its hash (`7919 * (i + 1)`) and its
/// density on that terrain.
type Candidate = (ResourceKind, f64, f64);

/// Places the resource nodes (`placeResourceNodes`): each tile may hold one, with the chance its
/// terrain gives that kind in the balance file (the first kind in order whose hash falls below
/// it), and no two nodes closer than `NODE_MIN_SPACING`, measured across the map's joins too.
/// The same terrain and seed always give the same nodes, `n1`, `n2`, … row by row. A map
/// without regions has no coal (`CONTEXT.md`: Rare goods): coal lies only outside a heartland.
pub fn place_resource_nodes(terrain: &TerrainMap, seed: i64) -> Vec<ResourceNode> {
    place_nodes_scaled(terrain, seed, |_, kind| if kind == ResourceKind::Coal { 0.0 } else { 1.0 })
}

/// The kinds that have no nodes in a heartland (`CONTEXT.md`: Rare goods).
pub const RARE_KINDS: [ResourceKind; 2] = [ResourceKind::GoldOre, ResourceKind::Coal];

/// Whether a node of this kind may lie in a region of this kind (`CONTEXT.md`: Rare goods): a rare
/// kind only in the frontier and on islands, every other kind anywhere.
pub fn allowed_in(kind: ResourceKind, region: RegionKind) -> bool {
    region != RegionKind::Heartland || !RARE_KINDS.contains(&kind)
}

/// How many times its region's density a kind's chances are: none where it is not
/// [`allowed_in`]; gold `GOLD_NODE_DENSITY` where it is, so the frontier and islands make up for
/// the heartlands (coal's own density already counts only out there).
fn kind_scale(kind: ResourceKind, region: RegionKind) -> f64 {
    if !allowed_in(kind, region) {
        0.0
    } else if kind == ResourceKind::GoldOre {
        GOLD_NODE_DENSITY
    } else {
        1.0
    }
}

/// Places the resource nodes by region (`CONTEXT.md`: Heartland, Frontier, Island, Rare goods): as
/// [`place_resource_nodes`], each tile's chances times its region's density (`NODE_DENSITY` in a
/// heartland, `FRONTIER_NODE_DENSITY` and `ISLAND_NODE_DENSITY` times it elsewhere) and its kind's
/// share there ([`kind_scale`]): gold and coal lie only in frontier regions and on islands, none in
/// a heartland. Tiles in no region (water) hold no coal.
pub fn place_resource_nodes_by_region(
    terrain: &TerrainMap,
    seed: i64,
    regions: &Regions,
) -> Vec<ResourceNode> {
    let scale: Vec<(RegionKind, f64)> = regions
        .regions
        .iter()
        .map(|r| {
            let density = match r.kind {
                RegionKind::Heartland => 1.0,
                RegionKind::Frontier => FRONTIER_NODE_DENSITY,
                RegionKind::Island => ISLAND_NODE_DENSITY,
            };
            (r.kind, density)
        })
        .collect();
    let mut nodes = place_nodes_scaled(terrain, seed, |t, kind| {
        let Some(id) = regions.id_of_tile(t) else {
            return if kind == ResourceKind::Coal { 0.0 } else { 1.0 };
        };
        let (region, density) = scale[id as usize];
        density * kind_scale(kind, region)
    });
    place_missing_rare_nodes(&mut nodes, terrain, regions);
    nodes
}

/// Makes sure every frontier region has a node of each rare kind in it or in a region next to it
/// (`CONTEXT.md`: Rare goods): one that has neither gets one, on the tile of it whose terrain holds
/// that kind most densely, nearest its middle, as far from other nodes as `NODE_MIN_SPACING` asks.
/// A frontier with no such terrain gets none.
fn place_missing_rare_nodes(
    nodes: &mut Vec<ResourceNode>,
    terrain: &TerrainMap,
    regions: &Regions,
) {
    let mut next_to = None;
    for (kind, densities) in kinds() {
        if !RARE_KINDS.contains(&kind) {
            continue;
        }
        let frontier: Vec<u32> = regions.of_kind(RegionKind::Frontier).map(|r| r.id).collect();
        for id in frontier {
            let has = |nodes: &[ResourceNode], id: u32| {
                nodes
                    .iter()
                    .any(|n| n.kind == kind && regions.id_at(n.x as i32, n.y as i32) == Some(id))
            };
            if has(nodes, id) {
                continue;
            }
            let next: &Vec<_> = next_to.get_or_insert_with(|| regions.next_to());
            if next[id as usize].iter().any(|&o| has(nodes, o)) {
                continue;
            }
            if let Some((x, y)) = rare_node_tile(nodes, terrain, regions, id, densities) {
                let id = format!("n{}", nodes.len() + 1);
                nodes.push(ResourceNode::new(id, kind, f64::from(x), f64::from(y)));
            }
        }
    }
}

/// Where a region's missing rare node goes ([`place_missing_rare_nodes`]): the tile of the region
/// whose terrain gives the kind the highest density, nearest the region's middle, with no node
/// closer than `NODE_MIN_SPACING`.
fn rare_node_tile(
    nodes: &[ResourceNode],
    terrain: &TerrainMap,
    regions: &Regions,
    id: u32,
    densities: TerrainTable,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let middle = regions.region(id).map(|r| (r.x, r.y))?;
    let mut best: Option<(f64, i32, (i32, i32))> = None;
    let reach = NODE_MIN_SPACING as i32 - 1;
    for (t, &tile) in terrain.tiles.iter().enumerate() {
        let Some(density) = densities.get(tile) else { continue };
        if regions.id_of_tile(t) != Some(id) {
            continue;
        }
        let at = ((t as i32) % size, (t as i32) / size);
        let d = csp_shared::terrain::wrap_distance(size, at, middle) as i32;
        if best.is_some_and(|(bd, bdist, _)| (density, -d) <= (bd, -bdist)) {
            continue;
        }
        let near = |n: &ResourceNode| {
            let (dx, dy) = (n.x as i32 - at.0, n.y as i32 - at.1);
            let wrapped = |v: i32| v.rem_euclid(size).min((-v).rem_euclid(size));
            wrapped(dx) <= reach && wrapped(dy) <= reach
        };
        if !nodes.iter().any(near) {
            best = Some((density, d, at));
        }
    }
    best.map(|(_, _, at)| at)
}

/// [`place_resource_nodes`] with each tile's chances of each kind times `scale` of the tile's
/// index and the kind.
fn place_nodes_scaled(
    terrain: &TerrainMap,
    seed: i64,
    scale: impl Fn(usize, ResourceKind) -> f64,
) -> Vec<ResourceNode> {
    let size = terrain.size;
    let su = size as usize;
    let seed = seed as f64;
    let mut by_terrain: Vec<Vec<Candidate>> = vec![Vec::new(); 256];
    for (i, (kind, densities)) in kinds().into_iter().enumerate() {
        for &(t, density) in densities.0 {
            by_terrain[usize::from(t)].push((kind, seed + 7919.0 * (i as f64 + 1.0), density));
        }
    }
    let mut blocked = vec![false; su * su];
    let reach = NODE_MIN_SPACING as i32 - 1;
    let mut nodes = Vec::new();
    for y in 0..size {
        let row = y as usize * su;
        for x in 0..size {
            let t = row + x as usize;
            if blocked[t] {
                continue;
            }
            let candidates = &by_terrain[usize::from(terrain.tiles[t])];
            if candidates.is_empty() {
                continue;
            }
            let (xf, yf) = (f64::from(x), f64::from(y));
            let Some(&(kind, _, _)) = candidates
                .iter()
                .find(|&&(kind, s, density)| hash(xf, yf, s) < density * scale(t, kind))
            else {
                continue;
            };
            nodes.push(ResourceNode::new(format!("n{}", nodes.len() + 1), kind, xf, yf));
            for by in y - reach..=y + reach {
                for bx in x - reach..=x + reach {
                    blocked[tile_index(size, bx, by)] = true;
                }
            }
        }
    }
    nodes
}

/// How far apart, in tiles, the border between two frontier regions is looked at when picking
/// their rich nodes: near enough to a border is all that counts, not the exact tile.
const BORDER_STEP: i32 = 4;

/// Sets every node's richness by its region (`CONTEXT.md`: Richness): poor in a heartland, rich
/// on an island, normal in the frontier but for the `FRONTIER_RICH_NODES` of each frontier region
/// nearest its passes, land bridges and borders with other frontier regions, which are rich; and
/// gives each normal or rich ore node its stock (`CONTEXT.md`: Running dry). Run
/// once, after all of a new world's nodes are placed; the same nodes, terrain and regions always
/// give the same richness.
pub fn assign_richness(nodes: &mut [ResourceNode], terrain: &TerrainMap, regions: &Regions) {
    let size = terrain.size;
    let kind_of = |id: Option<u32>| id.and_then(|id| regions.region(id)).map(|r| r.kind);
    let spots = contested_spots(size, regions);
    let mut frontier: HashMap<u32, Vec<(f64, usize)>> = HashMap::new();
    for (i, node) in nodes.iter_mut().enumerate() {
        let at = (node.x as i32, node.y as i32);
        let id = regions.id_at(at.0, at.1);
        node.richness = match kind_of(id) {
            Some(RegionKind::Heartland) => Richness::Poor,
            Some(RegionKind::Island) => Richness::Rich,
            Some(RegionKind::Frontier) | None => Richness::Normal,
        };
        if let (Some(id), Some(RegionKind::Frontier)) = (id, kind_of(id)) {
            let near = spots
                .get(&id)
                .into_iter()
                .flatten()
                .map(|&s| wrap_distance(size, at, s))
                .fold(f64::INFINITY, f64::min);
            frontier.entry(id).or_default().push((near, i));
        }
    }
    for mut in_region in frontier.into_values() {
        // Stable: of two as near, the one placed first.
        in_region.sort_by(|a, b| a.0.total_cmp(&b.0));
        for &(_, i) in in_region.iter().take(FRONTIER_RICH_NODES as usize) {
            nodes[i].richness = Richness::Rich;
        }
    }
    // A normal or rich ore node comes into being with its stock (`CONTEXT.md`: Running dry).
    for node in nodes.iter_mut() {
        node.fill_stock();
    }
}

/// The spots worth fighting over (`CONTEXT.md`: Richness), by frontier region: its passes and land
/// bridges and the tiles along its borders with another frontier region, looked at every
/// `BORDER_STEP` tiles.
pub fn contested_spots(size: i32, regions: &Regions) -> HashMap<u32, Vec<(i32, i32)>> {
    let kind_of = |id: Option<u32>| id.and_then(|id| regions.region(id)).map(|r| r.kind);
    let mut spots: HashMap<u32, Vec<(i32, i32)>> = HashMap::new();
    for way in &regions.ways {
        for id in way.between {
            if kind_of(Some(id)) == Some(RegionKind::Frontier) {
                spots.entry(id).or_default().push((way.x, way.y));
            }
        }
    }
    for y in (0..size).step_by(BORDER_STEP as usize) {
        for x in (0..size).step_by(BORDER_STEP as usize) {
            let Some(here) = regions.id_at(x, y) else { continue };
            if kind_of(Some(here)) != Some(RegionKind::Frontier) {
                continue;
            }
            for (nx, ny) in [(x + BORDER_STEP, y), (x, y + BORDER_STEP)] {
                let Some(there) = regions.id_at(nx, ny) else { continue };
                if there != here && kind_of(Some(there)) == Some(RegionKind::Frontier) {
                    spots.entry(here).or_default().push((x, y));
                    spots.entry(there).or_default().push((nx, ny));
                }
            }
        }
    }
    spots
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain_gen::generate_terrain;
    use csp_shared::terrain::{terrain_at, wrap, Terrain};
    use std::collections::HashMap;

    fn assert_fixture(seed: i64, size: i32) {
        let path = format!("{}/fixtures/nodes/{seed}-{size}.json", env!("CARGO_MANIFEST_DIR"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let expected: Vec<ResourceNode> = serde_json::from_str(&text).expect("nodes fixture");
        // The terrain the TypeScript placed them on (`fixtures/terrain`), not today's generator.
        let tiles = format!("{}/fixtures/terrain/{seed}-{size}.bin", env!("CARGO_MANIFEST_DIR"));
        let terrain = TerrainMap { size, tiles: std::fs::read(&tiles).expect("terrain fixture") };
        assert_eq!(place_resource_nodes(&terrain, seed), expected);
    }

    #[test]
    fn matches_the_typescript_nodes() {
        assert_fixture(1, 64);
        assert_fixture(1, 256);
        assert_fixture(42, 256);
        assert_fixture(1, 512);
    }

    #[test]
    fn matches_the_typescript_nodes_1024() {
        assert_fixture(7, 1024);
    }

    #[test]
    fn places_the_same_nodes_for_the_same_terrain_and_seed_other_ones_for_another() {
        let terrain = generate_terrain(1, 128);
        let nodes = place_resource_nodes(&terrain, 1);
        assert_eq!(place_resource_nodes(&terrain, 1), nodes);
        assert_ne!(place_resource_nodes(&terrain, 2), nodes);
    }

    /// The tests of `node-gen.test.ts` on a full-size map. Run with `cargo test --release --
    /// --ignored`.
    #[test]
    #[ignore = "5.1 s alone: generates the full-size map; see #1132"]
    fn places_nodes_on_a_full_size_map_as_the_rules_say() {
        let terrain = crate::terrain_gen::generate_full_terrain(1);
        let from = std::time::Instant::now();
        let nodes = place_resource_nodes(&terrain, 1);
        eprintln!("place_resource_nodes: {:?} for {} nodes", from.elapsed(), nodes.len());
        let at = |n: &ResourceNode| terrain_at(&terrain, n.x as i32, n.y as i32);

        // Every node on terrain that fits its kind.
        let all = kinds();
        let fits = |n: &ResourceNode| {
            all.iter().any(|(k, densities)| *k == n.kind && densities.get(at(n)).is_some())
        };
        assert!(nodes.iter().all(fits));

        // Apart, across the joins too, one per tile, with unique ids.
        let ids: std::collections::HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids.len(), nodes.len());
        let by_tile: HashMap<(i32, i32), usize> =
            nodes.iter().enumerate().map(|(i, n)| ((n.x as i32, n.y as i32), i)).collect();
        assert_eq!(by_tile.len(), nodes.len());
        let reach = NODE_MIN_SPACING as i32 - 1;
        for (i, n) in nodes.iter().enumerate() {
            for dy in -reach..=reach {
                for dx in -reach..=reach {
                    let o =
                        (wrap(n.x as i32 + dx, terrain.size), wrap(n.y as i32 + dy, terrain.size));
                    assert!(by_tile.get(&o).is_none_or(|&j| j == i), "{n:?} too close to another");
                }
            }
        }

        // Roughly the densities from the balance file, gold rarest.
        // A map without regions has no coal.
        let kinds = kinds().into_iter().filter(|(k, _)| *k != ResourceKind::Coal);
        let mut tiles_of = [0usize; 256];
        for &t in &terrain.tiles {
            tiles_of[usize::from(t)] += 1;
        }
        let count = |kind: ResourceKind| nodes.iter().filter(|n| n.kind == kind).count() as f64;
        for (kind, densities) in kinds {
            let expected: f64 =
                densities.0.iter().map(|&(t, d)| d * tiles_of[usize::from(t)] as f64).sum();
            // Spacing removes a few candidates; rare kinds also vary by chance (3 deviations).
            let noise = 3.0 * expected.sqrt();
            assert!(
                count(kind) > expected * 0.75 - noise,
                "{kind:?}: {} of {expected}",
                count(kind)
            );
            assert!(count(kind) < expected + noise, "{kind:?}: {} of {expected}", count(kind));
        }
        assert!(count(ResourceKind::GoldOre) < count(ResourceKind::IronOre));
        assert!(count(ResourceKind::GoldOre) > 10.0);
        let iron_in = |t: Terrain| {
            nodes.iter().filter(|n| n.kind == ResourceKind::IronOre && at(n) == t as u8).count()
                as f64
                / tiles_of[t as usize].max(1) as f64
        };
        assert!(iron_in(Terrain::Mountain) > iron_in(Terrain::Hills));
    }
}

#[cfg(test)]
#[path = "rare_goods_tests.rs"]
mod rare_goods_tests;
