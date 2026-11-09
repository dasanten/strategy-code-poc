//! Deliveries (`apps/server/src/deliveries.ts`, `CONTEXT.md`: Delivery, Guaranteed carriage): a
//! caravan standing at a warehouse takes on the oldest delivery or pick-up ordered there and
//! carries it out instead of going on along its route (`CaravanJob`), then goes back to its
//! route. Each step is one drive, pick-up or drop order of the driver's, which request actions
//! like a Player's do (ADR 0002).

use csp_shared::balance::{
    DELIVERY_DRIVE_TRIES, DELIVERY_LOAD, MAP_SIZE, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, CaravanJob, CaravanJobStep, CaravanStop, Delivery, DeliveryKind, DriveOrder,
    DropOrder, Good, GoodsSpot, Holding, Onto, PickUpOrder, RealmEventWhat, ResidentOrder, Stock,
    Tile, WorldState,
};

use crate::events::record_event;
use crate::goods_deps::raise_standing_both_ways;
use crate::queries::goods::{free_stock, units_that_fit, units_that_fit_carriage};
use crate::queries::names::{held, placed};
use crate::queries::residents::{good_weight, is_down};
use crate::queries::standing::TRADE_ORG;
use crate::queries::warehouse::trade_coin_warehouse;
use crate::queries::warehouse_trade::{delivery_storage, quote_pick_up};
use crate::sight::InvariantViolation;

/// Has caravan `ci`, standing at warehouse `warehouse_id`, take on the oldest delivery there that
/// waits for a caravan (`takeOnDelivery`). Returns whether it took one.
pub fn take_on_delivery(world: &mut WorldState, ci: usize, warehouse_id: &str) -> bool {
    let Some(di) = world
        .deliveries
        .iter()
        .position(|x| x.caravan_id.is_none() && x.warehouse_id == warehouse_id)
    else {
        return false;
    };
    let caravan_id = world.caravans[ci].id.clone();
    let d = &mut world.deliveries[di];
    d.caravan_id = Some(caravan_id);
    let job = CaravanJob {
        delivery_id: d.id.clone(),
        kind: d.kind,
        warehouse_id: d.warehouse_id.clone(),
        good: d.good,
        step: CaravanJobStep::Load,
        units: 0.0,
        coins: 0.0,
        target: None,
        to_pay: 0.0,
        paid: 0.0,
        fee: 0.0,
        misses: 0.0,
        robbed: 0.0,
    };
    world.caravans[ci].job = Some(job);
    true
}

/// Lets go of a caravan's delivery, which waits for the next caravan (`releaseDelivery`).
pub fn release_delivery(world: &mut WorldState, ci: usize) {
    let c = &world.caravans[ci];
    let Some(id) = c.job.as_ref().map(|j| j.delivery_id.clone()) else { return };
    let cid = c.id.clone();
    if let Some(d) = world.deliveries.iter_mut().find(|x| x.id == id) {
        if d.caravan_id.as_deref() == Some(cid.as_str()) {
            d.caravan_id = None;
        }
    }
}

/// The delivery a job is for, while it is still owed (`deliveryOf`).
fn delivery_of(world: &WorldState, job: &CaravanJob) -> Option<Delivery> {
    world.deliveries.iter().find(|d| d.id == job.delivery_id).cloned()
}

/// Drops a delivery that is done or cancelled (`drop`).
fn drop_delivery(world: &mut WorldState, id: &str) {
    world.deliveries.retain(|x| x.id != id);
}

fn delivery_mut<'w>(world: &'w mut WorldState, id: &str) -> Option<&'w mut Delivery> {
    world.deliveries.iter_mut().find(|x| x.id == id)
}

fn city_name(world: &WorldState, id: &str) -> Option<String> {
    world.cities.iter().find(|c| c.id == id).map(|c| c.name.clone())
}

