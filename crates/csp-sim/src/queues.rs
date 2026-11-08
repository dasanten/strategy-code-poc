//! Queues (`apps/server/src/queues.ts`, `CONTEXT.md`: Queue). The queue order gives a resident a
//! list of steps, each an order request; the edit-queue order replaces the steps of the one they
//! work through. Every tick, after the orders are applied and before scripts run, [`QueueRunner`]
//! starts the current step by applying its request as if it had been given on its own, and moves
//! on once it is done or its duration is up. Any order that isn't a step ends the queue
//! ([`crate::orders::OrderQueue`]). While a defence script runs, the queue waits, its step kept
//! aside with what it interrupted.
//!
//! A step may act somewhere else than where the resident stands (Planning ahead): adding it only
//! checks that the places it names could make sense ([`step_place_problem`]); whether it can
//! start is checked when its turn comes.

use std::collections::HashSet;
use std::sync::Arc;

use csp_shared::balance::{MAP_SIZE, REALM_LOG_LENGTH};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_HOUR;
use csp_shared::world::{
    Interrupted, OrderEndedKind, OrderRequest, Queue, QueueStep, RealmEvent, RealmEventWhat,
    Resident, WorldState,
};
use serde_json::Value;

use crate::order_sender::{commands, realm_of, OrderSender};
use crate::orders::{leave_armies, OrderKind, OrderKinds};
use crate::queries::residents::is_down;
use crate::queue::{
    field_str, queue_steps_problem, runs_script, QueueStepRequest, QUEUE_STEP_KINDS,
};
use crate::sight::InvariantViolation;
use crate::tick::{RunQueues, Scratch};

/// Ticks in a game minute.
const TICKS_PER_GAME_MINUTE: f64 = TICKS_PER_GAME_HOUR / 60.0;

/// The step's order as kept: plain data, without whom it is for (`keptOrder`).
fn kept_order(order: &OrderRequest) -> OrderRequest {
    let mut kept = order.clone();
    kept.fields.shift_remove("residentId");
    kept
}

fn kept_step(id: u32, s: &QueueStepRequest) -> QueueStep {
    QueueStep { id, order: kept_order(&s.order), minutes: s.minutes }
}

/// A tile as an order names it, `{ x, y }`, rather than a place by its id (`isTile`).
fn is_tile(p: &serde_json::Map<String, Value>) -> bool {
    p.contains_key("x") && p.contains_key("y")
}

use crate::crimes::carriage_organization;

/// Why a step can't make sense wherever the resident stands when its turn comes
/// (`stepPlaceProblem`, `CONTEXT.md`: Queue, Planning ahead): a tile it names is off the map, a
/// carriage or horse it names isn't there, or isn't the realm's, or the city a relocate names
/// isn't the realm's. A building it names that is gone passes: the step is skipped when its turn
/// comes. Everything else is checked when the step starts.
pub fn step_place_problem(
    world: &WorldState,
    realm_id: &str,
    order: &OrderRequest,
    size: i32,
) -> Option<&'static str> {
    let on_map = |p: &serde_json::Map<String, Value>| {
        ["x", "y"].iter().all(|k| match p.get(*k) {
            Some(Value::Number(n)) => {
                let n = n.as_f64().unwrap_or(f64::NAN);
                n.fract() == 0.0 && n >= 0.0 && n < size as f64
            }
            _ => true,
        })
    };
    let f = &order.fields;
    let mut tiles: Vec<&serde_json::Map<String, Value>> = Vec::new();
    if is_tile(f) {
        tiles.push(f);
    }
    for k in ["at", "from", "to"] {
        if let Some(Value::Object(p)) = f.get(k) {
            if is_tile(p) {
                tiles.push(p);
            }
        }
    }
    if !tiles.into_iter().all(on_map) {
        return Some("that tile is off the map");
    }
    // A store's `to` or a fetch's `from` names a storage or stable, anyone's, or a carriage.
    let places: Vec<&Value> = ["to", "from"]
        .iter()
        .filter_map(|k| f.get(*k))
        .filter(|p| !p.is_null() && !p.as_object().is_some_and(is_tile))
        .map(|p| match p {
            Value::Object(o) => o.get("id").unwrap_or(&Value::Null),
            other => other,
        })
        .collect();
    let spot_carriage = f.get("spot").and_then(|s| s.get("carriageId"));
    // A building a step names may be gone by now, as one a saved queue kept after it was torn
    // down (`CONTEXT.md`: Saved queue): the step is given, and skipped when its turn comes. So
    // may a store's or fetch's storage, which no carriage is.
    let ids =
        [f.get("carriageId"), spot_carriage].into_iter().flatten().chain(places.iter().copied());
    for id in ids {
        let Some(id) = id.as_str() else { continue };
        let k = world.carriages.iter().find(|x| x.id == id);
        let is_place = places.iter().any(|p| p.as_str() == Some(id));
        match k {
            None if is_place => continue,
            None => return Some("no such carriage"),
            Some(k) if carriage_organization(k) != Some(realm_id) => {
                return Some("not a carriage of your realm")
            }
            Some(_) => {}
        }
    }
    let mut horse_ids: Vec<&Value> = f.get("horseId").into_iter().collect();
    if let Some(Value::Array(more)) = f.get("horseIds") {
        horse_ids.extend(more);
    }
    for id in horse_ids {
        let Some(id) = id.as_str() else { continue };
        let Some(horse) = world.horses.iter().find(|h| h.id == id) else {
            return Some("no such horse");
        };
        if horse.realm_id.as_deref() != Some(realm_id) {
            return Some("not a horse of your realm");
        }
    }
    if order.kind == "relocate" {
        let city_id = f.get("cityId").and_then(Value::as_str);
        let city = world.cities.iter().find(|c| Some(c.id.as_str()) == city_id);
        if city.and_then(|c| c.realm_id.as_deref()) != Some(realm_id) {
            return Some("not a city of your realm");
        }
    }
    None
}

