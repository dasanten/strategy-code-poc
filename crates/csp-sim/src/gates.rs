//! The gate order (`apps/server/src/gates.ts`, `CONTEXT.md`: Walls in combat): a city's realm
//! opens or closes one of its gates, at the start of the next tick like an alliance's decision.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, OrderRequest, WorldState};

use crate::movement_pending::{bool_field, realm_of, str_field, OrderKind, OrderSender};

/// Where in `world.buildings` the finished gate `gate_id` of one of the sender's cities stands, or
/// why there is none (`ownGate`).
fn own_gate(
    world: &WorldState,
    sender: &OrderSender,
    gate_id: Option<&str>,
) -> Result<usize, &'static str> {
    let realm = realm_of(world, sender.user_id);
    let i = world
        .buildings
        .iter()
        .position(|b| Some(b.id.as_str()) == gate_id)
        .filter(|&i| world.buildings[i].kind == BuildingKind::Gate)
        .ok_or("no such gate")?;
    let gate = &world.buildings[i];
    if gate.site.is_some() {
        return Err("that gate is not finished yet");
    }
    let city = world.cities.iter().find(|c| Some(&c.id) == gate.city_id.as_ref());
    match (realm, city) {
        (Some(realm), Some(city)) if city.realm_id.as_deref() == Some(realm.id.as_str()) => Ok(i),
        _ => Err("not a gate of your cities"),
    }
}

/// The gate order (`setGate`).
pub struct SetGate;

impl OrderKind for SetGate {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        if bool_field(order, "open").is_none() {
            return Some("say whether the gate should be open".into());
        }
        own_gate(world, sender, str_field(order, "gateId")).err().map(str::to_string)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Ok(i) = own_gate(world, sender, str_field(order, "gateId")) else { return };
        let gate = &mut world.buildings[i];
        // `open` is checked when the order comes; `if (open)` treats anything else as closing.
        gate.closed = if bool_field(order, "open") == Some(true) { None } else { Some(true) };
    }
}

#[cfg(test)]
mod tests;
