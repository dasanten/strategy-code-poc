//! What each side sees (`apps/server/src/sight.ts`, `CONTEXT.md`: Sight): a realm's Player, or an
//! NPC city, sees everything within `SIGHT_RANGE` of any resident it sees through, and what is
//! inside or how someone fares only as `CONTEXT.md` says (Seeing inside a storage, Seeing how
//! someone fares).
//!
//! The TypeScript keeps the open `SightCache` in a module-level map by world; here it is an
//! explicit per-tick struct ([`SightCache::open`], [`SightCache::new_phase`],
//! [`SightCache::close`]) passed to whoever asks, and what it hands out is shared behind an `Arc`
//! instead of frozen. The world index ([`WorldIndex`]) comes along explicitly too, and carries the
//! map's size.

use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use csp_shared::balance::SIGHT_RANGE;
use csp_shared::footprint::{footprint_tiles, Placed, FOOTPRINT};
use csp_shared::protocol::{
    BuildLine, ScriptIdOnly, SeenArmy, SeenBuilding, SeenCaravan, SeenCarriage, SeenCity,
    SeenEntity, SeenHorse, SeenInterrupted, SeenResident, SeenScript, SeenTrader, SeenVessel,
};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::horse_market::NpcHorseOffer;
use csp_shared::world::protocol::Hire;
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, Resident, RunningScript, Tile, WorldState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::explored::ExploredTerrain;
use crate::queries::alliance::{carriage_commander_of, sharing_sight};
use crate::queries::carriages::{
    carriage_capacity, crew_ids_of, load_level, passengers_of, stands_still,
};
use crate::queries::city::{city_price, for_sale, npc_city_refuses, sells_to};
use crate::queries::horse_market::{horses_to_sell, npc_horse_offers};
use crate::queries::names::{kind_name, kind_of, placed};
use crate::queries::npc_trade::{npc_city_prices, npc_hire_price, spare_residents};
use crate::queries::offers::{offers_at, seen_offer};
use crate::queries::territory::city_organization;
use crate::queries::trader_trade::{trader_prices, trader_standing};
use crate::queries::vessels::vessel_load_level;
use crate::queries::warehouse::{trade_coin_warehouse, warehouse_prices};
use crate::world_index::WorldIndex;

/// A spot something can be seen from or at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
}

impl Spot {
    fn tile(self) -> (i32, i32) {
        (self.x as i32, self.y as i32)
    }
}

/// The map cut into squares at least twice the sight range across, so what is in sight of
/// someone stands in their square or one next to it (`squaresOf`).
#[derive(Debug, Clone, Copy)]
pub struct Squares {
    pub across: i32,
    side: f64,
    size: i32,
}

impl Squares {
    pub fn of(size: i32) -> Self {
        let across = 1.max((f64::from(size) / (2.0 * SIGHT_RANGE)).floor() as i32);
        Squares { across, side: f64::from(size) / f64::from(across), size }
    }

    /// The column or row of a coordinate.
    pub fn square(&self, v: f64) -> i32 {
        let size = f64::from(self.size);
        (self.across - 1).min((((v % size) + size) % size / self.side).floor() as i32)
    }

    /// The square of a spot, as one number.
    pub fn key(&self, x: f64, y: f64) -> i32 {
        self.square(y) * self.across + self.square(x)
    }
}

/// Where each building stands, by square (`buildingsBySquare`): its place in `world.buildings`.
/// Made once for a tick, it lets every side look only at the buildings near its observers. A
/// footprint is far smaller than a square, so its corner's square will do.
pub fn buildings_by_square(world: &WorldState, size: i32) -> HashMap<i32, Vec<usize>> {
    let squares = Squares::of(size);
    let mut out: HashMap<i32, Vec<usize>> = HashMap::new();
    for (i, b) in world.buildings.iter().enumerate() {
        out.entry(squares.key(b.x, b.y)).or_default().push(i);
    }
    out
}

/// The observers' eyes (`eyesOf`): whether any of them is within sight range of a spot, plus a
/// reach. The observers are sorted into squares, so a spot is checked only against those in its
/// square and the ones next to it.
#[derive(Debug, Clone)]
pub struct Eyes {
    size: i32,
    squares: Squares,
    steps: Vec<i32>,
    grid: HashMap<i32, Vec<(i32, i32)>>,
    /// The squares anything in sight can stand in.
    watched: HashSet<i32>,
}

impl Eyes {
    /// The eyes of observers on a map `size` tiles across.
    pub fn of(size: i32, observers: &[Spot]) -> Self {
        let squares = Squares::of(size);
        let across = squares.across;
        // The squares next to one, across the joins; on a map only a few squares across, every
        // one.
        let steps: Vec<i32> = if across < 3 { (0..across).collect() } else { vec![-1, 0, 1] };
        let mut grid: HashMap<i32, Vec<(i32, i32)>> = HashMap::new();
        let mut watched = HashSet::new();
        let mut eyes = Eyes { size, squares, steps, grid: HashMap::new(), watched: HashSet::new() };
        for o in observers {
            let (sx, sy) = (squares.square(o.x), squares.square(o.y));
            grid.entry(sy * across + sx).or_default().push(o.tile());
            for &dy in &eyes.steps {
                for &dx in &eyes.steps {
                    watched.insert(eyes.around(sy, dy) * across + eyes.around(sx, dx));
                }
            }
        }
        eyes.grid = grid;
        eyes.watched = watched;
        eyes
    }

    fn around(&self, s: i32, d: i32) -> i32 {
        let across = self.squares.across;
        if across < 3 {
            d
        } else {
            (s + d + across) % across
        }
    }

    /// The squares anything in sight can stand in.
    pub fn watched(&self) -> &HashSet<i32> {
        &self.watched
    }

    /// Whether any observer is within sight range of the spot.
    pub fn sees(&self, at: Spot) -> bool {
        self.sees_within(at, 0.0)
    }

