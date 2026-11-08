//! Script views (`packages/shared/src/script-views.ts`, `CONTEXT.md`: Script view; ADR 0011):
//! what a script gets of each kind of thing, as plain data beside the game API. Each view lists
//! its fields, each with the kind of value it holds, a description and, for one that can be
//! `null`, when it is. The tables themselves are generated into [`crate::script_tables`].

use serde_json::Value;

pub use crate::script_tables::{SCRIPT_VIEWS, SCRIPT_VIEW_CHANGES};

/// The kind of value a field or an API name holds (`ScriptType`): a plain value, a script view,
/// or a list of either. `Any` is anything (`memory`, an object of the script's own making),
/// never checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptType {
    Number,
    String,
    Boolean,
    Any,
    View(&'static str),
    List(&'static ScriptType),
}

impl ScriptType {
    /// The type as the TypeScript writes it: `"number"`, `{ view: "resident" }`,
    /// `{ list: ... }`.
    pub fn to_json(self) -> Value {
        match self {
            ScriptType::Number => "number".into(),
            ScriptType::String => "string".into(),
            ScriptType::Boolean => "boolean".into(),
            ScriptType::Any => "any".into(),
            ScriptType::View(v) => serde_json::json!({ "view": v }),
            ScriptType::List(t) => serde_json::json!({ "list": t.to_json() }),
        }
    }
}

/// A field of a script view (`ScriptField`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptField {
    pub name: &'static str,
    pub r#type: ScriptType,
    pub description: &'static str,
    /// When the field is `null`; `None` when it never is.
    pub null_when: Option<&'static str>,
}

/// A script view (`ScriptView`): what it is of, in words, and its fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptView {
    pub name: &'static str,
    pub description: &'static str,
    pub fields: &'static [ScriptField],
}

/// One breaking change to the script views (`SCRIPT_VIEW_CHANGES[i].dropped`): the fields it
/// renamed or removed, as `view.field`, or every field the views don't declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewChange {
    Undeclared,
    Dropped(&'static [&'static str]),
}

/// The view called `name`, if there is one (`SCRIPT_VIEWS[name]`).
pub fn script_view(name: &str) -> Option<&'static ScriptView> {
    SCRIPT_VIEWS.iter().find(|v| v.name == name)
}

/// A view's field by name, if it has one (`scriptViewField`).
pub fn script_view_field(view: &str, field: &str) -> Option<&'static ScriptField> {
    script_view(view)?.fields.iter().find(|f| f.name == field)
}

/// `typeof value` for plain data.
fn type_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "object",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) | Value::Object(_) => "object",
    }
}

/// Where a script value doesn't hold what its type declares (`scriptValueProblems`): a field
/// missing that is never null, a value of the wrong kind, or a field its view doesn't declare,
/// each with its path (`residents[0].stats`). A missing field reads as `null` in a script, so it
/// counts as a hidden one. Empty for a value that fits. Invariant (ADR 0004, 0011): every value
/// the server hands a script fits.
pub fn script_value_problems(value: Option<&Value>, t: ScriptType, path: &str) -> Vec<String> {
    let Some(value) = value.filter(|v| !v.is_null()) else { return Vec::new() };
    let plain = |name: &str| {
        if type_of(value) == name {
            Vec::new()
        } else {
            vec![format!("{path} is a {}, not a {name}", type_of(value))]
        }
    };
    match t {
        ScriptType::Any => Vec::new(),
        ScriptType::Number => plain("number"),
        ScriptType::String => plain("string"),
        ScriptType::Boolean => plain("boolean"),
        ScriptType::List(of) => match value {
            Value::Array(items) => items
                .iter()
                .enumerate()
                .flat_map(|(i, item)| {
                    script_value_problems(Some(item), *of, &format!("{path}[{i}]"))
                })
                .collect(),
            _ => vec![format!("{path} is not a list")],
        },
        ScriptType::View(view) => {
            let Value::Object(record) = value else {
                return vec![format!("{path} is not a {view}")];
            };
            let fields = script_view(view).map_or(&[][..], |v| v.fields);
            let mut out: Vec<String> = record
                .keys()
                .filter(|name| !fields.iter().any(|f| f.name == name.as_str()))
                .map(|name| format!("{path}.{name} is not in the {view} view"))
                .collect();
            for f in fields {
                let at = format!("{path}.{}", f.name);
                let item = record.get(f.name).filter(|v| !v.is_null());
                if item.is_none() && f.null_when.is_none() {
                    out.push(format!("{at} is missing"));
                    continue;
                }
                out.extend(script_value_problems(item, f.r#type, &at));
            }
            out
        }
    }
}
