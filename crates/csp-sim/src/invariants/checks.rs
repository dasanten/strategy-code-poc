//! The invariants of `invariants.ts` itself, each a function named as the TypeScript `const`,
//! with its doc comment's rule. Messages are the TypeScript's, numbers printed as JavaScript does
//! (`js_number`, `js_json`).

// `!(x >= 0)` as the TypeScript writes it: true for NaN too, which a plain `x < 0` is not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    carriage_can_enter, trained_cap, ALLIANCE_LEAVE_DELAY, ALLIANCE_RECALL_DELAY,
    CARRIAGE_CAPACITY, CARRIAGE_MAX_CAPACITY, CARRYING_TICKS, CITY_AREA_MARGIN,
    CONSTRUCTION_SKILL_MAX, CRIME_MEMORY_DAYS, GOOD_WEIGHT, LIFESPAN_MAX, LIFESPAN_MIN, MAX_HEALTH,
    MAX_HUNGER, MEAL_UNITS, OCCUPATION_GAME_DAYS, PASSENGER_WEIGHT, REALM_LOG_LENGTH,
    REALM_NAME_MAX_LENGTH, ROAD_LINE_MAX_TILES, STABLE_BREED_DAYS, TRAINING_GROUND_MAX_TRAINEES,
    WORK_SKILL_MAX,
};
use csp_shared::footprint::{footprint_tiles, is_at, near_footprint};
use csp_shared::terrain::{
    beside_step, is_passable_terrain, is_water, step_length, terrain_at, tile_index, touches_water,
    wrap_delta, Terrain, TerrainMap,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, HaulPhase, HaulStop, LinePhase, ResidentOrder, ResourceKind, SkillName,
    Stock, WorldState,
};

use super::{js_json, js_number, violation, InvariantViolation};
use crate::caravans::caravan_crew;
use crate::npc_behaviour::{is_npc_order, run_by_npc_city};
use crate::pairing::carrying_blocks;
use crate::queries::alliance::{allied_realms, carriage_commander_of, commander_of};
use crate::queries::balance::carry_capacity;
use crate::queries::building::{
    build_materials, build_work_of, building_at, carriage_can_go_to, has_choice, line_building,
    line_order, materials_needed, max_workers, node_workplace, teardown_work, work_needed,
    workplace_good, BUILDABLE, KEEPS_GOODS, OFF_NODES, ON_PLAINS, ON_SHORE, PROCESSING,
    SHARES_A_TILE,
};
use crate::queries::city_area::{city_membership, is_city_building};
use crate::queries::command::commander_of_resident;
use crate::queries::goods::units_that_fit;
use crate::queries::names::{good_name, held, kind_name, placed};
use crate::queries::people::{js_trim, name_problem};
use crate::queries::residents::{age_in_years, can_work, is_armed, stock_weight};
use crate::queries::standing::TRADE_ORG;
use crate::queries::territory::{
    city_organization, compute_territory, control_at, control_sources,
};
use crate::queries::vessels::vessel_capacity;
use crate::script_runner::{
    defaults_have_a_target, one_carrier_at_a_time, one_fetcher_at_a_time,
    one_input_fetcher_at_a_time,
};
use crate::survival::{refill_source, refill_target};
use crate::walls::{is_wall_or_gate, wall_strength};
use crate::world::is_walkable;

type Out = Vec<InvariantViolation>;

/// One foal's worth of breeding (`STABLE_BREED_TICKS`).
const STABLE_BREED_TICKS: f64 = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY;

