//! `tick.test.ts`. Its tests run on `worldWithCity`, a starting city whose eight residents work
//! its farm; until the starting city (T86.8), work (T86.6), Last seen and the invariants (T86.13)
//! are ported, these run on an empty world, and the eight work actions, the realm's one sight
//! build and the lake invariant are left to those tickets (each marked `TODO(T86.n)` below).

use super::*;
use crate::world::create_world;
use csp_shared::terrain::Terrain;
use csp_shared::world::{Good, Pile, Stock};
use std::rc::Rc;

fn terrain() -> TerrainMap {
    let size = 32;
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

#[derive(Default)]
struct FakeReporter {
    violations: Vec<Vec<InvariantViolation>>,
    health: Vec<TickHealth>,
    errors: Vec<String>,
}

impl TickReporter for FakeReporter {
    fn invariant_violations(&mut self, _: &WorldState, violations: &[InvariantViolation]) {
        self.violations.push(violations.to_vec());
    }
    fn tick_health(&mut self, _: &WorldState, health: &TickHealth) {
        self.health.push(health.clone());
    }
    fn tick_error(&mut self, _: &WorldState, error: &str) {
        self.errors.push(error.to_string());
    }
    fn script_error(&mut self, _: &WorldState, _: &str, _: &ScriptErrorWhere) {}
}

/// A clock that advances by `step_ms` on every read.
fn clock(step_ms: f64) -> Clock {
    let t = Cell::new(0.0);
    Box::new(move || {
        t.set(t.get() + step_ms);
        t.get()
    })
}

/// A clock that stands still unless a phase moves it on.
fn still_clock() -> (Clock, Rc<Cell<f64>>) {
    let t = Rc::new(Cell::new(0.0));
    let read = t.clone();
    (Box::new(move || read.get()), t)
}

fn advance(t: &Cell<f64>, ms: f64) {
    t.set(t.get() + ms);
}

struct FakeOrders(Rc<Cell<f64>>, f64);
impl ApplyOrders for FakeOrders {
    fn apply_all(&mut self, _: &mut WorldState, _: &mut Scratch) {
        advance(&self.0, self.1);
    }
}

struct FakeScripts {
    clock: Rc<Cell<f64>>,
    advance: f64,
    violations: Vec<InvariantViolation>,
    checked: Vec<bool>,
}

impl FakeScripts {
    fn new(clock: Rc<Cell<f64>>, advance: f64, violations: Vec<InvariantViolation>) -> Self {
        FakeScripts { clock, advance, violations, checked: Vec::new() }
    }
}

impl RunScripts for FakeScripts {
    fn run_all(
        &mut self,
        _: &mut WorldState,
        _: &mut Scratch,
        check: bool,
    ) -> Vec<InvariantViolation> {
        advance(&self.clock, self.advance);
        self.checked.push(check);
        if check {
            self.violations.clone()
        } else {
            Vec::new()
        }
    }
    fn runs(&self) -> usize {
        3
    }
}

struct FakeWalking(usize);
impl Walk for FakeWalking {
    fn walk(&mut self, _: &mut WorldState, _: &mut Scratch) -> usize {
        self.0
    }
}

#[test]
fn reports_tick_health_with_resident_and_action_counts() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.now = Some(clock(5.0));
    let health = run_tick(&mut world, &terrain, &mut Scratch::default(), opts).unwrap();
    // TODO(T86.6, T86.8, T86.13): on `worldWithCity`, 8 residents, 8 work actions and the
    // realm's one sight build for Last seen.
    assert_eq!(health.tick, 1);
    assert_eq!(health.residents, 0);
    assert_eq!(health.actions, 0);
    assert_eq!(health.script_runs, 0);
    assert_eq!(health.sight_builds, 0);
    assert!(!health.slow);
    assert_eq!(reporter.health, vec![health]);
    assert!(reporter.violations.is_empty());
}

#[test]
fn counts_steps_as_actions_and_scripts_as_runs() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let (now, t) = still_clock();
    let mut walking = FakeWalking(4);
    let mut scripts = FakeScripts::new(t, 0.0, Vec::new());
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.now = Some(now);
    opts.walking = Some(&mut walking);
    opts.scripts = Some(&mut scripts);
    let health = run_tick(&mut world, &terrain, &mut Scratch::default(), opts).unwrap();
    assert_eq!(health.actions, 4);
    assert_eq!(health.script_runs, 3);
}

#[test]
fn flags_a_tick_above_the_slow_tick_threshold() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.now = Some(clock(801.0));
    let health = run_tick(&mut world, &terrain, &mut Scratch::default(), opts).unwrap();
    assert!(health.slow);
    // A slow tick is reported with its phases.
    assert!(reporter.health[0].slow);
    assert!(reporter.health[0].phases[TickPhase::World] > 0.0);
}

