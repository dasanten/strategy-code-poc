//! The city-shape queries of `packages/shared/src/city.ts` (`CONTEXT.md`: City building, City
//! area, Occupying a town hall, House): which city a building belongs to, where a city's area is,
//! its housing, and who occupies its town hall.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

use csp_shared::balance::{
    CITY_AREA_MARGIN, CITY_BUILDING_REACH, FOOD_SURPLUS_DAYS, HOUSING_ROOM, OCCUPATION_GAME_DAYS,
};
use csp_shared::footprint::{footprints_near, is_at, near_footprint, FOOTPRINT};
use csp_shared::terrain::{wrap, wrap_delta, wrap_distance};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, Good, PunishmentHeading, Resident, TradeOrgCity, WorldState,
};

use super::alliance::allied;
use super::city::{city_food_use, city_residents, town_hall_of};
use super::goods::free_stock;
use super::names::{held, kind_name, placed};
use super::residents::is_armed;
use super::standing::TRADE_ORG;

/// Kinds of city building (`CITY_BUILDINGS`, `CONTEXT.md`: City building): what a city is made
/// of. Farms, workplaces and stables are not.
pub const CITY_BUILDINGS: [BuildingKind; 6] = [
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Warehouse,
    BuildingKind::Wall,
    BuildingKind::Gate,
];

/// Ticks a city's town hall has to be occupied before it is captured (`OCCUPATION_TICKS`).
pub const OCCUPATION_TICKS: f64 = OCCUPATION_GAME_DAYS * TICKS_PER_GAME_DAY;

/// Whether a building counts toward a city's shape: a finished city building (`isCityBuilding`).
pub fn is_city_building(b: &Building) -> bool {
    CITY_BUILDINGS.contains(&b.kind) && b.site.is_none()
}

/// The number in an entity's id (`idNumber`): `Number` of what follows its leading non-digits,
/// 0 for nothing, NaN when that is no number.
pub fn id_number(id: &str) -> f64 {
    let rest = id.trim_start_matches(|c: char| !c.is_ascii_digit());
    if rest.is_empty() {
        return 0.0;
    }
    rest.parse::<f64>().unwrap_or(f64::NAN)
}

/// A building's north-west tile.
pub fn tile_of(b: &Building) -> (i32, i32) {
    (b.x as i32, b.y as i32)
}

/// The side of a kind's footprint (`FOOTPRINT[kind]`).
pub fn side(kind: BuildingKind) -> i32 {
    FOOTPRINT.get(kind_name(kind)).expect("every kind has a footprint")
}

