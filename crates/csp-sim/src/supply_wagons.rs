//! A Trade Org army's supply wagon (`supply-wagons.ts`, `CONTEXT.md`: Trade Org debt, Supply line,
//! Caravan crew lost): a carriage of the HQ with a driver, which loads Food at the HQ, follows the
//! soldiers and takes on what they took, comes home with them and unloads into the warehouses. The
//! soldiers refill from it. Taking from it or stealing it is a crime like any against the Trade
//! Organization; without it they go on with what they carry. It outlives its army: with nobody left
//! to follow it goes home by itself. Plain data (ADR 0002); each tick the game gives its driver
//! orders a Player could give.

use std::collections::HashSet;

use csp_shared::balance::{trip_food, wagon_food_for, CARAVAN_SPREAD, OWN_FOOD, TRADE_ORG_PUNISH};
use csp_shared::footprint::{is_at, middle_of};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    BuildingKind, City, DriveOrder, DropOrder, Good, GoodsSpot, PickUpOrder, Punishment,
    PunishmentHeading, ResidentOrder, Stock, SupplyWagon, Tile, WagonHolding, WorldState,
};

use crate::caravans::{free_hands, horse_lies_down, new_caravan_carriage};
use crate::goods_deps::new_id;
use crate::npc_behaviour::{npc_home, walk_to};
use crate::queries::army::army_spot;
use crate::queries::carriages::carriage_capacity;
use crate::queries::city::town_hall_of;
use crate::queries::city_area::in_city_area;
use crate::queries::goods::{units_that_fit, units_that_fit_carriage};
use crate::queries::names::{held, placed};
use crate::queries::residents::{can_work, is_down};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse::warehouse_keeps;
use crate::sight::InvariantViolation;
use crate::trade_org::hq_layout;
use crate::trade_org_punishment::{fetch_food, food_in, taken_by, worth_of, Own};

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

fn dist(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    wrap_distance(size, tile(a.0, a.1), tile(b.0, b.1))
}

/// The punishment `pi` of the Trade Org HQ `hq` sets out with a supply wagon, for a city `tiles`
/// away (`sendWagon`): a new carriage with a horse at the HQ's goods warehouse, and the nearest free
/// adult of the HQ to drive it (`free_hands`). With nobody free it goes without.
pub fn send_wagon(world: &mut WorldState, hq: &City, pi: usize, tiles: f64, size: i32) {
    let Some(hall) = town_hall_of(world, hq) else { return };
    // `middleOf(hall)` with the map's size left out: the TypeScript's default.
    let (mx, my) = middle_of(placed(hall), csp_shared::balance::MAP_SIZE);
    let (x, y) = hq_layout(mx, my).goods_warehouse;
    let (x, y) = (f64::from(x), f64::from(y));
    let free = free_hands(world, Some(&hq.id));
    if free.is_empty() {
        return;
    }
    let d = |i: usize| dist(size, (world.residents[i].x, world.residents[i].y), (x, y));
    // `reduce` keeping `b` only when strictly nearer: the first of the nearest.
    let mut driver = free[0];
    for &b in &free[1..] {
        if d(b) < d(driver) {
            driver = b;
        }
    }
    world.residents[driver].order = None;
    let p = &world.punishments[pi];
    let (pid, members) = (p.id.clone(), p.members.len() as f64);
    let id = new_id(world, "wagon");
    let seed = format!("{}:wagon-horse:{pid}", world.seed);
    let carriage_id = new_caravan_carriage(world, &hq.id, x, y, &seed);
    let driver_id = world.residents[driver].id.clone();
    world.supply_wagons.push(SupplyWagon {
        id,
        punishment_id: Some(pid),
        carriage_id,
        driver_id: Some(driver_id),
        food: wagon_food_for(tiles, members),
        own_food: 0.0,
        loaded: None,
        sent_out: None,
        holding: None,
    });
}

