//! Trading posts (`apps/server/src/trading-posts.ts`, `CONTEXT.md`: Trading post, Trade Org debt):
//! one per region of the map, an NPC village of the Trade Organization's with a warehouse.
//!
//! Laying a post out is `foundNpcCity` with a warehouse beside its storage, and finding its site is
//! `npcSiteFits`; both are T86.10's (`npc-cities.ts`). Until it lands, `place_trading_posts`
//! places nothing, and a world gets its posts from a save or a test.

use csp_shared::balance::TRADING_POST_REGION;
use csp_shared::footprint::{covers, footprint_tiles, Placed};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, City, ResourceKind, Stock, TradeOrgCity, WorldState,
};

use crate::goods_deps::{new_id, update_city_membership};
use crate::queries::city::town_hall_of;
use crate::queries::names::{held_in, placed};

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

/// Where a new building of `kind` goes in a city (`houseTile` of `npc-growth.ts`).
/// TODO(T86.10): `npc_growth.rs`; until then none, so a taken city keeps its Food storage.
fn house_tile(_world: &WorldState, _city_id: &str, _kind: BuildingKind) -> Option<(f64, f64)> {
    None
}

/// A city taken by the Trade Organization's army gets its warehouses (`storagesBecomeWarehouses`):
/// every finished storage becomes one with all its goods but the Food, which goes into a new
/// storage near the town hall. With no room for a new building the storage holding the most Food
/// stays one and takes all the Food.
/// The TypeScript takes the terrain for `houseTile`; here the map size, until `houseTile` lands.
pub fn storages_become_warehouses(world: &mut WorldState, city_id: &str, size: i32) {
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
        let (x, y) = house_tile(world, city_id, kind)?;
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

/// Places a trading post in every region that has none yet (`placeTradingPosts`).
/// TODO(T86.10): founding a post is `foundNpcCity`'s; until it lands this places none.
pub fn place_trading_posts(_world: &mut WorldState, _terrain: &TerrainMap) -> Vec<String> {
    Vec::new()
}
