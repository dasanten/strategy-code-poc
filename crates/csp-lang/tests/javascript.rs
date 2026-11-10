//! Not in the TypeScript tests: what the TypeScript language did through JavaScript without
//! saying so, checked against Node (the expected values are what `node` printed for the same
//! script on the frozen `packages/lang`).

mod support;

use csp_lang::check_script;
use serde_json::json;
use support::*;

#[test]
fn orders_object_keys_as_javascript_does() {
    // Array-index keys first in numeric order, then the others as added.
    let Exec { printed, .. } =
        exec("let o = {b: 1, \"2\": 2, a: 3, \"1\": 4}; o[\"0\"] = 5; out(o)");
    let key_order: Vec<String> = match &printed[0] {
        csp_lang::Value::Object(o) => o.borrow().iter().map(|(k, _)| k.to_string()).collect(),
        other => panic!("{other:?}"),
    };
    assert_eq!(key_order, ["0", "1", "2", "b", "a"]);
}

#[test]
fn writes_numbers_and_counts_strings_as_javascript_does() {
    let Exec { printed, .. } = exec(
        "out(10000000000 * 100000000000 + \"\"); out(0.1 + 0.2 + \"\"); out(-0 + \"\"); out(\"😀\".length); out(\"a\" < \"😀\")",
    );
    assert_eq!(jsons(&printed), json!(["1e+21", "0.30000000000000004", "0", 2, true]));
}

#[test]
fn counts_columns_in_utf16_code_units() {
    assert_eq!(check_script("\"😀\" #")[0].column, 6);
    // A character outside the Basic Multilingual Plane outside a string: JavaScript reported its
    // first half, a lone surrogate, which a Rust string can't hold; it shows as U+FFFD.
    let found = check_script("let a = 😀");
    assert_eq!((found[0].line, found[0].column), (1, 9));
    assert_eq!(found[0].message, "Unexpected character \"\u{FFFD}\"");
}
