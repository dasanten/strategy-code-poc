//! The world's NPC cities come to be (`apps/server/src/npc-cities.ts`, `npc-horses.ts`,
//! `CONTEXT.md`: NPC city, NPC horses): `NPC_TOWNS` towns and `NPC_VILLAGES` villages, each laid out
//! as a starting city is, on a site out of every Player's sight, with its first horses.

use std::collections::HashSet;

use csp_shared::balance::{
    CITY_AREA_MARGIN, CITY_BUILDING_REACH, HORSE_FOOD_PER_DAY, MAP_SIZE, NPC_CITY_MIN_DISTANCE,
    NPC_START_HORSES, NPC_START_HORSE_FOOD_DAYS, NPC_TOWN, NPC_TOWNS, NPC_VILLAGE, NPC_VILLAGES,
    NpcCitySize, SIGHT_RANGE, START_CARRIED_FOOD,
};
use csp_shared::footprint::{footprint_keys, Placed, FOOTPRINT};
use csp_shared::terrain::{terrain_at, wrap, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, Good, Pile, ResidentOrder, Stock, Task, Tile,
    TradeOrgCity, WorkOrder, WorldState,
};
use serde_json::json;

use crate::cities::update_city_membership;
use crate::city_layout::{layout_plan, pick_layout, GateAt, LayoutPlan};
use crate::horses::{new_horse, NewHorse};
use crate::names::{city_names_taken, unique_name};
use crate::npc_behaviour::{default_script, npc_home};
use crate::npc_growth::{far_stable_spot, resident_tiles};
use crate::placing::Ground;
use crate::queries::city::town_hall_of;
use crate::queries::horses::{owns_horse, HorseOwner};
use crate::queries::names::kind_name;
use crate::random::{hash_str, new_id, Mulberry32};
use crate::residents::{new_resident, NewResident, Rand};
use crate::terrain_gen::js_hypot;

// ---- What `starting-city.ts` and `cities.ts` lay a city out by. TODO(T86.8): use the ports. ----

/// The ring of open land round a city's square (`FARM_RING`).
pub const FARM_RING: i32 = 1 + CITY_AREA_MARGIN as i32;

/// The names the game gives cities (`CITY_NAMES`).
pub const CITY_NAMES: [&str; 20] = [
    "Ashford", "Brackenholt", "Coldwater", "Dunmere", "Eastwick", "Fallowby", "Greyhaven",
    "Hartwell", "Ironside", "Juniper", "Kettleby", "Larkspur", "Millbrook", "Northam", "Oakhurst",
    "Pinecrest", "Quarrytown", "Redbank", "Stonebridge", "Thornbury",
];

/// The name the game gives a new city (`givenCityName`): `drawn`, or the next one no city has.
fn given_city_name(world: &WorldState, drawn: &str) -> String {
    unique_name(drawn, &city_names_taken(world), &CITY_NAMES)
}

/// Where a city's town hall goes in its square (`hallTile`): south of its storage.
pub fn hall_tile(x: i32, y: i32, size: i32) -> (i32, i32) {
    let mid = size / 2;
    let storage = FOOTPRINT.get("storage").expect("a footprint");
    (x + mid - 1, y + mid + storage + 1)
}

/// Where a city's `i`th starting house goes (`houseTile` of `starting-city.ts`): in a row north of
/// its storage.
pub fn row_house_tile(x: i32, y: i32, size: i32, i: i32) -> (i32, i32) {
    let mid = size / 2;
    let row = y + 2.max(mid - CITY_BUILDING_REACH as i32);
    let house = FOOTPRINT.get("house").expect("a footprint");
    (x + 2 + i * (house + 1), row)
}

/// A square of wall (`WallSquare`): its top-left tile, its side and its gate.
#[derive(Debug, Clone, Copy)]
pub struct WallSquare {
    pub x: i32,
    pub y: i32,
    pub size: i32,
    pub gate: (i32, i32),
}

