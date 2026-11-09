//! World queries about demands (`packages/shared/src/demand.ts`, `CONTEXT.md`: Demand; ADR 0002:
//! the API orders and scripts share).

use std::collections::HashSet;

use csp_shared::balance::{
    DEMANDS_PER_GAME_DAY, DEMAND_NOTE_MAX_LENGTH, DEMAND_YIELD_RESPECT_MIN,
    DEMAND_YIELD_RESPECT_TIMES,
};
use csp_shared::goods::GOODS;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, City, Demand, DemandTerms, Good, Realm, Remembered, Stock, WorldState,
};
use serde_json::Value;

use super::alliance::sharing_sight;
use super::alliance_rules::is_alliance_city;
use super::city::for_sale;
use super::names::good_of;
use super::offers::{free_stock, offer_storage};
use super::persuasion::{city_soldiers, respect_seen_by};
use super::residents::good_weight;
use super::standing::TRADE_ORG;
use super::trade_org::{trade_org_hq, NO_CARAVANS};
use super::transfer::{pick_up_transfer_problem, transfer_fee, transfer_load, transfer_warehouses};
use super::warehouse_trade::delivery_storage;

/// What is wrong with a demand's note, if anything (`demandNoteProblem`): it must be text,
/// trimmed not empty, at most `DEMAND_NOTE_MAX_LENGTH` characters and free of control characters
/// but tab and line breaks.
pub fn demand_note_problem(note: Option<&Value>) -> Option<String> {
    let Some(note) = note.and_then(Value::as_str).filter(|n| !js_trim(n).is_empty()) else {
        return Some("a demand needs a note".into());
    };
    if js_trim(note).encode_utf16().count() as f64 > DEMAND_NOTE_MAX_LENGTH {
        return Some(format!("a note is at most {DEMAND_NOTE_MAX_LENGTH} characters"));
    }
    let control =
        |c: char| matches!(c as u32, 0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f..=0x9f);
    if note.chars().any(control) {
        return Some("a note can’t hold control characters".into());
    }
    None
}

/// `String.prototype.trim`: JavaScript's whitespace and line terminators, and the BOM.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// When the realm sent the demands that still count against `DEMANDS_PER_GAME_DAY`
/// (`demandsCounted`).
pub fn demands_counted(realm: &Realm, tick: f64) -> Vec<f64> {
    let sent = realm.demands_sent_at.as_deref().unwrap_or_default();
    sent.iter().copied().filter(|at| tick - at < TICKS_PER_GAME_DAY).collect()
}

/// How many more demands the realm may send now (`demandsLeft`).
pub fn demands_left(realm: &Realm, tick: f64) -> f64 {
    (DEMANDS_PER_GAME_DAY - demands_counted(realm, tick).len() as f64).max(0.0)
}

/// The other realms a realm knows of (`realmsKnownTo`, `CONTEXT.md`: Demand): those it sees
/// residents of (`seen_realms`, which may hold anything else too), its allies, those whose cities
/// it has seen (Last seen), those with a standing toward it or it toward them, and its sides in
/// contracts, demands and Direct offers. In the world's order of realms.
pub fn realms_known_to<'a>(
    world: &WorldState,
    realm_id: &str,
    seen_realms: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let mut known: HashSet<&str> = seen_realms.into_iter().collect();
    let allies = sharing_sight(world, realm_id);
    known.extend(allies.iter().map(String::as_str));
    let user_id = world.realms.iter().find(|r| r.id == realm_id).map(|r| r.user_id);
    for m in user_id.and_then(|u| world.last_seen.get(&u)).into_iter().flatten() {
        if let Remembered::City(c) = m {
            if let Some(r) = c.realm_id.as_deref() {
                known.insert(r);
            }
        }
    }
    for s in &world.standings {
        if s.of == realm_id {
            known.insert(&s.toward);
        }
        if s.toward == realm_id {
            known.insert(&s.of);
        }
    }
    for c in &world.contracts {
        if c.lender_id == realm_id {
            known.insert(&c.hirer_id);
        }
        if c.hirer_id == realm_id {
            known.insert(&c.lender_id);
        }
    }
    for d in &world.demands {
        if d.from_id == realm_id {
            known.insert(&d.to_id);
        }
        if d.to_id == realm_id {
            known.insert(&d.from_id);
        }
    }
    for o in &world.offers {
        let Some(direct) = &o.direct else { continue };
        if o.realm_id == realm_id {
            known.insert(&direct.to_id);
        }
        if direct.to_id == realm_id {
            known.insert(&o.realm_id);
        }
    }
    world
        .realms
        .iter()
        .filter(|r| r.id != realm_id && known.contains(r.id.as_str()))
        .map(|r| r.id.clone())
        .collect()
}