/// The supply wagon following a punishment, if it has one, with its carriage (`wagonOf`): (wagon,
/// carriage) indices.
pub fn wagon_of(world: &WorldState, p: &Punishment) -> Option<(usize, usize)> {
    let wi = world.supply_wagons.iter().position(|w| w.punishment_id.as_ref() == Some(&p.id))?;
    let ki = world.carriages.iter().position(|k| k.id == world.supply_wagons[wi].carriage_id)?;
    Some((wi, ki))
}

/// What on a wagon's carriage was taken (`takenOn`): all of it but the Food it set out with.
fn taken_on(wagon: &SupplyWagon, load: &Stock) -> Stock {
    let mut load = load.clone();
    let food = held(&load, Good::Food) - wagon.own_food;
    if food > 0.0 {
        load.insert(Good::Food, food);
    } else {
        load.shift_remove(&Good::Food);
    }
    load
}

/// The Coins' worth of what a punishment's army took that lies on its supply wagon (`wagonTook`).
pub fn wagon_took(world: &WorldState, p: &Punishment) -> f64 {
    wagon_of(world, p).map_or(0.0, |(wi, ki)| {
        worth_of(&taken_on(&world.supply_wagons[wi], &world.carriages[ki].load))
    })
}

/// The carriage a resident may refill from as a supply wagon (`wagonFood`, `CONTEXT.md`: Supply
/// line), by index: a soldier of the punishment it follows, or whoever drives it, with its carriage
/// within `CARAVAN_SPREAD` tiles and Food on it.
pub fn wagon_food(world: &WorldState, ri: usize, size: i32) -> Option<usize> {
    let r = &world.residents[ri];
    if r.owner.is_some() || world.supply_wagons.is_empty() {
        return None;
    }
    let wagon = world.supply_wagons.iter().find(|w| {
        w.driver_id.as_ref() == Some(&r.id)
            || world
                .punishments
                .iter()
                .find(|p| w.punishment_id.as_ref() == Some(&p.id))
                .is_some_and(|p| p.members.iter().any(|m| m.resident_id == r.id))
    })?;
    let ki = world.carriages.iter().position(|k| k.id == wagon.carriage_id)?;
    let k = &world.carriages[ki];
    if held(&k.load, Good::Food) <= 0.0 {
        return None;
    }
    (dist(size, (r.x, r.y), (k.x, k.y)) <= CARAVAN_SPREAD).then_some(ki)
}

/// A soldier running out of Food whose wagon has some but is out of reach to refill from goes to
/// meet it (`goToWagonForFood`; the wagon is on its way to them too). Answers whether they are
/// doing that.
pub fn go_to_wagon_for_food(world: &mut WorldState, ri: usize, ki: usize, size: i32) -> bool {
    let k = &world.carriages[ki];
    let r = &world.residents[ri];
    if held(&r.carried, Good::Food) >= OWN_FOOD || held(&k.load, Good::Food) <= 0.0 {
        return false;
    }
    let at = (k.x, k.y);
    if dist(size, (r.x, r.y), at) <= CARAVAN_SPREAD {
        return false;
    }
    // Near enough where it was: a walk restarted at every step of the carriage would get nowhere.
    if let Some(ResidentOrder::WalkTo(o)) = &r.order {
        if dist(size, (o.target.x, o.target.y), at) <= CARAVAN_SPREAD {
            return true;
        }
    }
    walk_to(&mut world.residents[ri], at);
    true
}

/// A soldier (member `mi` of punishment `pi`) who took goods and has their wagon within
/// `TRADE_ORG_PUNISH.wagon_reach` tiles, with room on it, carries them over and puts them on it
/// (`loadOnWagon`). Answers whether they are doing that.
pub fn load_on_wagon(
    world: &mut WorldState,
    ri: usize,
    pi: usize,
    mi: usize,
    ki: usize,
    size: i32,
) -> bool {
    let r = &world.residents[ri];
    let k = &world.carriages[ki];
    if dist(size, (r.x, r.y), (k.x, k.y)) > TRADE_ORG_PUNISH.wagon_reach {
        return false;
    }
    let mut goods = Stock::new();
    for (g, n) in taken_by(r, &world.punishments[pi].members[mi].own) {
        if units_that_fit_carriage(world, k, g) >= 1.0 {
            goods.insert(g, n);
        }
    }
    if goods.is_empty() {
        return false;
    }
    let (kx, ky, kid) = (k.x, k.y, k.id.clone());
    if r.x == kx && r.y == ky {
        let order =
            ResidentOrder::Drop(DropOrder { to: GoodsSpot::Carriage { carriage_id: kid }, goods });
        world.residents[ri].order = Some(order);
        return true;
    }
    let going =
        matches!(&r.order, Some(ResidentOrder::WalkTo(o)) if o.target.x == kx && o.target.y == ky);
    if !going {
        walk_to(&mut world.residents[ri], (kx, ky));
    }
    true
}

