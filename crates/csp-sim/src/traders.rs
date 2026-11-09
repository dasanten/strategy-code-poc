//! Wandering traders (`traders.ts`, `CONTEXT.md`: Wandering trader): Trade Org carriages the HQ
//! sends round a fixed loop of its trading posts and itself, apart from the caravans, so posts can
//! hold goods they don't produce and new Food and Coins reach them. Crew, escort, Food on board and
//! a lost carriage go as for a caravan, and share its code (`step_crew`). The trader is plain data
//! (ADR 0002); each tick the game gives its crew drive, pick-up, drop and walk orders, which request
//! actions like a Player's do.

use std::collections::HashSet;

use csp_shared::balance::{
    CARRIAGE_CAPACITY, MAP_SIZE, SET_OFF_FOOD_SLACK, SIGHT_RANGE, START_CARRIED_FOOD, TRADERS,
    TRADER_DRIVE_TRIES, TRADER_ESCORTS,
};
use csp_shared::footprint::{is_at, middle_of};
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, City, DriveOrder, Good, GoodsSpot, Heading, Onto, ResidentOrder, Stock, Tile, Trader,
    TraderPlan, TraderStop, WorldState,
};

use crate::caravans::{
    drop_from_loop, food_for_way, horse_lies_down, hq_end, new_caravan_carriage, of_trade_org,
    post_end, put_down_held, stands_at_hq_stop, step_crew, take, top_up_food,
    trader_escorts_wanted, Convoy, RouteEnd,
};
use crate::goods_deps::new_id;
use crate::names::resident_names_taken;
use crate::queries::carriages::{caravan_food_for, carriage_capacity, crew_ids_of};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, is_city_building};
use crate::queries::goods::{units_that_fit, units_that_fit_carriage};
use crate::queries::names::{held, held_in, placed, ALL_GOODS};
use crate::queries::residents::{is_armed, stock_weight};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse::{trade_coin_warehouse, warehouse_keeps};
use crate::queries::warehouse_trade::owed_by;
use crate::random::{hash_str, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::sight::InvariantViolation;
use crate::trade_org::hq_layout;
use crate::trader_stops::{calls_on_the_way, run_stops};
use crate::trading_posts::trading_posts;

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

fn dist(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    wrap_distance(size, tile(a.0, a.1), tile(b.0, b.1))
}

/// Where a stop lies, for how far its neighbours on a loop are (`placeOf`): the middle of its town
/// hall, by the TypeScript's default map size.
fn place_of(world: &WorldState, stop_id: &str) -> Option<(f64, f64)> {
    let city = world.cities.iter().find(|c| c.id == stop_id)?;
    let hall = town_hall_of(world, city)?;
    let (x, y) = middle_of(placed(hall), MAP_SIZE);
    Some((f64::from(x), f64::from(y)))
}

/// Puts `stop_id` into `stops` where it adds the least way, keeping the order of the rest
/// (`insertIntoLoop`), so the loop stays fixed but for that one stop; last, when where it lies
/// isn't known. `size` is the map's.
fn insert_into_loop(world: &WorldState, stops: &mut Vec<String>, stop_id: &str, size: i32) {
    let Some(at) = place_of(world, stop_id) else {
        stops.push(stop_id.to_string());
        return;
    };
    let mut best = stops.len();
    let mut least = f64::INFINITY;
    for i in 0..stops.len() {
        let a = place_of(world, &stops[i]);
        let b = place_of(world, &stops[(i + 1) % stops.len()]);
        let (Some(a), Some(b)) = (a, b) else { continue };
        let added = dist(size, a, at) + dist(size, at, b) - dist(size, a, b);
        if added >= least {
            continue;
        }
        least = added;
        best = i + 1;
    }
    stops.insert(best, stop_id.to_string());
}

/// A loop of the HQ and all the world's trading posts (`newLoop`). `size` is the map's.
fn new_loop(world: &WorldState, hq: &str, posts: &[String], size: i32) -> Vec<String> {
    let mut stops = Vec::new();
    for stop in std::iter::once(hq.to_string()).chain(posts.iter().cloned()) {
        insert_into_loop(world, &mut stops, &stop, size);
    }
    stops
}

/// The HQ's goods warehouse tile, where traders and their carriages start.
fn goods_warehouse_at(world: &WorldState, hq: &City) -> Option<(f64, f64)> {
    let hall = town_hall_of(world, hq)?;
    let (mx, my) = middle_of(placed(hall), MAP_SIZE);
    let (x, y) = hq_layout(mx, my).goods_warehouse;
    Some((f64::from(x), f64::from(y)))
}

/// The HQ sends out its wandering traders (`placeTraders`, `CONTEXT.md`: Wandering trader):
/// `TRADERS`, or one for each post with fewer, each bound for a different post, spread evenly round
/// one loop of all the posts and the HQ. Each gets a carriage with a horse hitched to it, a driver
/// and `TRADER_ESCORTS` escorts, new residents of the HQ, all standing at its goods warehouse. Each
/// starts at the HQ, a stop like any. Nothing when the world has no HQ. Returns their ids.
pub fn place_traders(world: &mut WorldState, size: i32) -> Vec<String> {
    let Some(hq) = trade_org_hq(world).cloned() else { return Vec::new() };
    let Some((x, y)) = goods_warehouse_at(world, &hq) else { return Vec::new() };
    let posts: Vec<String> = trading_posts(world).into_iter().map(|c| c.id.clone()).collect();
    let stops = new_loop(world, &hq.id, &posts, size);
    let bound: Vec<String> = stops.iter().filter(|id| **id != hq.id).cloned().collect();
    let count = (TRADERS as usize).min(bound.len());
    let mut placed_ids = Vec::new();
    for i in world.traders.len()..count {
        let mut m = Mulberry32::new(f64::from(hash_str(&format!("{}:trader:{i}", world.seed))));
        let carriage_id =
            new_caravan_carriage(world, &hq.id, x, y, &format!("{}:trader-horse:{i}", world.seed));
        let mut names = resident_names_taken(world, None, Some(&hq.id));
        let mut crew = Vec::new();
        for _ in 0..1 + TRADER_ESCORTS as usize {
            let id = new_id(world, "r");
            let fields = NewResident {
                id: &id,
                owner: None,
                city_id: Some(&hq.id),
                x,
                y,
                tick: world.tick as f64,
            };
            let mut r = new_resident(&mut || m.next(), &fields, Some(&mut names));
            r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
            crew.push(r);
        }
        let driver_id = crew[0].id.clone();
        let escort_ids: Vec<String> = crew[1..].iter().map(|r| r.id.clone()).collect();
        world.residents.extend(crew);
        let trader = Trader {
            id: new_id(world, "trader"),
            carriage_id,
            driver_id: Some(driver_id),
            escort_ids,
            r#loop: stops.clone(),
            post_id: bound[(i * bound.len()) / count].clone(),
            heading: Heading::Hq,
            stop: TraderStop::Storage,
            plan: None,
            holding: None,
            misses: 0.0,
            robberies: 0.0,
            calls: None,
            stand: None,
        };
        placed_ids.push(trader.id.clone());
        world.traders.push(trader);
    }
    placed_ids
}

/// The HQ joins the loops of the world's traders (`putHqOnLoops`, `CONTEXT.md`: Wandering trader),
/// for a world from before it was a stop: where it adds the least way.
pub fn put_hq_on_loops(world: &mut WorldState, size: i32) {
    let Some(hq) = trade_org_hq(world).map(|c| c.id.clone()) else { return };
    for ti in 0..world.traders.len() {
        if !world.traders[ti].r#loop.contains(&hq) {
            let mut stops = std::mem::take(&mut world.traders[ti].r#loop);
            insert_into_loop(world, &mut stops, &hq, size);
            world.traders[ti].r#loop = stops;
        }
    }
}

/// What evens out a trader's load with a warehouse holding `there` (`evenOutLoad`, `CONTEXT.md`:
/// Wandering trader), every good including Food and Coins: of each it means to carry on half way
/// between its load and the warehouse, leaving what it has over that and taking what it has under.
/// When the carriage can't hold all that (`capacity`), each good's half way is cut by the same
/// share, so every good travels. The Food the crew keep on board (`keep_food`) is not load, but it
/// takes up room. So does the Food it wants before it leaves the HQ (`food_to_hold`), of which it
/// takes what it lacks, as far as the warehouse has it.
pub fn even_out_load(
    there: &Stock,
    load: &Stock,
    keep_food: f64,
    capacity: f64,
    food_to_hold: f64,
) -> TraderPlan {
    let carried = |g: Good| 0f64.max(held(load, g) - if g == Good::Food { keep_food } else { 0.0 });
    let mut half_way = Stock::new();
    for g in ALL_GOODS {
        half_way.insert(g, 0f64.max((carried(g) + held(there, g)) / 2.0));
    }
    let on_board = held(load, Good::Food);
    let kept = on_board.min(keep_food).max(food_to_hold);
    let room = 0f64.max(capacity - stock_weight(&Stock::from([(Good::Food, kept)])));
    let share = 1f64.min(room / stock_weight(&half_way).max(1e-9));
    let mut leave = Stock::new();
    let mut takes = Stock::new();
    for g in ALL_GOODS {
        let aim = held(&half_way, g) * share;
        // Rounded so that what it ends up with fits, when it was cut to fit.
        let over = carried(g) - aim;
        let more = if share < 1.0 { (over - 1e-9).ceil() } else { (over + 1e-9).floor() };
        let less = (aim - carried(g) + 1e-9).floor();
        if more > 0.0 {
            leave.insert(g, more);
        } else if less > 0.0 {
            takes.insert(g, less);
        }
    }
    let lacking = (food_to_hold - on_board).min(held(there, Good::Food)).floor();
    if lacking > held(&takes, Good::Food) {
        takes.insert(Good::Food, lacking);
        leave.shift_remove(&Good::Food);
    }
    TraderPlan { leave, take: takes }
}

/// Whether the trader's place now is the HQ (`atTheHq`): it is sent from there, or has come round
/// to it.
fn at_the_hq(world: &WorldState, t: &Trader) -> bool {
    t.heading == Heading::Hq || trade_org_hq(world).is_some_and(|hq| hq.id == t.post_id)
}

/// The trader's place now (`traderEnd`): its storage and warehouse, at the HQ or at `post_id`.
fn trader_end(world: &WorldState, t: &Trader) -> RouteEnd {
    if at_the_hq(world, t) {
        hq_end(world)
    } else {
        post_end(world, &t.post_id)
    }
}

/// The building the trader stands at or goes to next (`traderStop`): at its place now, its
/// storage, its warehouse or the warehouse with its Coins, which at a post is the same one.
fn trader_stop(world: &WorldState, t: &Trader) -> Option<usize> {
    let end = trader_end(world, t);
    match t.stop {
        TraderStop::Storage => end.storage,
        TraderStop::Warehouse => end.warehouse,
        TraderStop::CoinWarehouse => {
            let w = end.warehouse?;
            let coins = trade_coin_warehouse(world, &world.buildings[w])?.id.clone();
            world.buildings.iter().position(|b| b.id == coins)
        }
    }
}

/// Where the trader goes on to (`nextStop`): sent from the HQ, the post it was bound for; from a
/// stop, the next on its loop.
fn next_stop(world: &WorldState, t: &Trader) -> String {
    let hq = trade_org_hq(world).map(|c| c.id.as_str());
    if t.heading == Heading::Hq && Some(t.post_id.as_str()) != hq {
        return t.post_id.clone();
    }
    let at = t.r#loop.iter().position(|p| *p == t.post_id).map_or(0, |i| i + 1);
    t.r#loop[at % t.r#loop.len()].clone()
}

/// The trader goes on to its next stop, its storage first (`goOn`). The cities it stops at on the
/// way are worked out anew.
fn go_on(world: &mut WorldState, ti: usize) {
    let next = next_stop(world, &world.traders[ti]);
    let t = &mut world.traders[ti];
    t.post_id = next;
    t.heading = Heading::Post;
    t.stop = TraderStop::Storage;
    t.plan = None;
    t.misses = 0.0;
    t.calls = None;
}

/// The Food a trader wants on board to reach stop `stop_id` from where its carriage `ki` stands,
/// the cities it stops at on the way counted (`wayFoodTo`, `CONTEXT.md`: Waiting for Food).
fn way_food_to(world: &WorldState, t: &Trader, stop_id: &str, ki: usize, size: i32) -> f64 {
    let Some(to) = place_of(world, stop_id) else { return 0.0 };
    let k = &world.carriages[ki];
    let stops = calls_on_the_way(world, (k.x, k.y), to, size).len() as f64;
    food_for_way(t.escort_ids.len() as f64, dist(size, (k.x, k.y), to), stops)
}

/// Whether a trader about to leave the HQ stays for Food (`waitsForFood`, `CONTEXT.md`: Waiting
/// for Food): it holds too little for the way, so it stands at the goods warehouse until that has
/// some, then evens out again, which takes what it lacks.
fn waits_for_food(world: &mut WorldState, ti: usize, ki: usize, size: i32) -> bool {
    let Some(w) = hq_end(world).warehouse else { return false };
    let next = next_stop(world, &world.traders[ti]);
    let want = way_food_to(world, &world.traders[ti], &next, ki, size);
    if held(&world.carriages[ki].load, Good::Food) >= want {
        return false;
    }
    let b = &world.buildings[w];
    let spare = held_in(b.stock.as_ref(), Good::Food) - owed_by(world, &b.id, Good::Food);
    let t = &mut world.traders[ti];
    t.stop = TraderStop::Warehouse;
    t.plan = if spare >= 1.0 {
        None
    } else {
        Some(TraderPlan { leave: Stock::new(), take: Stock::new() })
    };
    true
}

/// The city of the post a trader is out to, when that has been lost (`lostPostAhead`).
fn lost_post_ahead(world: &WorldState, t: &Trader) -> Option<City> {
    if t.heading != Heading::Post {
        return None;
    }
    world.cities.iter().find(|c| c.id == t.post_id && c.trade_org.is_none()).cloned()
}

/// A trader coming into the area of the lost post it was out to finds out (`reachLostPost`,
/// `CONTEXT.md`: Lost post found out): it drops the post from its loop and goes on, and those of
/// its crew with it carry the news, as witnesses of the capture, to the next city of the Trade
/// Organization they stand in. A stop there is given up, and the city is left out of its calls on
/// the way on. With no crew by the carriage nobody has seen it yet.
fn reach_lost_post(world: &mut WorldState, ti: usize, ki: usize, size: i32) {
    let Some(city) = lost_post_ahead(world, &world.traders[ti]) else { return };
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    if !in_city_area(world, &city.id, k.0, k.1, size) {
        return;
    }
    let t = &world.traders[ti];
    let crew: Vec<usize> = crew_ids_of(t.driver_id.as_deref(), &t.escort_ids)
        .iter()
        .filter_map(|id| world.residents.iter().position(|r| &r.id == id))
        .filter(|&i| {
            let r = &world.residents[i];
            r.health > 0.0 && dist(size, (r.x, r.y), k) <= SIGHT_RANGE
        })
        .collect();
    if crew.is_empty() {
        return;
    }
    let ids: Vec<String> = crew.iter().map(|&i| world.residents[i].id.clone()).collect();
    if let Some(crime) = world.crimes.iter_mut().find(|c| {
        c.post.as_deref() == Some(city.id.as_str()) && !c.known_by.contains(&c.victim_org)
    }) {
        for id in &ids {
            if !crime.witnesses.contains(id) {
                crime.witnesses.push(id.clone());
            }
        }
    }
    drop_from_loop(&mut world.traders[ti], &city.id);
    if world.traders[ti].stand.as_ref().is_some_and(|s| s.city_id == city.id) {
        world.traders[ti].stand = None;
    }
    work_out_calls(world, ti, ki, size);
    if let Some(calls) = world.traders[ti].calls.as_mut() {
        calls.retain(|id| *id != city.id);
    } else {
        world.traders[ti].calls = Some(Vec::new());
    }
    // A drive to another city's stop goes on; one to here is over.
    let driver = world.traders[ti].driver_id.clone();
    let di = crew.iter().copied().find(|&i| Some(&world.residents[i].id) == driver.as_ref());
    if let Some(di) = di {
        if world.traders[ti].stand.is_none()
            && matches!(world.residents[di].order, Some(ResidentOrder::Drive(_)))
        {
            world.residents[di].order = None;
        }
    }
}

fn drive(world: &mut WorldState, ri: usize, ki: usize, to: (f64, f64), near: Option<bool>) {
    let carriage_id = world.carriages[ki].id.clone();
    world.residents[ri].order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id,
        target: Tile { x: to.0, y: to.1 },
        path: None,
        progress: 0.0,
        army: None,
        near,
    }));
}

