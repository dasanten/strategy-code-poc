//! Parity with the frozen TypeScript (ADR 0030): every case of `crates/csp-sim/fixtures/lang/
//! cases.json`, written by `scripts/dump-fixtures.mts` (T84.2) from the scripts of the language
//! tests and the default scripts. Per case: the tokens, the tree (as JSON through serde), the
//! syntax check, the checker's warnings and reads, and for a runnable case the run's result,
//! steps and what it printed.
//!
//! The file reaches this branch with the fixtures epic; until it is there the test says so and
//! passes, and the ported tests are the gate.

mod support;

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;
use std::rc::Rc;

use csp_lang::{
    check_names, check_script, parse, run, tokenize, CheckEnv, CheckedGlobal, CheckedType, Globals,
    ParamType, RunOptions, Value, ValueLimits,
};
use serde_json::{json, Value as Json};
use support::same_json;

fn checked_type(json: &Json) -> CheckedType {
    if json == "unknown" {
        return CheckedType::Unknown;
    }
    if let Some(item) = json.get("list") {
        return CheckedType::list(checked_type(item));
    }
    if let Some(shape) = json.get("shape").and_then(Json::as_str) {
        return CheckedType::shape(shape);
    }
    panic!("not a checked type: {json}");
}

fn check_env(json: &Json) -> CheckEnv {
    let map = |key: &str| json.get(key).and_then(Json::as_object).cloned().unwrap_or_default();
    let globals = map("globals")
        .into_iter()
        .map(|(name, g)| {
            let params = g.get("params").and_then(Json::as_array).map(|ps| {
                ps.iter().map(|p| p.as_str().expect("a param name").to_string()).collect()
            });
            (name, CheckedGlobal { ty: checked_type(&g["type"]), params })
        })
        .collect();
    let shapes = map("shapes")
        .into_iter()
        .map(|(shape, fields)| {
            let fields = fields
                .as_object()
                .expect("fields")
                .iter()
                .map(|(f, t)| (f.clone(), checked_type(t)))
                .collect();
            (shape, fields)
        })
        .collect();
    let param_types = map("paramTypes")
        .into_iter()
        .map(|(ty, t)| {
            let ty = ParamType::from_word(&ty).expect("a param type");
            (ty, checked_type(&t))
        })
        .collect();
    let described: HashMap<String, String> = map("describedShapes")
        .into_iter()
        .map(|(s, d)| (s, d.as_str().expect("a description").to_string()))
        .collect();
    CheckEnv {
        globals,
        shapes,
        param_types,
        describe_shape: (!described.is_empty()).then(|| {
            Box::new(move |s: &str| described.get(s).cloned().unwrap_or_else(|| format!("a {s}")))
                as Box<dyn Fn(&str) -> String>
        }),
    }
}

/// Values a script printed, as JSON: functions by their name (`printable` in the dumper).
fn printable(value: &Value) -> Json {
    match value {
        Value::Function(f) => json!({ "$function": f.name() }),
        Value::Native(n) => json!({ "$native": n.name }),
        Value::List(list) => Json::Array(list.borrow().items.iter().map(printable).collect()),
        Value::Object(object) => Json::Object(
            object.borrow().iter().map(|(k, v)| (k.to_string(), printable(v))).collect(),
        ),
        other => support::json(other),
    }
}

/// The cases whose run declares functions, each by a piece of its source found in it alone, and
/// how many declarations its run went through. The TypeScript charged a step for each; since
/// T89.5 declaring a function costs none (`CONTEXT.md`: Step budget, Daniel, 2026-11-10), so the
/// frozen result of each stands with its steps less that many, and nothing else changes. The
/// fixture file itself stays as the TypeScript wrote it (ADR 0030).
const FREE_DECLARATIONS: &[(&str, u64)] = &[
    ("fn go(target) { return target + n + later + helper() }", 2),
    ("fn move(a) { return a }\nmove(1)", 1),
    ("fn f(h) { return h.whatever }", 1),
    ("fn add(a, b) { return a + b }\nlet f = fn () { return }", 1),
    ("fn f() { return\n1 }", 1),
    ("fn f(a) { for (x of a) { while (x) { x = {k: [x]} } } }", 1),
    ("out(add(2, 3)); fn add(a, b) { return a + b }", 1),
    ("fn f(a, b) { out(b) } out(f(1))", 1),
    ("fn f(a) {} f(1, 2)", 1),
    ("fn counter() { let n = 0; return fn () { n = n + 1; return n } }", 1),
    ("out(fib(15)); fn fib(n)", 1),
    ("out(first([4, 5])); fn first(l) { for (x of l) { return x } }", 1),
    ("fn f() { return f() } f()", 1),
    ("let param = 1\nparam = param + 1\nfn f(param) { return param }", 1),
];