/// The driver leaves the wagon, which is done with them (`release`): one away from the HQ walks
/// home.
fn release(world: &mut WorldState, wagon: &SupplyWagon, size: i32) {
    let Some(di) = world.residents.iter().position(|r| wagon.driver_id.as_ref() == Some(&r.id))
    else {
        return;
    };
    world.residents[di].order = None;
    let Some(hq) = trade_org_hq(world) else { return };
    let Some(home) = npc_home(world, &hq.id).map(|h| (h.x, h.y)) else { return };
    let r = &world.residents[di];
    if !in_city_area(world, &hq.id, r.x, r.y, size) {
        walk_to(&mut world.residents[di], home);
    }
}

/// Its carriage was stolen (`wagonStolen`, `CONTEXT.md`: Stealing a carriage or horse): the army
/// goes on with what it carries, and the carriage is the thief's with all on it. The driver walks
/// home.
pub fn wagon_stolen(world: &mut WorldState, carriage_id: &str, size: i32) {
    let Some(wi) = world.supply_wagons.iter().position(|w| w.carriage_id == carriage_id) else {
        return;
    };
    let wagon = world.supply_wagons.remove(wi);
    release(world, &wagon, size);
}

/// The driver is gone (`replaceDriver`, `CONTEXT.md`: Caravan crew lost): a soldier of its army
/// takes over driving, the nearest who is up, bringing on board what they took, so long as that
/// leaves the army someone; otherwise there is no driver for now and the HQ sends one.
fn replace_driver(world: &mut WorldState, wi: usize, ki: usize, pi: Option<usize>, size: i32) {
    let w = &mut world.supply_wagons[wi];
    w.driver_id = None;
    w.holding = None;
    let Some(pi) = pi else { return };
    let resident = |id: &str| world.residents.iter().position(|r| r.id == id);
    let p = &world.punishments[pi];
    let alive: Vec<(usize, usize)> = p
        .members
        .iter()
        .enumerate()
        .filter_map(|(mi, m)| {
            let ri = resident(&m.resident_id)?;
            (world.residents[ri].health > 0.0).then_some((mi, ri))
        })
        .collect();
    let up: Vec<(usize, usize)> =
        alive.iter().copied().filter(|&(_, ri)| !is_down(world.residents[ri].down_until)).collect();
    if alive.len() < 2 || up.is_empty() {
        return;
    }
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    let d = |ri: usize| dist(size, (world.residents[ri].x, world.residents[ri].y), k);
    let mut nearest = up[0];
    for &b in &up[1..] {
        if d(b.1) < d(nearest.1) {
            nearest = b;
        }
    }
    let (mi, ri) = nearest;
    let member = world.punishments[pi].members.remove(mi);
    let r = &world.residents[ri];
    let taken = taken_by(r, &member.own);
    let rid = r.id.clone();
    world.residents[ri].order = None;
    let kid = world.carriages[ki].id.clone();
    let w = &mut world.supply_wagons[wi];
    w.driver_id = Some(rid);
    if !taken.is_empty() {
        w.holding =
            Some(WagonHolding { goods: taken, to: GoodsSpot::Carriage { carriage_id: kid } });
    }
}

