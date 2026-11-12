//! Haul routes by water (`CONTEXT.md`: Haul route by water): the Haul route with a boat. Its stops
//! are tiles on land, havens or shore tiles; the boat lies on the free water beside a stop while
//! the rower, standing on the stop, loads and unloads it by hand like a carriage's driver: at a
//! haven from its storage, at a shore from the pile on the tile. Leaving, they board, take the
//! oars and row to the other stop (the steps are the walking's, as for the row order).
//!
//! The order is the `haul` order naming a vessel (`vesselId`, or a vessel's id as `carriageId`);
//! the resident then holds a `haulByWater` order.
//!
//! A ship's route runs between two havens (`CONTEXT.md`: Haul route by water, Docked): its captain
//! gets off onto the haven at each stop and moves the goods straight between its storage and the
//! ship, as those at a haven do; leaving, they board again as one of its crew and sail it to the
//! other haven, docking there, while the rest of the crew stays aboard. It sails only with the
//! fewest crew it takes, the captain among them.

use csp_shared::balance::{GOOD_WEIGHT, SHIP_MIN_CREW};
use csp_shared::terrain::{is_passable_terrain, terrain_at, wrap, TerrainMap};
use csp_shared::world::{
    Good, GoodsSpot, HaulPhase, HaulStop, OrderRequest, Resident, ResidentOrder, Stock, Tile,
    Vessel, VesselKind, WaterHaulOrder, WorldState,
};
use serde_json::Value;

use crate::carrying::CarryAction;
use crate::hauling::{read_goods, stop_action, OnBoard, RouteGoods, CARRYING_A_CHILD};
use crate::loading::move_straight;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field};
use crate::queries::carriages::driven_carriage_id;
use crate::queries::goods::free_stock;
use crate::queries::goods::haul_stop_spot;
use crate::queries::names::held;
use crate::queries::residents::can_work;
use crate::queries::vessels::{
    beside_vessel, docked_at, haven_for, row_target, sail_target, shore_problem,
    units_that_fit_vessel, vessel_by_id, vessel_capacity, vessel_crew, vessel_of_resident,
};
use crate::queries::warehouse_trade::is_integer;
use crate::rowing::row_problem;
use crate::storing::end_order;

/// The vessel a haul order names, if it names one: its `vesselId`, or a vessel's id given as its
/// `carriageId` (as a script's `haul(id, …)` passes it, like `board`).
pub fn vessel_of_haul<'w>(world: &'w WorldState, order: &OrderRequest) -> Option<&'w Vessel> {
    str_field(order, "vesselId")
        .or_else(|| str_field(order, "carriageId"))
        .and_then(|id| vessel_by_id(world, id))
}

/// Why a stop on land can't be one for a vessel's route, with the map at hand: it must be land
/// anyone can stand on, with free water beside it for the vessel, the rower getting off onto it
/// there (`CONTEXT.md`: Beside a vessel).
pub fn water_stop_problem(
    world: &WorldState,
    map: &TerrainMap,
    v: &Vessel,
    x: i32,
    y: i32,
) -> Option<&'static str> {
    if !is_passable_terrain(terrain_at(map, x, y)) {
        return Some("a stop must be a shore tile or a haven");
    }
    // A ship's stops are havens it docks at (`CONTEXT.md`: Haul route by water).
    if v.kind == VesselKind::Ship {
        if haven_for(world, x, y, map.size).is_none() {
            return Some("a ship's stops are havens");
        }
        return sail_target(world, map, v, x, y).err();
    }
    let Some((wx, wy)) = row_target(world, map, v, x, y) else {
        return Some("no free water beside that tile");
    };
    let there = Vessel { x: f64::from(wx), y: f64::from(wy), ..v.clone() };
    shore_problem(world, map, &there, x, y)
}

