//! Caravans (`apps/server/src/caravans.ts`, `CONTEXT.md`: Caravan, Caravan crew lost, Waiting
//! for Food, Guaranteed carriage): the Trade Organization's carriages, each on the fixed route
//! between one trading post and the HQ, driven by an HQ resident and escorted by others on foot.
//! The caravan is plain data (ADR 0002); each tick the game gives its crew drive, pick-up, drop
//! and walk orders, which request actions like a Player's do.

use std::collections::HashSet;

use csp_shared::balance::{
    CARAVAN_ESCORTS, CARAVAN_ESCORTS_MAX, CARAVAN_GUARD_RANGE, CARAVAN_ROBBERIES_PER_ESCORT,
    CARAVAN_SPREAD, CARRIAGE_CAPACITY, DEFEND_CALM_TICKS, FOOD_PER_DAY, HORSE_FOOD_PER_DAY,
    HQ_PEOPLE_FOOD_DAYS, MAP_SIZE, SET_OFF_FOOD_SLACK, START_CARRIED_FOOD, TRADER_ESCORTS,
    TRADER_STOP_TICKS, WAITING_HORSE_FOOD, WALK_TICKS_PER_TILE, WAY_FOOD_MARGIN,
};
use csp_shared::footprint::{is_at, middle_of};
use csp_shared::goods::WEAPONS;
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Caravan, CaravanStop, Carriage, City, DriveOrder, DropOrder, Good,
    GoodsSpot, Heading, Holding, Onto, PickUpOrder, Resident, ResidentOrder, Stock, Tile,
    TradeOrgCity, Trader, WalkOrder, WorldState,
};

use crate::combat::attack_order;
use crate::crimes::organization_of;
use crate::deliveries::{delivery_robbed, release_delivery, run_delivery, take_on_delivery};
use crate::goods_deps::new_id;
use crate::horses::{new_horse, NewHorse};
use crate::names::resident_names_taken;
use crate::queries::alliance::contract_of;
use crate::queries::carriages::{caravan_food_for, carriage_capacity, crew_ids_of};
use crate::queries::city::town_hall_of;
use crate::queries::goods::{units_that_fit, units_that_fit_carriage};
use crate::queries::names::{good_of, held, held_in, placed, ALL_GOODS};
use crate::queries::residents::{can_work, good_weight, is_armed, is_down, stock_weight};
use crate::queries::trade_org::{punishers, trade_org_hq};
use crate::queries::warehouse_trade::owed_by;
use crate::random::{hash_str, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::sight::InvariantViolation;
use crate::trade_org::hq_layout;
use crate::trading_posts::{restore_warehouse, storages_become_warehouses, trading_posts};
use crate::transfers::{release_transfer, run_transfer, take_on_transfer, transfer_robbed};

/// The goods caravans even out (`CARRIED`): not Food, which lives in the storages, nor coins.
pub fn carried_goods() -> Vec<Good> {
    ALL_GOODS.into_iter().filter(|g| *g != Good::Food && *g != Good::Coins).collect()
}

/// A caravan or wandering trader, by where it is in its list (`Convoy`): what their crews and
/// carriages have in common (`CONTEXT.md`: Caravan crew lost).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Convoy {
    Caravan(usize),
    Trader(usize),
}

/// The fields of a convoy the crew rules read and change.
pub struct Crew<'a> {
    pub carriage_id: &'a mut String,
    pub driver_id: &'a mut Option<String>,
    pub escort_ids: &'a mut Vec<String>,
    pub holding: &'a mut Option<Holding>,
}

impl Convoy {
    /// The convoy's crew fields, to change.
    pub fn crew(self, world: &mut WorldState) -> Crew<'_> {
        match self {
            Convoy::Caravan(i) => {
                let c = &mut world.caravans[i];
                Crew {
                    carriage_id: &mut c.carriage_id,
                    driver_id: &mut c.driver_id,
                    escort_ids: &mut c.escort_ids,
                    holding: &mut c.holding,
                }
            }
            Convoy::Trader(i) => {
                let t = &mut world.traders[i];
                Crew {
                    carriage_id: &mut t.carriage_id,
                    driver_id: &mut t.driver_id,
                    escort_ids: &mut t.escort_ids,
                    holding: &mut t.holding,
                }
            }
        }
    }
    /// The convoy's driver, if it has one.
    pub fn driver_id(self, world: &WorldState) -> Option<String> {
        match self {
            Convoy::Caravan(i) => world.caravans[i].driver_id.clone(),
            Convoy::Trader(i) => world.traders[i].driver_id.clone(),
        }
    }
    /// The convoy's escort.
    pub fn escort_ids(self, world: &WorldState) -> Vec<String> {
        match self {
            Convoy::Caravan(i) => world.caravans[i].escort_ids.clone(),
            Convoy::Trader(i) => world.traders[i].escort_ids.clone(),
        }
    }
    /// The convoy's carriage, by id.
    pub fn carriage_id(self, world: &WorldState) -> String {
        match self {
            Convoy::Caravan(i) => world.caravans[i].carriage_id.clone(),
            Convoy::Trader(i) => world.traders[i].carriage_id.clone(),
        }
    }
}

/// Every caravan and wandering trader (`convoysOf`): the caravans first.
pub fn convoys_of(world: &WorldState) -> Vec<Convoy> {
    let caravans = (0..world.caravans.len()).map(Convoy::Caravan);
    caravans.chain((0..world.traders.len()).map(Convoy::Trader)).collect()
}

/// The caravan or wandering trader a resident drives or escorts, if any (`convoyOf`).
pub fn convoy_of(world: &WorldState, resident_id: &str) -> Option<Convoy> {
    convoys_of(world).into_iter().find(|c| {
        c.driver_id(world).as_deref() == Some(resident_id)
            || c.escort_ids(world).iter().any(|e| e == resident_id)
    })
}

/// `escorts`, and one more for every `CARAVAN_ROBBERIES_PER_ESCORT` robberies, up to the most
/// (`escortsAfter`).
fn escorts_after(escorts: f64, robberies: f64) -> f64 {
    CARAVAN_ESCORTS_MAX.min(escorts + (robberies / CARAVAN_ROBBERIES_PER_ESCORT).floor())
}

