//! An NPC city's own trade runs (`apps/server/src/npc-trader.ts`, `CONTEXT.md`: NPC trader). Its
//! planning pass sends spare hands, up to the number its size allows, each with a full load of a
//! surplus good to the nearest Trade Org warehouse in reach; between passes the city walks each
//! through their run with orders a Player could give (`run_trader`, ADR 0002). The runs are kept in
//! the city's plan (`CityPlan.traders`). A trader goes to a Player's offer in reach when one suits
//! the city, and only the planning pass looks for one (ADR 0016).

use std::collections::HashSet;

use csp_shared::balance::{
    set_out_food, GOOD_WEIGHT, NPC_OFFER_REACH, NPC_RESIDENTS_PER_TRADER, NPC_TRADER_GIVE_UP_DAYS,
    NPC_TRADER_REACH, OWN_FOOD, WALK_TICKS_PER_TILE,
};
use csp_shared::footprint::is_at;
use csp_shared::goods::{put_away_units, WEAPONS};
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    AcceptOfferOrder, Building, BuildingKind, Carriage, City, CityJob, CityJobKind, CityProject,
    CityTrader, CityTraderOffer, DropOrder, Good, GoodsSpot, Offer, PickUpOrder, ResidentOrder,
    Stock, TradeOrder, TradeSide, Trader, TraderLeg, WorldState,
};

use crate::npc_behaviour::{npc_home, walk_to, Jobs};
use crate::npc_chain::{chain_input, makes, project_needs, reserve_lacks, short_goods};
use crate::npc_plan::farmers_wanted;
use crate::npc_scouts::knows_node;
use crate::queries::alliance::allied;
use crate::queries::building::node_good;
use crate::queries::city::{city_residents, in_city_area, npc_city_refuses};
use crate::queries::names::{good_name, held, held_in, placed, PRICED_GOODS};
use crate::queries::npc_trade::{npc_city_stock, npc_reserve, npc_storages};
use crate::queries::residents::{carry_capacity, good_weight, is_armed};
use crate::queries::trade_quotes::{npc_offer_times, quote_with_trader, OfferTerms};
use crate::queries::trader_trade::{trader_prices, trader_standing, trader_stock};
use crate::queries::walls::wall_side;
use crate::queries::warehouse::{stock_floor, trade_coin_warehouse};
use crate::queries::warehouse_trade::{hands_of, TradeHolder};
use crate::sight::InvariantViolation;

/// Ticks after it left that a city stops waiting for its trader (`GIVE_UP_TICKS`).
const GIVE_UP_TICKS: f64 = NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY;

/// Whether a good is a weapon (`WEAPONS.includes`).
fn is_weapon(g: Good) -> bool {
    WEAPONS.contains(&good_name(g))
}

/// A job of trading.
fn trade_job() -> CityJob {
    CityJob {
        kind: CityJobKind::Trade,
        building_id: None,
        target_id: None,
        stable_id: None,
        ground_id: None,
        subject: None,
    }
}

/// How many traders a city has out at once (`tradersWanted`): one for each
/// `NPC_RESIDENTS_PER_TRADER` of its residents, and a village keeps one.
pub fn traders_wanted(world: &WorldState, city: &City) -> usize {
    1.max((city_residents(world, &city.id).len() as f64 / NPC_RESIDENTS_PER_TRADER).floor() as usize)
}

/// The city's traders still out (`tradersOut`), at the start of its planning pass: one out longer
/// than `NPC_TRADER_GIVE_UP_DAYS` is dropped from the plan first.
pub fn traders_out(world: &mut WorldState, city_id: &str) -> HashSet<String> {
    let tick = world.tick as f64;
    let plan = world.city_plans.get_mut(city_id).expect("a plan");
    let out: Vec<CityTrader> = plan
        .traders
        .take()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| tick - t.since <= GIVE_UP_TICKS)
        .collect();
    let ids = out.iter().map(|t| t.resident_id.clone()).collect();
    plan.traders = (!out.is_empty()).then_some(out);
    ids
}

/// What a city's traders out have spoken for (`SpokenFor`).
#[derive(Default)]
struct SpokenFor {
    takes: Stock,
    sells: HashSet<Good>,
    brings: HashSet<Good>,
}

