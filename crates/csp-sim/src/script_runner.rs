//! Running a script as a resident's or an army's order (`apps/server/src/script-runner.ts`,
//! `CONTEXT.md`: Running a script, Memory, Step budget).
//!
//! The run-script order sets `Resident.script` or `Army.script`. Each tick, before the world
//! steps, every running script's active version runs once with its memory and the game API bound
//! for its resident or army ([`crate::script_bindings`]). What it requests is applied as UI orders
//! are: an action sets the resident's or army's built-in order, which carries on over the next
//! ticks while the script keeps running. Any other order from the Player ends the script
//! (`OrderQueue`).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use csp_lang::interpreter::{run, RunOptions, RunResult, ValueLimits};
use csp_lang::{parse, plain_value, script_params, NotPlain, Object, Program, Value};
use csp_shared::balance::{
    MAP_SIZE, SCRIPT_LOG_INTERVAL, SCRIPT_MAX_CALL_DEPTH, SCRIPT_MEMORY_MAX,
    SCRIPT_REALM_STEP_BUDGET, SCRIPT_STEP_BUDGET, SCRIPT_VALUE_LIMITS, WORKPLACE_MAX_WORKERS,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    AlarmScriptId, BuildingKind, City, OrderRequest, OutOfSteps, RealmEventWhat, Resident,
    ResidentOrder, RunningScript, ScriptMemory, ScriptRunError, ScriptRunSteps, Task, WorldState,
};
use serde_json::{json, Map, Value as Json};

use crate::alarms::{back_to_outsider_alarm, runs_npc_alarm};
use crate::default_scripts::{default_script, task_of};
use crate::defence::resume_interrupted;
use crate::events::record_event;
use crate::order_sender::{commands, npc_sender, ordered_resident, realm_of, OrderSender};
use crate::orders::{order_kinds, OrderKind, OrderKinds};
use crate::queries::building::{
    build_at_problem, building_at, construction_at, line_to_build, road_line,
};
use crate::queries::horses::HorseOwner;
use crate::queries::names::kind_name;
use crate::queries::residents::{can_work, is_down};
use crate::queue::field_str;
use crate::script_bindings::{
    army_script_requests_sound, bind_script, script_requests_sound, ScriptContext,
};
use crate::script_deps::kept_pair;
use crate::script_log::add_to_script_log;
use crate::script_params::{
    param_target, param_values, script_params_sound, set_start_params, start_params_problem,
    with_target_param, ParamWithValue,
};
use crate::scripts::RunnableScript;
use crate::sight::{
    building_in_sight, entities_in_sight, places_in_sight, sight_of, InvariantViolation,
    SightCache,
};
use crate::tick::{RunScripts, Scratch, ScriptErrorWhere};
use crate::workplace_settings::{
    start_work_by_settings, with_work_settings, work_script_id, work_settings_of, WorkMemory,
    WorkSettingsHost,
};
use crate::world_index::WorldIndex;
use csp_lang::ParamType;

/// What running scripts needs from outside the world (`ScriptHost`): the script library and the
/// Players.
pub trait ScriptHost {
    /// The script's Player and active version; `None` once the script is deleted.
    fn script(&self, script_id: u64) -> Option<RunnableScript>;
    /// The Player as an order's sender; `None` if there is no such account.
    fn sender(&self, user_id: u64) -> Option<OrderSender>;
    /// Whether the Player has explored a tile.
    fn explored(&self, user_id: u64, x: i32, y: i32) -> bool;
    /// The id of the Player's version of a task's default script; without it such a script ends.
    fn default_script(&self, _user_id: u64, _task: Task) -> Option<u64> {
        None
    }
    /// Where an error of the game's own while running scripts is reported (ADR 0004).
    fn script_error(&self, _world: &WorldState, _error: &str, _at: &ScriptErrorWhere) {}
}

/// A host as the work-settings rules see it.
struct AsWorkHost<'h>(&'h dyn ScriptHost);

impl WorkSettingsHost for AsWorkHost<'_> {
    fn script(&self, script_id: u64) -> Option<RunnableScript> {
        self.0.script(script_id)
    }
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.0.default_script(user_id, task).unwrap_or(0)
    }
}

fn num(v: Option<&Json>) -> Option<f64> {
    v.and_then(Json::as_f64)
}

/// A whole number of zero or more as a script id.
fn script_id_of(v: Option<&Json>) -> Option<u64> {
    num(v).filter(|n| n.fract() == 0.0 && *n >= 0.0).map(|n| n as u64)
}

/// A reason the sender can't run script `scriptId`, if any (`badScript`).
fn bad_script(
    host: &dyn ScriptHost,
    sender: &OrderSender,
    script_id: Option<&Json>,
) -> Option<String> {
    let script = num(script_id).filter(|n| n.fract() == 0.0).and_then(|n| {
        if n >= 0.0 {
            host.script(n as u64)
        } else {
            None
        }
    });
    match script {
        Some(s) if s.user_id == sender.user_id => None,
        _ => Some("not one of your scripts with a version that can run".into()),
    }
}

/// Why the param values an order starting script `scriptId` gives don't fit its `param` lines
/// (`paramsProblem`); none given always fit.
fn params_problem(
    host: &dyn ScriptHost,
    world: &WorldState,
    realm_id: &str,
    script_id: Option<&Json>,
    params: Option<&Json>,
) -> Option<String> {
    let params = params?;
    let Some(source) = script_id_of(script_id).and_then(|id| host.script(id)).map(|s| s.source)
    else {
        return Some("not one of your scripts with a version that can run".into());
    };
    start_params_problem(world, realm_id, &script_params(&source), Some(params))
}

fn resident_index(world: &WorldState, order: &OrderRequest) -> Option<usize> {
    let id = field_str(order, "residentId");
    world.residents.iter().position(|x| Some(x.id.as_str()) == id)
}

fn running(script_id: u64, memory: ScriptMemory) -> RunningScript {
    serde_json::from_value(json!({ "scriptId": script_id, "memory": memory }))
        .expect("a running script")
}

/// The run-script order (`runScriptOrder`): one of the Player's residents runs one of the
/// Player's scripts, from a fresh memory, with the param values it gives set first; a default
/// script's target param is cleared unless it gives one.
pub struct RunScriptOrder {
    pub host: Arc<dyn ScriptHost + Send + Sync>,
}

impl OrderKind for RunScriptOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r = resident_index(world, order).map(|i| &world.residents[i]);
        let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
            return Some("not one of your residents".into());
        };
        let f = &order.fields;
        bad_script(self.host.as_ref(), sender, f.get("scriptId")).or_else(|| {
            params_problem(self.host.as_ref(), world, &realm.id, f.get("scriptId"), f.get("params"))
        })
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let Some(i) = resident_index(world, order) else { return };
        let script_id = script_id_of(order.fields.get("scriptId")).unwrap_or(0);
        let script = self.host.script(script_id);
        let params = order.fields.get("params").and_then(Json::as_object).cloned();
        let params =
            with_target_param(script.as_ref().map(|s| (s.source.as_str(), s.task)), params, None);
        let r = &mut world.residents[i];
        r.order = None;
        r.script = Some(running(script_id, Map::new()));
        set_start_params(r, script_id, params.as_ref());
    }
}

/// The set-defence-script order (`setDefenceScriptOrder`, `CONTEXT.md`: Defence script).
pub struct SetDefenceScriptOrder {
    pub host: Arc<dyn ScriptHost + Send + Sync>,
}

impl OrderKind for SetDefenceScriptOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r = resident_index(world, order).map(|i| &world.residents[i]);
        let Some(realm) =
            realm.filter(|realm| r.is_some_and(|r| r.owner.as_ref() == Some(&realm.id)))
        else {
            return Some("not one of your residents".into());
        };
        let f = &order.fields;
        if f.get("scriptId").is_some_and(Json::is_null) {
            return f.get("params").is_some().then(|| "Defend takes no params".into());
        }
        bad_script(self.host.as_ref(), sender, f.get("scriptId")).or_else(|| {
            params_problem(self.host.as_ref(), world, &realm.id, f.get("scriptId"), f.get("params"))
        })
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let Some(i) = resident_index(world, order) else { return };
        let script_id = script_id_of(order.fields.get("scriptId"));
        let defend = script_id
            .and_then(|id| self.host.script(id))
            .is_some_and(|s| s.task == Some(Task::Defend));
        let r = &mut world.residents[i];
        match script_id {
            Some(id) if !defend => {
                r.defence_script_id = Some(id);
                set_start_params(r, id, order.fields.get("params").and_then(Json::as_object));
            }
            _ => r.defence_script_id = None,
        }
    }
}

/// The set-alarm-script order (`setAlarmScriptOrder`, `CONTEXT.md`: Alarm script).
pub struct SetAlarmScriptOrder {
    pub host: Arc<dyn ScriptHost + Send + Sync>,
}

impl OrderKind for SetAlarmScriptOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r = resident_index(world, order).map(|i| &world.residents[i]);
        let Some(realm) =
            realm.filter(|realm| r.is_some_and(|r| r.owner.as_ref() == Some(&realm.id)))
        else {
            return Some("not one of your residents".into());
        };
        let f = &order.fields;
        let id = f.get("scriptId");
        if id.is_some_and(Json::is_null) || id.and_then(Json::as_str) == Some("none") {
            return f.get("params").is_some().then(|| "that takes no params".into());
        }
        bad_script(self.host.as_ref(), sender, id)
            .or_else(|| params_problem(self.host.as_ref(), world, &realm.id, id, f.get("params")))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let Some(i) = resident_index(world, order) else { return };
        let raw = order.fields.get("scriptId");
        let none = raw.and_then(Json::as_str) == Some("none");
        let script_id = script_id_of(raw);
        let alarm = script_id
            .and_then(|id| self.host.script(id))
            .is_some_and(|s| s.task == Some(Task::Alarm));
        let r = &mut world.residents[i];
        if none {
            r.alarm_script_id = Some(serde_json::from_value(json!("none")).expect("none"));
        } else if let Some(id) = script_id.filter(|_| !alarm) {
            r.alarm_script_id = Some(AlarmScriptId::Script(id));
            set_start_params(r, id, order.fields.get("params").and_then(Json::as_object));
        } else {
            r.alarm_script_id = None;
        }
    }
}