/// A trader's driver drives up to the lost post `city`, to its nearest building, in contact rather
/// than on it (`driveToLostPost`). Getting no nearer after `TRADER_DRIVE_TRIES` drives it goes on,
/// the post still on its loop for next time round.
fn drive_to_lost_post(
    world: &mut WorldState,
    ti: usize,
    city: &City,
    ri: usize,
    ki: usize,
    size: i32,
) {
    // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
    if horse_lies_down(world, ki) {
        return;
    }
    let standing: Vec<&Building> = world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city.id.as_str()) && is_city_building(b))
        .collect();
    if world.traders[ti].misses >= TRADER_DRIVE_TRIES || standing.is_empty() {
        go_on(world, ti);
        return;
    }
    let k = (world.carriages[ki].x, world.carriages[ki].y);
    let mut nearest = standing[0];
    for &b in &standing[1..] {
        if dist(size, k, (b.x, b.y)) < dist(size, k, (nearest.x, nearest.y)) {
            nearest = b;
        }
    }
    let to = (nearest.x, nearest.y);
    world.traders[ti].misses += 1.0;
    drive(world, ri, ki, to, Some(true));
}

/// The next of `goods` this warehouse keeps (`keeps`) that can be moved, what is left of it noted;
/// `None` with none left (`nextOf`).
fn next_of(goods: &mut Stock, keeps: &[Good], most: impl Fn(Good) -> f64) -> Option<Stock> {
    let entries: Vec<(Good, f64)> = goods.iter().map(|(&g, &n)| (g, n)).collect();
    for (g, wanted) in entries {
        if !keeps.contains(&g) {
            continue;
        }
        let units = wanted.min(most(g));
        if units <= 0.0 || wanted - units <= 0.0 {
            goods.shift_remove(&g);
        } else {
            goods.insert(g, wanted - units);
        }
        if units > 0.0 {
            return Some(Stock::from([(g, units)]));
        }
    }
    None
}