    /// Whether any observer is within sight range plus `reach` of the spot.
    pub fn sees_within(&self, at: Spot, reach: f64) -> bool {
        let across = self.squares.across;
        let (sx, sy) = (self.squares.square(at.x), self.squares.square(at.y));
        if !self.watched.contains(&(sy * across + sx)) {
            return false;
        }
        let tile = at.tile();
        for &dy in &self.steps {
            for &dx in &self.steps {
                let Some(near) =
                    self.grid.get(&(self.around(sy, dy) * across + self.around(sx, dx)))
                else {
                    continue;
                };
                if near.iter().any(|&o| wrap_distance(self.size, o, tile) <= SIGHT_RANGE + reach) {
                    return true;
                }
            }
        }
        false
    }

    /// Whether any tile of a building's footprint is in sight (`buildingSeen`, `CONTEXT.md`:
    /// Sight).
    pub fn building_seen(&self, b: Placed) -> bool {
        let side = FOOTPRINT.get(b.kind).expect("a footprint");
        let corner = Spot { x: f64::from(b.x), y: f64::from(b.y) };
        if side == 1 {
            return self.sees(corner);
        }
        // Every tile of it is within this of its corner, so close enough to that, all of it is
        // seen.
        let across = f64::from(side) * std::f64::consts::SQRT_2;
        if !self.sees_within(corner, across) {
            return false;
        }
        if self.sees_within(corner, -across) {
            return true;
        }
        footprint_tiles(b, self.size)
            .into_iter()
            .any(|(x, y)| self.sees(Spot { x: f64::from(x), y: f64::from(y) }))
    }
}

/// Whether any of the army's members is in sight (`armySeen`).
fn army_seen(world: &WorldState, member_ids: &[String], eyes: &Eyes) -> bool {
    world.residents.iter().any(|r| member_ids.contains(&r.id) && eyes.sees(Spot { x: r.x, y: r.y }))
}

/// Whether a caravan's or trader's carriage or any of its crew is in sight (`caravanSeen`).
fn caravan_seen(
    world: &WorldState,
    carriage_id: &str,
    driver_id: Option<&str>,
    escort_ids: &[String],
    eyes: &Eyes,
) -> bool {
    let crew = crew_ids_of(driver_id, escort_ids);
    world.carriages.iter().any(|k| k.id == carriage_id && eyes.sees(Spot { x: k.x, y: k.y }))
        || world
            .residents
            .iter()
            .any(|r| crew.contains(&r.id) && eyes.sees(Spot { x: r.x, y: r.y }))
}

/// The residents a side sees through (`observersOf`): its own and its alliance's, an NPC city
/// member's included, those rented out too, and mercenaries it hired.
pub fn observers_of(world: &WorldState, index: &WorldIndex, side: &str) -> Vec<Spot> {
    let members: HashSet<String> = sharing_sight(world, side).into_iter().collect();
    world
        .residents
        .iter()
        .filter(|r| {
            let org = r.owner.as_deref().or(r.city_id.as_deref());
            org.is_some_and(|o| members.contains(o))
                || index
                    .commander_ref(world, &r.id, r.owner.as_deref())
                    .is_some_and(|b| members.contains(b))
        })
        .map(|r| Spot { x: r.x, y: r.y })
        .collect()
}

/// What a side knows of what it sees (`Insight`, `insightOf`): whose things are its own or its
/// allies', and where one of the residents it sees through stands.
#[derive(Debug)]
pub struct Insight {
    size: i32,
    orgs: HashSet<String>,
    cities: HashMap<String, usize>,
    standing: HashSet<(i32, i32)>,
    coins_seen: OnceCell<HashSet<String>>,
}

impl Insight {
    /// A side's insight, from the residents it sees through.
    pub fn of(world: &WorldState, size: i32, side: &str, observers: &[Spot]) -> Self {
        let mut cities = HashMap::new();
        for (i, c) in world.cities.iter().enumerate() {
            cities.insert(c.id.clone(), i);
        }
        let mut orgs: HashSet<String> = sharing_sight(world, side).into_iter().collect();
        // A Trade Org city sees for its Organization, as all of the Trade Org's cities are one.
        if let Some(&i) = cities.get(side) {
            orgs.insert(city_organization(&world.cities[i]).to_string());
        }
        Insight {
            size,
            orgs,
            cities,
            standing: observers.iter().map(|o| o.tile()).collect(),
            coins_seen: OnceCell::new(),
        }
    }

    fn city<'w>(&self, world: &'w WorldState, id: &str) -> Option<&'w City> {
        self.cities.get(id).and_then(|&i| world.cities.get(i)).filter(|c| c.id == id)
    }

    /// Whether a thing of this realm, or else of this city, is the side's own or its allies'.
    pub fn ours(&self, world: &WorldState, realm_id: Option<&str>, city_id: Option<&str>) -> bool {
        if let Some(realm) = realm_id {
            return self.orgs.contains(realm);
        }
        city_id
            .and_then(|id| self.city(world, id))
            .is_some_and(|c| self.orgs.contains(&c.id) || self.orgs.contains(city_organization(c)))
    }

    /// Whether one of its residents stands on the building.
    fn at(&self, b: &Building) -> bool {
        footprint_tiles(placed(b), self.size).into_iter().any(|t| self.standing.contains(&t))
    }

    /// Trading at a warehouse of the HQ draws on its coin warehouse, so a resident at one sees
    /// those coins too (`tradeCoinWarehouse`).
    fn coin_warehouse_seen(&self, world: &WorldState, b: &Building) -> bool {
        self.coins_seen
            .get_or_init(|| {
                world
                    .buildings
                    .iter()
                    .filter(|w| w.kind == BuildingKind::Warehouse && self.at(w))
                    .filter_map(|w| trade_coin_warehouse(world, w).map(|c| c.id.clone()))
                    .collect()
            })
            .contains(&b.id)
    }

    /// Whether it sees what a storage, warehouse or stable holds.
    pub fn inside_building(&self, world: &WorldState, b: &Building) -> bool {
        self.ours(world, b.realm_id.as_deref(), b.city_id.as_deref())
            || self.at(b)
            || self.coin_warehouse_seen(world, b)
    }

    /// Whether it sees what a city's storages hold together.
    pub fn inside_city(&self, world: &WorldState, city_id: &str) -> bool {
        self.ours(world, None, Some(city_id))
            || world.buildings.iter().any(|b| {
                b.city_id.as_deref() == Some(city_id)
                    && b.kind == BuildingKind::Storage
                    && self.at(b)
            })
    }

    /// Whether it sees a carriage's load.
    pub fn inside_carriage(&self, world: &WorldState, k: &Carriage) -> bool {
        let by = carriage_commander_of(world, k);
        self.ours(world, k.realm_id.as_deref(), k.city_id.as_deref())
            || by.is_some_and(|b| self.orgs.contains(&b))
            || self.standing.contains(&(k.x as i32, k.y as i32))
    }

    /// Whether it sees how a resident fares.
    pub fn fares(&self, world: &WorldState, index: &WorldIndex, r: &Resident) -> bool {
        let by = index.commander_of(world, &r.id, r.owner.as_deref());
        self.ours(world, r.owner.as_deref(), r.city_id.as_deref())
            || by.is_some_and(|b| self.orgs.contains(&b))
    }
}

