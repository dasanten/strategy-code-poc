//! Transfers between realms (`apps/server/src/transfers.ts`, `CONTEXT.md`: Transfer, Trade Org
//! debt, Guaranteed carriage): the Trade Organization carries goods or coins from one realm to a
//! city of another. A caravan standing at a transfer's warehouse takes it on, after the
//! deliveries ordered there, and carries it out instead of going on along its route
//! (`TransferJob`), then goes back to its route.

use csp_shared::balance::{DELIVERY_DRIVE_TRIES, DELIVERY_LOAD, MAP_SIZE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    CaravanStop, DebtCollection, DebtWhat, DriveOrder, DropOrder, Good, GoodsSpot, HandInOrder,
    Holding, Onto, OrderRequest, PickUpOrder, RealmEventWhat, ResidentOrder, Stock, Tile, Transfer,
    TransferJob, TransferJobStep, TransferStuckWhy, WorldState,
};
use serde_json::Value;

use crate::events::record_event;
use crate::goods_deps::{end_offer, new_id, realm_name, OrderSender};
use crate::holders::{move_between, Holder};
use crate::order_sender::commands;
use crate::queries::goods::{free_stock, units_that_fit, units_that_fit_carriage};
use crate::queries::names::{good_of, held, placed};
use crate::queries::offers::offer_storage;
use crate::queries::residents::{good_weight, is_down};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::trade_org_hq;
use crate::queries::transfer::{
    fee_at_pick_up, hand_in_problem, nearest_warehouse, pick_up_transfer_problem, quote_transfer,
    transfer_fee, transfer_load, transfer_tiles,
};
use crate::queries::warehouse::trade_coin_warehouse;
use crate::queries::warehouse_trade::{debt_of, delivery_storage};
use crate::sight::InvariantViolation;

fn realm_of(world: &WorldState, user_id: u64) -> Option<&csp_shared::world::Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

fn xy(b: &csp_shared::world::Building) -> (f64, f64) {
    (b.x, b.y)
}

/// A pick-up transfer on terms already checked (`orderPickUp`): it waits for a caravan of the
/// warehouse nearest the sender's city, with a line in the sender's log.
#[allow(clippy::too_many_arguments)]
pub fn order_pick_up(
    world: &mut WorldState,
    size: i32,
    realm_id: &str,
    from_city_id: &str,
    to_city_id: &str,
    good: Good,
    units: f64,
) {
    let from = world.cities.iter().find(|c| c.id == from_city_id).cloned();
    let to = world.cities.iter().find(|c| c.id == to_city_id).cloned();
    let storage = delivery_storage(world, from_city_id).map(xy);
    let (Some(from), Some(to), Some(storage)) = (from, to, storage) else { return };
    let Some(to_realm) = to.realm_id.clone() else { return };
    let Some(warehouse) = nearest_warehouse(world, storage, size).map(|w| w.id.clone()) else {
        return;
    };
    let id = new_id(world, "transfer");
    world.transfers.push(Transfer {
        id,
        realm_id: realm_id.to_string(),
        to_realm_id: to_realm.clone(),
        to_city_id: to.id.clone(),
        warehouse_id: warehouse,
        from_city_id: Some(from.id.clone()),
        good,
        units,
        fee: 0.0,
        back: false,
        caravan_id: None,
        carried_offer: None,
        debt: None,
    });
    let what = RealmEventWhat::TransferOrdered {
        good,
        units,
        wanted: units,
        fee: 0.0,
        from_city: Some(from.name.clone()),
        name: None,
        to_realm: realm_name(world, &to_realm),
        to_realm_id: to_realm,
        city_id: to.id.clone(),
        city: to.name.clone(),
        x: storage.0,
        y: storage.1,
    };
    record_event(world, Some(realm_id), what);
}

/// Caravans of the warehouse nearest `storage` collect `coins` of a debt there, a load at a time
/// (`orderDebtCollection`). Nothing without a warehouse, or for a storage outside a city.
pub fn order_debt_collection(
    world: &mut WorldState,
    size: i32,
    org: &str,
    storage_id: &str,
    coins: f64,
    offer_id: Option<&str>,
) {
    let Some(storage) = world.buildings.iter().find(|b| b.id == storage_id).cloned() else {
        return;
    };
    let warehouse = nearest_warehouse(world, xy(&storage), size).cloned();
    let (Some(warehouse), Some(from_city)) = (warehouse, storage.city_id.clone()) else { return };
    let Some(to_city) = warehouse.city_id.clone() else { return };
    let load = transfer_load(Good::Coins);
    let mut left = coins;
    while left > 0.0 {
        let id = new_id(world, "transfer");
        world.transfers.push(Transfer {
            id,
            realm_id: org.to_string(),
            to_realm_id: TRADE_ORG.to_string(),
            to_city_id: to_city.clone(),
            warehouse_id: warehouse.id.clone(),
            from_city_id: Some(from_city.clone()),
            good: Good::Coins,
            units: left.min(load),
            fee: 0.0,
            back: false,
            caravan_id: None,
            carried_offer: None,
            debt: Some(DebtCollection {
                storage_id: storage.id.clone(),
                offer_id: offer_id.map(str::to_string),
            }),
        });
        left -= load;
    }
}