/// One tick of trader `ti` whose driver `ri` is idle with carriage `ki` (`runTrader`): out to a lost
/// post, drive up to it. Otherwise drive to the next stop, going on after `TRADER_DRIVE_TRIES`
/// drives that end short of it; at a storage, top up the Food on board for its crew; at a
/// warehouse, even out its load (`even_out_load`), leaving first, beyond what the warehouse keeps
/// for deliveries; then go on. At the HQ its Coins are moved in its coin warehouse after the other
/// goods; at its goods warehouse the trader first waits for its escort to be armed, with no post
/// left stays there, and leaves only with enough Food for the way (`waits_for_food`).
fn run_trader(world: &mut WorldState, ti: usize, ri: usize, ki: usize, size: i32) {
    let c = Convoy::Trader(ti);
    if let Some(lost) = lost_post_ahead(world, &world.traders[ti]) {
        drive_to_lost_post(world, ti, &lost, ri, ki, size);
        return;
    }
    let Some(stop) = trader_stop(world, &world.traders[ti]) else {
        if world.traders[ti].stop == TraderStop::Storage {
            world.traders[ti].stop = TraderStop::Warehouse;
        } else {
            go_on(world, ti);
        }
        return;
    };
    let r = &world.residents[ri];
    if !is_at(tile(r.x, r.y), placed(&world.buildings[stop]), size) {
        // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
        if horse_lies_down(world, ki) {
            return;
        }
        if world.traders[ti].misses >= TRADER_DRIVE_TRIES {
            go_on(world, ti);
            return;
        }
        world.traders[ti].misses += 1.0;
        let to = (world.buildings[stop].x, world.buildings[stop].y);
        drive(world, ri, ki, to, None);
        return;
    }
    world.traders[ti].misses = 0.0;
    if put_down_held(world, c, ri, stop, ki) {
        return;
    }
    if world.traders[ti].stop == TraderStop::Storage {
        if !top_up_food(world, c, ri, stop, ki) {
            world.traders[ti].stop = TraderStop::Warehouse;
        }
        return;
    }
    let at_hq = at_the_hq(world, &world.traders[ti]);
    if world.traders[ti].stop == TraderStop::Warehouse && at_hq {
        let t = &world.traders[ti];
        let armed = t.escort_ids.iter().all(|id| {
            world.residents.iter().find(|r| &r.id == id).is_none_or(|r| is_armed(&r.carried))
        });
        if !armed || t.r#loop.len() < 2 {
            return;
        }
    }
    let b = &world.buildings[stop];
    let stock = b.stock.clone().unwrap_or_default();
    if world.traders[ti].plan.is_none() {
        let coins = trade_coin_warehouse(world, b);
        let mut spare = Stock::new();
        for g in ALL_GOODS {
            let had = if g == Good::Coins {
                held_in(coins.and_then(|w| w.stock.as_ref()), Good::Coins)
            } else {
                held(&stock, g)
            };
            spare.insert(g, had - owed_by(world, &b.id, g));
        }
        let t = &world.traders[ti];
        let food_to_hold = if at_hq {
            let next = next_stop(world, t);
            way_food_to(world, t, &next, ki, size)
        } else {
            0.0
        };
        let plan = even_out_load(
            &spare,
            &world.carriages[ki].load,
            caravan_food_for(t.escort_ids.len() as f64),
            carriage_capacity(world, &world.carriages[ki]),
            food_to_hold,
        );
        world.traders[ti].plan = Some(plan);
    }
    let here = GoodsSpot::Storage { storage_id: world.buildings[stop].id.clone() };
    let on_carriage = GoodsSpot::Carriage { carriage_id: world.carriages[ki].id.clone() };
    let keeps = warehouse_keeps(world, &world.buildings[stop]);
    let tick = world.tick as f64;
    let mut plan = world.traders[ti].plan.take().expect("just made");
    let off = {
        let load = &world.carriages[ki].load;
        let driver = &world.residents[ri];
        next_of(&mut plan.leave, &keeps, |g| held(load, g).min(units_that_fit(driver, g, tick)))
    };
    if let Some(off) = off {
        world.traders[ti].plan = Some(plan);
        take(world, c, ri, on_carriage, off, Onto::Stop);
        return;
    }
    let on = {
        let k = &world.carriages[ki];
        let driver = &world.residents[ri];
        next_of(&mut plan.take, &keeps, |g| {
            held(&stock, g)
                .min(units_that_fit(driver, g, tick))
                .min(units_that_fit_carriage(world, k, g))
        })
    };
    if let Some(on) = on {
        world.traders[ti].plan = Some(plan);
        take(world, c, ri, here, on, Onto::Carriage);
        return;
    }
    // What is left of the plan is what this warehouse doesn't keep: at the HQ, the Coins.
    let coins_left = !plan.leave.is_empty() || !plan.take.is_empty();
    world.traders[ti].plan = Some(plan);
    if world.traders[ti].stop == TraderStop::Warehouse && coins_left {
        world.traders[ti].stop = TraderStop::CoinWarehouse;
    } else if !at_hq || !waits_for_food(world, ti, ki, size) {
        go_on(world, ti);
    }
}

