//! The map: terrain, resource nodes, veins, gathering patches and paths.

use csp_shared::terrain::{
    beside_step, is_passable_terrain, is_sea, is_water, step_length, terrain_at, tile_index,
    Terrain, TerrainMap,
};
use csp_shared::world::{ResidentOrder, ResourceKind, VesselKind, WorldState};

use super::shared::Out;
use super::{invariant, js_number, violation, Invariant};
use crate::queries::vessels::rowing_now;
use crate::world::is_walkable;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("nothing-on-impassable-terrain", nothing_on_impassable_terrain),
    invariant("positions-on-map", positions_on_map),
    invariant("waypoints-sound", crate::waypoints::waypoints_sound),
    invariant("patches-sound", crate::gathering::patch_problems),
    invariant("nodes-on-fitting-terrain", nodes_on_fitting_terrain),
    invariant("veins-sound", |w, _| crate::veins::veins_sound(w)),
    invariant("veins-counted", |w, _| crate::new_veins::veins_counted(w)),
    invariant("starting-sites-sound", |w, _t| crate::player_start::starting_sites_sound(w)),
    invariant("paths-are-steps", paths_are_steps),
];

/// Nothing stands on impassable terrain.
pub fn nothing_on_impassable_terrain(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "nothing-on-impassable-terrain";
    let mut things: Vec<(&str, f64, f64)> = Vec::new();
    // A vessel's passenger stands on its water tile (`CONTEXT.md`: Beside a vessel); that it
    // does is `vessel-passengers`.
    let on_vessel = |r: &&csp_shared::world::Resident| {
        r.aboard.as_deref().is_some_and(|id| world.vessels.iter().any(|v| v.id == id))
    };
    things.extend(
        world.residents.iter().filter(|r| !on_vessel(r)).map(|t| (t.id.as_str(), t.x, t.y)),
    );
    things.extend(world.horses.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.carriages.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.buildings.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.piles.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things
        .into_iter()
        .filter(|(_, x, y)| !is_walkable(terrain, *x as i32, *y as i32))
        .map(|(id, x, y)| {
            let msg = format!(
                "{id} stands on impassable terrain at ({}, {})",
                js_number(x),
                js_number(y)
            );
            violation(name, msg, &[id])
        })
        .collect()
}

/// Every position is stored as a tile on the map (0 ≤ x, y < size).
pub fn positions_on_map(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "positions-on-map";
    let on = |v: f64| v.fract() == 0.0 && v >= 0.0 && v < terrain.size as f64;
    let mut things: Vec<(&str, f64, f64)> = Vec::new();
    things.extend(world.residents.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.horses.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.carriages.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.vessels.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.siege_machines.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.buildings.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.nodes.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things.extend(world.piles.iter().map(|t| (t.id.as_str(), t.x, t.y)));
    things
        .into_iter()
        .filter(|(_, x, y)| !on(*x) || !on(*y))
        .map(|(id, x, y)| {
            let msg =
                format!("{id} is at ({}, {}), off the map's tiles", js_number(x), js_number(y));
            violation(name, msg, &[id])
        })
        .collect()
}

/// The terrains each kind of node lies on (`NODE_TERRAINS`).
pub fn node_terrains(kind: ResourceKind) -> &'static [Terrain] {
    match kind {
        ResourceKind::Forest => &[Terrain::Forest],
        ResourceKind::Stone => &[Terrain::Hills],
        ResourceKind::IronOre | ResourceKind::GoldOre | ResourceKind::Coal => {
            &[Terrain::Hills, Terrain::Mountain]
        }
    }
}

/// Every resource node lies on terrain that fits its kind.
pub fn nodes_on_fitting_terrain(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "nodes-on-fitting-terrain";
    world
        .nodes
        .iter()
        .filter(|n| {
            let t = terrain_at(terrain, n.x as i32, n.y as i32);
            !node_terrains(n.kind).iter().any(|k| *k as u8 == t)
        })
        .map(|n| {
            let kind = serde_json::to_value(n.kind).ok();
            let kind = kind.as_ref().and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let msg = format!(
                "{kind} node {} lies on unfitting terrain at ({}, {})",
                n.id,
                js_number(n.x),
                js_number(n.y)
            );
            violation(name, msg, &[&n.id])
        })
        .collect()
}

/// Every step left on a moving order's path is a step the resident can take
/// (`pathsAreSteps`); a rower's, a step their boat can take over water (`CONTEXT.md`: Rowing).
pub fn paths_are_steps(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "paths-are-steps";
    let size = terrain.size;
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
        let rowing = rowing_now(r).is_some();
        // A ship's, sailed or on a haul route, a step over Sea (`CONTEXT.md`: Sailing).
        let on_ship = rowing_now(r).is_some_and(|id| {
            world.vessels.iter().any(|v| v.id == id && v.kind == VesselKind::Ship)
        });
        let sailing = matches!(o, ResidentOrder::Sail(_)) || on_ship;
        let enterable = |t: usize| {
            if sailing {
                is_sea(terrain.tiles[t])
            } else if rowing {
                is_water(terrain.tiles[t])
            } else {
                is_passable_terrain(terrain.tiles[t])
            }
        };
        // `'path' in o && o.path`: any order with a path.
        let Ok(v) = serde_json::to_value(o) else { continue };
        let Some(path) = v.get("path").and_then(|p| p.as_array()) else { continue };
        let (mut x, mut y) = (r.x as i32, r.y as i32);
        let mut bad = None;
        for (i, step) in path.iter().enumerate() {
            let nx = step[0].as_f64().unwrap_or(f64::NAN) as i32;
            let ny = step[1].as_f64().unwrap_or(f64::NAN) as i32;
            let ok = step_length(size, x, y, nx, ny) > 0.0
                && enterable(tile_index(size, nx, ny))
                && beside_step(size, x, y, nx, ny).into_iter().all(enterable);
            (x, y) = (nx, ny);
            if !ok {
                bad = Some(i);
                break;
            }
        }
        if let Some(i) = bad {
            let msg =
                format!("resident {} has a path whose step {i} is no step they can take", r.id);
            out.push(violation(name, msg, &[&r.id]));
        }
    }
    out
}