/// What the city's traders out have spoken for (`spokenFor`).
fn spoken_for(world: &WorldState, city: &City, adults: &[usize]) -> SpokenFor {
    let mut spoken = SpokenFor::default();
    let traders = world.city_plans.get(&city.id).and_then(|p| p.traders.as_ref());
    for t in traders.into_iter().flatten() {
        let r = adults.iter().map(|&i| &world.residents[i]).find(|x| x.id == t.resident_id);
        let fetched = if t.visiting_id.is_some() {
            t.loaded == Some(true)
        } else {
            t.sells.keys().all(|g| r.is_some_and(|r| held(&r.carried, *g) >= 1.0))
        };
        for (good, units) in &t.sells {
            spoken.sells.insert(*good);
            if !fetched {
                *spoken.takes.entry(*good).or_insert(0.0) += units;
            }
        }
        spoken.brings.extend(t.buys.keys().copied());
        if !fetched && !t.buys.is_empty() {
            let coins = held(&npc_city_stock(world, city), Good::Coins)
                - held(&npc_reserve(world, city), Good::Coins);
            let entry = spoken.takes.entry(Good::Coins).or_insert(0.0);
            *entry = entry.max(coins);
        }
        if let Some(o) = &t.offer {
            if o.leg == TraderLeg::Load {
                *spoken.takes.entry(o.pays).or_insert(0.0) += o.units;
            }
            if let Some(offer) = world.offers.iter().find(|x| x.id == o.offer_id) {
                spoken.brings.insert(offer.gives);
            }
        }
    }
    spoken
}

/// The traders' part of a planning pass (`sendTraders`): it sends spare hands until it has as many
/// out as `traders_wanted` or nobody or nothing more to send. A wandering trader standing at the
/// city comes first.
pub fn send_traders(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    jobs: &mut Jobs,
    food_short: bool,
    size: i32,
) {
    let wanted = traders_wanted(world, city);
    loop {
        let out =
            world.city_plans.get(&city.id).and_then(|p| p.traders.as_ref()).map_or(0, Vec::len);
        if out >= wanted {
            return;
        }
        let sent = plan_visit(world, city, adults, jobs, size)
            || plan_trader(world, city, adults, jobs, food_short, size);
        if !sent {
            return;
        }
    }
}

/// Adds a run to the city's plan (`addRun`).
fn add_run(world: &mut WorldState, city_id: &str, run: CityTrader) {
    world
        .city_plans
        .get_mut(city_id)
        .expect("a plan")
        .traders
        .get_or_insert_with(Vec::new)
        .push(run);
}

/// One more trader for a city with room for one (`planTrader`). Returns whether it sent them.
fn plan_trader(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    jobs: &mut Jobs,
    food_short: bool,
    size: i32,
) -> bool {
    if (food_short && world.offers.is_empty()) || armed_outsiders(world, city, size, None) {
        return false;
    }
    let Some(home) = npc_home(world, &city.id).cloned() else { return false };
    let Some(r) = spare_hand(world, city, adults, jobs) else { return false };
    let spoken = spoken_for(world, city, adults);
    if plan_offer_run(world, city, r, &spoken, food_short, size) {
        jobs.insert(world.residents[r].id.clone(), trade_job());
        return true;
    }
    if food_short {
        return false;
    }
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let home_at = (home.x as i32, home.y as i32);
    let mut best: Option<(Good, f64, usize, f64, bool)> = None;
    for good in PRICED_GOODS {
        if is_weapon(good) {
            continue;
        }
        let surplus = held(&stock, good) - held(&reserve, good) - held(&spoken.takes, good);
        if surplus < 1.0 {
            continue;
        }
        let Some(w) = nearest_warehouse(world, home_at, good, size) else { continue };
        let wb = &world.buildings[w];
        let units =
            trader_load(world, r, good, wrap_distance(size, home_at, (wb.x as i32, wb.y as i32)));
        if units < 1.0 || surplus < units {
            continue;
        }
        let fresh = !spoken.sells.contains(&good);
        if best.is_some_and(|b| b.4 && !fresh) {
            continue;
        }
        if best.is_none_or(|b| fresh != b.4 || surplus - units > b.3) {
            best = Some((good, units, w, surplus - units, fresh));
        }
    }
    let Some((good, units, w, _, _)) = best else { return false };
    let mut buys = Stock::new();
    let project = world.city_plans.get(&city.id).and_then(|p| p.project.clone());
    if let Some(buy) = buy_good(world, city, home_at, w, project.as_ref(), &spoken, size) {
        buys.insert(buy, 1f64.max((held(&reserve, buy) - held(&stock, buy)).ceil()));
    }
    let run = CityTrader {
        resident_id: world.residents[r].id.clone(),
        warehouse_id: Some(world.buildings[w].id.clone()),
        visiting_id: None,
        loaded: None,
        offer: None,
        sells: Stock::from([(good, units)]),
        buys,
        since: world.tick as f64,
    };
    add_run(world, &city.id, run);
    jobs.insert(world.residents[r].id.clone(), trade_job());
    true
}

