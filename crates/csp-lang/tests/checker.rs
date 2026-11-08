//! `packages/lang/src/checker.test.ts`, ported one to one.

use std::collections::HashMap;

use csp_lang::{check_names, CheckEnv, CheckResult, CheckedGlobal, CheckedType, Diagnostic};

/// A toy game: a `hero` with a `pos`, a `foes()` list of heroes and a `move(x, y, fast?)`.
fn env() -> CheckEnv {
    let hero = || CheckedType::shape("hero");
    CheckEnv {
        globals: HashMap::from([
            ("hero".into(), CheckedGlobal::value(hero())),
            ("memory".into(), CheckedGlobal::value(CheckedType::Unknown)),
            ("foes".into(), CheckedGlobal::function(CheckedType::list(hero()), &[])),
            ("move".into(), CheckedGlobal::function(CheckedType::Unknown, &["x", "y", "fast?"])),
        ]),
        shapes: HashMap::from([
            (
                "hero".into(),
                HashMap::from([
                    ("name".into(), CheckedType::Unknown),
                    ("pos".into(), CheckedType::shape("spot")),
                    ("allies".into(), CheckedType::list(hero())),
                ]),
            ),
            (
                "spot".into(),
                HashMap::from([
                    ("x".into(), CheckedType::Unknown),
                    ("y".into(), CheckedType::Unknown),
                ]),
            ),
        ]),
        ..CheckEnv::default()
    }
}

fn warnings(source: &str) -> Vec<String> {
    check_names(source, &env()).warnings.into_iter().map(|w| w.message).collect()
}

fn diagnostic(message: &str, line: u32, column: u32) -> Diagnostic {
    Diagnostic { message: message.into(), line, column }
}

#[test]
fn warns_of_names_declared_nowhere_at_where_they_are() {
    assert_eq!(
        check_names("let a = 1\nfoo(a)", &env()).warnings,
        [diagnostic("Unknown name \"foo\"", 2, 1)]
    );
    assert_eq!(warnings("missing = 2"), ["Unknown name \"missing\""]);
}

#[test]
fn knows_locals_parameters_loop_variables_and_functions_used_before_their_declaration() {
    assert!(warnings(
        "
        let n = 1
        fn go(target) { return target + n + later + helper() }
        fn helper() { return 0 }
        for (f of foes()) { go(f) }
        let later = 2
        let anon = fn (a) { return a }"
    )
    .is_empty());
    assert_eq!(warnings("if (true) { let inner = 1 }\ninner"), ["Unknown name \"inner\""]);
}

#[test]
fn warns_of_calls_with_too_few_or_too_many_arguments() {
    assert_eq!(
        warnings("move(1)\nmove(1, 2)\nmove(1, 2, true)\nmove(1, 2, 3, 4)\nfoes(1)"),
        [
            "\"move\" takes 2 to 3 arguments (x, y, fast?), not 1",
            "\"move\" takes 2 to 3 arguments (x, y, fast?), not 4",
            "\"foes\" takes 0 arguments, not 1",
        ]
    );
}

#[test]
fn leaves_a_call_alone_when_a_local_shadows_the_name() {
    assert!(warnings("fn move(a) { return a }\nmove(1)").is_empty());
}

#[test]
fn warns_of_fields_a_known_shape_lacks_at_the_field() {
    assert_eq!(
        check_names("hero.pos.z", &env()).warnings,
        [diagnostic("\"z\" is not a field of a spot", 1, 10)]
    );
    assert_eq!(
        warnings(
            "
        for (f of foes()) { f.nam }
        let first = foes()[0]
        first.pos.x
        first.allies[0].poz
        foes().length
        foes().size"
        ),
        [
            "\"nam\" is not a field of a hero",
            "\"poz\" is not a field of a hero",
            "A list has no \"size\"",
        ]
    );
}

#[test]
fn stays_quiet_where_it_isnt_sure_of_a_value() {
    assert!(warnings(
        "
        memory.anything.deep.down
        fn f(h) { return h.whatever }
        let maybe = hero
        maybe = memory.other
        maybe.unheard
        for (x of memory.list) { x.y.z }
        let built = {a: 1}
        built.b"
    )
    .is_empty());
}

#[test]
fn tells_which_fields_of_known_shapes_a_script_reads() {
    let reads: Vec<(String, String, bool)> =
        check_names("hero.pos.x\nhero.nope\nmemory.free", &env())
            .reads
            .into_iter()
            .map(|r| (r.shape, r.field, r.declared))
            .collect();
    let expected = [("hero", "pos", true), ("spot", "x", true), ("hero", "nope", false)]
        .map(|(s, f, d)| (s.to_string(), f.to_string(), d));
    assert_eq!(reads, expected);
}

#[test]
fn gives_no_warnings_for_a_script_with_a_syntax_error() {
    assert_eq!(check_names("let = foo(", &env()), CheckResult::default());
}

#[test]
fn names_shapes_the_way_it_is_told_to() {
    let named = CheckEnv { describe_shape: Some(Box::new(|s| format!("the {s}"))), ..env() };
    assert_eq!(
        check_names("hero.oops", &named).warnings[0].message,
        "\"oops\" is not a field of the hero"
    );
}

// Not in the TypeScript tests: the checker looked a global up as `globals[name]` on a plain
// JavaScript object, so a name every object has through its prototype (`toString`, …) counted as
// declared, with an `undefined` type that `let` carries on. Ported as it is.
#[test]
fn finds_object_prototype_names_as_the_typescript_did() {
    assert!(warnings("toString\nconstructor.x\nhasOwnProperty(1, 2)").is_empty());
    // `let x = toString` gives `x` the type `undefined`, which a lookup skips, so `x` is unknown.
    assert_eq!(warnings("let x = toString\nx"), ["Unknown name \"x\""]);
}
