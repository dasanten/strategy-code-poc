//! Queues (`CONTEXT.md`: Queue): which orders can be steps and how a step list is checked
//! (`packages/shared/src/queue.ts`). Here rather than in `csp-shared` because the step check
//! measures an order as `JSON.stringify` writes it, which `csp-lang`'s JavaScript helpers know.

use csp_lang::js::{json_string, number_to_string, utf16_len};
use csp_shared::balance::{QUEUE_MAX_STEPS, QUEUE_STEP_MAX_CHARS};
use csp_shared::protocol::BuildLine;
use csp_shared::world::{BuildingKind, OrderRequest, Queue, Tile};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The order kinds a queue step can be (`QUEUE_STEP_KINDS`): the one-off actions and tasks the
/// UI gives a resident, and running one of the Player's scripts. Never a queue.
pub const QUEUE_STEP_KINDS: [&str; 23] = [
    "walkTo",
    "drive",
    "unhitch",
    "hitch",
    "board",
    "getOff",
    "pickUp",
    "drop",
    "store",
    "fetch",
    "build",
    "tearDown",
    "workAt",
    "teach",
    "haul",
    "roadLine",
    "wallLine",
    "mount",
    "dismount",
    "relocate",
    "feed",
    "task",
    "runScript",
];

/// Steps that run a script (a task's default or the Player's own) rather than a built-in order
/// (`runsScript`).
pub fn runs_script(order: &OrderRequest) -> bool {
    order.kind == "task" || order.kind == "runScript"
}

/// An order's field as a string, if it is one.
pub(crate) fn field_str<'a>(order: &'a OrderRequest, name: &str) -> Option<&'a str> {
    order.fields.get(name).and_then(Value::as_str)
}

/// A step that never ends on its own (`neverEnds`): working a workplace, a haul route, feeding a
/// stable, teaching or training.
pub fn never_ends(order: &OrderRequest) -> bool {
    if ["workAt", "haul", "teach"].contains(&order.kind.as_str()) {
        return true;
    }
    order.kind == "task"
        && field_str(order, "task")
            .is_some_and(|t| ["work", "haul", "feedStable", "train"].contains(&t))
}

/// A whole-number tile `{ x, y }`, as `stepLine` reads one.
fn whole_tile(p: Option<&Value>) -> Option<Tile> {
    let p = p?.as_object()?;
    let whole = |v: Option<&Value>| v.and_then(Value::as_f64).filter(|n| n.fract() == 0.0);
    Some(Tile { x: whole(p.get("x"))?, y: whole(p.get("y"))? })
}

/// The line a Build line step carries (`stepLine`, `CONTEXT.md`: Build line): road or wall and
/// its two picked ends. `None` for any other step, and for a Build line step without a whole line.
pub fn step_line(order: &OrderRequest) -> Option<BuildLine> {
    if order.kind != "task" || field_str(order, "task") != Some("buildLine") {
        return None;
    }
    let building = match field_str(order, "building")? {
        "road" => BuildingKind::Road,
        "wall" => BuildingKind::Wall,
        _ => return None,
    };
    let from = whole_tile(order.fields.get("from"))?;
    let to = whole_tile(order.fields.get("to"))?;
    Some(BuildLine { building, from, to })
}

/// A queue step as a request gives it (`QueueStepRequest`): `id` names a step already in the
/// queue being edited.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueueStepRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u32>,
    pub order: OrderRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minutes: Option<f64>,
}

/// How many UTF-16 code units `JSON.stringify` writes for a value.
pub fn json_length(v: &Value) -> usize {
    match v {
        Value::Null => 4,
        Value::Bool(b) => {
            if *b {
                4
            } else {
                5
            }
        }
        Value::Number(n) => number_to_string(n.as_f64().unwrap_or(0.0)).len(),
        Value::String(s) => utf16_len(&json_string(s)),
        Value::Array(items) => {
            2 + items.len().saturating_sub(1) + items.iter().map(json_length).sum::<usize>()
        }
        Value::Object(map) => {
            2 + map.len().saturating_sub(1)
                + map
                    .iter()
                    .map(|(k, v)| utf16_len(&json_string(k)) + 1 + json_length(v))
                    .sum::<usize>()
        }
    }
}