/// Which city each finished city building belongs to (`cityMembership`), building id to city id;
/// a building missing from it belongs to none. A town hall belongs to its own city. Cities grow
/// outward in a chain from their town halls: a building whose footprint comes within
/// `CITY_BUILDING_REACH` of a building already part of a city can join it. Claims are settled
/// nearest town hall first, then the older city, then the claim made first. `size` is the map's.
pub fn city_membership(world: &WorldState, size: i32) -> HashMap<String, String> {
    let mut members: HashMap<String, String> = HashMap::new();
    // A `Map` keyed by city id: the first city keeps its place, a later one of the same id its hall.
    let mut halls: Vec<(String, usize)> = Vec::new();
    for c in &world.cities {
        if let Some(i) = world.buildings.iter().position(|b| b.id == c.town_hall_id) {
            match halls.iter_mut().find(|(id, _)| *id == c.id) {
                Some(h) => h.1 = i,
                None => halls.push((c.id.clone(), i)),
            }
        }
    }
    let city: Vec<usize> =
        (0..world.buildings.len()).filter(|&i| is_city_building(&world.buildings[i])).collect();
    let widest = city.iter().map(|&i| side(world.buildings[i].kind)).fold(1, i32::max);
    let cell = CITY_BUILDING_REACH as i32 + widest;
    let cells = 1.max(size / cell);
    let cell_of = |v: f64| (cells - 1).min(wrap(v as i32, size) / cell);
    let mut grid: HashMap<i32, Vec<usize>> = HashMap::new();
    for &i in &city {
        let b = &world.buildings[i];
        grid.entry(cell_of(b.y) * cells + cell_of(b.x)).or_default().push(i);
    }
    // The city buildings within reach of a footprint, in the order of their tiles from it.
    let near = |bi: usize| -> Vec<usize> {
        let b = &world.buildings[bi];
        let mut keys: Vec<i32> = Vec::new();
        for dy in [-1, 0, 1] {
            for dx in [-1, 0, 1] {
                let cy = (cell_of(b.y) + dy).rem_euclid(cells);
                let cx = (cell_of(b.x) + dx).rem_euclid(cells);
                let k = cy * cells + cx;
                if !keys.contains(&k) {
                    keys.push(k);
                }
            }
        }
        let mut out: Vec<(usize, i32, i32)> = Vec::new();
        for k in keys {
            for &ni in grid.get(&k).map_or(&[][..], Vec::as_slice) {
                let n = &world.buildings[ni];
                if ni == bi
                    || n.kind == BuildingKind::TownHall
                    || !footprints_near(placed(b), placed(n), CITY_BUILDING_REACH as i32, size)
                {
                    continue;
                }
                let dy = wrap_delta(b.y as i32, n.y as i32, size);
                let dx = wrap_delta(b.x as i32, n.x as i32, size);
                out.push((ni, dy, dx));
            }
        }
        out.sort_by(|p, q| p.1.cmp(&q.1).then(p.2.cmp(&q.2)));
        out.into_iter().map(|p| p.0).collect()
    };
    let hall_of = |city_id: &str| halls.iter().find(|(id, _)| id == city_id).map(|h| h.1);
    let mut claims: BinaryHeap<Claim> = BinaryHeap::new();
    let mut made = 0u64;
    // Per city, the buildings it has claimed: a claim made again would never settle first.
    let mut claimed: HashMap<String, HashSet<usize>> = HashMap::new();
    let mut claim = |from: usize,
                     city_id: &str,
                     members: &HashMap<String, String>,
                     claims: &mut BinaryHeap<Claim>| {
        let hall = &world.buildings[hall_of(city_id).expect("a claiming city has a hall")];
        let mine = claimed.entry(city_id.to_string()).or_default();
        for b in near(from) {
            if members.contains_key(&world.buildings[b].id) || mine.contains(&b) {
                continue;
            }
            mine.insert(b);
            claims.push(Claim {
                b,
                city_id: city_id.to_string(),
                d: wrap_distance(size, tile_of(hall), tile_of(&world.buildings[b])),
                age: id_number(city_id),
                seq: made,
            });
            made += 1;
        }
    };
    for (city_id, hall) in &halls {
        members.insert(world.buildings[*hall].id.clone(), city_id.clone());
    }
    for (city_id, hall) in &halls {
        claim(*hall, city_id, &members, &mut claims);
    }
    while let Some(next) = claims.pop() {
        let id = &world.buildings[next.b].id;
        if members.contains_key(id) {
            continue;
        }
        members.insert(id.clone(), next.city_id.clone());
        claim(next.b, &next.city_id, &members, &mut claims);
    }
    members
}

/// A claim `city_membership` has yet to settle.
struct Claim {
    b: usize,
    city_id: String,
    d: f64,
    age: f64,
    seq: u64,
}

impl Claim {
    /// `before(p, q)` of the TypeScript heap: nearer hall, then older city, then made first.
    fn before(&self, q: &Claim) -> bool {
        self.d < q.d
            || (self.d == q.d && (self.age < q.age || (self.age == q.age && self.seq < q.seq)))
    }
}

impl PartialEq for Claim {
    fn eq(&self, other: &Self) -> bool {
        self.seq == other.seq
    }
}

impl Eq for Claim {}

