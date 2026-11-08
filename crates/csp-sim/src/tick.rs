//! One tick of the simulation with monitoring around it (`apps/server/src/tick.ts`, ADR 0004):
//! the phases in their order, their timer, tick health and the reporter it goes to.
//!
//! What the TypeScript passes in as optional collaborators (`TickOptions.orders`, `queues`,
//! `scripts`, `walking`) are traits here, so this file does not change when the tickets that
//! port them land: `OrderQueue` implements [`ApplyOrders`] (T86.2), `QueueRunner` [`RunQueues`]
//! (T86.2), `ScriptRunner` [`RunScripts`] (T86.12) and `Walking` [`Walk`] (T86.4).
//!
//! What the TypeScript keeps beside the world in `WeakMap`s (the open sight cache, the world
//! index, the goods made) is [`Scratch`]: never saved, never world state (ADR 0006), owned by the
//! loop and handed to every rule that needs it.

use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use serde::{Serialize, Serializer};

use crate::goods_made::{tally_goods, GoodsMade};
use crate::invariants::{check_invariants, invariants_for_tick, world_invariants, Invariant};
use crate::sight::{InvariantViolation, SightCache};
use crate::world::step_world;
use crate::world_index::{world_index, WorldIndex};

/// The phases of a tick, in the order they run (ADR 0004). `Npc`, `Walking`, `Rest` and
/// `LastSeen` are the parts of `World`: the [`TOP_LEVEL_PHASES`] add up to the tick, these four
/// to `World`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TickPhase {
    Orders,
    Queues,
    Scripts,
    World,
    Npc,
    Walking,
    Rest,
    LastSeen,
    Invariants,
    Territory,
    Sight,
    Broadcast,
    Save,
}

/// Every phase, in the order they run (`TICK_PHASES`).
pub const TICK_PHASES: [TickPhase; 13] = [
    TickPhase::Orders,
    TickPhase::Queues,
    TickPhase::Scripts,
    TickPhase::World,
    TickPhase::Npc,
    TickPhase::Walking,
    TickPhase::Rest,
    TickPhase::LastSeen,
    TickPhase::Invariants,
    TickPhase::Territory,
    TickPhase::Sight,
    TickPhase::Broadcast,
    TickPhase::Save,
];

/// The phases that together make up a whole tick; the parts of `World` are left out
/// (`TOP_LEVEL_PHASES`).
pub const TOP_LEVEL_PHASES: [TickPhase; 9] = [
    TickPhase::Orders,
    TickPhase::Queues,
    TickPhase::Scripts,
    TickPhase::World,
    TickPhase::Invariants,
    TickPhase::Territory,
    TickPhase::Sight,
    TickPhase::Broadcast,
    TickPhase::Save,
];

impl TickPhase {
    /// The phase's name as tick health reports it.
    pub fn name(self) -> &'static str {
        match self {
            TickPhase::Orders => "orders",
            TickPhase::Queues => "queues",
            TickPhase::Scripts => "scripts",
            TickPhase::World => "world",
            TickPhase::Npc => "npc",
            TickPhase::Walking => "walking",
            TickPhase::Rest => "rest",
            TickPhase::LastSeen => "lastSeen",
            TickPhase::Invariants => "invariants",
            TickPhase::Territory => "territory",
            TickPhase::Sight => "sight",
            TickPhase::Broadcast => "broadcast",
            TickPhase::Save => "save",
        }
    }

    fn slot(self) -> usize {
        self as usize
    }
}

/// How long each phase took, in ms; a phase that did not run is 0 (`Record<TickPhase, number>`).
/// Serialises as an object by phase name, in the phases' order.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Phases([f64; 13]);

impl Phases {
    pub fn get(&self, phase: TickPhase) -> f64 {
        self.0[phase.slot()]
    }

    /// Every phase with its time, in the phases' order.
    pub fn iter(&self) -> impl Iterator<Item = (TickPhase, f64)> + '_ {
        TICK_PHASES.iter().map(|&p| (p, self.get(p)))
    }
}

impl std::ops::Index<TickPhase> for Phases {
    type Output = f64;
    fn index(&self, phase: TickPhase) -> &f64 {
        &self.0[phase.slot()]
    }
}

impl Serialize for Phases {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_map(self.iter().map(|(p, ms)| (p.name(), ms)))
    }
}