/// An order's kind as the TypeScript names it (`order.kind`).
pub(crate) fn kind_of(o: &ResidentOrder) -> String {
    serde_json::to_value(o)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// At a building, on the whole map (`isAt(r, b)` with its default size).
fn at_building(x: f64, y: f64, b: &csp_shared::world::Building) -> bool {
    is_at((x as i32, y as i32), placed(b), csp_shared::balance::MAP_SIZE)
}

/// Nothing stands on impassable terrain.
pub fn nothing_on_impassable_terrain(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "nothing-on-impassable-terrain";
    let mut things: Vec<(&str, f64, f64)> = Vec::new();
    things.extend(world.residents.iter().map(|t| (t.id.as_str(), t.x, t.y)));
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

/// Every realm has a Player and a living Leader who belongs to it; one realm per Player; a realm
/// name, once given, is trimmed, not empty and no longer than `REALM_NAME_MAX_LENGTH`.
pub fn realms_have_leaders(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "realms-have-leaders";
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for realm in &world.realms {
        let leader = world.residents.iter().find(|r| r.id == realm.leader_id);
        let mut problems = Vec::new();
        if leader.is_none_or(|l| l.owner.as_deref() != Some(realm.id.as_str())) {
            problems.push(format!("has no Leader {}", realm.leader_id));
        }
        if seen.contains(&realm.user_id) {
            problems.push(format!("is a second realm of Player {}", realm.user_id));
        }
        seen.insert(realm.user_id);
        if let Some(n) = &realm.name {
            if n != js_trim(n) || name_problem(Some(n), REALM_NAME_MAX_LENGTH).is_some() {
                problems.push(format!("has a bad name {}", js_json(n)));
            }
        }
        for p in problems {
            out.push(violation(name, format!("realm {} {p}", realm.id), &[&realm.id]));
        }
    }
    out
}

/// The terrains each kind of node lies on (`NODE_TERRAINS`).
fn node_terrains(kind: ResourceKind) -> &'static [Terrain] {
    match kind {
        ResourceKind::Forest => &[Terrain::Forest],
        ResourceKind::Stone => &[Terrain::Hills],
        ResourceKind::IronOre | ResourceKind::GoldOre => &[Terrain::Hills, Terrain::Mountain],
    }
}

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
            let layer =
                if SHARES_A_TILE.contains(&b.kind) { format!("{kind} {key}") } else { key.clone() };
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
            if nodes.len() != 1 || node_workplace(nodes[0].kind) != b.kind {
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

/// Every city has exactly one town hall, a finished one that belongs to it; every town hall makes
/// a city; and every finished city building belongs to the city its chain gives it
/// (`citiesFromBuildings`).
pub fn cities_from_buildings(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "cities-from-buildings";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    let mut halls: HashMap<&str, &str> = HashMap::new();
    for c in &world.cities {
        let hall = world.buildings.iter().find(|b| b.id == c.town_hall_id);
        match hall {
            Some(h) if h.kind == BuildingKind::TownHall && h.site.is_none() => {
                if halls.contains_key(h.id.as_str()) {
                    fail(&c.id, format!("shares town hall {} with another city", h.id));
                } else {
                    halls.insert(&h.id, &c.id);
                }
            }
            _ => fail(&c.id, "has no town hall".into()),
        }
    }
    let members = city_membership(world, terrain.size);
    for b in &world.buildings {
        if b.kind == BuildingKind::TownHall
            && b.site.is_none()
            && !halls.contains_key(b.id.as_str())
        {
            fail(&b.id, "makes no city".into());
        }
        if !is_city_building(b) {
            continue;
        }
        let city = members.get(&b.id);
        if b.city_id.as_ref() != city {
            let say = |c: Option<&String>| c.map_or("null".to_string(), |c| c.clone());
            fail(
                &b.id,
                format!("belongs to city {}, but stands in {}", say(b.city_id.as_ref()), say(city)),
            );
        }
    }
    out
}

/// Only an outpost storage or a construction site has a realm of its own, and only one that
/// exists (`outpostStorageRealms`).
pub fn outpost_storage_realms(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "outpost-storage-realms";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let mut out = Vec::new();
    for b in &world.buildings {
        let Some(realm) = &b.realm_id else { continue };
        let outpost = b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.is_none();
        let why = if !outpost && b.site.is_none() {
            let of = b.city_id.as_ref().map(|c| format!(" of city {c}")).unwrap_or_default();
            Some(format!("is a {}{of} with realm {realm}", kind_name(b.kind)))
        } else if !realms.contains(realm.as_str()) {
            Some(format!("belongs to realm {realm}, which doesn't exist"))
        } else {
            None
        };
        if let Some(why) = why {
            out.push(violation(name, format!("{} {why}", b.id), &[&b.id]));
        }
    }
    out
}

/// Every stat has a positive base and a trained bonus between 0 and its cap.
pub fn trained_within_cap(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "trained-within-cap";
    let mut out = Vec::new();
    for r in &world.residents {
        let s = &r.stats;
        for (stat, v) in [
            ("strength", &s.strength),
            ("endurance", &s.endurance),
            ("agility", &s.agility),
            ("intellect", &s.intellect),
        ] {
            if !(v.base > 0.0 && v.trained >= 0.0 && v.trained <= trained_cap(v.base)) {
                let msg = format!(
                    "resident {} has {stat} {} + {} trained (cap {})",
                    r.id,
                    js_number(v.base),
                    js_number(v.trained),
                    js_number(trained_cap(v.base))
                );
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// No work or Construction skill is below 0 or above its most (`skillsWithinCap`).
pub fn skills_within_cap(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "skills-within-cap";
    // `CAPPED_SKILLS`: the work skills in `WORKPLACE_SKILL`'s order, then Construction.
    let capped = [
        (SkillName::Farming, "farming", WORK_SKILL_MAX),
        (SkillName::Woodcutting, "woodcutting", WORK_SKILL_MAX),
        (SkillName::Mining, "mining", WORK_SKILL_MAX),
        (SkillName::Smelting, "smelting", WORK_SKILL_MAX),
        (SkillName::Smithing, "smithing", WORK_SKILL_MAX),
        (SkillName::Construction, "construction", CONSTRUCTION_SKILL_MAX),
    ];
    let mut out = Vec::new();
    for r in &world.residents {
        for (skill, label, max) in capped {
            let v = r.skills.get(&skill).copied();
            let n = v.unwrap_or(0.0);
            if !(n >= 0.0 && n <= max + 1e-9) {
                let has = v.map_or("undefined".into(), js_number);
                let msg = format!("resident {} has {label} {has} (most {})", r.id, js_number(max));
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// Health and the hunger meter stay within their ranges, for residents and horses alike.
pub fn health_and_hunger_in_range(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "health-and-hunger-in-range";
    let mut living: Vec<(&str, &str, f64, f64)> = Vec::new();
    living.extend(world.residents.iter().map(|r| ("resident", r.id.as_str(), r.health, r.hunger)));
    living.extend(world.horses.iter().map(|h| ("horse", h.id.as_str(), h.health, h.hunger)));
    living
        .into_iter()
        .filter(|(_, _, health, hunger)| {
            !(*health >= 0.0 && *health <= MAX_HEALTH && *hunger >= 0.0 && *hunger <= MAX_HUNGER)
        })
        .map(|(what, id, health, hunger)| {
            let msg = format!(
                "{what} {id} has health {} and hunger {}",
                js_number(health),
                js_number(hunger)
            );
            violation(name, msg, &[id])
        })
        .collect()
}

/// Every horse has its stats, each a whole number of at least 1, and a birth tick no later than
/// now (`horseStatsSound`).
pub fn horse_stats_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "horse-stats-sound";
    let mut out = Vec::new();
    for h in &world.horses {
        let s = &h.stats;
        let bad: Vec<String> =
            [("speed", s.speed), ("strength", s.strength), ("endurance", s.endurance)]
                .into_iter()
                .filter(|(_, v)| !(v.fract() == 0.0 && *v >= 1.0))
                .map(|(n, v)| format!("{n} {}", js_number(v)))
                .collect();
        if !bad.is_empty() {
            out.push(violation(name, format!("horse {} has {}", h.id, bad.join(", ")), &[&h.id]));
        }
        if !(h.born_at.is_finite() && h.born_at <= world.tick as f64) {
            let msg = format!(
                "horse {} was born at tick {}, after tick {}",
                h.id,
                js_number(h.born_at),
                world.tick
            );
            out.push(violation(name, msg, &[&h.id]));
        }
    }
    out
}

/// The breeding progress a stable keeps for these two horses (`keptBreeding`).
fn kept_breeding<'b>(
    stable: &'b csp_shared::world::Building,
    ids: &[String; 2],
) -> Option<&'b csp_shared::world::KeptBreeding> {
    stable
        .breedings
        .as_ref()?
        .iter()
        .find(|k| ids.contains(&k.horse_ids[0]) && ids.contains(&k.horse_ids[1]))
}

/// Breeding goes on only while it makes sense (`breedOrdersSound`, `CONTEXT.md`: Breeding).
pub fn breed_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "breed-orders-sound";
    let mut out = Vec::new();
    let mut bred: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(ResidentOrder::Breed(o)) = &r.order else { continue };
        let mut fail = |m: String, ids: &[&str]| {
            let mut all = vec![r.id.as_str()];
            all.extend_from_slice(ids);
            out.push(violation(name, format!("resident {} {m}", r.id), &all));
        };
        let stable = world.buildings.iter().find(|b| b.id == o.stable_id);
        let fine = stable.is_some_and(|s| {
            s.kind == BuildingKind::Stable && s.site.is_none() && at_building(r.x, r.y, s)
        });
        if !fine {
            fail(
                format!("breeds at {}, which isn’t a finished stable they stand at", o.stable_id),
                &[&o.stable_id],
            );
        }
        if r.x != o.at.x || r.y != o.at.y {
            fail(
                format!(
                    "breeds from {}, {} but stands elsewhere",
                    js_number(o.at.x),
                    js_number(o.at.y)
                ),
                &[],
            );
        }
        if !(o.progress.fract() == 0.0 && o.progress >= 0.0 && o.progress < STABLE_BREED_TICKS) {
            fail(
                format!(
                    "has breeding progress {} of {}",
                    js_number(o.progress),
                    js_number(STABLE_BREED_TICKS)
                ),
                &[],
            );
        }
        if let Some(s) = stable {
            let kept = kept_breeding(s, &o.horse_ids).map_or(0.0, |k| k.progress);
            if o.progress != kept {
                fail(
                    format!(
                        "has breeding progress {}, the stable {}",
                        js_number(o.progress),
                        js_number(kept)
                    ),
                    &[&s.id],
                );
            }
        }
        if o.horse_ids[0] == o.horse_ids[1] {
            fail(format!("breeds horse {} with itself", o.horse_ids[0]), &[]);
        }
        for id in &o.horse_ids {
            let h = world.horses.iter().find(|x| &x.id == id);
            let inside = match (h, stable) {
                (Some(h), Some(s)) => at_building(h.x, h.y, s),
                _ => false,
            };
            if !inside {
                fail(format!("breeds horse {id}, which isn’t in the stable"), &[id]);
            }
            if let Some(other) = bred.get(id.as_str()).copied() {
                if other != r.id {
                    fail(format!("breeds horse {id}, which {other} breeds too"), &[id, other]);
                }
            }
            bred.insert(id, &r.id);
        }
    }
    out
}

/// Breeding progress belongs to two horses in a stable (`keptBreedingsSound`).
pub fn kept_breedings_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "kept-breedings-sound";
    let mut out = Vec::new();
    for b in &world.buildings {
        let Some(breedings) = &b.breedings else { continue };
        let mut fail = |m: String, ids: &[&str]| {
            let mut all = vec![b.id.as_str()];
            all.extend_from_slice(ids);
            out.push(violation(name, format!("building {} {m}", b.id), &all));
        };
        if b.kind != BuildingKind::Stable || b.site.is_some() {
            fail("keeps breeding progress but isn’t a finished stable".into(), &[]);
        }
        let mut pairs = HashSet::new();
        for k in breedings {
            let [a, c] = &k.horse_ids;
            let mut pair = [a.as_str(), c.as_str()];
            pair.sort();
            let pair = pair.join("+");
            if a == c {
                fail(format!("keeps breeding progress for horse {a} with itself"), &[a]);
            }
            if pairs.contains(&pair) {
                fail(format!("keeps breeding progress for {a} and {c} twice"), &[a, c]);
            }
            pairs.insert(pair);
            let horses: Vec<_> =
                k.horse_ids.iter().map(|id| world.horses.iter().find(|h| &h.id == id)).collect();
            if horses.iter().any(|h| h.is_none_or(|h| !at_building(h.x, h.y, b))) {
                fail(
                    format!("keeps breeding progress for {a} and {c}, not both alive in it"),
                    &[a, c],
                );
            }
            if let (Some(h1), Some(h2)) = (horses[0], horses[1]) {
                if h1.realm_id != h2.realm_id || h1.city_id != h2.city_id {
                    fail(
                        format!("keeps breeding progress for {a} and {c}, of different owners"),
                        &[a, c],
                    );
                }
            }
            if !(k.progress.fract() == 0.0 && k.progress >= 1.0 && k.progress < STABLE_BREED_TICKS)
            {
                fail(
                    format!(
                        "keeps breeding progress {} of {} for {a} and {c}",
                        js_number(k.progress),
                        js_number(STABLE_BREED_TICKS)
                    ),
                    &[],
                );
            }
        }
    }
    out
}

/// Every resident has a lifespan in range and has not outlived it, and nobody is born after the
/// current tick (`agesInRange`).
pub fn ages_in_range(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "ages-in-range";
    let mut out = Vec::new();
    for r in &world.residents {
        let age = age_in_years(r.born_at, world.tick as f64);
        let mut problems = Vec::new();
        if !(r.lifespan >= LIFESPAN_MIN && r.lifespan <= LIFESPAN_MAX) {
            problems.push(format!("has lifespan {}", js_number(r.lifespan)));
        }
        if age >= r.lifespan {
            problems.push(format!(
                "is {} years old, past their lifespan {}",
                js_number(age),
                js_number(r.lifespan)
            ));
        }
        if !(age >= 0.0) {
            problems.push(format!("is born after the current tick ({})", js_number(r.born_at)));
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
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

/// Nobody carries more than their carry capacity.
pub fn carried_within_capacity(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carried-within-capacity";
    let tick = world.tick as f64;
    world
        .residents
        .iter()
        .filter(|r| stock_weight(&r.carried) > carry_capacity(r, tick) + 1e-9)
        .map(|r| {
            let msg = format!(
                "resident {} carries {} kg of {} kg",
                r.id,
                js_number(stock_weight(&r.carried)),
                js_number(carry_capacity(r, tick))
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}

fn negative(stock: &Stock) -> bool {
    stock.values().any(|n| !(*n >= 0.0))
}

/// Goods are never negative, only storages and stables among buildings hold any, a pile is never
/// empty; one pile per tile, and a pile on a building's footprint is its one pile
/// (`goodsInPlace`).
pub fn goods_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "goods-in-place";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for r in &world.residents {
        if negative(&r.carried) {
            fail(&r.id, "carries negative goods".into());
        }
    }
    for b in &world.buildings {
        let holds = b.stock.as_ref().is_some_and(|s| s.values().any(|&n| n > 0.0));
        if holds && (!KEEPS_GOODS.contains(&b.kind) || b.site.is_some()) {
            fail(&b.id, format!("is a {} holding goods", kind_name(b.kind)));
        }
        if b.site.as_ref().is_some_and(|s| negative(&s.delivered)) {
            fail(&b.id, "has negative materials delivered".into());
        }
    }
    let mut tiles = HashSet::new();
    for p in &world.piles {
        if negative(&p.goods) {
            fail(&p.id, "holds negative goods".into());
        }
        if !p.goods.values().any(|&n| n > 0.0) {
            fail(&p.id, "is an empty pile".into());
        }
        let key = format!("{},{}", js_number(p.x), js_number(p.y));
        if tiles.contains(&key) {
            fail(&p.id, format!("is a second pile on tile ({key})"));
        }
        tiles.insert(key);
        if let Some(on) = building_at(world, p.x as i32, p.y as i32, terrain.size) {
            if on.x != p.x || on.y != p.y {
                fail(
                    &p.id,
                    format!("lies on {} but is not its pile (on its north-west tile)", on.id),
                );
            }
        }
    }
    out
}

/// Goods are counted in whole units wherever they are (`goodsInWholeUnits`).
pub fn goods_in_whole_units(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "goods-in-whole-units";
    let mut holders: Vec<(&str, Option<&Stock>)> = Vec::new();
    holders.extend(world.residents.iter().map(|r| (r.id.as_str(), Some(&r.carried))));
    holders.extend(world.buildings.iter().map(|b| (b.id.as_str(), b.stock.as_ref())));
    holders.extend(
        world
            .buildings
            .iter()
            .filter_map(|b| b.site.as_ref().map(|s| (b.id.as_str(), Some(&s.delivered)))),
    );
    holders.extend(world.carriages.iter().map(|k| (k.id.as_str(), Some(&k.load))));
    holders.extend(world.vessels.iter().map(|v| (v.id.as_str(), Some(&v.load))));
    holders.extend(world.piles.iter().map(|p| (p.id.as_str(), Some(&p.goods))));
    holders
        .into_iter()
        .filter(|(_, s)| s.is_some_and(|s| s.values().any(|n| n.fract() != 0.0 || !n.is_finite())))
        .map(|(id, s)| {
            violation(name, format!("{id} holds part of a unit: {}", js_json(&s)), &[id])
        })
        .collect()
}

/// Pick-up and drop orders are done within the tick they start (`carryOrdersDone`).
pub fn carry_orders_done(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carry-orders-done";
    world
        .residents
        .iter()
        .filter_map(|r| match &r.order {
            Some(o @ (ResidentOrder::PickUp(_) | ResidentOrder::Drop(_))) => Some((r, kind_of(o))),
            _ => None,
        })
        .map(|(r, kind)| {
            violation(
                name,
                format!("resident {} still holds a {kind} order after the tick", r.id),
                &[&r.id],
            )
        })
        .collect()
}

/// Store and fetch orders ask for goods in whole units or as many as there are, and are done
/// putting or taking within the tick; how one ended never lies in the future
/// (`storeFetchOrdersSound`).
pub fn store_fetch_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "store-fetch-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id]));
        let (kind, goods, phase) = match &r.order {
            Some(o @ ResidentOrder::Store(s)) => {
                (kind_of(o), Some(&s.goods), kind_of_phase(&s.phase))
            }
            Some(o @ ResidentOrder::Fetch(f)) => {
                (kind_of(o), Some(&f.goods), kind_of_phase(&f.phase))
            }
            _ => (String::new(), None, String::new()),
        };
        if let Some(goods) = goods {
            // `readWanted`: known goods (the type keeps to them), each `null` or a whole number
            // above 0, and at least one.
            let fine = !goods.is_empty()
                && goods.values().all(|u| u.is_none_or(|n| n.fract() == 0.0 && n > 0.0));
            if !fine {
                fail(format!("{kind}s malformed goods {}", js_json(goods)));
            }
            if phase == "putting" || phase == "taking" {
                fail(format!("is still {phase} for a {kind} order after the tick"));
            }
        }
        if let Some(ended) = &r.order_ended {
            if ended.tick > world.tick as f64 {
                let ended_kind = serde_json::to_value(ended.kind).ok();
                let ended_kind = ended_kind.as_ref().and_then(|v| v.as_str()).unwrap_or_default();
                fail(format!(
                    "has a {ended_kind} order that ended at tick {}",
                    js_number(ended.tick)
                ));
            }
        }
    }
    out
}

/// A store or fetch phase's TypeScript name.
fn kind_of_phase(phase: &impl serde::Serialize) -> String {
    serde_json::to_value(phase).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
}

/// A construction site never holds more materials than its building needs, nor goods it doesn't
/// need, and its work stays between 0 and what it needs; one that has everything has become its
/// building (`sitesWithinNeeds`).
pub fn sites_within_needs(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "sites-within-needs";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for b in &world.buildings {
        let Some(site) = &b.site else { continue };
        let needs = build_materials(b.kind);
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
        let work = build_work_of(b.kind);
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
        let msg =
            format!("resident {} tears down {}, which they don’t stand at", r.id, o.building_id);
        out.push(violation(name, msg, &[&r.id, &o.building_id]));
    }
    out
}

/// Realm logs stay in order and in bounds (`realmLogsInOrder`).
pub fn realm_logs_in_order(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "realm-logs-in-order";
    let mut out = Vec::new();
    let mut fail = |m: String| out.push(violation(name, m, &[]));
    let mut kept: Vec<(u64, usize)> = Vec::new();
    let mut last: Option<u64> = None;
    for e in &world.events {
        if last.is_some_and(|l| e.seq <= l) {
            fail(format!("event {} is logged after event {}", e.seq, last.unwrap()));
        }
        if e.seq >= world.next_id {
            fail(format!("event {} is numbered past next id {}", e.seq, world.next_id));
        }
        if e.tick > world.tick {
            fail(format!("event {} happened at tick {}, after now", e.seq, e.tick));
        }
        last = Some(e.seq);
        match kept.iter_mut().find(|(u, _)| *u == e.user_id) {
            Some((_, n)) => *n += 1,
            None => kept.push((e.user_id, 1)),
        }
    }
    for (user, n) in kept {
        if n as f64 > REALM_LOG_LENGTH {
            fail(format!("Player {user} keeps {n} events, over {}", js_number(REALM_LOG_LENGTH)));
        }
    }
    out
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
                if has_choice(p.kind) != makes.is_some() {
                    fail(match makes {
                        None => "making nothing".into(),
                        Some(m) => format!("making {m} with nothing to choose"),
                    });
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

/// Whether a horse or carriage is of a resident's realm, or of their NPC city
/// (`horseOfResident`, `carriageOfResident`).
fn of_resident(
    realm_id: Option<&str>,
    city_id: Option<&str>,
    r: &csp_shared::world::Resident,
) -> bool {
    match &r.owner {
        Some(owner) => realm_id == Some(owner.as_str()),
        None => realm_id.is_none() && r.city_id.is_some() && city_id == r.city_id.as_deref(),
    }
}

/// The carriage a resident drives, by a drive or haul order (`drivenCarriageId`).
fn driven_carriage_id(r: &csp_shared::world::Resident) -> Option<&str> {
    match &r.order {
        Some(ResidentOrder::Drive(o)) => Some(&o.carriage_id),
        Some(ResidentOrder::Haul(o)) => Some(&o.carriage_id),
        _ => None,
    }
}

/// Carriages keep to the rules (`carriagesInPlace`, `CONTEXT.md`: Carriage).
pub fn carriages_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "carriages-in-place";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String, ids: &[&str]| {
        let ids = if ids.is_empty() { vec![id] } else { ids.to_vec() };
        out.push(violation(name, format!("carriage {id} {m}"), &ids));
    };
    let mut pulling: HashMap<&str, &str> = HashMap::new();
    for k in &world.carriages {
        let (x, y) = (js_number(k.x), js_number(k.y));
        if !carriage_can_go_to(world, terrain, k.x as i32, k.y as i32) {
            fail(&k.id, format!("stands where no carriage can go at ({x}, {y})"), &[]);
        }
        let kg = stock_weight(&k.load);
        if kg > CARRIAGE_MAX_CAPACITY + 1e-9 {
            let m = format!(
                "holds {} kg, more than any carriage can ({} kg)",
                js_number(kg),
                js_number(CARRIAGE_MAX_CAPACITY)
            );
            fail(&k.id, m, &[]);
        }
        let Some(horse_id) = &k.horse_id else { continue };
        let horse = world.horses.iter().find(|h| &h.id == horse_id);
        match horse {
            None => fail(&k.id, format!("is hitched to {horse_id}, which doesn't exist"), &[]),
            Some(h) if h.x != k.x || h.y != k.y => {
                let m = format!(
                    "is at ({x}, {y}) but its horse at ({}, {})",
                    js_number(h.x),
                    js_number(h.y)
                );
                fail(&k.id, m, &[&k.id, &h.id]);
            }
            _ => {}
        }
        if let Some(h) = horse {
            if h.realm_id != k.realm_id || h.city_id != k.city_id {
                let m = format!("is hitched to {}, not its own realm's or city's", h.id);
                fail(&k.id, m, &[&k.id, &h.id]);
            }
        }
        if let Some(other) = pulling.get(horse_id.as_str()).copied() {
            let m = format!("shares horse {horse_id} with {other}");
            fail(&k.id, m, &[&k.id, other, horse_id]);
        }
        pulling.insert(horse_id, &k.id);
    }
    out
}

/// A vessel always stands on a water tile, one vessel per tile, and holds no more than it can
/// (`CONTEXT.md`: Vessel, Boat).
pub fn vessels_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "vessels-in-place";
    let mut out = Vec::new();
    let mut on: HashMap<(i32, i32), &str> = HashMap::new();
    for v in &world.vessels {
        let (x, y) = (v.x as i32, v.y as i32);
        let at = format!("({}, {})", js_number(v.x), js_number(v.y));
        if !is_water(terrain_at(terrain, x, y)) {
            out.push(violation(name, format!("vessel {} is on land at {at}", v.id), &[&v.id]));
        }
        if let Some(other) = on.insert((x, y), &v.id) {
            let m = format!("vessel {} shares the water tile {at} with {other}", v.id);
            out.push(violation(name, m, &[&v.id, other]));
        }
        let kg = stock_weight(&v.load);
        if kg > vessel_capacity(v) + 1e-9 {
            let m = format!(
                "vessel {} holds {} kg, more than it can ({} kg)",
                v.id,
                js_number(kg),
                js_number(vessel_capacity(v))
            );
            out.push(violation(name, m, &[&v.id]));
        }
    }
    out
}

/// A rider's horse exists, stands with them, is of their realm and pulls no carriage, no horse
/// has two riders, and a ridden horse stands where a carriage could (`ridersOnHorses`).
pub fn riders_on_horses(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "riders-on-horses";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut riders: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(riding) = &r.riding else { continue };
        let Some(h) = world.horses.iter().find(|h| &h.id == riding) else {
            fail(&[&r.id], format!("resident {} rides {riding}, which doesn't exist", r.id));
            continue;
        };
        let (hx, hy) = (js_number(h.x), js_number(h.y));
        if h.x != r.x || h.y != r.y {
            let m = format!(
                "resident {} at ({}, {}) rides horse {} at ({hx}, {hy})",
                r.id,
                js_number(r.x),
                js_number(r.y),
                h.id
            );
            fail(&[&r.id, &h.id], m);
        }
        if !of_resident(h.realm_id.as_deref(), h.city_id.as_deref(), r) {
            let m = format!("resident {} rides horse {} of another realm", r.id, h.id);
            fail(&[&r.id, &h.id], m);
        }
        if let Some(k) = world.carriages.iter().find(|k| k.horse_id.as_ref() == Some(&h.id)) {
            fail(&[&h.id, &k.id], format!("horse {} is ridden and hitched to {}", h.id, k.id));
        }
        if !carriage_can_go_to(world, terrain, h.x as i32, h.y as i32) {
            let m = format!("horse {} is ridden where no horse can go at ({hx}, {hy})", h.id);
            fail(&[&r.id, &h.id], m);
        }
        if let Some(other) = riders.get(h.id.as_str()).copied() {
            let m = format!("horse {} has two riders, {other} and {}", h.id, r.id);
            fail(&[&h.id, &r.id, other], m);
        }
        riders.insert(&h.id, &r.id);
    }
    out
}

/// A passenger's carriage exists, is of their realm and stands on their tile, and they neither
/// drive nor ride; goods and passengers never weigh more than any carriage holds
/// (`passengersAboard`).
pub fn passengers_aboard(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "passengers-aboard";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut aboard: HashMap<&str, f64> = HashMap::new();
    for r in &world.residents {
        let Some(on) = &r.aboard else { continue };
        *aboard.entry(on).or_insert(0.0) += 1.0;
        let Some(k) = world.carriages.iter().find(|c| &c.id == on) else {
            fail(&[&r.id], format!("resident {} is aboard {on}, which doesn't exist", r.id));
            continue;
        };
        if k.x != r.x || k.y != r.y {
            let m = format!(
                "resident {} at ({}, {}) is aboard carriage {} at ({}, {})",
                r.id,
                js_number(r.x),
                js_number(r.y),
                k.id,
                js_number(k.x),
                js_number(k.y)
            );
            fail(&[&r.id, &k.id], m);
        }
        if !of_resident(k.realm_id.as_deref(), k.city_id.as_deref(), r) {
            let m = format!("resident {} is aboard carriage {} of another realm", r.id, k.id);
            fail(&[&r.id, &k.id], m);
        }
        if driven_carriage_id(r).is_some() {
            fail(&[&r.id, &k.id], format!("resident {} drives aboard", r.id));
        }
        if r.riding.is_some() {
            fail(&[&r.id, &k.id], format!("resident {} rides aboard", r.id));
        }
    }
    for k in &world.carriages {
        let people = aboard.get(k.id.as_str()).copied().unwrap_or(0.0);
        let kg = stock_weight(&k.load) + people * PASSENGER_WEIGHT;
        if kg > CARRIAGE_MAX_CAPACITY + 1e-9 {
            let m = format!(
                "carriage {} holds {} kg of goods and passengers, more than any can",
                k.id,
                js_number(kg)
            );
            fail(&[&k.id], m);
        }
    }
    out
}

/// A driver stands on the carriage they drive, which exists, and is grown up; no carriage has
/// two drivers, and nobody drives another organization's carriage unless they command it
/// (`driversOnCarriages`).
pub fn drivers_on_carriages(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "drivers-on-carriages";
    let mut out = Vec::new();
    let mut driven: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(id) = driven_carriage_id(r) else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id, id]));
        let k = world.carriages.iter().find(|c| c.id == id);
        match k {
            None => fail(format!("drives {id}, which doesn't exist")),
            Some(k) if k.x != r.x || k.y != r.y => {
                fail(format!("drives {} but isn't on its tile", k.id))
            }
            _ => {}
        }
        if let Some(k) = k {
            // `organizationOf`, `carriageOrganization` (T86.7's `crimes.ts`).
            let org = r.owner.as_deref().or(r.city_id.as_deref());
            let carriage_org = k.realm_id.as_deref().or(k.city_id.as_deref());
            if org != carriage_org
                && commander_of(world, &r.id, r.owner.as_deref()) != carriage_commander_of(world, k)
            {
                fail(format!("drives {} of another organization without commanding it", k.id));
            }
        }
        if !can_work(r.born_at, world.tick as f64) {
            fail("drives as a child".into());
        }
        if let Some(other) = driven.get(id).copied() {
            fail(format!("drives {id} together with {other}"));
        }
        driven.insert(id, &r.id);
    }
    out
}

/// Haul routes stay sound (`haulRoutesSound`, `CONTEXT.md`: Haul route, Supply line).
pub fn haul_routes_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "haul-routes-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Haul(o)) = &r.order else { continue };
        let mut fail = |m: String| {
            out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id, &o.carriage_id]))
        };
        let (from, to) = (o.from, o.to);
        // An army stop is wherever the army is (`CONTEXT.md`: Supply line).
        let to_army = o.to_army.is_some();
        if !to_army && from.x == to.x && from.y == to.y {
            fail("hauls between one tile and itself".into());
        }
        // A stop on a road over Mountain may lose its road later; the route then finds no way.
        let stops: &[csp_shared::world::Tile] = if to_army { &[from] } else { &[from, to] };
        for s in stops {
            let t = terrain_at(terrain, s.x as i32, s.y as i32);
            if !carriage_can_enter(t) && t != Terrain::Mountain as u8 {
                let m = format!(
                    "hauls to ({}, {}), where no carriage can go",
                    js_number(s.x),
                    js_number(s.y)
                );
                fail(m);
            }
        }
        if o.goods.is_empty() {
            fail("hauls no goods".into());
        }
        let both: Vec<&str> =
            o.return_goods.iter().filter(|g| o.goods.contains(g)).map(|g| good_name(*g)).collect();
        if !both.is_empty() {
            fail(format!("hauls {} both ways", both.join(", ")));
        }
        if to_army && !o.return_goods.is_empty() {
            fail("hauls goods back from an army".into());
        }
        let food_kg = GOOD_WEIGHT.get("food").unwrap_or(0.0);
        if o.keep_food < 0.0 || o.keep_food * food_kg > CARRIAGE_CAPACITY {
            fail(format!("keeps {} Food for the horse", js_number(o.keep_food)));
        }
        let stop = if o.stop == HaulStop::From { from } else { to };
        let stop_name = if o.stop == HaulStop::From { "from" } else { "to" };
        let with_army = to_army && o.stop == HaulStop::To;
        if with_army && o.moving.is_some() {
            fail("holds goods for the route at an army".into());
        }
        if o.phase == HaulPhase::Loading && !with_army && (r.x != stop.x || r.y != stop.y) {
            fail(format!(
                "loads at the {stop_name} stop but stands at ({}, {})",
                js_number(r.x),
                js_number(r.y)
            ));
        }
        if o.phase == HaulPhase::Driving && o.moving.is_some() {
            fail("holds goods for the route while driving".into());
        }
    }
    out
}

