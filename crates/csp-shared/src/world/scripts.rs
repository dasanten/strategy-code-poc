//! Scripts: what a resident or workplace is set to run, a running script's memory and log, its
//! alarms, and what a script interrupted.

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ResidentOrder, Task};

/// A script value as plain data (`MemoryValue`): any JSON value.
pub type MemoryValue = serde_json::Value;

/// A running script's memory (`ScriptMemory`): plain JSON, key order kept.
pub type ScriptMemory = serde_json::Map<String, serde_json::Value>;

/// A resident's picked script parameter values (`ScriptParamValues`): script id, then param
/// name. Script ids are whole numbers, so JavaScript iterates them in ascending order.
pub type ScriptParamValues = BTreeMap<u64, IndexMap<String, ScriptParamValue>>;

/// What a resident runs when an alarm reaches them (`Resident.alarmScriptId`): a script id, or
/// `"none"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum AlarmScriptId {
    Script(u64),
    Off(NoScript),
}

/// The literal `"none"` of `AlarmScriptId`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub enum NoScript {
    #[serde(rename = "none")]
    None,
}

/// One line of a resident's script log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScriptLogLine {
    pub tick: f64,
    pub text: String,
}

/// A picked script parameter value: a building or carriage id, or a number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum ScriptParamValue {
    Id(String),
    Number(f64),
}

/// A realm's own settings for one workplace (`CONTEXT.md`: Workplace settings).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkplaceSettings {
    /// A script id (see `RunningScript::script_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub params: Option<IndexMap<String, ScriptParamValue>>,
}

/// A resident's or army's run-script order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunningScript {
    /// The id of a row of the `scripts` table (SQLite integer key), or 0 for a task's default:
    /// every writer copies one of those, an order naming any other is refused.
    pub script_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub task: Option<Task>,
    pub memory: ScriptMemory,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_logged_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_logged_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_error: Option<ScriptRunError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_run: Option<ScriptRunSteps>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub waiting_since: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm: Option<Alarm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm_under: Option<Alarm>,
}

/// What raised an alarm (`Alarm.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AlarmKind {
    Occupied,
    Outsider,
    Theft,
    Attacked,
}

/// Something that happened in a City area, as an Alarm script reads it (`CONTEXT.md`: Alarm).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alarm {
    pub kind: AlarmKind,
    pub city_id: String,
    pub about: String,
    pub realm_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub tick: f64,
}

/// A script's last runtime error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ScriptRunError {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub column: Option<f64>,
    pub tick: f64,
    /// A script version: an integer column of `script_versions`.
    pub version: u64,
}

/// Whose step budget a script ran out of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OutOfSteps {
    Own,
    Realm,
}

/// The steps a script used the last tick it ran.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptRunSteps {
    pub steps: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub out_of_steps: Option<OutOfSteps>,
}

/// What a defence or Alarm script interrupted (`Resident.interrupted`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct Interrupted {
    pub order: Option<ResidentOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub script: Option<RunningScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub alarm: Option<InterruptedAlarm>,
}

/// The Alarm script a blow interrupted in turn, with its order (`Interrupted.alarm`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct InterruptedAlarm {
    pub order: Option<ResidentOrder>,
    pub script: RunningScript,
}

/// How long what a Player gave a resident under attack holds (`GivenUnderAttack`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum GivenUnderAttack {
    UntilDone,
    UntilCalm,
}

/// A script that read a dropped field, in a `scriptFieldDropped` event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DroppedFieldScript {
    /// A script id (see `RunningScript::script_id`).
    pub script_id: u64,
    pub name: String,
}