/// Where a task order finds the Player's version of a task's default script (`DefaultScriptHost`).
pub trait DefaultScriptHost {
    /// The id of the Player's version of the task's default script, made if they have none.
    fn default_script(&self, user_id: u64, task: Task) -> u64;
    /// The script's Player and active version, to check the param values a task gives against.
    fn script(&self, _script_id: u64) -> Option<RunnableScript> {
        None
    }
    /// Whether it can tell scripts at all (`host.script` in the TypeScript).
    fn has_scripts(&self) -> bool {
        false
    }
}

struct AsWork<'h>(&'h dyn DefaultScriptHost);

impl WorkSettingsHost for AsWork<'_> {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.0.script(id)
    }
    fn default_script(&self, user_id: u64, task: Task) -> u64 {
        self.0.default_script(user_id, task)
    }
}

/// The script a task runs for the Player (`taskScriptId`): Work at a workplace their realm keeps
/// settings for runs its work script, any other task the Player's version of its default script.
fn task_script_id(
    host: &dyn DefaultScriptHost,
    world: &WorldState,
    sender: &OrderSender,
    task: Task,
    workplace: Option<&str>,
) -> u64 {
    let realm = if sender.npc_city_id.is_none() { realm_of(world, sender.user_id) } else { None };
    match (task, realm, workplace) {
        (Task::Work, Some(realm), Some(w)) if host.has_scripts() => {
            work_script_id(&AsWork(host), sender.user_id, work_settings_of(world, &realm.id, w))
        }
        _ => host.default_script(sender.user_id, task),
    }
}

fn fields_of(order: &OrderRequest) -> &Map<String, Json> {
    &order.fields
}

/// The built-in order a task's request is checked as, for the resident (`asOrder`).
fn as_order(o: &OrderRequest, task: Task) -> OrderRequest {
    let f = fields_of(o);
    let pick = |keys: &[(&str, &str)]| {
        let mut m = Map::new();
        if let Some(id) = f.get("residentId") {
            m.insert("residentId".into(), id.clone());
        }
        for (to, from) in keys {
            if let Some(v) = f.get(*from) {
                m.insert(to.to_string(), v.clone());
            }
        }
        m
    };
    let (kind, fields) = match task {
        // To a tile only; a supply line to an army stays the bare haul order's.
        Task::Haul => (
            "haul",
            pick(&[
                ("carriageId", "carriageId"),
                ("x", "x"),
                ("y", "y"),
                ("goods", "goods"),
                ("returnGoods", "returnGoods"),
                ("keepFood", "keepFood"),
            ]),
        ),
        Task::TearDown => ("tearDown", pick(&[("buildingId", "buildingId")])),
        Task::Breed => ("breed", pick(&[("stableId", "stableId"), ("horseIds", "horseIds")])),
        Task::Build => ("build", pick(&[("building", "building")])),
        Task::Train => ("train", pick(&[("buildingId", "groundId")])),
        _ => ("workAt", pick(&[("makes", "makes")])),
    };
    OrderRequest { kind: kind.into(), fields }
}

/// The task as the resident takes it up (`withKeptPair`): for Breed horses, a pair whose breeding
/// the stable keeps comes first, when the resident can breed it.
fn with_kept_pair(
    world: &WorldState,
    o: &OrderRequest,
    task: Task,
    realm_id: Option<&str>,
) -> OrderRequest {
    let (Task::Breed, Some(realm_id)) = (task, realm_id) else { return o.clone() };
    let stable =
        field_str(o, "stableId").and_then(|id| world.buildings.iter().find(|b| b.id == id));
    let r = field_str(o, "residentId");
    let kept = stable.and_then(|s| kept_pair(world, s, HorseOwner::Realm(realm_id), r));
    match kept {
        Some([a, b]) => {
            let mut o = o.clone();
            o.fields.insert("horseIds".into(), json!([a, b]));
            o
        }
        None => o.clone(),
    }
}

/// The memory a task's default script starts from (`taskMemory`), for the resident at (x, y).
fn task_memory(
    world: &WorldState,
    o: &OrderRequest,
    task: Task,
    (x, y): (f64, f64),
) -> ScriptMemory {
    let f = fields_of(o);
    let tile = |v: Option<&Json>| v.map(|t| json!({ "x": t.get("x"), "y": t.get("y") }));
    let mut m = Map::new();
    match task {
        Task::Work => {
            let id = field_str(o, "workplaceId").unwrap_or_default();
            m.insert("workplaceId".into(), json!(id));
            if let Some(makes) = f.get("makes") {
                m.insert("makes".into(), makes.clone());
            }
            if world.buildings.iter().find(|b| b.id == id).is_some_and(|b| b.site.is_some()) {
                m.insert("siteId".into(), json!(id));
            }
        }
        Task::Build => {
            m.insert("building".into(), f.get("building").cloned().unwrap_or(Json::Null));
            m.insert("at".into(), tile(f.get("at")).unwrap_or_else(|| json!({ "x": x, "y": y })));
        }
        Task::BuildLine => {
            m.insert(
                "line".into(),
                json!({ "building": f.get("building"), "from": tile(f.get("from")), "to": tile(f.get("to")) }),
            );
        }
        Task::Haul => {
            m.insert("carriageId".into(), f.get("carriageId").cloned().unwrap_or(Json::Null));
            m.insert("from".into(), json!({ "x": x, "y": y }));
            m.insert("to".into(), json!({ "x": f.get("x"), "y": f.get("y") }));
            m.insert("goods".into(), f.get("goods").cloned().unwrap_or(json!([])));
            m.insert(
                "returnGoods".into(),
                f.get("returnGoods").filter(|v| !v.is_null()).cloned().unwrap_or(json!([])),
            );
            m.insert("keepFood".into(), f.get("keepFood").cloned().unwrap_or(Json::Null));
        }
        Task::TearDown => {
            m.insert("buildingId".into(), f.get("buildingId").cloned().unwrap_or(Json::Null));
        }
        Task::Breed => {
            m.insert("stableId".into(), f.get("stableId").cloned().unwrap_or(Json::Null));
            m.insert("horseIds".into(), f.get("horseIds").cloned().unwrap_or(json!([])));
        }
        Task::Train => {
            m.insert("groundId".into(), f.get("groundId").cloned().unwrap_or(Json::Null));
            if let Some(subject) = f.get("subject") {
                m.insert("subject".into(), subject.clone());
            }
        }
        Task::FeedStable => {
            m.insert("stableId".into(), f.get("stableId").cloned().unwrap_or(Json::Null));
        }
        Task::Explore | Task::Defend | Task::Alarm => {}
    }
    m
}

/// The task's target as its default's target param holds it (`taskTarget`), while the realm may
/// name it.
fn task_target(
    world: &WorldState,
    realm_id: Option<&str>,
    o: &OrderRequest,
    task: Task,
    at: (f64, f64),
) -> Option<String> {
    let (id, ty) = match task {
        Task::BuildLine | Task::Explore | Task::Defend | Task::Alarm => return None,
        Task::Work => (field_str(o, "workplaceId").map(str::to_string), ParamType::Building),
        Task::TearDown => (field_str(o, "buildingId").map(str::to_string), ParamType::Building),
        Task::Train => (field_str(o, "groundId").map(str::to_string), ParamType::Building),
        Task::Breed | Task::FeedStable => {
            (field_str(o, "stableId").map(str::to_string), ParamType::Storage)
        }
        Task::Haul => (field_str(o, "carriageId").map(str::to_string), ParamType::Storage),
        Task::Build => (build_site(world, o, at), ParamType::Building),
    };
    let id = id?;
    param_target(world, realm_id, ty, &id).map(|_| id)
}

fn kind_of_name(name: &str) -> Option<BuildingKind> {
    serde_json::from_value(json!(name)).ok()
}

/// The unfinished site a Build task joins at `at` (or the resident's tile) (`buildSite`).
fn build_site(world: &WorldState, o: &OrderRequest, (x, y): (f64, f64)) -> Option<String> {
    let kind = field_str(o, "building").and_then(kind_of_name)?;
    let at = o.fields.get("at");
    let (ax, ay) = match at {
        Some(t) => (num(t.get("x")).unwrap_or(x), num(t.get("y")).unwrap_or(y)),
        None => (x, y),
    };
    let site = construction_at(world, ax as i32, ay as i32, kind)?;
    (site.site.is_some() && site.kind == kind).then(|| site.id.clone())
}

fn is_tile(t: Option<&Json>) -> Option<(i32, i32)> {
    let t = t?.as_object()?;
    let whole = |v: Option<&Json>| num(v).filter(|n| n.fract() == 0.0).map(|n| n as i32);
    Some((whole(t.get("x"))?, whole(t.get("y"))?))
}

/// Whether a value names a stat or skill to train (`isTrainingSubject`).
fn is_training_subject(v: &Json) -> bool {
    serde_json::from_value::<csp_shared::world::TrainingSubject>(v.clone()).is_ok()
}

