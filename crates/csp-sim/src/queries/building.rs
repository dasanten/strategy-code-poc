//! Building queries of `packages/shared/src/building.ts`: what stands on a tile, the finished
//! roads, recipes.

use std::collections::HashSet;

use csp_shared::balance::{
    carriage_can_enter, Recipe, BUILD_MATERIALS, BUILD_WORK, MAP_SIZE, MOUNTAIN_ROAD_WORK_FACTOR,
    RECIPES, TEARDOWN_MATERIALS_RETURNED, TEARDOWN_WORK_SHARE, TRAINING_GROUND_MAX_TRAINEES,
    WORKPLACE_MAX_WORKERS,
};
use csp_shared::footprint::{covers, footprint_tiles, is_at, may_cover, Placed, FOOTPRINT};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, tile_index, wrap, wrap_delta, Terrain, TerrainMap,
};
use csp_shared::world::{
    Building, BuildingKind, Good, LineOrder, LinePhase, Pile, Resident, ResidentOrder,
    ResourceKind, ResourceNode, Stock, TrainingSubject, WorldState,
};

use super::balance::{build_work, carry_capacity};
use super::names::{good_name, good_of, held, kind_name, placed};
use super::residents::{can_work, good_weight, stock_weight};

/// Kinds that may share a tile with a building (`SHARES_A_TILE`): roads and carriage sites.
pub const SHARES_A_TILE: [BuildingKind; 2] = [BuildingKind::Road, BuildingKind::Carriage];

/// Kinds that keep goods (`KEEPS_GOODS`): storages, warehouses and stables.
pub const KEEPS_GOODS: [BuildingKind; 3] =
    [BuildingKind::Storage, BuildingKind::Warehouse, BuildingKind::Stable];

/// Where in `world.buildings` the building or construction site whose footprint covers (x, y)
/// stands, if one does (`buildingAt`): the first in the world's order, roads and carriage sites
/// aside.
pub fn building_index_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<usize> {
    world.buildings.iter().position(|b| {
        // Nearly all are far off: their footprint needn't be worked out (T89.6).
        may_cover(b.x as i32, b.y as i32, x, y, size)
            && covers(placed(b), x, y, size)
            && !SHARES_A_TILE.contains(&b.kind)
    })
}

/// The building or construction site whose footprint covers (x, y) (`buildingAt`).
pub fn building_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    building_index_at(world, x, y, size).map(|i| &world.buildings[i])
}

/// The tiles with a finished road (`roadTiles`), as tile indices.
pub fn road_tiles(world: &WorldState, size: i32) -> HashSet<usize> {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Road && b.site.is_none())
        .map(|b| tile_index(size, b.x as i32, b.y as i32))
        .collect()
}

/// The good a recipe makes (`recipeGood`): its first output.
pub fn recipe_good(recipe: &Recipe) -> &'static str {
    recipe.output.0[0].0
}

/// The recipe a worker follows at a workplace that processes goods (`recipeFor`): the one that
/// makes `makes`, or with none the workplace's only recipe.
pub fn recipe_for(kind: BuildingKind, makes: Option<&str>) -> Option<&'static Recipe> {
    let recipes = RECIPES.get(kind_name(kind)).unwrap_or(&[]);
    match makes {
        None => (recipes.len() == 1).then(|| &recipes[0]),
        Some(good) => recipes.iter().find(|r| recipe_good(r) == good),
    }
}

// The rest of `packages/shared/src/building.ts` (T86.6): where buildings go, construction sites'
// materials and work, workplaces and their workers, training grounds, tearing down, lines.

/// Why a resident carrying a child can't take a working order (`CARRYING_A_CHILD`).
pub const CARRYING_A_CHILD: &str = "carrying a child";

/// Kinds of building that can be built so far (`BUILDABLE`).
pub const BUILDABLE: [BuildingKind; 16] = [
    BuildingKind::LumberCamp,
    BuildingKind::Quarry,
    BuildingKind::Mine,
    BuildingKind::Stable,
    BuildingKind::Farm,
    BuildingKind::House,
    BuildingKind::Smelter,
    BuildingKind::Mint,
    BuildingKind::Smithy,
    BuildingKind::TownHall,
    BuildingKind::Storage,
    BuildingKind::TrainingGround,
    BuildingKind::Wall,
    BuildingKind::Gate,
    BuildingKind::Road,
    BuildingKind::Carriage,
];

