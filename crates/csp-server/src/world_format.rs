//! Bringing a save up to the current world format (`migrateWorld` of
//! `apps/server/src/world-format.ts`, ADR 0006). The Rust server starts at the format of the
//! TypeScript freeze, [`FREEZE_FORMAT_VERSION`]: the steps before it stay in TypeScript, and a save
//! older than that is refused with the advice to run the TypeScript server once, which migrates
//! and saves it. Steps after the freeze go in [`migrations`], with a test.

use std::collections::BTreeMap;

use csp_shared::{terrain::TerrainMap, world::WORLD_FORMAT_VERSION};
use serde_json::Value;

/// The world format of the TypeScript server at the feature freeze (ADR 0030): the oldest save
/// this server migrates.
pub const FREEZE_FORMAT_VERSION: u32 = 111;

/// Saves older than this format are thrown away and a new world created, while accounts stay
/// (ADR 0006, the two resets). Never raise this again.
pub const RESET_BEFORE: u32 = 37;

/// What a migration step may look at besides the save itself.
pub struct MigrationContext<'a> {
    /// The world's stored terrain.
    pub terrain: &'a TerrainMap,
}

/// Turns a version-n save into version n + 1.
pub type MigrationStep = fn(Value, &MigrationContext<'_>) -> Value;

/// `migrations()[n]` turns a version-n save into version n + 1. Steps start at
/// [`FREEZE_FORMAT_VERSION`]; none yet.
pub fn migrations() -> BTreeMap<u32, MigrationStep> {
    BTreeMap::new()
}

/// Why a save cannot be brought to the current format.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct WorldFormatError(pub String);

/// Brings a save written in format `version` up to `current` with `steps`.
pub fn migrate_world_with(
    state: Value,
    version: u32,
    ctx: &MigrationContext<'_>,
    steps: &BTreeMap<u32, MigrationStep>,
    current: u32,
) -> Result<Value, WorldFormatError> {
    if version > current {
        return Err(WorldFormatError(format!(
            "the saved world is format {version}, newer than this server ({current}); deploy a newer server"
        )));
    }
    let mut s = state;
    for v in version..current {
        let Some(step) = steps.get(&v) else {
            return Err(WorldFormatError(format!(
                "no migration from world format {v} to {}",
                v + 1
            )));
        };
        s = step(s, ctx);
    }
    Ok(s)
}

/// Brings a save written in format `version` up to the current format. A save from before the
/// freeze is refused: the TypeScript server migrates it.
pub fn migrate_world(
    state: Value,
    version: u32,
    ctx: &MigrationContext<'_>,
) -> Result<Value, WorldFormatError> {
    if version < FREEZE_FORMAT_VERSION {
        return Err(WorldFormatError(format!(
            "the saved world is format {version}, older than the Rust server reads \
             ({FREEZE_FORMAT_VERSION}); run the TypeScript server once to migrate and save it"
        )));
    }
    migrate_world_with(state, version, ctx, &migrations(), WORLD_FORMAT_VERSION)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn ctx_terrain() -> TerrainMap {
        TerrainMap { size: 4, tiles: vec![0; 16] }
    }

    #[test]
    fn runs_every_step_from_the_saved_version_to_the_current_one() {
        let terrain = ctx_terrain();
        let ctx = MigrationContext { terrain: &terrain };
        let mut steps: BTreeMap<u32, MigrationStep> = BTreeMap::new();
        steps.insert(1, |mut s, _| {
            s["a"] = json!(1);
            s
        });
        steps.insert(2, |mut s, _| {
            s["b"] = json!(2);
            s
        });
        assert_eq!(
            migrate_world_with(json!({ "tick": 5 }), 1, &ctx, &steps, 3).unwrap(),
            json!({ "tick": 5, "a": 1, "b": 2 })
        );
        assert_eq!(
            migrate_world_with(json!({ "tick": 5 }), 3, &ctx, &steps, 3).unwrap(),
            json!({ "tick": 5 })
        );
    }

    #[test]
    fn refuses_a_missing_step_or_a_newer_save() {
        let terrain = ctx_terrain();
        let ctx = MigrationContext { terrain: &terrain };
        let none = BTreeMap::new();
        assert!(migrate_world_with(json!({}), 1, &ctx, &none, 2).is_err());
        let newer = migrate_world_with(json!({}), 3, &ctx, &none, 2).unwrap_err();
        assert!(newer.0.contains("newer than this server"), "{newer}");
    }

    #[test]
    // Empty while the format is still the freeze's; it fills as formats are added.
    #[allow(clippy::reversed_empty_ranges)]
    fn has_no_steps_from_before_the_freeze_and_one_for_every_version_since() {
        let steps = migrations();
        assert!(steps.keys().all(|&v| v >= FREEZE_FORMAT_VERSION));
        for v in FREEZE_FORMAT_VERSION..WORLD_FORMAT_VERSION {
            assert!(steps.contains_key(&v), "no migration from {v}");
        }
    }

    #[test]
    fn refuses_a_save_from_before_the_freeze_with_what_to_do() {
        let terrain = ctx_terrain();
        let ctx = MigrationContext { terrain: &terrain };
        let old = migrate_world(json!({}), FREEZE_FORMAT_VERSION - 1, &ctx).unwrap_err();
        assert!(old.0.contains("run the TypeScript server once"), "{old}");
        assert_eq!(
            migrate_world(json!({ "tick": 1 }), WORLD_FORMAT_VERSION, &ctx).unwrap(),
            json!({ "tick": 1 })
        );
    }
}
