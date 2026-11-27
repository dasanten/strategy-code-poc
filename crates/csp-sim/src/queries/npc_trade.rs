//! Trading with and hiring from an NPC city, read only (`CONTEXT.md`: Trading with an NPC city,
//! Hiring from an NPC city, NPC reserve): its stock, its reserve, its prices, what it asks for its
//! residents and whom it would lend.

use csp_shared::world::PricedGood;
use std::cmp::Ordering;
use std::collections::HashSet;
use ts_rs::TS;

use csp_shared::balance::{
    BUILD_MATERIALS, CITY_PRICE_STANDING_SWING, HORSE_FOOD_PER_DAY, MAP_SIZE, NPC_ARCHER_ARROWS,
    NPC_ARCHER_SHARE, NPC_HORSES_BASE, NPC_RESIDENTS_PER_HORSE, NPC_RESIDENTS_PER_NEEDS_STEP,
    NPC_SOLDIER_SHARE, NPC_STEEL_KIT, NPC_TOOLS_SPARE, NPC_TRADE, NPC_WAR_CHEST_PER_RESIDENT,
    STABLE_CAPACITY, STABLE_FEED_DAYS, STANDING_RANGE, WAREHOUSE_FLOOR,
};
use csp_shared::goods::WEAPONS;
use csp_shared::world::npc_trade::ShownNpcCityPrice;
use csp_shared::world::{
    Building, BuildingKind, City, CityJob, CityJobKind, Good, Resident, Stock, WorldState,
};

use super::building::{node_good, recipe_for};
use super::city::{city_food_use, city_residents, for_sale};
use super::horses::{horses_in, owns_horse, HorseOwner};
use super::js_round;
use super::names::{good_name, good_of, held, held_in, PRICED_GOODS};
use super::persuasion::respect_seen_by;
use super::residents::{can_work, is_armed};
use super::standing::standing_of;
use super::warehouse::{price_for, Price};
use crate::npc_hooks::npc_home;
use crate::npc_hooks::{chain_good, reserve_lacks};
use crate::npc_hooks::knows_node;

