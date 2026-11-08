//! A resident's script log (`apps/server/src/script-log.ts`, `CONTEXT.md`: Script log).

use csp_lang::js::{number_to_string, utf16_len};
use csp_shared::balance::{DOING_MAX_LENGTH, SCRIPT_LOG_LINES};
use csp_shared::world::{Resident, ScriptLogLine, WorldState};

use crate::sight::InvariantViolation;

/// Adds lines a script logged this tick to its resident's script log (`addToScriptLog`), each
/// with the tick; once it holds `SCRIPT_LOG_LINES`, the oldest go.
pub fn add_to_script_log(r: &mut Resident, tick: f64, texts: &[String]) {
    if texts.is_empty() {
        return;
    }
    let mut log = r.script_log.take().unwrap_or_default();
    log.extend(texts.iter().map(|text| ScriptLogLine { tick, text: text.clone() }));
    let keep = SCRIPT_LOG_LINES as usize;
    if log.len() > keep {
        log.drain(..log.len() - keep);
    }
    r.script_log = Some(log);
}

/// Invariant (`script-logs-sound`, ADR 0004): a resident's script log holds at most
/// `SCRIPT_LOG_LINES` lines of short, non-empty text, oldest first and none from the future.
pub fn script_logs_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(log) = &r.script_log else { continue };
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "script-logs-sound".into(),
                message: format!("{}'s script log {message}", r.id),
                entity_ids: vec![r.id.clone()],
            });
        };
        if log.is_empty() || log.len() as f64 > SCRIPT_LOG_LINES {
            fail(format!("holds {} lines", log.len()));
        }
        let mut last = f64::NEG_INFINITY;
        for line in log {
            let len = utf16_len(&line.text);
            if len == 0 || len as f64 > DOING_MAX_LENGTH {
                fail(format!("has a line of {len}"));
            }
            if line.tick < last {
                fail(format!(
                    "goes back from tick {} to {}",
                    number_to_string(last),
                    number_to_string(line.tick)
                ));
            }
            if line.tick > world.tick as f64 {
                fail(format!(
                    "has a line at tick {}, after {}",
                    number_to_string(line.tick),
                    world.tick
                ));
            }
            last = line.tick;
        }
    }
    out
}
