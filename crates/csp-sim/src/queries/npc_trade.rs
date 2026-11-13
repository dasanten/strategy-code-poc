//! Trading with and hiring from an NPC city, read only (`packages/shared/src/npc-trade.ts`,
//! `CONTEXT.md`: Trading with an NPC city, Hiring from an NPC city, NPC reserve): its stock, its
//! reserve, its prices, what it asks for its residents and whom it would lend.

use csp_shared::world::PricedGood;
use std::cmp::Ordering;
use std::collections::HashSet;
use ts_rs::TS;

use csp_shared::balance::{
    BUILD_MATERIALS, CITY_PRICE_STANDING_SWING, HORSE_FOOD_PER_DAY, NPC_HORSES_BASE,
    NPC_RESIDENTS_PER_HORSE, NPC_RESIDENTS_PER_NEEDS_STEP, NPC_SOLDIER_SHARE, NPC_TRADE,
    NPC_WAR_CHEST_PER_RESIDENT, STABLE_CAPACITY, STABLE_FEED_DAYS, STANDING_RANGE, WAREHOUSE_FLOOR,
};
use csp_shared::goods::WEAPONS;
use csp_shared::world::npc_trade::ShownNpcCityPrice;
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, Good, Resident, Stock, WorldState,
};

use super::building::recipe_for;
use super::city::{city_food_use, city_residents, for_sale};
use super::horses::{horses_in, owns_horse, HorseOwner};
use super::js_round;
use super::names::{good_name, good_of, held, held_in, PRICED_GOODS};
use super::persuasion::respect_seen_by;
use super::residents::{can_work, is_armed};
use super::standing::standing_of;
use super::warehouse::{price_for, Price};
use crate::npc_chain::{chain_good, reserve_lacks};

/// An NPC city's finished storages (`npcStorages`): where it trades and is paid.
pub fn npc_storages<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Building> {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_deref() == Some(city.id.as_str())
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        })
        .collect()
}

/// What an NPC city's storages hold together (`npcCityStock`).
pub fn npc_city_stock(world: &WorldState, city: &City) -> Stock {
    let mut sum = Stock::new();
    for b in npc_storages(world, city) {
        for (good, n) in b.stock.iter().flatten() {
            *sum.entry(*good).or_insert(0.0) += n;
        }
    }
    sum
}

/// What an NPC city's smithy makes for its soldiers (`NPC_SMITHY_WEAPON`): the cheapest weapon.
pub const NPC_SMITHY_WEAPON: Good = Good::Spear;

/// How many soldiers an NPC city keeps (`npcSoldierTarget`): `NPC_SOLDIER_SHARE` of its adults,
/// rounded up.
pub fn npc_soldier_target(adults: f64) -> f64 {
    (adults * NPC_SOLDIER_SHARE).ceil()
}

/// How many horses an NPC city wants for its size (`npcHorsesWanted`); none for the Trade
/// Organization's cities.
pub fn npc_horses_wanted(world: &WorldState, city: &City) -> f64 {
    if city.trade_org.is_some() {
        return 0.0;
    }
    let residents = city_residents(world, &city.id).len() as f64;
    STABLE_CAPACITY.min(NPC_HORSES_BASE + (residents / NPC_RESIDENTS_PER_HORSE).floor())
}

/// The Food an NPC city keeps in a stable for its own horses in it (`npcStableKeep`).
pub fn npc_stable_keep(world: &WorldState, city: &City, stable: &Building) -> f64 {
    let own = horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(HorseOwner::City(&city.id), h))
        .count() as f64;
    own * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY
}

/// The Food an NPC city's finished stables lack of what it keeps in them (`npcStablesLack`).
pub fn npc_stables_lack(world: &WorldState, city: &City) -> f64 {
    if city.trade_org.is_some() {
        return 0.0;
    }
    let mut lack = 0.0;
    for b in &world.buildings {
        if b.kind != BuildingKind::Stable
            || b.site.is_some()
            || b.city_id.as_deref() != Some(city.id.as_str())
        {
            continue;
        }
        lack += (npc_stable_keep(world, city, b) - held_in(b.stock.as_ref(), Good::Food)).max(0.0);
    }
    lack
}

