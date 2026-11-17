//! NPC cities upgrading their walls to stone (T106.3, `CONTEXT.md`: Wall / Gate, Wood or stone;
//! NPC city): once a town, holding Stone beyond its reserve, a city upgrades its outer wall's gate
//! first, then that wall tile by tile, nearest the gate first; its inner ring follows once the
//! outer one is stone. Villages, starting cities and the Trade Organization's stay as they are.
//! The upgrade takes Stone beyond its reserve only, last of a town's projects and while its road
//! crew is in: with no quarry it builds one, and its spare hands work it for the Stone.

use csp_shared::balance::{NPC_STONE_WALL_RESIDENTS, NPC_WALL_TILES_PER_TRIP};
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, CityProject, Stock, WallMaterial, WorldState,
};

use crate::npc_inner_wall::{holds_above_reserve, outer_walls};
use crate::queries::building::{build_materials_of, is_stone};
use crate::queries::city::city_residents;

/// Whether an NPC city is a town (`CONTEXT.md`: City): `NPC_STONE_WALL_RESIDENTS` of its own
/// residents or more. Only an NPC city is: no Player's, nor the Trade Organization's.
pub fn is_npc_town(world: &WorldState, city: &City) -> bool {
    if city.trade_org.is_some() || city.realm_id.is_some() {
        return false;
    }
    let own = city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0)
        .count();
    own as f64 >= NPC_STONE_WALL_RESIDENTS
}

fn is_wall(b: &Building) -> bool {
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
}

/// The city's finished walls and gates, its outer ring and its inner one (`outer_walls`).
fn rings_of<'w>(
    world: &'w WorldState,
    city: &City,
    home: (i32, i32),
    size: i32,
) -> (Vec<&'w Building>, Vec<&'w Building>) {
    let all: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_ref() == Some(&city.id) && is_wall(b) && b.site.is_none())
        .collect();
    let outer = outer_walls(&all, |b| (b.x as i32, b.y as i32), home, size);
    let inner = all.into_iter().filter(|b| !outer.iter().any(|o| o.id == b.id)).collect();
    (outer, inner)
}

/// A ring's wooden tiles in the order they are upgraded: its gate first, then the rest nearest the
/// gate first (the nearest to the home where it has none).
fn wooden_by_gate<'w>(ring: &[&'w Building], home: (i32, i32), size: i32) -> Vec<&'w Building> {
    let gate = ring.iter().find(|b| b.kind == BuildingKind::Gate);
    let from = gate.map_or(home, |g| (g.x as i32, g.y as i32));
    let far = |b: &Building| {
        let dx = wrap_delta(from.0, b.x as i32, size).abs();
        let dy = wrap_delta(from.1, b.y as i32, size).abs();
        (b.kind != BuildingKind::Gate, dx.max(dy), dx + dy, b.y as i32, b.x as i32)
    };
    let mut wooden: Vec<&Building> =
        ring.iter().copied().filter(|b| !is_stone(b.kind, b.material)).collect();
    wooden.sort_by_key(|b| far(b));
    wooden
}

/// The city's wooden walls and gates in the order it upgrades them to stone: its outer ring, then,
/// once that is all stone, its inner ring.
pub fn upgrade_order<'w>(
    world: &'w WorldState,
    city: &City,
    home: &Building,
    size: i32,
) -> Vec<&'w Building> {
    let home = (home.x as i32, home.y as i32);
    let (outer, inner) = rings_of(world, city, home, size);
    let outer = wooden_by_gate(&outer, home, size);
    if !outer.is_empty() {
        return outer;
    }
    wooden_by_gate(&inner, home, size)
}

/// Whether the city's outer ring is all of stone, so a new one it puts up when it grows is too
/// (`CONTEXT.md`: Wood or stone: a new outer wall is of the material its old one was).
pub fn outer_ring_of_stone(world: &WorldState, city: &City, home: &Building, size: i32) -> bool {
    let (outer, _) = rings_of(world, city, (home.x as i32, home.y as i32), size);
    !outer.is_empty() && outer.iter().all(|b| is_stone(b.kind, b.material))
}

/// The Stone of one upgrade trip: `NPC_WALL_TILES_PER_TRIP` tiles of stone wall's worth, as a
/// builder fetches for a wall; it covers a gate too.
fn trip() -> Stock {
    build_materials_of(BuildingKind::Wall, Some(WallMaterial::Stone))
        .into_iter()
        .map(|(g, n)| (g, n * NPC_WALL_TILES_PER_TRIP))
        .collect()
}

/// Whether a town has a wooden wall or gate left to upgrade, so wants Stone for it: a quarry
/// when it has none, its spare hands working it (`CONTEXT.md`: Wood or stone).
pub fn wants_stone_for_walls(world: &WorldState, city: &City) -> bool {
    is_npc_town(world, city)
        && world.buildings.iter().any(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && is_wall(b)
                && b.site.is_none()
                && !is_stone(b.kind, b.material)
        })
}

/// Whether a city has its road crew out (`CityJobKind::Road` in its plan): Stone above its
/// reserve goes on its roads first.
fn road_crew_out(world: &WorldState, city: &City) -> bool {
    world
        .city_plans
        .get(&city.id)
        .is_some_and(|p| p.jobs.values().any(|j| j.kind == CityJobKind::Road))
}

/// The stone site begun over one of the city's wooden walls or gates, if there is one.
fn begun_upgrade<'w>(world: &'w WorldState, city: &City) -> Option<&'w Building> {
    world.buildings.iter().find(|s| {
        s.site.is_some()
            && is_stone(s.kind, s.material)
            && world.buildings.iter().any(|w| {
                w.city_id.as_ref() == Some(&city.id)
                    && w.kind == s.kind
                    && w.site.is_none()
                    && !is_stone(w.kind, w.material)
                    && w.x == s.x
                    && w.y == s.y
            })
    })
}

fn stone_project(kind: BuildingKind, x: f64, y: f64) -> CityProject {
    CityProject::Build { building: kind, x, y, material: Some(WallMaterial::Stone) }
}

/// The next tile of a town's wall to upgrade to stone (`CONTEXT.md`: Wood or stone), if it is time
/// for one: the stone site it has begun first; else, while its wall isn't moving out, the next
/// wooden tile in `upgrade_order` once it holds that trip's Stone beyond its reserve.
pub fn stone_upgrade_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    size: i32,
    expanding: bool,
) -> Option<CityProject> {
    if !is_npc_town(world, city) {
        return None;
    }
    if let Some(site) = begun_upgrade(world, city) {
        return Some(stone_project(site.kind, site.x, site.y));
    }
    if expanding || road_crew_out(world, city) {
        return None;
    }
    let next = *upgrade_order(world, city, home, size).first()?;
    if !holds_above_reserve(world, city, &trip()) {
        return None;
    }
    Some(stone_project(next.kind, next.x, next.y))
}

#[cfg(test)]
mod tests;