/// The spare hand a city sends to trade (`spareHand`), idle ones first, never a soldier.
fn spare_hand(world: &WorldState, city: &City, adults: &[usize], jobs: &Jobs) -> Option<usize> {
    let kind = |i: usize| jobs.get(&world.residents[i].id).map(|j| j.kind);
    let farmers: Vec<usize> =
        adults.iter().copied().filter(|&i| kind(i) == Some(CityJobKind::Farm)).collect();
    let wanted = farmers_wanted(world, city) as usize;
    let extra: HashSet<usize> = farmers.into_iter().skip(wanted).collect();
    let rank = |i: usize| -> Option<u8> {
        let r = &world.residents[i];
        if is_armed(&r.carried) || r.carrying.is_some() {
            return None;
        }
        match kind(i) {
            Some(CityJobKind::Idle) => Some(0),
            Some(CityJobKind::Work) => Some(1),
            Some(CityJobKind::Road) => Some(2),
            Some(CityJobKind::Scout) => Some(4),
            _ => extra.contains(&i).then_some(3),
        }
    };
    let mut spare: Vec<(usize, u8)> =
        adults.iter().filter_map(|&i| rank(i).map(|k| (i, k))).collect();
    spare.sort_by_key(|(_, k)| *k);
    spare.first().map(|(i, _)| *i)
}

/// An NPC city treats a wandering trader standing at it as its visiting trader (`planVisit`).
/// Whether it sent someone; their job becomes `trade`.
fn plan_visit(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    jobs: &mut Jobs,
    size: i32,
) -> bool {
    let Some(visitor) = world
        .traders
        .iter()
        .find(|t| trader_standing(world, t).is_some_and(|s| s.city_id == city.id))
    else {
        return false;
    };
    let Some(carriage) = world.carriages.iter().find(|k| k.id == visitor.carriage_id) else {
        return false;
    };
    let crew: HashSet<String> = world
        .caravans
        .iter()
        .flat_map(|c| c.driver_id.iter().chain(&c.escort_ids))
        .chain(world.traders.iter().flat_map(|t| t.driver_id.iter().chain(&t.escort_ids)))
        .cloned()
        .collect();
    if armed_outsiders(world, city, size, Some(&crew)) {
        return false;
    }
    let Some(r) = spare_hand(world, city, adults, jobs) else { return false };
    let spoken = spoken_for(world, city, adults);
    let project = world.city_plans.get(&city.id).and_then(|p| p.project.clone());
    let Some((sells, buys)) =
        visit_deal(world, city, project.as_ref(), r, visitor, carriage, &spoken, size)
    else {
        return false;
    };
    let run = CityTrader {
        resident_id: world.residents[r].id.clone(),
        warehouse_id: None,
        visiting_id: Some(visitor.id.clone()),
        loaded: None,
        offer: None,
        sells,
        buys,
        since: world.tick as f64,
    };
    add_run(world, &city.id, run);
    jobs.insert(world.residents[r].id.clone(), trade_job());
    true
}

/// Looks for a Player's offer for the city's trader to take (`planOfferRun`), the good it is
/// shortest of first, then the nearest, and sends them if one suits. Returns whether it sent them.
fn plan_offer_run(
    world: &mut WorldState,
    city: &City,
    r: usize,
    spoken: &SpokenFor,
    food_only: bool,
    size: i32,
) -> bool {
    if world.offers.is_empty() {
        return false;
    }
    let Some(storage) = npc_storages(world, city).into_iter().next() else { return false };
    let project = world.city_plans.get(&city.id).and_then(|p| p.project.clone());
    let order: Vec<Good> =
        reserve_lacks(world, city, project.as_ref()).into_iter().map(|s| s.good).collect();
    let storage_at = (storage.x as i32, storage.y as i32);
    let mut best: Option<(&Offer, f64, usize, f64)> = None;
    for offer in &world.offers {
        // A Direct offer is for its named realm alone.
        if offer.direct.is_some()
            || (food_only && offer.gives != Good::Food)
            || spoken.brings.contains(&offer.gives)
        {
            continue;
        }
        let Some(place) = order.iter().position(|g| *g == offer.gives) else { continue };
        let d = wrap_distance(size, storage_at, (offer.x as i32, offer.y as i32));
        if d > NPC_OFFER_REACH {
            continue;
        }
        if best.is_some_and(|b| place > b.2 || (place == b.2 && d >= b.3)) {
            continue;
        }
        if npc_city_refuses(world, city, &offer.realm_id) {
            continue;
        }
        let times = offer_times(world, city, storage, project.as_ref(), r, offer, d, spoken);
        if times > 0.0 {
            best = Some((offer, times, place, d));
        }
    }
    let Some((offer, times, _, _)) = best else { return false };
    let run = CityTrader {
        resident_id: world.residents[r].id.clone(),
        warehouse_id: Some(offer.storage_id.clone()),
        visiting_id: None,
        loaded: None,
        offer: Some(CityTraderOffer {
            offer_id: offer.id.clone(),
            times,
            pays: offer.wants,
            units: times * offer.wants_units,
            leg: TraderLeg::Load,
        }),
        sells: Stock::new(),
        buys: Stock::new(),
        since: world.tick as f64,
    };
    add_run(world, &city.id, run);
    true
}