/// The square of a city of `size` tiles at (x, y) (`wallSquare`), its gate in the middle of its
/// south side.
pub fn wall_square(x: i32, y: i32, size: i32) -> WallSquare {
    WallSquare { x, y, size, gate: (x + size / 2, y + size - 1) }
}

/// The tiles of a square's ring of wall, each once (`ringTiles`).
pub fn ring_tiles(s: WallSquare) -> Vec<(i32, i32)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for i in 0..s.size {
        for t in [(s.x + i, s.y), (s.x + i, s.y + s.size - 1), (s.x, s.y + i), (s.x + s.size - 1, s.y + i)] {
            if seen.insert(t) {
                out.push(t);
            }
        }
    }
    out
}

/// Spots outside a city's wall for `kinds`, one each by the gate (`spotsOutside`), off the lane out
/// of the gate; none if one of them has no room.
pub fn spots_outside(ground: &Ground, city: WallSquare, kinds: &[BuildingKind]) -> Option<Vec<(i32, i32)>> {
    let out = FARM_RING;
    let WallSquare { x, y, size, gate } = city;
    let lane = |tx: i32, ty: i32| tx == gate.0 && ty > gate.1;
    let mut mine: HashSet<String> = HashSet::new();
    let mut spots = Vec::new();
    for &kind in kinds {
        let side = FOOTPRINT.get(kind_name(kind)).expect("a footprint");
        let mut candidates = Vec::new();
        for i in -out - side + 1..size + out {
            candidates.extend([
                (x + i, y - out - side + 1),
                (x + i, y + size - 1 + out),
                (x - out - side + 1, y + i),
                (x + size - 1 + out, y + i),
            ]);
        }
        let mut free: Vec<(i32, i32)> = candidates
            .into_iter()
            .filter(|&(cx, cy)| {
                let ring = (x - (cx + side - 1)).max(cx - (x + size - 1)).max(0).max((y - (cy + side - 1)).max(cy - (y + size - 1)).max(0));
                let also = |tx: i32, ty: i32| !lane(tx, ty) && !mine.contains(&format!("{tx},{ty}"));
                ring >= out && ground.fits(kind, cx, cy, Some(&also))
            })
            .collect();
        let to_gate = |&(cx, cy): &(i32, i32)| {
            js_hypot(f64::from(cx) + f64::from(side - 1) / 2.0 - f64::from(gate.0), f64::from(cy) + f64::from(side - 1) / 2.0 - f64::from(gate.1))
        };
        free.sort_by(|a, b| to_gate(a).total_cmp(&to_gate(b)));
        let best = *free.first()?;
        mine.extend(footprint_keys(Placed { kind: kind_name(kind), x: best.0, y: best.1 }, ground.terrain.size));
        spots.push(best);
    }
    Some(spots)
}

// ---- The NPC cities. ----

