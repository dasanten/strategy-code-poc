//! The chain an NPC city's reserve drives (`apps/server/src/npc-chain.ts`, `CONTEXT.md`: NPC city,
//! NPC reserve): which goods it is short of, most first, and which workplace makes each. Its
//! planning pass sends spare hands to the workplace of the good shortest (`plan_city`) and picks
//! the next workplace to build from the same list (`next_project`). The Trade Organization's
//! cities run the same chain for their warehouses, whose stock floor is their reserve. Queries
//! only: nothing moves.

use std::collections::HashSet;

use csp_shared::balance::{MAP_SIZE, NPC_SURPLUS_CAP};
use csp_shared::world::{Building, BuildingKind, City, CityProject, Good, Stock, WorldState};

use crate::npc_coins::earns_coins;
use crate::queries::building::{
    build_materials, building_at, materials_needed, max_workers, recipe_for, recipe_input,
    workplace_good,
};
use crate::queries::names::{good_name, held, held_in};
use crate::queries::npc_trade::{npc_city_stock, npc_needs_scale, npc_reserve, NPC_SMITHY_WEAPON};
use crate::queries::warehouse::{stock_floor, warehouse_keeps};

/// The workplace that processes goods into one the chain wants, by that good (`PROCESSED_BY`).
pub fn processed_by(good: Good) -> Option<BuildingKind> {
    match good {
        Good::Iron => Some(BuildingKind::Smelter),
        Good::Coins => Some(BuildingKind::Mint),
        g if g == NPC_SMITHY_WEAPON => Some(BuildingKind::Smithy),
        _ => None,
    }
}

/// What one batch at the workplace that makes `good` uses up, when a workplace processes it
/// (`chainInput`): 2 Iron ore for Iron, Iron and Wood for a spear. `None` for a good dug, cut or
/// farmed.
pub fn chain_input(good: Good) -> Option<Stock> {
    let kind = processed_by(good)?;
    recipe_for(kind, Some(good_name(good))).map(|r| recipe_input(r).into_iter().collect())
}

/// What a workplace makes for an NPC city (`chainGood`): its good (`workplace_good`); a smithy,
/// its weapon.
pub fn chain_good(world: &WorldState, b: &Building) -> Option<Good> {
    if b.kind == BuildingKind::Smithy {
        Some(NPC_SMITHY_WEAPON)
    } else {
        workplace_good(world, b, None)
    }
}

/// Where in `world.buildings` the city's own workplaces stand, finished or begun
/// (`ownWorkplaces`): its farms (and other buildings of its by `cityId`) and those in its
/// `workplaceIds`.
pub fn own_workplace_indices(world: &WorldState, city: &City) -> Vec<usize> {
    let own: HashSet<&String> = city.workplace_ids.iter().flatten().collect();
    world
        .buildings
        .iter()
        .enumerate()
        .filter(|(_, b)| {
            (b.city_id.as_ref() == Some(&city.id) || own.contains(&b.id))
                && max_workers(b.kind).is_some()
        })
        .map(|(i, _)| i)
        .collect()
}

/// The city's own workplaces, finished or begun (`ownWorkplaces`).
pub fn own_workplaces<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Building> {
    own_workplace_indices(world, city).into_iter().map(|i| &world.buildings[i]).collect()
}

/// Whether one of the city's workplaces, finished or not, makes a good (`makes`).
pub fn makes(world: &WorldState, city: &City, good: Good) -> bool {
    own_workplaces(world, city).iter().any(|b| chain_good(world, b) == Some(good))
}

/// Whether a stock holds the goods of one batch (`holdsBatch`).
pub fn holds_batch(stock: Option<&Stock>, input: &Stock) -> bool {
    input.iter().all(|(g, n)| held_in(stock, *g) >= *n)
}

/// A good a city is short of, and how much of what it wants of it it lacks, 0 to 1 (`Shortage`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shortage {
    pub good: Good,
    pub share: f64,
}

/// What an NPC city lacks of its reserve, the shortest first (`reserveLacks`): what its storages
/// lack of it (`npc_reserve`; a Trade Org city, what its warehouses lack of their stock floor,
/// `trade_org_reserve`), and of the materials its `project` still needs beyond that, as a share of
/// what it wants of each. Ties go by the reserve's order.
pub fn reserve_lacks(
    world: &WorldState,
    city: &City,
    project: Option<&CityProject>,
) -> Vec<Shortage> {
    let mut want = if city.trade_org.is_some() {
        trade_org_reserve(world, city)
    } else {
        npc_reserve(world, city)
    };
    for (good, n) in project_needs(world, project) {
        *want.entry(good).or_insert(0.0) += n;
    }
    let stock = if city.trade_org.is_some() {
        warehouse_stock(world, city)
    } else {
        npc_city_stock(world, city)
    };
    let mut out: Vec<Shortage> = want
        .iter()
        .map(|(good, n)| Shortage {
            good: *good,
            share: if *n > 0.0 { (n - held(&stock, *good)) / n } else { 0.0 },
        })
        .filter(|s| s.share > 1e-9)
        .collect();
    out.sort_by(|a, b| b.share.total_cmp(&a.share));
    out
}

/// What an NPC city is short of, the shortest first (`shortages`, `CONTEXT.md`: NPC reserve): what
/// it lacks of its reserve and its project (`reserve_lacks`), Coins only for a city that can earn
/// them (`earns_coins`). `size` is the map's.
pub fn shortages(
    world: &WorldState,
    city: &City,
    size: i32,
    project: Option<&CityProject>,
) -> Vec<Shortage> {
    let short = reserve_lacks(world, city, project);
    // Looked into only once Coins are short: finding a way to earn them looks over the map.
    if city.trade_org.is_some()
        || !short.iter().any(|s| s.good == Good::Coins)
        || earns_coins(world, city, size)
    {
        return short;
    }
    short.into_iter().filter(|s| s.good != Good::Coins).collect()
}