/// Why one of the steps `checked` picks can't make sense (`placesProblem`).
fn places_problem(
    world: &WorldState,
    realm_id: &str,
    steps: &[QueueStepRequest],
    checked: impl Fn(&QueueStepRequest) -> bool,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    for (i, s) in steps.iter().enumerate() {
        if !checked(s) {
            continue;
        }
        if let Some(problem) = step_place_problem(world, realm_id, &s.order, size) {
            return Some(format!("step {}: {problem}", i + 1));
        }
    }
    None
}

/// The resident the sender's queue order names, if they command them, with the realm's id
/// (`queuedResident`).
fn queued_resident(
    world: &WorldState,
    sender: &OrderSender,
    resident_id: Option<&str>,
) -> Option<(usize, String)> {
    let realm = realm_of(world, sender.user_id)?;
    let i = world.residents.iter().position(|x| Some(x.id.as_str()) == resident_id);
    if commands(world, &realm.id, i.map(|i| &world.residents[i])) {
        Some((i?, realm.id.clone()))
    } else {
        None
    }
}

/// The steps a request sends, once `queue_steps_problem` passed them.
fn steps_of(order: &OrderRequest) -> Vec<QueueStepRequest> {
    order
        .fields
        .get("steps")
        .and_then(|s| serde_json::from_value(s.clone()).ok())
        .unwrap_or_default()
}

/// `loop` as the request sends it: `None` when absent, an error when not a boolean.
fn loop_of(order: &OrderRequest) -> Result<Option<bool>, ()> {
    match order.fields.get("loop") {
        None => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(()),
    }
}

/// The queue order (`queue`): one of the Player's residents works through the steps, from the
/// first. It ends whatever they were doing.
pub struct QueueOrder;

impl OrderKind for QueueOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some((_, realm_id)) = queued_resident(world, sender, field_str(order, "residentId"))
        else {
            return Some("not one of your residents".into());
        };
        let raw = order.fields.get("steps");
        if raw.and_then(Value::as_array).is_some_and(Vec::is_empty) {
            return Some("a queue needs a step".into());
        }
        if loop_of(order).is_err() {
            return Some("loop must be true or false".into());
        }
        queue_steps_problem(raw)
            .or_else(|| places_problem(world, &realm_id, &steps_of(order), |_| true, terrain))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some((i, realm_id)) = queued_resident(world, sender, field_str(order, "residentId"))
        else {
            return;
        };
        let steps = steps_of(order);
        // A queue is an order of their own, so they leave their army (`CONTEXT.md`: Army).
        let id = world.residents[i].id.clone();
        leave_armies(world, &HashSet::from([id]));
        let r = &mut world.residents[i];
        r.order = None;
        r.queue = Some(Queue {
            realm_id,
            steps: steps.iter().enumerate().map(|(n, s)| kept_step(n as u32 + 1, s)).collect(),
            current: 0,
            started_at: None,
            r#loop: loop_of(order) == Ok(Some(true)),
            next_step_id: steps.len() as u32 + 1,
        });
    }
}