/// A building as the side sees it (`seenBuilding`): its stock and a stable's breeding progress
/// only when it sees inside, a Trade Org warehouse's prices and a storage's offers either way.
fn seen_building(world: &WorldState, insight: &Insight, b: &Building) -> SeenBuilding {
    let inside = insight.inside_building(world, b);
    let mut shown = SeenBuilding { building: b.clone(), prices: None, offers: None };
    if !inside {
        shown.building.stock = None;
        shown.building.breedings = None;
    }
    if b.kind == BuildingKind::Warehouse {
        let prices = warehouse_prices(world, b);
        if !prices.is_empty() {
            shown.prices = Some(prices.iter().map(|p| p.shown(inside)).collect());
        }
    }
    let offers = if world.offers.is_empty() { Vec::new() } else { offers_at(world, &b.id) };
    if !offers.is_empty() {
        shown.offers = Some(offers.into_iter().map(seen_offer).collect());
    }
    shown
}

/// A carriage as the side sees it (`seenCarriage`): how heavily it is loaded, its load only when
/// it sees inside, who is aboard, and whether anything moves it.
fn seen_carriage(world: &WorldState, insight: &Insight, k: &Carriage) -> SeenCarriage {
    SeenCarriage {
        id: k.id.clone(),
        realm_id: k.realm_id.clone(),
        city_id: k.city_id.clone(),
        x: k.x,
        y: k.y,
        horse_id: k.horse_id.clone(),
        load: insight.inside_carriage(world, k).then(|| k.load.clone()),
        load_level: load_level(&k.load, carriage_capacity(world, k)),
        passenger_ids: passengers_of(world, &k.id).into_iter().map(|r| r.id.clone()).collect(),
        stands_still: stands_still(world, k),
    }
}

/// A JSON string, unless empty (`typeof v === 'string' && v`).
fn non_empty_string(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// A field of a script's memory that is set, `null` counting as not (`??`).
fn set(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| !v.is_null())
}

/// A Build line task's line from its memory (`buildLineOf`), copied, if it holds one: a road or
/// wall with whole-number tiles to go from and to.
fn build_line_of(line: Option<&Value>) -> Option<BuildLine> {
    let l = line.and_then(Value::as_object);
    let tile = |t: Option<&Value>| {
        let t = t.and_then(Value::as_object)?;
        let whole = |v: Option<&Value>| {
            v.and_then(Value::as_f64).filter(|n| n.is_finite() && n.fract() == 0.0)
        };
        Some(Tile { x: whole(t.get("x"))?, y: whole(t.get("y"))? })
    };
    let l = l?;
    let building = match l.get("building").and_then(Value::as_str) {
        Some("road") => BuildingKind::Road,
        Some("wall") => BuildingKind::Wall,
        _ => return None,
    };
    Some(BuildLine { building, from: tile(l.get("from"))?, to: tile(l.get("to"))? })
}

/// What a Player sees of the script a resident runs (`seenScript`): which one, and for the owning
/// Player (`own`) what goes into the resident's Doing line (`CONTEXT.md`: Doing): the task, the
/// kind of building the task is about, the text the script gave `doing()`, whether it waits, and
/// whether Work's workplace is still a construction site it builds first.
pub fn seen_script(world: &WorldState, script: &RunningScript, own: bool) -> SeenScript {
    let mut seen = SeenScript::only(script.script_id);
    if !own {
        return seen;
    }
    let memory = &script.memory;
    let workplace = set(memory.get("workplaceId"));
    let id = workplace.or_else(|| set(memory.get("buildingId")));
    // Build line's kind is its line's (`TaskMemory`).
    let line = build_line_of(memory.get("line"));
    let kind: Option<&str> = match set(memory.get("building")) {
        Some(v) => v.as_str(),
        None => line.as_ref().map(|l| kind_name(l.building)),
    };
    let target =
        id.and_then(Value::as_str).and_then(|id| world.buildings.iter().find(|b| b.id == id));
    seen.task = script.task;
    seen.building = match kind.and_then(kind_of) {
        Some(k) => Some(k),
        None => target.map(|t| t.kind),
    };
    seen.doing = non_empty_string(memory.get("doing")).map(str::to_string);
    seen.line = line;
    seen.waiting = script.waiting_since.map(|_| true);
    let at_site = target.is_some_and(|t| {
        workplace.and_then(Value::as_str) == Some(t.id.as_str()) && t.site.is_some()
    });
    seen.site = at_site.then_some(true);
    seen.settings_from = script.settings_from.clone();
    seen
}

