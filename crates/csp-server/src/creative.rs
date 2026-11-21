//! Creative mode's time controls (`CONTEXT.md`: Creative mode, ADR 0043): pause, step one tick
//! and a speed for the whole world. They exist only on a server started with `CREATIVE=1`; the
//! tick loop ([`crate::server::tick_loop`]) honours them and drives the same `Game::tick` as
//! always, so every rule runs unchanged, only sooner. They live in the running server, never in
//! the world: a server always starts running at normal speed.

use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

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
        CreativeState { paused: c.paused, speed: c.speed }
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

/// The explored chunks that grew, by user id, as a tick's sight gives them.
pub type Grown = BTreeMap<u64, BTreeSet<usize>>;

/// How often the sockets are told of ticks: every tick, or at most once a `gap` (creative ×60
/// and max, [`CreativeSpeed::broadcast_gap`]). The explored chunks that grew in a tick that is
/// not broadcast are held for the next one that is.
#[derive(Debug, Default)]
pub struct BroadcastPace {
    pub gap: Option<Duration>,
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
        if let (Some(gap), Some(last)) = (self.gap, self.last) {
            if now.saturating_duration_since(last) < gap {
                return None;
            }
        }
        self.last = Some(now);
        Some(std::mem::take(&mut self.held))
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
        assert_eq!(controls.state(), CreativeState { paused: false, speed: CreativeSpeed::Normal });
        controls.pause();
        controls.set_speed(CreativeSpeed::X60);
        assert_eq!(controls.state(), CreativeState { paused: true, speed: CreativeSpeed::X60 });
        controls.resume();
        assert!(!controls.state().paused);
    }
}
