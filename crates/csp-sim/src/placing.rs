//! The ground as the game lays out buildings on it (`apps/server/src/placing.ts`, `CONTEXT.md`:
//! Where buildings go, Footprint): which tiles footprints and resource nodes already cover, so the
//! world generator and NPC cities can try many spots quickly. `buildProblem` stays the rule; this
//! is the same check, kept fast.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::RECIPES;
use csp_shared::footprint::{footprint_tiles, Placed};
use csp_shared::terrain::{is_passable_terrain, terrain_at, touches_water, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, ResourceKind, ResourceNode, WorldState};

use crate::queries::names::{kind_name, kind_of, placed};

/// The workplace that goes on each kind of resource node (`NODE_WORKPLACE`).
pub fn node_workplace(kind: ResourceKind) -> BuildingKind {
    match kind {
        ResourceKind::Forest => BuildingKind::LumberCamp,
        ResourceKind::Stone => BuildingKind::Quarry,
        ResourceKind::IronOre | ResourceKind::GoldOre => BuildingKind::Mine,
    }
}

/// Workplaces that process goods (`PROCESSING`): the kinds with recipes, in `RECIPES`' order.
pub fn processing() -> Vec<BuildingKind> {
    RECIPES.0.iter().filter_map(|(k, _)| kind_of(k)).collect()
}

/// Buildable kinds that go off any resource node and off mountains (`OFF_NODES`), havens on the shore
/// besides.
pub fn off_nodes() -> Vec<BuildingKind> {
    let mut kinds = processing();
    kinds.extend([
        BuildingKind::TownHall,
        BuildingKind::House,
        BuildingKind::Storage,
        BuildingKind::Wall,
        BuildingKind::Gate,
        BuildingKind::TrainingGround,
        BuildingKind::Haven,
    ]);
    kinds
}

/// Buildable kinds that go on Plains, off any resource node (`ON_PLAINS`).
pub const ON_PLAINS: [BuildingKind; 2] = [BuildingKind::Stable, BuildingKind::Farm];

/// Whether a kind of building goes on a resource node: mines, quarries and lumber camps.
fn on_node(kind: BuildingKind) -> bool {
    matches!(kind, BuildingKind::LumberCamp | BuildingKind::Quarry | BuildingKind::Mine)
}

/// The ground as the game lays out buildings on it (`Ground`).
pub struct Ground<'t> {
    taken: HashSet<(i32, i32)>,
    nodes: HashMap<(i32, i32), ResourceNode>,
    off_nodes: Vec<BuildingKind>,
    pub terrain: &'t TerrainMap,
}

impl<'t> Ground<'t> {
    /// The ground of `world` on `terrain`, with `more` tiles kept free: where residents, horses or
    /// piles stand.
    pub fn new(
        world: &WorldState,
        terrain: &'t TerrainMap,
        more: impl IntoIterator<Item = (i32, i32)>,
    ) -> Self {
        let mut taken = HashSet::new();
        for b in &world.buildings {
            if b.kind != BuildingKind::Road {
                taken.extend(footprint_tiles(placed(b), terrain.size));
            }
        }
        let nodes = world.nodes.iter().map(|n| ((n.x as i32, n.y as i32), n.clone())).collect();
        taken.extend(more);
        Ground { taken, nodes, off_nodes: off_nodes(), terrain }
    }

    /// Whether no footprint covers the tile.
    pub fn free(&self, x: i32, y: i32) -> bool {
        !self.taken.contains(&(x, y))
    }

    /// The resource node on the tile, if there is one.
    pub fn node_at(&self, x: i32, y: i32) -> Option<&ResourceNode> {
        self.nodes.get(&(x, y))
    }

    /// Whether a building of `kind` fits with the north-west tile of its footprint on (x, y), by
    /// the rules `buildProblem` checks (the house's city area aside), and every tile passes `also`.
    pub fn fits(
        &self,
        kind: BuildingKind,
        x: i32,
        y: i32,
        also: Option<&dyn Fn(i32, i32) -> bool>,
    ) -> bool {
        let tiles = footprint_tiles(Placed { kind: kind_name(kind), x, y }, self.terrain.size);
        let mut nodes = 0;
        let shore = kind != BuildingKind::Haven
            || touches_water(&tiles, self.terrain.size, |tx, ty| terrain_at(self.terrain, tx, ty));
        if !shore {
            return false;
        }
        for (tx, ty) in tiles {
            if self.taken.contains(&(tx, ty)) {
                return false;
            }
            let t = terrain_at(self.terrain, tx, ty);
            if !is_passable_terrain(t) {
                return false;
            }
            if ON_PLAINS.contains(&kind) && t != Terrain::Plains as u8 {
                return false;
            }
            if self.off_nodes.contains(&kind) && t == Terrain::Mountain as u8 {
                return false;
            }
            if let Some(node) = self.nodes.get(&(tx, ty)) {
                if node_workplace(node.kind) != kind {
                    return false;
                }
                nodes += 1;
            }
            if let Some(also) = also {
                if !also(tx, ty) {
                    return false;
                }
            }
        }
        // Only a node's workplace covers a node, and one of them.
        !on_node(kind) || nodes == 1
    }

    /// Marks a footprint as covered.
    pub fn take(&mut self, kind: BuildingKind, x: i32, y: i32) {
        let tiles = footprint_tiles(Placed { kind: kind_name(kind), x, y }, self.terrain.size);
        self.taken.extend(tiles);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workplaces_go_on_their_nodes() {
        assert_eq!(node_workplace(ResourceKind::GoldOre), BuildingKind::Mine);
        assert!(processing().contains(&BuildingKind::Smithy));
        assert!(off_nodes().contains(&BuildingKind::Storage));
    }
}
