//! An NPC city's scouts (`apps/server/src/npc-scouts.ts`, `CONTEXT.md`: Scout; ADR 0026). They
//! run the game's Explore default like a Player's explorer, but what is unexplored is what their
//! city doesn't know. A city's knowledge goes by sectors (`NPC_SCOUT_SECTOR`), so it stays small
//! plain data: `City.scouted`, the sectors scouts brought home, and `CityPlan.scouts`, what each
//! scout out has seen and not brought home yet.

use csp_shared::balance::{NPC_NODE_REACH, NPC_SCOUT_LIMIT, NPC_SCOUT_SECTOR};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::City;

/// Sectors along each side of the map (`sectorsAcross`).
fn sectors_across(size: i32) -> i32 {
    (f64::from(size) / NPC_SCOUT_SECTOR).ceil() as i32
}

/// The sector a tile lies in, as a number (`sectorOf`).
pub fn sector_of(size: i32, x: i32, y: i32) -> f64 {
    let across = f64::from(sectors_across(size));
    (f64::from(y) / NPC_SCOUT_SECTOR).floor() * across + (f64::from(x) / NPC_SCOUT_SECTOR).floor()
}

/// Whether a city knows of a resource node (`knowsNode`, `CONTEXT.md`: Scout): within its set
/// reach it simply does; out to its limit, once a scout who saw the node's sector has come home,
/// unless it has found no way to that sector.
pub fn knows_node(city: &City, home: (i32, i32), node: (i32, i32), size: i32) -> bool {
    let d = wrap_distance(size, home, node);
    if d <= NPC_NODE_REACH {
        return true;
    }
    let Some(scouted) = &city.scouted else { return false };
    if d > NPC_SCOUT_LIMIT {
        return false;
    }
    let sector = sector_of(size, node.0, node.1);
    scouted.sectors.contains(&sector)
        && !scouted.no_way.as_ref().is_some_and(|n| n.contains(&sector))
}