/// The building a job's step happens at (`stepBuilding`): the warehouse, its coin warehouse or the
/// city's storage, by id.
fn step_building(world: &WorldState, job: &CaravanJob) -> Option<String> {
    let warehouse = world.buildings.iter().find(|b| b.id == job.warehouse_id)?;
    let pick_up_load = job.step == CaravanJobStep::Load && job.kind == DeliveryKind::PickUp;
    if job.step == CaravanJobStep::ReturnCoins || pick_up_load {
        return trade_coin_warehouse(world, warehouse).map(|b| b.id.clone());
    }
    if matches!(job.step, CaravanJobStep::Load | CaravanJobStep::Return) {
        return Some(warehouse.id.clone());
    }
    let d = delivery_of(world, job)?;
    delivery_storage(world, &d.city_id).map(|b| b.id.clone())
}

/// What a step ends in: the job goes on, or it ends and the caravan goes back to its route
/// (`finish`).
#[derive(PartialEq)]
enum Next {
    Goes,
    Finish,
}

/// The caravan turns back to the warehouse with what it carries for its delivery (`turnBack`).
fn turn_back(world: &mut WorldState, job: &mut CaravanJob, d: &Delivery) -> Next {
    let city = world.cities.iter().find(|c| c.id == d.city_id);
    let cancelled = city.map(|c| c.realm_id.as_deref()) != Some(Some(d.realm_id.as_str()));
    let name = city.map_or_else(|| "a lost city".to_string(), |c| c.name.clone());
    if cancelled {
        drop_delivery(world, &d.id);
    } else if let Some(x) = delivery_mut(world, &d.id) {
        x.caravan_id = None;
    }
    job.step = CaravanJobStep::Return;
    job.misses = 0.0;
    let what = RealmEventWhat::DeliveryStuck {
        delivery: d.kind,
        good: d.good,
        units: d.units,
        city_id: d.city_id.clone(),
        city: name,
        cancelled,
    };
    record_event(world, Some(&d.realm_id), what);
    Next::Goes
}

/// One tick of caravan `ci` carrying out a delivery (`runDelivery`), its driver `ri` idle with
/// carriage `ki` and `holding` what they took last tick for it. `size` is the map's.
pub fn run_delivery(world: &mut WorldState, ci: usize, ri: usize, ki: usize, size: i32) {
    let mut job = world.caravans[ci].job.clone().expect("a caravan with a job");
    let next = step_delivery(world, ci, ri, ki, size, &mut job);
    let c = &mut world.caravans[ci];
    if next == Next::Finish {
        c.job = None;
        c.stop = CaravanStop::Storage;
    } else {
        c.job = Some(job);
    }
}

fn spot(id: &str) -> GoodsSpot {
    GoodsSpot::Storage { storage_id: id.to_string() }
}

