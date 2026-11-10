//! Workplace settings (`apps/server/src/workplace-settings.ts`, `CONTEXT.md`; ADR 0020): for each
//! workplace, or construction site of a workplace kind, it knows, a realm keeps a work script and
//! values for its params, set on the building's card (`WorldState.workplaceSettings`). Other
//! realms never see them; NPC cities keep none.

use std::sync::Arc;

use csp_lang::{script_params, ParamType};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    OrderRequest, Resident, RunningScript, ScriptParamValue, Task, WorkplaceSettings, WorldState,
};
use serde_json::{json, Map, Value};

use crate::default_scripts::{is_work_script, WORKPLACE_PARAM};
use crate::order_sender::{realm_of, OrderSender};
use crate::orders::OrderKind;
use crate::queries::alliance::commander_of;
use crate::script_api::{is_param_number, ScriptParam};
use crate::script_params::{param_target, set_start_params, start_params_problem, ParamWithValue};
use crate::scripts::RunnableScript;
use crate::sight::InvariantViolation;
use crate::tick::Scratch;

use crate::queries::building::takes_work_settings;

/// Where the settings order finds the Player's scripts (`WorkSettingsHost`).
pub trait WorkSettingsHost {
    /// The script's Player and active version; `None` once it is deleted.
    fn script(&self, script_id: u64) -> Option<RunnableScript>;
    /// The id of the Player's version of a task's default script, made if they have none.
    fn default_script(&self, user_id: u64, task: Task) -> u64;
}

/// The realm's settings for a building, if it set any (`workSettingsOf`).
pub fn work_settings_of<'w>(
    world: &'w WorldState,
    realm_id: &str,
    building_id: &str,
) -> Option<&'w WorkplaceSettings> {
    world.workplace_settings.get(realm_id)?.get(building_id)
}

/// The work script giving Work at a workplace runs for the Player (`workScriptId`): the one its
/// settings name while it is still theirs and a work script, else their Work default.
pub fn work_script_id(
    host: &dyn WorkSettingsHost,
    user_id: u64,
    settings: Option<&WorkplaceSettings>,
) -> u64 {
    if let Some(id) = settings.and_then(|s| s.script_id) {
        if let Some(picked) = host.script(id) {
            if picked.user_id == user_id && is_work_script(&script_params(&picked.source)) {
                return id;
            }
        }
    }
    host.default_script(user_id, Task::Work)
}

/// The `param` lines of the work script the settings name (`workScriptParams`).
fn work_script_params(
    host: &dyn WorkSettingsHost,
    user_id: u64,
    settings: Option<&WorkplaceSettings>,
) -> Vec<ScriptParam> {
    host.script(work_script_id(host, user_id, settings))
        .map_or_else(Vec::new, |s| script_params(&s.source))
}

/// The params of a script run by a workplace's settings as it reads them (`withWorkSettings`):
/// the resident's own value, their override, else the workplace's setting while it fits the
/// param's type, else none, which reads the default. `workplace` unpicked is the workplace itself.
pub fn with_work_settings(
    params: Vec<ParamWithValue>,
    workplace_id: &str,
    settings: Option<&WorkplaceSettings>,
) -> Vec<ParamWithValue> {
    params
        .into_iter()
        .map(|mut p| {
            if p.value.is_some() {
                return p;
            }
            if p.param.param.name == WORKPLACE_PARAM && p.param.param.ty == ParamType::Building {
                p.value = Some(ScriptParamValue::Id(workplace_id.to_string()));
                return p;
            }
            let value =
                settings.and_then(|s| s.params.as_ref()).and_then(|v| v.get(&p.param.param.name));
            let fits = match value {
                Some(ScriptParamValue::Number(n)) => {
                    p.param.param.ty == ParamType::Number && is_param_number(&json!(n))
                }
                Some(ScriptParamValue::Id(_)) => p.param.param.ty != ParamType::Number,
                None => false,
            };
            if fits {
                p.value = value.cloned();
            }
            p
        })
        .collect()
}

