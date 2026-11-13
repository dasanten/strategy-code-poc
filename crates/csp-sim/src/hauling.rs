//! Haul routes and the stop order (`apps/server/src/hauling.ts`, `CONTEXT.md`: Haul route, Supply
//! line): a resident drives a carriage between two stops, unloading and loading through the take
//! and put actions of `carrying.rs`.

use csp_shared::balance::{CARRIAGE_CAPACITY, GOOD_WEIGHT};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Good, GoodsSpot, HaulMoving, HaulOrder, HaulPhase, HaulStop, Onto, OrderRequest, ResidentOrder,
    Stock, Tile, WorldState,
};
use serde_json::Value;

use crate::carrying::{CarryAction, CarryKind};
use crate::driving::{army_start, army_to_supply};
use crate::goods_deps::{ordered_resident, realm_of, OrderSender};
use crate::queries::army::army_spot;
use crate::queries::combat::in_contact;
use crate::queries::command::{commands, commands_carriage};
use crate::queries::driving::{carriage_can_go_to, drive_problem};
use crate::queries::goods::{
    free_stock, goods_at_spot, haul_stop_spot, units_that_fit, units_that_fit_carriage,
};
use crate::queries::names::{good_name, good_of, held};
use crate::queries::warehouse_trade::is_integer;
use crate::water_hauling::{apply_water_haul, validate_water_haul, vessel_of_haul};

/// Why a resident carrying a child can't take an order that needs their hands
/// (`CARRYING_A_CHILD`).
pub const CARRYING_A_CHILD: &str = "carrying a child";

/// The order's goods as plain data (`readGoods`): known goods, each once, at least `min`.
pub(crate) fn read_goods(goods: Option<&Value>, min: usize) -> Option<Vec<Good>> {
    let list = goods?.as_array()?;
    if list.len() < min {
        return None;
    }
    let mut out = Vec::new();
    for g in list {
        out.push(good_of(g.as_str()?)?);
    }
    let mut seen = out.clone();
    seen.sort_by_key(|g| good_name(*g));
    seen.dedup();
    (seen.len() == out.len()).then_some(out)
}

/// Checks a haul order (`haul.validate`): one of the Player's adult residents drives one of the
/// Player's carriages between the tile they share and another stop, again and again.
pub fn validate_haul(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    // With a vessel it is a haul route by water (`CONTEXT.md`: Haul route by water).
    if let Some(v) = vessel_of_haul(world, order) {
        return validate_water_haul(world, sender, order, terrain, v);
    }
    let o = &order.fields;
    let realm = realm_of(world, sender.user_id);
    let id = o.get("residentId").and_then(Value::as_str);
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
        return Some("not one of your residents".into());
    };
    let r = r.expect("commanded");
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let cid = o.get("carriageId").and_then(Value::as_str);
    let carriage = world.carriages.iter().find(|k| Some(k.id.as_str()) == cid);
    if !commands_carriage(world, &realm.id, carriage) {
        return Some("not one of your carriages".into());
    }
    let carriage = carriage.expect("commanded");
    let army_id = o.get("armyId");
    if army_id.is_some() {
        if let Err(e) = army_to_supply(world, &realm.id, army_id.and_then(Value::as_str)) {
            return Some(e.into());
        }
    } else {
        let (x, y) = (o.get("x"), o.get("y"));
        if !is_integer(x) || !is_integer(y) {
            return Some("the other stop must be a tile".into());
        }
        let (x, y) = (x.and_then(Value::as_f64).unwrap(), y.and_then(Value::as_f64).unwrap());
        if x == r.x && y == r.y {
            return Some("the other stop must be another tile".into());
        }
        if terrain.is_some_and(|t| !carriage_can_go_to(world, t, x as i32, y as i32)) {
            return Some("a carriage can’t go there".into());
        }
    }
    let Some(goods) = read_goods(o.get("goods"), 1) else {
        return Some("pick the goods to haul".into());
    };
    let empty = Value::Array(Vec::new());
    let back = read_goods(Some(o.get("returnGoods").filter(|v| !v.is_null()).unwrap_or(&empty)), 0);
    let Some(back) = back.filter(|b| !b.iter().any(|g| goods.contains(g))) else {
        return Some("pick the goods to haul back, none of them hauled there".into());
    };
    if army_id.is_some() && !back.is_empty() {
        return Some("nothing comes back from an army".into());
    }
    let food = o.get("keepFood");
    let units = food.and_then(Value::as_f64).unwrap_or(-1.0);
    let food_weight = GOOD_WEIGHT.get("food").expect("a weight for food");
    if !is_integer(food) || units < 0.0 || units * food_weight > CARRIAGE_CAPACITY {
        return Some(
            "the Food kept for the horse must be whole units that fit on the carriage".into(),
        );
    }
    drive_problem(world, r, carriage)
}

