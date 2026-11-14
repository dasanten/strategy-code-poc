//! Leader queries of `packages/shared/src/leader.ts` (`CONTEXT.md`: Leader, Leader handover).

use csp_shared::world::{Resident, WorldState};

use super::alliance::{contract_of, handed_over_to};
use super::city::in_city_area;
use super::residents::can_work;

/// Whom a resident serves besides their own realm (`servesOthers`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServesOthers {
    /// A mercenary contract in force rents them out.
    Contract,
    /// They were handed over to an alliance army.
    AllianceArmy,
}

/// Whom a resident serves besides their own realm (`servesOthers`, `CONTEXT.md`: Leader, Leader
/// handover): `None` when they serve no one else.
pub fn serves_others(world: &WorldState, resident_id: &str) -> Option<ServesOthers> {
    if handed_over_to(world, resident_id).is_some() {
        return Some(ServesOthers::AllianceArmy);
    }
    contract_of(world, resident_id).map(|_| ServesOthers::Contract)
}

/// Why the realm's Leader `leader` can't hand the realm over to `target` now (`handOverProblem`,
/// `CONTEXT.md`: Leader handover), or `None` when they can: the target is a living adult of the
/// same realm, not the Leader already, serving no one else, and both stand in the area of the same
/// city of the realm. `size` is the map's.
pub fn hand_over_problem(
    world: &WorldState,
    realm: (&str, &str),
    leader: Option<&Resident>,
    target: Option<&Resident>,
    size: i32,
) -> Option<String> {
    let (realm_id, leader_id) = realm;
    let leader = match leader {
        Some(l) if l.id == leader_id && l.owner.as_deref() == Some(realm_id) => l,
        _ => return Some("only your Leader can hand over the realm".into()),
    };
    let target = match target {
        Some(t) if t.owner.as_deref() == Some(realm_id) && t.health > 0.0 => t,
        _ => return Some("not one of your residents".into()),
    };
    let name = &target.name;
    if target.id == leader.id {
        return Some(format!("{name} is your Leader already"));
    }
    if !can_work(target.born_at, world.tick as f64) {
        return Some(format!("{name} is a child"));
    }
    match serves_others(world, &target.id) {
        Some(ServesOthers::Contract) => return Some(format!("{name} is in a mercenary contract")),
        Some(ServesOthers::AllianceArmy) => return Some(format!("{name} is in the alliance army")),
        None => {}
    }
    // An offer could start once they lead, and a Leader is never hired out.
    if world.contracts.iter().any(|c| c.resident_ids.contains(&target.id)) {
        return Some(format!("{name} is named in a mercenary contract offer"));
    }
    let at = |r: &Resident| (r.x as i32, r.y as i32);
    let shared = world.cities.iter().any(|c| {
        c.realm_id.as_deref() == Some(realm_id)
            && in_city_area(world, &c.id, at(leader).0, at(leader).1, size)
            && in_city_area(world, &c.id, at(target).0, at(target).1, size)
    });
    if !shared {
        return Some(format!("{name} must stand in the same city as your Leader"));
    }
    None
}

/// Why `target` can't be named the realm's heir (`CONTEXT.md`: Heir), or `None` when they can:
/// the residents a Leader handover allows, a living adult of the realm who isn't its Leader and
/// serves no one else, who also lives in a city of the realm. Unlike a handover, they need not
/// stand anywhere in particular. `realm` is the realm's id and its Leader's.
pub fn heir_problem(
    world: &WorldState,
    realm: (&str, &str),
    target: Option<&Resident>,
) -> Option<String> {
    let (realm_id, leader_id) = realm;
    let target = match target {
        Some(t) if t.owner.as_deref() == Some(realm_id) && t.health > 0.0 => t,
        _ => return Some("not one of your residents".into()),
    };
    let name = &target.name;
    if target.id == leader_id {
        return Some(format!("{name} is your Leader"));
    }
    if !can_work(target.born_at, world.tick as f64) {
        return Some(format!("{name} is a child"));
    }
    match serves_others(world, &target.id) {
        Some(ServesOthers::Contract) => return Some(format!("{name} is in a mercenary contract")),
        Some(ServesOthers::AllianceArmy) => return Some(format!("{name} is in the alliance army")),
        None => {}
    }
    if world.contracts.iter().any(|c| c.resident_ids.contains(&target.id)) {
        return Some(format!("{name} is named in a mercenary contract offer"));
    }
    if !lives_in_realm(world, realm_id, target) {
        return Some(format!("{name} lives in no city of your realm"));
    }
    None
}

/// Whether a resident lives in a city of the realm.
pub fn lives_in_realm(world: &WorldState, realm_id: &str, r: &Resident) -> bool {
    r.city_id.as_deref().is_some_and(|id| {
        world.cities.iter().any(|c| c.id == id && c.realm_id.as_deref() == Some(realm_id))
    })
}