/// The edit-queue order (`editQueue`): the steps of the queue a resident works through are
/// replaced by these, and loop set. A step with the `id` of one already there is that step; the
/// current step keeps going unless it was left out. Then the step now in its place starts, or,
/// with none there, the first one when the queue loops; otherwise the queue ends and the
/// resident stops.
pub struct EditQueueOrder;

impl OrderKind for EditQueueOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some((i, realm_id)) = queued_resident(world, sender, field_str(order, "residentId"))
        else {
            return Some("not one of your residents".into());
        };
        let Some(q) = &world.residents[i].queue else {
            return Some("not working through a queue".into());
        };
        if loop_of(order).is_err() {
            return Some("loop must be true or false".into());
        }
        if let Some(problem) = queue_steps_problem(order.fields.get("steps")) {
            return Some(problem);
        }
        let raw: Vec<Value> = order.fields["steps"].as_array().cloned().unwrap_or_default();
        // A step's `id` as sent: anything there counts as given, as `s.id === undefined` does.
        let ids: Vec<&Value> = raw.iter().filter_map(|s| s.get("id")).collect();
        let distinct: HashSet<String> = ids.iter().map(|v| v.to_string()).collect();
        if distinct.len() != ids.len() {
            return Some("a step is in the list twice".into());
        }
        let known =
            |v: &Value| v.as_f64().is_some_and(|id| q.steps.iter().any(|s| s.id as f64 == id));
        if !ids.iter().all(|v| known(v)) {
            return Some("no such step in the queue".into());
        }
        // Only the steps added are checked: one already there whose place is gone since is
        // skipped when its turn comes, and can still be edited until then.
        places_problem(world, &realm_id, &steps_of(order), |s| s.id.is_none(), terrain)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Some((i, _)) = queued_resident(world, sender, field_str(order, "residentId")) else {
            return;
        };
        let r = &mut world.residents[i];
        let Some(q) = r.queue.as_mut() else { return };
        let current = q.steps[q.current as usize].id;
        let steps: Vec<QueueStep> = steps_of(order)
            .iter()
            .map(|s| {
                let id = s.id.unwrap_or_else(|| {
                    q.next_step_id += 1;
                    q.next_step_id - 1
                });
                kept_step(id, s)
            })
            .collect();
        if let Ok(Some(l)) = loop_of(order) {
            q.r#loop = l;
        }
        let kept = steps.iter().position(|s| s.id == current);
        let len = steps.len() as u32;
        q.steps = steps;
        if let Some(kept) = kept {
            // The current step keeps going, but with the request and duration as edited.
            q.current = kept as u32;
            return;
        }
        // The current step was removed: it stops, and the one in its place starts.
        let ends = q.current >= len && !(q.r#loop && len > 0);
        if q.current >= len && !ends {
            q.current = 0;
        }
        stop_step(r);
        if ends {
            r.queue = None;
            return;
        }
        if let Some(q) = r.queue.as_mut() {
            q.started_at = None;
        }
    }
}

/// Adds the queue order kinds (`queueOrders`).
pub fn add_queue_orders(kinds: &mut OrderKinds) {
    kinds.insert("queue", QueueOrder);
    kinds.insert("editQueue", EditQueueOrder);
}

/// Stops what the resident's current step had them do (`stopStep`); while their defence script
/// runs, what it interrupted (`CONTEXT.md`: Defence script), which then has nothing to go on with.
fn stop_step(r: &mut Resident) {
    if r.interrupted.is_some() {
        r.interrupted = Some(Interrupted { order: None, script: None, alarm: None });
        return;
    }
    r.order = None;
    r.script = None;
}

/// What [`QueueRunner`] needs from outside the world: the Players as orders' senders
/// (`QueueHost`).
pub trait QueueHost {
    fn sender(&self, user_id: u64) -> Option<OrderSender>;
}

