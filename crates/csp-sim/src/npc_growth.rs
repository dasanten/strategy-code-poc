//! How an NPC city grows (`apps/server/src/npc-growth.ts`, `CONTEXT.md`: NPC city): it pairs its
//! adults, builds a house when it has a food surplus and no free housing, a farm when the farmers
//! it wants don't fit, and the workplace for a material it needs but has no workplace for. With no
//! room left inside its wall it builds on its edge, puts up a new wall `NPC_WALL_STEP` tiles
//! further out and then tears down the old one. All through the orders a Player's residents take
//! (ADR 0002). The city decides all this in its planning pass and keeps the project in its plan;
//! each tick it only gives its builders their part in it (`take_part`).

use std::collections::HashSet;
use std::f64::consts::PI;

use csp_shared::balance::{
    MAP_SIZE, NPC_ADULTS_PER_PAIR, NPC_BUILDERS, NPC_FARM_REACH, NPC_VILLAGE, NPC_WALL_STEP,
    NPC_WALL_TILES_PER_TRIP,
};
use csp_shared::footprint::{covers, footprint_tiles, is_at, Placed, FOOTPRINT};
use csp_shared::terrain::{wrap, wrap_delta, wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, CityProject, Good, GoodsSpot, PickUpOrder,
    ResidentOrder, Stock, Task, TearDownOrder, Tile, TradeOrgCity, WorldState,
};
use serde_json::json;

use crate::city_layout::{layout_plan, GateAt};
use crate::npc_behaviour::{default_script, walk_to};
use crate::npc_chain::{
    chain_good, chain_input, chain_store, holds_batch, makes, own_workplaces, processed_by,
    short_goods, SurplusWork,
};
use crate::npc_inner_wall::{inner_wall_project, outer_walls, Rings as InnerRings};
use crate::npc_plan::{farmers_wanted, food_short};
use crate::npc_scouts::knows_node;
use crate::npc_training::wants_training_ground;
use crate::placing::Ground;
use crate::queries::building::{
    build_materials, build_problem, building_at, materials_needed, max_workers, node_corner,
    node_good, node_workplace, work_needed,
};
use crate::queries::city::{has_food_surplus, in_city_area, is_city_building};
use crate::queries::city_area::{city_area_tiles, city_membership, free_housing};
use crate::queries::horses::{owns_horse, HorseOwner};
use crate::queries::names::{held, held_in, kind_name, placed};
use crate::queries::npc_trade::{is_big_npc_city, npc_city_stock, npc_needs_scale, npc_reserve};

use crate::hq_growth as hq;

/// A tile, relative to a city's home, the short way round the map (`Offset`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offset {
    pub dx: i32,
    pub dy: i32,
}

/// How far a tile is from the home along the farther direction (`ringOf`).
fn ring_of(o: Offset) -> i32 {
    o.dx.abs().max(o.dy.abs())
}

/// The city's walls as rings round its home (`Rings`).
#[derive(Debug, Clone, PartialEq)]
pub struct Rings {
    pub inner: i32,
    pub outer: i32,
    /// It has outgrown its wall: a house outside it, or the new wall begun.
    pub expanding: bool,
    /// The id of the gate of the innermost ring, if it has one, and where it stands.
    pub gate: Option<(String, (i32, i32))>,
    /// Where the outer ring's gate goes: in line with the inner one's, or south of the home.
    pub new_gate: Offset,
}

impl Rings {
    fn gate_at(&self) -> GateAt {
        GateAt { dx: self.new_gate.dx, dy: self.new_gate.dy }
    }
}

/// A building project (`BuildProject`).
fn build(building: BuildingKind, at: (i32, i32)) -> CityProject {
    CityProject::Build { building, x: f64::from(at.0), y: f64::from(at.1) }
}

/// Whether a city grows at all (`cityGrows`): an NPC city always, the Trade Organization's cities
/// only while the HQ is too weak (`hqGrows`); trading posts never.
pub fn city_grows(world: &WorldState, city: &City, adults: &[usize]) -> bool {
    city.trade_org.is_none()
        || (city.trade_org == Some(TradeOrgCity::Hq) && hq::hq_grows(world, adults))
}

/// What a city builds or takes down next (`cityProject`): an NPC city whatever it wants most
/// (`next_project`); the HQ its rings and houses while it `grows`; and otherwise a Trade Org city
/// the chain for what is short of its warehouses' floor.
pub fn city_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    grows: bool,
) -> Option<CityProject> {
    if city.trade_org.is_none() {
        return if grows { next_project(world, city, home, terrain) } else { None };
    }
    grows
        .then(|| hq::hq_project(world, city, terrain))
        .flatten()
        .or_else(|| trade_org_chain_project(world, city, home, terrain))
}

/// The chain a Trade Org city builds (`tradeOrgChainProject`): a workplace of its own it has begun,
/// else the workplace for the good shortest of its warehouses' floor it can make.
fn trade_org_chain_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
) -> Option<CityProject> {
    let own: HashSet<&String> = city.workplace_ids.iter().flatten().collect();
    if let Some(begun) = world.buildings.iter().find(|b| b.site.is_some() && own.contains(&b.id)) {
        return Some(build(begun.kind, (begun.x as i32, begun.y as i32)));
    }
    let rings = if city.trade_org == Some(TradeOrgCity::Hq) {
        None
    } else {
        wall_rings(world, city, home, terrain.size)
    };
    short_goods(world, city, terrain.size, None).into_iter().find_map(|good| {
        chain_project(world, city, home, terrain, rings.as_ref(), good, &mut HashSet::new())
    })
}

/// Food runs short: the city's pairs with no child on the way end (`endPairs`, `CONTEXT.md`:
/// Pairing).
pub fn end_pairs(world: &mut WorldState, adults: &[usize]) {
    for &i in adults {
        let r = &world.residents[i];
        if r.pair.is_some() && r.carrying.is_none() && !partner_carrying(world, i) {
            world.residents[i].pair = None;
        }
    }
}

