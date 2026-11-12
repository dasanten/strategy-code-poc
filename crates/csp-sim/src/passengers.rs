//! Passengers (`apps/server/src/passengers.ts`, `CONTEXT.md`: Passenger, Beside a vessel): the
//! board and get-off orders, the orders that get a passenger off first, and being aboard ending
//! when it can't go on. Aboard a carriage a passenger stands on its tile; aboard a vessel, on its
//! water tile, stepping on from a land tile beside it and off onto a free one.

use csp_shared::terrain::{is_passable_terrain, terrain_at, TerrainMap};
use csp_shared::world::{OrderRequest, Resident, Vessel, VesselKind, WorldState};

use crate::combat::{attack_target, Target};
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{bool_field, int_field, str_field, OrderKind};
use crate::queries::building::building_at;
use crate::queries::carriages::driven_carriage_id;
use crate::queries::combat::in_contact;
use crate::queries::driving::{board_problem, carriage_of_resident};
use crate::queries::vessels::{
    across_docked_ship, between_vessels, board_vessel_problem, landing_tile, shore_problem, vessel_aboard,
    vessel_by_id, vessel_of_resident,
};
use crate::walking::WalkTo;
use crate::walls::is_wall_or_gate;
use crate::world::{is_walkable, nearest_free_tile};

/// The id a board order names: `vesselId`, or `carriageId`, which may name a vessel too (a script's
/// `board(id)` takes either).
fn board_target(order: &OrderRequest) -> Option<&str> {
    str_field(order, "vesselId").or_else(|| str_field(order, "carriageId"))
}

/// Whether a board order takes the resident aboard a ship as crew (`asCrew`, `CONTEXT.md`: Crew).
fn as_crew(order: &OrderRequest) -> bool {
    bool_field(order, "asCrew") == Some(true)
}

/// The board order (`board`): one of the Player's residents gets on a carriage of their realm on
/// their tile, or a vessel of their realm beside them (onto its water tile; a ship from the haven
/// it is docked at), that has room for them; with `asCrew`, aboard a ship as one of its crew
/// (`CONTEXT.md`: Crew). What they were doing stops.
pub struct Board;

impl OrderKind for Board {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId"))
            .map(|i| &world.residents[i])
        else {
            return Some("not one of your residents".into());
        };
        let id = board_target(order);
        if let Some(v) = id.and_then(|id| vessel_by_id(world, id)) {
            return board_vessel_problem(world, r, v, as_crew(order));
        }
        if as_crew(order) {
            return Some("only a ship takes a crew".into());
        }
        let carriage = world.carriages.iter().find(|k| Some(k.id.as_str()) == id);
        board_problem(world, r, carriage)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some(i) = world
            .residents
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "residentId"))
        else {
            return;
        };
        let cid = board_target(order);
        if let Some(v) = cid.and_then(|id| vessel_by_id(world, id)) {
            // Two residents ordered onto the last room in the same tick: the first one boards.
            let crew = as_crew(order);
            if board_vessel_problem(world, &world.residents[i], v, crew).is_some() {
                return;
            }
            let (id, x, y) = (v.id.clone(), v.x, v.y);
            if crew {
                let rid = world.residents[i].id.clone();
                let vi = world.vessels.iter().position(|v| v.id == id).expect("a vessel");
                world.vessels[vi].crew_ids.push(rid);
            }
            let r = &mut world.residents[i];
            r.aboard = Some(id);
            (r.x, r.y) = (x, y);
            r.order = None;
            return;
        }
        if as_crew(order) {
            return;
        }
        let carriage = world.carriages.iter().find(|k| Some(k.id.as_str()) == cid);
        // Two residents ordered onto the last room in the same tick: the first one boards.
        if board_problem(world, &world.residents[i], carriage).is_some() {
            return;
        }
        let r = &mut world.residents[i];
        r.aboard = cid.map(str::to_string);
        r.order = None;
    }
}

/// Why a passenger can't get off onto (x, y) (`getOffTileProblem`): a tile right next to their
/// carriage that is walkable and has no wall or gate on it.
fn get_off_tile_problem(
    world: &WorldState,
    r: &Resident,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
        return Some("the target must be a tile".into());
    };
    let terrain = terrain?;
    let size = terrain.size;
    if !in_contact(size, (r.x as i32, r.y as i32), (x as i32, y as i32)) {
        return Some("that tile is not next to the carriage".into());
    }
    if !is_passable_terrain(terrain_at(terrain, x as i32, y as i32)) {
        return Some("nobody can stand there".into());
    }
    if building_at(world, x as i32, y as i32, size).is_some_and(is_wall_or_gate) {
        return Some("a wall or gate stands there".into());
    }
    None
}

/// The get-off order (`getOff`): a passenger gets off onto their carriage's tile, or with a tile
/// right next to it, steps over onto that one (a walk).
pub struct GetOff;