/// An NPC city's finished storages (`npcStorages`): where it trades and is paid.
pub fn npc_storages<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Building> {
    crate::world_index::buildings_of_city(world, &city.id)
        .filter(|(_, b)| b.kind == BuildingKind::Storage && b.site.is_none())
        .map(|(_, b)| b)
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

/// What an NPC city's storages hold together in good condition (`CONTEXT.md`: Mending): a worn or
/// nearly broken weapon, piece of armour or set of Tools doesn't count towards its reserve.
pub fn npc_city_good_stock(world: &WorldState, city: &City) -> Stock {
    let mut sum = Stock::new();
    for b in npc_storages(world, city) {
        for (good, n) in b.stock.iter().flatten() {
            *sum.entry(*good).or_insert(0.0) += crate::mending::good_units(world, &b.id, *n, *good);
        }
    }
    sum
}

/// What an NPC city's smithy makes for its soldiers (`NPC_SMITHY_WEAPON`): the cheapest weapon.
pub const NPC_SMITHY_WEAPON: Good = Good::Spear;

/// Whether an NPC city goes for Steel (`CONTEXT.md`: NPC reserve): it knows of a coal node
/// (`knows_node`). Then its soldiers want the steel kit (`NPC_STEEL_KIT`), and it mines Coal,
/// smelts Steel and forges steel. Never a Trade Org city or a Player's.
pub fn npc_makes_steel(world: &WorldState, city: &City) -> bool {
    if !for_sale(city) {
        return false;
    }
    let Some(home) = npc_home(world, &city.id) else { return false };
    let at = (home.x as i32, home.y as i32);
    world.nodes.iter().any(|n| {
        node_good(n.kind) == Good::Coal && knows_node(city, at, (n.x as i32, n.y as i32), MAP_SIZE)
    })
}

/// What each soldier of an NPC city wants to carry, in the order its smithy forges it
/// (`npcSoldierKit`): the steel kit for a city that goes for Steel (`npc_makes_steel`), else a
/// spear.
pub fn npc_soldier_kit(world: &WorldState, city: &City) -> Vec<Good> {
    if npc_makes_steel(world, city) {
        NPC_STEEL_KIT.iter().map(|g| good_of(g).expect("a good")).collect()
    } else {
        vec![NPC_SMITHY_WEAPON]
    }
}

/// How many of each piece of a steel kit an NPC city's soldiers still lack (`kitLacks`): its
/// soldier target less the adults carrying that piece, in the kit's order; only those lacking. Its
/// archers (`npc_archer_target`) want no weapon or shield of it: their Bow takes both hands.
pub fn kit_lacks(world: &WorldState, city: &City, kit: &[Good]) -> Vec<(Good, f64)> {
    let tick = world.tick as f64;
    let adults: Vec<&Resident> = city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0 && can_work(r.born_at, tick))
        .collect();
    let target = npc_city_soldier_target(city, adults.len() as f64);
    let archers = npc_archer_target(world, city, adults.len() as f64);
    let hands = |g: Good| g == Good::SteelShield || WEAPONS.contains(&good_name(g));
    kit.iter()
        .map(|&g| {
            let want = if hands(g) { target - archers } else { target };
            let carrying = adults
                .iter()
                .filter(|r| held(&r.carried, g) > 0.0 && !(hands(g) && is_npc_archer(r)))
                .count() as f64;
            (g, want - carrying)
        })
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// What an NPC city's smithy forges (`npcSmithyGood`): what its soldiers lack first, beyond what
/// its storages hold (a spear for one unarmed, or for a city that goes for Steel the first piece of
/// its kit they lack); then a Bow or Arrows its archers lack (`archer_lacks`); then Tools while its
/// storages hold fewer than it wants (`npc_tools_wanted`, `CONTEXT.md`: Tools), not in a Trade
/// Organization city; with nothing lacking, the first of its kit.
pub fn npc_smithy_good(world: &WorldState, city: &City) -> Good {
    let kit = npc_soldier_kit(world, city);
    let stock = npc_city_stock(world, city);
    let soldiers = if kit.len() == 1 {
        let held_weapons: f64 =
            WEAPONS.iter().map(|w| held(&stock, good_of(w).expect("a weapon"))).sum();
        (npc_unarmed(world, city) > held_weapons).then_some(kit[0])
    } else {
        kit_lacks(world, city, &kit)
            .into_iter()
            .find(|(g, n)| held(&stock, *g) < *n)
            .map(|(g, _)| g)
    };
    let archers = || {
        archer_lacks(world, city).into_iter().find(|(g, n)| held(&stock, *g) < *n).map(|(g, _)| g)
    };
    // The Trade Organization's warehouses get their Tools as any good (`HQ_FLOOR_FACTOR`).
    let tools = || {
        (city.trade_org.is_none() && held(&stock, Good::Tools) < npc_tools_wanted(world, city))
            .then_some(Good::Tools)
    };
    soldiers.or_else(archers).or_else(tools).unwrap_or(kit[0])
}

/// An NPC city's grown residents, alive (`npcAdults`).
fn npc_adults<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Resident> {
    let tick = world.tick as f64;
    city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0 && can_work(r.born_at, tick))
        .collect()
}

/// How many more soldiers an NPC city wants armed: its soldier target less its armed adults.
fn npc_unarmed(world: &WorldState, city: &City) -> f64 {
    let adults = npc_adults(world, city);
    let armed = adults.iter().filter(|r| is_armed(r)).count() as f64;
    npc_city_soldier_target(city, adults.len() as f64) - armed
}

/// How many sets of Tools an NPC city wants in its storages (`CONTEXT.md`: Tools, NPC reserve):
/// one for each of its workers and builders (its adults beyond the soldiers it keeps) who carries
/// none, and `NPC_TOOLS_SPARE` besides.
pub fn npc_tools_wanted(world: &WorldState, city: &City) -> f64 {
    let adults = npc_adults(world, city);
    let workers = adults.len() as f64 - npc_city_soldier_target(city, adults.len() as f64);
    let equipped = adults.iter().filter(|r| !is_armed(r) && held(&r.carried, Good::Tools) >= 1.0);
    (workers - equipped.count() as f64).max(0.0) + NPC_TOOLS_SPARE
}

