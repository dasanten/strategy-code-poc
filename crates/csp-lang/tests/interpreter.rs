//! `packages/lang/src/interpreter.test.ts`, ported one to one.

mod support;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use csp_lang::{
    parse, run, CallError, Globals, HostError, RunOptions, RunResult, Value, MAX_EVALUATION_DEPTH,
};
use serde_json::json;
use support::*;

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn s(x: &str) -> Value {
    Value::string(x)
}

#[track_caller]
fn assert_value(expression: &str, expected: serde_json::Value) {
    assert_eq!(json(&value(expression)), expected, "{expression}");
}

#[track_caller]
fn assert_printed(source: &str, expected: serde_json::Value) {
    assert_eq!(jsons(&exec(source).printed), expected, "{source}");
}

fn with_steps(steps: u64) -> RunOptions {
    RunOptions { steps, ..options() }
}

fn with_call_depth(max_call_depth: u32) -> RunOptions {
    RunOptions { max_call_depth, ..options() }
}

fn status(result: &RunResult) -> &'static str {
    match result {
        RunResult::Done { .. } => "done",
        RunResult::OutOfSteps { .. } => "out-of-steps",
        RunResult::Error { .. } => "error",
    }
}

mod values_and_operators {
    use super::*;

    #[test]
    fn evaluates_literals() {
        assert_value("42", json!(42));
        assert_value("\"hi\"", json!("hi"));
        assert_value("true", json!(true));
        assert_value("null", json!(null));
        assert_value("[1, \"a\", null]", json!([1, "a", null]));
        assert_value("{ a: 1, b: [2] }", json!({ "a": 1, "b": [2] }));
    }

    #[test]
    fn does_arithmetic_with_precedence() {
        assert_value("1 + 2 * 3", json!(7));
        assert_value("(1 + 2) * 3", json!(9));
        assert_value("10 - 4 - 3", json!(3));
        assert_value("7 / 2", json!(3.5));
        assert_value("7 % 3", json!(1));
        assert_value("-(2 + 3)", json!(-5));
    }

    #[test]
    fn joins_strings_with_numbers_booleans_and_null() {
        assert_value("\"hp \" + 3", json!("hp 3"));
        assert_value("1 + \"x\"", json!("1x"));
        assert_value("\"a\" + true + null", json!("atruenull"));
        assert!(error("\"a\" + [1]").contains("joined to a string"));
    }

    #[test]
    fn compares_numbers_and_strings() {
        assert_value("1 < 2", json!(true));
        assert_value("2 <= 2", json!(true));
        assert_value("\"b\" > \"a\"", json!(true));
        assert_value("3 >= 4", json!(false));
        assert!(error("1 < \"2\"").contains("compares two numbers or two strings"));
    }

    #[test]
    fn compares_equality_by_value_for_plain_values_and_by_identity_for_lists_and_objects() {
        assert_value("1 == 1", json!(true));
        assert_value("\"a\" != \"a\"", json!(false));
        assert_value("null == false", json!(false));
        assert_value("[1] == [1]", json!(false));
        assert_printed("let a = [1]; let b = a; out(a == b)", json!([true]));
    }

    #[test]
    fn treats_false_null_0_and_empty_string_as_false() {
        assert_value("!false", json!(true));
        assert_value("!null", json!(true));
        assert_value("!0", json!(true));
        assert_value("!\"\"", json!(true));
        assert_value("![]", json!(false));
        assert_value("!\"x\"", json!(false));
    }

    #[test]
    fn short_circuits_and_and_or_and_gives_back_an_operand() {
        assert_value("null || \"default\"", json!("default"));
        assert_value("1 && 2", json!(2));
        assert_value("0 && boom()", json!(0));
        assert_value("1 || boom()", json!(1));
    }

