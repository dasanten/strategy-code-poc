//! `packages/lang/src/index.test.ts`, ported one to one. The long trees are what the TypeScript
//! parser gives (`tests/expected/parse.json`, written by `tests/expected/generate.mjs`).

mod support;

use std::sync::LazyLock;

use csp_lang::ast::{Expression, Statement};
use csp_lang::{
    check_script, parse, tokenize, Diagnostic, Program, TokenKind, LANGUAGE_VERSION, MAX_NESTING,
};
use serde_json::Value as Json;
use support::{assert_same_json, shape};

static EXPECTED: LazyLock<Json> = LazyLock::new(|| {
    serde_json::from_str(include_str!("expected/parse.json")).expect("parse.json is JSON")
});

fn statements(source: &str) -> Json {
    shape(&serde_json::to_value(parse(source).unwrap().body).unwrap())
}

fn expr(source: &str) -> Json {
    let program = parse(source).unwrap();
    let [Statement::ExpressionStatement(statement)] = program.body.as_slice() else {
        panic!("not an expression");
    };
    shape(&serde_json::to_value(&statement.expression).unwrap())
}

fn expected_statements(source: &str) -> &'static Json {
    &EXPECTED["statements"][source]
}

fn expected_expression(source: &str) -> &'static Json {
    &EXPECTED["expressions"][source]
}

mod lang {
    use super::*;

    #[test]
    fn exposes_the_language_version() {
        assert_eq!(LANGUAGE_VERSION, 1);
    }
}

mod tokenize_ {
    use super::*;

    #[test]
    fn reads_numbers_strings_names_keywords_and_operators_with_their_positions() {
        let tokens = tokenize("let x = 1.5\n  \"a\\n\" <= y").unwrap();
        assert_same_json(&serde_json::to_value(tokens).unwrap(), &EXPECTED["tokens"]);
    }

    #[test]
    fn skips_line_and_block_comments_and_keeps_counting_lines_through_them() {
        let tokens = tokenize("// first\n/* a\nb */ x // tail\ny").unwrap();
        let seen: Vec<(bool, u32, u32)> =
            tokens.iter().map(|t| (t.kind == TokenKind::End, t.line, t.column)).collect();
        assert_eq!(seen, [(false, 3, 6), (false, 4, 1), (true, 4, 2)]);
        assert!(matches!(&tokens[0].kind, TokenKind::Identifier(x) if x == "x"));
        assert!(matches!(&tokens[1].kind, TokenKind::Identifier(y) if y == "y"));
    }