/// What a city deals in with its visiting trader (`visitDeal`): `(sells, buys)`, or `None` with no
/// deal to make.
#[allow(clippy::too_many_arguments)]
fn visit_deal(
    world: &WorldState,
    city: &City,
    project: Option<&CityProject>,
    r: usize,
    visitor: &Trader,
    carriage: &Carriage,
    spoken: &SpokenFor,
    size: i32,
) -> Option<(Stock, Stock)> {
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let room = carry_capacity(&world.residents[r], world.tick as f64);
    let mut sells = Stock::new();
    let (mut best_coins, mut best_fresh) = (0.0, false);
    for good in PRICED_GOODS {
        if is_weapon(good) {
            continue;
        }
        let fresh = !spoken.sells.contains(&good);
        if best_fresh && !fresh {
            continue;
        }
        let surplus =
            (held(&stock, good) - held(&reserve, good) - held(&spoken.takes, good)).floor();
        if surplus < 1.0 {
            continue;
        }
        let arms = surplus.min((room / good_weight(good) + 1e-9).floor());
        let in_hand = Stock::from([(good, arms)]);
        let holder = TradeHolder { stock: &in_hand, room: f64::INFINITY };
        let q = quote_with_trader(world, visitor, carriage, holder, TradeSide::Sell, good, arms);
        if q.units < 1.0 || q.coins <= 0.0 || (fresh == best_fresh && q.coins <= best_coins) {
            continue;
        }
        best_coins = q.coins;
        best_fresh = fresh;
        sells.clear();
        sells.insert(good, q.units);
    }
    let above =
        held(&stock, Good::Coins) - held(&reserve, Good::Coins) - held(&spoken.takes, Good::Coins);
    let coins = best_coins + above.max(0.0);
    let has = trader_stock(visitor.escort_ids.len(), &carriage.load);
    let prices = trader_prices(visitor, carriage);
    let buy = short_goods(world, city, size, project).into_iter().find(|g| {
        *g != Good::Coins
            && PRICED_GOODS.contains(g)
            && !is_weapon(*g)
            && !spoken.brings.contains(g)
            && held(&has, *g) >= 1.0
            && prices.iter().find(|p| p.good == *g).is_some_and(|p| coins >= p.sell)
    });
    let mut buys = Stock::new();
    if let Some(buy) = buy {
        buys.insert(buy, 1f64.max((held(&reserve, buy) - held(&stock, buy)).ceil()));
    }
    (!sells.is_empty() || buy.is_some()).then_some((sells, buys))
}

/// How many times over the city's trader would take an offer `tiles` from its storage
/// (`offerTimes`); 0 when it doesn't suit.
#[allow(clippy::too_many_arguments)]
fn offer_times(
    world: &WorldState,
    city: &City,
    storage: &Building,
    project: Option<&CityProject>,
    r: usize,
    offer: &Offer,
    tiles: f64,
    spoken: &SpokenFor,
) -> f64 {
    if is_weapon(offer.gives) || is_weapon(offer.wants) {
        return 0.0;
    }
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let in_store = held_in(storage.stock.as_ref(), offer.wants);
    let spare = if offer.wants == Good::Coins {
        in_store
    } else {
        in_store.min(held(&stock, offer.wants) - held(&reserve, offer.wants))
    } - held(&spoken.takes, offer.wants);
    let wanted = held(&reserve, offer.gives) + held(&project_needs(world, project), offer.gives);
    let lacks = wanted - held(&stock, offer.gives);
    let hands = hands_of(&world.residents[r], world.tick as f64);
    let food = set_out_food(tiles * WALK_TICKS_PER_TILE) - held(hands.stock, Good::Food);
    let room = hands.room - food.max(0.0) * GOOD_WEIGHT.get("food").expect("a weight");
    let times = offer
        .times
        .min((lacks / offer.gives_units).ceil())
        .min((spare / offer.wants_units).floor())
        .min(((room + 1e-9) / (offer.gives_units * good_weight(offer.gives))).floor())
        .min(((room + 1e-9) / (offer.wants_units * good_weight(offer.wants))).floor());
    if times > 0.0 {
        let terms = OfferTerms {
            realm_id: &offer.realm_id,
            gives: offer.gives,
            gives_units: offer.gives_units,
            wants: offer.wants,
            wants_units: offer.wants_units,
        };
        npc_offer_times(world, city, &terms, times)
    } else {
        0.0
    }
}

