//! The live-world check for undeclared fields (`field-check.test.ts`, the `check-fields` half).
//!
//! The first tests check against a small environment with the names the TypeScript tests' scripts
//! use; the rest against the game's own (`scriptCheckEnv`), with the realm-log notes
//! (`noteScriptViewChanges`).
use std::collections::HashMap;

use csp_lang::{CheckEnv, CheckedGlobal, CheckedType};
use csp_server::db::open_db;
use csp_server::field_check::{
    describe_undeclared_reads, note_script_view_changes, note_view_changes, script_check_env,
    undeclared_field_reads, UndeclaredRead, RESIDENT_OR_ARMY,
};
use csp_server::scripts::{create_script, ensure_default_scripts, game_defaults};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{RealmEventWhat, WorldState};
use csp_sim::events::events_for;
use csp_sim::script_views::{ViewChange, SCRIPT_VIEW_CHANGES};
use csp_sim::world::create_world;
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

// ------------------------------------------------------------- against the game's own views

fn game_reads(db: &Connection) -> Vec<UndeclaredRead> {
    let (own, default) = (script_check_env(false), script_check_env(true));
    undeclared_field_reads(db, [&own, &default]).unwrap()
}

#[test]
fn lists_nothing_for_declared_fields_the_default_scripts_included() {
    let db = open_db(":memory:", None).unwrap();
    let tobin = add_user(&db, "Tobin");
    ensure_default_scripts(&db, game_defaults(), tobin).unwrap();
    let careful = Some("me.hunger + me.stats.strength.base\n");
    create_script(&db, game_defaults(), tobin, Some("careful"), careful).unwrap();
    // A version with a syntax error never runs, so it isn't checked.
    create_script(&db, game_defaults(), tobin, Some("broken"), Some("me.nope = \n")).unwrap();
    assert_eq!(game_reads(&db), []);
}

fn world(told: f64) -> WorldState {
    let terrain = TerrainMap { size: 64, tiles: vec![0; 64 * 64] };
    let mut w = create_world(&terrain, 1);
    w.script_view_changes = told;
    w
}

/// A Player's `scriptFieldDropped` events, as (field, [(script id, name)]).
fn dropped(w: &WorldState, user: i64) -> Vec<(String, Vec<(u64, String)>)> {
    events_for(w, user as u64, 0)
        .into_iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::ScriptFieldDropped { field, scripts } => Some((
                field.clone(),
                scripts.iter().map(|s| (s.script_id, s.name.clone())).collect(),
            )),
            _ => None,
        })
        .collect()
}

#[test]
fn notes_each_dropped_field_for_each_player_whose_scripts_read_it_naming_the_scripts() {
    let db = open_db(":memory:", None).unwrap();
    let mara = add_user(&db, "Mara");
    let tobin = add_user(&db, "Tobin");
    let d = game_defaults();
    let a = create_script(&db, d, mara, Some("feeder"), Some("let h = me.plan\n")).unwrap();
    let b = create_script(&db, d, mara, Some("miner"), Some("me.plan + me.plan\n")).unwrap();
    create_script(&db, d, tobin, Some("careful"), Some("me.hunger\n")).unwrap();
    let mut w = world(0.0);
    // A Player without a realm is told too: the log is theirs, not their realm's.
    assert!(note_script_view_changes(&db, &mut w).unwrap());
    assert_eq!(w.script_view_changes, SCRIPT_VIEW_CHANGES.len() as f64);
    let (a, b) = (a.summary.id as u64, b.summary.id as u64);
    assert_eq!(
        dropped(&w, mara),
        [("me.plan".to_string(), vec![(a, "feeder".to_string()), (b, "miner".to_string())])]
    );
    assert_eq!(dropped(&w, tobin), []);
    // Once told, never again.
    assert!(!note_script_view_changes(&db, &mut w).unwrap());
    assert_eq!(dropped(&w, mara).len(), 1);
}

#[test]
fn notes_only_the_fields_a_later_change_drops() {
    let db = open_db(":memory:", None).unwrap();
    let mara = add_user(&db, "Mara");
    let source = Some("me.plan + me.scheme\n");
    create_script(&db, game_defaults(), mara, Some("feeder"), source).unwrap();
    let mut w = world(1.0);
    let changes = [ViewChange::Undeclared, ViewChange::Dropped(&["resident.scheme"])];
    assert!(note_view_changes(&db, &mut w, &changes).unwrap());
    let fields: Vec<String> = dropped(&w, mara).into_iter().map(|(f, _)| f).collect();
    assert_eq!(fields, ["me.scheme"]);
}