/// The task order (`taskOrder`, `CONTEXT.md`: Order, Default script; ADR 0009): one of the
/// Player's residents runs the Player's version of the task's default script, from a memory
/// holding the task's target. It ends whatever the resident was doing.
pub struct TaskOrder {
    pub host: Arc<dyn DefaultScriptHost + Send + Sync>,
    /// The built-in order kinds a task is checked as (`orderKinds`).
    pub builtins: OrderKinds,
}

impl TaskOrder {
    pub fn new(host: Arc<dyn DefaultScriptHost + Send + Sync>) -> Self {
        TaskOrder { host, builtins: order_kinds() }
    }

    /// Why the resident can't be given the task on its target (`taskProblem`).
    fn task_problem(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        o: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let raw = o.fields.get("task");
        match raw.and_then(Json::as_str) {
            Some("defend") => return Some("Defend runs when they are struck".into()),
            Some("alarm") => return Some("Alarm runs when an alarm reaches them".into()),
            _ => {}
        }
        let Some(task) = raw.and_then(task_of) else { return Some("no such task".into()) };
        let realm = realm_of(world, sender.user_id);
        let r = resident_index(world, o).map(|i| &world.residents[i]);
        let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
            return Some("not one of your residents".into());
        };
        let r = r.expect("commanded");
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        let tick = world.tick as f64;
        if task == Task::Work {
            let here = building_at(world, r.x as i32, r.y as i32, size).map(|b| b.id.as_str());
            if field_str(o, "workplaceId").is_none() || here != field_str(o, "workplaceId") {
                return Some("not standing on that workplace".into());
            }
        }
        if task == Task::FeedStable {
            // No order of its own: they store and fetch, which children can't.
            let stable = building_at(world, r.x as i32, r.y as i32, size)
                .filter(|b| b.kind == BuildingKind::Stable && b.site.is_none());
            if stable.map(|b| b.id.as_str()) != field_str(o, "stableId") {
                return Some("not standing in that stable".into());
            }
            return (!can_work(r.born_at, tick))
                .then(|| "children can’t store or fetch goods".into());
        }
        if task == Task::BuildLine {
            return build_line_problem(world, r, o, terrain);
        }
        if task == Task::Explore {
            return (!can_work(r.born_at, tick)).then(|| "children can’t explore".into());
        }
        if task == Task::Build {
            if let Some(at) = o.fields.get("at") {
                let Some(at) = is_tile(Some(at)) else {
                    return Some("the target must be a tile".into());
                };
                let kind = field_str(o, "building").and_then(kind_of_name);
                return build_at_problem(world, r, kind, at, terrain);
            }
        }
        if task == Task::Train {
            if let Some(subject) = o.fields.get("subject") {
                if !is_training_subject(subject) {
                    return Some("train a stat or a skill".into());
                }
            }
        }
        let built = work_site_order(world, o, task, r, size)
            .unwrap_or_else(|| as_order(&with_kept_pair(world, o, task, Some(&realm.id)), task));
        let kind = self.builtins.get(&built.kind)?;
        let problem = kind.validate(world, sender, &built, terrain);
        // Working there by a bare work-at order, as the starting residents do, they can still be
        // given the task; already running it there, they can't.
        match problem.as_deref() {
            Some("already working here") | Some("already training here") if r.script.is_none() => {
                None
            }
            _ => problem,
        }
    }
}

/// Work on a workplace still being built, checked as joining its site (`workSiteOrder`).
fn work_site_order(
    world: &WorldState,
    o: &OrderRequest,
    task: Task,
    r: &Resident,
    size: i32,
) -> Option<OrderRequest> {
    if task != Task::Work {
        return None;
    }
    let here = building_at(world, r.x as i32, r.y as i32, size)?;
    if here.site.is_none() || WORKPLACE_MAX_WORKERS.get(kind_name(here.kind)).is_none() {
        return None;
    }
    let _ = o;
    let mut fields = Map::new();
    fields.insert("residentId".into(), json!(r.id));
    fields.insert("building".into(), json!(kind_name(here.kind)));
    Some(OrderRequest { kind: "build".into(), fields })
}

/// Why resident `r` can't be given Build line on its line (`buildLineProblem`).
fn build_line_problem(
    world: &WorldState,
    r: &Resident,
    o: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t build".into());
    }
    if r.carrying.is_some() {
        return Some(crate::queries::building::CARRYING_A_CHILD.into());
    }
    let building = match field_str(o, "building") {
        Some("road") => BuildingKind::Road,
        Some("wall") => BuildingKind::Wall,
        _ => return Some("a line is of road or wall".into()),
    };
    let (Some(from), Some(to)) = (is_tile(o.fields.get("from")), is_tile(o.fields.get("to")))
    else {
        return Some("the line must run between two tiles".into());
    };
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    if road_line(from, to, size).len() as f64 > csp_shared::balance::ROAD_LINE_MAX_TILES {
        return Some(format!(
            "a line covers at most {} tiles",
            csp_shared::balance::ROAD_LINE_MAX_TILES
        ));
    }
    let line = crate::queries::building::BuildLine { building, from, to };
    if line_to_build(world, &line, terrain).is_empty() {
        return Some(format!("no {} to build on that line", kind_name(building)));
    }
    None
}

impl OrderKind for TaskOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let problem = self.task_problem(world, sender, order, terrain);
        let params = order.fields.get("params");
        if problem.is_some() || params.is_none() {
            return problem;
        }
        if !self.host.has_scripts() {
            return Some("the task takes no params".into());
        }
        let realm = realm_of(world, sender.user_id).expect("checked in task_problem");
        let task = order.fields.get("task").and_then(task_of).expect("checked");
        let script_id = task_script_id(
            self.host.as_ref(),
            world,
            sender,
            task,
            field_str(order, "workplaceId"),
        );
        let source = self.host.script(script_id).map(|s| s.source);
        let Some(source) = source else {
            return Some("not one of your scripts with a version that can run".into());
        };
        start_params_problem(world, &realm.id, &script_params(&source), params)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let Some(task) = order.fields.get("task").and_then(task_of) else { return };
        let realm_id = realm_of(world, sender.user_id).map(|r| r.id.clone());
        let o = with_kept_pair(world, order, task, realm_id.as_deref());
        let Some(i) = resident_index(world, &o) else { return };
        let at = (world.residents[i].x, world.residents[i].y);
        let script_id =
            task_script_id(self.host.as_ref(), world, sender, task, field_str(&o, "workplaceId"));
        let memory = task_memory(world, &o, task, at);
        let target = task_target(world, realm_id.as_deref(), &o, task, at);
        let params = o.fields.get("params").and_then(Json::as_object).cloned();
        if task == Task::Work && realm_id.is_some() && sender.npc_city_id.is_none() {
            // Work at a workplace runs by its settings (`CONTEXT.md`: Workplace settings).
            let work = WorkMemory {
                workplace_id: memory
                    .get("workplaceId")
                    .and_then(Json::as_str)
                    .unwrap_or_default()
                    .to_string(),
                makes: memory.get("makes").and_then(Json::as_str).map(str::to_string),
                site_id: memory.get("siteId").and_then(Json::as_str).map(str::to_string),
            };
            start_work_by_settings(
                &mut world.residents[i],
                script_id,
                &work,
                params.as_ref(),
                target.as_deref(),
            );
            return;
        }
        let source = self.host.script(script_id).map(|s| s.source);
        let params = with_target_param(
            source.as_deref().map(|s| (s, Some(task))),
            params,
            target.as_deref(),
        );
        let r = &mut world.residents[i];
        r.order = None;
        r.script = Some(running(script_id, memory));
        set_start_params(r, script_id, params.as_ref());
    }
}

/// The run-script order for an army (`armyRunScriptOrder`): one of the Player's armies runs one of
/// the Player's scripts, from a fresh memory. It ends the army's order, as any army order does.
pub struct ArmyRunScriptOrder {
    pub host: Arc<dyn ScriptHost + Send + Sync>,
    /// Where `armyStop` is found (`orderKinds.armyStop`).
    pub builtins: OrderKinds,
}

impl OrderKind for ArmyRunScriptOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let army =
            field_str(order, "armyId").and_then(|id| world.armies.iter().find(|a| a.id == id));
        match (army, realm) {
            (Some(a), Some(realm)) if a.realm_id == realm.id => {
                bad_script(self.host.as_ref(), sender, order.fields.get("scriptId"))
            }
            _ => Some("not one of your armies".into()),
        }
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(army_id) = field_str(order, "armyId").map(str::to_string) else { return };
        if !world.armies.iter().any(|a| a.id == army_id) {
            return;
        }
        if let Some(stop) = self.builtins.get("armyStop") {
            let mut fields = Map::new();
            fields.insert("armyId".into(), json!(army_id));
            stop.apply(world, sender, &OrderRequest { kind: "armyStop".into(), fields }, terrain);
        }
        let script_id = script_id_of(order.fields.get("scriptId")).unwrap_or(0);
        if let Some(a) = world.armies.iter_mut().find(|a| a.id == army_id) {
            a.script = Some(running(script_id, Map::new()));
        }
    }
}

/// The order a waiting script waits on (`waitingOn`), by resident. The TypeScript keeps the order
/// object itself, so the script wakes once the order is replaced by any other, even one of the
/// same kind, while the world advancing the order in place keeps it. Rust orders have no
/// identity, so this keeps the order's value as it stood at the end of the last world step
/// (`settle`): that is when the world is done advancing orders in place (walking, work, fights),
/// and before the next scripts run, so an order that differs from it then was replaced
/// (by an order a Player sent, a queue's next step, or anything else that sets it). Scratch memory,
/// never saved: after a restart a waiting script runs once more and waits again.
#[derive(Debug, Default)]
pub struct Waiting {
    on: HashMap<String, ResidentOrder>,
}