    #[test]
    fn reads_single_quoted_strings_and_escapes() {
        let values: Vec<Option<String>> = tokenize(r#"'it\'s' "say \"hi\"""#)
            .unwrap()
            .into_iter()
            .map(|t| match t.kind {
                TokenKind::String(s) => Some(s),
                TokenKind::End => None,
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(values, [Some("it's".to_string()), Some("say \"hi\"".to_string()), None]);
    }
}

mod parse_ {
    use super::*;

    #[track_caller]
    fn check_statements(source: &str) {
        assert_same_json(&statements(source), expected_statements(source));
    }

    #[test]
    fn parses_let_with_and_without_a_value() {
        check_statements("let a = 1; let b");
    }

    #[test]
    fn parses_if_else_if_and_else() {
        check_statements("if (a) { 1 } else if (b) { 2 } else { 3 }");
    }

    #[test]
    fn parses_while() {
        check_statements("while (i < 3) { i = i + 1 }");
    }

    #[test]
    fn parses_for_x_of_list() {
        check_statements("for (x of [1, 2]) { say(x) }");
    }

    #[test]
    fn parses_fn_declarations_fn_values_and_return() {
        check_statements("fn add(a, b) { return a + b }\nlet f = fn () { return }");
    }

    #[test]
    fn takes_a_return_value_only_from_the_same_line() {
        check_statements("fn f() { return\n1 }");
    }

    #[test]
    fn parses_numbers_strings_booleans_and_null() {
        let source = "[1, \"a\", true, false, null]";
        assert_same_json(&expr(source), expected_expression(source));
    }

    #[test]
    fn parses_lists_and_objects_with_trailing_commas() {
        check_statements("let o = { role: \"miner\", \"max load\": 3, if: [], }");
    }

    #[test]
    fn parses_comments_anywhere() {
        check_statements("// role\nlet /* inline */ a = 1 // done");
    }

    #[test]
    fn follows_operator_precedence_and_associativity() {
        for source in ["a || b && c == d < e + f * -g", "a - b - c", "a = b = 1"] {
            assert_same_json(&expr(source), expected_expression(source));
        }
        // `toMatchObject({ kind: 'Binary', operator: '*', left: { operator: '+' } })`
        let grouped = expr("(a + b) * c");
        assert_eq!(grouped["kind"], "Binary");
        assert_eq!(grouped["operator"], "*");
        assert_eq!(grouped["left"]["operator"], "+");
        assert_same_json(&grouped, expected_expression("(a + b) * c"));
    }

    #[test]
    fn parses_member_access_indexing_calls_and_assignment_to_them() {
        let source = "memory.plan[0] = world.nearest(\"enemy\").x";
        assert_same_json(&expr(source), expected_expression(source));
    }

    #[test]
    fn parses_the_example_from_adr_0001() {
        let source = [
            "if (memory.role == null) { memory.role = \"gatherer\" }",
            "",
            "let enemy = world.nearest(\"enemy\")",
            "if (enemy != null && distance(me, enemy) < 3) {",
            "  attack(enemy)",
            "} else {",
            "  move(towards(world.nearest(\"resource\")))",
            "}",
        ]
        .join("\n");
        assert_eq!(check_script(&source), []);
        let kinds: Vec<&str> = parse(&source)
            .unwrap()
            .body
            .iter()
            .map(|s| match s {
                Statement::If(_) => "If",
                Statement::Let(_) => "Let",
                _ => "other",
            })
            .collect();
        assert_eq!(kinds, ["If", "Let", "If"]);
    }

    #[test]
    fn records_where_each_node_starts() {
        let program = parse("\n  let a = b + 1").unwrap();
        let [Statement::Let(statement)] = program.body.as_slice() else {
            panic!("one let");
        };
        assert_eq!((statement.line, statement.column), (2, 3));
        let Some(Expression::Binary(init)) = &statement.init else {
            panic!("a binary init");
        };
        assert_eq!((init.line, init.column), (2, 11));
        let right = init.right.position();
        assert_eq!((right.line, right.column), (2, 15));
    }

    #[test]
    fn produces_plain_serialisable_data() {
        let program = parse("fn f(a) { for (x of a) { while (x) { x = {k: [x]} } } }").unwrap();
        let json = serde_json::to_value(&program).unwrap();
        // The same JSON as the TypeScript tree, and it reads back as the same tree.
        assert_same_json(&json, &EXPECTED["serialisable"]);
        let back: Program = serde_json::from_value(json).unwrap();
        assert_eq!(back, program);
    }
}

mod check_script_ {
    use super::*;

    #[test]
    fn accepts_a_valid_script() {
        assert_eq!(check_script("let x = 1"), []);
        assert_eq!(check_script(""), []);
    }

    #[test]
    fn reports_each_syntax_error_at_its_place() {
        let cases: [(&str, u32, u32, &str); 18] = [
            ("let = 1", 1, 5, "Expected a name after \"let\" but found \"=\""),
            ("let x = 1 +", 1, 12, "The script ends where a value was expected"),
            ("if x { }", 1, 4, "Expected \"(\" after \"if\" but found the name \"x\""),
            (
                "while (a {",
                1,
                10,
                "Expected \")\" to close the \"while\" condition but found \"{\"",
            ),
            ("if (a) {\n  b\n", 3, 1, "The \"{\" on line 1 is never closed with \"}\""),
            ("for (let x of xs) {}", 1, 6, "Write \"for (x of list)\" without \"let\""),
            (
                "for (x in xs) {}",
                1,
                8,
                "Expected \"of\" in \"for (x of list)\" but found the name \"in\"",
            ),
            ("fn f(a, a) {}", 1, 9, "The parameter \"a\" appears twice"),
            ("let o = {a: 1, a: 2}", 1, 16, "The key \"a\" appears twice"),
            ("1 + 2 = 3", 1, 7, "Only a name, \"a.b\" or \"a[i]\" can be assigned to"),
            ("say(\"hi)", 1, 5, "This string is never closed with \""),
            ("let a = 1\n/* never", 2, 1, "This comment is never closed with */"),
            ("let a = \"\\q\"", 1, 10, "Unknown escape \"\\q\" in a string"),
            ("let a = 1 # 2", 1, 11, "Unexpected character \"#\""),
            ("let a = 12ab", 1, 11, "Unexpected \"a\" after a number"),
            ("x.", 1, 3, "Expected a property name after \".\" but found the end of the script"),
            ("f(1 2)", 1, 5, "Expected \")\" to close the arguments but found the number 2"),
            ("else { }", 1, 1, "Expected a value but found \"else\""),
        ];
        for (source, line, column, message) in cases {
            assert_eq!(
                check_script(source),
                [Diagnostic { message: message.to_string(), line, column }],
                "{source:?}"
            );
        }
    }

    #[test]
    fn reports_deep_nesting_as_an_error_instead_of_running_out_of_stack() {
        let n = MAX_NESTING as usize * 50;
        let deep = format!("{}1{}", "(".repeat(n), ")".repeat(n));
        let found = check_script(&deep);
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].message,
            format!("The script nests more than {MAX_NESTING} levels deep")
        );
        let m = MAX_NESTING as usize;
        let nested = format!("{}{}", "if (a) {".repeat(m), "}".repeat(m));
        assert_eq!(check_script(&nested).len(), 1);
        let fine = format!("{}1{}", "(".repeat(50), ")".repeat(50));
        assert_eq!(check_script(&fine), []);
    }

    // Invariant: whatever a player types, check_script returns (never panics) and any error it
    // reports points inside the script.
    #[test]
    fn never_throws_and_always_points_inside_the_script_for_any_input() {
        let pieces = [
            "let", "if", "else", "fn", "for", "of", "while", "return", "x", "1", "\"s\"", "'",
            "\"", "(", ")", "{", "}", "[", "]", ",", ":", ";", ".", "=", "==", "+", "-", "!", "&&",
            "/*", "*/", "//", "\n", " ", "#",
        ];
        // The TypeScript's generator, in doubles as JavaScript computes it.
        let mut seed = 1.0f64;
        let mut random = move || {
            seed = (seed * 1_103_515_245.0 + 12_345.0) % 2f64.powi(31);
            seed / 2f64.powi(31)
        };
        for _ in 0..2000 {
            let length = (random() * 30.0).floor() as usize;
            let source = (0..length)
                .map(|_| pieces[(random() * pieces.len() as f64).floor() as usize])
                .collect::<Vec<_>>()
                .join(" ");
            let lines: Vec<&str> = source.split('\n').collect();
            for d in check_script(&source) {
                assert!(d.line >= 1 && d.line as usize <= lines.len(), "{source:?}");
                let line_length = lines[d.line as usize - 1].encode_utf16().count();
                assert!(d.column >= 1 && d.column as usize <= line_length + 1, "{source:?}");
            }
        }
    }
}