/// Workplaces that turn goods into other goods (`PROCESSING`, the keys of `RECIPES`).
pub const PROCESSING: [BuildingKind; 3] =
    [BuildingKind::Smelter, BuildingKind::Mint, BuildingKind::Smithy];

/// Kinds that go on passable land but Mountain, off any resource node (`OFF_NODES`).
pub const OFF_NODES: [BuildingKind; 9] = [
    BuildingKind::Smelter,
    BuildingKind::Mint,
    BuildingKind::Smithy,
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Wall,
    BuildingKind::Gate,
    BuildingKind::TrainingGround,
];

/// Kinds that go wholly on Plains, off any resource node (`ON_PLAINS`): stables and farms.
pub const ON_PLAINS: [BuildingKind; 2] = [BuildingKind::Stable, BuildingKind::Farm];

/// Kinds that go only in a city's area, every tile of their footprint (`IN_CITY_AREA`).
pub const IN_CITY_AREA: [BuildingKind; 1] = [BuildingKind::House];

/// What a build menu offers off any resource node, in its order (`OFF_NODE_BUILDS`).
pub const OFF_NODE_BUILDS: [BuildingKind; 11] = [
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Wall,
    BuildingKind::Gate,
    BuildingKind::TrainingGround,
    BuildingKind::Stable,
    BuildingKind::Farm,
    BuildingKind::Smelter,
    BuildingKind::Mint,
    BuildingKind::Smithy,
];

/// The workplace that goes on each kind of resource node (`NODE_WORKPLACE`).
pub fn node_workplace(kind: ResourceKind) -> BuildingKind {
    match kind {
        ResourceKind::Forest => BuildingKind::LumberCamp,
        ResourceKind::Stone => BuildingKind::Quarry,
        ResourceKind::IronOre | ResourceKind::GoldOre => BuildingKind::Mine,
    }
}

/// The good each kind of node yields once worked (`NODE_GOOD`).
pub fn node_good(kind: ResourceKind) -> Good {
    match kind {
        ResourceKind::Forest => Good::Wood,
        ResourceKind::Stone => Good::Stone,
        ResourceKind::IronOre => Good::IronOre,
        ResourceKind::GoldOre => Good::GoldOre,
    }
}

/// What a build menu offers a resident on a tile (`buildMenu`).
pub fn build_menu(node: Option<ResourceKind>) -> Vec<BuildingKind> {
    match node {
        Some(kind) => vec![node_workplace(kind)],
        None => OFF_NODE_BUILDS.to_vec(),
    }
}

/// Whether a workplace has more than one recipe, so its workers say what they make (`hasChoice`).
pub fn has_choice(kind: BuildingKind) -> bool {
    RECIPES.get(kind_name(kind)).map_or(0, <[Recipe]>::len) > 1
}

/// Most workers a kind of workplace takes (`MAX_WORKERS`), for the kinds residents can work.
pub fn max_workers(kind: BuildingKind) -> Option<f64> {
    WORKPLACE_MAX_WORKERS.get(kind_name(kind))
}

/// Whether a realm can keep Workplace settings for the building (`takesWorkSettings`).
pub fn takes_work_settings(b: &Building) -> bool {
    max_workers(b.kind).is_some()
}

/// Where goods lying on (x, y) are kept (`pileTile`): a building's north-west tile on its
/// footprint, elsewhere the tile itself.
pub fn pile_tile(world: &WorldState, x: i32, y: i32, size: i32) -> (i32, i32) {
    match building_at(world, x, y, size) {
        Some(b) => (b.x as i32, b.y as i32),
        None => (x, y),
    }
}

/// Where in `world.piles` a building's pile is (`buildingPile`), if goods lie on its footprint.
pub fn building_pile_index(world: &WorldState, b: &Building) -> Option<usize> {
    world.piles.iter().position(|p| p.x == b.x && p.y == b.y)
}

/// A building's pile (`buildingPile`).
pub fn building_pile<'w>(world: &'w WorldState, b: &Building) -> Option<&'w Pile> {
    building_pile_index(world, b).map(|i| &world.piles[i])
}

fn first_of_kind_at(world: &WorldState, x: i32, y: i32, kind: BuildingKind) -> Option<usize> {
    world.buildings.iter().position(|b| b.x as i32 == x && b.y as i32 == y && b.kind == kind)
}