impl Waiting {
    /// Whether resident `r`'s script waits this tick (`waits`): it called `wait()` and the order
    /// it waits on still runs, and no blow struck them since. Otherwise its wait is over.
    fn waits(&self, r: &mut Resident) -> bool {
        let Some(running) = r.script.as_mut() else { return false };
        let Some(since) = running.waiting_since else { return false };
        let struck = r.struck.as_ref().is_some_and(|s| s.tick >= since);
        let same = r.order.as_ref().is_some_and(|o| self.on.get(&r.id) == Some(o));
        if same && !struck {
            return true;
        }
        running.waiting_since = None;
        false
    }

    /// After a run that called `wait()`, the script waits on the order the resident has now
    /// (`startWaiting`); with none, or with its script ended, it does nothing.
    fn start(&mut self, world: &mut WorldState, id: &str, script_id: u64) {
        let tick = world.tick as f64;
        let Some(r) = world.residents.iter_mut().find(|r| r.id == id) else { return };
        let (Some(order), Some(s)) = (&r.order, r.script.as_mut()) else { return };
        if s.script_id != script_id {
            return;
        }
        s.waiting_since = Some(tick);
        self.on.insert(r.id.clone(), order.clone());
    }

    /// Takes the orders the world advanced in place this step as the ones still waited on
    /// (`settle`), at the end of every world step. A waiting resident whose script ended, who
    /// no longer waits or who is gone is forgotten.
    pub fn settle(&mut self, world: &WorldState) {
        if self.on.is_empty() {
            return;
        }
        let mut kept = HashMap::with_capacity(self.on.len());
        for r in &world.residents {
            if !self.on.contains_key(&r.id) {
                continue;
            }
            let waiting = r.script.as_ref().is_some_and(|s| s.waiting_since.is_some());
            if let (true, Some(order)) = (waiting, &r.order) {
                kept.insert(r.id.clone(), order.clone());
            }
        }
        self.on = kept;
    }

    /// Invariant (`waiting-has-an-order`): every waiting script of `residents` has an order to
    /// wait on, the one it called `wait()` with, and began waiting no later than now
    /// (`waitingSound`).
    pub fn sound(&self, world: &WorldState, residents: &[String]) -> Vec<InvariantViolation> {
        let mut out = Vec::new();
        for id in residents {
            let Some(r) = world.residents.iter().find(|r| &r.id == id) else { continue };
            let Some(since) = r.script.as_ref().and_then(|s| s.waiting_since) else { continue };
            let mut fail = |m: String| {
                out.push(InvariantViolation {
                    invariant: "waiting-has-an-order".into(),
                    message: format!("{} {m}", r.id),
                    entity_ids: vec![r.id.clone()],
                })
            };
            match &r.order {
                None => fail("waits with no order".into()),
                Some(o) if self.on.get(&r.id).is_some_and(|w| w != o) => {
                    fail("waits past the end of the order it waited on".into())
                }
                _ => {}
            }
            if since > world.tick as f64 {
                fail(format!(
                    "began waiting at tick {}, after {}",
                    csp_lang::js::number_to_string(since),
                    world.tick
                ));
            }
        }
        out
    }
}

/// A resident or an army running a script (`Runner`).
#[derive(Clone)]
struct Runner {
    id: String,
    name: String,
    army: bool,
}

impl Runner {
    fn by(&self) -> (Option<String>, Option<String>) {
        if self.army {
            (None, Some(self.id.clone()))
        } else {
            (Some(self.id.clone()), None)
        }
    }

    fn script<'w>(&self, world: &'w WorldState) -> Option<&'w RunningScript> {
        if self.army {
            world.armies.iter().find(|a| a.id == self.id)?.script.as_ref()
        } else {
            world.residents.iter().find(|r| r.id == self.id)?.script.as_ref()
        }
    }

    fn script_mut<'w>(&self, world: &'w mut WorldState) -> Option<&'w mut RunningScript> {
        if self.army {
            world.armies.iter_mut().find(|a| a.id == self.id)?.script.as_mut()
        } else {
            world.residents.iter_mut().find(|r| r.id == self.id)?.script.as_mut()
        }
    }

    fn clear_script(&self, world: &mut WorldState) {
        if self.army {
            if let Some(a) = world.armies.iter_mut().find(|a| a.id == self.id) {
                a.script = None;
            }
        } else if let Some(r) = world.residents.iter_mut().find(|r| r.id == self.id) {
            r.script = None;
        }
    }
}

fn limits() -> ValueLimits {
    ValueLimits {
        max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
        max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
        max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
    }
}

fn options(steps: u64) -> RunOptions {
    RunOptions { steps, max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32, limits: limits() }
}

/// A script's memory after a run as plain data to keep, or why it can't be kept
/// (`keepMemory`); then the memory from before the run stays.
pub fn keep_memory(memory: &Object) -> Result<ScriptMemory, String> {
    match plain_value(&Value::Object(memory.clone()), SCRIPT_MEMORY_MAX as usize) {
        Ok(p) => Ok(match p.value {
            Json::Object(m) => m,
            _ => Map::new(),
        }),
        Err(NotPlain::Function) => {
            Err("Memory can’t keep functions; this tick’s changes were dropped".into())
        }
        Err(NotPlain::Cycle) => {
            Err("Memory can’t keep something that holds itself; this tick’s changes were dropped"
                .into())
        }
        Err(NotPlain::Size) => Err(format!(
            "Memory can keep at most {} characters; this tick’s changes were dropped",
            csp_lang::js::number_to_string(SCRIPT_MEMORY_MAX)
        )),
    }
}

/// A memory as a fresh script value to run with (`structuredClone(running.memory)`).
fn memory_object(memory: &ScriptMemory) -> Object {
    match Value::from_json(&Json::Object(memory.clone())) {
        Value::Object(o) => o,
        _ => Object::new(),
    }
}

/// A resident's script called `end()` (`endScript`): it ends and they stand idle. A defence or
/// Alarm script hands back to what it interrupted. True when it goes on as the same script (an
/// Alarm script back on an outsider alarm).
fn end_script(world: &mut WorldState, resident_id: &str) -> bool {
    let Some(i) = world.residents.iter().position(|x| x.id == resident_id) else { return false };
    if back_to_outsider_alarm(&mut world.residents[i]) {
        return true;
    }
    if resume_interrupted(world, i) {
        return false;
    }
    let r = &mut world.residents[i];
    r.script = None;
    r.order = None;
    false
}

/// A script that can't run any more stops (`stopScript`); a resident's defence script hands back
/// to what it interrupted, as on `end()`.
fn stop_script(world: &mut WorldState, r: &Runner) {
    if !r.army {
        if let Some(i) = world.residents.iter().position(|x| x.id == r.id) {
            if resume_interrupted(world, i) {
                return;
            }
        }
    }
    r.clear_script(world);
}

/// What an error of the game's own says, short enough for the realm log (`errorMessage`).
fn error_message(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() > 200 {
        format!("{}…", String::from_utf16_lossy(&units[..199]))
    } else {
        text.to_string()
    }
}

fn script_error_event(
    r: &Runner,
    script_id: u64,
    message: String,
    at: Option<(u32, u32)>,
) -> RealmEventWhat {
    let (resident_id, army_id) = r.by();
    RealmEventWhat::ScriptError {
        name: r.name.clone(),
        script_id,
        message,
        line: at.map(|a| f64::from(a.0)),
        column: at.map(|a| f64::from(a.1)),
        resident_id,
        army_id,
    }
}

fn out_of_steps_event(r: &Runner, script_id: u64, realm: bool) -> RealmEventWhat {
    let (resident_id, army_id) = r.by();
    RealmEventWhat::ScriptOutOfSteps {
        name: r.name.clone(),
        script_id,
        realm,
        resident_id,
        army_id,
    }
}

#[derive(Clone, Copy)]
enum LoggedAt {
    Error,
    Budget,
}

/// Writes a script's trouble into the realm log, at most once every `SCRIPT_LOG_INTERVAL` ticks
/// for each resident or army and kind of trouble (`logLimited`).
fn log_limited(
    world: &mut WorldState,
    realm_id: &str,
    r: &Runner,
    at: LoggedAt,
    what: RealmEventWhat,
) {
    let tick = world.tick as f64;
    let Some(running) = r.script_mut(world) else { return };
    let last = match at {
        LoggedAt::Error => &mut running.error_logged_at,
        LoggedAt::Budget => &mut running.budget_logged_at,
    };
    if last.is_some_and(|l| tick - l < SCRIPT_LOG_INTERVAL) {
        return;
    }
    *last = Some(tick);
    record_event(world, Some(realm_id), what);
}

/// Runs every resident's and army's script once a tick (`ScriptRunner`). Keeps parsed scripts
/// between ticks.
pub struct ScriptRunner {
    terrain: Arc<TerrainMap>,
    host: Arc<dyn ScriptHost + Send + Sync>,
    kinds: OrderKinds,
    programs: HashMap<u64, (String, Arc<Program>)>,
    waiting: Waiting,
    /// The scripts that ran the last `run_all`, waiting ones and those a realm's budget skipped
    /// left out: for tick health (ADR 0004).
    pub runs: usize,
}

impl ScriptRunner {
    pub fn new(
        terrain: Arc<TerrainMap>,
        host: Arc<dyn ScriptHost + Send + Sync>,
        kinds: OrderKinds,
    ) -> Self {
        ScriptRunner {
            terrain,
            host,
            kinds,
            programs: HashMap::new(),
            waiting: Waiting::default(),
            runs: 0,
        }
    }

