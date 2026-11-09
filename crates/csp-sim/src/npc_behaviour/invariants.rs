//! The invariants of what NPC residents do between passes (`npc-behaviour.ts`, `npc-roads.ts`,
//! `npc-posts.ts`; ADR 0004).

use std::collections::{HashMap, HashSet};

use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, BuildingKind, CityJobKind, Good, ResidentOrder, WorldState};
use indexmap::IndexMap;

use super::{haul, run_by_npc_city};
use crate::npc_plan::{runners, violation};
use crate::npc_posts::{free_soldiers, stands_posts};
use crate::npc_roads::npc_road_crew;
use crate::queries::city::town_hall_of;
use crate::queries::goods::units_that_fit;
use crate::queries::names::{held, placed};
use crate::queries::residents::{can_work, is_armed, is_down};
use crate::sight::InvariantViolation;

/// More than this many idle on one storage is a crowd (`IDLE_CROWD`): some come to rest there
/// between passes, having just put a load away.
const IDLE_CROWD: usize = 12;

/// More than this many soldiers with nothing to do on one storage, just after the pass that sent
/// them off it, is a crowd (`STORAGE_CROWD`).
const STORAGE_CROWD: usize = 4;

/// Invariant `npc-residents-kept-going` (`CONTEXT.md`: NPC city): a resident a city runs, while it
/// has a plan, works by a default script, not a bare work-at order, and one carrying a child with
/// no room for a meal does not stand still with goods to put away.
pub fn npc_residents_kept_going(world: &WorldState) -> Vec<InvariantViolation> {
    let tick = world.tick as f64;
    let storages: HashSet<&str> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Storage && b.site.is_none())
        .filter_map(|b| b.city_id.as_deref())
        .collect();
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(city_id) = r.city_id.as_deref() else { continue };
        if r.script.is_some() || r.down_until.is_some() {
            continue;
        }
        let bare = matches!(r.order, Some(ResidentOrder::WorkAt(_)));
        let full = r.order.is_none()
            && r.carrying.as_ref().is_some_and(|c| c.since < tick - 1.0)
            && storages.contains(city_id)
            && held(&r.carried, Good::Food) < 1.0
            && units_that_fit(r, Good::Food, tick) == 0.0
            && haul(r, None).is_some();
        if !bare && !full {
            continue;
        }
        if !world.city_plans.contains_key(city_id)
            || !can_work(r.born_at, tick)
            || !run_by_npc_city(world, r)
        {
            continue;
        }
        let what = if bare {
            "works by a bare work-at order"
        } else {
            "carries a child with no room for a meal"
        };
        let message = format!("NPC resident {} {what}", r.id);
        out.push(violation("npc-residents-kept-going", message, vec![r.id.clone()]));
    }
    out
}

/// Invariant `npc-idle-off-the-storage` (`CONTEXT.md`: NPC city): an NPC city with a house has no
/// crowd of idle residents standing on its storage; they wait at the houses.
pub fn npc_idle_off_the_storage(
    world: &WorldState,
    terrain: &TerrainMap,
) -> Vec<InvariantViolation> {
    let tick = world.tick as f64;
    let mut storages: HashMap<&str, &Building> = HashMap::new();
    let mut housed: HashSet<&str> = HashSet::new();
    for b in &world.buildings {
        let Some(city_id) = b.city_id.as_deref() else { continue };
        if b.site.is_some() {
            continue;
        }
        if b.kind == BuildingKind::House {
            housed.insert(city_id);
        } else if b.kind == BuildingKind::Storage {
            storages.entry(city_id).or_insert(b);
        }
    }
    let mut crowds: IndexMap<&str, Vec<String>> = IndexMap::new();
    for r in &world.residents {
        let Some(city_id) = r.city_id.as_deref() else { continue };
        if r.order.is_some() || r.script.is_some() || is_down(r.down_until) {
            continue;
        }
        let storage = if housed.contains(city_id) { storages.get(city_id) } else { None };
        let Some(storage) = storage else { continue };
        if !is_at((r.x as i32, r.y as i32), placed(storage), terrain.size) {
            continue;
        }
        let plan = world.city_plans.get(city_id);
        let job = plan.and_then(|p| p.jobs.get(&r.id));
        let skip = if can_work(r.born_at, tick) {
            job.is_none_or(|j| j.kind != CityJobKind::Idle)
        } else {
            plan.is_none()
        };
        if skip {
            continue;
        }
        if run_by_npc_city(world, r) {
            crowds.entry(city_id).or_default().push(r.id.clone());
        }
    }
    let stands_at_houses =
        |id: &str| !world.cities.iter().find(|c| c.id == id).is_some_and(|c| c.trade_org.is_some());
    crowds
        .into_iter()
        .filter(|(id, crowd)| crowd.len() > IDLE_CROWD && stands_at_houses(id))
        .map(|(id, ids)| {
            let message = format!("{} idle residents of {id} stand on its storage", ids.len());
            violation("npc-idle-off-the-storage", message, ids)
        })
        .collect()
}