/// Checks a transfer order (`transfer.validate`).
pub fn validate_transfer(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let Some(realm) = realm_of(world, sender.user_id) else {
        return Some("you have no realm".into());
    };
    let o = &order.fields;
    pick_up_transfer_problem(
        world,
        &realm.id,
        o.get("fromCityId"),
        o.get("good"),
        o.get("units"),
        o.get("toCityId"),
    )
}

/// Gives a transfer order (`transfer.apply`). Without a map, its size is `Infinity` in the
/// TypeScript; the order sender always passes one here.
pub fn apply_transfer(
    world: &mut WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    size: i32,
) {
    let Some(realm) = realm_of(world, sender.user_id).map(|r| r.id.clone()) else { return };
    if validate_transfer(world, sender, order).is_some() {
        return;
    }
    let o = &order.fields;
    let s = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let good = o.get("good").and_then(Value::as_str).and_then(good_of).expect("checked");
    let units = o.get("units").and_then(Value::as_f64).expect("checked");
    order_pick_up(world, size, &realm, &s("fromCityId"), &s("toCityId"), good, units);
}

/// Checks a hand-in order (`handInOrder.validate`).
pub fn validate_hand_in(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let id = o.get("residentId").and_then(Value::as_str);
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    let r = r.expect("commanded");
    hand_in_problem(
        world,
        &realm.id,
        r,
        o.get("good"),
        o.get("units"),
        o.get("carriageId"),
        o.get("toCityId"),
    )
}

/// Gives a hand-in order (`handInOrder.apply`).
pub fn apply_hand_in(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let o = &order.fields;
    let id = o.get("residentId").and_then(Value::as_str);
    let Some(good) = o.get("good").and_then(Value::as_str).and_then(good_of) else { return };
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::HandIn(HandInOrder {
            good,
            units: o.get("units").and_then(Value::as_f64).unwrap_or(0.0),
            carriage_id: o.get("carriageId").and_then(Value::as_str).map(str::to_string),
            to_city_id: o.get("toCityId").and_then(Value::as_str).unwrap_or_default().to_string(),
        }));
    }
}

fn holder_stock(world: &WorldState, h: Holder) -> Stock {
    crate::holders::stock_of(world, h)
}

/// Carries out the hand-in order `o` of resident `ri` of `realm` at warehouse `w` (`handIn`),
/// from `payer`. Returns whether a transfer was handed in.
#[allow(clippy::too_many_arguments)]
pub fn hand_in(
    world: &mut WorldState,
    size: i32,
    ri: usize,
    realm: &str,
    o: &HandInOrder,
    w: usize,
    payer: Holder,
) -> bool {
    let to = world.cities.iter().find(|c| c.id == o.to_city_id).cloned();
    let storage = delivery_storage(world, &o.to_city_id).map(xy);
    let coin_warehouse = trade_coin_warehouse(world, &world.buildings[w]).map(|b| b.id.clone());
    let (Some(to), Some(storage), Some(cw)) = (to, storage, coin_warehouse) else { return false };
    let Some(to_realm) = to.realm_id.clone().filter(|r| r != realm) else { return false };
    if !world.realms.iter().any(|x| x.id == to_realm) {
        return false;
    }
    // No caravan would ever come, should the HQ have fallen since the order was given.
    if trade_org_hq(world).is_none() {
        return false;
    }
    let tiles = transfer_tiles(size, xy(&world.buildings[w]), None, storage);
    let (units, fee) = quote_transfer(&holder_stock(world, payer), o.good, o.units, tiles, 0.0);
    let cwi = world.buildings.iter().position(|b| b.id == cw).expect("a coin warehouse");
    world.buildings[cwi].stock.get_or_insert_with(Stock::new);
    let into = if o.good == Good::Coins {
        Holder::Storage(cwi)
    } else {
        world.buildings[w].stock.get_or_insert_with(Stock::new);
        Holder::Storage(w)
    };
    move_between(world, payer, into, o.good, units);
    move_between(
        world,
        payer,
        Holder::Storage(cwi),
        Good::Coins,
        if units > 0.0 { fee } else { 0.0 },
    );
    if units > 0.0 {
        let id = new_id(world, "transfer");
        world.transfers.push(Transfer {
            id,
            realm_id: realm.to_string(),
            to_realm_id: to_realm.clone(),
            to_city_id: to.id.clone(),
            warehouse_id: world.buildings[w].id.clone(),
            from_city_id: None,
            good: o.good,
            units,
            fee,
            back: false,
            caravan_id: None,
            carried_offer: None,
            debt: None,
        });
    }
    let what = RealmEventWhat::TransferOrdered {
        good: o.good,
        units,
        wanted: o.units,
        fee: if units > 0.0 { fee } else { 0.0 },
        from_city: None,
        name: Some(world.residents[ri].name.clone()),
        to_realm: realm_name(world, &to_realm),
        to_realm_id: to_realm,
        city_id: to.id.clone(),
        city: to.name.clone(),
        x: world.buildings[w].x,
        y: world.buildings[w].y,
    };
    record_event(world, Some(realm), what);
    units > 0.0
}