/// A resident as `side` sees them (`everythingSeen`): which script they run but not its memory,
/// its params only for the realm commanding them, the queue only for the realm that gave it,
/// what a defence script interrupted and the defence and Alarm scripts only for the owner; that
/// they are Down for anyone, how they fare only as `fares` says. Never their script log nor
/// whether an order stands against blows (`withoutServerOnly`).
fn seen_resident(
    world: &WorldState,
    index: &WorldIndex,
    insight: &Insight,
    side: &str,
    r: &Resident,
) -> SeenResident {
    let commands = index.commander_of(world, &r.id, r.owner.as_deref()).as_deref() == Some(side);
    let kept = if commands { r.script_params.clone() } else { None };
    let own = r.owner.as_deref() == Some(side);
    let script = r.script.as_ref().map(|s| {
        let mut seen = seen_script(world, s, own);
        seen.params = kept.as_ref().and_then(|k| k.get(&s.script_id)).cloned();
        seen
    });
    let interrupted = r.interrupted.as_ref().filter(|_| own).map(|i| SeenInterrupted {
        order: i.order.clone(),
        script: i.script.as_ref().map(|s| seen_script(world, s, true)),
    });
    let fares = insight.fares(world, index, r);
    SeenResident {
        id: r.id.clone(),
        name: r.name.clone(),
        game_name: r.game_name,
        owner: r.owner.clone(),
        city_id: r.city_id.clone(),
        x: r.x,
        y: r.y,
        stats: r.stats.clone(),
        skills: r.skills.clone(),
        health: fares.then_some(r.health),
        hunger: fares.then_some(r.hunger),
        born_at: r.born_at,
        lifespan: r.lifespan,
        carried: r.carried.clone(),
        order: r.order.clone(),
        order_ended: r.order_ended.clone(),
        struck: r.struck.clone().filter(|_| fares),
        script,
        interrupted,
        defence_script_id: r.defence_script_id.filter(|_| own),
        alarm_script_id: r.alarm_script_id.clone().filter(|_| own),
        script_params: kept,
        queue: r.queue.clone().filter(|q| q.realm_id == side),
        pair: r.pair.clone(),
        carrying: r.carrying.clone(),
        riding: r.riding.clone(),
        aboard: r.aboard.clone(),
        down_until: r.down_until.filter(|_| fares),
        // Anyone in sight sees that they are Down; when it ends goes with how they fare.
        down: r.down_until.map(|_| true),
    }
}

/// Everything in a side's sight, as `entities_in_sight` gives it (`everythingSeen`).
fn everything_seen(
    world: &WorldState,
    index: &WorldIndex,
    side: &str,
    eyes: &Eyes,
    insight: &Insight,
    seen_places: &[SeenEntity],
) -> Vec<SeenEntity> {
    let in_sight = |x: f64, y: f64| eyes.sees(Spot { x, y });
    let mut out = Vec::new();
    for r in &world.residents {
        if in_sight(r.x, r.y) {
            out.push(SeenEntity::Resident(Box::new(seen_resident(world, index, insight, side, r))));
        }
    }
    out.extend(seen_places.iter().cloned());
    for h in &world.horses {
        if !in_sight(h.x, h.y) {
            continue;
        }
        let ours = insight.ours(world, h.realm_id.as_deref(), h.city_id.as_deref());
        out.push(SeenEntity::Horse(SeenHorse {
            id: h.id.clone(),
            name: h.name.clone(),
            realm_id: h.realm_id.clone(),
            city_id: h.city_id.clone(),
            x: h.x,
            y: h.y,
            hunger: ours.then_some(h.hunger),
            health: ours.then_some(h.health),
            stats: h.stats.clone(),
            born_at: h.born_at,
            down_until: h.down_until.filter(|_| ours),
            // Anyone in sight sees that it is Down; when it ends goes with how it fares.
            down: h.down_until.map(|_| true),
        }));
    }
    for k in &world.carriages {
        if in_sight(k.x, k.y) {
            out.push(SeenEntity::Carriage(seen_carriage(world, insight, k)));
        }
    }
    // A vessel shows to whoever has its tile in sight, like a carriage (`CONTEXT.md`: Vessels in
    // sight); its load only to its own realm and allies.
    for v in &world.vessels {
        if in_sight(v.x, v.y) {
            let inside = insight.ours(world, v.realm_id.as_deref(), None);
            out.push(SeenEntity::Vessel(SeenVessel {
                id: v.id.clone(),
                kind: v.kind,
                realm_id: v.realm_id.clone(),
                x: v.x,
                y: v.y,
                load: inside.then(|| v.load.clone()),
                load_level: vessel_load_level(v),
            }));
        }
    }
    for p in &world.piles {
        if in_sight(p.x, p.y) {
            out.push(SeenEntity::Pile(p.clone()));
        }
    }
    // An army is seen through its members; the Player gets only their own.
    for a in &world.armies {
        if a.realm_id == side && army_seen(world, &a.member_ids, eyes) {
            // As for residents: which script it runs is seen, its memory isn't.
            out.push(SeenEntity::Army(SeenArmy {
                id: a.id.clone(),
                name: a.name.clone(),
                realm_id: a.realm_id.clone(),
                member_ids: a.member_ids.clone(),
                order: a.order.clone(),
                script: a.script.as_ref().map(|s| ScriptIdOnly { script_id: s.script_id }),
            }));
        }
    }
    // A caravan is seen through its carriage and its crew (`CONTEXT.md`: Caravan).
    for c in &world.caravans {
        if caravan_seen(world, &c.carriage_id, c.driver_id.as_deref(), &c.escort_ids, eyes) {
            out.push(SeenEntity::Caravan(SeenCaravan {
                id: c.id.clone(),
                post_id: c.post_id.clone(),
                carriage_id: c.carriage_id.clone(),
                driver_id: c.driver_id.clone(),
                escort_ids: c.escort_ids.clone(),
                heading: c.heading,
            }));
        }
    }
    // A wandering trader likewise (`CONTEXT.md`: Wandering trader).
    for t in &world.traders {
        if !caravan_seen(world, &t.carriage_id, t.driver_id.as_deref(), &t.escort_ids, eyes) {
            continue;
        }
        // At a stop it names its prices to anyone in sight (`CONTEXT.md`: Trader stop).
        let standing = trader_standing(world, t);
        let k = standing.as_ref().and_then(|_| index.carriage_by_id(world, &t.carriage_id));
        let (standing, prices) = match (standing, k) {
            (Some(s), Some(k)) => {
                let inside = insight.inside_carriage(world, k);
                (Some(s), Some(trader_prices(t, k).iter().map(|p| p.shown(inside)).collect()))
            }
            _ => (None, None),
        };
        out.push(SeenEntity::Trader(SeenTrader {
            id: t.id.clone(),
            post_id: t.post_id.clone(),
            carriage_id: t.carriage_id.clone(),
            driver_id: t.driver_id.clone(),
            escort_ids: t.escort_ids.clone(),
            heading: t.heading,
            standing,
            prices,
        }));
    }
    out
}

