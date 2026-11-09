//! The Trade Org army (`CONTEXT.md`: Trade Org army, Trade Org HQ), ported from
//! `apps/server/src/trade-org-army.ts`: the HQ's soldiers, which it arms itself
//! (`step_npc_defence`). In mercenary contracts the Trade Organization is a side like a realm
//! (`TRADE_ORG`): it hires out its spare soldiers, keeps its inner ring clear by force, and hires
//! Players' residents itself when it has lost too many. Like an NPC city it only gives orders a
//! Player could give (ADR 0002), and opens and closes its own gates.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{TRADE_ORG_ARMY, TRADE_ORG_HQ};
use csp_shared::footprint::middle_of;
use csp_shared::terrain::{wrap_delta, wrap_distance};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, ContractSide, ContractWhat, Good, MercenaryContract,
    RealmEventWhat, Resident, ResidentOrder, WorldState,
};

use crate::caravans::caravan_crew;
use crate::combat::attack_order;
use crate::contracts::{cannot_start, pay_into, start_contract};
use crate::events::record_event;
use crate::npc_behaviour::walk_to;
use crate::npc_defence::{attackers_of, go_after_nearest};
use crate::queries::alliance::{contract_of, handed_over_to, realm_name};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, occupiers_of};
use crate::queries::contract::{contract_weeks, TICKS_PER_GAME_WEEK};
use crate::queries::names::{held_in, placed};
use crate::queries::npc_trade::locale_compare;
use crate::queries::residents::{can_work, is_armed};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::{in_inner_ring_around, punishers, trade_org_hq, trade_org_refuses};
use crate::queries::warehouse::warehouse_keeps;
use crate::sight::InvariantViolation;
use crate::trade_org::hq_layout;

/// Whether the resident is one of the HQ's own (`ofHq`).
fn of_hq(hq: &City, r: &Resident) -> bool {
    r.owner.is_none() && r.city_id.as_deref() == Some(hq.id.as_str())
}

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

/// The Trade Org HQ's soldiers (`hqSoldiers`): its living armed residents, a caravan's crew
/// aside. By their place in `world.residents`.
pub fn hq_soldiers(world: &WorldState) -> Vec<usize> {
    let Some(hq) = trade_org_hq(world) else { return Vec::new() };
    let crew = caravan_crew(world);
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            of_hq(hq, r) && r.health > 0.0 && is_armed(&r.carried) && !crew.contains(&r.id)
        })
        .collect()
}

/// The HQ soldiers it would hire out now (`spareSoldiers`): those in no contract, offered or in
/// force, and on no punishment trip, except the `TRADE_ORG_ARMY.guard` that always stay. By id,
/// so the same ones go first.
pub fn spare_soldiers(world: &WorldState) -> Vec<&Resident> {
    let mut named: HashSet<String> =
        world.contracts.iter().flat_map(|c| c.resident_ids.iter().cloned()).collect();
    named.extend(punishers(world));
    let mut home: Vec<&Resident> = hq_soldiers(world)
        .into_iter()
        .map(|i| &world.residents[i])
        .filter(|r| !named.contains(&r.id))
        .collect();
    home.sort_by(|a, b| locale_compare(&a.id, &b.id));
    let keep = 0f64.max(home.len() as f64 - TRADE_ORG_ARMY.guard) as usize;
    home.truncate(keep);
    home
}

/// One tick of the Trade Org army (`stepTradeOrgArmy`), on a map of `size` tiles: it answers the
/// offers made to it, pays its mercenaries, keeps its inner ring clear, watches its outer gates,
/// runs its mercenaries, and once a game day hires more when it has lost too many.
pub fn step_trade_org_army(world: &mut WorldState, size: i32) {
    let Some(hq) = trade_org_hq(world).cloned() else { return };
    answer_offers(world);
    pay_mercenaries(world, &hq);
    guard_inner_ring(world, &hq, size);
    watch_outer_gates(world, &hq, size);
    run_mercenaries(world, &hq, size);
    if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
        hire_mercenaries(world, &hq, size);
    }
}