/// Checks a haul order with a vessel: one of the Player's grown residents, standing on the shore
/// beside a boat of their realm, rows it between that tile and another stop on land, again and
/// again.
pub fn validate_water_haul(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
    v: &Vessel,
) -> Option<String> {
    let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[i];
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    if order.fields.get("armyId").is_some() {
        return Some("a boat hauls between stops on land, not to an army".into());
    }
    if r.aboard.is_some() {
        return Some("the route starts on the shore beside the boat: get off first".into());
    }
    if let Some(p) = route_problem(world, r, v) {
        return Some(p);
    }
    let o = &order.fields;
    let (x, y) = (o.get("x"), o.get("y"));
    if !is_integer(x) || !is_integer(y) {
        return Some("the other stop must be a tile".into());
    }
    let (x, y) = (int_field(order, "x").unwrap_or(0.0), int_field(order, "y").unwrap_or(0.0));
    if x == r.x && y == r.y {
        return Some("the other stop must be another tile".into());
    }
    if let Some(p) = terrain.and_then(|t| water_stop_problem(world, t, v, x as i32, y as i32)) {
        return Some(p.into());
    }
    let Some(goods) = read_goods(o.get("goods"), 1) else {
        return Some("pick the goods to haul".into());
    };
    let empty = Value::Array(Vec::new());
    let back = read_goods(Some(o.get("returnGoods").filter(|v| !v.is_null()).unwrap_or(&empty)), 0);
    if !back.is_some_and(|b| !b.iter().any(|g| goods.contains(g))) {
        return Some("pick the goods to haul back, none of them hauled there".into());
    }
    let food = o.get("keepFood");
    let units = food.and_then(Value::as_f64).unwrap_or(-1.0);
    let food_weight = GOOD_WEIGHT.get("food").expect("a weight for food");
    if !is_integer(food) || units < 0.0 || units * food_weight > vessel_capacity(v) {
        return Some("the Food kept for the rower must be whole units that fit on the boat".into());
    }
    None
}

/// Why a resident can't take a vessel on a haul route now: a boat as they would row it
/// (`row_problem`); a ship as its captain, grown, of its realm, on the haven it is docked at, on no
/// horse and driving nothing, with enough of its crew aboard to sail once they board too
/// (`CONTEXT.md`: Haul route by water, Crew).
fn route_problem(world: &WorldState, r: &Resident, v: &Vessel) -> Option<String> {
    if v.kind == VesselKind::Boat {
        return row_problem(world, r, v);
    }
    let problem = if !can_work(r.born_at, world.tick as f64) {
        "children can’t sail".to_string()
    } else if !vessel_of_resident(v, r) {
        "not a ship of your realm".into()
    } else if docked_at(world, v).is_none() {
        "the ship is not docked at a haven".into()
    } else if r.aboard.as_deref() != Some(v.id.as_str()) && !beside_vessel(world, v, r.x, r.y) {
        "the route starts on the haven the ship is docked at".into()
    } else if driven_carriage_id(r).is_some() {
        "the driver can’t sail".into()
    } else if r.riding.is_some() {
        "no horse goes aboard: dismount first".into()
    } else {
        let short = (SHIP_MIN_CREW as usize).saturating_sub(captain_and_crew(world, v, r));
        if short == 0 {
            return None;
        }
        format!("the ship needs {short} more crew aboard to sail")
    };
    Some(problem)
}

/// How many crew a ship sails with once its captain `r` is one of them.
fn captain_and_crew(world: &WorldState, v: &Vessel, r: &Resident) -> usize {
    let crew = vessel_crew(world, v);
    crew.len() + usize::from(!crew.iter().any(|c| c.id == r.id))
}

/// Gives a haul order with a vessel: the rower starts loading at the tile they stand on.
pub fn apply_water_haul(
    world: &mut WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) {
    let Some(v) = vessel_of_haul(world, order) else { return };
    // Rowed off or taken since the order came: no route.
    if validate_water_haul(world, sender, order, terrain, v).is_some() {
        return;
    }
    let vessel_id = v.id.clone();
    let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else { return };
    let o = &order.fields;
    let goods = read_goods(o.get("goods"), 1).unwrap_or_default();
    let return_goods =
        read_goods(o.get("returnGoods").filter(|v| !v.is_null()), 0).unwrap_or_default();
    let keep_food = o.get("keepFood").and_then(Value::as_f64).unwrap_or(0.0);
    let to =
        Tile { x: int_field(order, "x").unwrap_or(0.0), y: int_field(order, "y").unwrap_or(0.0) };
    let r = &mut world.residents[i];
    r.order = Some(ResidentOrder::HaulByWater(WaterHaulOrder {
        vessel_id,
        from: Tile { x: r.x, y: r.y },
        to,
        goods,
        return_goods,
        keep_food,
        stop: HaulStop::From,
        phase: HaulPhase::Loading,
        water: None,
        path: None,
        progress: 0.0,
        moving: None,
    }));
}

