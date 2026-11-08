//! The script library against a real database (`scripts.test.ts`). The game's default scripts
//! arrive with T86.12; these tests use a stand-in default for every task, as the TypeScript tests
//! only need each to be valid and the same until changed. The HTTP cases are in `tests/app.rs`;
//! the Leader's-death case, which needs the world rules, waits for T86.8.
use csp_server::db::open_db;
use csp_server::scripts::{
    activate_version, active_source, check_script_library, create_script, default_script_id,
    delete_older_versions, delete_script, delete_version, get_script, list_scripts, rename_script,
    reset_script, save_script, task_name, DefaultScript, ScriptDetail,
};
use csp_shared::balance::{SCRIPT_LIBRARY_MAX_SCRIPTS, SCRIPT_MAX_VERSIONS};
use csp_shared::world::default_scripts::Task;
use rusqlite::{params, Connection};

const VALID: &str = "let x = 1\n";
const VALID_2: &str = "let x = 2\n";
const BROKEN: &str = "let = \n";

const TASKS: [Task; 11] = [
    Task::Work,
    Task::Build,
    Task::Haul,
    Task::TearDown,
    Task::Breed,
    Task::FeedStable,
    Task::Defend,
    Task::Train,
    Task::BuildLine,
    Task::Explore,
    Task::Alarm,
];

/// A stand-in for `DEFAULT_SCRIPTS`: a valid script of its own for every task.
pub fn defaults() -> Vec<DefaultScript> {
    TASKS
        .iter()
        .map(|&task| {
            let name = task_name(task);
            DefaultScript {
                task,
                name: format!("{}{}", name[..1].to_uppercase(), &name[1..]),
                source: format!("// {name} (default)\nlet task = 1\n"),
            }
        })
        .collect()
}

struct Lib {
    db: Connection,
    defaults: Vec<DefaultScript>,
}

impl Lib {
    fn new() -> Self {
        Lib { db: open_db(":memory:", None).unwrap(), defaults: defaults() }
    }

    fn add_user(&self, name: &str) -> i64 {
        self.db
            .query_row("INSERT INTO users (name) VALUES (?1) RETURNING id", [name], |r| r.get(0))
            .unwrap()
    }

    fn create(&self, user: i64, name: &str, source: &str) -> ScriptDetail {
        create_script(&self.db, &self.defaults, user, Some(name), Some(source)).unwrap()
    }

    fn save(&self, user: i64, id: i64, source: &str) -> ScriptDetail {
        save_script(&self.db, &self.defaults, user, id, Some(source)).unwrap()
    }

    fn get(&self, user: i64, id: i64) -> ScriptDetail {
        get_script(&self.db, &self.defaults, user, id).unwrap()
    }

    fn own_names(&self, user: i64) -> Vec<String> {
        list_scripts(&self.db, &self.defaults, user)
            .unwrap()
            .into_iter()
            .filter(|s| s.task.is_none())
            .map(|s| s.name)
            .collect()
    }

    fn default_id(&self, user: i64, task: Task) -> i64 {
        default_script_id(&self.db, &self.defaults, user, task).unwrap().unwrap()
    }

    fn check(&self) -> Vec<(String, Vec<String>)> {
        check_script_library(&self.db, &self.defaults)
            .unwrap()
            .into_iter()
            .map(|v| (v.invariant, v.entity_ids))
            .collect()
    }
}

fn code<T: std::fmt::Debug>(r: csp_server::auth::AuthResult<T>) -> String {
    match r {
        Err(csp_server::auth::AuthFailure::Auth(e)) => {
            serde_json::to_value(e.code).unwrap().as_str().unwrap().to_owned()
        }
        other => panic!("expected an API error, got {other:?}"),
    }
}

fn message<T: std::fmt::Debug>(r: csp_server::auth::AuthResult<T>) -> String {
    match r {
        Err(csp_server::auth::AuthFailure::Auth(e)) => e.message,
        other => panic!("expected an API error, got {other:?}"),
    }
}

fn numbers(s: &ScriptDetail) -> Vec<i64> {
    s.versions.iter().map(|v| v.version).collect()
}