    #[test]
    fn stops_on_bad_arithmetic() {
        assert_eq!(error("1 / 0"), "Division by zero");
        assert_eq!(error("1 % 0"), "Division by zero");
        assert!(error("let x = 10; while (true) { x = x * x }").contains("too large"));
        assert!(error("-\"a\"").contains("needs a number"));
        assert!(error("true * 2").contains("needs two numbers"));
    }
}

mod variables_and_scopes {
    use super::*;

    #[test]
    fn declares_reads_and_assigns_variables() {
        assert_printed("let x = 1; x = x + 1; let y; out(x); out(y)", json!([2, null]));
    }

    #[test]
    fn scopes_variables_to_their_block() {
        assert_printed("let x = 1; { let x = 2; out(x) } out(x)", json!([2, 1]));
        assert_eq!(error("{ let inner = 1 } out(inner)"), "\"inner\" is not defined");
    }

    #[test]
    fn rejects_unknown_and_doubly_declared_names() {
        assert_eq!(error("out(nope)"), "\"nope\" is not defined");
        assert_eq!(error("nope = 1"), "\"nope\" is not defined");
        assert_eq!(error("let a = 1; let a = 2"), "\"a\" is already declared here");
    }

    #[test]
    fn keeps_globals_from_being_reassigned_but_lets_their_contents_change() {
        let me = Value::object::<&str>([]);
        assert_eq!(
            error_with("me = 1", options(), |g| {
                g.set("me", me);
            }),
            "\"me\" can't be changed"
        );
        let memory = Value::object::<&str>([]);
        let m = memory.clone();
        let Exec { result, .. } = exec_with("memory.role = \"miner\"", options(), |g| {
            g.set("memory", m);
        });
        assert_eq!(status(&result), "done");
        assert_eq!(json(&memory), json!({ "role": "miner" }));
    }

    #[test]
    fn lets_a_script_shadow_a_global_with_its_own_variable() {
        let Exec { printed, .. } = exec_with("let me = 5; out(me)", options(), |g| {
            g.set("me", Value::object::<&str>([]));
        });
        assert_eq!(jsons(&printed), json!([5]));
    }
}

mod control_flow {
    use super::*;

    #[test]
    fn runs_if_else_if_else() {
        let script = |n: i32| {
            jsons(&exec(&format!(
                "let n = {n}; if (n < 0) {{ out(\"neg\") }} else if (n == 0) {{ out(\"zero\") }} else {{ out(\"pos\") }}"
            ))
            .printed)
        };
        // `-1` is written as `let n = -1`, a unary minus, as in the TypeScript.
        assert_eq!(script(-1), json!(["neg"]));
        assert_eq!(script(0), json!(["zero"]));
        assert_eq!(script(1), json!(["pos"]));
    }

    #[test]
    fn loops_with_while() {
        assert_printed("let i = 0; while (i < 3) { out(i); i = i + 1 }", json!([0, 1, 2]));
    }

    #[test]
    fn loops_over_a_list_with_for_over_a_copy_of_it() {
        assert_printed(
            "let list = [1, 2]; for (x of list) { list[list.length] = x; out(x) }",
            json!([1, 2]),
        );
        assert!(error("for (x of 5) {}").contains("\"for\" needs a list"));
    }

    #[test]
    fn ends_the_run_on_a_top_level_return() {
        let Exec { printed, result } = exec("out(1); if (true) { return } out(2)");
        assert_eq!(jsons(&printed), json!([1]));
        assert_eq!(status(&result), "done");
    }
}

mod functions {
    use super::*;

    #[test]
    fn declares_and_calls_functions_also_before_their_declaration() {
        assert_printed("out(add(2, 3)); fn add(a, b) { return a + b }", json!([5]));
    }

    #[test]
    fn returns_null_without_a_return_and_missing_arguments_are_null() {
        assert_printed("fn f(a, b) { out(b) } out(f(1))", json!([null, null]));
    }

