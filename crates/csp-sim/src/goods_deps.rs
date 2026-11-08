//! Stand-ins for what the goods rules (T86.5) call in modules other rule tickets port. Each is
//! marked with the ticket that owns it; when that ticket lands, its function replaces the one here
//! and the `use` lines in the goods modules change, nothing else. The small pure ones are ported
//! as they are; the rules that change much of the world are no-ops until their ticket lands, and
//! the tests that need them say so.

use csp_shared::balance::{
    STANDING_NPC_TRADE_COINS_PER_POINT, STANDING_RANGE, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::world::{
    Building, Carriage, City, Realm, Resident, Standing, StandingMove, Stock, WorldState,
};

use crate::queries::js_round;
use crate::queries::standing::{standing_of, standing_organization, TRADE_ORG};

pub use crate::order_sender::OrderSender;

/// The Player's realm (`realmOf`). TODO(T86.8): `starting_city.rs`.
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<&Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

/// A new id from the world's counter (`newId`). By `random::new_id`.
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

pub use crate::events::record_event;

/// The Organization a resident belongs to (`organizationOf`). TODO(T86.7): `crimes.rs`.
pub fn organization_of(r: &Resident) -> Option<String> {
    r.owner.clone().or_else(|| r.city_id.clone())
}

/// The Organization a city belongs to (`cityOrganization`). TODO(T86.7): `crimes.rs`.
pub fn city_organization(c: &City) -> String {
    c.realm_id.clone().unwrap_or_else(|| c.id.clone())
}

/// The Organization a building belongs to (`buildingOrganization`). TODO(T86.7): `crimes.rs`.
pub fn building_organization(world: &WorldState, b: &Building) -> Option<String> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.clone();
    }
    match world.cities.iter().find(|c| b.city_id.as_deref() == Some(c.id.as_str())) {
        Some(city) => Some(city_organization(city)),
        None => b.realm_id.clone(),
    }
}

/// The Organization a carriage belongs to (`carriageOrganization`). TODO(T86.7): `crimes.rs`.
pub fn carriage_organization(k: &Carriage) -> Option<String> {
    k.realm_id.clone().or_else(|| k.city_id.clone())
}

/// Commits a crime (`commitCrime`). TODO(T86.7): `crimes.rs`; a no-op until then.
pub fn commit_theft(
    _world: &mut WorldState,
    _size: i32,
    _thief: usize,
    _victim_org: &str,
    _goods: &Stock,
    _victim: Option<usize>,
) {
}

/// Raises the alarm of a theft (`raiseTheft`). TODO(T86.7): `alarms.rs`; a no-op until then.
pub fn raise_theft(_world: &mut WorldState, _thief: usize, _victim_org: &str, _size: i32) {}

/// Finishes a site with all its materials and work (`finishSite`), returning whether it did.
/// TODO(T86.6): `building.rs`; a no-op until then.
pub fn finish_site(_world: &mut WorldState, _site: usize, _by: usize) -> bool {
    false
}

/// Updates who lives in which city (`updateCityMembership`). TODO(T86.8): `cities.rs`.
pub fn update_city_membership(_world: &mut WorldState, _size: i32) {}

/// Robs a caravan (`robCaravan`). TODO(T86.9): `caravans.rs`.
pub fn rob_caravan(
    _world: &mut WorldState,
    _thief: usize,
    _carriage_id: &str,
    _robbed: &mut std::collections::HashSet<String>,
) {
}

/// Robs a wandering trader (`robTrader`). TODO(T86.10): `traders.rs`.
pub fn rob_trader(
    _world: &mut WorldState,
    _thief: usize,
    _carriage_id: &str,
    _robbed: &mut std::collections::HashSet<String>,
) {
}

/// Whether a caravan resident collects a pick-up at the storage (`collectsFrom`).
/// TODO(T86.9): `deliveries.rs`.
pub fn collects_from(_world: &WorldState, _r: &Resident, _storage_id: &str) -> bool {
    false
}

/// Whether a caravan resident collects a transfer at the storage (`collectsTransferFrom`).
/// TODO(T86.9): `transfers.rs`.
pub fn collects_transfer_from(_world: &WorldState, _r: &Resident, _storage_id: &str) -> bool {
    false
}

pub use crate::survival::drop_goods;

/// Changes how `of` regards `toward` by `delta` (`changeStanding`). TODO(T86.7): `standing.rs`.
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

/// Raises standing by `delta` both ways (`raiseStandingBothWays`). TODO(T86.7): `standing.rs`.
pub fn raise_standing_both_ways(world: &mut WorldState, a: &str, b: &str, delta: f64) {
    change_standing(world, a, b, delta);
    change_standing(world, b, a, delta);
}

/// Coins of trade that raise standing by a point (`tradeCoinsPerPoint`).
fn trade_coins_per_point(world: &WorldState, a: &str, b: &str) -> f64 {
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

/// How Players call an Organization (`organizationLabel`).
fn organization_label(world: &WorldState, org: &str) -> String {
    if org == TRADE_ORG {
        return "the Trade Organization".into();
    }
    if let Some(city) = world.cities.iter().find(|c| c.id == org) {
        return city.name.clone();
    }
    let realm = world.realms.iter().find(|r| r.id == org);
    if let Some(name) = realm.and_then(|r| r.name.clone()) {
        return name;
    }
    realm
        .and_then(|r| world.residents.iter().find(|x| x.id == r.leader_id))
        .map_or_else(|| "a fallen realm".into(), |l| l.name.clone())
}

/// A trade of `coins` raises standing both ways (`raiseStandingByTrade`); how far it moved
/// `org`'s regard for the realm. TODO(T86.7): `standing.rs`.
pub fn raise_standing_by_trade(
    world: &mut WorldState,
    realm: &str,
    org: &str,
    coins: f64,
) -> Option<StandingMove> {
    let before = standing_of(world, org, realm);
    let per = trade_coins_per_point(world, realm, org);
    raise_standing_both_ways(world, realm, org, coins / per);
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

/// A city joins a realm with everything in it (`joinRealm`); how many residents came.
/// TODO(T86.7): `capture.rs`; a no-op until then.
pub fn join_realm(_world: &mut WorldState, _city: usize, _realm: &str, _size: i32) -> f64 {
    0.0
}

/// Ends any breeding a horse is part of (`endBreedingOf`). TODO(T86.8): `breeding.rs`.
pub fn end_breeding_of(_world: &mut WorldState, _horse_id: &str) {}

/// Hands in a transfer at a Trade Org warehouse (`handIn`), paying from `payer`; whether it was
/// handed in. TODO(T86.9): `transfers.rs`; a no-op until then.
pub fn hand_in(
    _world: &mut WorldState,
    _size: i32,
    _resident: usize,
    _realm: &str,
    _order: &csp_shared::world::HandInOrder,
    _warehouse: usize,
    _payer: crate::holders::Holder,
) -> bool {
    false
}
