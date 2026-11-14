//! Bringing a save up to the current world format (ADR 0006). The world was generated again once
//! (ADR 0035, `csp-admin reset-world`): a save from before that reset is refused with the advice
//! to run it, and the migration steps before it went. Steps after it go in [`migrations`], with a
//! test.

use std::collections::BTreeMap;

use csp_shared::{terrain::TerrainMap, world::WORLD_FORMAT_VERSION};
use serde_json::Value;

/// The world format of the reset (ADR 0035): the oldest save this server reads. An older save
/// holds the world from before it, which no migration brings onto the new land.
///
/// Until the reset ships, this is the current format: Epics 100 to 102 each bump it and write no
/// migration. The first change after the release pins this to the number it then has and adds its
/// step above it; `has_no_steps_from_before_the_reset_and_one_for_every_version_since` fails until
/// it does.
pub const RESET_FORMAT_VERSION: u32 = WORLD_FORMAT_VERSION;

/// What a migration step may look at besides the save itself.
pub struct MigrationContext<'a> {
    /// The world's stored terrain.
    pub terrain: &'a TerrainMap,
}

/// Turns a version-n save into version n + 1.
pub type MigrationStep = fn(Value, &MigrationContext<'_>) -> Value;

/// `migrations()[n]` turns a version-n save into version n + 1. Steps start at
/// [`RESET_FORMAT_VERSION`]; there are none yet.
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

/// What the server says of a save from before the reset.
pub fn before_the_reset(version: u32) -> String {
    format!(
        "the saved world is format {version}, from before the new world (format \
         {RESET_FORMAT_VERSION}); stop the server and run `csp-admin reset-world` (ADR 0035)"
    )
}

/// Brings a save written in format `version` up to the current format. A save from before the
/// reset is refused.
pub fn migrate_world(
    state: Value,
    version: u32,
    ctx: &MigrationContext<'_>,
) -> Result<Value, WorldFormatError> {
    if version < RESET_FORMAT_VERSION {
        return Err(WorldFormatError(before_the_reset(version)));
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
    // Empty until the first step after the reset; then it checks every version since.
    #[allow(clippy::reversed_empty_ranges)]
    fn has_no_steps_from_before_the_reset_and_one_for_every_version_since() {
        let steps = migrations();
        assert!(steps.keys().all(|&v| v >= RESET_FORMAT_VERSION), "a step from before the reset");
        for v in RESET_FORMAT_VERSION..WORLD_FORMAT_VERSION {
            assert!(steps.contains_key(&v), "no migration from {v}");
        }
    }

    #[test]
    fn refuses_a_save_from_before_the_reset_saying_to_run_it() {
        let terrain = ctx_terrain();
        let ctx = MigrationContext { terrain: &terrain };
        // The last format before the reset, and the TypeScript freeze's.
        for old in [RESET_FORMAT_VERSION - 1, 111] {
            let err = migrate_world(json!({}), old, &ctx).unwrap_err();
            assert!(err.0.contains("run `csp-admin reset-world`"), "{err}");
        }
        assert_eq!(
            migrate_world(json!({ "tick": 1 }), WORLD_FORMAT_VERSION, &ctx).unwrap(),
            json!({ "tick": 1 })
        );
    }
}