/// The phases of a tick, slowest first (`phasesSlowestFirst`); ties keep the phases' order, as
/// JavaScript's stable sort does.
pub fn phases_slowest_first(phases: &Phases) -> Vec<(TickPhase, f64)> {
    let mut out: Vec<_> = phases.iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

/// How one tick went, reported as performance data (ADR 0004).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickHealth {
    pub tick: u64,
    /// The whole tick, from the first order applied to the save written, in ms.
    pub duration_ms: f64,
    /// How long each phase took, in ms; a phase that did not run is 0.
    pub phases: Phases,
    pub residents: usize,
    pub actions: usize,
    /// Milliseconds the game-run cities spent planning (ADR 0016).
    pub npc_plan_ms: f64,
    /// Milliseconds spent noting who came into a City area (ADR 0028), part of the `rest` phase.
    pub outsiders_ms: f64,
    /// The scripts that ran this tick, the Players' and the NPC cities' residents': waiting ones
    /// (`CONTEXT.md`: Running a script, Waiting) and those a realm's budget skipped don't count.
    pub script_runs: usize,
    /// How many times a side's sight was worked out this tick (`SightCache.builds`): about one
    /// per realm or NPC city looking, per phase; one per socket would show here.
    pub sight_builds: u32,
    /// The tick took longer than the slow-tick threshold.
    pub slow: bool,
}

/// A clock in ms, as `performance.now` is.
pub type Clock = Box<dyn Fn() -> f64>;

/// The real clock: ms since it was made.
pub fn wall_clock() -> Clock {
    let start = Instant::now();
    Box::new(move || start.elapsed().as_secs_f64() * 1000.0)
}

/// Times the phases of one tick (`TickTimer`). [`TickTimer::time`] runs a phase and adds what it
/// took to that phase's total; a phase that panics is still counted, then the panic goes on. One
/// timer per tick, shared by [`run_tick`] and the loop's work after it ([`TickOptions::finish`]),
/// so tick health covers the whole tick. Takes `&self`, so a timed phase can time its parts.
pub struct TickTimer {
    phases: RefCell<Phases>,
    now: Clock,
    start: f64,
}

impl Default for TickTimer {
    fn default() -> Self {
        Self::new(wall_clock())
    }
}

impl TickTimer {
    pub fn new(now: Clock) -> Self {
        let start = now();
        TickTimer { phases: RefCell::new(Phases::default()), now, start }
    }

    /// Runs `f` as (part of) `phase` and adds what it took to that phase's total.
    pub fn time<T>(&self, phase: TickPhase, f: impl FnOnce() -> T) -> T {
        struct Count<'a> {
            timer: &'a TickTimer,
            phase: TickPhase,
            from: f64,
        }
        impl Drop for Count<'_> {
            fn drop(&mut self) {
                let took = (self.timer.now)() - self.from;
                self.timer.phases.borrow_mut().0[self.phase.slot()] += took;
            }
        }
        let _count = Count { timer: self, phase, from: (self.now)() };
        f()
    }

    /// Each phase's total so far.
    pub fn phases(&self) -> Phases {
        *self.phases.borrow()
    }

    /// Since the timer was made, in ms.
    pub fn elapsed(&self) -> f64 {
        (self.now)() - self.start
    }
}

/// Where an error of the game's own hit while running scripts (`ScriptErrorWhere`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptErrorWhere {
    pub realm_id: String,
    /// The resident or army whose script ended; none when the whole realm's set-up failed.
    pub entity_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_id: Option<u64>,
}

/// Where a tick sends what it found (`TickReporter`); the server wires this to its logs and
/// Sentry.
pub trait TickReporter {
    fn invariant_violations(&mut self, world: &WorldState, violations: &[InvariantViolation]);
    fn tick_health(&mut self, world: &WorldState, health: &TickHealth);
    /// The tick panicked (the TypeScript's thrown error): `error` is the panic's message.
    fn tick_error(&mut self, world: &WorldState, error: &str);
    /// The game itself failed running a script (`ScriptHost.scriptError`): a bug in the game,
    /// not in the script. With a `script_id`, that one script ended for `entity_ids`; without
    /// one, the whole realm's scripts skipped the tick.
    fn script_error(&mut self, world: &WorldState, error: &str, at: &ScriptErrorWhere);
}

