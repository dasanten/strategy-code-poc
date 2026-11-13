//! The Region map's invariant (`apps/server/src/region-map.ts`, ADR 0004).

use std::collections::HashSet;

use crate::queries::region_map::{region_tiles, RegionMap};
use crate::queries::territory::Territory;
use crate::sight::InvariantViolation;

/// Invariant `region-map-sound` (`regionMapUnsound`): a Region map update sent to a Player, whole
/// or in part, shows territory only on terrain they explored, and every tile on it as the
/// territory has it: held by that holder, and by no other. Its runs stay inside their chunks and
/// name only holders it lists.
pub fn region_map_unsound(
    region: &RegionMap,
    territory: &Territory,
    size: i32,
    is_explored: &dyn Fn(i32, i32) -> bool,
    realm_id: &str,
) -> Vec<InvariantViolation> {
    let violation = |message: String, holder: Option<&str>| InvariantViolation {
        invariant: "region-map-sound".into(),
        message,
        entity_ids: holder.into_iter().map(str::to_string).chain([realm_id.to_string()]).collect(),
    };
    let (tiles, problems) = region_tiles(region, size);
    let mut out: Vec<InvariantViolation> = problems
        .into_iter()
        .map(|p| violation(format!("the Region map sent to realm {realm_id}: {p}"), None))
        .collect();
    let mut shown = HashSet::new();
    for (t, holder) in tiles {
        let Some(holder) = usize::try_from(holder).ok().and_then(|h| region.holders.get(h)) else {
            continue;
        };
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
        out.push(violation(
            format!("tile {x},{y} went to realm {realm_id} as held by {}: {problem}", holder.id),
            Some(&holder.id),
        ));
    }
    out
}

#[cfg(test)]
mod tests;
