//! What the goods rules (T86.5) call in modules other rule tickets port, in one place. Where that
//! ticket has landed this is its function (or a thin wrapper over it in the goods rules' own
//! terms: indices into the world's lists, owned strings); where it hasn't, a stand-in marked with
//! the ticket that owns it. When it lands its function replaces the stand-in here, nothing else.

use std::collections::HashSet;

use csp_shared::world::{
    Building, Carriage, City, CrimeKind, Realm, Resident, StandingMove, Stock, WorldState,
};

use crate::crimes::CrimeAgainst;

pub use crate::events::record_event;
pub use crate::order_sender::OrderSender;
pub use crate::standing::{change_standing, raise_standing_both_ways};
pub use crate::survival::drop_goods;

/// The Player's realm (`realmOf`). TODO(T86.8): `starting_city.rs`.
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<&Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

/// A new id from the world's counter (`newId`), by `random::new_id`.
pub fn new_id(world: &mut WorldState, prefix: &str) -> String {
    crate::random::new_id(prefix, &mut world.next_id)
}

/// Where in `world.residents` the resident an order names is, if its sender may order them
/// (`orderedResident`, in `order_sender.rs`), from the order's plain `residentId`.
pub fn ordered_resident(
    world: &WorldState,
    sender: &OrderSender,
    resident_id: Option<&serde_json::Value>,
) -> Option<usize> {
    crate::order_sender::ordered_resident(world, sender, resident_id.and_then(|v| v.as_str()))
}

/// The Organization a resident belongs to (`organizationOf`, in `crimes.rs`).
pub fn organization_of(r: &Resident) -> Option<String> {
    crate::crimes::organization_of(r).map(str::to_string)
}

/// The Organization a city belongs to (`cityOrganization` of `crimes.ts`, in `crimes.rs`).
pub fn city_organization(c: &City) -> String {
    crate::crimes::city_organization(c).to_string()
}

/// The Organization a building belongs to (`buildingOrganization`, in `crimes.rs`).
pub fn building_organization(world: &WorldState, b: &Building) -> Option<String> {
    crate::crimes::building_organization(world, b)
}

/// The Organization a carriage belongs to (`carriageOrganization`, in `crimes.rs`).
pub fn carriage_organization(k: &Carriage) -> Option<String> {
    crate::crimes::carriage_organization(k).map(str::to_string)
}

/// A theft of `goods` by resident `thief` from `victim_org`, from the Down resident `victim` if
/// it was one (`commitCrime(world, size, 'theft', …)`, in `crimes.rs`).
pub fn commit_theft(
    world: &mut WorldState,
    size: i32,
    thief: usize,
    victim_org: &str,
    goods: &Stock,
    victim: Option<usize>,
) {
    let thief_id = world.residents[thief].id.clone();
    let against = CrimeAgainst {
        victim_org: Some(victim_org.to_string()),
        victim: victim.map(|i| world.residents[i].id.clone()),
        goods: Some(goods.clone()),
        ..CrimeAgainst::default()
    };
    crate::crimes::commit_crime(world, size, CrimeKind::Theft, &thief_id, against);
}

/// Raises the alarm of a theft (`raiseTheft`). TODO(T86.12): `alarms.rs`; a no-op until then.
pub fn raise_theft(_world: &mut WorldState, _thief: usize, _victim_org: &str, _size: i32) {}

/// Finishes a site with all its materials and work (`finishSite`, in `building.rs`), returning
/// whether it did.
pub fn finish_site(world: &mut WorldState, site: usize, by: usize) -> bool {
    let r = world.residents[by].clone();
    crate::building::finish_site(world, site, &r)
}

/// Updates who lives in which city (`updateCityMembership`, in `cities.rs`).
pub fn update_city_membership(world: &mut WorldState, size: i32) {
    crate::cities::update_city_membership(world, size);
}

/// Robs a caravan (`robCaravan`). TODO(T86.9): `caravans.rs`.
pub fn rob_caravan(
    _world: &mut WorldState,
    _thief: usize,
    _carriage_id: &str,
    _robbed: &mut HashSet<String>,
) {
}

/// Robs a wandering trader (`robTrader`). TODO(T86.10): `traders.rs`.
pub fn rob_trader(
    _world: &mut WorldState,
    _thief: usize,
    _carriage_id: &str,
    _robbed: &mut HashSet<String>,
) {
}

pub use crate::deliveries::collects_from;

pub use crate::transfers::collects_transfer_from;

/// A trade of `coins` raises standing both ways (`raiseStandingByTrade`, in `standing.rs`).
pub fn raise_standing_by_trade(
    world: &mut WorldState,
    realm: &str,
    org: &str,
    coins: f64,
) -> Option<StandingMove> {
    crate::standing::raise_standing_by_trade(world, realm, org, coins)
}

/// A city joins a realm with everything in it (`joinRealm`, in `capture.rs`); how many residents
/// came.
pub fn join_realm(world: &mut WorldState, city: usize, realm: &str, size: i32) -> f64 {
    let id = world.cities[city].id.clone();
    crate::capture::join_realm(world, &id, realm, size) as f64
}

/// Ends any breeding a horse is part of (`endBreedingOf`). TODO(T86.8): `breeding.rs`.
pub fn end_breeding_of(_world: &mut WorldState, _horse_id: &str) {}

pub use crate::transfers::hand_in;

/// Takes an offer out of the world (`endOffer`). TODO(offers): the lines in the realm logs it
/// writes come with the offers port.
pub fn end_offer(world: &mut WorldState, offer_id: &str) {
    world.offers.retain(|o| o.id != offer_id);
}

/// A realm's name for the log (`realmName` of `alliance.ts`).
pub fn realm_name(world: &WorldState, realm_id: &str) -> String {
    if realm_id == crate::queries::standing::TRADE_ORG {
        return "the Trade Organization".into();
    }
    let realm = world.realms.iter().find(|r| r.id == realm_id);
    if let Some(name) = realm.and_then(|r| r.name.clone()).filter(|n| !n.is_empty()) {
        return name;
    }
    realm
        .and_then(|r| world.residents.iter().find(|x| x.id == r.leader_id))
        .map_or_else(|| "a fallen realm".into(), |l| l.name.clone())
}