/// How many escorts a caravan to `post_id` walks with (`caravanEscortsWanted`).
pub fn caravan_escorts_wanted(world: &WorldState, post_id: &str) -> f64 {
    escorts_after(CARAVAN_ESCORTS, world.route_robberies.get(post_id).copied().unwrap_or(0.0))
}

/// How many escorts a wandering trader walks with (`traderEscortsWanted`).
pub fn trader_escorts_wanted(trader: &Trader) -> f64 {
    escorts_after(TRADER_ESCORTS, trader.robberies)
}

/// The Food a crew wants for a way of `tiles` tiles and `stops` stops (`foodForWay`).
pub fn food_for_way(escorts: f64, tiles: f64, stops: f64) -> f64 {
    let ticks = tiles * WALK_TICKS_PER_TILE * WAY_FOOD_MARGIN + stops * TRADER_STOP_TICKS;
    let per_day = (1.0 + escorts) * FOOD_PER_DAY + HORSE_FOOD_PER_DAY;
    caravan_food_for(escorts).min((ticks / TICKS_PER_GAME_DAY * per_day).ceil())
}

/// One end of a caravan's route (`RouteEnd`): its storage and warehouse, by index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RouteEnd {
    pub storage: Option<usize>,
    pub warehouse: Option<usize>,
}

/// The storage and warehouse at one end of a caravan's route (`routeEnd`).
pub fn route_end(world: &WorldState, post_id: &str, end: Heading) -> RouteEnd {
    match end {
        Heading::Post => post_end(world, post_id),
        Heading::Hq => hq_end(world),
    }
}

/// The storage and warehouse of trading post `post_id` (`postEnd`).
pub fn post_end(world: &WorldState, post_id: &str) -> RouteEnd {
    let own = |kind: BuildingKind| {
        world.buildings.iter().position(|b| {
            b.city_id.as_deref() == Some(post_id) && b.site.is_none() && b.kind == kind
        })
    };
    RouteEnd { storage: own(BuildingKind::Storage), warehouse: own(BuildingKind::Warehouse) }
}

/// The HQ's town hall's middle tile, the round layout's middle.
fn hq_middle(world: &WorldState) -> Option<(i32, i32)> {
    let hall = town_hall_of(world, trade_org_hq(world)?)?;
    Some(middle_of(placed(hall), MAP_SIZE))
}

/// The HQ's storage and its goods warehouse (`hqEnd`).
pub fn hq_end(world: &WorldState) -> RouteEnd {
    let Some((cx, cy)) = hq_middle(world) else { return RouteEnd::default() };
    let l = hq_layout(cx, cy);
    let at = |kind: BuildingKind, (x, y): (i32, i32)| {
        world.buildings.iter().position(|b| {
            b.kind == kind && b.x == f64::from(x) && b.y == f64::from(y) && b.site.is_none()
        })
    };
    RouteEnd {
        storage: at(BuildingKind::Storage, l.storage),
        warehouse: at(BuildingKind::Warehouse, l.goods_warehouse),
    }
}

/// A caravan ends (`endCaravan`): it lets go of what it was carrying out, and its crew stop what it
/// had them doing. The caller takes it off the caravans.
fn end_caravan(world: &mut WorldState, ci: usize) {
    release_delivery(world, ci);
    release_transfer(world, ci);
    let c = &world.caravans[ci];
    let crew: HashSet<String> =
        crew_ids_of(c.driver_id.as_deref(), &c.escort_ids).into_iter().collect();
    for r in &mut world.residents {
        if crew.contains(&r.id) {
            r.order = None;
        }
    }
}

/// A trading post that a realm took leaves the Trade Organization (`leaveTradeOrg`): it becomes a
/// plain city, its warehouse a storage with all it holds. Its caravan ends and its route's
/// robberies are forgotten; deliveries and transfers waiting at its warehouse go over to the HQ's
/// goods warehouse.
pub fn leave_trade_org(world: &mut WorldState, post_id: &str) {
    let Some(post) = world.cities.iter_mut().find(|c| c.id == post_id) else { return };
    if post.trade_org != Some(TradeOrgCity::Post) {
        return;
    }
    post.trade_org = None;
    let mut warehouses = HashSet::new();
    for b in &mut world.buildings {
        if b.city_id.as_deref() != Some(post_id) || b.kind != BuildingKind::Warehouse {
            continue;
        }
        b.kind = BuildingKind::Storage;
        warehouses.insert(b.id.clone());
    }
    let mut i = 0;
    while i < world.caravans.len() {
        if world.caravans[i].post_id == post_id {
            end_caravan(world, i);
            world.caravans.remove(i);
        } else {
            i += 1;
        }
    }
    world.route_robberies.shift_remove(post_id);
    let goods = hq_middle(world).and_then(|(cx, cy)| {
        let (x, y) = hq_layout(cx, cy).goods_warehouse;
        world
            .buildings
            .iter()
            .find(|b| {
                b.kind == BuildingKind::Warehouse && b.x == f64::from(x) && b.y == f64::from(y)
            })
            .map(|b| b.id.clone())
    });
    if let Some(goods) = &goods {
        for d in &mut world.deliveries {
            if warehouses.contains(&d.warehouse_id) {
                d.warehouse_id = goods.clone();
            }
        }
        for t in &mut world.transfers {
            if warehouses.contains(&t.warehouse_id) {
                t.warehouse_id = goods.clone();
            }
        }
    }
    world.deliveries.retain(|d| !warehouses.contains(&d.warehouse_id));
    world.transfers.retain(|t| !warehouses.contains(&t.warehouse_id));
}

/// A lost post comes back to the Trade Organization (`rejoinTradeOrg`).
pub fn rejoin_trade_org(world: &mut WorldState, post_id: &str, size: i32) {
    let Some(post) = world.cities.iter_mut().find(|c| c.id == post_id) else { return };
    post.trade_org = Some(TradeOrgCity::Post);
    // A Trade Org city has no layout (`CONTEXT.md`: City layout).
    post.layout = None;
    restore_warehouse(world, post_id, size);
    place_caravans(world);
}

