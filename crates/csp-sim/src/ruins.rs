//! Ruins and collapse (`CONTEXT.md`: Ruin; Epic 97): a building whose condition runs out becomes a
//! ruin. It stands and blocks the way but does nothing: a ruined wall or gate tile is a gap, a
//! house houses nobody, a workplace makes nothing, a storage takes nothing in, though anyone at it
//! can take out what is left in it. It is rebuilt with the repair order, for less than a new one
//! (`REBUILD_MATERIALS_SHARE`, `REBUILD_WORK_SHARE`). Left `RUIN_COLLAPSE_DAYS` game days more it
//! collapses: it is gone, and part of its materials, with any goods still in it, lie on its tiles.

use csp_shared::balance::{
    COLLAPSE_MATERIALS_LEFT, REBUILD_MATERIALS_SHARE, REBUILD_WORK_SHARE, RUIN_COLLAPSE_DAYS,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, ResidentOrder, Stock, WorldState};

use crate::cities::{dissolve_city, update_city_membership};
use crate::queries::building::{build_materials, build_work_of};
use crate::repair::decays;
use crate::survival::drop_goods;
use crate::tick::Scratch;
use crate::world_index::building_index;

/// Whether `b` is a ruin (`CONTEXT.md`: Ruin).
pub fn is_ruin(b: &Building) -> bool {
    b.ruined_at.is_some()
}

/// Whether `b` is a finished building that does what its kind does: no construction site and no
/// ruin.
pub fn standing(b: &Building) -> bool {
    b.site.is_none() && !is_ruin(b)
}

/// The materials rebuilding the ruin of a building of `kind` takes (`REBUILD_MATERIALS_SHARE` of
/// its `BUILD_MATERIALS`, rounded up to whole units).
pub fn rebuild_materials(kind: BuildingKind) -> Stock {
    build_materials(kind)
        .into_iter()
        .map(|(g, n)| (g, (n * REBUILD_MATERIALS_SHARE).ceil()))
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// The work rebuilding the ruin of a building of `kind` takes (`REBUILD_WORK_SHARE` of its
/// `BUILD_WORK`).
pub fn rebuild_work(kind: BuildingKind) -> f64 {
    build_work_of(kind) * REBUILD_WORK_SHARE
}

/// What lies on a collapsed building's tiles of its materials (`COLLAPSE_MATERIALS_LEFT`, rounded
/// down to whole units).
pub fn collapse_leaves(kind: BuildingKind) -> Stock {
    build_materials(kind)
        .into_iter()
        .map(|(g, n)| (g, (n * COLLAPSE_MATERIALS_LEFT).floor()))
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// Ticks a ruin stands before it collapses.
fn collapse_ticks() -> f64 {
    RUIN_COLLAPSE_DAYS * TICKS_PER_GAME_DAY
}

/// At the turn of each game day, after decay (`repair::step_decay`): a finished building that has
/// lost all its condition becomes a ruin, its wall damage forgotten (a gap takes no blows); a ruin
/// that has stood `RUIN_COLLAPSE_DAYS` collapses. Returns the buildings that collapsed.
pub fn step_ruins(world: &mut WorldState, size: i32, scratch: &mut Scratch) -> Vec<Building> {
    if world.tick == 0 || world.tick as f64 % TICKS_PER_GAME_DAY != 0.0 {
        return Vec::new();
    }
    let tick = world.tick as f64;
    for b in &mut world.buildings {
        if b.ruined_at.is_none() && decays(b) && b.decay.is_some_and(|d| d >= 1.0) {
            b.ruined_at = Some(tick);
            b.damage = None;
        }
    }
    let falls: Vec<String> = world
        .buildings
        .iter()
        .filter(|b| b.ruined_at.is_some_and(|at| tick - at >= collapse_ticks()))
        .map(|b| b.id.clone())
        .collect();
    let mut fallen = Vec::new();
    for id in falls {
        let Some(i) = building_index(world, &id) else { continue };
        fallen.push(collapse(world, i, size, scratch));
    }
    if !fallen.is_empty() {
        update_city_membership(world, size);
        end_orders_on_gone(world);
    }
    fallen
}

/// The ruin at `i` collapses: it is gone, part of its materials and what it kept lie on its tiles,
/// and a town hall's city is dissolved, as when it is torn down.
fn collapse(world: &mut WorldState, i: usize, size: i32, scratch: &mut Scratch) -> Building {
    let b = world.buildings.remove(i);
    let left = collapse_leaves(b.kind);
    drop_goods(world, b.x, b.y, &left, size);
    scratch.made.note(&left);
    if let Some(stock) = &b.stock {
        drop_goods(world, b.x, b.y, stock, size);
    }
    if let Some(repair) = &b.repair {
        drop_goods(world, b.x, b.y, &repair.delivered, size);
    }
    if let Some(city) = world.cities.iter().find(|c| c.town_hall_id == b.id) {
        let city_id = city.id.clone();
        dissolve_city(world, &city_id);
    }
    b
}

/// Orders on a building that is gone end.
fn end_orders_on_gone(world: &mut WorldState) {
    let gone = |w: &WorldState, id: &str| building_index(w, id).is_none();
    let ends: Vec<usize> = (0..world.residents.len())
        .filter(|&i| match &world.residents[i].order {
            Some(ResidentOrder::TearDown(o)) => gone(world, &o.building_id),
            Some(ResidentOrder::Repair(o)) => gone(world, &o.building_id),
            Some(ResidentOrder::Build(o)) => o.site_id.as_deref().is_some_and(|s| gone(world, s)),
            _ => false,
        })
        .collect();
    for i in ends {
        world.residents[i].order = None;
    }
}

#[cfg(test)]
#[path = "ruins/tests.rs"]
mod tests;