/// Orders accepted since the last tick, applied before the world steps (`OrderQueue.applyAll`,
/// T86.2).
pub trait ApplyOrders {
    fn apply_all(&mut self, world: &mut WorldState, scratch: &mut Scratch);
}

/// Moves the residents' queues on once the orders are applied (`QueueRunner.runAll`, T86.2).
pub trait RunQueues {
    fn run_all(&mut self, world: &mut WorldState, scratch: &mut Scratch);
}

/// Runs the residents' scripts after the orders are applied (`ScriptRunner`, T86.12).
pub trait RunScripts {
    /// Runs every running script once (`runAll`); with `check`, returns the script invariants
    /// broken this tick.
    fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        check: bool,
    ) -> Vec<InvariantViolation>;
    /// The scripts that ran in the last [`RunScripts::run_all`] (`runs`).
    fn runs(&self) -> usize;
}

/// Turns walk orders into steps (`Walking`, T86.4); without it nobody walks.
pub trait Walk {
    /// Requests this tick's steps and resolves them together (`requestSteps` then `resolve`);
    /// returns how many steps were requested, which count as actions.
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize;
}

/// The walking for one call, borrowed again from an optional one (`Option::as_deref_mut` would
/// tie the borrow to the trait object's own lifetime).
pub fn reborrow<'s>(walking: &'s mut Option<&mut dyn Walk>) -> Option<&'s mut dyn Walk> {
    match walking {
        Some(w) => Some(&mut **w),
        None => None,
    }
}

/// What the TypeScript keeps beside the world rather than in it: scratch memory for the tick,
/// never saved (ADR 0006). The loop keeps one for its world across ticks, as the `WeakMap`s keyed
/// by the world live as long as it.
#[derive(Debug, Default)]
pub struct Scratch {
    /// The open sight cache (`openSight` .. `closeSight`); `None` outside a tick.
    pub sight: Option<SightCache>,
    /// The world index, rebuilt when the world's revision changes (`worldIndex`).
    pub index: Option<WorldIndex>,
    /// Goods that came into the world this tick (`noteMade`, `takeMade`).
    pub made: GoodsMade,
    /// When each realm's Last seen was last refreshed (`refreshes`, `soon` of `last-seen.ts`).
    pub last_seen: crate::last_seen::LastSeenState,
}

impl Scratch {
    /// The world index for the world as it is now (`worldIndex`).
    pub fn index(&mut self, world: &WorldState, size: i32) -> &WorldIndex {
        world_index(&mut self.index, world, size)
    }

    /// Starts the next phase of the open sight cache, if one is open (`newSightPhase`).
    pub fn new_sight_phase(&mut self) {
        if let Some(sight) = &mut self.sight {
            sight.new_phase();
        }
    }
}

/// The loop's work once the world has stepped and the invariants are checked, timed with the
/// tick's timer so tick health covers the whole tick: territory, sight, broadcast, save.
pub type Finish<'a> = dyn FnMut(&TickTimer, &mut WorldState, &mut Scratch) + 'a;

/// What one tick runs with (`TickOptions`).
pub struct TickOptions<'a> {
    pub reporter: &'a mut dyn TickReporter,
    pub invariant_sample_rate: f64,
    pub slow_tick_ms: f64,
    /// Turns walk orders into steps; without it nobody walks.
    pub walking: Option<&'a mut dyn Walk>,
    /// Orders accepted since the last tick; applied before the world steps.
    pub orders: Option<&'a mut dyn ApplyOrders>,
    /// Moves the residents' queues on once the orders are applied; without it no queue moves.
    pub queues: Option<&'a mut dyn RunQueues>,
    /// Runs the residents' scripts after the orders are applied; without it no script runs.
    pub scripts: Option<&'a mut dyn RunScripts>,
    pub finish: Option<&'a mut Finish<'a>>,
    /// The clock; the wall clock without one.
    pub now: Option<Clock>,
    /// Draws whether this tick gets the before-and-after checks; `Math.random` in the
    /// TypeScript, a thread-local generator without one.
    pub rand: Option<&'a mut dyn FnMut() -> f64>,
}

impl<'a> TickOptions<'a> {
    /// Options with only the reporter and the two numbers, as most callers start.
    pub fn new(
        reporter: &'a mut dyn TickReporter,
        invariant_sample_rate: f64,
        slow_tick_ms: f64,
    ) -> Self {
        TickOptions {
            reporter,
            invariant_sample_rate,
            slow_tick_ms,
            walking: None,
            orders: None,
            queues: None,
            scripts: None,
            finish: None,
            now: None,
            rand: None,
        }
    }
}

