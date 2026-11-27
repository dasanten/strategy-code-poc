//! UI orders (ADR 0002): the order kinds, the queue of orders accepted during a tick and applied
//! together at the start of the next one.
//!
//! The registry ([`order_kinds`]) is built from what each kind says about itself
//! (`order_meta::ORDER_METAS`).

use std::collections::HashMap;
use std::sync::Arc;

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{OrderRequest, WorldState};
use serde::Serialize;
use serde_json::Value;

use crate::order_meta::{meta_of, ORDER_METAS};
use crate::order_sender::OrderSender;
use crate::passengers::GetsOffFirst;
use crate::queries::people::Given;
use crate::queries::residents::is_down;
use crate::tick::{ApplyOrders, Scratch};

/// One kind of UI order (`OrderKind`, ADR 0002). `validate` runs when the order arrives and
/// returns a reason to reject it; `apply` runs at the start of the next tick and may only set
/// the order state that later ticks turn into actions, never change the world directly.
pub trait OrderKind: Send + Sync {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String>;
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    );
}

/// A declared order kind (`OrderMeta::request`) is one too.
impl OrderKind for &'static dyn OrderKind {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        (**self).validate(world, sender, order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        (**self).apply(world, sender, order, terrain)
    }
}

/// A shared order kind is one too, so it can be wrapped (`getsOffFirst`).
impl OrderKind for Arc<dyn OrderKind> {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        (**self).validate(world, sender, order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        (**self).apply(world, sender, order, terrain)
    }
}

/// A string field of an order, if it is one.
pub fn str_field<'o>(order: &'o OrderRequest, name: &str) -> Option<&'o str> {
    order.fields.get(name).and_then(Value::as_str)
}

/// A number field of an order, if it is one.
pub fn num_field(order: &OrderRequest, name: &str) -> Option<f64> {
    order.fields.get(name).and_then(Value::as_f64)
}

/// A whole-number field of an order (`Number.isInteger`), if it is one.
pub fn int_field(order: &OrderRequest, name: &str) -> Option<f64> {
    num_field(order, name).filter(|v| v.is_finite() && v.fract() == 0.0)
}

/// A boolean field of an order, if it is one.
pub fn bool_field(order: &OrderRequest, name: &str) -> Option<bool> {
    order.fields.get(name).and_then(Value::as_bool)
}

/// A string field of an order, if it is one, owned.
pub fn text_field(order: &OrderRequest, name: &str) -> Option<String> {
    str_field(order, name).map(str::to_string)
}

/// A field that lists ids, if it is a list.
pub fn ids_field(order: &OrderRequest, name: &str) -> Option<Vec<String>> {
    order.fields.get(name).and_then(Value::as_array).map(|a| {
        a.iter().map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)).collect()
    })
}

/// A name field as the renaming checks take it (`Given`): missing, text, or something else.
pub fn given_field<'o>(order: &'o OrderRequest, name: &str) -> Given<'o> {
    match order.fields.get(name) {
        None => Given::Missing,
        Some(Value::String(s)) => Given::Text(s),
        Some(_) => Given::NotText,
    }
}

/// The side of the map an order is checked on.
pub fn map_size(terrain: Option<&TerrainMap>) -> i32 {
    terrain.map_or(MAP_SIZE, |t| t.size)
}

/// The order kinds by name (`Record<string, OrderKind>`). Only the kinds put in count, so a
/// name such as `"constructor"` finds nothing (`orderKindOf`).
#[derive(Clone, Default)]
pub struct OrderKinds {
    kinds: HashMap<String, Arc<dyn OrderKind>>,
}

impl OrderKinds {
    /// Adds a kind under `name`; one whose `gets_off_first` is set gets a passenger off
    /// first.
    pub fn insert(&mut self, name: &str, kind: impl OrderKind + 'static) {
        self.insert_arc(name, Arc::new(kind));
    }

    pub fn insert_arc(&mut self, name: &str, kind: Arc<dyn OrderKind>) {
        let gets_off_first = meta_of(name).is_some_and(|m| m.gets_off_first);
        let kind = if gets_off_first { Arc::new(GetsOffFirst(kind)) } else { kind };
        self.kinds.insert(name.to_string(), kind);
    }

    /// The order kind called `name`, if there is one (`orderKindOf`).
    pub fn get(&self, name: &str) -> Option<&Arc<dyn OrderKind>> {
        self.kinds.get(name)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.kinds.contains_key(name)
    }
}

/// The order kinds that exist (`orderKinds`), but for those built on the script library, which
/// its host adds.
pub fn order_kinds() -> OrderKinds {
    let mut kinds = OrderKinds::default();
    for m in ORDER_METAS {
        if let Some(kind) = m.order_kind() {
            kinds.insert_arc(m.kind, kind);
        }
    }
    kinds
}

/// The ids an order names as `residentId` and `residentIds`.
fn named_ids(order: &OrderRequest) -> Vec<&Value> {
    let mut ids: Vec<&Value> = order.fields.get("residentId").into_iter().collect();
    if let Some(Value::Array(more)) = order.fields.get("residentIds") {
        ids.extend(more);
    }
    ids
}

/// Why an order can't be given (`downProblem`): a resident it is for is Down (`CONTEXT.md`:
/// Down) and takes no orders. `None` when none is.
pub fn down_problem(world: &WorldState, order: &OrderRequest) -> Option<String> {
    let ids = named_ids(order);
    let down = world.residents.iter().find(|r| {
        is_down(r.down_until) && ids.iter().any(|id| id.as_str() == Some(r.id.as_str()))
    })?;
    Some(format!("{} is Down and takes no orders", down.name))
}

