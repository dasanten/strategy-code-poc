//! Mercenary contracts (`apps/server/src/contracts.ts`, `CONTEXT.md`: Mercenary contract, Trade
//! Org army, Hiring from an NPC city): one realm rents some of its residents to another for coins
//! over a number of game days. One side offers, the other accepts; each game week is paid in
//! advance with a pay order; a week that ends unpaid breaks the contract; at the end the residents
//! walk home. A side is a Player's realm, the Trade Organization (`TRADE_ORG`) or an NPC city.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    CONTRACT_MAX_DAYS, MAP_SIZE, SIGHT_RANGE, STANDING_CONTRACT_BROKEN_LOSS, STANDING_PER_PAID_WEEK,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::world::{
    BuildingKind, ContractSide, ContractWhat, Good, MercenaryContract, OrderRequest, PayOrder,
    RealmEventWhat, Resident, ResidentOrder, WorldState,
};
use serde_json::Value;

use crate::armies::leave_armies;
use crate::events::record_event;
use crate::npc_behaviour::walk_to;
use crate::order_sender::{realm_of, OrderSender};
use crate::orders::{str_field, OrderKind};
use crate::queries::alliance::realm_name;
use crate::queries::alliance::{commander_of, handed_over_to};
use crate::queries::city::building_realm;
use crate::queries::city::{for_sale, npc_city_refuses, town_hall_of};
use crate::queries::contract::{contract_ends_at, contract_pay_by, contract_weeks};
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::spare_residents;
use crate::queries::standing::organization_label;
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::{contract_side, trade_org_hq};
use crate::random::new_id;
use crate::sight::InvariantViolation;
use crate::standing::{change_standing, raise_standing_both_ways};
use crate::trade_org_army::spare_soldiers;

/// The NPC city an id names, if it is one (`npcCity`: `forSale`).
fn npc_city<'w>(world: &'w WorldState, id: Option<&str>) -> Option<&'w csp_shared::world::City> {
    world.cities.iter().find(|c| Some(c.id.as_str()) == id).filter(|c| for_sale(c))
}

/// The side whose storage it is (`storageRealm`): the realm of a finished storage's city or of an
/// outpost storage, the city itself for an NPC city's, `TRADE_ORG` for a finished warehouse of a
/// Trade Org city.
fn storage_realm(world: &WorldState, storage_id: Option<&str>) -> Option<String> {
    let b = world.buildings.iter().find(|x| Some(x.id.as_str()) == storage_id)?;
    if b.site.is_some() {
        return None;
    }
    let city = world.cities.iter().find(|c| b.city_id.as_ref() == Some(&c.id));
    match b.kind {
        BuildingKind::Storage => match city.filter(|c| for_sale(c)) {
            Some(c) => Some(c.id.clone()),
            None => building_realm(world, b).map(str::to_string),
        },
        BuildingKind::Warehouse if city.is_some_and(|c| c.trade_org.is_some()) => {
            Some(TRADE_ORG.to_string())
        }
        _ => None,
    }
}

/// Whether a contract side exists (`sideExists`): a realm, the Trade Organization while it has its
/// HQ, or an NPC city while it is one.
fn side_exists(world: &WorldState, id: &str) -> bool {
    if id == TRADE_ORG {
        return trade_org_hq(world).is_some();
    }
    world.realms.iter().any(|r| r.id == id) || npc_city(world, Some(id)).is_some()
}

/// Whether the resident is a realm's Leader, whom nobody hires (`isLeader`).
fn is_leader(world: &WorldState, id: &str) -> bool {
    world.realms.iter().any(|r| r.leader_id == id)
}

/// Whether the resident is named in any contract, offered or in force (`contracted`).
fn contracted(world: &WorldState, id: &str) -> bool {
    world.contracts.iter().any(|c| c.resident_ids.iter().any(|x| x == id))
}

/// Whether any of the realm's residents sees the spot (`inSightOf`).
fn in_sight_of(world: &WorldState, realm_id: &str, at: &Resident, size: i32) -> bool {
    let spot = (at.x as i32, at.y as i32);
    world.residents.iter().any(|x| {
        commander_of(world, &x.id, x.owner.as_deref()).as_deref() == Some(realm_id)
            && wrap_distance(size, (x.x as i32, x.y as i32), spot) <= SIGHT_RANGE
    })
}