/// Why the Trade Organization turns down an offer for its soldiers, if it does (`refusal`).
fn refusal(world: &WorldState, ci: usize) -> Option<&'static str> {
    let c = &world.contracts[ci];
    if trade_org_refuses(world, &c.hirer_id) {
        return Some("standing");
    }
    if c.price_per_week < c.resident_ids.len() as f64 * TRADE_ORG_ARMY.price_per_soldier_week {
        return Some("price");
    }
    if cannot_start(world, c).is_some() {
        return Some("changed");
    }
    let busy: HashSet<&String> = world
        .contracts
        .iter()
        .enumerate()
        .filter(|(j, _)| *j != ci)
        .flat_map(|(_, x)| x.resident_ids.iter())
        .collect();
    let soldiers = hq_soldiers(world);
    let ids: HashSet<&String> = soldiers.iter().map(|&i| &world.residents[i].id).collect();
    if !c.resident_ids.iter().all(|id| ids.contains(id) && !busy.contains(id)) {
        return Some("not spare");
    }
    let staying = soldiers
        .iter()
        .map(|&i| &world.residents[i].id)
        .filter(|id| !busy.contains(id) && !c.resident_ids.contains(id))
        .count();
    if (staying as f64) < TRADE_ORG_ARMY.guard {
        Some("guard")
    } else {
        None
    }
}

/// The Trade Organization answers each offer for its soldiers at once (`answerOffers`): it accepts
/// unless it has a `refusal`, and otherwise declines, which the hirer hears of.
fn answer_offers(world: &mut WorldState) {
    let offers: Vec<String> = world
        .contracts
        .iter()
        .filter(|c| c.lender_id == TRADE_ORG && c.started_at.is_none())
        .map(|c| c.id.clone())
        .collect();
    for id in offers {
        let Some(ci) = world.contracts.iter().position(|c| c.id == id) else { continue };
        if refusal(world, ci).is_none() {
            start_contract(world, ci);
            continue;
        }
        let c = world.contracts.remove(ci);
        let what = RealmEventWhat::Contract {
            contract_id: c.id.clone(),
            what: ContractWhat::Declined,
            lender: false,
            other: realm_name(world, TRADE_ORG),
            residents: c.resident_ids.len() as f64,
            weeks: None,
            leader_died: None,
        };
        record_event(world, Some(&c.hirer_id), what);
    }
}

/// The HQ's coin warehouse, if it stands (`coinWarehouse`), by its place in `world.buildings`.
fn coin_warehouse(world: &WorldState, hq: &City) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.city_id.as_deref() == Some(hq.id.as_str())
            && warehouse_keeps(world, b).contains(&Good::Coins)
    })
}

/// The Trade Organization pays each week of its mercenaries in advance as it begins, from its coin
/// warehouse straight into the lender's storage (`payMercenaries`). A week it can't pay breaks the
/// contract (`stepContracts`).
fn pay_mercenaries(world: &mut WorldState, hq: &City) {
    let bank = coin_warehouse(world, hq);
    for ci in 0..world.contracts.len() {
        let c = &world.contracts[ci];
        let Some(started) = c.started_at else { continue };
        if c.hirer_id != TRADE_ORG || !world.buildings.iter().any(|b| b.id == c.storage_id) {
            continue;
        }
        loop {
            let c = &world.contracts[ci];
            let coins =
                bank.map_or(0.0, |b| held_in(world.buildings[b].stock.as_ref(), Good::Coins));
            let due = c.paid_weeks < contract_weeks(c)
                && world.tick as f64 >= started + c.paid_weeks * TICKS_PER_GAME_WEEK
                && coins >= c.price_per_week;
            if !due {
                break;
            }
            let price = c.price_per_week;
            let b = bank.expect("coins came from the bank");
            *world.buildings[b]
                .stock
                .get_or_insert_with(Default::default)
                .entry(Good::Coins)
                .or_insert(0.0) -= price;
            pay_into(world, ci, 1.0);
        }
    }
}

/// The HQ's inner gates (`innerGates`): its gates on the inner ring, not the outer.
fn inner_gates(world: &WorldState, hq: &City, hall: &Building, size: i32) -> Vec<usize> {
    let (cx, cy) = middle_of(placed(hall), size);
    (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            let dx = f64::from(wrap_delta(cx, b.x as i32, size));
            let dy = f64::from(wrap_delta(cy, b.y as i32, size));
            b.city_id.as_deref() == Some(hq.id.as_str())
                && b.kind == BuildingKind::Gate
                && dx.hypot(dy) <= TRADE_ORG_HQ.inner_radius + 1.0
        })
        .collect()
}

/// The HQ's outer gates (`outerGates`): its finished gates that are not on its inner ring.
fn outer_gates(world: &WorldState, hq: &City, hall: &Building, size: i32) -> Vec<usize> {
    let inner: HashSet<usize> = inner_gates(world, hq, hall, size).into_iter().collect();
    (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            b.city_id.as_deref() == Some(hq.id.as_str())
                && b.kind == BuildingKind::Gate
                && b.site.is_none()
                && !inner.contains(&i)
        })
        .collect()
}

