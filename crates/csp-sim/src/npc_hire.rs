//! Hiring from an NPC city (`apps/server/src/npc-hire.ts`, `CONTEXT.md`: Hiring from an NPC
//! city): a Player asks an NPC city for a number of its residents, and the city answers at once,
//! here. Paying and ending go as in any mercenary contract (`step_contracts`). It accepts or
//! declines, and its lent residents take weapons and armour from its storage.

use std::collections::HashSet;

use csp_shared::balance::WEAPON_ATTACK;
use csp_shared::goods::PROTECTION;
use csp_shared::world::{
    City, ContractSide, ContractWhat, Good, MercenaryContract, RealmEventWhat, WorldState,
};

use crate::contracts::{cannot_start, start_contract};
use crate::events::record_event;
use crate::queries::city::{for_sale, in_city_area};
use crate::queries::names::{good_of, held};
use crate::queries::npc_trade::{npc_hire_problem, npc_storages, spare_residents};
use crate::queries::residents::{can_work, carry_capacity, good_weight, is_armed, stock_weight};
use crate::queries::standing::organization_label;
use crate::sight::InvariantViolation;

/// The NPC city lending in a contract, if its lender is one (`lenderCity`).
fn lender_city<'w>(world: &'w WorldState, c: &MercenaryContract) -> Option<&'w City> {
    world.cities.iter().find(|x| x.id == c.lender_id).filter(|c| for_sale(c))
}

/// One tick of hiring from NPC cities (`stepNpcHire`): each NPC city answers every ask for its
/// residents at once. It accepts when it has no `npc_hire_problem` with the ask and the residents
/// and storage are still its own; its lent residents then arm themselves. Otherwise it declines,
/// which the hirer hears of. Run before `step_npc_cities`. `size` is the map's.
pub fn step_npc_hire(world: &mut WorldState, size: i32) {
    let ids: Vec<String> = world.contracts.iter().map(|c| c.id.clone()).collect();
    for id in ids {
        let Some(c) = world.contracts.iter().find(|c| c.id == id).cloned() else { continue };
        if c.started_at.is_some() {
            continue;
        }
        let Some(city) = lender_city(world, &c).cloned() else { continue };
        if accepts(world, &city, &c) {
            let i = world.contracts.iter().position(|x| x.id == id).expect("the contract");
            start_contract(world, i);
            arm_lent(world, &city, &c, size);
            continue;
        }
        world.contracts.retain(|x| x.id != id);
        let what = RealmEventWhat::Contract {
            contract_id: c.id.clone(),
            what: ContractWhat::Declined,
            lender: false,
            other: organization_label(world, &city.id),
            residents: c.resident_ids.len() as f64,
            weeks: None,
            leader_died: None,
        };
        record_event(world, Some(&c.hirer_id), what);
    }
}

/// Whether the city accepts the ask (`accepts`): no problem with it, and each resident asked for
/// is spare.
fn accepts(world: &WorldState, city: &City, c: &MercenaryContract) -> bool {
    let n = c.resident_ids.len() as f64;
    if npc_hire_problem(world, city, &c.hirer_id, n, c.price_per_week, Some(&c.id)).is_some() {
        return false;
    }
    if cannot_start(world, c).is_some() {
        return false;
    }
    // The very residents named must still be ones it would lend.
    let spare: HashSet<&String> =
        spare_residents(world, city, Some(&c.id)).into_iter().map(|r| &r.id).collect();
    c.resident_ids.iter().all(|id| spare.contains(id))
}

/// Weapons from the strongest down (`BY_STRENGTH`).
fn by_strength() -> Vec<Good> {
    let mut weapons: Vec<(Good, f64)> =
        WEAPON_ATTACK.0.iter().filter_map(|(w, a)| good_of(w).map(|g| (g, *a))).collect();
    weapons.sort_by(|a, b| b.1.total_cmp(&a.1));
    weapons.into_iter().map(|(g, _)| g).collect()
}

/// The city's lent residents take weapons and armour from its storages along (`armLent`), as far
/// as it has them and they can carry them: each one at home in its area takes its best weapon if
/// unarmed, then one of each kind of protection they lack.
fn arm_lent(world: &mut WorldState, city: &City, c: &MercenaryContract, size: i32) {
    let storages: Vec<String> =
        npc_storages(world, city).into_iter().map(|b| b.id.clone()).collect();
    let tick = world.tick as f64;
    let take = |world: &mut WorldState, i: usize, good: Good| -> bool {
        let r = &world.residents[i];
        if stock_weight(&r.carried) + good_weight(good) > carry_capacity(r, tick) + 1e-9 {
            return false;
        }
        let from = storages.iter().find_map(|id| {
            world
                .buildings
                .iter()
                .position(|b| &b.id == id && b.stock.as_ref().is_some_and(|s| held(s, good) > 0.0))
        });
        let Some(from) = from else { return false };
        let stock = world.buildings[from].stock.as_mut().expect("a stock");
        let left = held(stock, good) - 1.0;
        if left == 0.0 {
            stock.shift_remove(&good);
        } else {
            stock.insert(good, left);
        }
        *world.residents[i].carried.entry(good).or_insert(0.0) += 1.0;
        true
    };
    for id in &c.resident_ids {
        let Some(i) = world.residents.iter().position(|x| &x.id == id) else { continue };
        let r = &world.residents[i];
        if !in_city_area(world, &city.id, r.x as i32, r.y as i32, size) {
            continue;
        }
        if !is_armed(&world.residents[i].carried) {
            for w in by_strength() {
                if take(world, i, w) {
                    break;
                }
            }
        }
        for p in PROTECTION.iter().filter_map(|p| good_of(p)) {
            if held(&world.residents[i].carried, p) == 0.0 {
                take(world, i, p);
            }
        }
    }
}

/// Invariant `npc-hire-sound` (`CONTEXT.md`: Hiring from an NPC city; ADR 0004): an NPC city never
/// offers on its own, hires out only to a realm, never lends a child, and is paid into a storage of
/// its own.
pub fn npc_hire_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, ids: Vec<String>| {
        out.push(InvariantViolation {
            invariant: "npc-hire-sound".into(),
            message,
            entity_ids: ids,
        })
    };
    let tick = world.tick as f64;
    for c in &world.contracts {
        if world.cities.iter().any(|x| x.id == c.hirer_id) {
            fail(format!("contract {} has city {} hiring", c.id, c.hirer_id), vec![c.id.clone()]);
        }
        let Some(city) = lender_city(world, c) else { continue };
        if c.offered_by != ContractSide::Hirer {
            fail(format!("NPC city {} offered contract {}", city.id, c.id), vec![c.id.clone()]);
        }
        if !world.realms.iter().any(|r| r.id == c.hirer_id) {
            fail(
                format!("NPC city {} hires out to {}, which is no realm", city.id, c.hirer_id),
                vec![c.id.clone()],
            );
        }
        for id in &c.resident_ids {
            if world
                .residents
                .iter()
                .find(|r| &r.id == id)
                .is_some_and(|r| !can_work(r.born_at, tick))
            {
                fail(
                    format!("NPC city {} lends child {id}", city.id),
                    vec![c.id.clone(), id.clone()],
                );
            }
        }
        if let Some(b) = world.buildings.iter().find(|x| x.id == c.storage_id) {
            if b.kind != csp_shared::world::BuildingKind::Storage
                || b.city_id.as_ref() != Some(&city.id)
            {
                fail(
                    format!("contract {} is paid into {}, no storage of {}", c.id, b.id, city.id),
                    vec![c.id.clone(), b.id.clone()],
                );
            }
        }
    }
    out
}