/// With no crew left the HQ sends a new driver on foot, the nearest to the carriage of those free,
/// once it has one (`sendDriver`, `CONTEXT.md`: Caravan crew lost). They pack Food for the walk
/// first.
fn send_driver(world: &mut WorldState, wi: usize, ki: usize, hq: &City, size: i32) {
    let free = free_hands(world, Some(&hq.id));
    if free.is_empty() {
        return;
    }
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    let d = |i: usize| dist(size, (world.residents[i].x, world.residents[i].y), k);
    let mut nearest = free[0];
    for &b in &free[1..] {
        if d(b) < d(nearest) {
            nearest = b;
        }
    }
    world.residents[nearest].order = None;
    let id = world.residents[nearest].id.clone();
    let w = &mut world.supply_wagons[wi];
    w.driver_id = Some(id);
    w.sent_out = Some(true);
}

/// The driver drives the carriage to a tile, or with `army` after that punishment's soldiers
/// (`driveTo`). With its horse Down it stands instead, until the horse wakes or dies.
fn drive_to(world: &mut WorldState, di: usize, ki: usize, to: (f64, f64), army: Option<String>) {
    if horse_lies_down(world, ki) {
        return;
    }
    let carriage_id = world.carriages[ki].id.clone();
    world.residents[di].order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id,
        target: Tile { x: to.0, y: to.1 },
        path: None,
        progress: 0.0,
        army,
        near: None,
    }));
}

/// The driver's next take at a stop (`take`): `goods` from `from`, to put down next tick at `to`.
fn take(
    world: &mut WorldState,
    wi: usize,
    di: usize,
    from: GoodsSpot,
    goods: Stock,
    to: GoodsSpot,
) {
    world.residents[di].order =
        Some(ResidentOrder::PickUp(PickUpOrder { from, goods: goods.clone() }));
    world.supply_wagons[wi].holding = Some(WagonHolding { goods, to });
}

/// The goods the driver holds for the wagon go down where they were meant to (`putDown`).
fn put_down(world: &mut WorldState, wi: usize, di: usize) -> bool {
    let Some(WagonHolding { goods, to }) = world.supply_wagons[wi].holding.take() else {
        return false;
    };
    let carried = &world.residents[di].carried;
    let mut on_hand = Stock::new();
    for (&g, &units) in &goods {
        let n = units.min(held(carried, g).floor());
        if n > 0.0 {
            on_hand.insert(g, n);
        }
    }
    if on_hand.is_empty() {
        return false;
    }
    let food = held(&on_hand, Good::Food);
    let to_carriage = matches!(to, GoodsSpot::Carriage { .. });
    world.residents[di].order = Some(ResidentOrder::Drop(DropOrder { to, goods: on_hand }));
    // Food put on while loading is the wagon's own, not what the army took.
    let w = &mut world.supply_wagons[wi];
    if w.loaded != Some(true) && to_carriage {
        w.own_food += food;
    }
    true
}

/// The first of the nearest of `stores` to (x, y).
fn nearest(world: &WorldState, stores: &[usize], at: (f64, f64), size: i32) -> usize {
    let d = |b: usize| dist(size, at, (world.buildings[b].x, world.buildings[b].y));
    let mut best = stores[0];
    for &b in &stores[1..] {
        if d(b) < d(best) {
            best = b;
        }
    }
    best
}

/// Loading at the HQ (`loadFood`): the driver brings Food from its storage, or its warehouses where
/// that has none (`food_in`), up to what the wagon means to set out with, keeping
/// `TRADE_ORG_PUNISH.wagon_room` free. Once it has that, or the HQ has no more, it is loaded.
/// Answers whether they are seeing to it.
fn load_food(
    world: &mut WorldState,
    wi: usize,
    di: usize,
    ki: usize,
    hq: &City,
    size: i32,
) -> bool {
    let k = &world.carriages[ki];
    let most = carriage_capacity(world, k) - TRADE_ORG_PUNISH.wagon_room;
    let wanted = (world.supply_wagons[wi].food.min(most) - held(&k.load, Good::Food)).floor();
    let stores = food_in(world, &HashSet::from([hq.id.clone()]));
    if wanted < 1.0 || stores.is_empty() {
        world.supply_wagons[wi].loaded = Some(true);
        return false;
    }
    let si = nearest(world, &stores, (k.x, k.y), size);
    let store = &world.buildings[si];
    let driver = &world.residents[di];
    if !is_at(tile(driver.x, driver.y), placed(store), size) {
        let to = (store.x, store.y);
        drive_to(world, di, ki, to, None);
        return true;
    }
    let food = wanted
        .min(held(store.stock.as_ref().expect("has Food"), Good::Food).floor())
        .min(units_that_fit(driver, Good::Food, world.tick as f64));
    if food < 1.0 {
        world.supply_wagons[wi].loaded = Some(true);
        return false;
    }
    let from = GoodsSpot::Storage { storage_id: store.id.clone() };
    let to = GoodsSpot::Carriage { carriage_id: k.id.clone() };
    take(world, wi, di, from, [(Good::Food, food)].into_iter().collect(), to);
    true
}

