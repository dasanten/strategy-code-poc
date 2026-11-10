//! Transfers between realms, read only (`packages/shared/src/transfer.ts`, `CONTEXT.md`:
//! Transfer): fees, loads, the warehouses whose caravans carry them, and the checks of the
//! transfer orders.

use csp_shared::balance::{DELIVERY_LOAD, MAP_SIZE, TRANSFER_FEE_FACTOR};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Building, BuildingKind, Good, Resident, Stock, WorldState};
use serde_json::Value;

use super::command::commands_carriage;
use super::names::{held, placed, ALL_GOODS};
use super::residents::{can_work, good_weight};
use super::trade_org::{trade_org_hq, trade_org_refuses, NO_CARAVANS};
use super::warehouse::trade_coin_warehouse;
use super::warehouse_trade::{
    carriage_named, delivery_fee, delivery_storage, good_in, is_given, is_integer,
    trading_warehouse_at,
};

/// A transfer's fee, in coins (`transferFee`): `TRANSFER_FEE_FACTOR` times a delivery's fee for
/// `kg` over the caravan's whole way of `tiles`.
pub fn transfer_fee(kg: f64, tiles: f64) -> f64 {
    TRANSFER_FEE_FACTOR * delivery_fee(kg, tiles)
}

/// The part of a transfer's fee its caravan takes at the pick-up (`feeAtPickUp`), the rest
/// (`unload_share` of it, rounded up) being taken where it unloads.
pub fn fee_at_pick_up(fee: f64, unload_share: f64) -> f64 {
    fee - (fee * unload_share).ceil()
}

/// The most units of a good one transfer carries (`transferLoad`): one delivery load.
pub fn transfer_load(good: Good) -> f64 {
    (DELIVERY_LOAD / good_weight(good) + 1e-9).floor()
}

/// The warehouses whose caravans carry transfers (`transferWarehouses`), in the world's order.
pub fn transfer_warehouses(world: &WorldState) -> Vec<&Building> {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Warehouse
                && b.site.is_none()
                && trade_coin_warehouse(world, b).is_some()
        })
        .collect()
}

/// The warehouse nearest `storage` (`nearestWarehouse`): the first of the nearest, `None` when
/// there is none.
pub fn nearest_warehouse(world: &WorldState, storage: (f64, f64), size: i32) -> Option<&Building> {
    let mut best = None;
    let mut best_tiles = f64::INFINITY;
    for w in transfer_warehouses(world) {
        let tiles =
            wrap_distance(size, (w.x as i32, w.y as i32), (storage.0 as i32, storage.1 as i32));
        if tiles < best_tiles {
            best = Some(w);
            best_tiles = tiles;
        }
    }
    best
}

/// The tiles of a transfer's whole way (`transferTiles`): from the warehouse to the sender's
/// storage `from` (none for a hand-in), on to the recipient's storage `to`, and back.
pub fn transfer_tiles(
    size: i32,
    warehouse: (f64, f64),
    from: Option<(f64, f64)>,
    to: (f64, f64),
) -> f64 {
    let stops: Vec<(f64, f64)> = match from {
        Some(f) => vec![warehouse, f, to, warehouse],
        None => vec![warehouse, to, warehouse],
    };
    stops
        .windows(2)
        .map(|w| {
            wrap_distance(size, (w[0].0 as i32, w[0].1 as i32), (w[1].0 as i32, w[1].1 as i32))
        })
        .sum()
}

/// The most of `wanted` units a transfer takes from `held` with its fee over `tiles`
/// (`quoteTransfer`): `(units, fee)`.
pub fn quote_transfer(
    stock: &Stock,
    good: Good,
    wanted: f64,
    tiles: f64,
    unload_share: f64,
) -> (f64, f64) {
    let mut best = (0.0, 0.0);
    let mut n = 1.0;
    while n <= wanted.min(transfer_load(good)) {
        let fee = transfer_fee(n * good_weight(good), tiles);
        let coins = fee_at_pick_up(fee, unload_share) + if good == Good::Coins { n } else { 0.0 };
        if n > held(stock, good) || coins > held(stock, Good::Coins) {
            break;
        }
        best = (n, fee);
        n += 1.0;
    }
    best
}