/// `Number.isInteger(v)`.
fn integer(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    (n.is_finite() && n.fract() == 0.0).then_some(n)
}

/// The residents an offer names (`offeredResidents`): `residentIds`, or that many of the Trade
/// Organization's spare `soldiers`, or of an NPC city's spare `residents`. A reason when they
/// can't be.
fn offered_residents(world: &WorldState, order: &OrderRequest) -> Result<Vec<Value>, String> {
    let realm_id = str_field(order, "realmId");
    if let Some(city) = npc_city(world, realm_id) {
        let n = integer(order.fields.get("residents")).filter(|&n| n >= 1.0);
        let Some(n) = n else { return Err("ask for a whole number of residents".into()) };
        let spare = spare_residents(world, city, None);
        if (spare.len() as f64) < n {
            return Err(format!("{} can spare only {} residents", city.name, spare.len()));
        }
        return Ok(spare.iter().take(n as usize).map(|r| Value::String(r.id.clone())).collect());
    }
    if realm_id != Some(TRADE_ORG) || !order.fields.contains_key("soldiers") {
        return Ok(order
            .fields
            .get("residentIds")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default());
    }
    if trade_org_hq(world).is_none() {
        return Err("the Trade Organization has had no army since its HQ fell".into());
    }
    let Some(n) = integer(order.fields.get("soldiers")).filter(|&n| n >= 1.0) else {
        return Err("ask for a whole number of soldiers".into());
    };
    let spare = spare_soldiers(world);
    if (spare.len() as f64) < n {
        return Err(format!("the Trade Organization can spare only {} soldiers", spare.len()));
    }
    Ok(spare.iter().take(n as usize).map(|r| Value::String(r.id.clone())).collect())
}

