//! Checkpoints (`CONTEXT.md`: Creative mode, ADR 0043): named copies of the world beside its
//! saves, in the same snapshot format, migrated when restored.
use std::collections::BTreeMap;

use csp_server::checkpoints::{
    delete_checkpoint, list_checkpoints, load_checkpoint, load_checkpoint_with, save_checkpoint,
    CheckpointError, CheckpointSaveRequest,
};
use csp_server::db::open_db;
use csp_server::saves::gzip;
use csp_server::world_format::{migrate_world_with, MigrationContext, MigrationStep};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{WorldState, WORLD_FORMAT_VERSION};
use csp_sim::world::create_world;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn terrain() -> TerrainMap {
    TerrainMap { size: 64, tiles: vec![0; 64 * 64] }
}

fn world() -> WorldState {
    create_world(&terrain(), 1)
}

fn save(conn: &Connection, name: &str, world: &WorldState) -> u64 {
    save_checkpoint(conn, name, world.tick, &serde_json::to_vec(world).unwrap()).unwrap().id
}

#[test]
fn saves_lists_replaces_by_name_and_deletes_checkpoints() {
    let conn = open_db(":memory:", None).unwrap();
    let mut w = world();
    let first = save(&conn, "start", &w);
    w.tick = 90;
    let second = save(&conn, "an hour in", &w);
    let names = |conn: &Connection| -> Vec<(String, u64)> {
        list_checkpoints(conn).unwrap().into_iter().map(|c| (c.name, c.tick)).collect()
    };
    assert_eq!(names(&conn), vec![("an hour in".into(), 90), ("start".into(), 0)]);

    // The same name again replaces the old one.
    w.tick = 120;
    let replaced = save(&conn, "start", &w);
    assert_ne!(replaced, first);
    assert_eq!(names(&conn), vec![("start".into(), 120), ("an hour in".into(), 90)]);

    assert!(delete_checkpoint(&conn, second).unwrap());
    assert!(!delete_checkpoint(&conn, second).unwrap(), "gone already");
    assert_eq!(names(&conn), vec![("start".into(), 120)]);
}

#[test]
fn gives_the_saved_world_back_unchanged() {
    let conn = open_db(":memory:", None).unwrap();
    let saved = world();
    let id = save(&conn, "start", &saved);
    let loaded = load_checkpoint(&conn, id, &terrain(), saved.seed).unwrap();
    assert_eq!(serde_json::to_value(&loaded).unwrap(), serde_json::to_value(&saved).unwrap());
    assert!(matches!(
        load_checkpoint(&conn, id + 1, &terrain(), 1),
        Err(CheckpointError::NotFound)
    ));
}

#[test]
fn refuses_a_checkpoint_of_another_world() {
    let conn = open_db(":memory:", None).unwrap();
    let id = save(&conn, "start", &world());
    let refused = load_checkpoint(&conn, id, &terrain(), 2);
    assert!(matches!(refused, Err(CheckpointError::OtherWorld { saved: 1, world: 2 })));
}

/// Marks the save as migrated: the step a format change would bring.
fn mark_migrated(mut state: Value, _: &MigrationContext<'_>) -> Value {
    state["tick"] = json!(4242);
    state
}

#[test]
fn migrates_a_checkpoint_from_an_older_format_when_restored() {
    let conn = open_db(":memory:", None).unwrap();
    let w = world();
    let older = WORLD_FORMAT_VERSION - 1;
    let data = gzip(&serde_json::to_vec(&w).unwrap()).unwrap();
    conn.execute(
        "INSERT INTO checkpoints (name, tick, version, data) VALUES ('old', 0, ?1, ?2)",
        params![older, data],
    )
    .unwrap();
    let id = list_checkpoints(&conn).unwrap()[0].id;
    let steps = BTreeMap::from([(older, mark_migrated as MigrationStep)]);
    let terrain = terrain();
    let ctx = MigrationContext { terrain: &terrain };
    let loaded = load_checkpoint_with(&conn, id, w.seed, |state, version| {
        migrate_world_with(state, version, &ctx, &steps, WORLD_FORMAT_VERSION)
    })
    .unwrap();
    assert_eq!(loaded.tick, 4242, "the step from format {older} ran");

    // The server's own migrations refuse a format from before the reset (ADR 0035), as for saves.
    let refused = load_checkpoint(&conn, id, &terrain, w.seed);
    assert!(matches!(refused, Err(CheckpointError::Format(_))), "{refused:?}");
}

#[test]
fn takes_a_name_of_one_to_sixty_characters_trimmed() {
    let name = |n: &str| CheckpointSaveRequest { name: n.into() }.name().map(str::to_owned);
    assert_eq!(name("  before the fight "), Some("before the fight".into()));
    assert_eq!(name("   "), None);
    assert_eq!(name(&"x".repeat(60)), Some("x".repeat(60)));
    assert_eq!(name(&"x".repeat(61)), None);
}