// ------------------------------------------------------------------------------ script library

#[test]
fn saves_new_versions_keeping_every_one() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID);
    assert_eq!(
        (s.summary.name.as_str(), s.summary.active_version, s.summary.latest_version),
        ("miners", Some(1), 1)
    );
    lib.save(mara, s.summary.id, VALID_2);
    let after = lib.save(mara, s.summary.id, VALID);
    let versions: Vec<(i64, &str)> =
        after.versions.iter().map(|v| (v.version, v.source.as_str())).collect();
    assert_eq!(versions, [(1, VALID), (2, VALID_2), (3, VALID)]);
    assert_eq!(after.summary.active_version, Some(3));
    assert_eq!(active_source(&lib.db, s.summary.id).unwrap().as_deref(), Some(VALID));
    assert_eq!(lib.check(), []);
}

#[test]
fn makes_a_version_with_warnings_but_no_syntax_errors_the_active_version() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "typos", VALID);
    // An unknown field, an unknown name and too few arguments: warnings in the editor only.
    let after = lib.save(mara, s.summary.id, "me.hungr\nresdents()\nwalkTo(3)\n");
    assert_eq!((after.summary.active_version, after.summary.latest_version), (Some(2), 2));
    assert_eq!(after.versions.last().unwrap().errors, []);
}

#[test]
fn renames_a_script_keeping_its_history_names_are_unique_per_player_regardless_of_case() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let tobin = lib.add_user("Tobin");
    let a = lib.create(mara, "miners", VALID);
    let id = a.summary.id;
    lib.save(mara, id, VALID_2);
    lib.create(mara, "farmers", VALID);
    // Another Player may use the same name.
    lib.create(tobin, "Miners", VALID);

    let renamed = rename_script(&lib.db, &lib.defaults, mara, id, Some("  diggers ")).unwrap();
    assert_eq!(
        (
            renamed.summary.name.as_str(),
            renamed.summary.active_version,
            renamed.summary.latest_version
        ),
        ("diggers", Some(2), 2)
    );
    assert_eq!(
        code(rename_script(&lib.db, &lib.defaults, mara, id, Some("FARMERS"))),
        "name-taken"
    );
    assert_eq!(
        code(create_script(&lib.db, &lib.defaults, mara, Some("Diggers"), Some(VALID))),
        "name-taken"
    );
    // Changing only the case of its own name is fine.
    let cased = rename_script(&lib.db, &lib.defaults, mara, id, Some("Diggers")).unwrap();
    assert_eq!(cased.summary.name, "Diggers");
    assert_eq!(lib.own_names(mara), ["Diggers", "farmers"]);
}

#[test]
fn deletes_a_script_with_its_history() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let a = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, a, VALID_2);
    let b = lib.create(mara, "farmers", VALID).summary.id;
    delete_script(&lib.db, mara, a).unwrap();
    let own: Vec<i64> = list_scripts(&lib.db, &lib.defaults, mara)
        .unwrap()
        .into_iter()
        .filter(|s| s.task.is_none())
        .map(|s| s.id)
        .collect();
    assert_eq!(own, [b]);
    let defaults: Vec<i64> = TASKS.iter().map(|&t| lib.default_id(mara, t)).collect();
    let left: Vec<i64> = lib
        .db
        .prepare("SELECT script_id FROM script_versions")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .filter(|id| !defaults.contains(id))
        .collect();
    assert_eq!(left, [b]);
    assert_eq!(active_source(&lib.db, a).unwrap(), None);
    assert_eq!(code(get_script(&lib.db, &lib.defaults, mara, a)), "not-found");
}

#[test]
fn keeps_players_out_of_each_others_scripts() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let tobin = lib.add_user("Tobin");
    let a = lib.create(mara, "miners", VALID).summary.id;
    let d = &lib.defaults;
    assert_eq!(code(get_script(&lib.db, d, tobin, a)), "not-found");
    assert_eq!(code(save_script(&lib.db, d, tobin, a, Some(VALID_2))), "not-found");
    assert_eq!(code(rename_script(&lib.db, d, tobin, a, Some("mine"))), "not-found");
    assert_eq!(code(activate_version(&lib.db, d, tobin, a, Some(1.0))), "not-found");
    assert_eq!(code(delete_script(&lib.db, tobin, a)), "not-found");
    assert!(lib.own_names(tobin).is_empty());
    assert_eq!(lib.get(mara, a).summary.latest_version, 1);
}