/// What giving Work writes into a work script's memory (`TaskMemory['work']`).
pub struct WorkMemory {
    pub workplace_id: String,
    pub makes: Option<String>,
    pub site_id: Option<String>,
}

impl WorkMemory {
    /// As plain data, in the TypeScript's key order.
    pub fn to_memory(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("workplaceId".into(), Value::String(self.workplace_id.clone()));
        if let Some(makes) = &self.makes {
            m.insert("makes".into(), Value::String(makes.clone()));
        }
        if let Some(site) = &self.site_id {
            m.insert("siteId".into(), Value::String(site.clone()));
        }
        m
    }
}

/// A running script from a memory, as `{ scriptId, memory, settingsFrom }`.
fn running(script_id: u64, memory: Map<String, Value>, settings_from: &str) -> RunningScript {
    serde_json::from_value(
        json!({ "scriptId": script_id, "memory": memory, "settingsFrom": settings_from }),
    )
    .expect("a running script")
}

/// Gives a resident Work at a workplace by its settings (`startWorkBySettings`): they run work
/// script `script_id` from `memory`, their earlier kept values for it dropped. What they keep then
/// is the workplace in `workplace` when the realm may name it (`target`), and the values the
/// Player changed in the form before it started, their overrides; null keeps nothing. It ends
/// whatever they were doing.
pub fn start_work_by_settings(
    r: &mut Resident,
    script_id: u64,
    memory: &WorkMemory,
    overrides: Option<&Map<String, Value>>,
    target: Option<&str>,
) {
    r.order = None;
    r.script = Some(running(script_id, memory.to_memory(), &memory.workplace_id));
    drop_kept(r, script_id);
    let mut kept = Map::new();
    for (name, value) in overrides.into_iter().flatten() {
        if !value.is_null() && name != WORKPLACE_PARAM {
            kept.insert(name.clone(), value.clone());
        }
    }
    if let Some(target) = target {
        kept.insert(WORKPLACE_PARAM.into(), Value::String(target.to_string()));
    }
    set_start_params(r, script_id, Some(&kept));
}

/// Drops the values a resident keeps for a script (`dropKept`).
fn drop_kept(r: &mut Resident, script_id: u64) {
    let Some(all) = &mut r.script_params else { return };
    if all.remove(&script_id).is_some() && all.is_empty() {
        r.script_params = None;
    }
}

/// Switches everyone the realm commands who works the workplace by its settings, and runs another
/// script than its work script now, to that one (`switchWorkers`), as if given Work there again;
/// a script a defence script interrupted too, which goes on as the new one.
fn switch_workers(
    world: &mut WorldState,
    host: &dyn WorkSettingsHost,
    user_id: u64,
    realm_id: &str,
    building_id: &str,
) {
    let script_id = work_script_id(host, user_id, work_settings_of(world, realm_id, building_id));
    let stale = |s: Option<&RunningScript>| {
        s.is_some_and(|s| {
            s.settings_from.as_deref() == Some(building_id) && s.script_id != script_id
        })
    };
    // As giving Work writes it: what a smithy's worker makes kept, and a workplace still being
    // built in `siteId` too (`CONTEXT.md`: Working a site).
    let site =
        world.buildings.iter().find(|b| b.id == building_id).is_some_and(|b| b.site.is_some());
    let work_memory = |s: &RunningScript| WorkMemory {
        workplace_id: building_id.to_string(),
        makes: s.memory.get("makes").and_then(Value::as_str).map(str::to_string),
        site_id: site.then(|| building_id.to_string()),
    };
    // The workplace in `workplace`, as giving Work there fills it, while the realm may name it.
    let target = param_target(world, Some(realm_id), ParamType::Building, building_id)
        .map(|_| building_id.to_string());
    let commanded: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            commander_of(world, &r.id, r.owner.as_deref()).as_deref() == Some(realm_id)
        })
        .collect();
    for i in commanded {
        let r = &mut world.residents[i];
        if stale(r.script.as_ref()) {
            let memory = work_memory(r.script.as_ref().expect("stale"));
            start_work_by_settings(r, script_id, &memory, Some(&Map::new()), target.as_deref());
        }
        let interrupted_stale = r.interrupted.as_ref().is_some_and(|it| stale(it.script.as_ref()));
        if interrupted_stale {
            let it = r.interrupted.as_mut().expect("checked");
            let memory = work_memory(it.script.as_ref().expect("stale"));
            it.order = None;
            it.script = Some(running(script_id, memory.to_memory(), building_id));
            drop_kept(r, script_id);
            if let Some(target) = &target {
                let mut m = Map::new();
                m.insert(WORKPLACE_PARAM.into(), Value::String(target.clone()));
                set_start_params(r, script_id, Some(&m));
            }
        }
    }
}

