//! What the building, work and training tests share (T86.6): a small Plains map, a resident
//! builder, and the game's `OrderQueue` (receive checks, the next tick applies).

#![allow(dead_code)]

use csp_shared::balance::ticks_for_age;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, ConstructionSite, Realm, Resident, Stat, StatRecord, Stock, WorldState,
};
use std::sync::Arc;

use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};

/// A Plains map `size` across.
pub fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// A Player's sender (`{ userId, account }`).
pub fn player(user_id: u64) -> OrderSender {
    OrderSender::player(user_id, "Mara")
}

/// A realm.
pub fn realm(id: &str, user_id: u64, leader: &str) -> Realm {
    serde_json::from_value(json!({ "id": id, "userId": user_id, "leaderId": leader })).unwrap()
}

/// A grown resident of `owner` on (x, y), every stat 10, thirty years old at tick 0, fed and well
/// (`newResident` with the stats the tests set).
pub fn new_resident(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    let stat = || Stat { base: 10.0, trained: 0.0 };
    Resident {
        id: id.into(),
        name: format!("Name {id}"),
        game_name: None,
        owner: owner.map(str::to_string),
        city_id: None,
        x,
        y,
        stats: StatRecord {
            strength: stat(),
            endurance: stat(),
            agility: stat(),
            intellect: stat(),
        },
        skills: Default::default(),
        health: 100.0,
        hunger: 100.0,
        born_at: -ticks_for_age(30.0).round(),
        lifespan: 60.0,
        carried: Stock::new(),
        order: None,
        order_ended: None,
        struck: None,
        script: None,
        interrupted: None,
        given_under_attack: None,
        defence_script_id: None,
        alarm_script_id: None,
        script_params: None,
        script_log: None,
        queue: None,
        pair: None,
        carrying: None,
        riding: None,
        aboard: None,
        down_until: None,
    }
}

/// Pushes a resident of realm r1 and returns its index.
pub fn resident(world: &mut WorldState, id: &str, x: f64, y: f64) -> usize {
    world.residents.push(new_resident(id, Some("r1"), x, y));
    world.residents.len() - 1
}

/// The resident with this id.
pub fn at<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

/// A building, finished.
pub fn building(id: &str, kind: BuildingKind, x: f64, y: f64) -> Building {
    Building {
        id: id.into(),
        kind,
        city_id: None,
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

/// A construction site.
pub fn site(id: &str, kind: BuildingKind, x: f64, y: f64) -> Building {
    Building {
        site: Some(ConstructionSite { delivered: Stock::new(), work: 0.0 }),
        ..building(id, kind, x, y)
    }
}

/// A new, empty world on `terrain`, with no nodes.
pub fn empty_world(terrain: &TerrainMap) -> WorldState {
    let mut world = create_world(terrain, 1);
    world.nodes.clear();
    world
}

/// The answer to an order (`{ type: 'ack' }` or `{ type: 'rejected', reason }`).
pub type Answer = Result<(), String>;

/// The game's own `OrderQueue`, made on the first order with the map the tests give it: orders
/// received wait for the next tick, which applies them.
#[derive(Default)]
pub struct Orders {
    queue: Option<OrderQueue>,
}

impl Orders {
    fn queue(&mut self, terrain: &TerrainMap) -> &mut OrderQueue {
        self.queue
            .get_or_insert_with(|| OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone()))))
    }

    /// Checks an order; an accepted one waits for `apply_all` (`receive`).
    pub fn receive(
        &mut self,
        world: &WorldState,
        sender: &OrderSender,
        order: Value,
        terrain: &TerrainMap,
    ) -> Answer {
        match self.queue(terrain).receive(world, sender, &json!("q"), &order) {
            OrderReply::Ack { .. } => Ok(()),
            OrderReply::Rejected { reason, .. } => Err(reason),
        }
    }

    /// Applies every waiting order, in the order received (`applyAll`).
    pub fn apply_all(&mut self, world: &mut WorldState, terrain: &TerrainMap) {
        self.queue(terrain).apply_all(world);
    }

    /// How many orders wait (`size`).
    pub fn len(&self) -> usize {
        self.queue.as_ref().map_or(0, OrderQueue::len)
    }
}

/// Steps the world, keeping residents fed so long builds don't starve them.
pub fn run(world: &mut WorldState, terrain: &TerrainMap, ticks: usize) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, terrain, &mut scratch, None, None);
    }
}

/// Every world invariant holds (`expect(checkInvariants(world, terrain)).toEqual([])`).
#[track_caller]
pub fn assert_sound(world: &WorldState, terrain: &TerrainMap) {
    let broken: Vec<String> = check_all(world, terrain)
        .iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert!(broken.is_empty(), "invariants broken at tick {}: {broken:?}", world.tick);
}

/// Steps the world, fed and walking, until `done` or `max` ticks; every invariant holds after
/// each tick (`run` of the walking tests).
#[track_caller]
pub fn run_walking(
    world: &mut WorldState,
    terrain: &TerrainMap,
    max: usize,
    mut done: impl FnMut(&WorldState) -> bool,
) {
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    for _ in 0..max {
        if done(world) {
            break;
        }
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
        assert_sound(world, terrain);
    }
}

/// Sends an order, and if accepted runs the tick that starts it.
pub fn order(
    world: &mut WorldState,
    orders: &mut Orders,
    sender: &OrderSender,
    o: Value,
    terrain: &TerrainMap,
) -> Answer {
    let answer = orders.receive(world, sender, o, terrain);
    orders.apply_all(world, terrain);
    run(world, terrain, 1);
    answer
}

/// The first construction site in the world.
pub fn site_of(world: &WorldState) -> Option<&Building> {
    world.buildings.iter().find(|b| b.site.is_some())
}

/// Asserts two numbers agree to two decimals, as `toBeCloseTo`.
#[track_caller]
pub fn close(got: f64, want: f64) {
    assert!((got - want).abs() < 0.005, "{got} is not close to {want}");
}

/// Adds a city with its town hall on (x, y) (`addCity` of `test-terrain.ts`).
pub fn add_city(world: &mut WorldState, id: &str, realm_id: Option<&str>, x: f64, y: f64) {
    let mut hall = building(&format!("{id}-hall"), BuildingKind::TownHall, x, y);
    hall.city_id = Some(id.into());
    let mut city = json!({
        "id": id, "name": "Ashford", "realmId": realm_id, "townHallId": hall.id, "occupation": null
    });
    if realm_id.is_none() {
        city["layout"] = json!("grid");
    }
    world.buildings.push(hall);
    world.cities.push(serde_json::from_value(city).unwrap());
}
