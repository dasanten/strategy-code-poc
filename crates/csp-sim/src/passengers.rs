//! Passengers (`apps/server/src/passengers.ts`, `CONTEXT.md`: Passenger): the board and get-off
//! orders, the orders that get a passenger off first, and being aboard ending when it can't go on.

use csp_shared::terrain::{is_passable_terrain, terrain_at, TerrainMap};
use csp_shared::world::{OrderRequest, Resident, WorldState};

use crate::movement_pending::{
    in_contact, int_field, is_wall_or_gate, ordered_resident, str_field, OrderKind, OrderSender,
};
use crate::queries::building::building_at;
use crate::queries::carriages::driven_carriage_id;
use crate::queries::driving::{board_problem, carriage_of_resident};
use crate::walking::WalkTo;

/// The board order (`board`): one of the Player's residents gets on a carriage of their realm on
/// their tile that has room for them. What they were doing stops.
pub struct Board;

impl OrderKind for Board {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Some("not one of your residents".into());
        };
        let carriage =
            world.carriages.iter().find(|k| Some(k.id.as_str()) == str_field(order, "carriageId"));
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
        let cid = str_field(order, "carriageId");
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
    if !in_contact(size, (r.x, r.y), (x, y)) {
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
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Some("not one of your residents".into());
        };
        if r.aboard.is_none() {
            return Some("not aboard a carriage".into());
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
pub struct GetsOffFirst<K: OrderKind>(pub K);

impl<K: OrderKind> OrderKind for GetsOffFirst<K> {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        self.0.validate(world, sender, order, terrain)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
            r.aboard = None;
        }
        self.0.apply(world, sender, order, terrain);
    }
}

/// Ends being aboard that can't go on (`stepPassengers`), at the end of each tick: the carriage
/// is gone or no longer the passenger's realm's, the passenger drives or rides now, or left its
/// tile. They stand where they are.
pub fn step_passengers(world: &mut WorldState) {
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        let Some(id) = r.aboard.as_deref() else { continue };
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
}

#[cfg(test)]
mod tests;
