//! Standing queries of `packages/shared/src/standing.ts` (`CONTEXT.md`: Standing).

use csp_shared::balance::{
    FORMER_PLAYER_STANDING, STANDING_DRIFT_PER_DAY, STANDING_NPC_TRADE_COINS_PER_POINT,
    STANDING_RANGE, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, WorldState};

use super::alliance::realm_name;

/// The Trade Organization's id as a side in standings, contracts and trades (`TRADE_ORG`).
pub const TRADE_ORG: &str = "trade-org";

/// What Players call the Trade Organization where they would see a realm's name
/// (`TRADE_ORG_NAME`).
pub const TRADE_ORG_NAME: &str = "the Trade Organization";

/// Coins of trade between two Organizations that raise standing by one point
/// (`tradeCoinsPerPoint`): an NPC city has its own number, whichever side of the trade it is on.
pub fn trade_coins_per_point(world: &WorldState, a: &str, b: &str) -> f64 {
    let npc = world
        .cities
        .iter()
        .any(|c| (c.id == a || c.id == b) && c.realm_id.is_none() && c.trade_org.is_none());
    if npc {
        STANDING_NPC_TRADE_COINS_PER_POINT
    } else {
        STANDING_TRADE_COINS_PER_POINT
    }
}

/// Whether a standing value is within its range (`standingInRange`).
pub fn standing_in_range(value: f64) -> bool {
    value.is_finite() && (-STANDING_RANGE..=STANDING_RANGE).contains(&value)
}

/// The standing a self-managed city holds its former Player in at `tick`
/// (`formerPlayerStanding`): `FORMER_PLAYER_STANDING` when their Leader died, fading like any
/// standing since; 0 once faded, or for a city that remembers no former Player.
pub fn former_player_standing(city: &City, tick: f64) -> f64 {
    let Some(f) = &city.former_player else { return 0.0 };
    let days = (tick - f.tick) / TICKS_PER_GAME_DAY;
    0f64.max(FORMER_PLAYER_STANDING - STANDING_DRIFT_PER_DAY * days)
}

/// How Players call an Organization (`organizationLabel`): a realm by its realm name, a city by
/// its own.
pub fn organization_label(world: &WorldState, org: &str) -> String {
    if org == TRADE_ORG {
        return TRADE_ORG_NAME.to_string();
    }
    match world.cities.iter().find(|c| c.id == org) {
        Some(c) => c.name.clone(),
        None => realm_name(world, org),
    }
}

/// The Organization an id names for standing (`standingOrganization`): a Trade Org city is the
/// Trade Organization, anything else itself.
pub fn standing_organization<'a>(world: &WorldState, org: &'a str) -> &'a str {
    if world.cities.iter().any(|c| c.id == org && c.trade_org.is_some()) {
        TRADE_ORG
    } else {
        org
    }
}

/// How `of` regards `toward` (`standingOf`); 0 is neutral, also for an Organization itself.
pub fn standing_of(world: &WorldState, of: &str, toward: &str) -> f64 {
    let a = standing_organization(world, of);
    let b = standing_organization(world, toward);
    world.standings.iter().find(|s| s.of == a && s.toward == b).map_or(0.0, |s| s.value)
}