/// Units of a good that make a trader's full load (`traderLoad`): what fits in their arms beside
/// the Food for the walk to a warehouse `tiles` away and back.
pub fn trader_load(world: &WorldState, r: usize, good: Good, tiles: f64) -> f64 {
    let food =
        set_out_food(tiles * WALK_TICKS_PER_TILE) * GOOD_WEIGHT.get("food").expect("a weight");
    ((carry_capacity(&world.residents[r], world.tick as f64) - food) / good_weight(good) + 1e-9)
        .floor()
        .max(0.0)
}

/// The nearest finished Trade Org warehouse within `NPC_TRADER_REACH` of `home` that prices `good`
/// and has its coins at hand (`nearestWarehouse`).
fn nearest_warehouse(world: &WorldState, home: (i32, i32), good: Good, size: i32) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (i, b) in world.buildings.iter().enumerate() {
        if b.kind != BuildingKind::Warehouse
            || b.site.is_some()
            || !stock_floor(world, b).contains_key(&good)
        {
            continue;
        }
        if trade_coin_warehouse(world, b).is_none() {
            continue;
        }
        let d = wrap_distance(size, home, (b.x as i32, b.y as i32));
        if d <= NPC_TRADER_REACH && best.is_none_or(|bb| d < bb.1) {
            best = Some((i, d));
        }
    }
    best.map(|b| b.0)
}

/// What a trader buys (`buyGood`): the good shortest of the city's reserve that it has no node for,
/// the warehouse prices and no trader out brings. Never Food, Coins or a weapon.
fn buy_good(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    warehouse: usize,
    project: Option<&CityProject>,
    spoken: &SpokenFor,
    size: i32,
) -> Option<Good> {
    let priced = stock_floor(world, &world.buildings[warehouse]);
    short_goods(world, city, size, project).into_iter().find(|g| {
        *g != Good::Food
            && *g != Good::Coins
            && !is_weapon(*g)
            && priced.contains_key(g)
            && !spoken.brings.contains(g)
            && !has_node_for(world, city, home, *g, size, &mut HashSet::new())
    })
}

/// Whether an NPC city can make a good from its own land (`hasNodeFor`).
pub fn has_node_for(
    world: &WorldState,
    city: &City,
    home: (i32, i32),
    good: Good,
    size: i32,
    seen: &mut HashSet<Good>,
) -> bool {
    if good == Good::Food || makes(world, city, good) {
        return true;
    }
    if !seen.insert(good) {
        return false;
    }
    if let Some(input) = chain_input(good) {
        return input.keys().all(|g| has_node_for(world, city, home, *g, size, seen));
    }
    world.nodes.iter().any(|n| {
        node_good(n.kind) == good && knows_node(city, home, (n.x as i32, n.y as i32), size)
    })
}

/// Whether an armed outsider stands in the city's area (`armedOutsiders`): then it sends no trader.
fn armed_outsiders(
    world: &WorldState,
    city: &City,
    size: i32,
    except: Option<&HashSet<String>>,
) -> bool {
    world.residents.iter().any(|r| {
        r.health > 0.0
            && is_armed(&r.carried)
            && !except.is_some_and(|e| e.contains(&r.id))
            && !allied(world, &city.id, wall_side(r).unwrap_or(""))
            && in_city_area(world, &city.id, r.x as i32, r.y as i32, size)
    })
}

/// The run of resident `i`, as kept in the city's plan.
fn run_of<'w>(
    world: &'w mut WorldState,
    city_id: &str,
    resident_id: &str,
) -> Option<&'w mut CityTrader> {
    world
        .city_plans
        .get_mut(city_id)?
        .traders
        .as_mut()?
        .iter_mut()
        .find(|t| t.resident_id == resident_id)
}

/// A trade order.
fn trade(side: TradeSide, good: Good, units: f64) -> ResidentOrder {
    ResidentOrder::Trade(TradeOrder { side, good, units, carriage_id: None, city_id: None })
}

/// A pick-up from a storage.
fn pick_up(storage_id: &str, goods: Stock) -> ResidentOrder {
    ResidentOrder::PickUp(PickUpOrder {
        from: GoodsSpot::Storage { storage_id: storage_id.to_string() },
        goods,
    })
}