/// How many of a territory's tiles `territory_sound` passes over for each it works out again
/// (`TERRITORY_CHECK_STRIDE`).
const TERRITORY_CHECK_STRIDE: usize = 37;

/// Territory is derived soundly (`territorySound`, `CONTEXT.md`: Territory): every tile in it
/// belongs to an Organization that exists (a realm, or a city of no realm) and lies within reach
/// of one of that Organization's cities or guarded workplaces, and no other Organization projects
/// as much control onto it. The control on a tile is worked out apart from the territory,
/// straight from each source's tiles, for every `TERRITORY_CHECK_STRIDE`th tile of it.
pub fn territory_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "territory-sound";
    let size = terrain.size;
    let organizations: HashSet<&str> = world
        .realms
        .iter()
        .map(|r| r.id.as_str())
        .chain(world.cities.iter().filter(|c| c.realm_id.is_none()).map(city_organization))
        .collect();
    let sources = control_sources(world, size);
    // Each source's tiles as a box round its first one, to pass over the sources out of reach.
    struct Box {
        o: (i32, i32),
        x0: i32,
        x1: i32,
        y0: i32,
        y1: i32,
    }
    let boxes: Vec<Box> = sources
        .iter()
        .map(|s| {
            let o = s.tiles[0];
            let dxs = s.tiles.iter().map(|t| wrap_delta(o.0, t.0, size));
            let dys = s.tiles.iter().map(|t| wrap_delta(o.1, t.1, size));
            let (x0, x1) = dxs.fold((i32::MAX, i32::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
            let (y0, y1) = dys.fold((i32::MAX, i32::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
            Box { o, x0, x1, y0, y1 }
        })
        .collect();
    // Each Organization's control on a tile, worked out apart from the territory.
    let control_at_tile = |x: i32, y: i32| -> indexmap::IndexMap<&str, f64> {
        let mut control: indexmap::IndexMap<&str, f64> = indexmap::IndexMap::new();
        for (k, s) in sources.iter().enumerate() {
            let b = &boxes[k];
            let dx = wrap_delta(b.o.0, x, size);
            let dy = wrap_delta(b.o.1, y, size);
            // Measured the short way round from its first tile, the box holds only while it and
            // the reach take up less than half the map.
            let small = f64::from((b.x1 - b.x0).max(b.y1 - b.y0)) + s.reach < f64::from(size) / 2.0;
            let gap = f64::from((b.x0 - dx).max(0).max(dx - b.x1))
                .hypot(f64::from((b.y0 - dy).max(0).max(dy - b.y1)));
            if small && gap > s.reach {
                continue;
            }
            // The nearest of its tiles, by squared distance, passing over those too far along a
            // side.
            let mut d2 = f64::INFINITY;
            for t in &s.tiles {
                let tx = f64::from(wrap_delta(t.0, x, size));
                if tx * tx >= d2 {
                    continue;
                }
                let ty = f64::from(wrap_delta(t.1, y, size));
                d2 = d2.min(tx * tx + ty * ty);
            }
            let c = control_at(s.strength, s.reach, d2.sqrt());
            if c > control.get(s.owner.as_str()).copied().unwrap_or(0.0) {
                control.insert(s.owner.as_str(), c);
            }
        }
        control
    };
    let mut out = Vec::new();
    let mut fail = |key: &str, owner: &str, message: String| {
        out.push(violation(name, format!("tile ({key}) {message}"), &[owner]));
    };
    for (i, (&index, owner)) in compute_territory(world, size).owners.iter().enumerate() {
        let (x, y) = ((index % size as usize) as i32, (index / size as usize) as i32);
        let key = format!("{x},{y}");
        if !organizations.contains(owner.as_str()) {
            fail(&key, owner, format!("belongs to {owner}, which is no Organization"));
        }
        if i % TERRITORY_CHECK_STRIDE != 0 {
            continue;
        }
        let control = control_at_tile(x, y);
        let own = control.get(owner.as_str()).copied().unwrap_or(0.0);
        if own <= 0.0 {
            fail(&key, owner, format!("belongs to {owner}, which projects no control there"));
        }
        for (other, c) in &control {
            if *other != owner.as_str() && *c >= own {
                fail(&key, owner, format!("belongs to {owner}, but {other} is as strong there"));
            }
        }
    }
    out
}

/// After a tick, nobody at home, near an outpost storage of their realm, at their workplace, or
/// in an army or aboard as a passenger by a carriage runs low on food (a child at home: has less
/// than their own food) while the storage, pile or carriage they refill from still has some and
/// a meal would fit (`refilledWhenLow`, `stepRefill`, `refillTarget`).
pub fn refilled_when_low(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "refilled-when-low";
    let size = terrain.size;
    world
        .residents
        .iter()
        .filter(|r| {
            held(&r.carried, Good::Food) < refill_target(world, r, size)
                && refill_source(world, r, size).map_or(0.0, |s| s.food) > 0.0
                && units_that_fit(r, Good::Food, world.tick as f64) >= MEAL_UNITS
        })
        .map(|r| {
            let msg = format!(
                "resident {} has only {} food where there is more",
                r.id,
                js_number(held(&r.carried, Good::Food))
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}

/// Every resident lives in a city that exists, or in none (`residentsInCities`).
pub fn residents_in_cities(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "residents-in-cities";
    let cities: HashSet<&str> = world.cities.iter().map(|c| c.id.as_str()).collect();
    world
        .residents
        .iter()
        .filter_map(|r| r.city_id.as_deref().filter(|c| !cities.contains(c)).map(|c| (r, c)))
        .map(|(r, c)| {
            violation(
                name,
                format!("resident {} lives in city {c}, which doesn't exist", r.id),
                &[&r.id],
            )
        })
        .collect()
}

/// The NPC cities' ids: cities of no realm.
fn npc_cities(world: &WorldState) -> HashSet<&str> {
    world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.as_str()).collect()
}

/// An NPC city's residents belong to no realm (`npcCityResidentsUnowned`).
pub fn npc_city_residents_unowned(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-city-residents-unowned";
    let npc = npc_cities(world);
    let mut out = Vec::new();
    for r in &world.residents {
        if let (Some(c), Some(owner)) = (&r.city_id, &r.owner) {
            if npc.contains(c.as_str()) {
                let msg = format!("resident {} of NPC city {c} belongs to realm {owner}", r.id);
                out.push(violation(name, msg, &[&r.id]));
            }
        }
    }
    out
}

/// Everything belongs to a realm that exists, an NPC city that exists, or nobody
/// (`ownersExist`).
pub fn owners_exist(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "owners-exist";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let npc = npc_cities(world);
    let mut out = Vec::new();
    let mut problem = |id: &str, m: String| out.push(violation(name, format!("{id} {m}"), &[id]));
    for r in &world.residents {
        if let Some(owner) = r.owner.as_deref().filter(|o| !realms.contains(o)) {
            problem(&r.id, format!("belongs to ended realm {owner}"));
        }
    }
    for c in &world.cities {
        if let Some(realm) = c.realm_id.as_deref().filter(|o| !realms.contains(o)) {
            problem(&c.id, format!("belongs to ended realm {realm}"));
        }
    }
    let things = world
        .horses
        .iter()
        .map(|h| (&h.id, &h.realm_id, &h.city_id))
        .chain(world.carriages.iter().map(|k| (&k.id, &k.realm_id, &k.city_id)));
    for v in &world.vessels {
        if let Some(realm) = v.realm_id.as_deref().filter(|o| !realms.contains(o)) {
            problem(&v.id, format!("belongs to ended realm {realm}"));
        }
    }
    for (id, realm, city) in things {
        if let Some(realm) = realm.as_deref().filter(|o| !realms.contains(o)) {
            problem(id, format!("belongs to ended realm {realm}"));
        }
        if let Some(city) = city {
            if realm.is_some() || !npc.contains(city.as_str()) {
                problem(id, format!("belongs to {city}, which is no NPC city it can belong to"));
            }
        }
    }
    out
}

/// A realm's city's residents belong to that realm (`cityResidentsInItsRealm`).
pub fn city_residents_in_its_realm(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "city-residents-in-its-realm";
    let realm_of: HashMap<&str, Option<&str>> =
        world.cities.iter().map(|c| (c.id.as_str(), c.realm_id.as_deref())).collect();
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(city) = &r.city_id else { continue };
        let Some(Some(realm)) = realm_of.get(city.as_str()) else { continue };
        if r.owner.as_deref() == Some(*realm) {
            continue;
        }
        let msg = format!(
            "resident {} of city {city} (realm {realm}) belongs to {}",
            r.id,
            r.owner.as_deref().unwrap_or("no realm")
        );
        out.push(violation(name, msg, &[&r.id, city]));
    }
    out
}

/// Relocate orders hold (`relocateOrdersSound`, `CONTEXT.md`: Relocate).
pub fn relocate_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "relocate-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Relocate(o)) = &r.order else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id]));
        if r.owner.is_none() {
            fail("of no realm is relocating".into());
        }
        if r.carrying.is_some() {
            fail("is relocating while carrying a child".into());
        }
        if r.city_id.as_deref() == Some(o.city_id.as_str()) {
            fail(format!("is relocating to {}, where they live", o.city_id));
        }
    }
    out
}

/// The soldiers of the Trade Organization's army come to take `city` (`cityTakers`).
fn city_takers(world: &WorldState, city: &csp_shared::world::City) -> HashSet<String> {
    let org = city.realm_id.as_deref().unwrap_or(&city.id);
    let mut takers = HashSet::new();
    for p in &world.punishments {
        let out = serde_json::to_value(p.heading).ok().and_then(|v| v.as_str().map(str::to_owned));
        if p.takes != Some(true)
            || out.as_deref() != Some("out")
            || p.city_id != city.id
            || p.culprit_org != org
        {
            continue;
        }
        if !world.debts.iter().any(|d| d.org == org) {
            continue;
        }
        takers.extend(p.members.iter().map(|m| m.resident_id.clone()));
    }
    takers
}

/// Occupations of town halls hold (`occupationsSound`).
pub fn occupations_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "occupations-sound";
    let occupation_ticks = OCCUPATION_GAME_DAYS * TICKS_PER_GAME_DAY;
    let mut out = Vec::new();
    for c in &world.cities {
        let Some(o) = &c.occupation else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("city {}: {m}", c.id), &[&c.id]));
        let ran = world.tick as f64 - o.since;
        if ran < 0.0 || ran >= occupation_ticks {
            fail(format!(
                "occupied by {} for {} ticks without being captured",
                o.realm_id,
                js_number(ran)
            ));
        }
        let hall = world.buildings.iter().find(|b| b.id == c.town_hall_id);
        let takers = city_takers(world, c);
        let holds = world.residents.iter().any(|r| {
            let theirs = if o.realm_id == TRADE_ORG {
                takers.contains(&r.id)
            } else {
                r.owner.as_deref() == Some(o.realm_id.as_str())
            };
            theirs
                && is_armed(&r.carried)
                && hall.is_some_and(|h| is_at((r.x as i32, r.y as i32), placed(h), terrain.size))
        });
        if !holds {
            fail(format!(
                "occupied by {} with none of its armed residents on the hall",
                o.realm_id
            ));
        }
        if let Some(realm) = &c.realm_id {
            if realm == &o.realm_id || allied_realms(world, realm).contains(&o.realm_id) {
                fail(format!("occupied by {}, its own realm or an ally", o.realm_id));
            }
        }
    }
    out
}

