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

use crate::order_meta::{OrderMeta, StepGroup};
use crate::order_sender::{ordered_resident, realm_of, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::vessels::{crew_short, sail_target, steals_vessel, vessel_by_id};
use crate::running::{no_ties, same_when_equal, Arrival, By, Going, GoingMut, RunningOrder, To};
use crate::script_actions::{arg, place, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
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

pub(crate) static SAIL_META: OrderMeta =
    OrderMeta::request("sail", &Sail).queue_step(StepGroup::Move).script(&[SAIL_ACTION]);

const SAIL_ACTION: ScriptAction = ScriptAction {
    name: "sail",
    group: ActionGroup::Movement,
    request: Request::Fields(&[place("ship", "vesselId"), arg("x"), arg("y")]),
    cost: 10.0,
    description: "Sail a ship, by it or its id, to the Sea tile x, y, or to the haven on x, y, docking on the free Sea tile beside it nearest the ship. I must be aboard it as one of its crew, with at least the fewest crew it sails with aboard. A Step at a time over Sea only, never onto a Lake; the crew's Seafaring sets the pace, and sailing teaches it to all of them. My order is \"sail\" until it gets there.",
    returns: ScriptType::String,
};

impl RunningOrder<Sail> for RowOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Sails(&self.vessel_id),
            to: To::tile(&self.target),
            near: false,
            after: None,
            estimated: false,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        Arrival::Done
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        // The path found before the interruption is kept (#1619).
        true
    }
    same_when_equal!();
    no_ties!();
}