/// The buildings and cities in a side's sight, as `entities_in_sight` shows them (`places`).
fn places(
    world: &WorldState,
    side: &str,
    eyes: &Eyes,
    insight: &Insight,
    by_square: Option<&HashMap<i32, Vec<usize>>>,
) -> Vec<SeenEntity> {
    let mut out = Vec::new();
    let mut seen_cities: HashSet<&str> = HashSet::new();
    let mut seen_storages: HashSet<&str> = HashSet::new();
    let mut seen_halls: HashSet<&str> = HashSet::new();
    let mut seen_stables: Vec<&Building> = Vec::new();
    // Only the buildings near the observers, in the world's order, when they are sorted by
    // square.
    let near: Vec<&Building> = match by_square {
        Some(by_square) => {
            let mut at: Vec<usize> = eyes
                .watched
                .iter()
                .flat_map(|k| by_square.get(k).into_iter().flatten().copied())
                .collect();
            at.sort_unstable();
            at.into_iter().map(|i| &world.buildings[i]).collect()
        }
        None => world.buildings.iter().collect(),
    };
    for b in near {
        if !eyes.building_seen(placed(b)) {
            continue;
        }
        out.push(SeenEntity::Building(seen_building(world, insight, b)));
        if let Some(city) = b.city_id.as_deref() {
            seen_cities.insert(city);
            if b.kind == BuildingKind::Storage && b.site.is_none() {
                seen_storages.insert(city);
            }
            if b.kind == BuildingKind::TownHall {
                seen_halls.insert(city);
            }
        }
        if b.kind == BuildingKind::Stable && b.site.is_none() {
            seen_stables.push(b);
        }
    }
    // An NPC city names the Player its price (`CONTEXT.md`: Buying a city), from all of it, or
    // says it won't sell to them or refuses them at all (`CONTEXT.md`: NPC city reaction). One
    // that doesn't refuse them names what it would lend and its asking price, and, with a
    // storage of it in sight, its prices (`CONTEXT.md`: Hiring from / Trading with an NPC city).
    for c in &world.cities {
        if !seen_cities.contains(c.id.as_str()) {
            continue;
        }
        let selling = for_sale(c);
        let (price, wont_sell) = if !selling {
            (None, None)
        } else if sells_to(world, c, side) {
            (Some(city_price(world, c, Some(side))), None)
        } else {
            (None, Some(true))
        };
        let refuses = npc_city_refuses(world, c, side);
        let (hire, trade) = if !selling || refuses {
            (None, None)
        } else {
            let hire = Hire {
                spare: spare_residents(world, c, None).len() as f64,
                price_per_resident_week: npc_hire_price(world, c, side),
            };
            let trade = seen_storages.contains(c.id.as_str()).then(|| {
                let inside = insight.inside_city(world, &c.id);
                npc_city_prices(world, c, Some(side)).iter().map(|p| p.shown(inside)).collect()
            });
            (Some(hire), trade)
        };
        // Its horses in sight in its stables in sight, and the Player's standing there
        // (`CONTEXT.md`: Horse market), refusing or not, so the Trade section can say why.
        let listed = |list: fn(&WorldState, &City, &Building, &str) -> Vec<NpcHorseOffer>| {
            if !selling {
                return Vec::new();
            }
            seen_stables
                .iter()
                .filter(|b| b.city_id.as_deref() == Some(c.id.as_str()))
                .flat_map(|b| list(world, c, b, side))
                .filter(|o| {
                    let h = world.horses.iter().find(|x| x.id == o.horse_id).expect("a horse");
                    eyes.sees(Spot { x: h.x, y: h.y })
                })
                .collect()
        };
        let horses = listed(npc_horse_offers);
        let to_sell = listed(horses_to_sell);
        let mut shown = c.clone();
        // Who occupies its town hall only with the hall in sight (`CONTEXT.md`: Occupying a town
        // hall).
        if !seen_halls.contains(c.id.as_str()) {
            shown.occupation = None;
        }
        // What its scouts brought home is its own (`CONTEXT.md`: Scout), and who is in its area
        // counts only for its alarms: nobody sees them for being on that list (`CONTEXT.md`:
        // Alarm).
        shown.scouted = None;
        shown.outsiders = None;
        shown.alarmed_attackers = None;
        out.push(SeenEntity::City(SeenCity {
            city: shown,
            price,
            wont_sell,
            refuses: refuses.then_some(true),
            hire,
            trade,
            horses: (!horses.is_empty()).then_some(horses),
            horses_to_sell: (!to_sell.is_empty()).then_some(to_sell),
        }));
    }
    out
}

/// What one side, a realm or an NPC city, sees (`SideSight`): who it sees through and their
/// eyes, worked out when it is made; its insight, the buildings and cities in its sight and
/// everything in its sight, each the first time it is asked for, then shared.
#[derive(Debug)]
pub struct SideSight {
    side: String,
    observers: Vec<Spot>,
    eyes: Arc<Eyes>,
    insight: OnceCell<Insight>,
    seen_places: OnceCell<Arc<Vec<SeenEntity>>>,
    everything: OnceCell<Arc<Vec<SeenEntity>>>,
}

