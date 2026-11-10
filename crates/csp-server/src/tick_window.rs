//! Tick health over time (new in the Rust server, Epic 87): the last hour of ticks, summed up as
//! p50, p95 and max of the whole tick and of every phase, for the last minute and the last hour.
//! Logged once a minute and served to admins over HTTP.

use std::collections::VecDeque;

use csp_sim::tick::{Phases, TickHealth, TICK_PHASES};
use indexmap::IndexMap;
use serde::Serialize;
use ts_rs::TS;

/// How far back the window reaches, in ms.
pub const WINDOW_MS: f64 = 60.0 * 60.0 * 1000.0;
/// The short summary's reach, in ms.
pub const MINUTE_MS: f64 = 60.0 * 1000.0;

/// p50, p95 and max of a stretch of ticks (`Percentiles`).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, TS)]
pub struct Percentiles {
    pub p50: f64,
    pub p95: f64,
    pub max: f64,
}

/// p50, p95 and max of `values` by nearest rank (the smallest value with at least that share of
/// the values at or below it); all 0 for none. Sorts `values`.
pub fn percentiles(values: &mut [f64]) -> Percentiles {
    if values.is_empty() {
        return Percentiles::default();
    }
    values.sort_by(f64::total_cmp);
    let rank =
        |p: f64| values[((p * values.len() as f64).ceil() as usize).clamp(1, values.len()) - 1];
    Percentiles { p50: rank(0.5), p95: rank(0.95), max: values[values.len() - 1] }
}

/// The ticks of one stretch of time, summed up (`WindowStats`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowStats {
    pub ticks: usize,
    /// Ticks over the slow-tick threshold.
    pub slow: usize,
    pub duration_ms: Percentiles,
    /// The residents in the world, per tick.
    pub residents: Percentiles,
    /// The scripts that ran, per tick (`TickHealth.script_runs`).
    pub script_runs: Percentiles,
    /// Every phase by its name, in the phases' order.
    #[ts(as = "IndexMap<String, Percentiles>")]
    pub phases: IndexMap<&'static str, Percentiles>,
}

/// The last minute and the last hour of ticks (`TickHealthSummary`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TickHealthSummary {
    pub last_minute: WindowStats,
    pub last_hour: WindowStats,
}

/// What `GET /api/admin/tick-health` answers (`TickHealthResponse`): the summary, and the
/// slow-tick threshold it was measured against.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TickHealthResponse {
    /// A tick longer than this, in ms, is slow (`SLOW_TICK_MS`).
    pub slow_tick_ms: f64,
    #[serde(flatten)]
    pub summary: TickHealthSummary,
}

#[derive(Debug, Clone)]
struct Entry {
    at_ms: f64,
    duration_ms: f64,
    phases: Phases,
    residents: usize,
    script_runs: usize,
    slow: bool,
}

/// The tick health of the last hour.
#[derive(Debug, Clone, Default)]
pub struct TickHealthWindow {
    entries: VecDeque<Entry>,
}

