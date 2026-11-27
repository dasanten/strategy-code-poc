//! The random-order run (ADR 0048, Epic 125): random order requests given to a small world, a
//! Player's way (`receive`, the queue, `run_tick`), with every world invariant checked after every
//! tick. Nobody wrote the scenarios, so it finds the order a rule forgot. Test-only.
//!
//! The run's random numbers are its own ([`Draws`]), never the simulation's: the same seed gives
//! the same orders, and the simulation, being deterministic, the same run.
//!
//! Every order kind is given: [`generators::GENERATORS`] makes each kind's requests, and the world
//! ([`world::random_world`]) has what the kinds need. Residents also run queues and the default
//! scripts, so orders come from the queue runner and the scripts too.

pub mod generators;
pub mod world;

use std::fmt::Write as _;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, BuildingKind, Resident, WorldState};
use serde_json::{json, Map, Value};

use crate::invariants::InvariantViolation;
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::script_runner::default_host::DefaultScripts;
use crate::tick::{run_tick, Scratch, ScriptErrorWhere, TickHealth, TickOptions, TickReporter};
use crate::walking::Walking;
use generators::GENERATORS;

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
    pub busy: Busy,
}


/// How busy the residents were with orders that come from elsewhere than the run's requests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Busy {
    /// Resident-ticks with a queue, whose steps the queue runner gives.
    pub queued: u64,
    /// Resident-ticks with a running script, whose orders the script runner gives.
    pub scripted: u64,
    /// Requests accepted for a resident that had a queue or a script then.
    pub interrupted: u64,
}

/// Whether the resident runs a queue or a script.
fn busy_now(world: &WorldState, id: &str) -> bool {
    world.residents.iter().any(|r| r.id == id && (r.queue.is_some() || r.script.is_some()))
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

/// Requests given each tick, each for a Player's resident drawn at random.
const REQUESTS_PER_TICK: usize = 6;
/// How often, against an idle one, a resident running a queue or a script is drawn: random
/// orders interrupt them now and then, not at once.
const BUSY_WEIGHT: usize = 1;
const IDLE_WEIGHT: usize = 4;
/// The share of requests that walk the resident to something in the world, so that residents
/// spread out and stand where other orders need them.
const WALKS: f64 = 0.15;
/// The share of requests sent by another Player than the resident's own.
const FROM_ANOTHER_PLAYER: f64 = 0.05;
/// The share of requests with a field left out.
const FIELD_LEFT_OUT: f64 = 0.05;
/// The share of requests with a field of nonsense of the wrong type.
const NONSENSE: f64 = 0.03;
/// The share of requests about another resident of the world than the entry chose.
const SOMEONE_ELSE: f64 = 0.02;

/// The order kinds the run gives, with the script orders a host adds (here the game's default
/// scripts, as `DefaultScripts` runs them), and the runner of the residents' scripts.
pub fn run_kinds(terrain: Arc<TerrainMap>, users: &[u64]) -> DefaultScripts {
    let senders: Vec<OrderSender> =
        users.iter().map(|u| OrderSender::player(*u, &format!("Player {u}"))).collect();
    DefaultScripts::new(terrain, &senders)
}

/// Runs `ticks` ticks of random orders on `world` from `seed`. Every world invariant
/// (`check_all`'s, with the tick's ledgers, as the game runs them) is checked after every tick;
/// the first tick that breaks one, or panics, ends the run as a [`Failure`]. The first tick's
/// requests give some residents of each realm a looping queue and some a task, which their
/// default script carries out, so that orders also come from the queues and the scripts.
pub fn random_run(
    world: &mut WorldState,
    terrain: TerrainMap,
    seed: u64,
    ticks: u64,
) -> Result<Outcome, Box<Failure>> {
    let terrain = Arc::new(terrain);
    let users: Vec<u64> = world.realms.iter().map(|r| r.user_id).collect();
    let mut scripts = run_kinds(terrain.clone(), &users);
    let mut queues = scripts.queue_runner(Some(terrain.clone()));
    let mut queue = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
    let mut walking = Walking::without_budget(terrain.clone());
    let mut scratch = Scratch::default();
    let mut draws = Draws::new(seed);
    let mut given: Vec<Given> = Vec::new();
    let mut busy = Busy::default();
    let fail = |tick, broke, given: &Vec<Given>| {
        Box::new(Failure { seed, tick, broke, given: given.clone() })
    };
    for tick in 0..ticks {
        // Kept fed, so the run is about orders, not hunger.
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        let requests = if tick == 0 {
            first_requests(world)
        } else {
            requests(&mut draws, world, &terrain, &users)
        };
        for r in &world.residents {
            busy.queued += u64::from(r.queue.is_some());
            busy.scripted += u64::from(r.script.is_some());
        }
        for (user_id, order) in requests {
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
            if refused.is_none() && order["residentId"].as_str().is_some_and(|id| busy_now(world, id)) {
                busy.interrupted += 1;
            }
            given.push(Given { tick: world.tick, user_id, order, refused });
        }
        let mut kept = Kept::default();
        let mut every_tick = || 0.0;
        let mut opts = TickOptions::new(&mut kept, 1.0, f64::INFINITY);
        opts.walking = Some(&mut walking);
        opts.orders = Some(&mut queue);
        opts.queues = Some(&mut queues);
        opts.scripts = Some(&mut scripts.runner);
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
    Ok(Outcome { seed, given, busy })
}

/// What starts the run: in each realm two residents walk a looping queue between their town hall
/// and their storage, and two more are given Work at their farm, which their default script
/// carries out.
fn first_requests(world: &WorldState) -> Vec<(u64, Value)> {
    let mut out = Vec::new();
    for realm in &world.realms {
        let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.id.as_str()));
        let Some(city) = city else { continue };
        let of = |kind: BuildingKind| {
            world.buildings.iter().find(|b| b.kind == kind && b.city_id.as_ref() == Some(&city.id))
        };
        let (Some(hall), Some(storage)) = (of(BuildingKind::TownHall), of(BuildingKind::Storage))
        else {
            continue;
        };
        let own: Vec<&Resident> = world
            .residents
            .iter()
            .filter(|r| r.owner.as_deref() == Some(realm.id.as_str()))
            .filter(|r| !r.id.starts_with(world::PLACED) && r.id != realm.leader_id)
            .collect();
        let walk = |b: &Building| {
            json!({ "order": { "kind": "walkTo", "x": b.x as i64, "y": b.y as i64 }, "minutes": 2 })
        };
        for r in own.iter().take(2) {
            let steps = json!([walk(hall), walk(storage)]);
            let q = json!({ "kind": "queue", "residentId": r.id, "steps": steps, "loop": true });
            out.push((realm.user_id, q));
        }
        let farm = of(BuildingKind::Farm).map(|b| b.id.as_str());
        for r in own.iter().skip(2).take(2) {
            let o = json!({
                "kind": "task", "task": "work", "residentId": r.id, "workplaceId": farm,
            });
            out.push((realm.user_id, o));
        }
    }
    out
}

