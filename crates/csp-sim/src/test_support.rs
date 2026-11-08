//! Test worlds for the rule tests (`apps/server/src/test-terrain.ts`), until the rules that make
//! them are ported.
//!
//! `world_with_city` stands in for `worldWithCity` (`foundStartingCity` on `cityTerrain()`): a
//! starting city laid out as `foundStartingCity` lays it out (storage, town hall, houses, wall
//! and gate, farm and stable outside, eight residents working the farm with their starting food,
//! two horses and a carriage), on a map of Plains with a row of the other terrains away from it,
//! at a fixed site rather than one `findCitySite` draws. Its residents come from the same
//! `newResident` calls, but the draws `findCitySite` makes first are left out, so they are not
//! the TypeScript test's residents. TODO(T86.8): build it with the ported `found_starting_city`.

use std::collections::HashSet;

use csp_shared::balance::{
    CITY_BUILDING_REACH, MAX_HEALTH, MAX_HUNGER, START_CARRIED_FOOD, START_CITY_SIZE, START_FOOD,
    START_HORSES, START_RESIDENTS, START_SPARE_HOUSES, START_STABLE_FOOD,
};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, Good, Horse, HorseStats, Realm, Resident,
    ResidentOrder, Stat, StatRecord, Stock, Tile, WorkOrder, WorldState,
};

use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::world::create_world;

/// An open map of Plains, `size` tiles along each side (`plains`).
pub fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// The map `world_with_city` is on: Plains, with a row of Forest, Hills and Mountain tiles at
/// (`HARD_TERRAIN_X` + i, `HARD_TERRAIN_Y`), well away from the city.
pub fn city_terrain() -> TerrainMap {
    let mut t = plains(CITY_MAP_SIZE);
    for (i, terrain) in [Terrain::Forest, Terrain::Hills, Terrain::Mountain].iter().enumerate() {
        let x = HARD_TERRAIN_X + i as i32;
        t.tiles[tile_index(CITY_MAP_SIZE, x, HARD_TERRAIN_Y)] = *terrain as u8;
    }
    t
}

/// The side of `city_terrain`'s map.
pub const CITY_MAP_SIZE: i32 = 256;
/// Where `city_terrain`'s row of hard terrain starts.
pub const HARD_TERRAIN_X: i32 = 150;
/// The row of `city_terrain`'s hard terrain.
pub const HARD_TERRAIN_Y: i32 = 150;