/// The set-work-settings order (`setWorkSettingsOrder`, `CONTEXT.md`: Workplace settings): the
/// Player sets, for a workplace or site of a workplace kind their realm knows, its work script,
/// values for that script's params, or both. Free and instant, from anywhere; it changes nobody's
/// order.
pub struct SetWorkSettingsOrder {
    pub host: Arc<dyn WorkSettingsHost + Send + Sync>,
}

impl OrderKind for SetWorkSettingsOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let Some(realm) = realm_of(world, sender.user_id) else {
            return Some("you have no realm".into());
        };
        let id = f.get("buildingId").and_then(Value::as_str);
        let b = id.and_then(|id| world.buildings.iter().find(|b| b.id == id));
        let Some(b) = b.filter(|b| {
            takes_work_settings(b)
                && param_target(world, Some(&realm.id), ParamType::Building, &b.id).is_some()
        }) else {
            return Some("not a workplace or construction site of one you know".into());
        };
        let script_id = f.get("scriptId");
        if let Some(sid) = script_id.filter(|v| !v.is_null()) {
            let script = sid
                .as_f64()
                .filter(|n| n.fract() == 0.0 && *n >= 0.0)
                .and_then(|n| self.host.script(n as u64));
            let Some(script) = script.filter(|s| s.user_id == sender.user_id) else {
                return Some("not one of your scripts with a version that can run".into());
            };
            if script.task != Some(Task::Work) && !is_work_script(&script_params(&script.source)) {
                return Some(format!(
                    "not a work script: it declares no `param {WORKPLACE_PARAM}: building`"
                ));
            }
        }
        let params = f.get("params")?;
        if params.as_object().is_some_and(|p| p.contains_key(WORKPLACE_PARAM)) {
            return Some(format!("{WORKPLACE_PARAM}: is the workplace itself"));
        }
        let now = work_settings_of(world, &realm.id, &b.id).cloned();
        let next = match script_id {
            None => now,
            Some(v) => {
                Some(WorkplaceSettings { script_id: v.as_f64().map(|n| n as u64), params: None })
            }
        };
        let declared = work_script_params(self.host.as_ref(), sender.user_id, next.as_ref());
        start_params_problem(world, &realm.id, &declared, Some(params))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let Some(realm_id) = realm_of(world, sender.user_id).map(|r| r.id.clone()) else { return };
        let building_id =
            f.get("buildingId").and_then(Value::as_str).unwrap_or_default().to_string();
        let script_id = f.get("scriptId");
        let all = world.workplace_settings.entry(realm_id.clone()).or_default();
        let mut settings = all
            .get(&building_id)
            .cloned()
            .unwrap_or(WorkplaceSettings { script_id: None, params: None });
        if let Some(sid) = script_id {
            // Their Work default is kept as none: it is what a workplace without settings runs.
            let id = sid
                .as_f64()
                .map(|n| n as u64)
                .filter(|&n| self.host.script(n).map(|s| s.task) != Some(Some(Task::Work)));
            if id != settings.script_id {
                settings.params = None;
            }
            settings.script_id = id;
        }
        let mut values = settings.params.take().unwrap_or_default();
        if let Some(Value::Object(params)) = f.get("params") {
            for (name, value) in params {
                match value {
                    Value::Null => {
                        values.shift_remove(name);
                    }
                    Value::String(s) => {
                        values.insert(name.clone(), ScriptParamValue::Id(s.clone()));
                    }
                    Value::Number(n) => {
                        values.insert(
                            name.clone(),
                            ScriptParamValue::Number(n.as_f64().unwrap_or(0.0)),
                        );
                    }
                    _ => {}
                }
            }
        }
        settings.params = (!values.is_empty()).then_some(values);
        if settings.script_id.is_some() || settings.params.is_some() {
            all.insert(building_id.clone(), settings);
        } else {
            all.shift_remove(&building_id);
        }
        if all.is_empty() {
            world.workplace_settings.shift_remove(&realm_id);
        }
        if script_id.is_some() {
            switch_workers(world, self.host.as_ref(), sender.user_id, &realm_id, &building_id);
        }
    }
}