/// The HQ's building a good goes into (`homeFor`): the warehouse that keeps it, or for one none
/// keeps its storage.
fn home_for(world: &WorldState, hq: &City, good: Good) -> Option<usize> {
    let own: Vec<usize> = (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            b.city_id.as_deref() == Some(hq.id.as_str()) && b.site.is_none()
        })
        .collect();
    own.iter()
        .copied()
        .find(|&i| warehouse_keeps(world, &world.buildings[i]).contains(&good))
        .or_else(|| own.iter().copied().find(|&i| world.buildings[i].kind == BuildingKind::Storage))
}

/// Home, its army's trip over (`unload`): the driver drives to where the first good on board goes
/// (`home_for`) and unloads it there through their hands, like a caravan. Answers false once there
/// is nothing left to unload, or nowhere to take it.
fn unload(world: &mut WorldState, wi: usize, di: usize, ki: usize, hq: &City, size: i32) -> bool {
    let load: Vec<(Good, f64)> = world.carriages[ki].load.iter().map(|(&g, &n)| (g, n)).collect();
    for (g, n) in load {
        if n < 1.0 {
            continue;
        }
        let Some(bi) = home_for(world, hq, g) else { continue };
        let b = &world.buildings[bi];
        let driver = &world.residents[di];
        if !is_at(tile(driver.x, driver.y), placed(b), size) {
            let to = (b.x, b.y);
            drive_to(world, di, ki, to, None);
            return true;
        }
        let units = n.floor().min(units_that_fit(driver, g, world.tick as f64));
        if units < 1.0 {
            continue;
        }
        let from = GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() };
        let to = GoodsSpot::Storage { storage_id: b.id.clone() };
        take(world, wi, di, from, [(g, units)].into_iter().collect(), to);
        return true;
    }
    false
}

/// Its trip is over (`retire`): what is left of the carriage and horse goes back into the HQ's
/// stock, as they came out of it (a carriage with goods it can't put anywhere stands where it is).
fn retire(world: &mut WorldState, ki: usize) {
    if world.carriages[ki].load.values().any(|&n| n >= 1.0) {
        return;
    }
    let k = world.carriages.remove(ki);
    world.horses.retain(|h| k.horse_id.as_ref() != Some(&h.id));
}

/// A driver on the way to where the army was goes after it step by step once within
/// `TRADE_ORG_PUNISH.wagon_follow_reach` tiles of it; one going after it step by step who has
/// fallen twice as far behind drives to where it is now (`keepAfterArmy`).
fn keep_after_army(world: &mut WorldState, wi: usize, di: usize, ki: usize, pid: &str, size: i32) {
    let Some(ResidentOrder::Drive(o)) = &world.residents[di].order else { return };
    if world.supply_wagons[wi].loaded != Some(true) {
        return;
    }
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    let Some(spot) = army_spot(world, pid, k, size) else { return };
    let tiles = dist(size, k, spot);
    let reach = TRADE_ORG_PUNISH.wagon_follow_reach;
    if o.army.is_none() && tiles <= reach {
        drive_to(world, di, ki, spot, Some(pid.to_string()));
    } else if o.army.is_some() && tiles > 2.0 * reach {
        drive_to(world, di, ki, spot, None);
    }
}