    /// Runs the scripts and applies what they requested (`runAll`). Realm by realm, each script
    /// gets `SCRIPT_STEP_BUDGET` steps, or what is left of the realm's `SCRIPT_REALM_STEP_BUDGET`;
    /// once that is used up the rest skip the tick. Who goes first rotates with the tick. With
    /// `check`, returns the invariant violations found.
    pub fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        check: bool,
    ) -> Vec<InvariantViolation> {
        let mut out = Vec::new();
        let size = self.terrain.size;
        self.waiting = std::mem::take(&mut scratch.waiting);
        let mut by_realm: HashMap<String, Vec<Runner>> = HashMap::new();
        // The residents whose scripts the realms run, waiting or not.
        let mut commanded: Vec<String> = Vec::new();
        for i in 0..world.residents.len() {
            if world.residents[i].script.is_none() {
                continue;
            }
            // Down, they run nothing (`CONTEXT.md`: Down).
            if is_down(world.residents[i].down_until) {
                world.residents[i].script = None;
                world.residents[i].interrupted = None;
                continue;
            }
            let realm_id = {
                let r = &world.residents[i];
                scratch.index(world, size).commander_of(world, &r.id, r.owner.as_deref())
            };
            match realm_id {
                None => {
                    // An NPC city runs its residents' game defaults itself (`runNpcScripts`).
                    if runs_npc_alarm(world, &world.residents[i]) {
                        continue;
                    }
                    // Nobody runs their defence or Alarm script any more: what it interrupted goes on.
                    while resume_interrupted(world, i) {}
                    let r = &mut world.residents[i];
                    let keep = r
                        .script
                        .as_ref()
                        .is_some_and(|s| s.task.is_some() && s.script_id == 0 && r.owner.is_none());
                    if !keep {
                        r.script = None;
                    }
                }
                Some(realm_id) => {
                    commanded.push(world.residents[i].id.clone());
                    if self.waiting.waits(&mut world.residents[i]) {
                        continue;
                    }
                    let r = &world.residents[i];
                    by_realm.entry(realm_id).or_default().push(Runner {
                        id: r.id.clone(),
                        name: r.name.clone(),
                        army: false,
                    });
                }
            }
        }
        for a in &world.armies {
            if a.script.is_some() {
                by_realm.entry(a.realm_id.clone()).or_default().push(Runner {
                    id: a.id.clone(),
                    name: a.name.clone(),
                    army: true,
                });
            }
        }
        let mut used: HashMap<u64, (String, Arc<Program>)> = HashMap::new();
        let mut ran: HashSet<String> = HashSet::new();
        let opened = scratch.sight.is_none();
        if opened {
            scratch.sight = Some(SightCache::open(size));
        }
        let realms: Vec<(String, u64)> =
            world.realms.iter().map(|r| (r.id.clone(), r.user_id)).collect();
        for (realm_id, user_id) in realms {
            let Some(running) = by_realm.get(&realm_id) else { continue };
            let violations = if check { Some(&mut out) } else { None };
            self.run_realm(
                world, scratch, &realm_id, user_id, running, &mut used, &mut ran, violations,
            );
        }
        if opened {
            scratch.sight = None;
        }
        self.programs = used;
        self.runs = ran.len();
        let waiting = std::mem::take(&mut self.waiting);
        if check {
            out.extend(running_scripts_sound(world));
            out.extend(script_params_sound(world));
            out.extend(waiting.sound(world, &commanded));
            let host = self.host.clone();
            let unedited = |r: &Resident| {
                r.script.as_ref().is_some_and(|s| {
                    s.script_id != 0 && host.script(s.script_id).is_some_and(|x| x.follows_default)
                })
            };
            out.extend(one_carrier_at_a_time(world, &unedited));
            out.extend(one_fetcher_at_a_time(world, &unedited));
            out.extend(one_input_fetcher_at_a_time(world, &unedited));
            let task_of = |r: &Resident| {
                if !ran.contains(&r.id) || !unedited(r) {
                    return None;
                }
                host.script(r.script.as_ref()?.script_id)?.task
            };
            out.extend(defaults_have_a_target(world, &task_of));
            out.extend(line_builders_on_their_line(world, &task_of, size));
            out.extend(line_builders_apart(world, &task_of));
        }
        scratch.waiting = waiting;
        out
    }

    /// Runs one realm's scripts in turn, within the realm's step budget (`runRealm`).
    #[allow(clippy::too_many_arguments)]
    fn run_realm(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        realm_id: &str,
        user_id: u64,
        running: &[Runner],
        used: &mut HashMap<u64, (String, Arc<Program>)>,
        ran: &mut HashSet<String>,
        mut violations: Option<&mut Vec<InvariantViolation>>,
    ) {
        let Some(sender) = self.host.sender(user_id) else { return };
        let mut left = SCRIPT_REALM_STEP_BUDGET;
        let first = (world.tick as usize) % running.len();
        for k in 0..running.len() {
            let r = &running[(first + k) % running.len()];
            // Its script may have ended this tick.
            if r.script(world).is_none() {
                continue;
            }
            if left <= 0.0 {
                let script_id = r.script(world).map_or(0, |s| s.script_id);
                if let Some(s) = r.script_mut(world) {
                    s.last_run =
                        Some(ScriptRunSteps { steps: 0.0, out_of_steps: Some(OutOfSteps::Realm) });
                }
                log_limited(
                    world,
                    realm_id,
                    r,
                    LoggedAt::Budget,
                    out_of_steps_event(r, script_id, true),
                );
                continue;
            }
            ran.insert(r.id.clone());
            let steps = SCRIPT_STEP_BUDGET.min(left);
            match self.run_one(
                world,
                scratch,
                realm_id,
                user_id,
                &sender,
                r,
                steps,
                used,
                violations.as_deref_mut(),
            ) {
                Ok(spent) => left -= spent,
                Err(error) => {
                    // The game's own bug, not the script's: it ends this one script and the tick
                    // goes on.
                    left -= steps;
                    self.failed_in_game(world, realm_id, r, &error);
                }
            }
        }
    }

    /// A script's run hit something the game didn't expect (`failedInGame`): a bug in the game.
    /// The script ends as with `end()`, the realm log notes it once and monitoring gets the error.
    fn failed_in_game(&self, world: &mut WorldState, realm_id: &str, r: &Runner, error: &str) {
        let script_id = r.script(world).map(|s| s.script_id);
        if let Some(id) = script_id {
            let message = format!(
                "the game hit an error running this script, so it ended: {}",
                error_message(error)
            );
            record_event(world, Some(realm_id), script_error_event(r, id, message, None));
            if r.army {
                r.clear_script(world);
            } else {
                end_script(world, &r.id);
            }
        }
        let at = ScriptErrorWhere {
            realm_id: realm_id.to_string(),
            entity_ids: vec![r.id.clone()],
            script_id,
        };
        self.host.script_error(world, error, &at);
    }

    /// Runs one resident's or army's script with `steps`; returns the steps it used (`runOne`).
    #[allow(clippy::too_many_arguments)]
    fn run_one(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        realm_id: &str,
        user_id: u64,
        sender: &OrderSender,
        r: &Runner,
        steps: f64,
        used: &mut HashMap<u64, (String, Arc<Program>)>,
        violations: Option<&mut Vec<InvariantViolation>>,
    ) -> Result<f64, String> {
        let running = r.script(world).cloned().expect("checked by the caller");
        // Started on a task without a script of the Player's, a resident of theirs runs their
        // version of its default; one the realm commands but doesn't own stops, but for Defend.
        if running.script_id == 0 {
            let owned = world
                .residents
                .iter()
                .any(|x| x.id == r.id && x.owner.as_deref() == Some(realm_id));
            let runs = owned || running.task == Some(Task::Defend);
            let id = match running.task {
                Some(task) if runs => self.host.default_script(user_id, task).unwrap_or(0),
                _ => 0,
            };
            if id == 0 {
                stop_script(world, r);
                return Ok(0.0);
            }
            r.script_mut(world).expect("running").script_id = id;
            return self
                .run_one(world, scratch, realm_id, user_id, sender, r, steps, used, violations);
        }
        let script = self.host.script(running.script_id).filter(|s| s.user_id == user_id);
        let resident =
            if r.army { None } else { world.residents.iter().position(|x| x.id == r.id) };
        if script.is_none() {
            if let Some(i) = resident {
                let picked_defence = running.task == Some(Task::Defend)
                    && world.residents[i].defence_script_id == Some(running.script_id);
                let picked_alarm = running.task == Some(Task::Alarm)
                    && world.residents[i].alarm_script_id
                        == Some(AlarmScriptId::Script(running.script_id));
                if picked_defence || picked_alarm {
                    // The script picked is deleted or no longer theirs: they run the default from now on.
                    let (resident_id, name, script_id) =
                        (r.id.clone(), r.name.clone(), running.script_id);
                    let what = if picked_defence {
                        world.residents[i].defence_script_id = None;
                        RealmEventWhat::DefenceScriptGone { resident_id, name, script_id }
                    } else {
                        world.residents[i].alarm_script_id = None;
                        RealmEventWhat::AlarmScriptGone { resident_id, name, script_id }
                    };
                    record_event(world, Some(realm_id), what);
                    r.script_mut(world).expect("running").script_id = 0;
                    return self.run_one(
                        world, scratch, realm_id, user_id, sender, r, steps, used, violations,
                    );
                }
            }
            // Deleted, or the resident now belongs to another Player, whose script it isn't.
            let gone = self.host.script(running.script_id).is_none();
            stop_script(world, r);
            if gone {
                let (resident_id, army_id) = r.by();
                record_event(
                    world,
                    Some(realm_id),
                    RealmEventWhat::ScriptEnded {
                        name: r.name.clone(),
                        script_id: running.script_id,
                        resident_id,
                        army_id,
                    },
                );
            }
            return Ok(0.0);
        }
        let script = script.expect("checked");
        // A saved change is picked up here: the active version's source is read every tick.
        let parsed =
            used.get(&running.script_id).or_else(|| self.programs.get(&running.script_id)).cloned();
        let parsed = match parsed {
            Some((source, program)) if source == script.source => (source, program),
            _ => {
                let program = parse(&script.source)
                    .map_err(|e| format!("an active version that doesn't parse: {e:?}"))?;
                (script.source.clone(), Arc::new(program))
            }
        };
        used.insert(running.script_id, parsed.clone());
        let program = parsed.1;
        // An error belongs to the version that ran into it; another one running clears it.
        if let Some(s) = r.script_mut(world) {
            if s.last_error.as_ref().is_some_and(|e| e.version != u64::from(script.version)) {
                s.last_error = None;
            }
        }
        let memory = memory_object(&running.memory);
        // A resident's picked param values; an army's params are never picked.
        let declared = params_of(&script.source);
        let picked: Vec<ParamWithValue> = match resident {
            Some(i) => param_values(world, i, running.script_id, &declared),
            None => {
                declared.iter().map(|p| ParamWithValue { param: p.clone(), value: None }).collect()
            }
        };
        // Working by a workplace's settings, what isn't picked for them reads the workplace's.
        let params = match &running.settings_from {
            None => picked,
            Some(from) => with_work_settings(picked, from, work_settings_of(world, realm_id, from)),
        };
        let mut violations = violations;
        if let (Some(v), Some(from)) = (violations.as_deref_mut(), &running.settings_from) {
            v.extend(runs_work_script(
                self.host.as_ref(),
                world,
                realm_id,
                user_id,
                &r.id,
                from,
                running.script_id,
            ));
        }
        let size = self.terrain.size;
        let mut slot = scratch.index.take();
        let index = crate::world_index::world_index(&mut slot, world, size);
        let host = self.host.clone();
        let explored = move |x: i32, y: i32| host.explored(user_id, x, y);
        let (requests, ended, end_reason, waited, logged, result) = {
            let sight = RefCell::new(scratch.sight.take());
            let world_ref: &WorldState = world;
            let seen = || {
                let mut cache = sight.borrow_mut();
                entities_in_sight(world_ref, index, Some(realm_id), cache.as_mut())
            };
            let places = || {
                let mut cache = sight.borrow_mut();
                places_in_sight(world_ref, index, realm_id, None, cache.as_mut()).seen
            };
            let place = |b: &csp_shared::world::Building| {
                let mut cache = sight.borrow_mut();
                building_in_sight(world_ref, index, realm_id, b, cache.as_mut())
            };
            let eyes = || {
                let mut cache = sight.borrow_mut();
                sight_of(world_ref, index, realm_id, cache.as_mut())
            };
            let ctx = ScriptContext {
                world: world_ref,
                terrain: &self.terrain,
                index,
                sender,
                resident_id: (!r.army).then_some(r.id.as_str()),
                army_id: r.army.then_some(r.id.as_str()),
                memory: memory.clone(),
                seen: &seen,
                places: Some(&places),
                place: Some(&place),
                eyes: &eyes,
                explored: &explored,
                kinds: &self.kinds,
                edge: None,
                params: Some(&params),
            };
            let mut bound = bind_script(ctx).map_err(|e| e.0)?;
            let result = run(&program, &mut bound, &options(steps as u64)).map_err(|e| e.0)?;
            let out =
                (bound.requests, bound.ended, bound.end_reason, bound.waited, bound.logged, result);
            scratch.sight = sight.into_inner();
            out
        };
        scratch.index = slot;
        if let Some(v) = violations {
            let sound = if r.army { army_script_requests_sound } else { script_requests_sound };
            v.extend(sound(world, &self.terrain, sender, &r.id, &requests, &self.kinds));
            // Invariant (ADR 0009): the game's defaults stay well within a resident's budget.
            if matches!(result, RunResult::OutOfSteps { .. })
                && script.follows_default
                && steps >= SCRIPT_STEP_BUDGET
            {
                v.push(InvariantViolation {
                    invariant: "default-scripts-in-budget".into(),
                    message: format!(
                        "{} ran out of steps running unedited default script {}",
                        r.id, running.script_id
                    ),
                    entity_ids: vec![r.id.clone()],
                });
            }
        }
        // What it requested counts, even when it stopped with an error or out of steps.
        for order in &requests {
            let kind = self
                .kinds
                .get(&order.kind)
                .cloned()
                .ok_or_else(|| format!("no order kind {}", order.kind))?;
            // A waypoint a script puts down is noted in the realm log (`CONTEXT.md`: Waypoint).
            let marks = order.kind == "addWaypoint"
                && kind.validate(world, sender, order, Some(&self.terrain)).is_none();
            kind.apply(world, sender, order, Some(&self.terrain));
            if marks {
                let (resident_id, army_id) = r.by();
                let f = &order.fields;
                record_event(
                    world,
                    Some(realm_id),
                    RealmEventWhat::WaypointAdded {
                        name: r.name.clone(),
                        waypoint: csp_lang::js::trim(
                            f.get("name").and_then(Json::as_str).unwrap_or_default(),
                        )
                        .to_string(),
                        x: num(f.get("x")).unwrap_or(0.0),
                        y: num(f.get("y")).unwrap_or(0.0),
                        resident_id,
                        army_id,
                    },
                );
            }
        }
        // So are its log lines, and the reason it ended with goes in the log after them. Only the
        // owning Player reads the log.
        let reason = if ended { end_reason } else { None };
        if let Some(i) = world.residents.iter().position(|x| x.id == r.id && !r.army) {
            if world.residents[i].owner.as_deref() == Some(realm_id) {
                let mut lines = logged;
                lines.extend(reason.clone());
                let tick = world.tick as f64;
                add_to_script_log(&mut world.residents[i], tick, &lines);
            }
        }
        let spent = result.steps() as f64;
        if ended {
            let same = !r.army && end_script(world, &r.id);
            if r.army {
                r.clear_script(world);
            }
            // An Alarm script going back to an outsider alarm hasn't ended: it keeps what it
            // remembered, and its script log has the reason.
            if same {
                if let Ok(kept) = keep_memory(&memory) {
                    if let Some(s) = r.script_mut(world) {
                        s.memory = kept;
                    }
                }
                return Ok(spent);
            }
            // A reason is noted each time, not rate-limited: an end is no error.
            if let Some(reason) = reason {
                let (resident_id, army_id) = r.by();
                record_event(
                    world,
                    Some(realm_id),
                    RealmEventWhat::ScriptStopped {
                        name: r.name.clone(),
                        script_id: running.script_id,
                        script: script.name.clone(),
                        reason,
                        resident_id,
                        army_id,
                    },
                );
            }
            return Ok(spent);
        }
        // The script may have been ended or replaced by what it requested.
        let still = r.script(world).is_some_and(|s| s.script_id == running.script_id);
        if waited && !r.army && still {
            self.waiting.start(world, &r.id, running.script_id);
        }
        if !still {
            return Ok(spent);
        }
        let version = u64::from(script.version);
        let tick = world.tick as f64;
        let failed = |world: &mut WorldState, message: String, at: Option<(u32, u32)>| {
            if let Some(s) = r.script_mut(world) {
                s.last_error = Some(ScriptRunError {
                    message: message.clone(),
                    line: at.map(|a| f64::from(a.0)),
                    column: at.map(|a| f64::from(a.1)),
                    tick,
                    version,
                });
            }
            log_limited(
                world,
                realm_id,
                r,
                LoggedAt::Error,
                script_error_event(r, running.script_id, message, at),
            );
        };
        match keep_memory(&memory) {
            Err(why) => failed(world, why, None),
            Ok(kept) => {
                if let Some(s) = r.script_mut(world) {
                    s.memory = kept;
                }
            }
        }
        let realm_cut = steps < SCRIPT_STEP_BUDGET;
        if let Some(s) = r.script_mut(world) {
            s.last_run = Some(ScriptRunSteps { steps: spent, out_of_steps: None });
        }
        match result {
            RunResult::Error { message, line, column, .. } => {
                failed(world, message, Some((line, column)))
            }
            RunResult::OutOfSteps { .. } => {
                if let Some(s) = r.script_mut(world) {
                    if let Some(l) = &mut s.last_run {
                        l.out_of_steps =
                            Some(if realm_cut { OutOfSteps::Realm } else { OutOfSteps::Own });
                    }
                }
                log_limited(
                    world,
                    realm_id,
                    r,
                    LoggedAt::Budget,
                    out_of_steps_event(r, running.script_id, realm_cut),
                );
            }
            RunResult::Done { .. } => {}
        }
        Ok(spent)
    }
}

