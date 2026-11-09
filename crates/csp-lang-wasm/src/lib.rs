//! The editor's script checker (ADR 0030, T88.3): `csp-lang`'s checker, built to WebAssembly
//! with `wasm-bindgen` into `packages/lang-wasm` (`@csp/lang-wasm`), so the editor finds what the
//! server finds. Every function answers JSON in the TypeScript's shapes (`packages/lang`), which
//! `packages/lang-wasm/src/index.ts` parses; that keeps the module free of `js-sys` and small.
//!
//! [`script_data`] is the other half: the game's script tables (views, API, default scripts) as
//! the JSON `packages/lang-wasm/script-data.json`, written by the `script-data` binary.

use std::cell::OnceCell;
use std::collections::HashMap;

use csp_lang::{CheckEnv, CheckedGlobal, CheckedType, ParamType, KEYWORDS, PARAMS_SHAPE};
use csp_shared::world::Task;
use csp_sim::default_scripts::{task_name, DEFAULT_SCRIPTS};
use csp_sim::script_api::{Is, ScriptBinding, ARMY_SCRIPT_API, PARAM_DESCRIPTIONS, SCRIPT_API};
use csp_sim::script_check::{script_check_env, RESIDENT_OR_ARMY};
use csp_sim::script_views::{ScriptField, SCRIPT_VIEWS};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::wasm_bindgen;

fn to_json(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value).expect("plain data serialises")
}

/// The syntax check (`checkScript`): at most one error, as `{ message, line, column }`.
#[wasm_bindgen(js_name = checkScript)]
pub fn check_script(source: &str) -> String {
    to_json(&csp_lang::check_script(source))
}

/// The checker's warnings and reads (`checkNames`) against an env given as the TypeScript's
/// `CheckEnv` in JSON ([`check_env_from_json`]).
#[wasm_bindgen(js_name = checkNames)]
pub fn check_names(source: &str, env: &str) -> String {
    let env: Value = serde_json::from_str(env).expect("the env is JSON");
    to_json(&csp_lang::check_names(source, &check_env_from_json(&env)))
}

thread_local! {
    /// The game's two envs (`scriptCheckEnv`), built once: any script, and a default script.
    static GAME_ENVS: [OnceCell<CheckEnv>; 2] = const { [OnceCell::new(), OnceCell::new()] };
}

/// The checker's warnings and reads against the game's names and views (`checkNames(source,
/// scriptCheckEnv({ defaultScript }))`).
#[wasm_bindgen(js_name = checkGameNames)]
pub fn check_game_names(source: &str, default_script: bool) -> String {
    GAME_ENVS.with(|envs| {
        let env =
            envs[usize::from(default_script)].get_or_init(|| script_check_env(default_script));
        to_json(&csp_lang::check_names(source, env))
    })
}

/// The tokens (`tokenize`) as `{ "tokens": [...] }`, or `{ "error": { message, line, column } }`
/// for a source that doesn't lex.
#[wasm_bindgen]
pub fn tokenize(source: &str) -> String {
    match csp_lang::tokenize(source) {
        Ok(tokens) => to_json(&json!({ "tokens": tokens })),
        Err(error) => to_json(&json!({ "error": error })),
    }
}

/// A script's `param` lines with their comments (`scriptParams`).
#[wasm_bindgen(js_name = scriptParams)]
pub fn script_params(source: &str) -> String {
    to_json(&csp_lang::script_params(source))
}

fn checked_type(json: &Value) -> CheckedType {
    if json == "unknown" {
        return CheckedType::Unknown;
    }
    if let Some(item) = json.get("list") {
        return CheckedType::list(checked_type(item));
    }
    if let Some(shape) = json.get("shape").and_then(Value::as_str) {
        return CheckedType::shape(shape);
    }
    panic!("not a checked type: {json}");
}

