//! What the checks of several domains share.

use std::collections::HashSet;

use csp_shared::footprint::is_at;
use csp_shared::world::{ResidentOrder, WorldState};

use super::InvariantViolation;
use crate::queries::names::placed;

/// What a check found.
pub(super) type Out = Vec<InvariantViolation>;

/// An order's kind as the TypeScript names it (`order.kind`).
pub(super) fn kind_of(o: &ResidentOrder) -> String {
    serde_json::to_value(o)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// At a building, on the whole map (`isAt(r, b)` with its default size).
pub(super) fn at_building(x: f64, y: f64, b: &csp_shared::world::Building) -> bool {
    is_at((x as i32, y as i32), placed(b), csp_shared::balance::MAP_SIZE)
}

/// Whether a horse or carriage is of a resident's realm, or of their NPC city
/// (`horseOfResident`, `carriageOfResident`).
pub(super) fn of_resident(
    realm_id: Option<&str>,
    city_id: Option<&str>,
    r: &csp_shared::world::Resident,
) -> bool {
    match &r.owner {
        Some(owner) => realm_id == Some(owner.as_str()),
        None => realm_id.is_none() && r.city_id.is_some() && city_id == r.city_id.as_deref(),
    }
}

/// The carriage a resident drives, by a drive or haul order (`drivenCarriageId`).
pub(super) fn driven_carriage_id(r: &csp_shared::world::Resident) -> Option<&str> {
    match &r.order {
        Some(ResidentOrder::Drive(o)) => Some(&o.carriage_id),
        Some(ResidentOrder::Haul(o)) => Some(&o.carriage_id),
        _ => None,
    }
}

/// The NPC cities' ids: cities of no realm.
pub(super) fn npc_cities(world: &WorldState) -> HashSet<&str> {
    world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.as_str()).collect()
}

/// What a check finds in a tick's ledger: nothing in one nothing wrote to yet.
pub(super) fn empty<T>(ledger: Option<&T>, check: fn(&T) -> Out) -> Out {
    ledger.map(check).unwrap_or_default()
}