impl RunScripts for ScriptRunner {
    fn run_all(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        check: bool,
    ) -> Vec<InvariantViolation> {
        ScriptRunner::run_all(self, world, scratch, check)
    }
    fn runs(&self) -> usize {
        self.runs
    }
}

/// Invariant (`works-by-work-script`): a resident working by a workplace's settings runs its
/// current work script (`runsWorkScript`).
fn runs_work_script(
    host: &dyn ScriptHost,
    world: &WorldState,
    realm_id: &str,
    user_id: u64,
    resident_id: &str,
    from: &str,
    script_id: u64,
) -> Vec<InvariantViolation> {
    let settings = work_settings_of(world, realm_id, from);
    if host.default_script(user_id, Task::Work).is_none()
        || Some(script_id) == settings.and_then(|s| s.script_id)
    {
        return Vec::new();
    }
    if script_id == work_script_id(&AsWorkHost(host), user_id, settings) {
        return Vec::new();
    }
    vec![InvariantViolation {
        invariant: "works-by-work-script".into(),
        message: format!("{resident_id} works {from} by its settings but runs script {script_id}"),
        entity_ids: vec![resident_id.to_string(), from.to_string()],
    }]
}

/// Invariant (`running-scripts-sound`, ADR 0004): every running script names a script (or a
/// task, for its default), keeps plain memory within `SCRIPT_MEMORY_MAX`, has logged no trouble
/// and kept no error from the future, and used no more steps than its budget.
pub fn running_scripts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let holders = world
        .residents
        .iter()
        .map(|r| ("resident", &r.id, r.script.as_ref()))
        .chain(world.armies.iter().map(|a| ("army", &a.id, a.script.as_ref())));
    let tick = world.tick as f64;
    for (what, id, s) in holders {
        let Some(s) = s else { continue };
        let mut fail = |m: String| {
            out.push(InvariantViolation {
                invariant: "running-scripts-sound".into(),
                message: format!("{what} {id} {m}"),
                entity_ids: vec![id.clone()],
            })
        };
        // 0 only while it runs a task's default without a script of the Player's.
        if s.script_id == 0 && s.task.is_none() {
            fail(format!("runs script {}", s.script_id));
        }
        match keep_memory(&memory_object(&s.memory)) {
            Err(why) => fail(format!("keeps memory it can't: {why}")),
            Ok(kept) => {
                if Json::Object(kept) != Json::Object(s.memory.clone()) {
                    fail("keeps memory that is not plain data".into());
                }
            }
        }
        for at in [s.error_logged_at, s.budget_logged_at].into_iter().flatten() {
            if at > tick {
                fail(format!(
                    "logged script trouble at tick {}, after {}",
                    csp_lang::js::number_to_string(at),
                    world.tick
                ));
            }
        }
        if let Some(e) = s.last_error.as_ref().filter(|e| e.tick > tick) {
            fail(format!(
                "kept an error from tick {}, after {}",
                csp_lang::js::number_to_string(e.tick),
                world.tick
            ));
        }
        if let Some(used) = s.last_run.as_ref().map(|l| l.steps) {
            if !(used.fract() == 0.0 && (0.0..=SCRIPT_STEP_BUDGET).contains(&used)) {
                fail(format!(
                    "used {} steps, outside its budget of {}",
                    csp_lang::js::number_to_string(used),
                    csp_lang::js::number_to_string(SCRIPT_STEP_BUDGET)
                ));
            }
        }
    }
    out
}