/// The trader's loop follows the world's posts (`followPosts`, `CONTEXT.md`: Wandering trader): new
/// ones join it where they add the least way. One lost stays on it until the trader gets there, and
/// only a city no longer there at all drops at once.
fn follow_posts(world: &mut WorldState, ti: usize, posts: &[String], size: i32) {
    let stops = world.traders[ti].r#loop.clone();
    for id in stops {
        if !world.cities.iter().any(|c| c.id == id) {
            drop_from_loop(&mut world.traders[ti], &id);
        }
    }
    for post in posts {
        if !world.traders[ti].r#loop.contains(post) {
            let mut stops = std::mem::take(&mut world.traders[ti].r#loop);
            insert_into_loop(world, &mut stops, post, size);
            world.traders[ti].r#loop = stops;
        }
    }
}

/// The cities a trader stops at on its way from where its carriage stands to its next place,
/// worked out when it sets off on that way (`workOutCalls`, `CONTEXT.md`: Trader stop).
fn work_out_calls(world: &mut WorldState, ti: usize, ki: usize, size: i32) {
    if world.traders[ti].calls.is_some() {
        return;
    }
    let end = trader_end(world, &world.traders[ti]);
    let calls = match end.storage.or(end.warehouse) {
        Some(b) => {
            let k = &world.carriages[ki];
            let to = &world.buildings[b];
            calls_on_the_way(world, (k.x, k.y), (to.x, to.y), size)
        }
        None => Vec::new(),
    };
    world.traders[ti].calls = Some(calls);
}

