//! Stand-ins for helpers other Epic 86 tickets own, which the realm-level rules (T86.11) need
//! before they land. Each is a port of its TypeScript, marked `TODO(T86.x)` with the ticket that
//! owns it; whichever merges second swaps these for the real ones. T86.4's `movement_pending.rs`
//! has twins of some of them: they go the same way.

use std::collections::HashSet;

use csp_shared::balance::REALM_LOG_LENGTH;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, Realm, RealmEvent, RealmEventWhat, WorldState};

use crate::queries::standing::TRADE_ORG;

// ---- T86.2 (`orders.ts`) --------------------------------------------------------------------------

/// Who sent an order (`OrderSender`): a Player's account, or an NPC city's game default.
// TODO(T86.2): the real `OrderSender`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OrderSender {
    pub user_id: u64,
    pub npc_city_id: Option<String>,
}

/// An order kind (`OrderKind`): checks an order when it comes, applies it at the next tick.
// TODO(T86.2): the real `OrderKind` and its registry.
pub trait OrderKind {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String>;
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    );
}

/// A string field of an order, if it is one.
pub fn str_field<'o>(order: &'o OrderRequest, name: &str) -> Option<&'o str> {
    order.fields.get(name).and_then(|v| v.as_str())
}

/// A number field of an order, if it is one.
pub fn num_field(order: &OrderRequest, name: &str) -> Option<f64> {
    order.fields.get(name).and_then(|v| v.as_f64())
}

// ---- T86.8 (`starting-city.ts`) -------------------------------------------------------------------

/// The Player's realm (`realmOf`).
// TODO(T86.8): `starting_city::realm_of`.
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<&Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

// ---- T86.13 (`events.ts`) -------------------------------------------------------------------------

/// Notes an event in the realm's log (`recordEvent`), keeping the newest `REALM_LOG_LENGTH`.
// TODO(T86.13): `events::record_event`.
pub fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let Some(user_id) =
        realm_id.and_then(|id| world.realms.iter().find(|r| r.id == id)).map(|r| r.user_id)
    else {
        return;
    };
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    let keep = REALM_LOG_LENGTH as usize;
    if mine > keep {
        let mut drop = mine - keep;
        world.events.retain(|e| {
            if drop > 0 && e.user_id == user_id {
                drop -= 1;
                return false;
            }
            true
        });
    }
}

// ---- T86.7 (`alliance.ts`'s names, `standing.ts`, `armies.ts`) -----------------------------------

/// The Trade Organization's name (`TRADE_ORG_NAME`).
pub const TRADE_ORG_NAME: &str = "the Trade Organization";

/// How Players call a realm (`realmName`): its realm name, else its Leader's name.
// TODO(T86.7): `queries::alliance::realm_name`.
pub fn realm_name(world: &WorldState, realm_id: &str) -> String {
    if realm_id == TRADE_ORG {
        return TRADE_ORG_NAME.to_string();
    }
    let realm = world.realms.iter().find(|r| r.id == realm_id);
    if let Some(name) = realm.and_then(|r| r.name.clone()) {
        return name;
    }
    realm
        .and_then(|realm| world.residents.iter().find(|r| r.id == realm.leader_id))
        .map_or_else(|| "a fallen realm".to_string(), |r| r.name.clone())
}

/// What an Organization is called (`organizationLabel`): the Trade Organization, a city's name,
/// or a realm's.
// TODO(T86.7): `queries::standing::organization_label`.
pub fn organization_label(world: &WorldState, org: &str) -> String {
    if org == TRADE_ORG {
        return TRADE_ORG_NAME.to_string();
    }
    match world.cities.iter().find(|c| c.id == org) {
        Some(c) => c.name.clone(),
        None => realm_name(world, org),
    }
}

/// Takes residents out of every army; an army left with nobody is gone (`leaveArmies`).
// TODO(T86.7): `armies::leave_armies`.
pub fn leave_armies(world: &mut WorldState, ids: &HashSet<String>) {
    for a in &mut world.armies {
        a.member_ids.retain(|id| !ids.contains(id));
    }
    world.armies.retain(|a| !a.member_ids.is_empty());
}

