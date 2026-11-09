//! The Trade Organization punishes (`trade-org-punishment.ts`, `CONTEXT.md`: Trade Org reaction,
//! Self-interest): once it holds an Organization below `TRADE_ORG_PUNISHES_BELOW` and knows of
//! crimes it did against it, it sends spare soldiers of its army to that Organization's city
//! nearest the crime, to take back `TRADE_ORG_PUNISH.times` what it lost from the city's storages,
//! Coins first, fighting whoever resists, and carry it home. What it came for and couldn't take
//! stays owed (`CONTEXT.md`: Trade Org debt), and past its demand's deadline an army comes to tear
//! down workplaces for it (`Punishment.wrecks`, `trade_org_wrecks`), and once enough of those have
//! come and it is still owed the next one holds the town hall until the city joins it as a trading
//! post (`Punishment.takes`, `take_city`). Like the rest of the HQ it only gives orders a Player
//! could give (ADR 0002): walking, picking up, dropping, attacking, tearing down.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    trip_food, ARMY_SPREAD, CARRIAGE_STOLEN_WORTH, DIRECTIVE_PUNISH_WORTH, FOOD_PER_DAY,
    HORSE_STOLEN_WORTH, OWN_FOOD, TRADE_ORG_DEBT_TRIPS, TRADE_ORG_LOSS, TRADE_ORG_PUNISH,
    TRADE_ORG_PUNISHES_BELOW, WALK_TICKS_PER_TILE, WAREHOUSE_BASE_PRICE,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, City, Crime, CrimeKind, DropOrder, Good, GoodsSpot, PickUpOrder, PunishedWhat,
    PunishedWhere, Punishment, PunishmentEnd, PunishmentHeading, PunishmentMember, RealmEventWhat,
    Resident, ResidentOrder, Stock, WorldState,
};

use crate::caravans::crew_threats;
use crate::combat::attack_order;
use crate::crimes::city_organization;
use crate::directive::directive_targets;
use crate::events::record_event;
use crate::goods_deps::new_id;
use crate::npc_behaviour::{npc_home, walk_to};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::in_city_area;
use crate::queries::goods::units_that_fit;
use crate::queries::names::{good_name, held, held_in, placed};
use crate::queries::residents::{carry_capacity, good_weight, stock_weight};
use crate::queries::standing::{standing_of, standing_organization, TRADE_ORG};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse::warehouse_keeps;
use crate::sight::InvariantViolation;
use crate::supply_wagons::{
    go_to_wagon_for_food, load_on_wagon, send_wagon, step_supply_wagons, wagon_of, wagon_took,
};
use crate::trade_org_army::spare_soldiers;
use crate::trade_org_buying::{buy_food, pack_purse};
use crate::trade_org_debt::{owe_trade_org, FirstOwed};
use crate::trade_org_takes::hall_blockers;
use crate::trade_org_wrecks::{find_workplaces, tear_down_next, workplaces_to_wreck};

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

fn dist(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    wrap_distance(size, tile(a.0, a.1), tile(b.0, b.1))
}

fn xy(r: &Resident) -> (f64, f64) {
    (r.x, r.y)
}

/// The warehouse base price of a good (`WAREHOUSE_BASE_PRICE[good]`).
fn base_price(g: Good) -> f64 {
    WAREHOUSE_BASE_PRICE.get(good_name(g)).unwrap_or(0.0)
}

/// What goods are worth in Coins (`worthOf`): a Coin one, any other good its warehouse base price.
pub fn worth_of(stock: &Stock) -> f64 {
    stock.iter().map(|(&g, &n)| n * if g == Good::Coins { 1.0 } else { base_price(g) }).sum()
}

/// What a crime cost the Trade Organization in Coins (`lossOf`, `TRADE_ORG_LOSS`): for a theft, the
/// worth of the goods and of a carriage and horse (`CONTEXT.md`: Stealing a carriage or horse).
pub fn loss_of(crime: &Crime) -> f64 {
    match crime.kind {
        CrimeKind::Attack => TRADE_ORG_LOSS.attack,
        CrimeKind::Killing => TRADE_ORG_LOSS.killing,
        CrimeKind::TearDown => TRADE_ORG_LOSS.tear_down,
        CrimeKind::Capture => TRADE_ORG_LOSS.capture,
        CrimeKind::Theft => {
            let carriage = if crime.carriage == Some(true) { CARRIAGE_STOLEN_WORTH } else { 0.0 };
            let horse = if crime.horse.is_some() { HORSE_STOLEN_WORTH } else { 0.0 };
            crime.goods.as_ref().map_or(0.0, worth_of) + carriage + horse
        }
    }
}

/// What a member carries above what they set out with: what they took (`takenBy`).
pub fn taken_by(r: &Resident, own: &Stock) -> Stock {
    let mut taken = Stock::new();
    for (&g, &n) in &r.carried {
        let more = n - held(own, g);
        if more > 0.0 {
            taken.insert(g, more);
        }
    }
    taken
}

/// A punishment's living members (`living`): (member, resident) indices.
fn living(world: &WorldState, p: &Punishment) -> Vec<(usize, usize)> {
    let by_id: HashMap<&str, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.as_str(), i)).collect();
    p.members
        .iter()
        .enumerate()
        .filter_map(|(mi, m)| {
            let ri = *by_id.get(m.resident_id.as_str())?;
            (world.residents[ri].health > 0.0).then_some((mi, ri))
        })
        .collect()
}

/// The Coins' worth a punishment's living members have taken, on them or on its supply wagon
/// (`tookSoFar`).
pub fn took_so_far(world: &WorldState, p: &Punishment) -> f64 {
    let carried: f64 = living(world, p)
        .into_iter()
        .map(|(mi, ri)| worth_of(&taken_by(&world.residents[ri], &p.members[mi].own)))
        .sum();
    carried + wagon_took(world, p)
}

/// Whether a crime is one the Trade Organization knows of against itself and hasn't punished yet
/// (`toPunish`). A captured post never is: that is a debt (`lost_posts_become_debts`).
fn to_punish(world: &WorldState, c: &Crime) -> bool {
    c.punished != Some(true)
        && c.post.is_none()
        && standing_organization(world, &c.victim_org) == TRADE_ORG
        && c.known_by.contains(&c.victim_org)
}

