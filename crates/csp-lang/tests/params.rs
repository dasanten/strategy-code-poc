//! `packages/lang/src/params.test.ts`, ported one to one.

mod support;

use std::collections::HashMap;

use csp_lang::{
    check_names, check_script, parse, run, script_params, CheckEnv, CheckedGlobal, CheckedType,
    Diagnostic, Globals, ParamDeclaration, ParamDefault, ParamType, RunOptions, RunResult, Value,
    ValueLimits,
};
use serde_json::json;

fn param(name: &str, ty: ParamType, line: u32) -> ParamDeclaration {
    ParamDeclaration { name: name.into(), ty, choices: None, default: None, line, column: 1 }
}

fn first_message(source: &str) -> String {
    check_script(source).into_iter().next().map(|d| d.message).unwrap_or_default()
}

fn diagnostic(message: &str, line: u32, column: u32) -> Diagnostic {
    Diagnostic { message: message.into(), line, column }
}

mod param_lines {
    use super::*;

    #[test]
    fn are_read_from_the_top_of_a_script_with_their_type_and_where_they_are() {
        let program =
            parse("// where to\nparam storage: storage\nparam site: building;\nlet x = 1").unwrap();
        assert_eq!(
            program.params,
            [param("storage", ParamType::Storage, 2), param("site", ParamType::Building, 3)]
        );
        assert_eq!(program.body.len(), 1);
        assert_eq!(
            parse("param foodAt: number").unwrap().params,
            [param("foodAt", ParamType::Number, 1)]
        );
        assert_eq!(parse("let x = 1").unwrap().params, []);
    }

    #[test]
    fn are_a_syntax_error_anywhere_but_the_top() {
        assert_eq!(
            check_script("let x = 1\nparam storage: storage"),
            [diagnostic("\"param\" lines go at the top of the script", 2, 1)]
        );
        assert_eq!(check_script("if (true) {\n  param a: building\n}").len(), 1);
    }

    #[test]
    fn need_a_known_type_and_a_name_only_once() {
        assert_eq!(
            first_message("param a: horse"),
            "Expected \"building\" or \"storage\" or \"number\" or \"choice\" or \"waypoint\" after \"param a:\" but found the name \"horse\""
        );
        assert_eq!(
            first_message("param a: building\nparam a: storage"),
            "The param \"a\" appears twice"
        );
    }

    #[test]
    fn read_a_choice_param_with_its_words_and_a_waypoint_param() {
        let program = parse(
            "param toward: choice(north, east, south, west)\nparam to: waypoint;\nparam one: choice(only);",
        )
        .unwrap();
        let words = |w: &[&str]| Some(w.iter().map(|s| s.to_string()).collect());
        assert_eq!(
            program.params,
            [
                ParamDeclaration {
                    choices: words(&["north", "east", "south", "west"]),
                    ..param("toward", ParamType::Choice, 1)
                },
                param("to", ParamType::Waypoint, 2),
                ParamDeclaration {
                    choices: words(&["only"]),
                    ..param("one", ParamType::Choice, 3)
                },
            ]
        );
        assert_eq!(
            serde_json::to_value(script_params(
                "param go: choice(in, out) = out // which way; none: in"
            ))
            .unwrap(),
            json!([{
                "name": "go",
                "type": "choice",
                "choices": ["in", "out"],
                "default": "out",
                "description": "which way; none: in",
                "line": 1,
                "column": 1,
            }])
        );
    }

    #[test]
    fn need_a_choice_param_to_list_its_words_each_once_and_its_default_among_them() {
        assert_eq!(
            first_message("param toward: choice"),
            "Expected \"(\" after \"param toward: choice\" but found the end of the script"
        );
        assert_eq!(
            first_message("param toward: choice()"),
            "Expected a word to choose for \"param toward\" but found \")\""
        );
        assert_eq!(
            first_message("param toward: choice(north, \"east\")"),
            "Expected a word to choose for \"param toward\" but found a string"
        );
        assert_eq!(
            first_message("param toward: choice(north east)"),
            "Expected \")\" to close the words of \"param toward\" but found the name \"east\""
        );
        assert_eq!(
            check_script("param toward: choice(north, south, north)"),
            [diagnostic("The word \"north\" appears twice in \"param toward\"", 1, 36)]
        );
        assert_eq!(
            check_script("param toward: choice(north, south) = west"),
            [diagnostic(
                "The default of \"param toward\" must be \"north\" or \"south\" but found the name \"west\"",
                1,
                38
            )]
        );
        assert_eq!(
            first_message("param toward: choice(north, south) = 1"),
            "The default of \"param toward\" must be \"north\" or \"south\" but found the number 1"
        );
        assert_eq!(
            first_message("param toward: choice(north, south) = \"north\""),
            "The default of \"param toward\" must be \"north\" or \"south\" but found a string"
        );
    }

    #[test]
    fn give_no_default_to_a_waypoint_param() {
        assert_eq!(
            check_script("param to: waypoint = home"),
            [diagnostic(
                "A \"waypoint\" param can't have a default, only a \"number\" or \"choice\" param",
                1,
                20
            )]
        );
    }

    #[test]
    fn may_give_a_number_param_a_default_a_whole_number_of_zero_or_more() {
        assert_eq!(
            parse("param foodAt: number = 3\nparam take: number = 0;\nlet x = 1").unwrap().params,
            [
                ParamDeclaration {
                    default: Some(ParamDefault::Number(3.0)),
                    ..param("foodAt", ParamType::Number, 1)
                },
                ParamDeclaration {
                    default: Some(ParamDefault::Number(0.0)),
                    ..param("take", ParamType::Number, 2)
                },
            ]
        );
        let params = script_params("param rounds: number = 5");
        assert_eq!(params.len(), 1);
        assert_eq!(
            params[0].param,
            ParamDeclaration {
                default: Some(ParamDefault::Number(5.0)),
                ..param("rounds", ParamType::Number, 1)
            }
        );
        assert_eq!(params[0].description, None);
    }

