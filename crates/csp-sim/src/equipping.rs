//! Swapping and taking off gear (`CONTEXT.md`: Equipment; ADR 0038): the `equip` order puts an
//! item the resident carries into the slot it fits, the `takeOff` order empties a slot (the item
//! stays carried, and the slot stays empty until more that fits it is picked up). Either takes
//! `EQUIP_TICKS`, during which the resident holds the order and so strikes no blows; being struck
//! meanwhile doesn't stop it. The slots themselves are [`crate::equipment`].

use csp_shared::balance::EQUIP_TICKS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{EquipOrder, Good, OrderRequest, Resident, ResidentOrder, WorldState};
use serde_json::Value;

use crate::equipment::{equipped, hands_full, set_slot, slot_name, slot_named, slot_of, Slot};
use crate::order_meta::OrderMeta;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::OrderKind;
use crate::queries::names::{good_name, good_of, held};
use crate::script_actions::{arg, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;

/// Why a resident can't put `good` on (`None` when they can): it goes into a slot, they carry it,
/// and it isn't what that slot holds already.
pub fn equip_problem(r: &Resident, good: Good) -> Option<String> {
    let Some(slot) = slot_of(good) else {
        return Some(format!("{} goes in no equipment slot", good_name(good)));
    };
    if held(&r.carried, good) <= 0.0 {
        return Some(format!("doesn’t carry a {}", good_name(good)));
    }
    if equipped(r, slot) == Some(good) {
        return Some(format!("{} is equipped already", good_name(good)));
    }
    if slot == Slot::Shield && hands_full(r) {
        let weapon = equipped(r, Slot::Weapon).map(good_name).unwrap_or("weapon");
        return Some(format!("the {weapon} takes both hands"));
    }
    None
}

/// Why a resident can't take off what is in `slot` (`None` when they can): something is in it.
pub fn take_off_problem(r: &Resident, slot: Slot) -> Option<String> {
    if equipped(r, slot).is_none() {
        return Some(format!("nothing in the {} slot", slot_name(slot)));
    }
    None
}

fn equip_order(slot: Slot, good: Option<Good>) -> ResidentOrder {
    ResidentOrder::Equip(EquipOrder { slot, good, progress: 0.0 })
}

/// The equip order (`equip`): a resident of the Player's realm swaps `good`, which they carry,
/// into the slot it fits.
pub struct Equip;

impl OrderKind for Equip {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let Some(i) = ordered_resident(world, sender, f.get("residentId").and_then(Value::as_str))
        else {
            return Some("not one of your residents".into());
        };
        let Some(good) = f.get("good").and_then(Value::as_str).and_then(good_of) else {
            return Some("no such good".into());
        };
        equip_problem(&world.residents[i], good)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = f.get("residentId").and_then(Value::as_str);
        let Some(good) = f.get("good").and_then(Value::as_str).and_then(good_of) else { return };
        let Some(slot) = slot_of(good) else { return };
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        r.order = Some(equip_order(slot, Some(good)));
    }
}

pub(crate) static EQUIP_META: OrderMeta =
    OrderMeta::request("equip", &Equip).queue_step().script(&[EQUIP_ACTION]);

const EQUIP_ACTION: ScriptAction = ScriptAction {
    name: "equip",
    group: ActionGroup::Fighting,
    request: Request::Fields(&[arg("good")]),
    cost: 10.0,
    description: "Swap a weapon, shield or armour I carry, like \"sword\", into the slot it fits; what was there stays carried. It takes a few ticks, and I strike no blows meanwhile.",
    returns: ScriptType::String,
};

/// The take-off order (`takeOff`): a resident of the Player's realm empties `slot`; its item
/// stays carried.
pub struct TakeOff;

impl OrderKind for TakeOff {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let Some(i) = ordered_resident(world, sender, f.get("residentId").and_then(Value::as_str))
        else {
            return Some("not one of your residents".into());
        };
        let Some(slot) = f.get("slot").and_then(Value::as_str).and_then(slot_named) else {
            return Some("slot must be weapon, shield or armour".into());
        };
        take_off_problem(&world.residents[i], slot)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = f.get("residentId").and_then(Value::as_str);
        let Some(slot) = f.get("slot").and_then(Value::as_str).and_then(slot_named) else {
            return;
        };
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        r.order = Some(equip_order(slot, None));
    }
}

pub(crate) static TAKE_OFF_META: OrderMeta =
    OrderMeta::request("takeOff", &TakeOff).queue_step().script(&[TAKE_OFF_ACTION]);

const TAKE_OFF_ACTION: ScriptAction = ScriptAction {
    name: "takeOff",
    group: ActionGroup::Fighting,
    request: Request::Fields(&[arg("slot")]),
    cost: 10.0,
    description: "Take off what I have in a slot, \"weapon\", \"shield\" or \"armour\"; it stays carried, and the slot stays empty until I pick up more that fits it. It takes a few ticks, and I strike no blows meanwhile.",
    returns: ScriptType::String,
};

/// Whether a resident is in the middle of swapping or taking off gear.
pub fn is_equipping(r: &Resident) -> bool {
    matches!(r.order, Some(ResidentOrder::Equip(_)))
}

/// Equipping (`stepEquipping`): each resident with an equip order spends a tick on it; after
/// `EQUIP_TICKS` the item goes into its slot (or the slot's comes off) and the order is done. A
/// swap whose item is no longer carried, or a take-off of a slot already empty, does nothing.
pub fn step_equipping(world: &mut WorldState) {
    for r in &mut world.residents {
        let Some(ResidentOrder::Equip(o)) = &mut r.order else { continue };
        o.progress += 1.0;
        if o.progress < EQUIP_TICKS {
            continue;
        }
        let (slot, good) = (o.slot, o.good);
        r.order = None;
        match good {
            Some(g) if equip_problem(r, g).is_none() => set_slot(r, slot, Some(g)),
            None if take_off_problem(r, slot).is_none() => set_slot(r, slot, None),
            _ => {}
        }
    }
}

#[cfg(test)]
#[path = "equipping/tests.rs"]
mod tests;
