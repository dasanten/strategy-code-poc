//! What the checks of several domains share.

use std::collections::HashSet;

use csp_shared::footprint::is_at;
use csp_shared::world::{ResidentOrder, WorldState};

use super::InvariantViolation;
use crate::order_meta::running_meta;
use crate::queries::names::placed;

/// What a check found.
pub type Out = Vec<InvariantViolation>;

/// An order's kind as the TypeScript names it (`order.kind`).
pub fn kind_of(o: &ResidentOrder) -> &'static str {
    running_meta(o).kind
}

/// At a building, on the whole map (`isAt(r, b)` with its default size).
pub fn at_building(x: f64, y: f64, b: &csp_shared::world::Building) -> bool {
    is_at((x as i32, y as i32), placed(b), csp_shared::balance::MAP_SIZE)
}

/// Whether a horse or carriage is of a resident's realm, or of their NPC city
/// (`horseOfResident`, `carriageOfResident`).
pub fn of_resident(
    realm_id: Option<&str>,
    city_id: Option<&str>,
    r: &csp_shared::world::Resident,
) -> bool {
    match &r.owner {
        Some(owner) => realm_id == Some(owner.as_str()),
        None => realm_id.is_none() && r.city_id.is_some() && city_id == r.city_id.as_deref(),
    }
}

pub use crate::queries::carriages::driven_carriage_id;

/// The NPC cities' ids: cities of no realm.
pub fn npc_cities(world: &WorldState) -> HashSet<&str> {
    world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.as_str()).collect()
}

/// What a check finds in a tick's ledger: nothing in one nothing wrote to yet.
pub fn empty<T>(ledger: Option<&T>, check: fn(&T) -> Out) -> Out {
    ledger.map(check).unwrap_or_default()
}
