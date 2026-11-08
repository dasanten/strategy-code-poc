//! Where goods are and how many more fit (`packages/shared/src/goods.ts`, with `freeStock` of
//! `offers.ts`, `canHandle`/`carryCapacity` of `balance.ts` and the carriage room helpers of
//! `carriages.ts`), read only.

use csp_shared::balance::{
    CARRY_BASE, CARRY_PER_STRENGTH, CHILD_GOODS, MAP_SIZE, OWN_FOOD, PASSENGER_WEIGHT,
};
use csp_shared::footprint::covers;
use csp_shared::world::{
    Building, Carriage, Good, GoodsSpot, Pile, Resident, StatName, Stock, WorldState,
};

use super::building::{building_at, KEEPS_GOODS};
use super::carriages::{carriage_capacity, passengers_of};
use super::names::{good_name, held, placed};
use super::offers::offers_at;
use super::residents::{can_work, good_weight, is_down, stat_value, stock_weight};

/// The tile whose pile is reached from (x, y) (`pileTile`): on a building's footprint its
/// north-west tile, elsewhere the tile itself.
pub fn pile_tile(world: &WorldState, x: f64, y: f64, size: i32) -> (f64, f64) {
    match building_at(world, x as i32, y as i32, size) {
        Some(b) => (b.x, b.y),
        None => (x, y),
    }
}

/// Where in `world.piles` the pile reached from a tile lies (`pileAt`).
pub fn pile_index_at(world: &WorldState, x: f64, y: f64) -> Option<usize> {
    let at = pile_tile(world, x, y, MAP_SIZE);
    world.piles.iter().position(|p| p.x == at.0 && p.y == at.1)
}

/// The pile reached from a tile (`pileAt`).
pub fn pile_at(world: &WorldState, x: f64, y: f64) -> Option<&Pile> {
    pile_index_at(world, x, y).map(|i| &world.piles[i])
}

/// Where in `world.buildings` the finished building with a storage covering a tile stands
/// (`storageAt`).
pub fn storage_index_at(world: &WorldState, x: f64, y: f64) -> Option<usize> {
    world.buildings.iter().position(|b| {
        KEEPS_GOODS.contains(&b.kind)
            && b.site.is_none()
            && covers(placed(b), x as i32, y as i32, MAP_SIZE)
    })
}

/// The finished building with a storage covering a tile (`storageAt`).
pub fn storage_at(world: &WorldState, x: f64, y: f64) -> Option<&Building> {
    storage_index_at(world, x, y).map(|i| &world.buildings[i])
}

/// Where in `world.buildings` the construction site `site_id` is, if (x, y) is on its footprint
/// (`siteAt`).
pub fn site_index_at(world: &WorldState, x: f64, y: f64, site_id: &str) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.id == site_id && b.site.is_some() && covers(placed(b), x as i32, y as i32, MAP_SIZE)
    })
}

/// The construction site `site_id` if (x, y) is on its footprint (`siteAt`).
pub fn site_at<'w>(world: &'w WorldState, x: f64, y: f64, site_id: &str) -> Option<&'w Building> {
    site_index_at(world, x, y, site_id).map(|i| &world.buildings[i])
}

/// Where in `world.residents` the resident `resident_id` is, if they lie Down on (x, y)
/// (`downOn`).
pub fn down_index_on(world: &WorldState, x: f64, y: f64, resident_id: &str) -> Option<usize> {
    let i = world.residents.iter().position(|d| d.id == resident_id)?;
    let r = &world.residents[i];
    (is_down(r.down_until) && r.x == x && r.y == y).then_some(i)
}

/// The resident `resident_id` if they lie Down on (x, y) (`downOn`).
pub fn down_on<'w>(
    world: &'w WorldState,
    x: f64,
    y: f64,
    resident_id: &str,
) -> Option<&'w Resident> {
    down_index_on(world, x, y, resident_id).map(|i| &world.residents[i])
}

/// An empty stock, for a storage that has none yet (`storage.stock ?? {}`).
pub static NO_GOODS: std::sync::LazyLock<Stock> = std::sync::LazyLock::new(Stock::new);

/// The goods at a spot reached from (x, y) (`goodsAtSpot`); `None` when the spot isn't there.
pub fn goods_at_spot<'w>(
    world: &'w WorldState,
    x: f64,
    y: f64,
    spot: &GoodsSpot,
) -> Option<&'w Stock> {
    match spot {
        GoodsSpot::Ground => pile_at(world, x, y).map(|p| &p.goods),
        GoodsSpot::Carriage { carriage_id } => world
            .carriages
            .iter()
            .find(|k| &k.id == carriage_id)
            .filter(|k| k.x == x && k.y == y)
            .map(|k| &k.load),
        GoodsSpot::Site { site_id } => {
            site_at(world, x, y, site_id).and_then(|b| b.site.as_ref()).map(|s| &s.delivered)
        }
        GoodsSpot::Resident { resident_id } => {
            down_on(world, x, y, resident_id).map(|r| &r.carried)
        }
        GoodsSpot::Storage { storage_id } => {
            let s = storage_at(world, x, y)?;
            (&s.id == storage_id).then(|| s.stock.as_ref().unwrap_or(&NO_GOODS))
        }
    }
}