/// A resident of nobody, idle at (0, 0) with base stats of 10, for tests.
pub fn resident(id: &str) -> Resident {
    let mut m = Mulberry32::new(1.0);
    let fields = NewResident { id, owner: None, city_id: None, x: 0.0, y: 0.0, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    let stat = Stat { base: 10.0, trained: 0.0 };
    r.stats = StatRecord {
        strength: stat.clone(),
        endurance: stat.clone(),
        agility: stat.clone(),
        intellect: stat,
    };
    r
}

/// Adds a city with its town hall at (x, y) to a test world (`addCity`); the town hall's id is
/// `{id}-hall`.
pub fn add_city(world: &mut WorldState, id: &str, realm_id: Option<&str>, x: f64, y: f64) {
    let hall = building(&format!("{id}-hall"), BuildingKind::TownHall, Some(id), x, y);
    world.buildings.push(hall);
    world.cities.push(City {
        id: id.into(),
        name: "Ashford".into(),
        game_name: None,
        realm_id: realm_id.map(str::to_string),
        town_hall_id: format!("{id}-hall"),
        trade_org: None,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        layout: realm_id.is_none().then_some(csp_shared::world::CityLayout::Grid),
    });
}

/// A finished building of a city.
pub fn building(id: &str, kind: BuildingKind, city_id: Option<&str>, x: f64, y: f64) -> Building {
    Building {
        id: id.into(),
        kind,
        city_id: city_id.map(str::to_string),
        realm_id: None,
        x,
        y,
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    }
}

/// A fresh world on `city_terrain` where Player 1 has founded their starting city
/// (`worldWithCity`); see the module's doc for how it differs from the TypeScript's.
pub fn world_with_city() -> (WorldState, TerrainMap) {
    let terrain = city_terrain();
    let mut world = create_world(&terrain, 1);
    let user_id = 1;
    let mut rand = Mulberry32::new((world.seed * 7919 + user_id) as f64);
    let (x, y) = (10.0, 10.0);
    let size = START_CITY_SIZE;
    let mid = (size / 2.0).floor();
    let realm_id = new_id("realm", &mut world.next_id);
    let city_id = new_id("city", &mut world.next_id);
    // The city's name (`CITY_NAMES`, T86.8) is drawn here.
    rand.next();
    let b = |world: &mut WorldState, kind, bx, by| {
        let id = new_id("b", &mut world.next_id);
        building(&id, kind, Some(&city_id), bx, by)
    };
    let hall = b(&mut world, BuildingKind::TownHall, x + mid - 1.0, y + mid + 2.0 + 1.0);
    let mut storage = b(&mut world, BuildingKind::Storage, x + mid, y + mid);
    storage.stock = Some(Stock::from([(Good::Food, START_FOOD)]));
    let mut buildings = vec![hall.clone(), storage];
    let houses = (START_RESIDENTS / 4.0).ceil() + START_SPARE_HOUSES;
    let row = y + 2f64.max(mid - CITY_BUILDING_REACH);
    for i in 0..houses as i32 {
        let house = b(&mut world, BuildingKind::House, x + 2.0 + f64::from(i) * 3.0, row);
        buildings.push(house);
    }
    let gate = (x + mid, y + size - 1.0);
    let mut ring = Vec::new();
    for i in 0..size as i32 {
        let i = f64::from(i);
        for t in [(x + i, y), (x + i, y + size - 1.0), (x, y + i), (x + size - 1.0, y + i)] {
            if !ring.contains(&t) {
                ring.push(t);
            }
        }
    }
    for (wx, wy) in ring {
        let kind = if (wx, wy) == gate { BuildingKind::Gate } else { BuildingKind::Wall };
        buildings.push(b(&mut world, kind, wx, wy));
    }
    // Outside the wall, by the gate, the farm and the stable beside it.
    let (fx, fy) = (gate.0 + 1.0, gate.1 + 5.0);
    let (sx, sy) = (gate.0 - 3.0, gate.1 + 5.0);
    let farm = b(&mut world, BuildingKind::Farm, fx, fy);
    let mut stable = b(&mut world, BuildingKind::Stable, sx, sy);
    stable.stock = Some(Stock::from([(Good::Food, START_STABLE_FOOD)]));
    let farm_id = farm.id.clone();
    buildings.push(farm);
    buildings.push(stable);

    let mut taken = HashSet::new();
    let residents: Vec<Resident> = (0..START_RESIDENTS as usize)
        .map(|_| {
            let id = new_id("r", &mut world.next_id);
            let fields = NewResident {
                id: &id,
                owner: Some(&realm_id),
                city_id: Some(&city_id),
                x: fx,
                y: fy,
                tick: world.tick as f64,
            };
            let mut r = new_resident(&mut || rand.next(), &fields, Some(&mut taken));
            r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
            r.order = Some(ResidentOrder::WorkAt(WorkOrder {
                building_id: farm_id.clone(),
                at: Tile { x: fx, y: fy },
                progress: 0.0,
                makes: None,
            }));
            r
        })
        .collect();
    world.realms.push(Realm {
        id: realm_id.clone(),
        user_id: user_id as u64,
        leader_id: residents[0].id.clone(),
        name: None,
        demands_sent_at: None,
    });
    world.cities.push(City {
        id: city_id.clone(),
        name: "Ashford".into(),
        game_name: Some(true),
        realm_id: Some(realm_id.clone()),
        town_hall_id: hall.id.clone(),
        trade_org: None,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        layout: None,
    });
    world.buildings.extend(buildings);
    world.residents.extend(residents);
    for i in 0..START_HORSES as usize {
        let id = new_id("horse", &mut world.next_id);
        world.horses.push(Horse {
            id,
            name: format!("Horse {i}"),
            realm_id: Some(realm_id.clone()),
            city_id: None,
            x: sx,
            y: sy,
            hunger: MAX_HUNGER,
            health: MAX_HEALTH,
            stats: HorseStats { speed: 10.0, strength: 10.0, endurance: 10.0 },
            born_at: -1_000_000.0,
            down_until: None,
        });
    }
    let horse_id = world.horses.last().map(|h| h.id.clone());
    let id = new_id("carriage", &mut world.next_id);
    world.carriages.push(Carriage {
        id,
        realm_id: Some(realm_id),
        city_id: None,
        x: sx,
        y: sy,
        horse_id,
        load: Stock::new(),
    });
    (world, terrain)
}

/// A JSON value with every number as an `f64`, so a Rust `1.0` and a TypeScript `1` compare equal.
pub fn as_numbers(v: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Number(n) => n.as_f64().map_or(Value::Null, |f| serde_json::json!(f)),
        Value::Array(a) => Value::Array(a.iter().map(as_numbers).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), as_numbers(v))).collect())
        }
        other => other.clone(),
    }
}

/// Whether a Rust value serialises to what the TypeScript wrote, numbers compared as `f64`.
pub fn same_json<T: serde::Serialize>(rust: &T, typescript: &serde_json::Value) -> bool {
    as_numbers(&serde_json::to_value(rust).expect("serialisable")) == as_numbers(typescript)
}
