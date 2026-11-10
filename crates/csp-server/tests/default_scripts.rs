//! The library half of `default-scripts.test.ts`, ported (T86.17, part 5): a Player's default
//! scripts (`CONTEXT.md`: Default script; ADR 0009) follow the game's default until edited, can be
//! reset, and can't be renamed or deleted. The cases that run the scripts in the world are
//! `crates/csp-sim/tests/default_scripts.rs`.
use csp_lang::check_script;
use csp_server::db::open_db;
use csp_server::scripts::{
    activate_version, check_script_library, create_script, default_script_id, delete_script,
    ensure_default_scripts, get_script, list_scripts, rename_script, reset_script, runnable_script,
    save_script, sync_default_scripts, DefaultScript, GameDefault,
};
use csp_shared::world::default_scripts::Task;
use rusqlite::Connection;

mod common;
use common::{defaults, TASKS};

struct Lib {
    db: Connection,
    mara: i64,
    tobin: i64,
}

impl Lib {
    fn new() -> Self {
        let db = open_db(":memory:", None).unwrap();
        let add = |name: &str| -> i64 {
            db.query_row("INSERT INTO users (name) VALUES (?1) RETURNING id", [name], |r| r.get(0))
                .unwrap()
        };
        let (mara, tobin) = (add("Mara"), add("Tobin"));
        Lib { db, mara, tobin }
    }

    fn work_id(&self, user: i64) -> i64 {
        default_script_id(&self.db, &defaults(), user, Task::Work).unwrap().unwrap()
    }

    fn source_of(&self, id: i64) -> Option<String> {
        runnable_script(&self.db, id).unwrap().map(|s| s.source)
    }
}

/// The game's defaults with `task`'s source replaced, as a later game version might have it
/// (`withGameDefault`).
fn with_game_default(task: Task, source: &str) -> Vec<DefaultScript> {
    let mut d = defaults();
    d.iter_mut().find(|x| x.task == task).unwrap().source = source.into();
    d
}

fn work_source() -> String {
    defaults().into_iter().find(|d| d.task == Task::Work).unwrap().source
}

fn message<T: std::fmt::Debug>(r: csp_server::auth::AuthResult<T>) -> String {
    match r {
        Err(csp_server::auth::AuthFailure::Auth(e)) => e.message,
        other => panic!("expected an API error, got {other:?}"),
    }
}

fn is_auth_error<T: std::fmt::Debug>(r: csp_server::auth::AuthResult<T>) -> bool {
    matches!(r, Err(csp_server::auth::AuthFailure::Auth(_)))
}

fn check(lib: &Lib, defaults: &[DefaultScript]) -> Vec<String> {
    check_script_library(&lib.db, defaults).unwrap().into_iter().map(|v| v.invariant).collect()
}

#[test]
fn a_players_default_scripts_are_in_their_library_from_the_start_one_per_task_following_the_games_default(
) {
    let lib = Lib::new();
    let d = defaults();
    let list = list_scripts(&lib.db, &d, lib.mara).unwrap();
    let names: Vec<(String, Option<Task>, bool)> =
        list.iter().map(|s| (s.name.clone(), s.task, s.follows_default)).collect();
    let want = [
        ("Alarm (default)", Task::Alarm),
        ("Breed horses (default)", Task::Breed),
        ("Build (default)", Task::Build),
        ("Build line (default)", Task::BuildLine),
        ("Defend (default)", Task::Defend),
        ("Explore (default)", Task::Explore),
        ("Feed the stable (default)", Task::FeedStable),
        ("Haul (default)", Task::Haul),
        ("Tear down (default)", Task::TearDown),
        ("Train (default)", Task::Train),
        ("Work (default)", Task::Work),
    ];
    let want: Vec<(String, Option<Task>, bool)> =
        want.iter().map(|(n, t)| (n.to_string(), Some(*t), true)).collect();
    assert_eq!(names, want);
    let work = get_script(&lib.db, &d, lib.mara, lib.work_id(lib.mara)).unwrap();
    let sources: Vec<&str> = work.versions.iter().map(|v| v.source.as_str()).collect();
    assert_eq!(sources, vec![work_source().as_str()]);
    assert_eq!(work.summary.active_version, Some(1));
    assert_eq!(work.game_default, Some(GameDefault { source: work_source(), edited_from: None }));
    // Listing again makes no second one.
    assert_eq!(list_scripts(&lib.db, &d, lib.mara).unwrap().len(), TASKS.len());
    assert!(list.iter().any(|s| s.id == lib.work_id(lib.mara)));
}

#[test]
fn a_players_default_scripts_ship_without_syntax_errors() {
    for d in defaults() {
        assert_eq!(check_script(&d.source), vec![], "{:?}", d.task);
    }
}

#[test]
fn a_players_default_scripts_cant_be_renamed_or_deleted_and_their_names_cant_be_taken() {
    let lib = Lib::new();
    let d = defaults();
    let id = lib.work_id(lib.mara);
    assert!(is_auth_error(rename_script(&lib.db, &d, lib.mara, id, Some("Mine"))));
    assert!(message(delete_script(&lib.db, lib.mara, id)).contains("default script"));
    assert!(message(create_script(&lib.db, &d, lib.mara, Some("work (DEFAULT)"), Some("")))
        .contains("by that name"));
    let own = create_script(&lib.db, &d, lib.mara, Some("Mine"), Some("")).unwrap();
    assert!(message(rename_script(&lib.db, &d, lib.mara, own.summary.id, Some("Work (default)")))
        .contains("by that name"));
    assert!(message(reset_script(&lib.db, &d, lib.mara, own.summary.id))
        .contains("Only a default script"));
}