    #[test]
    fn rejects_too_many_arguments_and_calling_a_non_function() {
        assert_eq!(error("fn f(a) {} f(1, 2)"), "\"f\" takes 1 argument, not 2");
        assert_eq!(error("let x = 3; x()"), "The number 3 is not a function");
    }

    #[test]
    fn makes_closures_that_keep_their_scope() {
        assert_printed(
            "
      fn counter() { let n = 0; return fn () { n = n + 1; return n } }
      let c = counter(); c(); c(); out(c())
    ",
            json!([3]),
        );
    }

    #[test]
    fn recurses() {
        assert_printed(
            "out(fib(15)); fn fib(n) { if (n < 2) { return n } return fib(n - 1) + fib(n - 2) }",
            json!([610]),
        );
    }

    #[test]
    fn returns_from_inside_loops() {
        assert_printed("out(first([4, 5])); fn first(l) { for (x of l) { return x } }", json!([4]));
    }
}

mod lists_and_objects {
    use super::*;

    #[test]
    fn reads_and_writes_list_items_and_length() {
        assert_printed(
            "let l = [1, 2]; l[0] = 9; l[2] = 3; out(l); out(l.length); out(l[5])",
            json!([[9, 2, 3], 3, null]),
        );
        assert!(error("let l = []; l[2] = 1").contains("can be written at 0 to 0"));
        assert!(error("[1][0.5]").contains("whole number"));
        assert_value("\"abc\".length", json!(3));
    }

    #[test]
    fn reads_and_writes_object_properties_missing_ones_are_null() {
        assert_printed(
            "let o = { a: 1 }; o.b = 2; o[\"c\"] = 3; out(o); out(o.zzz); out(o[\"a\"])",
            json!([{ "a": 1, "b": 2, "c": 3 }, null, 1]),
        );
    }

    #[test]
    fn does_not_reach_javascript_prototypes() {
        assert_value("{}.toString", json!(null));
        assert_value("{}.constructor", json!(null));
        let memory = Value::object::<&str>([]);
        let m = memory.clone();
        exec_with("memory.__proto__ = { evil: true }", options(), |g| {
            g.set("memory", m);
        });
        // An own key like any other.
        assert_eq!(json(&memory), json!({ "__proto__": { "evil": true } }));
    }

    #[test]
    fn stops_on_reading_or_writing_through_the_wrong_kind_of_value() {
        assert_eq!(error("let x = null; x.a"), "Can't read \"a\" of null");
        assert_eq!(error("let x = 1; x.a = 2"), "Can't set \"a\" of the number 1");
        assert!(error("let o = {}; o[1]").contains("keys are strings"));
        assert_eq!(error("[1].foo"), "A list has no \"foo\"");
    }

    #[test]
    fn keeps_frozen_host_values_read_only() {
        let me = Value::object([("hp", n(10.0))]).freeze();
        let m = me.clone();
        assert_eq!(
            error_with("me.hp = 99", options(), |g| {
                g.set("me", m);
            }),
            "The object can't be changed"
        );
        assert_eq!(json(&me), json!({ "hp": 10 }));
    }
}

mod native_functions {
    use super::*;

    #[test]
    fn passes_arguments_and_gives_back_the_result() {
        let Exec { printed, .. } = exec_with("out(add(2, 3))", options(), |g| {
            g.function("add", 0, |args| {
                let a = args[0].as_number().unwrap();
                let b = args[1].as_number().unwrap();
                Ok(n(a + b))
            });
        });
        assert_eq!(jsons(&printed), json!([5]));
    }

    #[test]
    fn turns_a_script_error_into_an_error_at_the_call() {
        let Exec { result, .. } = exec_with("\n  move(\"up\")", options(), |g| {
            g.function("move", 0, |_| Err(CallError::Script("No such direction".into())));
        });
        let RunResult::Error { message, line, column, .. } = result else {
            panic!("an error: {result:?}");
        };
        assert_eq!((message.as_str(), line, column), ("No such direction", 2, 3));
    }

