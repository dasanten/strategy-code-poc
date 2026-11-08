//! What the goods tests (T86.5) share: an open map, residents and buildings as the TypeScript
//! tests build them, and orders sent and stepped as `OrderQueue.receive`, `applyAll` and
//! `stepWorld` do. The queue itself is T86.2's: until it lands, `Queue` checks and applies the
//! goods order kinds directly, as their `validate` and `apply` do.

#![allow(dead_code)]

use csp_shared::balance::{ticks_for_age, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, Good, OrderRequest, Realm, Resident, Stock, TradeSide, WorldState,
};
use csp_sim::goods_deps::OrderSender;
use csp_sim::tick::Scratch;
use csp_sim::world::{create_world, step_world};
use csp_sim::{buying, carrying, hauling, storing, trading};
use serde_json::{json, Value};

/// A map of `size` by `size` Plains tiles (`open`).
pub fn open(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// A new world on a map (`createWorld`).
pub fn world_on(terrain: &TerrainMap) -> WorldState {
    create_world(terrain, 1)
}

/// The sender of a Player's orders.
pub fn player(user_id: u64) -> OrderSender {
    OrderSender::player(user_id, "Mara")
}

/// A realm of Player `user_id` led by `leader_id`.
pub fn realm(id: &str, user_id: u64, leader_id: &str) -> Realm {
    serde_json::from_value(json!({ "id": id, "userId": user_id, "leaderId": leader_id })).unwrap()
}

/// A grown-up resident as `newResident` makes them, every base stat 10 and 25 years old at tick 0
/// (the TypeScript draws them; the tests that care set them).
pub fn resident(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let stat = json!({ "base": 10, "trained": 0 });
    serde_json::from_value(json!({
        "id": id,
        "name": id,
        "owner": owner,
        "cityId": null,
        "x": x,
        "y": y,
        "stats": { "strength": stat, "endurance": stat, "agility": stat, "intellect": stat },
        "skills": {},
        "health": MAX_HEALTH,
        "hunger": MAX_HUNGER,
        "bornAt": -ticks_for_age(25.0).round(),
        "lifespan": 70,
        "carried": {},
        "order": null,
    }))
    .unwrap()
}

/// A building from its plain-data fields, as the TypeScript tests write them.
pub fn building(v: Value) -> Building {
    serde_json::from_value(v).unwrap()
}

/// A stock from plain data.
pub fn stock(v: Value) -> Stock {
    serde_json::from_value(v).unwrap()
}

/// An order request from plain data.
pub fn request(v: Value) -> OrderRequest {
    serde_json::from_value(v).unwrap()
}

/// Checks an order of a goods kind (`OrderKind.validate`).
pub fn validate(
    world: &WorldState,
    sender: &OrderSender,
    o: &OrderRequest,
    terrain: &TerrainMap,
) -> Option<String> {
    let size = terrain.size;
    match o.kind.as_str() {
        "pickUp" => carrying::validate_pick_up(world, sender, o),
        "drop" => carrying::validate_drop(world, sender, o),
        "store" => storing::validate_store(world, sender, o, size),
        "fetch" => storing::validate_fetch(world, sender, o, size),
        "haul" => hauling::validate_haul(world, sender, o, Some(terrain)),
        "stop" => hauling::validate_stop(world, sender, o),
        "buyCity" => buying::validate_buy_city(world, sender, o),
        "buy" => trading::validate_trade(world, sender, o, TradeSide::Buy),
        "sell" => trading::validate_trade(world, sender, o, TradeSide::Sell),
        "swap" => trading::validate_swap(world, sender, o),
        "buyHorse" => trading::validate_buy_horse(world, sender, o),
        "sellHorse" => trading::validate_sell_horse(world, sender, o),
        "transfer" => csp_sim::transfers::validate_transfer(world, sender, o),
        "handIn" => csp_sim::transfers::validate_hand_in(world, sender, o),
        k => panic!("no goods order kind {k}"),
    }
}

/// Gives an order of a goods kind (`OrderKind.apply`).
pub fn apply(world: &mut WorldState, sender: &OrderSender, o: &OrderRequest, size: i32) {
    match o.kind.as_str() {
        "pickUp" => carrying::apply_pick_up(world, sender, o),
        "drop" => carrying::apply_drop(world, sender, o),
        "store" => storing::apply_store(world, sender, o, size),
        "fetch" => storing::apply_fetch(world, sender, o, size),
        "haul" => hauling::apply_haul(world, sender, o),
        "stop" => hauling::apply_stop(world, sender, o),
        "buyCity" => buying::apply_buy_city(world, sender, o),
        "buy" => trading::apply_trade(world, sender, o, TradeSide::Buy),
        "sell" => trading::apply_trade(world, sender, o, TradeSide::Sell),
        "swap" => trading::apply_swap(world, sender, o),
        "buyHorse" => trading::apply_buy_horse(world, sender, o),
        "sellHorse" => trading::apply_sell_horse(world, sender, o),
        "transfer" => csp_sim::transfers::apply_transfer(world, sender, o, size),
        "handIn" => csp_sim::transfers::apply_hand_in(world, sender, o),
        k => panic!("no goods order kind {k}"),
    }
}

/// Orders received and not yet applied (`OrderQueue`, for the goods kinds).
pub struct Queue {
    pending: Vec<(OrderSender, OrderRequest)>,
    terrain: TerrainMap,
}

impl Queue {
    pub fn new(terrain: &TerrainMap) -> Self {
        Queue { pending: Vec::new(), terrain: terrain.clone() }
    }

    /// Receives an order (`receive`): `Ok` for an ack, `Err(reason)` when rejected.
    pub fn receive(
        &mut self,
        world: &WorldState,
        sender: &OrderSender,
        o: Value,
    ) -> Result<(), String> {
        let o = request(o);
        match validate(world, sender, &o, &self.terrain) {
            Some(reason) => Err(reason),
            None => {
                self.pending.push((sender.clone(), o));
                Ok(())
            }
        }
    }

    /// How many orders wait to be applied (`size`).
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    /// Applies every order received (`applyAll`).
    pub fn apply_all(&mut self, world: &mut WorldState) {
        for (sender, o) in std::mem::take(&mut self.pending) {
            apply(world, &sender, &o, self.terrain.size);
        }
    }
}

/// One step of the world (`stepWorld`), nobody walking.
pub fn step(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    step_world(world, terrain, scratch, None, None);
}

/// Sends an order and, if accepted, runs the tick that resolves it (`order`).
pub fn order(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    sender: &OrderSender,
    o: Value,
) -> Result<(), String> {
    let mut q = Queue::new(terrain);
    let answer = q.receive(world, sender, o);
    q.apply_all(world);
    step(world, terrain, scratch);
    answer
}

/// Every unit of each good in the world, wherever it is (`total`).
pub fn total(world: &WorldState) -> Stock {
    let mut out = Stock::new();
    let mut add = |s: Option<&Stock>| {
        for (g, n) in s.into_iter().flatten() {
            *out.entry(*g).or_insert(0.0) += n;
        }
    };
    world.residents.iter().for_each(|r| add(Some(&r.carried)));
    world.buildings.iter().for_each(|b| add(b.stock.as_ref()));
    world.piles.iter().for_each(|p| add(Some(&p.goods)));
    world.carriages.iter().for_each(|k| add(Some(&k.load)));
    out
}

/// Units of a good in a stock.
pub fn units(stock: &Stock, good: Good) -> f64 {
    stock.get(&good).copied().unwrap_or(0.0)
}

/// Whether two stocks hold the same goods and units, in any order (`toEqual`).
pub fn same(a: &Stock, b: &Stock) -> bool {
    a.len() == b.len() && a.iter().all(|(g, n)| b.get(g) == Some(n))
}

/// Asserts a stock holds just these goods: `assert_stock!(r.carried, { "food": 5 })`.
#[macro_export]
macro_rules! assert_stock {
    ($got:expr, $want:tt) => {{
        let want: csp_shared::world::Stock =
            serde_json::from_value(serde_json::json!($want)).unwrap();
        let got = &$got;
        assert!(goods_support::same(got, &want), "stock {:?}, want {:?}", got, want);
    }};
}

/// A stand-in for `Walking` (T86.4) in the goods tests: on an open map with nothing in the way,
/// a store or fetch order walking to its place, and a haul route driving to its next stop, take
/// one step a tick straight toward it (diagonals too, the short way round) and arrive as
/// `walking.ts`'s `arrive` has them: store putting, fetch taking, a haul route loading. A driver
/// takes their carriage and its horse along. Nothing else walks.
pub struct StraightWalk {
    pub size: i32,
}

fn toward(from: f64, to: f64, size: i32) -> f64 {
    let d = csp_shared::terrain::wrap_delta(from as i32, to as i32, size);
    csp_shared::terrain::wrap(from as i32 + d.signum(), size) as f64
}

impl csp_sim::tick::Walk for StraightWalk {
    fn walk(&mut self, world: &mut WorldState, _scratch: &mut Scratch) -> usize {
        use csp_shared::world::{FetchPhase, HaulPhase, HaulStop, ResidentOrder, StorePhase};
        let mut steps = 0;
        for ri in 0..world.residents.len() {
            let (x, y) = (world.residents[ri].x, world.residents[ri].y);
            let target = match &world.residents[ri].order {
                Some(ResidentOrder::Store(o)) if o.phase == StorePhase::Walking => {
                    storing::place_tile(world, &o.to)
                }
                Some(ResidentOrder::Fetch(o)) if o.phase == FetchPhase::Walking => {
                    storing::place_tile(world, &o.from)
                }
                Some(ResidentOrder::Haul(o)) if o.phase == HaulPhase::Driving => {
                    let t = if o.stop == HaulStop::To { &o.to } else { &o.from };
                    Some((t.x, t.y))
                }
                _ => continue,
            };
            let Some((tx, ty)) = target else { continue };
            if (x, y) != (tx, ty) {
                let (nx, ny) = (toward(x, tx, self.size), toward(y, ty, self.size));
                if let Some(ResidentOrder::Haul(o)) = &world.residents[ri].order {
                    // As `Walking` resolves a drive step: without its horse there, or with it
                    // Down, the order ends; else the horse pulls the carriage, hitched.
                    let id = o.carriage_id.clone();
                    let k = world.carriages.iter().position(|k| k.id == id);
                    let horse = k.and_then(|k| {
                        csp_sim::queries::carriages::horse_for(world, &world.carriages[k])
                    });
                    let pulls = horse.filter(|h| {
                        h.x == x && h.y == y && !csp_sim::queries::residents::is_down(h.down_until)
                    });
                    let (Some(k), Some(h)) = (k, pulls.map(|h| h.id.clone())) else {
                        world.residents[ri].order = None;
                        continue;
                    };
                    world.carriages[k].x = nx;
                    world.carriages[k].y = ny;
                    world.carriages[k].horse_id = Some(h.clone());
                    if let Some(h) = world.horses.iter_mut().find(|x| x.id == h) {
                        h.x = nx;
                        h.y = ny;
                    }
                }
                world.residents[ri].x = nx;
                world.residents[ri].y = ny;
                steps += 1;
            }
            if (world.residents[ri].x, world.residents[ri].y) != (tx, ty) {
                continue;
            }
            match world.residents[ri].order.as_mut() {
                Some(ResidentOrder::Store(o)) => {
                    o.phase = StorePhase::Putting;
                    o.path = None;
                    o.progress = 0.0;
                }
                Some(ResidentOrder::Fetch(o)) => {
                    o.phase = FetchPhase::Taking;
                    o.path = None;
                    o.progress = 0.0;
                }
                Some(ResidentOrder::Haul(o)) => {
                    o.phase = HaulPhase::Loading;
                    o.path = None;
                    o.progress = 0.0;
                }
                _ => {}
            }
        }
        steps
    }
}

/// One step of the world (`stepWorld`) with the stand-in walking.
pub fn step_walking(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    let mut walk = StraightWalk { size: terrain.size };
    step_world(world, terrain, scratch, Some(&mut walk), None);
}

/// A resident as `newResident(mulberry32(seed), { id, owner, x, y, tick: 0 })` draws them: base
/// stats `between` `STAT_BASE_MIN` and `STAT_BASE_MAX` in `STAT_NAMES`' order, then an age
/// between `START_AGE_MIN` and `START_AGE_MAX`. The name and lifespan drawn after are left as
/// `resident` gives them: no goods rule reads them.
pub fn new_resident(seed: f64, id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    use csp_shared::balance::{START_AGE_MAX, START_AGE_MIN, STAT_BASE_MAX, STAT_BASE_MIN};
    let mut rand = csp_sim::random::Mulberry32::new(seed);
    let mut between = |min: f64, max: f64| min + (rand.next() * (max - min + 1.0)).floor();
    let base: Vec<f64> = (0..4).map(|_| between(STAT_BASE_MIN, STAT_BASE_MAX)).collect();
    let age = START_AGE_MIN + rand.next() * (START_AGE_MAX - START_AGE_MIN);
    let mut r = resident(id, owner, x, y);
    r.stats.strength.base = base[0];
    r.stats.endurance.base = base[1];
    r.stats.agility.base = base[2];
    r.stats.intellect.base = base[3];
    r.born_at = -ticks_for_age(age).round();
    r
}
