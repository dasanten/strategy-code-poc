//! The game's side of the script checker (`packages/shared/src/script-check.ts`; `check_names` in
//! `csp-lang`; `CONTEXT.md`: Script view): the API names a script gets and the shapes of the
//! script views, in the checker's terms. A script isn't typed as a resident's or an army's, so
//! both APIs are in, and `me` holds either; a default script (it has a task) runs only as a
//! resident's and gets that API alone.

use std::collections::{HashMap, HashSet};

use csp_lang::checker::{CheckEnv, CheckedGlobal, CheckedType, ShapeFields};
use csp_lang::ParamType;

use crate::script_api::{Is, ScriptBinding, ARMY_SCRIPT_API, SCRIPT_API};
use crate::script_views::{ScriptType, SCRIPT_VIEWS};

/// The shape of `me` where it may be a resident or an army (`RESIDENT_OR_ARMY`).
pub const RESIDENT_OR_ARMY: &str = "residentOrArmy";

/// A view's type as the checker knows it: views and lists of them; plain values aren't checked.
fn checked(t: ScriptType) -> CheckedType {
    match t {
        ScriptType::View(v) => CheckedType::shape(v),
        ScriptType::List(of) => CheckedType::list(checked(*of)),
        _ => CheckedType::Unknown,
    }
}

fn params_of(b: &ScriptBinding) -> Vec<String> {
    b.params.iter().map(|p| p.to_string()).collect()
}

/// The same name in both APIs (`merged`): what both allow, and only what both agree on is
/// certain.
fn merged(r: &ScriptBinding, a: &ScriptBinding) -> CheckedGlobal {
    let (r_type, a_type) = (checked(r.returns), checked(a.returns));
    let ty = if r_type == a_type {
        r_type
    } else if r.name == "me" {
        CheckedType::shape(RESIDENT_OR_ARMY)
    } else {
        CheckedType::Unknown
    };
    if r.is == Is::Value {
        return CheckedGlobal { ty, params: None };
    }
    let long = if r.params.len() >= a.params.len() { r.params } else { a.params };
    let needed = |ps: &[&str]| ps.iter().filter(|p| !p.ends_with('?')).count();
    let least = needed(r.params).min(needed(a.params));
    // The longer list's names, those past the fewest either needs marked as optional.
    let params = long
        .iter()
        .enumerate()
        .map(|(i, p)| if i >= least && !p.ends_with('?') { format!("{p}?") } else { p.to_string() })
        .collect();
    CheckedGlobal { ty, params: Some(params) }
}

/// How a shape is named in a warning (`NOUNS`); `a <shape>` for the rest.
fn describe_shape(shape: &str) -> String {
    let noun = match shape {
        RESIDENT_OR_ARMY => "a resident or an army",
        "army" => "an army",
        "stats" => "stats",
        "skills" => "skills",
        "goods" => "goods",
        "residentOrder" => "a resident’s order",
        "armyOrder" => "an army’s order",
        "runningScript" => "a running script",
        "lastSeen" => "a last-seen building or city",
        "directiveGoal" => "a directive’s goal",
        "site" => "a construction site’s progress",
        "hire" => "an NPC city’s hire offer",
        other => return format!("a {other}"),
    };
    noun.to_string()
}

