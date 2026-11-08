//! Monitoring (`apps/server/src/monitoring.ts`, ADR 0004): the tick reporter that sends what a
//! tick found to the log and to Sentry, with the same tags, fingerprints and metrics as the
//! TypeScript, plus the rolling tick health summary ([`crate::tick_window`]) logged once a minute.
//! Without a Sentry DSN every Sentry call is a no-op and only logs are written.

use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use csp_shared::world::WorldState;
use csp_sim::{
    sight::InvariantViolation,
    tick::{phases_slowest_first, ScriptErrorWhere, TickHealth, TickReporter},
};
use sentry::{
    metrics,
    protocol::{Context, Event, Exception, Map, Unit},
    ClientInitGuard, Scope,
};
use serde_json::{json, Value};
use tracing::Level;

use crate::{
    log::log_event,
    tick_window::{TickHealthSummary, TickHealthWindow, MINUTE_MS},
};

/// Where the reporter writes its log lines; [`TracingLog`] in the server.
pub trait LogSink {
    fn log(&self, level: Level, fields: Value, message: &str);
}

/// The server's log ([`crate::log`]).
#[derive(Debug, Clone, Copy, Default)]
pub struct TracingLog;

impl LogSink for TracingLog {
    fn log(&self, level: Level, fields: Value, message: &str) {
        log_event(level, &fields, message);
    }
}

/// Starts Sentry when a DSN is configured; the guard flushes it when dropped. Without one,
/// reporting is off and only logs are written.
pub fn init_sentry(dsn: Option<&str>, environment: &str) -> Option<ClientInitGuard> {
    let dsn = dsn?;
    let mut options = sentry::ClientOptions::default();
    options.environment = Some(environment.to_owned().into());
    options.release = sentry::release_name!();
    let guard = sentry::init((dsn, options));
    guard.is_enabled().then_some(guard)
}

/// Tags every later event with the world it came from.
pub fn tag_world(world: &WorldState) {
    sentry::configure_scope(|scope| {
        scope.set_tag("world_seed", world.seed);
        scope.set_tag("tick", world.tick);
    });
}

/// `Sentry.captureException(new Error(message))`.
fn capture_exception(message: &str) {
    sentry::capture_event(Event {
        level: sentry::Level::Error,
        exception: vec![Exception {
            ty: "Error".into(),
            value: Some(message.to_owned()),
            ..Default::default()
        }]
        .into(),
        ..Default::default()
    });
}

/// Runs `capture` with a scope set up by `configure`, as `Sentry.withScope` with both in one.
fn with_scope_capture(configure: impl FnOnce(&mut Scope), capture: impl FnOnce()) {
    sentry::with_scope(configure, capture);
}

/// `Math.round(ms * 10) / 10`.
fn round1(ms: f64) -> f64 {
    (ms * 10.0).round() / 10.0
}

/// `toFixed(digits)`: halves round up, as JavaScript does for these positive times.
pub fn to_fixed(x: f64, digits: usize) -> String {
    let scale = 10f64.powi(digits as i32);
    format!("{:.digits$}", (x * scale).round() / scale)
}

/// The tick reporter of the server (`createTickReporter`), keeping the last hour of tick health.
pub struct ServerReporter<L: LogSink> {
    log: L,
    window: Arc<Mutex<TickHealthWindow>>,
    started: Instant,
    last_summary_ms: f64,
}

impl<L: LogSink> ServerReporter<L> {
    pub fn new(log: L) -> Self {
        Self { log, window: Arc::default(), started: Instant::now(), last_summary_ms: 0.0 }
    }

    /// The tick health window, for admins over HTTP.
    pub fn window(&self) -> Arc<Mutex<TickHealthWindow>> {
        Arc::clone(&self.window)
    }

    pub fn log(&self) -> &L {
        &self.log
    }

    /// When the window's clock started: its ticks are noted at ms since then.
    pub fn started(&self) -> Instant {
        self.started
    }

    /// Notes a tick's health in the window at `at_ms`, and once a minute logs the summary.
    pub fn note_health(&mut self, at_ms: f64, health: &TickHealth) {
        let mut window = self.window.lock().unwrap_or_else(|e| e.into_inner());
        window.push(at_ms, health);
        if at_ms - self.last_summary_ms >= MINUTE_MS {
            self.last_summary_ms = at_ms;
            let summary = window.summary(at_ms);
            drop(window);
            log_summary(&self.log, &summary);
        }
    }
}

