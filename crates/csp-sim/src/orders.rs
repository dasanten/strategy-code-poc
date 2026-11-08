//! UI orders (`apps/server/src/orders.ts`, ADR 0002): the order kinds, the queue of orders
//! accepted during a tick and applied together at the start of the next one.
//!
//! `orderKinds` imports every module's order kind in the TypeScript. Here [`order_kinds`] is the
//! registry the rule tickets add theirs to, one `kinds.insert(..)` line each; an order kind that
//! acts on a tile is wrapped to get a passenger off first (`GETS_OFF_FIRST`) as it goes in.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use csp_shared::balance::DEFEND_CALM_TICKS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    GivenUnderAttack, OrderRequest, Resident, ResidentOrder, Task, WorldState,
};
use serde::Serialize;
use serde_json::Value;

use crate::order_sender::OrderSender;
use crate::queries::alliance::commander_of;
use crate::queries::residents::is_down;
use crate::queue::field_str;
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

/// The orders that act on a tile, and so get a passenger off their carriage first
/// (`GETS_OFF_FIRST`, `CONTEXT.md`: Passenger).
// TODO(T86.4): moves to `passengers.rs` with `getsOffFirst`.
pub const GETS_OFF_FIRST: [&str; 33] = [
    "walkTo",
    "relocate",
    "drive",
    "unhitch",
    "hitch",
    "haul",
    "pickUp",
    "drop",
    "store",
    "fetch",
    "build",
    "tearDown",
    "workAt",
    "teach",
    "train",
    "breed",
    "attack",
    "climb",
    "mount",
    "roadLine",
    "wallLine",
    "buyCity",
    "buy",
    "sell",
    "swap",
    "buyHorse",
    "sellHorse",
    "handIn",
    "transfer",
    "buyOff",
    "payDebt",
    "acceptOffer",
    "feed",
];

/// An order kind that first gets the ordered resident off their carriage (`getsOffFirst`).
struct GetsOffFirst(Arc<dyn OrderKind>);

impl OrderKind for GetsOffFirst {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        self.0.validate(world, sender, order, terrain)
    }
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let id = field_str(order, "residentId");
        if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
            r.aboard = None;
        }
        self.0.apply(world, sender, order, terrain);
    }
}

/// The order kinds by name (`Record<string, OrderKind>`). Only the kinds put in count, so a
/// name such as `"constructor"` finds nothing (`orderKindOf`).
#[derive(Clone, Default)]
pub struct OrderKinds {
    kinds: HashMap<String, Arc<dyn OrderKind>>,
}

impl OrderKinds {
    /// Adds a kind under `name`; one in [`GETS_OFF_FIRST`] gets a passenger off first.
    pub fn insert(&mut self, name: &str, kind: impl OrderKind + 'static) {
        self.insert_arc(name, Arc::new(kind));
    }

