//! The game's rules for the client, as WebAssembly (ADR 0045, T122.1): `csp-sim`'s own functions,
//! called from the browser instead of a TypeScript copy of them.
//!
//! The first slice: one rule that needs no world ([`building_work`]), and a first, throwaway
//! mirror of what the client sees ([`WorldMirror`]): the server's `welcome` message and each `tick`
//! message go into it once, and a rule that reads the world ([`WorldMirror::building_at`]) is
//! called with coordinates, never with the world. T122.4 replaces the mirror with the real one.

use std::collections::HashMap;

use csp_shared::protocol::SeenBuilding;
use csp_shared::world::{Building, BuildingKind, WorldState};
use serde::Deserialize;
use wasm_bindgen::prelude::wasm_bindgen;

/// Work a building of `kind` takes in ticks of one unskilled resident of average Strength, over
/// the terrain `under` where known (`buildingWork`). NaN for a kind that isn't one.
#[wasm_bindgen(js_name = buildingWork)]
pub fn building_work(kind: &str, under: Option<u8>) -> f64 {
    match serde_json::from_value::<BuildingKind>(serde_json::Value::String(kind.into())) {
        Ok(kind) => csp_sim::queries::building::building_work(kind, under),
        Err(_) => f64::NAN,
    }
}

/// What the mirror keeps of something in sight: a building whole, of anything else only its id. Only
/// the buildings' fields are read, so only theirs cost code in the module.
#[derive(Deserialize)]
#[serde(tag = "is", rename_all = "camelCase")]
enum Seen {
    Building(Box<SeenBuilding>),
    #[serde(other)]
    Other,
}

/// What the mirror reads of the server's `welcome` message.
#[derive(Deserialize)]
struct Welcome {
    map: MapSize,
    entities: Vec<Seen>,
}

#[derive(Deserialize)]
struct MapSize {
    size: i32,
}

/// What the mirror reads of a `tick` message: what came into sight or changed, what left it.
#[derive(Deserialize)]
struct Tick {
    changed: Vec<Seen>,
    gone: Vec<String>,
}

/// What the client sees, mirrored in the module's memory: updated once a tick from the server's
/// messages, read by the rules (throwaway, T122.1: only the buildings in sight). The buildings stay
/// in place in `world.buildings`, each found by id, so a tick costs what it changed.
#[wasm_bindgen]
#[derive(Default)]
pub struct WorldMirror {
    size: i32,
    /// Where each building in sight stands in `world.buildings`.
    at: HashMap<String, usize>,
    world: WorldState,
}

#[wasm_bindgen]
impl WorldMirror {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WorldMirror {
        WorldMirror::default()
    }

    /// Starts over from a `welcome` message, as JSON. An error for one it can't read.
    pub fn welcome(&mut self, json: &str) -> Result<(), String> {
        let msg: Welcome = serde_json::from_str(json).map_err(|e| e.to_string())?;
        self.size = msg.map.size;
        self.at.clear();
        self.world.buildings.clear();
        for b in msg.entities.into_iter().filter_map(building) {
            self.put(b);
        }
        self.changed();
        Ok(())
    }

    /// Takes in a `tick` message, as JSON. An error for one it can't read, which changes nothing.
    pub fn tick(&mut self, json: &str) -> Result<(), String> {
        let msg: Tick = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if msg.changed.is_empty() && msg.gone.is_empty() {
            return Ok(());
        }
        for b in msg.changed.into_iter().filter_map(building) {
            self.put(b);
        }
        for id in &msg.gone {
            self.remove(id);
        }
        self.changed();
        Ok(())
    }

    /// How many buildings are in sight.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.world.buildings.len()
    }

    /// The id of the building or construction site in sight whose footprint covers (x, y)
    /// (`buildingAt`).
    #[wasm_bindgen(js_name = buildingAt)]
    pub fn building_at(&self, x: i32, y: i32) -> Option<String> {
        csp_sim::queries::building::building_at(&self.world, x, y, self.size).map(|b| b.id.clone())
    }
}

impl WorldMirror {
    /// A building in sight, new or changed.
    fn put(&mut self, b: Building) {
        match self.at.get(&b.id) {
            Some(&i) => self.world.buildings[i] = b,
            None => {
                self.at.insert(b.id.clone(), self.world.buildings.len());
                self.world.buildings.push(b);
            }
        }
    }

    /// A building that left sight: the last one takes its place.
    fn remove(&mut self, id: &str) {
        let Some(i) = self.at.remove(id) else { return };
        self.world.buildings.swap_remove(i);
        if let Some(moved) = self.world.buildings.get(i) {
            self.at.insert(moved.id.clone(), i);
        }
    }

    /// The buildings changed: the lookups the rules keep by tile are built again on their next use
    /// (`world_index`'s stamp has the tick in it).
    fn changed(&mut self) {
        self.world.tick += 1;
    }
}

/// The building, of a building in sight.
fn building(e: Seen) -> Option<Building> {
    match e {
        Seen::Building(b) => Some(b.building),
        Seen::Other => None,
    }
}