/// A city's own workplaces are workplaces other than farms, of no city
/// (`cityWorkplacesSound`).
pub fn city_workplaces_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "city-workplaces-sound";
    let mut out = Vec::new();
    for c in &world.cities {
        for id in c.workplace_ids.iter().flatten() {
            // `new Map(...)`: the last building with the id.
            let Some(b) = world.buildings.iter().rev().find(|b| &b.id == id) else { continue };
            if max_workers(b.kind).is_none() || b.kind == BuildingKind::Farm || b.city_id.is_some()
            {
                let msg = format!(
                    "{} works {}, a {} of city {}",
                    c.id,
                    b.id,
                    kind_name(b.kind),
                    b.city_id.as_deref().unwrap_or("null")
                );
                out.push(violation(name, msg, &[&c.id, &b.id]));
            }
        }
    }
    out
}

/// An NPC city does nothing a Player's residents couldn't (`npcOrdersAllowed`).
pub fn npc_orders_allowed(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-orders-allowed";
    let drivers: HashSet<&str> = world
        .caravans
        .iter()
        .filter_map(|c| c.driver_id.as_deref())
        .chain(world.traders.iter().filter_map(|t| t.driver_id.as_deref()))
        .chain(world.supply_wagons.iter().filter_map(|w| w.driver_id.as_deref()))
        .collect();
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
        if !run_by_npc_city(world, r) {
            continue;
        }
        let kind = kind_of(o);
        let allowed = is_npc_order(o) || (kind == "drive" && drivers.contains(r.id.as_str()));
        if !allowed {
            out.push(violation(
                name,
                format!("NPC resident {} holds a {kind} order", r.id),
                &[&r.id],
            ));
        }
    }
    out
}

