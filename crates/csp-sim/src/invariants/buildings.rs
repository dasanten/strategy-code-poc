//! Finished buildings: where they stand, their condition and the work in them.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::carriage_can_enter;
use csp_shared::footprint::{covers, footprint_tiles};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, touches_sea, touches_water, Terrain, TerrainMap,
};
use csp_shared::world::{BuildingKind, ResidentOrder, WorldState};

use super::shared::{at_building, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::queries::building::{
    building_at, carriage_can_go_to, has_choice, is_stone, max_workers, node_workplace, recipe_for,
    wooden_wall_index_at, workplace_good, BUILDABLE, OFF_NODES, ON_PLAINS, ON_SHORE, PROCESSING,
    SHARES_A_TILE,
};
use crate::queries::names::{good_name, kind_name, placed};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("workplace-settings-sound", |w, _| {
        crate::workplace_settings::workplace_settings_sound(w)
    }),
    invariant("buildings-in-place", buildings_in_place),
    invariant("work-orders-on-workplaces", work_orders_on_workplaces),
    invariant("conditions-in-range", conditions_in_range),
    invariant("repair-orders-on-buildings", repair_orders_on_buildings),
    invariant("trade-org-kept-up", trade_org_kept_up),
    invariant("ruins-ruined", ruins_ruined),
];