/// The tick health summary's log line, once a minute.
pub fn log_summary(log: &impl LogSink, summary: &TickHealthSummary) {
    let m = &summary.last_minute;
    let slowest = m
        .phases
        .iter()
        .max_by(|a, b| a.1.p95.total_cmp(&b.1.p95))
        .map(|(name, p)| format!("; slowest phase {name} (p95 {} ms)", to_fixed(p.p95, 1)))
        .unwrap_or_default();
    log.log(
        Level::INFO,
        serde_json::to_value(summary).unwrap_or(Value::Null),
        &format!(
            "tick health, last minute: {} ticks, p50 {} ms, p95 {} ms, max {} ms{slowest}",
            m.ticks,
            to_fixed(m.duration_ms.p50, 1),
            to_fixed(m.duration_ms.p95, 1),
            to_fixed(m.duration_ms.max, 1),
        ),
    );
}

impl<L: LogSink> TickReporter for ServerReporter<L> {
    fn invariant_violations(&mut self, world: &WorldState, violations: &[InvariantViolation]) {
        for v in violations {
            self.log.log(
                Level::ERROR,
                json!({
                    "tick": world.tick,
                    "seed": world.seed,
                    "invariant": v.invariant,
                    "entityIds": v.entity_ids,
                }),
                &format!("invariant violated: {}", v.message),
            );
            let (tick, seed, ids, inv, message) = (
                world.tick,
                world.seed,
                v.entity_ids.clone(),
                v.invariant.clone(),
                v.message.clone(),
            );
            with_scope_capture(
                |scope| {
                    scope.set_tag("tick", tick);
                    scope.set_tag("world_seed", seed);
                    if !ids.is_empty() {
                        scope.set_tag("entity_ids", ids.join(","));
                        let mut ctx = Map::new();
                        ctx.insert("ids".into(), json!(ids));
                        scope.set_context("entities", Context::Other(ctx));
                    }
                    scope.set_tag("invariant", &inv);
                    // Same invariant groups into one Sentry issue, whatever the entities.
                    scope.set_fingerprint(Some(&["invariant", inv.as_str()]));
                },
                || capture_exception(&format!("Invariant violated: {message}")),
            );
        }
    }

    fn tick_health(&mut self, world: &WorldState, health: &TickHealth) {
        let seed = world.seed;
        metrics::distribution("tick.duration", health.duration_ms)
            .unit(Unit::Millisecond)
            .attribute("world_seed", seed)
            .capture();
        metrics::gauge("tick.residents", health.residents as f64)
            .attribute("world_seed", seed)
            .capture();
        metrics::gauge("tick.actions", health.actions as f64)
            .attribute("world_seed", seed)
            .capture();
        metrics::distribution("tick.npc_plan", health.npc_plan_ms)
            .unit(Unit::Millisecond)
            .attribute("world_seed", seed)
            .capture();
        metrics::distribution("tick.outsiders", health.outsiders_ms)
            .unit(Unit::Millisecond)
            .attribute("world_seed", seed)
            .capture();
        metrics::gauge("tick.scriptRuns", health.script_runs as f64)
            .attribute("world_seed", seed)
            .capture();
        let slowest_first = phases_slowest_first(&health.phases);
        for (phase, ms) in &slowest_first {
            metrics::distribution(format!("tick.phase.{}", phase.name()), *ms)
                .unit(Unit::Millisecond)
                .attribute("world_seed", seed)
                .capture();
        }
        // Logged slowest phase first, so the terminal says where the tick went at a glance.
        let phases: serde_json::Map<String, Value> =
            slowest_first.iter().map(|(p, ms)| (p.name().to_owned(), json!(round1(*ms)))).collect();
        let (slowest, slowest_ms) =
            slowest_first.first().map_or(("world", 0.0), |(p, ms)| (p.name(), *ms));
        let mut fields = serde_json::to_value(health).unwrap_or_else(|_| json!({}));
        fields["phases"] = Value::Object(phases.clone());
        if health.slow {
            fields["seed"] = json!(seed);
            self.log.log(
                Level::WARN,
                fields,
                &format!(
                    "slow tick: {} ms, slowest phase {slowest} ({} ms)",
                    to_fixed(health.duration_ms, 0),
                    to_fixed(slowest_ms, 0)
                ),
            );
            let mut context = Map::new();
            if let Ok(Value::Object(h)) = serde_json::to_value(health) {
                context.extend(h);
            }
            context.insert("phases".into(), Value::Object(phases));
            let (tick, slowest) = (world.tick, slowest.to_owned());
            with_scope_capture(
                |scope| {
                    scope.set_tag("tick", tick);
                    scope.set_tag("world_seed", seed);
                    scope.set_context("tick_health", Context::Other(context));
                    scope.set_tag("slowest_phase", &slowest);
                    scope.set_fingerprint(Some(&["slow-tick"]));
                },
                || {
                    sentry::capture_message("Slow tick", sentry::Level::Warning);
                },
            );
        } else {
            self.log.log(
                Level::DEBUG,
                fields,
                &format!("tick {}: {} ms", health.tick, to_fixed(health.duration_ms, 1)),
            );
        }
        let at = self.started.elapsed().as_secs_f64() * 1000.0;
        self.note_health(at, health);
    }

