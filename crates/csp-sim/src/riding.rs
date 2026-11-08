//! Riding (`apps/server/src/riding.ts`, `CONTEXT.md`: Riding): the mount and dismount orders, and
//! riding ending at the end of a tick when it can't go on.

use std::collections::HashSet;

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, WorldState};

use crate::movement_pending::{
    ordered_resident, str_field, take_over, OrderKind, OrderSender, Taken,
};
use crate::queries::alliance::commander_of;
use crate::queries::carriages::carriage_pulled_by;
use crate::queries::residents::is_down;
use crate::queries::riding::{horse_of_resident, horse_ridden, mount_problem};
use crate::walking::order_path_mut;

/// A path found before mounting or dismounting kept to the ground and walls of the other way of
/// going, so the walk finds a new one (`freshPath`).
fn fresh_path(world: &mut WorldState, i: usize) {
    if let Some(o) = world.residents[i].order.as_mut() {
        if let Some((path, progress)) = order_path_mut(o) {
            *path = None;
            *progress = 0.0;
        }
    }
}

/// The mount order (`mount`): one of the Player's residents gets on a horse of their realm on
/// their tile that pulls no carriage. Naming another organization's free horse steals it.
pub struct Mount;

impl OrderKind for Mount {
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
        let horse =
            world.horses.iter().find(|h| Some(h.id.as_str()) == str_field(order, "horseId"));
        let commander = commander_of(world, &r.id, r.owner.as_deref());
        mount_problem(world, r, horse, terrain, commander.as_deref())
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let (Some(rid), Some(hid)) = (str_field(order, "residentId"), str_field(order, "horseId"))
        else {
            return;
        };
        let Some(i) = world.residents.iter().position(|x| x.id == rid) else { return };
        let Some(h) = world.horses.iter().position(|x| x.id == hid) else { return };
        // Two riders ordered onto one horse in the same tick: the first one rides it.
        let r = &world.residents[i];
        let commander = commander_of(world, &r.id, r.owner.as_deref());
        if mount_problem(world, r, Some(&world.horses[h]), terrain, commander.as_deref()).is_some()
        {
            return;
        }
        if let Some(c) = commander.as_deref().filter(|c| !c.is_empty()) {
            if !horse_of_resident(&world.horses[h], &world.residents[i]) {
                let thief = world.residents[i].id.clone();
                let size = terrain.map_or(MAP_SIZE, |t| t.size);
                take_over(world, &thief, c, Taken { carriage: None, horse: Some(h) }, size);
            }
        }
        world.residents[i].riding = Some(hid.to_string());
        fresh_path(world, i);
    }
}

/// The dismount order (`dismount`): a resident gets off their horse, which stays on the tile.
pub struct Dismount;

impl OrderKind for Dismount {
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
        r.riding.is_none().then(|| "not riding".into())
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some(rid) = str_field(order, "residentId") else { return };
        let Some(i) = world.residents.iter().position(|x| x.id == rid) else { return };
        if world.residents[i].riding.take().is_none() {
            return;
        }
        fresh_path(world, i);
    }
}

/// Ends riding that can't go on (`stepRiders`), at the end of each tick: the horse died or is
/// Down, is no longer the rider's realm's, was hitched, or has another rider, or the rider left
/// it behind. The horse stays where it is.
pub fn step_riders(world: &mut WorldState) {
    let mut ridden: HashSet<String> = HashSet::new();
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        if r.riding.is_none() {
            continue;
        }
        let keep = horse_ridden(world, r).filter(|h| {
            h.x == r.x
                && h.y == r.y
                && horse_of_resident(h, r)
                && !is_down(h.down_until)
                && carriage_pulled_by(world, &h.id).is_none()
                && !ridden.contains(&h.id)
        });
        match keep.map(|h| h.id.clone()) {
            Some(id) => {
                ridden.insert(id);
            }
            None => world.residents[i].riding = None,
        }
    }
}

#[cfg(test)]
mod tests;