fn route_mut(world: &mut WorldState, ri: usize) -> &mut WaterHaulOrder {
    match world.residents[ri].order.as_mut() {
        Some(ResidentOrder::HaulByWater(o)) => o,
        _ => unreachable!("a haul route by water"),
    }
}

/// The tile of the route's stop it stands at or rows to.
pub fn stop_tile(o: &WaterHaulOrder, stop: HaulStop) -> Tile {
    match stop {
        HaulStop::From => o.from,
        HaulStop::To => o.to,
    }
}

/// Requests this tick's takes and puts for residents on haul routes by water who are at a stop,
/// and moves them on (`CONTEXT.md`: Haul route by water). Arrived, the rower gets off onto the
/// stop; there they load by hand, from beside the boat, as a carriage's driver does; done, they
/// board again, take the oars and row to the free water beside the other stop. The route ends
/// when the boat is gone or no longer beside the stop, or the rower can't get off onto it or
/// row it on.
pub fn request_water_hauling(world: &mut WorldState, map: &TerrainMap) -> Vec<CarryAction> {
    let mut actions = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::HaulByWater(o)) = world.residents[ri].order.clone() else {
            continue;
        };
        if o.phase != HaulPhase::Loading {
            continue;
        }
        let Some(vi) = world.vessels.iter().position(|v| v.id == o.vessel_id) else {
            end_order(world, ri, Some("the boat is gone".into()));
            continue;
        };
        let stop = stop_tile(&o, o.stop);
        let (sx, sy) = (stop.x as i32, stop.y as i32);
        let r = &world.residents[ri];
        let v = &world.vessels[vi];
        if !beside_vessel(world, v, stop.x, stop.y) {
            end_order(world, ri, Some("the boat is not beside the stop".into()));
            continue;
        }
        if r.aboard.as_deref() == Some(v.id.as_str()) {
            // Arrived: they get off onto the stop and leave the oars.
            if shore_problem(world, map, v, sx, sy).is_some() {
                end_order(world, ri, Some("no getting off onto the stop".into()));
                continue;
            }
            let rid = world.residents[ri].id.clone();
            let v = &mut world.vessels[vi];
            if v.rower_id.as_deref() == Some(rid.as_str()) {
                v.rower_id = None;
            }
            // A ship's captain leaves its crew while ashore (`CONTEXT.md`: Crew).
            v.crew_ids.retain(|c| *c != rid);
            let r = &mut world.residents[ri];
            r.aboard = None;
            (r.x, r.y) = (f64::from(wrap(sx, map.size)), f64::from(wrap(sy, map.size)));
            continue;
        }
        if r.aboard.is_some() || r.x != stop.x || r.y != stop.y {
            end_order(world, ri, Some("not at the stop".into()));
            continue;
        }
        if v.kind == VesselKind::Ship {
            if !load_ship_at_stop(world, ri, vi, &o, map) {
                continue;
            }
        } else {
            let spot = haul_stop_spot(world, stop.x, stop.y);
            let route = RouteGoods {
                goods: &o.goods,
                return_goods: &o.return_goods,
                keep_food: o.keep_food,
                stop: o.stop,
            };
            let fits = |g: Good| units_that_fit_vessel(world, v, g);
            let board = OnBoard {
                spot: GoodsSpot::Vessel { vessel_id: v.id.clone() },
                load: &v.load,
                fits: &fits,
            };
            let action = stop_action(world, ri, o.moving.as_ref(), &route, &board, &spot);
            let loaded = route.loaded(board.load);
            if let Some((action, moving)) = action {
                route_mut(world, ri).moving = moving;
                actions.push(action);
                continue;
            }
            route_mut(world, ri).moving = None;
            // It leaves the first stop once it has goods on board and nothing more to load there.
            if o.stop == HaulStop::From && !loaded {
                continue;
            }
        }
        let next = if o.stop == HaulStop::From { HaulStop::To } else { HaulStop::From };
        let other = stop_tile(&o, next);
        let (r, v) = (&world.residents[ri], &world.vessels[vi]);
        // Every water tile beside the other stop taken by another vessel: it waits for one.
        let target = match v.kind {
            VesselKind::Boat => row_target(world, map, v, other.x as i32, other.y as i32),
            VesselKind::Ship => sail_target(world, map, v, other.x as i32, other.y as i32).ok(),
        };
        let Some((wx, wy)) = target else {
            continue;
        };
        if let Some(p) = route_problem(world, r, v) {
            end_order(world, ri, Some(p));
            continue;
        }
        let rid = world.residents[ri].id.clone();
        let v = &mut world.vessels[vi];
        let (vid, vx, vy) = (v.id.clone(), v.x, v.y);
        // A boat's rower takes the oars; a ship's captain boards as one of its crew.
        match v.kind {
            VesselKind::Boat => v.rower_id = Some(rid),
            VesselKind::Ship if !v.crew_ids.contains(&rid) => v.crew_ids.push(rid),
            VesselKind::Ship => {}
        }
        let r = &mut world.residents[ri];
        r.aboard = Some(vid);
        (r.x, r.y) = (vx, vy);
        let o = route_mut(world, ri);
        o.stop = next;
        o.phase = HaulPhase::Driving;
        o.water = Some(Tile { x: f64::from(wx), y: f64::from(wy) });
        o.path = None;
        o.progress = 0.0;
    }
    actions
}

