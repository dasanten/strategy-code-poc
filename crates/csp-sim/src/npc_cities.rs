//! The world's NPC cities come to be (`apps/server/src/npc-cities.ts`, `npc-horses.ts`,
//! `CONTEXT.md`: NPC city, NPC horses): `NPC_TOWNS` towns and `NPC_VILLAGES` villages, each laid out
//! as a starting city is, on a site out of every Player's sight, with its first horses.

use std::collections::HashSet;

use csp_shared::balance::{
    NpcCitySize, HORSE_FOOD_PER_DAY, MAP_SIZE, NPC_CITY_MIN_DISTANCE, NPC_START_HORSES,
    NPC_START_HORSE_FOOD_DAYS, NPC_TOWN, NPC_TOWNS, NPC_VILLAGE, NPC_VILLAGES, SIGHT_RANGE,
    START_CARRIED_FOOD,
};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{terrain_at, wrap, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, Good, Pile, ResidentOrder, Stock, Task, Tile, TradeOrgCity,
    WorkOrder, WorldState,
};
use serde_json::json;

use crate::cities::update_city_membership;
use crate::city_layout::{layout_plan, pick_layout, GateAt, LayoutPlan};
use crate::horses::{new_horse, NewHorse};
use crate::npc_behaviour::{default_script, npc_home};
use crate::npc_growth::{far_stable_spot, resident_tiles};
use crate::placing::Ground;
use crate::queries::city::town_hall_of;
use crate::queries::horses::{owns_horse, HorseOwner};
use crate::random::{hash_str, new_id, Mulberry32};
use crate::residents::{new_resident, NewResident, Rand};
use crate::terrain_gen::js_hypot;

use crate::cities::{given_city_name, CITY_NAMES};
pub use crate::starting_city::{hall_tile, FARM_RING};
use crate::starting_city::{house_tile as row_house_tile, ring_tiles, spots_outside, wall_square};

// ---- The NPC cities. ----

/// How many cities of a kind a map of `size` gets (`npcCityCount`): `per_full_map` on a full-size
/// map, by area.
pub fn npc_city_count(per_full_map: f64, size: i32) -> usize {
    crate::queries::js_round(
        per_full_map * f64::from(size) * f64::from(size)
            / (f64::from(MAP_SIZE) * f64::from(MAP_SIZE)),
    ) as usize
}

/// How far a city's tiles reach from its middle at most (`footprintRadius`).
fn footprint_radius(kind: &NpcCitySize) -> f64 {
    (kind.size / 2.0 + f64::from(FARM_RING)) * std::f64::consts::SQRT_2
}

/// Whether an NPC city of `kind` with its top-left wall tile at (x, y) fits there (`npcSiteFits`):
/// its square and the ring round it all Plains with nothing on them, room for its farms outside
/// the wall, at least `NPC_CITY_MIN_DISTANCE` from every city, and, unless `out_of_sight` is false,
/// out of sight of every Player's resident.
pub fn npc_site_fits(
    world: &WorldState,
    terrain: &TerrainMap,
    kind: &NpcCitySize,
    x: i32,
    y: i32,
    ground: &Ground,
    out_of_sight: bool,
) -> bool {
    let size = terrain.size;
    let centre = (f64::from(x) + kind.size / 2.0, f64::from(y) + kind.size / 2.0);
    // `wrapDistance` of the TypeScript, to a half tile.
    let dist = |a: (f64, f64), b: (f64, f64)| {
        let d = |p: f64, q: f64| {
            let s = f64::from(size);
            let v = (q - p).rem_euclid(s);
            if v > s / 2.0 {
                s - v
            } else {
                v
            }
        };
        js_hypot(d(a.0, b.0), d(a.1, b.1))
    };
    for c in &world.cities {
        if let Some(hall) = town_hall_of(world, c) {
            if dist((hall.x, hall.y), centre) < NPC_CITY_MIN_DISTANCE {
                return false;
            }
        }
    }
    let unseen = SIGHT_RANGE + footprint_radius(kind);
    if out_of_sight
        && world.residents.iter().any(|r| r.owner.is_some() && dist((r.x, r.y), centre) <= unseen)
    {
        return false;
    }
    let side = kind.size as i32;
    for ty in y - FARM_RING..y + side + FARM_RING {
        for tx in x - FARM_RING..x + side + FARM_RING {
            if terrain_at(terrain, tx, ty) != Terrain::Plains as u8
                || !ground.free(wrap(tx, size), wrap(ty, size))
            {
                return false;
            }
        }
    }
    spots_outside(
        ground,
        &wall_square(x, y, side),
        &vec![BuildingKind::Farm; kind.farms as usize],
        FARM_RING,
    )
    .is_some()
}

/// The ground with what stands on it (`takenGround`): nodes, footprints, residents, horses,
/// carriages and piles.
pub fn taken_ground<'t>(world: &WorldState, terrain: &'t TerrainMap) -> Ground<'t> {
    let mut more: Vec<(i32, i32)> = world.nodes.iter().map(|n| (n.x as i32, n.y as i32)).collect();
    more.extend(resident_tiles(world));
    Ground::new(world, terrain, more)
}