#[test]
fn a_players_default_scripts_move_aside_a_script_of_the_players_already_called_by_a_defaults_name()
{
    let lib = Lib::new();
    let d = defaults();
    let old: i64 = lib
        .db
        .query_row("INSERT INTO users (name) VALUES ('Old') RETURNING id", [], |r| r.get(0))
        .unwrap();
    lib.db
        .execute("INSERT INTO scripts (user_id, name) VALUES (?1, 'Work (default)')", [old])
        .unwrap();
    let list = list_scripts(&lib.db, &d, old).unwrap();
    let names: Vec<(String, Option<Task>)> =
        list.iter().map(|s| (s.name.clone(), s.task)).collect();
    assert_eq!(names.len(), TASKS.len() + 1);
    assert!(names.contains(&("Work (default)".to_string(), Some(Task::Work))));
    assert!(names.contains(&("Work (default) 2".to_string(), None)));
}

#[test]
fn a_players_default_scripts_follow_the_games_default_as_it_changes_until_the_player_edits_theirs()
{
    let lib = Lib::new();
    let real = defaults();
    let id = lib.work_id(lib.mara);
    let tobins = lib.work_id(lib.tobin);
    let changed = with_game_default(Task::Work, "workAt(null)\n");
    sync_default_scripts(&lib.db, &changed).unwrap();
    assert_eq!(lib.source_of(id).as_deref(), Some("workAt(null)\n"));
    assert_eq!(get_script(&lib.db, &changed, lib.mara, id).unwrap().versions.len(), 2);
    assert_eq!(check(&lib, &changed), Vec::<String>::new());

    // Mara edits hers: it is hers from then on.
    save_script(&lib.db, &changed, lib.mara, id, Some("let mine = 1\n")).unwrap();
    sync_default_scripts(&lib.db, &real).unwrap();
    // Tobin's follows the default back; Mara's stays hers and tells her the default changed.
    assert_eq!(lib.source_of(tobins), Some(work_source()));
    assert_eq!(lib.source_of(id).as_deref(), Some("let mine = 1\n"));
    let edited = get_script(&lib.db, &real, lib.mara, id).unwrap();
    assert!(!edited.summary.follows_default);
    assert_eq!(
        edited.game_default,
        Some(GameDefault { source: work_source(), edited_from: Some("workAt(null)\n".into()) })
    );
    assert!(!runnable_script(&lib.db, id).unwrap().unwrap().follows_default);
    assert_eq!(check(&lib, &real), Vec::<String>::new());
}

#[test]
fn a_players_default_scripts_stay_the_players_once_a_version_is_made_active_again_even_one_of_the_games(
) {
    let lib = Lib::new();
    let d = defaults();
    let id = lib.work_id(lib.mara);
    save_script(&lib.db, &d, lib.mara, id, Some("let mine = 1\n")).unwrap();
    reset_script(&lib.db, &d, lib.mara, id).unwrap();
    activate_version(&lib.db, &d, lib.mara, id, Some(2.0)).unwrap();
    let s = get_script(&lib.db, &d, lib.mara, id).unwrap();
    assert!(!s.summary.follows_default);
    assert_eq!(s.game_default.unwrap().edited_from, Some(work_source()));
}

#[test]
fn a_players_default_scripts_keep_a_saved_version_with_syntax_errors_without_running_it_and_are_edited_by_it(
) {
    let lib = Lib::new();
    let d = defaults();
    let id = lib.work_id(lib.mara);
    save_script(&lib.db, &d, lib.mara, id, Some("let = ")).unwrap();
    assert_eq!(lib.source_of(id), Some(work_source()));
    assert!(!get_script(&lib.db, &d, lib.mara, id).unwrap().summary.follows_default);
}

#[test]
fn a_players_default_scripts_are_reset_to_the_games_current_default_which_they_follow_again() {
    let lib = Lib::new();
    let real = defaults();
    let id = lib.work_id(lib.mara);
    save_script(&lib.db, &real, lib.mara, id, Some("let mine = 1\n")).unwrap();
    let changed = with_game_default(Task::Work, "workAt(null)\n");
    let reset = reset_script(&lib.db, &changed, lib.mara, id).unwrap();
    let sources: Vec<&str> = reset.versions.iter().map(|v| v.source.as_str()).collect();
    assert_eq!(sources, vec![work_source().as_str(), "let mine = 1\n", "workAt(null)\n"]);
    assert_eq!(reset.summary.active_version, Some(3));
    assert!(reset.summary.follows_default);
    assert_eq!(
        reset.game_default,
        Some(GameDefault { source: "workAt(null)\n".into(), edited_from: None })
    );
    // Following again, it takes the next default.
    ensure_default_scripts(&lib.db, &real, lib.mara).unwrap();
    assert_eq!(lib.source_of(id), Some(work_source()));
}

#[test]
fn a_players_default_scripts_are_flagged_when_one_following_the_games_default_doesnt_run_it() {
    let lib = Lib::new();
    let d = defaults();
    let id = lib.work_id(lib.mara);
    lib.db
        .execute(
            "INSERT INTO script_versions (script_id, version, source) VALUES (?1, 2, 'let x = 1')",
            [id],
        )
        .unwrap();
    lib.db
        .execute("UPDATE scripts SET active_version = 2, latest_version = 2 WHERE id = ?1", [id])
        .unwrap();
    assert_eq!(check(&lib, &d), vec!["default-scripts-follow".to_string()]);
}