/// An NPC city fights only outsiders (`npcFightsOutsiders`).
pub fn npc_fights_outsiders(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-fights-outsiders";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Attack(o)) = &r.order else { continue };
        if !run_by_npc_city(world, r) {
            continue;
        }
        // `new Map(...)`: the last resident with the id.
        let t = world.residents.iter().rev().find(|x| x.id == o.target_id);
        if t.is_some_and(|t| t.owner.is_none() && t.city_id == r.city_id) {
            let msg = format!("NPC resident {} attacks someone of their own city", r.id);
            out.push(violation(name, msg, &[&r.id]));
        }
    }
    out
}

/// Pairs hold together (`pairsHoldTogether`, `CONTEXT.md`: Pairing).
pub fn pairs_hold_together(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "pairs-hold-together";
    let mut out = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let Some(o) = &r.pair else { continue };
        // `new Map(...)`: the last resident with the id.
        let pi = world.residents.iter().rposition(|x| x.id == o.partner_id);
        let partner = pi.map(|p| &world.residents[p]);
        let back = partner.and_then(|p| p.pair.as_ref());
        let mut problems = Vec::new();
        match (partner, back) {
            (Some(p), Some(b)) if b.partner_id == r.id => {
                if b.since != o.since {
                    problems.push(format!(
                        "pairs since {}, {} since {}",
                        js_number(o.since),
                        p.id,
                        js_number(b.since)
                    ));
                }
                if p.city_id != r.city_id {
                    problems.push(format!("pairs with {} of another city", p.id));
                }
                if pi == Some(i) {
                    problems.push("pairs with themselves".into());
                }
            }
            _ => problems.push(format!("pairs with {}, who doesn't pair back", o.partner_id)),
        }
        if r.city_id.is_none() {
            problems.push("pairs but lives in no city".into());
        }
        if !can_work(r.born_at, world.tick as f64) {
            problems.push("pairs as a child".into());
        }
        if o.since > world.tick as f64 {
            problems.push(format!("pairs since {}, after now", js_number(o.since)));
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id, &o.partner_id]));
        }
    }
    out
}