/// One tick of supply wagon `wi`, answering whether it goes on (`runWagon`). It ends once its
/// carriage is no longer the HQ's or has no horse to pull it, and once it is unloaded at home. A
/// driver who is gone is replaced (`replace_driver`, `send_driver`); one parted from the carriage
/// walks to it, packing first if they were sent on foot. A driver who is idle with the carriage
/// loads Food, then follows its army (`keep_after_army`), then comes home.
fn run_wagon(world: &mut WorldState, hq: &City, wi: usize, size: i32) -> bool {
    let wagon = world.supply_wagons[wi].clone();
    let ki = world.carriages.iter().position(|k| k.id == wagon.carriage_id);
    let Some(ki) = ki.filter(|&ki| {
        let k = &world.carriages[ki];
        k.realm_id.is_none() && k.city_id.as_deref() == Some(hq.id.as_str()) && k.horse_id.is_some()
    }) else {
        release(world, &wagon, size);
        return false;
    };
    let pi = world.punishments.iter().position(|x| wagon.punishment_id.as_ref() == Some(&x.id));
    let find_driver = |world: &WorldState| {
        let id = world.supply_wagons[wi].driver_id.clone();
        id.and_then(|id| world.residents.iter().position(|r| r.id == id))
    };
    if pi.is_none() && wagon.punishment_id.is_some() {
        world.supply_wagons[wi].punishment_id = None;
        // Its army is gone or home, so its drive after them is over.
        if let Some(di) = find_driver(world) {
            if matches!(&world.residents[di].order, Some(ResidentOrder::Drive(o)) if o.army.is_some())
            {
                world.residents[di].order = None;
            }
        }
    }
    let food = held(&world.carriages[ki].load, Good::Food);
    let w = &mut world.supply_wagons[wi];
    w.own_food = w.own_food.min(food);
    if world.supply_wagons[wi].driver_id.is_some() && find_driver(world).is_none() {
        replace_driver(world, wi, ki, pi, size);
    }
    if world.supply_wagons[wi].driver_id.is_none() {
        send_driver(world, wi, ki, hq, size);
    }
    let driver = find_driver(world);
    if let (Some(di), Some(pi)) = (driver, pi) {
        let pid = world.punishments[pi].id.clone();
        keep_after_army(world, wi, di, ki, &pid, size);
    }
    let Some(di) = driver else { return true };
    let r = &world.residents[di];
    if r.order.is_some() || is_down(r.down_until) || !can_work(r.born_at, world.tick as f64) {
        return true;
    }
    let k = &world.carriages[ki];
    if r.x != k.x || r.y != k.y {
        let at = (k.x, k.y);
        if world.supply_wagons[wi].sent_out == Some(true) {
            let wanted = trip_food(dist(size, (r.x, r.y), at));
            let hq_id = HashSet::from([hq.id.clone()]);
            let stores = move |w: &WorldState| food_in(w, &hq_id);
            if fetch_food(world, &stores, di, Own::Nobody, wanted, size) {
                if matches!(world.residents[di].order, Some(ResidentOrder::PickUp(_))) {
                    world.supply_wagons[wi].sent_out = None;
                }
                return true;
            }
            world.supply_wagons[wi].sent_out = None;
        }
        walk_to(&mut world.residents[di], at);
        return true;
    }
    if put_down(world, wi, di) {
        return true;
    }
    if world.supply_wagons[wi].loaded != Some(true) {
        let out = pi.is_some_and(|pi| world.punishments[pi].heading == PunishmentHeading::Out);
        if !out {
            world.supply_wagons[wi].loaded = Some(true);
        } else if load_food(world, wi, di, ki, hq, size) {
            return true;
        }
    }
    if let Some(pi) = pi {
        if world.tick as f64 % TRADE_ORG_PUNISH.wagon_retry_ticks != 0.0 {
            return true;
        }
        let pid = world.punishments[pi].id.clone();
        let r = &world.residents[di];
        if let Some(spot) = army_spot(world, &pid, (r.x, r.y), size) {
            let k = &world.carriages[ki];
            let near = dist(size, (k.x, k.y), spot) <= TRADE_ORG_PUNISH.wagon_follow_reach;
            drive_to(world, di, ki, spot, near.then_some(pid));
        }
        return true;
    }
    if unload(world, wi, di, ki, hq, size) {
        return true;
    }
    retire(world, ki);
    let wagon = world.supply_wagons[wi].clone();
    release(world, &wagon, size);
    false
}

