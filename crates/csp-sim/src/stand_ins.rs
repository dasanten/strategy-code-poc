//! Minimal private stand-ins for helpers other tickets of Epic 86 port, so building and work
//! (T86.6) compile and test on their own. Each says which ticket replaces it; once that lands,
//! its callers switch over and the stand-in goes.

use csp_shared::footprint::covers;
use csp_shared::world::{Building, City, Pile, Stock, WorldState};

use crate::queries::building::pile_tile;
use crate::queries::names::placed;

/// A fresh id for a new entity (`newId`); ids are never reused.
// TODO(T86.8): `starting-city.ts`.
pub(crate) fn new_id(world: &mut WorldState, prefix: &str) -> String {
    let id = format!("{prefix}{}", world.next_id);
    world.next_id += 1;
    id
}

/// Puts goods in the pile reached from a tile, starting one if there is none and there is
/// anything to drop (`dropGoods`).
// TODO(T86.3): `survival.ts`.
pub(crate) fn drop_goods(world: &mut WorldState, x: i32, y: i32, stock: &Stock, size: i32) {
    let goods: Vec<_> = stock.iter().filter(|(_, n)| **n > 0.0).map(|(g, n)| (*g, *n)).collect();
    if goods.is_empty() {
        return;
    }
    let (px, py) = pile_tile(world, x, y, size);
    let at = match world.piles.iter().position(|p| p.x as i32 == px && p.y as i32 == py) {
        Some(i) => i,
        None => {
            let id = format!("pile{}", world.next_id);
            world.next_id += 1;
            world.piles.push(Pile { id, x: px as f64, y: py as f64, goods: Stock::new() });
            world.piles.len() - 1
        }
    };
    let pile = &mut world.piles[at];
    for (good, n) in goods {
        *pile.goods.entry(good).or_insert(0.0) += n;
    }
}

/// Gathers the piles lying on a building's footprint into its one pile (`gatherPile`).
// TODO(T86.3): `survival.ts`.
pub(crate) fn gather_pile(world: &mut WorldState, b: &Building, size: i32) {
    let lies_on =
        |p: &Pile| covers(placed(b), p.x as i32, p.y as i32, size) && (p.x != b.x || p.y != b.y);
    let lying: Vec<Pile> = world.piles.iter().filter(|p| lies_on(p)).cloned().collect();
    if lying.is_empty() {
        return;
    }
    world.piles.retain(|p| !lies_on(p));
    for p in lying {
        drop_goods(world, b.x as i32, b.y as i32, &p.goods, size);
    }
}

/// Founds a city around a finished town hall (`foundCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn found_city(_world: &mut WorldState, _town_hall_id: &str, _realm_id: Option<&str>) {}

/// Brings every city's buildings up to date with where they stand (`updateCityMembership`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn update_city_membership(_world: &mut WorldState, _size: i32) {}

/// Dissolves a city whose town hall is gone (`dissolveCity`).
// TODO(T86.8): `cities.ts`.
pub(crate) fn dissolve_city(world: &mut WorldState, city_id: &str) {
    world.cities.retain(|c: &City| c.id != city_id);
}

/// Taking down another Organization's building is a crime (`buildingOrganization`,
/// `commitCrime`).
// TODO(T86.7): `crimes.ts`.
pub(crate) fn commit_tear_down_crime(
    _world: &mut WorldState,
    _resident_id: &str,
    _building: &Building,
    _size: i32,
) {
}

/// Who sent an order (`OrderSender`): a Player's account, or an NPC city running the game's
/// default scripts for its residents (`npcCityId`, with `userId` 0).
// TODO(T86.2): `orders.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OrderSender {
    pub user_id: u64,
    pub npc_city_id: Option<String>,
}

/// The Player's realm, if they have one (`realmOf`).
// TODO(T86.8): `starting-city.ts`.
pub(crate) fn realm_of(world: &WorldState, user_id: u64) -> Option<&csp_shared::world::Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

/// Whether the realm's Player may give the resident orders (`commands`).
// TODO(T86.5): `queries/command.rs`.
pub(crate) fn commands(
    world: &WorldState,
    realm_id: &str,
    r: &csp_shared::world::Resident,
) -> bool {
    crate::queries::alliance::commander_of(world, &r.id, r.owner.as_deref()).as_deref()
        == Some(realm_id)
}

/// Where in `world.residents` the resident an order names is, if its sender may order them
/// (`orderedResident`).
// TODO(T86.2): `order-sender.ts`.
pub(crate) fn ordered_resident(
    world: &WorldState,
    sender: &OrderSender,
    resident_id: Option<&str>,
) -> Option<usize> {
    let i = world.residents.iter().position(|x| Some(x.id.as_str()) == resident_id)?;
    let r = &world.residents[i];
    if let Some(city) = &sender.npc_city_id {
        let runs = r.owner.is_none()
            && r.city_id.as_ref() == Some(city)
            && crate::queries::alliance::contract_of(world, &r.id).is_none();
        return runs.then_some(i);
    }
    let realm = realm_of(world, sender.user_id)?;
    commands(world, &realm.id, r).then_some(i)
}

/// Why an NPC city's sender can't have a resident teach or train (`npcTrainingProblem`).
// TODO(T86.2): `order-sender.ts`.
pub(crate) fn npc_training_problem(
    world: &WorldState,
    sender: &OrderSender,
    r: &csp_shared::world::Resident,
) -> Option<String> {
    let city_id = sender.npc_city_id.as_ref()?;
    let city = world.cities.iter().find(|c| &c.id == city_id);
    let big = city.is_some_and(|c| {
        c.trade_org.is_none() && crate::queries::npc_trade::npc_needs_scale(world, c) > 1.0
    });
    if !big {
        return Some("this city trains nobody".into());
    }
    (!crate::queries::residents::is_armed(&r.carried)).then(|| "it trains only its soldiers".into())
}

/// A string field of an order's input (`order.residentId` as a string), if it is one.
// TODO(T86.2): with the order kinds' input helpers.
pub(crate) fn str_field<'o>(
    order: &'o csp_shared::world::OrderRequest,
    key: &str,
) -> Option<&'o str> {
    order.fields.get(key).and_then(serde_json::Value::as_str)
}