impl SideSight {
    /// What `side` sees of the world now.
    pub fn new(world: &WorldState, index: &WorldIndex, side: &str) -> Self {
        let observers = observers_of(world, index, side);
        let eyes = Arc::new(Eyes::of(index.size(), &observers));
        SideSight {
            side: side.to_string(),
            observers,
            eyes,
            insight: OnceCell::new(),
            seen_places: OnceCell::new(),
            everything: OnceCell::new(),
        }
    }

    /// Its eyes (`sees`, `buildingSeen`).
    pub fn eyes(&self) -> Arc<Eyes> {
        self.eyes.clone()
    }

    /// Whether the side has anyone to see through.
    pub fn looking(&self) -> bool {
        !self.observers.is_empty()
    }

    fn insight(&self, world: &WorldState, index: &WorldIndex) -> &Insight {
        self.insight.get_or_init(|| Insight::of(world, index.size(), &self.side, &self.observers))
    }

    /// The buildings and cities in its sight; `by_square` (`buildings_by_square` this tick)
    /// saves looking at every building.
    pub fn places(
        &self,
        world: &WorldState,
        index: &WorldIndex,
        by_square: Option<&HashMap<i32, Vec<usize>>>,
    ) -> Arc<Vec<SeenEntity>> {
        if self.observers.is_empty() {
            return Arc::new(Vec::new());
        }
        self.seen_places
            .get_or_init(|| {
                let insight = self.insight(world, index);
                Arc::new(places(world, &self.side, &self.eyes, insight, by_square))
            })
            .clone()
    }

    /// One building as `places` shows it, if it is in its sight, without working out the rest
    /// (T89.6): `places` holds each building it sees as `seen_building` makes it, once.
    pub fn place(
        &self,
        world: &WorldState,
        index: &WorldIndex,
        b: &Building,
    ) -> Option<SeenEntity> {
        if self.observers.is_empty() || !self.eyes.building_seen(placed(b)) {
            return None;
        }
        let insight = self.insight(world, index);
        Some(SeenEntity::Building(seen_building(world, insight, b)))
    }

    /// Everything in its sight.
    pub fn entities(&self, world: &WorldState, index: &WorldIndex) -> Arc<Vec<SeenEntity>> {
        if self.observers.is_empty() {
            return Arc::new(Vec::new());
        }
        if let Some(all) = self.everything.get() {
            return all.clone();
        }
        let seen_places = self.places(world, index, None);
        let insight = self.insight(world, index);
        self.everything
            .get_or_init(|| {
                Arc::new(everything_seen(
                    world,
                    index,
                    &self.side,
                    &self.eyes,
                    insight,
                    &seen_places,
                ))
            })
            .clone()
    }
}

/// What each side sees, worked out once per phase of a tick and shared by everyone who asks:
/// the scripts, the NPC scripts, Last seen and sync (`SightCache`, Epic 49). A tick has three
/// phases: the scripts run before the world steps, the NPC scripts inside it, Last seen and sync
/// once it has stepped; [`SightCache::new_phase`] starts the next. Scratch memory like the
/// pathfinder's: never saved, never world state (ADR 0006). The sight invariants work theirs out
/// on their own.
#[derive(Debug)]
pub struct SightCache {
    size: i32,
    /// How many times a side's sight was worked out since the cache opened (tick health).
    pub builds: u32,
    sides: HashMap<String, SideSight>,
    /// What is in sight as JSON, by the shared thing it was made from (`seen_json`).
    json: HashMap<usize, Arc<str>>,
}

impl SightCache {
    /// Opens a sight cache for a map `size` tiles across (`openSight`), until [`Self::close`].
    pub fn open(size: i32) -> Self {
        SightCache { size, builds: 0, sides: HashMap::new(), json: HashMap::new() }
    }

    /// The map size it was opened for.
    pub fn size(&self) -> i32 {
        self.size
    }

    /// A side's sight, worked out the first time it is asked for this phase.
    pub fn side(&mut self, world: &WorldState, index: &WorldIndex, side: &str) -> &SideSight {
        if !self.sides.contains_key(side) {
            self.sides.insert(side.to_string(), SideSight::new(world, index, side));
            self.builds += 1;
        }
        &self.sides[side]
    }

    /// Forgets every side's sight: the world has moved on since (`newPhase`, `newSightPhase`).
    pub fn new_phase(&mut self) {
        self.sides.clear();
        self.json.clear();
    }

    /// Closes the cache (`closeSight`): from then on each caller works sight out for itself.
    pub fn close(self) {}
}

/// Runs `f` with a sight cache open (`withSight`): the open one, or one opened for it and closed
/// after.
pub fn with_sight<T>(
    cache: Option<&mut SightCache>,
    size: i32,
    f: impl FnOnce(&mut SightCache) -> T,
) -> T {
    match cache {
        Some(cache) => f(cache),
        None => {
            let mut cache = SightCache::open(size);
            let out = f(&mut cache);
            cache.close();
            out
        }
    }
}

/// A side's sight with what is asked of it: from the open cache, or worked out for this caller
/// alone without one (`sideSight`).
fn with_side<T>(
    world: &WorldState,
    index: &WorldIndex,
    side: &str,
    cache: Option<&mut SightCache>,
    f: impl FnOnce(&SideSight) -> T,
) -> T {
    match cache {
        Some(cache) if cache.size == index.size() => f(cache.side(world, index, side)),
        _ => f(&SideSight::new(world, index, side)),
    }
}

/// The eyes of a realm's Player, or an NPC city (`sightOf`): whether they see a spot, within
/// sight range of any of their residents or their alliance's, as `entities_in_sight` counts it.
pub fn sight_of(
    world: &WorldState,
    index: &WorldIndex,
    side: &str,
    cache: Option<&mut SightCache>,
) -> Arc<Eyes> {
    with_side(world, index, side, cache, SideSight::eyes)
}

