//! Test helpers for the realm-level rules' tests (T86.11). The TypeScript tests found starting
//! cities on a generated map (`foundStartingCity`, T86.8); these build the same shapes by hand:
//! realms `realm<n>` of Player `<n>` with a Leader `leader<n>`, cities with a town hall, and orders
//! sent and applied as `OrderQueue.receive` and `applyAll` would (T86.2).

use csp_shared::balance::{ADULT_AGE, CHILD_YEAR_DAYS, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, OrderRequest, Realm, Resident, WorldState};
use serde_json::{json, Value};

use crate::order_sender::OrderSender;
use crate::orders::OrderKind;
use crate::world::create_world;

/// Plains all over, `size` tiles a side.
pub fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// A grown resident of `owner` at (x, y), every stat 10, named `Name of <id>`.
pub fn resident(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let mut r: Resident = serde_json::from_value(json!({
        "id": id, "name": format!("Name of {id}"), "owner": owner, "cityId": null, "x": x, "y": y,
        "stats": {"strength": {"base": 10, "trained": 0}, "endurance": {"base": 10, "trained": 0},
                  "agility": {"base": 10, "trained": 0}, "intellect": {"base": 10, "trained": 0}},
        "skills": {}, "health": MAX_HEALTH, "hunger": MAX_HUNGER, "bornAt": 0, "lifespan": 1e12,
        "carried": {}, "order": null
    }))
    .expect("a resident");
    r.born_at = -ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    r
}

/// A realm of Player `user_id`: `realm<user_id>`, led by `leader<user_id>`.
pub fn realm_id(user_id: u64) -> String {
    format!("realm{user_id}")
}

/// A world on `terrain` without resource nodes, with a realm and its Leader for each Player in
/// `users`, the Leaders standing at (10 × n, 10 × n).
pub fn world_with_realms(terrain: &TerrainMap, users: &[u64]) -> WorldState {
    let mut world = create_world(terrain, 1);
    world.nodes.clear();
    for &u in users {
        let realm: Realm = serde_json::from_value(
            json!({"id": realm_id(u), "userId": u, "leaderId": format!("leader{u}")}),
        )
        .expect("a realm");
        world.realms.push(realm);
        let at = 10.0 * u as f64;
        world.residents.push(resident(&format!("leader{u}"), Some(&realm_id(u)), at, at));
    }
    world
}

/// A finished building of `city_id` at (x, y).
pub fn building(id: &str, kind: BuildingKind, city_id: Option<&str>, x: f64, y: f64) -> Building {
    let mut b: Building = serde_json::from_value(
        json!({"id": id, "kind": "road", "cityId": city_id, "x": x, "y": y}),
    )
    .expect("a building");
    b.kind = kind;
    b
}

/// Adds a city `id` of `realm_id` (None: an NPC city) with its town hall `<id>-hall` at (x, y)
/// (`addCity`); an NPC city gets the grid layout, as `addCity` gives it.
pub fn add_city(
    world: &mut WorldState,
    id: &str,
    realm_id: Option<&str>,
    x: f64,
    y: f64,
    name: &str,
) {
    world.buildings.push(building(&format!("{id}-hall"), BuildingKind::TownHall, Some(id), x, y));
    let mut city = json!({"id": id, "name": name, "realmId": realm_id, "townHallId": format!("{id}-hall"), "occupation": null});
    if realm_id.is_none() {
        city["layout"] = json!("grid");
    }
    world.cities.push(serde_json::from_value(city).expect("a city"));
}

/// Sends the order of Player `user_id` and applies it, as the next tick would: `Ok(())` for an
/// ack, `Err(reason)` when refused. `kind` handles it.
pub fn send(
    world: &mut WorldState,
    terrain: &TerrainMap,
    kind: &dyn OrderKind,
    user_id: u64,
    o: Value,
) -> Result<(), String> {
    let o: OrderRequest = serde_json::from_value(o).expect("an order");
    let sender = OrderSender::player(user_id, "Player");
    if let Some(reason) = kind.validate(world, &sender, &o, Some(terrain)) {
        return Err(reason);
    }
    kind.apply(world, &sender, &o, Some(terrain));
    Ok(())
}