    #[test]
    fn passes_on_other_errors_from_the_host() {
        let mut globals = Globals::new();
        globals.function("broken", 0, |_| Err(CallError::Host(HostError("host bug".into()))));
        let program = parse("broken()").unwrap();
        assert_eq!(run(&program, &mut globals, &options()), Err(HostError("host bug".into())));
    }
}

mod step_budget {
    use super::*;

    #[test]
    fn counts_one_step_per_evaluated_node() {
        // Program body: ExpressionStatement, Call, Identifier `out`, Number → 4 steps.
        assert_eq!(exec("out(1)").result, RunResult::Done { steps: 4 });
        // Let + Number.
        assert_eq!(exec("let x = 1").result.steps(), 2);
    }

    /// `CONTEXT.md`: Step budget (Daniel, 2026-11-10): declaring a function costs no step,
    /// calling it does.
    #[test]
    fn declaring_a_function_costs_no_step_and_calling_it_does() {
        let declarations = "fn a() {}\nfn b(x) { return x }\nfn c() { out(1) }";
        assert_eq!(exec(declarations).result, RunResult::Done { steps: 0 });
        // Declarations alone never run out of steps, even on a budget of none.
        assert_eq!(
            exec_with(declarations, with_steps(0), |_| {}).result,
            RunResult::Done { steps: 0 }
        );
        // In a block, the block is the one step.
        assert_eq!(exec("{ fn a() {} fn b() {} }").result.steps(), 1);
        // A call: its statement, the call, the name, the body's block, the return, the number.
        assert_eq!(exec("fn a() { return 1 }\na()").result.steps(), 6);
        // The same as calling a function value, which costs its let and the value on top.
        assert_eq!(exec("let a = fn () { return 1 }\na()").result.steps(), 6 + 2);
        // A function declared and never called adds nothing.
        assert_eq!(exec("fn a() { return 1 }\nfn unused() { return 2 }\na()").result.steps(), 6);
    }

    #[test]
    fn a_declared_function_is_one_function_however_often_it_is_read_and_can_be_assigned_over() {
        let Exec { printed, .. } = exec("let g = f\nout(g == f)\nfn f() {}\nf = 3\nout(f)");
        assert_eq!(jsons(&printed), json!([true, 3]));
        let Exec { printed, .. } = exec("fn f() {}\nf = 3\nout(f)");
        assert_eq!(jsons(&printed), json!([3]));
    }

    #[test]
    fn still_refuses_a_name_declared_twice_in_a_block_where_it_starts() {
        let twice = exec("out(1)\nfn f() {}\nfn f() {}");
        assert_eq!(status(&twice.result), "error");
        let RunResult::Error { message, line, column, .. } = &twice.result else { unreachable!() };
        assert_eq!((message.as_str(), *line, *column), ("\"f\" is already declared here", 3, 1));
        // Refused as the block starts, before anything in it ran.
        assert_eq!(jsons(&twice.printed), json!([]));
        assert_eq!(error("fn f() {}\nlet f = 1"), "\"f\" is already declared here");
    }

    #[test]
    fn charges_a_native_function_its_cost_on_top() {
        let Exec { result, .. } = exec_with("attack()", options(), |g| {
            g.function("attack", 10, |_| Ok(Value::Null));
        });
        assert_eq!(result.steps(), 13);
    }

    #[test]
    fn stops_an_endless_loop_at_the_budget() {
        let Exec { printed, result } =
            exec_with("let i = 0; while (true) { out(i); i = i + 1 }", with_steps(500), |_| {});
        assert!(matches!(result, RunResult::OutOfSteps { steps: 500, .. }));
        assert!(printed.len() > 10);
    }