/// Where in `world.buildings` the road or road site on a tile is (`roadAt`).
pub fn road_index_at(world: &WorldState, x: i32, y: i32) -> Option<usize> {
    first_of_kind_at(world, x, y, BuildingKind::Road)
}

/// The road or road construction site on a tile (`roadAt`).
pub fn road_at(world: &WorldState, x: i32, y: i32) -> Option<&Building> {
    road_index_at(world, x, y).map(|i| &world.buildings[i])
}

/// The carriage site on a tile (`carriageSiteAt`).
pub fn carriage_site_at(world: &WorldState, x: i32, y: i32) -> Option<&Building> {
    first_of_kind_at(world, x, y, BuildingKind::Carriage).map(|i| &world.buildings[i])
}

/// Where in `world.buildings` what of `kind` stands on a tile is (`constructionAt`): its road
/// for a road, its carriage site for a carriage, else its building (on the whole map).
pub fn construction_index_at(
    world: &WorldState,
    x: i32,
    y: i32,
    kind: BuildingKind,
) -> Option<usize> {
    match kind {
        BuildingKind::Road => road_index_at(world, x, y),
        BuildingKind::Carriage => first_of_kind_at(world, x, y, BuildingKind::Carriage),
        _ => building_index_at(world, x, y, MAP_SIZE),
    }
}

/// What of `kind` stands on a tile, finished or not (`constructionAt`).
pub fn construction_at(
    world: &WorldState,
    x: i32,
    y: i32,
    kind: BuildingKind,
) -> Option<&Building> {
    construction_index_at(world, x, y, kind).map(|i| &world.buildings[i])
}

/// The finished stable a carriage site on (x, y) is built at (`stableFor`).
pub fn stable_for(world: &WorldState, x: i32, y: i32, size: i32) -> Option<&Building> {
    let finished_stable = |b: &&Building| b.kind == BuildingKind::Stable && b.site.is_none();
    if let Some(here) = building_at(world, x, y, size).filter(finished_stable) {
        return Some(here);
    }
    for dy in -1..=1 {
        for dx in -1..=1 {
            let b = building_at(world, wrap(x + dx, size), wrap(y + dy, size), size);
            if let Some(b) = b.filter(finished_stable) {
                return Some(b);
            }
        }
    }
    None
}

/// Whether a carriage, or a rider, can go onto (x, y) (`carriageCanGoTo`).
pub fn carriage_can_go_to(world: &WorldState, map: &TerrainMap, x: i32, y: i32) -> bool {
    let road = road_at(world, x, y);
    let under = match road {
        Some(r) if r.site.is_none() => Terrain::Road as u8,
        _ => terrain_at(map, x, y),
    };
    carriage_can_enter(under)
}

/// The materials a kind of building takes (`BUILD_MATERIALS[kind] ?? {}`), in the table's order.
pub fn build_materials(kind: BuildingKind) -> Stock {
    BUILD_MATERIALS
        .get(kind_name(kind))
        .map(|t| t.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))).collect())
        .unwrap_or_default()
}

/// Work a kind of building takes (`BUILD_WORK[kind] ?? 0`).
pub fn build_work_of(kind: BuildingKind) -> f64 {
    BUILD_WORK.get(kind_name(kind)).unwrap_or(0.0)
}

/// Materials a construction site still needs (`materialsNeeded`).
pub fn materials_needed(site: &Building) -> Stock {
    let mut out = Stock::new();
    for (good, units) in build_materials(site.kind) {
        let left = units - site.site.as_ref().map_or(0.0, |s| held(&s.delivered, good));
        if left > 0.0 {
            out.insert(good, left);
        }
    }
    out
}

/// How many times its `BUILD_WORK` a building of `kind` over `under` takes (`workFactor`).
pub fn work_factor(kind: BuildingKind, under: Option<u8>) -> f64 {
    if kind == BuildingKind::Road && under == Some(Terrain::Mountain as u8) {
        MOUNTAIN_ROAD_WORK_FACTOR
    } else {
        1.0
    }
}

/// Work a building of `kind` takes over `under` (`buildingWork`): what a Player is shown.
pub fn building_work(kind: BuildingKind, under: Option<u8>) -> f64 {
    build_work_of(kind) * work_factor(kind, under)
}

/// How much `work` of a resident counts on a building of `kind` over `under` (`siteWorkOf`).
pub fn site_work_of(work: f64, kind: BuildingKind, under: Option<u8>) -> f64 {
    work / work_factor(kind, under)
}