/// Stops a builder who can do no more at their site until materials come (`stopBuildersWhoCantGoOn`).
pub fn stop_builders_who_cant_go_on(
    world: &mut WorldState,
    adults: &[usize],
    storage: Option<usize>,
) {
    for &i in adults {
        let Some(ResidentOrder::Build(o)) = &world.residents[i].order else { continue };
        let Some(site) = world.buildings.iter().find(|b| Some(&b.id) == o.site_id.as_ref()) else {
            continue;
        };
        let store = storage.map(|s| &world.buildings[s]);
        if site.site.is_some() && !can_do_more(world, i, site, store) {
            world.residents[i].order = None;
            world.residents[i].script = None;
        }
    }
}

/// Whether a builder can still help a site (`canDoMore`): it needs work, or materials they carry or
/// the storage holds, or they are fetching some.
pub fn can_do_more(
    world: &WorldState,
    i: usize,
    site: &Building,
    storage: Option<&Building>,
) -> bool {
    let r = &world.residents[i];
    let fetching =
        r.script.as_ref().and_then(|s| s.memory.get("fetch")).is_some_and(|v| !v.is_null());
    if work_needed(site) > 0.0 || fetching {
        return true;
    }
    let need = materials_needed(site);
    pick(Some(&r.carried), &need).is_some()
        || pick(storage.and_then(|s| s.stock.as_ref()), &need).is_some()
}

/// Whether a resident is building (by the Build default or not), tearing down or delivering
/// (`isBuilder`).
pub fn is_builder(r: &csp_shared::world::Resident) -> bool {
    let building =
        r.script.as_ref().is_some_and(|s| s.script_id == 0 && s.task == Some(Task::Build));
    building
        || match &r.order {
            Some(ResidentOrder::Build(_)) | Some(ResidentOrder::TearDown(_)) => true,
            Some(ResidentOrder::Drop(o)) => matches!(o.to, GoodsSpot::Site { .. }),
            Some(ResidentOrder::PickUp(o)) => {
                matches!(o.from, GoodsSpot::Storage { .. }) && !o.goods.contains_key(&Good::Food)
            }
            Some(ResidentOrder::Fetch(o)) => !o.goods.contains_key(&Good::Food),
            _ => false,
        }
}

/// Whether a resident's partner carries their child (`partnerCarrying`).
fn partner_carrying(world: &WorldState, i: usize) -> bool {
    let r = &world.residents[i];
    let Some(pair) = &r.pair else { return false };
    world
        .residents
        .iter()
        .find(|x| x.id == pair.partner_id)
        .is_some_and(|p| p.carrying.as_ref().is_some_and(|c| c.partner_id == r.id))
}

/// Pairs two residents, by the pairing order as a Player would (`pair.apply`).
fn apply_pair(world: &mut WorldState, a: usize, b: usize) {
    let (ra, rb) = (world.residents[a].id.clone(), world.residents[b].id.clone());
    crate::pairing::apply_pair(
        world,
        &crate::pairing::PairRequest { resident_id: Some(&ra), partner_id: Some(&rb) },
    );
}

/// Pairs unpaired adults two by two (`pairAdults`, `CONTEXT.md`: Pairing) while the city has a
/// food surplus, until it holds one pair for every `NPC_ADULTS_PER_PAIR` adults.
pub fn pair_adults(world: &mut WorldState, city: &City, adults: &[usize]) {
    if !has_food_surplus(world, city) {
        return;
    }
    let pairs = adults.iter().filter(|&&i| world.residents[i].pair.is_some()).count() as f64 / 2.0;
    let mut wanted = (adults.len() as f64 / NPC_ADULTS_PER_PAIR).floor() - pairs.floor();
    let mut single: Vec<usize> = adults
        .iter()
        .copied()
        .filter(|&i| world.residents[i].pair.is_none() && world.residents[i].carrying.is_none())
        .collect();
    while wanted > 0.0 && single.len() >= 2 {
        let (a, b) = (single.remove(0), single.remove(0));
        apply_pair(world, a, b);
        wanted -= 1.0;
    }
}

/// Gives a resident their part in a project, if there is one for them (`takePart`): walking to the
/// tile and tearing down there; or building it by the game's Build default. For a tile of wall they
/// first take enough for a few tiles from the storage. False when they can't help, or the building
/// to tear down is gone. With `deliver`, only bringing materials they carry.
pub fn take_part(
    world: &mut WorldState,
    i: usize,
    project: &CityProject,
    storage: Option<usize>,
    deliver: bool,
) -> bool {
    let r = &world.residents[i];
    if deliver {
        let carries = match project {
            CityProject::Build { x, y, .. } => building_at(world, *x as i32, *y as i32, MAP_SIZE)
                .filter(|s| s.site.is_some())
                .and_then(|s| pick(Some(&r.carried), &materials_needed(s)))
                .is_some(),
            CityProject::TearDown { .. } => false,
        };
        // Carrying the materials of a few tiles of wall, they help with this one.
        let wall = matches!(project, CityProject::Build { building, .. } if for_wall(*building, &r.carried));
        if !carries && !wall {
            return false;
        }
    }
    let (building, x, y) = match project {
        CityProject::TearDown { building_id } => {
            let Some(b) = world.buildings.iter().find(|x| &x.id == building_id) else {
                return false;
            };
            let (bid, at) = (b.id.clone(), (b.x, b.y));
            let here = (r.x as i32, r.y as i32);
            if !is_at(here, placed(b), MAP_SIZE) {
                walk_to(&mut world.residents[i], at);
            } else {
                let at = Tile { x: r.x, y: r.y };
                world.residents[i].order =
                    Some(ResidentOrder::TearDown(TearDownOrder { building_id: bid, at }));
            }
            return true;
        }
        CityProject::Build { building, x, y } => (*building, *x, *y),
    };
    let start_build = |world: &mut WorldState| {
        world.residents[i].order = None;
        let memory = json!({ "building": kind_name(building), "at": { "x": x, "y": y } });
        world.residents[i].script = Some(default_script(Task::Build, memory));
        true
    };
    let Some(site) = building_at(world, x as i32, y as i32, MAP_SIZE).filter(|s| s.site.is_some())
    else {
        return start_build(world);
    };
    let need = materials_needed(site);
    if pick(Some(&r.carried), &need).is_some() {
        return start_build(world);
    }
    // For a tile of wall, enough for a few tiles at once: the rest goes to the next ones.
    let wall = building == BuildingKind::Wall || building == BuildingKind::Gate;
    let store = storage.map(|s| &world.buildings[s]);
    let stocked = if wall && !for_wall(building, &r.carried) {
        pick(store.and_then(|s| s.stock.as_ref()), &times(&need, NPC_WALL_TILES_PER_TRIP))
    } else {
        None
    };
    if let (Some(store), Some(goods)) = (store, stocked) {
        let (sid, at) = (store.id.clone(), (store.x, store.y));
        if is_at((r.x as i32, r.y as i32), placed(store), MAP_SIZE) {
            let from = GoodsSpot::Storage { storage_id: sid };
            world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder { from, goods }));
        } else {
            walk_to(&mut world.residents[i], at);
        }
        return true;
    }
    can_do_more(world, i, site, store) && start_build(world)
}

