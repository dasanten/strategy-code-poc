//! The wall walk (`CONTEXT.md`: Wall walk, ADR 0036): who is up on top of a wall or gate. Getting
//! up, walking along and getting down are steps of a path (`walking`, `pathfinding`); here is what
//! keeps being up true to the walls each tick, and the invariants of it (ADR 0004).

use csp_shared::balance::{FALL_DAMAGE, MAP_SIZE, TOWER_ROOM};
use csp_shared::footprint::{covers, footprint_tiles};
use csp_shared::terrain::{is_passable_terrain, tile_index, wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, DeathCause, Realm, Resident, ResidentOrder, UpSide, WorldState,
};
use rustc_hash::FxHashMap;

use crate::invariants::{violation, InvariantViolation};
use crate::queries::city::town_hall_of;
use crate::queries::combat::{in_contact, ranged_weapon};
use crate::queries::names::placed;
use crate::queries::walls::is_up;
use crate::running::RunningOrder;
use crate::survival::die_all;
use crate::walls::{is_wall_or_gate, neighbours, of_wall_side, plain_ground, side_of, wall_map};

/// The finished walls, gates and towers by tile, a tower on every tile of its footprint.
fn walls_by_tile(world: &WorldState) -> FxHashMap<(i64, i64), &Building> {
    world
        .buildings
        .iter()
        .filter(|b| is_wall_or_gate(b))
        .flat_map(|b| {
            footprint_tiles(placed(b), MAP_SIZE)
                .into_iter()
                .map(move |(x, y)| ((i64::from(x), i64::from(y)), b))
        })
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
            (Some(w), None) if w.kind != BuildingKind::Gate && of_wall_side(world, w, r) => {
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

/// Whoever is up on a wall or gate tile that broke this tick (`broken`) falls (`CONTEXT.md`: A tile
/// breaks): down to the ground next to it on its inside, as the walls stood before they broke, or
/// for a stretch with no inside to the ground nearest its city, and loses `FALL_DAMAGE`. Someone
/// left with no health, a Down resident too, dies of the fall like of a blow: the realm log says
/// so and what they carried drops as Loot. Returns who died and the realms that ended with them.
pub fn fall_from_broken(
    world: &mut WorldState,
    terrain: &TerrainMap,
    broken: &[Building],
) -> (Vec<String>, Vec<Realm>) {
    let size = terrain.size;
    let at = |b: &Building, r: &Resident| covers(placed(b), r.x as i32, r.y as i32, terrain.size);
    let falling: Vec<(usize, &Building)> = world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| r.up.is_some())
        .filter_map(|(i, r)| Some((i, broken.iter().find(|b| at(b, r))?)))
        .collect();
    if falling.is_empty() {
        return (Vec::new(), Vec::new());
    }
    // The walls as they stood before these tiles broke: their inside is where the falls land.
    let standing = world.buildings.len();
    world.buildings.extend(broken.iter().cloned());
    let walls = wall_map(world, terrain);
    world.buildings.truncate(standing);
    let mut died = Vec::new();
    for (i, wall) in falling {
        // From the tile they stood on: a tower is broad, its walk on every tile of it.
        let (x, y) = (world.residents[i].x as i32, world.residents[i].y as i32);
        let t = tile_index(size, x, y);
        let ground: Vec<usize> = neighbours(size, t)
            .into_iter()
            .filter(|&n| plain_ground(&walls, n) && is_passable_terrain(terrain.tiles[n]))
            .collect();
        let city = wall
            .city_id
            .as_deref()
            .and_then(|id| world.cities.iter().find(|c| c.id == id))
            .and_then(|c| town_hall_of(world, c))
            .map(|h| (h.x as i32, h.y as i32));
        let xy = |n: usize| ((n as i32) % size, (n as i32) / size);
        let nearest_city = || {
            let city = city?;
            ground.iter().copied().min_by(|&a, &b| {
                let (da, db) = (wrap_distance(size, xy(a), city), wrap_distance(size, xy(b), city));
                da.total_cmp(&db)
            })
        };
        let landing = ground
            .iter()
            .copied()
            .find(|&n| side_of(&walls, n) == UpSide::Inside)
            .or_else(nearest_city)
            .or_else(|| ground.first().copied())
            .unwrap_or(t);
        let (lx, ly) = xy(landing);
        let r = &mut world.residents[i];
        r.x = f64::from(lx);
        r.y = f64::from(ly);
        r.up = None;
        if let Some(going) = r.order.as_mut().and_then(|o| o.going_mut()) {
            going.reset();
        }
        r.health = (r.health - FALL_DAMAGE).max(0.0);
        if r.health <= 0.0 {
            died.push(r.id.clone());
        }
    }
    let (_, ended) = die_all(world, &died, DeathCause::Fell, size, None);
    (died, ended)
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

/// Never more residents up on a tower than its room (`CONTEXT.md`: Tower, `TOWER_ROOM`; ADR 0004).
pub fn tower_room(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "tower-room";
    let towers =
        world.buildings.iter().filter(|b| b.kind == BuildingKind::Tower && b.site.is_none());
    let mut out = Vec::new();
    for t in towers {
        let up: Vec<&str> = world
            .residents
            .iter()
            .filter(|r| r.up.is_some() && covers(placed(t), r.x as i32, r.y as i32, terrain.size))
            .map(|r| r.id.as_str())
            .collect();
        if up.len() as f64 > TOWER_ROOM {
            let msg = format!("tower {} has {} residents up, more than its room", t.id, up.len());
            out.push(violation(name, msg, &[&t.id]));
        }
    }
    out
}

/// Nobody on the ground holds an attack order on someone up on the wall walk they are in contact
/// with (`CONTEXT.md`: High ground, ADR 0004): no blow reaches up, so such an order ends. An
/// archer is left out: they shoot up (`CONTEXT.md`: Ranged combat).
pub fn none_attack_up_from_below(
    world: &WorldState,
    terrain: &TerrainMap,
) -> Vec<InvariantViolation> {
    let name = "none-attack-up-from-below";
    let size = terrain.size;
    let tile = |r: &Resident| (r.x as i32, r.y as i32);
    world
        .residents
        .iter()
        .filter(|a| !is_up(world, a))
        .filter_map(|a| {
            let Some(ResidentOrder::Attack(o)) = &a.order else { return None };
            let t = world.residents.iter().find(|t| t.id == o.target_id)?;
            // An archer may shoot up at them (`CONTEXT.md`: Ranged combat); one just out of Arrows
            // gives the order up on the next tick.
            if t.up.is_none() || !in_contact(size, tile(a), tile(t)) || ranged_weapon(a).is_some() {
                return None;
            }
            let msg = format!("{} on the ground attacks {}, up on the wall walk", a.id, t.id);
            Some(violation(name, msg, &[&a.id, &t.id]))
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

#[cfg(test)]
mod tower_tests;

#[cfg(test)]
mod tower_sight_tests;
