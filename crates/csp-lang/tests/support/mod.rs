//! What the ported tests share: the `exec`/`value`/`error` helpers of `interpreter.test.ts` and a
//! JSON comparison that reads numbers as JavaScript does.
#![allow(dead_code)]

use std::cell::RefCell;
use std::rc::Rc;

use csp_lang::{parse, plain_value, run, Globals, RunOptions, RunResult, Value, ValueLimits};
use serde_json::Value as Json;

pub const BUDGET: u64 = 100_000;
pub const CALL_DEPTH: u32 = 50;
pub const LIMITS: ValueLimits =
    ValueLimits { max_string_length: 1000, max_list_length: 100, max_object_keys: 50 };

pub fn options() -> RunOptions {
    RunOptions { steps: BUDGET, max_call_depth: CALL_DEPTH, limits: LIMITS }
}

pub struct Exec {
    pub printed: Vec<Value>,
    pub result: RunResult,
}

/// Runs a script with an `out(value)` global and the globals `setup` adds, and returns what it
/// printed and the result.
pub fn exec_with(source: &str, options: RunOptions, setup: impl FnOnce(&mut Globals)) -> Exec {
    let printed = Rc::new(RefCell::new(Vec::new()));
    let mut globals = Globals::new();
    let sink = printed.clone();
    globals.function("out", 0, move |args| {
        sink.borrow_mut().push(args.first().cloned().unwrap_or(Value::Null));
        Ok(Value::Null)
    });
    setup(&mut globals);
    let program = parse(source).expect("the script parses");
    let result = run(&program, &mut globals, &options).expect("no host failure");
    let printed = printed.borrow().clone();
    Exec { printed, result }
}

pub fn exec(source: &str) -> Exec {
    exec_with(source, options(), |_| {})
}

/// The value of one expression.
pub fn value(expression: &str) -> Value {
    let Exec { printed, result } = exec(&format!("out({expression})"));
    assert!(matches!(result, RunResult::Done { .. }), "{expression}: {result:?}");
    printed.into_iter().next().unwrap_or(Value::Null)
}

/// The error message a script stops with.
pub fn error_with(source: &str, options: RunOptions, setup: impl FnOnce(&mut Globals)) -> String {
    match exec_with(source, options, setup).result {
        RunResult::Error { message, .. } => message,
        other => panic!("expected an error, got {other:?}"),
    }
}

pub fn error(source: &str) -> String {
    error_with(source, options(), |_| {})
}

/// A value as JSON, as `toEqual` would see it.
pub fn json(value: &Value) -> Json {
    plain_value(value, usize::MAX).expect("plain data").value
}

pub fn jsons(values: &[Value]) -> Json {
    Json::Array(values.iter().map(json).collect())
}

/// Whether two JSON values are the same, reading every number as an `f64` (`1` and `1.0` are
/// one JavaScript number) and objects' keys in any order.
pub fn same_json(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same_json(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

#[track_caller]
pub fn assert_same_json(actual: &Json, expected: &Json) {
    assert!(same_json(actual, expected), "\n actual:   {actual}\n expected: {expected}");
}

/// Strips positions so tests can compare tree shapes, as `shape` in `index.test.ts`.
pub fn shape(node: &Json) -> Json {
    match node {
        Json::Array(items) => Json::Array(items.iter().map(shape).collect()),
        Json::Object(map) => Json::Object(
            map.iter()
                .filter(|(k, _)| {
                    !["line", "column", "propertyLine", "propertyColumn"].contains(&k.as_str())
                })
                .map(|(k, v)| (k.clone(), shape(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}