/// One tick of a city's trader on their run, idle between orders (`runTrader`).
pub fn run_trader(
    world: &mut WorldState,
    city: &City,
    i: usize,
    storage: Option<usize>,
    size: i32,
) {
    let rid = world.residents[i].id.clone();
    let Some(t) = run_of(world, &city.id, &rid).cloned() else { return };
    if t.visiting_id.is_some() {
        return run_visit(world, city, i, &t, storage, size);
    }
    if t.offer.is_some() && run_to_offer(world, city, i, storage, size) {
        return;
    }
    let warehouse =
        world.buildings.iter().find(|b| Some(&b.id) == t.warehouse_id.as_ref()).cloned();
    let sell = t.sells.iter().next().map(|(g, n)| (*g, *n));
    let buy = t.buys.iter().next().map(|(g, n)| (*g, *n));
    let at = (world.residents[i].x as i32, world.residents[i].y as i32);
    let storage_b = storage.map(|s| world.buildings[s].clone());
    if storage_b.is_none() || (warehouse.is_none() && (sell.is_some() || buy.is_some())) {
        if let Some(t) = run_of(world, &city.id, &rid) {
            t.sells.clear();
            t.buys.clear();
        }
        return go_home(world, &city.id, i, storage, size);
    }
    if let (Some(store), Some(w), Some((sell, units))) = (&storage_b, &warehouse, sell) {
        if held(&world.residents[i].carried, sell) < 1.0 {
            if !is_at(at, placed(store), size) {
                return walk_to(&mut world.residents[i], (store.x, store.y));
            }
            let has = held_in(store.stock.as_ref(), sell);
            if has < 1.0 {
                return end_run(world, &city.id, &rid);
            }
            let mut goods = Stock::new();
            let food = set_out_food(
                wrap_distance(size, at, (w.x as i32, w.y as i32)) * WALK_TICKS_PER_TILE,
            );
            let lacks = held_in(store.stock.as_ref(), Good::Food)
                .min(food - held(&world.residents[i].carried, Good::Food));
            if lacks >= 1.0 {
                goods.insert(Good::Food, lacks.floor());
            }
            goods.insert(sell, units.min(has));
            let coins = held_in(store.stock.as_ref(), Good::Coins)
                - held(&npc_reserve(world, city), Good::Coins);
            if coins >= 1.0 && buy.is_some() {
                goods.insert(Good::Coins, coins.floor());
            }
            world.residents[i].order = Some(pick_up(&store.id, goods));
            return;
        }
        if !is_at(at, placed(w), size) {
            return walk_to(&mut world.residents[i], (w.x, w.y));
        }
        let units = held(&world.residents[i].carried, sell);
        world.residents[i].order = Some(trade(TradeSide::Sell, sell, units));
        if let Some(t) = run_of(world, &city.id, &rid) {
            t.sells.clear();
        }
        return;
    }
    if let (Some(_), Some(w), Some((buy, wanted))) = (&storage_b, &warehouse, buy) {
        if !is_at(at, placed(w), size) {
            return walk_to(&mut world.residents[i], (w.x, w.y));
        }
        if let Some(t) = run_of(world, &city.id, &rid) {
            t.buys.clear();
        }
        if held(&world.residents[i].carried, Good::Coins) < 1.0 {
            return;
        }
        world.residents[i].order = Some(trade(TradeSide::Buy, buy, wanted));
        return;
    }
    go_home(world, &city.id, i, storage, size);
}

