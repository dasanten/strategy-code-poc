//! The random-order run (ADR 0048, Epic 125): random order requests given to a small world, a
//! Player's way (`receive`, the queue, `run_tick`), with every world invariant checked after every
//! tick. Nobody wrote the scenarios, so it finds the order a rule forgot. Test-only.
//!
//! The run's random numbers are its own ([`Draws`]), never the simulation's: the same seed gives
//! the same orders, and the simulation, being deterministic, the same run.

use std::fmt::Write as _;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, Good, WorldState};
use serde_json::{json, Map, Value};

use crate::invariants::InvariantViolation;
use crate::order_meta::ORDER_METAS;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::script_actions::Request;
use crate::tick::{run_tick, Scratch, ScriptErrorWhere, TickHealth, TickOptions, TickReporter};
use crate::walking::Walking;

/// The run's own random numbers (splitmix64), seeded by the run's seed.
pub struct Draws(u64);

impl Draws {
    pub fn new(seed: u64) -> Self {
        Draws(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A whole number in [0, n); 0 when n is 0.
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() % n as u64) as usize
        }
    }

    /// True with chance `p`.
    pub fn chance(&mut self, p: f64) -> bool {
        ((self.next() >> 11) as f64 / (1u64 << 53) as f64) < p
    }

    /// One of `items`, if there are any.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> Option<&'a T> {
        let i = self.below(items.len());
        items.get(i)
    }

    /// A whole number in [lo, hi].
    pub fn between(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as usize) as i64
    }
}

/// An order request given during the run, and how it was answered.
#[derive(Debug, Clone)]
pub struct Given {
    /// The tick of the world when it was given; it is applied at the start of the next.
    pub tick: u64,
    pub user_id: u64,
    pub order: Value,
    /// Why `validate` refused it; `None` when it was accepted.
    pub refused: Option<String>,
}

/// What broke a run.
#[derive(Debug, Clone)]
pub enum Broke {
    Invariants(Vec<InvariantViolation>),
    /// A tick, or the checking of an order, panicked, or the game failed running a script.
    Panic(String),
}

/// A run that broke: its seed, the tick, what broke and every order given up to then.
#[derive(Debug, Clone)]
pub struct Failure {
    pub seed: u64,
    pub tick: u64,
    pub broke: Broke,
    pub given: Vec<Given>,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "random-order run of seed {} broke at tick {}:", self.seed, self.tick)?;
        match &self.broke {
            Broke::Invariants(vs) => {
                for v in vs {
                    writeln!(f, "  {}: {} {:?}", v.invariant, v.message, v.entity_ids)?;
                }
            }
            Broke::Panic(m) => writeln!(f, "  panicked: {m}")?,
        }
        let accepted: Vec<&Given> = self.given.iter().filter(|g| g.refused.is_none()).collect();
        writeln!(
            f,
            "replay: the same world, seed {}, {} ticks; the {} accepted orders of {} given, by tick:",
            self.seed,
            self.tick,
            accepted.len(),
            self.given.len()
        )?;
        for g in accepted {
            writeln!(f, "  tick {} player {}: {}", g.tick, g.user_id, g.order)?;
        }
        Ok(())
    }
}

/// How a run went: the requests accepted and refused, and every one given.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub seed: u64,
    pub given: Vec<Given>,
}

impl Outcome {
    pub fn accepted(&self) -> usize {
        self.given.iter().filter(|g| g.refused.is_none()).count()
    }

    pub fn refused(&self) -> usize {
        self.given.len() - self.accepted()
    }

    /// The order kinds accepted at least once, by name.
    pub fn kinds_accepted(&self) -> Vec<String> {
        let mut kinds: Vec<String> = self
            .given
            .iter()
            .filter(|g| g.refused.is_none())
            .filter_map(|g| g.order["kind"].as_str().map(str::to_string))
            .collect();
        kinds.sort();
        kinds.dedup();
        kinds
    }
}

/// What the tick reports, kept to be looked at once it is over.
#[derive(Default)]
struct Kept {
    violations: Vec<InvariantViolation>,
    errors: Vec<String>,
}