/// A task's default script as an NPC city runs it: parsed, with its params and no values picked.
struct NpcDefault {
    program: Arc<Program>,
    params: Vec<ParamWithValue>,
}

thread_local! {
    /// The game's default scripts as parsed, by task, for NPC cities (`gamePrograms`). By task
    /// rather than by source, so a run doesn't hash the whole source to find it (#1092).
    static NPC_DEFAULTS: RefCell<HashMap<Task, Rc<NpcDefault>>> = RefCell::new(HashMap::new());
}

/// The default script of `task`, parsed once, with its params: nobody picks values for an NPC
/// city, so its defaults fall back on their own.
fn npc_default(task: Task) -> Rc<NpcDefault> {
    NPC_DEFAULTS.with(|d| {
        d.borrow_mut()
            .entry(task)
            .or_insert_with(|| {
                let (_, source) = default_script(task);
                let program = parse(source).expect("the game's default scripts parse");
                let params = params_of(source)
                    .iter()
                    .cloned()
                    .map(|p| ParamWithValue { param: p, value: None })
                    .collect();
                Rc::new(NpcDefault { program: Arc::new(program), params })
            })
            .clone()
    })
}

/// Whether `r` fights back at who last struck them (`fightsBack`).
fn fights_back(r: &Resident) -> bool {
    match &r.order {
        Some(ResidentOrder::Attack(o)) => {
            o.defending == Some(true) && r.struck.as_ref().is_some_and(|s| s.by == o.target_id)
        }
        _ => false,
    }
}

/// Where an NPC city's scout explores next (`scoutEdge`), and noting how its scouting ended
/// (`scoutEnded`).
fn scout_edge(
    world: &WorldState,
    city: &City,
    r: &Resident,
    size: i32,
    can_enter: &dyn Fn(i32, i32) -> bool,
    skip: &[(i32, i32)],
) -> Option<(i32, i32)> {
    crate::npc_scouts::scout_edge(world, city, r, size, can_enter, skip)
}

fn scout_ended(world: &mut WorldState, city_id: &str, reason: Option<&str>) {
    if let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) {
        crate::npc_scouts::scout_ended(city, reason);
    }
}

/// An NPC city's residents run the game's default of their task (`runNpcScripts`, `CONTEXT.md`:
/// NPC city, Default script; ADR 0009), through the same interpreter and game API as a Player's
/// scripts, with the city as the sender: it sees what its residents see, explored or not, and
/// has no realm budget. Returns how many scripts ran, for tick health.
pub fn run_npc_scripts(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
) -> usize {
    let kinds = order_kinds();
    let npc: Vec<&City> = world.cities.iter().filter(|c| c.realm_id.is_none()).collect();
    let mut by_city: Vec<(City, Vec<String>)> = Vec::new();
    for r in &world.residents {
        let Some(city) = r.city_id.as_ref().and_then(|id| npc.iter().find(|c| &c.id == id)) else {
            continue;
        };
        let default = r.script.as_ref().is_some_and(|s| s.script_id == 0 && s.task.is_some());
        if r.owner.is_some() || !default || is_down(r.down_until) {
            continue;
        }
        match by_city.iter_mut().find(|(c, _)| c.id == city.id) {
            Some((_, people)) => people.push(r.id.clone()),
            None => by_city.push(((*city).clone(), vec![r.id.clone()])),
        }
    }
    let opened = scratch.sight.is_none();
    if opened {
        scratch.sight = Some(SightCache::open(terrain.size));
    }
    let mut runs = 0;
    let mut waiting = std::mem::take(&mut scratch.waiting);
    for (city, people) in by_city {
        runs += run_city_scripts(world, terrain, scratch, &mut waiting, &city, &people, &kinds);
    }
    scratch.waiting = waiting;
    if opened {
        scratch.sight = None;
    }
    runs
}

/// Runs one NPC city's residents' scripts; returns how many ran (`runCityScripts`).
fn run_city_scripts(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
    waiting: &mut Waiting,
    city: &City,
    people: &[String],
    kinds: &OrderKinds,
) -> usize {
    let sender = npc_sender(city);
    let mut runs = 0;
    for id in people {
        let Some(i) = world.residents.iter().position(|r| &r.id == id) else { continue };
        let Some(running) = world.residents[i].script.clone() else { continue };
        let Some(task) = running.task else { continue };
        // A resident lent out is run by the hirer.
        if ordered_resident(world, &sender, Some(id)).is_none()
            || waiting.waits(&mut world.residents[i])
        {
            continue;
        }
        // Struck on alarm, they fight back first, as Defend does, and it goes on after.
        if task == Task::Alarm && fights_back(&world.residents[i]) {
            continue;
        }
        runs += 1;
        let default = npc_default(task);
        let memory = memory_object(&running.memory);
        let mut slot = scratch.index.take();
        let index = crate::world_index::world_index(&mut slot, world, terrain.size);
        let outcome = {
            let sight = RefCell::new(scratch.sight.take());
            let world_ref: &WorldState = world;
            let seen = || {
                let mut cache = sight.borrow_mut();
                entities_in_sight(world_ref, index, Some(&city.id), cache.as_mut())
            };
            let places = || {
                let mut cache = sight.borrow_mut();
                places_in_sight(world_ref, index, &city.id, None, cache.as_mut()).seen
            };
            let place = |b: &csp_shared::world::Building| {
                let mut cache = sight.borrow_mut();
                building_in_sight(world_ref, index, &city.id, b, cache.as_mut())
            };
            let eyes = || {
                let mut cache = sight.borrow_mut();
                sight_of(world_ref, index, &city.id, cache.as_mut())
            };
            let explored = |_: i32, _: i32| true;
            let resident = &world_ref.residents[i];
            // A scout explores what their city doesn't know yet (`CONTEXT.md`: Scout).
            let edge = |can_enter: &dyn Fn(i32, i32) -> bool, skip: &[(i32, i32)]| {
                scout_edge(world_ref, city, resident, terrain.size, can_enter, skip)
            };
            let ctx = ScriptContext {
                world: world_ref,
                terrain,
                index,
                sender: &sender,
                resident_id: Some(id),
                army_id: None,
                memory: memory.clone(),
                seen: &seen,
                places: Some(&places),
                place: Some(&place),
                eyes: &eyes,
                explored: &explored,
                kinds,
                edge: Some(&edge),
                params: Some(&default.params),
            };
            let outcome = bind_script(ctx).ok().map(|mut bound| {
                let _ = run(&default.program, &mut bound, &options(SCRIPT_STEP_BUDGET as u64));
                (bound.requests, bound.ended, bound.end_reason, bound.waited)
            });
            scratch.sight = sight.into_inner();
            outcome
        };
        scratch.index = slot;
        let Some((requests, ended, end_reason, waited)) = outcome else { continue };
        // What it logs is dropped: no Player owns an NPC city's residents to read their script log.
        for order in &requests {
            if let Some(kind) = kinds.get(&order.kind) {
                kind.apply(world, &sender, order, Some(terrain));
            }
        }
        if ended {
            if task == Task::Explore {
                scout_ended(world, &city.id, end_reason.as_deref());
            }
            // An Alarm script going back to an outsider alarm hasn't ended: it keeps what it remembered.
            if end_script(world, id) {
                if let Ok(kept) = keep_memory(&memory) {
                    if let Some(s) = world
                        .residents
                        .iter_mut()
                        .find(|r| &r.id == id)
                        .and_then(|r| r.script.as_mut())
                    {
                        s.memory = kept;
                    }
                }
            }
            continue;
        }
        let still = world
            .residents
            .iter()
            .find(|r| &r.id == id)
            .and_then(|r| r.script.as_ref())
            .is_some_and(|s| s.script_id == 0 && s.task == Some(task));
        if waited && still {
            waiting.start(world, id, 0);
        }
        if let (Ok(kept), true) = (keep_memory(&memory), still) {
            if let Some(s) =
                world.residents.iter_mut().find(|r| &r.id == id).and_then(|r| r.script.as_mut())
            {
                s.memory = kept;
            }
        }
    }
    runs
}