/// Works every resident's queue once a tick (`QueueRunner`, `CONTEXT.md`: Queue).
pub struct QueueRunner {
    host: Box<dyn QueueHost>,
    /// All the order kinds a step may be, `runScript` and `task` among them.
    kinds: OrderKinds,
    terrain: Option<Arc<TerrainMap>>,
}

impl QueueRunner {
    pub fn new(
        host: Box<dyn QueueHost>,
        kinds: OrderKinds,
        terrain: Option<Arc<TerrainMap>>,
    ) -> Self {
        QueueRunner { host, kinds, terrain }
    }

    fn size(&self) -> i32 {
        self.terrain.as_ref().map_or(MAP_SIZE, |t| t.size)
    }

    /// Moves each queue on (`runAll`): a step that is done, or whose duration is up, ends, and
    /// the next one starts. A step that ended in a failure, or can't start, is skipped and goes
    /// in the realm log. Run after the orders are applied and before scripts run, so a step's
    /// script runs the tick it starts. The residents with a queue are taken as the tick begins;
    /// one gone since is passed over.
    pub fn run_all(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        let ids: Vec<String> =
            world.residents.iter().filter(|r| r.queue.is_some()).map(|r| r.id.clone()).collect();
        let size = self.size();
        for id in ids {
            let Some(i) = world.residents.iter().position(|r| r.id == id) else { continue };
            let Some(q) = &world.residents[i].queue else { continue };
            let realm_id = q.realm_id.clone();
            let r = &world.residents[i];
            // Hired out, lent back or taken: the Player who gave it no longer commands them.
            let realm = world.realms.iter().find(|x| x.id == realm_id);
            let sender = realm.and_then(|realm| self.host.sender(realm.user_id));
            // Taken into an army, they follow its orders instead.
            let in_army = world.armies.iter().any(|a| a.member_ids.contains(&r.id));
            // Looked up afresh for each: a step started before may have handed someone over.
            // Down, they do nothing (`CONTEXT.md`: Down).
            let commander =
                scratch.index(world, size).commander_of(world, &r.id, r.owner.as_deref());
            let Some(sender) = sender.filter(|_| {
                commander.as_deref() == Some(realm_id.as_str())
                    && !in_army
                    && !is_down(r.down_until)
            }) else {
                world.residents[i].queue = None;
                continue;
            };
            // Defending themselves, the queue waits until their defence script hands back
            // (`CONTEXT.md`: Defence script).
            if r.interrupted.is_some() {
                continue;
            }
            let q = r.queue.as_ref().expect("checked above");
            if let Some(started_at) = q.started_at {
                let step = &q.steps[q.current as usize];
                let time_up = step
                    .minutes
                    .is_some_and(|m| world.tick as f64 - started_at >= m * TICKS_PER_GAME_MINUTE);
                let done =
                    if runs_script(&step.order) { r.script.is_none() } else { r.order.is_none() };
                if !time_up && !done {
                    continue;
                }
                if time_up {
                    stop_step(&mut world.residents[i]);
                } else if let Some(failure) = failure_of(r, started_at) {
                    skipped(world, i, &failure, false);
                }
                if !next(&mut world.residents[i]) {
                    continue;
                }
            }
            self.start(world, i, &sender);
        }
    }

    /// Starts the current step, checked as if given on its own; one that can't start is skipped,
    /// and the next one tried. When none of the queue's steps can start, the queue ends.
    fn start(&self, world: &mut WorldState, i: usize, sender: &OrderSender) {
        let len = world.residents[i].queue.as_ref().map_or(0, |q| q.steps.len());
        for tried in 1..=len {
            let r = &world.residents[i];
            let Some(q) = &r.queue else { return };
            let step = &q.steps[q.current as usize];
            let mut order = step.order.clone();
            order.fields.insert("residentId".into(), Value::String(r.id.clone()));
            let kind = self.kinds.get(&order.kind).cloned();
            // What was the realm's when planned may be stolen by now, and a step never steals
            // it back.
            let realm = realm_of(world, sender.user_id);
            let reason = realm
                .and_then(|realm| step_place_problem(world, &realm.id, &order, self.size()))
                .map(str::to_string)
                .or_else(|| match &kind {
                    Some(kind) => kind.validate(world, sender, &order, self.terrain.as_deref()),
                    None => Some(format!("unknown order: {}", order.kind)),
                });
            let Some(reason) = reason else {
                let id = r.id.clone();
                let r = &mut world.residents[i];
                stop_step(r);
                // How their last store or fetch ended is kept until their next order, as for
                // the UI's.
                r.order_ended = None;
                kind.expect("validated").apply(world, sender, &order, self.terrain.as_deref());
                let tick = world.tick as f64;
                if let Some(q) =
                    world.residents.iter_mut().find(|x| x.id == id).and_then(|r| r.queue.as_mut())
                {
                    q.started_at = Some(tick);
                }
                return;
            };
            let none = tried == len;
            skipped(world, i, &reason, none);
            if none {
                world.residents[i].queue = None;
            } else if !next(&mut world.residents[i]) {
                return;
            }
        }
    }
}