/// Armed outsiders near the HQ (`armedOutsidersNear`): armed residents not of it in its area or
/// within `TRADE_ORG_ARMY.gateWatchRange` of one of its outer gates; its own mercenaries aside.
pub fn armed_outsiders_near(world: &WorldState, hq: &City, size: i32) -> Vec<usize> {
    let Some(hall) = town_hall_of(world, hq) else { return Vec::new() };
    let gates = outer_gates(world, hq, hall, size);
    let hired: HashSet<String> =
        mercenaries(world).into_iter().map(|i| world.residents[i].id.clone()).collect();
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.health > 0.0
                && is_armed(&r.carried)
                && !of_hq(hq, r)
                && !hired.contains(&r.id)
                && (in_city_area(world, &hq.id, r.x, r.y, size)
                    || gates.iter().any(|&g| {
                        let g = &world.buildings[g];
                        wrap_distance(size, tile(r.x, r.y), tile(g.x, g.y))
                            <= TRADE_ORG_ARMY.gate_watch_range
                    }))
        })
        .collect()
}

/// The HQ closes its outer gates while more armed outsiders are near it than
/// `TRADE_ORG_ARMY.gateShare` of its soldiers at home, and opens them again once there are no more
/// (`watchOuterGates`).
fn watch_outer_gates(world: &mut WorldState, hq: &City, size: i32) {
    let Some(hall) = town_hall_of(world, hq).cloned() else { return };
    let home = hq_soldiers(world)
        .into_iter()
        .filter(|&i| contract_of(world, &world.residents[i].id).is_none())
        .count();
    let close = armed_outsiders_near(world, hq, size).len() as f64
        > TRADE_ORG_ARMY.gate_share * home as f64;
    for g in outer_gates(world, hq, &hall, size) {
        world.buildings[g].closed = close.then_some(true);
    }
}

/// The HQ keeps its inner ring clear (`guardInnerRing`): its inner gates stay closed, and each of
/// its soldiers in its area who is not fighting yet and not hired out goes after the nearest
/// outsider on or inside the inner ring.
fn guard_inner_ring(world: &mut WorldState, hq: &City, size: i32) {
    let Some(hall) = town_hall_of(world, hq).cloned() else { return };
    for g in inner_gates(world, hq, &hall, size) {
        world.buildings[g].closed = Some(true);
    }
    let outsiders: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.health > 0.0 && !of_hq(hq, r) && in_inner_ring_around(&hall, (r.x, r.y), size)
        })
        .collect();
    if outsiders.is_empty() {
        return;
    }
    let away = punishers(world);
    for i in hq_soldiers(world) {
        let r = &world.residents[i];
        if matches!(r.order, Some(ResidentOrder::Attack(_)))
            || contract_of(world, &r.id).is_some()
            || away.contains(&r.id)
        {
            continue;
        }
        if !in_city_area(world, &hq.id, r.x, r.y, size) {
            continue;
        }
        let at = tile(r.x, r.y);
        let d =
            |j: usize| wrap_distance(size, at, tile(world.residents[j].x, world.residents[j].y));
        // `reduce((a, b) => d(b) < d(a) ? b : a)`: the first of the nearest.
        let nearest =
            outsiders.iter().copied().reduce(|a, b| if d(b) < d(a) { b } else { a }).expect("some");
        let target = world.residents[nearest].id.clone();
        world.residents[i].order = Some(ResidentOrder::Attack(attack_order(&target, false, false)));
    }
}

/// The residents the Trade Organization has hired, in the order it hired them (`mercenaries`).
fn mercenaries(world: &WorldState) -> Vec<usize> {
    let by_id: HashMap<&str, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.as_str(), i)).collect();
    world
        .contracts
        .iter()
        .filter(|c| c.hirer_id == TRADE_ORG && c.started_at.is_some())
        .flat_map(|c| c.resident_ids.iter().filter_map(|id| by_id.get(id.as_str()).copied()))
        .collect()
}

/// Where the HQ's mercenaries stand guard (`guardPosts`): one tile outside each inner gate, away
/// from the town hall. `middleOf(hall)` there leaves the size out: `MAP_SIZE`.
fn guard_posts(hall: &Building) -> Vec<(f64, f64)> {
    let (cx, cy) = middle_of(placed(hall), csp_shared::balance::MAP_SIZE);
    let (cx, cy) = (f64::from(cx), f64::from(cy));
    hq_layout(cx as i32, cy as i32)
        .inner_gates
        .iter()
        .map(|g| {
            let (x, y) = (f64::from(g.0), f64::from(g.1));
            let d = (x - cx).hypot(y - cy);
            let d = if d == 0.0 { 1.0 } else { d };
            (x + crate::queries::js_round((x - cx) / d), y + crate::queries::js_round((y - cy) / d))
        })
        .collect()
}

