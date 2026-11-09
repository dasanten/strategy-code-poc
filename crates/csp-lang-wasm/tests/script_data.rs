//! The script tables the editor reads (`packages/lang-wasm/script-data.json`) are the ones this
//! build has: the file is written by `pnpm script-data:rust`, never by hand.

use std::path::Path;

use csp_lang_wasm::{check_game_names, check_names, check_script, script_params, tokenize};
use serde_json::{json, Value};

#[test]
fn script_data_json_is_not_stale() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(csp_lang_wasm::SCRIPT_DATA_PATH);
    let written = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        written == csp_lang_wasm::script_data(),
        "{} is stale: run `pnpm script-data:rust`",
        path.display()
    );
}

#[test]
fn script_data_holds_every_table() {
    let data: Value = serde_json::from_str(&csp_lang_wasm::script_data()).unwrap();
    assert_eq!(data["paramsShape"], "$params");
    assert_eq!(data["residentOrArmy"], "residentOrArmy");
    assert_eq!(data["defaultScripts"]["tearDown"]["name"], "Tear down");
    assert_eq!(data["scriptApi"][0]["name"], "me");
    assert_eq!(data["scriptApi"][0]["returns"], json!({ "view": "resident" }));
    assert!(data["scriptViews"]["resident"]["fields"].as_array().unwrap().len() > 5);
    assert!(data["armyScriptApi"].as_array().unwrap().len() > 5);
}

fn parse(text: String) -> Value {
    serde_json::from_str(&text).unwrap()
}

#[test]
fn answers_json_in_the_typescript_shapes() {
    assert_eq!(parse(check_script("let a = 1")), json!([]));
    assert_eq!(
        parse(check_script("let = 1")),
        json!([{ "message": "Expected a name after \"let\" but found \"=\"", "line": 1, "column": 5 }])
    );
    assert_eq!(
        parse(tokenize("let a")),
        json!({ "tokens": [
            { "type": "keyword", "value": "let", "line": 1, "column": 1 },
            { "type": "identifier", "value": "a", "line": 1, "column": 5 },
            { "type": "end", "line": 1, "column": 6 },
        ] })
    );
    assert!(parse(tokenize("\"open")).get("error").is_some());
    assert_eq!(
        parse(script_params("param n: number = 2 // how many")),
        json!([{ "name": "n", "type": "number", "default": 2.0, "line": 1, "column": 1,
                 "description": "how many" }])
    );
    let env = json!({ "globals": { "hero": { "type": { "shape": "hero" } } },
                      "shapes": { "hero": { "name": "unknown" } },
                      "describedShapes": { "hero": "the hero" } });
    assert_eq!(
        parse(check_names("hero.nam\nfoo", &env.to_string()))["warnings"],
        json!([
            { "message": "\"nam\" is not a field of the hero", "line": 1, "column": 6 },
            { "message": "Unknown name \"foo\"", "line": 2, "column": 1 },
        ])
    );
    let game = parse(check_game_names("me.nam", false));
    assert_eq!(game["reads"][0]["shape"], "residentOrArmy");
    assert_eq!(
        parse(check_game_names("me.members", true))["warnings"].as_array().unwrap().len(),
        1
    );
}