    #[test]
    fn give_no_default_to_a_building_or_storage_param_nor_one_that_is_no_whole_number() {
        assert_eq!(
            check_script("param home: building = 3"),
            [diagnostic(
                "A \"building\" param can't have a default, only a \"number\" or \"choice\" param",
                1,
                22
            )]
        );
        assert_eq!(
            first_message("param s: storage = 1"),
            "A \"storage\" param can't have a default, only a \"number\" or \"choice\" param"
        );
        assert_eq!(
            check_script("param n: number = -1"),
            [diagnostic(
                "The default of \"param n\" must be a whole number of zero or more but found \"-\"",
                1,
                19
            )]
        );
        assert_eq!(
            first_message("param n: number = 1.5"),
            "The default of \"param n\" must be a whole number of zero or more but found the number 1.5"
        );
        assert_eq!(
            first_message("param n: number = \"3\""),
            "The default of \"param n\" must be a whole number of zero or more but found a string"
        );
        assert_eq!(
            first_message("param n: number ="),
            "The default of \"param n\" must be a whole number of zero or more but found the end of the script"
        );
    }

    #[test]
    fn leave_param_free_as_a_name_elsewhere() {
        assert_eq!(
            check_script("let param = 1\nparam = param + 1\nfn f(param) { return param }"),
            []
        );
    }

    #[test]
    fn are_listed_by_script_params_none_for_a_script_with_a_syntax_error() {
        let params = script_params("param a: building\nlet b = 1");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].param, param("a", ParamType::Building, 1));
        assert_eq!(params[0].description, None);
        assert!(script_params("param a: building\nlet = 1").is_empty());
    }

    #[test]
    fn are_listed_by_script_params_with_the_comment_at_the_end_of_their_line() {
        let source = [
            "param workplace: building // the workplace to work; none: the one I stand on",
            "param foodAt: number = 3; //   get Food below this  ",
            "param bare: storage",
            "param empty: storage //",
            "let s = \"// no param comment\"",
        ]
        .join("\n");
        assert_eq!(
            serde_json::to_value(script_params(&source)).unwrap(),
            json!([
                {
                    "name": "workplace",
                    "type": "building",
                    "description": "the workplace to work; none: the one I stand on",
                    "line": 1,
                    "column": 1,
                },
                {
                    "name": "foodAt",
                    "type": "number",
                    "default": 3.0,
                    "description": "get Food below this",
                    "line": 2,
                    "column": 1,
                },
                { "name": "bare", "type": "storage", "line": 3, "column": 1 },
                { "name": "empty", "type": "storage", "line": 4, "column": 1 },
            ])
        );
        // A string before any `//` on the line: the slashes may be in it, so no comment.
        assert_eq!(script_params("param a: building; let s = \"x // y\"")[0].description, None);
    }

    #[test]
    fn read_as_params_name_whatever_the_host_gives() {
        let memory = Value::object::<&str>([]);
        let program = parse("param a: building\nmemory.seen = params.a").unwrap();
        let mut globals = Globals::new();
        globals.set("memory", memory.clone()).set("params", Value::object([("a", Value::Null)]));
        let result = run(
            &program,
            &mut globals,
            &RunOptions {
                steps: 100,
                max_call_depth: 10,
                limits: ValueLimits {
                    max_string_length: 100,
                    max_list_length: 10,
                    max_object_keys: 10,
                },
            },
        )
        .unwrap();
        assert!(matches!(result, RunResult::Done { .. }));
        assert_eq!(support::json(&memory), json!({ "seen": null }));
    }
}

mod checking_params {
    use super::*;

    fn env() -> CheckEnv {
        CheckEnv {
            globals: HashMap::from([("memory".into(), CheckedGlobal::value(CheckedType::Unknown))]),
            shapes: HashMap::from([(
                "place".into(),
                HashMap::from([
                    ("x".into(), CheckedType::Unknown),
                    ("y".into(), CheckedType::Unknown),
                ]),
            )]),
            param_types: HashMap::from([(ParamType::Building, CheckedType::shape("place"))]),
            ..CheckEnv::default()
        }
    }

    fn warnings(source: &str) -> Vec<String> {
        check_names(source, &env()).warnings.into_iter().map(|w| w.message).collect()
    }

    #[test]
    fn warns_of_a_param_the_script_has_no_line_for() {
        assert_eq!(
            warnings("param home: building\nlet a = params.home\nlet b = params.away"),
            ["No param \"away\": declare it with a \"param\" line at the top"]
        );
    }

    #[test]
    fn knows_what_a_param_holds_by_its_type() {
        assert_eq!(
            warnings("param home: building\nlet a = params.home.z"),
            ["\"z\" is not a field of a place"]
        );
        assert!(warnings("param s: storage\nlet a = params.s.anything").is_empty());
    }
}

// Not in the TypeScript tests: the comment regex's `.` stops at a line terminator, so a param
// line of a script saved with CRLF line ends gets no description. Ported as it is.
#[test]
fn a_param_line_ending_in_cr_has_no_description() {
    let params = script_params("param a: building // where\r\nlet b = 1");
    assert_eq!(params[0].description, None);
}
