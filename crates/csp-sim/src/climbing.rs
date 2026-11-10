//! Climbing over walls (`apps/server/src/climbing.ts`, `CONTEXT.md`: Walls in combat, climbed):
//! the climb order, and climbing a tick further each tick until over.

use csp_shared::balance::{CLIMB_TICKS, MAP_SIZE};
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::world::{BuildingKind, ClimbOrder, OrderRequest, ResidentOrder, Tile, WorldState};

use crate::order_sender::{commands, realm_of, OrderSender};
use crate::orders::{str_field, OrderKind};
use crate::walls::{climb_landing, foreign_wall};

/// An action a resident with a climb order requests: climb a tick further up the wall.
#[derive(Debug, Clone, PartialEq)]
pub struct ClimbAction {
    pub resident_id: String,
}

/// Whether two tiles are side by side, the short way round a map of `size` tiles (`besides`).
/// Only straight: the climber comes down straight across (`climb_landing`).
fn besides(size: i32, a: (f64, f64), b: (f64, f64)) -> bool {
    wrap_delta(a.0 as i32, b.0 as i32, size).abs() + wrap_delta(a.1 as i32, b.1 as i32, size).abs()
        == 1
}

/// The climb order (`climb`): one of the Player's residents climbs over a wall or gate of another
/// realm's city, or of none, from the tile next to it they stand on.
pub struct Climb;

impl OrderKind for Climb {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let (Some(realm), Some(r)) = (realm, r) else {
            return Some("not one of your residents".into());
        };
        if !commands(world, &realm.id, Some(r)) {
            return Some("not one of your residents".into());
        }
        let wall = match foreign_wall(world, Some(&realm.id), str_field(order, "wallId")) {
            Ok(w) => w,
            Err(e) => return Some(e),
        };
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        if !besides(size, (r.x, r.y), (wall.x, wall.y)) {
            return Some("stand next to the wall to climb it".into());
        }
        None
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let (Some(id), Some(wall_id)) =
            (str_field(order, "residentId"), str_field(order, "wallId"))
        else {
            return;
        };
        if let Some(r) = world.residents.iter_mut().find(|x| x.id == id) {
            let at = Tile { x: r.x, y: r.y };
            r.order = Some(ResidentOrder::Climb(ClimbOrder {
                wall_id: wall_id.to_string(),
                at,
                progress: 0.0,
            }));
        }
    }
}

/// Requests this tick's climbing (`requestClimbing`).
pub fn request_climbing(world: &WorldState) -> Vec<ClimbAction> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::Climb(_))))
        .map(|r| ClimbAction { resident_id: r.id.clone() })
        .collect()
}

/// Resolves climbing (`resolveClimbing`, ADR 0002), one action after another. A climber who has
/// left their tile, or whose wall is gone, stops. Each tick takes them `1 / CLIMB_TICKS` of the
/// way; once over, they come down where `climb_landing` says and the order is done.
pub fn resolve_climbing(world: &mut WorldState, actions: &[ClimbAction], terrain: &TerrainMap) {
    for a in actions {
        let Some(i) = world.residents.iter().position(|x| x.id == a.resident_id) else { continue };
        let r = &world.residents[i];
        let Some(ResidentOrder::Climb(o)) = &r.order else { continue };
        let wall = world.buildings.iter().find(|b| b.id == o.wall_id);
        let finished = wall.filter(|w| {
            matches!(w.kind, BuildingKind::Wall | BuildingKind::Gate) && w.site.is_none()
        });
        let stays = finished.is_some_and(|w| {
            r.x == o.at.x && r.y == o.at.y && besides(terrain.size, (r.x, r.y), (w.x, w.y))
        });
        if !stays {
            world.residents[i].order = None;
            continue;
        }
        let wall_at = finished.map(|w| (w.x, w.y)).expect("a finished wall");
        let from = (r.x, r.y);
        let progress = 1.0f64.min(o.progress + 1.0 / CLIMB_TICKS);
        if progress < 1.0 - 1e-9 {
            if let Some(ResidentOrder::Climb(o)) = &mut world.residents[i].order {
                o.progress = progress;
            }
            continue;
        }
        let tile = |(x, y): (f64, f64)| (x as i32, y as i32);
        let (x, y) = climb_landing(world, terrain, tile(from), tile(wall_at));
        let r = &mut world.residents[i];
        (r.x, r.y) = (f64::from(x), f64::from(y));
        r.order = None;
    }
}

#[cfg(test)]
mod tests;