/// Whether two realms stand together (`allied`): the same, or members of one alliance.
// TODO(T86.7): `queries::alliance::allied`.
pub fn allied(world: &WorldState, a: &str, b: &str) -> bool {
    a == b || crate::queries::alliance::allied_realms(world, a).iter().any(|x| x == b)
}

// ---- T86.5 / T86.9 (`trade-org.ts`, `trade-org-army.ts`, `caravans.ts`) --------------------------

/// The Trade Org HQ, while it stands (`tradeOrgHq`).
// TODO(T86.5): `queries::trade_org::trade_org_hq`.
pub fn trade_org_hq(world: &WorldState) -> Option<&csp_shared::world::City> {
    world.cities.iter().find(|c| c.trade_org == Some(csp_shared::world::TradeOrgCity::Hq))
}

/// The side a resident is on in a contract (`contractSide`): their realm, the Trade Organization
/// for one of its cities, an NPC city of no realm; None otherwise.
// TODO(T86.5/T86.9): `queries::trade_org::contract_side`.
pub fn contract_side(world: &WorldState, r: &csp_shared::world::Resident) -> Option<String> {
    if let Some(owner) = &r.owner {
        return Some(owner.clone());
    }
    let city = world.cities.iter().find(|c| r.city_id.as_ref() == Some(&c.id))?;
    if city.trade_org.is_some() {
        return Some(TRADE_ORG.to_string());
    }
    city.realm_id.is_none().then(|| city.id.clone())
}

/// The Trade Org HQ's soldiers it can hire out (`spareSoldiers`): its living armed residents off
/// the caravans, in no contract and on no punishment trip, by id, less the guard it keeps.
// TODO(T86.9): `trade_org_army::spare_soldiers`.
pub fn spare_soldiers(world: &WorldState) -> Vec<&csp_shared::world::Resident> {
    use crate::queries::npc_trade::locale_compare;
    use crate::queries::residents::is_armed;
    let Some(hq) = trade_org_hq(world) else { return Vec::new() };
    let mut crew: HashSet<&str> = HashSet::new();
    for (driver, escorts) in world
        .caravans
        .iter()
        .map(|c| (&c.driver_id, &c.escort_ids))
        .chain(world.traders.iter().map(|t| (&t.driver_id, &t.escort_ids)))
    {
        crew.extend(driver.as_deref());
        crew.extend(escorts.iter().map(String::as_str));
    }
    let mut named: HashSet<&str> =
        world.contracts.iter().flat_map(|c| c.resident_ids.iter().map(String::as_str)).collect();
    named.extend(
        world.punishments.iter().flat_map(|p| p.members.iter().map(|m| m.resident_id.as_str())),
    );
    named.extend(world.supply_wagons.iter().filter_map(|w| w.driver_id.as_deref()));
    let mut home: Vec<_> = world
        .residents
        .iter()
        .filter(|r| {
            r.owner.is_none()
                && r.city_id.as_ref() == Some(&hq.id)
                && r.health > 0.0
                && is_armed(&r.carried)
                && !crew.contains(r.id.as_str())
                && !named.contains(r.id.as_str())
        })
        .collect();
    home.sort_by(|a, b| locale_compare(&a.id, &b.id));
    let keep = home.len().saturating_sub(csp_shared::balance::TRADE_ORG_ARMY.guard as usize);
    home.truncate(keep);
    home
}

/// The realm a building is of (`buildingRealm`): a site's own realm, else its city's, else its own.
// TODO(T86.6/T86.8): `queries::city::building_realm`.
pub fn building_realm(world: &WorldState, b: &csp_shared::world::Building) -> Option<String> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.clone();
    }
    match &b.city_id {
        Some(id) => world.cities.iter().find(|c| c.id == *id).and_then(|c| c.realm_id.clone()),
        None => b.realm_id.clone(),
    }
}

// ---- T86.7 (`standing.ts`) -------------------------------------------------------------------------

