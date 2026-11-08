//! Stand-in for `Ground` of `placing.ts` (TODO(T86.5)), with the kind lists of shared
//! `building.ts` it reads (TODO(T86.6)): which tiles a placement may use.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::RECIPES;
use csp_shared::footprint::{footprint_tiles, Placed};
use csp_shared::terrain::{is_passable_terrain, terrain_at, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, ResourceKind, ResourceNode, WorldState};

use crate::queries::names::{kind_name, kind_of, placed};

/// The workplace a node's kind takes (`NODE_WORKPLACE`).
fn node_workplace(kind: ResourceKind) -> BuildingKind {
    match kind {
        ResourceKind::Forest => BuildingKind::LumberCamp,
        ResourceKind::Stone => BuildingKind::Quarry,
        ResourceKind::IronOre | ResourceKind::GoldOre => BuildingKind::Mine,
    }
}

/// Kinds that go on any passable terrain but Mountain, off nodes (`OFF_NODES`).
fn off_nodes(kind: BuildingKind) -> bool {
    RECIPES.0.iter().any(|(k, _)| kind_of(k) == Some(kind))
        || matches!(
            kind,
            BuildingKind::TownHall
                | BuildingKind::House
                | BuildingKind::Storage
                | BuildingKind::Wall
                | BuildingKind::Gate
                | BuildingKind::TrainingGround
        )
}

/// Kinds that go on Plains, off nodes (`ON_PLAINS`).
fn on_plains(kind: BuildingKind) -> bool {
    matches!(kind, BuildingKind::Stable | BuildingKind::Farm)
}

/// Whether a kind goes on a resource node (`onNode`).
fn on_node(kind: BuildingKind) -> bool {
    matches!(kind, BuildingKind::LumberCamp | BuildingKind::Quarry | BuildingKind::Mine)
}

/// The tiles a placement may use (`Ground`): those no footprint covers but a road's, and the
/// resource nodes.
pub(crate) struct Ground<'t> {
    taken: HashSet<(i32, i32)>,
    nodes: HashMap<(i32, i32), ResourceNode>,
    terrain: &'t TerrainMap,
}

impl<'t> Ground<'t> {
    /// `new Ground(world, terrain, more)`: `more` are further tiles to keep free.
    pub fn new(world: &WorldState, terrain: &'t TerrainMap, more: &[(i32, i32)]) -> Self {
        let mut taken = HashSet::new();
        for b in &world.buildings {
            if b.kind != BuildingKind::Road {
                taken.extend(footprint_tiles(placed(b), terrain.size));
            }
        }
        let nodes = world.nodes.iter().map(|n| ((n.x as i32, n.y as i32), n.clone())).collect();
        taken.extend(more.iter().copied());
        Ground { taken, nodes, terrain }
    }

    /// The map's size.
    pub fn size(&self) -> i32 {
        self.terrain.size
    }

    /// Whether no footprint covers the tile.
    pub fn free(&self, x: i32, y: i32) -> bool {
        !self.taken.contains(&(x, y))
    }

    /// The resource node on the tile, if there is one.
    pub fn node_at(&self, x: i32, y: i32) -> Option<&ResourceNode> {
        self.nodes.get(&(x, y))
    }

    /// Whether a building of `kind` fits with its north-west tile on (x, y), and every tile
    /// passes `also`.
    pub fn fits(
        &self,
        kind: BuildingKind,
        x: i32,
        y: i32,
        also: &dyn Fn(i32, i32) -> bool,
    ) -> bool {
        let tiles = footprint_tiles(Placed { kind: kind_name(kind), x, y }, self.terrain.size);
        let mut nodes = 0;
        for (tx, ty) in tiles {
            if self.taken.contains(&(tx, ty)) {
                return false;
            }
            let t = terrain_at(self.terrain, tx, ty);
            if !is_passable_terrain(t) {
                return false;
            }
            if on_plains(kind) && t != Terrain::Plains as u8 {
                return false;
            }
            if off_nodes(kind) && t == Terrain::Mountain as u8 {
                return false;
            }
            if let Some(node) = self.nodes.get(&(tx, ty)) {
                if node_workplace(node.kind) != kind {
                    return false;
                }
                nodes += 1;
            }
            if !also(tx, ty) {
                return false;
            }
        }
        !on_node(kind) || nodes == 1
    }
}