pub use crate::invariants::{goods_only_from_nothing_at_the_floor, should_check_invariants};

/// The world invariants this tick checks (`invariantsForTick`): all of them with every tick
/// sampled, else the slice for `tick % round`.
fn invariant_slice(tick: u64, sample_rate: f64) -> Vec<Invariant> {
    invariants_for_tick(tick, sample_rate, &world_invariants())
}

thread_local! {
    static RAND_STATE: Cell<u64> = const { Cell::new(0x9E37_79B9_7F4A_7C15) };
}

/// A draw in [0, 1) from a thread-local generator (splitmix64), standing in for `Math.random`.
fn default_rand() -> f64 {
    RAND_STATE.with(|s| {
        let mut z = s.get().wrapping_add(0x9E37_79B9_7F4A_7C15);
        s.set(z);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    })
}

/// A panic's message.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "tick panicked".to_string()
    }
}

/// Runs one tick of the simulation with monitoring around it (`runTick`): applies waiting
/// orders, moves queues, runs scripts, steps the world, checks the tick's slice of the world
/// invariants and, on sampled ticks, the before-and-after ones, runs `finish` and reports tick
/// health with how long each phase took. A panic is reported, not passed on, so one bad tick
/// does not stop the loop.
pub fn run_tick(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    opts: TickOptions<'_>,
) -> Option<TickHealth> {
    let TickOptions {
        reporter,
        invariant_sample_rate,
        slow_tick_ms,
        mut walking,
        orders,
        queues,
        mut scripts,
        finish,
        now,
        rand,
    } = opts;
    let timer = TickTimer::new(now.unwrap_or_else(wall_clock));
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        timer.time(TickPhase::Orders, || {
            if let Some(o) = orders {
                o.apply_all(world, scratch);
            }
        });
        timer.time(TickPhase::Queues, || {
            if let Some(q) = queues {
                q.run_all(world, scratch);
            }
        });
        // What each side sees is worked out once per phase and shared, up to the broadcast.
        scratch.sight = Some(SightCache::open(terrain.size));
        let check = match rand {
            Some(r) => should_check_invariants(invariant_sample_rate, r),
            None => should_check_invariants(invariant_sample_rate, &mut default_rand),
        };
        let script_violations = timer.time(TickPhase::Scripts, || match scripts.as_deref_mut() {
            Some(s) => s.run_all(world, scratch, check),
            None => Vec::new(),
        });
        let before = timer.time(TickPhase::Invariants, || check.then(|| tally_goods(world)));
        let step = timer.time(TickPhase::World, || {
            scratch.made.take();
            step_world(world, terrain, scratch, reborrow(&mut walking), Some(&timer))
        });
        let slice = invariant_slice(world.tick, invariant_sample_rate);
        if check || !slice.is_empty() {
            timer.time(TickPhase::Invariants, || {
                let mut violations = script_violations;
                violations.extend(check_invariants(world, terrain, &slice));
                if let Some(before) = &before {
                    let made = scratch.made.take();
                    violations.extend(goods_only_from_nothing_at_the_floor(before, world, &made));
                }
                if !violations.is_empty() {
                    reporter.invariant_violations(world, &violations);
                }
            });
        }
        if let Some(f) = finish {
            f(&timer, world, scratch);
        }
        let duration_ms = timer.elapsed();
        let health = TickHealth {
            tick: world.tick,
            duration_ms,
            phases: timer.phases(),
            residents: world.residents.len(),
            actions: step.actions,
            npc_plan_ms: step.npc_plan_ms,
            outsiders_ms: step.outsiders_ms,
            script_runs: scripts.as_deref().map_or(0, |s| s.runs()) + step.npc_script_runs,
            sight_builds: scratch.sight.as_ref().map_or(0, |s| s.builds),
            slow: duration_ms > slow_tick_ms,
        };
        reporter.tick_health(world, &health);
        health
    }));
    // The tick's sight closes however it ended (`closeSight`).
    scratch.sight = None;
    match outcome {
        Ok(health) => Some(health),
        Err(payload) => {
            reporter.tick_error(world, &panic_message(payload.as_ref()));
            None
        }
    }
}

#[cfg(test)]
mod tests;
