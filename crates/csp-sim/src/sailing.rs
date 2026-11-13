//! Sailing (`CONTEXT.md`: Sailing, Crew, Seafaring): the sail order, by which one of a ship's crew,
//! its captain, sails it with at least the minimum crew aboard to a Sea tile or to a haven, where it
//! docks. The steps themselves are found and taken by the walking (`walking.rs`), over Sea only, at
//! the pace the crew's Seafaring sets. Sailing off another organization's ship with a crew of the
//! captain's realm steals it.

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    OrderRequest, Resident, ResidentOrder, RowOrder, Tile, Vessel, VesselKind, WorldState,
};

use crate::order_sender::{ordered_resident, realm_of, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::vessels::{crew_short, sail_target, steals_vessel, vessel_by_id};
use crate::stealing::{take_over, Taken};

/// Why a resident can't sail a ship now (`CONTEXT.md`: Sailing): a ship, which they are aboard as
/// one of its crew, with at least the minimum crew aboard.
pub fn sail_problem(world: &WorldState, r: &Resident, v: &Vessel) -> Option<String> {
    if v.kind != VesselKind::Ship {
        return Some("only a ship is sailed: a boat is rowed".into());
    }
    if r.aboard.as_deref() != Some(v.id.as_str()) || !v.crew_ids.contains(&r.id) {
        return Some("only one of its crew aboard sails a ship".into());
    }
    match crew_short(world, v) {
        0 => None,
        n => Some(format!("the ship needs {n} more crew to sail")),
    }
}

/// A checked sail order: the captain and the ship, by their places in the world, the Sea tile to
/// sail to (with the map at hand), and the realm that steals the ship by it, if it does.
type Checked = (usize, usize, Option<(i32, i32)>, Option<String>);

/// The sail order (`sail`): one of the Player's residents, one of a ship's crew, sails it (`vesselId`)
/// to (x, y): a Sea tile, or a haven, docking on the free Sea tile beside it nearest the ship. A
/// ship of another organization, or of nobody, crewed by the captain's realm is stolen by it with
/// its load (`CONTEXT.md`: Sailing).
pub struct Sail;

impl Sail {
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
            return Err("no such ship".into());
        };
        let r = &world.residents[i];
        if let Some(p) = sail_problem(world, r, v) {
            return Err(p);
        }
        // Only a resident of the ordering realm itself steals one (`CONTEXT.md`: Sailing).
        let realm = realm_of(world, sender.user_id)
            .filter(|_| sender.npc_city_id.is_none())
            .map(|realm| realm.id.clone())
            .filter(|realm| r.owner.as_deref() == Some(realm.as_str()));
        let thief_realm = realm.filter(|realm| steals_vessel(v, realm));
        if thief_realm.is_none() && v.realm_id != r.owner {
            return Err("not a ship of your realm".into());
        }
        let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
            return Err("the target must be a tile".into());
        };
        let to = match terrain {
            Some(map) => Some(sail_target(world, map, v, x as i32, y as i32)?),
            None => None,
        };
        let vi = world.vessels.iter().position(|x| x.id == v.id).expect("a vessel of the world");
        Ok((i, vi, to, thief_realm))
    }
}

impl OrderKind for Sail {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        Sail::check(world, sender, order, terrain).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Ok((i, vi, to, thief_realm)) = Sail::check(world, sender, order, terrain) else {
            return;
        };
        if let Some(realm) = thief_realm {
            let (thief, size) =
                (world.residents[i].id.clone(), terrain.map_or(MAP_SIZE, |t| t.size));
            take_over(world, &thief, &realm, Taken { vessel: Some(vi), ..Taken::default() }, size);
        }
        let (x, y) = to.unwrap_or_else(|| {
            (
                int_field(order, "x").unwrap_or(0.0) as i32,
                int_field(order, "y").unwrap_or(0.0) as i32,
            )
        });
        let vessel_id = world.vessels[vi].id.clone();
        // One captain at a time: another of the crew sailing it stops.
        for r in &mut world.residents {
            if matches!(&r.order, Some(ResidentOrder::Sail(o)) if o.vessel_id == vessel_id) {
                r.order = None;
            }
        }
        world.residents[i].order = Some(ResidentOrder::Sail(RowOrder {
            vessel_id,
            target: Tile { x: f64::from(x), y: f64::from(y) },
            path: None,
            progress: 0.0,
        }));
    }
}
