//! Trading posts (`apps/server/src/trading-posts.ts`, `CONTEXT.md`: Trading post, Trade Org debt):
//! one in every heartland and others across the frontier, an NPC village of the Trade Organization's with a warehouse.
//!
//! Laying a post out is `found_npc_city` with a warehouse beside its storage, and finding its site
//! is `npc_site_fits` (`npc-cities.ts`).

use csp_shared::balance::{NpcCitySize, TRADING_POST, TRADING_POST_REGION};
use csp_shared::footprint::{covers, footprint_tiles, Placed, FOOTPRINT};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, City, ResourceKind, Stock, TradeOrgCity, WorldState,
};

use crate::goods_deps::{new_id, update_city_membership};
use crate::npc_cities::{found_npc_city, npc_site_fits_among, taken_ground, SiteWorld};
use crate::placing::{node_workplace, Ground};
use crate::queries::city::town_hall_of;
use crate::queries::names::{good_of, held_in, placed};
use crate::residents::Rand;
use crate::starting_city::FARM_RING;
use crate::trade_org::nearest_free_node;

/// A part of the map one trading post serves (`Region`): its top-left tile and how far it reaches.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The map cut into a grid of regions about `TRADING_POST_REGION` wide (`regions`), row by row
/// from the top left.
pub fn regions(size: i32) -> Vec<Region> {
    let js_round = crate::queries::js_round;
    let per_side = 1f64.max(js_round(f64::from(size) / TRADING_POST_REGION));
    let width = f64::from(size) / per_side;
    let mut out = Vec::new();
    for j in 0..per_side as i32 {
        for i in 0..per_side as i32 {
            let x = js_round(f64::from(i) * width);
            let y = js_round(f64::from(j) * width);
            out.push(Region {
                x,
                y,
                width: js_round(f64::from(i + 1) * width) - x,
                height: js_round(f64::from(j + 1) * width) - y,
            });
        }
    }
    out
}