/// One tick of the Trade Organization punishing, on a map of `size` tiles (`stepPunishments`):
/// crimes of those who owe it go on their debts, it sends out new punishments and runs those under
/// way and their supply wagons. Run after `step_trade_org_army` and before `step_npc_cities`; the
/// HQ leaves the members of a punishment to it.
pub fn step_punishments(world: &mut WorldState, size: i32) {
    let Some(hq) = trade_org_hq(world).cloned() else {
        world.punishments.clear();
        world.supply_wagons.clear();
        world.debts.clear();
        return;
    };
    add_crimes_to_debts(world);
    send_out(world, size);
    send_out_for_debts(world, size);
    send_out_for_directives(world, size);
    let ids: Vec<String> = world.punishments.iter().map(|p| p.id.clone()).collect();
    for id in ids {
        if let Some(pi) = world.punishments.iter().position(|p| p.id == id) {
            run_punishment(world, &hq, pi, size);
        }
    }
    step_supply_wagons(world, &hq, size);
}

/// A crime the Trade Organization comes to know of by an Organization that owes it adds what it
/// cost to the debt (`addCrimesToDebts`) and sends no army of its own: it counts as punished.
fn add_crimes_to_debts(world: &mut WorldState) {
    if world.debts.is_empty() {
        return;
    }
    for ci in 0..world.crimes.len() {
        if !to_punish(world, &world.crimes[ci]) {
            continue;
        }
        let org = world.crimes[ci].culprit.org.clone();
        if !world.debts.iter().any(|d| d.org == org) {
            continue;
        }
        world.crimes[ci].punished = Some(true);
        let loss = loss_of(&world.crimes[ci]);
        owe_trade_org(world, &org, loss, None, FirstOwed::Owed);
    }
}

/// The culprit's cities with a town hall: (city index, hall position).
fn halls_of(world: &WorldState, org: &str) -> Vec<(usize, (f64, f64))> {
    world
        .cities
        .iter()
        .enumerate()
        .filter(|(_, c)| c.trade_org.is_none() && city_organization(c) == org)
        .filter_map(|(ci, c)| town_hall_of(world, c).map(|h| (ci, (h.x, h.y))))
        .collect()
}

/// The first of the nearest of `halls` to `from`, as `reduce` with `<` keeps.
fn nearest_hall(halls: &[(usize, (f64, f64))], from: (f64, f64), size: i32) -> usize {
    let mut best = halls[0];
    for &h in &halls[1..] {
        if dist(size, from, h.1) < dist(size, from, best.1) {
            best = h;
        }
    }
    best.0
}

/// Up to `TRADE_ORG_PUNISH.soldiers` spare soldiers in no punishment yet.
fn free_soldiers(world: &WorldState) -> Vec<PunishmentMember> {
    let busy: HashSet<&str> = world
        .punishments
        .iter()
        .flat_map(|p| p.members.iter().map(|m| m.resident_id.as_str()))
        .collect();
    spare_soldiers(world)
        .into_iter()
        .filter(|r| !busy.contains(r.id.as_str()))
        .take(TRADE_ORG_PUNISH.soldiers as usize)
        .map(|r| PunishmentMember {
            resident_id: r.id.clone(),
            own: r.carried.clone(),
            packed: None,
            seller: None,
            no_way: None,
        })
        .collect()
}

fn new_punishment(
    world: &mut WorldState,
    org: &str,
    city_id: &str,
    worth: f64,
    members: Vec<PunishmentMember>,
) -> Punishment {
    Punishment {
        id: new_id(world, "punishment"),
        culprit_org: org.to_string(),
        city_id: city_id.to_string(),
        worth,
        members,
        heading: PunishmentHeading::Out,
        took: 0.0,
        started_at: world.tick as f64,
        arrived_at: None,
        directive_id: None,
        wrecks: None,
        takes: None,
    }
}

fn coming(city: &City, worth: f64) -> RealmEventWhat {
    RealmEventWhat::Punished {
        what: PunishedWhat::Coming,
        city_id: city.id.clone(),
        city: city.name.clone(),
        worth,
        took: None,
        why: None,
        r#where: None,
        directive: None,
        wrecks: None,
        takes: None,
    }
}

/// For each Organization the Trade Organization holds below `TRADE_ORG_PUNISHES_BELOW` and knows of
/// crimes by against itself, with none of its punishments under way (`sendOut`): its army goes to
/// the Organization's city nearest the latest such crime, `TRADE_ORG_PUNISH.soldiers` of its spare
/// soldiers at most, to take back `TRADE_ORG_PUNISH.times` what those crimes cost it. Once it goes,
/// those crimes are punished. With no spare soldier, or no city to go to, it waits.
fn send_out(world: &mut WorldState, size: i32) {
    let crimes: Vec<usize> =
        (0..world.crimes.len()).filter(|&i| to_punish(world, &world.crimes[i])).collect();
    if crimes.is_empty() {
        return;
    }
    // By culprit, in the order they first come, as a `Map` keeps them.
    let mut by_org: Vec<(String, Vec<usize>)> = Vec::new();
    for ci in crimes {
        let org = world.crimes[ci].culprit.org.clone();
        match by_org.iter_mut().find(|(o, _)| *o == org) {
            Some((_, list)) => list.push(ci),
            None => by_org.push((org, vec![ci])),
        }
    }
    for (org, theirs) in by_org {
        if world.punishments.iter().any(|p| p.culprit_org == org) {
            continue;
        }
        if standing_organization(world, &org) == TRADE_ORG {
            continue;
        }
        if standing_of(world, TRADE_ORG, &org) >= TRADE_ORG_PUNISHES_BELOW {
            continue;
        }
        let mut latest = theirs[0];
        for &c in &theirs[1..] {
            if world.crimes[c].tick > world.crimes[latest].tick {
                latest = c;
            }
        }
        let halls = halls_of(world, &org);
        if halls.is_empty() {
            continue;
        }
        let at = (world.crimes[latest].x, world.crimes[latest].y);
        let city = world.cities[nearest_hall(&halls, at, size)].clone();
        let soldiers = free_soldiers(world);
        if soldiers.is_empty() {
            continue;
        }
        let worth =
            TRADE_ORG_PUNISH.times * theirs.iter().map(|&c| loss_of(&world.crimes[c])).sum::<f64>();
        for &c in &theirs {
            world.crimes[c].punished = Some(true);
        }
        if worth <= 0.0 {
            continue;
        }
        let p = new_punishment(world, &org, &city.id, worth, soldiers);
        set_out(world, &city, size, p);
        record_event(world, Some(&org), coming(&city, worth));
    }
}