/// A `CheckEnv` from the TypeScript's in JSON: `globals`, `shapes`, `paramTypes`, and
/// `describedShapes` (a shape's words by name) for its `describeShape` function, which JSON
/// can't carry.
pub fn check_env_from_json(json: &Value) -> CheckEnv {
    let map = |key: &str| json.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
    let globals = map("globals")
        .into_iter()
        .map(|(name, g)| {
            let params = g.get("params").and_then(Value::as_array).map(|ps| {
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
        .map(|(ty, t)| (ParamType::from_word(&ty).expect("a param type"), checked_type(&t)))
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

/// A whole number as an integer, so the JSON reads `1`, not `1.0`.
fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

fn field_json(f: &ScriptField) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), json!(f.name));
    out.insert("type".into(), f.r#type.to_json());
    out.insert("description".into(), json!(f.description));
    if let Some(when) = f.null_when {
        out.insert("nullWhen".into(), json!(when));
    }
    Value::Object(out)
}

fn binding_json(b: &ScriptBinding) -> Value {
    let is = match b.is {
        Is::Value => "value",
        Is::Query => "query",
        Is::Action => "action",
    };
    json!({
        "name": b.name,
        "is": is,
        "params": b.params,
        "cost": number(b.cost),
        "description": b.description,
        "returns": b.returns.to_json(),
    })
}

/// The order `DEFAULT_SCRIPTS` lists the default scripts in `default-scripts.ts`, which the
/// Library's template picker shows them in; not the order of `TASKS`.
pub const DEFAULT_SCRIPTS_ORDER: [Task; 11] = [
    Task::Work,
    Task::Build,
    Task::BuildLine,
    Task::Haul,
    Task::TearDown,
    Task::Breed,
    Task::FeedStable,
    Task::Train,
    Task::Explore,
    Task::Defend,
    Task::Alarm,
];

/// The game's script tables in the TypeScript's shapes, for the editor, the library and the
/// Wiki: the language's keywords, the `params` and resident-or-army shape names, what each param
/// type accepts (`PARAM_DESCRIPTIONS`), the script views (`SCRIPT_VIEWS`), both game APIs
/// (`SCRIPT_API`, `ARMY_SCRIPT_API`) and each task's default script (`DEFAULT_SCRIPTS`), as
/// pretty JSON with a final newline.
pub fn script_data() -> String {
    let views: Map<String, Value> = SCRIPT_VIEWS
        .iter()
        .map(|v| {
            let fields: Vec<Value> = v.fields.iter().map(field_json).collect();
            (v.name.to_string(), json!({ "description": v.description, "fields": fields }))
        })
        .collect();
    let param_descriptions: Map<String, Value> =
        PARAM_DESCRIPTIONS.iter().map(|(t, d)| (t.to_string(), json!(d))).collect();
    let default_scripts: Map<String, Value> = DEFAULT_SCRIPTS_ORDER
        .iter()
        .map(|task| {
            let (_, name, source) =
                DEFAULT_SCRIPTS.iter().find(|(t, _, _)| t == task).expect("every task has one");
            (task_name(*task).to_string(), json!({ "name": name, "source": source }))
        })
        .collect();
    let data = json!({
        "keywords": KEYWORDS,
        "paramsShape": PARAMS_SHAPE,
        "residentOrArmy": RESIDENT_OR_ARMY,
        "scriptNameMaxLength": SCRIPT_NAME_MAX_LENGTH,
        "paramDescriptions": param_descriptions,
        "scriptViews": views,
        "scriptApi": SCRIPT_API.iter().map(binding_json).collect::<Vec<_>>(),
        "armyScriptApi": ARMY_SCRIPT_API.iter().map(binding_json).collect::<Vec<_>>(),
        "defaultScripts": default_scripts,
    });
    let mut text = serde_json::to_string_pretty(&data).expect("plain data serialises");
    text.push('\n');
    text
}

/// Script names are at most this many characters (`SCRIPT_NAME_MAX_LENGTH`, the server's in
/// `csp-server`, which this crate can't depend on; a test keeps the two the same).
pub const SCRIPT_NAME_MAX_LENGTH: usize = 40;

/// Where the `script-data` binary writes [`script_data`], from the repository root.
pub const SCRIPT_DATA_PATH: &str = "packages/lang-wasm/script-data.json";
