//! The Players' realm logs (`apps/server/src/events.ts`): writing down what happened in a realm.
//!
//! Ported with the residents (T86.3), who write the most of it; T86.13 adds the rest of
//! `events.ts` and the invariants over it here.

use csp_shared::balance::REALM_LOG_LENGTH;
use csp_shared::world::{RealmEvent, RealmEventWhat, WorldState};

/// Writes down something that happened in a realm, in its Player's log (`recordEvent`); an event
/// for no realm (a resident or city that belongs to nobody) is not kept. Each Player keeps their
/// latest `REALM_LOG_LENGTH` events; the oldest go first.
pub fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let Some(realm_id) = realm_id else { return };
    let user_id = world.realms.iter().find(|x| x.id == realm_id).map(|r| r.user_id);
    if let Some(user_id) = user_id {
        record_player_event(world, user_id, what);
    }
}

/// Writes down something for a Player's log, whether they have a realm now or not
/// (`recordPlayerEvent`).
pub fn record_player_event(world: &mut WorldState, user_id: u64, what: RealmEventWhat) {
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    let keep = REALM_LOG_LENGTH as usize;
    if mine > keep {
        let mut drop = mine - keep;
        world.events.retain(|e| {
            if drop > 0 && e.user_id == user_id {
                drop -= 1;
                return false;
            }
            true
        });
    }
}

/// A Player's events numbered after `after`, oldest first: the whole log when `after` is 0
/// (`eventsFor`).
pub fn events_for(world: &WorldState, user_id: u64, after: u64) -> Vec<&RealmEvent> {
    world.events.iter().filter(|e| e.user_id == user_id && e.seq > after).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::world::Realm;

    #[test]
    fn keeps_each_players_latest_events_and_none_for_no_realm() {
        let mut world = crate::world::create_world(&crate::test_support::plains(16), 1);
        world.realms.push(Realm {
            id: "realm1".into(),
            user_id: 7,
            leader_id: "r1".into(),
            name: None,
            demands_sent_at: None,
            heir_id: None,
        });
        let what = || RealmEventWhat::FoodSpoiled { units: 1.0 };
        record_event(&mut world, None, what());
        record_event(&mut world, Some("nobody"), what());
        assert!(world.events.is_empty());
        record_player_event(&mut world, 8, what());
        for _ in 0..(REALM_LOG_LENGTH as usize + 5) {
            record_event(&mut world, Some("realm1"), what());
        }
        assert_eq!(events_for(&world, 7, 0).len(), REALM_LOG_LENGTH as usize);
        assert_eq!(events_for(&world, 8, 0).len(), 1);
        // The oldest went first: the first kept is the sixth written for the realm.
        assert_eq!(events_for(&world, 7, 0)[0].seq, world.next_id - REALM_LOG_LENGTH as u64);
    }
}