/// Has caravan `ci`, standing at warehouse `warehouse_id`, take on the oldest transfer there
/// that waits for a caravan (`takeOnTransfer`). Returns whether it took one.
pub fn take_on_transfer(world: &mut WorldState, ci: usize, warehouse_id: &str) -> bool {
    let Some(ti) = world
        .transfers
        .iter()
        .position(|x| x.caravan_id.is_none() && x.warehouse_id == warehouse_id)
    else {
        return false;
    };
    let cid = world.caravans[ci].id.clone();
    let t = &mut world.transfers[ti];
    t.caravan_id = Some(cid);
    let job = TransferJob {
        transfer_id: t.id.clone(),
        warehouse_id: t.warehouse_id.clone(),
        good: t.good,
        step: if t.from_city_id.is_none() {
            TransferJobStep::Load
        } else {
            TransferJobStep::Collect
        },
        units: 0.0,
        coins: 0.0,
        target: None,
        fee: 0.0,
        misses: 0.0,
        robbed: 0.0,
        from_city_id: t.from_city_id.clone(),
    };
    world.caravans[ci].transfer = Some(job);
    true
}

/// Lets go of a caravan's transfer, which waits for the next caravan (`releaseTransfer`).
pub fn release_transfer(world: &mut WorldState, ci: usize) {
    let c = &world.caravans[ci];
    let Some(id) = c.transfer.as_ref().map(|j| j.transfer_id.clone()) else { return };
    let cid = c.id.clone();
    if let Some(t) = world.transfers.iter_mut().find(|x| x.id == id) {
        if t.caravan_id.as_deref() == Some(cid.as_str()) {
            t.caravan_id = None;
        }
    }
}

fn transfer_of(world: &WorldState, job: &TransferJob) -> Option<Transfer> {
    world.transfers.iter().find(|t| t.id == job.transfer_id).cloned()
}

fn tmut<'w>(world: &'w mut WorldState, id: &str) -> Option<&'w mut Transfer> {
    world.transfers.iter_mut().find(|x| x.id == id)
}

fn drop_transfer(world: &mut WorldState, id: &str) {
    world.transfers.retain(|x| x.id != id);
}

/// The city's name, for the realm log (`cityName`).
fn city_name(world: &WorldState, city_id: &str) -> String {
    world
        .cities
        .iter()
        .find(|c| c.id == city_id)
        .map_or_else(|| "a lost city".into(), |c| c.name.clone())
}

/// The realm a transfer goes to: the recipient's, or the sender's once it goes back (`receiver`).
fn receiver(t: &Transfer) -> &str {
    if t.back {
        &t.realm_id
    } else {
        &t.to_realm_id
    }
}

/// The building a transfer's goods go into (`dropOff`), by index.
fn drop_off(world: &WorldState, t: &Transfer) -> Option<usize> {
    let id = if t.debt.is_none() || t.back {
        delivery_storage(world, &t.to_city_id).map(|b| b.id.clone())
    } else {
        let w = world.buildings.iter().find(|b| b.id == t.warehouse_id)?;
        trade_coin_warehouse(world, w).map(|b| b.id.clone())
    }?;
    world.buildings.iter().position(|b| b.id == id)
}

/// The building a pick-up collects at (`pickUpAt`), by index.
fn pick_up_at(
    world: &WorldState,
    from_city_id: Option<&str>,
    t: Option<&Transfer>,
) -> Option<usize> {
    if let Some(debt) = t.and_then(|t| t.debt.as_ref()) {
        return world.buildings.iter().position(|b| b.id == debt.storage_id);
    }
    let id = delivery_storage(world, from_city_id?)?.id.clone();
    world.buildings.iter().position(|b| b.id == id)
}

/// Whether the city is still the realm's, with a storage (`holds`).
fn holds(world: &WorldState, realm_id: &str, city_id: Option<&str>) -> bool {
    world.cities.iter().find(|c| Some(c.id.as_str()) == city_id).is_some_and(|c| {
        c.realm_id.as_deref() == Some(realm_id) && delivery_storage(world, &c.id).is_some()
    })
}

/// Whether the sender still holds where its transfer is picked up (`senderHolds`).
fn sender_holds(world: &WorldState, job: &TransferJob, t: &Transfer) -> bool {
    match &t.debt {
        Some(debt) => offer_storage(world, &t.realm_id, &debt.storage_id).is_some(),
        None => holds(world, &t.realm_id, job.from_city_id.as_deref()),
    }
}

/// Whether what a transfer carries can still go in where it is going (`receiverHolds`).
fn receiver_holds(world: &WorldState, t: &Transfer) -> bool {
    if t.debt.is_some() && !t.back {
        debt_of(world, &t.realm_id) > 0.0 && drop_off(world, t).is_some()
    } else {
        holds(world, receiver(t), Some(&t.to_city_id))
    }
}