/// A resident carrying a child holds no order to work, build, tear down or haul, is grown, and
/// gives birth in time (`carryingDoesntWork`).
pub fn carrying_doesnt_work(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "carrying-doesnt-work";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(c) = &r.carrying else { continue };
        let mut problems = Vec::new();
        if let Some(o) = &r.order {
            let kind = kind_of(o);
            if carrying_blocks(o) {
                problems.push(format!("holds a {kind} order while carrying a child"));
            }
        }
        if !can_work(r.born_at, world.tick as f64) {
            problems.push("carries a child as a child".into());
        }
        if c.since > world.tick as f64 {
            problems.push(format!("carries since {}, after now", js_number(c.since)));
        }
        if world.tick as f64 - c.since > CARRYING_TICKS {
            problems.push("carries a child past its time".into());
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// Orders only a grown resident can hold (`ADULT_ORDERS`).
const ADULT_ORDERS: [&str; 10] = [
    "build", "roadLine", "wallLine", "tearDown", "workAt", "teach", "train", "breed", "drive",
    "feed",
];

/// Children don't work until they are grown (`childrenDontWork`).
pub fn children_dont_work(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "children-dont-work";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
        let kind = kind_of(o);
        if ADULT_ORDERS.contains(&kind.as_str()) && !can_work(r.born_at, world.tick as f64) {
            out.push(violation(
                name,
                format!("resident {} holds a {kind} order as a child", r.id),
                &[&r.id],
            ));
        }
    }
    out
}

/// Children handle only Food (`childrenCarryOnlyFood`, `canHandle`).
pub fn children_carry_only_food(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "children-carry-only-food";
    let mut out = Vec::new();
    for r in &world.residents {
        if can_work(r.born_at, world.tick as f64) {
            continue;
        }
        let mut goods: Vec<&str> =
            r.carried.iter().filter(|(_, n)| **n > 0.0).map(|(g, _)| good_name(*g)).collect();
        match &r.order {
            Some(ResidentOrder::PickUp(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Drop(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Store(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            Some(ResidentOrder::Fetch(o)) => goods.extend(o.goods.keys().map(|g| good_name(*g))),
            _ => {}
        }
        if goods.iter().all(|g| *g == "food") {
            continue;
        }
        out.push(violation(name, format!("child {} handles {}", r.id, goods.join(", ")), &[&r.id]));
    }
    out
}

/// Dead residents leave their goods as loot: none with no health left is still in the world,
/// unless Down (`deadLeaveLoot`).
pub fn dead_leave_loot(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "dead-leave-loot";
    world
        .residents
        .iter()
        .filter(|r| !(r.health > 0.0) && r.down_until.is_none())
        .map(|r| {
            let msg = format!(
                "resident {} has no health left but is still in the world, holding {}",
                r.id,
                js_json(&r.carried)
            );
            violation(name, msg, &[&r.id])
        })
        .collect()
}

/// Attack orders are sound, and who last struck a resident struck them no later than now
/// (`attackOrdersSound`).
pub fn attack_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "attack-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        if let Some(s) = &r.struck {
            if s.tick > world.tick as f64 {
                let msg = format!(
                    "resident {} was struck at tick {}, after tick {}",
                    r.id,
                    js_number(s.tick),
                    world.tick
                );
                out.push(violation(name, msg, &[&r.id]));
            }
        }
        let Some(ResidentOrder::Attack(o)) = &r.order else { continue };
        let problem = if o.target_id == r.id {
            Some("attacks themselves".to_string())
        } else if !(o.strike >= 0.0 && o.strike < 1.0) {
            Some(format!("is {} of the way to a blow", js_number(o.strike)))
        } else {
            None
        };
        if let Some(p) = problem {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// The longest an alliance's name may be (`ALLIANCE_NAME_MAX_LENGTH`).
const ALLIANCE_NAME_MAX_LENGTH: usize = 30;

/// Alliances hold together (`alliancesSound`, `CONTEXT.md`: Alliance).
pub fn alliances_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "alliances-sound";
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let mut member_of: HashMap<&str, &str> = HashMap::new();
    for a in &world.alliances {
        for m in &a.members {
            let v = if member_of.contains_key(m.realm_id.as_str()) { "" } else { a.id.as_str() };
            member_of.insert(&m.realm_id, v);
        }
    }
    let mut handed_over: HashMap<&str, &str> = HashMap::new();
    for a in &world.alliances {
        for p in &a.army {
            let v = if handed_over.contains_key(p.id.as_str()) { "" } else { a.id.as_str() };
            handed_over.insert(&p.id, v);
        }
    }
    let alliance_city = |id: &str| {
        world.cities.iter().any(|c| c.id == id && c.realm_id.is_none() && c.trade_org.is_none())
    };
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for a in &world.alliances {
        let mut problems = Vec::new();
        if a.name.trim().is_empty() || a.name.encode_utf16().count() > ALLIANCE_NAME_MAX_LENGTH {
            problems.push(format!("has a bad name \"{}\"", a.name));
        }
        if a.members.is_empty() {
            problems.push("has no members".into());
        }
        if !a.members.iter().any(|m| m.realm_id == a.leader_id) {
            problems.push(format!("has leader {}, who is not a member", a.leader_id));
        }
        if !realms.contains(a.leader_id.as_str()) {
            problems.push(format!("has leader {}, which is no realm", a.leader_id));
        }
        for (i, m) in a.members.iter().enumerate() {
            if !realms.contains(m.realm_id.as_str()) && !alliance_city(&m.realm_id) {
                problems.push(format!("has member {}, which is no realm or NPC city", m.realm_id));
            }
            if member_of.get(m.realm_id.as_str()) == Some(&"") {
                problems.push(format!("shares member {}", m.realm_id));
            }
            if i > 0 && m.joined_at < a.members[i - 1].joined_at {
                problems
                    .push(format!("lists member {} before one that joined earlier", m.realm_id));
            }
            if let Some(at) = m.leaving.as_ref().map(|l| l.at) {
                if at <= tick || at > tick + ALLIANCE_LEAVE_DELAY {
                    problems.push(format!(
                        "has member {} leaving at tick {}",
                        m.realm_id,
                        js_number(at)
                    ));
                }
            }
        }
        let unique: HashSet<&String> = a.invites.iter().collect();
        if unique.len() != a.invites.len() {
            problems.push("invites a realm twice".into());
        }
        for id in &a.invites {
            if !realms.contains(id.as_str()) {
                problems.push(format!("invites {id}, which has ended"));
            } else if member_of.contains_key(id.as_str()) {
                problems.push(format!("invites {id}, which is in an alliance"));
            }
        }
        let members: HashSet<&str> = a.members.iter().map(|m| m.realm_id.as_str()).collect();
        for p in &a.army {
            let is = serde_json::to_value(p.is).ok();
            let is = is.as_ref().and_then(|v| v.as_str()).unwrap_or_default();
            // `?.owner` / `?.realmId`: gone is `undefined`, of nobody `null`.
            let owner: Option<Option<&str>> = if is == "resident" {
                world.residents.iter().find(|r| r.id == p.id).map(|r| r.owner.as_deref())
            } else {
                world.carriages.iter().find(|k| k.id == p.id).map(|k| k.realm_id.as_deref())
            };
            match owner {
                None => problems.push(format!("has {is} {} in its army, which is gone", p.id)),
                Some(o) if !members.contains(o.unwrap_or("")) => {
                    problems.push(format!("has {is} {} in its army, which is no member's", p.id))
                }
                _ => {}
            }
            if handed_over.get(p.id.as_str()) != Some(&a.id.as_str()) {
                problems.push(format!("shares {is} {} in its army", p.id));
            }
            if let Some(at) = p.recall_at {
                if at <= tick || at > tick + ALLIANCE_RECALL_DELAY {
                    problems.push(format!(
                        "has {is} {} in its army recalled at tick {}",
                        p.id,
                        js_number(at)
                    ));
                }
            }
        }
        for p in problems {
            out.push(violation(name, format!("alliance {} {p}", a.id), &[&a.id]));
        }
    }
    out
}

/// Crimes hold together (`crimesSound`, `CONTEXT.md`: Crime, Witness).
pub fn crimes_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "crimes-sound";
    let memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY;
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for c in &world.crimes {
        let mut problems: Vec<String> = Vec::new();
        if c.culprit.org == c.victim_org {
            problems.push("is against its culprit’s own Organization".into());
        }
        if c.tick > tick {
            problems.push(format!("happens later, at tick {}", js_number(c.tick)));
        }
        if c.witnesses.iter().collect::<HashSet<_>>().len() != c.witnesses.len() {
            problems.push("lists a witness twice".into());
        }
        for id in &c.witnesses {
            // `new Map(...)`: the last resident with the id.
            match world.residents.iter().rev().find(|r| &r.id == id) {
                None => problems.push(format!("has witness {id}, who is gone")),
                Some(w)
                    if w.owner.as_deref().or(w.city_id.as_deref())
                        == Some(c.culprit.org.as_str()) =>
                {
                    problems.push(format!("has witness {id} of the culprit’s Organization"))
                }
                _ => {}
            }
        }
        if c.known_by.iter().collect::<HashSet<_>>().len() != c.known_by.len() {
            problems.push("is known twice to one".into());
        }
        let remembered = !c.known_by.is_empty() && tick - c.heard_at.unwrap_or(c.tick) <= memory;
        // `awaitsTrader` (T86.7's `crimes.ts`): a captured post a wandering trader may still find out.
        let awaits = c.post.as_ref().is_some_and(|post| {
            !c.known_by.contains(&c.victim_org)
                && world.traders.iter().any(|t| t.r#loop.contains(post))
        });
        if c.witnesses.is_empty() && !remembered && !awaits {
            problems.push("is kept though forgotten".into());
        }
        let capture =
            serde_json::to_value(c.kind).ok().and_then(|v| v.as_str().map(|s| s == "capture"));
        if capture.unwrap_or(false) != c.post.is_some() {
            problems.push("names a post without being a capture, or the other way round".into());
        }
        for p in problems {
            out.push(violation(name, format!("crime {} {p}", c.id), &[&c.id]));
        }
    }
    out
}

/// Only gates close, and a gate is either closed or open (`gatesSound`).
pub fn gates_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "gates-sound";
    world
        .buildings
        .iter()
        .filter(|b| {
            b.closed.is_some()
                && (b.kind != BuildingKind::Gate || b.site.is_some() || b.closed != Some(true))
        })
        .map(|b| {
            let site = if b.site.is_some() { "site of a " } else { "" };
            let msg = format!(
                "{site}{} {} is marked closed: {}",
                kind_name(b.kind),
                b.id,
                b.closed.unwrap_or_default()
            );
            violation(name, msg, &[&b.id])
        })
        .collect()
}

/// Only a finished wall or gate takes damage, and stands only while short of its strength
/// (`wallDamageSound`).
pub fn wall_damage_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "wall-damage-sound";
    world
        .buildings
        .iter()
        .filter(|b| {
            b.damage.is_some_and(|d| !is_wall_or_gate(b) || !(d >= 0.0 && d < wall_strength(b)))
        })
        .map(|b| {
            let site = if b.site.is_some() { "site of a " } else { "" };
            let msg = format!(
                "{site}{} {} stands with damage {}",
                kind_name(b.kind),
                b.id,
                js_number(b.damage.unwrap_or_default())
            );
            violation(name, msg, &[&b.id])
        })
        .collect()
}

/// A teacher stands on a finished training ground, and a ground has at most one teacher
/// (`teachersSound`).
pub fn teachers_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "teachers-sound";
    let mut out = Vec::new();
    let mut teachers: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(ResidentOrder::Teach(o)) = &r.order else { continue };
        let ground = world.buildings.iter().find(|b| b.id == o.building_id);
        let other = teachers.get(o.building_id.as_str()).copied();
        let problem = match ground {
            Some(g) if g.kind == BuildingKind::TrainingGround && g.site.is_none() => {
                if !is_at((r.x as i32, r.y as i32), placed(g), terrain.size) {
                    Some(format!(
                        "teaches at {} but stands off it, on ({}, {})",
                        g.id,
                        js_number(r.x),
                        js_number(r.y)
                    ))
                } else {
                    other.map(|o| format!("teaches at {}, where {o} teaches already", g.id))
                }
            }
            _ => Some(format!("teaches at {}, no finished training ground", o.building_id)),
        };
        match problem {
            Some(p) => {
                let ids: Vec<&str> = match other {
                    Some(o) => vec![&r.id, o],
                    None => vec![&r.id],
                };
                out.push(violation(name, format!("resident {} {p}", r.id), &ids));
            }
            None => {
                teachers.insert(&o.building_id, &r.id);
            }
        }
    }
    out
}