/// Work a construction site still needs (`workNeeded`).
pub fn work_needed(site: &Building) -> f64 {
    0f64.max(build_work_of(site.kind) - site.site.as_ref().map_or(0.0, |s| s.work))
}

/// The terrain of tiles as far as it is known (`TerrainLookup`), for checking where buildings go:
/// the whole map on the server, the explored chunks on a client.
pub trait TerrainLookup {
    /// The map's size.
    fn size(&self) -> i32;
    /// The terrain byte at (x, y).
    fn at(&self, x: i32, y: i32) -> u8;
}

impl TerrainLookup for TerrainMap {
    fn size(&self) -> i32 {
        self.size
    }
    fn at(&self, x: i32, y: i32) -> u8 {
        terrain_at(self, x, y)
    }
}

/// Why a building of this kind can't be laid out with the north-west tile of its footprint on
/// (x, y) (`buildProblem`), or `None` if it can. Without `terrain` the terrain rules are not
/// checked.
pub fn build_problem(
    world: &WorldState,
    x: i32,
    y: i32,
    kind: BuildingKind,
    terrain: Option<&dyn TerrainLookup>,
) -> Option<String> {
    if !BUILDABLE.contains(&kind) {
        return Some(format!("a {} can't be built yet", kind_name(kind)));
    }
    let at = |tx: i32, ty: i32| terrain.map(|t| t.at(tx, ty));
    if kind == BuildingKind::Road {
        if at(x, y).is_some_and(|t| !is_passable_terrain(t)) {
            return Some("a road goes on passable land".into());
        }
        if road_at(world, x, y).is_some() {
            return Some("there is already a road on this tile".into());
        }
        return None;
    }
    let size = terrain.map_or(MAP_SIZE, |t| t.size());
    if kind == BuildingKind::Carriage {
        if at(x, y).is_some_and(|t| !carriage_can_enter(t)) {
            return Some("a carriage can’t stand on this land".into());
        }
        if world.nodes.iter().any(|n| n.x as i32 == x && n.y as i32 == y) {
            return Some("a carriage goes off any resource node".into());
        }
        if stable_for(world, x, y, size).is_none() {
            return Some("a carriage is built at a finished stable".into());
        }
        if building_at(world, x, y, size).is_some_and(|h| h.kind != BuildingKind::Stable) {
            return Some("there is already a building there".into());
        }
        if carriage_site_at(world, x, y).is_some() {
            return Some("there is already a carriage site on this tile".into());
        }
        return None;
    }
    let shape = Placed { kind: kind_name(kind), x, y };
    let tiles = footprint_tiles(shape, size);
    let nodes: Vec<_> =
        world.nodes.iter().filter(|n| covers(shape, n.x as i32, n.y as i32, size)).collect();
    let all = |ok: &dyn Fn(u8) -> bool| {
        terrain.is_none_or(|t| tiles.iter().all(|&(tx, ty)| ok(t.at(tx, ty))))
    };
    let name = kind_name(kind);
    if !all(&is_passable_terrain) {
        return Some(format!("a {name} goes on passable land"));
    }
    if ON_PLAINS.contains(&kind) {
        if !nodes.is_empty() || !all(&|t| t == Terrain::Plains as u8) {
            return Some(format!("a {name} goes wholly on Plains, off any resource node"));
        }
    } else if OFF_NODES.contains(&kind) {
        if !nodes.is_empty() || !all(&|t| t != Terrain::Mountain as u8) {
            return Some(format!("a {name} goes off any resource node, and not on Mountain"));
        }
        if IN_CITY_AREA.contains(&kind)
            && !tiles.iter().all(|&(tx, ty)| {
                !super::city_area::cities_at(world, f64::from(tx), f64::from(ty), size).is_empty()
            })
        {
            return Some(format!("a {name} goes in a city’s area"));
        }
    } else if nodes.len() != 1 || node_workplace(nodes[0].kind) != kind {
        return Some(format!("a {name} goes with one tile on a fitting resource node"));
    }
    if tiles.iter().any(|&(tx, ty)| building_at(world, tx, ty, size).is_some()) {
        return Some("there is already a building there".into());
    }
    None
}

/// The north-west tiles a footprint of `kind` may have so that it covers (x, y), the tile itself
/// first (`cornersCovering`).
pub fn corners_covering(kind: BuildingKind, x: i32, y: i32, size: i32) -> Vec<(i32, i32)> {
    let side = FOOTPRINT.get(kind_name(kind)).unwrap_or(1);
    let mut out = Vec::new();
    for dy in 0..side {
        for dx in 0..side {
            out.push((wrap(x - dx, size), wrap(y - dy, size)));
        }
    }
    out
}