/// Cuts what a transfer job counts on board down to what the carriage holds (`countOnBoard`).
fn count_on_board(job: &mut TransferJob, load: &Stock) {
    let coins = held(load, Good::Coins);
    if job.good == Good::Coins {
        job.units = job.units.min(coins);
        job.coins = job.coins.min(coins - job.units);
    } else {
        job.units = job.units.min(held(load, job.good));
        job.coins = job.coins.min(coins);
    }
}

/// The building a job's step happens at (`stepBuilding`), by index.
fn step_building(world: &WorldState, job: &TransferJob, t: Option<&Transfer>) -> Option<usize> {
    let w = world.buildings.iter().position(|b| b.id == job.warehouse_id)?;
    let coin = trade_coin_warehouse(world, &world.buildings[w])
        .and_then(|c| world.buildings.iter().position(|b| b.id == c.id));
    match job.step {
        TransferJobStep::Collect | TransferJobStep::Fee => {
            pick_up_at(world, job.from_city_id.as_deref(), t)
        }
        TransferJobStep::Load => {
            if job.good == Good::Coins {
                coin
            } else {
                Some(w)
            }
        }
        TransferJobStep::Deliver | TransferJobStep::UnloadFee => t.and_then(|t| drop_off(world, t)),
        TransferJobStep::Return => {
            if job.units > 0.0 && job.good != Good::Coins {
                Some(w)
            } else {
                coin
            }
        }
    }
}

fn stuck(
    world: &mut WorldState,
    realm: &str,
    why: TransferStuckWhy,
    good: Good,
    units: f64,
    city_id: &str,
) {
    let what = RealmEventWhat::TransferStuck {
        why,
        good,
        units,
        city_id: city_id.to_string(),
        city: city_name(world, city_id),
    };
    record_event(world, Some(realm), what);
}

/// The caravan turns back to the warehouse from a storage it couldn't get to (`turnBack`).
fn turn_back(world: &mut WorldState, job: &mut TransferJob, t: &Transfer) {
    let delivering = job.step == TransferJobStep::Deliver;
    if let Some(x) = tmut(world, &t.id) {
        if delivering {
            x.from_city_id = None;
        }
        x.caravan_id = None;
    }
    if delivering {
        job.robbed = 0.0;
    }
    job.step = TransferJobStep::Return;
    job.misses = 0.0;
    // No caravan gets there to collect a debt, so it stays owed rather than wait on the next one.
    if t.debt.is_some() && !delivering {
        drop_transfer(world, &t.id);
    }
    let city = if delivering || job.from_city_id.is_none() {
        t.to_city_id.clone()
    } else {
        job.from_city_id.clone().unwrap()
    };
    stuck(world, &t.realm_id, TransferStuckWhy::TurnedBack, t.good, t.units, &city);
}

/// The recipient's city is no longer that realm's, or the realm is gone (`cancel`).
fn cancel(world: &mut WorldState, job: &mut TransferJob, t: &Transfer, size: i32) {
    let lost = t.to_city_id.clone();
    let home = if t.back { None } else { home_for(world, job, t, size) };
    match &home {
        Some(home) => {
            if let Some(x) = tmut(world, &t.id) {
                x.back = true;
                x.to_city_id = home.clone();
                // Going back, it unloads at the side that didn't owe that part of the fee.
                if let Some(c) = x.carried_offer.as_mut() {
                    c.due = 0.0;
                }
            }
            job.misses = 0.0;
        }
        None => {
            drop_transfer(world, &t.id);
            job.step = TransferJobStep::Return;
        }
    }
    let why = if home.is_some() { TransferStuckWhy::Cancelled } else { TransferStuckWhy::Kept };
    stuck(world, &t.realm_id, why, t.good, job.units, &lost);
}

/// The sender's city a cancelled transfer goes back to, if the sender still has one (`homeFor`).
fn home_for(world: &WorldState, job: &TransferJob, t: &Transfer, size: i32) -> Option<String> {
    if let Some(from) = &job.from_city_id {
        return holds(world, &t.realm_id, Some(from)).then(|| from.clone());
    }
    let warehouse = world.buildings.iter().find(|b| b.id == job.warehouse_id);
    let mut best = None;
    let mut best_tiles = f64::INFINITY;
    for c in &world.cities {
        let storage = if c.realm_id.as_deref() == Some(t.realm_id.as_str()) {
            delivery_storage(world, &c.id)
        } else {
            None
        };
        let (Some(s), Some(w)) = (storage, warehouse) else { continue };
        let tiles = wrap_distance(size, (w.x as i32, w.y as i32), (s.x as i32, s.y as i32));
        if tiles < best_tiles {
            best = Some(c.id.clone());
            best_tiles = tiles;
        }
    }
    best
}

#[derive(PartialEq)]
enum Next {
    Goes,
    Finish,
}