/// Whether an NPC city has a smithy of its own, finished or begun (`CONTEXT.md`: Tools, NPC
/// reserve): only then does it keep Tools in its reserve.
pub fn has_smithy(world: &WorldState, city: &City) -> bool {
    crate::npc_hooks::own_workplaces(world, city).iter().any(|b| b.kind == BuildingKind::Smithy)
}

/// How many soldiers an NPC city keeps (`npcSoldierTarget`): `NPC_SOLDIER_SHARE` of its adults,
/// rounded up.
pub fn npc_soldier_target(adults: f64) -> f64 {
    (adults * NPC_SOLDIER_SHARE).ceil()
}

/// How many soldiers `city` keeps for its `adults` (`CONTEXT.md`: Soldiers in peace, Stance): those by
/// its size (`npc_soldier_target`), more under Fortify (`NPC_STANCE.fortify_soldiers`).
pub fn npc_city_soldier_target(city: &City, adults: f64) -> f64 {
    (adults * NPC_SOLDIER_SHARE * crate::npc_hooks::soldiers_factor(city)).ceil()
}

/// An NPC city's finished smithy, its own or among its workplaces, if any (`CONTEXT.md`: NPC
/// city): where it forges its soldiers' weapons.
pub fn npc_smithy(world: &WorldState, city: &City) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.kind == BuildingKind::Smithy
            && b.site.is_none()
            && (b.city_id.as_ref() == Some(&city.id)
                || city.workplace_ids.iter().flatten().any(|id| *id == b.id))
    })
}

/// Whether a resident is one of an NPC city's archers: they carry a Bow (`CONTEXT.md`: Ranged
/// combat).
pub fn is_npc_archer(r: &Resident) -> bool {
    held(&r.carried, Good::Bow) > 0.0
}

/// How many of its soldiers an NPC city arms with a Bow (`CONTEXT.md`: Ranged combat): with a
/// finished smithy (`npc_smithy`), `NPC_ARCHER_SHARE` of the soldiers it keeps for its `adults`,
/// rounded down; none without one, and none for the Trade Org's cities or a Player's.
pub fn npc_archer_target(world: &WorldState, city: &City, adults: f64) -> f64 {
    if !for_sale(city) || npc_smithy(world, city).is_none() {
        return 0.0;
    }
    (npc_city_soldier_target(city, adults) * NPC_ARCHER_SHARE).floor()
}