/// Moves how `of` regards `toward` by `delta`, within `STANDING_RANGE` (`changeStanding`).
// TODO(T86.7): `standing::change_standing`.
pub fn change_standing(world: &mut WorldState, of: &str, toward: &str, delta: f64) {
    use crate::queries::standing::standing_organization;
    use csp_shared::balance::STANDING_RANGE;
    let a = standing_organization(world, of).to_string();
    let b = standing_organization(world, toward).to_string();
    if a == b || delta == 0.0 {
        return;
    }
    let s = world.standings.iter().position(|x| x.of == a && x.toward == b);
    let value = (-STANDING_RANGE)
        .max(STANDING_RANGE.min(s.map_or(0.0, |i| world.standings[i].value) + delta));
    match s {
        Some(i) => world.standings[i].value = value,
        None => world.standings.push(csp_shared::world::Standing { of: a, toward: b, value }),
    }
    if value == 0.0 {
        world.standings.retain(|x| x.value != 0.0);
    }
}

/// `change_standing` both ways (`raiseStandingBothWays`).
// TODO(T86.7): `standing::raise_standing_both_ways`.
pub fn raise_standing_both_ways(world: &mut WorldState, a: &str, b: &str, delta: f64) {
    change_standing(world, a, b, delta);
    change_standing(world, b, a, delta);
}

// ---- T86.10 (`npc-behaviour.ts`) ---------------------------------------------------------------

/// Gives a resident a walk-to order (`walkTo` of `npc-behaviour.ts`).
// TODO(T86.10): `npc_behaviour::walk_to`.
pub fn walk_to(r: &mut csp_shared::world::Resident, x: f64, y: f64) {
    use csp_shared::world::{ResidentOrder, Tile, WalkOrder};
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

// ---- T86.6 / T86.7 (`city.ts`, `building.ts`) -------------------------------------------------

/// Whether a building counts toward a city's shape (`isCityBuilding`): a finished town hall,
/// house, storage, warehouse, wall or gate.
// TODO(T86.7): `queries::city_area::is_city_building`.
pub fn is_city_building(b: &csp_shared::world::Building) -> bool {
    use csp_shared::world::BuildingKind as K;
    matches!(b.kind, K::TownHall | K::House | K::Storage | K::Warehouse | K::Wall | K::Gate)
        && b.site.is_none()
}

/// Whether (x, y) lies in the city's area (`inCityArea`): within `CITY_AREA_MARGIN` of one of its
/// city buildings.
// TODO(T86.7): `queries::city_area::in_city_area`.
pub fn in_city_area(world: &WorldState, city_id: &str, x: f64, y: f64, size: i32) -> bool {
    use crate::queries::names::placed;
    use csp_shared::balance::CITY_AREA_MARGIN;
    use csp_shared::footprint::near_footprint;
    world.buildings.iter().any(|b| {
        b.city_id.as_deref() == Some(city_id)
            && is_city_building(b)
            && near_footprint(placed(b), (x as i32, y as i32), CITY_AREA_MARGIN as i32, size)
    })
}

/// The residents working at a workplace now (`workersOf`): a work order there, standing at it.
// TODO(T86.6): `queries::building::workers_of`.
pub fn workers_of<'w>(
    world: &'w WorldState,
    b: &csp_shared::world::Building,
) -> Vec<&'w csp_shared::world::Resident> {
    use crate::queries::names::placed;
    use csp_shared::balance::MAP_SIZE;
    use csp_shared::footprint::is_at;
    use csp_shared::world::ResidentOrder;
    world
        .residents
        .iter()
        .filter(|r| {
            matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == b.id)
                && is_at((r.x as i32, r.y as i32), placed(b), MAP_SIZE)
        })
        .collect()
}

// ---- T86.2 / T86.5 (`directive.ts`, `warehouse.ts`) --------------------------------------------

/// The Organizations a directive names (`directiveTargets`): its target, and with `withAlliance`
/// every member of the target's alliance as it stands now.
// TODO(T86.2/T86.5): `queries::directive::directive_targets`.
pub fn directive_targets(world: &WorldState, target: &str, with_alliance: bool) -> Vec<String> {
    if !with_alliance {
        return vec![target.to_string()];
    }
    match world.alliances.iter().find(|a| a.members.iter().any(|m| m.realm_id == target)) {
        Some(a) => a.members.iter().map(|m| m.realm_id.clone()).collect(),
        None => vec![target.to_string()],
    }
}