/// Picks a site for an NPC city of `kind` (`findNpcCitySite`), or none when the map has no room
/// left for it. A city never straddles the map's joins.
pub fn find_npc_city_site(
    world: &WorldState,
    terrain: &TerrainMap,
    kind: &NpcCitySize,
    rand: &mut Rand,
) -> Option<(i32, i32)> {
    let span = terrain.size - kind.size as i32 - 2 * FARM_RING;
    if span <= 0 {
        return None;
    }
    let ground = taken_ground(world, terrain);
    for _ in 0..3000 {
        let x = FARM_RING + (rand() * f64::from(span)).floor() as i32;
        let y = FARM_RING + (rand() * f64::from(span)).floor() as i32;
        if npc_site_fits(world, terrain, kind, x, y, &ground, true) {
            return Some((x, y));
        }
    }
    None
}

/// A building of a city.
fn building(id: String, kind: BuildingKind, city_id: &str, x: i32, y: i32) -> Building {
    Building {
        id,
        kind,
        city_id: Some(city_id.to_string()),
        realm_id: None,
        x: f64::from(x),
        y: f64::from(y),
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    }
}

/// Lays out an NPC city of `kind` with its top-left wall tile at (x, y) (`foundNpcCity`), as a
/// starting city is laid out: a ring of wall with a gate, the storage with food in the middle, the
/// town hall south of it, houses north of it, each on the nearest spot its layout has, and farms
/// outside the wall by the gate. Its residents belong to no realm; they start on the farms, working
/// them. A trading post (`trade_org`) has no layout. Returns the city's id.
pub fn found_npc_city(
    world: &mut WorldState,
    terrain: &TerrainMap,
    kind: &NpcCitySize,
    x: i32,
    y: i32,
    rand: &mut Rand,
    trade_org: Option<TradeOrgCity>,
) -> String {
    let side = kind.size as i32;
    let mid = side / 2;
    let square = wall_square(x, y, side);
    let id = new_id("city", &mut world.next_id);
    let drawn =
        CITY_NAMES[(hash_str(&format!("{}:{id}", world.seed)) % CITY_NAMES.len() as u32) as usize];
    let city = City {
        id: id.clone(),
        name: given_city_name(world, drawn),
        game_name: Some(true),
        realm_id: None,
        town_hall_id: String::new(),
        trade_org,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        layout: trade_org.is_none().then(|| pick_layout(world.seed, &id)),
    };
    let b = |world: &mut WorldState, k, bx, by| {
        building(new_id("b", &mut world.next_id), k, &id, bx, by)
    };
    let (hx, hy) = hall_tile(x, y, side);
    let hall = b(world, BuildingKind::TownHall, hx, hy);
    let farm_spots = spots_outside(
        &taken_ground(world, terrain),
        &square,
        &vec![BuildingKind::Farm; kind.farms as usize],
        FARM_RING,
    )
    .unwrap_or_default();
    let farms: Vec<Building> =
        farm_spots.into_iter().map(|(fx, fy)| b(world, BuildingKind::Farm, fx, fy)).collect();
    let mut storage = b(world, BuildingKind::Storage, x + mid, y + mid);
    storage.stock = Some(Stock::from([(Good::Food, kind.food)]));
    let walls: Vec<Building> = ring_tiles(&square)
        .into_iter()
        .map(|(wx, wy)| {
            let k = if (wx, wy) == square.gate { BuildingKind::Gate } else { BuildingKind::Wall };
            b(world, k, wx, wy)
        })
        .collect();
    let mut city = city;
    city.town_hall_id = hall.id.clone();
    world.cities.push(city.clone());
    world.buildings.push(hall);
    world.buildings.push(storage.clone());
    world.buildings.extend(walls);
    world.buildings.extend(farms.iter().cloned());
    let plan = layout_plan(world, &city, &storage, Some(GateAt { dx: 0, dy: mid }), terrain.size);
    let mut ground = Ground::new(world, terrain, []);
    for i in 0..kind.houses as i32 {
        let row = row_house_tile(x, y, side, i);
        let (hx, hy) = plan
            .as_ref()
            .and_then(|p| starting_house_spot(p, &ground, &storage, row))
            .unwrap_or(row);
        ground.take(BuildingKind::House, hx, hy);
        let house = b(world, BuildingKind::House, hx, hy);
        world.buildings.push(house);
    }
    let mut names = HashSet::new();
    for i in 0..kind.residents as usize {
        let farm = &farms[i % farms.len()];
        let rid = new_id("r", &mut world.next_id);
        let fields = NewResident {
            id: &rid,
            owner: None,
            city_id: Some(&id),
            x: farm.x,
            y: farm.y,
            tick: world.tick as f64,
        };
        let mut r = new_resident(rand, &fields, Some(&mut names));
        r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
        r.order = Some(ResidentOrder::WorkAt(WorkOrder {
            building_id: farm.id.clone(),
            at: Tile { x: farm.x, y: farm.y },
            progress: 0.0,
            makes: None,
        }));
        r.script = Some(default_script(Task::Work, json!({ "workplaceId": farm.id })));
        world.residents.push(r);
    }
    update_city_membership(world, terrain.size);
    id
}