/// What a realm's Player sees (`entitiesInSight`, `CONTEXT.md`: Sight): everything within sight
/// range of any of their residents or their alliance's, their own things included; nothing for
/// no realm. While a cache is open the list is shared by everyone who asks this phase.
pub fn entities_in_sight(
    world: &WorldState,
    index: &WorldIndex,
    realm_id: Option<&str>,
    cache: Option<&mut SightCache>,
) -> Arc<Vec<SeenEntity>> {
    let Some(realm) = realm_id else {
        return Arc::new(Vec::new());
    };
    with_side(world, index, realm, cache, |s| s.entities(world, index))
}

/// The buildings and cities a side sees, its eyes and whether it has anyone to see through
/// (`placesInSight`).
#[derive(Debug, Clone)]
pub struct PlacesInSight {
    pub seen: Arc<Vec<SeenEntity>>,
    pub eyes: Arc<Eyes>,
    pub looking: bool,
}

impl PlacesInSight {
    /// Whether any tile of a footprint is in their sight (`CONTEXT.md`: Last seen).
    pub fn sees(&self, b: Placed) -> bool {
        self.eyes.building_seen(b)
    }
}

/// The buildings and cities a realm's Player sees, as `entities_in_sight` shows them
/// (`placesInSight`). `by_square`, from `buildings_by_square` this tick, saves looking at every
/// building. Without a cache it is worked out afresh, as an invariant should.
pub fn places_in_sight(
    world: &WorldState,
    index: &WorldIndex,
    realm_id: &str,
    by_square: Option<&HashMap<i32, Vec<usize>>>,
    cache: Option<&mut SightCache>,
) -> PlacesInSight {
    with_side(world, index, realm_id, cache, |s| PlacesInSight {
        seen: s.places(world, index, by_square),
        eyes: s.eyes(),
        looking: s.looking(),
    })
}

/// A building as `places_in_sight` would show it to a side, if the side sees it: the one entry,
/// not the whole list.
pub fn building_in_sight(
    world: &WorldState,
    index: &WorldIndex,
    side: &str,
    b: &Building,
    cache: Option<&mut SightCache>,
) -> Option<SeenEntity> {
    with_side(world, index, side, cache, |s| s.place(world, index, b))
}

/// Something in sight as JSON (`seenJson`): while a sight cache is open, made once per phase and
/// shared by everyone who asks, so the same string comes back each time; else made for this
/// caller alone. Only for what an open cache handed out this phase.
pub fn seen_json(cache: Option<&mut SightCache>, e: &SeenEntity) -> Arc<str> {
    let json = || Arc::<str>::from(serde_json::to_string(e).expect("serialisable"));
    match cache {
        Some(cache) => {
            cache.json.entry(e as *const SeenEntity as usize).or_insert_with(json).clone()
        }
        None => json(),
    }
}

/// An invariant broken (ADR 0004), as `invariants.ts` reports it (`InvariantViolation`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvariantViolation {
    pub invariant: String,
    pub message: String,
    pub entity_ids: Vec<String>,
}

/// Where a seen thing stands, for what is seen at a spot.
fn spot_of(e: &SeenEntity) -> Option<Spot> {
    match e {
        SeenEntity::Resident(r) => Some(Spot { x: r.x, y: r.y }),
        SeenEntity::Horse(h) => Some(Spot { x: h.x, y: h.y }),
        SeenEntity::Carriage(k) => Some(Spot { x: k.x, y: k.y }),
        SeenEntity::Vessel(v) => Some(Spot { x: v.x, y: v.y }),
        SeenEntity::Pile(p) => Some(Spot { x: p.x, y: p.y }),
        SeenEntity::Building(b) => Some(Spot { x: b.building.x, y: b.building.y }),
        _ => None,
    }
}

/// Invariant (ADR 0004): nothing is sent to a Player outside their own or their alliance's sight
/// (`sentOutOfSight`). Checks the entities about to go out against the world as it is, each on
/// its own: a city is in sight when any of its buildings is, a building when any tile of its
/// footprint is.
pub fn sent_out_of_sight(
    world: &WorldState,
    index: &WorldIndex,
    realm_id: &str,
    sent: &[SeenEntity],
) -> Vec<InvariantViolation> {
    let eyes = Eyes::of(index.size(), &observers_of(world, index, realm_id));
    sent.iter()
        .filter(|e| match e {
            SeenEntity::City(c) => !world.buildings.iter().any(|b| {
                b.city_id.as_deref() == Some(c.city.id.as_str()) && eyes.building_seen(placed(b))
            }),
            SeenEntity::Army(a) => !army_seen(world, &a.member_ids, &eyes),
            SeenEntity::Caravan(c) => {
                !caravan_seen(world, &c.carriage_id, c.driver_id.as_deref(), &c.escort_ids, &eyes)
            }
            SeenEntity::Trader(t) => {
                !caravan_seen(world, &t.carriage_id, t.driver_id.as_deref(), &t.escort_ids, &eyes)
            }
            SeenEntity::Building(b) => !eyes.building_seen(placed(&b.building)),
            other => !eyes.sees(spot_of(other).expect("a spot")),
        })
        .map(|e| InvariantViolation {
            invariant: "sent-only-in-sight".into(),
            message: format!(
                "{} {} was sent to realm {realm_id}, outside its sight",
                e.is(),
                e.id()
            ),
            entity_ids: vec![e.id().to_string(), realm_id.to_string()],
        })
        .collect()
}