/// One tick of caravan `ci` carrying out a transfer (`runTransfer`), its driver `ri` idle with
/// carriage `ki`. `size` is the map's.
pub fn run_transfer(world: &mut WorldState, ci: usize, ri: usize, ki: usize, size: i32) {
    let mut job = world.caravans[ci].transfer.clone().expect("a caravan with a transfer");
    let next = step_transfer(world, ci, ri, ki, size, &mut job);
    let c = &mut world.caravans[ci];
    if next == Next::Finish {
        c.transfer = None;
        c.stop = CaravanStop::Storage;
    } else {
        c.transfer = Some(job);
    }
}

fn step_transfer(
    world: &mut WorldState,
    ci: usize,
    ri: usize,
    ki: usize,
    size: i32,
    job: &mut TransferJob,
) -> Next {
    count_on_board(job, &world.carriages[ki].load);
    let t = transfer_of(world, job);
    if job.step != TransferJobStep::Return && t.is_none() {
        job.step = TransferJobStep::Return;
        return Next::Goes;
    }
    let collecting = matches!(job.step, TransferJobStep::Collect | TransferJobStep::Fee);
    if let Some(t) = &t {
        if collecting && !sender_holds(world, job, t) {
            // The sender's city is gone: with nothing taken yet there is nothing to carry.
            if job.units + job.robbed == 0.0 {
                nothing(world, job, t);
            } else {
                collected(world, job, t);
            }
            return Next::Goes;
        }
        if job.step == TransferJobStep::Deliver {
            if !receiver_holds(world, t) {
                cancel(world, job, t, size);
                return Next::Goes;
            }
            // Robbed of all it carried, it has nothing left to bring.
            if job.units == 0.0 && job.robbed > 0.0 && world.caravans[ci].holding.is_none() {
                let s = delivery_storage(world, &t.to_city_id).map(xy);
                send_again(world, job, t, s);
                return Next::Goes;
            }
        }
        if job.step == TransferJobStep::UnloadFee && !holds(world, receiver(t), Some(&t.to_city_id))
        {
            // The goods are in and the city has changed hands: nobody there owes the fee.
            let at = (world.residents[ri].x, world.residents[ri].y);
            arrived(world, job, t, at);
            job.step = TransferJobStep::Return;
            return Next::Goes;
        }
    }
    let Some(bi) = step_building(world, job, t.as_ref()) else { return Next::Finish };
    let driver = &world.residents[ri];
    if !is_at((driver.x as i32, driver.y as i32), placed(&world.buildings[bi]), MAP_SIZE) {
        // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
        let k = &world.carriages[ki];
        let horse = k.horse_id.as_deref().and_then(|h| world.horses.iter().find(|x| x.id == h));
        if horse.is_some_and(|h| is_down(h.down_until)) {
            return Next::Goes;
        }
        let to_storage = collecting || job.step == TransferJobStep::Deliver;
        if to_storage && job.misses >= DELIVERY_DRIVE_TRIES {
            turn_back(world, job, t.as_ref().expect("a transfer to a storage"));
            return Next::Goes;
        }
        job.misses += 1.0;
        let target = Tile { x: world.buildings[bi].x, y: world.buildings[bi].y };
        let carriage_id = world.carriages[ki].id.clone();
        world.residents[ri].order = Some(ResidentOrder::Drive(DriveOrder {
            carriage_id,
            target,
            path: None,
            progress: 0.0,
            army: None,
            near: None,
        }));
        return Next::Goes;
    }
    job.misses = 0.0;
    let b = world.buildings[bi].id.clone();
    let bxy = xy(&world.buildings[bi]);
    let here = GoodsSpot::Storage { storage_id: b.clone() };
    let on_carriage = GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() };
    // The fee's coins count apart from the transfer's units, coins or not.
    let fee_step = matches!(job.step, TransferJobStep::Fee | TransferJobStep::UnloadFee);
    if let Some(Holding { goods, onto }) = world.caravans[ci].holding.clone() {
        world.caravans[ci].holding = None;
        let (&good, &wanted) = goods.iter().next().expect("one good held");
        let fits = match onto {
            Onto::Carriage => units_that_fit_carriage(world, &world.carriages[ki], good),
            Onto::Stop => f64::INFINITY,
        };
        let units = wanted.min(held(&world.residents[ri].carried, good)).min(fits);
        if units > 0.0 {
            let to = if onto == Onto::Carriage { on_carriage.clone() } else { here.clone() };
            let goods = Stock::from([(good, units)]);
            world.residents[ri].order = Some(ResidentOrder::Drop(DropOrder { to, goods }));
            if onto == Onto::Carriage && fee_step {
                job.coins += units;
                let unload = job.step == TransferJobStep::UnloadFee;
                if let Some(x) = t.as_ref().and_then(|t| tmut(world, &t.id)) {
                    x.fee += units;
                    if unload {
                        if let Some(c) = x.carried_offer.as_mut() {
                            c.due -= units;
                        }
                    }
                }
            } else if onto == Onto::Carriage {
                job.units += units;
            }
            return Next::Goes;
        }
    }
    // A pick-up leaves what is set aside for an offer alone (`CONTEXT.md`: Offer), but for a debt
    // collecting just that (`CONTEXT.md`: Trade Org debt).
    let offer_id = if collecting {
        t.as_ref().and_then(|t| t.debt.as_ref()).and_then(|d| d.offer_id.clone())
    } else {
        None
    };
    let offer_times = offer_id
        .as_deref()
        .map(|id| world.offers.iter().find(|o| o.id == id).map_or(0.0, |o| o.times));
    let stock: Stock = match offer_times {
        Some(times) => Stock::from([(Good::Coins, times)]),
        None => free_stock(world, &b, world.buildings[bi].stock.as_ref()),
    };
    let tick = world.tick as f64;
    let hands = |world: &WorldState, g: Good| units_that_fit(&world.residents[ri], g, tick);
    let fits =
        |world: &WorldState, g: Good| units_that_fit_carriage(world, &world.carriages[ki], g);
    let take = |world: &mut WorldState, from: GoodsSpot, good: Good, units: f64, onto: Onto| {
        let goods = Stock::from([(good, units)]);
        world.residents[ri].order =
            Some(ResidentOrder::PickUp(PickUpOrder { from, goods: goods.clone() }));
        world.caravans[ci].holding = Some(Holding { goods, onto });
        Next::Goes
    };
    let off = |world: &mut WorldState, job: &mut TransferJob, good: Good, units: f64, fee: bool| {
        if fee {
            job.coins -= units;
        } else {
            job.units -= units;
        }
        take(world, on_carriage.clone(), good, units, Onto::Stop)
    };
    let g = job.good;
    if job.step == TransferJobStep::Return {
        let units = job.units.min(hands(world, g));
        if units > 0.0 {
            return off(world, job, g, units, false);
        }
        let coins = job.coins.min(hands(world, Good::Coins));
        if coins > 0.0 {
            return off(world, job, Good::Coins, coins, true);
        }
        return Next::Finish;
    }
    let t = t.expect("a transfer for every step but return");
    match job.step {
        TransferJobStep::Collect => {
            let w = world
                .buildings
                .iter()
                .find(|x| x.id == job.warehouse_id)
                .map(xy)
                .expect("a warehouse");
            let to = drop_off(world, &t).map(|i| xy(&world.buildings[i]));
            let tiles = to.map_or(0.0, |to| transfer_tiles(size, w, Some(bxy), to));
            // What is set aside for a debt goes for no fee: none of it is taken at the pick-up,
            // and without a carried offer none is due anywhere else.
            let unload_share = if offer_id.is_some() {
                1.0
            } else {
                t.carried_offer.as_ref().map_or(0.0, |c| c.unload_share)
            };
            if job.target.is_none() {
                let wanted = if t.debt.is_some() {
                    t.units.min(debt_of(world, &t.realm_id))
                } else {
                    t.units
                };
                let (units, _) = quote_transfer(&stock, g, wanted, tiles, unload_share);
                let target = units.min(fits(world, g));
                job.target = Some(target);
                if target == 0.0 {
                    nothing(world, job, &t);
                    return Next::Goes;
                }
            }
            // What robbers took off the carriage was collected all the same.
            let have = job.units + job.robbed;
            let units = (job.target.unwrap() - have)
                .min(held(&stock, g))
                .min(hands(world, g))
                .min(fits(world, g));
            if units > 0.0 {
                // They stop being set aside now, for the driver to take them next tick.
                if let Some(id) = &offer_id {
                    if let Some(o) = world.offers.iter_mut().find(|o| &o.id == id) {
                        o.times -= units;
                        if o.times <= 0.0 {
                            end_offer(world, id);
                        }
                    }
                }
                return take(world, here, g, units, Onto::Carriage);
            }
            let fee = if have > 0.0 { transfer_fee(have * good_weight(g), tiles) } else { 0.0 };
            job.fee = fee_at_pick_up(fee, unload_share);
            let at_pick_up = job.fee;
            if let Some(x) = tmut(world, &t.id) {
                if let Some(c) = x.carried_offer.as_mut() {
                    c.due = fee - at_pick_up;
                }
            }
            job.step = TransferJobStep::Fee;
            Next::Goes
        }
        TransferJobStep::Fee => {
            let units = (job.fee - t.fee)
                .min(held(&stock, Good::Coins))
                .min(hands(world, Good::Coins))
                .min(fits(world, Good::Coins));
            if units > 0.0 {
                return take(world, here, Good::Coins, units, Onto::Carriage);
            }
            collected(world, job, &t);
            Next::Goes
        }
        TransferJobStep::Load => {
            let want = t.units - job.units;
            let units = want.min(held(&stock, g)).min(hands(world, g)).min(fits(world, g));
            if units > 0.0 {
                return take(world, here, g, units, Onto::Carriage);
            }
            // Nothing to load yet: it waits at the warehouse for its stock.
            if job.units == 0.0 && want > 0.0 {
                return Next::Goes;
            }
            job.step = TransferJobStep::Deliver;
            Next::Goes
        }
        TransferJobStep::Deliver => {
            job.target.get_or_insert(job.units);
            let units = job.units.min(hands(world, g));
            if units > 0.0 {
                return off(world, job, g, units, false);
            }
            if job.robbed > 0.0 {
                send_again(world, job, &t, Some(bxy));
                return Next::Goes;
            }
            if t.carried_offer.as_ref().map_or(0.0, |c| c.due) > 0.0 {
                job.step = TransferJobStep::UnloadFee;
                return Next::Goes;
            }
            arrived(world, job, &t, bxy);
            job.step = TransferJobStep::Return;
            Next::Goes
        }
        TransferJobStep::UnloadFee => {
            let due = t.carried_offer.as_ref().map_or(0.0, |c| c.due);
            let units = due
                .min(held(&stock, Good::Coins))
                .min(hands(world, Good::Coins))
                .min(fits(world, Good::Coins));
            if units > 0.0 {
                return take(world, here, Good::Coins, units, Onto::Carriage);
            }
            // What the storage hasn't got, or the carriage can't take, is the Trade
            // Organization's loss.
            arrived(world, job, &t, bxy);
            job.step = TransferJobStep::Return;
            Next::Goes
        }
        TransferJobStep::Return => unreachable!("handled above"),
    }
}