#[test]
fn rejects_empty_or_overlong_names_and_overlong_sources() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let d = &lib.defaults;
    let long_name = "x".repeat(41);
    let long_source = "x".repeat(20_001);
    assert_eq!(code(create_script(&lib.db, d, mara, Some("  "), Some(VALID))), "invalid-input");
    assert_eq!(
        code(create_script(&lib.db, d, mara, Some(&long_name), Some(VALID))),
        "invalid-input"
    );
    assert_eq!(
        code(create_script(&lib.db, d, mara, Some("a"), Some(&long_source))),
        "invalid-input"
    );
    // `source: 3` in the TypeScript: no string.
    assert_eq!(code(create_script(&lib.db, d, mara, Some("a"), None)), "invalid-input");
}

// --------------------------------------------------------------------------------- library cap

#[test]
fn refuses_a_script_past_the_cap_default_scripts_counted_and_allows_one_after_a_delete() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let max = SCRIPT_LIBRARY_MAX_SCRIPTS as usize;
    assert_eq!(list_scripts(&lib.db, &lib.defaults, mara).unwrap().len(), TASKS.len());
    let made: Vec<i64> = (TASKS.len()..max)
        .map(|i| lib.create(mara, &format!("script {i}"), VALID).summary.id)
        .collect();
    assert_eq!(list_scripts(&lib.db, &lib.defaults, mara).unwrap().len(), max);
    let full = create_script(&lib.db, &lib.defaults, mara, Some("one more"), Some(VALID));
    let msg = message(full);
    assert!(msg.contains(&format!("{max} scripts")), "{msg}");
    assert_eq!(
        code(create_script(&lib.db, &lib.defaults, mara, Some("one more"), Some(VALID))),
        "library-full"
    );
    delete_script(&lib.db, mara, made[0]).unwrap();
    assert_eq!(lib.create(mara, "one more", VALID).summary.name, "one more");
    // Another Player's library is their own.
    let tobin = lib.add_user("Tobin");
    assert_eq!(lib.create(tobin, "mine", VALID).summary.name, "mine");
}

#[test]
fn refuses_a_save_or_reset_past_the_version_cap_and_allows_one_after_a_delete() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let max = SCRIPT_MAX_VERSIONS as i64;
    let s = lib.create(mara, "miners", VALID).summary.id;
    for v in 2..=max {
        lib.save(mara, s, &format!("let x = {v}\n"));
    }
    assert_eq!(lib.get(mara, s).versions.len() as i64, max);
    let refused = save_script(&lib.db, &lib.defaults, mara, s, Some(VALID_2));
    let msg = message(refused);
    assert!(msg.contains(&format!("{max} versions")), "{msg}");
    // Deleting any version makes room; the new one still gets the next number.
    delete_version(&lib.db, &lib.defaults, mara, s, Some(1.0)).unwrap();
    let saved = lib.save(mara, s, VALID_2);
    assert_eq!(
        (saved.summary.active_version, saved.summary.latest_version),
        (Some(max + 1), max + 1)
    );
    delete_older_versions(&lib.db, &lib.defaults, mara, s).unwrap();
    assert_eq!(lib.save(mara, s, VALID).versions.len(), 2);

    // A default script is capped like any other, Reset included.
    let work = lib.default_id(mara, Task::Work);
    while (lib.get(mara, work).versions.len() as i64) < max {
        lib.save(mara, work, VALID);
    }
    assert_eq!(code(reset_script(&lib.db, &lib.defaults, mara, work)), "library-full");
    delete_version(&lib.db, &lib.defaults, mara, work, Some(2.0)).unwrap();
    assert!(reset_script(&lib.db, &lib.defaults, mara, work).unwrap().summary.follows_default);
    assert_eq!(lib.check(), []);
}