/// Whether a resident carries materials for walls or gates, for a project of `building`
/// (`forWall`).
fn for_wall(building: BuildingKind, carried: &Stock) -> bool {
    if building != BuildingKind::Wall && building != BuildingKind::Gate {
        return false;
    }
    pick(Some(carried), &build_materials(building)).is_some()
}

/// `n` times the goods (`times`).
fn times(goods: &Stock, n: f64) -> Stock {
    goods.iter().map(|(g, units)| (*g, units * n)).collect()
}

/// The goods of `wanted` that `stock` holds some of, as many as wanted; none if it holds none
/// (`pick`).
fn pick(stock: Option<&Stock>, wanted: &Stock) -> Option<Stock> {
    let out: Stock = wanted
        .iter()
        .filter_map(|(good, units)| {
            let have = held_in(stock, *good);
            (have > 0.0).then(|| (*good, have.min(*units)))
        })
        .collect();
    (!out.is_empty()).then_some(out)
}

/// What an NPC city builds or takes down next, if anything (`nextProject`): once its new wall is
/// finished, the old one, a stretch at a time and the gate last; else whatever it wants most
/// (`wanted`), its materials' workplaces first (`materials_first`).
pub fn next_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
) -> Option<CityProject> {
    let rings = wall_rings(world, city, home, terrain.size);
    if let Some(r) = &rings {
        if let Some(old) = old_wall_to_tear_down(world, city, home, terrain, r) {
            return Some(CityProject::TearDown { building_id: old });
        }
    }
    let want = wanted(world, city, home, terrain, rings.as_ref())?;
    Some(materials_first(world, city, home, terrain, rings.as_ref(), want, &mut HashSet::new()))
}

/// What the residents of a city carry, all together (`carriedBy`).
fn carried_by(world: &WorldState, city: &City) -> Stock {
    let mut out = Stock::new();
    for r in world.residents.iter().filter(|r| r.city_id.as_ref() == Some(&city.id)) {
        for (good, n) in &r.carried {
            *out.entry(*good).or_insert(0.0) += n;
        }
    }
    out
}

/// How many of a city's adults build at once (`npcBuilders`): `NPC_BUILDERS` for each step of an
/// NPC city's needs, and just that at a Trade Org city; an NPC city with no storage yet lets
/// everyone who can.
pub fn npc_builders(world: &WorldState, city: &City) -> f64 {
    if city.trade_org.is_some() {
        return NPC_BUILDERS;
    }
    if no_storage_yet(world, city) {
        f64::INFINITY
    } else {
        NPC_BUILDERS * npc_needs_scale(world, city)
    }
}

/// Whether an NPC city has no finished storage yet (`noStorageYet`).
pub fn no_storage_yet(world: &WorldState, city: &City) -> bool {
    city.trade_org.is_none()
        && !world.buildings.iter().any(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        })
}

/// Whether an NPC city has no finished farm yet (`noFarm`).
pub fn no_farm(world: &WorldState, city: &City) -> bool {
    city.trade_org.is_none()
        && !world.buildings.iter().any(|b| {
            b.kind == BuildingKind::Farm && b.city_id.as_ref() == Some(&city.id) && b.site.is_none()
        })
}

/// Where a project builds, and what (`want.x`, `want.y`, `want.building`).
fn build_of(p: &CityProject) -> (BuildingKind, i32, i32) {
    match p {
        CityProject::Build { building, x, y } => (*building, *x as i32, *y as i32),
        CityProject::TearDown { .. } => unreachable!("a build project"),
    }
}

/// The project to take on before `want` (`materialsFirst`): when it needs a material the storage
/// lacks and none of the city's workplaces makes, the workplace for that material first.
fn materials_first(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
    want: CityProject,
    seen: &mut HashSet<Good>,
) -> CityProject {
    let (building, x, y) = build_of(&want);
    let need = match building_at(world, x, y, MAP_SIZE).filter(|s| s.site.is_some()) {
        Some(site) => materials_needed(site),
        None => build_materials(building),
    };
    let storage = world.buildings.iter().find(|b| {
        b.city_id.as_ref() == Some(&city.id) && b.kind == BuildingKind::Storage && b.site.is_none()
    });
    // Without a storage yet (a daughter), what its people carry.
    let have = if storage.is_some() || city.trade_org.is_some() {
        storage.and_then(|s| s.stock.clone()).unwrap_or_default()
    } else {
        carried_by(world, city)
    };
    for (good, units) in &need {
        if held(&have, *good) >= *units || makes(world, city, *good) {
            continue;
        }
        if let Some(first) = chain_project(world, city, home, terrain, rings, *good, seen) {
            return materials_first(world, city, home, terrain, rings, first, seen);
        }
    }
    want
}

