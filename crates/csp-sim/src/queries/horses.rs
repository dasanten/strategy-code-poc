//! Horse queries of `packages/shared/src/horses.ts`.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::world::{Building, Horse, Resident, WorldState};

use super::names::placed;

/// Whose horse it is (`HorseOwner`): a realm's, or an NPC city's (of no realm).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HorseOwner<'a> {
    Realm(&'a str),
    City(&'a str),
}

/// Whether the horse is the owner's (`ownsHorse`).
pub fn owns_horse(owner: HorseOwner, h: &Horse) -> bool {
    match owner {
        HorseOwner::Realm(realm) => h.realm_id.as_deref() == Some(realm),
        HorseOwner::City(city) => h.realm_id.is_none() && h.city_id.as_deref() == Some(city),
    }
}

/// The horses standing in a stable, hitched or not (`horsesIn`).
pub fn horses_in<'w>(horses: &'w [Horse], stable: &Building) -> Vec<&'w Horse> {
    horses.iter().filter(|h| is_at((h.x as i32, h.y as i32), placed(stable), MAP_SIZE)).collect()
}

/// Who rides the horse, if anyone does (`riderOf`).
pub fn rider_of<'w>(world: &'w WorldState, horse_id: &str) -> Option<&'w Resident> {
    world.residents.iter().find(|r| r.riding.as_deref() == Some(horse_id))
}