// ------------------------------------------------------------------------------ active version

#[test]
fn keeps_a_version_with_syntax_errors_in_the_history_but_never_makes_it_active() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    let after = lib.save(mara, s, BROKEN);
    assert_eq!((after.summary.active_version, after.summary.latest_version), (Some(1), 2));
    assert_eq!(after.versions[1].errors.len(), 1);
    assert_eq!(active_source(&lib.db, s).unwrap().as_deref(), Some(VALID));
    assert_eq!(
        code(activate_version(&lib.db, &lib.defaults, mara, s, Some(2.0))),
        "script-has-errors"
    );
    assert_eq!(lib.get(mara, s).summary.active_version, Some(1));
    assert_eq!(lib.check(), []);
}

#[test]
fn has_no_active_version_while_every_version_has_syntax_errors() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", BROKEN);
    assert_eq!(s.summary.active_version, None);
    assert_eq!(active_source(&lib.db, s.summary.id).unwrap(), None);
    assert_eq!(lib.save(mara, s.summary.id, VALID).summary.active_version, Some(2));
}

#[test]
fn goes_back_to_an_earlier_version_without_syntax_errors() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, VALID_2);
    let back = activate_version(&lib.db, &lib.defaults, mara, s, Some(1.0)).unwrap();
    assert_eq!(back.summary.active_version, Some(1));
    assert_eq!(active_source(&lib.db, s).unwrap().as_deref(), Some(VALID));
    // Going back adds no version.
    assert_eq!(lib.get(mara, s).summary.latest_version, 2);
    assert_eq!(code(activate_version(&lib.db, &lib.defaults, mara, s, Some(7.0))), "not-found");
}

// ---------------------------------------------------------------------------- deleting versions

#[test]
fn deletes_one_version_for_good_the_others_keep_their_numbers() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, VALID_2);
    lib.save(mara, s, VALID);
    let after = delete_version(&lib.db, &lib.defaults, mara, s, Some(1.0)).unwrap();
    assert_eq!(numbers(&after), [2, 3]);
    assert_eq!((after.summary.active_version, after.summary.latest_version), (Some(3), 3));
    assert_eq!(code(delete_version(&lib.db, &lib.defaults, mara, s, Some(1.0))), "not-found");
    assert_eq!(lib.check(), []);
}

#[test]
fn keeps_counting_up_after_the_newest_version_is_deleted() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, BROKEN);
    assert_eq!(numbers(&delete_version(&lib.db, &lib.defaults, mara, s, Some(2.0)).unwrap()), [1]);
    let listed = list_scripts(&lib.db, &lib.defaults, mara).unwrap();
    assert_eq!(listed.iter().find(|x| x.id == s).unwrap().latest_version, 2);
    let saved = lib.save(mara, s, VALID_2);
    assert_eq!(numbers(&saved), [1, 3]);
    assert_eq!((saved.summary.active_version, saved.summary.latest_version), (Some(3), 3));
}

#[test]
fn refuses_the_active_version() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, VALID_2);
    activate_version(&lib.db, &lib.defaults, mara, s, Some(1.0)).unwrap();
    assert_eq!(code(delete_version(&lib.db, &lib.defaults, mara, s, Some(1.0))), "active-version");
    // A later version than the active one can go.
    assert_eq!(numbers(&delete_version(&lib.db, &lib.defaults, mara, s, Some(2.0)).unwrap()), [1]);
    assert_eq!(active_source(&lib.db, s).unwrap().as_deref(), Some(VALID));
}

#[test]
fn deletes_every_version_older_than_the_active_one_at_once() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, BROKEN);
    lib.save(mara, s, VALID_2);
    lib.save(mara, s, BROKEN);
    let after = delete_older_versions(&lib.db, &lib.defaults, mara, s).unwrap();
    assert_eq!(numbers(&after), [3, 4]);
    assert_eq!((after.summary.active_version, after.summary.latest_version), (Some(3), 4));
    assert_eq!(active_source(&lib.db, s).unwrap().as_deref(), Some(VALID_2));
    assert_eq!(lib.save(mara, s, VALID).summary.latest_version, 5);
}

