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
use crate::goods_deps::{ordered_resident, realm_of, OrderSender};
use crate::queries::command::{commands, commands_carriage};
use crate::queries::driving::{army_spot, carriage_can_go_to, drive_problem, in_contact};
use crate::queries::goods::{
    free_stock, goods_at_spot, haul_stop_spot, units_that_fit, units_that_fit_carriage,
};
use crate::queries::names::{good_name, good_of, held};
use crate::queries::warehouse_trade::is_integer;

/// Why a resident carrying a child can't take an order that needs their hands
/// (`CARRYING_A_CHILD`).
pub const CARRYING_A_CHILD: &str = "carrying a child";

/// The order's goods as plain data (`readGoods`): known goods, each once, at least `min`.
fn read_goods(goods: Option<&Value>, min: usize) -> Option<Vec<Good>> {
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

/// The army of the realm a haul goes to (`armyToSupply`), or why not. TODO(T86.4): `driving.rs`.
fn army_to_supply(
    world: &WorldState,
    realm_id: &str,
    army_id: Option<&Value>,
) -> Result<usize, String> {
    let id = army_id.and_then(Value::as_str);
    world
        .armies
        .iter()
        .position(|a| Some(a.id.as_str()) == id && a.realm_id == realm_id)
        .ok_or_else(|| "not one of your armies".into())
}

/// Where an army stands to start with (`armyStart`): its first member's tile. TODO(T86.4).
fn army_start(world: &WorldState, army: usize) -> (f64, f64) {
    let first = world.armies[army].member_ids.first();
    let r = first.and_then(|id| world.residents.iter().find(|r| &r.id == id));
    r.map_or((0.0, 0.0), |r| (r.x, r.y))
}

/// Checks a haul order (`haul.validate`): one of the Player's adult residents drives one of the
/// Player's carriages between the tile they share and another stop, again and again.
pub fn validate_haul(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
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
        if let Err(e) = army_to_supply(world, &realm.id, army_id) {
            return Some(e);
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
        if terrain.is_some_and(|t| !carriage_can_go_to(world, t, x, y)) {
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
pub fn apply_haul(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
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
        Some(a) => army_start(world, a),
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

/// How much of a good the route leaves on board when unloading: the Food kept for the horse.
fn kept(o: &HaulOrder, good: Good) -> f64 {
    if good == Good::Food {
        o.keep_food
    } else {
        0.0
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
    let load = &world.carriages[k].load;
    if !o.goods.iter().any(|g| held(load, *g) > kept(o, *g)) {
        drive_on(haul_mut(world, ri), HaulStop::From);
    } else if !in_contact(size, (r.x, r.y), spot) {
        drive_on(haul_mut(world, ri), HaulStop::To);
    }
}

/// The next take at the hauler's stop, if there is one (`nextTransfer`).
fn next_transfer(
    world: &WorldState,
    ri: usize,
    o: &HaulOrder,
    k: usize,
    spot: &GoodsSpot,
) -> Option<Transfer> {
    let r = &world.residents[ri];
    let carriage = &world.carriages[k];
    let load = &carriage.load;
    let on_carriage = GoodsSpot::Carriage { carriage_id: carriage.id.clone() };
    let held_there = goods_at_spot(world, r.x, r.y, spot).cloned().unwrap_or_default();
    // A haul route leaves what is set aside for an offer alone (`CONTEXT.md`: Offer).
    let there: Stock = match spot {
        GoodsSpot::Storage { storage_id } => free_stock(world, storage_id, Some(&held_there)),
        _ => held_there,
    };
    let tick = world.tick as f64;
    let hands = |g: Good| units_that_fit(r, g, tick);
    let loadable =
        |g: Good| held(&there, g).min(hands(g)).min(units_that_fit_carriage(world, carriage, g));
    let (unloading, loading) = match o.stop {
        HaulStop::To => (&o.goods, &o.return_goods),
        HaulStop::From => (&o.return_goods, &o.goods),
    };
    for &good in unloading {
        let units = (held(load, good) - kept(o, good)).min(hands(good));
        if units > 0.0 {
            return Some(Transfer { good, units, from: on_carriage, onto: Onto::Stop });
        }
    }
    let food = (o.keep_food - held(load, Good::Food)).min(loadable(Good::Food));
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
        let id = world.residents[ri].id.clone();
        if let Some(HaulMoving { good, before, onto }) = o.moving.clone() {
            haul_mut(world, ri).moving = None;
            let carrying = held(&world.residents[ri].carried, good) - before;
            let to = match onto {
                Onto::Carriage => {
                    GoodsSpot::Carriage { carriage_id: world.carriages[k].id.clone() }
                }
                Onto::Stop => spot.clone(),
            };
            if carrying > 0.0 {
                let goods = Stock::from([(good, carrying)]);
                actions.push(CarryAction {
                    kind: CarryKind::Put,
                    resident_id: id,
                    spot: to,
                    goods,
                });
                continue;
            }
        }
        if let Some(next) = next_transfer(world, ri, &o, k, &spot) {
            let before = held(&world.residents[ri].carried, next.good);
            haul_mut(world, ri).moving =
                Some(HaulMoving { good: next.good, before, onto: next.onto });
            let goods = Stock::from([(next.good, next.units)]);
            actions.push(CarryAction {
                kind: CarryKind::Take,
                resident_id: id,
                spot: next.from,
                goods,
            });
            continue;
        }
        let load = &world.carriages[k].load;
        let loaded = o.goods.iter().any(|g| held(load, *g) > kept(&o, *g));
        if o.stop == HaulStop::From && !loaded {
            continue;
        }
        let next = if o.stop == HaulStop::From { HaulStop::To } else { HaulStop::From };
        drive_on(haul_mut(world, ri), next);
    }
    actions
}
