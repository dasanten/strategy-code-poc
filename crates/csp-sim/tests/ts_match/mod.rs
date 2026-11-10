//! Comparing world state the way the TypeScript tests do (`toMatchObject`), for the test files
//! ported in #1110 part 2.

#![allow(dead_code)]

use serde::Serialize;
use serde_json::Value;

/// Whether `got` has everything `want` has (`toMatchObject`): objects may hold more keys, arrays
/// and scalars must be equal, and numbers compare as JavaScript numbers.
pub fn has(got: &Value, want: &Value) -> bool {
    match (got, want) {
        (Value::Object(g), Value::Object(w)) => w.iter().all(|(k, v)| {
            g.get(k).is_some_and(|x| has(x, v)) || (v.is_null() && !g.contains_key(k))
        }),
        (Value::Array(g), Value::Array(w)) => {
            g.len() == w.len() && g.iter().zip(w).all(|(x, v)| has(x, v))
        }
        (Value::Number(g), Value::Number(w)) => g.as_f64() == w.as_f64(),
        _ => got == want,
    }
}

/// Asserts `got`, as JSON, matches `want` (`expect(got).toMatchObject(want)`).
#[track_caller]
pub fn assert_matches<T: Serialize + ?Sized>(got: &T, want: Value) {
    let got = serde_json::to_value(got).expect("serialisable");
    assert!(has(&got, &want), "{got}\ndoes not match\n{want}");
}

/// The JSON of anything serialisable.
pub fn json_of<T: Serialize + ?Sized>(x: &T) -> Value {
    serde_json::to_value(x).expect("serialisable")
}