/// The workplace an NPC city builds next for a good it is short of (`chainProject`), if it can make
/// the good at all: for a processed good whose input its storage lacks a batch of and none of its
/// workplaces makes, the workplace for that input first; then, while none of its workplaces makes
/// the good, on the nearest fitting node it knows of, or for a processing workplace in its area
/// like a house. `seen` keeps the goods already asked after.
pub fn chain_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
    good: Good,
    seen: &mut HashSet<Good>,
) -> Option<CityProject> {
    if !seen.insert(good) {
        return None;
    }
    let storage = chain_store(world, city);
    if let Some(input) = chain_input(good) {
        for (g, n) in &input {
            if held_in(storage.and_then(|s| s.stock.as_ref()), *g) >= *n || makes(world, city, *g) {
                continue;
            }
            return chain_project(world, city, home, terrain, rings, *g, seen);
        }
    }
    if makes(world, city, good) {
        return None;
    }
    if let Some(kind) = processed_by(good) {
        let hall = if city.trade_org == Some(TradeOrgCity::Hq) {
            crate::queries::city::town_hall_of(world, city)
        } else {
            None
        };
        let t = match hall {
            Some(hall) => {
                let outermost = hq::hq_rings(world, hall, terrain, None).outermost;
                hq::hq_house_tile(world, hall, terrain, outermost, kind)
            }
            None => house_tile(world, city, home, terrain, rings, kind),
        };
        return t.map(|t| build(kind, t));
    }
    let (kind, at) = nearest_node(world, city, home, terrain, good)?;
    Some(build(node_workplace(kind), at))
}

/// The nearest free resource node yielding `good` that the city knows of, with where its workplace
/// goes (`nearestNode`, `nodeCorner`).
fn nearest_node(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    good: Good,
) -> Option<(csp_shared::world::ResourceKind, (i32, i32))> {
    let home_at = (home.x as i32, home.y as i32);
    let mut best: Option<(csp_shared::world::ResourceKind, (i32, i32), f64)> = None;
    for node in &world.nodes {
        if node_good(node.kind) != good {
            continue;
        }
        let at = (node.x as i32, node.y as i32);
        let d = wrap_distance(terrain.size, home_at, at);
        if best.as_ref().is_some_and(|b| d >= b.2) || !knows_node(city, home_at, at, terrain.size) {
            continue;
        }
        if let Some(corner) = node_corner(world, terrain, node) {
            best = Some((node.kind, corner, d));
        }
    }
    best.map(|(k, at, _)| (k, at))
}

/// What the city wants built most, where (`wanted`).
fn wanted(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
) -> Option<CityProject> {
    let size = terrain.size;
    let own: HashSet<&String> = city.workplace_ids.iter().flatten().collect();
    let ring = match rings {
        Some(r) if r.expanding => new_wall(world, home, terrain, r),
        _ => first_wall(world, city, home, terrain, rings),
    };
    let in_area = |b: &Building| in_city_area(world, &city.id, b.x as i32, b.y as i32, size);
    let begun = world.buildings.iter().find(|b| {
        b.site.is_some()
            && (((b.kind == BuildingKind::Farm || b.kind == BuildingKind::Stable)
                && b.city_id.as_ref() == Some(&city.id))
                || own.contains(&b.id)
                || ((b.kind == BuildingKind::House || b.kind == BuildingKind::Storage)
                    && in_area(b))
                || (b.kind == BuildingKind::TrainingGround
                    && city.trade_org.is_none()
                    && is_big_npc_city(world, city)
                    && in_area(b)))
    });
    let wall_site = ring.iter().find(|t| t.site.is_some());
    if let Some(b) = begun {
        return Some(build(b.kind, (b.x as i32, b.y as i32)));
    }
    if let Some(t) = wall_site {
        let site = world.buildings.iter().find(|b| Some(&b.id) == t.site.as_ref()).expect("a site");
        return Some(build(site.kind, (site.x as i32, site.y as i32)));
    }
    let at = |building: BuildingKind, t: Option<(i32, i32)>| t.map(|t| build(building, t));
    if city.trade_org.is_none() {
        // A daughter starts with its town hall alone.
        let first = first_ring();
        let plan = rings.unwrap_or(&first);
        let has = |kind: BuildingKind| {
            world
                .buildings
                .iter()
                .any(|b| b.kind == kind && b.site.is_none() && b.city_id.as_ref() == Some(&city.id))
        };
        if !has(BuildingKind::Storage) {
            if let Some(p) = at(
                BuildingKind::Storage,
                house_tile(world, city, home, terrain, Some(plan), BuildingKind::Storage),
            ) {
                return Some(p);
            }
        }
        if !has(BuildingKind::Farm) {
            if let Some(p) = at(BuildingKind::Farm, farm_tile(world, home, terrain, Some(plan))) {
                return Some(p);
            }
        }
        if !has(BuildingKind::House) {
            if let Some(p) = at(
                BuildingKind::House,
                house_tile(world, city, home, terrain, Some(plan), BuildingKind::House),
            ) {
                return Some(p);
            }
        }
        // Its Food runs short with every farm full: another farm, whether or not anyone is idle.
        if food_short(world, city) && farms_full(world, city) {
            if let Some(p) = at(BuildingKind::Farm, farm_tile(world, home, terrain, Some(plan))) {
                return Some(p);
            }
        }
    }
    if farmers_dont_fit(world, city) {
        if let Some(p) = at(BuildingKind::Farm, farm_tile(world, home, terrain, rings)) {
            return Some(p);
        }
    }
    if has_food_surplus(world, city) && free_housing(world, &city.id) <= 0.0 {
        if let Some(p) = at(
            BuildingKind::House,
            house_tile(world, city, home, terrain, rings, BuildingKind::House),
        ) {
            return Some(p);
        }
    }
    if city.trade_org.is_none() {
        if wants_stable(world, city, size) {
            if let Some(p) =
                at(BuildingKind::Stable, stable_tile(world, city, home, terrain, rings))
            {
                return Some(p);
            }
        }
        for good in short_goods(world, city, size, None) {
            if let Some(chain) =
                chain_project(world, city, home, terrain, rings, good, &mut HashSet::new())
            {
                return Some(chain);
            }
        }
        if let Some(another) = another_workplace(world, city, home, terrain, rings) {
            return Some(another);
        }
    }
    if let Some(next) = ring.iter().find(|t| !t.done) {
        return Some(build(next.kind, (next.x, next.y)));
    }
    if let Some(second) = second_workplace(world, city, home, terrain) {
        return Some(second);
    }
    if wants_training_ground(world, city, size) {
        let t = house_tile(world, city, home, terrain, rings, BuildingKind::TrainingGround);
        if let Some(p) = at(BuildingKind::TrainingGround, t) {
            return Some(p);
        }
    }
    let rings = rings?;
    let inner = InnerRings {
        expanding: rings.expanding,
        gate: rings.gate.as_ref().map(|g| g.1),
        new_gate: rings.gate_at(),
    };
    inner_wall_project(world, city, home, terrain, &inner, npc_builders(world, city))
}