/// A city the Trade Organization's army took joins it as a new trading post (`joinTradeOrg`).
pub fn join_trade_org(
    world: &mut WorldState,
    city_id: &str,
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) else { return };
    city.trade_org = Some(TradeOrgCity::Post);
    city.layout = None;
    city.former_player = None;
    storages_become_warehouses(world, city_id, size, terrain);
    for b in &mut world.buildings {
        if b.city_id.as_deref() == Some(city_id) && b.kind == BuildingKind::Gate {
            b.closed = None;
        }
    }
    place_caravans(world);
}

/// Post `post_id` leaves a wandering trader's loop (`dropFromLoop`).
pub fn drop_from_loop(trader: &mut Trader, post_id: &str) {
    let Some(at) = trader.r#loop.iter().position(|p| p == post_id) else { return };
    trader.r#loop.remove(at);
    if trader.post_id != post_id {
        return;
    }
    trader.post_id = trader.r#loop[at % trader.r#loop.len()].clone();
    trader.stop = csp_shared::world::TraderStop::Storage;
    trader.plan = None;
    trader.misses = 0.0;
    trader.calls = None;
}

/// A new carriage of the HQ at (x, y), with a new horse hitched to it drawn from `seed`
/// (`newCaravanCarriage`). Returns its id.
pub fn new_caravan_carriage(
    world: &mut WorldState,
    hq_id: &str,
    x: f64,
    y: f64,
    seed: &str,
) -> String {
    let horse_id = new_id(world, "horse");
    let mut rand = Mulberry32::new(f64::from(hash_str(seed)));
    let mut next = || rand.next();
    let horse = new_horse(
        &mut next,
        NewHorse {
            id: horse_id.clone(),
            realm_id: None,
            city_id: Some(hq_id.to_string()),
            x,
            y,
            tick: world.tick as f64,
        },
    );
    world.horses.push(horse);
    let carriage_id = new_id(world, "carriage");
    world.carriages.push(Carriage {
        id: carriage_id.clone(),
        realm_id: None,
        city_id: Some(hq_id.to_string()),
        x,
        y,
        horse_id: Some(horse_id),
        load: Stock::new(),
    });
    carriage_id
}

/// Gives the HQ a caravan for every trading post that has none (`placeCaravans`): a carriage with
/// a horse hitched to it, a driver and `CARAVAN_ESCORTS` escorts, new residents of the HQ, all
/// standing at its goods warehouse. Returns the new caravans' ids.
pub fn place_caravans(world: &mut WorldState) -> Vec<String> {
    let Some(hq) = trade_org_hq(world).map(|c| c.id.clone()) else { return Vec::new() };
    let Some((cx, cy)) = hq_middle(world) else { return Vec::new() };
    let (gx, gy) = hq_layout(cx, cy).goods_warehouse;
    let (x, y) = (f64::from(gx), f64::from(gy));
    let served: HashSet<String> = world.caravans.iter().map(|c| c.post_id.clone()).collect();
    let mut placed = Vec::new();
    let posts: Vec<String> = trading_posts(world).iter().map(|c| c.id.clone()).collect();
    for post in posts {
        if served.contains(&post) {
            continue;
        }
        let mut rand =
            Mulberry32::new(f64::from(hash_str(&format!("{}:caravan:{post}", world.seed))));
        let horse_seed = format!("{}:caravan-horse:{post}", world.seed);
        let carriage_id = new_caravan_carriage(world, &hq, x, y, &horse_seed);
        let mut names = resident_names_taken(world, None, Some(&hq));
        let mut crew = Vec::new();
        for _ in 0..(1 + CARAVAN_ESCORTS as usize) {
            let id = new_id(world, "r");
            let fields = NewResident {
                id: &id,
                owner: None,
                city_id: Some(&hq),
                x,
                y,
                tick: world.tick as f64,
            };
            let mut next = || rand.next();
            let mut r = new_resident(&mut next, &fields, Some(&mut names));
            r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
            crew.push(r);
        }
        let driver = crew[0].id.clone();
        let escorts = crew[1..].iter().map(|r| r.id.clone()).collect();
        world.residents.extend(crew);
        let id = new_id(world, "caravan");
        world.caravans.push(Caravan {
            id: id.clone(),
            post_id: post,
            carriage_id,
            driver_id: Some(driver),
            escort_ids: escorts,
            heading: Heading::Hq,
            stop: CaravanStop::Storage,
            to_load: None,
            holding: None,
            job: None,
            transfer: None,
        });
        placed.push(id);
    }
    placed
}

/// Everyone on a caravan or wandering trader, by id (`caravanCrew`).
pub fn caravan_crew(world: &WorldState) -> HashSet<String> {
    convoys_of(world)
        .into_iter()
        .flat_map(|c| crew_ids_of(c.driver_id(world).as_deref(), &c.escort_ids(world)))
        .collect()
}

/// Resident `resident_id` is gone from the caravans and wandering traders they were on
/// (`leaveCaravans`).
pub fn leave_caravans(world: &mut WorldState, resident_id: &str) {
    for c in convoys_of(world) {
        let crew = c.crew(world);
        crew.escort_ids.retain(|id| id != resident_id);
        if crew.driver_id.as_deref() == Some(resident_id) {
            replace_driver(world, c);
        }
    }
}

fn resident_index(world: &WorldState, id: &str) -> Option<usize> {
    world.residents.iter().position(|r| r.id == id)
}

/// A surviving escort takes over from the driver who is gone (`replaceDriver`).
fn replace_driver(world: &mut WorldState, c: Convoy) {
    let escorts: Vec<usize> =
        c.escort_ids(world).iter().filter_map(|id| resident_index(world, id)).collect();
    let next = escorts
        .iter()
        .copied()
        .find(|&i| !is_down(world.residents[i].down_until))
        .or(escorts.first().copied());
    let next_id = next.map(|i| world.residents[i].id.clone());
    let crew = c.crew(world);
    *crew.holding = None;
    *crew.driver_id = next_id.clone();
    let Some(next_id) = next_id else { return };
    crew.escort_ids.retain(|id| *id != next_id);
    // They go on driving, out of whatever they were doing as an escort.
    world.residents[next.unwrap()].order = None;
}