/// The goods an NPC city is short of, the shortest first (`shortGoods`).
pub fn short_goods(
    world: &WorldState,
    city: &City,
    size: i32,
    project: Option<&CityProject>,
) -> Vec<Good> {
    shortages(world, city, size, project).into_iter().map(|s| s.good).collect()
}

/// How an NPC city weighs its workplaces for surplus work (`surplusWork`, `CONTEXT.md`: Spare
/// hands' work), from what it holds now: for a workplace, how full its good's cap is
/// (`NPC_SURPLUS_CAP` for each step of its needs, past the reserve), below 1 and lowest for the
/// good that wants hands most. `None` for one not to be worked for surplus: its good at its cap or
/// with no cap, or a workplace that processes goods while `storage` holds a batch of its input
/// only by eating into the reserve.
pub struct SurplusWork {
    stock: Stock,
    reserve: Stock,
    steps: f64,
    spare: Stock,
}

impl SurplusWork {
    /// Worked out from what the city holds now (`surplusWork(world, city, storage)`).
    pub fn of(world: &WorldState, city: &City, storage: Option<&Building>) -> Self {
        let stock = npc_city_stock(world, city);
        let reserve = npc_reserve(world, city);
        let steps = npc_needs_scale(world, city);
        let mut spare = Stock::new();
        for (good, n) in storage.and_then(|s| s.stock.as_ref()).into_iter().flatten() {
            spare.insert(*good, n - held(&reserve, *good));
        }
        SurplusWork { stock, reserve, steps, spare }
    }

    /// How full a workplace's good's cap is, if it is to be worked for surplus.
    pub fn full(&self, world: &WorldState, place: &Building) -> Option<f64> {
        let good = chain_good(world, place)?;
        let cap = NPC_SURPLUS_CAP.get(good_name(good)).filter(|c| *c != 0.0)?;
        if let Some(input) = chain_input(good) {
            if !holds_batch(Some(&self.spare), &input) {
                return None;
            }
        }
        let full = (held(&self.stock, good) - held(&self.reserve, good)) / (cap * self.steps);
        (full < 1.0).then_some(full)
    }
}

/// The materials a project still needs (`projectNeeds`): its site's, or all of the building's
/// before it is laid out.
pub fn project_needs(world: &WorldState, project: Option<&CityProject>) -> Stock {
    let Some(CityProject::Build { building, x, y }) = project else { return Stock::new() };
    // The TypeScript's `buildingAt` without a size: `MAP_SIZE`.
    match building_at(world, *x as i32, *y as i32, MAP_SIZE) {
        Some(site) if site.site.is_some() => materials_needed(site),
        Some(_) => Stock::new(),
        None => build_materials(*building),
    }
}

/// A Trade Org city's finished warehouses (`tradeOrgWarehouses`); none for any other city.
pub fn trade_org_warehouses<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Building> {
    if city.trade_org.is_none() {
        return Vec::new();
    }
    world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Warehouse
                && b.site.is_none()
                && b.city_id.as_ref() == Some(&city.id)
        })
        .collect()
}

/// The reserve of a Trade Org city (`tradeOrgReserve`): the stock floor of its warehouses, Food
/// aside.
pub fn trade_org_reserve(world: &WorldState, city: &City) -> Stock {
    let mut reserve = Stock::new();
    for b in trade_org_warehouses(world, city) {
        for (good, n) in stock_floor(world, b) {
            if good != Good::Food {
                *reserve.entry(good).or_insert(0.0) += n;
            }
        }
    }
    reserve
}

/// What a Trade Org city's warehouses hold together (`warehouseStock`).
pub fn warehouse_stock(world: &WorldState, city: &City) -> Stock {
    let mut sum = Stock::new();
    for b in trade_org_warehouses(world, city) {
        for (good, n) in b.stock.iter().flatten() {
            *sum.entry(*good).or_insert(0.0) += n;
        }
    }
    sum
}

/// Where a city keeps what its chain makes and uses up (`chainStore`): an NPC city its storage; a
/// Trade Org city its warehouse of goods, at the HQ the one that is not its coin warehouse.
pub fn chain_store<'w>(world: &'w WorldState, city: &City) -> Option<&'w Building> {
    if city.trade_org.is_some() {
        return trade_org_warehouses(world, city)
            .into_iter()
            .find(|b| warehouse_keeps(world, b).iter().any(|g| *g != Good::Coins));
    }
    world.buildings.iter().find(|b| {
        b.city_id.as_ref() == Some(&city.id) && b.kind == BuildingKind::Storage && b.site.is_none()
    })
}

/// Where in `world.buildings` the city's chain store stands (`chainStore`).
pub fn chain_store_index(world: &WorldState, city: &City) -> Option<usize> {
    let store = chain_store(world, city)?;
    crate::world_index::building_index(world, &store.id)
}

/// The warehouse a Trade Org city's worker stores a load of `goods` in (`warehouseFor`): the
/// first that keeps one of them, Food aside. None for a load of Food, and none for any other city.
pub fn warehouse_for<'w>(
    world: &'w WorldState,
    city: &City,
    goods: &[Good],
) -> Option<&'w Building> {
    let kept: Vec<Good> = goods.iter().copied().filter(|g| *g != Good::Food).collect();
    if kept.is_empty() {
        return None;
    }
    trade_org_warehouses(world, city)
        .into_iter()
        .find(|b| warehouse_keeps(world, b).iter().any(|g| kept.contains(g)))
}

#[cfg(test)]
mod tests;