/// Why the game answers demands sent to `id` (`answeredByGame`, `CONTEXT.md`: Demand).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnsweredBy {
    TradeOrg,
    City,
}

/// Whether the game answers demands sent to `id`, and why (`answeredByGame`): the Trade
/// Organization, or a city by its id. `None` for a realm, or nothing at all.
pub fn answered_by_game(world: &WorldState, id: &str) -> Option<AnsweredBy> {
    if id == TRADE_ORG {
        return Some(AnsweredBy::TradeOrg);
    }
    world.cities.iter().any(|c| c.id == id).then_some(AnsweredBy::City)
}

/// Whom else a realm can send a demand, for the game to answer (`npcOrgsKnownTo`): the Trade
/// Organization, which everyone knows of, and the NPC cities it knows of: those it sees (`seen`,
/// which may hold anything else too), those it last saw as NPC cities, and those with a standing
/// either way.
pub fn npc_orgs_known_to<'a>(
    world: &WorldState,
    realm_id: &str,
    seen: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let mut known: HashSet<String> = HashSet::new();
    for id in seen {
        if is_alliance_city(world, id) {
            known.insert(id.to_string());
        }
    }
    for s in &world.standings {
        if s.toward == realm_id && is_alliance_city(world, &s.of) {
            known.insert(s.of.clone());
        }
        if s.of == realm_id && is_alliance_city(world, &s.toward) {
            known.insert(s.toward.clone());
        }
    }
    let user_id = world.realms.iter().find(|r| r.id == realm_id).map(|r| r.user_id);
    for m in user_id.and_then(|u| world.last_seen.get(&u)).into_iter().flatten() {
        if let Remembered::City(c) = m {
            if c.realm_id.is_none() && c.trade_org.is_none() {
                known.insert(c.id.clone());
            }
        }
    }
    let cities = world
        .cities
        .iter()
        .filter(|c| known.contains(&c.id) && c.realm_id.as_deref() != Some(realm_id))
        .map(|c| c.id.clone());
    std::iter::once(TRADE_ORG.to_string()).chain(cities).collect()
}

/// Whether an NPC city gives in to a realm's demand (`yieldsToDemand`, `CONTEXT.md`: Demand): the
/// respect it sees from the realm, its armed residents and walls in the city's sight, far
/// outweighs its soldiers.
pub fn yields_to_demand(world: &WorldState, city: &City, realm_id: &str, size: i32) -> bool {
    if !for_sale(city) {
        return false;
    }
    let needed =
        DEMAND_YIELD_RESPECT_MIN.max(DEMAND_YIELD_RESPECT_TIMES * city_soldiers(world, city));
    respect_seen_by(world, city, realm_id, size) >= needed
}

/// How the one accepting a demand hands over its goods (`DemandHandOver`): set aside at a storage
/// of theirs, or sent by a Transfer from a city of theirs to a city of the sender's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DemandHandOver {
    SetAside { storage_id: String },
    Transfer { from_city_id: String, to_city_id: String },
}

fn goods_in_order() -> impl Iterator<Item = Good> {
    GOODS.iter().filter_map(|g| good_of(g))
}