/// For each debt at its step `wrecks`, with none of the Trade Organization's punishments under way
/// against who owes it (`sendOutForDebts`): its next army goes to the city kept with the debt, or if
/// that is no longer theirs their city nearest the HQ, `TRADE_ORG_PUNISH.soldiers` of its spare
/// soldiers at most, to tear down workplaces for it. It goes again each time it is back, with the
/// debt still owed; once `TRADE_ORG_DEBT_TRIPS` of them have reached a city, it goes to take the
/// city instead (`Punishment.takes`). With no spare soldier, or no city to go to, it waits.
fn send_out_for_debts(world: &mut WorldState, size: i32) {
    let Some(hq_hall) = trade_org_hq(world).and_then(|hq| town_hall_of(world, hq)) else { return };
    let from = (hq_hall.x, hq_hall.y);
    for di in 0..world.debts.len() {
        let debt = world.debts[di].clone();
        if debt.step != Some(csp_shared::world::DebtStep::Wrecks) {
            continue;
        }
        if world.punishments.iter().any(|p| p.culprit_org == debt.org) {
            continue;
        }
        let halls = halls_of(world, &debt.org);
        if halls.is_empty() {
            continue;
        }
        let kept = halls.iter().find(|h| Some(&world.cities[h.0].id) == debt.city_id.as_ref());
        let ci = kept.map_or_else(|| nearest_hall(&halls, from, size), |h| h.0);
        let city = world.cities[ci].clone();
        let soldiers = free_soldiers(world);
        if soldiers.is_empty() {
            return;
        }
        let takes = debt.trips.unwrap_or(0.0) >= TRADE_ORG_DEBT_TRIPS;
        let mut p = new_punishment(world, &debt.org, &city.id, debt.coins, soldiers);
        if takes {
            p.takes = Some(true);
        } else {
            p.wrecks = Some(Vec::new());
        }
        set_out(world, &city, size, p);
        let mut what = coming(&city, debt.coins);
        if let RealmEventWhat::Punished { wrecks, takes: t, .. } = &mut what {
            if takes {
                *t = Some(true);
            } else {
                *wrecks = Some(true);
            }
        }
        record_event(world, Some(&debt.org), what);
    }
}

/// For each Organization an admin directive names (`sendOutForDirectives`, `CONTEXT.md`: Admin
/// directive), with none of the Trade Organization's punishments under way: its army goes to the
/// Organization's city nearest the HQ, `TRADE_ORG_PUNISH.soldiers` of its spare soldiers at most, to
/// take `DIRECTIVE_PUNISH_WORTH`, and goes again each time it is back, until the directive is lifted.
/// With no spare soldier, or no city to go to, it waits.
fn send_out_for_directives(world: &mut WorldState, size: i32) {
    let Some(hq_hall) = trade_org_hq(world).and_then(|hq| town_hall_of(world, hq)) else { return };
    let from = (hq_hall.x, hq_hall.y);
    for di in 0..world.directives.len() {
        let d = world.directives[di].clone();
        for org in directive_targets(world, &d) {
            if world.punishments.iter().any(|p| p.culprit_org == org) {
                continue;
            }
            if standing_organization(world, &org) == TRADE_ORG {
                continue;
            }
            let halls = halls_of(world, &org);
            if halls.is_empty() {
                continue;
            }
            let city = world.cities[nearest_hall(&halls, from, size)].clone();
            let soldiers = free_soldiers(world);
            if soldiers.is_empty() {
                return;
            }
            let mut p = new_punishment(world, &org, &city.id, DIRECTIVE_PUNISH_WORTH, soldiers);
            p.directive_id = Some(d.id.clone());
            set_out(world, &city, size, p);
            let mut what = coming(&city, DIRECTIVE_PUNISH_WORTH);
            if let RealmEventWhat::Punished { directive, .. } = &mut what {
                *directive = Some(d.reason.clone());
            }
            record_event(world, Some(&org), what);
        }
    }
}

/// A punishment sets out for `city`, with a supply wagon if it can have one (`setOut`, `send_wagon`).
fn set_out(world: &mut WorldState, city: &City, size: i32, p: Punishment) {
    world.punishments.push(p);
    let pi = world.punishments.len() - 1;
    let Some(hq) = trade_org_hq(world).cloned() else { return };
    let from = town_hall_of(world, &hq).map(|h| (h.x, h.y));
    let to = town_hall_of(world, city).map(|h| (h.x, h.y));
    if let (Some(from), Some(to)) = (from, to) {
        send_wagon(world, &hq, pi, dist(size, from, to), size);
    }
}

/// The city's finished storages that hold anything (`storagesToTake`), by index.
fn storages_to_take(world: &WorldState, city: &City) -> Vec<usize> {
    (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            b.city_id.as_deref() == Some(city.id.as_str())
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
                && b.stock.as_ref().is_some_and(|s| s.values().any(|&n| n > 0.0))
        })
        .collect()
}

/// The goods of a stock in the order the Trade Organization takes them (`takingOrder`): Coins,
/// then most worth.
fn taking_order(stock: &Stock) -> Vec<Good> {
    let worth = |g: Good| if g == Good::Coins { f64::INFINITY } else { base_price(g) };
    let mut goods: Vec<Good> = stock.iter().filter(|(_, &n)| n > 0.0).map(|(&g, _)| g).collect();
    goods.sort_by(|&a, &b| {
        worth(b).total_cmp(&worth(a)).then_with(|| good_name(a).cmp(good_name(b)))
    });
    goods
}

/// What a member standing at storage `si` picks up (`toTake`): of each good in `taking_order`, as
/// many units as are there, fit their carry capacity and still make up `left` Coins' worth.
/// Returns the goods and their worth.
fn to_take(world: &WorldState, r: &Resident, si: usize, left: f64) -> (Stock, f64) {
    let mut goods = Stock::new();
    let mut worth = 0.0;
    let empty = Stock::new();
    let stock = world.buildings[si].stock.as_ref().unwrap_or(&empty);
    for g in taking_order(stock) {
        if worth >= left {
            break;
        }
        let each = if g == Good::Coins { 1.0 } else { base_price(g) };
        let units = held(stock, g)
            .min(units_that_fit(r, g, world.tick as f64))
            .min(((left - worth) / each).ceil());
        if units <= 0.0 {
            continue;
        }
        goods.insert(g, units);
        worth += units * each;
    }
    (goods, worth)
}

