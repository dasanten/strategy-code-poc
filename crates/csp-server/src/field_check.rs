//! The live-world check before scripts see exactly their script views (ADR 0011;
//! `apps/server/src/field-check.ts`): the checker run over the active version of every Player's
//! script, listing each field it reads that the views don't declare, with the script and the
//! Player. Read only, so `check-fields` is safe to run while the server is up.
//!
//! At start, [`note_script_view_changes`] tells each Player whose script reads a field a script
//! view dropped since the last start, in their realm log.

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};

use csp_lang::{check_names, CheckEnv, PARAMS_SHAPE};
use csp_shared::world::{DroppedFieldScript, RealmEventWhat, WorldState};
use csp_sim::events::record_player_event;
use csp_sim::script_views::{ViewChange, SCRIPT_VIEW_CHANGES};
use indexmap::IndexMap;
use rusqlite::Connection;

pub use csp_sim::script_check::RESIDENT_OR_ARMY;

/// A field a Player's active script reads that its script view doesn't declare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndeclaredRead {
    /// The view as the checker names it: `resident`, `building`, `residentOrArmy`, …
    pub view: String,
    pub field: String,
    pub script_id: i64,
    pub script: String,
    pub user_id: i64,
    pub player: String,
    pub line: u32,
    pub column: u32,
}

/// The names and shapes a script is checked against (`scriptCheckEnv`): a Player's own script
/// (`default_script: false`) gets both the resident and the army API, a default script only the
/// resident's.
pub fn script_check_env(default_script: bool) -> CheckEnv {
    csp_sim::script_check::script_check_env(default_script)
}

/// Tells each Player whose active script reads a field that a script view change since the last
/// start dropped (`noteScriptViewChanges`): one `scriptFieldDropped` event per Player and field,
/// naming the scripts. Notes the changes as told either way; true when there were any, so the
/// world is saved.
pub fn note_script_view_changes(
    conn: &Connection,
    world: &mut WorldState,
) -> rusqlite::Result<bool> {
    note_view_changes(conn, world, SCRIPT_VIEW_CHANGES)
}

/// [`note_script_view_changes`] over the given changes.
pub fn note_view_changes(
    conn: &Connection,
    world: &mut WorldState,
    changes: &[ViewChange],
) -> rusqlite::Result<bool> {
    let told = (world.script_view_changes.max(0.0) as usize).min(changes.len());
    let pending = &changes[told..];
    if pending.is_empty() {
        return Ok(false);
    }
    world.script_view_changes = changes.len() as f64;
    // A Player's own script's `me` may be a resident's or an army's: the note calls it `me`.
    let views = |r: &UndeclaredRead| -> Vec<String> {
        if r.view == RESIDENT_OR_ARMY {
            vec!["resident".into(), "army".into()]
        } else {
            vec![r.view.clone()]
        }
    };
    let dropped = |r: &UndeclaredRead| {
        pending.iter().any(|c| match c {
            ViewChange::Undeclared => true,
            ViewChange::Dropped(fields) => {
                views(r).iter().any(|v| fields.contains(&format!("{v}.{}", r.field).as_str()))
            }
        })
    };
    let (own, default) = (script_check_env(false), script_check_env(true));
    let mut notes: IndexMap<(i64, String), IndexMap<i64, String>> = IndexMap::new();
    for r in undeclared_field_reads(conn, [&own, &default])?.into_iter().filter(|r| dropped(r)) {
        let view = if r.view == RESIDENT_OR_ARMY { "me" } else { r.view.as_str() };
        let field = format!("{view}.{}", r.field);
        notes.entry((r.user_id, field)).or_default().insert(r.script_id, r.script);
    }
    for ((user_id, field), scripts) in notes {
        let scripts = scripts
            .into_iter()
            .map(|(id, name)| DroppedFieldScript { script_id: id as u64, name })
            .collect();
        record_player_event(
            world,
            user_id as u64,
            RealmEventWhat::ScriptFieldDropped { field, scripts },
        );
    }
    Ok(true)
}

/// Every undeclared field read of the Players' active scripts (`undeclaredFieldReads`), ordered
/// by Player, then script. `envs` is the environment of a Player's own script, then of a default
/// script (one with a task). Only reads from values the checker is sure of count; a script's own
/// params are no field of the game's.
pub fn undeclared_field_reads(
    conn: &Connection,
    envs: [&CheckEnv; 2],
) -> rusqlite::Result<Vec<UndeclaredRead>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.task, u.id, u.name, v.source
         FROM scripts s
         JOIN users u ON u.id = s.user_id
         JOIN script_versions v ON v.script_id = s.id AND v.version = s.active_version
         WHERE s.active_version IS NOT NULL
         ORDER BY u.name ASC, s.name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (script_id, script, task, user_id, player, source) = row?;
        let env = envs[usize::from(task.is_some())];
        for read in check_names(&source, env).reads {
            if read.declared || read.shape == PARAMS_SHAPE {
                continue;
            }
            out.push(UndeclaredRead {
                view: read.shape,
                field: read.field,
                script_id,
                script: script.clone(),
                user_id,
                player: player.clone(),
                line: read.line,
                column: read.column,
            });
        }
    }
    Ok(out)
}

/// `a.localeCompare(b)` for the ASCII names views and fields have: letters compare without case
/// first, a lowercase letter before its capital only when all else is equal.
fn locale_compare(a: &str, b: &str) -> Ordering {
    let fold = |s: &str| s.to_lowercase();
    fold(a).cmp(&fold(b)).then_with(|| {
        for (x, y) in a.chars().zip(b.chars()) {
            if x != y {
                return if x.is_lowercase() { Ordering::Less } else { Ordering::Greater };
            }
        }
        a.len().cmp(&b.len())
    })
}

/// The check's report: one line per field read, grouped by view and field
/// (`describeUndeclaredReads`).
pub fn describe_undeclared_reads(reads: &[UndeclaredRead]) -> String {
    if reads.is_empty() {
        return "No active script reads a field the script views don’t declare.".to_string();
    }
    let mut by_field: Vec<(String, Vec<&UndeclaredRead>)> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for r in reads {
        let key = format!("{}.{}", r.view, r.field);
        let i = *at.entry(key.clone()).or_insert_with(|| {
            by_field.push((key, Vec::new()));
            by_field.len() - 1
        });
        by_field[i].1.push(r);
    }
    // A stable sort, as `Array.prototype.sort`.
    by_field.sort_by(|(a, _), (b, _)| locale_compare(a, b));
    let mut lines = Vec::new();
    for (key, rs) in &by_field {
        lines.push(key.clone());
        for r in rs {
            lines.push(format!(
                "  {} · script \"{}\" ({}) · {}:{}",
                r.player, r.script, r.script_id, r.line, r.column
            ));
        }
    }
    let players = reads.iter().map(|r| r.player.as_str()).collect::<BTreeSet<_>>().len();
    let fields = by_field.len();
    lines.push(format!(
        "{fields} undeclared field{} read by {players} Player{}.",
        if fields == 1 { "" } else { "s" },
        if players == 1 { "" } else { "s" },
    ));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_names_as_locale_compare() {
        assert_eq!(locale_compare("building.x", "resident.a"), Ordering::Less);
        assert_eq!(locale_compare("resident.Plan", "resident.hunger"), Ordering::Greater);
        assert_eq!(locale_compare("resident.plan", "resident.Plan"), Ordering::Less);
        assert_eq!(locale_compare("me.a", "me.a"), Ordering::Equal);
    }
}
