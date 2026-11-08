//! The one query of `packages/shared/src/combat.ts` that is not combat's own.

use csp_shared::terrain::wrap_delta;

/// Whether two residents are in contact (`inContact`, `CONTEXT.md`: Combat): on the same tile or
/// one of the eight around it, the short way round the map of `size` tiles.
pub fn in_contact(size: i32, a: (i32, i32), b: (i32, i32)) -> bool {
    wrap_delta(a.0, b.0, size).abs() <= 1 && wrap_delta(a.1, b.1, size).abs() <= 1
}