#[test]
fn reports_invariant_violations_on_checked_ticks_only() {
    // TODO(T86.13): the TypeScript puts every resident in a lake and looks for
    // `nothing-on-impassable-terrain`, and spreads the world invariants over the ticks of a
    // round; until the invariants are ported, a script invariant stands in for them.
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let (_, t) = still_clock();
    let broken = InvariantViolation {
        invariant: "script-sound".into(),
        message: "broken".into(),
        entity_ids: vec!["r1".into()],
    };
    let mut scripts = FakeScripts::new(t, 0.0, vec![broken.clone()]);
    let mut scratch = Scratch::default();
    let mut opts = TickOptions::new(&mut reporter, 0.0, 800.0);
    opts.scripts = Some(&mut scripts);
    run_tick(&mut world, &terrain, &mut scratch, opts);
    assert!(reporter.violations.is_empty());

    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.scripts = Some(&mut scripts);
    run_tick(&mut world, &terrain, &mut scratch, opts);
    assert_eq!(reporter.violations, vec![vec![broken]]);
    assert_eq!(scripts.checked, vec![false, true]);
}

#[test]
fn draws_the_before_and_after_checks_with_the_sample_rate() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let (_, t) = still_clock();
    let mut scripts = FakeScripts::new(t, 0.0, Vec::new());
    let mut scratch = Scratch::default();
    for draw in [0.05, 0.5] {
        let mut rand = move || draw;
        let mut opts = TickOptions::new(&mut reporter, 0.1, 800.0);
        opts.scripts = Some(&mut scripts);
        opts.rand = Some(&mut rand);
        run_tick(&mut world, &terrain, &mut scratch, opts);
    }
    assert_eq!(scripts.checked, vec![true, false]);
}

#[test]
fn finds_goods_that_came_from_nothing() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    world.piles.push(Pile {
        id: "p1".into(),
        x: 1.0,
        y: 1.0,
        goods: [(Good::Wood, 2.0)].into_iter().collect(),
    });
    let mut reporter = FakeReporter::default();
    let opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    run_tick(&mut world, &terrain, &mut Scratch::default(), opts);
    assert!(reporter.violations.is_empty());

    let before = tally_goods(&world);
    world.piles[0].goods.insert(Good::Wood, 6.0);
    let found = goods_only_from_nothing_at_the_floor(&before, &world, &Stock::new());
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "goods-only-from-nothing-at-the-floor");
    assert_eq!(found[0].message, "4 wood appeared from nothing at tick 1");
    // What work noted as made is no violation.
    let made: Stock = [(Good::Wood, 4.0)].into_iter().collect();
    assert!(goods_only_from_nothing_at_the_floor(&before, &world, &made).is_empty());
}

#[test]
fn reports_a_panic_instead_of_passing_it_on() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let mut boom = |_: &TickTimer, _: &mut WorldState, _: &mut Scratch| panic!("boom");
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.finish = Some(&mut boom);
    let mut scratch = Scratch::default();
    assert_eq!(run_tick(&mut world, &terrain, &mut scratch, opts), None);
    assert_eq!(reporter.errors, vec!["boom".to_string()]);
    assert!(reporter.health.is_empty());
    // The sight closes however the tick ended.
    assert!(scratch.sight.is_none());
}

#[test]
fn timer_counts_the_time_of_a_phase_that_panics_then_lets_the_panic_on() {
    let timer = TickTimer::new(clock(5.0));
    let caught = catch_unwind(AssertUnwindSafe(|| {
        timer.time(TickPhase::World, || panic!("boom"));
    }));
    assert!(caught.is_err());
    assert_eq!(timer.phases()[TickPhase::World], 5.0);
    // The timer still works for the next phase.
    assert_eq!(timer.time(TickPhase::Save, || "saved"), "saved");
    assert_eq!(timer.phases()[TickPhase::Save], 5.0);
}

#[test]
fn timer_adds_up_the_calls_of_one_phase() {
    let timer = TickTimer::new(clock(2.0));
    timer.time(TickPhase::Rest, || ());
    timer.time(TickPhase::Rest, || ());
    assert_eq!(timer.phases()[TickPhase::Rest], 4.0);
    assert_eq!(timer.phases()[TickPhase::Npc], 0.0);
}