/// The residents counted whose script memory has `away` set, by the `key` in their memory they
/// share, where more than one share it (`oneAwayAtATime`).
fn one_away_at_a_time(
    world: &WorldState,
    counts: &dyn Fn(&Resident) -> bool,
    key: &str,
    away: &str,
) -> Vec<(String, Vec<String>)> {
    let mut by_key: Vec<(String, Vec<String>)> = Vec::new();
    for r in &world.residents {
        let Some(s) = &r.script else { continue };
        let Some(at) = s.memory.get(key).and_then(Json::as_str) else { continue };
        if s.memory.get(away).is_none_or(Json::is_null) || !counts(r) {
            continue;
        }
        match by_key.iter_mut().find(|(k, _)| k == at) {
            Some((_, ids)) => ids.push(r.id.clone()),
            None => by_key.push((at.to_string(), vec![r.id.clone()])),
        }
    }
    by_key.into_iter().filter(|(_, ids)| ids.len() > 1).collect()
}

/// Invariant (`one-carrier-at-a-time`): at most one resident of a workplace is away carrying its
/// output at once, among those running the Work default as the game ships it.
pub fn one_carrier_at_a_time(
    world: &WorldState,
    counts: &dyn Fn(&Resident) -> bool,
) -> Vec<InvariantViolation> {
    one_away_at_a_time(world, counts, "workplaceId", "carry")
        .into_iter()
        .map(|(place, ids)| InvariantViolation {
            invariant: "one-carrier-at-a-time".into(),
            message: format!(
                "{} residents carry {place}'s output at once: {}",
                ids.len(),
                ids.join(", ")
            ),
            entity_ids: std::iter::once(place).chain(ids).collect(),
        })
        .collect()
}

/// Invariant (`one-fetcher-at-a-time`): at most one resident building a site is away fetching
/// its materials at once, among those running the Build default as the game ships it.
pub fn one_fetcher_at_a_time(
    world: &WorldState,
    counts: &dyn Fn(&Resident) -> bool,
) -> Vec<InvariantViolation> {
    one_away_at_a_time(world, counts, "siteId", "fetch")
        .into_iter()
        .map(|(site, ids)| InvariantViolation {
            invariant: "one-fetcher-at-a-time".into(),
            message: format!(
                "{} residents fetch materials for {site} at once: {}",
                ids.len(),
                ids.join(", ")
            ),
            entity_ids: std::iter::once(site).chain(ids).collect(),
        })
        .collect()
}

/// Invariant (`one-input-fetcher-at-a-time`): at most one resident of a smelter, mint or smithy
/// is away fetching its inputs at once, among those running the Work default as shipped.
pub fn one_input_fetcher_at_a_time(
    world: &WorldState,
    counts: &dyn Fn(&Resident) -> bool,
) -> Vec<InvariantViolation> {
    one_away_at_a_time(world, counts, "workplaceId", "input")
        .into_iter()
        .map(|(place, ids)| InvariantViolation {
            invariant: "one-input-fetcher-at-a-time".into(),
            message: format!(
                "{} residents fetch {place}'s inputs at once: {}",
                ids.len(),
                ids.join(", ")
            ),
            entity_ids: std::iter::once(place).chain(ids).collect(),
        })
        .collect()
}

/// What a default script keeps in memory once it knows its target (`TARGET_KNOWN`).
fn target_known(task: Task) -> Option<(&'static str, &'static [&'static str], &'static str)> {
    Some(match task {
        Task::Work => ("workers-have-a-workplace", &["workplaceId"], "Work without a workplace"),
        Task::Build => ("builders-have-a-site", &["building", "at"], "Build without a site"),
        Task::Haul => {
            ("haulers-have-a-route", &["to", "carriageId"], "Haul without a route or carriage")
        }
        Task::BuildLine => ("line-builders-have-a-line", &["line"], "Build line without a line"),
        _ => return None,
    })
}

/// Invariant (`defaultsHaveATarget`): a resident running the Work, Build, Haul or Build line
/// default as the game ships it knows its target once it has run.
pub fn defaults_have_a_target(
    world: &WorldState,
    task_of: &dyn Fn(&Resident) -> Option<Task>,
) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(s) = &r.script else { continue };
        let Some((invariant, keys, without)) = task_of(r).and_then(target_known) else { continue };
        if keys.iter().all(|k| s.memory.get(*k).is_some_and(|v| !v.is_null())) {
            continue;
        }
        out.push(InvariantViolation {
            invariant: invariant.into(),
            message: format!("{} runs {without}", r.id),
            entity_ids: vec![r.id.clone()],
        });
    }
    out
}

fn memory_tile(v: Option<&Json>) -> Option<(f64, f64)> {
    let v = v?.as_object()?;
    Some((v.get("x")?.as_f64()?, v.get("y")?.as_f64()?))
}

/// Invariant (`lineBuildersOnTheirLine`): a resident running the Build line default as shipped
/// builds only on their line.
pub fn line_builders_on_their_line(
    world: &WorldState,
    task_of: &dyn Fn(&Resident) -> Option<Task>,
    size: i32,
) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(s) = &r.script else { continue };
        if task_of(r) != Some(Task::BuildLine) {
            continue;
        }
        let Some(line) = s.memory.get("line").filter(|v| !v.is_null()) else { continue };
        let (Some(from), Some(to)) = (memory_tile(line.get("from")), memory_tile(line.get("to")))
        else {
            continue;
        };
        let tiles: HashSet<(i32, i32)> =
            road_line((from.0 as i32, from.1 as i32), (to.0 as i32, to.1 as i32), size)
                .into_iter()
                .collect();
        let took = memory_tile(s.memory.get("at"));
        let builds = match &r.order {
            Some(ResidentOrder::Build(o)) => Some((o.at.x, o.at.y)),
            _ => None,
        };
        let building = line.get("building").and_then(Json::as_str).unwrap_or_default();
        for (what, t) in [("took", took), ("builds on", builds)] {
            let Some(t) = t else { continue };
            if tiles.contains(&(t.0 as i32, t.1 as i32)) {
                continue;
            }
            out.push(InvariantViolation {
                invariant: "line-builders-on-their-line".into(),
                message: format!(
                    "{} {what} ({}, {}), off their {building} line",
                    r.id,
                    csp_lang::js::number_to_string(t.0),
                    csp_lang::js::number_to_string(t.1)
                ),
                entity_ids: vec![r.id.clone()],
            });
        }
    }
    out
}

/// Invariant (`lineBuildersApart`): residents of one realm running the Build line default as
/// shipped on the same line never take the same tile.
pub fn line_builders_apart(
    world: &WorldState,
    task_of: &dyn Fn(&Resident) -> Option<Task>,
) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut took: HashMap<String, String> = HashMap::new();
    for r in &world.residents {
        let Some(s) = &r.script else { continue };
        if task_of(r) != Some(Task::BuildLine) {
            continue;
        }
        let (Some(line), Some(at)) =
            (s.memory.get("line").filter(|v| !v.is_null()), memory_tile(s.memory.get("at")))
        else {
            continue;
        };
        let org = r.owner.as_deref().or(r.city_id.as_deref()).unwrap_or("null");
        let key = format!("{org}|{}|{},{}", line, at.0, at.1);
        match took.get(&key) {
            None => {
                took.insert(key, r.id.clone());
            }
            Some(other) => out.push(InvariantViolation {
                invariant: "line-builders-apart".into(),
                message: format!(
                    "{other} and {} both took ({}, {}) of their {} line",
                    r.id,
                    csp_lang::js::number_to_string(at.0),
                    csp_lang::js::number_to_string(at.1),
                    line.get("building").and_then(Json::as_str).unwrap_or_default()
                ),
                entity_ids: vec![other.clone(), r.id.clone()],
            }),
        }
    }
    out
}

/// A seen thing's list for callers that want all of a side's sight at once.
pub fn seen_by(world: &WorldState, size: i32, side: &str) -> Arc<Vec<SeenEntity>> {
    let index = WorldIndex::new(world, size);
    entities_in_sight(world, &index, Some(side), None)
}

#[cfg(test)]
mod build_line_tests;
#[cfg(test)]
pub(crate) mod default_host;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod working_site_tests;

thread_local! {
    /// The params each script source declares (`scriptParams`), by source. Reading them parses
    /// the source; a source's params never change, and every resident running it reads them
    /// every tick, so each source is read once.
    static SOURCE_PARAMS: RefCell<HashMap<String, Arc<Vec<csp_lang::ParamInfo>>>> =
        RefCell::new(HashMap::new());
}

/// `script_params(source)`, read once per source (`SOURCE_PARAMS`).
fn params_of(source: &str) -> Arc<Vec<csp_lang::ParamInfo>> {
    SOURCE_PARAMS.with(|p| {
        if let Some(found) = p.borrow().get(source) {
            return found.clone();
        }
        let params = Arc::new(script_params(source));
        p.borrow_mut().insert(source.to_string(), params.clone());
        params
    })
}