/// Why `realm_id` can't send a transfer (`transferProblem`), or `None`.
pub fn transfer_problem(
    world: &WorldState,
    realm_id: &str,
    good: Option<&Value>,
    units: Option<&Value>,
    to_city_id: Option<&Value>,
) -> Option<String> {
    if trade_org_hq(world).is_none() {
        return Some(NO_CARAVANS.into());
    }
    if trade_org_refuses(world, realm_id) {
        return Some("the Trade Organization won’t carry for you".into());
    }
    let Some(good) = good_in(good, &ALL_GOODS) else {
        return Some("not a good".into());
    };
    let n = units.and_then(Value::as_f64).unwrap_or(0.0);
    if !is_integer(units) || n <= 0.0 {
        return Some("units must be a whole number".into());
    }
    if n > transfer_load(good) {
        return Some("more than one carriage load".into());
    }
    let to =
        to_city_id.and_then(Value::as_str).and_then(|id| world.cities.iter().find(|c| c.id == id));
    let Some(to) = to
        .filter(|c| c.realm_id.as_deref().is_some_and(|r| world.realms.iter().any(|x| x.id == r)))
    else {
        return Some("not a city of a realm".into());
    };
    if to.realm_id.as_deref() == Some(realm_id) {
        return Some("that city is your own".into());
    }
    if delivery_storage(world, &to.id).is_none() {
        return Some("that city has no storage".into());
    }
    None
}

/// Why `realm_id` can't have a caravan pick up a transfer at its city (`pickUpTransferProblem`),
/// or `None`.
pub fn pick_up_transfer_problem(
    world: &WorldState,
    realm_id: &str,
    from_city_id: Option<&Value>,
    good: Option<&Value>,
    units: Option<&Value>,
    to_city_id: Option<&Value>,
) -> Option<String> {
    if let Some(p) = transfer_problem(world, realm_id, good, units, to_city_id) {
        return Some(p);
    }
    let from = from_city_id
        .and_then(Value::as_str)
        .and_then(|id| world.cities.iter().find(|c| c.id == id));
    let Some(from) = from.filter(|c| c.realm_id.as_deref() == Some(realm_id)) else {
        return Some("not one of your cities".into());
    };
    if delivery_storage(world, &from.id).is_none() {
        return Some("your city has no storage".into());
    }
    if transfer_warehouses(world).is_empty() {
        return Some("no Trade Org warehouse to send a caravan".into());
    }
    None
}

/// Why a resident of `realm_id` can't hand in a transfer at a warehouse now (`handInProblem`), or
/// `None`.
#[allow(clippy::too_many_arguments)]
pub fn hand_in_problem(
    world: &WorldState,
    realm_id: &str,
    resident: &Resident,
    good: Option<&Value>,
    units: Option<&Value>,
    carriage_id: Option<&Value>,
    to_city_id: Option<&Value>,
) -> Option<String> {
    if let Some(p) = transfer_problem(world, realm_id, good, units, to_city_id) {
        return Some(p);
    }
    if !can_work(resident.born_at, world.tick as f64) {
        return Some("children can’t hand in a transfer".into());
    }
    let Some(warehouse) = trading_warehouse_at(world, resident.x, resident.y) else {
        return Some("not at a Trade Org warehouse".into());
    };
    let mut stock = &resident.carried;
    if is_given(carriage_id) {
        let k = carriage_named(world, carriage_id);
        if !commands_carriage(world, realm_id, k) {
            return Some("not one of your carriages".into());
        }
        let k = k.expect("commanded");
        if !is_at((k.x as i32, k.y as i32), placed(warehouse), MAP_SIZE) {
            return Some("that carriage is not at the warehouse".into());
        }
        stock = &k.load;
    }
    let good = good_in(good, &ALL_GOODS).expect("checked");
    if held(stock, good) <= 0.0 {
        return Some("none of that good to hand in".into());
    }
    None
}
