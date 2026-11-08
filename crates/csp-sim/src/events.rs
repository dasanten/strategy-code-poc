//! The Players' logs (`apps/server/src/events.ts`, `CONTEXT.md`: Events): what happened in a
//! realm, kept in the world, the latest `REALM_LOG_LENGTH` of each Player's.

use csp_shared::balance::REALM_LOG_LENGTH;
use csp_shared::world::{RealmEvent, RealmEventWhat, WorldState};

/// Writes down something that happened in a realm, in its Player's log (`recordEvent`); an event
/// for no realm (a resident or city that belongs to nobody) is not kept.
pub fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let user = realm_id.and_then(|id| world.realms.iter().find(|r| r.id == id)).map(|r| r.user_id);
    if let Some(user_id) = user {
        record_player_event(world, user_id, what);
    }
}

/// Writes down something for a Player's log, whether they have a realm now or not
/// (`recordPlayerEvent`). Each Player keeps their latest `REALM_LOG_LENGTH` events; the oldest go
/// first.
pub fn record_player_event(world: &mut WorldState, user_id: u64, what: RealmEventWhat) {
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    let max = REALM_LOG_LENGTH as usize;
    if mine > max {
        let mut drop = mine - max;
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
    use crate::world::create_world;
    use csp_shared::terrain::TerrainMap;

    fn spoiled(units: f64) -> RealmEventWhat {
        serde_json::from_value(serde_json::json!({ "kind": "foodSpoiled", "units": units }))
            .unwrap()
    }

    fn units(e: &RealmEvent) -> f64 {
        serde_json::to_value(e).unwrap()["units"].as_f64().unwrap()
    }

    /// `events.test.ts`' "keeps each Player's own events, the latest REALM_LOG_LENGTH of them",
    /// on two bare realms instead of starting cities (T86.8); its invariant check is
    /// `realm_logs_in_order`'s test.
    #[test]
    fn keeps_each_players_own_events_the_latest_realm_log_length_of_them() {
        let mut world = create_world(&TerrainMap { size: 16, tiles: vec![0; 256] }, 1);
        for (id, user) in [("r1", 1), ("r2", 2)] {
            world.realms.push(
                serde_json::from_value(
                    serde_json::json!({ "id": id, "userId": user, "leaderId": "x" }),
                )
                .unwrap(),
            );
        }
        record_event(&mut world, Some("r2"), spoiled(1.0));
        let max = REALM_LOG_LENGTH as usize;
        for i in 0..max + 5 {
            record_event(&mut world, Some("r1"), spoiled(i as f64));
        }
        let log: Vec<RealmEvent> = events_for(&world, 1, 0).into_iter().cloned().collect();
        assert_eq!(log.len(), max);
        assert_eq!(units(&log[0]), 5.0);
        let theirs = events_for(&world, 2, 0);
        assert_eq!(theirs.len(), 1);
        assert_eq!(units(theirs[0]), 1.0);
        let after: Vec<RealmEvent> =
            events_for(&world, 1, log[1].seq).into_iter().cloned().collect();
        assert_eq!(after, log[2..]);
        // Nobody's events are kept for nobody.
        record_event(&mut world, None, spoiled(9.0));
        assert_eq!(world.events.len(), max + 1);
    }
}
