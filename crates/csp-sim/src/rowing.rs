//! Rowing (`CONTEXT.md`: Rowing, Seafaring): the row order, by which a grown resident aboard a
//! boat of their realm, or beside it (boarding first), takes its oars and rows it to a water tile.
//! The steps themselves are found and taken by the walking (`walking.rs`), over water only.

use csp_shared::balance::PASSENGER_WEIGHT;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    OrderRequest, Resident, ResidentOrder, RowOrder, Tile, Vessel, WorldState,
};

use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::carriages::driven_carriage_id;
use crate::queries::residents::can_work;
use crate::queries::vessels::{
    beside_vessel, row_target, vessel_by_id, vessel_of_resident, vessel_room,
};

/// Why a resident can't take a vessel's oars now (`CONTEXT.md`: Rowing): grown, of its realm,
/// aboard it or beside it, on no horse and driving nothing. One boarding from beside it who would
/// put its rower among the passengers needs room for them.
pub fn row_problem(world: &WorldState, r: &Resident, v: &Vessel) -> Option<String> {
    let aboard_it = r.aboard.as_deref() == Some(v.id.as_str());
    let problem = if !can_work(r.born_at, world.tick as f64) {
        "children can’t row"
    } else if !vessel_of_resident(v, r) {
        "not a boat of your realm"
    } else if r.aboard.is_some() && !aboard_it {
        "aboard another carriage or boat"
    } else if !aboard_it && !beside_vessel(v, r.x, r.y) {
        "that boat is not beside the resident"
    } else if driven_carriage_id(r).is_some() {
        "the driver can’t row"
    } else if r.riding.is_some() {
        "no horse goes aboard: dismount first"
    } else if !aboard_it
        && v.rower_id.as_deref().is_some_and(|id| id != r.id)
        && vessel_room(world, v) < PASSENGER_WEIGHT - 1e-9
    {
        // The one at the oars becomes a passenger.
        "the boat is full"
    } else {
        return None;
    };
    Some(problem.to_string())
}

/// A checked row order: the rower and the boat, by their places in the world, and the water tile
/// to row to (with the map at hand).
type Checked = (usize, usize, Option<(i32, i32)>);

/// The row order (`row`): one of the Player's residents rows a boat (`vesselId`) to (x, y), or the
/// nearest free water tile beside it when it is land. Beside the boat, they board it first. They
/// take its oars, and the one at them before becomes a passenger.
pub struct Row;

impl Row {
    /// The resident (by index), the boat and the water tile to row to, or why not.
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Result<Checked, String> {
        let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let Some(v) = str_field(order, "vesselId").and_then(|id| vessel_by_id(world, id)) else {
            return Err("no such boat".into());
        };
        if let Some(p) = row_problem(world, &world.residents[i], v) {
            return Err(p);
        }
        let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
            return Err("the target must be a tile".into());
        };
        let to = match terrain {
            Some(map) => Some(
                row_target(world, map, v, x as i32, y as i32)
                    .ok_or("no free water beside that tile")?,
            ),
            None => None,
        };
        let vi = world.vessels.iter().position(|x| x.id == v.id).expect("a vessel of the world");
        Ok((i, vi, to))
    }
}

impl OrderKind for Row {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        Row::check(world, sender, order, terrain).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        // Taken or rowed by someone else since the order came: it goes nowhere.
        let Ok((i, vi, to)) = Row::check(world, sender, order, terrain) else { return };
        let (x, y) = to.unwrap_or_else(|| {
            (
                int_field(order, "x").unwrap_or(0.0) as i32,
                int_field(order, "y").unwrap_or(0.0) as i32,
            )
        });
        let v = &mut world.vessels[vi];
        let (vid, vx, vy) = (v.id.clone(), v.x, v.y);
        v.rower_id = Some(world.residents[i].id.clone());
        let r = &mut world.residents[i];
        r.aboard = Some(vid.clone());
        (r.x, r.y) = (vx, vy);
        r.order = Some(ResidentOrder::Row(RowOrder {
            vessel_id: vid,
            target: Tile { x: f64::from(x), y: f64::from(y) },
            path: None,
            progress: 0.0,
        }));
    }
}

#[cfg(test)]
mod tests;