/// How an order was answered (`ServerMessage` `ack` or `rejected`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OrderReply {
    Ack { request_id: String },
    Rejected { request_id: String, reason: String },
}

struct Pending {
    sender: OrderSender,
    order: OrderRequest,
}

/// Orders accepted during a tick, applied together at the start of the next one (`OrderQueue`).
pub struct OrderQueue {
    pending: Vec<Pending>,
    kinds: OrderKinds,
    terrain: Option<Arc<TerrainMap>>,
}

impl OrderQueue {
    /// `terrain`, when given, lets orders check the land, such as a stable going on Plains.
    pub fn new(kinds: OrderKinds, terrain: Option<Arc<TerrainMap>>) -> Self {
        OrderQueue { pending: Vec::new(), kinds, terrain }
    }

    /// Checks an incoming order and answers it; a valid one waits for the next tick (`receive`).
    /// `request_id` and `order` are as the client sent them, any JSON.
    pub fn receive(
        &mut self,
        world: &WorldState,
        sender: &OrderSender,
        request_id: &Value,
        order: &Value,
    ) -> OrderReply {
        let id = request_id.as_str().unwrap_or("").to_string();
        let Some(fields) = order.as_object().filter(|_| !id.is_empty()) else {
            return OrderReply::Rejected { request_id: id, reason: "malformed order".into() };
        };
        let kind = fields.get("kind");
        let Some(name) = kind.and_then(Value::as_str).filter(|k| self.kinds.contains(k)) else {
            let reason = format!("unknown order: {}", crate::queue::js_string_of(kind));
            return OrderReply::Rejected { request_id: id, reason };
        };
        let mut rest = fields.clone();
        rest.shift_remove("kind");
        let req = OrderRequest { kind: name.to_string(), fields: rest };
        let kind = self.kinds.get(name).expect("checked above");
        let reason = down_problem(world, &req)
            .or_else(|| kind.validate(world, sender, &req, self.terrain.as_deref()));
        if let Some(reason) = reason {
            return OrderReply::Rejected { request_id: id, reason };
        }
        self.pending.push(Pending { sender: sender.clone(), order: req });
        OrderReply::Ack { request_id: id }
    }

    /// Applies the waiting orders in the order they came (`applyAll`). A resident in an army who
    /// gets an order of their own leaves it (`CONTEXT.md`: Army); orders to armies don't count.
    pub fn apply_all(&mut self, world: &mut WorldState) {
        let batch = std::mem::take(&mut self.pending);
        for Pending { sender, order } in batch {
            // Gone Down since the order came, they no longer take it.
            if down_problem(world, &order).is_some() {
                continue;
            }
            let kind_name = order.kind.as_str();
            let meta = meta_of(kind_name);
            let keeps = meta.is_some_and(|m| m.keeps_script);
            let resident_id = str_field(&order, "residentId").map(str::to_string);
            let ri = resident_id
                .as_deref()
                .and_then(|id| world.residents.iter().position(|x| x.id == id));
            // An order replacing what they do, given under attack, stands against further blows
            // (`CONTEXT.md`: A Player's order under attack). What a script or queue requests
            // itself doesn't come through here.
            let replaces = ri.is_some() && (kind_name == "runScript" || !keeps);
            let given = match ri {
                Some(i) if replaces => Some((
                    under_attack(world, &world.residents[i]),
                    world.residents[i].order.clone(),
                )),
                _ => None,
            };
            if let Some(i) = ri {
                let r = &mut world.residents[i];
                if !keeps {
                    // Any other order ends the script they run (`CONTEXT.md`: Running a script);
                    // how their last store or fetch ended is kept until their next order.
                    r.script = None;
                    r.order_ended = None;
                }
                // Any order that isn't a step of it ends the resident's queue, running a script
                // too; a new queue replaces it. It ends a defence or Alarm script and what it
                // interrupted too (`CONTEXT.md`: Defence script, Alarm script).
                if replaces {
                    r.queue = None;
                    if r.interrupted.is_some() {
                        r.interrupted = None;
                        r.script = None;
                    }
                }
            }
            if kind_name != "armyRunScript" {
                let army_id = str_field(&order, "armyId");
                if let Some(a) = world.armies.iter_mut().find(|x| Some(x.id.as_str()) == army_id) {
                    a.script = None;
                }
            }
            let to_army = meta.is_some_and(|m| m.to_army);
            let before = if to_army { None } else { Some(member_orders(world)) };
            // Accepted by `receive`, so the kind exists.
            let kind = self.kinds.get(kind_name).expect("accepted orders have a kind").clone();
            kind.apply(world, &sender, &order, self.terrain.as_deref());
            if let Some(before) = before {
                leave_on_own_orders(world, &before);
            }
            if let (Some(id), Some((attacked, order_before))) = (resident_id, given) {
                if let Some(i) = world.residents.iter().position(|x| x.id == id) {
                    note_given(world, i, attacked, order_before.as_ref());
                }
            }
        }
    }

    /// How many orders wait for the next tick (`size`).
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// How many orders a Player has waiting for the next tick (`pendingFor`).
    pub fn pending_for(&self, user_id: u64) -> usize {
        self.pending.iter().filter(|p| p.sender.user_id == user_id).count()
    }
}

impl ApplyOrders for OrderQueue {
    fn apply_all(&mut self, world: &mut WorldState, _scratch: &mut Scratch) {
        OrderQueue::apply_all(self, world);
    }
}

// ------------------------------------------------------------------------------------------------
// The helpers `applyAll` needs from the conflict rules (T86.7).
// ------------------------------------------------------------------------------------------------

use crate::armies::{leave_on_own_orders, member_orders};
use crate::defence::{note_given, under_attack};

pub(crate) use crate::armies::leave_armies;

#[cfg(test)]
mod tests;