impl TickHealthWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a tick that ended at `at_ms` (any clock in ms that only goes forward) and forgets the
    /// ticks older than an hour before it.
    pub fn push(&mut self, at_ms: f64, health: &TickHealth) {
        self.entries.push_back(Entry {
            at_ms,
            duration_ms: health.duration_ms,
            phases: health.phases,
            residents: health.residents,
            script_runs: health.script_runs,
            slow: health.slow,
        });
        while self.entries.front().is_some_and(|e| e.at_ms <= at_ms - WINDOW_MS) {
            self.entries.pop_front();
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The last minute and the last hour before `now_ms`.
    pub fn summary(&self, now_ms: f64) -> TickHealthSummary {
        TickHealthSummary {
            last_minute: self.stats(now_ms - MINUTE_MS),
            last_hour: self.stats(now_ms - WINDOW_MS),
        }
    }

    /// The summary before `now_ms` as admins get it, with the slow-tick threshold.
    pub fn response(&self, now_ms: f64, slow_tick_ms: f64) -> TickHealthResponse {
        TickHealthResponse { slow_tick_ms, summary: self.summary(now_ms) }
    }

    fn stats(&self, after_ms: f64) -> WindowStats {
        let recent: Vec<&Entry> = self.entries.iter().filter(|e| e.at_ms > after_ms).collect();
        let of = |f: fn(&Entry) -> f64| {
            percentiles(&mut recent.iter().map(|e| f(e)).collect::<Vec<_>>())
        };
        let phases = TICK_PHASES
            .iter()
            .map(|&p| {
                let mut ms: Vec<f64> = recent.iter().map(|e| e.phases.get(p)).collect();
                (p.name(), percentiles(&mut ms))
            })
            .collect();
        WindowStats {
            ticks: recent.len(),
            slow: recent.iter().filter(|e| e.slow).count(),
            duration_ms: of(|e| e.duration_ms),
            residents: of(|e| e.residents as f64),
            script_runs: of(|e| e.script_runs as f64),
            phases,
        }
    }
}

#[cfg(test)]
mod tests {
    use csp_sim::tick::TickPhase;

    use super::*;

    fn health(duration_ms: f64, slow: bool) -> TickHealth {
        TickHealth {
            tick: 1,
            duration_ms,
            phases: Phases::default(),
            residents: 0,
            actions: 0,
            npc_plan_ms: 0.0,
            outsiders_ms: 0.0,
            script_runs: 0,
            sight_builds: 0,
            slow,
        }
    }

    #[test]
    fn takes_percentiles_by_nearest_rank() {
        let mut v: Vec<f64> = (1..=100).rev().map(f64::from).collect();
        assert_eq!(percentiles(&mut v), Percentiles { p50: 50.0, p95: 95.0, max: 100.0 });
        assert_eq!(percentiles(&mut [7.0]), Percentiles { p50: 7.0, p95: 7.0, max: 7.0 });
        assert_eq!(percentiles(&mut [1.0, 2.0]), Percentiles { p50: 1.0, p95: 2.0, max: 2.0 });
        assert_eq!(percentiles(&mut [3.0, 1.0, 2.0]).p50, 2.0);
        assert_eq!(percentiles(&mut []), Percentiles::default());
    }

    #[test]
    fn sums_up_the_last_minute_and_the_last_hour() {
        let mut w = TickHealthWindow::new();
        // An hour and a bit of ticks, one a second: 1 ms each, but the last minute's 10 ms and
        // one slow tick of 900 ms among them.
        let end = 3700.0 * 1000.0;
        for s in 0..3700 {
            let at = f64::from(s + 1) * 1000.0;
            let in_last_minute = at > end - MINUTE_MS;
            let ms = if s == 3699 {
                900.0
            } else if in_last_minute {
                10.0
            } else {
                1.0
            };
            w.push(at, &health(ms, ms > 800.0));
        }
        // Older than an hour is forgotten.
        assert_eq!(w.len(), 3600);
        let s = w.summary(end);
        assert_eq!(s.last_minute.ticks, 60);
        assert_eq!(s.last_minute.slow, 1);
        assert_eq!(s.last_minute.duration_ms, Percentiles { p50: 10.0, p95: 10.0, max: 900.0 });
        assert_eq!(s.last_hour.ticks, 3600);
        // The last minute is under 5 % of the hour: its 10 ms ticks do not reach the p95.
        assert_eq!(s.last_hour.duration_ms, Percentiles { p50: 1.0, p95: 1.0, max: 900.0 });
    }

    #[test]
    fn reports_every_phase_in_order() {
        let mut w = TickHealthWindow::new();
        let mut h = health(5.0, false);
        h.phases = one_phase(TickPhase::World, 4.0);
        w.push(1000.0, &h);
        let s = w.summary(1000.0);
        let names: Vec<&str> = s.last_minute.phases.keys().copied().collect();
        assert_eq!(names, TICK_PHASES.iter().map(|p| p.name()).collect::<Vec<_>>());
        assert_eq!(s.last_minute.phases[TickPhase::World.name()].max, 4.0);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["lastHour"]["durationMs"]["p95"], 5.0);
        assert_eq!(json["lastMinute"]["phases"]["world"]["p50"], 4.0);
        assert!(
            TickHealthWindow::new().summary(0.0).last_hour.phases["save"] == Percentiles::default()
        );
    }

    #[test]
    fn sums_up_residents_and_script_runs_per_tick() {
        let mut w = TickHealthWindow::new();
        for (s, (residents, runs)) in [(10, 2), (12, 0), (11, 9)].into_iter().enumerate() {
            let mut h = health(1.0, false);
            (h.residents, h.script_runs) = (residents, runs);
            w.push(1000.0 * (s as f64 + 1.0), &h);
        }
        let s = w.summary(3000.0);
        assert_eq!(s.last_minute.residents, Percentiles { p50: 11.0, p95: 12.0, max: 12.0 });
        assert_eq!(s.last_minute.script_runs, Percentiles { p50: 2.0, p95: 9.0, max: 9.0 });
    }

    #[test]
    fn answers_admins_with_the_slow_tick_threshold_beside_both_windows() {
        let mut w = TickHealthWindow::new();
        w.push(1000.0, &health(5.0, false));
        let json = serde_json::to_value(w.response(1000.0, 800.0)).unwrap();
        assert_eq!(json["slowTickMs"], 800.0);
        assert_eq!(json["lastMinute"]["ticks"], 1);
        assert_eq!(json["lastHour"]["durationMs"]["max"], 5.0);
        assert_eq!(json["lastHour"]["scriptRuns"]["p50"], 0.0);
    }

    /// Phases in which only `phase` took time, `ms` of it: timed with a clock that moves `ms` on
    /// every reading.
    pub(crate) fn one_phase(phase: TickPhase, ms: f64) -> Phases {
        let t = std::cell::Cell::new(0.0);
        let timer = csp_sim::tick::TickTimer::new(Box::new(move || {
            let v = t.get();
            t.set(v + ms);
            v
        }));
        timer.time(phase, || ());
        timer.phases()
    }
}