/// One tick of the city's spare hand on a run to its visiting trader (`runVisit`).
fn run_visit(
    world: &mut WorldState,
    city: &City,
    i: usize,
    t: &CityTrader,
    storage: Option<usize>,
    size: i32,
) {
    let rid = world.residents[i].id.clone();
    let visitor = world.traders.iter().find(|x| Some(&x.id) == t.visiting_id.as_ref());
    let stand = visitor.and_then(|v| trader_standing(world, v));
    let sell = t.sells.iter().next().map(|(g, n)| (*g, *n));
    let buy = t.buys.iter().next().map(|(g, n)| (*g, *n));
    let Some(s) = storage else { return go_home(world, &city.id, i, storage, size) };
    let Some(stand) = stand.filter(|s| s.city_id == city.id) else {
        return go_home(world, &city.id, i, storage, size);
    };
    if sell.is_none() && buy.is_none() {
        return go_home(world, &city.id, i, storage, size);
    }
    let store = world.buildings[s].clone();
    let at = (world.residents[i].x as i32, world.residents[i].y as i32);
    if t.loaded != Some(true) {
        if !is_at(at, placed(&store), size) {
            return walk_to(&mut world.residents[i], (store.x, store.y));
        }
        if let Some(t) = run_of(world, &city.id, &rid) {
            t.loaded = Some(true);
        }
        let mut goods = Stock::new();
        if let Some((sell, units)) = sell {
            let has = held_in(store.stock.as_ref(), sell);
            if has >= 1.0 {
                goods.insert(sell, units.min(has));
            }
        }
        let coins = held_in(store.stock.as_ref(), Good::Coins)
            - held(&npc_reserve(world, city), Good::Coins);
        if coins >= 1.0 && buy.is_some() {
            goods.insert(Good::Coins, coins.floor());
        }
        if goods.is_empty() {
            return end_run(world, &city.id, &rid);
        }
        world.residents[i].order = Some(pick_up(&store.id, goods));
        return;
    }
    if world.residents[i].x != stand.x || world.residents[i].y != stand.y {
        return walk_to(&mut world.residents[i], (stand.x, stand.y));
    }
    if let Some((sell, _)) = sell {
        if let Some(t) = run_of(world, &city.id, &rid) {
            t.sells.clear();
        }
        let units = held(&world.residents[i].carried, sell);
        if units < 1.0 {
            return;
        }
        world.residents[i].order = Some(trade(TradeSide::Sell, sell, units));
        return;
    }
    if let Some(t) = run_of(world, &city.id, &rid) {
        t.buys.clear();
    }
    if held(&world.residents[i].carried, Good::Coins) < 1.0 {
        return;
    }
    let (buy, wanted) = buy.expect("a good to buy");
    world.residents[i].order = Some(trade(TradeSide::Buy, buy, wanted));
}

/// The end of a trade run (`goHome`): the trader walks home to the storage and puts everything away
/// but their weapons, and the run is over.
fn go_home(world: &mut WorldState, city_id: &str, i: usize, storage: Option<usize>, size: i32) {
    let rid = world.residents[i].id.clone();
    let Some(s) = storage else { return end_run(world, city_id, &rid) };
    let store = &world.buildings[s];
    let r = &world.residents[i];
    if !is_at((r.x as i32, r.y as i32), placed(store), size) {
        let to = (store.x, store.y);
        return walk_to(&mut world.residents[i], to);
    }
    let load: Stock = r
        .carried
        .iter()
        .filter_map(|(good, n)| {
            let put = put_away_units(good_name(*good), *n, OWN_FOOD);
            (put > 0.0 && !is_weapon(*good)).then_some((*good, put))
        })
        .collect();
    if load.is_empty() {
        end_run(world, city_id, &rid);
    } else {
        let to = GoodsSpot::Storage { storage_id: store.id.clone() };
        world.residents[i].order = Some(ResidentOrder::Drop(DropOrder { to, goods: load }));
    }
}

/// One tick of the trader's way to an offer (`runToOffer`). Returns whether they got an order.
fn run_to_offer(
    world: &mut WorldState,
    city: &City,
    i: usize,
    storage: Option<usize>,
    size: i32,
) -> bool {
    let rid = world.residents[i].id.clone();
    let Some(run) = run_of(world, &city.id, &rid).and_then(|t| t.offer.clone()) else {
        return false;
    };
    let offer = world.offers.iter().find(|o| o.id == run.offer_id).cloned();
    let target =
        offer.as_ref().and_then(|o| world.buildings.iter().find(|b| b.id == o.storage_id)).cloned();
    let at = (world.residents[i].x as i32, world.residents[i].y as i32);
    if let (Some(offer), Some(target)) = (&offer, &target) {
        if run.leg == TraderLeg::Load {
            if let Some(s) = storage {
                let store = world.buildings[s].clone();
                if !is_at(at, placed(&store), size) {
                    walk_to(&mut world.residents[i], (store.x, store.y));
                    return true;
                }
                let has = held_in(store.stock.as_ref(), run.pays);
                if has >= offer.wants_units {
                    let units = run.units.min(has);
                    let mut goods = Stock::from([(run.pays, units)]);
                    let food = set_out_food(
                        wrap_distance(size, at, (target.x as i32, target.y as i32))
                            * WALK_TICKS_PER_TILE,
                    );
                    let left = held_in(store.stock.as_ref(), Good::Food)
                        - if run.pays == Good::Food { units } else { 0.0 };
                    let lacks =
                        left.min(food - held(&world.residents[i].carried, Good::Food)).floor();
                    if lacks >= 1.0 {
                        *goods.entry(Good::Food).or_insert(0.0) += lacks;
                    }
                    world.residents[i].order = Some(pick_up(&store.id, goods));
                    if let Some(o) = run_of(world, &city.id, &rid).and_then(|t| t.offer.as_mut()) {
                        o.leg = TraderLeg::SetOff;
                    }
                    return true;
                }
            }
        } else {
            if is_at(at, placed(target), size) {
                world.residents[i].order = Some(ResidentOrder::AcceptOffer(AcceptOfferOrder {
                    offer_id: offer.id.clone(),
                    times: run.times,
                    carriage_id: None,
                }));
                if let Some(t) = run_of(world, &city.id, &rid) {
                    t.offer = None;
                }
                return true;
            }
            if run.leg == TraderLeg::SetOff {
                walk_to(&mut world.residents[i], (target.x, target.y));
                if let Some(o) = run_of(world, &city.id, &rid).and_then(|t| t.offer.as_mut()) {
                    o.leg = TraderLeg::Walking;
                }
                return true;
            }
        }
    }
    if let Some(t) = run_of(world, &city.id, &rid) {
        t.offer = None;
    }
    false
}

