//! Test helpers for the rule tests (`apps/server/src/test-terrain.ts`): small worlds built by
//! hand, and `world_with_city` as the TypeScript builds it (`foundStartingCity` on `cityTerrain`).

use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Building, BuildingKind, City, Resident, Stat, StatRecord, WorldState};

use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};

/// An open map of Plains, `size` tiles along each side (`plains`).
pub fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

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
        outweighed: None,
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

/// A fresh world on `cityTerrain` where Player 1 has founded their starting city
/// (`worldWithCity`), with its terrain.
pub fn world_with_city() -> (WorldState, TerrainMap) {
    (crate::test_world::world_with_city(), crate::test_world::city_terrain().clone())
}

/// A generated world on `cityTerrain` where Player 1 has founded their starting city
/// (`worldWithPost`), with its terrain. The world is generated once and cloned for each test.
pub fn world_with_post() -> (WorldState, TerrainMap) {
    static WORLD: std::sync::OnceLock<WorldState> = std::sync::OnceLock::new();
    let terrain = crate::test_world::city_terrain();
    let world = WORLD.get_or_init(|| {
        let mut world = crate::world::generate_world(terrain, 1);
        crate::starting_city::found_starting_city(&mut world, terrain, 1, None);
        world
    });
    (world.clone(), terrain.clone())
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