/// Whether a tile lies in a region (`inRegion`).
pub fn in_region(r: &Region, (x, y): (f64, f64)) -> bool {
    x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

/// The resource kinds in the order they win a tie for a region's most common (`KINDS`).
const KINDS: [ResourceKind; 4] =
    [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre, ResourceKind::GoldOre];

/// The kind of resource node a region has most of, or none when it has no nodes
/// (`commonResource`).
pub fn common_resource(world: &WorldState, region: &Region) -> Option<ResourceKind> {
    let count = |k: ResourceKind| {
        world.nodes.iter().filter(|n| n.kind == k && in_region(region, (n.x, n.y))).count()
    };
    let mut best: Option<ResourceKind> = None;
    for k in KINDS {
        if count(k) > best.map_or(0, count) {
            best = Some(k);
        }
    }
    best
}

/// The world's trading posts (`tradingPosts`).
pub fn trading_posts(world: &WorldState) -> Vec<&City> {
    world.cities.iter().filter(|c| c.trade_org == Some(TradeOrgCity::Post)).collect()
}

/// A city's finished storages, as indices (`npcStorages`).
fn storages_of(world: &WorldState, city_id: &str) -> Vec<usize> {
    (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            b.city_id.as_deref() == Some(city_id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        })
        .collect()
}

/// A post that comes back has a warehouse again (`restoreWarehouse`): its old warehouse turns back
/// with all it holds, on the spot `foundTradingPost` gave it, or another storage than the one its
/// people eat from; with none, a new empty one on that spot, unless something else stands there.
pub fn restore_warehouse(world: &mut WorldState, post_id: &str, size: i32) {
    let Some(post) = world.cities.iter().find(|c| c.id == post_id) else { return };
    let side = csp_shared::footprint::FOOTPRINT.get("storage").expect("a footprint");
    let spot = town_hall_of(world, post)
        .map(|h| (h.x + f64::from(side) + 2.0, h.y - f64::from(side) - 1.0));
    let storages = storages_of(world, post_id);
    let at = |i: &usize| {
        spot.is_some_and(|(x, y)| world.buildings[*i].x == x && world.buildings[*i].y == y)
    };
    let old = storages.iter().copied().find(at).or_else(|| storages.iter().skip(1).last().copied());
    if let Some(old) = old {
        world.buildings[old].kind = BuildingKind::Warehouse;
        return;
    }
    let Some((x, y)) = spot else { return };
    let tiles = footprint_tiles(Placed { kind: "warehouse", x: x as i32, y: y as i32 }, size);
    if world.buildings.iter().any(|b| tiles.iter().any(|&(tx, ty)| covers(placed(b), tx, ty, size)))
    {
        return;
    }
    let id = new_id(world, "b");
    world.buildings.push(Building {
        id,
        kind: BuildingKind::Warehouse,
        city_id: Some(post_id.to_string()),
        realm_id: None,
        x,
        y,
        stock: Some(Stock::new()),
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    });
}

/// Where a new building of `kind` goes in a city (`houseTile` of `npc-growth.ts`), by its town
/// hall; none without the terrain to lay it out on.
fn house_tile(
    world: &WorldState,
    city_id: &str,
    kind: BuildingKind,
    terrain: Option<&TerrainMap>,
) -> Option<(f64, f64)> {
    let terrain = terrain?;
    let city = world.cities.iter().find(|c| c.id == city_id)?;
    let hall = town_hall_of(world, city)?;
    crate::npc_growth::house_tile(world, city, hall, terrain, None, kind)
        .map(|(x, y)| (f64::from(x), f64::from(y)))
}

/// A city taken by the Trade Organization's army gets its warehouses (`storagesBecomeWarehouses`):
/// every finished storage becomes one with all its goods but the Food, which goes into a new
/// storage near the town hall. With no room for a new building the storage holding the most Food
/// stays one and takes all the Food.
/// Without `terrain` (a test of the conflict rules alone) there is no room for a new building.
pub fn storages_become_warehouses(
    world: &mut WorldState,
    city_id: &str,
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id) else { return };
    if town_hall_of(world, city).is_none() {
        return;
    }
    let storages = storages_of(world, city_id);
    let food: f64 = storages
        .iter()
        .map(|&i| held_in(world.buildings[i].stock.as_ref(), csp_shared::world::Good::Food))
        .sum();
    let food_of =
        |i: usize| held_in(world.buildings[i].stock.as_ref(), csp_shared::world::Good::Food);
    let most_food = storages.iter().copied().fold(None, |most: Option<usize>, b| match most {
        Some(m) if food_of(b) <= food_of(m) => Some(m),
        _ => Some(b),
    });
    for &i in &storages {
        if let Some(s) = world.buildings[i].stock.as_mut() {
            s.shift_remove(&csp_shared::world::Good::Food);
        }
    }
    let place = |world: &mut WorldState, kind: BuildingKind, stock: Stock| -> Option<usize> {
        let (x, y) = house_tile(world, city_id, kind, terrain)?;
        let id = new_id(world, "b");
        world.buildings.push(Building {
            id,
            kind,
            city_id: Some(city_id.to_string()),
            realm_id: None,
            x,
            y,
            stock: Some(stock),
            site: None,
            teardown: None,
            closed: None,
            damage: None,
            breedings: None,
        });
        Some(world.buildings.len() - 1)
    };
    let eating = if food > 0.0 {
        Stock::from([(csp_shared::world::Good::Food, food)])
    } else {
        Stock::new()
    };
    let eating_from = place(world, BuildingKind::Storage, eating);
    let kept = if eating_from.is_some() { None } else { most_food };
    if let Some(k) = kept {
        world.buildings[k]
            .stock
            .get_or_insert_with(Stock::new)
            .insert(csp_shared::world::Good::Food, food);
    }
    for &i in &storages {
        if Some(i) != kept {
            world.buildings[i].kind = BuildingKind::Warehouse;
        }
    }
    if storages.is_empty() {
        place(world, BuildingKind::Warehouse, Stock::new());
    }
    update_city_membership(world, size);
}

/// How far apart the sites tried for a post lie (`SITE_STEP`).
const SITE_STEP: usize = 3;

/// A trading post as `found_npc_city` lays out a village (`TRADING_POST`).
pub(crate) fn post_size() -> NpcCitySize {
    NpcCitySize {
        size: TRADING_POST.size,
        residents: TRADING_POST.residents,
        houses: TRADING_POST.houses,
        farms: TRADING_POST.farms,
        food: TRADING_POST.food,
    }
}

/// Picks the site for a region's trading post (`findTradingPostSite`): the one nearest the
/// region's middle where an NPC village would fit (`npc_site_fits`: open Plains, far enough from
/// every city, out of every Player's sight), wholly inside the region. None when nothing there
/// fits. `ground` is `taken_ground` when not given.
pub fn find_trading_post_site(
    world: &WorldState,
    terrain: &TerrainMap,
    region: &Region,
    ground: Option<&Ground>,
) -> Option<(i32, i32)> {
    let middle = (region.x + region.width / 2.0, region.y + region.height / 2.0);
    find_trading_post_site_where(world, terrain, region, middle, ground, true, &|_, _| true)
}