/// What goes of the goods demanded from a storage holding `free` (`goodsToHandOver`): as many
/// whole units of each as it holds, up to what was demanded.
pub fn goods_to_hand_over(goods: &Stock, free: &Stock) -> Stock {
    let mut going = Stock::new();
    for good in goods_in_order() {
        let held = free.get(&good).copied().unwrap_or(0.0).floor();
        let units = goods.get(&good).copied().unwrap_or(0.0).min(held);
        if units > 0.0 {
            going.insert(good, units);
        }
    }
    going
}

/// Goods sent by Transfer, as the Transfers they take (`transferLoads`): each good by itself, one
/// load at a time.
pub fn transfer_loads(goods: &Stock) -> Vec<(Good, f64)> {
    let mut loads = Vec::new();
    for good in goods_in_order() {
        let load = transfer_load(good);
        let mut left = goods.get(&good).copied().unwrap_or(0.0);
        while left > 0.0 {
            loads.push((good, left.min(load)));
            left -= load;
        }
    }
    loads
}

/// What the Transfers for these goods cost together, each over a whole way of `tiles`
/// (`transferLoadsFee`).
pub fn transfer_loads_fee(goods: &Stock, tiles: f64) -> f64 {
    transfer_loads(goods)
        .into_iter()
        .fold(0.0, |fee, (good, units)| fee + transfer_fee(units * good_weight(good), tiles))
}

/// The storage goods demanded would go from (`handOverStorage`).
fn hand_over_storage<'w>(
    world: &'w WorldState,
    realm_id: &str,
    how: &DemandHandOver,
) -> Option<&'w Building> {
    match how {
        DemandHandOver::SetAside { storage_id } => offer_storage(world, realm_id, storage_id),
        DemandHandOver::Transfer { from_city_id, .. } => delivery_storage(world, from_city_id),
    }
}

/// What of a demand's goods this hand-over would move now, by `realm_id` (`goodsHandedOver`): an
/// empty stock with none there, or when the storage named isn't theirs.
pub fn goods_handed_over(
    world: &WorldState,
    realm_id: &str,
    goods: &Stock,
    how: &DemandHandOver,
) -> Stock {
    match hand_over_storage(world, realm_id, how) {
        Some(s) => goods_to_hand_over(goods, &free_stock(world, &s.id, s.stock.as_ref())),
        None => Stock::new(),
    }
}

/// The hand-over an order names, as `demandHandOverProblem` checks it: `Ok` with the hand-over
/// when it will do (its goods may still be none), `Err` with the reason when it won't.
pub fn demand_hand_over(
    world: &WorldState,
    realm_id: &str,
    demand: &Demand,
    how: Option<&Value>,
) -> Result<DemandHandOver, String> {
    let field = |k: &str| how.and_then(|h| h.get(k));
    let text = |k: &str| field(k).and_then(Value::as_str);
    let to_trade_org = demand.from_id == TRADE_ORG;
    if to_trade_org {
        if trade_org_hq(world).is_none() {
            return Err(NO_CARAVANS.into());
        }
        if transfer_warehouses(world).is_empty() {
            return Err("no Trade Org warehouse to send a caravan".into());
        }
    }
    match text("way") {
        Some("setAside") => {
            let storage = text("storageId").and_then(|id| offer_storage(world, realm_id, id));
            let Some(storage) = storage else {
                return Err("not a finished storage of yours".into());
            };
            if to_trade_org && storage.city_id.is_none() {
                return Err("its caravans fetch only from a storage in a city".into());
            }
            Ok(DemandHandOver::SetAside { storage_id: storage.id.clone() })
        }
        Some("transfer") if to_trade_org => {
            let from = text("fromCityId").and_then(|id| world.cities.iter().find(|c| c.id == id));
            let Some(from) = from.filter(|c| c.realm_id.as_deref() == Some(realm_id)) else {
                return Err("not one of your cities".into());
            };
            if delivery_storage(world, &from.id).is_none() {
                return Err("your city has no storage".into());
            }
            Ok(DemandHandOver::Transfer {
                from_city_id: from.id.clone(),
                to_city_id: String::new(),
            })
        }
        Some("transfer") => {
            let to = text("toCityId").and_then(|id| world.cities.iter().find(|c| c.id == id));
            let Some(to) = to.filter(|c| c.realm_id.as_deref() == Some(demand.from_id.as_str()))
            else {
                return Err("send it to a city of theirs".into());
            };
            if let DemandTerms::Goods { goods } = &demand.terms {
                let one = Value::from(1);
                for good in goods.keys() {
                    let good = serde_json::to_value(good).expect("serialisable");
                    let problem = pick_up_transfer_problem(
                        world,
                        realm_id,
                        field("fromCityId"),
                        Some(&good),
                        Some(&one),
                        field("toCityId"),
                    );
                    if let Some(p) = problem {
                        return Err(p);
                    }
                }
            }
            Ok(DemandHandOver::Transfer {
                from_city_id: text("fromCityId").unwrap_or_default().to_string(),
                to_city_id: to.id.clone(),
            })
        }
        _ => Err("set the goods aside at a storage, or send them by a Transfer".into()),
    }
}

