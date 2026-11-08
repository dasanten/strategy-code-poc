//! Test helpers for movement's tests (T86.4): small maps drawn as text, and residents, horses,
//! carriages and buildings as the TypeScript tests build them.
//!
//! `resident` stands in for `newResident(mulberry32(1), ...)` (T86.3): every stat 10 and just
//! grown up, so nothing hangs on its draws. The TypeScript tests read their expectations from the
//! resident they made (`walkSpeed(r, ...)`), so the ported ones do too.

use csp_shared::balance::{
    ADULT_AGE, AVERAGE_HORSE_STATS, CHILD_YEAR_DAYS, MAX_HEALTH, MAX_HUNGER,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Carriage, Horse, HorseStats, RealmEvent, Resident, Stat, StatRecord,
    WorldState,
};

use crate::world::create_world;

/// A square map drawn as text (sides join): `.` plains, `f` forest, `h` hills, `^` mountain,
/// `~` lake.
pub fn draw(rows: &[&str]) -> TerrainMap {
    let tiles = rows
        .iter()
        .flat_map(|r| r.chars())
        .map(|c| match c {
            '.' => Terrain::Plains as u8,
            'f' => Terrain::Forest as u8,
            'h' => Terrain::Hills as u8,
            '^' => Terrain::Mountain as u8,
            '~' => Terrain::Lake as u8,
            other => panic!("no terrain drawn as {other:?}"),
        })
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

/// Plains all over, `size` tiles a side.
pub fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// A world on `terrain` with no resource nodes, and realm `r1` of Player 7 with Leader `w1`.
pub fn world_with_realm(terrain: &TerrainMap) -> WorldState {
    let mut world = create_world(terrain, 1);
    world.nodes.clear();
    world.realms.push(
        serde_json::from_value(serde_json::json!({"id": "r1", "userId": 7, "leaderId": "w1"}))
            .expect("a realm"),
    );
    world
}

/// A grown resident of `owner` at (x, y), every stat 10.
pub fn resident(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let stat = || Stat { base: 10.0, trained: 0.0 };
    let mut r: Resident = serde_json::from_value(serde_json::json!({
        "id": id, "name": format!("Name of {id}"), "owner": owner, "cityId": null, "x": x, "y": y,
        "stats": {"strength": {"base": 10, "trained": 0}, "endurance": {"base": 10, "trained": 0},
                  "agility": {"base": 10, "trained": 0}, "intellect": {"base": 10, "trained": 0}},
        "skills": {}, "health": MAX_HEALTH, "hunger": MAX_HUNGER, "bornAt": 0, "lifespan": 1e12,
        "carried": {}, "order": null
    }))
    .expect("a resident");
    r.stats =
        StatRecord { strength: stat(), endurance: stat(), agility: stat(), intellect: stat() };
    r.born_at = -ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    r
}

/// A horse of average stats called Rowan, born at tick 0, with full hunger and health.
pub fn horse(id: &str, realm_id: Option<&str>, x: f64, y: f64) -> Horse {
    Horse {
        id: id.to_string(),
        name: "Rowan".to_string(),
        realm_id: realm_id.map(str::to_string),
        city_id: None,
        x,
        y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        },
        born_at: 0.0,
        down_until: None,
    }
}

/// An empty carriage of `realm_id` at (x, y).
pub fn carriage(
    id: &str,
    realm_id: Option<&str>,
    x: f64,
    y: f64,
    horse_id: Option<&str>,
) -> Carriage {
    Carriage {
        id: id.to_string(),
        realm_id: realm_id.map(str::to_string),
        city_id: None,
        x,
        y,
        horse_id: horse_id.map(str::to_string),
        load: Default::default(),
    }
}

/// A finished building of no city at (x, y).
pub fn building(id: &str, kind: BuildingKind, x: f64, y: f64) -> Building {
    let mut b: Building = serde_json::from_value(
        serde_json::json!({"id": id, "kind": "road", "cityId": null, "x": x, "y": y}),
    )
    .expect("a building");
    b.kind = kind;
    b
}

/// The events in a Player's realm log (`eventsFor`).
pub fn events_for(world: &WorldState, user_id: u64) -> Vec<&RealmEvent> {
    world.events.iter().filter(|e| e.user_id == user_id).collect()
}