/// Gives a resident an order to walk to a tile, unless they are already on their way there
/// (`headFor`).
pub fn head_for(world: &mut WorldState, ri: usize, to: (f64, f64)) {
    let r = &mut world.residents[ri];
    if r.x == to.0 && r.y == to.1 {
        return;
    }
    if let Some(ResidentOrder::WalkTo(o)) = &r.order {
        if o.target.x == to.0 && o.target.y == to.1 {
            return;
        }
    }
    walk_to(r, to);
}

/// Whether the admin directive a punishment was sent for is no longer in force
/// (`directiveLifted`).
fn directive_lifted(world: &WorldState, p: &Punishment) -> bool {
    p.directive_id.as_ref().is_some_and(|id| !world.directives.iter().any(|d| &d.id == id))
}

/// Whether the city is one of the culprit's still, with a town hall to walk to
/// (`stillTheCulprits`).
fn still_the_culprits(world: &WorldState, p: &Punishment, city: &City) -> bool {
    city.trade_org.is_none()
        && city_organization(city) == p.culprit_org
        && town_hall_of(world, city).is_some()
}

/// Why a punishment heads home now, if it does (`whyHeadHome`, `CONTEXT.md`: Punishment trip).
/// Wherever it is, when the debt it came about is no longer owed, the admin directive it was sent
/// for is lifted or the city is no longer the culprit's. On the road only when it has been trying
/// for `TRADE_ORG_PUNISH.road_times` the straight walk: it has no way there. At the city once it has
/// taken its worth, when the storages hold nothing (for an army that wrecks: no workplaces are
/// left), or `TRADE_ORG_PUNISH.give_up_days` after it arrived.
fn why_head_home(
    world: &WorldState,
    hq: &City,
    p: &Punishment,
    city: Option<&City>,
    took: f64,
    size: i32,
) -> Option<PunishmentEnd> {
    let takes = p.takes == Some(true);
    if takes && city.is_some_and(|c| c.trade_org == Some(csp_shared::world::TradeOrgCity::Post)) {
        return Some(PunishmentEnd::TookCity);
    }
    if (p.wrecks.is_some() || takes) && !world.debts.iter().any(|d| d.org == p.culprit_org) {
        return Some(if took >= p.worth { PunishmentEnd::Enough } else { PunishmentEnd::Paid });
    }
    if directive_lifted(world, p) {
        return Some(PunishmentEnd::DirectiveLifted);
    }
    let Some(city) = city.filter(|c| still_the_culprits(world, p, c)) else {
        return Some(PunishmentEnd::CityLost);
    };
    let Some(arrived_at) = p.arrived_at else {
        let hall = town_hall_of(world, hq);
        let target = town_hall_of(world, city);
        let tiles = match (hall, target) {
            (Some(h), Some(t)) => dist(size, (h.x, h.y), (t.x, t.y)),
            _ => 0.0,
        };
        let most = (TRADE_ORG_PUNISH.give_up_days * TICKS_PER_GAME_DAY)
            .max(TRADE_ORG_PUNISH.road_times * tiles * WALK_TICKS_PER_TILE);
        return (world.tick as f64 - p.started_at >= most).then_some(PunishmentEnd::NoWay);
    };
    if let Some(wrecks) = &p.wrecks {
        if wrecks.is_empty() {
            return Some(PunishmentEnd::NoWorkplaces);
        }
    } else if takes {
        if city.occupation.as_ref().is_some_and(|o| o.realm_id == TRADE_ORG) {
            return None;
        }
    } else {
        if took >= p.worth {
            return Some(PunishmentEnd::Enough);
        }
        if storages_to_take(world, city).is_empty() {
            return Some(PunishmentEnd::Empty);
        }
    }
    let stayed = world.tick as f64 - arrived_at;
    (stayed >= TRADE_ORG_PUNISH.give_up_days * TICKS_PER_GAME_DAY).then_some(PunishmentEnd::GaveUp)
}

/// The Food the rest of the trip takes a member, in units (`foodNeeded`, `CONTEXT.md`: Punishment
/// trip): on the way there, for the walk there, their time there and the walk back; from then on,
/// for the walk back to the HQ.
fn food_needed(
    world: &WorldState,
    hq: &City,
    p: &Punishment,
    city: Option<&City>,
    r: &Resident,
    size: i32,
) -> f64 {
    let Some(hall) = town_hall_of(world, hq) else { return 0.0 };
    let hall = (hall.x, hall.y);
    let target = city.and_then(|c| town_hall_of(world, c)).map(|t| (t.x, t.y));
    match target {
        Some(target) if p.heading != PunishmentHeading::Home && p.arrived_at.is_none() => {
            let tiles = dist(size, xy(r), target) + dist(size, target, hall);
            trip_food(tiles) + TRADE_ORG_PUNISH.give_up_days * FOOD_PER_DAY
        }
        _ => trip_food(dist(size, xy(r), hall)),
    }
}

/// The Food a member still wants on them for the trip, in units (`foodWanted`, `food_needed`): on
/// the way there never into the room they keep for what they will carry home.
fn food_wanted(
    world: &WorldState,
    hq: &City,
    p: &Punishment,
    city: Option<&City>,
    r: &Resident,
    size: i32,
) -> f64 {
    let needed = food_needed(world, hq, p, city, r, size);
    if p.heading == PunishmentHeading::Home || p.arrived_at.is_some() {
        return needed;
    }
    let food = good_weight(Good::Food);
    let others = stock_weight(&r.carried) - held(&r.carried, Good::Food) * food;
    let room = carry_capacity(r, world.tick as f64) - others - TRADE_ORG_PUNISH.pack_room;
    needed.min((room / food).floor())
}

/// The Food a member on the road is short of and would buy, in units (`foodToBuy`): what the rest
/// of the trip takes them above what they carry and their share of what is on the wagon, as far as
/// they `wanted` it on them.
fn food_to_buy(r: &Resident, needed: f64, wanted: f64, wagon_share: f64) -> f64 {
    let carried = held(&r.carried, Good::Food);
    (needed - carried - wagon_share).min(wanted - carried).floor()
}

