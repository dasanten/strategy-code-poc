//! Guarding of `packages/shared/src/city.ts` (`CONTEXT.md`: Outpost storage, Stealing a carriage
//! or horse).

use csp_shared::footprint::near_footprint;
use csp_shared::world::{Building, BuildingKind, Resident, WorldState};

use super::names::placed;
use super::residents::{is_armed, is_down};

/// Whether a building is an outpost storage (`isOutpostStorage`): a finished storage of no city.
pub fn is_outpost_storage(b: &Building) -> bool {
    b.kind == BuildingKind::Storage && b.site.is_none() && b.city_id.is_none()
}

/// Whether a place is guarded (`guardedBy`): of the armed residents who are up and `here`, one
/// `guards` it and none `breaks` the guard.
pub fn guarded_by<'r>(
    residents: impl IntoIterator<Item = &'r Resident>,
    here: impl Fn(&Resident) -> bool,
    guards: impl Fn(&Resident) -> bool,
    breaks: impl Fn(&Resident) -> bool,
) -> bool {
    let mut guarded = false;
    for r in residents {
        if r.health <= 0.0 || is_down(r.down_until) || !is_armed(&r.carried) || !here(r) {
            continue;
        }
        if breaks(r) {
            return false;
        }
        if guards(r) {
            guarded = true;
        }
    }
    guarded
}

/// Whether an outpost storage's stock is guarded (`outpostStorageGuarded`): an armed, living
/// resident of its realm stands on or next to it, and nobody else's armed resident does.
pub fn outpost_storage_guarded(world: &WorldState, b: &Building, size: i32) -> bool {
    let Some(realm) = b.realm_id.as_deref().filter(|r| !r.is_empty()) else {
        return false;
    };
    if !is_outpost_storage(b) {
        return false;
    }
    guarded_by(
        &world.residents,
        |r| near_footprint(placed(b), (r.x as i32, r.y as i32), 1, size),
        |r| r.owner.as_deref() == Some(realm),
        |r| r.owner.as_deref() != Some(realm),
    )
}