impl TickReporter for Kept {
    fn invariant_violations(&mut self, _: &WorldState, violations: &[InvariantViolation]) {
        self.violations.extend_from_slice(violations);
    }
    fn tick_health(&mut self, _: &WorldState, _: &TickHealth) {}
    fn tick_error(&mut self, _: &WorldState, error: &str) {
        self.errors.push(format!("tick panicked: {error}"));
    }
    fn script_error(&mut self, _: &WorldState, error: &str, _: &ScriptErrorWhere) {
        self.errors.push(format!("script error: {error}"));
    }
}

/// The share of a Player's residents given a random order each tick.
const ORDERS_PER_RESIDENT: f64 = 0.15;
/// The share of requests that walk the resident to something in the world, so that residents
/// spread out and stand where other orders need them.
const WALKS: f64 = 0.2;
/// The share of requests sent by another Player than the resident's own.
const FROM_ANOTHER_PLAYER: f64 = 0.1;
/// The share of fields left out of a request.
const FIELD_LEFT_OUT: f64 = 0.1;
/// The share of field values that are nonsense of the wrong type.
const NONSENSE: f64 = 0.05;

/// Runs `ticks` ticks of random orders on `world` from `seed`. Every world invariant (`check_all`'s, with the
/// tick's ledgers, as the game runs them) is checked after every tick; the first tick that breaks
/// one, or panics, ends the run as a [`Failure`].
pub fn random_run(
    world: &mut WorldState,
    terrain: TerrainMap,
    seed: u64,
    ticks: u64,
) -> Result<Outcome, Box<Failure>> {
    let terrain = Arc::new(terrain);
    let kinds = order_kinds();
    let names: Vec<&'static str> =
        ORDER_METAS.iter().map(|m| m.kind).filter(|k| kinds.contains(k)).collect();
    let mut queue = OrderQueue::new(kinds, Some(terrain.clone()));
    let mut walking = Walking::without_budget(terrain.clone());
    let mut scratch = Scratch::default();
    let mut draws = Draws::new(seed);
    let mut given: Vec<Given> = Vec::new();
    let users: Vec<u64> = world.realms.iter().map(|r| r.user_id).collect();
    let fail = |tick, broke, given: &Vec<Given>| {
        Box::new(Failure { seed, tick, broke, given: given.clone() })
    };
    for _ in 0..ticks {
        // Kept fed, so the run is about orders, not hunger.
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        let pool = Pool::of(world, terrain.size);
        for owner in pool.player_residents(world) {
            if !draws.chance(ORDERS_PER_RESIDENT) {
                continue;
            }
            let (resident_id, realm_id) = owner;
            let own_user = world.realms.iter().find(|r| r.id == realm_id).map_or(0, |r| r.user_id);
            let user_id = if draws.chance(FROM_ANOTHER_PLAYER) {
                *draws.pick(&users).unwrap_or(&own_user)
            } else {
                own_user
            };
            let order = if draws.chance(WALKS) {
                let (x, y) = draws.pick(&pool.tiles).copied().unwrap_or((0, 0));
                json!({ "kind": "walkTo", "residentId": resident_id, "x": x, "y": y })
            } else {
                let kind = *draws.pick(&names).expect("order kinds");
                random_order(&mut draws, &pool, kind, &resident_id)
            };
            let sender = OrderSender::player(user_id, &format!("Player {user_id}"));
            let reply = catch_unwind(AssertUnwindSafe(|| {
                queue.receive(world, &sender, &json!("random"), &order)
            }));
            let refused = match reply {
                Ok(OrderReply::Ack { .. }) => None,
                Ok(OrderReply::Rejected { reason, .. }) => Some(reason),
                Err(p) => {
                    given.push(Given { tick: world.tick, user_id, order, refused: None });
                    return Err(fail(world.tick, Broke::Panic(panic_text(p.as_ref())), &given));
                }
            };
            given.push(Given { tick: world.tick, user_id, order, refused });
        }
        let mut kept = Kept::default();
        let mut every_tick = || 0.0;
        let mut opts = TickOptions::new(&mut kept, 1.0, f64::INFINITY);
        opts.walking = Some(&mut walking);
        opts.orders = Some(&mut queue);
        opts.now = Some(Box::new(|| 0.0));
        opts.rand = Some(&mut every_tick);
        run_tick(world, &terrain, &mut scratch, opts);
        if let Some(e) = kept.errors.first() {
            return Err(fail(world.tick, Broke::Panic(e.clone()), &given));
        }
        if !kept.violations.is_empty() {
            return Err(fail(world.tick, Broke::Invariants(kept.violations), &given));
        }
    }
    Ok(Outcome { seed, given })
}

fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic".into())
}

/// What a request can name: the ids of everything in the world, by the list it is in, and the
/// tiles where things are.
struct Pool {
    /// The ids of each list of the world (`residents`, `buildings`, `offers`, ...).
    ids: Map<String, Value>,
    /// Where each id with a place is.
    at: std::collections::HashMap<String, (i64, i64)>,
    tiles: Vec<(i64, i64)>,
    size: i64,
}

impl Pool {
    /// Everything the world has an id for, read from its saved form so a new list is in it
    /// without an edit here.
    fn of(world: &WorldState, size: i32) -> Pool {
        let saved = serde_json::to_value(world).expect("a world saves");
        let mut ids = Map::new();
        let mut tiles = Vec::new();
        let mut at = std::collections::HashMap::new();
        for (list, items) in saved.as_object().expect("a world is an object") {
            let Some(items) = items.as_array() else { continue };
            let of_list: Vec<Value> = items
                .iter()
                .filter_map(|it| it.get("id").filter(|id| id.is_string()).cloned())
                .collect();
            for it in items {
                if let (Some(x), Some(y)) =
                    (it.get("x").and_then(Value::as_f64), it.get("y").and_then(Value::as_f64))
                {
                    let tile = (x.floor() as i64, y.floor() as i64);
                    tiles.push(tile);
                    if let Some(id) = it.get("id").and_then(Value::as_str) {
                        at.insert(id.to_string(), tile);
                    }
                }
            }
            if !of_list.is_empty() {
                ids.insert(list.clone(), Value::Array(of_list));
            }
        }
        Pool { ids, at, tiles, size: size as i64 }
    }

    /// Each resident a Player's realm owns, with that realm.
    fn player_residents(&self, world: &WorldState) -> Vec<(String, String)> {
        world
            .residents
            .iter()
            .filter_map(|r| {
                let realm = r.owner.as_deref()?;
                world.realms.iter().any(|x| x.id == realm).then(|| (r.id.clone(), realm.into()))
            })
            .collect()
    }

    /// An id from the world lists `lists`, or from any list when they have none; half the time
    /// one near `near` when there is one, since most orders need their target close by.
    fn id(&self, draws: &mut Draws, lists: &[&str], near: (i64, i64)) -> Value {
        let mut candidates: Vec<&Value> = Vec::new();
        for l in lists {
            if let Some(Value::Array(a)) = self.ids.get(*l) {
                candidates.extend(a);
            }
        }
        if candidates.is_empty() {
            candidates = self.ids.values().filter_map(Value::as_array).flatten().collect();
        }
        if draws.chance(0.5) {
            let close: Vec<&Value> = candidates
                .iter()
                .copied()
                .filter(|v| {
                    let p = v.as_str().and_then(|id| self.at.get(id));
                    p.is_some_and(|p| (p.0 - near.0).abs() <= 2 && (p.1 - near.1).abs() <= 2)
                })
                .collect();
            if !close.is_empty() {
                candidates = close;
            }
        }
        draws.pick(&candidates).map_or(json!("nobody"), |v| (*v).clone())
    }

    /// A tile at or next to something in the world, half the time to `near`.
    fn tile(&self, draws: &mut Draws, near: (i64, i64)) -> (i64, i64) {
        let (x, y) = if draws.chance(0.5) {
            near
        } else {
            draws.pick(&self.tiles).copied().unwrap_or((0, 0))
        };
        let wrap = |v: i64| v.rem_euclid(self.size);
        (wrap(x + draws.between(-3, 3)), wrap(y + draws.between(-3, 3)))
    }
}