    #[test]
    fn keeps_what_the_script_already_did_before_running_out() {
        let actions = Rc::new(RefCell::new(Vec::new()));
        let seen = actions.clone();
        let Exec { result, .. } =
            exec_with("say(\"a\"); say(\"b\"); while (true) {}", with_steps(50), |g| {
                g.function("say", 0, move |args| {
                    seen.borrow_mut().push(args.first().cloned().unwrap_or(Value::Null));
                    Ok(Value::Null)
                });
            });
        assert_eq!(status(&result), "out-of-steps");
        assert_eq!(jsons(&actions.borrow()), json!(["a", "b"]));
    }

    #[test]
    fn does_not_call_a_native_function_it_cannot_afford() {
        let called = Rc::new(Cell::new(false));
        let flag = called.clone();
        let Exec { result, .. } = exec_with("expensive()", with_steps(50), |g| {
            g.function("expensive", 100, move |_| {
                flag.set(true);
                Ok(Value::Null)
            });
        });
        assert!(matches!(result, RunResult::OutOfSteps { line: 1, column: 1, .. }));
        assert!(!called.get());
    }

    #[test]
    fn runs_nothing_with_a_budget_of_zero() {
        let Exec { printed, result } = exec_with("out(1)", with_steps(0), |_| {});
        assert!(printed.is_empty());
        assert!(matches!(result, RunResult::OutOfSteps { steps: 0, .. }));
    }

    #[test]
    fn points_at_the_node_it_stopped_at() {
        let Exec { result, .. } = exec_with("let a = 1\nlet b = 2", with_steps(2), |_| {});
        assert!(matches!(result, RunResult::OutOfSteps { line: 2, column: 1, .. }));
    }

    #[test]
    fn never_uses_more_than_the_budget_invariant() {
        let scripts = [
            "let i = 0; while (i < 100) { i = i + 1 }",
            "fn f(n) { if (n < 1) { return 0 } return f(n - 1) + 1 } f(30)",
            "for (x of [1, 2, 3, 4, 5]) { cost(x) }",
            "let o = { a: [1, 2, { b: 3 }] }; o.a[2].b = o.a[0] + o.a[1]",
        ];
        let mut globals = Globals::new();
        globals.function("cost", 7, |_| Ok(Value::Null));
        for source in scripts {
            let program = parse(source).unwrap();
            for steps in 0..=600 {
                let result = run(&program, &mut globals, &with_steps(steps)).unwrap();
                assert!(result.steps() <= steps);
                if let RunResult::Done { .. } = result {
                    // Any bigger budget gives the same result.
                    assert_eq!(run(&program, &mut globals, &with_steps(BUDGET)).unwrap(), result);
                } else {
                    assert_eq!(status(&result), "out-of-steps");
                }
            }
        }
    }
}

mod nesting_too_deep {
    use super::*;

    #[test]
    fn stops_endless_recursion_at_the_call_depth() {
        let Exec { result, .. } =
            exec_with("fn f() { return f() } f()", with_call_depth(20), |_| {});
        assert!(
            matches!(&result, RunResult::Error { message, .. } if message == "Function calls nest more than 20 deep"),
            "{result:?}"
        );
    }

    #[test]
    fn allows_calls_exactly_up_to_the_call_depth() {
        let script = "fn f(n) { if (n > 1) { f(n - 1) } } f(20)";
        assert_eq!(status(&exec_with(script, with_call_depth(20), |_| {}).result), "done");
        assert_eq!(status(&exec_with(script, with_call_depth(19), |_| {}).result), "error");
    }

    #[test]
    fn caps_the_overall_evaluation_depth_even_with_a_huge_call_depth() {
        let Exec { result, .. } =
            exec_with("fn f() { return f() } f()", with_call_depth(1_000_000), |_| {});
        assert!(
            matches!(&result, RunResult::Error { message, .. } if message == "The script nests too deeply"),
            "{result:?}"
        );
        const { assert!(MAX_EVALUATION_DEPTH > 0) };
    }
}

mod purity_and_determinism {
    use super::*;