/// The Trade Organization's mercenaries (`runMercenaries`): while the HQ has attackers in its
/// area, each armed one there goes after the nearest; otherwise they walk to their guard post
/// outside the inner gates and stand there.
fn run_mercenaries(world: &mut WorldState, hq: &City, size: i32) {
    let hired = mercenaries(world);
    let Some(hall) = town_hall_of(world, hq).cloned() else { return };
    if hired.is_empty() {
        return;
    }
    let posts = guard_posts(&hall);
    let attackers = attackers_of(world, hq, size);
    let occupiers = occupiers_of(world, hq, size);
    for (n, &i) in hired.iter().enumerate() {
        let r = &world.residents[i];
        if r.health <= 0.0 || matches!(r.order, Some(ResidentOrder::Attack(_))) {
            continue;
        }
        if !attackers.is_empty()
            && is_armed(&r.carried)
            && in_city_area(world, &hq.id, r.x, r.y, size)
        {
            go_after_nearest(world, i, &attackers, &occupiers, size);
            continue;
        }
        let post = posts[n % posts.len()];
        let r = &mut world.residents[i];
        if r.order.is_none() && (r.x != post.0 || r.y != post.1) {
            walk_to(r, post);
        }
    }
}

/// How many soldiers the Trade Organization lacks (`soldiersLacking`): none while its soldiers,
/// the adults it could still arm and its mercenaries come to at least `TRADE_ORG_ARMY.hireBelow`
/// of its army's size; once they don't, the rest of its size.
pub fn soldiers_lacking(world: &WorldState, hq: &City) -> f64 {
    let crew = caravan_crew(world);
    let tick = world.tick as f64;
    let adults: Vec<&Resident> = world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_deref() == Some(hq.id.as_str())
                && r.owner.is_none()
                && r.health > 0.0
                && !crew.contains(&r.id)
        })
        .collect();
    let working: Vec<&&Resident> = adults.iter().filter(|r| can_work(r.born_at, tick)).collect();
    let soldiers = working.iter().filter(|r| is_armed(&r.carried)).count() as f64;
    let armable = 0f64.max(working.len() as f64 - TRADE_ORG_ARMY.workers - soldiers);
    let hired: f64 = world
        .contracts
        .iter()
        .filter(|c| c.hirer_id == TRADE_ORG)
        .map(|c| c.resident_ids.len() as f64)
        .sum();
    let strength = soldiers + armable + hired;
    if strength >= TRADE_ORG_ARMY.size * TRADE_ORG_ARMY.hire_below {
        return 0.0;
    }
    TRADE_ORG_ARMY.size - strength
}

/// The Trade Organization hires mercenaries once it has lost too many (`hireMercenaries`): it asks
/// Players' realms for their armed residents nearest the HQ, the nearest realm first, as many as it
/// lacks, at its own price and length, paid into the lender's storage nearest them.
fn hire_mercenaries(world: &mut WorldState, hq: &City, size: i32) {
    let mut lacking = soldiers_lacking(world, hq);
    let Some(hall) = town_hall_of(world, hq) else { return };
    if lacking <= 0.0 {
        return;
    }
    let hall_at = tile(hall.x, hall.y);
    let leaders: HashSet<&str> = world.realms.iter().map(|r| r.leader_id.as_str()).collect();
    let busy: HashSet<&str> =
        world.contracts.iter().flat_map(|c| c.resident_ids.iter().map(String::as_str)).collect();
    let asked: HashSet<&str> = world
        .contracts
        .iter()
        .filter(|c| c.hirer_id == TRADE_ORG && c.started_at.is_none())
        .map(|c| c.lender_id.as_str())
        .collect();
    let mut candidates: Vec<&Resident> = world
        .residents
        .iter()
        .filter(|r| {
            r.owner.as_deref().is_some_and(|o| !asked.contains(o) && !trade_org_refuses(world, o))
                && r.health > 0.0
                && is_armed(&r.carried)
                && !leaders.contains(r.id.as_str())
                && !busy.contains(r.id.as_str())
                && handed_over_to(world, &r.id).is_none()
        })
        .collect();
    let d = |r: &Resident| wrap_distance(size, hall_at, tile(r.x, r.y));
    candidates.sort_by(|a, b| {
        (d(a) - d(b))
            .partial_cmp(&0.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| locale_compare(&a.id, &b.id))
    });
    // A `Map` by realm, in the order each realm first comes up.
    type Hireling = (String, f64, f64);
    let mut by_realm: Vec<(String, Vec<Hireling>)> = Vec::new();
    for r in candidates {
        let owner = r.owner.clone().expect("of a realm");
        let entry = (r.id.clone(), r.x, r.y);
        match by_realm.iter_mut().find(|(o, _)| *o == owner) {
            Some((_, list)) => list.push(entry),
            None => by_realm.push((owner, vec![entry])),
        }
    }
    for (realm_id, residents) in by_realm {
        if lacking <= 0.0 {
            break;
        }
        let take: Vec<Hireling> = residents.into_iter().take(lacking as usize).collect();
        let Some(storage) = nearest_storage(world, &realm_id, (take[0].1, take[0].2), size) else {
            continue;
        };
        let id = format!("contract{}", world.next_id);
        world.next_id += 1;
        let c = MercenaryContract {
            id: id.clone(),
            lender_id: realm_id.clone(),
            hirer_id: TRADE_ORG.to_string(),
            offered_by: ContractSide::Hirer,
            resident_ids: take.iter().map(|t| t.0.clone()).collect(),
            days: TRADE_ORG_ARMY.hire_days,
            price_per_week: take.len() as f64 * TRADE_ORG_ARMY.hire_price_per_soldier_week,
            storage_id: storage,
            started_at: None,
            paid_weeks: 0.0,
        };
        world.contracts.push(c);
        let what = RealmEventWhat::Contract {
            contract_id: id,
            what: ContractWhat::Offered,
            lender: true,
            other: realm_name(world, TRADE_ORG),
            residents: take.len() as f64,
            weeks: None,
            leader_died: None,
        };
        record_event(world, Some(&realm_id), what);
        lacking -= take.len() as f64;
    }
}