/// The names and shapes a script is checked against (`scriptCheckEnv`).
pub fn script_check_env(default_script: bool) -> CheckEnv {
    let mut shapes: HashMap<String, ShapeFields> = HashMap::new();
    for view in SCRIPT_VIEWS {
        shapes.insert(
            view.name.to_string(),
            view.fields.iter().map(|f| (f.name.to_string(), checked(f.r#type))).collect(),
        );
    }
    let resident = &shapes["resident"];
    let army = &shapes["army"];
    let names: HashSet<&String> = resident.keys().chain(army.keys()).collect();
    let either: ShapeFields = names
        .into_iter()
        .map(|f| {
            let t = match (resident.get(f), army.get(f)) {
                (Some(r), Some(a)) if r != a => CheckedType::Unknown,
                (Some(r), _) => r.clone(),
                (None, Some(a)) => a.clone(),
                (None, None) => unreachable!("a name of one of them"),
            };
            (f.clone(), t)
        })
        .collect();
    shapes.insert(RESIDENT_OR_ARMY.to_string(), either);

    let entry = |b: &ScriptBinding| CheckedGlobal {
        ty: checked(b.returns),
        params: (b.is != Is::Value).then(|| params_of(b)),
    };
    let army_api: &[ScriptBinding] = if default_script { &[] } else { ARMY_SCRIPT_API };
    let mut globals = HashMap::new();
    for b in SCRIPT_API {
        let g = match army_api.iter().find(|a| a.name == b.name) {
            Some(a) => merged(b, a),
            None => entry(b),
        };
        globals.insert(b.name.to_string(), g);
    }
    for a in army_api {
        if !SCRIPT_API.iter().any(|b| b.name == a.name) {
            globals.insert(a.name.to_string(), entry(a));
        }
    }

    CheckEnv {
        globals,
        shapes,
        describe_shape: Some(Box::new(describe_shape)),
        // A storage param may hold a carriage as well, so only a building one is certain.
        param_types: HashMap::from([
            (ParamType::Building, CheckedType::shape("building")),
            (ParamType::Waypoint, CheckedType::shape("waypoint")),
        ]),
    }
}

#[cfg(test)]
mod tests {
    //! `script-check.test.ts`.
    use super::*;
    use crate::default_scripts::DEFAULT_SCRIPTS;

    fn warnings(source: &str, default_script: bool) -> Vec<String> {
        csp_lang::check_names(source, &script_check_env(default_script))
            .warnings
            .into_iter()
            .map(|w| w.message)
            .collect()
    }

    #[test]
    fn warns_of_a_misspelt_query_an_action_with_too_few_arguments_and_an_unknown_field() {
        assert_eq!(warnings("resdents()", false), ["Unknown name \"resdents\""]);
        assert_eq!(warnings("walkTo(3)", false), ["\"walkTo\" takes 2 arguments (x, y), not 1"]);
        assert_eq!(
            warnings("pickUp({kind: \"ground\"})", false),
            ["\"pickUp\" takes 2 arguments (spot, goods), not 1"]
        );
        assert_eq!(
            warnings("me.hungr", false),
            ["\"hungr\" is not a field of a resident or an army"]
        );
        assert_eq!(warnings("me.hungr", true), ["\"hungr\" is not a field of a resident"]);
    }

    #[test]
    fn follows_queries_lists_and_fields_to_their_views() {
        let source = "
        for (r of residents()) { r.stats.strength.base + r.helth }
        let b = building(\"b1\")
        b.site.delivered.wood + b.stok
        storages()[0].kind
        directives()[0].goals[0].cout";
        assert_eq!(
            warnings(source, false),
            [
                "\"helth\" is not a field of a resident",
                "\"stok\" is not a field of a building",
                "\"cout\" is not a field of a directive’s goal",
            ]
        );
    }

    #[test]
    fn stays_quiet_about_memory_function_parameters_and_the_scripts_own_objects() {
        let source = "
        memory.anything.deep = 1
        let x = memory.anything.deep
        fn at(spot) { return spot.whatever }
        let mine = {a: 1}
        mine.b";
        assert!(warnings(source, false).is_empty());
    }

    #[test]
    fn offers_both_apis_to_a_players_script_the_residents_alone_to_a_default_script() {
        assert!(warnings("guard(1, 2)\nme.members\nme.carried", false).is_empty());
        assert_eq!(warnings("guard(1, 2)", true), ["Unknown name \"guard\""]);
        assert_eq!(warnings("me.members", true), ["\"members\" is not a field of a resident"]);
    }

    #[test]
    fn finds_nothing_in_the_default_scripts() {
        for (task, _, source) in DEFAULT_SCRIPTS {
            assert!(warnings(source, true).is_empty(), "{task:?}");
            assert!(warnings(source, false).is_empty(), "{task:?}");
        }
    }
}