/// A trader's run is over (`endRun`): the plan forgets it, and they are idle until the next pass.
fn end_run(world: &mut WorldState, city_id: &str, resident_id: &str) {
    let plan = world.city_plans.get_mut(city_id).expect("a plan");
    let left: Vec<CityTrader> = plan
        .traders
        .take()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.resident_id != resident_id)
        .collect();
    plan.traders = (!left.is_empty()).then_some(left);
    let idle = CityJob {
        kind: CityJobKind::Idle,
        building_id: None,
        target_id: None,
        stable_id: None,
        ground_id: None,
        subject: None,
    };
    plan.jobs.insert(resident_id.to_string(), idle);
}

/// Invariant `npc-traders-sound` (`CONTEXT.md`: NPC trader; ADR 0004).
pub fn npc_traders_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for (city_id, plan) in &world.city_plans {
        let jobbed: Vec<&String> = plan
            .jobs
            .iter()
            .filter(|(_, j)| j.kind == CityJobKind::Trade)
            .map(|(id, _)| id)
            .collect();
        let runs = plan.traders.as_deref().unwrap_or(&[]);
        let on_run: HashSet<&String> = runs.iter().map(|t| &t.resident_id).collect();
        let city = world.cities.iter().find(|c| &c.id == city_id);
        let mut push = |message: String, ids: Vec<String>| {
            out.push(InvariantViolation {
                invariant: "npc-traders-sound".into(),
                message,
                entity_ids: ids,
            })
        };
        if jobbed.iter().any(|id| !on_run.contains(id)) || on_run.len() < runs.len() {
            let names: Vec<&str> = jobbed.iter().map(|s| s.as_str()).collect();
            let run_names: Vec<&str> = runs.iter().map(|t| t.resident_id.as_str()).collect();
            let mut ids = vec![city_id.clone()];
            ids.extend(jobbed.iter().map(|s| s.to_string()));
            push(
                format!(
                    "{city_id} plans traders {}, with runs for {}",
                    names.join(", "),
                    run_names.join(", ")
                ),
                ids,
            );
        }
        if let Some(city) = city {
            if runs.iter().any(|t| t.since == tick) && runs.len() > traders_wanted(world, city) + 1
            {
                let mut ids = vec![city_id.clone()];
                ids.extend(on_run.iter().map(|s| s.to_string()));
                push(
                    format!(
                        "{city_id} sent a trader with {} out, for {} residents",
                        runs.len(),
                        city_residents(world, &city.id).len()
                    ),
                    ids,
                );
            }
        }
        for t in runs {
            if let Some(o) = &t.offer {
                if ![o.times, o.units].iter().all(|n| n.fract() == 0.0 && *n > 0.0) {
                    push(
                        format!(
                            "{city_id}'s trader goes to {} {} times for {} {}",
                            o.offer_id,
                            o.times,
                            o.units,
                            good_name(o.pays)
                        ),
                        vec![city_id.clone(), t.resident_id.clone(), o.offer_id.clone()],
                    );
                }
            }
            if city.is_some_and(|c| c.trade_org.is_some()) {
                push(
                    format!("{city_id}, the Trade Organization's, sends trader {}", t.resident_id),
                    vec![city_id.clone(), t.resident_id.clone()],
                );
            }
            let Some(r) =
                world.residents.iter().find(|r| r.id == t.resident_id).filter(|r| r.health > 0.0)
            else {
                continue;
            };
            if r.city_id.as_ref() != Some(city_id) || r.owner.is_some() || is_armed(&r.carried) {
                let what = if is_armed(&r.carried) { "armed" } else { "not of the city" };
                push(
                    format!("{city_id}'s trader {} is {what}", r.id),
                    vec![city_id.clone(), r.id.clone()],
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod offer_tests;
#[cfg(test)]
mod tests;