fn step_delivery(
    world: &mut WorldState,
    ci: usize,
    ri: usize,
    ki: usize,
    size: i32,
    job: &mut CaravanJob,
) -> Next {
    let load = &world.carriages[ki].load;
    job.units = job.units.min(held(load, job.good));
    job.coins = job.coins.min(held(load, Good::Coins));
    let d = delivery_of(world, job);
    let at_storage =
        matches!(job.step, CaravanJobStep::Deliver | CaravanJobStep::Collect | CaravanJobStep::Pay);
    if at_storage && d.is_none() {
        job.step = CaravanJobStep::Return;
        return Next::Goes;
    }
    if let (true, Some(d)) = (at_storage, &d) {
        let city = world.cities.iter().find(|c| c.id == d.city_id);
        let gone = city.map(|c| c.realm_id.as_deref()) != Some(Some(d.realm_id.as_str()))
            || delivery_storage(world, &d.city_id).is_none();
        // Halfway through paying it pays what it has paid and is done, as when the storage went.
        if gone && job.step == CaravanJobStep::Pay {
            paid_up(world, job, d);
            return Next::Goes;
        }
        if gone {
            return turn_back(world, job, d);
        }
    }
    // Robbed of all it carried for a delivery, it has nothing left to bring.
    let holding = world.caravans[ci].holding.clone();
    if let Some(d) = &d {
        if job.step == CaravanJobStep::Deliver
            && job.units == 0.0
            && job.robbed > 0.0
            && holding.is_none()
        {
            let storage = delivery_storage(world, &d.city_id).map(|b| b.id.clone());
            send_again(world, job, d, storage.as_deref());
            return Next::Goes;
        }
    }
    let Some(b) = step_building(world, job) else { return Next::Finish };
    let bi = world.buildings.iter().position(|x| x.id == b).expect("a building");
    let driver = &world.residents[ri];
    if !is_at((driver.x as i32, driver.y as i32), placed(&world.buildings[bi]), MAP_SIZE) {
        // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
        let k = &world.carriages[ki];
        let horse = k.horse_id.as_deref().and_then(|h| world.horses.iter().find(|x| x.id == h));
        if horse.is_some_and(|h| is_down(h.down_until)) {
            return Next::Goes;
        }
        if at_storage && job.misses >= DELIVERY_DRIVE_TRIES {
            return turn_back(world, job, d.as_ref().expect("at the storage"));
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
    let here = spot(&b);
    let on_carriage = GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() };
    // What the job counts on board changes with each order that puts onto or takes off the
    // carriage, so it matches the carriage once the tick's actions are resolved.
    let count = |job: &mut CaravanJob, good: Good, units: f64| {
        if good == Good::Coins {
            job.coins += units;
        } else {
            job.units += units;
        }
    };
    if let Some(Holding { goods, onto }) = holding {
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
            if onto == Onto::Carriage {
                count(job, good, units);
            }
            if good == Good::Coins && job.step == CaravanJobStep::Pay {
                job.paid += units;
            }
            return Next::Goes;
        }
    }
    // A pick-up leaves what is set aside for an offer alone (`CONTEXT.md`: Offer).
    let stock = free_stock(world, &b, world.buildings[bi].stock.as_ref());
    let tick = world.tick as f64;
    let hands = |world: &WorldState, g: Good| units_that_fit(&world.residents[ri], g, tick);
    let fits_carriage =
        |world: &WorldState, g: Good| units_that_fit_carriage(world, &world.carriages[ki], g);
    let take = |world: &mut WorldState,
                job: &mut CaravanJob,
                from: GoodsSpot,
                good: Good,
                units: f64,
                onto: Onto| {
        let goods = Stock::from([(good, units)]);
        let is_carriage = matches!(from, GoodsSpot::Carriage { .. });
        world.residents[ri].order =
            Some(ResidentOrder::PickUp(PickUpOrder { from, goods: goods.clone() }));
        world.caravans[ci].holding = Some(Holding { goods, onto });
        if is_carriage {
            count(job, good, -units);
        }
        Next::Goes
    };
    let g = job.good;
    let tiles = |world: &WorldState, storage: &Building| {
        let w = world.buildings.iter().find(|x| x.id == job.warehouse_id);
        w.map_or(0.0, |w| {
            wrap_distance(size, (w.x as i32, w.y as i32), (storage.x as i32, storage.y as i32))
        })
    };
    match job.step {
        CaravanJobStep::Load => {
            if job.kind == DeliveryKind::Delivery {
                let want = d.as_ref().map_or(0.0, |d| d.units) - job.units;
                let units =
                    want.min(held(&stock, g)).min(hands(world, g)).min(fits_carriage(world, g));
                if units > 0.0 {
                    return take(world, job, here, g, units, Onto::Carriage);
                }
                // Nothing to load yet: it waits at the warehouse for its stock.
                if job.units == 0.0 && want > 0.0 && held(&stock, g) == 0.0 {
                    return Next::Goes;
                }
                job.step = CaravanJobStep::Deliver;
                return Next::Goes;
            }
            // A pick-up loads the coins its goods fetch at the warehouse's prices now, or, robbed
            // while it paid, what it has still to pay.
            let paying = job.target.is_some();
            let need = if paying {
                job.to_pay - job.paid
            } else {
                let storage = d.as_ref().and_then(|d| delivery_storage(world, &d.city_id));
                let warehouse = world.buildings.iter().find(|x| x.id == job.warehouse_id);
                match (d.as_ref(), storage, warehouse) {
                    (Some(d), Some(s), Some(w)) => {
                        let t = tiles(world, s);
                        quote_pick_up(world, w, g, d.units, d.units, t, f64::INFINITY).coins
                    }
                    _ => 0.0,
                }
            };
            let units = (need - job.coins)
                .min(held(&stock, Good::Coins))
                .min(hands(world, Good::Coins))
                .min(fits_carriage(world, Good::Coins));
            if units > 0.0 {
                return take(world, job, here, Good::Coins, units, Onto::Carriage);
            }
            // With no coins to pay with, it waits at the coin warehouse for some.
            if paying && need > 0.0 && job.coins == 0.0 {
                return Next::Goes;
            }
            job.step = if paying { CaravanJobStep::Pay } else { CaravanJobStep::Collect };
            Next::Goes
        }
        CaravanJobStep::Deliver => {
            job.target.get_or_insert(job.units);
            let units = job.units.min(hands(world, g));
            if units > 0.0 {
                return take(world, job, on_carriage, g, units, Onto::Stop);
            }
            let d = d.expect("checked at the storage");
            if job.robbed > 0.0 {
                send_again(world, job, &d, Some(&b));
                return Next::Goes;
            }
            delivered_all(world, job, &d, bi);
            job.step = CaravanJobStep::Return;
            Next::Goes
        }
        CaravanJobStep::Collect => {
            let d = d.expect("checked at the storage");
            let warehouse = world.buildings.iter().position(|x| x.id == job.warehouse_id);
            if job.target.is_none() {
                let q = match warehouse {
                    Some(w) => {
                        let t = tiles(world, &world.buildings[bi]);
                        quote_pick_up(
                            world,
                            &world.buildings[w],
                            g,
                            d.units,
                            held(&stock, g),
                            t,
                            job.coins,
                        )
                        .units
                    }
                    None => 0.0,
                };
                job.target = Some(q.min(fits_carriage(world, g)));
            }
            // What robbers took off the carriage was collected all the same.
            let collected = job.units + job.robbed;
            let units = (job.target.unwrap() - collected)
                .min(held(&stock, g))
                .min(hands(world, g))
                .min(fits_carriage(world, g));
            if units > 0.0 {
                return take(world, job, here, g, units, Onto::Carriage);
            }
            let (coins, fee) = match warehouse {
                Some(w) => {
                    let t = tiles(world, &world.buildings[bi]);
                    let q = quote_pick_up(
                        world,
                        &world.buildings[w],
                        g,
                        collected,
                        collected,
                        t,
                        f64::INFINITY,
                    );
                    (q.coins, q.fee)
                }
                None => (0.0, 0.0),
            };
            job.to_pay = coins;
            job.fee = fee;
            job.step = CaravanJobStep::Pay;
            Next::Goes
        }
        CaravanJobStep::Pay => {
            let units = (job.to_pay - job.paid).min(job.coins).min(hands(world, Good::Coins));
            if units > 0.0 {
                return take(world, job, on_carriage, Good::Coins, units, Onto::Stop);
            }
            // Short of coins (robbed, or the price rose), it fetches the rest at the coin warehouse.
            if job.paid < job.to_pay && job.coins == 0.0 {
                job.step = CaravanJobStep::Load;
                return Next::Goes;
            }
            paid_up(world, job, &d.expect("checked at the storage"));
            Next::Goes
        }
        CaravanJobStep::Return => {
            let units = job.units.min(hands(world, g));
            if units > 0.0 {
                return take(world, job, on_carriage, g, units, Onto::Stop);
            }
            if job.coins > 0.0 {
                job.step = CaravanJobStep::ReturnCoins;
                Next::Goes
            } else {
                Next::Finish
            }
        }
        CaravanJobStep::ReturnCoins => {
            let units = job.coins.min(hands(world, Good::Coins));
            if units > 0.0 {
                return take(world, job, on_carriage, Good::Coins, units, Onto::Stop);
            }
            Next::Finish
        }
    }
}