/// An offer's terms as plain data, or a reason they are not good (`readOffer`).
fn read_offer(
    world: &WorldState,
    realm_id: &str,
    order: &OrderRequest,
    size: Option<i32>,
) -> Result<MercenaryContract, String> {
    let ids = offered_residents(world, order)?;
    if ids.is_empty() {
        return Err("a contract needs at least one resident".into());
    }
    let distinct: HashSet<String> = ids.iter().map(Value::to_string).collect();
    if distinct.len() != ids.len() {
        return Err("a resident is named twice".into());
    }
    let residents: Option<Vec<&Resident>> = ids
        .iter()
        .map(|id| world.residents.iter().find(|r| Some(r.id.as_str()) == id.as_str()))
        .collect();
    let Some(residents) = residents else { return Err("no such resident".into()) };
    let ids: Vec<String> = residents.iter().map(|r| r.id.clone()).collect();
    let lender_id = contract_side(world, residents[0]);
    let Some(lender_id) =
        lender_id.filter(|l| residents.iter().all(|r| contract_side(world, r).as_ref() == Some(l)))
    else {
        return Err("the residents must all be of one realm".into());
    };
    if ids.iter().any(|id| contracted(world, id)) {
        return Err("a resident is already in a contract".into());
    }
    if ids.iter().any(|id| handed_over_to(world, id).is_some()) {
        return Err("a resident is in an alliance army".into());
    }
    if ids.iter().any(|id| is_leader(world, id)) {
        return Err("a Leader is never hired out".into());
    }
    let to = str_field(order, "realmId");
    let hirer_id = if lender_id == realm_id {
        if to == Some(TRADE_ORG) {
            return Err("the Trade Organization hires only by its own offers".into());
        }
        let Some(to) = to.filter(|to| world.realms.iter().any(|r| r.id == *to)) else {
            return Err("offer them to a realm".into());
        };
        if to == realm_id {
            return Err("offer them to another realm".into());
        }
        to.to_string()
    } else if lender_id == TRADE_ORG {
        // It hires out its spare soldiers wherever they are, seen or not.
        let spare: HashSet<&str> = spare_soldiers(world).iter().map(|r| r.id.as_str()).collect();
        if !ids.iter().all(|id| spare.contains(id.as_str())) {
            return Err("the Trade Organization can’t spare those residents".into());
        }
        realm_id.to_string()
    } else if npc_city(world, Some(&lender_id)).is_some() {
        // An NPC city lends only by being asked for a number of its residents, wherever they are.
        if to != Some(lender_id.as_str()) {
            return Err("ask the city for a number of its residents".into());
        }
        realm_id.to_string()
    } else {
        if !world.realms.iter().any(|r| r.id == lender_id) {
            return Err("the residents must be of a realm".into());
        }
        if size.is_some_and(|size| !residents.iter().all(|r| in_sight_of(world, realm_id, r, size)))
        {
            return Err("those residents are out of sight".into());
        }
        realm_id.to_string()
    };
    let days =
        integer(order.fields.get("days")).filter(|&d| (1.0..=CONTRACT_MAX_DAYS).contains(&d));
    let Some(days) = days else {
        return Err(format!("a contract runs 1 to {CONTRACT_MAX_DAYS} game days"));
    };
    let Some(price) = integer(order.fields.get("pricePerWeek")).filter(|&p| p >= 1.0) else {
        return Err("the price is a whole number of coins a week, at least 1".into());
    };
    let storage_id = str_field(order, "storageId");
    if storage_realm(world, storage_id).as_deref() != Some(lender_id.as_str()) {
        if lender_id == TRADE_ORG {
            return Err("the coins go into a warehouse of the Trade Organization".into());
        }
        return Err(if npc_city(world, Some(&lender_id)).is_some() {
            "the coins go into a storage of the city".into()
        } else {
            "the coins go into a storage of the realm renting them out".into()
        });
    }
    // A city that refuses the hirer says so at once; a low price it declines like any offer.
    if let Some(city) = npc_city(world, Some(&lender_id)) {
        if npc_city_refuses(world, city, &hirer_id) {
            return Err(format!("{} won’t hire out to you", city.name));
        }
    }
    let offered_by = if lender_id == realm_id { ContractSide::Lender } else { ContractSide::Hirer };
    Ok(MercenaryContract {
        id: String::new(),
        lender_id,
        hirer_id,
        offered_by,
        resident_ids: ids,
        days,
        price_per_week: price,
        storage_id: storage_id.expect("a storage of the lender").to_string(),
        started_at: None,
        paid_weeks: 0.0,
    })
}

/// An event about the contract for both its sides (`tellBoth`).
fn tell_both(
    world: &mut WorldState,
    c: &MercenaryContract,
    what: ContractWhat,
    weeks: Option<f64>,
    leader_died: Option<ContractSide>,
) {
    let event = |lender: bool, other: String| RealmEventWhat::Contract {
        contract_id: c.id.clone(),
        what,
        lender,
        other,
        residents: c.resident_ids.len() as f64,
        weeks,
        leader_died,
    };
    let to_lender = event(true, organization_label(world, &c.hirer_id));
    record_event(world, Some(&c.lender_id), to_lender);
    let to_hirer = event(false, organization_label(world, &c.lender_id));
    record_event(world, Some(&c.hirer_id), to_hirer);
}

type Check = fn(&WorldState, &str, &OrderRequest, Option<i32>) -> Option<String>;
type Act = fn(&mut WorldState, &str, &OrderRequest);

/// A contract order (`contractOrderKind`): `check` gives a reason to reject it, on a map of
/// `size` tiles when known.
pub struct ContractOrder {
    check: Check,
    act: Act,
}

impl OrderKind for ContractOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(realm) = realm_of(world, sender.user_id) else {
            return Some("you have no realm".into());
        };
        (self.check)(world, &realm.id, order, terrain.map(|t| t.size))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some(realm_id) = realm_of(world, sender.user_id).map(|r| r.id.clone()) else { return };
        if (self.check)(world, &realm_id, order, None).is_none() {
            (self.act)(world, &realm_id, order);
        }
    }
}