/// Buildings and construction sites keep to where they may go (`buildingsInPlace`).
pub fn buildings_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "buildings-in-place";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    let cities: HashSet<&str> = world.cities.iter().map(|c| c.id.as_str()).collect();
    let size = terrain.size;
    let mut tiles: HashMap<String, String> = HashMap::new();
    let mut nodes_at: HashMap<(i32, i32), &csp_shared::world::ResourceNode> = HashMap::new();
    for n in &world.nodes {
        // `new Map(...)`: the last node on a tile wins.
        nodes_at.insert((n.x as i32, n.y as i32), n);
    }
    for b in &world.buildings {
        let footprint = footprint_tiles(placed(b), size);
        let terrains: Vec<u8> = footprint.iter().map(|&(x, y)| terrain_at(terrain, x, y)).collect();
        let nodes: Vec<_> = footprint.iter().filter_map(|t| nodes_at.get(t)).collect();
        let kind = kind_name(b.kind);
        for &(x, y) in &footprint {
            let key = format!("{x},{y}");
            // A stone wall or gate site over the finished wooden one of its kind it upgrades has a
            // layer of its own (`CONTEXT.md`: Wood or stone); anywhere else it overlaps as any.
            let upgrades = b.site.is_some()
                && is_stone(b.kind, b.material)
                && wooden_wall_index_at(world, x, y, b.kind).is_some();
            let layer = if SHARES_A_TILE.contains(&b.kind) {
                format!("{kind} {key}")
            } else if upgrades {
                format!("upgrade {key}")
            } else {
                key.clone()
            };
            if let Some(other) = tiles.get(&layer) {
                fail(&b.id, format!("overlaps {other} on tile ({key})"));
            }
            tiles.insert(layer, b.id.clone());
        }
        if !terrains.iter().all(|&t| is_passable_terrain(t)) {
            fail(&b.id, format!("is a {kind} on impassable land"));
        }
        let city = b.city_id.as_deref();
        if b.kind == BuildingKind::Road {
            if let Some(c) = city {
                fail(&b.id, format!("is a road of city {c}"));
            }
            if b.stock.is_some() {
                fail(&b.id, "is a road with a stock".into());
            }
        } else if matches!(b.kind, BuildingKind::Ram | BuildingKind::Catapult) {
            // `CONTEXT.md`: Siege machine: a site in the field, where a carriage could stand.
            if b.site.is_none() {
                fail(&b.id, format!("is a finished {kind} site"));
            }
            if !carriage_can_go_to(world, terrain, b.x as i32, b.y as i32) {
                fail(&b.id, format!("is a {kind} site where no carriage can go"));
            }
            if !nodes.is_empty() {
                fail(&b.id, format!("is a {kind} site on a resource node"));
            }
            if let Some(c) = city {
                fail(&b.id, format!("is a ram site of city {c}"));
            }
            if b.stock.is_some() {
                fail(&b.id, "is a ram site with a stock".into());
            }
            if let Some(under) = building_at(world, b.x as i32, b.y as i32, size) {
                fail(&b.id, format!("is a ram site on a {}", kind_name(under.kind)));
            }
        } else if b.kind == BuildingKind::Carriage {
            if b.site.is_none() {
                fail(&b.id, "is a finished carriage site".into());
            }
            if !carriage_can_enter(terrains[0]) {
                fail(&b.id, "is a carriage site where no carriage can go".into());
            }
            if !nodes.is_empty() {
                fail(&b.id, "is a carriage site on a resource node".into());
            }
            if let Some(c) = city {
                fail(&b.id, format!("is a carriage site of city {c}"));
            }
            if b.stock.is_some() {
                fail(&b.id, "is a carriage site with a stock".into());
            }
            if let Some(under) = building_at(world, b.x as i32, b.y as i32, size) {
                if under.kind != BuildingKind::Stable {
                    fail(&b.id, format!("is a carriage site on a {}", kind_name(under.kind)));
                }
            }
        } else if b.kind == BuildingKind::Boat {
            // `CONTEXT.md`: Building a boat: on a haven tile that touches the water.
            if b.site.is_none() {
                fail(&b.id, "is a finished boat site".into());
            }
            if building_at(world, b.x as i32, b.y as i32, size)
                .is_none_or(|h| h.kind != BuildingKind::Haven)
            {
                fail(&b.id, "is a boat site off any haven".into());
            }
            if !touches_water(&footprint, size, |x, y| terrain_at(terrain, x, y)) {
                fail(&b.id, "is a boat site away from water".into());
            }
            if let Some(c) = city {
                fail(&b.id, format!("is a boat site of city {c}"));
            }
            if b.stock.is_some() {
                fail(&b.id, "is a boat site with a stock".into());
            }
        } else if b.kind == BuildingKind::Ship {
            // `CONTEXT.md`: Building a ship: on a haven tile that touches Sea.
            if b.site.is_none() {
                fail(&b.id, "is a finished ship site".into());
            }
            if building_at(world, b.x as i32, b.y as i32, size)
                .is_none_or(|h| h.kind != BuildingKind::Haven)
            {
                fail(&b.id, "is a ship site off any haven".into());
            }
            if !touches_sea(&footprint, size, |x, y| terrain_at(terrain, x, y)) {
                fail(&b.id, "is a ship site away from the Sea".into());
            }
            if let Some(c) = city {
                fail(&b.id, format!("is a ship site of city {c}"));
            }
            if b.stock.is_some() {
                fail(&b.id, "is a ship site with a stock".into());
            }
        } else if OFF_NODES.contains(&b.kind) {
            if !nodes.is_empty() {
                fail(&b.id, format!("is a {kind} on a resource node"));
            }
            if terrains.contains(&(Terrain::Mountain as u8)) {
                fail(&b.id, format!("is a {kind} on Mountain"));
            }
            if ON_SHORE.contains(&b.kind)
                && !touches_water(&footprint, size, |x, y| terrain_at(terrain, x, y))
            {
                fail(&b.id, format!("is a {kind} away from water"));
            }
            if PROCESSING.contains(&b.kind) {
                if let Some(c) = city {
                    fail(&b.id, format!("is a {kind} of city {c}"));
                }
            }
        } else if BUILDABLE.contains(&b.kind) && !ON_PLAINS.contains(&b.kind) {
            // A workplace whose node ran dry stands on where it was (`CONTEXT.md`: Running dry).
            let on_dry = nodes.is_empty()
                && b.site.is_none()
                && world.dry_nodes.iter().any(|d| {
                    covers(placed(b), d.x as i32, d.y as i32, size)
                        && node_workplace(d.kind) == b.kind
                });
            if !on_dry && (nodes.len() != 1 || node_workplace(nodes[0].kind) != b.kind) {
                fail(&b.id, format!("is a {kind} off its node"));
            }
            if let Some(c) = city {
                fail(&b.id, format!("is a {kind} of city {c}"));
            }
        } else if !nodes.is_empty() {
            fail(&b.id, format!("is a {kind} on a resource node"));
        }
        if let Some(c) = city {
            if !cities.contains(c) {
                fail(&b.id, format!("belongs to no city ({c})"));
            }
        }
        if matches!(b.kind, BuildingKind::Farm | BuildingKind::Stable)
            && terrains.iter().any(|&t| t != Terrain::Plains as u8)
        {
            fail(&b.id, format!("is a {kind} off Plains"));
        }
        if b.stock.as_ref().is_some_and(|s| s.values().any(|&kg| kg < 0.0)) {
            fail(&b.id, "has negative stock".into());
        }
    }
    for k in &world.carriages {
        if k.load.values().any(|&kg| kg < 0.0) {
            fail(&k.id, "has a negative load".into());
        }
    }
    out
}

