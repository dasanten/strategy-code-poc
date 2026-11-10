//! A script value as the plain data it stands for, in one bounded walk (`CONTEXT.md`: Memory):
//! the twin of `apps/server/src/plain-value.ts`, which keeps a script's memory as plain data and
//! caps its size.
//!
//! Script lists and objects are shared by reference, so a value where each level points at the
//! previous one twice is built in a few steps per level but stands for a tree that doubles with
//! each level. This walk counts the characters of the JSON it would make and gives up as soon as
//! they pass `max`, so it stays as cheap as the limit. Shared references within the limit are
//! fine and come out as separate copies. The lists and objects on the current path are tracked,
//! so a value that holds itself is found instead of overflowing the stack.

use std::collections::HashSet;

use crate::js;
use crate::value::Value;

/// Why a value can't be plain data: it holds a function, holds itself, or is too large.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotPlain {
    Function,
    Cycle,
    Size,
}

/// A value as plain data, with the characters of its JSON.
#[derive(Debug, Clone, PartialEq)]
pub struct Plain {
    pub value: serde_json::Value,
    pub size: usize,
}

/// `value` as plain data within `max` characters of JSON, or why it can't be.
pub fn plain_value(value: &Value, max: usize) -> Result<Plain, NotPlain> {
    let mut walk = Walk { path: HashSet::new(), size: 0, max, why: None };
    let plain = walk.walk(value);
    if walk.why.is_none() && walk.size > max {
        walk.why = Some(NotPlain::Size);
    }
    match walk.why {
        None => Ok(Plain { value: plain, size: walk.size }),
        Some(why) => Err(why),
    }
}

/// A number as JSON: a whole number as JSON text would read back (an integer), else a float.
pub fn number_json(n: f64) -> serde_json::Value {
    if n.trunc() == n && n.is_finite() {
        if n == 0.0 {
            return serde_json::Value::from(0u64);
        }
        if n > 0.0 && n < 18_446_744_073_709_551_616.0 {
            return serde_json::Value::from(n as u64);
        }
        if (-9_223_372_036_854_775_808.0..0.0).contains(&n) {
            return serde_json::Value::from(n as i64);
        }
    }
    serde_json::Number::from_f64(n)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::Null)
}

struct Walk {
    path: HashSet<usize>,
    size: usize,
    max: usize,
    why: Option<NotPlain>,
}

impl Walk {
    fn walk(&mut self, v: &Value) -> serde_json::Value {
        match v {
            Value::Null => {
                self.size += 4;
                serde_json::Value::Null
            }
            Value::Bool(b) => {
                self.size += if *b { 4 } else { 5 };
                serde_json::Value::Bool(*b)
            }
            Value::Number(n) => {
                // JSON has no NaN or Infinity; `JSON.stringify` writes null for them.
                if !n.is_finite() {
                    self.size += 4;
                    return serde_json::Value::Null;
                }
                self.size += js::number_to_string(*n).len();
                number_json(*n)
            }
            Value::String(s) => {
                self.size += js::utf16_len(&js::json_string(s));
                serde_json::Value::String(s.to_string())
            }
            Value::Function(_) | Value::Native(_) => {
                self.why = Some(NotPlain::Function);
                serde_json::Value::Null
            }
            Value::List(list) => {
                if !self.path.insert(list.addr()) {
                    self.why = Some(NotPlain::Cycle);
                    return serde_json::Value::Null;
                }
                let items = list.borrow().items.clone();
                self.size += 2 + items.len().saturating_sub(1);
                let mut out = Vec::new();
                for item in &items {
                    if self.size > self.max {
                        self.why = Some(NotPlain::Size);
                    }
                    if self.why.is_some() {
                        break;
                    }
                    out.push(self.walk(item));
                }
                self.path.remove(&list.addr());
                serde_json::Value::Array(out)
            }
            Value::Object(object) => {
                if !self.path.insert(object.addr()) {
                    self.why = Some(NotPlain::Cycle);
                    return serde_json::Value::Null;
                }
                let entries: Vec<(String, Value)> =
                    object.borrow().iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
                self.size += 2 + entries.len().saturating_sub(1);
                let mut out = serde_json::Map::new();
                for (key, item) in &entries {
                    self.size += js::utf16_len(&js::json_string(key)) + 1;
                    if self.size > self.max {
                        self.why = Some(NotPlain::Size);
                    }
                    if self.why.is_some() {
                        break;
                    }
                    let plain = self.walk(item);
                    out.insert(key.clone(), plain);
                }
                self.path.remove(&object.addr());
                serde_json::Value::Object(out)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The cases of `keepMemory` in `apps/server/src/script-runner.test.ts`, at the level of the
    // walk (the messages are the runner's, ported with the bindings).
    #[test]
    fn keeps_plain_data_and_refuses_cycles_functions_and_size() {
        let memory = Value::object([
            (
                "a",
                Value::list(vec![Value::Number(1.0), Value::object([("b", Value::string("c"))])]),
            ),
            ("d", Value::Null),
        ]);
        let plain = plain_value(&memory, 1000).unwrap();
        assert_eq!(plain.value, json!({ "a": [1, { "b": "c" }], "d": null }));
        assert_eq!(plain.size, serde_json::to_string(&plain.value).unwrap().len());

        let lp = Value::object::<&str>([]);
        if let Value::Object(o) = &lp {
            o.borrow_mut().insert("self", lp.clone());
        }
        assert_eq!(plain_value(&lp, 1000), Err(NotPlain::Cycle));
        let nested = Value::object([("list", Value::list(vec![Value::object([("loop", lp)])]))]);
        assert_eq!(plain_value(&nested, 1000), Err(NotPlain::Cycle));
        let f = Value::object([("f", Value::native("f", 0, 0))]);
        assert_eq!(plain_value(&f, 1000), Err(NotPlain::Function));

        // Shared references come out as separate copies.
        let tile = Value::object([("x", Value::Number(1.0)), ("y", Value::Number(2.0))]);
        let shared = Value::object([
            ("a", tile.clone()),
            ("b", tile.clone()),
            ("list", Value::list(vec![tile.clone(), tile])),
        ]);
        let plain = plain_value(&shared, 1000).unwrap();
        assert_eq!(plain.value["list"][1], json!({ "x": 1, "y": 2 }));

        // A value doubling at each level gives up at the limit instead of walking it all.
        let mut value = Value::list(vec![]);
        for _ in 0..60 {
            value = Value::list(vec![value.clone(), value]);
        }
        assert_eq!(plain_value(&value, 4000), Err(NotPlain::Size));
    }

    #[test]
    fn counts_size_as_json_text() {
        let value = Value::object([
            ("n", Value::Number(-1.5e-7)),
            ("s", Value::string("a\"\n€")),
            ("t", Value::Bool(false)),
            ("nan", Value::Number(f64::NAN)),
        ]);
        let plain = plain_value(&value, 1000).unwrap();
        // JSON.stringify({n: -1.5e-7, s: 'a"\n€', t: false, nan: NaN})
        assert_eq!(plain.size, r#"{"n":-1.5e-7,"s":"a\"\n€","t":false,"nan":null}"#.len() - 2);
        assert_eq!(plain_value(&value, plain.size - 1), Err(NotPlain::Size));
    }
}
