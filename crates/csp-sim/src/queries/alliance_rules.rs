//! The rest of `packages/shared/src/alliance.ts` (`CONTEXT.md`: Alliance, NPC city in an
//! alliance, Alliance army) beside T85.5's `alliance.rs`: NPC cities as members, the alliance army's
//! parts, the realms that stand together. `diplomacyFor` builds the client's view out of six other
//! modules' views and goes with the sync (T87.6).

use csp_shared::balance::{
    CRIME_MEMORY_DAYS, NPC_ALLIANCE_JOIN_STANDING, NPC_ALLIANCE_LEAVE_STANDING,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Alliance, AllianceArmyPart, WorldState};

use super::standing::standing_of;

/// The longest an alliance's name may be (`ALLIANCE_NAME_MAX_LENGTH`).
pub const ALLIANCE_NAME_MAX_LENGTH: usize = 30;

/// Whether `id` is an NPC city that may be an alliance member (`isAllianceCity`): of no realm and
/// not the Trade Organization's.
pub fn is_alliance_city(world: &WorldState, id: &str) -> bool {
    world.cities.iter().any(|c| c.id == id && c.realm_id.is_none() && c.trade_org.is_none())
}

/// Whether the NPC city knows of a recent crime by `org` against it (`knowsRecentCrime`).
pub fn knows_recent_crime(world: &WorldState, city_id: &str, org: &str) -> bool {
    let since = world.tick as f64 - CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY;
    world.crimes.iter().any(|c| {
        c.victim_org == city_id
            && c.culprit.org == org
            && c.known_by.iter().any(|k| k == city_id)
            && c.tick > since
    })
}

/// Whether the NPC city joins the alliance when invited (`npcCityAccepts`): it holds every
/// member in high standing and knows of no recent crime by any.
pub fn npc_city_accepts(world: &WorldState, city_id: &str, alliance: &Alliance) -> bool {
    alliance.members.iter().all(|m| {
        standing_of(world, city_id, &m.realm_id) >= NPC_ALLIANCE_JOIN_STANDING
            && !knows_recent_crime(world, city_id, &m.realm_id)
    })
}

/// Whether the NPC city member wants out (`npcCityWantsOut`): its standing toward another member
/// fell too low.
pub fn npc_city_wants_out(world: &WorldState, city_id: &str, alliance: &Alliance) -> bool {
    alliance.members.iter().any(|m| {
        m.realm_id != city_id
            && standing_of(world, city_id, &m.realm_id) < NPC_ALLIANCE_LEAVE_STANDING
    })
}

/// The alliance army part `id` is, if it was handed over (`armyPartOf`).
pub fn army_part_of<'w>(world: &'w WorldState, id: &str) -> Option<&'w AllianceArmyPart> {
    world.alliances.iter().find_map(|a| a.army.iter().find(|p| p.id == id))
}

/// The realms that stand together, for weighing strength (`realmsStandingTogether`): each
/// alliance's members together, and every realm in no alliance on its own.
pub fn realms_standing_together(world: &WorldState) -> Vec<Vec<String>> {
    let mut groups: Vec<Vec<String>> = world
        .alliances
        .iter()
        .map(|a| a.members.iter().map(|m| m.realm_id.clone()).collect())
        .collect();
    let allied: std::collections::HashSet<String> = groups.iter().flatten().cloned().collect();
    for r in &world.realms {
        if !allied.contains(&r.id) {
            groups.push(vec![r.id.clone()]);
        }
    }
    groups
}