/// Why resident `r` can't build `building` with its north-west tile `at` once they stand there
/// (`buildAtProblem`), or `None` if they can. `building` is the order's input, which may name no
/// kind at all.
pub fn build_at_problem(
    world: &WorldState,
    r: &Resident,
    building: Option<BuildingKind>,
    at: (i32, i32),
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t build".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let Some(kind) = building.filter(|k| BUILDABLE.contains(k)) else {
        return Some("that can’t be built".into());
    };
    if construction_at(world, at.0, at.1, kind).is_some_and(|h| h.site.is_some() && h.kind == kind)
    {
        return None;
    }
    build_problem(world, at.0, at.1, kind, terrain.map(|t| t as &dyn TerrainLookup))
}

/// Where a node's workplace can be laid out (`nodeCorner`): the node's own tile first.
pub fn node_corner(
    world: &WorldState,
    terrain: &dyn TerrainLookup,
    node: &ResourceNode,
) -> Option<(i32, i32)> {
    let kind = node_workplace(node.kind);
    corners_covering(kind, node.x as i32, node.y as i32, terrain.size())
        .into_iter()
        .find(|&(x, y)| build_problem(world, x, y, kind, Some(terrain)).is_none())
}

/// The good a workplace makes (`workplaceGood`).
pub fn workplace_good(
    world: &WorldState,
    workplace: &Building,
    makes: Option<Good>,
) -> Option<Good> {
    if workplace.kind == BuildingKind::Farm {
        return Some(Good::Food);
    }
    max_workers(workplace.kind)?;
    if RECIPES.get(kind_name(workplace.kind)).is_some() {
        let recipe = recipe_for(workplace.kind, makes.map(good_name))?;
        return good_of(recipe_good(recipe));
    }
    world
        .nodes
        .iter()
        .find(|n| covers(placed(workplace), n.x as i32, n.y as i32, MAP_SIZE))
        .map(|n| node_good(n.kind))
}

/// The goods a recipe's batch uses up, in its order.
pub fn recipe_input(recipe: &Recipe) -> Vec<(Good, f64)> {
    recipe.input.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))).collect()
}

/// The goods a recipe's batch makes, in its order.
pub fn recipe_output(recipe: &Recipe) -> Vec<(Good, f64)> {
    recipe.output.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))).collect()
}

/// Whether a resident works a workplace: holds a work-at order for it and stands at it.
fn works(r: &Resident, workplace: &Building) -> bool {
    matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == workplace.id)
        && is_at((r.x as i32, r.y as i32), placed(workplace), MAP_SIZE)
}

/// The residents working a workplace (`workersOf`), in the world's order.
pub fn workers_of<'w>(world: &'w WorldState, workplace: &Building) -> Vec<&'w Resident> {
    world.residents.iter().filter(|r| works(r, workplace)).collect()
}

/// Where in `world.residents` the workers of a workplace are (`workersOf`).
pub fn worker_indices(world: &WorldState, workplace: &Building) -> Vec<usize> {
    (0..world.residents.len()).filter(|&i| works(&world.residents[i], workplace)).collect()
}

/// The goods a processing workplace can use up for its next batches (`inputAt`), in the order
/// its recipes name them.
pub fn input_at(world: &WorldState, workplace: &Building) -> Stock {
    let mut out = Stock::new();
    let pile = building_pile(world, workplace);
    let mut goods: Vec<Good> = Vec::new();
    for recipe in RECIPES.get(kind_name(workplace.kind)).unwrap_or(&[]) {
        for (g, _) in recipe_input(recipe) {
            if !goods.contains(&g) {
                goods.push(g);
            }
        }
    }
    let workers = workers_of(world, workplace);
    for good in goods {
        let carried: f64 = workers.iter().map(|w| held(&w.carried, good)).sum();
        let units = carried + pile.map_or(0.0, |p| held(&p.goods, good));
        if units > 0.0 {
            out.insert(good, units);
        }
    }
    out
}

/// Whether a workplace has the input for one more batch of `recipe` (`hasInput`).
pub fn has_input(world: &WorldState, workplace: &Building, recipe: &Recipe) -> bool {
    let at = input_at(world, workplace);
    recipe_input(recipe).iter().all(|&(g, n)| held(&at, g) >= n)
}