/// A trainee stands on a finished training ground, and a ground has no more than its room
/// (`traineesSound`).
pub fn trainees_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "trainees-sound";
    let mut out = Vec::new();
    let mut trainees: Vec<(&str, Vec<&str>)> = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Train(o)) = &r.order else { continue };
        let ground = world.buildings.iter().find(|b| b.id == o.building_id);
        let problem = match ground {
            Some(g) if g.kind == BuildingKind::TrainingGround && g.site.is_none() => {
                (!is_at((r.x as i32, r.y as i32), placed(g), terrain.size)).then(|| {
                    format!(
                        "trains at {} but stands off it, on ({}, {})",
                        g.id,
                        js_number(r.x),
                        js_number(r.y)
                    )
                })
            }
            _ => Some(format!("trains at {}, no finished training ground", o.building_id)),
        };
        match problem {
            Some(p) => out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id])),
            None => match trainees.iter_mut().find(|(g, _)| *g == o.building_id) {
                Some((_, ids)) => ids.push(&r.id),
                None => trainees.push((&o.building_id, vec![&r.id])),
            },
        }
    }
    for (ground, ids) in trainees {
        if ids.len() as f64 <= TRAINING_GROUND_MAX_TRAINEES {
            continue;
        }
        let msg = format!(
            "{} train at {ground}, room for {}",
            ids.len(),
            js_number(TRAINING_GROUND_MAX_TRAINEES)
        );
        out.push(violation(name, msg, &ids));
    }
    out
}