#[test]
fn deletes_nothing_at_once_while_there_is_no_active_version() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let s = lib.create(mara, "broken", BROKEN).summary.id;
    lib.save(mara, s, BROKEN);
    assert_eq!(numbers(&delete_older_versions(&lib.db, &lib.defaults, mara, s).unwrap()), [1, 2]);
    // With none active, any version can go.
    assert_eq!(numbers(&delete_version(&lib.db, &lib.defaults, mara, s, Some(2.0)).unwrap()), [1]);
}

#[test]
fn deletes_old_versions_of_the_players_default_script_reset_still_adds_the_newest() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let work = lib.default_id(mara, Task::Work);
    lib.save(mara, work, VALID);
    lib.save(mara, work, VALID_2);
    let after = delete_older_versions(&lib.db, &lib.defaults, mara, work).unwrap();
    assert_eq!(numbers(&after), [3]);
    assert!(!after.summary.follows_default);
    let reset = reset_script(&lib.db, &lib.defaults, mara, work).unwrap();
    assert_eq!(numbers(&reset), [3, 4]);
    assert_eq!((reset.summary.active_version, reset.summary.follows_default), (Some(4), true));
    assert_eq!(lib.check(), []);
}

#[test]
fn keeps_players_out_of_each_others_versions() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let tobin = lib.add_user("Tobin");
    let s = lib.create(mara, "miners", VALID).summary.id;
    lib.save(mara, s, VALID_2);
    assert_eq!(code(delete_version(&lib.db, &lib.defaults, tobin, s, Some(1.0))), "not-found");
    assert_eq!(code(delete_older_versions(&lib.db, &lib.defaults, tobin, s)), "not-found");
    assert_eq!(numbers(&lib.get(mara, s)), [1, 2]);
}

// --------------------------------------------------------------------------- checkScriptLibrary

#[test]
fn reports_a_version_numbered_above_its_latest_version() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let a = lib.create(mara, "a", VALID).summary.id;
    lib.db.execute("UPDATE scripts SET latest_version = 0 WHERE id = ?1", [a]).unwrap();
    assert_eq!(lib.check(), [("script-versions-counted".to_string(), vec![format!("script-{a}")])]);
}

#[test]
fn reports_an_active_version_with_syntax_errors_or_one_that_is_missing() {
    let lib = Lib::new();
    let mara = lib.add_user("Mara");
    let a = lib.create(mara, "a", VALID).summary.id;
    let b = lib.create(mara, "b", VALID).summary.id;
    lib.db
        .execute("UPDATE script_versions SET source = ?1 WHERE script_id = ?2", params![BROKEN, a])
        .unwrap();
    lib.db.execute("UPDATE scripts SET active_version = 5 WHERE id = ?1", [b]).unwrap();
    assert_eq!(
        lib.check(),
        [
            ("active-scripts-valid".to_string(), vec![format!("script-{a}")]),
            ("active-scripts-valid".to_string(), vec![format!("script-{b}")]),
        ]
    );
}

// ---------------------------------------------------------------------------------- scripts last

#[test]
fn survive_a_server_restart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("game.db");
    let defaults = defaults();
    let (mara, id, before) = {
        let db = open_db(&file, None).unwrap();
        let mara: i64 = db
            .query_row("INSERT INTO users (name) VALUES ('Mara') RETURNING id", [], |r| r.get(0))
            .unwrap();
        let s = create_script(&db, &defaults, mara, Some("miners"), Some(VALID)).unwrap();
        save_script(&db, &defaults, mara, s.summary.id, Some(BROKEN)).unwrap();
        let before = get_script(&db, &defaults, mara, s.summary.id).unwrap();
        (mara, s.summary.id, before)
    };
    let db = open_db(&file, None).unwrap();
    assert_eq!(get_script(&db, &defaults, mara, id).unwrap(), before);
    assert_eq!(active_source(&db, id).unwrap().as_deref(), Some(VALID));
}