/// How many cities of a kind a map of `size` gets (`npcCityCount`): `per_full_map` on a full-size
/// map, by area.
pub fn npc_city_count(per_full_map: f64, size: i32) -> usize {
    crate::queries::js_round(per_full_map * f64::from(size) * f64::from(size) / (f64::from(MAP_SIZE) * f64::from(MAP_SIZE))) as usize
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
            if v > s / 2.0 { s - v } else { v }
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
    if out_of_sight && world.residents.iter().any(|r| r.owner.is_some() && dist((r.x, r.y), centre) <= unseen) {
        return false;
    }
    let side = kind.size as i32;
    for ty in y - FARM_RING..y + side + FARM_RING {
        for tx in x - FARM_RING..x + side + FARM_RING {
            if terrain_at(terrain, tx, ty) != Terrain::Plains as u8 || !ground.free(wrap(tx, size), wrap(ty, size)) {
                return false;
            }
        }
    }
    spots_outside(ground, wall_square(x, y, side), &vec![BuildingKind::Farm; kind.farms as usize]).is_some()
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
pub fn find_npc_city_site(world: &WorldState, terrain: &TerrainMap, kind: &NpcCitySize, rand: &mut Rand) -> Option<(i32, i32)> {
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
    let drawn = CITY_NAMES[(hash_str(&format!("{}:{id}", world.seed)) % CITY_NAMES.len() as u32) as usize];
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
    let mut b = |world: &mut WorldState, k, bx, by| building(new_id("b", &mut world.next_id), k, &id, bx, by);
    let (hx, hy) = hall_tile(x, y, side);
    let hall = b(world, BuildingKind::TownHall, hx, hy);
    let farm_spots = spots_outside(&taken_ground(world, terrain), square, &vec![BuildingKind::Farm; kind.farms as usize]).unwrap_or_default();
    let farms: Vec<Building> = farm_spots.into_iter().map(|(fx, fy)| b(world, BuildingKind::Farm, fx, fy)).collect();
    let mut storage = b(world, BuildingKind::Storage, x + mid, y + mid);
    storage.stock = Some(Stock::from([(Good::Food, kind.food)]));
    let walls: Vec<Building> = ring_tiles(square)
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
        let (hx, hy) = plan.as_ref().and_then(|p| starting_house_spot(p, &ground, &storage, row)).unwrap_or(row);
        ground.take(BuildingKind::House, hx, hy);
        let house = b(world, BuildingKind::House, hx, hy);
        world.buildings.push(house);
    }
    let mut names = HashSet::new();
    for i in 0..kind.residents as usize {
        let farm = &farms[i % farms.len()];
        let rid = new_id("r", &mut world.next_id);
        let fields = NewResident { id: &rid, owner: None, city_id: Some(&id), x: farm.x, y: farm.y, tick: world.tick as f64 };
        let mut r = new_resident(rand, &fields, Some(&mut names));
        r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
        r.order = Some(ResidentOrder::WorkAt(WorkOrder { building_id: farm.id.clone(), at: Tile { x: farm.x, y: farm.y }, progress: 0.0, makes: None }));
        r.script = Some(default_script(Task::Work, json!({ "workplaceId": farm.id })));
        world.residents.push(r);
    }
    update_city_membership(world, terrain.size);
    id
}

/// Where a starting house goes by its city's layout (`startingHouseSpot`): the spot nearest its
/// tile in a starting city's row, and no further from the home than that.
fn starting_house_spot(plan: &LayoutPlan, ground: &Ground, home: &Building, row: (i32, i32)) -> Option<(i32, i32)> {
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
    let stable = world.buildings.iter().find(|b| b.kind == BuildingKind::Stable && b.city_id.as_deref() == Some(city_id));
    let spot = match stable {
        Some(s) => Some((s.x as i32, s.y as i32)),
        None => npc_home(world, city_id).cloned().and_then(|home| far_stable_spot(world, &city, &home, terrain)),
    };
    let Some(spot) = spot else { return };
    let middle = FOOTPRINT.get("stable").expect("a footprint") / 2;
    let (x, y) = (wrap(spot.0 + middle, terrain.size), wrap(spot.1 + middle, terrain.size));
    let mut m = Mulberry32::new(f64::from(hash_str(&format!("{}:{city_id}:horses", world.seed))));
    for _ in 0..NPC_START_HORSES as usize {
        let id = new_id("horse", &mut world.next_id);
        let fields = NewHorse { id, realm_id: None, city_id: Some(city_id.to_string()), x: f64::from(x), y: f64::from(y), tick: world.tick as f64 };
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
    let ids: Vec<String> = world.cities.iter().filter(|c| c.realm_id.is_none() && c.trade_org.is_none()).map(|c| c.id.clone()).collect();
    for id in ids {
        if world.horses.iter().any(|h| owns_horse(HorseOwner::City(&id), h)) {
            continue;
        }
        give_npc_horses(world, terrain, &id);
    }
}