impl OrderKind for GetOff {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId"))
            .map(|i| &world.residents[i])
        else {
            return Some("not one of your residents".into());
        };
        if r.aboard.is_none() {
            return Some("not aboard a carriage or boat".into());
        }
        if let Some(v) = vessel_aboard(world, r) {
            let terrain = terrain?;
            let given = order.fields.contains_key("x") || order.fields.contains_key("y");
            if !given {
                return landing_tile(world, terrain, v, None).is_none().then(|| no_shore(v));
            }
            let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
                return Some("the target must be a tile".into());
            };
            return shore_problem(world, terrain, v, x as i32, y as i32).map(str::to_string);
        }
        if !order.fields.contains_key("x") && !order.fields.contains_key("y") {
            return None;
        }
        get_off_tile_problem(world, r, order, terrain)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(i) = world
            .residents
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "residentId"))
        else {
            return;
        };
        if vessel_aboard(world, &world.residents[i]).is_some() {
            let Some(map) = terrain else { return };
            let at = match (int_field(order, "x"), int_field(order, "y")) {
                (Some(x), Some(y)) => Some((x as i32, y as i32)),
                _ => None,
            };
            let v = vessel_aboard(world, &world.residents[i]).expect("aboard a vessel");
            let tile = match at {
                Some((x, y)) => shore_problem(world, map, v, x, y).is_none().then_some((x, y)),
                None => landing_tile(world, map, v, None),
            };
            if let Some(tile) = tile {
                land(world, i, tile, map.size);
            }
            return;
        }
        if world.residents[i].aboard.take().is_none() {
            return;
        }
        if !order.fields.contains_key("x") || !order.fields.contains_key("y") {
            return;
        }
        let mut walk = order.clone();
        walk.kind = "walkTo".into();
        WalkTo.apply(world, sender, &walk, terrain);
    }
}

/// The orders that act on a tile, and so get a passenger off their carriage first
/// (`GETS_OFF_FIRST`).
pub const GETS_OFF_FIRST: [&str; 33] = [
    "walkTo",
    "relocate",
    "drive",
    "unhitch",
    "hitch",
    "haul",
    "pickUp",
    "drop",
    "store",
    "fetch",
    "build",
    "tearDown",
    "workAt",
    "teach",
    "train",
    "breed",
    "attack",
    "climb",
    "mount",
    "roadLine",
    "wallLine",
    "buyCity",
    "buy",
    "sell",
    "swap",
    "buyHorse",
    "sellHorse",
    "handIn",
    "transfer",
    "buyOff",
    "payDebt",
    "acceptOffer",
    "feed",
];

/// An order kind that first gets the ordered resident off their carriage (`getsOffFirst`).
pub struct GetsOffFirst<K>(pub K);

impl<K: OrderKind> OrderKind for GetsOffFirst<K> {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        if let Some(p) = self.0.validate(world, sender, order, terrain) {
            return Some(p);
        }
        // Off a boat only onto a shore beside it (`CONTEXT.md`: Beside a vessel).
        let id = str_field(order, "residentId");
        let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id)?;
        let v = vessel_aboard(world, r)?;
        let map = terrain?;
        if fights_from_aboard(world, r, order, map.size) {
            return None;
        }
        landing_tile(world, map, v, order_tile(order).or_else(|| attack_tile(world, order)))
            .is_none()
            .then(|| no_shore(v))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        if let Some(i) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) {
            if vessel_aboard(world, &world.residents[i]).is_some() {
                let toward = order_tile(order).or_else(|| attack_tile(world, order));
                let stays = terrain.is_some_and(|map| {
                    fights_from_aboard(world, &world.residents[i], order, map.size)
                });
                let landed =
                    stays || terrain.is_some_and(|map| get_off_vessel(world, i, map, toward));
                if !landed {
                    return;
                }
            } else {
                world.residents[i].aboard = None;
            }
        }
        self.0.apply(world, sender, order, terrain);
    }
}

/// The tile an attack order's target stands on, if it is one and that target is there.
fn attack_tile(world: &WorldState, order: &OrderRequest) -> Option<(i32, i32)> {
    if order.kind != "attack" {
        return None;
    }
    let (x, y) = match attack_target(world, str_field(order, "targetId")?)? {
        Target::Resident(t) => (world.residents[t].x, world.residents[t].y),
        Target::Building(b) => (world.buildings[b].x, world.buildings[b].y),
    };
    Some((x as i32, y as i32))
}

/// Whether a vessel's passenger fights the target of an attack order from aboard (`CONTEXT.md`:
/// Fighting at a vessel): it is beside the vessel, or aboard it too, as if the vessel were the
/// next land tile; never someone aboard another vessel. They stay aboard for it.
fn fights_from_aboard(world: &WorldState, r: &Resident, order: &OrderRequest, size: i32) -> bool {
    let Some(at) = attack_tile(world, order) else { return false };
    let target = str_field(order, "targetId").and_then(|id| world.residents.iter().find(|t| t.id == id));
    let across = target.is_some_and(|t| between_vessels(world, r, t));
    // From a docked ship, anyone on its haven (`CONTEXT.md`: Fighting at a vessel).
    let haven = target.is_some_and(|t| across_docked_ship(world, r, t));
    !across && (haven || in_contact(size, (r.x as i32, r.y as i32), at))
}