#[test]
fn times_each_phase_finish_included_and_they_add_up_to_the_tick() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let (now, t) = still_clock();
    let mut orders = FakeOrders(t.clone(), 10.0);
    let mut scripts = FakeScripts::new(t.clone(), 20.0, Vec::new());
    let ft = t.clone();
    let mut finish = move |timer: &TickTimer, _: &mut WorldState, _: &mut Scratch| {
        timer.time(TickPhase::Sight, || advance(&ft, 30.0));
        timer.time(TickPhase::Broadcast, || advance(&ft, 40.0));
    };
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.now = Some(now);
    opts.orders = Some(&mut orders);
    opts.scripts = Some(&mut scripts);
    opts.finish = Some(&mut finish);
    let health = run_tick(&mut world, &terrain, &mut Scratch::default(), opts).unwrap();
    let p = health.phases;
    assert_eq!(p[TickPhase::Orders], 10.0);
    assert_eq!(p[TickPhase::Scripts], 20.0);
    assert_eq!(p[TickPhase::Sight], 30.0);
    assert_eq!(p[TickPhase::Broadcast], 40.0);
    assert_eq!(health.duration_ms, 100.0);
    let top_level: f64 = TOP_LEVEL_PHASES.iter().map(|&ph| p[ph]).sum();
    assert!((top_level - health.duration_ms).abs() < 1e-5);
    let parts = p[TickPhase::Npc] + p[TickPhase::Walking] + p[TickPhase::Rest];
    assert!((parts - p[TickPhase::World]).abs() < 1e-5);
}

#[test]
fn splits_the_world_phase_into_npc_walking_rest_and_last_seen() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let mut walking = FakeWalking(0);
    let mut opts = TickOptions::new(&mut reporter, 0.0, 800.0);
    // Each read moves the clock on, so every phase that ran took some time.
    opts.now = Some(clock(1.0));
    opts.walking = Some(&mut walking);
    let health = run_tick(&mut world, &terrain, &mut Scratch::default(), opts).unwrap();
    for phase in
        [TickPhase::World, TickPhase::Npc, TickPhase::Walking, TickPhase::Rest, TickPhase::LastSeen]
    {
        assert!(health.phases[phase] > 0.0, "{phase:?}");
    }
    for phase in [TickPhase::Territory, TickPhase::Sight, TickPhase::Broadcast, TickPhase::Save] {
        assert_eq!(health.phases[phase], 0.0, "{phase:?}");
    }
}

#[test]
fn reports_a_panic_while_finishing_without_tick_health() {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    let mut reporter = FakeReporter::default();
    let mut finish = |timer: &TickTimer, _: &mut WorldState, _: &mut Scratch| {
        timer.time(TickPhase::Broadcast, || panic!("socket gone"));
    };
    let mut opts = TickOptions::new(&mut reporter, 1.0, 800.0);
    opts.finish = Some(&mut finish);
    assert_eq!(run_tick(&mut world, &terrain, &mut Scratch::default(), opts), None);
    assert_eq!(reporter.errors, vec!["socket gone".to_string()]);
    assert!(reporter.health.is_empty());
}

/// `monitoring.test.ts`'s phase parts: tick health lists the phases slowest first; the logging
/// itself is the shell's (T87).
fn phases_of(entries: &[(TickPhase, f64)]) -> Phases {
    let mut phases = Phases::default();
    for &(p, ms) in entries {
        phases.0[p.slot()] = ms;
    }
    phases
}

#[test]
fn lists_a_slow_ticks_phases_slowest_first() {
    let phases = phases_of(&[
        (TickPhase::World, 500.26),
        (TickPhase::Sight, 300.0),
        (TickPhase::Orders, 100.0),
    ]);
    assert_eq!(
        phases_slowest_first(&phases)[..3],
        [(TickPhase::World, 500.26), (TickPhase::Sight, 300.0), (TickPhase::Orders, 100.0)]
    );
}

#[test]
fn lists_every_other_ticks_phases_slowest_first() {
    let phases = phases_of(&[(TickPhase::Broadcast, 2.0), (TickPhase::World, 5.0)]);
    let names: Vec<_> = phases_slowest_first(&phases)[..2].iter().map(|(p, _)| p.name()).collect();
    assert_eq!(names, ["world", "broadcast"]);
}

#[test]
fn phases_serialise_by_name_in_their_order() {
    let mut phases = Phases::default();
    phases.0[TickPhase::LastSeen.slot()] = 2.0;
    let json = serde_json::to_value(phases).unwrap();
    let names: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    assert_eq!(names, TICK_PHASES.map(|p| p.name().to_string()).to_vec());
    assert_eq!(json["lastSeen"], 2.0);
    assert_eq!(
        phases_slowest_first(&phases)[..2],
        [(TickPhase::LastSeen, 2.0), (TickPhase::Orders, 0.0)]
    );
}
