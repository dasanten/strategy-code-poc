//! Standing (`CONTEXT.md`: Standing, Self-managed city), ported from `apps/server/src/standing.ts`:
//! how one Organization regards another. Known crimes lower the victim's standing toward the
//! culprit's Organization (`step_crimes`); trades and paid contract weeks raise it both ways; every
//! day it drifts back toward neutral. A self-managed city remembers its former Player.

use std::collections::HashSet;

use csp_shared::balance::{STANDING_DRIFT_PER_DAY, STANDING_RANGE};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{FormerPlayer, Realm, Standing, StandingMove, WorldState};

use crate::queries::js_round;
use crate::queries::standing::{
    former_player_standing, organization_label, standing_in_range, standing_of,
    standing_organization, trade_coins_per_point, TRADE_ORG,
};
use crate::sight::InvariantViolation;

/// Changes how `of` regards `toward` by `delta`, kept within its range (`changeStanding`).
/// Nothing happens between an Organization and itself. A standing back at neutral is dropped.
pub fn change_standing(world: &mut WorldState, of: &str, toward: &str, delta: f64) {
    let a = standing_organization(world, of).to_string();
    let b = standing_organization(world, toward).to_string();
    if a == b || delta == 0.0 {
        return;
    }
    let i = world.standings.iter().position(|x| x.of == a && x.toward == b);
    let old = i.map_or(0.0, |i| world.standings[i].value);
    let value = (-STANDING_RANGE).max(STANDING_RANGE.min(old + delta));
    match i {
        Some(i) => world.standings[i].value = value,
        None => world.standings.push(Standing { of: a, toward: b, value }),
    }
    if value == 0.0 {
        world.standings.retain(|x| x.value != 0.0);
    }
}

/// Raises standing by `delta` both ways between two Organizations (`raiseStandingBothWays`).
pub fn raise_standing_both_ways(world: &mut WorldState, a: &str, b: &str, delta: f64) {
    change_standing(world, a, b, delta);
    change_standing(world, b, a, delta);
}

/// A trade of `coins` between `realm` and `org` raises standing both ways (`raiseStandingByTrade`).
/// Returns how far it moved `org`'s regard for the realm, for the realm's log; nothing when it is
/// already as high as it goes.
pub fn raise_standing_by_trade(
    world: &mut WorldState,
    realm: &str,
    org: &str,
    coins: f64,
) -> Option<StandingMove> {
    let before = standing_of(world, org, realm);
    let per_point = trade_coins_per_point(world, realm, org);
    raise_standing_both_ways(world, realm, org, coins / per_point);
    let by = js_round((standing_of(world, org, realm) - before) * 100.0) / 100.0;
    if by <= 0.0 {
        return None;
    }
    Some(StandingMove {
        org: standing_organization(world, org).to_string(),
        name: organization_label(world, org),
        by,
    })
}

/// Whether an Organization still exists (`organizationExists`): a realm, a city of no realm, or
/// the Trade Organization while it has a city.
pub fn organization_exists(world: &WorldState, org: &str) -> bool {
    if org == TRADE_ORG {
        return world.cities.iter().any(|c| c.trade_org.is_some());
    }
    world.realms.iter().any(|r| r.id == org)
        || world.cities.iter().any(|c| c.id == org && c.realm_id.is_none())
}

/// Standing drifts back toward neutral by `STANDING_DRIFT_PER_DAY` each game day, a little each
/// tick, and is dropped once neutral (`stepStanding`). Standing of or toward an Organization
/// that is gone is dropped too.
pub fn step_standing(world: &mut WorldState) {
    forget_former_players(world);
    if world.standings.is_empty() {
        return;
    }
    let drift = STANDING_DRIFT_PER_DAY / TICKS_PER_GAME_DAY;
    let mut standings = std::mem::take(&mut world.standings);
    standings.retain_mut(|s| {
        if !organization_exists(world, &s.of) || !organization_exists(world, &s.toward) {
            return false;
        }
        s.value = if s.value > 0.0 { 0f64.max(s.value - drift) } else { 0f64.min(s.value + drift) };
        s.value != 0.0
    });
    world.standings = standings;
}

