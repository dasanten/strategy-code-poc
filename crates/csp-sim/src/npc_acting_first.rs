//! NPC cities acting first (`CONTEXT.md`: Acting first; Epic 98, T98.5): against an Organization
//! it feels threatened by, an NPC city seeks allies and hires mercenaries on its own.
//!
//! - **Allies:** at its first planning pass of each game day, a city whose threat from one
//!   Organization is at least `NPC_ACTING_FIRST.ally_threat` invites into its alliance the NPC
//!   cities in no alliance that it holds in high standing, that hold it in high standing and feel
//!   threatened by that Organization too, and the realms in no alliance it holds in high standing
//!   (never the Organization itself). With no alliance, it founds one first and leads it. It
//!   invites only into an alliance it leads.
//! - **Mercenaries:** at the same pass, a city whose threat from one Organization is at least
//!   `NPC_ACTING_FIRST.hire_threat`, with no contract of its own, asks the Trade Org army for up to
//!   `hire_soldiers` of its spare soldiers for `hire_days`, at the Trade Organization's price, paid
//!   into the Trade Org warehouse nearest it, as long as its storages hold the whole price; the
//!   Trade Organization answers as it does any hirer. The city pays each week in advance straight
//!   from its storages, like a transfer. Its mercenaries go after attackers in its City area and
//!   otherwise walk to its town hall and stand there.

use csp_shared::balance::{NPC_ACTING_FIRST, NPC_ALLIANCE_JOIN_STANDING, TRADE_ORG_ARMY};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    BuildingKind, City, ContractSide, Good, MercenaryContract, ResidentOrder, WorldState,
};

use crate::alliances::{invite, npc_found_alliance};
use crate::contracts::pay_into;
use crate::npc_behaviour::{npc_home, walk_to};
use crate::npc_defence::{attackers_of, go_after_nearest};
use crate::queries::alliance::alliance_of;
use crate::queries::alliance_rules::{is_alliance_city, knows_recent_crime};
use crate::queries::city::{for_sale, town_hall_of};
use crate::queries::city_area::{in_city_area, occupiers_of};
use crate::queries::contract::{contract_weeks, TICKS_PER_GAME_WEEK};
use crate::queries::names::held_in;
use crate::queries::npc_trade::npc_storages;
use crate::queries::residents::is_armed;
use crate::queries::standing::{standing_of, standing_organization, TRADE_ORG};
use crate::random::new_id;

/// The Organization `city` feels most threatened by, with how much, if any reaches `at`; the first
/// by id of equals.
fn threat_from(city: &City, at: f64) -> Option<(String, f64)> {
    let mut threats: Vec<(&String, &f64)> = city.threats.iter().flatten().collect();
    threats.sort_by(|a, b| a.0.cmp(b.0));
    let mut best: Option<(String, f64)> = None;
    for (org, &t) in threats {
        if t >= at && best.as_ref().is_none_or(|b| t > b.1) {
            best = Some((org.clone(), t));
        }
    }
    best
}

/// Whether the resident `id` is one of the mercenaries `city_id` hired, in force.
pub fn hired_by(world: &WorldState, id: &str, city_id: &str) -> bool {
    world.contracts.iter().any(|c| {
        c.started_at.is_some() && c.hirer_id == city_id && c.resident_ids.iter().any(|x| x == id)
    })
}

/// One tick of NPC cities acting first (`stepNpcActingFirst`): allies and hiring at each city's
/// first planning pass of a game day; paying and running mercenaries every tick. Run before the
/// Trade Org army answers offers.
pub fn step_npc_acting_first(world: &mut WorldState, size: i32) {
    for ci in 0..world.cities.len() {
        let city = &world.cities[ci];
        if !for_sale(city) || !crate::npc_stance::first_pass_of_day(world, &city.id) {
            continue;
        }
        let id = city.id.clone();
        seek_allies(world, &id);
        hire_mercenaries(world, &id, size);
    }
    pay_mercenaries(world);
    run_mercenaries(world, size);
}

/// The realms and NPC cities `city_id` would invite against `org` now.
fn would_invite(world: &WorldState, city_id: &str, org: &str) -> Vec<String> {
    let high = |of: &str, toward: &str| {
        standing_of(world, of, toward) >= NPC_ALLIANCE_JOIN_STANDING
            && !knows_recent_crime(world, of, toward)
    };
    let invited = |id: &str| world.alliances.iter().any(|a| a.invites.iter().any(|x| x == id));
    let threat_side = standing_organization(world, org);
    let cities = world.cities.iter().filter(|c| {
        c.id != city_id
            && is_alliance_city(world, &c.id)
            && alliance_of(world, &c.id).is_none()
            && high(city_id, &c.id)
            && high(&c.id, city_id)
            && c.threats.as_ref().is_some_and(|t| t.get(org).is_some_and(|&v| v > 0.0))
    });
    let realms = world.realms.iter().filter(|r| {
        r.id != org
            && r.id != threat_side
            && alliance_of(world, &r.id).is_none()
            && !invited(&r.id)
            && high(city_id, &r.id)
    });
    cities.map(|c| c.id.clone()).chain(realms.map(|r| r.id.clone())).collect()
}

/// `city_id` seeks allies against the Organization it feels most threatened by (`seekAllies`).
fn seek_allies(world: &mut WorldState, city_id: &str) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id) else { return };
    let Some((org, _)) = threat_from(city, NPC_ACTING_FIRST.ally_threat) else { return };
    if alliance_of(world, city_id).is_some_and(|a| a.leader_id != city_id) {
        return;
    }
    let ids = would_invite(world, city_id, &org);
    if ids.is_empty() {
        return;
    }
    let a = match world.alliances.iter().position(|a| a.leader_id == city_id) {
        Some(a) => a,
        None => npc_found_alliance(world, city_id),
    };
    for id in ids {
        invite(world, a, &id);
    }
}

