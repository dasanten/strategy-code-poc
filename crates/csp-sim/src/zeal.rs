//! Zeal (`CONTEXT.md`: Zeal, ADR 0042): a pool every Player holds, apart from the world, counted
//! in game hours of rallying. It fills steadily in real time up to a cap, whether the Player is
//! online or not, and a new Player starts with it full. It is kept by account id
//! (`WorldState.zeal`), not by realm, so a Leader handover or death keeps it; NPC cities and the
//! Trade Organization have none.
//!
//! Only pools that are not full have an entry: a Player with none has a full pool. Scripts see
//! nothing of it (ADR 0042): no script view or game API call reads it.

use csp_shared::balance::{ZEAL_CAP_HOURS, ZEAL_PER_TICK};
use std::collections::BTreeSet;

use csp_shared::world::{ResidentOrder, WorldState};

use crate::sight::InvariantViolation;

/// The Zeal the Player with account `user_id` holds, in game hours of rallying: full while
/// they have no entry.
pub fn zeal_of(world: &WorldState, user_id: u64) -> f64 {
    world.zeal.get(&user_id).copied().unwrap_or(ZEAL_CAP_HOURS)
}

/// Sets the Player's Zeal to `hours`, kept between empty and the cap; a full pool keeps no entry.
pub fn set_zeal(world: &mut WorldState, user_id: u64, hours: f64) {
    let hours = if hours.is_nan() { 0.0 } else { hours.clamp(0.0, ZEAL_CAP_HOURS) };
    if hours >= ZEAL_CAP_HOURS {
        world.zeal.remove(&user_id);
    } else {
        world.zeal.insert(user_id, hours);
    }
}

/// One tick of filling: every pool that is not full gains `ZEAL_PER_TICK`, up to the cap, where it
/// stops (`CONTEXT.md`: Zeal). Not while the Player's Leader rallies the crew: the pool pauses for
/// as long as the order runs, whether or not anyone works and it drains, and fills again from the
/// moment it ends (Daniel, 2026-11-20).
pub fn step_zeal(world: &mut WorldState) {
    let rallying = rallying_players(world);
    world.zeal.retain(|user_id, hours| {
        if !rallying.contains(user_id) {
            *hours = (*hours + ZEAL_PER_TICK).min(ZEAL_CAP_HOURS);
        }
        *hours < ZEAL_CAP_HOURS
    });
}

/// The accounts whose Leader holds the rally order now (`CONTEXT.md`: Rallying the crew).
pub fn rallying_players(world: &WorldState) -> BTreeSet<u64> {
    world
        .realms
        .iter()
        .filter(|realm| {
            world.residents.iter().any(|r| {
                r.id == realm.leader_id && matches!(r.order, Some(ResidentOrder::Rally(_)))
            })
        })
        .map(|realm| realm.user_id)
        .collect()
}

/// Invariant (ADR 0004): a Player's Zeal is never below zero or above the cap.
pub fn zeal_within_cap(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .zeal
        .iter()
        .filter(|(_, &hours)| !(0.0..=ZEAL_CAP_HOURS).contains(&hours))
        .map(|(user_id, hours)| InvariantViolation {
            invariant: "zeal-within-cap".into(),
            message: format!(
                "Player {user_id} holds {hours} hours of Zeal, outside 0 to {ZEAL_CAP_HOURS}"
            ),
            entity_ids: Vec::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests;
