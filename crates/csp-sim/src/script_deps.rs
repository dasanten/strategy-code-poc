//! Helpers the script bindings need from rule tickets not merged yet, each a minimal port of the
//! TypeScript marked with the ticket that owns it. Each is replaced by its owner's and deleted
//! once that ticket lands (T86.12's PR names them).

use csp_shared::world::{Building, Pile, Resident, Stock, WorldState};
use serde_json::{json, Value};

use crate::queries::standing::organization_label;

/// The goods of a storage that aren't set aside for its offers (`freeStock`).
pub fn free_stock(world: &WorldState, b: &Building) -> Stock {
    crate::queries::goods::free_stock(world, &b.id, b.stock.as_ref())
}

pub use crate::queries::goods::units_that_fit;
pub use crate::queries::warehouse_trade::debt_of;

/// The pile reached from a tile (`pileAt`, on the full map's size as the TypeScript's default).
pub fn pile_at(world: &WorldState, x: f64, y: f64, _size: i32) -> Option<&Pile> {
    crate::queries::goods::pile_at(world, x, y)
}

/// The realm a building is of (`buildingRealm`).
pub fn building_realm(world: &WorldState, b: &Building) -> Option<String> {
    crate::queries::city::building_realm(world, b).map(str::to_string)
}

/// The footprint tile with the fewest of a building's crew on it (`crewTile`).
pub fn crew_tile(
    world: &WorldState,
    b: &Building,
    me: &Resident,
    of_crew: &dyn Fn(&Resident) -> bool,
    size: i32,
) -> (i32, i32) {
    crate::queries::crew::crew_tile(world, b, (&me.id, me.x as i32, me.y as i32), of_crew, size)
}

/// The demands a realm sent or was sent, as its scripts see them (`demandsFor`, flattened as the
/// bindings give them: `fromId`, `from`, `toId`, `to`).
// TODO(T86.11): `demands::demands_for`.
pub fn demands_for(world: &WorldState, realm_id: &str) -> Vec<Value> {
    world
        .demands
        .iter()
        .filter(|d| d.from_id == realm_id || d.to_id == realm_id)
        .map(|d| {
            json!({
                "id": d.id,
                "terms": d.terms,
                "note": d.note,
                "sentAt": d.sent_at,
                "deadline": d.deadline,
                "fromId": d.from_id,
                "from": organization_label(world, &d.from_id),
                "toId": d.to_id,
                "to": organization_label(world, &d.to_id),
            })
        })
        .collect()
}

pub use crate::last_seen::last_seen_out_of_sight;
pub use crate::queries::breeding::{breeding_pair, kept_pair};
pub use crate::queries::city_area::occupation_ticks_left;
