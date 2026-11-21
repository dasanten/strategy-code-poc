//! Creative mode's time controls (`CONTEXT.md`: Creative mode, ADR 0043): pause, step one tick
//! and a speed for the whole world. They exist only on a server started with `CREATIVE=1`; the
//! tick loop ([`crate::server::tick_loop`]) honours them and drives the same `Game::tick` as
//! always, so every rule runs unchanged, only sooner. They live in the running server, never in
//! the world: a server always starts running at normal speed.
//!
//! A **skip ahead** runs a number of game hours or days as fast as the machine allows, one tick
//! after another through the same loop, cancellable between ticks. The sockets get one full
//! update at its end; the Creative bar asks for its progress meanwhile.

use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

use csp_shared::terrain::TerrainMap;
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_YEAR};
use csp_shared::world::{Good, HorseStats, SkillName, StatRecord, WorldState};
use csp_sim::creative;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use ts_rs::TS;

/// How fast the world runs: one tick a `TICK_MS`, ten or sixty times as fast, or as fast as the
/// machine allows (ticks back to back).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CreativeSpeed {
    #[default]
    Normal,
    X10,
    X60,
    Max,
}

impl CreativeSpeed {
    /// The time between ticks at this speed, `normal` being one tick's at normal speed; `None`
    /// runs them back to back.
    pub fn period(self, normal: Duration) -> Option<Duration> {
        match self {
            CreativeSpeed::Normal => Some(normal),
            CreativeSpeed::X10 => Some(normal / 10),
            CreativeSpeed::X60 => Some(normal / 60),
            CreativeSpeed::Max => None,
        }
    }

    /// The least time between two broadcasts at this speed. At ×60 and at max the ticks come
    /// faster than a client can draw them, so the sockets are told at most ten times a real second;
    /// a tick between two broadcasts is sent with the next (each socket gets the difference from
    /// what it was sent last, so nothing is lost).
    pub fn broadcast_gap(self) -> Option<Duration> {
        match self {
            CreativeSpeed::Normal | CreativeSpeed::X10 => None,
            CreativeSpeed::X60 | CreativeSpeed::Max => Some(FAST_BROADCAST_GAP),
        }
    }
}

/// The least time between broadcasts at ×60 and max: ten a real second.
pub const FAST_BROADCAST_GAP: Duration = Duration::from_millis(100);

/// How long a step waits for the tick loop to run its tick before answering anyway.
const STEP_WAIT: Duration = Duration::from_secs(30);

/// The time controls as the Creative bar shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreativeState {
    pub paused: bool,
    pub speed: CreativeSpeed,
    /// The skip ahead under way, if one is.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skip: Option<SkipProgress>,
}

/// How far a skip ahead has come: ticks run of the ticks asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SkipProgress {
    pub done: u64,
    pub total: u64,
}

/// What a skip ahead counts in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SkipUnit {
    Hours,
    Days,
}

/// A skip ahead asked for by the Creative bar: `amount` game hours or days.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreativeSkipRequest {
    pub amount: u32,
    pub unit: SkipUnit,
}

/// The longest skip ahead: one game year.
pub const MAX_SKIP_TICKS: u64 = TICKS_PER_GAME_YEAR as u64;

impl CreativeSkipRequest {
    /// The ticks this skip runs, or `None` if it is none or longer than [`MAX_SKIP_TICKS`].
    pub fn ticks(self) -> Option<u64> {
        let per = match self.unit {
            SkipUnit::Hours => TICKS_PER_GAME_HOUR,
            SkipUnit::Days => TICKS_PER_GAME_DAY,
        } as u64;
        let ticks = u64::from(self.amount) * per;
        (1..=MAX_SKIP_TICKS).contains(&ticks).then_some(ticks)
    }
}

/// A skip ahead under way. `id` tells it from a later one, so a tick that was running when it
/// was cancelled never counts for the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Skip {
    pub id: u64,
    pub done: u64,
    pub total: u64,
}

/// A speed asked for by the Creative bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreativeSpeedRequest {
    pub speed: CreativeSpeed,
}

/// What the tick loop reads: the controls, and the steps asked for and run so far.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Clock {
    pub paused: bool,
    pub speed: CreativeSpeed,
    pub steps_asked: u64,
    pub steps_run: u64,
    /// The skip ahead under way, if one is: while it runs, no other tick does.
    pub skip: Option<Skip>,
    /// How many skips were started, for their ids.
    pub skips_started: u64,
}

impl Clock {
    /// Whether a step is waiting for its tick.
    pub fn step_waiting(&self) -> bool {
        self.steps_asked > self.steps_run
    }
}

/// The time controls of a creative server, shared by its routes and its tick loop.
#[derive(Debug)]
pub struct TimeControls {
    clock: watch::Sender<Clock>,
}

