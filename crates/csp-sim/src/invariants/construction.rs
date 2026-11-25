//! Construction sites, tearing down, and walls and roads built in a line.

use csp_shared::balance::ROAD_LINE_MAX_TILES;
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::world::{BuildingKind, LinePhase, ResidentOrder, WorldState};

use super::shared::{at_building, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::queries::building::{
    is_stone, line_building, line_order, materials_needed, materials_of, teardown_work,
    work_needed, work_of, BUILDABLE,
};
use crate::queries::names::{good_name, kind_name};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("sites-within-needs", sites_within_needs),
    invariant("build-orders-on-sites", build_orders_on_sites),
    invariant("teardowns-within-needs", teardowns_within_needs),
    invariant("tear-down-orders-on-buildings", tear_down_orders_on_buildings),
    invariant("line-orders-sound", line_orders_sound),
];

/// A construction site never holds more materials than its building needs, nor goods it doesn't
/// need, and its work stays between 0 and what it needs; one that has everything has become its
/// building (`sitesWithinNeeds`).
pub fn sites_within_needs(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "sites-within-needs";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for b in &world.buildings {
        let Some(site) = &b.site else { continue };
        let needs = materials_of(b);
        for (good, units) in &site.delivered {
            let need = needs.get(good).copied().unwrap_or(0.0);
            if *units > need {
                fail(
                    &b.id,
                    format!(
                        "holds {} {}, needs {}",
                        js_number(*units),
                        good_name(*good),
                        js_number(need)
                    ),
                );
            }
        }
        let work = work_of(b);
        if !(site.work >= 0.0 && site.work <= work) {
            fail(&b.id, format!("has work {} of {}", js_number(site.work), js_number(work)));
        }
        if work_needed(b) == 0.0 && materials_needed(b).is_empty() {
            fail(&b.id, "has all its materials and work but is still a site".into());
        }
    }
    out
}

/// A resident with a build order on a site stands at that site, and it is still a site
/// (`buildOrdersOnSites`).
pub fn build_orders_on_sites(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "build-orders-on-sites";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Build(o)) = &r.order else { continue };
        let Some(site_id) = &o.site_id else { continue };
        let site = world.buildings.iter().find(|b| &b.id == site_id);
        if site.is_some_and(|s| s.site.is_some() && at_building(r.x, r.y, s)) {
            continue;
        }
        let msg = format!("resident {} builds {site_id}, which is not a site they stand at", r.id);
        out.push(violation(name, msg, &[&r.id, site_id]));
    }
    out
}

/// Only what can be built is ever being torn down, and its tear-down work stays between 0 and
/// what it needs (`teardownsWithinNeeds`).
pub fn teardowns_within_needs(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "teardowns-within-needs";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for b in &world.buildings {
        let Some(done) = b.teardown else { continue };
        if !BUILDABLE.contains(&b.kind) {
            fail(&b.id, format!("is a {} being torn down", kind_name(b.kind)));
        }
        let work = teardown_work(b);
        if !(done >= 0.0 && done < work) {
            fail(&b.id, format!("has tear-down work {} of {}", js_number(done), js_number(work)));
        }
    }
    out
}

/// A resident with a tear-down order stands at that building or site, and it is still there
/// (`tearDownOrdersOnBuildings`).
pub fn tear_down_orders_on_buildings(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "tear-down-orders-on-buildings";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::TearDown(o)) = &r.order else { continue };
        let b = world.buildings.iter().find(|x| x.id == o.building_id);
        if b.is_some_and(|b| at_building(r.x, r.y, b)) {
            continue;
        }
        // A siege machine is torn down from its tile (`CONTEXT.md`: Siege machine).
        let m = crate::siege::machine_by_id(world, &o.building_id);
        if m.is_some_and(|m| (m.x as i32, m.y as i32) == (r.x as i32, r.y as i32)) {
            continue;
        }
        let msg =
            format!("resident {} tears down {}, which they don’t stand at", r.id, o.building_id);
        out.push(violation(name, msg, &[&r.id, &o.building_id]));
    }
    out
}

/// Orders along a line are sound (`lineOrdersSound`).
pub fn line_orders_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "line-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(order) = &r.order else { continue };
        let (Some(o), Some(kind)) = (line_order(Some(order)), line_building(order)) else {
            continue;
        };
        let building = kind_name(kind);
        let mut ids = vec![r.id.as_str()];
        if let Some(s) = &o.site_id {
            ids.push(s);
        }
        let mut fail =
            |p: String| out.push(violation(name, format!("resident {} {p}", r.id), &ids));
        let Some(first) = o.tiles.first().copied() else {
            fail(format!("has a {building} order with {} tiles", o.tiles.len()));
            continue;
        };
        if o.tiles.len() as f64 > ROAD_LINE_MAX_TILES {
            fail(format!("has a {building} order with {} tiles", o.tiles.len()));
            continue;
        }
        let size = terrain.size;
        let apart = o.tiles.iter().enumerate().skip(1).find(|(i, (x, y))| {
            let (px, py) = o.tiles[i - 1];
            let dx = wrap_delta(px as i32, *x as i32, size).abs();
            let dy = wrap_delta(py as i32, *y as i32, size).abs();
            dx.max(dy) != 1
        });
        if let Some((i, _)) = apart {
            fail(format!(
                "has a {building} order whose tile {i} is not a step on from the one before"
            ));
        }
        if o.phase != LinePhase::Building {
            continue;
        }
        let Some(site_id) = &o.site_id else { continue };
        let site = world.buildings.iter().find(|b| &b.id == site_id);
        // A stone wall line builds a gate where it upgrades a wooden one (`CONTEXT.md`: Wood or
        // stone).
        let fits = |s: &csp_shared::world::Building| {
            s.kind == kind
                || (kind == BuildingKind::Wall
                    && s.kind == BuildingKind::Gate
                    && is_stone(s.kind, s.material))
        };
        let on_it = site.is_some_and(|s| s.site.is_some() && fits(s) && s.x == r.x && s.y == r.y);
        if !on_it || r.x != first.0 || r.y != first.1 {
            fail(format!(
                "builds {site_id}, which is not the {building} site on their tile and the order’s next"
            ));
        }
    }
    out
}