/// The caravan has what it collected at the sender's storage, with the fee (`collected`).
fn collected(world: &mut WorldState, job: &mut TransferJob, t: &Transfer) {
    let units = job.units + job.robbed;
    if units == 0.0 {
        return nothing(world, job, t);
    }
    if let Some(x) = tmut(world, &t.id) {
        x.units = units;
    }
    job.target = None;
    job.step = TransferJobStep::Deliver;
}

/// Nothing was there to carry: the transfer is dropped, with a line in the sender's log
/// (`nothing`).
fn nothing(world: &mut WorldState, job: &mut TransferJob, t: &Transfer) {
    drop_transfer(world, &t.id);
    job.step = TransferJobStep::Return;
    // A debt says for itself what is still owed.
    if t.debt.is_some() {
        return;
    }
    let city = job.from_city_id.clone().unwrap_or_else(|| t.to_city_id.clone());
    stuck(world, &t.realm_id, TransferStuckWhy::Nothing, t.good, t.units, &city);
    // The other side of a carried Direct offer was waiting for these goods.
    if t.carried_offer.is_some() {
        stuck(world, &t.to_realm_id, TransferStuckWhy::NothingCame, t.good, t.units, &t.to_city_id);
    }
}

/// Coins a caravan brought in come off the debt (`debtCollected`).
fn debt_collected(world: &mut WorldState, org: &str, units: f64) {
    let Some(i) = world.debts.iter().position(|d| d.org == org) else { return };
    let coins = units.min(world.debts[i].coins);
    world.debts[i].coins -= coins;
    let owed = world.debts[i].coins;
    if owed <= 0.0 {
        world.debts.remove(i);
    }
    record_event(world, Some(org), RealmEventWhat::Debt { what: DebtWhat::Collected, coins, owed });
}