/// The input a resident working a processing workplace fetches for it (`inputToFetch`).
pub fn input_to_fetch(
    world: &WorldState,
    workplace: &Building,
    recipe: &Recipe,
    resident: &Resident,
) -> Stock {
    let at = input_at(world, workplace);
    let short: Vec<(Good, f64)> =
        recipe_input(recipe).into_iter().filter(|&(g, n)| held(&at, g) < n).collect();
    let room = carry_capacity(resident, world.tick as f64) - stock_weight(&resident.carried);
    let batch: f64 = short.iter().map(|&(g, n)| n * good_weight(g)).sum();
    let batches = if batch > 0.0 { (room / batch + 1e-9).floor() } else { 0.0 };
    if batches < 1.0 {
        return Stock::new();
    }
    short.into_iter().map(|(g, n)| (g, n * batches)).collect()
}

/// Who teaches at a training ground (`teacherAt`).
pub fn teacher_at<'w>(
    ground: &Building,
    residents: &'w [Resident],
    size: i32,
) -> Option<&'w Resident> {
    residents.iter().find(|r| {
        matches!(&r.order, Some(ResidentOrder::Teach(o)) if o.building_id == ground.id)
            && is_at((r.x as i32, r.y as i32), placed(ground), size)
    })
}

/// A training subject's TypeScript name, capitalised (`capitalised`).
fn capitalised(subject: TrainingSubject) -> String {
    let name = serde_json::to_value(subject).ok();
    let name = name.as_ref().and_then(|v| v.as_str()).unwrap_or_default();
    let mut chars = name.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Why a resident can't start teaching `subject` at the building on their tile (`teachProblem`).
/// `subject` is the order's input, which may name no subject at all.
pub fn teach_problem(
    world: &WorldState,
    resident: &Resident,
    subject: Option<TrainingSubject>,
) -> Option<String> {
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t teach".into());
    }
    let Some(subject) = subject else {
        return Some("teach a stat or a skill".into());
    };
    let here = building_at(world, resident.x as i32, resident.y as i32, MAP_SIZE);
    let Some(here) = here.filter(|h| h.kind == BuildingKind::TrainingGround) else {
        return Some("there is no training ground here".into());
    };
    if here.site.is_some() {
        return Some("it is still a construction site".into());
    }
    if let Some(ResidentOrder::Teach(o)) = &resident.order {
        if o.building_id == here.id && o.subject == subject {
            return Some("already teaching here".into());
        }
    }
    if let Some(teacher) = teacher_at(here, &world.residents, MAP_SIZE) {
        if teacher.id != resident.id {
            let what = match &teacher.order {
                Some(ResidentOrder::Teach(o)) => o.subject,
                _ => subject,
            };
            return Some(format!("{} teaches {} here", teacher.name, capitalised(what)));
        }
    }
    None
}

/// Who trains at a training ground (`traineesOf`).
pub fn trainees_of<'w>(
    ground: &Building,
    residents: &'w [Resident],
    size: i32,
) -> Vec<&'w Resident> {
    residents
        .iter()
        .filter(|r| {
            matches!(&r.order, Some(ResidentOrder::Train(o)) if o.building_id == ground.id)
                && is_at((r.x as i32, r.y as i32), placed(ground), size)
        })
        .collect()
}

/// Why a resident can't start training at the building on their tile (`trainProblem`).
pub fn train_problem(world: &WorldState, resident: &Resident) -> Option<String> {
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t train".into());
    }
    let here = building_at(world, resident.x as i32, resident.y as i32, MAP_SIZE);
    let Some(here) = here.filter(|h| h.kind == BuildingKind::TrainingGround) else {
        return Some("there is no training ground here".into());
    };
    if here.site.is_some() {
        return Some("it is still a construction site".into());
    }
    if let Some(ResidentOrder::Train(o)) = &resident.order {
        if o.building_id == here.id {
            return Some("already training here".into());
        }
    }
    if trainees_of(here, &world.residents, MAP_SIZE).len() as f64 >= TRAINING_GROUND_MAX_TRAINEES {
        return Some(format!(
            "the training ground has room for {TRAINING_GROUND_MAX_TRAINEES} trainees"
        ));
    }
    None
}

