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

use csp_shared::balance::MAP_SIZE;
use csp_shared::balance::{QUEUE_MAX_DEPTH, QUEUE_MAX_STEPS};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_HOUR;
use csp_shared::world::{
    Interrupted, OrderEndedKind, OrderRequest, Queue, RealmEventWhat, Resident, WorldState,
};
use serde_json::Value;

use crate::conditions::{condition_holds, condition_of, condition_place_problem, Holds};
use crate::events::record_event;
use crate::order_sender::{commands, realm_of, OrderSender};
use crate::orders::{leave_armies, OrderKind, OrderKinds};
use crate::queries::residents::is_down;
use crate::queue::{
    field_str, queue_steps_problem, request_steps, runs_script, QueueItemRequest, QueueStepRequest,
    QUEUE_STEP_KINDS, WAIT_UNTIL,
};
use crate::queue_tree::{
    advance, begin, block_ids, depth_of, ids_of, kept_items, mark_started, rounds_of,
    rounds_problem, settle_rounds, Advance, Rounds,
};
use crate::sight::InvariantViolation;
use crate::tick::{RunQueues, Scratch};

/// Ticks in a game minute.
const TICKS_PER_GAME_MINUTE: f64 = TICKS_PER_GAME_HOUR / 60.0;

/// A tile as an order names it, `{ x, y }`, rather than a place by its id (`isTile`).
fn is_tile(p: &serde_json::Map<String, Value>) -> bool {
    p.contains_key("x") && p.contains_key("y")
}

use crate::crimes::carriage_organization;
use crate::queries::vessels::vessel_by_id;