/// The finished buildings of the given cities with Food to take (`foodIn`), by index: their
/// storages, or where those have none, their warehouses, which keep Food for sale.
pub fn food_in(world: &WorldState, city_ids: &HashSet<String>) -> Vec<usize> {
    let stores: Vec<usize> = (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            matches!(b.kind, BuildingKind::Storage | BuildingKind::Warehouse)
                && b.site.is_none()
                && city_ids.contains(b.city_id.as_deref().unwrap_or(""))
                && held_in(b.stock.as_ref(), Good::Food) > 0.0
        })
        .collect();
    let storages: Vec<usize> = stores
        .iter()
        .copied()
        .filter(|&i| world.buildings[i].kind == BuildingKind::Storage)
        .collect();
    if storages.is_empty() {
        stores
    } else {
        storages
    }
}

/// Where a member may refill on the way, within `TRADE_ORG_PUNISH.post_reach` tiles of them
/// (`refillPlaces`): the Trade Organization's cities, the trading posts they pass, and `robbing`,
/// the city the army reached, while it may still take from it.
fn refill_places(world: &WorldState, robbing: Option<&str>, ri: usize, size: i32) -> Vec<usize> {
    let trade_org: HashSet<String> =
        world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.clone()).collect();
    let mut places = food_in(world, &trade_org);
    if let Some(robbing) = robbing {
        places.extend(food_in(world, &HashSet::from([robbing.to_string()])));
    }
    let at = xy(&world.residents[ri]);
    places
        .into_iter()
        .filter(|&b| {
            let b = &world.buildings[b];
            dist(size, at, (b.x, b.y)) <= TRADE_ORG_PUNISH.post_reach
        })
        .collect()
}

/// Whose own stock what a resident fetches counts in (`own` of `fetchFood`).
#[derive(Debug, Clone, Copy)]
pub enum Own {
    /// A member of a punishment: (punishment, member).
    Member(usize, usize),
    /// Nobody's, as for a supply wagon's driver.
    Nobody,
}

/// Sends a resident for the Food they are short of (`fetchFood`, `CONTEXT.md`: Punishment trip) to
/// the nearest of `places`, if they have any: whole units, none for less. What they take for the
/// trip is their own (`own`), not what the army came to take. Answers whether they are seeing to it.
pub fn fetch_food(
    world: &mut WorldState,
    places: &dyn Fn(&WorldState) -> Vec<usize>,
    ri: usize,
    own: Own,
    wanted: f64,
    size: i32,
) -> bool {
    let r = &world.residents[ri];
    let short = (wanted - held(&r.carried, Good::Food)).floor().min(units_that_fit(
        r,
        Good::Food,
        world.tick as f64,
    ));
    if short < 1.0 {
        return false;
    }
    let found = places(world);
    if found.is_empty() {
        return false;
    }
    let at = xy(r);
    let d = |b: usize| dist(size, at, (world.buildings[b].x, world.buildings[b].y));
    let mut si = found[0];
    for &b in &found[1..] {
        if d(b) < d(si) {
            si = b;
        }
    }
    let storage = &world.buildings[si];
    if !is_at(tile(at.0, at.1), placed(storage), size) {
        let to = (storage.x, storage.y);
        head_for(world, ri, to);
        return true;
    }
    let food = short.min(held_in(storage.stock.as_ref(), Good::Food).floor());
    if food < 1.0 {
        return false;
    }
    let order = ResidentOrder::PickUp(PickUpOrder {
        from: GoodsSpot::Storage { storage_id: storage.id.clone() },
        goods: [(Good::Food, food)].into_iter().collect(),
    });
    world.residents[ri].order = Some(order);
    if let Own::Member(pi, mi) = own {
        let own = &mut world.punishments[pi].members[mi].own;
        let had = held(own, Good::Food);
        own.insert(Good::Food, had + food);
    }
    true
}

/// Which of the Trade Org's soldiers wait this tick, on a map of `size` tiles (`waitingOnTheRoad`,
/// `CONTEXT.md`: Army, Punishment trip): those walking the road, to the city or home to the HQ,
/// with more than `ARMY_SPREAD` tiles fewer to go than the one furthest behind, so that they keep
/// together with their supply wagon.
pub fn waiting_on_the_road(world: &WorldState, size: i32) -> HashSet<String> {
    let mut waiting = HashSet::new();
    let hq = trade_org_hq(world);
    for p in &world.punishments {
        if p.heading == PunishmentHeading::Out && p.arrived_at.is_some() {
            continue;
        }
        let city = world.cities.iter().find(|c| c.id == p.city_id);
        let hall = city.and_then(|c| town_hall_of(world, c));
        let walkers: Vec<(&str, usize)> = living(world, p)
            .into_iter()
            .filter_map(|(_, ri)| {
                let r = &world.residents[ri];
                let Some(ResidentOrder::WalkTo(o)) = &r.order else { return None };
                let path = o.path.as_ref()?;
                let on_the_road = if p.heading == PunishmentHeading::Out {
                    hall.is_some_and(|h| o.target.x == h.x && o.target.y == h.y)
                } else {
                    hq.is_some_and(|hq| in_city_area(world, &hq.id, o.target.x, o.target.y, size))
                };
                on_the_road.then_some((r.id.as_str(), path.len()))
            })
            .collect();
        if walkers.len() < 2 {
            continue;
        }
        let behind = walkers.iter().map(|w| w.1).max().unwrap_or(0) as f64;
        for (id, left) in walkers {
            if (left as f64) < behind - ARMY_SPREAD {
                waiting.insert(id.to_string());
            }
        }
    }
    waiting
}

/// What a member has eaten stops counting as their own (`eatFromOwn`), so that Food they take later
/// is told from it. Their own food (`OWN_FOOD`) always counts, or a meal taken at home would look
/// like loot. So do Coins they spent (`buy_food`), or Coins they take later would look like what
/// they brought.
fn eat_from_own(r: &Resident, own: &mut Stock) {
    let food = OWN_FOOD.max(held(own, Good::Food).min(held(&r.carried, Good::Food)));
    own.insert(Good::Food, food);
    if let Some(coins) = own.get_mut(&Good::Coins) {
        *coins = coins.min(held(&r.carried, Good::Coins));
    }
}