/// The soldiers of the Organizations a directive names (`directiveSoldiers`).
// TODO(T86.2/T86.5): `queries::directive::directive_soldiers`.
pub fn directive_soldiers<'w>(
    world: &'w WorldState,
    target: &str,
    with_alliance: bool,
) -> Vec<&'w csp_shared::world::Resident> {
    let orgs = directive_targets(world, target, with_alliance);
    world
        .residents
        .iter()
        .filter(|r| {
            let org = r.owner.as_deref().or(r.city_id.as_deref()).unwrap_or("");
            orgs.iter().any(|o| o == org) && crate::queries::residents::is_armed(&r.carried)
        })
        .collect()
}

/// Whether all of a directive's goals are met (`goalsMet`); one with none ends only when lifted.
// TODO(T86.2/T86.5): `queries::directive::goals_met`.
pub fn goals_met(d: &csp_shared::world::Directive) -> bool {
    use csp_shared::world::DirectiveGoal;
    !d.goals.is_empty()
        && d.goals.iter().all(|g| match g {
            DirectiveGoal::City { met, .. } => *met,
            DirectiveGoal::Soldiers { count, .. } => d.soldiers_killed >= *count,
        })
}

/// Where a buy-off at (x, y) pays in (`buyOffCoinWarehouseAt`): the warehouse there if it keeps
/// coins, else its city's coin warehouse.
// TODO(T86.5): `queries::warehouse::buy_off_coin_warehouse_at`.
pub fn buy_off_coin_warehouse_at(world: &WorldState, x: f64, y: f64) -> Option<usize> {
    use crate::queries::names::placed;
    use crate::queries::warehouse::{trade_coin_warehouse, warehouse_keeps};
    use csp_shared::balance::MAP_SIZE;
    use csp_shared::footprint::covers;
    use csp_shared::world::Good;
    let here = world.buildings.iter().find(|b| {
        covers(placed(b), x as i32, y as i32, MAP_SIZE) && !warehouse_keeps(world, b).is_empty()
    })?;
    let w = if warehouse_keeps(world, here).contains(&Good::Coins) {
        Some(here)
    } else {
        trade_coin_warehouse(world, here)
    }?;
    world.buildings.iter().position(|b| b.id == w.id)
}

/// Why the realm's resident can't buy the directive off now (`buyOffProblem`).
// TODO(T86.5): `queries::warehouse::buy_off_problem`.
pub fn buy_off_problem(
    world: &WorldState,
    realm_id: &str,
    r: &csp_shared::world::Resident,
    directive_id: Option<&str>,
    carriage_id: Option<&str>,
) -> Option<String> {
    use crate::queries::names::{held, placed};
    use crate::queries::residents::can_work;
    use crate::queries::warehouse::warehouse_keeps;
    use csp_shared::balance::MAP_SIZE;
    use csp_shared::footprint::{covers, is_at};
    use csp_shared::world::Good;
    let Some(d) = world
        .directives
        .iter()
        .find(|x| Some(x.id.as_str()) == directive_id)
        .filter(|d| d.target == realm_id)
    else {
        return Some("no directive names your realm by that id".into());
    };
    let Some(price) = d.price else { return Some("this directive can’t be bought off".into()) };
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t pay".into());
    }
    let (rx, ry) = (r.x as i32, r.y as i32);
    let at = world
        .buildings
        .iter()
        .find(|b| covers(placed(b), rx, ry, MAP_SIZE) && !warehouse_keeps(world, b).is_empty());
    let Some(at) = at.filter(|_| buy_off_coin_warehouse_at(world, r.x, r.y).is_some()) else {
        return Some("not at a Trade Org warehouse".into());
    };
    let mut stock = &r.carried;
    if let Some(cid) = carriage_id {
        let k = world.carriages.iter().find(|x| x.id == cid);
        let Some(k) = k.filter(|k| {
            crate::queries::alliance::carriage_commander_of(world, k).as_deref() == Some(realm_id)
        }) else {
            return Some("not one of your carriages".into());
        };
        if !is_at((k.x as i32, k.y as i32), placed(at), MAP_SIZE) {
            return Some("that carriage is not at the warehouse".into());
        }
        stock = &k.load;
    }
    (held(stock, Good::Coins) < price).then(|| format!("it costs {} coins", js_number(price)))
}

/// A number as a template string prints it, for the whole numbers the messages hold.
pub fn js_number(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}
