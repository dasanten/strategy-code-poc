//! The live-world check for undeclared fields (`field-check.test.ts`, the `check-fields` half).
//!
//! The game's checker environment (`scriptCheckEnv`) arrives with the script views (T86.12); these
//! tests check against a small one with the names the TypeScript tests' scripts use. The case
//! with the default scripts (`ensureDefaultScripts`) waits for the script library (T87.5) and the
//! default scripts (T86.12); the realm-log notes (`noteScriptViewChanges`) for T86.13.
use std::collections::HashMap;

use csp_lang::{CheckEnv, CheckedGlobal, CheckedType};
use csp_server::db::open_db;
use csp_server::field_check::{
    describe_undeclared_reads, undeclared_field_reads, UndeclaredRead, RESIDENT_OR_ARMY,
};
use rusqlite::{params, Connection};

fn env() -> CheckEnv {
    let fields = |names: &[&str]| -> HashMap<String, CheckedType> {
        names.iter().map(|n| (n.to_string(), CheckedType::Unknown)).collect()
    };
    let mut resident = fields(&["hunger", "x", "y"]);
    resident.insert("stats".into(), CheckedType::shape("stats"));
    let mut shapes = HashMap::new();
    shapes.insert(RESIDENT_OR_ARMY.to_string(), resident.clone());
    shapes.insert("resident".to_string(), resident);
    shapes.insert("stats".to_string(), {
        let mut s = HashMap::new();
        s.insert("strength".to_string(), CheckedType::shape("stat"));
        s
    });
    shapes.insert("stat".to_string(), fields(&["base"]));
    let mut globals = HashMap::new();
    globals.insert("me".into(), CheckedGlobal::value(CheckedType::shape(RESIDENT_OR_ARMY)));
    globals.insert(
        "residents".into(),
        CheckedGlobal::function(CheckedType::list(CheckedType::shape("resident")), &[]),
    );
    globals.insert("walkTo".into(), CheckedGlobal::function(CheckedType::Unknown, &["x", "y"]));
    CheckEnv { globals, shapes, describe_shape: None, param_types: HashMap::new() }
}

fn add_user(db: &Connection, name: &str) -> i64 {
    db.query_row("INSERT INTO users (name) VALUES (?1) RETURNING id", [name], |r| r.get(0)).unwrap()
}

/// A script with its versions, the newest active (`createScript` then `saveScript`).
fn add_script(db: &Connection, user: i64, name: &str, versions: &[&str]) -> i64 {
    let id: i64 = db
        .query_row(
            "INSERT INTO scripts (user_id, name) VALUES (?1, ?2) RETURNING id",
            params![user, name],
            |r| r.get(0),
        )
        .unwrap();
    for (i, source) in versions.iter().enumerate() {
        db.execute(
            "INSERT INTO script_versions (script_id, version, source) VALUES (?1, ?2, ?3)",
            params![id, i as i64 + 1, source],
        )
        .unwrap();
    }
    db.execute("UPDATE scripts SET active_version = ?1 WHERE id = ?2", params![versions.len(), id])
        .unwrap();
    id
}

#[test]
fn lists_a_field_an_active_script_reads_that_the_views_dont_declare_with_its_script_and_player() {
    let db = open_db(":memory:", None).unwrap();
    let env = env();
    let mara = add_user(&db, "Mara");
    let s = add_script(
        &db,
        mara,
        "feeder",
        &[
            "let h = me.hunger\n",
            "for (r of residents()) {\n  if (r.secretPlan == 1) { walkTo(r.x, r.y) }\n}\n",
        ],
    );
    // An older version, no longer active, reads one too: it isn't listed.
    let reads = undeclared_field_reads(&db, [&env, &env]).unwrap();
    assert_eq!(
        reads,
        [UndeclaredRead {
            view: "resident".into(),
            field: "secretPlan".into(),
            script_id: s,
            script: "feeder".into(),
            user_id: mara,
            player: "Mara".into(),
            line: 2,
            column: 9,
        }]
    );
    assert_eq!(
        describe_undeclared_reads(&reads),
        [
            "resident.secretPlan".to_string(),
            format!("  Mara · script \"feeder\" ({s}) · 2:9"),
            "1 undeclared field read by 1 Player.".to_string(),
        ]
        .join("\n")
    );
}

#[test]
fn lists_nothing_for_scripts_reading_only_declared_fields() {
    let db = open_db(":memory:", None).unwrap();
    let env = env();
    let tobin = add_user(&db, "Tobin");
    add_script(&db, tobin, "careful", &["me.hunger + me.stats.strength.base\n"]);
    // A version with a syntax error never runs, so it isn't checked.
    add_script(&db, tobin, "broken", &["me.nope = \n"]);
    assert_eq!(undeclared_field_reads(&db, [&env, &env]).unwrap(), []);
    assert_eq!(
        describe_undeclared_reads(&[]),
        "No active script reads a field the script views don’t declare."
    );
}

#[test]
fn groups_the_report_by_field_and_counts_fields_and_players() {
    let db = open_db(":memory:", None).unwrap();
    let env = env();
    let mara = add_user(&db, "Mara");
    let tobin = add_user(&db, "Tobin");
    let a = add_script(&db, mara, "a", &["me.plan\nme.zeal\n"]);
    let b = add_script(&db, tobin, "b", &["me.plan\n"]);
    let reads = undeclared_field_reads(&db, [&env, &env]).unwrap();
    assert_eq!(
        describe_undeclared_reads(&reads),
        [
            "residentOrArmy.plan".to_string(),
            format!("  Mara · script \"a\" ({a}) · 1:4"),
            format!("  Tobin · script \"b\" ({b}) · 1:4"),
            "residentOrArmy.zeal".to_string(),
            format!("  Mara · script \"a\" ({a}) · 2:4"),
            "2 undeclared fields read by 2 Players.".to_string(),
        ]
        .join("\n")
    );
}