/// A delivery's goods are all in the city's storage: it is done (`deliveredAll`).
fn delivered_all(world: &mut WorldState, job: &CaravanJob, d: &Delivery, bi: usize) {
    drop_delivery(world, &d.id);
    let what = RealmEventWhat::Delivered {
        delivery: DeliveryKind::Delivery,
        good: d.good,
        units: job.target.unwrap_or(0.0),
        coins: 0.0,
        fee: d.fee,
        city_id: d.city_id.clone(),
        city: city_name(world, &d.city_id).unwrap_or_default(),
        x: world.buildings[bi].x,
        y: world.buildings[bi].y,
    };
    record_event(world, Some(&d.realm_id), what);
}

/// Robbers took some of a delivery off the caravan, which put the rest into the city's storage
/// `b` (none when it had nothing left to bring): what was taken is sent again (`sendAgain`).
fn send_again(world: &mut WorldState, job: &mut CaravanJob, d: &Delivery, b: Option<&str>) {
    let city = city_name(world, &d.city_id).unwrap_or_default();
    let at = b.and_then(|id| world.buildings.iter().find(|x| x.id == id)).map(|x| (x.x, x.y));
    if let (Some((x, y)), Some(target)) = (at, job.target.filter(|t| *t > 0.0)) {
        let what = RealmEventWhat::Delivered {
            delivery: DeliveryKind::Delivery,
            good: d.good,
            units: target,
            coins: 0.0,
            fee: d.fee,
            city_id: d.city_id.clone(),
            city: city.clone(),
            x,
            y,
        };
        record_event(world, Some(&d.realm_id), what);
    }
    let what = RealmEventWhat::DeliveryRobbed {
        good: d.good,
        units: job.robbed,
        city_id: d.city_id.clone(),
        city,
    };
    record_event(world, Some(&d.realm_id), what);
    if let Some(x) = delivery_mut(world, &d.id) {
        x.units = job.robbed;
        x.caravan_id = None;
    }
    job.robbed = 0.0;
    job.step = CaravanJobStep::Return;
}