/// Why a list of queue steps can't be given, if it can't (`queueStepsProblem`): each must be an
/// order a step can be (`QUEUE_STEP_KINDS`), at most `QUEUE_MAX_STEPS` of them, with a duration
/// in whole game minutes if any; one that never ends needs a duration unless it is the last. A
/// Build line step carries its whole line (`step_line`) and ends on its own once the line is
/// built or laid out. Takes the steps as the request sent them, any JSON.
pub fn queue_steps_problem(steps: Option<&Value>) -> Option<String> {
    let Some(Value::Array(steps)) = steps else {
        return Some("the steps must be a list".into());
    };
    if steps.len() as f64 > QUEUE_MAX_STEPS {
        return Some(format!("a queue holds at most {} steps", number_to_string(QUEUE_MAX_STEPS)));
    }
    for (i, step) in steps.iter().enumerate() {
        let n = i + 1;
        let order = step.as_object().and_then(|s| s.get("order"));
        let Some(Value::Object(fields)) = order else {
            return Some(format!("step {n} must be an order"));
        };
        let kind = fields.get("kind");
        let Some(kind_str) = kind.and_then(Value::as_str).filter(|k| QUEUE_STEP_KINDS.contains(k))
        else {
            return Some(format!("step {n}: {} can't be a queue step", js_string_of(kind)));
        };
        let mut rest = fields.clone();
        rest.shift_remove("kind");
        let order = OrderRequest { kind: kind_str.to_string(), fields: rest };
        if json_length(&Value::Object(fields.clone())) as f64 > QUEUE_STEP_MAX_CHARS {
            return Some(format!("step {n} is too long"));
        }
        if order.kind == "task"
            && field_str(&order, "task") == Some("buildLine")
            && step_line(&order).is_none()
        {
            return Some(format!(
                "step {n}: a Build line step needs road or wall and its two ends"
            ));
        }
        let minutes = step.as_object().and_then(|s| s.get("minutes"));
        let minutes = match minutes {
            None => None,
            Some(m) => match m.as_f64() {
                Some(v) if v.fract() == 0.0 && v > 0.0 => Some(v),
                _ => return Some(format!("step {n}'s duration must be a whole number of minutes")),
            },
        };
        if minutes.is_none() && never_ends(&order) && n < steps.len() {
            return Some(format!(
                "step {n} never ends on its own: give it a duration or make it the last"
            ));
        }
    }
    None
}

/// `String(v)` for what a request sent as an order's kind.
pub(crate) fn js_string_of(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => number_to_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Array(items)) => items
            .iter()
            .map(|i| match i {
                Value::Null => String::new(),
                other => js_string_of(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// What a script sees of a queue (`QueueView`, the `queue` script view): where it is and the
/// current step.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueView {
    /// The current step, counted from 1.
    pub step: u32,
    pub steps: usize,
    pub r#loop: bool,
    /// The current step's order kind, and the task or script it runs, if any.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minutes: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<f64>,
}

/// What a script sees of a queue (`queueView`).
pub fn queue_view(q: &Queue) -> QueueView {
    let step = &q.steps[q.current as usize];
    QueueView {
        step: q.current + 1,
        steps: q.steps.len(),
        r#loop: q.r#loop,
        kind: step.order.kind.clone(),
        task: field_str(&step.order, "task").map(str::to_string),
        script_id: step.order.fields.get("scriptId").and_then(Value::as_f64),
        minutes: step.minutes,
        started_at: q.started_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn order(v: Value) -> OrderRequest {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn checks_a_step_list() {
        let walk = json!({ "order": { "kind": "walkTo", "x": 1, "y": 2 } });
        assert_eq!(queue_steps_problem(Some(&json!([walk.clone()]))), None);
        assert_eq!(queue_steps_problem(None).as_deref(), Some("the steps must be a list"));
        assert_eq!(
            queue_steps_problem(Some(&json!([{ "order": { "kind": "queue" } }]))).as_deref(),
            Some("step 1: queue can't be a queue step")
        );
        assert_eq!(
            queue_steps_problem(Some(&json!([{ "order": 3 }]))).as_deref(),
            Some("step 1 must be an order")
        );
        let many: Vec<_> = (0..51).map(|_| walk.clone()).collect();
        assert_eq!(
            queue_steps_problem(Some(&Value::Array(many))).as_deref(),
            Some("a queue holds at most 50 steps")
        );
        assert_eq!(
            queue_steps_problem(Some(&json!([{ "order": { "kind": "workAt" } }, walk.clone()])))
                .as_deref(),
            Some("step 1 never ends on its own: give it a duration or make it the last")
        );
        assert_eq!(
            queue_steps_problem(Some(&json!([{ "order": { "kind": "workAt" }, "minutes": 1.5 }])))
                .as_deref(),
            Some("step 1's duration must be a whole number of minutes")
        );
        let long = "x".repeat(1000);
        assert_eq!(
            queue_steps_problem(Some(&json!([{ "order": { "kind": "walkTo", "note": long } }])))
                .as_deref(),
            Some("step 1 is too long")
        );
        assert_eq!(
            queue_steps_problem(Some(
                &json!([{ "order": { "kind": "task", "task": "buildLine" } }])
            ))
            .as_deref(),
            Some("step 1: a Build line step needs road or wall and its two ends")
        );
    }

    #[test]
    fn measures_json_as_javascript_writes_it() {
        assert_eq!(json_length(&json!({ "kind": "walkTo", "x": 1.5, "s": "€\"" })), 35);
    }

    #[test]
    fn reads_a_build_line_step() {
        let o = order(json!({ "kind": "task", "task": "buildLine", "building": "road",
            "from": { "x": 1, "y": 2 }, "to": { "x": 3, "y": 2 } }));
        assert_eq!(
            step_line(&o),
            Some(BuildLine {
                building: BuildingKind::Road,
                from: Tile { x: 1.0, y: 2.0 },
                to: Tile { x: 3.0, y: 2.0 }
            })
        );
        assert!(never_ends(&order(json!({ "kind": "task", "task": "train" }))));
        assert!(!never_ends(&order(json!({ "kind": "walkTo" }))));
    }
}