/// The line a transfer put into storage at `at` leaves in both realms' logs, or what a debt
/// collected (`logArrived`).
fn log_arrived(world: &mut WorldState, t: &Transfer, units: f64, at: (f64, f64)) {
    if t.debt.is_some() && !t.back {
        return debt_collected(world, &t.realm_id, units);
    }
    let fee = world.transfers.iter().find(|x| x.id == t.id).map_or(t.fee, |x| x.fee);
    let what = RealmEventWhat::Transferred {
        good: t.good,
        units,
        fee,
        carried: t.carried_offer.as_ref().map(|_| true),
        from_realm_id: t.realm_id.clone(),
        from_realm: realm_name(world, &t.realm_id),
        to_realm_id: t.to_realm_id.clone(),
        to_realm: realm_name(world, &t.to_realm_id),
        back: t.back,
        city_id: t.to_city_id.clone(),
        city: city_name(world, &t.to_city_id),
        x: at.0,
        y: at.1,
    };
    record_event(world, Some(&t.realm_id), what.clone());
    if !t.back {
        record_event(world, Some(&t.to_realm_id), what);
    }
}

/// A transfer's goods are all in the storage at `at`: it is done (`arrived`).
fn arrived(world: &mut WorldState, job: &TransferJob, t: &Transfer, at: (f64, f64)) {
    let t = world.transfers.iter().find(|x| x.id == t.id).cloned().unwrap_or_else(|| t.clone());
    drop_transfer(world, &t.id);
    log_arrived(world, &t, job.target.unwrap_or(0.0), at);
}

/// Robbers took some of a transfer off the caravan (`sendAgain`).
fn send_again(world: &mut WorldState, job: &mut TransferJob, t: &Transfer, at: Option<(f64, f64)>) {
    if let (Some(at), Some(target)) = (at, job.target.filter(|x| *x > 0.0)) {
        log_arrived(world, t, target, at);
    }
    stuck(world, &t.realm_id, TransferStuckWhy::Robbed, t.good, job.robbed, &t.to_city_id);
    if let Some(x) = tmut(world, &t.id) {
        x.units = job.robbed;
        x.from_city_id = None;
        x.caravan_id = None;
    }
    job.robbed = 0.0;
    job.step = TransferJobStep::Return;
}

