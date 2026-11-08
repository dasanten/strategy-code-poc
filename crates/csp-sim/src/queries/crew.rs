//! Where a crew stands at a building (`packages/shared/src/crew.ts`, `CONTEXT.md`: Spreading over
//! the footprint).

use std::collections::HashMap;

use csp_shared::footprint::{covers, footprint_tiles};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Building, Resident, ResidentOrder, WorldState};

use super::names::placed;

/// Where a resident stands at a building they are sent to work, build or breed at (`crewTile`,
/// `CONTEXT.md`: Spreading over the footprint): the footprint tile with the fewest of the crew on
/// it, the nearest to them on ties.
///
/// The crew are the residents `of_crew` picks out, other than `me`: those holding a work-at,
/// build or breed order at the building, counted on the tile they stand on, and those on their
/// way there, counted on the tile they walk to, which their running script keeps as `memory.at`.
pub fn crew_tile(
    world: &WorldState,
    building: &Building,
    me: (&str, i32, i32),
    of_crew: impl Fn(&Resident) -> bool,
    size: i32,
) -> (i32, i32) {
    let (me_id, mx, my) = me;
    let tiles = footprint_tiles(placed(building), size);
    let mut counts: HashMap<(i32, i32), u32> = tiles.iter().map(|t| (*t, 0)).collect();
    for r in &world.residents {
        if r.id == me_id || !of_crew(r) {
            continue;
        }
        if let Some(at) = stands_at(r, building, size) {
            *counts.entry(at).or_insert(0) += 1;
        }
    }
    let mut best = tiles[0];
    let mut best_count = u32::MAX;
    let mut best_distance = f64::INFINITY;
    for &(x, y) in &tiles {
        let count = counts[&(x, y)];
        let distance = wrap_distance(size, (mx, my), (x, y));
        if count < best_count || (count == best_count && distance < best_distance) {
            best = (x, y);
            best_count = count;
            best_distance = distance;
        }
    }
    best
}

/// The footprint tile a resident counts on as one of a building's crew (`standsAt`): where their
/// script sends them, if on the footprint, else where they stand holding an order at the
/// building; `None` for one not of its crew.
fn stands_at(r: &Resident, building: &Building, size: i32) -> Option<(i32, i32)> {
    let at = r.script.as_ref().and_then(|s| s.memory.get("at")).and_then(|at| at.as_object());
    if let Some(at) = at {
        if let (Some(x), Some(y)) = (
            at.get("x").and_then(serde_json::Value::as_f64),
            at.get("y").and_then(serde_json::Value::as_f64),
        ) {
            // `covers` takes whole tiles; a script's `at` is a tile.
            if covers(placed(building), x as i32, y as i32, size) {
                return Some((x as i32, y as i32));
            }
        }
    }
    let there = match &r.order {
        Some(ResidentOrder::WorkAt(o)) => o.building_id == building.id,
        Some(ResidentOrder::Build(o)) => o.site_id.as_deref() == Some(building.id.as_str()),
        Some(ResidentOrder::Breed(o)) => o.stable_id == building.id,
        _ => false,
    };
    let (x, y) = (r.x as i32, r.y as i32);
    (there && covers(placed(building), x, y, size)).then_some((x, y))
}