impl Default for TimeControls {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeControls {
    /// Running, at normal speed.
    pub fn new() -> Self {
        TimeControls { clock: watch::Sender::new(Clock::default()) }
    }

    pub fn state(&self) -> CreativeState {
        let c = *self.clock.borrow();
        let skip = c.skip.map(|s| SkipProgress { done: s.done, total: s.total });
        CreativeState { paused: c.paused, speed: c.speed, skip }
    }

    /// Starts skipping `ticks` ahead; `false` if a skip is already under way.
    pub fn skip(&self, ticks: u64) -> bool {
        self.clock.send_if_modified(|c| {
            if c.skip.is_some() {
                return false;
            }
            c.skips_started += 1;
            c.skip = Some(Skip { id: c.skips_started, done: 0, total: ticks });
            true
        })
    }

    /// Stops the skip ahead after the tick it is running, if one is under way.
    pub fn cancel_skip(&self) {
        self.clock.send_if_modified(|c| c.skip.take().is_some());
    }

    /// The tick loop ran a tick of skip `id`: the skip ends once it has run them all.
    pub fn skip_ticked(&self, id: u64) {
        self.clock.send_if_modified(|c| match &mut c.skip {
            Some(s) if s.id == id => {
                s.done += 1;
                if s.done >= s.total {
                    c.skip = None;
                }
                true
            }
            _ => false,
        });
    }

    pub fn pause(&self) {
        self.clock.send_if_modified(|c| !std::mem::replace(&mut c.paused, true));
    }

    pub fn resume(&self) {
        self.clock.send_if_modified(|c| std::mem::replace(&mut c.paused, false));
    }

    pub fn set_speed(&self, speed: CreativeSpeed) {
        self.clock.send_if_modified(|c| std::mem::replace(&mut c.speed, speed) != speed);
    }

    /// Pauses the world and runs one tick: resolves once the tick loop has run it (or after
    /// [`STEP_WAIT`] if no loop runs it).
    pub async fn step(&self) {
        let mut rx = self.clock.subscribe();
        let mut asked = 0;
        self.clock.send_modify(|c| {
            c.paused = true;
            c.steps_asked += 1;
            asked = c.steps_asked;
        });
        let _ = tokio::time::timeout(STEP_WAIT, rx.wait_for(|c| c.steps_run >= asked)).await;
    }

    /// The clock, for the tick loop.
    pub fn subscribe(&self) -> watch::Receiver<Clock> {
        self.clock.subscribe()
    }

    /// The tick loop ran a step's tick.
    pub fn stepped(&self) {
        self.clock.send_modify(|c| c.steps_run += 1);
    }
}

/// A creative action an admin gives by hand from a card (`CONTEXT.md`: Creative mode, Creative
/// actions): sent to [`crate::app::CREATIVE_ACT_PATH`], done between ticks through `with_game`,
/// never an order kind or a script call (ADR 0043). Later actions add their variants here.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CreativeAction {
    /// Gives whole units of a good to a storage (warehouse, stable, haven) or a carriage.
    GiveGoods { holder_id: String, good: Good, amount: f64 },
    /// Takes whole units of a good out of one, never below none.
    TakeGoods { holder_id: String, good: Good, amount: f64 },
    /// Finishes a construction site (and the road or wall lines building on it) or the trainings
    /// at a training ground now.
    FinishNow { building_id: String },
    /// Adds a Resident on a tile to a city and its realm, with an age (game years), base stats
    /// and skills picked; what is left out is drawn as for a starting city's resident.
    AddResident {
        city_id: String,
        x: f64,
        y: f64,
        #[serde(default)]
        #[ts(optional)]
        age: Option<f64>,
        #[serde(default)]
        #[ts(optional)]
        stats: Option<StatRecord<f64>>,
        #[serde(default)]
        #[ts(optional, as = "Option<IndexMap<SkillName, f64>>")]
        skills: IndexMap<SkillName, f64>,
    },
    /// Adds a horse on a tile to a city and its realm, with an age and stats picked or drawn.
    AddHorse {
        city_id: String,
        x: f64,
        y: f64,
        #[serde(default)]
        #[ts(optional)]
        age: Option<f64>,
        #[serde(default)]
        #[ts(optional)]
        stats: Option<HorseStats>,
    },
    /// Heals a Resident: wounds close and a Down one wakes.
    Heal { resident_id: String },
    /// Grows a child up now, as if the years had passed.
    GrowUp { resident_id: String },
    /// Kills a Resident by a normal death (Leader death rules for a Leader).
    Kill { resident_id: String },
}

