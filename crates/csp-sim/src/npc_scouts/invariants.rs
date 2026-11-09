//! The scouts' invariant (`npc-scouts.ts`; ADR 0004).

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{City, CityJobKind, CityPlan, CityProject, WorldState};

use super::{knows_node, scouts_wanted, sector_of, sectors_across};
use crate::npc_behaviour::npc_home;
use crate::npc_plan::violation;
use crate::queries::building::{building_at, corners_covering, node_workplace};
use crate::sight::InvariantViolation;

/// Whether a plan's project on a resource node is on one the city knows of (`plansOnKnown`), or
/// one in a sector it found no way to.
fn plans_on_known(world: &WorldState, city: &City, plan: &CityPlan, size: i32) -> bool {
    let Some(CityProject::Build { building, x, y }) = &plan.project else { return true };
    let (px, py) = (*x as i32, *y as i32);
    if building_at(world, px, py, MAP_SIZE).is_some() {
        return true;
    }
    let nodes: Vec<(i32, i32)> = world
        .nodes
        .iter()
        .filter(|n| {
            node_workplace(n.kind) == *building
                && corners_covering(*building, n.x as i32, n.y as i32, size)
                    .into_iter()
                    .any(|c| c == (px, py))
        })
        .map(|n| (n.x as i32, n.y as i32))
        .collect();
    let Some(home) = npc_home(world, &city.id) else { return true };
    if nodes.is_empty() {
        return true;
    }
    let home = (home.x as i32, home.y as i32);
    nodes.into_iter().any(|n| {
        knows_node(city, home, n, size)
            || city
                .scouted
                .as_ref()
                .and_then(|s| s.no_way.as_ref())
                .is_some_and(|w| w.contains(&sector_of(size, n.0, n.1)))
    })
}

/// Invariant `npc-scouts-sound` (`CONTEXT.md`: Scout): a city knows only sectors on the map, its
/// scouts saw only those; the Trade Organization sends none; a plan made this tick sends at most
/// one more than it wants and builds on a node only once it knows of it.
pub fn npc_scouts_sound(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let sectors = f64::from(sectors_across(terrain.size)).powi(2);
    let on_map = |s: &f64| s.fract() == 0.0 && *s >= 0.0 && *s < sectors;
    let mut fail = |city_id: &str, message: &str| {
        let message = format!("{city_id} {message}");
        out.push(violation("npc-scouts-sound", message, vec![city_id.to_string()]));
    };
    let tick = world.tick as f64;
    for city in &world.cities {
        let known =
            city.scouted.iter().flat_map(|s| s.sectors.iter().chain(s.no_way.iter().flatten()));
        if !known.into_iter().all(on_map) {
            fail(&city.id, "knows of a sector off the map");
        }
        let Some(plan) = world.city_plans.get(&city.id) else { continue };
        let trips: Vec<_> = plan.scouts.iter().flat_map(|s| s.values()).collect();
        if !trips.iter().all(|t| t.saw.iter().chain(t.no_way.iter().flatten()).all(on_map)) {
            fail(&city.id, "has a scout who saw a sector off the map");
        }
        let scouts = plan.jobs.values().filter(|j| j.kind == CityJobKind::Scout).count();
        if city.trade_org.is_some() && (scouts > 0 || !trips.is_empty()) {
            fail(&city.id, "of the Trade Organization, sends scouts");
        }
        let wanted = scouts_wanted(world, city);
        if plan.planned_at == tick && scouts > wanted + 1 {
            fail(&city.id, &format!("plans {scouts} scouts of {wanted}"));
        }
        if plan.planned_at == tick && !plans_on_known(world, city, plan, terrain.size) {
            fail(&city.id, "plans a workplace on a node it has not heard of");
        }
    }
    out
}
