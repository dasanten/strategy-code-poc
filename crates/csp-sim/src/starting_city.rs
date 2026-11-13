//! The starting city (`CONTEXT.md`: Starting city, Realm name, Game-given names), ported from
//! `apps/server/src/starting-city.ts`: where a new realm's walled city goes and what it starts
//! with. The same world and Player always get the same city.

use std::collections::HashSet;

use csp_shared::balance::{
    CITY_AREA_MARGIN, CITY_BUILDING_REACH, CITY_MIN_DISTANCE, HOUSING_ROOM, NPC_CITY_MIN_DISTANCE,
    START_CARRIED_FOOD, START_CITY_SIZE, START_FOOD, START_HORSES, START_RESIDENTS,
    START_SPARE_HOUSES, START_STABLE_FOOD, TRADE_ORG_HQ, TRADE_ORG_HQ_MIN_DISTANCE,
};
use csp_shared::footprint::{footprint_tiles, Placed, FOOTPRINT};
use csp_shared::terrain::{terrain_at, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, Good, Realm, RealmEventWhat, ResidentOrder,
    RunningScript, Task, Tile, TradeOrgCity, WorkOrder, WorldState,
};

use crate::cities::{given_city_name, update_city_membership, CITY_NAMES};
use crate::events::record_event;
use crate::horses::{new_horse, NewHorse};
use crate::placing::Ground;
use crate::queries::city::town_hall_of;
use crate::queries::names::kind_name;
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, resident_name, NewResident};
use crate::standing::welcome_former_player;

/// The Player's realm, if they have one (`realmOf`), by index.
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<usize> {
    world.realms.iter().position(|r| r.user_id == user_id)
}

/// The Leader's name from the game offered to a Player founding a realm (`suggestedLeaderName`).
pub fn suggested_leader_name(world: &WorldState, user_id: u64) -> String {
    let seed = world.seed as f64 * 6151.0 + user_id as f64 * 31.0 + world.tick as f64;
    let mut m = Mulberry32::new(seed);
    resident_name(&mut || m.next()).to_string()
}

/// How many tiles out from a starting city's wall its farm and stable stand (`FARM_RING`).
pub const FARM_RING: i32 = 1 + CITY_AREA_MARGIN as i32;

const START_SIZE: i32 = START_CITY_SIZE as i32;

fn footprint(kind: BuildingKind) -> i32 {
    FOOTPRINT.get(kind_name(kind)).expect("every kind has a footprint")
}

/// Where a walled square city's town hall goes (`hallTile`): just south of the storage.
pub fn hall_tile(x: i32, y: i32, size: i32) -> (i32, i32) {
    let mid = size / 2;
    (x + mid - 1, y + mid + footprint(BuildingKind::Storage) + 1)
}

/// Where a walled square city's `i`th house goes (`houseTile`): in a row along the north side.
pub fn house_tile(x: i32, y: i32, size: i32, i: i32) -> (i32, i32) {
    let mid = size / 2;
    let row = y + 2.max(mid - CITY_BUILDING_REACH as i32);
    (x + 2 + i * (footprint(BuildingKind::House) + 1), row)
}

/// The tiles residents, horses, carriages and piles stand on (`residentTiles`).
pub fn resident_tiles(world: &WorldState) -> Vec<(i32, i32)> {
    let at = |x: f64, y: f64| (x as i32, y as i32);
    world
        .residents
        .iter()
        .map(|e| at(e.x, e.y))
        .chain(world.horses.iter().map(|e| at(e.x, e.y)))
        .chain(world.carriages.iter().map(|e| at(e.x, e.y)))
        .chain(world.piles.iter().map(|e| at(e.x, e.y)))
        .collect()
}

/// A square ring of wall with one gate in it (`WallSquare`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallSquare {
    pub x: i32,
    pub y: i32,
    pub size: i32,
    pub gate: (i32, i32),
}

/// A walled square at (x, y), the gate in the middle of the south side (`wallSquare`).
pub fn wall_square(x: i32, y: i32, size: i32) -> WallSquare {
    WallSquare { x, y, size, gate: (x + size / 2, y + size - 1) }
}

fn start_city(x: i32, y: i32) -> WallSquare {
    wall_square(x, y, START_SIZE)
}

/// The tiles of a square's wall ring, the gate's included, each once (`ringTiles`), in the order
/// of a `Map` filled side by side.
pub fn ring_tiles(square: &WallSquare) -> Vec<(i32, i32)> {
    let WallSquare { x, y, size, .. } = *square;
    let mut seen = HashSet::new();
    let mut ring = Vec::new();
    for i in 0..size {
        for t in [(x + i, y), (x + i, y + size - 1), (x, y + i), (x + size - 1, y + i)] {
            if seen.insert(t) {
                ring.push(t);
            }
        }
    }
    ring
}