/// How much a resident can carry at `tick`, in kg (`carryCapacity`).
pub fn carry_capacity(r: &Resident, tick: f64) -> f64 {
    CARRY_BASE + CARRY_PER_STRENGTH * stat_value(r, StatName::Strength, tick)
}

/// How many more whole units of a good fit in what the resident carries (`unitsThatFit`).
pub fn units_that_fit(r: &Resident, good: Good, tick: f64) -> f64 {
    let room = carry_capacity(r, tick) - stock_weight(&r.carried);
    0f64.max((room / good_weight(good) + 1e-9).floor())
}

/// Whether a resident may handle these goods (`canHandle`): grown up, or only goods a child may
/// carry (`CHILD_GOODS`).
pub fn can_handle<'a>(born_at: f64, tick: f64, goods: impl IntoIterator<Item = &'a Good>) -> bool {
    if can_work(born_at, tick) {
        return true;
    }
    goods.into_iter().all(|g| CHILD_GOODS.contains(&good_name(*g)))
}

/// How many of a carried good a resident puts away unless asked for an exact amount
/// (`putAwayUnits`): all but their own food (`own_food` units, `OWN_FOOD` by default).
pub fn put_away_units(good: Good, carried: f64, own_food: Option<f64>) -> f64 {
    if good == Good::Food {
        0f64.max(carried - own_food.unwrap_or(OWN_FOOD))
    } else {
        carried
    }
}

/// The goods its offers set aside at a storage (`setAsideAt`).
pub fn set_aside_at(world: &WorldState, storage_id: &str) -> Stock {
    let mut aside = Stock::new();
    for o in offers_at(world, storage_id) {
        *aside.entry(o.gives).or_insert(0.0) += o.times * o.gives_units;
    }
    aside
}

/// The goods of a storage that aren't set aside for its offers (`freeStock`). A copy: the
/// TypeScript returns the stock itself without offers, which no caller writes to.
pub fn free_stock(world: &WorldState, storage_id: &str, stock: Option<&Stock>) -> Stock {
    let stock = stock.cloned().unwrap_or_default();
    if world.offers.is_empty() {
        return stock;
    }
    let aside = set_aside_at(world, storage_id);
    if aside.is_empty() {
        return stock;
    }
    let mut free = stock.clone();
    for (good, n) in aside {
        let left = stock.get(&good).copied().unwrap_or(0.0) - n;
        if left > 0.0 {
            free.insert(good, left);
        } else {
            free.shift_remove(&good);
        }
    }
    free
}

/// What a carriage holds in goods, in kg (`goodsCapacity`): its capacity less its passengers.
pub fn goods_capacity(world: &WorldState, carriage: &Carriage) -> f64 {
    carriage_capacity(world, carriage)
        - passengers_of(world, &carriage.id).len() as f64 * PASSENGER_WEIGHT
}

/// How much more weight fits on a carriage, in kg (`carriageRoom`).
pub fn carriage_room(world: &WorldState, carriage: &Carriage) -> f64 {
    goods_capacity(world, carriage) - stock_weight(&carriage.load)
}

/// How many more whole units of a good fit on a carriage (`unitsThatFitCarriage`).
pub fn units_that_fit_carriage(world: &WorldState, carriage: &Carriage, good: Good) -> f64 {
    0f64.max((carriage_room(world, carriage) / good_weight(good) + 1e-9).floor())
}

/// Where a hauler at (x, y) loads and unloads (`haulStopSpot`): the storage there, else the
/// ground.
pub fn haul_stop_spot(world: &WorldState, x: f64, y: f64) -> GoodsSpot {
    match storage_at(world, x, y) {
        Some(s) => GoodsSpot::Storage { storage_id: s.id.clone() },
        None => GoodsSpot::Ground,
    }
}

/// Moves units of one good between two stocks, dropping a good that reaches 0 (`move` of
/// carrying.ts and trading.ts). Nothing for `units <= 0`.
pub fn move_goods(from: &mut Stock, to: &mut Stock, good: Good, units: f64) {
    if units <= 0.0 {
        return;
    }
    take_out(from, good, units);
    *to.entry(good).or_insert(0.0) += units;
}

/// Takes units of a good out of a stock, dropping it at 0 or below (the `from` half of `move`).
pub fn take_out(stock: &mut Stock, good: Good, units: f64) {
    let left = held(stock, good) - units;
    if left > 0.0 {
        stock.insert(good, left);
    } else {
        stock.shift_remove(&good);
    }
}

/// Materials a construction site still needs before it can become the building
/// (`materialsNeeded`), in `BUILD_MATERIALS`' order.
pub fn materials_needed(site: &Building) -> Stock {
    let mut out = Stock::new();
    let Some((_, table)) = csp_shared::balance::BUILD_MATERIALS
        .0
        .iter()
        .find(|(k, _)| *k == super::names::kind_name(site.kind))
    else {
        return out;
    };
    for (name, units) in table.0 {
        let Some(good) = super::names::good_of(name) else { continue };
        let delivered = site.site.as_ref().map_or(0.0, |s| held(&s.delivered, good));
        let left = units - delivered;
        if left > 0.0 {
            out.insert(good, left);
        }
    }
    out
}
