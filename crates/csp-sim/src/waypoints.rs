//! Waypoints (`apps/server/src/waypoints.ts` and shared `waypoints.ts`, `CONTEXT.md`: Waypoint):
//! the Player's own marks on the map. Putting one down, renaming or removing it is plain data,
//! free, at once and from anywhere, which a script could request as well (ADR 0002). They are
//! kept by account id (`WorldState.waypoints`), not by realm, so a Leader death leaves them where
//! they are.

use csp_lang::js::{number_to_string, trim, utf16_len};
use csp_shared::balance::{WAYPOINTS_MAX, WAYPOINT_NAME_MAX_LENGTH};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, Waypoint, WorldState};
use serde_json::Value;

use crate::order_sender::OrderSender;
use crate::orders::{OrderKind, OrderKinds};
use crate::random::new_id;
use crate::sight::InvariantViolation;

/// The waypoints the Player with account `user_id` holds, oldest first (`waypointsOf`).
pub fn waypoints_of(world: &WorldState, user_id: u64) -> &[Waypoint] {
    world.waypoints.get(&user_id).map_or(&[], Vec::as_slice)
}

/// Why a name can't be given (`nameProblem`): none, empty once trimmed, or too long.
pub fn name_problem(name: Option<&Value>, max_length: f64) -> Option<String> {
    let Some(name) = name.and_then(Value::as_str) else { return Some("needs a name".into()) };
    let trimmed = trim(name);
    if trimmed.is_empty() {
        return Some("needs a name".into());
    }
    if utf16_len(trimmed) as f64 > max_length {
        return Some(format!("at most {} characters", number_to_string(max_length)));
    }
    None
}

/// Whether a value is a whole number on a map `size` tiles across.
fn on_map(v: Option<&Value>, size: i32) -> bool {
    v.and_then(Value::as_f64).is_some_and(|n| n.fract() == 0.0 && n >= 0.0 && n < size as f64)
}

/// Why a Player holding `held` can't add a waypoint named `name` on tile (x, y)
/// (`addWaypointProblem`).
pub fn add_waypoint_problem(
    held: &[Waypoint],
    x: Option<&Value>,
    y: Option<&Value>,
    name: Option<&Value>,
    size: i32,
) -> Option<String> {
    if held.len() as f64 >= WAYPOINTS_MAX {
        return Some(format!(
            "you hold {} waypoints already, the most",
            number_to_string(WAYPOINTS_MAX)
        ));
    }
    if !on_map(x, size) || !on_map(y, size) {
        return Some("not a tile on the map".into());
    }
    name_problem(name, WAYPOINT_NAME_MAX_LENGTH).map(|bad| format!("Name: {bad}"))
}

fn holds(held: &[Waypoint], id: Option<&Value>) -> bool {
    held.iter().any(|w| id.and_then(Value::as_str) == Some(w.id.as_str()))
}

/// Why a Player holding `held` can't rename the waypoint `id` to `name`
/// (`renameWaypointProblem`).
pub fn rename_waypoint_problem(
    held: &[Waypoint],
    id: Option<&Value>,
    name: Option<&Value>,
) -> Option<String> {
    if !holds(held, id) {
        return Some("not one of your waypoints".into());
    }
    name_problem(name, WAYPOINT_NAME_MAX_LENGTH).map(|bad| format!("Name: {bad}"))
}

/// Why a Player holding `held` can't remove the waypoint `id` (`removeWaypointProblem`).
pub fn remove_waypoint_problem(held: &[Waypoint], id: Option<&Value>) -> Option<String> {
    (!holds(held, id)).then(|| "not one of your waypoints".into())
}

/// The add order (`addWaypoint`): the Player gets a new waypoint with the name trimmed, after
/// those they hold. Turned down past `WAYPOINTS_MAX`, also when orders waiting for the same tick
/// filled the cap, and for an NPC city's default script, which has no Player to hold it.
pub struct AddWaypoint;