/// Invariant (ADR 0004): nothing a Player may not see inside goes out to them
/// (`sentInsideUnseen`): no other Organization's stock, prices with what is held or carriage
/// load without a resident there, no stranger's hunger or health.
pub fn sent_inside_unseen(
    world: &WorldState,
    index: &WorldIndex,
    realm_id: &str,
    sent: &[SeenEntity],
) -> Vec<InvariantViolation> {
    let insight = Insight::of(world, index.size(), realm_id, &observers_of(world, index, realm_id));
    let carriage = |id: &str| world.carriages.iter().find(|k| k.id == id);
    sent.iter()
        .filter(|e| match e {
            SeenEntity::Building(b) => {
                let told = b.building.stock.is_some()
                    || b.prices.iter().flatten().any(|l| l.stock.is_some());
                let it = world.buildings.iter().find(|x| x.id == b.building.id);
                told && !it.is_some_and(|it| insight.inside_building(world, it))
            }
            SeenEntity::Carriage(k) => {
                k.load.is_some()
                    && !carriage(&k.id).is_some_and(|k| insight.inside_carriage(world, k))
            }
            SeenEntity::City(c) => {
                c.trade.iter().flatten().any(|l| l.stock.is_some())
                    && !insight.inside_city(world, &c.city.id)
            }
            SeenEntity::Trader(t) => {
                t.prices.iter().flatten().any(|l| l.stock.is_some())
                    && !carriage(&t.carriage_id).is_some_and(|k| insight.inside_carriage(world, k))
            }
            SeenEntity::Resident(r) => {
                let told = r.hunger.is_some()
                    || r.health.is_some()
                    || r.struck.is_some()
                    || r.down_until.is_some();
                let it = world.residents.iter().find(|x| x.id == r.id);
                told && !it.is_some_and(|it| insight.fares(world, index, it))
            }
            SeenEntity::Horse(h) => {
                let told = h.hunger.is_some() || h.health.is_some() || h.down_until.is_some();
                let it = world.horses.iter().find(|x| x.id == h.id);
                told && !it.is_some_and(|it| {
                    insight.ours(world, it.realm_id.as_deref(), it.city_id.as_deref())
                })
            }
            SeenEntity::Vessel(v) => {
                let it = world.vessels.iter().find(|x| x.id == v.id);
                v.load.is_some()
                    && !it.is_some_and(|it| insight.ours(world, it.realm_id.as_deref(), None))
            }
            _ => false,
        })
        .map(|e| InvariantViolation {
            invariant: "sent-only-what-is-seen-inside".into(),
            message: format!(
                "what is inside {} {}, or how it fares, was sent to realm {realm_id}",
                e.is(),
                e.id()
            ),
            entity_ids: vec![e.id().to_string(), realm_id.to_string()],
        })
        .collect()
}

/// What explores terrain for a Player (`ExploredTerrain.explore`): marks every tile within
/// `radius` of (x, y) explored for them and gives the chunks that grew. [`ExploredTerrain`] is
/// the game's; tests may explore otherwise.
pub trait Explore {
    fn explore(&mut self, user_id: u64, x: i32, y: i32, radius: i32) -> HashSet<usize>;
}

impl Explore for ExploredTerrain {
    fn explore(&mut self, user_id: u64, x: i32, y: i32, radius: i32) -> HashSet<usize> {
        ExploredTerrain::explore(self, user_id, x, y, radius)
            .into_iter()
            .map(|c| c as usize)
            .collect()
    }
}

/// Grows each Player's explored terrain from what they see: their residents and their
/// alliance's (`SightTracker`). Only residents that came to a new tile since the last call look
/// around again, for a Player that shares their sight, so a quiet tick costs next to nothing; a
/// Player who joins an alliance explores around its residents on the next call. The positions it
/// remembers are scratch memory: after a restart everyone looks around once.
#[derive(Debug, Default)]
pub struct SightTracker {
    /// Per Player and resident, the tile they last looked around from.
    last_seen_from: HashMap<(u64, String), (i32, i32)>,
}

impl SightTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Explores around residents that moved; returns, per Player, the chunks that grew.
    pub fn update(
        &mut self,
        world: &WorldState,
        index: &WorldIndex,
        explored: &mut impl Explore,
    ) -> BTreeMap<u64, BTreeSet<usize>> {
        let user_of: HashMap<&str, u64> =
            world.realms.iter().map(|r| (r.id.as_str(), r.user_id)).collect();
        // Per realm, and per NPC city in an alliance, the Players who see through its residents.
        let mut viewers_of: HashMap<String, Vec<u64>> = HashMap::new();
        let members = world
            .realms
            .iter()
            .map(|r| &r.id)
            .chain(world.alliances.iter().flat_map(|a| a.members.iter().map(|m| &m.realm_id)));
        for id in members {
            if viewers_of.contains_key(id) {
                continue;
            }
            let viewers = sharing_sight(world, id)
                .iter()
                .filter_map(|x| user_of.get(x.as_str()).copied())
                .collect();
            viewers_of.insert(id.clone(), viewers);
        }
        let mut grown: BTreeMap<u64, BTreeSet<usize>> = BTreeMap::new();
        let mut looking: HashSet<(u64, String)> = HashSet::new();
        let radius = SIGHT_RANGE as i32;
        for r in &world.residents {
            let by = index.commander_of(world, &r.id, r.owner.as_deref());
            let org = r.owner.as_deref().or(r.city_id.as_deref());
            let other = by.as_deref().filter(|b| Some(*b) != r.owner.as_deref());
            let mut users: Vec<u64> = Vec::new();
            for id in [org, other].into_iter().flatten() {
                for &u in viewers_of.get(id).into_iter().flatten() {
                    if !users.contains(&u) {
                        users.push(u);
                    }
                }
            }
            let here = (r.x as i32, r.y as i32);
            for user in users {
                let key = (user, r.id.clone());
                looking.insert(key.clone());
                if self.last_seen_from.get(&key) == Some(&here) {
                    continue;
                }
                self.last_seen_from.insert(key, here);
                let chunks = explored.explore(user, here.0, here.1, radius);
                if chunks.is_empty() {
                    continue;
                }
                grown.entry(user).or_default().extend(chunks);
            }
        }
        self.last_seen_from.retain(|k, _| looking.contains(k));
        grown
    }
}