/// Offering a contract (`offerContract`).
pub const OFFER_CONTRACT: ContractOrder = ContractOrder {
    check: |world, realm_id, order, size| read_offer(world, realm_id, order, size).err(),
    act: |world, realm_id, order| {
        let mut c = read_offer(world, realm_id, order, None).expect("checked");
        c.id = new_id("contract", &mut world.next_id);
        let to = if c.offered_by == ContractSide::Lender {
            c.hirer_id.clone()
        } else {
            c.lender_id.clone()
        };
        let what = RealmEventWhat::Contract {
            contract_id: c.id.clone(),
            what: ContractWhat::Offered,
            lender: c.offered_by == ContractSide::Hirer,
            other: realm_name(world, realm_id),
            residents: c.resident_ids.len() as f64,
            weeks: None,
            leader_died: None,
        };
        world.contracts.push(c);
        record_event(world, Some(&to), what);
    },
};

/// The offer named by `contractId` that the realm is a side of, or a reason (`offerOf`).
fn offer_of(world: &WorldState, realm_id: &str, order: &OrderRequest) -> Result<usize, String> {
    let id = str_field(order, "contractId");
    let i = world
        .contracts
        .iter()
        .position(|c| {
            Some(c.id.as_str()) == id && (c.lender_id == realm_id || c.hirer_id == realm_id)
        })
        .ok_or("no such contract")?;
    if world.contracts[i].started_at.is_some() {
        return Err("that contract is already in force".into());
    }
    Ok(i)
}

/// A reason the offer can't start now, if any (`cannotStart`): its residents or storage changed
/// hands.
pub fn cannot_start(world: &WorldState, c: &MercenaryContract) -> Option<String> {
    let lenders = |id: &String| {
        world.residents.iter().any(|r| {
            r.id == *id && contract_side(world, r).as_deref() == Some(c.lender_id.as_str())
        })
    };
    if !c.resident_ids.iter().all(lenders) {
        return Some("the residents are no longer all the lender’s".into());
    }
    if c.resident_ids.iter().any(|id| is_leader(world, id)) {
        return Some("a Leader is never hired out".into());
    }
    if storage_realm(world, Some(&c.storage_id)).as_deref() != Some(c.lender_id.as_str()) {
        return Some("the storage is no longer the lender’s".into());
    }
    None
}

/// Puts an offer in force from now (`startContract`): its residents stop what they were doing,
/// scripts included, and wait for the hirer's orders.
pub fn start_contract(world: &mut WorldState, i: usize) {
    world.contracts[i].started_at = Some(world.tick as f64);
    let ids: HashSet<String> = world.contracts[i].resident_ids.iter().cloned().collect();
    for r in &mut world.residents {
        if !ids.contains(&r.id) {
            continue;
        }
        r.order = None;
        r.script = None;
        r.interrupted = None;
    }
    let c = world.contracts[i].clone();
    tell_both(world, &c, ContractWhat::Started, None, None);
}

/// Accepting an offer the other side made (`acceptContract`).
pub const ACCEPT_CONTRACT: ContractOrder = ContractOrder {
    check: |world, realm_id, order, _size| {
        let i = match offer_of(world, realm_id, order) {
            Ok(i) => i,
            Err(e) => return Some(e),
        };
        let c = &world.contracts[i];
        let mine = if c.offered_by == ContractSide::Lender { &c.hirer_id } else { &c.lender_id };
        if mine != realm_id {
            return Some("the other side has to accept your offer".into());
        }
        cannot_start(world, c)
    },
    act: |world, _realm_id, order| {
        let id = str_field(order, "contractId");
        let i = world.contracts.iter().position(|x| Some(x.id.as_str()) == id).expect("checked");
        start_contract(world, i);
    },
};

/// Declining an offer, or taking back one's own (`cancelContract`).
pub const CANCEL_CONTRACT: ContractOrder = ContractOrder {
    check: |world, realm_id, order, _size| offer_of(world, realm_id, order).err(),
    act: |world, _realm_id, order| {
        let id = str_field(order, "contractId").map(str::to_string);
        world.contracts.retain(|x| Some(&x.id) != id.as_ref());
    },
};