/// A building's condition stays within its range: what it lost to decay is between nothing and
/// all of it, only on a finished building of a kind that decays; a repair under way is on one too,
/// and holds no more of each material, nor work, than a repair takes (`CONTEXT.md`: Decay,
/// Repairing).
pub fn conditions_in_range(world: &WorldState, _: &TerrainMap) -> Out {
    use crate::repair::{decays, repair_materials_of, repair_work_of};
    let name = "conditions-in-range";
    let mut out = Vec::new();
    for b in &world.buildings {
        let mut fail = |m: String| out.push(violation(name, format!("{} {m}", b.id), &[&b.id]));
        if let Some(d) = b.decay {
            if !(0.0..=1.0).contains(&d) {
                fail(format!("has lost {} of its condition", js_number(d)));
            }
            if !decays(b) {
                fail("has decayed but never decays".into());
            }
        }
        let Some(repair) = &b.repair else { continue };
        if !decays(b) {
            fail("is being repaired but never decays".into());
        }
        let materials = repair_materials_of(b);
        for (good, units) in &repair.delivered {
            let most = materials.get(good).copied().unwrap_or(0.0);
            if !(*units >= 0.0 && *units <= most) {
                fail(format!("has {} {good:?} for its repair of {}", js_number(*units), most));
            }
        }
        let work = repair_work_of(b);
        if !(repair.work >= 0.0 && repair.work <= work) {
            fail(format!("has repair work {} of {}", js_number(repair.work), js_number(work)));
        }
    }
    out
}

/// A ruin is a finished building of a kind that decays and has lost all its condition, takes no
/// blows, and has stood no longer than `RUIN_COLLAPSE_DAYS` (`CONTEXT.md`: Ruin).
pub fn ruins_ruined(world: &WorldState, _: &TerrainMap) -> Out {
    use csp_shared::balance::RUIN_COLLAPSE_DAYS;
    use csp_shared::time::TICKS_PER_GAME_DAY;
    let name = "ruins-ruined";
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for b in &world.buildings {
        let Some(at) = b.ruined_at else { continue };
        let mut fail = |m: String| out.push(violation(name, format!("{} {m}", b.id), &[&b.id]));
        if !crate::repair::decays(b) {
            fail("is a ruin but never decays".into());
        }
        if b.decay != Some(1.0) {
            fail(format!(
                "is a ruin with {} of its condition lost",
                js_number(b.decay.unwrap_or(0.0))
            ));
        }
        if b.damage.is_some() {
            fail("is a ruin with damage".into());
        }
        if !(at <= tick && tick - at < RUIN_COLLAPSE_DAYS * TICKS_PER_GAME_DAY) {
            fail(format!("became a ruin at tick {}", js_number(at)));
        }
    }
    out
}