/// The frozen TypeScript result of a run, with the steps of the declarations it went through
/// taken off (`FREE_DECLARATIONS`); `found` counts the cases each entry matched.
fn expected_result(source: &str, typescript: &Json, found: &mut [usize]) -> Json {
    let mut expected = typescript.clone();
    for (i, (piece, declarations)) in FREE_DECLARATIONS.iter().enumerate() {
        if source.contains(piece) {
            found[i] += 1;
            let steps = expected["steps"].as_u64().expect("a run's steps");
            expected["steps"] = json!(steps - declarations);
        }
    }
    expected
}

fn syntax_error(error: &csp_lang::ScriptSyntaxError) -> Json {
    json!({ "message": error.message, "line": error.line, "column": error.column })
}

#[test]
fn every_lang_fixture_case_matches_the_typescript() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../csp-sim/fixtures/lang/cases.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("{} is not on this branch yet: the ported tests are the gate", path.display());
        return;
    };
    let fixture: Json = serde_json::from_str(&text).expect("cases.json is JSON");
    let budget = &fixture["budget"];
    assert_eq!(budget["globals"], json!(["out"]));
    let limits: ValueLimits = serde_json::from_value(budget["limits"].clone()).unwrap();
    let options = RunOptions {
        steps: budget["steps"].as_u64().unwrap(),
        max_call_depth: budget["maxCallDepth"].as_u64().unwrap() as u32,
        limits,
    };
    let envs: HashMap<String, CheckEnv> = fixture["envs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(name, env)| (name.clone(), check_env(env)))
        .collect();

    let cases = fixture["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    let mut ran = 0;
    let mut found = vec![0; FREE_DECLARATIONS.len()];
    for case in cases {
        let source = case["source"].as_str().unwrap();
        let mut differs = |what: &str, actual: Json, expected: &Json| {
            if !same_json(&actual, expected) {
                failures.push(format!(
                    "{} {source:?}: {what}\n  rust:       {actual}\n  typescript: {expected}",
                    case["from"]
                ));
            }
        };

        let tokens = match tokenize(source) {
            Ok(tokens) => json!({ "tokens": tokens }),
            Err(error) => json!({ "error": syntax_error(&error) }),
        };
        match case.get("tokens") {
            Some(expected) => differs("tokens", tokens["tokens"].clone(), expected),
            None => differs("tokenize error", tokens["error"].clone(), &case["error"]),
        }

        let program = parse(source);
        match (&program, case.get("program")) {
            (Ok(program), Some(expected)) => {
                differs("tree", serde_json::to_value(program).unwrap(), expected)
            }
            (Err(error), None) => differs("parse error", syntax_error(error), &case["error"]),
            (Ok(_), None) => differs("parse", json!("parsed"), &case["error"]),
            (Err(error), Some(_)) => differs("parse", syntax_error(error), &json!("a tree")),
        }

        differs("syntax", serde_json::to_value(check_script(source)).unwrap(), &case["syntax"]);
        let env = &envs[case["env"].as_str().unwrap()];
        let names = check_names(source, env);
        differs("warnings", serde_json::to_value(&names.warnings).unwrap(), &case["warnings"]);
        differs("reads", serde_json::to_value(&names.reads).unwrap(), &case["reads"]);

        if let (Some(expected), Ok(program)) = (case.get("run"), &program) {
            ran += 1;
            let printed = Rc::new(RefCell::new(Vec::new()));
            let sink = printed.clone();
            let mut globals = Globals::new();
            globals.function("out", 0, move |args| {
                sink.borrow_mut().push(printable(args.first().unwrap_or(&Value::Null)));
                Ok(Value::Null)
            });
            let result = run(program, &mut globals, &options).expect("no host failure");
            let expected_result = expected_result(source, &expected["result"], &mut found);
            differs("run result", serde_json::to_value(&result).unwrap(), &expected_result);
            differs("printed", Json::Array(printed.borrow().clone()), &expected["printed"]);
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
    assert!(ran > 0, "no case ran");
    // Each case with free declarations is one case, and still in the file.
    for ((piece, _), n) in FREE_DECLARATIONS.iter().zip(&found) {
        assert_eq!(*n, 1, "{piece:?} is in {n} cases");
    }
}