/// Where buildings of `kinds` go outside a city's wall, one after another (`spotsOutside`): each
/// footprint wholly at least `out` tiles out from the wall, touching that ring, on ground that
/// takes it, off the way straight out of the gate and off the others; each the one nearest the
/// gate. None when one of them finds no room.
pub(crate) fn spots_outside(
    ground: &Ground,
    city: &WallSquare,
    kinds: &[BuildingKind],
    out: i32,
) -> Option<Vec<(i32, i32)>> {
    let WallSquare { x, y, size, gate } = *city;
    let lane = |tx: i32, ty: i32| tx == gate.0 && ty > gate.1;
    let mut mine: HashSet<(i32, i32)> = HashSet::new();
    let mut spots = Vec::new();
    for &kind in kinds {
        let side = footprint(kind);
        let mut candidates = Vec::new();
        for i in (-out - side + 1)..(size + out) {
            candidates.push((x + i, y - out - side + 1));
            candidates.push((x + i, y + size - 1 + out));
            candidates.push((x - out - side + 1, y + i));
            candidates.push((x + size - 1 + out, y + i));
        }
        let mut free: Vec<(i32, i32)> = candidates
            .into_iter()
            .filter(|&(cx, cy)| {
                let ring = (x - (cx + side - 1))
                    .max(cx - (x + size - 1))
                    .max(0)
                    .max((y - (cy + side - 1)).max(cy - (y + size - 1)).max(0));
                ring >= out
                    && ground.fits(
                        kind,
                        cx,
                        cy,
                        Some(&|tx, ty| !lane(tx, ty) && !mine.contains(&(tx, ty))),
                    )
            })
            .collect();
        let to_gate = |&(cx, cy): &(i32, i32)| {
            let half = f64::from(side - 1) / 2.0;
            (f64::from(cx) + half - f64::from(gate.0))
                .hypot(f64::from(cy) + half - f64::from(gate.1))
        };
        free.sort_by(|a, b| {
            (to_gate(a) - to_gate(b)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        let best = *free.first()?;
        let size_map = ground.terrain.size;
        for t in footprint_tiles(Placed { kind: kind_name(kind), x: best.0, y: best.1 }, size_map) {
            mine.insert(t);
        }
        spots.push(best);
    }
    Some(spots)
}

/// Where a city may stand (`siteFits`): its square and the rings around it on open land, with no
/// nodes, and room outside the wall for the farm and the stable.
fn site_fits(terrain: &TerrainMap, ground: &Ground, x: i32, y: i32) -> bool {
    for ty in (y - FARM_RING)..(y + START_SIZE + FARM_RING) {
        for tx in (x - FARM_RING)..(x + START_SIZE + FARM_RING) {
            let t = terrain_at(terrain, tx, ty);
            if t != Terrain::Plains as u8 && t != Terrain::Forest as u8 && t != Terrain::Hills as u8
            {
                return false;
            }
            if !ground.free(tx, ty) || ground.node_at(tx, ty).is_some() {
                return false;
            }
        }
    }
    spots_outside(ground, &start_city(x, y), &[BuildingKind::Farm, BuildingKind::Stable], FARM_RING)
        .is_some()
}

/// `wrap` of the TypeScript on numbers that may have fractions.
fn wrap_f(v: f64, size: f64) -> f64 {
    ((v % size) + size) % size
}

/// `wrapDistance` of the TypeScript on numbers that may have fractions.
fn wrap_distance_f(size: f64, a: (f64, f64), b: (f64, f64)) -> f64 {
    let delta = |a: f64, b: f64| {
        let d = wrap_f(b - a, size);
        if d > size / 2.0 {
            d - size
        } else {
            d
        }
    };
    delta(a.0, b.0).hypot(delta(a.1, b.1))
}

/// Picks a site for a new starting city (`findCitySite`): on open land, far enough from every
/// city of a realm, the Trade Org HQ and every NPC city; when the map has no such room left, the
/// distances are halved until a site fits. Panics when no site fits at all, as the TypeScript
/// throws.
pub fn find_city_site(
    world: &WorldState,
    terrain: &TerrainMap,
    rand: &mut Mulberry32,
) -> (i32, i32) {
    let span = f64::from(terrain.size - START_SIZE - 2 * FARM_RING);
    struct Other {
        at: (f64, f64),
        npc: bool,
        hq: bool,
    }
    let others: Vec<Other> = world
        .cities
        .iter()
        .filter_map(|c| {
            town_hall_of(world, c).map(|h| Other {
                at: (h.x, h.y),
                npc: c.realm_id.is_none(),
                hq: c.trade_org == Some(TradeOrgCity::Hq),
            })
        })
        .collect();
    let ground = Ground::new(world, terrain, []);
    let size = f64::from(terrain.size);
    let mut min_distance = CITY_MIN_DISTANCE;
    loop {
        for _ in 0..3000 {
            let x = FARM_RING + (rand.next() * span).floor() as i32;
            let y = FARM_RING + (rand.next() * span).floor() as i32;
            let centre =
                (f64::from(x) + START_CITY_SIZE / 2.0, f64::from(y) + START_CITY_SIZE / 2.0);
            let too_near = |o: &Other| {
                let keep = if o.hq {
                    (TRADE_ORG_HQ_MIN_DISTANCE * min_distance / CITY_MIN_DISTANCE)
                        .max(TRADE_ORG_HQ.outer_radius + f64::from(FARM_RING) + START_CITY_SIZE)
                } else if o.npc {
                    NPC_CITY_MIN_DISTANCE.min(min_distance)
                } else {
                    min_distance
                };
                wrap_distance_f(size, o.at, centre) < keep
            };
            if others.iter().any(too_near) {
                continue;
            }
            if site_fits(terrain, &ground, x, y) {
                return (x, y);
            }
        }
        if min_distance == 0.0 {
            panic!("no room left on the map for a starting city");
        }
        min_distance = (min_distance / 2.0).floor();
    }
}

/// The names a Player gives when founding (`names` of `foundStartingCity`).
#[derive(Debug, Clone)]
pub struct FoundingNames {
    pub realm_name: String,
    pub leader_name: String,
}

/// Gives a Player their realm and starting city (`foundStartingCity`), unless they already have
/// one: residents with random stats, one of them the Leader, a town hall, a ring of wooden wall
/// with a gate, houses for everyone and a spare, a storage with food, a farm outside the wall, a
/// stable next to it with horses and a little food, and a carriage at the stable with a horse
/// hitched to it. The residents start on the farm, working it. Returns the realm's index.
pub fn found_starting_city(
    world: &mut WorldState,
    terrain: &TerrainMap,
    user_id: u64,
    names: Option<&FoundingNames>,
) -> usize {
    if let Some(existing) = realm_of(world, user_id) {
        return existing;
    }
    let mut rand = Mulberry32::new(world.seed as f64 * 7919.0 + user_id as f64);
    let (x, y) = find_city_site(world, terrain, &mut rand);
    let size = START_SIZE;
    let mid = size / 2;
    let realm_id = new_id("realm", &mut world.next_id);
    let square = start_city(x, y);
    let city_id = new_id("city", &mut world.next_id);
    let drawn = CITY_NAMES[(rand.next() * CITY_NAMES.len() as f64).floor() as usize];
    let mut city = City {
        id: city_id.clone(),
        name: given_city_name(world, drawn),
        game_name: Some(true),
        realm_id: Some(realm_id.clone()),
        town_hall_id: String::new(),
        trade_org: None,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        outweighed: None,
        layout: None,
    };
    let building = |world: &mut WorldState, kind: BuildingKind, (bx, by): (i32, i32)| Building {
        id: new_id("b", &mut world.next_id),
        kind,
        city_id: Some(city_id.clone()),
        realm_id: None,
        x: f64::from(bx),
        y: f64::from(by),
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    };
    let hall = building(world, BuildingKind::TownHall, hall_tile(x, y, size));
    city.town_hall_id = hall.id.clone();
    let (hall_x, hall_y) = (hall.x, hall.y);
    let houses = (START_RESIDENTS / HOUSING_ROOM.get("house").expect("a house houses")).ceil()
        + START_SPARE_HOUSES;
    let mut buildings = vec![hall];
    let mut storage = building(world, BuildingKind::Storage, (x + mid, y + mid));
    storage.stock = Some([(Good::Food, START_FOOD)].into_iter().collect());
    buildings.push(storage);
    for i in 0..houses as i32 {
        buildings.push(building(world, BuildingKind::House, house_tile(x, y, size, i)));
    }
    for (wx, wy) in ring_tiles(&square) {
        let kind = if (wx, wy) == square.gate { BuildingKind::Gate } else { BuildingKind::Wall };
        buildings.push(building(world, kind, (wx, wy)));
    }
    // Outside the wall, just past the city's area by the gate: the farm, and the stable next to it.
    let spots = {
        let ground = Ground::new(world, terrain, resident_tiles(world));
        spots_outside(&ground, &square, &[BuildingKind::Farm, BuildingKind::Stable], FARM_RING)
            .expect("the site fits a farm and a stable")
    };
    let ((fx, fy), (sx, sy)) = (spots[0], spots[1]);
    let farm = building(world, BuildingKind::Farm, (fx, fy));
    let farm_id = farm.id.clone();
    let mut stable = building(world, BuildingKind::Stable, (sx, sy));
    stable.stock = Some([(Good::Food, START_STABLE_FOOD)].into_iter().collect());
    buildings.push(farm);
    buildings.push(stable);

    // Everyone starts on the farm, working it, with a little food; the first is the Leader.
    let leader_name = names.map(|n| crate::queries::people::js_trim(&n.leader_name).to_string());
    let mut taken: HashSet<String> = leader_name.iter().cloned().collect();
    let (fx, fy) = (f64::from(fx), f64::from(fy));
    let mut residents = Vec::new();
    for i in 0..START_RESIDENTS as usize {
        let id = new_id("r", &mut world.next_id);
        let place = NewResident {
            id: &id,
            owner: Some(&realm_id),
            city_id: Some(&city_id),
            x: fx,
            y: fy,
            tick: world.tick as f64,
        };
        let names_from = if i == 0 && leader_name.is_some() { None } else { Some(&mut taken) };
        let mut r = new_resident(&mut || rand.next(), &place, names_from);
        r.carried = [(Good::Food, START_CARRIED_FOOD)].into_iter().collect();
        r.order = Some(ResidentOrder::WorkAt(WorkOrder {
            building_id: farm_id.clone(),
            at: Tile { x: fx, y: fy },
            progress: 0.0,
            makes: None,
        }));
        // By the Work default, the Player's version from the first tick their scripts run.
        let mut memory = serde_json::Map::new();
        memory.insert("workplaceId".into(), serde_json::Value::String(farm_id.clone()));
        r.script = Some(RunningScript {
            script_id: 0,
            task: Some(Task::Work),
            memory,
            settings_from: None,
            error_logged_at: None,
            budget_logged_at: None,
            last_error: None,
            last_run: None,
            waiting_since: None,
            alarm: None,
            alarm_under: None,
        });
        residents.push(r);
    }
    let mut realm = Realm {
        id: realm_id.clone(),
        user_id,
        leader_id: residents[0].id.clone(),
        name: None,
        demands_sent_at: None,
    };
    if let (Some(names), Some(leader_name)) = (names, &leader_name) {
        realm.name = Some(crate::queries::people::js_trim(&names.realm_name).to_string());
        residents[0].name = leader_name.clone();
    }
    world.realms.push(realm.clone());
    welcome_former_player(world, &realm);
    world.cities.push(city);
    world.buildings.extend(buildings);
    update_city_membership(world, terrain.size);
    let (leader_id, leader) = (residents[0].id.clone(), residents[0].name.clone());
    world.residents.extend(residents);
    let mut horse_rand = Mulberry32::new(world.seed as f64 * 7919.0 + user_id as f64 + 1.0);
    let (sx, sy) = (f64::from(sx), f64::from(sy));
    for _ in 0..START_HORSES as usize {
        let id = new_id("horse", &mut world.next_id);
        let fields = NewHorse {
            id,
            realm_id: Some(realm_id.clone()),
            city_id: None,
            x: sx,
            y: sy,
            tick: world.tick as f64,
        };
        let horse = new_horse(&mut || horse_rand.next(), fields);
        world.horses.push(horse);
    }
    // The carriage stands at the stable, with one of the horses hitched to it.
    let horse_id = world.horses.last().map(|h| h.id.clone());
    let carriage_id = new_id("carriage", &mut world.next_id);
    world.carriages.push(Carriage {
        id: carriage_id,
        realm_id: Some(realm_id.clone()),
        city_id: None,
        x: sx,
        y: sy,
        horse_id,
        load: Default::default(),
    });
    let city = world.cities.iter().find(|c| c.id == city_id).expect("just founded");
    let what = RealmEventWhat::Founded {
        resident_id: leader_id,
        name: leader,
        city_id: city.id.clone(),
        city: city.name.clone(),
        x: hall_x,
        y: hall_y,
    };
    record_event(world, Some(&realm_id), what);
    world.realms.len() - 1
}

#[cfg(test)]
mod tests;