    const SOURCE: &str = "
    fn step(state) {
      let next = []
      for (x of state) { next[next.length] = (x * 31 + 7) % 101 }
      return next
    }
    let s = memory.state || [1, 2, 3]
    let i = 0
    while (i < 20) { s = step(s); i = i + 1 }
    memory.state = s
    memory.text = \"sum \" + s[0] + s[1]
  ";

    fn once(program: &csp_lang::Program) -> (RunResult, Value) {
        let memory = Value::object::<&str>([]);
        let mut globals = Globals::new();
        globals.set("memory", memory.clone());
        (run(program, &mut globals, &options()).unwrap(), memory)
    }

    #[test]
    fn gives_the_same_result_and_memory_for_the_same_input() {
        let program = parse(SOURCE).unwrap();
        let (a, memory_a) = once(&program);
        let (b, memory_b) = once(&program);
        assert_eq!(a, b);
        assert!(memory_a.deep_equals(&memory_b));
        assert_eq!(json(&memory_a), json(&memory_b));
    }

    #[test]
    fn does_not_change_the_program_or_the_globals_it_is_given() {
        let program = parse(SOURCE).unwrap();
        let before = serde_json::to_string(&program).unwrap();
        let mut globals = Globals::new();
        globals.set("memory", Value::object::<&str>([]));
        run(&program, &mut globals, &options()).unwrap();
        assert_eq!(serde_json::to_string(&program).unwrap(), before);
        assert_eq!(globals.names().collect::<Vec<_>>(), ["memory"]);
    }

    #[test]
    fn sees_only_the_globals_it_is_given() {
        assert_eq!(error("console"), "\"console\" is not defined");
        assert_eq!(error("Math"), "\"Math\" is not defined");
        assert_eq!(error("globalThis"), "\"globalThis\" is not defined");
    }

    #[test]
    fn keeps_memory_plain_serialisable_data() {
        let memory = Value::object::<&str>([]);
        let m = memory.clone();
        exec_with("memory.a = { list: [1, \"x\", null, true] }", options(), |g| {
            g.set("memory", m);
        });
        let plain = json(&memory);
        assert!(Value::from_json(&plain).deep_equals(&memory));
        assert_eq!(plain, json!({ "a": { "list": [1, "x", null, true] } }));
    }
}

mod value_limits {
    use super::*;

    const MAX_STRING: usize = LIMITS.max_string_length;
    const MAX_LIST: usize = LIMITS.max_list_length;
    const MAX_KEYS: usize = LIMITS.max_object_keys;

    #[track_caller]
    fn assert_error_on_line(result: &RunResult, expected: &str, expected_line: u32) {
        let RunResult::Error { message, line, steps, .. } = result else {
            panic!("an error: {result:?}");
        };
        assert_eq!((message.as_str(), *line), (expected, expected_line));
        assert!(*steps < BUDGET);
    }

    /// The fastest of three runs of `script`, in ms, and what the last one gave: a moment of load on
    /// a busy machine slows one run, not all three (T89.6), so the time stays a check of the work.
    fn fastest_of_three(script: &str) -> (u128, Exec) {
        let mut best = u128::MAX;
        let mut last = None;
        for _ in 0..3 {
            let start = Instant::now();
            let run = exec(script);
            best = best.min(start.elapsed().as_millis());
            last = Some(run);
        }
        (best, last.expect("three runs"))
    }

    #[test]
    fn stops_a_string_doubling_past_the_cap_quickly_and_within_the_budget() {
        let (ms, Exec { result, .. }) =
            fastest_of_three("let s = \"x\"\nwhile (true) { s = s + s }");
        assert_error_on_line(
            &result,
            &format!("A string can hold at most {MAX_STRING} characters"),
            2,
        );
        assert!(ms < 1000, "{ms} ms");
    }