/// The realm's finished storage nearest `from`, if it has one (`nearestStorage`): its id.
fn nearest_storage(
    world: &WorldState,
    realm_id: &str,
    from: (f64, f64),
    size: i32,
) -> Option<String> {
    let cities: HashSet<&str> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.as_deref() == Some(realm_id))
        .map(|c| c.id.as_str())
        .collect();
    let from = tile(from.0, from.1);
    let mut best: Option<&Building> = None;
    for b in &world.buildings {
        if b.kind != BuildingKind::Storage
            || b.site.is_some()
            || !b.city_id.as_deref().is_some_and(|c| cities.contains(c))
        {
            continue;
        }
        let d = |x: &Building| wrap_distance(size, from, tile(x.x, x.y));
        if best.is_none_or(|bb| d(b) < d(bb)) {
            best = Some(b);
        }
    }
    best.map(|b| b.id.clone())
}

/// Invariant (`tradeOrgArmySound`): the HQ's inner gates are closed; the Trade Organization rents
/// out only soldiers of its HQ, paid into one of its warehouses; and it never hires a Leader.
pub fn trade_org_army_sound(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation {
            invariant: "trade-org-army-sound".into(),
            message,
            entity_ids,
        })
    };
    let hq = trade_org_hq(world);
    if let Some((hq, hall)) = hq.and_then(|hq| town_hall_of(world, hq).map(|h| (hq, h))) {
        for g in inner_gates(world, hq, hall, size) {
            let g = &world.buildings[g];
            if g.closed != Some(true) {
                fail(
                    format!("inner gate {} of the Trade Org HQ is open", g.id),
                    vec![g.id.clone()],
                );
            }
        }
    }
    let leaders: HashSet<&str> = world.realms.iter().map(|r| r.leader_id.as_str()).collect();
    for c in &world.contracts {
        if c.lender_id == TRADE_ORG {
            for id in &c.resident_ids {
                let r = world.residents.iter().find(|x| x.id == *id);
                if r.is_some_and(|r| hq.is_none_or(|hq| !of_hq(hq, r))) {
                    fail(
                        format!("contract {} rents out {id}, who is not of the Trade Org HQ", c.id),
                        vec![c.id.clone(), id.clone()],
                    );
                }
            }
            if let Some(b) = world.buildings.iter().find(|x| x.id == c.storage_id) {
                if b.kind != BuildingKind::Warehouse {
                    fail(
                        format!("contract {} is paid into {}, which is no warehouse", c.id, b.id),
                        vec![c.id.clone(), b.id.clone()],
                    );
                }
            }
        }
        if c.hirer_id == TRADE_ORG {
            for id in &c.resident_ids {
                if leaders.contains(id.as_str()) {
                    fail(
                        format!("the Trade Organization hires Leader {id}"),
                        vec![c.id.clone(), id.clone()],
                    );
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