/// One tick of the Trade Org's wandering traders (`stepTraders`, `CONTEXT.md`: Wandering trader),
/// run before the actions are requested: escorts who are gone leave it; one whose carriage or HQ is
/// gone ends, its crew left to the HQ; its loop follows the posts; it finds out a lost post on
/// reaching it; and its crew and carriage go as for a caravan (`step_crew`), a driver idle with the
/// carriage making its stops on the way (`run_stops`), then going on along its loop
/// (`run_trader`). Without `terrain` it makes no stops.
pub fn step_traders(world: &mut WorldState, size: i32, terrain: Option<&TerrainMap>) {
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let posts: Vec<String> = trading_posts(world).into_iter().map(|c| c.id.clone()).collect();
    let mut ti = 0;
    while ti < world.traders.len() {
        let ids: HashSet<String> = world.residents.iter().map(|r| r.id.clone()).collect();
        world.traders[ti].escort_ids.retain(|id| ids.contains(id));
        let carriage = world.carriages.iter().position(|k| k.id == world.traders[ti].carriage_id);
        let (Some(hq), Some(ki)) = (hq.as_deref(), carriage) else {
            world.traders.remove(ti);
            continue;
        };
        follow_posts(world, ti, &posts, size);
        reach_lost_post(world, ti, ki, size);
        let wanted = trader_escorts_wanted(&world.traders[ti]);
        step_crew(world, Convoy::Trader(ti), ki, hq, wanted, size, &mut |world, ri| {
            work_out_calls(world, ti, ki, size);
            if let Some(terrain) = terrain {
                if run_stops(world, ti, ri, ki, terrain) {
                    return;
                }
            }
            run_trader(world, ti, ri, ki, size);
        });
        ti += 1;
    }
}