/// Gives a haul order (`haul.apply`). Of two drivers ordered onto one carriage in the same tick
/// the first one drives it.
pub fn apply_haul(
    world: &mut WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) {
    if vessel_of_haul(world, order).is_some() {
        return apply_water_haul(world, sender, order, terrain);
    }
    let o = &order.fields;
    let id = o.get("residentId").and_then(Value::as_str);
    let cid = o.get("carriageId").and_then(Value::as_str);
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let Some(carriage) = world.carriages.iter().find(|k| Some(k.id.as_str()) == cid) else {
        return;
    };
    if drive_problem(world, &world.residents[ri], carriage).is_some() {
        return;
    }
    let carriage_id = carriage.id.clone();
    let army_id = o.get("armyId");
    let army = match army_id {
        None => None,
        Some(a) => match world.armies.iter().position(|x| Some(x.id.as_str()) == a.as_str()) {
            Some(i) => Some(i),
            None => return,
        },
    };
    let (x, y) = match army {
        Some(a) => {
            let t = army_start(world, &world.armies[a]);
            (t.x, t.y)
        }
        None => (
            o.get("x").and_then(Value::as_f64).unwrap_or(0.0),
            o.get("y").and_then(Value::as_f64).unwrap_or(0.0),
        ),
    };
    let goods = read_goods(o.get("goods"), 1).unwrap_or_default();
    let return_goods =
        read_goods(o.get("returnGoods").filter(|v| !v.is_null()), 0).unwrap_or_default();
    let keep_food = o.get("keepFood").and_then(Value::as_f64).unwrap_or(0.0);
    let to_army = army.map(|a| world.armies[a].id.clone());
    let r = &mut world.residents[ri];
    r.order = Some(ResidentOrder::Haul(HaulOrder {
        carriage_id,
        from: Tile { x: r.x, y: r.y },
        to: Tile { x, y },
        to_army,
        goods,
        return_goods,
        keep_food,
        stop: HaulStop::From,
        phase: HaulPhase::Loading,
        path: None,
        progress: 0.0,
        moving: None,
    }));
}

/// Checks a stop order (`stop.validate`): one of the Player's residents stops what they were
/// ordered to do and stands idle.
pub fn validate_stop(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    match ordered_resident(world, sender, order.fields.get("residentId")) {
        Some(_) => None,
        None => Some("not one of your residents".into()),
    }
}

/// Gives a stop order (`stop.apply`).
pub fn apply_stop(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let id = order.fields.get("residentId").and_then(Value::as_str);
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = None;
    }
}

/// What a haul route moves, by land or by water (`HaulOrder`, `WaterHaulOrder`): the goods to
/// the second stop, those back, the Food kept on board, and the stop it stands at.
pub(crate) struct RouteGoods<'a> {
    pub goods: &'a [Good],
    pub return_goods: &'a [Good],
    pub keep_food: f64,
    pub stop: HaulStop,
}

impl RouteGoods<'_> {
    /// How much of a good the route leaves on board when unloading: the Food kept for the horse
    /// and driver, or for the rower.
    fn kept(&self, good: Good) -> f64 {
        if good == Good::Food {
            self.keep_food
        } else {
            0.0
        }
    }

    /// Whether any of the goods for the second stop are on board, past what stays there.
    pub(crate) fn loaded(&self, load: &Stock) -> bool {
        self.goods.iter().any(|g| held(load, *g) > self.kept(*g))
    }
}

/// What a haul route loads onto: the carriage or the vessel as a spot, what it holds, and how
/// many more units of a good fit on it.
pub(crate) struct OnBoard<'a> {
    pub spot: GoodsSpot,
    pub load: &'a Stock,
    pub fits: &'a dyn Fn(Good) -> f64,
}

/// One take a hauler requests next at a stop (`Transfer`).
struct Transfer {
    good: Good,
    units: f64,
    from: GoodsSpot,
    onto: Onto,
}

/// Sets a hauler driving to their route's other stop (`driveOn`).
fn drive_on(o: &mut HaulOrder, stop: HaulStop) {
    o.stop = stop;
    o.phase = HaulPhase::Driving;
    o.path = None;
    o.progress = 0.0;
}

fn route_of(o: &HaulOrder) -> RouteGoods<'_> {
    RouteGoods {
        goods: &o.goods,
        return_goods: &o.return_goods,
        keep_food: o.keep_food,
        stop: o.stop,
    }
}

fn haul_mut(world: &mut WorldState, ri: usize) -> &mut HaulOrder {
    match world.residents[ri].order.as_mut() {
        Some(ResidentOrder::Haul(o)) => o,
        _ => unreachable!("a haul order"),
    }
}

/// A haul route standing at its army stop (`standWithArmy`).
fn stand_with_army(
    world: &mut WorldState,
    ri: usize,
    o: &HaulOrder,
    army_id: &str,
    k: usize,
    size: i32,
) {
    let r = &world.residents[ri];
    let spot = army_spot(world, army_id, (r.x, r.y), size);
    let Some(spot) = spot else {
        world.residents[ri].order = None;
        return;
    };
    if !route_of(o).loaded(&world.carriages[k].load) {
        drive_on(haul_mut(world, ri), HaulStop::From);
    } else if !in_contact(size, (r.x as i32, r.y as i32), (spot.0 as i32, spot.1 as i32)) {
        drive_on(haul_mut(world, ri), HaulStop::To);
    }
}