/// How many steps of a village's needs an NPC city has (`npcNeedsScale`), at least one.
pub fn npc_needs_scale(world: &WorldState, city: &City) -> f64 {
    1f64.max((city_residents(world, &city.id).len() as f64 / NPC_RESIDENTS_PER_NEEDS_STEP).floor())
}

/// The reserve an NPC city keeps (`npcReserve`, `CONTEXT.md`: NPC reserve): Food, building
/// materials by its needs, weapons for the soldiers it has not armed, and a war chest.
pub fn npc_reserve(world: &WorldState, city: &City) -> Stock {
    let mut reserve = Stock::new();
    let eaten = city_food_use(world, city, NPC_TRADE.reserve_food_days);
    let food = (eaten + npc_stables_lack(world, city) - 1e-9).ceil();
    if food > 0.0 {
        reserve.insert(Good::Food, food);
    }
    fn add<'a>(reserve: &mut Stock, goods: impl IntoIterator<Item = (&'a str, f64)>, times: f64) {
        if times <= 0.0 {
            return;
        }
        for (name, n) in goods {
            let good = good_of(name).expect("a good");
            *reserve.entry(good).or_insert(0.0) += n * times;
        }
    }
    let materials = |kind: &str| BUILD_MATERIALS.get(kind).expect("materials").0.iter().copied();
    let steps = npc_needs_scale(world, city);
    add(&mut reserve, materials("house"), steps);
    add(&mut reserve, materials("wall"), NPC_TRADE.reserve_wall_stretches * steps);
    add(&mut reserve, [("stone", NPC_TRADE.reserve_stone_per_step)], steps - 1.0);
    let tick = world.tick as f64;
    let residents: Vec<&Resident> = city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0)
        .collect();
    let adults: Vec<&&Resident> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
    let armed = adults.iter().filter(|r| is_armed(&r.carried)).count() as f64;
    let unarmed = npc_soldier_target(adults.len() as f64) - armed;
    if unarmed > 0.0 {
        reserve.insert(NPC_SMITHY_WEAPON, unarmed);
        let stock = npc_city_stock(world, city);
        let held_weapons: f64 =
            WEAPONS.iter().map(|w| held(&stock, good_of(w).expect("a weapon"))).sum();
        let recipe = recipe_for(BuildingKind::Smithy, Some(good_name(NPC_SMITHY_WEAPON)));
        if let Some(recipe) = recipe {
            add(&mut reserve, recipe.input.0.iter().copied(), unarmed - held_weapons);
        }
    }
    if !residents.is_empty() {
        reserve.insert(Good::Coins, residents.len() as f64 * NPC_WAR_CHEST_PER_RESIDENT);
    }
    reserve
}

/// The floor an NPC city prices a good from (`priceFloor`): its reserve of it, or a trading
/// post's floor when that is more.
fn price_floor(good: Good, reserve: &Stock) -> f64 {
    let floor = WAREHOUSE_FLOOR.get(good_name(good)).expect("a floor for every priced good");
    floor.max(held(reserve, good))
}

/// How far an NPC city's standing toward the trader moves its prices (`standingSwing`); 0
/// without a trader.
pub fn standing_swing(world: &WorldState, city: &City, trader_id: Option<&str>) -> f64 {
    let Some(trader) = trader_id else {
        return 0.0;
    };
    (CITY_PRICE_STANDING_SWING * standing_of(world, &city.id, trader)) / STANDING_RANGE
}

