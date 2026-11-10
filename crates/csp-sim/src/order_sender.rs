//! Who sent an order and who may order whom (`apps/server/src/order-sender.ts`). Kept apart from
//! `orders.rs`, as in the TypeScript, so the order kinds can use it.

use csp_shared::world::{City, Realm, Resident, WorldState};

use crate::queries::alliance::{commander_of, contract_of};
use crate::queries::npc_trade::is_big_npc_city;
use crate::queries::residents::is_armed;

/// A Player's account as an order's sender carries it (`Account`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub name: String,
    pub is_admin: bool,
}

/// Who sent an order: the Player's account and id (`OrderSender`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderSender {
    pub user_id: u64,
    pub account: Account,
    /// Set when an NPC city's game default sends it for one of the residents the city runs
    /// (`CONTEXT.md`: NPC city, Default script); `user_id` is then 0, nobody's.
    pub npc_city_id: Option<String>,
}

impl OrderSender {
    /// A Player's sender.
    pub fn player(user_id: u64, name: &str) -> Self {
        OrderSender {
            user_id,
            account: Account { name: name.to_string(), is_admin: false },
            npc_city_id: None,
        }
    }
}

/// The sender for an NPC city running the game's default scripts for its residents
/// (`npcSender`).
pub fn npc_sender(city: &City) -> OrderSender {
    OrderSender {
        user_id: 0,
        account: Account { name: city.name.clone(), is_admin: false },
        npc_city_id: Some(city.id.clone()),
    }
}

/// The Player's realm, if they have one (`realmOf`).
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<&Realm> {
    crate::starting_city::realm_of(world, user_id).map(|i| &world.realms[i])
}

/// Whether the realm's Player may give the resident orders (`commands`).
pub fn commands(world: &WorldState, realm_id: &str, r: Option<&Resident>) -> bool {
    r.is_some_and(|r| commander_of(world, &r.id, r.owner.as_deref()).as_deref() == Some(realm_id))
}

/// Where in `world.residents` the resident an order names is, if its sender may order them
/// (`orderedResident`): one the Player commands, or, for an NPC city's sender, one living in
/// that city, of no realm and lent to nobody.
pub fn ordered_resident(
    world: &WorldState,
    sender: &OrderSender,
    resident_id: Option<&str>,
) -> Option<usize> {
    let i = world.residents.iter().position(|x| Some(x.id.as_str()) == resident_id);
    let r = i.map(|i| &world.residents[i]);
    if let Some(city_id) = &sender.npc_city_id {
        let runs = r.is_some_and(|r| {
            r.owner.is_none()
                && r.city_id.as_deref() == Some(city_id.as_str())
                && contract_of(world, &r.id).is_none()
        });
        return if runs { i } else { None };
    }
    let realm = realm_of(world, sender.user_id)?;
    if commands(world, &realm.id, r) {
        i
    } else {
        None
    }
}

/// Why an NPC city's sender can't have a resident teach or train (`npcTrainingProblem`,
/// `CONTEXT.md`: Who trains), if it can't: of the game's cities, only a big one trains, and only
/// its soldiers. A Player's sender needs no such check.
pub fn npc_training_problem(
    world: &WorldState,
    sender: &OrderSender,
    r: &Resident,
) -> Option<&'static str> {
    let city_id = sender.npc_city_id.as_deref()?;
    let city = world.cities.iter().find(|c| c.id == city_id);
    match city {
        Some(city) if city.trade_org.is_none() && is_big_npc_city(world, city) => {
            if is_armed(&r.carried) {
                None
            } else {
                Some("it trains only its soldiers")
            }
        }
        _ => Some("this city trains nobody"),
    }
}