/// The next take at the hauler's stop, if there is one (`nextTransfer`).
fn next_transfer(
    world: &WorldState,
    ri: usize,
    route: &RouteGoods,
    board: &OnBoard,
    spot: &GoodsSpot,
) -> Option<Transfer> {
    let r = &world.residents[ri];
    let load = board.load;
    let held_there = goods_at_spot(world, r.x, r.y, spot).cloned().unwrap_or_default();
    // A haul route leaves what is set aside for an offer alone (`CONTEXT.md`: Offer).
    let there: Stock = match spot {
        GoodsSpot::Storage { storage_id } => free_stock(world, storage_id, Some(&held_there)),
        _ => held_there,
    };
    let tick = world.tick as f64;
    let hands = |g: Good| units_that_fit(r, g, tick);
    let loadable = |g: Good| held(&there, g).min(hands(g)).min((board.fits)(g));
    let (unloading, loading) = match route.stop {
        HaulStop::To => (route.goods, route.return_goods),
        HaulStop::From => (route.return_goods, route.goods),
    };
    for &good in unloading {
        let units = (held(load, good) - route.kept(good)).min(hands(good));
        if units > 0.0 {
            return Some(Transfer { good, units, from: board.spot.clone(), onto: Onto::Stop });
        }
    }
    let food = (route.keep_food - held(load, Good::Food)).min(loadable(Good::Food));
    if food > 0.0 {
        return Some(Transfer {
            good: Good::Food,
            units: food,
            from: spot.clone(),
            onto: Onto::Carriage,
        });
    }
    for &good in loading {
        let units = loadable(good);
        if units > 0.0 {
            return Some(Transfer { good, units, from: spot.clone(), onto: Onto::Carriage });
        }
    }
    None
}

/// The hauler's take or put at their stop this tick, by hand between the stop's `spot` and what
/// they load onto: first the goods they took last tick (`moving`) go where they were taken for,
/// then the next take. With it, what `moving` becomes; `None` once nothing is left to move there.
pub(crate) fn stop_action(
    world: &WorldState,
    ri: usize,
    moving: Option<&HaulMoving>,
    route: &RouteGoods,
    board: &OnBoard,
    spot: &GoodsSpot,
) -> Option<(CarryAction, Option<HaulMoving>)> {
    let r = &world.residents[ri];
    if let Some(HaulMoving { good, before, onto }) = moving {
        let carrying = held(&r.carried, *good) - before;
        let to = match onto {
            Onto::Carriage => board.spot.clone(),
            Onto::Stop => spot.clone(),
        };
        if carrying > 0.0 {
            let goods = Stock::from([(*good, carrying)]);
            let put =
                CarryAction { kind: CarryKind::Put, resident_id: r.id.clone(), spot: to, goods };
            return Some((put, None));
        }
    }
    let next = next_transfer(world, ri, route, board, spot)?;
    let before = held(&r.carried, next.good);
    let moving = HaulMoving { good: next.good, before, onto: next.onto };
    let goods = Stock::from([(next.good, next.units)]);
    let take =
        CarryAction { kind: CarryKind::Take, resident_id: r.id.clone(), spot: next.from, goods };
    Some((take, Some(moving)))
}

/// Requests this tick's takes and puts for residents on haul routes who stand at a stop
/// (`requestHauling`), and starts them driving on when they are done there. `size` is the map's.
pub fn request_hauling(world: &mut WorldState, size: i32) -> Vec<CarryAction> {
    let mut actions = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::Haul(o)) = world.residents[ri].order.clone() else { continue };
        if o.phase != HaulPhase::Loading {
            continue;
        }
        let (x, y) = (world.residents[ri].x, world.residents[ri].y);
        let k = world.carriages.iter().position(|k| k.id == o.carriage_id);
        let Some(k) = k.filter(|&k| world.carriages[k].x == x && world.carriages[k].y == y) else {
            world.residents[ri].order = None;
            continue;
        };
        if o.stop == HaulStop::To {
            if let Some(army) = &o.to_army {
                stand_with_army(world, ri, &o, army, k, size);
                continue;
            }
        }
        let spot = haul_stop_spot(world, x, y);
        let route = route_of(&o);
        let carriage = &world.carriages[k];
        let fits = |g: Good| units_that_fit_carriage(world, carriage, g);
        let board = OnBoard {
            spot: GoodsSpot::Carriage { carriage_id: carriage.id.clone() },
            load: &carriage.load,
            fits: &fits,
        };
        let action = stop_action(world, ri, o.moving.as_ref(), &route, &board, &spot);
        let loaded = route.loaded(board.load);
        if let Some((action, moving)) = action {
            haul_mut(world, ri).moving = moving;
            actions.push(action);
            continue;
        }
        haul_mut(world, ri).moving = None;
        if o.stop == HaulStop::From && !loaded {
            continue;
        }
        let next = if o.stop == HaulStop::From { HaulStop::To } else { HaulStop::From };
        drive_on(haul_mut(world, ri), next);
    }
    actions
}