/// Invariant (`standingsSound`): every value within its range and not neutral, between two
/// different Organizations that exist, the Trade Organization named as one, and at most one
/// standing for each pair.
pub fn standings_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "standings-sound";
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for s in &world.standings {
        let ids = vec![s.of.clone(), s.toward.clone()];
        let mut report = |message: String| {
            out.push(InvariantViolation {
                invariant: name.into(),
                message,
                entity_ids: ids.clone(),
            })
        };
        let pair = format!("{} → {}", s.of, s.toward);
        if !standing_in_range(s.value) {
            report(format!("standing {pair} is {}, out of its range", s.value));
        }
        if s.value == 0.0 {
            report(format!("standing {pair} is neutral but kept"));
        }
        if s.of == s.toward {
            report(format!("{} has a standing toward itself", s.of));
        }
        for org in [&s.of, &s.toward] {
            if !organization_exists(world, org) {
                report(format!("standing {pair} names {org}, which is gone"));
            }
            if standing_organization(world, org) != org {
                report(format!(
                    "standing {pair} names a Trade Org city instead of the Trade Organization"
                ));
            }
        }
        if !seen.insert(pair.clone()) {
            report(format!("standing {pair} is kept twice"));
        }
    }
    out
}

/// The cities of a realm whose Leader just died remember its Player from now on
/// (`rememberFormerPlayer`). `cities` are city ids.
pub fn remember_former_player(world: &mut WorldState, cities: &[String], user_id: u64) {
    let tick = world.tick as f64;
    for c in world.cities.iter_mut().filter(|c| cities.contains(&c.id)) {
        c.former_player = Some(FormerPlayer { user_id, tick });
    }
}

/// A Player's new realm is founded (`welcomeFormerPlayer`): every self-managed city that
/// remembers them holds the realm in the good standing left of its memory.
pub fn welcome_former_player(world: &mut WorldState, realm: &Realm) {
    let tick = world.tick as f64;
    for i in 0..world.cities.len() {
        let c = &world.cities[i];
        if c.former_player.as_ref().map(|f| f.user_id) != Some(realm.user_id) {
            continue;
        }
        if c.realm_id.is_none() {
            let (id, value) = (c.id.clone(), former_player_standing(c, tick));
            change_standing(world, &id, &realm.id, value);
        }
        world.cities[i].former_player = None;
    }
}

/// A city forgets its former Player once the memory has faded, or once it joined a realm
/// (`forgetFormerPlayers`).
pub fn forget_former_players(world: &mut WorldState) {
    let tick = world.tick as f64;
    for c in &mut world.cities {
        if c.former_player.is_some()
            && (c.realm_id.is_some() || former_player_standing(c, tick) == 0.0)
        {
            c.former_player = None;
        }
    }
}

/// Invariant (`formerPlayersSound`): former Players are remembered only by cities of no realm
/// and not of the Trade Organization, from a tick already passed, and only while the Player has
/// no realm.
pub fn former_players_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "former-players-sound";
    let mut out = Vec::new();
    for c in &world.cities {
        let Some(f) = &c.former_player else { continue };
        let mut report = |message: String| {
            out.push(InvariantViolation {
                invariant: name.into(),
                message,
                entity_ids: vec![c.id.clone()],
            })
        };
        if c.realm_id.is_some() {
            report(format!("{} belongs to a realm but remembers a former Player", c.id));
        }
        if c.trade_org.is_some() {
            report(format!("Trade Org city {} remembers a former Player", c.id));
        }
        if f.tick > world.tick as f64 {
            report(format!("{} remembers a Leader death still to come", c.id));
        }
        if world.realms.iter().any(|r| r.user_id == f.user_id) {
            report(format!("{} remembers Player {}, who has a realm again", c.id, f.user_id));
        }
    }
    out
}

#[cfg(test)]
mod tests;