/// The adults of the HQ who can be taken on for a caravan (`freeHands`), as indices.
pub fn free_hands(world: &WorldState, hq_id: Option<&str>) -> Vec<usize> {
    let crew = caravan_crew(world);
    let away = punishers(world);
    let tick = world.tick as f64;
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none()
                && r.city_id.as_deref() == hq_id
                && r.health > 0.0
                && !is_down(r.down_until)
                && can_work(r.born_at, tick)
                && !is_armed(&r.carried)
                && matches!(r.order, None | Some(ResidentOrder::WorkAt(_)))
                && !crew.contains(&r.id)
                && !away.contains(&r.id)
                && contract_of(world, &r.id).is_none()
        })
        .collect()
}

fn dist(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    wrap_distance(size, (a.0 as i32, a.1 as i32), (b.0 as i32, b.1 as i32))
}

fn xy_r(r: &Resident) -> (f64, f64) {
    (r.x, r.y)
}

/// The HQ sends a convoy with no crew left a new driver on foot, the nearest to its carriage of
/// those free (`sendDriver`).
fn send_driver(world: &mut WorldState, c: Convoy, ki: usize, hq_id: &str, size: i32) {
    let free = free_hands(world, Some(hq_id));
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    let Some(nearest) = free.into_iter().reduce(|a, b| {
        if dist(size, xy_r(&world.residents[b]), k) < dist(size, xy_r(&world.residents[a]), k) {
            b
        } else {
            a
        }
    }) else {
        return;
    };
    world.residents[nearest].order = None;
    let id = world.residents[nearest].id.clone();
    *c.crew(world).driver_id = Some(id);
}

/// What evens out two warehouses' stock (`evenOut`): of each good carried, half of what `here`
/// holds more than `there`, as much as fits on the carriage.
pub fn even_out(here: &Stock, there: &Stock, load: &Stock, capacity: f64) -> Stock {
    let mut room = capacity - stock_weight(load);
    let mut out = Stock::new();
    for g in carried_goods() {
        let more = ((held(here, g) - held(there, g)) / 2.0).floor();
        let units = more.min((room / good_weight(g) + 1e-9).floor());
        if units <= 0.0 {
            continue;
        }
        out.insert(g, units);
        room -= units * good_weight(g);
    }
    out
}

/// A walk order to a tile (`walkTo`).
pub fn walk_to(r: &mut Resident, at: (f64, f64)) {
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: at.0, y: at.1 },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

/// An escort who is idle and out of contact with the carriage walks to it (`followCarriage`).
fn follow_carriage(world: &mut WorldState, c: Convoy, ki: usize, size: i32) {
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    for id in c.escort_ids(world) {
        let Some(i) = resident_index(world, &id) else { continue };
        let r = &world.residents[i];
        let touching = crate::queries::combat::in_contact(
            size,
            (r.x as i32, r.y as i32),
            (k.0 as i32, k.1 as i32),
        );
        if r.order.is_none() && !touching {
            walk_to(&mut world.residents[i], k);
        }
    }
}

/// Whether a resident is of the Trade Organization: of its HQ or a trading post (`ofTradeOrg`).
pub fn of_trade_org(world: &WorldState, r: &Resident) -> bool {
    let org = organization_of(r);
    world.cities.iter().any(|c| Some(c.id.as_str()) == org && c.trade_org.is_some())
}

/// Who threatens a convoy (`caravanThreats`), as indices.
pub fn caravan_threats(world: &WorldState, c: Convoy, ki: usize, size: i32) -> Vec<usize> {
    let crew: HashSet<String> =
        crew_ids_of(c.driver_id(world).as_deref(), &c.escort_ids(world)).into_iter().collect();
    crew_threats(world, &crew, ki, size)
}

/// `caravan_threats` for any crew by id with carriage `ki`, as a supply wagon and its soldiers
/// (`caravanThreats` with a crew of its own).
pub fn crew_threats(
    world: &WorldState,
    crew: &HashSet<String>,
    ki: usize,
    size: i32,
) -> Vec<usize> {
    let k = &world.carriages[ki];
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            if r.health <= 0.0 || crew.contains(&r.id) {
                return false;
            }
            if dist(size, (r.x, r.y), (k.x, k.y)) > CARAVAN_GUARD_RANGE {
                return false;
            }
            match &r.order {
                Some(ResidentOrder::Attack(o)) => {
                    o.defending != Some(true) && crew.contains(&o.target_id)
                }
                Some(ResidentOrder::PickUp(PickUpOrder {
                    from: GoodsSpot::Carriage { carriage_id },
                    ..
                })) => *carriage_id == k.id && !of_trade_org(world, r),
                _ => false,
            }
        })
        .collect()
}

/// The escort defends its convoy (`guardCaravan`).
fn guard_caravan(world: &mut WorldState, c: Convoy, ki: usize, size: i32) {
    let threats = caravan_threats(world, c, ki, size);
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    for id in c.escort_ids(world) {
        let Some(i) = resident_index(world, &id) else { continue };
        if world.residents[i].health <= 0.0 {
            continue;
        }
        if let Some(ResidentOrder::Attack(o)) = &world.residents[i].order {
            let t = world.residents.iter().find(|x| x.id == o.target_id);
            if t.is_some_and(|t| dist(size, (t.x, t.y), k) > CARAVAN_GUARD_RANGE) {
                world.residents[i].order = None;
            }
            continue;
        }
        if threats.is_empty() || !is_armed(&world.residents[i].carried) {
            continue;
        }
        let me = xy_r(&world.residents[i]);
        let nearest = threats
            .iter()
            .copied()
            .reduce(|a, b| {
                if dist(size, me, xy_r(&world.residents[b]))
                    < dist(size, me, xy_r(&world.residents[a]))
                {
                    b
                } else {
                    a
                }
            })
            .expect("threats");
        let target = world.residents[nearest].id.clone();
        world.residents[i].order = Some(ResidentOrder::Attack(attack_order(&target, false, true)));
    }
}

