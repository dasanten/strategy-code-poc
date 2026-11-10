//! The save format of `apps/server/src/world-format.ts` (ADR 0006, ADR 0030): which version of
//! `WorldState` a save holds. The Rust server reads the version of the TypeScript freeze;
//! migrations from older ones are not ported (a save is migrated once by the TypeScript server
//! before the cutover), and later ones come with Epic 1004.

use super::WorldState;

/// `WORLD_FORMAT_VERSION` of `apps/server/src/world-format.ts` when this port was written. A test
/// reads that file, so the two cannot drift apart unnoticed.
pub const WORLD_FORMAT_VERSION: u32 = 111;

/// Why a save does not load.
#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("the saved world is format {found}, this server reads format {WORLD_FORMAT_VERSION}")]
    Version { found: u32 },
    #[error("the saved world does not match format {WORLD_FORMAT_VERSION}: {0}")]
    Shape(#[from] serde_json::Error),
}

/// A save's world state from its JSON (the `data` of a `world_saves` row, gunzipped) and the
/// `version` it was written in, which must be `WORLD_FORMAT_VERSION`.
pub fn parse_save(version: u32, json: &[u8]) -> Result<WorldState, SaveError> {
    if version != WORLD_FORMAT_VERSION {
        return Err(SaveError::Version { found: version });
    }
    Ok(serde_json::from_slice(json)?)
}
