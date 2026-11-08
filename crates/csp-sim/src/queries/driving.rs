//! Read-only checks of driving a carriage (`driveProblem`, `carriageCanGoTo`, `roadAt` of
//! `packages/shared`), of contact (`inContact`) and of where an army stands (`armySpot`).

use csp_shared::balance::carriage_can_enter;
use csp_shared::terrain::{terrain_at, wrap_delta, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Carriage, Resident, WorldState};

use super::carriages::{driver_of, horse_for};
use super::residents::{can_work, is_down};

/// The road or road site on a tile (`roadAt`).
pub fn road_at(world: &WorldState, x: f64, y: f64) -> Option<&Building> {
    world.buildings.iter().find(|b| b.x == x && b.y == y && b.kind == BuildingKind::Road)
}

/// Whether a carriage can go onto a tile (`carriageCanGoTo`): by its finished road, else its
/// terrain.
pub fn carriage_can_go_to(world: &WorldState, map: &TerrainMap, x: f64, y: f64) -> bool {
    let road = road_at(world, x, y).is_some_and(|r| r.site.is_none());
    let t = if road { Terrain::Road as u8 } else { terrain_at(map, x as i32, y as i32) };
    carriage_can_enter(t)
}

/// Why a resident can't drive a carriage now (`driveProblem`), or `None`.
pub fn drive_problem(
    world: &WorldState,
    resident: &Resident,
    carriage: &Carriage,
) -> Option<String> {
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t drive".into());
    }
    if resident.riding.is_some() {
        return Some("dismount first to drive".into());
    }
    if carriage.x != resident.x || carriage.y != resident.y {
        return Some("that carriage is not on the resident’s tile".into());
    }
    let horse = horse_for(world, carriage);
    let Some(horse) = horse.filter(|h| h.x == carriage.x && h.y == carriage.y) else {
        return Some("no horse here to pull that carriage".into());
    };
    if is_down(horse.down_until) {
        return Some("its horse is Down".into());
    }
    if driver_of(world, &carriage.id).is_some_and(|d| d.id != resident.id) {
        return Some("someone else is driving that carriage".into());
    }
    None
}

/// Whether two tiles touch or are the same (`inContact`).
pub fn in_contact(size: i32, a: (f64, f64), b: (f64, f64)) -> bool {
    wrap_delta(a.0 as i32, b.0 as i32, size).abs() <= 1
        && wrap_delta(a.1 as i32, b.1 as i32, size).abs() <= 1
}

/// Where the member of an army or punishing party nearest `from` stands (`armySpot`).
pub fn army_spot(
    world: &WorldState,
    army_id: &str,
    from: (f64, f64),
    size: i32,
) -> Option<(f64, f64)> {
    let members: Vec<&str> = match world.armies.iter().find(|a| a.id == army_id) {
        Some(a) => a.member_ids.iter().map(String::as_str).collect(),
        None => world
            .punishments
            .iter()
            .find(|p| p.id == army_id)?
            .members
            .iter()
            .map(|m| m.resident_id.as_str())
            .collect(),
    };
    let mut best: Option<((f64, f64), f64)> = None;
    for r in &world.residents {
        if !members.contains(&r.id.as_str()) {
            continue;
        }
        let d = wrap_distance(size, (from.0 as i32, from.1 as i32), (r.x as i32, r.y as i32));
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some(((r.x, r.y), d));
        }
    }
    best.map(|(at, _)| at)
}