/// An NPC city's price for one unit of a good with `stock` of it in its storages
/// (`npcPriceFor`): a warehouse's price from that stock and its floor, moved by standing.
pub fn npc_price_for(good: Good, stock: f64, reserve: &Stock, swing: f64) -> Price {
    let base = price_for(good, stock, price_floor(good, reserve));
    let sell = 2f64.max(js_round(base.sell * (1.0 - swing)));
    let buy = 1f64.max((sell - 1.0).min(js_round(base.buy * (1.0 + swing))));
    Price { buy, sell }
}

/// One line of an NPC city's prices (`NpcCityPrice`): the good, what it holds, its price, and
/// what it would sell (above its reserve) and buy (what it lacks of it).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(rename_all = "camelCase")]
pub struct NpcCityPrice {
    #[ts(as = "PricedGood")]
    pub good: Good,
    pub stock: f64,
    pub for_sale: f64,
    pub wanted: f64,
    pub buy: f64,
    pub sell: f64,
}

impl NpcCityPrice {
    /// The line as a side sees it (`Shown<NpcCityPrice>`): what is held only when it sees inside.
    pub fn shown(&self, inside: bool) -> ShownNpcCityPrice {
        ShownNpcCityPrice {
            good: self.good,
            buy: self.buy,
            sell: self.sell,
            stock: inside.then_some(self.stock),
            for_sale: self.for_sale,
            wanted: self.wanted,
        }
    }
}

/// An NPC city's prices to a trader, every good but coins (`npcCityPrices`); empty for a city
/// that is not an NPC city.
pub fn npc_city_prices(
    world: &WorldState,
    city: &City,
    trader_id: Option<&str>,
) -> Vec<NpcCityPrice> {
    if !for_sale(city) {
        return Vec::new();
    }
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    let swing = standing_swing(world, city, trader_id);
    PRICED_GOODS
        .iter()
        .map(|&good| {
            let have = held(&stock, good);
            let keep = held(&reserve, good);
            let price = npc_price_for(good, have, &reserve, swing);
            NpcCityPrice {
                good,
                stock: have,
                for_sale: (have - keep).max(0.0),
                wanted: (keep - have).max(0.0),
                buy: price.buy,
                sell: price.sell,
            }
        })
        .collect()
}

/// What an NPC city asks for each resident it lends and game week (`npcHirePrice`), at least a
/// coin.
pub fn npc_hire_price(world: &WorldState, city: &City, hirer_id: &str) -> f64 {
    let swing = standing_swing(world, city, Some(hirer_id));
    1f64.max(js_round(NPC_TRADE.price_per_resident_week * (1.0 - swing)))
}

/// Whether the city's plan has the resident as a spare hand (`spareHand`, `CONTEXT.md`: Spare
/// hands' work; ADR 0033): idle, on a road crew, scouting, or working for surplus at a workplace
/// whose good isn't short of its reserve. With no job planned yet they count as idle. Farmers,
/// those working for a short good, builders with a project, soldiers, traders, a founding party
/// and the rest of its plan stay.
fn spare_hand(job: Option<&CityJob>, workplace_short: impl Fn(&str) -> bool) -> bool {
    let Some(job) = job else { return true };
    match job.kind {
        CityJobKind::Idle | CityJobKind::Road | CityJobKind::Scout => true,
        CityJobKind::Work => job.building_id.as_deref().is_some_and(|b| !workplace_short(b)),
        _ => false,
    }
}