/// One tick of the Trade Organization's supply wagons (`stepSupplyWagons`, `run_wagon`). Run after
/// its punishments.
pub fn step_supply_wagons(world: &mut WorldState, hq: &City, size: i32) {
    let mut wi = 0;
    while wi < world.supply_wagons.len() {
        if run_wagon(world, hq, wi, size) {
            wi += 1;
        } else {
            world.supply_wagons.remove(wi);
        }
    }
}

/// Supply wagons hold together (`supplyWagonsSound`, `CONTEXT.md`: Trade Org debt, Caravan crew
/// lost; ADR 0004): each has a carriage of the HQ and follows a punishment under way, at most one
/// to each, or none; its driver, if it has one, is one of the HQ's, on no other wagon or caravan
/// and none of its soldiers, and drives only its carriage; the Food it calls its own is no less than
/// none.
#[allow(clippy::neg_cmp_op_on_partial_ord)] // NaN fails it, as in the TypeScript.
pub fn supply_wagons_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |w: &SupplyWagon, message: String, ids: Vec<String>| {
        let mut entity_ids = vec![w.id.clone()];
        entity_ids.extend(ids);
        out.push(InvariantViolation {
            invariant: "supply-wagons-sound".into(),
            message: format!("supply wagon {} {message}", w.id),
            entity_ids,
        })
    };
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let mut followed = HashSet::new();
    let mut drivers = HashSet::new();
    let soldiers: HashSet<&str> = world
        .punishments
        .iter()
        .flat_map(|p| p.members.iter().map(|m| m.resident_id.as_str()))
        .collect();
    for w in &world.supply_wagons {
        match world.carriages.iter().find(|x| x.id == w.carriage_id) {
            None => fail(w, format!("has carriage {}, which doesn't exist", w.carriage_id), vec![]),
            Some(k) if k.realm_id.is_some() || k.city_id != hq => fail(
                w,
                format!("has carriage {}, which isn't the Trade Org HQ's", k.id),
                vec![k.id.clone()],
            ),
            _ => {}
        }
        if let Some(pid) = &w.punishment_id {
            if !world.punishments.iter().any(|p| &p.id == pid) {
                fail(w, format!("follows {pid}, which is no punishment under way"), vec![]);
            }
            if !followed.insert(pid.clone()) {
                fail(w, format!("shares {pid} with another wagon"), vec![]);
            }
        }
        if !(w.own_food >= 0.0) {
            fail(
                w,
                format!("calls {} Food its own", crate::invariants::js_number(w.own_food)),
                vec![],
            );
        }
        let Some(did) = &w.driver_id else { continue };
        let r = world.residents.iter().find(|x| &x.id == did);
        match r {
            None => fail(w, format!("has driver {did}, who doesn't exist"), vec![]),
            Some(r) if r.owner.is_some() || r.city_id != hq => fail(
                w,
                format!("has driver {}, who isn't of the Trade Org HQ", r.id),
                vec![r.id.clone()],
            ),
            _ => {}
        }
        if !drivers.insert(did.clone()) {
            fail(w, format!("shares its driver {did}"), vec![did.clone()]);
        }
        if soldiers.contains(did.as_str()) {
            fail(w, format!("is driven by its soldier {did}"), vec![did.clone()]);
        }
        if world
            .caravans
            .iter()
            .any(|c| c.driver_id.as_ref() == Some(did) || c.escort_ids.contains(did))
        {
            fail(w, format!("shares its driver {did} with a caravan"), vec![did.clone()]);
        }
        if let Some(ResidentOrder::Drive(o)) = r.and_then(|r| r.order.as_ref()) {
            if o.carriage_id != w.carriage_id {
                fail(w, format!("has its driver driving {}", o.carriage_id), vec![did.clone()]);
            }
        }
    }
    out
}