impl CreativeAction {
    /// The action's name, as `csp_sim::creative::CREATIVE_ACTIONS` lists it.
    pub fn name(&self) -> &'static str {
        match self {
            CreativeAction::GiveGoods { .. } => "giveGoods",
            CreativeAction::TakeGoods { .. } => "takeGoods",
            CreativeAction::FinishNow { .. } => "finishNow",
            CreativeAction::AddResident { .. } => "addResident",
            CreativeAction::AddHorse { .. } => "addHorse",
            CreativeAction::Heal { .. } => "heal",
            CreativeAction::GrowUp { .. } => "growUp",
            CreativeAction::Kill { .. } => "kill",
        }
    }

    /// Does the action on the world: what was done, for the admin, or why not.
    pub fn apply(self, world: &mut WorldState, terrain: &TerrainMap) -> Result<String, String> {
        let units = |n: f64| if n == 1.0 { "1 unit".to_string() } else { format!("{n} units") };
        match self {
            CreativeAction::GiveGoods { holder_id, good, amount } => {
                creative::give_goods(world, &holder_id, good, amount)
                    .map(|n| format!("Gave {}.", units(n)))
            }
            CreativeAction::TakeGoods { holder_id, good, amount } => {
                creative::take_goods(world, &holder_id, good, amount)
                    .map(|n| format!("Took {}.", units(n)))
            }
            CreativeAction::FinishNow { building_id } => {
                creative::finish_now(world, &building_id, Some(terrain))
            }
            CreativeAction::AddResident { city_id, x, y, age, stats, skills } => {
                let pick = creative::ResidentPick { age, stats, skills };
                let id = creative::add_resident(world, terrain, &city_id, (x, y), &pick)?;
                let name = world.residents.iter().find(|r| r.id == id).map(|r| r.name.clone());
                Ok(format!("{} joined.", name.unwrap_or(id)))
            }
            CreativeAction::AddHorse { city_id, x, y, age, stats } => {
                let id = creative::add_horse(world, terrain, &city_id, (x, y), age, stats)?;
                let name = world.horses.iter().find(|h| h.id == id).map(|h| h.name.clone());
                Ok(format!("The horse {} joined.", name.unwrap_or(id)))
            }
            CreativeAction::Heal { resident_id } => creative::heal(world, &resident_id),
            CreativeAction::GrowUp { resident_id } => creative::grow_up(world, &resident_id),
            CreativeAction::Kill { resident_id } => {
                creative::kill(world, &resident_id, terrain.size)
            }
        }
    }
}

/// What a creative action did: its line for the admin, and the invariants it left broken (run
/// once after every action, ADR 0004), which are reported as a tick's are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CreativeDone {
    pub message: String,
    pub violations: Vec<String>,
}

/// The explored chunks that grew, by user id, as a tick's sight gives them.
pub type Grown = BTreeMap<u64, BTreeSet<usize>>;

/// How often the sockets are told of ticks: every tick, or at most once a `gap` (creative ×60
/// and max, [`CreativeSpeed::broadcast_gap`]). The explored chunks that grew in a tick that is
/// not broadcast are held for the next one that is.
#[derive(Debug, Default)]
pub struct BroadcastPace {
    pub gap: Option<Duration>,
    /// During a skip ahead no tick is broadcast: everything goes out at its end
    /// ([`BroadcastPace::flush`]).
    pub holding: bool,
    last: Option<Instant>,
    held: Grown,
}

impl BroadcastPace {
    /// Whether the tick that grew `grown` is broadcast at `now`: if so, every chunk grown since
    /// the last broadcast; if not, `None`, and they are held.
    pub fn due(&mut self, grown: Grown, now: Instant) -> Option<Grown> {
        for (user, chunks) in grown {
            self.held.entry(user).or_default().extend(chunks);
        }
        if self.holding {
            return None;
        }
        if let (Some(gap), Some(last)) = (self.gap, self.last) {
            if now.saturating_duration_since(last) < gap {
                return None;
            }
        }
        self.last = Some(now);
        Some(std::mem::take(&mut self.held))
    }