/// Robbers took goods off caravan `ci`'s carriage (`deliveryRobbed`): what its job counts on board
/// is cut down to what is left.
pub fn delivery_robbed(world: &mut WorldState, ci: usize, ki: usize) {
    let load = world.carriages[ki].load.clone();
    let Some(job) = world.caravans[ci].job.as_mut() else { return };
    let units = job.units.min(held(&load, job.good));
    let coins = job.coins.min(held(&load, Good::Coins));
    let lost = job.units - units;
    let coins_lost = job.coins - coins;
    job.units = units;
    job.coins = coins;
    let collected = job.kind == DeliveryKind::PickUp
        && job.target.is_some()
        && matches!(job.step, CaravanJobStep::Load | CaravanJobStep::Collect | CaravanJobStep::Pay);
    if job.step == CaravanJobStep::Deliver || collected {
        job.robbed += lost;
    }
    // What was put into the storage is the rest: the target less what was taken.
    if job.step == CaravanJobStep::Deliver {
        if let Some(t) = job.target.as_mut() {
            *t -= lost;
        }
    }
    if coins_lost > 0.0 && job.step == CaravanJobStep::Collect && job.target.is_none() {
        job.step = CaravanJobStep::Load;
    }
}

/// A pick-up is paid for: it is done, and the caravan brings the goods to the warehouse
/// (`paidUp`).
fn paid_up(world: &mut WorldState, job: &mut CaravanJob, d: &Delivery) {
    drop_delivery(world, &d.id);
    // Paying for goods sold is trade, which raises standing (`CONTEXT.md`: Standing).
    if job.paid > 0.0 {
        let points = job.paid / STANDING_TRADE_COINS_PER_POINT;
        raise_standing_both_ways(world, &d.realm_id, TRADE_ORG, points);
    }
    let at = delivery_storage(world, &d.city_id).map(|s| (s.x, s.y)).unwrap_or((0.0, 0.0));
    let what = RealmEventWhat::Delivered {
        delivery: DeliveryKind::PickUp,
        good: d.good,
        units: job.units + job.robbed,
        coins: job.paid,
        fee: job.fee,
        city_id: d.city_id.clone(),
        city: city_name(world, &d.city_id).unwrap_or_default(),
        x: at.0,
        y: at.1,
    };
    record_event(world, Some(&d.realm_id), what);
    job.step = CaravanJobStep::Return;
}

