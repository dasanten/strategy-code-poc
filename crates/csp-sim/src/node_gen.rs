//! Resource nodes placed when a world is created (`CONTEXT.md`: Resource node), ported bit for bit
//! from the frozen `apps/server/src/node-gen.ts` (ADR 0030).
//!
//! The TypeScript asks every kind of every tile with a closure; here a table from each terrain to
//! the kinds that may lie on it is built once, so most tiles (plains, water) cost one lookup.

use csp_shared::balance::{TerrainTable, NODE_DENSITY, NODE_MIN_SPACING};
use csp_shared::terrain::{tile_index, TerrainMap};
use csp_shared::world::{ResourceKind, ResourceNode};

use crate::random::hash;

/// The kinds in the order of `Object.keys(NODE_DENSITY)`, with their densities.
fn kinds() -> [(ResourceKind, TerrainTable); 4] {
    [
        (ResourceKind::Forest, NODE_DENSITY.forest),
        (ResourceKind::Stone, NODE_DENSITY.stone),
        (ResourceKind::IronOre, NODE_DENSITY.iron_ore),
        (ResourceKind::GoldOre, NODE_DENSITY.gold_ore),
    ]
}

/// One kind a terrain may hold: the kind, the seed offset of its hash (`7919 * (i + 1)`) and its
/// density on that terrain.
type Candidate = (ResourceKind, f64, f64);

/// Places the resource nodes (`placeResourceNodes`): each tile may hold one, with the chance its
/// terrain gives that kind in the balance file (the first kind in order whose hash falls below
/// it), and no two nodes closer than `NODE_MIN_SPACING`, measured across the map's joins too.
/// The same terrain and seed always give the same nodes, `n1`, `n2`, … row by row.
pub fn place_resource_nodes(terrain: &TerrainMap, seed: i64) -> Vec<ResourceNode> {
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
            let (xf, yf) = (f64::from(x), f64::from(y));
            let Some(&(kind, _, _)) =
                candidates.iter().find(|&&(_, s, density)| hash(xf, yf, s) < density)
            else {
                continue;
            };
            nodes.push(ResourceNode { id: format!("n{}", nodes.len() + 1), kind, x: xf, y: yf });
            for by in y - reach..=y + reach {
                for bx in x - reach..=x + reach {
                    blocked[tile_index(size, bx, by)] = true;
                }
            }
        }
    }
    nodes
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
        assert_eq!(place_resource_nodes(&generate_terrain(seed, size), seed), expected);
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
    #[ignore = "generates the full-size map; run with --release -- --ignored"]
    fn places_nodes_on_a_full_size_map_as_the_rules_say() {
        let terrain = crate::terrain_gen::generate_full_terrain(1);
        let from = std::time::Instant::now();
        let nodes = place_resource_nodes(&terrain, 1);
        eprintln!("place_resource_nodes: {:?} for {} nodes", from.elapsed(), nodes.len());
        let at = |n: &ResourceNode| terrain_at(&terrain, n.x as i32, n.y as i32);

        // Every node on terrain that fits its kind.
        let kinds = kinds();
        let fits = |n: &ResourceNode| {
            kinds.iter().any(|(k, densities)| *k == n.kind && densities.get(at(n)).is_some())
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