/// Whether a city's last pass left someone idle who is free to work (`handsIdle`).
fn hands_idle(world: &WorldState, city: &City) -> bool {
    let jobs = world.city_plans.get(&city.id).map(|p| &p.jobs);
    world.residents.iter().any(|r| {
        r.city_id.as_ref() == Some(&city.id)
            && r.carrying.is_none()
            && jobs.and_then(|j| j.get(&r.id)).is_some_and(|j| j.kind == CityJobKind::Idle)
    })
}

/// Whether a workplace's crew is full, by who is there or by the last pass (`crewHeld`).
fn crew_held(world: &WorldState, city: &City, place: &Building) -> bool {
    if crew_full(world, place) {
        return true;
    }
    let jobs = world.city_plans.get(&city.id).map(|p| &p.jobs);
    let n = jobs
        .into_iter()
        .flatten()
        .filter(|(_, j)| j.building_id.as_ref() == Some(&place.id))
        .count();
    n as f64 >= max_workers(place.kind).unwrap_or(0.0)
}

/// Whether an NPC city has finished farms and every one of them has its crew full (`farmsFull`).
pub fn farms_full(world: &WorldState, city: &City) -> bool {
    if city.trade_org.is_some() {
        return false;
    }
    let farms: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Farm && b.city_id.as_ref() == Some(&city.id) && b.site.is_none()
        })
        .collect();
    !farms.is_empty() && farms.iter().all(|b| crew_held(world, city, b))
}

/// Another workplace for a good an NPC city is short of, when all of those it has have their crews
/// full (`anotherWorkplace`).
fn another_workplace(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
) -> Option<CityProject> {
    let idle = hands_idle(world, city);
    let own: Vec<&Building> =
        own_workplaces(world, city).into_iter().filter(|b| b.site.is_none()).collect();
    let stock = chain_store(world, city).and_then(|s| s.stock.as_ref());
    fn full_good(
        world: &WorldState,
        city: &City,
        own: &[&Building],
        stock: Option<&Stock>,
        good: Good,
        seen: &mut HashSet<Good>,
    ) -> Option<Good> {
        if !seen.insert(good) {
            return None;
        }
        if let Some(input) = chain_input(good).filter(|i| !holds_batch(stock, i)) {
            let lacking: Vec<Good> =
                input.iter().filter(|(g, n)| held_in(stock, **g) < **n).map(|(g, _)| *g).collect();
            return lacking.into_iter().find_map(|g| full_good(world, city, own, stock, g, seen));
        }
        let places: Vec<&&Building> =
            own.iter().filter(|b| chain_good(world, b) == Some(good)).collect();
        (!places.is_empty() && places.iter().all(|b| crew_held(world, city, b))).then_some(good)
    }
    for short in short_goods(world, city, terrain.size, None) {
        let Some(good) = full_good(world, city, &own, stock, short, &mut HashSet::new()) else {
            continue;
        };
        if good != Good::Food && !idle {
            continue;
        }
        if good == Good::Food {
            if let Some(t) = farm_tile(world, home, terrain, rings) {
                return Some(build(BuildingKind::Farm, t));
            }
            continue;
        }
        if let Some(kind) = processed_by(good) {
            if let Some(t) = house_tile(world, city, home, terrain, rings, kind) {
                return Some(build(kind, t));
            }
            continue;
        }
        if let Some((kind, at)) = nearest_node(world, city, home, terrain, good) {
            return Some(build(node_workplace(kind), at));
        }
    }
    None
}

/// A big NPC city's second workplace (`secondWorkplace`): with nothing short, of a good dug or cut
/// whose one workplace has its crew full and whose cap isn't reached, the good furthest below its
/// cap first, on the nearest node of it the city knows of.
fn second_workplace(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
) -> Option<CityProject> {
    if city.trade_org.is_some() || !is_big_npc_city(world, city) {
        return None;
    }
    if !short_goods(world, city, terrain.size, None).is_empty() {
        return None;
    }
    let surplus = SurplusWork::of(world, city, chain_store(world, city));
    let mut places: indexmap::IndexMap<Good, Vec<&Building>> = indexmap::IndexMap::new();
    for b in own_workplaces(world, city) {
        if !on_node(b.kind) {
            continue;
        }
        if let Some(good) = chain_good(world, b) {
            places.entry(good).or_default().push(b);
        }
    }
    let mut wants: Vec<(Good, f64)> = places
        .iter()
        .filter_map(|(good, of)| {
            let place = of.first()?;
            let full = if of.len() == 1 { surplus.full(world, place) } else { None }?;
            crew_full(world, place).then_some((*good, full))
        })
        .collect();
    wants.sort_by(|a, b| a.1.total_cmp(&b.1));
    wants.into_iter().find_map(|(good, _)| {
        nearest_node(world, city, home, terrain, good).map(|(k, at)| build(node_workplace(k), at))
    })
}

/// Whether a kind of workplace stands on a resource node (`onNode`).
pub fn on_node(kind: BuildingKind) -> bool {
    matches!(kind, BuildingKind::LumberCamp | BuildingKind::Quarry | BuildingKind::Mine)
}

/// Whether a workplace has no room for another worker, coming or there (`crewFull`).
fn crew_full(world: &WorldState, place: &Building) -> bool {
    let there = world
        .residents
        .iter()
        .filter(|r| {
            let by_script = r
                .script
                .as_ref()
                .and_then(|s| s.memory.get("workplaceId"))
                .is_some_and(|v| v.as_str() == Some(place.id.as_str()));
            by_script
                || match &r.order {
                    Some(ResidentOrder::WorkAt(o)) => o.building_id == place.id,
                    Some(ResidentOrder::WalkTo(o)) => {
                        o.target.x == place.x && o.target.y == place.y
                    }
                    _ => false,
                }
        })
        .count();
    there as f64 >= max_workers(place.kind).unwrap_or(0.0)
}

