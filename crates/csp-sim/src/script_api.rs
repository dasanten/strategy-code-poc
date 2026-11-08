//! The game API as a script sees it (`packages/shared/src/script-api.ts`, `CONTEXT.md`: Script,
//! Memory, Step budget; ADR 0002): the built-in names a running script gets, as plain data, so
//! the server binds them and the editor can list them. A resident's script gets [`SCRIPT_API`],
//! an army's [`ARMY_SCRIPT_API`]: the same values and queries, but army actions. The tables are
//! generated into [`crate::script_tables`].

use csp_lang::{ParamInfo, ParamType, PARAM_TYPES};
use serde_json::Value;

use crate::script_views::ScriptType;

pub use crate::script_tables::{ARMY_SCRIPT_API, PARAM_DESCRIPTIONS, SCRIPT_API};

/// What a name of the game API is (`ScriptBinding.is`): a value read like a variable, a query or
/// an action called.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Is {
    Value,
    Query,
    Action,
}

/// One name of the game API (`ScriptBinding`). `cost` is the steps one call costs on top of the
/// 1 every evaluated node costs; `returns` is what a value holds or a call answers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScriptBinding {
    pub name: &'static str,
    pub is: Is,
    /// The arguments, by name; a `?` marks one that may be left out.
    pub params: &'static [&'static str],
    pub cost: f64,
    pub description: &'static str,
    pub returns: ScriptType,
}

/// A binding of a game API by name.
pub fn binding(api: &'static [ScriptBinding], name: &str) -> Option<&'static ScriptBinding> {
    api.iter().find(|b| b.name == name)
}

/// What a script's `param` line can hold (`SCRIPT_PARAM_TYPES`); the same types as `csp-lang`'s
/// `PARAM_TYPES`.
pub const SCRIPT_PARAM_TYPES: [ParamType; 5] = PARAM_TYPES;

/// A param type's name as the TypeScript writes it.
pub fn param_type_name(t: ParamType) -> &'static str {
    match t {
        ParamType::Building => "building",
        ParamType::Storage => "storage",
        ParamType::Number => "number",
        ParamType::Choice => "choice",
        ParamType::Waypoint => "waypoint",
    }
}

/// Whether a value names a param type (`isScriptParamType`).
pub fn is_script_param_type(value: &Value) -> bool {
    value.as_str().is_some_and(|s| SCRIPT_PARAM_TYPES.iter().any(|t| param_type_name(*t) == s))
}

/// What a param type accepts, for the Wiki and the editor (`PARAM_DESCRIPTIONS[type]`).
pub fn param_description(t: ParamType) -> &'static str {
    let name = param_type_name(t);
    PARAM_DESCRIPTIONS.iter().find(|(n, _)| *n == name).map(|(_, d)| *d).unwrap_or_default()
}

/// The largest whole number a JavaScript number holds exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Whether a value fits a `number` param (`isParamNumber`): a whole number of zero or more.
pub fn is_param_number(value: &Value) -> bool {
    value.as_f64().is_some_and(|n| n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER && n >= 0.0)
}

/// Whether a value fits a `choice` param (`isParamChoice`): one of the words its line lists.
pub fn is_param_choice(param: &ParamInfo, value: &Value) -> bool {
    match (value.as_str(), &param.param.choices) {
        (Some(v), Some(choices)) => choices.iter().any(|c| c == v),
        _ => false,
    }
}

/// A script's `param` line (`ScriptParam`): `csp-lang`'s declaration with its comment.
pub type ScriptParam = ParamInfo;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::script_views::script_view;

    #[test]
    fn every_view_a_binding_returns_exists() {
        fn views(t: ScriptType, out: &mut Vec<&'static str>) {
            match t {
                ScriptType::View(v) => out.push(v),
                ScriptType::List(of) => views(*of, out),
                _ => {}
            }
        }
        let mut named = Vec::new();
        for b in SCRIPT_API.iter().chain(ARMY_SCRIPT_API) {
            views(b.returns, &mut named);
        }
        for v in crate::script_views::SCRIPT_VIEWS {
            for f in v.fields {
                views(f.r#type, &mut named);
            }
        }
        for v in named {
            assert!(script_view(v).is_some(), "{v}");
        }
    }

    #[test]
    fn tells_param_values() {
        assert!(is_param_number(&serde_json::json!(3)));
        assert!(!is_param_number(&serde_json::json!(-1)));
        assert!(!is_param_number(&serde_json::json!(1.5)));
        assert!(is_script_param_type(&serde_json::json!("waypoint")));
        assert!(!is_script_param_type(&serde_json::json!("horse")));
        assert!(param_description(ParamType::Number).starts_with("A whole number"));
    }
}