/// A climber stands where they started climbing, between 0 and 1 of the way over
/// (`climbOrdersSound`).
pub fn climb_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "climb-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Climb(o)) = &r.order else { continue };
        let problem = if r.x != o.at.x || r.y != o.at.y {
            Some(format!(
                "climbs from ({}, {}) but stands on ({}, {})",
                js_number(o.at.x),
                js_number(o.at.y),
                js_number(r.x),
                js_number(r.y)
            ))
        } else if !(o.progress >= 0.0 && o.progress < 1.0) {
            Some(format!("is {} of the way over a wall", js_number(o.progress)))
        } else {
            None
        };
        if let Some(p) = problem {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// Every step left on a moving order's path is a step the resident can take
/// (`pathsAreSteps`).
pub fn paths_are_steps(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "paths-are-steps";
    let size = terrain.size;
    let enterable = |t: usize| is_passable_terrain(terrain.tiles[t]);
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
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
        let on_it =
            site.is_some_and(|s| s.site.is_some() && s.kind == kind && s.x == r.x && s.y == r.y);
        if !on_it || r.x != first.0 || r.y != first.1 {
            fail(format!(
                "builds {site_id}, which is not the {building} site on their tile and the order’s next"
            ));
        }
    }
    out
}

/// The Trade Organization stays apart (`tradeOrgSound`).
pub fn trade_org_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "trade-org-sound";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, m, &[id]));
    let mut trade_org = HashSet::new();
    for c in &world.cities {
        if c.trade_org.is_none() {
            continue;
        }
        trade_org.insert(c.id.as_str());
        if let Some(realm) = &c.realm_id {
            fail(&c.id, format!("Trade Org city {} belongs to realm {realm}", c.id));
        }
    }
    let hqs: Vec<_> = world
        .cities
        .iter()
        .filter(|c| c.trade_org.is_some_and(|t| serde_json::to_value(t).ok() == Some("hq".into())))
        .collect();
    if hqs.len() > 1 {
        fail(&hqs[1].id, format!("the world has {} Trade Org HQs", hqs.len()));
    }
    for b in &world.buildings {
        if let Some(city) = &b.city_id {
            if b.kind == BuildingKind::Warehouse && !trade_org.contains(city.as_str()) {
                fail(&b.id, format!("warehouse {} stands in {city}, not a Trade Org city", b.id));
            }
        }
    }
    out
}

/// Whether a resident runs the game's own default script (`r.script?.scriptId === 0`): an NPC
/// city's residents; a Player's unedited ones are checked where their scripts run.
fn runs_the_game_default(r: &csp_shared::world::Resident) -> bool {
    r.script.as_ref().is_some_and(|s| s.script_id == 0)
}

/// At most one carrier of a workplace's output at once, among NPC cities' residents running the
/// game's own Work default (`gameDefaultCarriers`).
pub fn game_default_carriers(world: &WorldState, _: &TerrainMap) -> Out {
    one_carrier_at_a_time(world, &runs_the_game_default)
}

/// At most one fetcher of a site's materials at once (`gameDefaultFetchers`).
pub fn game_default_fetchers(world: &WorldState, _: &TerrainMap) -> Out {
    one_fetcher_at_a_time(world, &runs_the_game_default)
}

/// At most one fetcher of a processing workplace's inputs at once (`gameDefaultInputFetchers`).
pub fn game_default_input_fetchers(world: &WorldState, _: &TerrainMap) -> Out {
    one_input_fetcher_at_a_time(world, &runs_the_game_default)
}

/// Nobody runs Work, Build or Haul for longer than a tick without its target
/// (`gameDefaultTargets`).
pub fn game_default_targets(world: &WorldState, _: &TerrainMap) -> Out {
    defaults_have_a_target(world, &|r| r.script.as_ref().filter(|s| s.script_id == 0)?.task)
}

/// Whether the city keeps track of outsiders: trading posts and the HQ keep their own rules
/// (`watches` of `outsiders.ts`).
fn watches(city: &csp_shared::world::City) -> bool {
    city.trade_org.is_none()
}

/// Whether `r` counts as an outsider for `city`, wherever they stand (`outsiderTo` of
/// `outsiders.ts`, `CONTEXT.md`: Alarm): of another realm, or of another NPC city, and not allied;
/// someone hired by the city's realm or an ally of it is on its side.
// Written here, beside the invariant that reads it, because the module that ports
// `outsiders.ts` keeps its own.
fn outsider_to(
    world: &WorldState,
    city: &csp_shared::world::City,
    r: &csp_shared::world::Resident,
) -> bool {
    let Some(theirs) = r.owner.as_deref().or(r.city_id.as_deref()) else { return false };
    let side = city.realm_id.as_deref().unwrap_or(&city.id);
    if allied_ids(world, side, theirs) {
        return false;
    }
    match commander_of_resident(world, r) {
        None => true,
        Some(by) => by == theirs || !allied_ids(world, side, &by),
    }
}

fn allied_ids(world: &WorldState, a: &str, b: &str) -> bool {
    crate::queries::alliance::allied(world, a, b)
}

/// A city's outsiders are there as of the tick that just ended: each one once, alive, of no side
/// of the city's and standing in its area. A list is never left empty, and trading posts and the
/// HQ keep none (`outsidersSound`, ADR 0004; `CONTEXT.md`: Alarm).
pub fn outsiders_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "outsiders-sound";
    let crew = caravan_crew(world);
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(list) = &city.outsiders else { continue };
        let mut problem = |message: String, ids: &[&str]| {
            let mut entity_ids = vec![city.id.clone()];
            entity_ids.extend(ids.iter().map(|s| s.to_string()));
            out.push(InvariantViolation {
                invariant: name.into(),
                message: format!("{} {message}", city.id),
                entity_ids,
            });
        };
        if list.is_empty() {
            problem("keeps an empty list of outsiders".into(), &[]);
        }
        if !watches(city) {
            problem("keeps outsiders, but keeps its own rules".into(), &[]);
        }
        if list.iter().collect::<HashSet<_>>().len() != list.len() {
            problem("lists an outsider twice".into(), &[]);
        }
        let area: Vec<&csp_shared::world::Building> = world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_ref() == Some(&city.id) && is_city_building(b))
            .collect();
        for id in list {
            let Some(r) = world.residents.iter().rev().find(|r| &r.id == id) else {
                problem(format!("lists {id}, who is gone"), &[id]);
                continue;
            };
            if !outsider_to(world, city, r) || crew.contains(id) {
                problem(format!("lists {id}, who is no outsider"), &[id]);
            } else if !area.iter().any(|b| {
                near_footprint(
                    placed(b),
                    (r.x as i32, r.y as i32),
                    CITY_AREA_MARGIN as i32,
                    terrain.size,
                )
            }) {
                problem(format!("lists {id}, who stands outside its area"), &[id]);
            }
        }
    }
    out
}