/// The escort is made up and armed at the HQ (`manEscort`). Whether an escort is still on the way
/// to arm themselves, which the convoy waits for.
fn man_escort(world: &mut WorldState, c: Convoy, ki: usize, wanted: f64, size: i32) -> bool {
    let Some(w) = hq_end(world).warehouse else { return false };
    let k = &world.carriages[ki];
    if !is_at((k.x as i32, k.y as i32), placed(&world.buildings[w]), size) {
        return false;
    }
    let wxy = (world.buildings[w].x, world.buildings[w].y);
    let have = c.escort_ids(world).len() as f64;
    if have < wanted {
        let mut joining = free_hands(world, world.buildings[w].city_id.as_deref());
        // The nearest come, so the caravan waits for them least.
        joining.sort_by(|&a, &b| {
            dist(size, xy_r(&world.residents[a]), wxy)
                .partial_cmp(&dist(size, xy_r(&world.residents[b]), wxy))
                .expect("distances")
        });
        for i in joining.into_iter().take((wanted - have) as usize) {
            world.residents[i].order = None;
            let id = world.residents[i].id.clone();
            c.crew(world).escort_ids.push(id);
        }
    }
    let stock = world.buildings[w].stock.clone().unwrap_or_default();
    let wid = world.buildings[w].id.clone();
    let tick = world.tick as f64;
    let mut arming = false;
    for id in c.escort_ids(world) {
        let Some(i) = resident_index(world, &id) else { continue };
        if is_armed(&world.residents[i].carried) {
            continue;
        }
        if let Some(o) = &world.residents[i].order {
            if matches!(
                o,
                ResidentOrder::PickUp(PickUpOrder { from: GoodsSpot::Storage { .. }, .. })
            ) {
                arming = true;
            }
            let there = matches!(o, ResidentOrder::WalkTo(walk) if walk.target.x == wxy.0 && walk.target.y == wxy.1);
            arming = arming || there;
            continue;
        }
        let weapon = WEAPONS.iter().filter_map(|w| good_of(w)).find(|&g| {
            held(&stock, g) - owed_by(world, &wid, g) > 0.0
                && units_that_fit(&world.residents[i], g, tick) > 0.0
        });
        let Some(weapon) = weapon else { continue };
        arming = true;
        let r = &world.residents[i];
        if is_at((r.x as i32, r.y as i32), placed(&world.buildings[w]), size) {
            world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder {
                from: GoodsSpot::Storage { storage_id: wid.clone() },
                goods: Stock::from([(weapon, 1.0)]),
            }));
        } else {
            walk_to(&mut world.residents[i], wxy);
        }
    }
    arming
}

/// Sets the caravan off for the other end of its route, to its storage first (`depart`).
fn depart(caravan: &mut Caravan) {
    caravan.heading = if caravan.heading == Heading::Hq { Heading::Post } else { Heading::Hq };
    caravan.stop = CaravanStop::Storage;
    caravan.to_load = None;
}

/// The driver's next take at a stop (`take`): `goods` from `from`, put down next tick `onto`.
pub fn take(
    world: &mut WorldState,
    c: Convoy,
    ri: usize,
    from: GoodsSpot,
    goods: Stock,
    onto: Onto,
) {
    world.residents[ri].order =
        Some(ResidentOrder::PickUp(PickUpOrder { from, goods: goods.clone() }));
    *c.crew(world).holding = Some(Holding { goods, onto });
}

/// What the driver took last tick goes down, on the carriage or at `stop` (`putDownHeld`).
/// Whether they have that to do.
pub fn put_down_held(world: &mut WorldState, c: Convoy, ri: usize, stop: usize, ki: usize) -> bool {
    let Some(Holding { goods, onto }) = c.crew(world).holding.take() else { return false };
    let mut put = Stock::new();
    for (&g, &units) in &goods {
        let n = units.min(held(&world.residents[ri].carried, g));
        if n > 0.0 {
            put.insert(g, n);
        }
    }
    if put.is_empty() {
        return false;
    }
    let to = match onto {
        Onto::Carriage => GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() },
        Onto::Stop => GoodsSpot::Storage { storage_id: world.buildings[stop].id.clone() },
    };
    world.residents[ri].order = Some(ResidentOrder::Drop(DropOrder { to, goods: put }));
    true
}

/// The Food of storage `stop` a carriage holding `on_board` may take (`foodToSpare`).
fn food_to_spare(world: &WorldState, stop: usize, on_board: f64) -> f64 {
    let b = &world.buildings[stop];
    let food = held_in(b.stock.as_ref(), Good::Food);
    if b.city_id.as_deref() != trade_org_hq(world).map(|c| c.id.as_str()) {
        return food;
    }
    let crew = caravan_crew(world);
    let people =
        world.residents.iter().filter(|r| r.city_id == b.city_id && !crew.contains(&r.id)).count()
            as f64;
    let left = people * FOOD_PER_DAY * HQ_PEOPLE_FOOD_DAYS;
    (food - left).floor().max(food.min(WAITING_HORSE_FOOD - on_board))
}

/// The driver takes the Food the crew keep on board from storage `stop` (`topUpFood`). Whether
/// there was any to take.
pub fn top_up_food(world: &mut WorldState, c: Convoy, ri: usize, stop: usize, ki: usize) -> bool {
    let on_board = held(&world.carriages[ki].load, Good::Food);
    let escorts = c.escort_ids(world).len() as f64;
    let food = (caravan_food_for(escorts) - on_board)
        .min(food_to_spare(world, stop, on_board))
        .min(units_that_fit(&world.residents[ri], Good::Food, world.tick as f64))
        .min(units_that_fit_carriage(world, &world.carriages[ki], Good::Food));
    if food <= 0.0 {
        return false;
    }
    let from = GoodsSpot::Storage { storage_id: world.buildings[stop].id.clone() };
    take(world, c, ri, from, Stock::from([(Good::Food, food)]), Onto::Carriage);
    true
}

/// The Food a caravan wants on board to leave the HQ for its post (`caravanWayFood`).
fn caravan_way_food(world: &WorldState, ci: usize, ki: usize, size: i32) -> f64 {
    let c = &world.caravans[ci];
    let post = world.cities.iter().find(|x| x.id == c.post_id);
    let hall = post.and_then(|p| town_hall_of(world, p));
    let k = &world.carriages[ki];
    let tiles = hall.map_or(0.0, |h| {
        let (mx, my) = middle_of(placed(h), MAP_SIZE);
        wrap_distance(size, (k.x as i32, k.y as i32), (mx, my))
    });
    food_for_way(c.escort_ids.len() as f64, tiles, 0.0)
}