/// Where a starting house goes by its city's layout (`startingHouseSpot`): the spot nearest its
/// tile in a starting city's row, and no further from the home than that.
fn starting_house_spot(
    plan: &LayoutPlan,
    ground: &Ground,
    home: &Building,
    row: (i32, i32),
) -> Option<(i32, i32)> {
    let size = ground.terrain.size;
    let (hx, hy) = (home.x as i32, home.y as i32);
    let reach = (row.0 - hx).abs().max((row.1 - hy).abs());
    let off = |x: i32, y: i32| !plan.street(x, y);
    let mut best: Option<((i32, i32), i32, f64)> = None;
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let x = wrap(hx + dx, size);
            let y = wrap(hy + dy, size);
            if !plan.spot(BuildingKind::House, x, y) {
                continue;
            }
            let rank = plan.rank(BuildingKind::House, x, y).unwrap_or(0);
            let d = if plan.has_rank() {
                f64::from(reach - dx.abs().max(dy.abs()))
            } else {
                js_hypot(f64::from(hx + dx - row.0), f64::from(hy + dy - row.1))
            };
            if best.is_some_and(|b| rank > b.1 || (rank == b.1 && d >= b.2)) {
                continue;
            }
            if ground.fits(BuildingKind::House, x, y, Some(&off)) {
                best = Some(((x, y), rank, d));
            }
        }
    }
    best.map(|b| b.0)
}

/// Places the world's NPC cities (`placeNpcCities`): `NPC_TOWNS` towns, then `NPC_VILLAGES`
/// villages, scaled to the map's area, each on a site `find_npc_city_site` picks and with its first
/// horses. Fewer when the map has no room left. Returns their ids.
pub fn place_npc_cities(world: &mut WorldState, terrain: &TerrainMap) -> Vec<String> {
    let mut m = Mulberry32::new((world.seed * 104_729 + 31) as f64);
    let mut rand = || m.next();
    let mut kinds: Vec<NpcCitySize> = vec![NPC_TOWN; npc_city_count(NPC_TOWNS, terrain.size)];
    kinds.extend(vec![NPC_VILLAGE; npc_city_count(NPC_VILLAGES, terrain.size)]);
    let mut placed = Vec::new();
    for kind in &kinds {
        if let Some((x, y)) = find_npc_city_site(world, terrain, kind, &mut rand) {
            placed.push(found_npc_city(world, terrain, kind, x, y, &mut rand, None));
        }
    }
    for id in &placed {
        give_npc_horses(world, terrain, id);
    }
    placed
}

/// An NPC city's first horses (`giveNpcHorses`, `CONTEXT.md`: NPC horses): `NPC_START_HORSES` new
/// ones of the city and their Food on the ground by them, in its stable if it has one, else where
/// one fits far from its home. A city's horses are drawn from its own seed.
pub fn give_npc_horses(world: &mut WorldState, terrain: &TerrainMap, city_id: &str) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { return };
    let stable = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Stable && b.city_id.as_deref() == Some(city_id));
    let spot = match stable {
        Some(s) => Some((s.x as i32, s.y as i32)),
        None => npc_home(world, city_id)
            .cloned()
            .and_then(|home| far_stable_spot(world, &city, &home, terrain)),
    };
    let Some(spot) = spot else { return };
    let middle = FOOTPRINT.get("stable").expect("a footprint") / 2;
    let (x, y) = (wrap(spot.0 + middle, terrain.size), wrap(spot.1 + middle, terrain.size));
    let mut m = Mulberry32::new(f64::from(hash_str(&format!("{}:{city_id}:horses", world.seed))));
    for _ in 0..NPC_START_HORSES as usize {
        let id = new_id("horse", &mut world.next_id);
        let fields = NewHorse {
            id,
            realm_id: None,
            city_id: Some(city_id.to_string()),
            x: f64::from(x),
            y: f64::from(y),
            tick: world.tick as f64,
        };
        world.horses.push(new_horse(&mut || m.next(), fields));
    }
    let food = (NPC_START_HORSES * NPC_START_HORSE_FOOD_DAYS * HORSE_FOOD_PER_DAY).ceil();
    let (fx, fy) = (f64::from(x), f64::from(y));
    if let Some(p) = world.piles.iter_mut().find(|p| p.x == fx && p.y == fy) {
        *p.goods.entry(Good::Food).or_insert(0.0) += food;
    } else {
        let id = new_id("pile", &mut world.next_id);
        world.piles.push(Pile { id, x: fx, y: fy, goods: Stock::from([(Good::Food, food)]) });
    }
}

/// The migration of the NPC horses (`giveHorsesToNpcCities`): each NPC city with no horse gets its
/// two.
pub fn give_horses_to_npc_cities(world: &mut WorldState, terrain: &TerrainMap) {
    let ids: Vec<String> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
        .map(|c| c.id.clone())
        .collect();
    for id in ids {
        if world.horses.iter().any(|h| owns_horse(HorseOwner::City(&id), h)) {
            continue;
        }
        give_npc_horses(world, terrain, &id);
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod horses_tests;