/// The residents an NPC city would lend now, in the order it lends them (`spareResidents`,
/// `CONTEXT.md`: Hiring from an NPC city; ADR 0033): living, unarmed adults in no contract but
/// `except` whom its plan has as spare hands (`spare_hand`), nor so many that fewer than
/// `NPC_TRADE.defence_share` of its adults (its soldiers among them) stay besides those its plan
/// keeps busy. Idle ones
/// first, then by id.
pub fn spare_residents<'w>(
    world: &'w WorldState,
    city: &City,
    except: Option<&str>,
) -> Vec<&'w Resident> {
    if !for_sale(city) {
        return Vec::new();
    }
    let busy: HashSet<&str> = world
        .contracts
        .iter()
        .filter(|c| Some(c.id.as_str()) != except)
        .flat_map(|c| c.resident_ids.iter().map(String::as_str))
        .collect();
    let plan = world.city_plans.get(&city.id);
    let short: HashSet<Good> = reserve_lacks(world, city, plan.and_then(|p| p.project.as_ref()))
        .into_iter()
        .map(|s| s.good)
        .collect();
    let workplace_short = |id: &str| {
        world
            .buildings
            .iter()
            .find(|b| b.id == id)
            .and_then(|b| chain_good(world, b))
            .is_some_and(|g| short.contains(&g))
    };
    let tick = world.tick as f64;
    let adults: Vec<&Resident> = world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_deref() == Some(city.id.as_str())
                && r.owner.is_none()
                && r.health > 0.0
                && can_work(r.born_at, tick)
                && !busy.contains(r.id.as_str())
        })
        .collect();
    let job = |r: &Resident| plan.and_then(|p| p.jobs.get(&r.id));
    let mut candidates: Vec<&Resident> = adults
        .iter()
        .copied()
        .filter(|r| !is_armed(&r.carried) && spare_hand(job(r), workplace_short))
        .collect();
    let staying = (NPC_TRADE.defence_share * adults.len() as f64 - 1e-9).ceil();
    // Its soldiers count toward the share at home; the rest its plan keeps busy come on top.
    let armed = adults.iter().filter(|r| is_armed(&r.carried)).count();
    let kept_busy = (adults.len() - candidates.len() - armed) as f64;
    let idle = |r: &Resident| u8::from(!job(r).is_some_and(|j| j.kind != CityJobKind::Idle));
    candidates.sort_by(|a, b| idle(b).cmp(&idle(a)).then_with(|| locale_compare(&a.id, &b.id)));
    let take = (adults.len() as f64 - kept_busy - staying).max(0.0) as usize;
    candidates.truncate(take);
    candidates
}

/// Why an NPC city feels threatened by the hirer and lends it nobody (`npcHireThreat`, `CONTEXT.md`:
/// Hiring from an NPC city; ADR 0033): it weighs a demand, its town hall is occupied, or armed
/// residents of the hirer stand in its area or in sight of it. `size` is the map's.
pub fn npc_hire_threat(
    world: &WorldState,
    city: &City,
    hirer_id: &str,
    size: i32,
) -> Option<String> {
    if world.demands.iter().any(|d| d.to_id == city.id) {
        return Some(format!("{} is weighing a demand and lends nobody", city.name));
    }
    if city.occupation.is_some() {
        return Some(format!("{}\u{2019}s town hall is occupied: it lends nobody", city.name));
    }
    if respect_seen_by(world, city, hirer_id, size) > 0.0 {
        return Some(format!(
            "{} lends nobody while your armed residents stand near it",
            city.name
        ));
    }
    None
}

/// How many residents an NPC city would lend the hirer now (`hireSpare`): none while it feels
/// threatened by it, else its spare residents.
pub fn hire_spare(world: &WorldState, city: &City, hirer_id: &str, size: i32) -> f64 {
    if npc_hire_threat(world, city, hirer_id, size).is_some() {
        return 0.0;
    }
    spare_residents(world, city, None).len() as f64
}

/// `a.localeCompare(b)` for ids, as ICU's root collation orders ASCII: punctuation and symbols
/// before digits before letters, letters by their lower case first and lower before upper on a
/// tie, digits one by one (no numeric collation). Ids are ASCII (`newId`: a prefix and a number).
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    fn primary(c: char) -> (u8, char) {
        if c.is_ascii_alphabetic() {
            (2, c.to_ascii_lowercase())
        } else if c.is_ascii_digit() {
            (1, c)
        } else {
            (0, c)
        }
    }
    let first = a.chars().map(primary).cmp(b.chars().map(primary));
    // Lower case before upper case where only case differs.
    first.then_with(|| {
        a.chars().map(|c| c.is_ascii_uppercase()).cmp(b.chars().map(|c| c.is_ascii_uppercase()))
    })
}