/// Where a city without a wall puts its first (`firstRing`): a ring `NPC_VILLAGE.size / 2` tiles
/// round its home, as a village's, with its gate south of the home.
fn first_ring() -> Rings {
    let d = (NPC_VILLAGE.size / 2.0).floor() as i32;
    Rings { inner: d, outer: d, expanding: false, gate: None, new_gate: Offset { dx: 0, dy: d } }
}

/// The tiles of an NPC city's first wall (`firstWall`), the gate last.
fn first_wall(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
) -> Vec<WallTileState> {
    if city.trade_org.is_some() || rings.is_some_and(|r| r.gate.is_some() || r.expanding) {
        return Vec::new();
    }
    if rings.is_none()
        && held(&npc_city_stock(world, city), Good::Wood)
            < held(&npc_reserve(world, city), Good::Wood)
    {
        return Vec::new();
    }
    // Its gate south of the home on this ring, not where a wall moving out would put it.
    let ring = match rings {
        Some(r) => Rings { new_gate: Offset { dx: 0, dy: r.inner }, ..r.clone() },
        None => first_ring(),
    };
    let tiles = new_wall(world, home, terrain, &ring);
    let (walls, gates): (Vec<_>, Vec<_>) =
        tiles.into_iter().partition(|t| t.kind == BuildingKind::Wall);
    walls.into_iter().chain(gates.into_iter().filter(|t| t.kind == BuildingKind::Gate)).collect()
}

/// Whether an NPC city wants a stable (`wantsStable`).
fn wants_stable(world: &WorldState, city: &City, size: i32) -> bool {
    if world
        .buildings
        .iter()
        .any(|b| b.kind == BuildingKind::Stable && b.city_id.as_ref() == Some(&city.id))
    {
        return false;
    }
    if world.horses.iter().any(|h| h.city_id.as_ref() == Some(&city.id) && h.health > 0.0) {
        return true;
    }
    short_goods(world, city, size, None).is_empty()
}

/// A footprint of `kind` at (x, y).
fn at_kind(kind: BuildingKind, x: i32, y: i32) -> Placed<'static> {
    Placed { kind: kind_name(kind), x, y }
}

/// Where an NPC city puts its stable (`stableTile`): over its horses when one fits there, off its
/// streets unless they stand on one; else where it would put a house.
pub fn stable_tile(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let horses: Vec<_> =
        world.horses.iter().filter(|h| owns_horse(HorseOwner::City(&city.id), h)).collect();
    if let Some(first) = horses.first() {
        let area: HashSet<(i32, i32)> =
            city_area_tiles(world, &city.id, size).into_iter().collect();
        let ground = Ground::new(world, terrain, []);
        let side = FOOTPRINT.get("stable").expect("a footprint");
        let middle = side / 2;
        let far = side - 1;
        let (fx, fy) = (first.x as i32, first.y as i32);
        let mut corners = vec![(wrap(fx - middle, size), wrap(fy - middle, size))];
        corners.extend(footprint_tiles(at_kind(BuildingKind::Stable, fx - far, fy - far), size));
        let over: Vec<(i32, i32)> = corners
            .into_iter()
            .filter(|&(x, y)| {
                horses.iter().all(|h| {
                    covers(at_kind(BuildingKind::Stable, x, y), h.x as i32, h.y as i32, size)
                })
            })
            .collect();
        let lanes = layout_plan(world, city, home, rings.map(Rings::gate_at), size);
        let in_area = |tx: i32, ty: i32| area.contains(&(tx, ty));
        let off_street =
            |tx: i32, ty: i32| in_area(tx, ty) && !lanes.as_ref().is_some_and(|l| l.street(tx, ty));
        let allowed: [&dyn Fn(i32, i32) -> bool; 2] = [&off_street, &in_area];
        for allowed in allowed {
            for &(x, y) in &over {
                if ground.fits(BuildingKind::Stable, x, y, Some(allowed)) {
                    return Some((x, y));
                }
            }
        }
    }
    house_tile(world, city, home, terrain, rings, BuildingKind::Stable)
}

pub use crate::starting_city::resident_tiles;

/// Where an NPC city's first horses stand while it has no stable (`farStableSpot`), by the
/// north-west tile of a stable's footprint: wholly on free ground of its area, off its streets,
/// inside its wall and as far from its home as that goes.
pub fn far_stable_spot(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let area_list = city_area_tiles(world, &city.id, size);
    let area: HashSet<(i32, i32)> = area_list.iter().copied().collect();
    let ground = Ground::new(world, terrain, resident_tiles(world));
    let rings = wall_rings(world, city, home, size);
    let lanes = layout_plan(world, city, home, rings.as_ref().map(Rings::gate_at), size);
    let in_area =
        |x: i32, y: i32| area.contains(&(x, y)) && !lanes.as_ref().is_some_and(|l| l.street(x, y));
    let mut free: Vec<(i32, i32, i32, i32)> = area_list
        .iter()
        .filter(|&&(x, y)| ground.fits(BuildingKind::Stable, x, y, Some(&in_area)))
        .map(|&(x, y)| {
            let (near, far) = rings_of(home, at_kind(BuildingKind::Stable, x, y), size);
            (x, y, near, far)
        })
        .filter(|t| rings.as_ref().is_none_or(|r| t.3 < r.inner))
        .collect();
    free.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
    free.first().map(|t| (t.0, t.1))
}

/// Whether the farmers an NPC city wants don't fit on the farms it has (`farmersDontFit`).
fn farmers_dont_fit(world: &WorldState, city: &City) -> bool {
    let farms = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Farm && b.city_id.as_ref() == Some(&city.id) && b.site.is_none()
        })
        .count();
    if farms == 0 {
        return false;
    }
    farmers_wanted(world, city) > farms as f64 * max_workers(BuildingKind::Farm).unwrap_or(0.0)
}