/// A ship's captain at a stop moves the route's goods straight between the haven's storage and
/// the ship (`CONTEXT.md`: Docked): first the goods for this stop off, then the Food kept on board
/// topped up, then the goods for the other stop on, as much as there is and fits. Whether the ship
/// leaves now: at the first stop only once it has goods for the other on board; with none there
/// yet it waits.
fn load_ship_at_stop(
    world: &mut WorldState,
    ri: usize,
    vi: usize,
    o: &WaterHaulOrder,
    map: &TerrainMap,
) -> bool {
    let Some(haven) = docked_at(world, &world.vessels[vi]).map(|h| h.id.clone()) else {
        return false;
    };
    let ship = GoodsSpot::Vessel { vessel_id: world.vessels[vi].id.clone() };
    let storage = GoodsSpot::Storage { storage_id: haven.clone() };
    let route = RouteGoods {
        goods: &o.goods,
        return_goods: &o.return_goods,
        keep_food: o.keep_food,
        stop: o.stop,
    };
    let (unloading, loading) = match o.stop {
        HaulStop::To => (&o.goods, &o.return_goods),
        HaulStop::From => (&o.return_goods, &o.goods),
    };
    let size = map.size;
    let kept = |g: Good| if g == Good::Food { o.keep_food } else { 0.0 };
    for &good in unloading {
        let units = held(&world.vessels[vi].load, good) - kept(good);
        if units > 0.0 {
            let goods = Stock::from([(good, units)]);
            move_straight(world, ri, &ship, &storage, goods, size, Some(map));
        }
    }
    let there = |world: &WorldState| {
        let b = world.buildings.iter().find(|b| b.id == haven);
        free_stock(world, &haven, b.and_then(|b| b.stock.as_ref()))
    };
    let food = (o.keep_food - held(&world.vessels[vi].load, Good::Food))
        .min(held(&there(world), Good::Food));
    if food > 0.0 {
        let goods = Stock::from([(Good::Food, food)]);
        move_straight(world, ri, &storage, &ship, goods, size, Some(map));
    }
    for &good in loading {
        let units = held(&there(world), good);
        if units > 0.0 {
            let goods = Stock::from([(good, units)]);
            move_straight(world, ri, &storage, &ship, goods, size, Some(map));
        }
    }
    route_mut(world, ri).moving = None;
    o.stop != HaulStop::From || route.loaded(&world.vessels[vi].load)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod ship_tests;