/// Coins in `city`'s storages.
fn coins_of(world: &WorldState, city: &City) -> f64 {
    npc_storages(world, city).iter().map(|b| held_in(b.stock.as_ref(), Good::Coins)).sum()
}

/// `city_id` asks the Trade Org army for mercenaries if it feels threatened enough
/// (`hireMercenaries`).
fn hire_mercenaries(world: &mut WorldState, city_id: &str, size: i32) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id) else { return };
    if threat_from(city, NPC_ACTING_FIRST.hire_threat).is_none()
        || world.contracts.iter().any(|c| c.hirer_id == city_id)
    {
        return;
    }
    let Some(home) = npc_home(world, city_id) else { return };
    let at = (home.x as i32, home.y as i32);
    let warehouse = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Warehouse
                && b.site.is_none()
                && world
                    .cities
                    .iter()
                    .any(|c| b.city_id.as_ref() == Some(&c.id) && c.trade_org.is_some())
        })
        .min_by(|a, b| {
            let d = |x: &&csp_shared::world::Building| {
                wrap_distance(size, at, (x.x as i32, x.y as i32))
            };
            d(a).total_cmp(&d(b))
        });
    let Some(warehouse) = warehouse.map(|b| b.id.clone()) else { return };
    let soldiers: Vec<String> = crate::trade_org_army::spare_soldiers(world)
        .into_iter()
        .take(NPC_ACTING_FIRST.hire_soldiers as usize)
        .map(|r| r.id.clone())
        .collect();
    if soldiers.is_empty() {
        return;
    }
    let price = soldiers.len() as f64 * TRADE_ORG_ARMY.price_per_soldier_week;
    let mut c = MercenaryContract {
        id: String::new(),
        lender_id: TRADE_ORG.to_string(),
        hirer_id: city_id.to_string(),
        offered_by: ContractSide::Hirer,
        resident_ids: soldiers,
        days: NPC_ACTING_FIRST.hire_days,
        price_per_week: price,
        storage_id: warehouse,
        started_at: None,
        paid_weeks: 0.0,
    };
    // Only with the whole price in its storages.
    if coins_of(world, city) < price * contract_weeks(&c) {
        return;
    }
    c.id = new_id("contract", &mut world.next_id);
    world.contracts.push(c);
}

/// NPC cities pay each week of their mercenaries in advance as it begins, straight from their
/// storages into the contract's warehouse (`payMercenaries`). A week one can't pay breaks the
/// contract (`step_contracts`).
fn pay_mercenaries(world: &mut WorldState) {
    let tick = world.tick as f64;
    for ci in 0..world.contracts.len() {
        loop {
            let c = &world.contracts[ci];
            let Some(started) = c.started_at else { break };
            let Some(city) = world.cities.iter().find(|x| x.id == c.hirer_id && for_sale(x)) else {
                break;
            };
            let due = c.paid_weeks < contract_weeks(c)
                && tick >= started + c.paid_weeks * TICKS_PER_GAME_WEEK
                && world.buildings.iter().any(|b| b.id == c.storage_id);
            if !due || coins_of(world, city) < c.price_per_week {
                break;
            }
            let mut owed = c.price_per_week;
            let storages: Vec<String> =
                npc_storages(world, city).iter().map(|b| b.id.clone()).collect();
            for id in storages {
                let b = world.buildings.iter_mut().find(|b| b.id == id).expect("a storage");
                let stock = b.stock.get_or_insert_with(Default::default);
                let have = stock.get(&Good::Coins).copied().unwrap_or(0.0);
                let take = have.min(owed);
                if have - take > 0.0 {
                    stock.insert(Good::Coins, have - take);
                } else {
                    stock.shift_remove(&Good::Coins);
                }
                owed -= take;
                if owed <= 0.0 {
                    break;
                }
            }
            pay_into(world, ci, 1.0);
        }
    }
}

/// NPC cities' mercenaries (`runMercenaries`): while the city has attackers in its area, each armed
/// one there goes after the nearest; otherwise they walk to its town hall and stand there.
fn run_mercenaries(world: &mut WorldState, size: i32) {
    let hirers: Vec<(String, Vec<String>)> = world
        .contracts
        .iter()
        .filter(|c| c.started_at.is_some() && is_alliance_city(world, &c.hirer_id))
        .map(|c| (c.hirer_id.clone(), c.resident_ids.clone()))
        .collect();
    for (city_id, ids) in hirers {
        let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { continue };
        let Some(hall) = town_hall_of(world, &city).map(|h| (h.x, h.y)) else { continue };
        let attackers = attackers_of(world, &city, size);
        let occupiers = occupiers_of(world, &city, size);
        for id in ids {
            let Some(i) = world.residents.iter().position(|r| r.id == id) else { continue };
            let r = &world.residents[i];
            if r.health <= 0.0 || matches!(r.order, Some(ResidentOrder::Attack(_))) {
                continue;
            }
            if !attackers.is_empty() && is_armed(r) && in_city_area(world, &city.id, r.x, r.y, size)
            {
                go_after_nearest(world, i, &attackers, &occupiers, size);
                continue;
            }
            let r = &mut world.residents[i];
            if r.order.is_none() && (r.x != hall.0 || r.y != hall.1) {
                walk_to(r, hall);
            }
        }
    }
}

#[cfg(test)]
mod tests;