/// A tick's random requests: each for a Player's resident drawn at random (one running a queue or
/// a script less often), of a kind drawn at random, made by its entry and then perhaps spoiled.
fn requests(
    draws: &mut Draws,
    world: &WorldState,
    terrain: &TerrainMap,
    users: &[u64],
) -> Vec<(u64, Value)> {
    let mut drawn: Vec<&Resident> = Vec::new();
    for r in &world.residents {
        let Some(realm) = r.owner.as_deref() else { continue };
        if r.id.starts_with(world::PLACED) || !world.realms.iter().any(|x| x.id == realm) {
            continue;
        }
        let busy = r.queue.is_some() || r.script.is_some();
        let weight = if busy { BUSY_WEIGHT } else { IDLE_WEIGHT };
        drawn.extend(std::iter::repeat_n(r, weight));
    }
    let mut out = Vec::new();
    for _ in 0..REQUESTS_PER_TICK {
        let Some(me) = draws.pick(&drawn).copied() else { break };
        let realm = me.owner.as_deref().expect("a Player's resident");
        let own_user = world.realms.iter().find(|r| r.id == realm).map_or(0, |r| r.user_id);
        let user = if draws.chance(FROM_ANOTHER_PLAYER) {
            *draws.pick(users).unwrap_or(&own_user)
        } else {
            own_user
        };
        let kind =
            if draws.chance(WALKS) { "walkTo" } else { draws.pick(GENERATORS).expect("kinds").0 };
        let mut g = generators::Gen { draws: std::cell::RefCell::new(&mut *draws), world, terrain, me, realm, user };
        let mut fields = generators::make(&mut g, kind);
        spoil(draws, world, &mut fields);
        fields.insert("kind".into(), json!(kind));
        out.push((user, Value::Object(fields)));
    }
    out
}

/// Now and then a field left out, a field of nonsense, or another resident of the world.
fn spoil(draws: &mut Draws, world: &WorldState, fields: &mut Map<String, Value>) {
    let names: Vec<String> = fields.keys().cloned().collect();
    if draws.chance(FIELD_LEFT_OUT) {
        if let Some(name) = draws.pick(&names) {
            fields.remove(name);
        }
    }
    if draws.chance(NONSENSE) {
        if let Some(name) = draws.pick(&names) {
            let value = nonsense(draws);
            fields.insert(name.clone(), value);
        }
    }
    if draws.chance(SOMEONE_ELSE) && fields.contains_key("residentId") {
        let all: Vec<&str> = world.residents.iter().map(|r| r.id.as_str()).collect();
        fields.insert("residentId".into(), json!(draws.pick(&all).copied().unwrap_or("nobody")));
    }
}

fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic".into())
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