/// Whether a caravan at the HQ holds too little Food to leave (`shortOfFood`).
fn short_of_food(world: &WorldState, ci: usize, ki: usize, size: i32) -> bool {
    let RouteEnd { storage, warehouse } = hq_end(world);
    let c = &world.caravans[ci];
    if c.heading != Heading::Hq || storage.is_none() {
        return false;
    }
    let wid = warehouse.map(|w| world.buildings[w].id.as_str());
    let job = world
        .deliveries
        .iter()
        .any(|d| d.caravan_id.is_none() && Some(d.warehouse_id.as_str()) == wid)
        || world
            .transfers
            .iter()
            .any(|t| t.caravan_id.is_none() && Some(t.warehouse_id.as_str()) == wid);
    let want = if job {
        caravan_food_for(c.escort_ids.len() as f64)
    } else {
        caravan_way_food(world, ci, ki, size)
    };
    held(&world.carriages[ki].load, Good::Food) < want
}

/// The whole units of Food a warehouse holds beyond what it keeps for deliveries
/// (`warehouseFood`).
fn warehouse_food(world: &WorldState, w: Option<usize>) -> f64 {
    let Some(w) = w else { return 0.0 };
    let b = &world.buildings[w];
    (held_in(b.stock.as_ref(), Good::Food) - owed_by(world, &b.id, Good::Food)).floor()
}

fn drive(world: &mut WorldState, ri: usize, ki: usize, target: (f64, f64)) {
    let carriage_id = world.carriages[ki].id.clone();
    world.residents[ri].order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id,
        target: Tile { x: target.0, y: target.1 },
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    }));
}

/// Whether the carriage's hitched horse lies Down (`horseLiesDown`).
pub fn horse_lies_down(world: &WorldState, ki: usize) -> bool {
    let k = &world.carriages[ki];
    k.horse_id
        .as_deref()
        .and_then(|h| world.horses.iter().find(|x| x.id == h))
        .is_some_and(|h| is_down(h.down_until))
}

/// One tick of a caravan whose driver is idle with the carriage (`runCaravan`).
fn run_caravan(world: &mut WorldState, ci: usize, ri: usize, ki: usize, size: i32) {
    if world.caravans[ci].job.is_some() {
        return run_delivery(world, ci, ri, ki, size);
    }
    if world.caravans[ci].transfer.is_some() {
        return run_transfer(world, ci, ri, ki, size);
    }
    let c = Convoy::Caravan(ci);
    let (post_id, heading) = (world.caravans[ci].post_id.clone(), world.caravans[ci].heading);
    let end = route_end(world, &post_id, heading);
    let at_storage = world.caravans[ci].stop == CaravanStop::Storage;
    let Some(stop) = (if at_storage { end.storage } else { end.warehouse }) else {
        let caravan = &mut world.caravans[ci];
        if at_storage {
            caravan.stop = CaravanStop::Warehouse;
        } else {
            depart(caravan);
        }
        return;
    };
    let r = &world.residents[ri];
    if !is_at((r.x as i32, r.y as i32), placed(&world.buildings[stop]), size) {
        // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
        if horse_lies_down(world, ki) {
            return;
        }
        let target = (world.buildings[stop].x, world.buildings[stop].y);
        return drive(world, ri, ki, target);
    }
    let here = GoodsSpot::Storage { storage_id: world.buildings[stop].id.clone() };
    let on_carriage = GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() };
    if put_down_held(world, c, ri, stop, ki) {
        return;
    }
    let stock = world.buildings[stop].stock.clone().unwrap_or_default();
    let tick = world.tick as f64;
    let hands = |world: &WorldState, g: Good| units_that_fit(&world.residents[ri], g, tick);
    let carried = carried_goods();
    if at_storage {
        if top_up_food(world, c, ri, stop, ki) {
            return;
        }
        let unloaded = carried.iter().all(|g| held(&world.carriages[ki].load, *g) <= 0.0);
        let waits = unloaded && short_of_food(world, ci, ki, size);
        if !waits || warehouse_food(world, end.warehouse) >= 1.0 {
            world.caravans[ci].stop = CaravanStop::Warehouse;
        }
        return;
    }
    if world.caravans[ci].to_load.is_none() {
        // Unloading what it brought comes first; loading is worked out once all of it is off.
        for &g in &carried {
            let units = held(&world.carriages[ki].load, g).min(hands(world, g));
            if units > 0.0 {
                return take(world, c, ri, on_carriage, Stock::from([(g, units)]), Onto::Stop);
            }
        }
        if short_of_food(world, ci, ki, size) {
            let escorts = world.caravans[ci].escort_ids.len() as f64;
            let food = (caravan_food_for(escorts) - held(&world.carriages[ki].load, Good::Food))
                .min(warehouse_food(world, Some(stop)))
                .min(hands(world, Good::Food))
                .min(units_that_fit_carriage(world, &world.carriages[ki], Good::Food));
            if food > 0.0 {
                return take(world, c, ri, here, Stock::from([(Good::Food, food)]), Onto::Carriage);
            }
            world.caravans[ci].stop = CaravanStop::Storage;
            return;
        }
        let stop_id = world.buildings[stop].id.clone();
        if take_on_delivery(world, ci, &stop_id) || take_on_transfer(world, ci, &stop_id) {
            return;
        }
        let other_heading = if heading == Heading::Hq { Heading::Post } else { Heading::Hq };
        let other = route_end(world, &post_id, other_heading).warehouse;
        let mut spare = stock.clone();
        for &g in &carried {
            spare.insert(g, held(&stock, g) - owed_by(world, &stop_id, g));
        }
        let to_load = match other {
            Some(o) => {
                let there = world.buildings[o].stock.clone().unwrap_or_default();
                let k = &world.carriages[ki];
                even_out(&spare, &there, &k.load, carriage_capacity(world, k))
            }
            None => Stock::new(),
        };
        world.caravans[ci].to_load = Some(to_load);
    }
    let to_load = world.caravans[ci].to_load.clone().expect("worked out");
    for (g, wanted) in to_load {
        let units = wanted.min(held(&stock, g)).min(hands(world, g)).min(units_that_fit_carriage(
            world,
            &world.carriages[ki],
            g,
        ));
        let left = world.caravans[ci].to_load.as_mut().expect("worked out");
        if units <= 0.0 {
            left.shift_remove(&g);
            continue;
        }
        if wanted - units > 0.0 {
            left.insert(g, wanted - units);
        } else {
            left.shift_remove(&g);
        }
        return take(world, c, ri, here, Stock::from([(g, units)]), Onto::Carriage);
    }
    depart(&mut world.caravans[ci]);
}