/// A line in the culprit's log about a punishment (`logPunished`, `CONTEXT.md`: Punishment trip).
fn log_punished(
    world: &mut WorldState,
    pi: usize,
    city: Option<&City>,
    what: PunishedWhat,
    why: Option<PunishmentEnd>,
    r#where: Option<PunishedWhere>,
) {
    let p = &world.punishments[pi];
    let line = RealmEventWhat::Punished {
        what,
        city_id: p.city_id.clone(),
        city: city.map_or_else(|| "a city".to_string(), |c| c.name.clone()),
        worth: p.worth,
        took: Some(p.took),
        why,
        r#where,
        directive: None,
        wrecks: p.wrecks.is_some().then_some(true),
        takes: (p.takes == Some(true)).then_some(true),
    };
    let org = p.culprit_org.clone();
    record_event(world, Some(&org), line);
}

/// What a punishment for crimes came for and didn't take stays owed (`leaveDebt`, `CONTEXT.md`:
/// Trade Org debt), from when it heads home or is lost. `took` is what it got; one sent for an
/// admin directive leaves no debt, nor does one that came to tear down workplaces for a debt, which
/// still stands.
fn leave_debt(world: &mut WorldState, p: &Punishment, took: f64) {
    if p.directive_id.is_none() && p.wrecks.is_none() && p.takes != Some(true) {
        owe_trade_org(world, &p.culprit_org, p.worth - took, Some(&p.city_id), FirstOwed::Owed);
    }
}

