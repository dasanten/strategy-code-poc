//! The Region map's invariant (`apps/server/src/region-map.ts`, ADR 0004).

use std::collections::HashSet;

use crate::queries::region_map::RegionMap;
use crate::queries::territory::Territory;
use crate::sight::InvariantViolation;

/// Invariant `region-map-sound` (`regionMapUnsound`): the Region map sent to a Player shows
/// territory only on terrain they explored, and every tile on it as the territory has it: held by
/// that holder, and by no other.
pub fn region_map_unsound(
    region: &RegionMap,
    territory: &Territory,
    size: i32,
    is_explored: &dyn Fn(i32, i32) -> bool,
    realm_id: &str,
) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut shown = HashSet::new();
    for holder in &region.holders {
        for &t in &holder.tiles {
            let (x, y) = ((t as i32) % size, (t as i32) / size);
            let problem = if !is_explored(x, y) {
                Some("unexplored")
            } else if shown.contains(&t) {
                Some("shown twice")
            } else if territory.owners.get(&t) != Some(&holder.id) {
                Some("not theirs")
            } else {
                None
            };
            shown.insert(t);
            let Some(problem) = problem else { continue };
            out.push(InvariantViolation {
                invariant: "region-map-sound".into(),
                message: format!(
                    "tile {x},{y} went to realm {realm_id} as held by {}: {problem}",
                    holder.id
                ),
                entity_ids: vec![holder.id.clone(), realm_id.to_string()],
            });
        }
    }
    out
}

#[cfg(test)]
mod tests;
