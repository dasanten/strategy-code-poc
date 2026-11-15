//! The wall walk (`CONTEXT.md`: Wall walk, ADR 0036): who is up on top of a wall or gate. Getting
//! up, walking along and getting down are steps of a path (`walking`, `pathfinding`); here is what
//! keeps being up true to the walls each tick, and the invariants of it (ADR 0004).

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, BuildingKind, ResidentOrder, UpSide, WorldState};
use rustc_hash::FxHashMap;

use crate::invariants::{violation, InvariantViolation};
use crate::walls::{is_wall_or_gate, of_wall_side};

/// The finished walls and gates by tile.
fn walls_by_tile(world: &WorldState) -> FxHashMap<(i64, i64), &Building> {
    world
        .buildings
        .iter()
        .filter(|b| is_wall_or_gate(b))
        .map(|b| ((b.x as i64, b.y as i64), b))
        .collect()
}

/// Keeps who is up true to the walls (`stepWallWalk`), once everything else moved this tick:
/// nobody stays up where no finished wall or gate is any more (a broken tile), nor on one that is
/// no longer of their side; one of its side standing on a wall tile, put there other than by a
/// step, is up on it, as having come from inside.
pub fn step_wall_walk(world: &mut WorldState) {
    if world.residents.iter().all(|r| r.up.is_none())
        && !world.buildings.iter().any(is_wall_or_gate)
    {
        return;
    }
    let walls = walls_by_tile(world);
    let mut changes: Vec<(usize, Option<UpSide>)> = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let wall = walls.get(&(r.x as i64, r.y as i64));
        let up = match (wall, r.up) {
            (None, Some(_)) => None,
            (Some(w), Some(_)) if !of_wall_side(world, w, r) => None,
            (Some(w), None) if w.kind == BuildingKind::Wall && of_wall_side(world, w, r) => {
                Some(UpSide::Inside)
            }
            _ => continue,
        };
        changes.push((i, up));
    }
    for (i, up) in changes {
        world.residents[i].up = up;
    }
}

/// Nobody is up anywhere but on a finished wall or gate tile (ADR 0004).
pub fn up_only_on_walls(world: &WorldState, _terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "up-only-on-walls";
    let walls = walls_by_tile(world);
    world
        .residents
        .iter()
        .filter(|r| r.up.is_some() && !walls.contains_key(&(r.x as i64, r.y as i64)))
        .map(|r| {
            let msg =
                format!("{} is up on a wall walk at ({}, {}) with no wall there", r.id, r.x, r.y);
            violation(name, msg, &[&r.id])
        })
        .collect()
}

/// Nobody of another side is up on a city's wall or gate, but a climber (ADR 0004).
pub fn up_only_on_own_walls(world: &WorldState, _terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "up-only-on-own-walls";
    let walls = walls_by_tile(world);
    world
        .residents
        .iter()
        .filter(|r| r.up.is_some() && !matches!(r.order, Some(ResidentOrder::Climb(_))))
        .filter_map(|r| {
            let w = walls.get(&(r.x as i64, r.y as i64))?;
            if of_wall_side(world, w, r) {
                return None;
            }
            let msg = format!("{} is up on {}, a wall not of their side", r.id, w.id);
            Some(violation(name, msg, &[&r.id, &w.id]))
        })
        .collect()
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod sent_up_tests;