/// Why a step can't name the vessel `id` (`CONTEXT.md`: Beside a vessel, Rowing): it must be
/// there and the realm's. A step never steals one, as it never steals a carriage.
fn vessel_problem(world: &WorldState, realm_id: &str, id: &str) -> Option<&'static str> {
    match vessel_by_id(world, id) {
        None => Some("no such boat"),
        Some(v) if v.realm_id.as_deref() != Some(realm_id) => Some("not a boat of your realm"),
        Some(_) => None,
    }
}

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
    let spot = f.get("spot");
    let spot_carriage = spot.and_then(|s| s.get("carriageId"));
    // A boat a step boards, rows or loads must be the realm's, as a carriage must
    // (`CONTEXT.md`: Beside a vessel, Rowing); a board's `carriageId` may name one too.
    let vessel_ids = [f.get("vesselId"), spot.and_then(|s| s.get("vesselId"))];
    for id in vessel_ids.into_iter().flatten() {
        let Some(id) = id.as_str() else { continue };
        if let Some(problem) = vessel_problem(world, realm_id, id) {
            return Some(problem);
        }
    }
    // A building a step names may be gone by now, as one a saved queue kept after it was torn
    // down (`CONTEXT.md`: Saved queue): the step is given, and skipped when its turn comes. So
    // may a store's or fetch's storage, which no carriage or boat is.
    let ids =
        [f.get("carriageId"), spot_carriage].into_iter().flatten().chain(places.iter().copied());
    for id in ids {
        let Some(id) = id.as_str() else { continue };
        if vessel_by_id(world, id).is_some() {
            if let Some(problem) = vessel_problem(world, realm_id, id) {
                return Some(problem);
            }
            continue;
        }
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
    steps: &[&QueueStepRequest],
    checked: impl Fn(&QueueStepRequest) -> bool,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    for (i, s) in steps.iter().enumerate() {
        if !checked(s) {
            continue;
        }
        // A Wait until's condition asks only about places of the realm (`CONTEXT.md`: Condition).
        if s.order.kind == WAIT_UNTIL {
            let problem = condition_of(s.order.fields.get("condition"))
                .ok()
                .and_then(|c| condition_place_problem(world, realm_id, &c));
            if let Some(problem) = problem {
                return Some(format!("step {}: {problem}", i + 1));
            }
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

/// The items a request sends, steps and blocks, once `queue_steps_problem` passed them.
fn items_of(order: &OrderRequest) -> Vec<QueueItemRequest> {
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
        queue_steps_problem(raw).or_else(|| {
            let items = items_of(order);
            places_problem(world, &realm_id, &request_steps(&items), |_| true, terrain)
        })
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
        // Steps and blocks get their ids from 1 in the order listed, a block before its items.
        let mut next_step_id = 1;
        let items = kept_items(&items_of(order), &mut next_step_id, &Rounds::new());
        // A queue is an order of their own, so they leave their army (`CONTEXT.md`: Army).
        let id = world.residents[i].id.clone();
        leave_armies(world, &HashSet::from([id]));
        let r = &mut world.residents[i];
        r.order = None;
        let mut q = Queue {
            realm_id,
            items,
            current: 0,
            started_at: None,
            r#loop: loop_of(order) == Ok(Some(true)),
            next_step_id,
            started: false,
        };
        begin(&mut q);
        r.queue = Some(q);
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
        // An item's `id` as sent, and whether it is a block: anything there counts as given, as
        // `s.id === undefined` does.
        let mut ids: Vec<(&Value, bool)> = Vec::new();
        sent_ids(&raw, &mut ids);
        let distinct: HashSet<String> = ids.iter().map(|(v, _)| v.to_string()).collect();
        if distinct.len() != ids.len() {
            return Some("a step is in the list twice".into());
        }
        let steps: Vec<u32> = q.steps().iter().map(|s| s.id).collect();
        let blocks = block_ids(&q.items);
        let known = |v: &Value, block: bool| {
            let list = if block { &blocks } else { &steps };
            v.as_f64().is_some_and(|id| list.iter().any(|&s| f64::from(s) == id))
        };
        if !ids.iter().all(|&(v, block)| known(v, block)) {
            return Some("no such step in the queue".into());
        }
        // Only the steps added are checked: one already there whose place is gone since is
        // skipped when its turn comes, and can still be edited until then.
        let items = items_of(order);
        places_problem(world, &realm_id, &request_steps(&items), |s| s.id.is_none(), terrain)
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
        // The current step's number top to bottom, for the step in its place should it go.
        let at = q.current_index().unwrap_or(0);
        let rounds = rounds_of(&q.items);
        q.items = kept_items(&items_of(order), &mut q.next_step_id, &rounds);
        if let Ok(Some(l)) = loop_of(order) {
            q.r#loop = l;
        }
        let steps: Vec<u32> = q.steps().iter().map(|s| s.id).collect();
        if steps.contains(&q.current) {
            // The current step keeps going, but with the request and duration as edited; each
            // block keeps its round by its id.
            settle_rounds(q);
            return;
        }
        // The current step was removed: it stops, and the one in its place starts.
        let next = match steps.get(at) {
            Some(&id) => Some(id),
            None if q.r#loop => steps.first().copied(),
            None => None,
        };
        stop_step(r);
        let Some(next) = next else {
            r.queue = None;
            return;
        };
        if let Some(q) = r.queue.as_mut() {
            q.current = next;
            q.started_at = None;
            settle_rounds(q);
        }
    }
}

/// The ids a request's items carry, with whether each is a block's, top to bottom.
fn sent_ids<'a>(items: &'a [Value], out: &mut Vec<(&'a Value, bool)>) {
    for item in items {
        let block = item.get("repeat").is_some();
        if let Some(id) = item.get("id") {
            out.push((id, block));
        }
        if let Some(Value::Array(inner)) = item.get("items").filter(|_| block) {
            sent_ids(inner, out);
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
            // Whether the queue already moved across a block's edge this tick.
            let mut crossed = false;
            if let Some(started_at) = q.started_at {
                let step = q.current_step().expect("current names a step");
                let time_up = step
                    .minutes
                    .is_some_and(|m| world.tick as f64 - started_at >= m * TICKS_PER_GAME_MINUTE);
                // A Wait until is done once its condition holds, checked from the tick after it
                // started, so one that already holds can't spin (`CONTEXT.md`: Wait until).
                let held = (step.order.kind == WAIT_UNTIL).then(|| {
                    condition_of(step.order.fields.get("condition"))
                        .map_or(Holds::No, |c| condition_holds(world, i, &realm_id, &c))
                });
                let done = match &held {
                    Some(h) => h.yes(),
                    None if runs_script(&step.order) => r.script.is_none(),
                    None => r.order.is_none(),
                };
                if let Some(Holds::PlaceGone(place_id)) = held {
                    place_gone(world, i, &place_id, started_at);
                }
                if !time_up && !done {
                    continue;
                }
                let r = &world.residents[i];
                if time_up {
                    stop_step(&mut world.residents[i]);
                } else if let Some(failure) = failure_of(r, started_at) {
                    skipped(world, i, &failure, false);
                }
                match next(&mut world.residents[i]) {
                    Advance::Ended => continue,
                    Advance::Moved { crossed: c } => crossed = c,
                }
            }
            self.start(world, i, &sender, crossed);
        }
    }

    /// Starts the current step, checked as if given on its own; one that can't start is skipped,
    /// and the next one tried. When none of the queue's steps can start, the queue ends. A queue
    /// moves across a block's edge at most once a tick (ADR 0032): the step past a second one
    /// is tried next tick. `crossed` is whether it already moved across one this tick.
    fn start(&self, world: &mut WorldState, i: usize, sender: &OrderSender, mut crossed: bool) {
        let len = world.residents[i].queue.as_ref().map_or(0, |q| q.steps().len());
        // The steps tried and skipped in a row this tick, each once.
        let mut failed = HashSet::new();
        loop {
            let r = &world.residents[i];
            let Some(q) = &r.queue else { return };
            let step = q.current_step().expect("current names a step");
            let step_id = step.id;
            // A Wait until always starts: the resident stops what they did and stands idle
            // until it ends (`CONTEXT.md`: Wait until).
            if step.order.kind == WAIT_UNTIL {
                let tick = world.tick as f64;
                let r = &mut world.residents[i];
                stop_step(r);
                r.order_ended = None;
                if let Some(q) = r.queue.as_mut() {
                    q.started_at = Some(tick);
                    mark_started(q);
                }
                return;
            }
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
                    mark_started(q);
                }
                return;
            };
            failed.insert(step_id);
            // Where the queue goes next, found before the skip is noted so the note can say
            // the queue ended.
            let mut moved = q.clone();
            let outcome = advance(&mut moved);
            // None could start: every step failed in a row, or a looping queue's pass started
            // none. Past the last step of one that doesn't loop it simply ends.
            let none = failed.len() >= len || (outcome == Advance::Ended && moved.r#loop);
            skipped(world, i, &reason, none);
            let r = &mut world.residents[i];
            let Advance::Moved { crossed: c } = outcome else {
                r.queue = None;
                return;
            };
            if none {
                r.queue = None;
                return;
            }
            r.queue = Some(moved);
            if c {
                if crossed {
                    return;
                }
                crossed = true;
            }
        }
    }
}

impl RunQueues for QueueRunner {
    fn run_all(&mut self, world: &mut WorldState, scratch: &mut Scratch) {
        QueueRunner::run_all(self, world, scratch);
    }
}

/// Moves the queue to its next step (`next`, [`advance`]); it ends instead past its last step.
fn next(r: &mut Resident) -> Advance {
    let Some(q) = r.queue.as_mut() else { return Advance::Ended };
    let outcome = advance(q);
    if outcome == Advance::Ended {
        r.queue = None;
    }
    outcome
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

/// Notes in the realm log that a condition the resident at `i` waits on asks about a place that
/// is gone or no longer the realm's (`CONTEXT.md`: Condition): once for each wait that started at
/// `since`, not every tick it is asked.
fn place_gone(world: &mut WorldState, i: usize, place_id: &str, since: f64) {
    let r = &world.residents[i];
    let noted = world.events.iter().any(|e| {
        e.tick as f64 >= since
            && matches!(&e.what, RealmEventWhat::ConditionPlaceGone { resident_id, place_id: p, .. }
                if *resident_id == r.id && p == place_id)
    });
    let Some(q) = r.queue.as_ref().filter(|_| !noted) else { return };
    let what = RealmEventWhat::ConditionPlaceGone {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        place_id: place_id.to_string(),
    };
    let realm_id = q.realm_id.clone();
    record_event(world, Some(&realm_id), what);
}

/// Notes in the realm log that the resident at `i` skipped their current step (`skipped`).
fn skipped(world: &mut WorldState, i: usize, reason: &str, queue_ended: bool) {
    let r = &world.residents[i];
    let Some(q) = &r.queue else { return };
    let (Some(at), Some(step)) = (q.current_index(), q.current_step()) else { return };
    let what = RealmEventWhat::QueueStepSkipped {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        step: at as f64 + 1.0,
        order: step.order.kind.clone(),
        reason: reason.to_string(),
        queue_ended: queue_ended.then_some(true),
    };
    let realm_id = q.realm_id.clone();
    record_event(world, Some(&realm_id), what);
}

/// Invariant (`queues-sound`, ADR 0004, ADR 0032): every queue has steps, `current` names one of
/// them and it started no later than now, the blocks around it run a round within their counts and
/// the others none, the queue holds no more steps and blocks than a queue may and nests them no
/// deeper, its ids are unique and below `nextStepId`, and no step is a queue.
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
        let steps = q.steps();
        if q.current_step().is_none() {
            fail(format!("is at step id {}, not one of its {} steps", q.current, steps.len()));
        } else if let Some(problem) = rounds_problem(q) {
            fail(problem);
        }
        let written = ids_of(&q.items).len();
        let depth = depth_of(&q.items);
        if written as f64 > QUEUE_MAX_STEPS || f64::from(depth) > QUEUE_MAX_DEPTH {
            fail(format!("holds {written} steps and blocks, nested {depth} deep"));
        }
        if let Some(s) = q.started_at.filter(|&s| s > world.tick as f64) {
            fail(format!(
                "started a step at tick {}, after {}",
                csp_lang::js::number_to_string(s),
                world.tick
            ));
        }
        let ids = ids_of(&q.items);
        let distinct: HashSet<u32> = ids.iter().copied().collect();
        if distinct.len() != ids.len() || ids.iter().any(|&id| id >= q.next_step_id) {
            let list: Vec<String> = ids.iter().map(u32::to_string).collect();
            fail(format!("has step ids {} with {} next", list.join(", "), q.next_step_id));
        }
        for s in steps {
            if !QUEUE_STEP_KINDS.contains(&s.order.kind.as_str()) {
                fail(format!("holds a {} step", s.order.kind));
            }
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests;

#[cfg(test)]
mod boat_tests;