/// The city's walls as rings round its home (`wallRings`). A city expands once it has a house,
/// finished or begun, outside its innermost ring, or has begun its new wall `NPC_WALL_STEP`
/// further out.
pub fn wall_rings(world: &WorldState, city: &City, home: &Building, size: i32) -> Option<Rings> {
    let (hx, hy) = (home.x as i32, home.y as i32);
    let off = |b: &Building| Offset {
        dx: wrap_delta(hx, b.x as i32, size),
        dy: wrap_delta(hy, b.y as i32, size),
    };
    let candidates: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && (b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
                && b.site.is_none()
        })
        .collect();
    let walls = outer_walls(&candidates, |b| (b.x as i32, b.y as i32), (hx, hy), size);
    if walls.is_empty() {
        return None;
    }
    let dists: Vec<i32> = walls.iter().map(|b| ring_of(off(b))).collect();
    let inner = *dists.iter().min().expect("walls");
    let outer = *dists.iter().max().expect("walls");
    let target = inner + NPC_WALL_STEP as i32;
    if outer != inner && outer != target {
        return None;
    }
    let is_wall = |b: &Building| b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate;
    let begun =
        world.buildings.iter().any(|b| is_wall(b) && b.site.is_some() && ring_of(off(b)) == target);
    let outside = world.buildings.iter().any(|b| {
        b.kind == BuildingKind::House
            && ring_of(off(b)) > inner
            && (b.city_id.as_ref() == Some(&city.id)
                || (b.site.is_some()
                    && in_city_area(world, &city.id, b.x as i32, b.y as i32, size)))
    });
    let gate = walls.iter().find(|b| b.kind == BuildingKind::Gate && ring_of(off(b)) == inner);
    let new_gate = match gate.map(|g| off(g)) {
        Some(g) if g.dy.abs() == inner => Offset { dx: g.dx, dy: g.dy.signum() * target },
        Some(g) => Offset { dx: g.dx.signum() * target, dy: g.dy },
        None => Offset { dx: 0, dy: target },
    };
    let expanding = outer > inner || begun || outside;
    Some(Rings {
        inner,
        outer: if expanding { target } else { inner },
        expanding,
        gate: gate.map(|g| (g.id.clone(), (g.x as i32, g.y as i32))),
        new_gate,
    })
}

/// A tile of a city's new wall (`WallTileState`): what goes there, and whether it is finished or
/// begun (`site`: the begun one's id).
#[derive(Debug, Clone, PartialEq)]
pub struct WallTileState {
    pub kind: BuildingKind,
    pub x: i32,
    pub y: i32,
    pub done: bool,
    pub site: Option<String>,
}