    #[test]
    fn allows_a_string_just_at_the_cap_and_refuses_one_more_character() {
        let grow = format!(
            "let s = \"\"; let i = 0; while (i < {MAX_STRING}) {{ s = s + \"x\"; i = i + 1 }}"
        );
        let Exec { printed, result } = exec(&format!("{grow} out(s.length)"));
        assert_eq!(status(&result), "done");
        assert_eq!(jsons(&printed), json!([MAX_STRING]));
        let too_long = format!("A string can hold at most {MAX_STRING} characters");
        assert_eq!(error(&format!("{grow} s = s + 1")), too_long);
        assert_eq!(error(&format!("{grow} s = 1 + s")), too_long);
        assert_value(&format!("\"{}\".length", "y".repeat(MAX_STRING)), json!(MAX_STRING));
        assert!(error(&format!("\"{}\"", "y".repeat(MAX_STRING + 1))).contains("at most"));
    }

    #[test]
    fn stops_a_list_growing_past_the_cap_quickly_and_within_the_budget() {
        let (ms, Exec { result, .. }) =
            fastest_of_three("let l = []\nwhile (true) { l[l.length] = 1 }");
        assert_error_on_line(&result, &format!("A list can hold at most {MAX_LIST} items"), 2);
        assert!(ms < 1000, "{ms} ms");
    }

    #[test]
    fn allows_a_full_list_replacing_its_items_and_a_literal_of_that_size() {
        let items = vec!["1"; MAX_LIST].join(", ");
        assert_value(&format!("[{items}].length"), json!(MAX_LIST));
        assert_eq!(
            error(&format!("[{items}, 1]")),
            format!("A list can hold at most {MAX_LIST} items")
        );
        let full = format!("let l = [{items}]; l[0] = 2; l[{}] = 3", MAX_LIST - 1);
        assert_eq!(status(&exec(&full).result), "done");
        assert!(error(&format!("{full}; l[{MAX_LIST}] = 4")).contains("at most"));
    }

    #[test]
    fn stops_an_object_gaining_keys_past_the_cap_quickly_and_within_the_budget() {
        let (ms, Exec { result, .. }) =
            fastest_of_three("let o = {}; let i = 0\nwhile (true) { o[\"k\" + i] = i; i = i + 1 }");
        assert_error_on_line(&result, &format!("An object can hold at most {MAX_KEYS} keys"), 2);
        assert!(ms < 1000, "{ms} ms");
    }

    #[test]
    fn allows_a_full_object_rewriting_its_keys_and_a_literal_of_that_size() {
        let keys = |n: usize| (0..n).map(|i| format!("k{i}: {i}")).collect::<Vec<_>>().join(", ");
        let full = format!("let o = {{{}}}; o.k0 = 9; o[\"k1\"] = 8", keys(MAX_KEYS));
        assert_eq!(status(&exec(&full).result), "done");
        assert_eq!(
            error(&format!("{full}; o.more = 1")),
            format!("An object can hold at most {MAX_KEYS} keys")
        );
        assert!(error(&format!("let o = {{{}}}", keys(MAX_KEYS + 1))).contains("at most"));
    }

    #[test]
    fn reads_host_values_bigger_than_the_caps_but_cannot_grow_them() {
        let list = || Value::list(vec![n(0.0); MAX_LIST + 5]);
        let text = || s(&"z".repeat(MAX_STRING + 5));
        let Exec { printed, result } =
            exec_with("out(list.length); out(text.length)", options(), |g| {
                g.set("list", list()).set("text", text());
            });
        assert_eq!(status(&result), "done");
        assert_eq!(jsons(&printed), json!([MAX_LIST + 5, MAX_STRING + 5]));
        assert!(error_with("list[list.length] = 1", options(), |g| {
            g.set("list", list());
        })
        .contains("at most"));
        assert!(error_with("text + \"!\"", options(), |g| {
            g.set("text", text());
        })
        .contains("at most"));
    }
}