/// One tick of punishment `pi` (`runPunishment`, `CONTEXT.md`: Trade Org reaction, Punishment
/// trip). See the TypeScript for the whole story: each member packs at the HQ, walks to the city's
/// town hall refilling and buying Food on the way, and there goes after anyone attacking one of
/// them, else takes from the storages, tears down workplaces (`wrecks`) or holds the town hall
/// (`takes`); heading home, each brings what they took into the HQ's warehouses and walks home.
fn run_punishment(world: &mut WorldState, hq: &City, pi: usize, size: i32) {
    let members = living(world, &world.punishments[pi]);
    let city = world.cities.iter().find(|c| c.id == world.punishments[pi].city_id).cloned();
    if members.is_empty() {
        let p = world.punishments[pi].clone();
        let r#where = match (p.heading, p.arrived_at) {
            (PunishmentHeading::Home, _) => PunishedWhere::WayHome,
            (_, None) => PunishedWhere::WayThere,
            _ => PunishedWhere::AtCity,
        };
        log_punished(world, pi, city.as_ref(), PunishedWhat::Lost, None, Some(r#where));
        world.punishments.remove(pi);
        // Nobody is left carrying anything but its wagon, which goes home by itself; on the way
        // home the debt was settled as it left.
        if p.heading == PunishmentHeading::Out {
            let took = wagon_took(world, &p).min(p.worth);
            leave_debt(world, &p, took);
        }
        return;
    }
    for &(mi, ri) in &members {
        let mut own = std::mem::take(&mut world.punishments[pi].members[mi].own);
        eat_from_own(&world.residents[ri], &mut own);
        world.punishments[pi].members[mi].own = own;
    }
    let p = &world.punishments[pi];
    let wrecks_or_takes = p.wrecks.is_some() || p.takes == Some(true);
    let took = if wrecks_or_takes { p.took } else { took_so_far(world, p) };
    let debt = if wrecks_or_takes {
        world.debts.iter().position(|d| d.org == p.culprit_org)
    } else {
        None
    };
    if world.punishments[pi].heading == PunishmentHeading::Out {
        if let Some(d) = debt {
            let p = &mut world.punishments[pi];
            p.worth = p.took + world.debts[d].coins;
        }
        let p = &mut world.punishments[pi];
        p.took = took.min(p.worth);
        let p = &world.punishments[pi];
        let arrives = p.arrived_at.is_none()
            && city.as_ref().is_some_and(|c| {
                still_the_culprits(world, p, c)
                    && members.iter().any(|&(_, ri)| {
                        let r = &world.residents[ri];
                        in_city_area(world, &c.id, r.x, r.y, size)
                    })
            });
        if arrives {
            world.punishments[pi].arrived_at = Some(world.tick as f64);
            log_punished(world, pi, city.as_ref(), PunishedWhat::Arrived, None, None);
            if world.punishments[pi].wrecks.is_some() {
                if let Some(d) = debt {
                    let trips = world.debts[d].trips.unwrap_or(0.0) + 1.0;
                    world.debts[d].trips = Some(trips);
                }
            }
        }
        let p = &world.punishments[pi];
        if p.wrecks.is_some() && p.arrived_at.is_some() {
            if let Some(c) = city.as_ref().filter(|c| still_the_culprits(world, p, c)) {
                find_workplaces(world, pi, c, size);
            }
        }
        let why = why_head_home(world, hq, &world.punishments[pi], city.as_ref(), took, size);
        if let Some(why) = why {
            world.punishments[pi].heading = PunishmentHeading::Home;
            let what = if world.punishments[pi].arrived_at.is_none() {
                PunishedWhat::TurnedBack
            } else {
                PunishedWhat::Left
            };
            log_punished(world, pi, city.as_ref(), what, Some(why), None);
            let p = world.punishments[pi].clone();
            leave_debt(world, &p, p.took);
        }
    }
    let p = world.punishments[pi].clone();
    let robbing: Option<City> = city.clone().filter(|c| {
        p.arrived_at.is_some() && still_the_culprits(world, &p, c) && !directive_lifted(world, &p)
    });
    let takes = p.takes == Some(true);
    let storages = match &robbing {
        Some(c) if p.wrecks.is_none() && !takes => storages_to_take(world, c),
        _ => Vec::new(),
    };
    let wrecking: Vec<usize> = match (&robbing, debt) {
        (Some(_), Some(d)) if p.heading == PunishmentHeading::Out => {
            workplaces_to_wreck(world, &p, world.debts[d].coins)
        }
        _ => Vec::new(),
    };
    let target =
        city.as_ref().and_then(|c| town_hall_of(world, c)).map(|h| (h.x, h.y, h.id.clone()));
    let ids: HashSet<String> =
        members.iter().map(|&(_, ri)| world.residents[ri].id.clone()).collect();
    let on = wagon_of(world, &p);
    let mut resisting: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.health > 0.0
                && !ids.contains(&r.id)
                && matches!(&r.order, Some(ResidentOrder::Attack(o)) if ids.contains(&o.target_id))
        })
        .collect();
    // Those robbing its supply wagon or going after its driver are fought too, like a caravan's.
    if let Some((wi, ki)) = on {
        let mut crew: HashSet<String> = ids.clone();
        if let Some(d) = &world.supply_wagons[wi].driver_id {
            crew.insert(d.clone());
        }
        for t in crew_threats(world, &crew, ki, size) {
            if !resisting.contains(&t) {
                resisting.push(t);
            }
        }
    }
    let mut left = p.worth - took;
    let on_the_road = p.heading == PunishmentHeading::Home || p.arrived_at.is_none();
    let wagon_share = on.map_or(0.0, |(_, ki)| {
        held(&world.carriages[ki].load, Good::Food) / (members.len() as f64 + 1.0)
    });
    // Holding the hall: whoever stands in its way there is fought, and one of them stays on it
    // whatever else the others go for, or the days are lost.
    let holding = match (&robbing, &target) {
        (Some(_), Some(t)) if takes && p.heading == PunishmentHeading::Out => Some(t.clone()),
        _ => None,
    };
    if let (Some(_), Some(robbing)) = (&holding, &robbing) {
        for t in hall_blockers(world, robbing, &ids, size) {
            if !resisting.contains(&t) {
                resisting.push(t);
            }
        }
    }
    let hall_index = |world: &WorldState| {
        holding.as_ref().and_then(|h| world.buildings.iter().position(|b| b.id == h.2))
    };
    let keeper: Option<usize> = hall_index(world).and_then(|hi| {
        let hall = &world.buildings[hi];
        members.iter().map(|&(_, ri)| ri).find(|&ri| {
            let r = &world.residents[ri];
            is_at(tile(r.x, r.y), placed(hall), size)
        })
    });
    let wrecking_ids: Vec<String> =
        wrecking.iter().map(|&b| world.buildings[b].id.clone()).collect();
    for &(mi, ri) in &members {
        if let Some(ResidentOrder::TearDown(o)) = &world.residents[ri].order {
            if !wrecking_ids.contains(&o.building_id) {
                world.residents[ri].order = None;
            }
        }
        if matches!(world.residents[ri].order, Some(ResidentOrder::Attack(_))) {
            continue;
        }
        if !resisting.is_empty() {
            let me = xy(&world.residents[ri]);
            let mut nearest = resisting[0];
            for &t in &resisting[1..] {
                if dist(size, me, xy(&world.residents[t]))
                    < dist(size, me, xy(&world.residents[nearest]))
                {
                    nearest = t;
                }
            }
            let id = world.residents[nearest].id.clone();
            world.residents[ri].order =
                Some(ResidentOrder::Attack(attack_order(&id, false, false)));
            continue;
        }
        let p = world.punishments[pi].clone();
        let wanted = food_wanted(world, hq, &p, city.as_ref(), &world.residents[ri], size);
        if p.heading == PunishmentHeading::Out && p.members[mi].packed != Some(true) {
            if pack_purse(world, hq, pi, mi, ri, size) {
                continue;
            }
            let hq_id = HashSet::from([hq.id.clone()]);
            let places = move |w: &WorldState| food_in(w, &hq_id);
            if fetch_food(world, &places, ri, Own::Member(pi, mi), wanted, size) {
                if matches!(world.residents[ri].order, Some(ResidentOrder::PickUp(_))) {
                    world.punishments[pi].members[mi].packed = Some(true);
                }
                continue;
            }
            world.punishments[pi].members[mi].packed = Some(true);
        }
        if on_the_road {
            let r = &world.residents[ri];
            let needed = food_needed(world, hq, &p, city.as_ref(), r, size);
            let units = food_to_buy(r, needed, wanted, wagon_share);
            if buy_food(world, hq, pi, mi, ri, units, size) {
                continue;
            }
        }
        if Some(ri) == keeper {
            continue;
        }
        if let Some((_, ki)) = on {
            if go_to_wagon_for_food(world, ri, ki, size) {
                continue;
            }
        }
        let robbing_id = robbing.as_ref().map(|c| c.id.clone());
        let places = move |w: &WorldState| refill_places(w, robbing_id.as_deref(), ri, size);
        if fetch_food(world, &places, ri, Own::Member(pi, mi), wanted, size) {
            continue;
        }
        if let Some((_, ki)) = on {
            if load_on_wagon(world, ri, pi, mi, ki, size) {
                continue;
            }
        }
        if p.heading == PunishmentHeading::Home {
            let taken = handing_in(world, hq, &world.residents[ri], &p.members[mi].own);
            bring_home(world, hq, ri, &taken, size);
            continue;
        }
        if p.arrived_at.is_none() {
            if let Some(t) = &target {
                head_for(world, ri, (t.0, t.1));
            }
            continue;
        }
        if p.wrecks.is_some() {
            tear_down_next(world, ri, &wrecking, size, head_for);
            continue;
        }
        if takes {
            if let Some(hi) = hall_index(world) {
                let hall = &world.buildings[hi];
                let r = &world.residents[ri];
                if !is_at(tile(r.x, r.y), placed(hall), size) {
                    let to = (hall.x, hall.y);
                    head_for(world, ri, to);
                }
            }
            continue;
        }
        if storages.is_empty() {
            continue;
        }
        let me = xy(&world.residents[ri]);
        let d = |b: usize| dist(size, me, (world.buildings[b].x, world.buildings[b].y));
        let mut si = storages[0];
        for &b in &storages[1..] {
            if d(b) < d(si) {
                si = b;
            }
        }
        let storage = &world.buildings[si];
        if !is_at(tile(me.0, me.1), placed(storage), size) {
            let to = (storage.x, storage.y);
            head_for(world, ri, to);
            continue;
        }
        let (goods, worth) = to_take(world, &world.residents[ri], si, left);
        if worth <= 0.0 {
            continue;
        }
        let order = ResidentOrder::PickUp(PickUpOrder {
            from: GoodsSpot::Storage { storage_id: storage.id.clone() },
            goods,
        });
        world.residents[ri].order = Some(order);
        left -= worth;
    }
    let p = &world.punishments[pi];
    let done = p.heading == PunishmentHeading::Home
        && members.iter().all(|&(mi, ri)| {
            let r = &world.residents[ri];
            handing_in(world, hq, r, &p.members[mi].own).is_empty()
                && in_city_area(world, &hq.id, r.x, r.y, size)
        });
    if done {
        world.punishments.remove(pi);
    }
}

