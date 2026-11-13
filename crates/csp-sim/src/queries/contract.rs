//! Mercenary contract queries of `packages/shared/src/contract.ts` (`CONTEXT.md`: Mercenary
//! contract): its weeks, when it ends and when the next week is due, and a contract as one of its
//! sides sees it. `contractOf` is T85.5's, in `alliance.rs`.

use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{City, ContractSide, MercenaryContract, WorldState};
use serde::Serialize;
use ts_rs::TS;

use crate::queries::alliance::contract_of;
use crate::queries::city::for_sale;
use crate::queries::standing::organization_label;

/// The NPC city that lent the resident under a started contract, if one did (`CONTEXT.md`:
/// Hiring from an NPC city).
pub fn lending_city<'w>(world: &'w WorldState, resident_id: &str) -> Option<&'w City> {
    let c = contract_of(world, resident_id)?;
    world.cities.iter().find(|x| x.id == c.lender_id && for_sale(x))
}

/// Whether the NPC city `city_id` lent the resident (`CONTEXT.md`: Hiring from an NPC city).
/// Such a resident never acts against that city and never counts as the hirer's fighter toward
/// it (Respect): a one-line filter for whoever weighs the hirer's force.
pub fn is_lent_by(world: &WorldState, resident_id: &str, city_id: &str) -> bool {
    lending_city(world, resident_id).is_some_and(|c| c.id == city_id)
}

/// Game days in a game week, the period a contract is paid for (`GAME_DAYS_PER_WEEK`).
pub const GAME_DAYS_PER_WEEK: f64 = 7.0;

/// Ticks in one game week (`TICKS_PER_GAME_WEEK`).
pub const TICKS_PER_GAME_WEEK: f64 = GAME_DAYS_PER_WEEK * TICKS_PER_GAME_DAY;

/// Game weeks the contract runs, the last one maybe short (`contractWeeks`).
pub fn contract_weeks(c: &MercenaryContract) -> f64 {
    (c.days / GAME_DAYS_PER_WEEK).ceil()
}

/// The tick an accepted contract's time is up (`contractEndsAt`).
pub fn contract_ends_at(c: &MercenaryContract, started_at: f64) -> f64 {
    started_at + c.days * TICKS_PER_GAME_DAY
}

/// The tick by which the next unpaid week has to be paid (`contractPayBy`): when that week ends,
/// or when the contract does if sooner. None while only offered or with every week paid.
pub fn contract_pay_by(c: &MercenaryContract) -> Option<f64> {
    let started_at = c.started_at?;
    if c.paid_weeks >= contract_weeks(c) {
        return None;
    }
    Some(
        (started_at + (c.paid_weeks + 1.0) * TICKS_PER_GAME_WEEK)
            .min(contract_ends_at(c, started_at)),
    )
}

/// A side of a contract as a Player sees it (`RealmLabel`): its id and its name, and for an NPC
/// city that may be an alliance member, `city`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RealmLabel {
    pub realm_id: String,
    pub realm: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "true")]
    pub city: Option<bool>,
}

/// A rented resident in a `ContractView`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct ContractResident {
    pub id: String,
    pub name: String,
}

/// The storage a contract is paid into, where it stands.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct ContractStorage {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

/// A mercenary contract as one of its sides sees it (`ContractView`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContractView {
    pub id: String,
    pub lender: RealmLabel,
    pub hirer: RealmLabel,
    pub offered_by: ContractSide,
    pub residents: Vec<ContractResident>,
    pub days: f64,
    pub price_per_week: f64,
    pub storage: Option<ContractStorage>,
    pub started_at: Option<f64>,
    pub ends_at: Option<f64>,
    pub weeks: f64,
    pub paid_weeks: f64,
    pub pay_by: Option<f64>,
}

/// The contracts the realm is a side of, offered or in force (`contractsFor`).
pub fn contracts_for(world: &WorldState, realm_id: &str) -> Vec<ContractView> {
    let label = |id: &str| RealmLabel {
        realm_id: id.to_string(),
        realm: organization_label(world, id),
        city: None,
    };
    world
        .contracts
        .iter()
        .filter(|c| c.lender_id == realm_id || c.hirer_id == realm_id)
        .map(|c| {
            let storage = world.buildings.iter().find(|b| b.id == c.storage_id);
            ContractView {
                id: c.id.clone(),
                lender: label(&c.lender_id),
                hirer: label(&c.hirer_id),
                offered_by: c.offered_by,
                residents: c
                    .resident_ids
                    .iter()
                    .map(|id| ContractResident {
                        id: id.clone(),
                        name: world
                            .residents
                            .iter()
                            .find(|r| r.id == *id)
                            .map_or("?".into(), |r| r.name.clone()),
                    })
                    .collect(),
                days: c.days,
                price_per_week: c.price_per_week,
                storage: storage.map(|b| ContractStorage { id: b.id.clone(), x: b.x, y: b.y }),
                started_at: c.started_at,
                ends_at: c.started_at.map(|s| contract_ends_at(c, s)),
                weeks: contract_weeks(c),
                paid_weeks: c.paid_weeks,
                pay_by: contract_pay_by(c),
            }
        })
        .collect()
}