/// The tile an order acts on, if it names one.
fn order_tile(order: &OrderRequest) -> Option<(i32, i32)> {
    match (int_field(order, "x"), int_field(order, "y")) {
        (Some(x), Some(y)) => Some((x as i32, y as i32)),
        _ => None,
    }
}

/// Why nobody gets off a vessel with no land to get off onto (`CONTEXT.md`: Beside a vessel; a
/// ship only at a haven).
fn no_shore(v: &Vessel) -> String {
    match v.kind {
        VesselKind::Boat => "no shore beside the boat to get off onto".into(),
        VesselKind::Ship => "the ship is not docked at a haven".into(),
    }
}

/// Puts the resident at `i` off whatever they are aboard, onto `tile`; one of a ship's crew is
/// its crew no more (`CONTEXT.md`: Crew).
fn land(world: &mut WorldState, i: usize, tile: (i32, i32), size: i32) {
    let id = world.residents[i].id.clone();
    for v in &mut world.vessels {
        v.crew_ids.retain(|c| *c != id);
    }
    let r = &mut world.residents[i];
    r.aboard = None;
    r.x = f64::from(csp_shared::terrain::wrap(tile.0, size));
    r.y = f64::from(csp_shared::terrain::wrap(tile.1, size));
}

/// Gets the passenger at `i` off the vessel they are aboard onto the free land tile beside it
/// nearest `toward` (`CONTEXT.md`: Beside a vessel). Whether they got off: not with no shore beside
/// it, where they stay aboard.
pub fn get_off_vessel(
    world: &mut WorldState,
    i: usize,
    map: &TerrainMap,
    toward: Option<(i32, i32)>,
) -> bool {
    let Some(v) = vessel_aboard(world, &world.residents[i]) else { return false };
    let Some(tile) = landing_tile(world, map, v, toward) else { return false };
    land(world, i, tile, map.size);
    true
}

/// Ends being aboard that can't go on (`stepPassengers`), at the end of each tick: the carriage
/// is gone or no longer the passenger's realm's, the passenger drives or rides now, or left its
/// tile. They stand where they are. A vessel's passenger stands on water, so they get off onto
/// the shore beside it instead (`get_off_vessel`), and stay aboard while there is none; with
/// the vessel gone, onto the nearest land.
pub fn step_passengers(world: &mut WorldState, map: &TerrainMap) {
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        let Some(id) = r.aboard.as_deref() else { continue };
        if world.carriages.iter().all(|k| k.id != id) {
            step_vessel_passenger(world, i, map);
            continue;
        }
        let stays = world.carriages.iter().find(|k| k.id == id).is_some_and(|k| {
            k.x == r.x
                && k.y == r.y
                && carriage_of_resident(&k.realm_id, &k.city_id, r)
                && driven_carriage_id(r).is_none()
                && r.riding.is_none()
        });
        if !stays {
            world.residents[i].aboard = None;
        }
    }
    // A boat's rower who is no longer aboard it leaves its oars (`CONTEXT.md`: Rowing).
    for vi in 0..world.vessels.len() {
        let v = &world.vessels[vi];
        let Some(rower) = v.rower_id.as_deref() else { continue };
        let aboard =
            world.residents.iter().any(|r| r.id == rower && r.aboard.as_deref() == Some(&v.id));
        if !aboard {
            world.vessels[vi].rower_id = None;
        }
    }
    // A ship's crew who are no longer aboard it are no longer its crew (`CONTEXT.md`: Crew).
    for vi in 0..world.vessels.len() {
        if world.vessels[vi].crew_ids.is_empty() {
            continue;
        }
        let id = world.vessels[vi].id.clone();
        let residents = &world.residents;
        world.vessels[vi]
            .crew_ids
            .retain(|c| residents.iter().any(|r| &r.id == c && r.aboard.as_deref() == Some(&id)));
    }
}

/// `step_passengers` for one aboard something that is no carriage: a vessel, or one that is gone.
fn step_vessel_passenger(world: &mut WorldState, i: usize, map: &TerrainMap) {
    let r = &world.residents[i];
    if let Some(v) = vessel_aboard(world, r) {
        if v.x != r.x || v.y != r.y {
            // Somehow off its tile: no longer aboard, and on land.
            world.residents[i].aboard = None;
        } else {
            // A thief crew aboard a ship they are taking stay too (`CONTEXT.md`: Sailing).
            let stays =
                (vessel_of_resident(v, r) || v.crew_ids.contains(&r.id))
                    && driven_carriage_id(r).is_none()
                    && r.riding.is_none();
            if !stays {
                get_off_vessel(world, i, map, None);
            }
            return;
        }
    } else {
        world.residents[i].aboard = None;
    }
    let r = &world.residents[i];
    let (x, y) = (r.x as i32, r.y as i32);
    if !is_walkable(map, x, y) {
        let (x, y) = nearest_free_tile(map, &Default::default(), x, y);
        land(world, i, (x, y), map.size);
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod vessel_tests;
