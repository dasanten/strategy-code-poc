//! The world's territory (`apps/server/src/territory.ts`, `CONTEXT.md`: Territory), recomputed
//! once a game hour. Derived from the world, never saved; shown only, so being up to a game hour
//! old matters to no rule.

use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_HOUR;
use csp_shared::world::WorldState;

use crate::queries::territory::{compute_territory, Territory};

/// Keeps the world's territory (`TerritoryTracker`).
#[derive(Debug, Clone, Default)]
pub struct TerritoryTracker {
    pub current: Option<Territory>,
}

impl TerritoryTracker {
    /// Recomputes the territory when a game hour has passed since the last time; true if it did.
    pub fn update(&mut self, world: &WorldState, terrain: &TerrainMap) -> bool {
        let fresh = self
            .current
            .as_ref()
            .is_some_and(|t| (world.tick as f64 - t.tick as f64) < TICKS_PER_GAME_HOUR);
        if fresh {
            return false;
        }
        self.current = Some(compute_territory(world, terrain.size));
        true
    }
}

#[cfg(test)]
mod tests;