impl PartialOrd for Claim {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Claim {
    /// The heap pops its greatest, so the claim to settle first is the greatest.
    fn cmp(&self, other: &Self) -> Ordering {
        if self.before(other) {
            Ordering::Greater
        } else if other.before(self) {
            Ordering::Less
        } else {
            other.seq.cmp(&self.seq)
        }
    }
}

/// Whether a tile lies in a city's area (`inCityArea`): within `CITY_AREA_MARGIN` of the
/// footprint of one of its finished city buildings, the footprints included.
pub fn in_city_area(world: &WorldState, city_id: &str, x: f64, y: f64, size: i32) -> bool {
    near_city_area(world, city_id, x, y, 0.0, size)
}

/// Whether a tile lies in a city's area or within `tiles` of it (`nearCityArea`).
pub fn near_city_area(
    world: &WorldState,
    city_id: &str,
    x: f64,
    y: f64,
    tiles: f64,
    size: i32,
) -> bool {
    let reach = (CITY_AREA_MARGIN + tiles) as i32;
    world.buildings.iter().any(|b| {
        b.city_id.as_deref() == Some(city_id)
            && is_city_building(b)
            && near_footprint(placed(b), (x as i32, y as i32), reach, size)
    })
}

/// The ids of the cities whose area the tile lies in (`cityIdsAt`), in the order of their first
/// building.
pub fn city_ids_at(world: &WorldState, x: f64, y: f64, size: i32) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for b in &world.buildings {
        let Some(c) = &b.city_id else { continue };
        if !is_city_building(b) || ids.contains(c) {
            continue;
        }
        if near_footprint(placed(b), (x as i32, y as i32), CITY_AREA_MARGIN as i32, size) {
            ids.push(c.clone());
        }
    }
    ids
}

/// Every tile in a city's area (`cityAreaTiles`), each once, in the order the TypeScript set
/// holds them.
pub fn city_area_tiles(world: &WorldState, city_id: &str, size: i32) -> Vec<(i32, i32)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let m = CITY_AREA_MARGIN as i32;
    for b in &world.buildings {
        if b.city_id.as_deref() != Some(city_id) || !is_city_building(b) {
            continue;
        }
        let s = side(b.kind);
        let (bx, by) = tile_of(b);
        for dy in -m..s + m {
            for dx in -m..s + m {
                let t = (wrap(bx + dx, size), wrap(by + dy, size));
                if seen.insert(t) {
                    out.push(t);
                }
            }
        }
    }
    out
}

/// How many residents a city's finished buildings house (`housingRoom`).
pub fn housing_room(world: &WorldState, city_id: &str) -> f64 {
    world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(city_id) && b.site.is_none())
        .fold(0.0, |room, b| room + HOUSING_ROOM.get(kind_name(b.kind)).unwrap_or(0.0))
}

/// A city's free housing (`freeHousing`): its room minus its residents. Can be below 0.
pub fn free_housing(world: &WorldState, city_id: &str) -> f64 {
    housing_room(world, city_id) - city_residents(world, city_id).len() as f64
}

/// Whether a realm stands with a city in a fight over it (`onCitySide`): the city's own realm or
/// an ally. An NPC city has nobody on its side but its own residents.
fn on_city_side(world: &WorldState, city: &City, realm_id: &str) -> bool {
    city.realm_id.as_deref().is_some_and(|own| allied(world, own, realm_id))
}

/// Whether a resident is one of a city's defenders (`defendsCity`): armed, standing in its area,
/// and on its side: of its realm or an allied one, or for an NPC city one of its own residents.
pub fn defends_city(world: &WorldState, city: &City, r: &Resident, size: i32) -> bool {
    let side = match &r.owner {
        None => city.realm_id.is_none() && r.city_id.as_deref() == Some(city.id.as_str()),
        Some(owner) => on_city_side(world, city, owner),
    };
    side && is_armed(&r.carried) && in_city_area(world, &city.id, r.x, r.y, size)
}

/// Whether the resident is hired by the Trade Organization under a started contract.
fn hired_by_trade_org(world: &WorldState, id: &str) -> bool {
    world.contracts.iter().any(|c| {
        c.started_at.is_some() && c.hirer_id == TRADE_ORG && c.resident_ids.iter().any(|x| x == id)
    })
}

/// The soldiers of the Trade Organization's army come to take `city` (`cityTakers`): on their way
/// there or at it, for a debt the city's Organization still owes.
pub fn city_takers(world: &WorldState, city: &City) -> HashSet<String> {
    let org = city.realm_id.as_deref().unwrap_or(&city.id);
    let mut takers = HashSet::new();
    for p in &world.punishments {
        if p.takes != Some(true)
            || p.heading != PunishmentHeading::Out
            || p.city_id != city.id
            || p.culprit_org != org
        {
            continue;
        }
        if !world.debts.iter().any(|d| d.org == org) {
            continue;
        }
        takers.extend(p.members.iter().map(|m| m.resident_id.clone()));
    }
    takers
}