/// One tick of the Trade Org's caravans (`stepCaravans`), run before the actions are requested.
pub fn step_caravans(world: &mut WorldState, size: i32) {
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let mut ci = 0;
    while ci < world.caravans.len() {
        // Asked for each caravan: the last one breaking up may have changed the world.
        let ids = world.caravans[ci].escort_ids.clone();
        world.caravans[ci].escort_ids =
            ids.into_iter().filter(|id| resident_index(world, id).is_some()).collect();
        let c = &world.caravans[ci];
        let ki = world.carriages.iter().position(|k| k.id == c.carriage_id);
        let post = world
            .cities
            .iter()
            .any(|x| x.id == c.post_id && x.trade_org == Some(TradeOrgCity::Post));
        let (Some(hq), Some(ki), true) = (hq.clone(), ki, post) else {
            end_caravan(world, ci);
            world.caravans.remove(ci);
            continue;
        };
        let wanted = caravan_escorts_wanted(world, &world.caravans[ci].post_id);
        step_crew(world, Convoy::Caravan(ci), ki, &hq, wanted, size, &mut |world, ri| {
            run_caravan(world, ci, ri, ki, size)
        });
        ci += 1;
    }
}

/// One tick of a caravan's or trader's crew, its carriage and the HQ still there (`stepCrew`).
pub fn step_crew(
    world: &mut WorldState,
    c: Convoy,
    ki: usize,
    hq_id: &str,
    wanted: f64,
    size: i32,
    run: &mut dyn FnMut(&mut WorldState, usize),
) {
    let driver = c.driver_id(world);
    if driver.as_deref().is_some_and(|d| resident_index(world, d).is_none()) {
        replace_driver(world, c);
    }
    if c.driver_id(world).is_none() {
        send_driver(world, c, ki, hq_id, size);
    }
    let Some(ri) = c.driver_id(world).and_then(|d| resident_index(world, &d)) else { return };
    guard_caravan(world, c, ki, size);
    let arming = man_escort(world, c, ki, wanted, size);
    follow_carriage(world, c, ki, size);
    let driver = &world.residents[ri];
    if arming || driver.order.is_some() || !can_work(driver.born_at, world.tick as f64) {
        return;
    }
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    if (driver.x, driver.y) != k {
        walk_to(&mut world.residents[ri], k);
    } else {
        run(world, ri);
    }
}

/// Drivers of caravans and traders who wait this tick for their escort (`waitingForEscort`).
pub fn waiting_for_escort(world: &WorldState, size: i32) -> HashSet<String> {
    let mut waiting = HashSet::new();
    for c in convoys_of(world) {
        let Some(driver) =
            c.driver_id(world).and_then(|d| world.residents.iter().find(|r| r.id == d))
        else {
            continue;
        };
        if !matches!(driver.order, Some(ResidentOrder::Drive(_))) {
            continue;
        }
        if driver.struck.as_ref().is_some_and(|s| world.tick as f64 - s.tick < DEFEND_CALM_TICKS) {
            continue;
        }
        let behind = c.escort_ids(world).iter().any(|id| {
            let r = world.residents.iter().find(|x| &x.id == id);
            match r.and_then(|r| r.order.as_ref().map(|o| (r, o))) {
                Some((_, ResidentOrder::Attack(_))) => true,
                Some((r, ResidentOrder::WalkTo(_))) => {
                    dist(size, xy_r(r), xy_r(driver)) > CARAVAN_SPREAD
                }
                _ => false,
            }
        });
        if behind {
            waiting.insert(driver.id.clone());
        }
    }
    waiting
}

/// The carriage load a caravan or trader's crew member may refill from (`caravanFood`), by
/// carriage index.
pub fn caravan_food(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    if r.owner.is_some() {
        return None;
    }
    let c = convoy_of(world, &r.id)?;
    let id = c.carriage_id(world);
    let ki = world.carriages.iter().position(|k| k.id == id)?;
    let k = &world.carriages[ki];
    if held(&k.load, Good::Food) <= 0.0 {
        return None;
    }
    (dist(size, xy_r(r), (k.x, k.y)) <= CARAVAN_SPREAD).then_some(ki)
}

/// Resident `ri` took goods off carriage `carriage_id` (`robCaravan`): when it is a caravan's and
/// they aren't of the Trade Organization, they robbed it. With `whole`, the carriage itself was
/// taken, so all its load counts as taken.
pub fn rob_caravan(
    world: &mut WorldState,
    ri: usize,
    carriage_id: &str,
    robbed: &mut HashSet<String>,
    whole: bool,
) {
    let Some(ci) = world.caravans.iter().position(|c| c.carriage_id == carriage_id) else { return };
    let Some(ki) = world.carriages.iter().position(|k| k.id == carriage_id) else { return };
    // One of the Trade Org's own, hired out to a realm, robs it too by taking the whole carriage.
    if of_trade_org(world, &world.residents[ri]) && !whole {
        return;
    }
    let (cid, post) = (world.caravans[ci].id.clone(), world.caravans[ci].post_id.clone());
    if robbed.insert(cid) {
        *world.route_robberies.entry(post).or_insert(0.0) += 1.0;
    }
    if whole {
        let load = std::mem::take(&mut world.carriages[ki].load);
        delivery_robbed(world, ci, ki);
        transfer_robbed(world, ci, ki);
        world.carriages[ki].load = load;
    } else {
        delivery_robbed(world, ci, ki);
        transfer_robbed(world, ci, ki);
    }
}

/// `thief` stole a caravan's carriage (`caravanCarriageStolen`): the caravan is robbed of its whole
/// load and gets a new carriage and horse at the HQ's goods warehouse, or ends with no HQ left.
pub fn caravan_carriage_stolen(world: &mut WorldState, thief: usize, carriage_id: &str) {
    let Some(ci) = world.caravans.iter().position(|c| c.carriage_id == carriage_id) else { return };
    rob_caravan(world, thief, carriage_id, &mut HashSet::new(), true);
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let middle = hq_middle(world);
    let (Some(hq), Some((cx, cy))) = (hq, middle) else {
        end_caravan(world, ci);
        world.caravans.remove(ci);
        return;
    };
    let (x, y) = hq_layout(cx, cy).goods_warehouse;
    let seed = format!("{}:caravan-horse:{}:{carriage_id}", world.seed, world.caravans[ci].post_id);
    let k = new_caravan_carriage(world, &hq, f64::from(x), f64::from(y), &seed);
    let c = &mut world.caravans[ci];
    c.carriage_id = k;
    c.heading = Heading::Hq;
    c.stop = CaravanStop::Storage;
    c.to_load = None;
}