impl RunQueues for QueueRunner {
    fn run_all(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        QueueRunner::run_all(self, world, scratch);
    }
}

/// Moves the queue to its next step (`next`); false when it ended instead.
fn next(r: &mut Resident) -> bool {
    let Some(q) = r.queue.as_mut() else { return false };
    q.started_at = None;
    if (q.current as usize) + 1 < q.steps.len() {
        q.current += 1;
    } else if q.r#loop {
        q.current = 0;
    } else {
        r.queue = None;
        return false;
    }
    true
}

/// Why the step that started at `started_at` ended in a failure (`failureOf`): a store or fetch
/// ending early. A relocate that didn't move in is left out: the realm log already says why.
fn failure_of(r: &Resident, started_at: f64) -> Option<String> {
    let ended = r.order_ended.as_ref()?;
    if ended.kind == OrderEndedKind::Relocate {
        return None;
    }
    if ended.tick >= started_at {
        ended.reason.clone()
    } else {
        None
    }
}

/// Notes in the realm log that the resident at `i` skipped their current step (`skipped`).
fn skipped(world: &mut WorldState, i: usize, reason: &str, queue_ended: bool) {
    let r = &world.residents[i];
    let Some(q) = &r.queue else { return };
    let what = RealmEventWhat::QueueStepSkipped {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        step: f64::from(q.current + 1),
        order: q.steps[q.current as usize].order.kind.clone(),
        reason: reason.to_string(),
        queue_ended: queue_ended.then_some(true),
    };
    let realm_id = q.realm_id.clone();
    record_event(world, Some(&realm_id), what);
}

/// Writes down something that happened in a realm, in its Player's log (`recordEvent`); an event
/// for no realm is not kept. Each Player keeps their latest `REALM_LOG_LENGTH` events.
// TODO(T86.13): `events::record_event`.
fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let Some(user_id) =
        realm_id.and_then(|id| world.realms.iter().find(|x| x.id == id)).map(|r| r.user_id)
    else {
        return;
    };
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    if mine as f64 > REALM_LOG_LENGTH {
        let mut drop = mine - REALM_LOG_LENGTH as usize;
        world.events.retain(|e| {
            if drop > 0 && e.user_id == user_id {
                drop -= 1;
                false
            } else {
                true
            }
        });
    }
}

/// Invariant (`queues-sound`, ADR 0004): every queue has steps, its current step is one of them
/// and started no later than now, its step ids are unique and below `nextStepId`, and no step is
/// a queue.
pub fn queues_sound(world: &WorldState, _terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(q) = &r.queue else { continue };
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "queues-sound".into(),
                message: format!("{}'s queue {message}", r.id),
                entity_ids: vec![r.id.clone()],
            });
        };
        if q.current as usize >= q.steps.len() {
            fail(format!("is at step {} of {}", q.current, q.steps.len()));
        }
        if let Some(s) = q.started_at.filter(|&s| s > world.tick as f64) {
            fail(format!(
                "started a step at tick {}, after {}",
                csp_lang::js::number_to_string(s),
                world.tick
            ));
        }
        let ids: Vec<u32> = q.steps.iter().map(|s| s.id).collect();
        let distinct: HashSet<u32> = ids.iter().copied().collect();
        if distinct.len() != ids.len() || ids.iter().any(|&id| id >= q.next_step_id) {
            let list: Vec<String> = ids.iter().map(u32::to_string).collect();
            fail(format!("has step ids {} with {} next", list.join(", "), q.next_step_id));
        }
        for s in &q.steps {
            if !QUEUE_STEP_KINDS.contains(&s.order.kind.as_str()) {
                fail(format!("holds a {} step", s.order.kind));
            }
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests;
