//! The game's rules for the client, as WebAssembly (ADR 0045, Epic 122): `csp-sim`'s own
//! functions, called from the browser instead of a TypeScript copy of them.
//!
//! Rules that read the world are methods of [`WorldMirror`], called with ids and coordinates, never with the world: the mirror
//! (`csp_sim::mirror::SightMirror`) is what one Player sees, as a `WorldState`, fed the server's
//! `welcome` message once and each `tick` message after it (T122.4). The rules that take only values are in `value_rules`.

use csp_shared::protocol::SeenEntity;
use csp_sim::mirror::SightMirror;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::value::RawValue;
use wasm_bindgen::prelude::wasm_bindgen;

/// What the mirror reads of the server's `welcome` message.
#[derive(Deserialize)]
struct Welcome<'a> {
    map: MapSize,
    tick: u64,
    #[serde(borrow)]
    entities: Vec<&'a RawValue>,
}

#[derive(Deserialize)]
struct MapSize {
    size: i32,
}

/// What the mirror reads of a `tick` message: what came into sight or changed, what left it.
#[derive(Deserialize)]
struct Tick<'a> {
    tick: u64,
    #[serde(borrow)]
    changed: Vec<&'a RawValue>,
    gone: Vec<String>,
}

/// What the Player sees, as a world in the module's memory (`SightMirror`).
#[wasm_bindgen]
#[derive(Default)]
pub struct WorldMirror {
    mirror: SightMirror,
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
        self.mirror.welcome(msg.map.size, msg.tick, seen_entities(msg.entities)?);
        Ok(())
    }

    /// Takes in a `tick` message, as JSON. An error for one it can't read, which changes nothing.
    pub fn tick(&mut self, json: &str) -> Result<(), String> {
        let msg: Tick = serde_json::from_str(json).map_err(|e| e.to_string())?;
        // Every tick, changed or not: the world is at the server's tick.
        self.mirror.tick(msg.tick, seen_entities(msg.changed)?, &msg.gone);
        Ok(())
    }

    /// How many things are in sight.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.mirror.count()
    }

    /// The id of the building or construction site in sight whose footprint covers (x, y)
    /// (`buildingAt`).
    #[wasm_bindgen(js_name = buildingAt)]
    pub fn building_at(&self, x: i32, y: i32) -> Option<String> {
        let world = self.mirror.world();
        csp_sim::queries::building::building_at(world, x, y, self.mirror.size())
            .map(|b| b.id.clone())
    }
}

/// What is in sight, each read on its own.
fn seen_entities(list: Vec<&RawValue>) -> Result<Vec<SeenEntity>, String> {
    list.into_iter().map(|raw| seen_entity_raw(raw.get())).collect()
}

/// Something in sight from its JSON text. The server writes its `is` first (`{"is":"resident",`):
/// the rest reads straight into its kind's type, the quick way a tick's hundreds of residents need.
// The server always does.
fn seen_entity_raw(text: &str) -> Result<SeenEntity, String> {
    fn rest<T: DeserializeOwned>(is: &str, text: &str) -> Result<T, String> {
        serde_json::from_str(text).map_err(|e| format!("{is}: {e}"))
    }
    let Some(after) = text.strip_prefix("{\"is\":\"") else {
        return Err("something in sight that doesn't start with its `is`".into());
    };
    let Some((is, tail)) = after.split_once('"') else {
        return Err("something in sight without its `is`".into());
    };
    let body = match tail.strip_prefix(',') {
        Some(fields) => format!("{{{fields}"),
        None => "{}".to_string(),
    };
    Ok(match is {
        "resident" => SeenEntity::Resident(Box::new(rest(is, &body)?)),
        "building" => SeenEntity::Building(Box::new(rest(is, &body)?)),
        "city" => SeenEntity::City(Box::new(rest(is, &body)?)),
        "horse" => SeenEntity::Horse(rest(is, &body)?),
        "carriage" => SeenEntity::Carriage(rest(is, &body)?),
        "pile" => SeenEntity::Pile(rest(is, &body)?),
        "army" => SeenEntity::Army(rest(is, &body)?),
        "caravan" => SeenEntity::Caravan(rest(is, &body)?),
        "trader" => SeenEntity::Trader(rest(is, &body)?),
        "vessel" => SeenEntity::Vessel(rest(is, &body)?),
        "machine" => SeenEntity::Machine(rest(is, &body)?),
        "patch" => SeenEntity::Patch(rest(is, &body)?),
        _ => return Err(format!("something in sight of no kind the mirror knows: {is}")),
    })
}