/// What an NPC city keeps for its archers (`CONTEXT.md`: NPC reserve): a Bow for each archer it
/// wants beyond those carrying one, and `NPC_ARCHER_ARROWS` Arrows in its storages for each archer
/// it wants. Only those it wants any of.
pub fn archer_lacks(world: &WorldState, city: &City) -> Vec<(Good, f64)> {
    let tick = world.tick as f64;
    let adults: Vec<&Resident> = city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0 && can_work(r.born_at, tick))
        .collect();
    let target = npc_archer_target(world, city, adults.len() as f64);
    let archers = adults.iter().filter(|r| is_npc_archer(r)).count() as f64;
    [(Good::Bow, target - archers), (Good::Arrows, target * NPC_ARCHER_ARROWS)]
        .into_iter()
        .filter(|(_, n)| *n > 0.0)
        .collect()
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
    // A founding party carries its own Food along (`CONTEXT.md`: Founding), so the mother's
    // reserve doesn't count its members (T100.8).
    let party: HashSet<String> =
        crate::npc_hooks::founding_party(world.city_plans.get(&city.id)).into_iter().collect();
    let theirs: f64 = city_residents(world, &city.id)
        .iter()
        .filter(|r| party.contains(&r.id))
        .map(|r| {
            csp_shared::balance::FOOD_PER_DAY
                * super::residents::hunger_factor(r, world.tick as f64)
                * NPC_TRADE.reserve_food_days
        })
        .sum();
    let eaten = city_food_use(world, city, NPC_TRADE.reserve_food_days) - theirs;
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
    // A town building or upgrading its wall in stone sets Stone aside for it (Epic 113): its
    // roads, repairs and trade leave it, and only its walls spend it (`holds_for_walls`).
    let aside = crate::npc_hooks::wall_stone_set_aside(world, city);
    if aside > 0.0 {
        *reserve.entry(Good::Stone).or_insert(0.0) += aside;
    }
    let tick = world.tick as f64;
    let residents: Vec<&Resident> = city_residents(world, &city.id)
        .into_iter()
        .filter(|r| r.owner.is_none() && r.health > 0.0)
        .collect();
    let adults: Vec<&&Resident> = residents.iter().filter(|r| can_work(r.born_at, tick)).collect();
    let armed = adults.iter().filter(|r| is_armed(r)).count() as f64;
    let unarmed = npc_city_soldier_target(city, adults.len() as f64) - armed;
    let kit = npc_soldier_kit(world, city);
    if kit.len() > 1 {
        // The steel kit: each piece its soldiers lack, the Steel and Wood to forge what its
        // storages don't hold, and the Iron and Coal to smelt the Steel they don't hold.
        let stock = npc_city_stock(world, city);
        let mut steel = 0.0;
        for (good, lack) in kit_lacks(world, city, &kit) {
            reserve.insert(good, lack);
            let forge = lack - held(&stock, good);
            if let Some(recipe) = recipe_for(BuildingKind::Smithy, Some(good_name(good))) {
                for (name, n) in recipe.input.0 {
                    if *name == "steel" {
                        steel += n * forge.max(0.0);
                    }
                }
                add(&mut reserve, recipe.input.0.iter().copied(), forge);
            }
        }
        let smelt = steel - held(&stock, Good::Steel);
        if let Some(recipe) = recipe_for(BuildingKind::Smelter, Some(good_name(Good::Steel))) {
            add(&mut reserve, recipe.input.0.iter().copied(), smelt);
        }
        // And the Iron ore for that Iron, so its miners count as working for a short good.
        let iron = held(&reserve, Good::Iron) - held(&stock, Good::Iron);
        if let Some(recipe) = recipe_for(BuildingKind::Smelter, Some(good_name(Good::Iron))) {
            add(&mut reserve, recipe.input.0.iter().copied(), iron);
        }
    } else if unarmed > 0.0 {
        reserve.insert(NPC_SMITHY_WEAPON, unarmed);
        let stock = npc_city_stock(world, city);
        let held_weapons: f64 =
            WEAPONS.iter().map(|w| held(&stock, good_of(w).expect("a weapon"))).sum();
        let recipe = recipe_for(BuildingKind::Smithy, Some(good_name(NPC_SMITHY_WEAPON)));
        if let Some(recipe) = recipe {
            add(&mut reserve, recipe.input.0.iter().copied(), unarmed - held_weapons);
        }
    }
    // Tools for its workers and builders: only for a city with a smithy of its own, finished or
    // begun, to forge them. They are kept, never sold, but never short: its spare hands forge them
    // as surplus work (`NPC_SURPLUS_CAP`), from Iron and Wood above the reserve, so a big city
    // forging a set for every worker still counts as full (decided overnight, Daniel to confirm).
    // The Trade Organization's cities keep theirs by their warehouses' floors.
    if !adults.is_empty() && city.trade_org.is_none() && has_smithy(world, city) {
        reserve.insert(Good::Tools, npc_tools_wanted(world, city));
    }
    // Its archers' Bows and Arrows, and the Iron and Wood for the batches its storages lack.
    let lacks = archer_lacks(world, city);
    if !lacks.is_empty() {
        let stock = npc_city_stock(world, city);
        for (good, lack) in lacks {
            *reserve.entry(good).or_insert(0.0) += lack;
            let forge = lack - held(&stock, good);
            let Some(recipe) = recipe_for(BuildingKind::Smithy, Some(good_name(good))) else {
                continue;
            };
            let batch = recipe.output.get(good_name(good)).unwrap_or(1.0);
            add(&mut reserve, recipe.input.0.iter().copied(), (forge / batch).ceil());
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
        .filter(|r| !is_armed(r) && spare_hand(job(r), workplace_short))
        .collect();
    let staying = (NPC_TRADE.defence_share * adults.len() as f64 - 1e-9).ceil();
    // Its soldiers count toward the share at home; the rest its plan keeps busy come on top.
    let armed = adults.iter().filter(|r| is_armed(r)).count();
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
