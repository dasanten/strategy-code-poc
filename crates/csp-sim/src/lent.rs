//! Lent residents never turn on their own city (`CONTEXT.md`: Hiring from an NPC city; ADR
//! 0033). A resident an NPC city lends takes the hirer's orders, except against that city: an
//! order to attack its residents, walls or gates, to climb its walls or to tear down its buildings
//! is refused with [`WONT_TURN`], whichever way it reaches them (by hand, queue step, group,
//! script or army), since every one of them goes through the order kinds' `validate`. Struck by
//! someone of their own city, they still fight back. Whatever slips past (the city's side changing
//! under an order already held) ends before it acts, in [`drop_orders_against_lender`].

use csp_shared::world::{Resident, ResidentOrder, WorldState};

use crate::crimes::{building_organization, organization_of};
use crate::queries::contract::lending_city;
use crate::sight::InvariantViolation;

/// Why a lent resident refuses an order against the city that lent them.
pub const WONT_TURN: &str = "lent by that city, they won’t act against it";

/// The Organization `target_id` belongs to: the resident's, or the building's.
fn organization_of_target(world: &WorldState, target_id: &str) -> Option<String> {
    if let Some(r) = world.residents.iter().find(|x| x.id == target_id) {
        return organization_of(r).map(str::to_string);
    }
    let b = world.buildings.iter().find(|x| x.id == target_id)?;
    building_organization(world, b)
}

/// Whether `r` is lent by an NPC city and `target_id` (a resident or a building) is that city's.
pub fn against_lender(world: &WorldState, r: &Resident, target_id: &str) -> bool {
    let Some(city) = lending_city(world, &r.id) else { return false };
    organization_of_target(world, target_id).as_deref() == Some(city.id.as_str())
}

/// The reason `r` refuses an order on `target_id`, if it is their lending city's
/// ([`against_lender`]).
pub fn refusal(world: &WorldState, r: &Resident, target_id: &str) -> Option<&'static str> {
    against_lender(world, r, target_id).then_some(WONT_TURN)
}

/// What `r`'s order goes against, if it turns them on their lending city: an attack not fought
/// back at whoever struck them, a climb or a tear-down.
fn order_against_lender<'r>(world: &WorldState, r: &'r Resident) -> Option<&'r str> {
    let target = match r.order.as_ref()? {
        ResidentOrder::Attack(o) if o.defending != Some(true) => &o.target_id,
        ResidentOrder::Climb(o) => &o.wall_id,
        ResidentOrder::TearDown(o) => &o.building_id,
        _ => return None,
    };
    against_lender(world, r, target).then_some(target.as_str())
}

/// Ends every order a lent resident holds against the city that lent them, before anyone acts
/// on it this tick.
pub fn drop_orders_against_lender(world: &mut WorldState) {
    let turned: Vec<usize> = (0..world.residents.len())
        .filter(|&i| order_against_lender(world, &world.residents[i]).is_some())
        .collect();
    for i in turned {
        world.residents[i].order = None;
    }
}

/// Invariant `lent-never-turn` (ADR 0004): no lent resident holds an order against the NPC city
/// that lent them.
pub fn lent_never_turn(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter_map(|r| {
            let target = order_against_lender(world, r)?;
            Some(InvariantViolation {
                invariant: "lent-never-turn".into(),
                message: format!(
                    "{} holds an order against {target} of the city that lent them",
                    r.id
                ),
                entity_ids: vec![r.id.clone(), target.to_string()],
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