/// Robbers took goods off caravan `ci`'s carriage (`transferRobbed`).
pub fn transfer_robbed(world: &mut WorldState, ci: usize, ki: usize) {
    let load = world.carriages[ki].load.clone();
    let Some(job) = world.caravans[ci].transfer.as_mut() else { return };
    let before = job.units;
    count_on_board(job, &load);
    let lost = before - job.units;
    if matches!(
        job.step,
        TransferJobStep::Collect | TransferJobStep::Fee | TransferJobStep::Deliver
    ) {
        job.robbed += lost;
    }
    // What was put into the storage is the rest: the target less what was taken.
    if job.step == TransferJobStep::Deliver {
        if let Some(t) = job.target.as_mut() {
            *t -= lost;
        }
    }
}

/// Whether resident `r` takes from storage `storage_id` for a transfer (`collectsTransferFrom`).
pub fn collects_transfer_from(
    world: &WorldState,
    r: &csp_shared::world::Resident,
    storage_id: &str,
) -> bool {
    let job = world
        .caravans
        .iter()
        .find(|c| c.driver_id.as_deref() == Some(r.id.as_str()))
        .and_then(|c| c.transfer.as_ref());
    let Some(job) = job else { return false };
    let t = world.transfers.iter().find(|x| x.id == job.transfer_id);
    if job.step == TransferJobStep::UnloadFee {
        return t.is_some_and(|t| {
            delivery_storage(world, &t.to_city_id).is_some_and(|s| s.id == storage_id)
        });
    }
    if !matches!(job.step, TransferJobStep::Collect | TransferJobStep::Fee) {
        return false;
    }
    pick_up_at(world, job.from_city_id.as_deref(), t)
        .is_some_and(|i| world.buildings[i].id == storage_id)
}

/// Transfers hold together (`transfers-sound`).
pub fn transfers_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |id: &str, message: String| {
        out.push(InvariantViolation {
            invariant: "transfers-sound".into(),
            message,
            entity_ids: vec![id.to_string()],
        });
    };
    let n = crate::queries::warehouse_trade::js_number;
    let whole = |x: f64| x.is_finite() && x.fract() == 0.0;
    for t in &world.transfers {
        if !whole(t.units) || t.units <= 0.0 {
            fail(&t.id, format!("transfer {} is for {} units", t.id, n(t.units)));
        }
        if t.units > transfer_load(t.good) {
            fail(&t.id, format!("transfer {} is more than one load", t.id));
        }
        if !whole(t.fee) || t.fee < 0.0 {
            fail(&t.id, format!("transfer {} has a fee of {}", t.id, n(t.fee)));
        }
        if !t.back && t.realm_id == t.to_realm_id {
            fail(&t.id, format!("transfer {} goes to its sender", t.id));
        }
        let due = t.carried_offer.as_ref().map_or(0.0, |c| c.due);
        if !whole(due) || due < 0.0 || (t.back && due > 0.0) {
            fail(&t.id, format!("transfer {} has {} coins due on unloading", t.id, n(due)));
        }
        let Some(cid) = &t.caravan_id else { continue };
        let c = world.caravans.iter().find(|x| &x.id == cid);
        if c.and_then(|c| c.transfer.as_ref()).map(|j| j.transfer_id.as_str())
            != Some(t.id.as_str())
        {
            fail(
                &t.id,
                format!("transfer {} is carried out by {}, whose job is another", t.id, cid),
            );
        }
    }
    for c in &world.caravans {
        let Some(job) = &c.transfer else { continue };
        if c.job.is_some() {
            fail(&c.id, format!("caravan {} carries out a delivery and a transfer at once", c.id));
        }
        let t = world.transfers.iter().find(|x| x.id == job.transfer_id);
        if job.step != TransferJobStep::Return
            && t.and_then(|t| t.caravan_id.as_deref()) != Some(c.id.as_str())
        {
            fail(
                &c.id,
                format!("caravan {} carries out {}, which isn't its own", c.id, job.transfer_id),
            );
        }
        let empty = Stock::new();
        let load =
            world.carriages.iter().find(|x| x.id == c.carriage_id).map_or(&empty, |k| &k.load);
        let coins = job.coins + if job.good == Good::Coins { job.units } else { 0.0 };
        // The crew eat the Food on board, a transfer's too.
        let short =
            job.good != Good::Food && job.good != Good::Coins && job.units > held(load, job.good);
        if short || coins > held(load, Good::Coins) {
            fail(
                &c.id,
                format!(
                    "caravan {} counts more on board for its transfer than its carriage holds",
                    c.id
                ),
            );
        }
        if job.units * good_weight(job.good) > DELIVERY_LOAD + 1e-9 {
            fail(&c.id, format!("caravan {} carries more than one load for its transfer", c.id));
        }
        if !whole(job.robbed) || job.robbed < 0.0 || t.is_some_and(|t| job.robbed > t.units) {
            fail(
                &c.id,
                format!(
                    "caravan {} counts {} units robbed, not within its transfer",
                    c.id,
                    n(job.robbed)
                ),
            );
        }
    }
    out
}
