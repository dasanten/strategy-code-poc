//! Trade Organization queries of `packages/shared/src/trade-org.ts` and `tradeOrgRefuses` of
//! `standing.ts` (`CONTEXT.md`: Trade Organization, Trade Org reaction).

use csp_shared::balance::TRADE_ORG_REFUSES_TRADE_BELOW;
use std::collections::{HashMap, HashSet};

use csp_shared::balance::{TRADE_ORG_ARMY, TRADE_ORG_HQ};
use csp_shared::footprint::middle_of;
use csp_shared::terrain::wrap_delta;
use csp_shared::world::{Building, City, Resident, TradeOrgCity, WorldState};

use super::residents::is_armed;

use super::standing::{standing_of, standing_organization, TRADE_ORG};
use crate::directive::directive_against;

/// Why nothing goes by caravan once the HQ is gone (`NO_CARAVANS`).
pub const NO_CARAVANS: &str = "no caravans run since the Trade Org HQ fell";

/// The Trade Org HQ, if the world has one (`tradeOrgHq`).
pub fn trade_org_hq(world: &WorldState) -> Option<&City> {
    world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq))
}

/// Whether the resident is one of the HQ's own residents (`ofTradeOrgHq`).
pub fn of_trade_org_hq(world: &WorldState, r: &Resident) -> bool {
    r.owner.is_none()
        && r.city_id.is_some()
        && trade_org_hq(world).is_some_and(|hq| r.city_id.as_deref() == Some(hq.id.as_str()))
}

/// Whether the Trade Organization refuses to trade with an Organization (`tradeOrgRefuses`): it
/// holds it below `TRADE_ORG_REFUSES_TRADE_BELOW`, or a directive has it punish it.
pub fn trade_org_refuses(world: &WorldState, org: &str) -> bool {
    standing_of(world, TRADE_ORG, org) < TRADE_ORG_REFUSES_TRADE_BELOW
        || (standing_organization(world, org) != TRADE_ORG
            && directive_against(world, org).is_some())
}

/// The side a resident is on in a mercenary contract (`contractSide`): their realm, `TRADE_ORG`
/// for one of the Trade Organization's cities, their NPC city itself, `None` for anyone else.
pub fn contract_side(world: &WorldState, r: &Resident) -> Option<String> {
    if r.owner.is_some() {
        return r.owner.clone();
    }
    let city = world.cities.iter().find(|c| r.city_id.as_deref() == Some(c.id.as_str()))?;
    if city.trade_org.is_some() {
        return Some(TRADE_ORG.to_string());
    }
    city.realm_id.is_none().then(|| city.id.clone())
}

/// Whether a tile is on or inside the HQ's inner ring (`inInnerRing`), on a map of `size` tiles.
pub fn in_inner_ring(world: &WorldState, at: (f64, f64), size: i32) -> bool {
    let hall = trade_org_hq(world).and_then(|hq| super::city::town_hall_of(world, hq));
    hall.is_some_and(|h| in_inner_ring_around(h, at, size))
}

/// `in_inner_ring` for the HQ whose town hall is `hall` (`inInnerRingAround`).
pub fn in_inner_ring_around(hall: &Building, at: (f64, f64), size: i32) -> bool {
    let (cx, cy) = middle_of(super::names::placed(hall), size);
    let dx = wrap_delta(cx, at.0 as i32, size) as f64;
    let dy = wrap_delta(cy, at.1 as i32, size) as f64;
    dx.hypot(dy) <= TRADE_ORG_HQ.inner_radius + 0.5
}

/// The armed residents of the strongest Organization (`strongestArmed`): an alliance's members
/// counted together, a realm in none on its own; residents the Trade Organization hired don't
/// count.
pub fn strongest_armed(world: &WorldState) -> f64 {
    let hired: HashSet<&str> = world
        .contracts
        .iter()
        .filter(|c| c.hirer_id == TRADE_ORG)
        .flat_map(|c| c.resident_ids.iter().map(String::as_str))
        .collect();
    let mut side_of: HashMap<&str, &str> = HashMap::new();
    for a in &world.alliances {
        for m in &a.members {
            side_of.insert(&m.realm_id, &a.id);
        }
    }
    let mut armed: HashMap<&str, f64> = HashMap::new();
    for r in &world.residents {
        let Some(owner) = r.owner.as_deref() else { continue };
        if r.health <= 0.0 || !is_armed(&r.carried) || hired.contains(r.id.as_str()) {
            continue;
        }
        *armed.entry(side_of.get(owner).copied().unwrap_or(owner)).or_insert(0.0) += 1.0;
    }
    armed.values().copied().fold(0.0, f64::max)
}

/// How many soldiers the HQ wants (`tradeOrgArmyWanted`).
pub fn trade_org_army_wanted(world: &WorldState) -> f64 {
    TRADE_ORG_ARMY.size.max((TRADE_ORG_ARMY.strongest_multiple * strongest_armed(world)).ceil())
}

/// Everyone in the Trade Org army out to punish someone and everyone driving a supply wagon for
/// it, by id (`punishers`).
pub fn punishers(world: &WorldState) -> HashSet<String> {
    let mut ids: HashSet<String> = world
        .punishments
        .iter()
        .flat_map(|p| p.members.iter().map(|m| m.resident_id.clone()))
        .collect();
    ids.extend(world.supply_wagons.iter().filter_map(|w| w.driver_id.clone()));
    ids
}