/// Whether resident `r` takes from storage `storage_id` for a pick-up (`collectsFrom`).
pub fn collects_from(
    world: &WorldState,
    r: &csp_shared::world::Resident,
    storage_id: &str,
) -> bool {
    let job = world
        .caravans
        .iter()
        .find(|c| c.driver_id.as_deref() == Some(r.id.as_str()))
        .and_then(|c| c.job.as_ref());
    let Some(job) = job.filter(|j| j.step == CaravanJobStep::Collect) else { return false };
    delivery_of(world, job)
        .is_some_and(|d| delivery_storage(world, &d.city_id).is_some_and(|s| s.id == storage_id))
}

/// Deliveries hold together (`deliveries-sound`).
pub fn deliveries_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |id: &str, message: String| {
        out.push(InvariantViolation {
            invariant: "deliveries-sound".into(),
            message,
            entity_ids: vec![id.to_string()],
        });
    };
    let n = crate::queries::warehouse_trade::js_number;
    for d in &world.deliveries {
        if !(d.units.fract() == 0.0 && d.units.is_finite()) || d.units <= 0.0 {
            fail(&d.id, format!("delivery {} is for {} units", d.id, n(d.units)));
        }
        if d.units * good_weight(d.good) > DELIVERY_LOAD + 1e-9 {
            fail(&d.id, format!("delivery {} weighs more than one delivery load", d.id));
        }
        // `!(fee >= 0)`: also a fee that is not a number.
        if d.fee.is_nan() || d.fee < 0.0 {
            fail(&d.id, format!("delivery {} has a fee of {}", d.id, n(d.fee)));
        }
        let Some(cid) = &d.caravan_id else { continue };
        let c = world.caravans.iter().find(|x| &x.id == cid);
        if c.and_then(|c| c.job.as_ref()).map(|j| j.delivery_id.as_str()) != Some(d.id.as_str()) {
            fail(
                &d.id,
                format!("delivery {} is carried out by {}, whose job is another", d.id, cid),
            );
        }
    }
    for c in &world.caravans {
        let Some(job) = &c.job else { continue };
        let d = world.deliveries.iter().find(|x| x.id == job.delivery_id);
        let owed = matches!(
            job.step,
            CaravanJobStep::Load
                | CaravanJobStep::Deliver
                | CaravanJobStep::Collect
                | CaravanJobStep::Pay
        );
        if owed && d.and_then(|d| d.caravan_id.as_deref()) != Some(c.id.as_str()) {
            fail(
                &c.id,
                format!("caravan {} carries out {}, which isn't its own", c.id, job.delivery_id),
            );
        }
        let empty = Stock::new();
        let load =
            world.carriages.iter().find(|x| x.id == c.carriage_id).map_or(&empty, |k| &k.load);
        // The crew eat the Food on board, a delivery's too.
        let short = job.good != Good::Food && job.units > held(load, job.good);
        if short || job.coins > held(load, Good::Coins) {
            fail(
                &c.id,
                format!(
                    "caravan {} counts more on board for its delivery than its carriage holds",
                    c.id
                ),
            );
        }
        if job.units * good_weight(job.good) > DELIVERY_LOAD + 1e-9 {
            fail(
                &c.id,
                format!("caravan {} carries more than one delivery load for its delivery", c.id),
            );
        }
        let whole = job.robbed.is_finite() && job.robbed.fract() == 0.0;
        if !whole || job.robbed < 0.0 || d.is_some_and(|d| job.robbed > d.units) {
            fail(
                &c.id,
                format!(
                    "caravan {} counts {} units robbed, not within its delivery",
                    c.id,
                    n(job.robbed)
                ),
            );
        }
    }
    out
}