/// A reason the resident can't pay `weeks` of the contract now, if any (`cannotPay`).
fn cannot_pay(
    world: &WorldState,
    r: &Resident,
    c: Option<&MercenaryContract>,
    weeks: Option<&Value>,
) -> Option<String> {
    let Some(c) = c.filter(|c| c.started_at.is_some()) else {
        return Some("no such contract in force".into());
    };
    let Some(weeks) = integer(weeks).filter(|&w| w >= 1.0) else {
        return Some("pay for a whole number of weeks".into());
    };
    if weeks > contract_weeks(c) - c.paid_weeks {
        return Some("that is more weeks than are left".into());
    }
    let b = world.buildings.iter().find(|x| x.id == c.storage_id);
    if b.is_none_or(|b| !is_at((r.x as i32, r.y as i32), placed(b), MAP_SIZE)) {
        return Some("the resident must stand at the contract’s storage".into());
    }
    if held(&r.carried, Good::Coins) < weeks * c.price_per_week {
        return Some("the resident doesn’t carry enough coins".into());
    }
    None
}

/// The pay order (`pay`): one of the hirer's residents, standing on the contract's storage, puts
/// in the coins for `weeks` game weeks. It happens this tick.
pub struct Pay;

impl OrderKind for Pay {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let (Some(realm), Some(r)) = (realm, r) else {
            return Some("not one of your residents".into());
        };
        if commander_of(world, &r.id, r.owner.as_deref()).as_deref() != Some(realm.id.as_str()) {
            return Some("not one of your residents".into());
        }
        let c =
            world.contracts.iter().find(|x| Some(x.id.as_str()) == str_field(order, "contractId"));
        if c.is_some_and(|c| c.hirer_id != realm.id) {
            return Some("you are not the hirer of that contract".into());
        }
        cannot_pay(world, r, c, order.fields.get("weeks"))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        let contract_id = str_field(order, "contractId").unwrap_or_default().to_string();
        let weeks = order.fields.get("weeks").and_then(Value::as_f64).unwrap_or(0.0);
        if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
            r.order = Some(ResidentOrder::Pay(PayOrder { contract_id, weeks }));
        }
    }
}

/// The contract order kinds, besides the resident's pay order (`contractOrders`).
pub fn contract_orders() -> Vec<(&'static str, ContractOrder)> {
    vec![
        ("offerContract", OFFER_CONTRACT),
        ("acceptContract", ACCEPT_CONTRACT),
        ("cancelContract", CANCEL_CONTRACT),
    ]
}

/// Puts the coins for `weeks` game weeks into the contract's storage and counts them as paid
/// (`payInto`); each week raises standing both ways between its sides.
pub fn pay_into(world: &mut WorldState, i: usize, weeks: f64) {
    let c = world.contracts[i].clone();
    let storage =
        world.buildings.iter_mut().find(|b| b.id == c.storage_id).expect("the contract's storage");
    let stock = storage.stock.get_or_insert_with(Default::default);
    let coins = held(stock, Good::Coins) + weeks * c.price_per_week;
    stock.insert(Good::Coins, coins);
    world.contracts[i].paid_weeks += weeks;
    raise_standing_both_ways(world, &c.lender_id, &c.hirer_id, weeks * STANDING_PER_PAID_WEEK);
    let c = world.contracts[i].clone();
    tell_both(world, &c, ContractWhat::Paid, Some(weeks), None);
}

/// Carries out pay orders (`resolvePayments`): each payer who still can puts the coins into the
/// storage. Either way the order is done. Returns how many paid.
pub fn resolve_payments(world: &mut WorldState) -> usize {
    let mut paid = 0;
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::Pay(o)) = world.residents[ri].order.clone() else { continue };
        world.residents[ri].order = None;
        let Some(i) = world.contracts.iter().position(|x| x.id == o.contract_id) else { continue };
        let weeks = Value::from(o.weeks);
        if cannot_pay(world, &world.residents[ri], Some(&world.contracts[i]), Some(&weeks))
            .is_some()
        {
            continue;
        }
        let coins = o.weeks * world.contracts[i].price_per_week;
        let carried = &mut world.residents[ri].carried;
        let left = held(carried, Good::Coins) - coins;
        if left > 0.0 {
            carried.insert(Good::Coins, left);
        } else {
            carried.shift_remove(&Good::Coins);
        }
        pay_into(world, i, o.weeks);
        paid += 1;
    }
    paid
}