/// Resident `ri` took goods off carriage `carriage_id` (`robTrader`, `CONTEXT.md`: Wandering
/// trader): when it is a trader's and they aren't of the Trade Organization, they robbed it, which
/// it counts once a tick however many take from it (`robbed`) and which earns it more escorts. With
/// `whole`, the carriage itself was taken, which one of the Trade Org's own hired out does too.
pub fn rob_trader(
    world: &mut WorldState,
    ri: usize,
    carriage_id: &str,
    robbed: &mut HashSet<String>,
    whole: bool,
) {
    let Some(ti) = world.traders.iter().position(|t| t.carriage_id == carriage_id) else { return };
    let tid = world.traders[ti].id.clone();
    if (of_trade_org(world, &world.residents[ri]) && !whole) || robbed.contains(&tid) {
        return;
    }
    robbed.insert(tid);
    world.traders[ti].robberies += 1.0;
}

/// `thief` stole a carriage (`traderCarriageStolen`, `CONTEXT.md`: Wandering trader, Caravan crew
/// lost): when it was a trader's that robs it, and the same trader gets a new carriage and horse at
/// the HQ's goods warehouse, where it is sent out again to the stop it was bound for. With no HQ
/// left to give them, the trader ends.
pub fn trader_carriage_stolen(world: &mut WorldState, thief: usize, carriage_id: &str) {
    let Some(ti) = world.traders.iter().position(|t| t.carriage_id == carriage_id) else { return };
    rob_trader(world, thief, carriage_id, &mut HashSet::new(), true);
    let at = trade_org_hq(world)
        .cloned()
        .and_then(|hq| goods_warehouse_at(world, &hq).map(|xy| (hq, xy)));
    let Some((hq, (x, y))) = at else {
        world.traders.remove(ti);
        return;
    };
    let seed = format!("{}:trader-horse:{}:{carriage_id}", world.seed, world.traders[ti].id);
    let new = new_caravan_carriage(world, &hq.id, x, y, &seed);
    let t = &mut world.traders[ti];
    t.carriage_id = new;
    t.heading = Heading::Hq;
    t.stop = TraderStop::Storage;
    t.plan = None;
    t.misses = 0.0;
    t.calls = None;
    t.stand = None;
}