/// The tiles of the city's new wall (`newWall`), the gate first and then on round the ring from
/// it: each either finished, begun, or free for it. Tiles that can take no wall are left out.
pub fn new_wall(
    world: &WorldState,
    home: &Building,
    terrain: &TerrainMap,
    rings: &Rings,
) -> Vec<WallTileState> {
    let size = terrain.size;
    let d = rings.outer;
    let (hx, hy) = (home.x as i32, home.y as i32);
    let mut out: Vec<(f64, WallTileState)> = Vec::new();
    for dy in -d..=d {
        for dx in -d..=d {
            if dx.abs().max(dy.abs()) != d {
                continue;
            }
            let x = wrap(hx + dx, size);
            let y = wrap(hy + dy, size);
            let kind = if dx == rings.new_gate.dx && dy == rings.new_gate.dy {
                BuildingKind::Gate
            } else {
                BuildingKind::Wall
            };
            let angle = |dx: i32, dy: i32| f64::from(dy).atan2(f64::from(dx));
            let turn = angle(dx, dy) - angle(rings.new_gate.dx, rings.new_gate.dy);
            let order = (turn + 4.0 * PI) % (2.0 * PI);
            // The TypeScript's `buildingAt` without a size: `MAP_SIZE`.
            let here = building_at(world, x, y, MAP_SIZE);
            match here {
                Some(h) if h.kind == BuildingKind::Wall || h.kind == BuildingKind::Gate => {
                    out.push((
                        order,
                        WallTileState {
                            kind: h.kind,
                            x,
                            y,
                            done: h.site.is_none(),
                            site: h.site.as_ref().map(|_| h.id.clone()),
                        },
                    ));
                }
                _ => {
                    if build_problem(world, x, y, kind, Some(terrain)).is_none() {
                        out.push((order, WallTileState { kind, x, y, done: false, site: None }));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out.into_iter().map(|(_, t)| t).collect()
}

/// The stretch of the old wall to tear down next (`oldWallToTearDown`), once every tile of the new
/// wall is finished, and only while the city's other buildings stay part of it without the old
/// wall: the stretch farthest along the wall from its gate, and the gate last. Its id.
fn old_wall_to_tear_down(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: &Rings,
) -> Option<String> {
    if rings.outer == rings.inner {
        return None;
    }
    if new_wall(world, home, terrain, rings).iter().any(|t| !t.done) {
        return None;
    }
    let size = terrain.size;
    let (hx, hy) = (home.x as i32, home.y as i32);
    let old: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && (b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
                && b.site.is_none()
                && wrap_delta(hx, b.x as i32, size)
                    .abs()
                    .max(wrap_delta(hy, b.y as i32, size).abs())
                    == rings.inner
        })
        .collect();
    let gone: HashSet<&String> = old.iter().map(|b| &b.id).collect();
    // `cityMembership` reads the cities and buildings only.
    let mut without = WorldState { buildings: Vec::new(), residents: Vec::new(), ..world.clone() };
    without.buildings = world.buildings.iter().filter(|b| !gone.contains(&b.id)).cloned().collect();
    let members = city_membership(&without, size);
    let cut = world.buildings.iter().any(|b| {
        b.city_id.as_ref() == Some(&city.id)
            && is_city_building(b)
            && !gone.contains(&b.id)
            && members.get(&b.id) != Some(&city.id)
    });
    if cut {
        return None;
    }
    // Distances along the old wall from its gate, four ways as residents walk.
    let by_tile: std::collections::HashMap<(i32, i32), usize> =
        old.iter().enumerate().map(|(i, b)| ((b.x as i32, b.y as i32), i)).collect();
    let start = match &rings.gate {
        Some((id, _)) if gone.contains(id) => old.iter().position(|b| &b.id == id),
        _ => (!old.is_empty()).then_some(0),
    }?;
    let mut dist: Vec<Option<u32>> = vec![None; old.len()];
    dist[start] = Some(0);
    let mut todo = std::collections::VecDeque::from([start]);
    while let Some(i) = todo.pop_front() {
        let (x, y) = (old[i].x as i32, old[i].y as i32);
        for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            if let Some(&n) = by_tile.get(&(wrap(nx, size), wrap(ny, size))) {
                if dist[n].is_none() {
                    dist[n] = Some(dist[i].expect("reached") + 1);
                    todo.push_back(n);
                }
            }
        }
    }
    // Stretches cut off from the gate go first; then the farthest; the gate last.
    let far = |i: usize| dist[i].map_or(f64::INFINITY, f64::from);
    let mut order: Vec<usize> = (0..old.len()).collect();
    order.sort_by(|&a, &b| {
        far(b)
            .total_cmp(&far(a))
            .then_with(|| crate::queries::npc_trade::locale_compare(&old[a].id, &old[b].id))
    });
    order.first().map(|&i| old[i].id.clone())
}

/// The rings round the home that a footprint's tiles lie on, nearest and farthest (`ringsOf`).
fn rings_of(home: &Building, b: Placed, size: i32) -> (i32, i32) {
    let (hx, hy) = (home.x as i32, home.y as i32);
    let rings: Vec<i32> = footprint_tiles(b, size)
        .into_iter()
        .map(|(x, y)| ring_of(Offset { dx: wrap_delta(hx, x, size), dy: wrap_delta(hy, y, size) }))
        .collect();
    (*rings.iter().min().expect("a tile"), *rings.iter().max().expect("a tile"))
}

/// Where the city puts its next house, or another `kind` of building that goes in its area like one
/// (`houseTile`), by the north-west tile of its footprint: wholly on free ground of its area inside
/// its wall, nearest its home first; when it is expanding, inside the new wall. With no room left
/// there, on its edge just outside the wall. Its layout, if it has one, says which spots it may take
/// and which it fills first, and keeps its streets free.
pub fn house_tile(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
    kind: BuildingKind,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let area_list = city_area_tiles(world, &city.id, size);
    let area: HashSet<(i32, i32)> = area_list.iter().copied().collect();
    let ground = Ground::new(world, terrain, []);
    let plan = layout_plan(world, city, home, rings.map(Rings::gate_at), size);
    let allowed =
        |x: i32, y: i32| area.contains(&(x, y)) && !plan.as_ref().is_some_and(|p| p.street(x, y));
    let among = |spot: Option<&dyn Fn(i32, i32) -> bool>| -> Option<(i32, i32)> {
        let mut free: Vec<(i32, i32, i32, i32, i32)> = area_list
            .iter()
            .filter(|&&(x, y)| {
                spot.is_none_or(|s| s(x, y)) && ground.fits(kind, x, y, Some(&allowed))
            })
            .map(|&(x, y)| {
                let (near, far) = rings_of(home, at_kind(kind, x, y), size);
                let rank = plan.as_ref().and_then(|p| p.rank(kind, x, y)).unwrap_or(0);
                (x, y, near, far, rank)
            })
            .collect();
        free.sort_by(|a, b| {
            a.4.cmp(&b.4).then(a.2.cmp(&b.2)).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0))
        });
        let Some(rings) = rings else { return free.first().map(|t| (t.0, t.1)) };
        let inside = free.iter().find(|t| t.3 < rings.outer);
        if inside.is_some() || rings.expanding {
            return inside.map(|t| (t.0, t.1));
        }
        let step = NPC_WALL_STEP as i32;
        free.iter().find(|t| t.2 > rings.inner && t.3 < rings.inner + step).map(|t| (t.0, t.1))
    };
    let Some(plan_ref) = plan.as_ref() else { return among(None) };
    let own = among(Some(&|x, y| plan_ref.spot(kind, x, y)));
    if own.is_some() || !plan_ref.has_spill() || rings.is_some_and(|r| r.expanding) {
        return own;
    }
    among(Some(&|x, y| plan_ref.spill(kind, x, y).unwrap_or(false)))
}

/// Where the city lays out its next farm (`farmTile`), by the north-west tile of its footprint:
/// wholly on free Plains beyond where its next wall would stand, nearest that wall first and then
/// nearest its gate, up to `NPC_FARM_REACH` further out, off the way out of its gate.
pub fn farm_tile(
    world: &WorldState,
    home: &Building,
    terrain: &TerrainMap,
    rings: Option<&Rings>,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let wall = rings.map_or(0, |r| r.outer);
    let gate = rings.map_or(Offset { dx: 0, dy: wall }, |r| r.new_gate);
    let from = wall + NPC_WALL_STEP as i32 + 1;
    let side = FOOTPRINT.get("farm").expect("a footprint");
    let ground = Ground::new(world, terrain, []);
    let (hx, hy) = (home.x as i32, home.y as i32);
    // Keep the way out of the gate open, and stay beyond the next wall.
    let fine = |x: i32, y: i32| {
        let dx = wrap_delta(hx, x, size);
        let dy = wrap_delta(hy, y, size);
        let lane = if gate.dy.abs() >= gate.dx.abs() {
            dx == gate.dx && dy.signum() == gate.dy.signum()
        } else {
            dy == gate.dy && dx.signum() == gate.dx.signum()
        };
        !lane && ring_of(Offset { dx, dy }) >= from
    };
    for d in from..from + NPC_FARM_REACH as i32 {
        let mut best: Option<(i32, i32, f64)> = None;
        // North-west tiles of footprints whose nearest tile to the home is on ring `d`.
        let mut candidates = Vec::new();
        for t in -d - side + 1..=d {
            candidates.extend([(t, -d - side + 1), (t, d), (-d - side + 1, t), (d, t)]);
        }
        for (dx, dy) in candidates {
            let x = wrap(hx + dx, size);
            let y = wrap(hy + dy, size);
            if !ground.fits(BuildingKind::Farm, x, y, Some(&fine)) {
                continue;
            }
            let half = f64::from(side - 1) / 2.0;
            let dist = crate::terrain_gen::js_hypot(
                f64::from(dx) + half - f64::from(gate.dx),
                f64::from(dy) + half - f64::from(gate.dy),
            );
            if best.is_none_or(|b| dist < b.2) {
                best = Some((x, y, dist));
            }
        }
        if let Some(b) = best {
            return Some((b.0, b.1));
        }
    }
    None
}

#[cfg(test)]
mod needs_grow_tests;
#[cfg(test)]
mod tests;