    fn tick_error(&mut self, world: &WorldState, error: &str) {
        self.log.log(
            Level::ERROR,
            json!({ "err": { "message": error }, "tick": world.tick, "seed": world.seed }),
            "tick failed",
        );
        let (tick, seed) = (world.tick, world.seed);
        with_scope_capture(
            |scope| {
                scope.set_tag("tick", tick);
                scope.set_tag("world_seed", seed);
            },
            || capture_exception(error),
        );
    }

    fn script_error(&mut self, world: &WorldState, error: &str, at: &ScriptErrorWhere) {
        let mut fields = json!({
            "err": { "message": error },
            "tick": world.tick,
            "seed": world.seed,
            "realmId": at.realm_id,
            "entityIds": at.entity_ids,
        });
        if let Some(id) = at.script_id {
            fields["scriptId"] = json!(id);
        }
        let message = match at.script_id {
            None => format!("scripts of realm {} failed", at.realm_id),
            Some(id) => format!("script {id} failed and ended"),
        };
        self.log.log(Level::ERROR, fields, &message);
        let (tick, seed, ids, realm, script) =
            (world.tick, world.seed, at.entity_ids.clone(), at.realm_id.clone(), at.script_id);
        with_scope_capture(
            |scope| {
                scope.set_tag("tick", tick);
                scope.set_tag("world_seed", seed);
                if !ids.is_empty() {
                    scope.set_tag("entity_ids", ids.join(","));
                    let mut ctx = Map::new();
                    ctx.insert("ids".into(), json!(ids));
                    scope.set_context("entities", Context::Other(ctx));
                }
                scope.set_tag("realm_id", &realm);
                if let Some(id) = script {
                    scope.set_tag("script_id", id);
                }
                // The same bug groups into one Sentry issue, whichever script or resident hit it.
                scope.set_fingerprint(Some(&["script-error", "{{ default }}"]));
            },
            || capture_exception(error),
        );
    }
}