/// Sends a resident whose contract is over home to their city, if it still stands (`sendHome`).
fn send_home(world: &mut WorldState, ri: usize) {
    world.residents[ri].script = None;
    world.residents[ri].order = None;
    let r = &world.residents[ri];
    let hall = world
        .cities
        .iter()
        .find(|c| r.city_id.as_ref() == Some(&c.id))
        .and_then(|c| town_hall_of(world, c));
    if let Some(hall) = hall {
        if !is_at((r.x as i32, r.y as i32), placed(hall), MAP_SIZE) {
            let (x, y) = (hall.x, hall.y);
            walk_to(&mut world.residents[ri], (x, y));
        }
    }
}

/// The residents named by `ids`, by index.
fn indices_of(world: &WorldState, ids: &HashSet<String>) -> Vec<usize> {
    world
        .residents
        .iter()
        .enumerate()
        .filter(|(_, r)| ids.contains(&r.id))
        .map(|(i, _)| i)
        .collect()
}

/// A side's Leader died (`endContractsOnLeaderDeath`): every contract of the realm ends at once,
/// costing no standing; the rented residents walk home and leave the hirer's armies; offers lapse.
pub fn end_contracts_on_leader_death(world: &mut WorldState, realm_id: &str) {
    let (ending, kept): (Vec<_>, Vec<_>) =
        world.contracts.drain(..).partition(|c| c.lender_id == realm_id || c.hirer_id == realm_id);
    world.contracts = kept;
    for c in ending {
        if c.started_at.is_none() {
            continue;
        }
        let ids: HashSet<String> = c.resident_ids.iter().cloned().collect();
        for ri in indices_of(world, &ids) {
            send_home(world, ri);
        }
        leave_armies(world, &ids);
        let died = if c.lender_id == realm_id { ContractSide::Lender } else { ContractSide::Hirer };
        tell_both(world, &c, ContractWhat::Ended, None, Some(died));
    }
}

/// The Trade Org HQ fell (`endTradeOrgContracts`): every contract with it ends at once. Soldiers
/// it had hired out stop where they stand; mercenaries it had hired walk home. Offers lapse.
pub fn end_trade_org_contracts(world: &mut WorldState) {
    let (ending, kept): (Vec<_>, Vec<_>) = world
        .contracts
        .drain(..)
        .partition(|c| c.lender_id == TRADE_ORG || c.hirer_id == TRADE_ORG);
    world.contracts = kept;
    for c in ending {
        if c.started_at.is_none() {
            continue;
        }
        let ids: HashSet<String> = c.resident_ids.iter().cloned().collect();
        for ri in indices_of(world, &ids) {
            if c.hirer_id == TRADE_ORG {
                send_home(world, ri);
            } else {
                world.residents[ri].script = None;
                world.residents[ri].order = None;
            }
        }
        leave_armies(world, &ids);
        tell_both(world, &c, ContractWhat::Ended, None, None);
    }
}

/// Keeps contracts sound and ends them, as a tick ends (`stepContracts`): residents who died or
/// left the lender drop out; a contract left with nobody or a side that ended is gone, as is an
/// offer whose storage is no longer the lender's. One in force ends when its time is up, and
/// breaks once a week ends unpaid, costing standing with the lender; its residents walk home.
pub fn step_contracts(world: &mut WorldState) {
    if world.contracts.is_empty() {
        return;
    }
    let by_id: HashMap<String, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
    let mut kept = Vec::new();
    let contracts = std::mem::take(&mut world.contracts);
    for mut c in contracts {
        c.resident_ids.retain(|id| {
            by_id.get(id).is_some_and(|&i| {
                contract_side(world, &world.residents[i]).as_deref() == Some(c.lender_id.as_str())
            })
        });
        let sound = !c.resident_ids.is_empty()
            && side_exists(world, &c.lender_id)
            && side_exists(world, &c.hirer_id);
        let Some(started_at) = c.started_at else {
            if sound
                && storage_realm(world, Some(&c.storage_id)).as_deref()
                    == Some(c.lender_id.as_str())
            {
                kept.push(c);
            }
            continue;
        };
        let pay_by = contract_pay_by(&c);
        let tick = world.tick as f64;
        let over = !sound || tick >= contract_ends_at(&c, started_at);
        let broken = pay_by.is_some_and(|p| tick >= p);
        if !over && !broken {
            kept.push(c);
            continue;
        }
        for id in &c.resident_ids {
            send_home(world, by_id[id]);
        }
        if broken && sound {
            change_standing(world, &c.lender_id, &c.hirer_id, -STANDING_CONTRACT_BROKEN_LOSS);
        }
        if !c.resident_ids.is_empty() {
            tell_both(
                world,
                &c,
                if broken { ContractWhat::Broken } else { ContractWhat::Ended },
                None,
                None,
            );
        }
    }
    world.contracts = kept;
}