/// The fields a request of `kind` has, as its script actions name them; for a kind no script
/// action asks for, every field any action names (and those only such kinds read), each half
/// the time: a field a kind doesn't read is left alone.
fn fields_of(kind: &str, draws: &mut Draws) -> Vec<&'static str> {
    let field = |name: &'static str| name.trim_end_matches('?');
    let named = |m: &crate::order_meta::OrderMeta| -> Vec<&'static str> {
        m.script
            .iter()
            .flat_map(|a| match a.request {
                Request::Fields(args) => args.iter().map(|x| field(x.field)).collect::<Vec<_>>(),
                Request::ByHand(params) => params.iter().map(|p| field(p)).collect(),
            })
            .collect()
    };
    let meta = ORDER_METAS.iter().find(|m| m.kind == kind).expect("a declared kind");
    let mut fields = named(meta);
    if fields.is_empty() {
        let mut every: Vec<&'static str> = ORDER_METAS.iter().flat_map(|m| named(m)).collect();
        every.extend(ONLY_REQUESTED);
        every.sort();
        every.dedup();
        fields = every.into_iter().filter(|_| draws.chance(0.5)).collect();
    }
    fields.sort();
    fields.dedup();
    fields
}

/// Fields read by kinds no script action asks for, so no action names them.
const ONLY_REQUESTED: &[&str] = &[
    "open",
    "name",
    "gateId",
    "armyId",
    "residentIds",
    "realmId",
    "residents",
    "soldiers",
    "days",
    "pricePerWeek",
    "contractId",
    "weeks",
    "allianceId",
    "realmName",
    "steps",
    "waypointId",
];

/// A random request of `kind` about resident `resident_id`, its fields filled from the world.
fn random_order(draws: &mut Draws, pool: &Pool, kind: &str, resident_id: &str) -> Value {
    let mut order = Map::new();
    order.insert("kind".into(), json!(kind));
    order.insert("residentId".into(), json!(resident_id));
    let near = pool.at.get(resident_id).copied().unwrap_or((0, 0));
    let (x, y) = pool.tile(draws, near);
    for name in fields_of(kind, draws) {
        if name == "kind" || draws.chance(FIELD_LEFT_OUT) {
            continue;
        }
        let value = if draws.chance(NONSENSE) {
            nonsense(draws)
        } else {
            match name {
                "x" => json!(x),
                "y" => json!(y),
                "steps" => queue_steps(draws, pool, resident_id),
                _ => value_for(draws, pool, name, (x, y), near),
            }
        };
        order.insert(name.into(), value);
    }
    // Now and then about someone else of the world.
    if draws.chance(0.05) {
        order.insert("residentId".into(), pool.id(draws, &["residents"], near));
    }
    Value::Object(order)
}

/// The steps of a queue: one to three random requests of kinds a queue can hold.
fn queue_steps(draws: &mut Draws, pool: &Pool, resident_id: &str) -> Value {
    let kinds: Vec<&str> = ORDER_METAS.iter().filter(|m| m.queue_step).map(|m| m.kind).collect();
    let n = draws.between(1, 3);
    let steps: Vec<Value> = (0..n)
        .map(|_| {
            let kind = *draws.pick(&kinds).unwrap_or(&"walkTo");
            let mut order = random_order(draws, pool, kind, resident_id);
            if let Some(o) = order.as_object_mut() {
                o.remove("residentId");
            }
            json!({ "order": order })
        })
        .collect();
    json!(steps)
}

/// What a training ground teaches.
const SUBJECTS: &[&str] = &[
    "strength",
    "endurance",
    "agility",
    "intellect",
    "mining",
    "woodcutting",
    "smelting",
    "smithing",
    "construction",
    "farming",
    "combat",
    "driving",
];

/// A value of the wrong kind, as a careless client might send.
fn nonsense(draws: &mut Draws) -> Value {
    let choices =
        [json!(null), json!(-1), json!(1.5), json!("nope"), json!(true), json!([]), json!({})];
    draws.pick(&choices).cloned().unwrap_or(Value::Null)
}