/// Reports an error that escaped a client's WebSocket message handler (ADR 0004): logged, and
/// sent to Sentry with the Player it came from.
pub fn report_client_error(log: &impl LogSink, error: &str, user_id: i64) {
    log.log(
        Level::ERROR,
        json!({ "err": { "message": error }, "userId": user_id }),
        "client message failed",
    );
    with_scope_capture(|scope| scope.set_tag("user_id", user_id), || capture_exception(error));
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use csp_sim::tick::{Phases, TickPhase, TickTimer};

    use super::*;

    #[derive(Default)]
    struct FakeLog(RefCell<Vec<(Level, Value, String)>>);

    impl LogSink for FakeLog {
        fn log(&self, level: Level, fields: Value, message: &str) {
            self.0.borrow_mut().push((level, fields, message.to_owned()));
        }
    }

    /// Phases with these times, timed by a clock that reads 0 between them.
    fn phases(times: &[(TickPhase, f64)]) -> Phases {
        let readings: Vec<f64> =
            std::iter::once(0.0).chain(times.iter().flat_map(|&(_, ms)| [0.0, ms])).collect();
        let i = Cell::new(0);
        let timer = TickTimer::new(Box::new(move || {
            let v = readings[i.get()];
            i.set(i.get() + 1);
            v
        }));
        for &(p, _) in times {
            timer.time(p, || ());
        }
        timer.phases()
    }

    fn health(times: &[(TickPhase, f64)], slow: bool) -> TickHealth {
        TickHealth {
            tick: 7,
            duration_ms: times.iter().map(|t| t.1).sum(),
            phases: phases(times),
            residents: 3,
            actions: 2,
            npc_plan_ms: 0.0,
            outsiders_ms: 0.0,
            script_runs: 0,
            sight_builds: 0,
            slow,
        }
    }

    fn world() -> WorldState {
        let terrain = csp_shared::terrain::TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
        csp_sim::world::create_world(&terrain, 1)
    }

    #[test]
    fn warns_of_a_slow_tick_with_its_phases_slowest_first() {
        let mut reporter = ServerReporter::new(FakeLog::default());
        let h = health(
            &[(TickPhase::World, 500.26), (TickPhase::Sight, 300.0), (TickPhase::Orders, 100.0)],
            true,
        );
        reporter.tick_health(&world(), &h);
        let lines = reporter.log().0.borrow();
        let warns: Vec<_> = lines.iter().filter(|l| l.0 == Level::WARN).collect();
        assert_eq!(warns.len(), 1);
        let (_, fields, message) = warns[0];
        assert_eq!(message, "slow tick: 900 ms, slowest phase world (500 ms)");
        let first: Vec<(String, Value)> = fields["phases"]
            .as_object()
            .unwrap()
            .iter()
            .take(3)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        assert_eq!(
            first,
            vec![
                ("world".into(), json!(500.3)),
                ("sight".into(), json!(300.0)),
                ("orders".into(), json!(100.0))
            ]
        );
        assert_eq!(fields["seed"], 1);
        assert!(lines.iter().all(|l| l.0 != Level::DEBUG));
    }

    #[test]
    fn logs_every_other_tick_with_its_phases_at_debug() {
        let mut reporter = ServerReporter::new(FakeLog::default());
        reporter.tick_health(
            &world(),
            &health(&[(TickPhase::Broadcast, 2.0), (TickPhase::World, 5.0)], false),
        );
        let lines = reporter.log().0.borrow();
        assert!(lines.iter().all(|l| l.0 != Level::WARN));
        let (_, fields, message) = lines.iter().find(|l| l.0 == Level::DEBUG).unwrap();
        assert_eq!(message, "tick 7: 7.0 ms");
        assert_eq!(fields["tick"], 7);
        assert_eq!(fields["durationMs"], 7.0);
        assert_eq!(fields["phases"]["world"], 5.0);
        let keys: Vec<&String> = fields["phases"].as_object().unwrap().keys().take(2).collect();
        assert_eq!(keys, vec!["world", "broadcast"]);
    }

    #[test]
    fn logs_the_tick_health_summary_once_a_minute() {
        let mut reporter = ServerReporter::new(FakeLog::default());
        let h = health(&[(TickPhase::World, 5.0)], false);
        for s in 0..=120 {
            reporter.note_health(f64::from(s) * 1000.0 + 1.0, &h);
        }
        let lines = reporter.log().0.borrow();
        let summaries: Vec<_> = lines.iter().filter(|l| l.0 == Level::INFO).collect();
        // A minute in and two minutes in, not at the start.
        assert_eq!(summaries.len(), 2);
        let (_, fields, message) = summaries[1];
        assert_eq!(fields["lastMinute"]["ticks"], 60);
        assert_eq!(fields["lastHour"]["ticks"], 121);
        assert_eq!(
            message,
            "tick health, last minute: 60 ticks, p50 5.0 ms, p95 5.0 ms, max 5.0 ms; slowest phase world (p95 5.0 ms)"
        );
        assert_eq!(reporter.window().lock().unwrap().len(), 121);
    }

    #[test]
    fn logs_invariants_tick_errors_and_script_errors() {
        let mut reporter = ServerReporter::new(FakeLog::default());
        let w = world();
        reporter.invariant_violations(
            &w,
            &[InvariantViolation {
                invariant: "goods".into(),
                message: "made from nothing".into(),
                entity_ids: vec!["b1".into()],
            }],
        );
        reporter.tick_error(&w, "boom");
        let at = ScriptErrorWhere { realm_id: "r1".into(), entity_ids: vec![], script_id: Some(3) };
        reporter.script_error(&w, "bad", &at);
        reporter.script_error(&w, "bad", &ScriptErrorWhere { script_id: None, ..at });
        let lines = reporter.log().0.borrow();
        let messages: Vec<&str> = lines.iter().map(|l| l.2.as_str()).collect();
        assert_eq!(
            messages,
            vec![
                "invariant violated: made from nothing",
                "tick failed",
                "script 3 failed and ended",
                "scripts of realm r1 failed"
            ]
        );
        assert!(lines.iter().all(|l| l.0 == Level::ERROR));
        assert_eq!(lines[0].1["invariant"], "goods");
        assert_eq!(lines[0].1["entityIds"], json!(["b1"]));
        assert_eq!(lines[1].1["err"]["message"], "boom");
        assert_eq!(lines[2].1["scriptId"], 3);
        assert!(lines[3].1.get("scriptId").is_none());
    }

    #[test]
    fn rounds_as_javascript_to_fixed() {
        assert_eq!(to_fixed(900.26, 0), "900");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(7.0, 1), "7.0");
        assert_eq!(to_fixed(0.25, 1), "0.3");
    }
}