/// Drops Workplace settings that no longer name anything, once a tick (`stepWorkplaceSettings`):
/// those of a realm that is gone, those of a building that is gone, and values naming a building
/// or carriage that is gone. A value naming something no longer the realm's stays, read as unset.
pub fn step_workplace_settings(world: &mut WorldState, _scratch: &mut Scratch) {
    let WorldState { workplace_settings, buildings, carriages, realms, .. } = world;
    workplace_settings.retain(|realm_id, all| {
        if !realms.iter().any(|r| &r.id == realm_id) {
            return false;
        }
        all.retain(|building_id, settings| {
            let Some(b) = buildings.iter().find(|b| &b.id == building_id) else { return false };
            if !takes_work_settings(b) {
                return false;
            }
            if let Some(params) = &mut settings.params {
                params.retain(|_, value| match value {
                    ScriptParamValue::Id(id) => {
                        buildings.iter().any(|b| &b.id == id)
                            || carriages.iter().any(|k| &k.id == id)
                    }
                    ScriptParamValue::Number(_) => true,
                });
                if params.is_empty() {
                    settings.params = None;
                }
            }
            settings.script_id.is_some() || settings.params.is_some()
        });
        !all.is_empty()
    });
}

/// Invariant (`workplace-settings-sound`, ADR 0004): settings are kept only by realms, only for
/// buildings there are that take them, each with a whole positive script id if any and values
/// that are plain ids or whole numbers of zero or more, never for `workplace`; no empty group is
/// left behind.
pub fn workplace_settings_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation {
            invariant: "workplace-settings-sound".into(),
            message,
            entity_ids,
        });
    };
    for (realm_id, all) in &world.workplace_settings {
        if !world.realms.iter().any(|r| &r.id == realm_id) {
            fail(format!("{realm_id}, no realm, keeps workplace settings"), vec![]);
        }
        if all.is_empty() {
            fail(format!("realm {realm_id} keeps an empty group"), vec![]);
        }
        for (building_id, settings) in all {
            let b = world.buildings.iter().find(|b| &b.id == building_id);
            if !b.is_some_and(takes_work_settings) {
                fail(
                    format!("realm {realm_id} keeps settings for {building_id}, no workplace"),
                    vec![building_id.clone()],
                );
            }
            if settings.script_id.is_none() && settings.params.is_none() {
                fail(
                    format!("realm {realm_id} keeps empty settings for {building_id}"),
                    vec![building_id.clone()],
                );
            }
            if settings.script_id == Some(0) {
                fail(
                    format!("realm {realm_id} keeps script 0 for {building_id}"),
                    vec![building_id.clone()],
                );
            }
            let Some(params) = &settings.params else { continue };
            if params.is_empty() {
                fail(
                    format!("realm {realm_id} keeps an empty set of values for {building_id}"),
                    vec![building_id.clone()],
                );
            }
            if params.contains_key(WORKPLACE_PARAM) {
                fail(
                    format!("realm {realm_id} keeps a {WORKPLACE_PARAM} value for {building_id}"),
                    vec![building_id.clone()],
                );
            }
            let bad = params
                .values()
                .any(|v| matches!(v, ScriptParamValue::Number(n) if !is_param_number(&json!(n))));
            if bad {
                fail(format!("realm {realm_id} keeps a value for {building_id} that is no id or whole number"), vec![building_id.clone()]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