    /// Stops holding and hands over every chunk grown since the last broadcast, for a broadcast
    /// at `now` (a skip ahead's end).
    pub fn flush(&mut self, now: Instant) -> Grown {
        self.holding = false;
        self.last = Some(now);
        std::mem::take(&mut self.held)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broadcasts_every_tick_without_a_gap() {
        let mut pace = BroadcastPace::default();
        let now = Instant::now();
        let grown = Grown::from([(1, BTreeSet::from([3]))]);
        assert_eq!(pace.due(grown.clone(), now), Some(grown));
        assert_eq!(pace.due(Grown::new(), now), Some(Grown::new()));
    }

    #[test]
    fn holds_the_chunks_grown_between_broadcasts_for_the_next() {
        let mut pace = BroadcastPace { gap: Some(FAST_BROADCAST_GAP), ..BroadcastPace::default() };
        let start = Instant::now();
        assert_eq!(
            pace.due(Grown::from([(1, BTreeSet::from([3]))]), start),
            Some(Grown::from([(1, BTreeSet::from([3]))]))
        );
        assert_eq!(
            pace.due(Grown::from([(1, BTreeSet::from([4]))]), start + Duration::from_millis(10)),
            None
        );
        assert_eq!(
            pace.due(Grown::from([(2, BTreeSet::from([5]))]), start + Duration::from_millis(50)),
            None
        );
        assert_eq!(
            pace.due(Grown::new(), start + FAST_BROADCAST_GAP),
            Some(Grown::from([(1, BTreeSet::from([4])), (2, BTreeSet::from([5]))]))
        );
        // Back to every tick once the gap is gone.
        pace.gap = None;
        assert!(pace.due(Grown::new(), start + FAST_BROADCAST_GAP).is_some());
    }

    #[test]
    fn speeds_divide_the_normal_tick() {
        let normal = Duration::from_millis(1000);
        assert_eq!(CreativeSpeed::Normal.period(normal), Some(normal));
        assert_eq!(CreativeSpeed::X10.period(normal), Some(Duration::from_millis(100)));
        assert_eq!(CreativeSpeed::X60.period(normal), Some(normal / 60));
        assert_eq!(CreativeSpeed::Max.period(normal), None);
        assert_eq!(CreativeSpeed::X10.broadcast_gap(), None);
        assert_eq!(CreativeSpeed::Max.broadcast_gap(), Some(FAST_BROADCAST_GAP));
    }

    #[test]
    fn speeds_are_named_as_the_client_sends_them() {
        let names: Vec<_> =
            [CreativeSpeed::Normal, CreativeSpeed::X10, CreativeSpeed::X60, CreativeSpeed::Max]
                .iter()
                .map(|s| serde_json::to_value(s).unwrap())
                .collect();
        assert_eq!(names, vec!["normal", "x10", "x60", "max"]);
    }

    #[test]
    fn starts_running_at_normal_speed() {
        let controls = TimeControls::new();
        let normal = CreativeState { paused: false, speed: CreativeSpeed::Normal, skip: None };
        assert_eq!(controls.state(), normal);
        controls.pause();
        controls.set_speed(CreativeSpeed::X60);
        let paused = CreativeState { paused: true, speed: CreativeSpeed::X60, skip: None };
        assert_eq!(controls.state(), paused);
        controls.resume();
        assert!(!controls.state().paused);
    }

    #[test]
    fn counts_a_skip_in_game_hours_or_days_up_to_a_year() {
        let ticks = |amount, unit| CreativeSkipRequest { amount, unit }.ticks();
        assert_eq!(ticks(1, SkipUnit::Days), Some(1440));
        assert_eq!(ticks(3, SkipUnit::Hours), Some(180));
        assert_eq!(ticks(0, SkipUnit::Hours), None);
        assert_eq!(ticks(420, SkipUnit::Days), Some(MAX_SKIP_TICKS));
        assert_eq!(ticks(421, SkipUnit::Days), None);
        let request: CreativeSkipRequest =
            serde_json::from_value(serde_json::json!({ "amount": 2, "unit": "hours" })).unwrap();
        assert_eq!(request.ticks(), Some(120));
    }

    #[test]
    fn runs_one_skip_at_a_time_and_never_counts_a_cancelled_skips_tick_for_the_next() {
        let controls = TimeControls::new();
        assert!(controls.skip(2));
        assert!(!controls.skip(5), "one at a time");
        assert_eq!(controls.state().skip, Some(SkipProgress { done: 0, total: 2 }));
        controls.skip_ticked(1);
        assert_eq!(controls.state().skip, Some(SkipProgress { done: 1, total: 2 }));
        controls.skip_ticked(1);
        assert_eq!(controls.state().skip, None, "done");

        assert!(controls.skip(3));
        controls.cancel_skip();
        assert_eq!(controls.state().skip, None);
        assert!(controls.skip(3));
        // The tick the cancelled skip was running when it was cancelled.
        controls.skip_ticked(2);
        assert_eq!(controls.state().skip, Some(SkipProgress { done: 0, total: 3 }));
    }

    #[test]
    fn holds_every_tick_during_a_skip_and_hands_them_over_at_its_end() {
        let mut pace = BroadcastPace { holding: true, ..BroadcastPace::default() };
        let now = Instant::now();
        assert_eq!(pace.due(Grown::from([(1, BTreeSet::from([3]))]), now), None);
        assert_eq!(pace.due(Grown::from([(1, BTreeSet::from([4]))]), now), None);
        assert_eq!(pace.flush(now), Grown::from([(1, BTreeSet::from([3, 4]))]));
        assert!(!pace.holding);
        assert_eq!(pace.due(Grown::new(), now), Some(Grown::new()));
    }
}