/// The invariant `contracts-sound` (`contractsSound`): two different sides that exist, residents
/// who live and are the lender's, none in two contracts, a positive length and price, a storage
/// that exists while offered, no more weeks paid than it has; one in force has every ended week
/// paid and has not run past its time.
pub fn contracts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut report = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation { invariant: "contracts-sound".into(), message, entity_ids });
    };
    let by_id: HashMap<&str, &Resident> =
        world.residents.iter().map(|r| (r.id.as_str(), r)).collect();
    let mut seen = HashSet::new();
    for c in &world.contracts {
        let id = c.id.clone();
        if c.lender_id == c.hirer_id {
            report(format!("contract {id} rents to its own lender"), vec![id.clone()]);
        }
        for realm in [&c.lender_id, &c.hirer_id] {
            if !side_exists(world, realm) {
                report(
                    format!("contract {id} has realm {realm}, which does not exist"),
                    vec![id.clone()],
                );
            }
        }
        if c.resident_ids.is_empty() {
            report(format!("contract {id} has no residents"), vec![id.clone()]);
        }
        for rid in &c.resident_ids {
            match by_id.get(rid.as_str()) {
                None => report(
                    format!("contract {id} has resident {rid}, who does not exist"),
                    vec![id.clone(), rid.clone()],
                ),
                Some(r) if contract_side(world, r).as_deref() != Some(c.lender_id.as_str()) => {
                    report(
                        format!("contract {id} rents out {rid}, who is not the lender’s"),
                        vec![id.clone(), rid.clone()],
                    )
                }
                Some(_) => {}
            }
            if !seen.insert(rid.clone()) {
                report(format!("resident {rid} is in two contracts"), vec![rid.clone()]);
            }
        }
        // `!(n >= 1)`: NaN fails too.
        let at_least_one = |n: f64| n.partial_cmp(&1.0).is_some_and(std::cmp::Ordering::is_ge);
        if !at_least_one(c.days) || !at_least_one(c.price_per_week) {
            report(format!("contract {id} has no length or price"), vec![id.clone()]);
        }
        if !world.buildings.iter().any(|b| b.id == c.storage_id) && c.started_at.is_none() {
            report(
                format!("contract {id} is offered with storage {}, which is gone", c.storage_id),
                vec![id.clone()],
            );
        }
        let weeks = contract_weeks(c);
        if c.paid_weeks < 0.0 || c.paid_weeks > weeks {
            report(
                format!("contract {id} has {} weeks paid of {}", js(c.paid_weeks), js(weeks)),
                vec![id.clone()],
            );
        }
        let Some(started_at) = c.started_at else {
            if c.paid_weeks != 0.0 {
                report(format!("contract {id} is only offered but paid"), vec![id.clone()]);
            }
            continue;
        };
        let tick = world.tick as f64;
        if contract_pay_by(c).is_some_and(|p| tick >= p) {
            report(format!("contract {id} has a week that ended unpaid"), vec![id.clone()]);
        }
        if tick >= contract_ends_at(c, started_at) {
            report(format!("contract {id} ran past its time"), vec![id.clone()]);
        }
    }
    out
}

/// A number as a template string prints it, for the whole numbers the messages hold.
fn js(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests;