/// Movement's order kinds by name, the ones in `GETS_OFF_FIRST` getting a passenger off first, as
/// `orderKinds` registers them (T86.2 keeps the real registry).
fn order_kind(name: &str) -> Box<dyn crate::movement_pending::OrderKind> {
    use crate::passengers::GetsOffFirst;
    match name {
        "walkTo" => Box::new(GetsOffFirst(crate::walking::WalkTo)),
        "drive" => Box::new(GetsOffFirst(crate::driving::Drive)),
        "hitch" => Box::new(GetsOffFirst(crate::driving::Hitch)),
        "unhitch" => Box::new(GetsOffFirst(crate::driving::Unhitch)),
        "mount" => Box::new(GetsOffFirst(crate::riding::Mount)),
        "dismount" => Box::new(crate::riding::Dismount),
        "climb" => Box::new(GetsOffFirst(crate::climbing::Climb)),
        "setGate" => Box::new(crate::gates::SetGate),
        "board" => Box::new(crate::passengers::Board),
        "getOff" => Box::new(crate::passengers::GetOff),
        "claimHorses" => Box::new(crate::horse_grant::ClaimHorses),
        other => panic!("no order kind {other:?} in movement's tests"),
    }
}

/// Sends an order of Player 7's and applies it as the next tick would (`OrderQueue.receive`, then
/// `applyAll`): `Ok(())` for an ack, `Err(reason)` when it is rejected.
pub fn order(world: &mut WorldState, map: &TerrainMap, o: serde_json::Value) -> Result<(), String> {
    order_from(world, map, 7, o)
}

/// `order` from the Player with account `user_id`.
pub fn order_from(
    world: &mut WorldState,
    map: &TerrainMap,
    user_id: u64,
    o: serde_json::Value,
) -> Result<(), String> {
    let o: csp_shared::world::OrderRequest = serde_json::from_value(o).expect("an order");
    let kind = order_kind(&o.kind);
    let sender = crate::movement_pending::OrderSender { user_id, npc_city_id: None };
    if let Some(reason) = kind.validate(world, &sender, &o, Some(map)) {
        return Err(reason);
    }
    kind.apply(world, &sender, &o, Some(map));
    Ok(())
}

/// Steps the world with `walking` until resident `id`'s order is done or `max` ticks pass;
/// returns the ticks (`walkOut`).
pub fn walk_out(
    world: &mut WorldState,
    map: &TerrainMap,
    walking: &mut crate::walking::Walking,
    id: &str,
    max: u32,
) -> u32 {
    let mut scratch = crate::tick::Scratch::default();
    let mut t = 0;
    while t < max && world.residents.iter().find(|r| r.id == id).is_some_and(|r| r.order.is_some())
    {
        crate::world::step_world(world, map, &mut scratch, Some(walking), None);
        t += 1;
    }
    t
}

/// A resident walking to (x, y) (`walkTo` in the tests).
pub fn walk_to(r: &mut Resident, x: f64, y: f64) {
    use csp_shared::world::{ResidentOrder, Tile, WalkOrder};
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

/// Adds a Player city `id` of `realm_id` with its town hall `<id>-hall` at (x, y) (`addCity`).
// TODO(T86.8): the test helper that comes with starting cities.
pub fn add_city(world: &mut WorldState, id: &str, realm_id: Option<&str>, x: f64, y: f64) {
    let mut hall = building(&format!("{id}-hall"), BuildingKind::TownHall, x, y);
    hall.city_id = Some(id.to_string());
    world.buildings.push(hall);
    let city = serde_json::json!({
        "id": id, "name": "Ashford", "realmId": realm_id, "townHallId": format!("{id}-hall"), "occupation": null
    });
    world.cities.push(serde_json::from_value(city).expect("a city"));
}

/// A realm `id` of Player `user_id` with Leader `leader_id`.
pub fn realm(id: &str, user_id: u64, leader_id: &str) -> csp_shared::world::Realm {
    serde_json::from_value(serde_json::json!({"id": id, "userId": user_id, "leaderId": leader_id}))
        .expect("a realm")
}