/// What a member heading home hands in at the HQ (`handingIn`): what they took, and all the Coins
/// they carry, what they brought to buy Food with included, as long as a warehouse there keeps
/// Coins.
fn handing_in(world: &WorldState, hq: &City, r: &Resident, own: &Stock) -> Stock {
    let mut taken = taken_by(r, own);
    let coins = held(&r.carried, Good::Coins);
    if coins <= 0.0 {
        return taken;
    }
    let kept = world.buildings.iter().any(|b| {
        b.city_id.as_deref() == Some(hq.id.as_str())
            && warehouse_keeps(world, b).contains(&Good::Coins)
    });
    if kept {
        taken.insert(Good::Coins, coins);
    }
    taken
}

/// A member heading home puts what they took into the HQ's warehouses (`bringHome`): Coins into
/// the one that keeps them, other goods into the one that keeps those. With nothing left to bring,
/// they walk home.
fn bring_home(world: &mut WorldState, hq: &City, ri: usize, taken: &Stock, size: i32) {
    let goods: Vec<Good> = taken.keys().copied().collect();
    let at = tile(world.residents[ri].x, world.residents[ri].y);
    for b in &world.buildings {
        if b.city_id.as_deref() != Some(hq.id.as_str()) {
            continue;
        }
        let keeps = warehouse_keeps(world, b);
        let here: Vec<Good> = goods.iter().copied().filter(|g| keeps.contains(g)).collect();
        if here.is_empty() {
            continue;
        }
        if !is_at(at, placed(b), size) {
            let to = (b.x, b.y);
            head_for(world, ri, to);
            return;
        }
        let put: Stock = here.iter().map(|&g| (g, held(taken, g))).collect();
        let order = ResidentOrder::Drop(DropOrder {
            to: GoodsSpot::Storage { storage_id: b.id.clone() },
            goods: put,
        });
        world.residents[ri].order = Some(order);
        return;
    }
    // Goods no HQ warehouse keeps stay carried, like a soldier's own.
    let home = npc_home(world, &hq.id).map(|h| (h.x, h.y));
    let r = &world.residents[ri];
    if let Some(home) = home {
        if !in_city_area(world, &hq.id, r.x, r.y, size) {
            head_for(world, ri, home);
        }
    }
}

/// The Trade Organization's punishments hold together (`punishmentsSound`, `CONTEXT.md`: Trade Org
/// reaction; ADR 0004): each punishes an Organization other than the Trade Organization, at most one
/// under way for each, for a positive worth of which it took no more than all and nothing before it
/// arrived; its members are residents of the HQ, each in one punishment at most and in no contract,
/// having brought no less than no Coins. An army that takes a city takes goods from nobody, tears
/// nothing down and comes for a debt whose trips are over. No city ever has the Trade Organization
/// for a realm.
#[allow(clippy::neg_cmp_op_on_partial_ord)] // NaN fails it, as in the TypeScript.
pub fn punishments_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let n = crate::invariants::js_number;
    let mut out = Vec::new();
    let mut fail = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation { invariant: "punishments-sound".into(), message, entity_ids })
    };
    let hq = trade_org_hq(world);
    let mut orgs = HashSet::new();
    let mut members = HashSet::new();
    for p in &world.punishments {
        let pid = || vec![p.id.clone()];
        let takes = p.takes == Some(true);
        if !takes && standing_organization(world, &p.culprit_org) == TRADE_ORG {
            fail(format!("punishment {} punishes the Trade Organization itself", p.id), pid());
        }
        if takes {
            if p.wrecks.is_some() || p.directive_id.is_some() || p.took != 0.0 {
                fail(
                    format!("punishment {} takes a city and does something else too", p.id),
                    pid(),
                );
            }
            if let Some(debt) = world.debts.iter().find(|d| d.org == p.culprit_org) {
                let trips = debt.trips.unwrap_or(0.0);
                if trips < TRADE_ORG_DEBT_TRIPS {
                    fail(
                        format!("punishment {} takes a city after {} trips", p.id, n(trips)),
                        pid(),
                    );
                }
            }
        }
        if !(p.worth > 0.0) {
            fail(format!("punishment {} is worth {}", p.id, n(p.worth)), pid());
        }
        if !(p.took >= 0.0 && p.took <= p.worth) {
            fail(format!("punishment {} took {} of its {}", p.id, n(p.took), n(p.worth)), pid());
        }
        if p.took > 0.0 && p.arrived_at.is_none() {
            fail(format!("punishment {} took {} before it arrived", p.id, n(p.took)), pid());
        }
        if p.arrived_at.is_some_and(|a| a < p.started_at) {
            fail(format!("punishment {} arrived before it set out", p.id), pid());
        }
        if !orgs.insert(p.culprit_org.as_str()) {
            fail(format!("{} is punished twice at once", p.culprit_org), pid());
        }
        for m in &p.members {
            let id = &m.resident_id;
            let both = || vec![p.id.clone(), id.clone()];
            let r = world.residents.iter().find(|x| &x.id == id);
            if held(&m.own, Good::Coins) < 0.0 {
                fail(format!("{id} brought {} Coins", n(held(&m.own, Good::Coins))), both());
            }
            if let Some(r) = r {
                if r.owner.is_some() || r.city_id.as_deref() != hq.map(|h| h.id.as_str()) {
                    fail(
                        format!("punishment {} sends {id}, who is not of the Trade Org HQ", p.id),
                        both(),
                    );
                }
            }
            if !members.insert(id.as_str()) {
                fail(format!("{id} is in two punishments"), both());
            }
            if world.contracts.iter().any(|c| c.resident_ids.contains(id)) {
                fail(format!("punishment {} sends {id}, who is in a contract", p.id), both());
            }
        }
    }
    for c in &world.cities {
        if c.realm_id.as_deref() == Some(TRADE_ORG) {
            fail(format!("the Trade Organization holds city {}", c.id), vec![c.id.clone()]);
        }
    }
    out
}

#[cfg(test)]
mod tests;