/// `find_trading_post_site` nearest `middle` (the tile a post's middle is wanted on) rather than
/// the region's, and only where `allowed` lets a post's top-left wall tile be: on the land, a
/// heartland's or frontier land clear of the starting sites and ways (`land_sites`). With `apart` false it
/// keeps no distance from other cities (`SiteWorld::players_only`).
pub fn find_trading_post_site_where(
    world: &WorldState,
    terrain: &TerrainMap,
    region: &Region,
    middle: (f64, f64),
    ground: Option<&Ground>,
    apart: bool,
    allowed: &dyn Fn(i32, i32) -> bool,
) -> Option<(i32, i32)> {
    let made;
    let ground = match ground {
        Some(g) => g,
        None => {
            made = taken_ground(world, terrain);
            &made
        }
    };
    let size = TRADING_POST.size;
    let ring = f64::from(FARM_RING);
    let mut candidates: Vec<((i32, i32), f64)> = Vec::new();
    let mut dy = ring;
    while dy <= region.height - size - ring {
        let mut dx = ring;
        while dx <= region.width - size - ring {
            let off = (region.x + dx + size / 2.0 - middle.0)
                .hypot(region.y + dy + size / 2.0 - middle.1);
            candidates.push((((region.x + dx) as i32, (region.y + dy) as i32), off));
            dx += SITE_STEP as f64;
        }
        dy += SITE_STEP as f64;
    }
    candidates.sort_by(|a, b| a.1.total_cmp(&b.1));
    let kind = post_size();
    let among = if apart { SiteWorld::new(world) } else { SiteWorld::players_only(world) };
    candidates
        .into_iter()
        .find(|&((x, y), _)| {
            allowed(x, y) && npc_site_fits_among(&among, terrain, &kind, x, y, ground, true)
        })
        .map(|(at, _)| at)
}

/// Lays out a trading post with its top-left wall tile at (x, y) (`foundTradingPost`,
/// `CONTEXT.md`: Trading post): an NPC village (`found_npc_city`) of the Trade Organization's, with
/// a warehouse east of its storage and a workplace on the nearest free node of `resource`, the
/// region's most common. Returns the post's id.
pub fn found_trading_post(
    world: &mut WorldState,
    terrain: &TerrainMap,
    x: i32,
    y: i32,
    resource: Option<ResourceKind>,
    rand: &mut Rand,
) -> String {
    let city_id =
        found_npc_city(world, terrain, &post_size(), x, y, rand, Some(TradeOrgCity::Post));
    let mid = TRADING_POST.size as i32 / 2;
    let mut stock = Stock::new();
    if let Some(coins) = good_of("coins") {
        stock.insert(coins, TRADING_POST.coins);
    }
    stock.extend(TRADING_POST.goods.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))));
    let id = new_id(world, "b");
    world.buildings.push(Building {
        id,
        kind: BuildingKind::Warehouse,
        city_id: Some(city_id.clone()),
        realm_id: None,
        x: f64::from(x + mid + FOOTPRINT.get("storage").expect("a footprint") + 1),
        y: f64::from(y + mid),
        stock: Some(stock),
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    });
    let hall = world
        .cities
        .iter()
        .find(|c| c.id == city_id)
        .and_then(|c| town_hall_of(world, c))
        .map(|h| (h.x as i32, h.y as i32))
        .expect("a founded post has its town hall");
    let spot = resource.and_then(|r| nearest_free_node(world, terrain, r, hall.0, hall.1));
    let mut workplaces = Vec::new();
    if let (Some(resource), Some((sx, sy))) = (resource, spot) {
        let id = new_id(world, "b");
        world.buildings.push(Building {
            id: id.clone(),
            kind: node_workplace(resource),
            city_id: None,
            realm_id: None,
            x: f64::from(sx),
            y: f64::from(sy),
            stock: None,
            site: None,
            teardown: None,
            closed: None,
            damage: None,
            breedings: None,
        });
        workplaces.push(id);
    }
    if let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) {
        city.workplace_ids = Some(workplaces);
    }
    update_city_membership(world, terrain.size);
    city_id
}

/// Places the trading posts that are missing (`placeTradingPosts`): one near the middle of every
/// heartland, then one on frontier land in every square of the grid (`regions`) that has none yet,
/// skipping where there is no room (`land_sites::place_trading_posts_on`). The same world always
/// gets the same posts. Returns their ids.
pub fn place_trading_posts(world: &mut WorldState, terrain: &TerrainMap) -> Vec<String> {
    let land = crate::land_sites::LandSites::of(world, terrain);
    crate::land_sites::place_trading_posts_on(world, terrain, &land)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod chain_tests;
#[cfg(test)]
mod supplied_tests;