impl OrderKind for AddWaypoint {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        if sender.npc_city_id.is_some() {
            return Some("only a Player holds waypoints".into());
        }
        let Some(terrain) = terrain else { return Some("no map to put a waypoint on".into()) };
        let f = &order.fields;
        add_waypoint_problem(
            waypoints_of(world, sender.user_id),
            f.get("x"),
            f.get("y"),
            f.get("name"),
            terrain.size,
        )
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        if terrain.is_none() || self.validate(world, sender, order, terrain).is_some() {
            return;
        }
        let f = &order.fields;
        let at = |k: &str| f.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let name = trim(f.get("name").and_then(Value::as_str).unwrap_or_default()).to_string();
        let id = new_id("wp", &mut world.next_id);
        world.waypoints.entry(sender.user_id).or_default().push(Waypoint {
            id,
            name,
            x: at("x"),
            y: at("y"),
        });
    }
}

/// The rename order (`renameWaypoint`): one of the Player's waypoints takes the new name, trimmed.
pub struct RenameWaypoint;

impl OrderKind for RenameWaypoint {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        rename_waypoint_problem(
            waypoints_of(world, sender.user_id),
            f.get("waypointId"),
            f.get("name"),
        )
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        if self.validate(world, sender, order, terrain).is_some() {
            return;
        }
        let f = &order.fields;
        let id = f.get("waypointId").and_then(Value::as_str);
        let name = trim(f.get("name").and_then(Value::as_str).unwrap_or_default()).to_string();
        let held = world.waypoints.get_mut(&sender.user_id).expect("validated");
        held.iter_mut().find(|w| Some(w.id.as_str()) == id).expect("validated").name = name;
    }
}

/// The remove order (`removeWaypoint`): one of the Player's waypoints goes; a Player left with
/// none has no entry.
pub struct RemoveWaypoint;

impl OrderKind for RemoveWaypoint {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        remove_waypoint_problem(waypoints_of(world, sender.user_id), order.fields.get("waypointId"))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        if self.validate(world, sender, order, terrain).is_some() {
            return;
        }
        let id = order.fields.get("waypointId").and_then(Value::as_str);
        let held = world.waypoints.get_mut(&sender.user_id).expect("validated");
        held.retain(|w| Some(w.id.as_str()) != id);
        if held.is_empty() {
            world.waypoints.remove(&sender.user_id);
        }
    }
}

/// Adds the waypoint order kinds (`waypointOrders`).
pub fn add_waypoint_orders(kinds: &mut OrderKinds) {
    kinds.insert("addWaypoint", AddWaypoint);
    kinds.insert("renameWaypoint", RenameWaypoint);
    kinds.insert("removeWaypoint", RemoveWaypoint);
}

fn whole_on_map(v: f64, size: i32) -> bool {
    v.fract() == 0.0 && v >= 0.0 && v < size as f64
}

/// Invariant (`waypoints-sound`, ADR 0004): each Player holds at most `WAYPOINTS_MAX` waypoints,
/// each on a tile of the map with a trimmed name of at most `WAYPOINT_NAME_MAX_LENGTH`, and no
/// two waypoints share an id.
pub fn waypoints_sound(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for (user_id, held) in &world.waypoints {
        if held.len() as f64 > WAYPOINTS_MAX {
            out.push(InvariantViolation {
                invariant: "waypoints-sound".into(),
                message: format!(
                    "Player {user_id} holds {} waypoints, more than {}",
                    held.len(),
                    number_to_string(WAYPOINTS_MAX)
                ),
                entity_ids: Vec::new(),
            });
        }
        for w in held {
            let name = Value::String(w.name.clone());
            let problem = if ids.contains(&w.id) {
                Some("shares its id with another waypoint".to_string())
            } else if !whole_on_map(w.x, terrain.size) || !whole_on_map(w.y, terrain.size) {
                Some("is off the map".to_string())
            } else if let Some(p) = name_problem(Some(&name), WAYPOINT_NAME_MAX_LENGTH) {
                Some(p)
            } else if w.name != trim(&w.name) {
                Some("name not trimmed".to_string())
            } else {
                None
            };
            if let Some(problem) = problem {
                out.push(InvariantViolation {
                    invariant: "waypoints-sound".into(),
                    message: format!("Player {user_id}'s waypoint {}: {problem}", w.id),
                    entity_ids: vec![w.id.clone()],
                });
            }
            ids.insert(w.id.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests;