/// A stock of these goods, in this order.
pub fn stock_of(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

/// Whether an NPC city counts as big (`isBigNpcCity`): two steps of needs or more.
pub fn is_big_npc_city(world: &WorldState, city: &City) -> bool {
    npc_needs_scale(world, city) > 1.0
}

/// How many game days an NPC city of `residents` waits full before it founds (`npcFullDays`).
pub fn npc_full_days(residents: f64) -> f64 {
    use csp_shared::balance::{
        NPC_FOUND_VILLAGE_RESIDENTS, NPC_FULL_DAYS, NPC_FULL_DAYS_LEAST, NPC_FULL_RESIDENTS_PER_DAY,
    };
    let past = (residents - NPC_FOUND_VILLAGE_RESIDENTS).max(0.0);
    NPC_FULL_DAYS_LEAST.max(NPC_FULL_DAYS - past / NPC_FULL_RESIDENTS_PER_DAY)
}

/// How many adults a full NPC city of `residents` sends to found a daughter (`npcFoundingPartySize`).
pub fn npc_founding_party_size(residents: f64) -> f64 {
    use csp_shared::balance::{
        NPC_FOUND_PARTY_MOST, NPC_FOUND_RESIDENTS_PER_MEMBER, NPC_FOUND_VILLAGE_RESIDENTS,
        NPC_VILLAGE,
    };
    let past = (residents - NPC_FOUND_VILLAGE_RESIDENTS).max(0.0);
    let more = (past / NPC_FOUND_RESIDENTS_PER_MEMBER).floor();
    NPC_FOUND_PARTY_MOST.min(NPC_VILLAGE.residents + more)
}

/// Why an NPC city won't hire out `count` residents to `hirer_id` at `price_per_week`, if it won't
/// (`npcHireProblem`).
pub fn npc_hire_problem(
    world: &WorldState,
    city: &City,
    hirer_id: &str,
    count: f64,
    price_per_week: f64,
    except: Option<&str>,
    size: i32,
) -> Option<String> {
    if !for_sale(city) {
        return Some("only NPC cities hire out their residents".into());
    }
    if super::city::npc_city_refuses(world, city, hirer_id) {
        return Some(format!("{} won\u{2019}t hire out to you", city.name));
    }
    if let Some(threat) = npc_hire_threat(world, city, hirer_id, size) {
        return Some(threat);
    }
    let spare = spare_residents(world, city, except).len() as f64;
    if spare < count {
        return Some(format!("{} can spare only {spare} residents", city.name));
    }
    let asks = count * npc_hire_price(world, city, hirer_id);
    if price_per_week < asks {
        return Some(format!("{} asks {asks} coins a week for them", city.name));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_ids_as_locale_compare_does() {
        let mut ids = vec!["r10", "r9", "R1", "r1", "b-2", "b2", "city12"];
        ids.sort_by(|a, b| locale_compare(a, b));
        // `["b-2","b2","city12","r1","R1","r10","r9"].sort((a,b)=>a.localeCompare(b))` in Node.
        assert_eq!(ids, ["b-2", "b2", "city12", "r1", "R1", "r10", "r9"]);
    }

    #[test]
    fn prices_move_with_standing_and_stay_a_coin_apart() {
        let reserve = stock_of(&[(Good::Food, 100.0)]);
        let plain = npc_price_for(Good::Food, 50.0, &reserve, 0.0);
        let liked = npc_price_for(Good::Food, 50.0, &reserve, 0.25);
        assert!(liked.sell <= plain.sell && liked.buy >= plain.buy);
        assert!(liked.buy < liked.sell);
    }
}