/// A resident with a repair order stands at that building, and it is still there.
pub fn repair_orders_on_buildings(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "repair-orders-on-buildings";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Repair(o)) = &r.order else { continue };
        let b = world.buildings.iter().find(|x| x.id == o.building_id);
        if b.is_some_and(|b| at_building(r.x, r.y, b)) {
            continue;
        }
        let msg = format!("resident {} repairs {}, which they don’t stand at", r.id, o.building_id);
        out.push(violation(name, msg, &[&r.id, &o.building_id]));
    }
    out
}

/// The Trade Organization repairs its own at the turn of each day, so no building of the HQ or a
/// trading post is ever nearly a ruin, let alone a ruin (`CONTEXT.md`: Decay).
pub fn trade_org_kept_up(world: &WorldState, _: &TerrainMap) -> Out {
    use crate::repair::{condition_of, Condition};
    let name = "trade-org-kept-up";
    let theirs: Vec<&str> =
        world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.as_str()).collect();
    world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref().is_some_and(|c| theirs.contains(&c)))
        .filter(|b| matches!(condition_of(b), Some(Condition::NearlyRuin | Condition::Ruin)))
        .map(|b| {
            violation(name, format!("the Trade Org’s {} is nearly a ruin or worse", b.id), &[&b.id])
        })
        .collect()
}

/// A resident with a work-at order stands on the finished workplace it names, says what they
/// make exactly where there is a choice and makes something there, their share of the next unit
/// is between 0 and 1, and no workplace has more workers than it takes
/// (`workOrdersOnWorkplaces`).
pub fn work_orders_on_workplaces(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "work-orders-on-workplaces";
    let mut out = Vec::new();
    let mut workers: Vec<(&str, usize)> = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::WorkAt(o)) = &r.order else { continue };
        let mut fail = |m: String| {
            let msg = format!("resident {} works {}, {m}", r.id, o.building_id);
            out.push(violation(name, msg, &[&r.id, &o.building_id]));
        };
        let place = world.buildings.iter().find(|b| b.id == o.building_id);
        let makes = o.makes.map(good_name);
        match place {
            Some(p) if p.site.is_none() && max_workers(p.kind).is_some() => {
                // A smithy's workers say what they make or mend (`CONTEXT.md`: Mending); a
                // smelter's may say Steel, else Iron.
                if o.mends && (p.kind != BuildingKind::Smithy || makes.is_some()) {
                    fail("mending, which only a smithy's worker making nothing else does".into());
                } else if o.mends {
                    if !at_building(r.x, r.y, p) || o.at.x != r.x || o.at.y != r.y {
                        fail("which they don’t stand at".into());
                    }
                } else if makes.is_none()
                    && has_choice(p.kind)
                    && recipe_for(p.kind, None).is_none()
                {
                    fail("making nothing".into());
                } else if makes.is_some() && !has_choice(p.kind) {
                    fail(format!("making {} with nothing to choose", makes.unwrap_or_default()));
                } else if workplace_good(world, p, o.makes).is_none() {
                    fail(match makes {
                        None => "which makes nothing".into(),
                        Some(m) => format!("which can't make {m}"),
                    });
                } else if !at_building(r.x, r.y, p) || o.at.x != r.x || o.at.y != r.y {
                    fail("which they don’t stand at".into());
                }
            }
            _ => fail("which is no finished workplace".into()),
        }
        if !(o.progress >= 0.0 && o.progress < 1.0) {
            fail(format!("with progress {}", js_number(o.progress)));
        }
        match workers.iter_mut().find(|(id, _)| *id == o.building_id) {
            Some((_, n)) => *n += 1,
            None => workers.push((&o.building_id, 1)),
        }
    }
    for (id, n) in workers {
        let place = world.buildings.iter().find(|b| b.id == id);
        if let Some(max) = place.and_then(|p| max_workers(p.kind)) {
            if n as f64 > max {
                let msg = format!("{id} has {n} workers, over {}", js_number(max));
                out.push(violation(name, msg, &[id]));
            }
        }
    }
    out
}