/// A good's name.
fn good(draws: &mut Draws) -> Value {
    serde_json::to_value(draws.pick(Good::ALL).expect("goods")).expect("a good")
}

/// A value for the field `name` of a request, guessed from its name and taken from the world.
fn value_for(
    draws: &mut Draws,
    pool: &Pool,
    name: &str,
    at: (i64, i64),
    near: (i64, i64),
) -> Value {
    let tile = |draws: &mut Draws| {
        let (x, y) = pool.tile(draws, at);
        json!({ "x": x, "y": y })
    };
    match name {
        "material" if draws.chance(0.8) => json!(if draws.chance(0.5) { "wood" } else { "stone" }),
        "good" | "gives" | "wants" | "makes" | "material" | "food" => good(draws),
        "slot" => json!(draws.pick(&["weapon", "shield", "armour"]).copied().unwrap_or("weapon")),
        "subject" => json!(draws.pick(SUBJECTS).copied().unwrap_or("strength")),
        "building" | "buildingKind" => {
            serde_json::to_value(draws.pick(BuildingKind::ALL).expect("kinds")).expect("a kind")
        }
        "goods" => {
            let mut m = Map::new();
            m.insert(good(draws).as_str().unwrap_or("food").into(), json!(draws.between(1, 10)));
            Value::Object(m)
        }
        "from" | "to" | "at" | "tile" => {
            if draws.chance(0.6) {
                tile(draws)
            } else {
                pool.id(draws, &["buildings", "carriages"], near)
            }
        }
        "open" | "unload" | "asCrew" | "shoot" | "loop" | "ownFood" | "keep" => {
            json!(draws.chance(0.5))
        }
        "name" | "realmName" | "note" | "cityName" => {
            json!(draws.pick(&["Ash", "Brook", "Cole", ""]).copied().unwrap_or("Ash"))
        }
        _ if name.ends_with("Ids") || name == "group" => {
            let n = draws.between(1, 3);
            json!((0..n).map(|_| pool.id(draws, &lists_for(name), near)).collect::<Vec<_>>())
        }
        _ if name.ends_with("Id") || name == "target" => pool.id(draws, &lists_for(name), near),
        _ if is_count(name) => json!(draws.between(0, 12)),
        _ => nonsense(draws),
    }
}

/// Whether a field is a count of something.
fn is_count(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        "units",
        "times",
        "count",
        "amount",
        "days",
        "weeks",
        "soldiers",
        "residents",
        "price",
        "n",
        "load",
    ]
    .iter()
    .any(|w| lower.ends_with(w))
}

/// The world lists an id field names a thing of, by the field's name; none means any list.
fn lists_for(name: &str) -> Vec<&'static str> {
    let base = name.trim_end_matches("Ids").trim_end_matches("Id").to_ascii_lowercase();
    let lists: &[&str] = match base.as_str() {
        "resident" | "partner" | "heir" | "newleader" | "leader" | "member" | "residents" => {
            &["residents"]
        }
        "building" | "storage" | "stable" | "wall" | "gate" | "workplace" | "home" | "haven"
        | "site" | "warehouse" => &["buildings"],
        "city" | "fromcity" | "tocity" => &["cities"],
        "realm" | "to" => &["realms"],
        "horse" | "horses" => &["horses"],
        "carriage" | "vessel" | "machine" | "boat" => &["carriages"],
        "army" => &["armies"],
        "offer" => &["offers"],
        "contract" => &["contracts"],
        "alliance" => &["alliances"],
        "directive" => &["directives"],
        "demand" => &["demands"],
        "target" => &["residents", "buildings", "horses", "carriages"],
        _ => &[],
    };
    lists.to_vec()
}

/// A run's counts, one line, for the PR and the test's output.
pub fn summary(o: &Outcome) -> String {
    let mut s = String::new();
    let _ = write!(
        s,
        "seed {}: {} requests, {} accepted, {} refused, {} kinds accepted",
        o.seed,
        o.given.len(),
        o.accepted(),
        o.refused(),
        o.kinds_accepted().len()
    );
    s
}

#[cfg(test)]
mod tests;