/// Why `realm_id` can't hand over a demand's goods this way, or `None` when it can
/// (`demandHandOverProblem`, `CONTEXT.md`: Demand): a storage of its own holding some of them, or
/// a Transfer it could order to a city of the sender's. Less than demanded will do. For the Trade
/// Organization, a storage in a city, or a Transfer from one, whoever it refuses.
pub fn demand_hand_over_problem(
    world: &WorldState,
    realm_id: &str,
    demand: &Demand,
    how: Option<&Value>,
) -> Option<String> {
    let DemandTerms::Goods { goods } = &demand.terms else { return None };
    match demand_hand_over(world, realm_id, demand, how) {
        Err(problem) => Some(problem),
        Ok(h) if goods_handed_over(world, realm_id, goods, &h).is_empty() => {
            Some("that storage holds none of it that isn’t set aside".into())
        }
        Ok(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_is_trimmed_text_without_control_characters() {
        let v = |s: &str| Some(Value::from(s));
        assert_eq!(demand_note_problem(None).as_deref(), Some("a demand needs a note"));
        assert_eq!(demand_note_problem(v("  ").as_ref()).as_deref(), Some("a demand needs a note"));
        assert_eq!(demand_note_problem(v("pay up\n\tnow").as_ref()), None);
        assert!(demand_note_problem(v("a\u{7}b").as_ref()).is_some());
        let long = "x".repeat(DEMAND_NOTE_MAX_LENGTH as usize + 1);
        assert!(demand_note_problem(v(&long).as_ref()).is_some());
        assert_eq!(demand_note_problem(v(&format!("  {}  ", &long[1..])).as_ref()), None);
    }

    #[test]
    fn transfer_loads_split_each_good_into_whole_loads() {
        let goods: Stock =
            [(Good::Stone, transfer_load(Good::Stone) * 2.0 + 3.0), (Good::Food, 2.0)]
                .into_iter()
                .collect();
        let loads = transfer_loads(&goods);
        let stone = transfer_load(Good::Stone);
        assert!(loads.contains(&(Good::Stone, stone)));
        assert!(loads.contains(&(Good::Stone, 3.0)));
        assert!(loads.contains(&(Good::Food, 2.0)));
        assert_eq!(loads.len(), 4);
    }

    #[test]
    fn goods_to_hand_over_takes_whole_units_up_to_the_demand() {
        let goods: Stock = [(Good::Food, 10.0), (Good::Wood, 3.0)].into_iter().collect();
        let free: Stock = [(Good::Food, 4.7), (Good::Iron, 9.0)].into_iter().collect();
        let going = goods_to_hand_over(&goods, &free);
        assert_eq!(going, [(Good::Food, 4.0)].into_iter().collect::<Stock>());
    }
}