/// The realms holding a workplace (`holdersOf`): those whose residents work it, sorted.
pub fn holders_of(world: &WorldState, workplace: &Building) -> Vec<String> {
    let mut realms: Vec<String> =
        workers_of(world, workplace).into_iter().filter_map(|r| r.owner.clone()).collect();
    realms.sort();
    realms.dedup();
    realms
}

/// Why a resident can't start working the building on their tile (`workProblem`).
pub fn work_problem(
    world: &WorldState,
    resident: &Resident,
    makes: Option<Good>,
) -> Option<String> {
    let here = building_at(world, resident.x as i32, resident.y as i32, MAP_SIZE);
    let (Some(here), Some(max)) = (here, here.and_then(|h| max_workers(h.kind))) else {
        return Some("there is no workplace to work here".into());
    };
    let name = kind_name(here.kind);
    if has_choice(here.kind) {
        let Some(makes) = makes else {
            return Some(format!("say what to make at the {name}"));
        };
        if recipe_for(here.kind, Some(good_name(makes))).is_none() {
            return Some(format!("a {name} can't make {}", good_name(makes)));
        }
    } else if makes.is_some() {
        return Some(format!("nothing to choose at a {name}"));
    }
    if workplace_good(world, here, makes).is_none() {
        return Some("there is no workplace to work here".into());
    }
    if here.site.is_some() {
        return Some("it is still a construction site".into());
    }
    if let Some(ResidentOrder::WorkAt(o)) = &resident.order {
        if o.building_id == here.id {
            return (o.makes == makes).then(|| "already working here".into());
        }
    }
    if workers_of(world, here).len() as f64 >= max {
        return Some(format!("it already has {max} workers"));
    }
    None
}

/// Work it takes to tear down a building or construction site (`teardownWork`).
pub fn teardown_work(b: &Building) -> f64 {
    let built = b.site.as_ref().map_or_else(|| build_work_of(b.kind), |s| s.work);
    built * TEARDOWN_WORK_SHARE
}

/// Work still needed to tear it down (`teardownLeft`).
pub fn teardown_left(b: &Building) -> f64 {
    0f64.max(teardown_work(b) - b.teardown.unwrap_or(0.0))
}

/// Whether an order is one along a line (`isLineOrder`), and the line if so.
pub fn line_order(o: Option<&ResidentOrder>) -> Option<&LineOrder> {
    match o {
        Some(ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l)) => Some(l),
        _ => None,
    }
}

/// The line of a line order, to change (`isLineOrder`).
pub fn line_order_mut(o: Option<&mut ResidentOrder>) -> Option<&mut LineOrder> {
    match o {
        Some(ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l)) => Some(l),
        _ => None,
    }
}

/// What a line order builds on each of its tiles (`LINE_BUILDING`): `None` for any other order.
pub fn line_building(o: &ResidentOrder) -> Option<BuildingKind> {
    match o {
        ResidentOrder::RoadLine(_) => Some(BuildingKind::Road),
        ResidentOrder::WallLine(_) => Some(BuildingKind::Wall),
        _ => None,
    }
}

/// The residents working on a building or construction site now, standing on it (`workingOn`).
pub fn working_on<'w>(
    b: &Building,
    residents: &'w [Resident],
    tearing_down: bool,
    size: i32,
) -> Vec<&'w Resident> {
    residents
        .iter()
        .filter(|r| {
            let on = match &r.order {
                Some(ResidentOrder::TearDown(o)) => tearing_down && o.building_id == b.id,
                Some(ResidentOrder::Build(o)) => {
                    !tearing_down && o.site_id.as_deref() == Some(b.id.as_str())
                }
                Some(ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o)) => {
                    !tearing_down
                        && o.phase == LinePhase::Building
                        && o.site_id.as_deref() == Some(b.id.as_str())
                }
                _ => false,
            };
            on && is_at((r.x as i32, r.y as i32), placed(b), size)
        })
        .collect()
}

/// Work a building or site gets a tick from these residents (`workPace`).
pub fn work_pace(b: &Building, workers: &[&Resident], tick: f64, under: Option<u8>) -> f64 {
    workers.iter().map(|r| site_work_of(build_work(r, tick), b.kind, under)).sum()
}

/// Goods left on the tile once it is torn down (`teardownReturns`).
pub fn teardown_returns(b: &Building) -> Stock {
    if let Some(site) = &b.site {
        return site.delivered.clone();
    }
    let mut out = Stock::new();
    for (good, units) in build_materials(b.kind) {
        let back = (units * TEARDOWN_MATERIALS_RETURNED).floor();
        if back > 0.0 {
            out.insert(good, back);
        }
    }
    out
}