/// Robberies counted per caravan route hold together (`route-robberies-sound`).
pub fn route_robberies_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (post, n) in &world.route_robberies {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "route-robberies-sound".into(),
                message,
                entity_ids: vec![post.clone()],
            })
        };
        if !world.cities.iter().any(|c| &c.id == post && c.trade_org == Some(TradeOrgCity::Post)) {
            fail(format!("robberies are counted for {post}, which is no trading post"));
        }
        if !(n.is_finite() && n.fract() == 0.0) || *n < 1.0 {
            fail(format!(
                "the route to {post} counts {} robberies",
                crate::queries::warehouse_trade::js_number(*n)
            ));
        }
    }
    out
}

/// Caravans hold together (`caravans-sound`).
pub fn caravans_sound(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |c: &Caravan, message: String, ids: Vec<String>| {
        let mut entity_ids = vec![c.id.clone()];
        entity_ids.extend(ids);
        out.push(InvariantViolation {
            invariant: "caravans-sound".into(),
            message: format!("caravan {} {message}", c.id),
            entity_ids,
        });
    };
    let n = crate::queries::warehouse_trade::js_number;
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let mut posts = HashSet::new();
    let mut crew = HashSet::new();
    for (ci, c) in world.caravans.iter().enumerate() {
        if !world
            .cities
            .iter()
            .any(|x| x.id == c.post_id && x.trade_org == Some(TradeOrgCity::Post))
        {
            fail(c, format!("runs to {}, which is no trading post", c.post_id), vec![]);
        }
        if !posts.insert(c.post_id.clone()) {
            fail(c, format!("shares the route to {} with another caravan", c.post_id), vec![]);
        }
        let ki = world.carriages.iter().position(|x| x.id == c.carriage_id);
        match ki.map(|i| &world.carriages[i]) {
            None => fail(c, format!("has carriage {}, which doesn't exist", c.carriage_id), vec![]),
            Some(k) if k.realm_id.is_some() || k.city_id != hq => fail(
                c,
                format!("has carriage {}, which isn't the Trade Org HQ's", k.id),
                vec![k.id.clone()],
            ),
            _ => {}
        }
        if c.driver_id.is_none() && !c.escort_ids.is_empty() {
            fail(c, "has no driver, though an escort could take over".into(), vec![]);
        }
        for id in crew_ids_of(c.driver_id.as_deref(), &c.escort_ids) {
            match world.residents.iter().find(|x| x.id == id) {
                None => fail(c, format!("has crew {id}, who doesn't exist"), vec![]),
                Some(r) if r.owner.is_some() || r.city_id != hq => fail(
                    c,
                    format!("has crew {id}, who isn't of the Trade Org HQ"),
                    vec![id.clone()],
                ),
                _ => {}
            }
            if !crew.insert(id.clone()) {
                fail(
                    c,
                    format!("has crew {id} twice or shared with another caravan"),
                    vec![id.clone()],
                );
            }
        }
        let wanted = caravan_escorts_wanted(world, &c.post_id);
        if c.escort_ids.len() as f64 > wanted {
            fail(
                c,
                format!(
                    "walks with {} escorts, more than the {} of its route",
                    c.escort_ids.len(),
                    n(wanted)
                ),
                vec![],
            );
        }
        let driver =
            c.driver_id.as_deref().and_then(|d| world.residents.iter().find(|x| x.id == d));
        if let Some(d) = driver {
            if let Some(ResidentOrder::Drive(o)) = &d.order {
                if o.carriage_id != c.carriage_id {
                    fail(
                        c,
                        format!("has its driver driving {}", o.carriage_id),
                        vec![d.id.clone()],
                    );
                }
            }
        }
        let holds = ki.map_or(CARRIAGE_CAPACITY, |i| carriage_capacity(world, &world.carriages[i]));
        if let Some(to_load) = &c.to_load {
            if stock_weight(to_load) > holds + 1e-9 {
                fail(
                    c,
                    format!(
                        "means to load {} kg, more than a carriage holds",
                        n(stock_weight(to_load))
                    ),
                    vec![],
                );
            }
        }
        if let (Some(ki), Some(_)) = (ki, driver) {
            if just_left_the_hq(world, c, ki, size) {
                let want = caravan_way_food(world, ci, ki, size) - SET_OFF_FOOD_SLACK;
                let food = held(&world.carriages[ki].load, Good::Food);
                if food < want {
                    let k = world.carriages[ki].id.clone();
                    fail(
                        c,
                        format!("set off from the HQ with {} Food, wanting {}", n(food), n(want)),
                        vec![k],
                    );
                }
            }
        }
    }
    out
}

/// Whether a caravan is on its way to its post, its carriage still on the HQ's stop it left from
/// (`justLeftTheHq`).
fn just_left_the_hq(world: &WorldState, c: &Caravan, ki: usize, size: i32) -> bool {
    if c.heading != Heading::Post || c.job.is_some() || c.transfer.is_some() {
        return false;
    }
    stands_at_hq_stop(world, ki, size)
}

/// Whether a carriage stands at the HQ's storage or goods warehouse, of an HQ with a storage
/// (`standsAtHqStop`).
pub fn stands_at_hq_stop(world: &WorldState, ki: usize, size: i32) -> bool {
    let RouteEnd { storage, warehouse } = hq_end(world);
    let Some(storage) = storage else { return false };
    let k = &world.carriages[ki];
    let at = |b: usize| is_at((k.x as i32, k.y as i32), placed(&world.buildings[b]), size);
    at(storage) || warehouse.is_some_and(at)
}

/// The city of the HQ, for tests.
pub fn hq_city(world: &WorldState) -> Option<&City> {
    trade_org_hq(world)
}

/// The building at an index, for tests.
pub fn building(world: &WorldState, i: usize) -> &Building {
    &world.buildings[i]
}