/// Wandering traders hold together (`tradersSound`, `CONTEXT.md`: Wandering trader, Caravan crew
/// lost; ADR 0004): each one's loop holds the HQ and otherwise names cities that exist, each once,
/// and it goes to one of them; it makes for a coin warehouse only at the HQ; its carriage is of the
/// Trade Organization and its crew exist and are the HQ's; it has no driver only with no crew left;
/// nobody is on two traders or caravans; the driver drives only its carriage; it walks with no more
/// escorts than it gets; what it means to take fits on a carriage; and one just set off from the HQ
/// holds enough for its way, but for what it ate since it loaded (`SET_OFF_FOOD_SLACK`).
pub fn traders_sound(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let n = crate::invariants::js_number;
    let mut out = Vec::new();
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    let mut crew: HashSet<String> = world
        .caravans
        .iter()
        .flat_map(|c| crew_ids_of(c.driver_id.as_deref(), &c.escort_ids))
        .collect();
    for t in &world.traders {
        let mut fail = |message: String, ids: Vec<String>| {
            let mut entity_ids = vec![t.id.clone()];
            entity_ids.extend(ids);
            out.push(InvariantViolation {
                invariant: "traders-sound".into(),
                message: format!("trader {} {message}", t.id),
                entity_ids,
            })
        };
        for id in &t.r#loop {
            if !world.cities.iter().any(|c| &c.id == id) {
                fail(format!("has {id} on its loop, which is no city"), vec![id.clone()]);
            }
        }
        if let Some(hq) = &hq {
            if !t.r#loop.contains(hq) {
                fail("has no HQ on its loop".into(), vec![hq.clone()]);
            }
        }
        if t.r#loop.iter().collect::<HashSet<_>>().len() != t.r#loop.len() {
            fail("has a stop twice on its loop".into(), vec![]);
        }
        if !t.r#loop.contains(&t.post_id) {
            fail(
                format!("goes to {}, which isn't on its loop of {}", t.post_id, t.r#loop.len()),
                vec![],
            );
        }
        if t.stop == TraderStop::CoinWarehouse && !at_the_hq(world, t) {
            fail(
                format!("makes for a coin warehouse at {}, which is not the HQ", t.post_id),
                vec![],
            );
        }
        let ki = world.carriages.iter().position(|x| x.id == t.carriage_id);
        match ki {
            None => fail(format!("has carriage {}, which doesn't exist", t.carriage_id), vec![]),
            Some(ki) => {
                let k = &world.carriages[ki];
                if k.realm_id.is_some() || k.city_id != hq {
                    fail(
                        format!("has carriage {}, which isn't the Trade Org HQ's", k.id),
                        vec![k.id.clone()],
                    );
                }
            }
        }
        if t.driver_id.is_none() && !t.escort_ids.is_empty() {
            fail("has no driver, though an escort could take over".into(), vec![]);
        }
        for id in crew_ids_of(t.driver_id.as_deref(), &t.escort_ids) {
            match world.residents.iter().find(|x| x.id == id) {
                None => fail(format!("has crew {id}, who doesn't exist"), vec![]),
                Some(r) if r.owner.is_some() || r.city_id != hq => {
                    fail(format!("has crew {id}, who isn't of the Trade Org HQ"), vec![id.clone()])
                }
                _ => {}
            }
            if !crew.insert(id.clone()) {
                fail(format!("has crew {id} twice or shared with another"), vec![id.clone()]);
            }
        }
        let wanted = trader_escorts_wanted(t);
        if t.escort_ids.len() as f64 > wanted {
            fail(
                format!(
                    "walks with {} escorts, more than the {} it gets",
                    t.escort_ids.len(),
                    n(wanted)
                ),
                vec![],
            );
        }
        let driver = world.residents.iter().find(|x| t.driver_id.as_ref() == Some(&x.id));
        if let Some(d) = driver {
            if let Some(ResidentOrder::Drive(o)) = &d.order {
                if o.carriage_id != t.carriage_id {
                    fail(format!("has its driver driving {}", o.carriage_id), vec![d.id.clone()]);
                }
            }
        }
        let holds =
            ki.map_or(CARRIAGE_CAPACITY, |ki| carriage_capacity(world, &world.carriages[ki]));
        if let Some(plan) = &t.plan {
            if stock_weight(&plan.take) > holds + 1e-9 {
                fail(
                    format!(
                        "means to take {} kg, more than a carriage holds",
                        n(stock_weight(&plan.take))
                    ),
                    vec![],
                );
            }
        }
        if let (Some(ki), Some(_)) = (ki, driver) {
            if !at_the_hq(world, t) && stands_at_hq_stop(world, ki, terrain.size) {
                let want = way_food_to(world, t, &t.post_id, ki, terrain.size) - SET_OFF_FOOD_SLACK;
                let food = held(&world.carriages[ki].load, Good::Food);
                if food < want {
                    fail(
                        format!("set off from the HQ with {} Food, wanting {}", n(food), n(want)),
                        vec![world.carriages[ki].id.clone()],
                    );
                }
            }
        }
    }
    out
}