/// Who occupies a city's town hall right now (`occupationOf`): the realm, and the indices of the
/// residents occupying it.
fn occupation_of(world: &WorldState, city: &City, size: i32) -> Option<(String, Vec<usize>)> {
    let hall = town_hall_of(world, city)?;
    let takers = city_takers(world, city);
    let mut occupier: Option<String> = None;
    let mut residents = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        if !is_armed(&r.carried) || !is_at((r.x as i32, r.y as i32), placed(hall), size) {
            continue;
        }
        if defends_city(world, city, r, size) {
            return None;
        }
        let for_trade_org = hired_by_trade_org(world, &r.id);
        if for_trade_org && city.trade_org == Some(TradeOrgCity::Hq) {
            return None;
        }
        let realm =
            if takers.contains(&r.id) { Some(TRADE_ORG.to_string()) } else { r.owner.clone() };
        let Some(realm) = realm else { continue };
        if for_trade_org || (realm != TRADE_ORG && on_city_side(world, city, &realm)) {
            continue;
        }
        if occupier.as_ref().is_some_and(|o| *o != realm) {
            return None;
        }
        occupier = Some(realm);
        residents.push(i);
    }
    occupier.map(|o| (o, residents))
}

/// The realm occupying a city's town hall (`occupierOf`), if any: armed residents of exactly one
/// realm not on the city's side stand on the hall's footprint, and no defender does.
pub fn occupier_of(world: &WorldState, city: &City, size: i32) -> Option<String> {
    occupation_of(world, city, size).map(|o| o.0)
}

/// The indices of the armed residents occupying a city's town hall (`occupiersOf`).
pub fn occupiers_of(world: &WorldState, city: &City, size: i32) -> Vec<usize> {
    occupation_of(world, city, size).map_or_else(Vec::new, |o| o.1)
}

/// Whether `r` is someone occupying `city`'s town hall (`standsOccupying`): armed, on its
/// footprint, and one who could hold it.
pub fn stands_occupying(world: &WorldState, city: &City, r: &Resident, size: i32) -> bool {
    let Some(hall) = town_hall_of(world, city) else { return false };
    if !is_armed(&r.carried)
        || !is_at((r.x as i32, r.y as i32), placed(hall), size)
        || defends_city(world, city, r, size)
    {
        return false;
    }
    !hired_by_trade_org(world, &r.id)
        && (r.owner.is_some() || city_takers(world, city).contains(&r.id))
}

/// Food in a city's storages, but for what is set aside for offers (`storedFood`).
pub fn stored_food(world: &WorldState, city_id: &str) -> f64 {
    world
        .buildings
        .iter()
        .filter(|b| {
            b.city_id.as_deref() == Some(city_id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        })
        .fold(0.0, |food, b| food + held(&free_stock(world, &b.id, b.stock.as_ref()), Good::Food))
}

/// Food all of a city's residents eat in `FOOD_SURPLUS_DAYS` game days (`surplusFoodLine`).
pub fn surplus_food_line(world: &WorldState, city: &City) -> f64 {
    city_food_use(world, city, FOOD_SURPLUS_DAYS)
}

/// Whether a city has a food surplus (`hasFoodSurplus`): its storages hold more Food than all its
/// residents eat in `FOOD_SURPLUS_DAYS` game days.
pub fn has_food_surplus(world: &WorldState, city: &City) -> bool {
    stored_food(world, &city.id) > surplus_food_line(world, city)
}

/// The cities whose area the tile lies in (`citiesAt`), by index.
pub fn cities_at(world: &WorldState, x: f64, y: f64, size: i32) -> Vec<usize> {
    (0..world.cities.len())
        .filter(|&i| in_city_area(world, &world.cities[i].id, x, y, size))
        .collect()
}

/// Ticks left before the occupation of a city's town hall captures it (`occupationTicksLeft`).
pub fn occupation_ticks_left(world: &WorldState, city: &City) -> Option<f64> {
    city.occupation.as_ref().map(|o| 0f64.max(o.since + OCCUPATION_TICKS - world.tick as f64))
}
