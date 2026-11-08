//! Who may order whom (`commands`, `commandsCarriage`, `stealsCarriage` of
//! `packages/shared/src/alliance.ts`), on top of `alliance.rs`'s `commander_of`.

use csp_shared::world::{Carriage, Resident, WorldState};

use super::alliance::{carriage_commander_of, commander_of};

/// The realm whose orders the resident takes (`commanderOf`), from the resident itself.
pub fn commander_of_resident(world: &WorldState, r: &Resident) -> Option<String> {
    commander_of(world, &r.id, r.owner.as_deref())
}

/// Whether the realm's Player may give the resident orders (`commands`, in `order_sender.rs`).
pub use crate::order_sender::commands;

/// Whether the realm's Player may give orders with the carriage (`commandsCarriage`).
pub fn commands_carriage(world: &WorldState, realm_id: &str, k: Option<&Carriage>) -> bool {
    k.is_some_and(|k| carriage_commander_of(world, k).as_deref() == Some(realm_id))
}

/// Whether the realm driving the carriage off would steal it (`stealsCarriage`): another
/// Organization's, not one of the alliance army the realm commands.
pub fn steals_carriage(world: &WorldState, realm_id: &str, k: &Carriage) -> bool {
    k.realm_id.as_deref() != Some(realm_id)
        && carriage_commander_of(world, k).as_deref() != Some(realm_id)
}