/// Invariant `npc-road-crew-sized` (`CONTEXT.md`: NPC road): a plan made this tick sends no more
/// to its road than its crew; the Trade Organization sends none.
pub fn npc_road_crew_sized(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(plan) = world.city_plans.get(&city.id) else { continue };
        let crew: Vec<String> = plan
            .jobs
            .iter()
            .filter(|(_, j)| j.kind == CityJobKind::Road)
            .map(|(id, _)| id.clone())
            .collect();
        if crew.is_empty() {
            continue;
        }
        if city.trade_org.is_none() && plan.planned_at != world.tick as f64 {
            continue;
        }
        let most = if city.trade_org.is_some() { 0.0 } else { npc_road_crew(world, city) };
        if crew.len() as f64 <= most {
            continue;
        }
        let message = format!("{} plans a road crew of {}, at most {most}", city.id, crew.len());
        let mut ids = vec![city.id.clone()];
        ids.extend(crew);
        out.push(violation("npc-road-crew-sized", message, ids));
    }
    out
}

/// Invariant `npc-soldiers-on-posts` (`CONTEXT.md`: Soldier posts): the tick after a pass, its
/// soldiers do not crowd the storage, and someone armed holds or is going to the town hall.
pub fn npc_soldiers_on_posts(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    let size = terrain.size;
    let mut people: Option<IndexMap<String, Vec<usize>>> = None;
    for city in &world.cities {
        if city.realm_id.is_some() || !stands_posts(world, city) {
            continue;
        }
        let Some(plan) = world.city_plans.get(&city.id) else { continue };
        // Only the tick after: that of the pass itself has ended, so its orders have gone out.
        if tick != plan.planned_at + 1.0 {
            continue;
        }
        let people = people.get_or_insert_with(|| runners(world).0);
        let own = people.get(&city.id).cloned().unwrap_or_default();
        let adults: Vec<usize> =
            own.iter().copied().filter(|&i| can_work(world.residents[i].born_at, tick)).collect();
        // Soldiers when it planned: one armed since has had no post yet.
        let soldiers: Vec<usize> = free_soldiers(world, city, &adults)
            .into_iter()
            .filter(|&i| {
                plan.jobs
                    .get(&world.residents[i].id)
                    .is_some_and(|j| j.kind == CityJobKind::Soldier)
            })
            .collect();
        if soldiers.is_empty() {
            continue;
        }
        let storage = world.buildings.iter().find(|b| {
            b.city_id.as_deref() == Some(city.id.as_str())
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        });
        let crowd: Vec<String> = soldiers
            .iter()
            .map(|&i| &world.residents[i])
            .filter(|r| {
                r.order.is_none()
                    && storage.is_some_and(|s| is_at((r.x as i32, r.y as i32), placed(s), size))
            })
            .map(|r| r.id.clone())
            .collect();
        if crowd.len() > STORAGE_CROWD {
            let message = format!("{} soldiers of {} stand on its storage", crowd.len(), city.id);
            out.push(violation("npc-soldiers-on-posts", message, crowd));
        }
        let hall = town_hall_of(world, city).expect("a town hall: it stands posts");
        let on_the_way = |order: &Option<ResidentOrder>| match order {
            Some(ResidentOrder::WalkTo(o)) => {
                is_at((o.target.x as i32, o.target.y as i32), placed(hall), size)
            }
            _ => false,
        };
        let held_hall = own.iter().map(|&i| &world.residents[i]).any(|r| {
            is_armed(&r.carried)
                && (is_at((r.x as i32, r.y as i32), placed(hall), size) || on_the_way(&r.order))
        });
        if !held_hall {
            let message = format!("nobody holds or is going to the town hall of {}", city.id);
            let mut ids = vec![hall.id.clone()];
            ids.extend(soldiers.iter().map(|&i| world.residents[i].id.clone()));
            out.push(violation("npc-soldiers-on-posts", message, ids));
        }
    }
    out
}