    pub fn insert_arc(&mut self, name: &str, kind: Arc<dyn OrderKind>) {
        let kind: Arc<dyn OrderKind> =
            if GETS_OFF_FIRST.contains(&name) { Arc::new(GetsOffFirst(kind)) } else { kind };
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

/// The order kinds that exist (`orderKinds`). Each rule ticket adds its kinds here.
pub fn order_kinds() -> OrderKinds {
    let mut kinds = OrderKinds::default();
    crate::queues::add_queue_orders(&mut kinds);
    kinds
}

/// The army order kinds (`Object.keys(armyOrders)`): an order to an army, not to a resident.
// TODO(T86.7): from `armies.rs` once it ports `armyOrders`.
const ARMY_ORDERS: [&str; 7] =
    ["formArmy", "disbandArmy", "armyWalkTo", "armyGuard", "armyAttack", "armyFollow", "armyStop"];

/// The order kinds that leave a resident's script running (`keeps` in `applyAll`): pairing, the
/// Leader handover, renaming and claiming the Horse offer change nobody's order, nor do picking a
/// param value, a defence or Alarm script, the demand, offer and waypoint orders; editing a queue
/// keeps its current step going.
const KEEPS_SCRIPT: [&str; 23] = [
    "runScript",
    "pair",
    "handOver",
    "rename",
    "renameCity",
    "renameHorse",
    "claimHorses",
    // `demandOrders` (T86.11).
    "sendDemand",
    "acceptDemand",
    "declineDemand",
    "setScriptParam",
    "setDefenceScript",
    "setAlarmScript",
    "editQueue",
    "postOffer",
    "takeDownOffer",
    "sendDirectOffer",
    "declineOffer",
    "sendCarriedOffer",
    "acceptCarriedOffer",
    // `waypointOrders` (T86.11).
    "addWaypoint",
    "renameWaypoint",
    "removeWaypoint",
];

fn keeps_script(kind: &str) -> bool {
    KEEPS_SCRIPT.contains(&kind)
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
            let keeps = keeps_script(kind_name);
            let resident_id = field_str(&order, "residentId").map(str::to_string);
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
                let army_id = field_str(&order, "armyId");
                if let Some(a) = world.armies.iter_mut().find(|x| Some(x.id.as_str()) == army_id) {
                    a.script = None;
                }
            }
            let to_army = ARMY_ORDERS.contains(&kind_name) || kind_name == "armyRunScript";
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
// Helpers of other modules `applyAll` needs, until their tickets port them.
// ------------------------------------------------------------------------------------------------

/// Whether `r` counts as under attack for an order given now (`underAttack`).
// TODO(T86.7): `defence::under_attack`.
fn under_attack(world: &WorldState, r: &Resident) -> bool {
    let alarm = r.script.as_ref().is_some_and(|s| s.task == Some(Task::Alarm));
    if r.interrupted.is_some() && !alarm {
        return true;
    }
    r.struck.as_ref().is_some_and(|s| world.tick as f64 - s.tick < DEFEND_CALM_TICKS)
}

/// Whether a resident defends by script (`defendsByScript`): someone commands them and they are
/// in no army.
// TODO(T86.7): `defence::defends_by_script`.
fn defends_by_script(world: &WorldState, r: &Resident) -> bool {
    commander_of(world, &r.id, r.owner.as_deref()).is_some()
        && !world.armies.iter().any(|a| a.member_ids.contains(&r.id))
}

/// The order kinds that go on until stopped (`GOES_ON_UNTIL_STOPPED`).
fn goes_on_until_stopped(o: &ResidentOrder) -> bool {
    matches!(
        o,
        ResidentOrder::Haul(_)
            | ResidentOrder::WorkAt(_)
            | ResidentOrder::Teach(_)
            | ResidentOrder::Train(_)
    )
}

/// Marks what a Player's order just gave the resident at `i` under attack (`noteGiven`). The
/// TypeScript tells an order replaced by identity (`r.order === orderBefore`); here an order
/// replaced by an equal one counts as unchanged.
// TODO(T86.7): `defence::note_given`.
fn note_given(
    world: &mut WorldState,
    i: usize,
    was_under_attack: bool,
    order_before: Option<&ResidentOrder>,
) {
    let r = &world.residents[i];
    if r.order.as_ref() == order_before && r.script.is_none() && r.queue.is_none() {
        return;
    }
    let defends = defends_by_script(world, r);
    let r = &mut world.residents[i];
    r.given_under_attack = None;
    if !was_under_attack || !defends {
        return;
    }
    if r.script.is_some()
        || r.queue.is_some()
        || r.order.as_ref().is_some_and(goes_on_until_stopped)
    {
        r.given_under_attack = Some(GivenUnderAttack::UntilCalm);
    } else if r.order.is_some() {
        r.given_under_attack = Some(GivenUnderAttack::UntilDone);
    }
}

/// Each army member's order as it is now (`memberOrders`).
// TODO(T86.7): `armies::member_orders`.
fn member_orders(world: &WorldState) -> HashMap<String, Option<ResidentOrder>> {
    let mut out = HashMap::new();
    if world.armies.is_empty() {
        return out;
    }
    let members: HashSet<&String> = world.armies.iter().flat_map(|a| &a.member_ids).collect();
    for r in &world.residents {
        if members.contains(&r.id) {
            out.insert(r.id.clone(), r.order.clone());
        }
    }
    out
}

/// Members whose order changed since `before` got an order of their own, and leave their army
/// (`leaveOnOwnOrders`). As in [`note_given`], an order replaced by an equal one is no change.
// TODO(T86.7): `armies::leave_on_own_orders`.
pub(crate) fn leave_on_own_orders(
    world: &mut WorldState,
    before: &HashMap<String, Option<ResidentOrder>>,
) {
    if before.is_empty() {
        return;
    }
    let left: HashSet<String> = world
        .residents
        .iter()
        .filter(|r| before.get(&r.id).is_some_and(|o| *o != r.order))
        .map(|r| r.id.clone())
        .collect();
    if !left.is_empty() {
        leave_armies(world, &left);
    }
}

/// Takes residents out of every army; an army left with nobody is gone (`leaveArmies`).
// TODO(T86.7): `armies::leave_armies`.
pub(crate) fn leave_armies(world: &mut WorldState, ids: &HashSet<String>) {
    for a in &mut world.armies {
        a.member_ids.retain(|id| !ids.contains(id));
    }
    world.armies.retain(|a| !a.member_ids.is_empty());
}

#[cfg(test)]
mod tests;