/// Whether tearing down `b` would leave a carriage or ridden horse on Mountain without a road
/// (`strandsOnMountain`).
pub fn strands_on_mountain(world: &WorldState, b: &Building, terrain: &TerrainMap) -> bool {
    if b.kind != BuildingKind::Road
        || b.site.is_some()
        || terrain_at(terrain, b.x as i32, b.y as i32) != Terrain::Mountain as u8
    {
        return false;
    }
    let ridden = |id: &str| world.residents.iter().any(|r| r.riding.as_deref() == Some(id));
    world.carriages.iter().any(|k| k.x == b.x && k.y == b.y)
        || world.horses.iter().any(|h| h.x == b.x && h.y == b.y && ridden(&h.id))
}

/// Why the building or site can't be torn down by a resident on (x, y) (`tearDownProblem`).
pub fn tear_down_problem(
    world: &WorldState,
    x: i32,
    y: i32,
    building_id: &str,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let b = world.buildings.iter().find(|c| c.id == building_id);
    let Some(b) = b.filter(|b| covers(placed(b), x, y, MAP_SIZE)) else {
        return Some("the resident is not at that building".into());
    };
    if !BUILDABLE.contains(&b.kind) {
        return Some(format!("a {} can’t be torn down yet", kind_name(b.kind)));
    }
    if terrain.is_some_and(|t| strands_on_mountain(world, b, t)) {
        return Some("a carriage or rider on this mountain road would be stranded".into());
    }
    None
}

/// The tiles of a road or wall along a straight line from `from` to `to`, both ends included,
/// the short way round (`roadLine`).
pub fn road_line(from: (i32, i32), to: (i32, i32), size: i32) -> Vec<(i32, i32)> {
    let dx = wrap_delta(from.0, to.0, size);
    let dy = wrap_delta(from.1, to.1, size);
    let steps = dx.abs().max(dy.abs());
    // Step i goes i/steps of the way along `d`, rounded to the nearest tile, halves up.
    let along = |i: i32, d: i32| d.signum() * ((2 * i * d.abs() + steps) / (2 * steps));
    let mut out = vec![(wrap(from.0, size), wrap(from.1, size))];
    for i in 1..=steps {
        out.push((wrap(from.0 + along(i, dx), size), wrap(from.1 + along(i, dy), size)));
    }
    out
}

/// A Build line (`BuildLine`): road or wall from `from` to `to`.
#[derive(Debug, Clone, PartialEq)]
pub struct BuildLine {
    pub building: BuildingKind,
    pub from: (i32, i32),
    pub to: (i32, i32),
}

/// A tile of a Build line still to build, with its construction site once laid out (`LineTile`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineTile {
    pub x: i32,
    pub y: i32,
    pub site_id: Option<String>,
}

/// Tile (x, y) of a line of `building` as still to build (`lineTile`).
pub fn line_tile(
    world: &WorldState,
    building: BuildingKind,
    x: i32,
    y: i32,
    terrain: Option<&dyn TerrainLookup>,
) -> Option<LineTile> {
    if let Some(here) = construction_at(world, x, y, building) {
        if here.site.is_some() && here.kind == building {
            return Some(LineTile { x, y, site_id: Some(here.id.clone()) });
        }
    }
    build_problem(world, x, y, building, terrain).is_none().then_some(LineTile {
        x,
        y,
        site_id: None,
    })
}

/// The tiles of a Build line still to build, from its start to its end (`lineToBuild`).
pub fn line_to_build(
    world: &WorldState,
    line: &BuildLine,
    terrain: Option<&TerrainMap>,
) -> Vec<LineTile> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    road_line(line.from, line.to, size)
        .into_iter()
        .filter_map(|(x, y)| {
            line_tile(world, line.building, x, y, terrain.map(|t| t as &dyn TerrainLookup))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_smithy_needs_to_be_told_what_it_makes() {
        assert!(recipe_for(BuildingKind::Smithy, None).is_none());
        let spear = recipe_for(BuildingKind::Smithy, Some("spear")).unwrap();
        assert_eq!(recipe_good(spear), "spear");
        assert_eq!(recipe_good(recipe_for(BuildingKind::Mint, None).unwrap()), "coins");
        assert!(recipe_for(BuildingKind::House, None).is_none());
    }
}
