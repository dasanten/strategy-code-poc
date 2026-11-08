//! What the cities the game runs do each tick (`apps/server/src/npc-behaviour.ts`, `CONTEXT.md`:
//! NPC city): they only give their residents orders, which request actions like a Player's orders
//! do (ADR 0002); the world resolves them later in the tick.
//!
//! Residents are referred to by their place in `world.residents`: a city's tick neither adds nor
//! removes anyone, so the places hold through it. A city's plan stays in `world.city_plans`, where
//! the TypeScript keeps it, and is looked up by the city's id.

use csp_shared::balance::{OWN_FOOD, WORK_OUTPUT_PER_DAY};
use csp_shared::goods::put_away_units;
use csp_shared::world::{
    Building, BuildingKind, CityJob, Good, Resident, ResidentOrder, RunningScript, Stock, Task,
    Tile, WalkOrder, WorldState,
};
use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::queries::alliance::contract_of;
use crate::queries::names::{good_name, held};
use crate::queries::npc_trade::NPC_SMITHY_WEAPON;

/// A city plan's jobs by resident id (`Record<string, CityJob>`), in the order they were given.
pub type Jobs = IndexMap<String, CityJob>;

/// The orders an NPC city gives its residents (`NPC_ORDER_KINDS`): only kinds a Player's order can
/// give too (ADR 0002), so the city does nothing a Player's residents couldn't.
pub fn is_npc_order(o: &ResidentOrder) -> bool {
    matches!(
        o,
        ResidentOrder::WalkTo(_)
            | ResidentOrder::PickUp(_)
            | ResidentOrder::Drop(_)
            | ResidentOrder::Store(_)
            | ResidentOrder::Fetch(_)
            | ResidentOrder::WorkAt(_)
            | ResidentOrder::Build(_)
            | ResidentOrder::TearDown(_)
            | ResidentOrder::Breed(_)
            | ResidentOrder::Attack(_)
            | ResidentOrder::Trade(_)
            | ResidentOrder::Feed(_)
            | ResidentOrder::Teach(_)
            | ResidentOrder::Train(_)
    )
}

/// Whether a resident is run by an NPC city (`runByNpcCity`): they live in one and belong to no
/// realm, and no mercenary contract rents them out (`CONTEXT.md`: Trade Org army).
pub fn run_by_npc_city(world: &WorldState, r: &Resident) -> bool {
    let Some(city_id) = &r.city_id else { return false };
    if r.owner.is_some() || contract_of(world, &r.id).is_some() {
        return false;
    }
    world.cities.iter().any(|c| &c.id == city_id && c.realm_id.is_none())
}

/// Where an NPC city's residents go home to (`npcHome`): its finished storage, else its town
/// hall.
pub fn npc_home<'w>(world: &'w WorldState, city_id: &str) -> Option<&'w Building> {
    crate::survival::npc_home(world, city_id)
}

/// Gives a resident an order to walk to a tile (`walkTo`).
pub fn walk_to(r: &mut Resident, to: (f64, f64)) {
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: to.0, y: to.1 },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

/// Ends a resident's work (`stopWork`): their order, and the Work default they run, if any.
pub fn stop_work(r: &mut Resident) {
    r.order = None;
    r.script = None;
}

/// A default script running with `memory` (`{ scriptId: 0, task, memory }`).
pub fn default_script(task: Task, memory: Value) -> RunningScript {
    assert!(memory.is_object(), "a script's memory is an object");
    serde_json::from_value(json!({ "scriptId": 0, "task": task, "memory": memory }))
        .expect("a running script")
}

/// Puts one of the city's residents to work a workplace (`putToWork`): they run the game's Work
/// default for it, which walks them to its anchor tile (`at`) and once there picks the footprint
/// tile they stand on (`CONTEXT.md`: Spreading over the footprint).
pub fn put_to_work(r: &mut Resident, place: &Building) {
    let mut memory = json!({ "workplaceId": place.id, "at": { "x": place.x, "y": place.y } });
    if place.kind == BuildingKind::Smithy {
        memory["makes"] = json!(good_name(NPC_SMITHY_WEAPON));
    }
    r.script = Some(default_script(Task::Work, memory));
}

/// What a resident carries for the storage (`haul`): the goods workplaces make, all but `OWN_FOOD`
/// Food to eat and the `input` of the workplace they go to process at; `None` if nothing. Weapons
/// and armour stay on them.
pub fn haul(r: &Resident, input: Option<&Stock>) -> Option<Stock> {
    let mut load = Stock::new();
    for (good, units) in &r.carried {
        if WORK_OUTPUT_PER_DAY.get(good_name(*good)).is_none()
            || input.is_some_and(|i| i.contains_key(good))
        {
            continue;
        }
        let n = put_away_units(good_name(*good), *units, OWN_FOOD);
        if n > 0.0 {
            load.insert(*good, n);
        }
    }
    (!load.is_empty()).then_some(load)
}

/// Units of Food a resident carries.
pub fn food_of(r: &Resident) -> f64 {
    held(&r.carried, Good::Food)
}

/// The workplace a resident works, by its Work default or a bare work-at order, if any
/// (`workplaceOf`).
pub fn workplace_of(r: &Resident) -> Option<String> {
    if let Some(id) = r.script.as_ref().and_then(|s| s.memory.get("workplaceId")) {
        if let Some(id) = id.as_str() {
            return Some(id.to_string());
        }
    }
    match &r.order {
        Some(ResidentOrder::WorkAt(o)) => Some(o.building_id.clone()),
        _ => None,
    }
}

/// The task of the script a resident runs, if any.
pub fn task_of(r: &Resident) -> Option<Task> {
    r.script.as_ref().and_then(|s| s.task)
}
