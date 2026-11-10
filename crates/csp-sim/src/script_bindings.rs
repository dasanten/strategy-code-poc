//! The game API bound for a running script (`apps/server/src/script-bindings.ts`, `CONTEXT.md`:
//! Script, Memory, Step budget; ADR 0002). [`crate::script_api`] lists the names and their step
//! costs; this gives them their meaning for one resident or army in one tick.
//!
//! Queries read only what the Player sees and has explored, and every value a script gets is
//! built from its script view (ADR 0011), so it holds exactly the view's fields
//! ([`view_value`]). Actions build the very order request the UI sends for `me` and check it with
//! the same order kind, so a script can request nothing an order couldn't; accepted requests are
//! collected for the caller to apply like UI orders.
//!
//! The data a query answers is built as plain JSON (`serde_json::Value`), as the TypeScript
//! builds plain objects, then turned into a script value through the query's view.

use std::cell::OnceCell;
use std::collections::HashSet;
use std::sync::Arc;

use csp_lang::interpreter::{CallError, Host, HostError};
use csp_lang::js::{json_string, number_to_string, trim};
use csp_lang::{plain_value, NativeFunction, NotPlain, Object, Value};
use csp_shared::balance::{
    DOING_MAX_LENGTH, HAUL_KEEP_FOOD, RECIPES, ROAD_LINE_MAX_TILES, SCRIPT_ACTION_VALUE_MAX,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::{is_passable_terrain, terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{
    AlarmScriptId, Building, BuildingKind, Good, OrderRequest, Remembered, Resident, ResidentOrder,
    SkillName, Stat, StatRecord, Struck, Waypoint, WorldState,
};
use indexmap::IndexMap;
use serde_json::{json, Map, Value as Json};

use crate::crimes::known_thieves;
use crate::directive::directives_for;
use crate::explored_edge::{compass, explored_edge, EdgeSearch};
use crate::order_sender::{realm_of, OrderSender};
use crate::orders::OrderKinds;
use crate::queries::building::{
    building_at, carriage_can_go_to, construction_at, input_to_fetch, line_tile, materials_needed,
    recipe_for, road_line, teacher_at, trainees_of, workplace_good,
};
use crate::queries::carriages::{passengers_of, stands_still};
use crate::queries::city_area::{city_ids_at, in_city_area};
use crate::queries::horses::HorseOwner;
use crate::queries::names::{good_name, good_of, kind_name};
use crate::queries::offers::{offers_at, seen_offer};
use crate::queries::residents::age_in_years;
use crate::queries::standing::organization_label;
use crate::queue::queue_view;
use crate::random::{hash_str, Mulberry32};
use crate::script_api::{binding, Is, ScriptBinding, ARMY_SCRIPT_API, SCRIPT_API};
use crate::script_deps::breeding_pair;
use crate::script_deps::last_seen_out_of_sight;
use crate::script_deps::occupation_ticks_left;
use crate::script_deps::{
    building_realm, crew_tile, debt_of, demands_for, free_stock, pile_at, units_that_fit,
};
use crate::script_params::{param_target, param_waypoint, ParamTarget, ParamWithValue};
use crate::script_views::{script_view, ScriptType};
use crate::sight::{Eyes, InvariantViolation, Spot};
use crate::walk_time::{walk_time, way_food};
use crate::waypoints::{add_waypoint_problem, remove_waypoint_problem, waypoints_of};
use crate::world_index::WorldIndex;
use csp_lang::ParamType;

/// Where `exploredEdge` leads for an NPC city, which has no explored terrain (`ScriptContext.edge`):
/// the next place its scout goes. Takes whether one can go onto a tile, and the tiles to skip.
pub type ScoutEdge<'a> = &'a dyn Fn(&dyn Fn(i32, i32) -> bool, &[(i32, i32)]) -> Option<(i32, i32)>;

/// What one run of a resident's or army's script may look at and act for (`ScriptContext`).
pub struct ScriptContext<'a> {
    pub world: &'a WorldState,
    pub terrain: &'a TerrainMap,
    pub index: &'a WorldIndex,
    /// The Player whose script it is, as an order's sender.
    pub sender: &'a OrderSender,
    /// The resident running the script; not used with `army_id`.
    pub resident_id: Option<&'a str>,
    /// The army running the script instead.
    pub army_id: Option<&'a str>,
    /// The script's memory for this resident or army, kept by the caller between ticks.
    pub memory: Object,
    /// Everything the Player sees (`entitiesInSight`); called at most once a run.
    pub seen: &'a dyn Fn() -> Arc<Vec<SeenEntity>>,
    /// The buildings and cities in `seen`, as it lists them (`placesInSight`): enough to show one
    /// building without working out everything else in sight (T89.6). Called at most once a run;
    /// without it a building is looked for in `seen`.
    pub places: Option<&'a dyn Fn() -> Arc<Vec<SeenEntity>>>,
    /// One building as `places` shows it, if it is in sight (`building_in_sight`): what
    /// `building(id)` needs, without the rest. Without it the building is looked for in `places`.
    pub place: Option<&'a dyn Fn(&Building) -> Option<SeenEntity>>,
    /// The side's eyes (`sightOf`); called at most once a run.
    pub eyes: &'a dyn Fn() -> Arc<Eyes>,
    /// Whether the Player has explored a tile.
    pub explored: &'a dyn Fn(i32, i32) -> bool,
    /// The order kinds actions go through.
    pub kinds: &'a OrderKinds,
    /// For an NPC city: where `exploredEdge` leads instead (`scoutEdge`).
    pub edge: Option<ScoutEdge<'a>>,
    /// The script's `param` lines with what is picked for each; `params` holds nothing without.
    pub params: Option<&'a [ParamWithValue]>,
}

/// The order kinds a resident's script can request (`SCRIPT_ORDER_KINDS`): one per action in
/// `SCRIPT_API`, but `doing`, `log`, `end` and `wait`, which ask for none.
pub fn script_order_kinds() -> Vec<&'static str> {
    SCRIPT_API
        .iter()
        .filter(|b| b.is == Is::Action && !["doing", "log", "end", "wait"].contains(&b.name))
        .map(|b| b.name)
        .collect()
}

/// The army order each action of an army's script asks for (`ARMY_SCRIPT_ORDERS`).
pub fn army_script_order(action: &str) -> Option<&'static str> {
    Some(match action {
        "walkTo" => "armyWalkTo",
        "guard" => "armyGuard",
        "attack" => "armyAttack",
        "follow" => "armyFollow",
        "stop" => "armyStop",
        "addWaypoint" => "addWaypoint",
        "removeWaypoint" => "removeWaypoint",
        _ => return None,
    })
}

/// The order kinds an army's script can request (`ARMY_SCRIPT_ORDER_KINDS`).
pub fn army_script_order_kinds() -> Vec<&'static str> {
    ARMY_SCRIPT_API
        .iter()
        .filter(|b| b.is == Is::Action)
        .filter_map(|b| army_script_order(b.name))
        .collect()
}

/// A terrain byte's name as scripts read it (`TERRAIN_NAMES`).
fn terrain_name(t: u8) -> Option<&'static str> {
    Some(match Terrain::from_byte(t)? {
        Terrain::Plains => "plains",
        Terrain::Forest => "forest",
        Terrain::Hills => "hills",
        Terrain::Mountain => "mountain",
        Terrain::Lake => "lake",
        Terrain::Sea => "sea",
        Terrain::Road => "road",
    })
}

fn script_error(message: impl Into<String>) -> CallError {
    CallError::Script(message.into())
}

fn host_error(message: impl Into<String>) -> CallError {
    CallError::Host(HostError(message.into()))
}

/// Plain data of any serialisable world thing, as the TypeScript's objects hold it.
fn to_json<T: serde::Serialize>(t: &T) -> Map<String, Json> {
    match serde_json::to_value(t) {
        Ok(Json::Object(m)) => m,
        _ => Map::new(),
    }
}

/// `{ ...a, ...b }`.
fn merge(mut a: Map<String, Json>, b: Option<Map<String, Json>>) -> Map<String, Json> {
    for (k, v) in b.into_iter().flatten() {
        a.insert(k, v);
    }
    a
}

/// A seen thing without its `is` tag (`untagged`).
fn untagged(e: &SeenEntity) -> Map<String, Json> {
    let mut m = to_json(e);
    m.shift_remove("is");
    m
}

fn seen_is(e: &SeenEntity) -> &'static str {
    match e {
        SeenEntity::Resident(_) => "resident",
        SeenEntity::Building(_) => "building",
        SeenEntity::City(_) => "city",
        SeenEntity::Horse(_) => "horse",
        SeenEntity::Carriage(_) => "carriage",
        SeenEntity::Pile(_) => "pile",
        SeenEntity::Army(_) => "army",
        SeenEntity::Caravan(_) => "caravan",
        SeenEntity::Trader(_) => "trader",
    }
}

/// `struckBy` and `struckAt` for who last struck a resident, or nothing once they are gone
/// (`struckView`).
fn struck_view(world: &WorldState, struck: &Struck) -> Option<Map<String, Json>> {
    world.residents.iter().any(|x| x.id == struck.by).then(|| {
        let mut m = Map::new();
        m.insert("struckBy".into(), Json::String(struck.by.clone()));
        m.insert("struckAt".into(), json!(struck.tick));
        m
    })
}

/// A resident (or anything) as its script view shows it (`asView`): its queue as `queueView`, who
/// last struck them, whether they are Down as `down`, the defence and Alarm scripts picked.
fn as_view(world: &WorldState, mut r: Map<String, Json>) -> Map<String, Json> {
    let down = r.get("downUntil").is_some_and(|v| !v.is_null())
        || r.get("down") == Some(&Json::Bool(true));
    r.insert("down".into(), Json::Bool(down));
    if let Some(q) = r.get("queue").filter(|v| !v.is_null()).cloned() {
        if let Ok(q) = serde_json::from_value(q) {
            r.insert("queue".into(), serde_json::to_value(queue_view(&q)).unwrap_or(Json::Null));
        }
    }
    if let Some(s) = r.get("struck").filter(|v| !v.is_null()).cloned() {
        if let Ok(s) = serde_json::from_value::<Struck>(s) {
            r = merge(r, struck_view(world, &s));
        }
    }
    if let Some(d) = r.get("defenceScriptId").filter(|v| !v.is_null()).cloned() {
        r.insert("defenceScript".into(), d);
    }
    if let Some(a) = r.get("alarmScriptId").filter(|v| !v.is_null()).cloned() {
        r.insert("alarmScript".into(), a);
    }
    r
}

/// A number as plain data turns it: `null` when it isn't finite, as `JSON.stringify` writes it.
fn number(n: f64) -> Value {
    if n.is_finite() {
        Value::Number(n)
    } else {
        Value::Null
    }
}

fn text(s: Option<&String>) -> Value {
    s.map_or(Value::Null, |s| Value::string(s))
}

/// A field of a world thing as a script value of its view type, through its plain data.
fn field_value<T: serde::Serialize>(t: &T, ty: ScriptType) -> Value {
    view_value(&serde_json::to_value(t).unwrap_or(Json::Null), ty)
}

/// A resident's order as its view (`residentOrder`), through its plain data less the path of a
/// moving order: the view has no `path`, and a walk's path can run to hundreds of tiles, each of
/// which would become a JSON object only to be dropped (T89.6).
fn order_value(order: Option<&ResidentOrder>, ty: ScriptType) -> Value {
    let Some(order) = order else { return Value::Null };
    let mut order = order.clone();
    if let Some((path, _)) = crate::walking::order_path_mut(&mut order) {
        *path = None;
    }
    field_value(&order, ty)
}

/// Numbers by name as a view of number fields, such as `goods` or `skills`: each field the
/// number `named` gives it, `null` for none.
fn numbers_view<K: Copy>(
    view: &'static str,
    entries: &IndexMap<K, f64>,
    name_of: fn(K) -> &'static str,
) -> Value {
    let fields = script_view(view).map_or(&[][..], |v| v.fields);
    Value::frozen_fields(fields.iter().map(|f| {
        let n = entries.iter().find(|(k, _)| name_of(**k) == f.name);
        (f.name, n.map_or(Value::Null, |(_, n)| number(*n)))
    }))
}

/// A resident's `stats` as their view: each stat's `base` and `trained`.
fn stats_view(stats: &StatRecord<Stat>) -> Value {
    let stat = |s: &Stat| {
        let fields = script_view("stat").map_or(&[][..], |v| v.fields);
        Value::frozen_fields(fields.iter().map(|f| {
            let n = match f.name {
                "base" => number(s.base),
                "trained" => number(s.trained),
                _ => Value::Null,
            };
            (f.name, n)
        }))
    };
    let fields = script_view("stats").map_or(&[][..], |v| v.fields);
    Value::frozen_fields(fields.iter().map(|f| {
        let v = match f.name {
            "strength" => stat(&stats.strength),
            "endurance" => stat(&stats.endurance),
            "agility" => stat(&stats.agility),
            "intellect" => stat(&stats.intellect),
            _ => Value::Null,
        };
        (f.name, v)
    }))
}

/// A skill's TypeScript name.
fn skill_name(s: SkillName) -> &'static str {
    match s {
        SkillName::Mining => "mining",
        SkillName::Woodcutting => "woodcutting",
        SkillName::Smelting => "smelting",
        SkillName::Smithing => "smithing",
        SkillName::Construction => "construction",
        SkillName::Farming => "farming",
        SkillName::Combat => "combat",
        SkillName::Driving => "driving",
    }
}

/// A resident as `me` or an army's member sees itself (`asView` of its plain data, less its
/// `script`, with its `age`), built field by field from the struct rather than through the whole
/// resident as JSON: the same value, for a fraction of the cost (#1092). Its defence and Alarm
/// scripts show to its own side only, and `alarm` (what an alarm told it) when `alarm` is set.
fn resident_view(world: &WorldState, r: &Resident, side: Option<&str>, alarm: bool) -> Value {
    let own = r.owner.as_deref() == side;
    let struck = r.struck.as_ref().filter(|s| world.residents.iter().any(|x| x.id == s.by));
    let down_until = r.down_until.map_or(Value::Null, number);
    let fields = script_view("resident").map_or(&[][..], |v| v.fields);
    Value::frozen_fields(fields.iter().map(|f| {
        let value = match f.name {
            "id" => Value::string(&r.id),
            "name" => Value::string(&r.name),
            "owner" => text(r.owner.as_ref()),
            "cityId" => text(r.city_id.as_ref()),
            "x" => number(r.x),
            "y" => number(r.y),
            "health" => number(r.health),
            "hunger" => number(r.hunger),
            "down" => Value::Bool(!down_until.is_null()),
            "downUntil" => down_until.clone(),
            "struckBy" => struck.map_or(Value::Null, |s| Value::string(&s.by)),
            "struckAt" => struck.map_or(Value::Null, |s| number(s.tick)),
            "defenceScript" => match r.defence_script_id.filter(|_| own) {
                Some(id) => Value::Number(id as f64),
                None => Value::Null,
            },
            "alarmScript" => match r.alarm_script_id.as_ref().filter(|_| own) {
                Some(AlarmScriptId::Script(id)) => Value::Number(*id as f64),
                Some(AlarmScriptId::Off(_)) => Value::string("none"),
                None => Value::Null,
            },
            "alarm" => match r.script.as_ref().and_then(|s| s.alarm.as_ref()).filter(|_| alarm) {
                Some(a) => field_value(a, f.r#type),
                None => Value::Null,
            },
            "bornAt" => number(r.born_at),
            "age" => number(age_in_years(r.born_at, world.tick as f64)),
            "lifespan" => number(r.lifespan),
            "stats" => stats_view(&r.stats),
            "skills" => numbers_view("skills", &r.skills, skill_name),
            "carried" => numbers_view("goods", &r.carried, good_name),
            "order" => order_value(r.order.as_ref(), f.r#type),
            "orderEnded" => field_value(&r.order_ended, f.r#type),
            "queue" => match &r.queue {
                Some(q) => field_value(&queue_view(q), f.r#type),
                None => Value::Null,
            },
            "pair" => field_value(&r.pair, f.r#type),
            "carrying" => field_value(&r.carrying, f.r#type),
            "riding" => text(r.riding.as_ref()),
            "aboard" => text(r.aboard.as_ref()),
            // `knownThief` is for others, and `script` is left out of `me`.
            _ => Value::Null,
        };
        (f.name, value)
    }))
}

/// A resident's plain data as `me` or an army's member shows it, before `asView`: without its
/// `script`, its defence and Alarm scripts for its own side only, what an alarm told it with
/// `alarm`, and its `age`. [`resident_view`] builds the same value without it.
fn resident_data(
    world: &WorldState,
    r: &Resident,
    side: Option<&str>,
    alarm: bool,
) -> Map<String, Json> {
    let mut m = to_json(r);
    m.shift_remove("script");
    if r.owner.as_deref() != side {
        m.shift_remove("defenceScriptId");
        m.shift_remove("alarmScriptId");
    }
    if let Some(AlarmScriptId::Off(_)) = &r.alarm_script_id {
        if r.owner.as_deref() == side {
            m.insert("alarmScriptId".into(), json!("none"));
        }
    }
    if alarm {
        if let Some(a) = r.script.as_ref().and_then(|s| s.alarm.as_ref()) {
            m.insert("alarm".into(), serde_json::to_value(a).unwrap_or(Json::Null));
        }
    }
    m.insert("age".into(), json!(age_in_years(r.born_at, world.tick as f64)));
    m
}

/// Who last struck any of `members` (`lastStruck`): the latest, if any was.
fn last_struck<'r>(members: impl Iterator<Item = &'r Resident>) -> Option<&'r Struck> {
    let mut last: Option<&Struck> = None;
    for m in members {
        if let Some(s) = &m.struck {
            if last.is_none_or(|l| s.tick > l.tick) {
                last = Some(s);
            }
        }
    }
    last
}

/// Plain world data as a script value of `type`, built from its script view (`viewValue`, ADR
/// 0011): an object holds exactly its view's fields, each `null` that the data doesn't hold. A
/// value of the wrong kind for its type is `null`. Frozen, so the script can't change it.
pub fn view_value(data: &Json, ty: ScriptType) -> Value {
    match (data, ty) {
        (Json::Null, _) => Value::Null,
        (_, ScriptType::Any) => Value::from_json(data).freeze(),
        (Json::Number(n), ScriptType::Number) => Value::Number(n.as_f64().unwrap_or(f64::NAN)),
        (Json::String(s), ScriptType::String) => Value::string(s),
        (Json::Bool(b), ScriptType::Boolean) => Value::Bool(*b),
        (Json::Array(items), ScriptType::List(of)) => {
            // Each item comes out frozen already.
            Value::frozen_list(items.iter().map(|d| view_value(d, *of)).collect())
        }
        (Json::Object(record), ScriptType::View(view)) => {
            let fields = script_view(view).map_or(&[][..], |v| v.fields);
            Value::frozen_fields(
                fields.iter().map(|f| {
                    (f.name, view_value(record.get(f.name).unwrap_or(&Json::Null), f.r#type))
                }),
            )
        }
        _ => Value::Null,
    }
}

/// A script value as plain data for an order request (`plain`), within `SCRIPT_ACTION_VALUE_MAX`
/// characters of JSON; `None` for null or nothing.
fn plain(value: Option<&Value>) -> Result<Option<Json>, CallError> {
    let Some(value) = value.filter(|v| !v.is_null()) else { return Ok(None) };
    match plain_value(value, SCRIPT_ACTION_VALUE_MAX as usize) {
        Ok(p) => Ok(Some(p.value)),
        Err(NotPlain::Function) => Err(script_error("A function can’t be passed to an action")),
        Err(NotPlain::Cycle) => {
            Err(script_error("A value that holds itself can’t be passed to an action"))
        }
        Err(NotPlain::Size) => Err(script_error(format!(
            "A value passed to an action can have at most {} characters",
            number_to_string(SCRIPT_ACTION_VALUE_MAX)
        ))),
    }
}

/// A place for `store` and `fetch` (`placeId`): its id, or the id of a thing a script holds.
fn place_id(value: &Value) -> Result<Option<Json>, CallError> {
    if let Value::Object(o) = value {
        if let Some(id) = o.borrow().get("id").cloned() {
            return plain(Some(&id));
        }
    }
    plain(Some(value))
}

fn whole(v: Option<&Value>) -> Option<i32> {
    v.and_then(Value::as_number).filter(|n| n.fract() == 0.0 && n.is_finite()).map(|n| n as i32)
}

/// Two whole numbers x and y (`tile`).
fn tile(x: Option<&Value>, y: Option<&Value>, name: &str) -> Result<(i32, i32), CallError> {
    match (whole(x), whole(y)) {
        (Some(x), Some(y)) => Ok((x, y)),
        _ => Err(script_error(format!("\"{name}\" needs a tile: two whole numbers x and y"))),
    }
}

fn field(value: Option<&Value>, key: &str) -> Option<Value> {
    match value {
        Some(Value::Object(o)) => o.borrow().get(key).cloned(),
        _ => None,
    }
}

/// Something with `x` and `y`, such as a resident or a building (`spot`).
fn spot(value: Option<&Value>, name: &str) -> Result<(i32, i32), CallError> {
    if !matches!(value, Some(Value::Object(_))) {
        return Err(script_error(format!("\"{name}\" needs things with x and y")));
    }
    tile(field(value, "x").as_ref(), field(value, "y").as_ref(), name)
}

/// A short text a script gives `call` (`shortText`): trimmed and cut to `DOING_MAX_LENGTH`
/// UTF-16 units; empty is null.
fn short_text(text: Option<&Value>, call: &str) -> Result<Option<String>, CallError> {
    match text {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let t = trim(s);
            let units: Vec<u16> = t.encode_utf16().take(DOING_MAX_LENGTH as usize).collect();
            let cut = String::from_utf16_lossy(&units);
            Ok((!cut.is_empty()).then_some(cut))
        }
        Some(_) => Err(script_error(format!("\"{call}\" needs a text or null"))),
    }
}

/// What `doing(text)` keeps as `memory.doing` (`doingText`).
pub fn doing_text(text: Option<&Value>) -> Result<Option<String>, CallError> {
    short_text(text, "doing")
}

/// The `random` value of a tick (`tickRandom`): drawn from the world's seed, the same for every
/// script.
pub fn tick_random(world: &WorldState) -> f64 {
    let seed = format!("{}:{}:random", world.seed, world.tick);
    Mulberry32::new(f64::from(hash_str(&seed))).next()
}

/// `JSON.stringify` of plain data, numbers written as JavaScript writes them.
fn js_stringify(v: &Json) -> String {
    match v {
        Json::Null => "null".into(),
        Json::Bool(b) => b.to_string(),
        Json::Number(n) => number_to_string(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => json_string(s),
        Json::Array(items) => {
            format!("[{}]", items.iter().map(js_stringify).collect::<Vec<_>>().join(","))
        }
        Json::Object(m) => format!(
            "{{{}}}",
            m.iter()
                .map(|(k, v)| format!("{}:{}", json_string(k), js_stringify(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

/// How many sets of param lines `params` keeps the defaults of.
const DEFAULT_PARAMS_KEPT: usize = 32;

thread_local! {
    /// `params` with no value picked, by its param lines.
    static DEFAULT_PARAMS: std::cell::RefCell<Vec<(Vec<ParamWithValue>, Value)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// The game API bound for one run (`ScriptBindings`): the globals the interpreter asks for, and
/// what the run asked for.
pub struct ScriptBindings<'a> {
    ctx: ScriptContext<'a>,
    side: Option<String>,
    resident: Option<usize>,
    api: &'static [ScriptBinding],
    for_me: (&'static str, String),
    random: f64,
    seen: OnceCell<Arc<Vec<SeenEntity>>>,
    places: OnceCell<Arc<Vec<SeenEntity>>>,
    eyes: OnceCell<Arc<Eyes>>,
    thieves: OnceCell<HashSet<String>>,
    /// The order requests the script's actions asked for and that were accepted, in order.
    pub requests: Vec<OrderRequest>,
    /// Whether the script called `end()`.
    pub ended: bool,
    /// The reason it gave `end(reason)`; `None` without one.
    pub end_reason: Option<String>,
    /// Whether the script called `wait()`.
    pub waited: bool,
    /// The lines it gave `log(text)`, in order.
    pub logged: Vec<String>,
}

/// Binds the game API for one run of a resident's script, or an army's with `army_id`
/// (`bindScript`). Fails for a resident or army that isn't there: a bug of the caller's.
pub fn bind_script(ctx: ScriptContext<'_>) -> Result<ScriptBindings<'_>, HostError> {
    let world = ctx.world;
    let side = match &ctx.sender.npc_city_id {
        Some(city) => Some(city.clone()),
        None => realm_of(world, ctx.sender.user_id).map(|r| r.id.clone()),
    };
    let (api, for_me, resident) = match (ctx.army_id, ctx.resident_id) {
        (Some(army_id), _) => {
            if !world.armies.iter().any(|a| a.id == army_id) {
                return Err(HostError(format!("no army {army_id} to run a script for")));
            }
            (ARMY_SCRIPT_API, ("armyId", army_id.to_string()), None)
        }
        (None, Some(id)) => {
            let i = world.residents.iter().position(|r| r.id == id);
            let Some(i) = i else {
                return Err(HostError(format!("no resident {id} to run a script for")));
            };
            (SCRIPT_API, ("residentId", id.to_string()), Some(i))
        }
        (None, None) => return Err(HostError("a script runs for a resident or an army".into())),
    };
    let random = tick_random(world);
    let b = ScriptBindings {
        ctx,
        side,
        resident,
        api,
        for_me,
        random,
        seen: OnceCell::new(),
        places: OnceCell::new(),
        eyes: OnceCell::new(),
        thieves: OnceCell::new(),
        requests: Vec::new(),
        ended: false,
        end_reason: None,
        waited: false,
        logged: Vec::new(),
    };
    Ok(b)
}

impl<'a> ScriptBindings<'a> {
    fn world(&self) -> &'a WorldState {
        self.ctx.world
    }

    fn size(&self) -> i32 {
        self.ctx.terrain.size
    }

    fn npc(&self) -> bool {
        self.ctx.sender.npc_city_id.is_some()
    }

    fn seen(&self) -> &Arc<Vec<SeenEntity>> {
        self.seen.get_or_init(|| (self.ctx.seen)())
    }

    /// What in sight a building or a city is looked for in: the places in sight, whose buildings
    /// and cities are `seen`'s in the same order, or `seen` itself.
    fn seen_places(&self) -> &Arc<Vec<SeenEntity>> {
        match self.ctx.places {
            Some(places) => self.places.get_or_init(places),
            None => self.seen(),
        }
    }

    /// Whether the side sees a tile (`inSight`).
    fn in_sight(&self, (x, y): (i32, i32)) -> bool {
        self.side.is_some()
            && self
                .eyes
                .get_or_init(|| (self.ctx.eyes)())
                .sees(Spot { x: f64::from(x), y: f64::from(y) })
    }

    /// Whether a resident is the side's own (`own`).
    fn own(&self, r: &Resident) -> bool {
        let Some(side) = &self.side else { return false };
        if self.npc() {
            r.owner.is_none() && r.city_id.as_ref() == Some(side)
        } else {
            r.owner.as_ref() == Some(side)
        }
    }

    /// A building of one of the side's own cities, or an outpost storage of its realm
    /// (`ownBuilding`).
    fn own_building(&self, b: &Building) -> bool {
        let Some(side) = &self.side else { return false };
        if self.npc() {
            b.city_id.as_ref() == Some(side)
        } else {
            building_realm(self.world(), b).as_ref() == Some(side)
        }
    }

    /// `{ script: { scriptId, memory } }` for one of the side's own residents running a script
    /// (`ownMemory`).
    fn own_memory(&self, id: &str) -> Option<Map<String, Json>> {
        let r = self.world().residents.iter().find(|r| r.id == id && self.own(r))?;
        let s = r.script.as_ref()?;
        let mut m = Map::new();
        m.insert("script".into(), json!({ "scriptId": s.script_id, "memory": s.memory }));
        Some(m)
    }

    fn resident_extras(&self, id: &str) -> Map<String, Json> {
        let thieves = self.thieves.get_or_init(|| match &self.side {
            Some(side) => known_thieves(self.world(), side),
            None => HashSet::new(),
        });
        let mut m = self.own_memory(id).unwrap_or_default();
        m.insert("knownThief".into(), Json::Bool(thieves.contains(id)));
        m
    }

    /// Who teaches what and who trains at a training ground (`teachingAt`).
    fn teaching_at(&self, id: &str) -> Option<Map<String, Json>> {
        let world = self.world();
        let ground = world
            .buildings
            .iter()
            .find(|b| b.id == id)
            .filter(|b| b.kind == BuildingKind::TrainingGround)?;
        let teacher = teacher_at(ground, &world.residents, self.size());
        let trainees: Vec<Json> = trainees_of(ground, &world.residents, self.size())
            .iter()
            .map(|r| json!(r.id))
            .collect();
        let mut m = Map::new();
        if let Some(t) = teacher {
            if let Some(ResidentOrder::Teach(o)) = &t.order {
                m.insert("teacher".into(), json!(t.id));
                m.insert("subject".into(), json!(o.subject));
            }
        }
        m.insert("trainees".into(), Json::Array(trainees));
        Some(m)
    }

    /// The realm's own Workplace settings for a building (`settingsAt`).
    fn settings_at(&self, id: &str) -> Option<Map<String, Json>> {
        let side = self.side.as_ref().filter(|_| !self.npc())?;
        let settings = self.world().workplace_settings.get(side)?.get(id)?;
        let mut m = Map::new();
        m.insert("workSettings".into(), serde_json::to_value(settings).ok()?);
        Some(m)
    }

    /// At a storage, its offers, and at one of the side's own the goods it can take (`offersOf`).
    fn offers_of(&self, b: &Building) -> Option<Map<String, Json>> {
        let world = self.world();
        if world.offers.is_empty() {
            return None;
        }
        let offers = offers_at(world, &b.id);
        if offers.is_empty() {
            return None;
        }
        let mut m = Map::new();
        m.insert(
            "offers".into(),
            Json::Array(
                offers
                    .into_iter()
                    .map(|o| serde_json::to_value(seen_offer(o)).unwrap_or(Json::Null))
                    .collect(),
            ),
        );
        if self.own_building(b) {
            m.insert(
                "stock".into(),
                serde_json::to_value(free_stock(world, b)).unwrap_or(Json::Null),
            );
        }
        Some(m)
    }

    fn building_extras(&self, id: &str) -> Map<String, Json> {
        let mut m = self.teaching_at(id).unwrap_or_default();
        m = merge(m, self.settings_at(id));
        if !self.world().offers.is_empty() {
            if let Some(b) = self.world().buildings.iter().find(|x| x.id == id) {
                m = merge(m, self.offers_of(b));
            }
        }
        m
    }

    /// A building as `building(id)` gives it (`asSeenBuilding`): one of the side's own as it is,
    /// another's as the Player sees it; `None` when they don't.
    fn as_seen_building(&self, b: &Building) -> Option<Json> {
        if self.own_building(b) {
            let m = merge(merge(to_json(b), self.settings_at(&b.id)), self.offers_of(b));
            return Some(Json::Object(m));
        }
        // What is in sight holds a building just when the eyes see its footprint (`places`):
        // one out of sight is nothing, without working out all that is in sight.
        self.side.as_ref()?;
        let eyes = self.eyes.get_or_init(|| (self.ctx.eyes)());
        if !eyes.building_seen(crate::queries::names::placed(b)) {
            return None;
        }
        let shown = match self.ctx.place {
            Some(place) => place(b)?,
            None => self
                .seen_places()
                .iter()
                .find(|e| matches!(e, SeenEntity::Building(sb) if sb.building.id == b.id))?
                .clone(),
        };
        Some(Json::Object(merge(untagged(&shown), Some(self.building_extras(&b.id)))))
    }

    /// One of the side's own buildings as `building(id)` gives it, built from the struct rather
    /// than through its plain data (#1092): the same value. `None` for one with offers, whose
    /// `stock` and `offers` come from them; that one goes through its plain data.
    fn own_building_view(&self, b: &Building) -> Option<Value> {
        if self.offers_of(b).is_some() {
            return None;
        }
        let settings = self
            .side
            .as_ref()
            .filter(|_| !self.npc())
            .and_then(|side| self.world().workplace_settings.get(side)?.get(&b.id));
        let fields = script_view("building").map_or(&[][..], |v| v.fields);
        Some(Value::frozen_fields(fields.iter().map(|f| {
            let value = match f.name {
                "id" => Value::string(&b.id),
                "kind" => Value::string(kind_name(b.kind)),
                "cityId" => text(b.city_id.as_ref()),
                "realmId" => text(b.realm_id.as_ref()),
                "x" => number(b.x),
                "y" => number(b.y),
                "stock" => {
                    b.stock.as_ref().map_or(Value::Null, |s| numbers_view("goods", s, good_name))
                }
                "site" => field_value(&b.site, f.r#type),
                "teardown" => b.teardown.map_or(Value::Null, number),
                "closed" => b.closed.map_or(Value::Null, Value::Bool),
                "damage" => b.damage.map_or(Value::Null, number),
                "workSettings" => settings.map_or(Value::Null, |s| field_value(s, f.r#type)),
                // A building's `prices` and `offers` come with its offers, `teacher`,
                // `subject` and `trainees` with another's.
                _ => Value::Null,
            };
            (f.name, value)
        })))
    }

    /// The queries answered straight as script values, without plain data in between (#1092):
    /// `building` of one of the side's own without offers, and `pileAt`. `None` for the rest.
    fn direct_query(&self, name: &str, args: &[Value]) -> Option<Result<Value, CallError>> {
        match name {
            "building" => {
                let Some(b) = self.building_by(args.first()) else { return Some(Ok(Value::Null)) };
                if !self.own_building(b) {
                    return None;
                }
                self.own_building_view(b).map(Ok)
            }
            "pileAt" => Some(tile(args.first(), args.get(1), "pileAt").map(|at| {
                if !self.in_sight(at) {
                    return Value::Null;
                }
                pile_at(self.world(), f64::from(at.0), f64::from(at.1), self.size())
                    .map_or(Value::Null, |p| numbers_view("goods", &p.goods, good_name))
            })),
            _ => None,
        }
    }

    /// The building as the Player remembers it (`lastSaw`); an NPC city has no memory.
    fn last_saw(&self, b: &Building) -> Option<Json> {
        if self.npc() {
            return None;
        }
        let memory = self.world().last_seen.get(&self.ctx.sender.user_id)?;
        let remembered =
            memory.iter().find(|e| matches!(e, Remembered::Building(rb) if rb.id == b.id))?;
        Some(Json::Object(merge(to_json(remembered), self.settings_at(&b.id))))
    }

    /// Who occupies a seen city's town hall and the ticks left (`occupationSeen`).
    fn occupation_seen(&self, id: &str) -> Map<String, Json> {
        let mut m = Map::new();
        let city = self.seen_places().iter().find_map(|e| match e {
            SeenEntity::City(c) if c.city.id == id => Some(c),
            _ => None,
        });
        let occupation = city.and_then(|c| {
            let o = c.city.occupation.as_ref()?;
            let world_city = self.world().cities.iter().find(|x| x.id == c.city.id)?;
            Some(json!({ "realmId": o.realm_id, "ticksLeft": occupation_ticks_left(self.world(), world_city) }))
        });
        m.insert("occupation".into(), occupation.unwrap_or(Json::Null));
        m
    }

    /// What is seen of one kind, with extras by id (`seenOf`).
    fn seen_of(&self, is: &str, add: impl Fn(&Self, &str) -> Option<Map<String, Json>>) -> Json {
        let items = self
            .seen()
            .iter()
            .filter(|e| seen_is(e) == is)
            .map(|e| {
                let rest = untagged(e);
                let id = rest.get("id").and_then(Json::as_str).unwrap_or_default().to_string();
                Json::Object(as_view(self.world(), merge(rest, add(self, &id))))
            })
            .collect();
        Json::Array(items)
    }

    /// A building by an id a query was given (`buildingById`).
    fn building_by(&self, v: Option<&Value>) -> Option<&'a Building> {
        let id = v.and_then(Value::as_str)?;
        // The first with the id, as `find` gives it, by the index.
        self.ctx.index.building_by_id(self.world(), id)
    }

    /// The `id` of a thing a query was given, as a building.
    fn building_of(&self, v: Option<&Value>) -> Option<&'a Building> {
        self.building_by(field(v, "id").as_ref())
    }

    fn me(&self) -> &'a Resident {
        &self.world().residents[self.resident.expect("a resident's query")]
    }

    /// The data a query answers, before its view (`queries[name]`).
    fn query(&self, name: &str, args: &[Value]) -> Result<Json, CallError> {
        let world = self.world();
        let size = self.size();
        let arg = |i: usize| args.get(i);
        let none = Json::Null;
        Ok(match name {
            "residents" => self.seen_of("resident", |s, id| Some(s.resident_extras(id))),
            "buildings" => self.seen_of("building", |s, id| Some(s.building_extras(id))),
            "cities" => self.seen_of("city", |s, id| Some(s.occupation_seen(id))),
            "horses" => self.seen_of("horse", |_, _| None),
            "carriages" => self.seen_of("carriage", |_, _| None),
            "traders" => self.seen_of("trader", |_, _| None),
            "piles" => self.seen_of("pile", |_, _| None),
            "nodes" => Json::Array(
                world
                    .nodes
                    .iter()
                    .filter(|n| (self.ctx.explored)(n.x as i32, n.y as i32))
                    .map(|n| serde_json::to_value(n).unwrap_or(Json::Null))
                    .collect(),
            ),
            "nodesInSight" => {
                let kind = arg(0).filter(|v| !v.is_null());
                let wanted = match kind {
                    None => None,
                    Some(Value::String(k))
                        if ["forest", "stone", "ironOre", "goldOre"].contains(&k.as_ref()) =>
                    {
                        Some(k.to_string())
                    }
                    Some(other) => {
                        return Err(script_error(format!(
                            "\"nodesInSight\" needs a node kind, not {}",
                            csp_lang::interpreter::describe(other)
                        )))
                    }
                };
                Json::Array(
                    world
                        .nodes
                        .iter()
                        .filter(|n| {
                            let k = serde_json::to_value(n.kind).ok();
                            wanted.as_ref().is_none_or(|w| {
                                k.as_ref().and_then(Json::as_str) == Some(w.as_str())
                            }) && self.in_sight((n.x as i32, n.y as i32))
                        })
                        .map(|n| serde_json::to_value(n).unwrap_or(Json::Null))
                        .collect(),
                )
            }
            "lastSeen" => {
                if self.npc() {
                    Json::Array(vec![])
                } else {
                    serde_json::to_value(last_seen_out_of_sight(
                        world,
                        self.ctx.index,
                        self.ctx.sender.user_id,
                    ))
                    .unwrap_or(Json::Null)
                }
            }
            "offers" => {
                if world.offers.is_empty() {
                    return Ok(Json::Array(vec![]));
                }
                let known: HashSet<&str> = self
                    .seen()
                    .iter()
                    .filter_map(|e| match e {
                        SeenEntity::Building(b) => Some(b.building.id.as_str()),
                        _ => None,
                    })
                    .collect();
                let side = self.side.as_deref();
                Json::Array(
                    world
                        .offers
                        .iter()
                        .filter(|o| {
                            side.is_some() && Some(o.realm_id.as_str()) == side
                                || o.direct.as_ref().is_some_and(|d| Some(d.to_id.as_str()) == side)
                                || (known.contains(o.storage_id.as_str())
                                    && !o.direct.as_ref().is_some_and(|d| d.carried.is_some()))
                        })
                        .map(|o| serde_json::to_value(seen_offer(o)).unwrap_or(Json::Null))
                        .collect(),
                )
            }
            "directives" => {
                serde_json::to_value(directives_for(world, |org| organization_label(world, org)))
                    .unwrap_or(none)
            }
            "withMemory" => {
                let Some(Value::String(key)) = arg(0) else {
                    return Err(script_error("\"withMemory\" needs a key"));
                };
                let wanted = js_stringify(&plain(arg(1))?.unwrap_or(Json::Null));
                Json::Array(
                    world
                        .residents
                        .iter()
                        .filter(|r| {
                            self.own(r)
                                && r.script.as_ref().is_some_and(|s| {
                                    js_stringify(s.memory.get(key.as_ref()).unwrap_or(&Json::Null))
                                        == wanted
                                })
                        })
                        .map(|r| {
                            let mut m = to_json(r);
                            let s = r.script.as_ref().expect("filtered");
                            m.insert(
                                "script".into(),
                                json!({ "scriptId": s.script_id, "memory": s.memory }),
                            );
                            Json::Object(as_view(world, m))
                        })
                        .collect(),
                )
            }
            "building" => {
                self.building_by(arg(0)).and_then(|b| self.as_seen_building(b)).unwrap_or(none)
            }
            "buildingAt" => {
                let at = tile(arg(0), arg(1), "buildingAt")?;
                match building_at(world, at.0, at.1, size) {
                    Some(b) if self.own_building(b) || self.in_sight(at) => {
                        self.as_seen_building(b).unwrap_or(none)
                    }
                    _ => none,
                }
            }
            "inCityArea" => {
                let at = tile(arg(1), arg(2), "inCityArea")?;
                let city = arg(0)
                    .and_then(Value::as_str)
                    .and_then(|id| world.cities.iter().find(|c| c.id == id));
                let Some(city) = city else { return Ok(Json::Bool(false)) };
                let ours = self.side.is_some()
                    && (if self.npc() { Some(&city.id) } else { city.realm_id.as_ref() })
                        == self.side.as_ref();
                Json::Bool(
                    (ours || self.in_sight(at))
                        && in_city_area(world, &city.id, f64::from(at.0), f64::from(at.1), size),
                )
            }
            "cityAreaAt" => {
                let at = tile(arg(0), arg(1), "cityAreaAt")?;
                let here = city_ids_at(world, f64::from(at.0), f64::from(at.1), size);
                let ours = here.iter().find(|id| {
                    world.cities.iter().find(|c| &&c.id == id).is_some_and(|city| {
                        self.side.is_some()
                            && (if self.npc() { Some(&city.id) } else { city.realm_id.as_ref() })
                                == self.side.as_ref()
                    })
                });
                match (ours, here.first()) {
                    (Some(id), _) => json!(id),
                    (None, Some(id)) if self.in_sight(at) => json!(id),
                    _ => none,
                }
            }
            "outsidersIn" => {
                let city = arg(0)
                    .and_then(Value::as_str)
                    .and_then(|id| world.cities.iter().find(|c| c.id == id));
                let Some(ids) = city.and_then(|c| c.outsiders.as_ref()) else {
                    return Ok(Json::Array(vec![]));
                };
                let ids: HashSet<&String> = ids.iter().collect();
                Json::Array(
                    self.seen()
                        .iter()
                        .filter(|e| matches!(e, SeenEntity::Resident(r) if ids.contains(&r.id)))
                        .map(|e| {
                            let rest = untagged(e);
                            let id = rest
                                .get("id")
                                .and_then(Json::as_str)
                                .unwrap_or_default()
                                .to_string();
                            Json::Object(as_view(world, merge(rest, self.own_memory(&id))))
                        })
                        .collect(),
                )
            }
            "pileAt" => {
                let at = tile(arg(0), arg(1), "pileAt")?;
                if !self.in_sight(at) {
                    return Ok(none);
                }
                pile_at(world, f64::from(at.0), f64::from(at.1), size)
                    .map_or(none, |p| serde_json::to_value(&p.goods).unwrap_or(Json::Null))
            }
            "outputOf" => {
                let Some(b) = self.building_of(arg(0)) else { return Ok(Json::Array(vec![])) };
                if !(self.own_building(b)
                    || self.in_sight((b.x as i32, b.y as i32))
                    || self.last_saw(b).is_some())
                {
                    return Ok(Json::Array(vec![]));
                }
                let goods: Vec<Json> = match RECIPES.get(kind_name(b.kind)) {
                    Some(recipes) => {
                        let mut out: Vec<&str> = Vec::new();
                        for r in recipes {
                            for (g, _) in r.output.0 {
                                if !out.contains(g) {
                                    out.push(g);
                                }
                            }
                        }
                        out.into_iter().map(|g| json!(g)).collect()
                    }
                    None => workplace_good(world, b, None)
                        .into_iter()
                        .map(|g| json!(good_name(g)))
                        .collect(),
                };
                Json::Array(goods)
            }
            "materialsNeeded" => {
                let Some(b) = self.building_of(arg(0)).filter(|b| b.site.is_some()) else {
                    return Ok(Json::Array(vec![]));
                };
                if !(self.own_building(b) || self.in_sight((b.x as i32, b.y as i32))) {
                    return Ok(Json::Array(vec![]));
                }
                Json::Array(
                    materials_needed(b)
                        .iter()
                        .map(|(g, u)| json!({ "good": good_name(*g), "units": u }))
                        .collect(),
                )
            }
            "terrainAt" => {
                let at = tile(arg(0), arg(1), "terrainAt")?;
                if !(self.ctx.explored)(at.0, at.1) {
                    return Ok(none);
                }
                terrain_name(terrain_at(self.ctx.terrain, at.0, at.1)).map_or(none, |n| json!(n))
            }
            "distance" => {
                json!(wrap_distance(size, spot(arg(0), "distance")?, spot(arg(1), "distance")?))
            }
            "lineTiles" => self.line_tiles(arg(0), arg(1))?,
            "demands" => {
                if self.side.is_none() || self.npc() {
                    Json::Array(vec![])
                } else {
                    Json::Array(demands_for(world, self.side.as_deref().expect("checked")))
                }
            }
            "waypoints" => {
                if self.npc() {
                    Json::Array(vec![])
                } else {
                    serde_json::to_value(waypoints_of(world, self.ctx.sender.user_id))
                        .unwrap_or(none)
                }
            }
            _ if self.resident.is_some() => self.resident_query(name, args)?,
            _ => return Err(host_error(format!("the script binding {name} is not implemented"))),
        })
    }

    /// `lineTiles(line, from)`: the line's tiles still to build, nearest `from` first.
    fn line_tiles(&self, line: Option<&Value>, from: Option<&Value>) -> Result<Json, CallError> {
        let world = self.world();
        let size = self.size();
        let building = match field(line, "building").as_ref().and_then(Value::as_str) {
            Some("road") => BuildingKind::Road,
            Some("wall") => BuildingKind::Wall,
            _ => {
                return Err(script_error(
                    "\"lineTiles\" needs a line: {building: \"road\" or \"wall\", from, to}",
                ))
            }
        };
        let start = spot(field(line, "from").as_ref(), "lineTiles")?;
        let to = spot(field(line, "to").as_ref(), "lineTiles")?;
        let tiles = road_line(start, to, size);
        if tiles.len() as f64 > ROAD_LINE_MAX_TILES {
            return Err(script_error(format!(
                "\"lineTiles\" covers at most {} tiles",
                number_to_string(ROAD_LINE_MAX_TILES)
            )));
        }
        let mut out: Vec<(i32, i32, Option<String>)> = Vec::new();
        for (x, y) in tiles {
            if self.in_sight((x, y)) {
                if let Some(t) = line_tile(world, building, x, y, Some(self.ctx.terrain)) {
                    out.push((t.x, t.y, t.site_id));
                }
                continue;
            }
            let site = construction_at(world, x, y, building);
            let own_site =
                site.filter(|s| s.site.is_some() && s.kind == building && self.own_building(s));
            out.push((x, y, own_site.map(|s| s.id.clone())));
        }
        if from.is_some_and(|f| !f.is_null()) {
            let near = spot(from, "lineTiles")?;
            out.sort_by(|a, b| {
                wrap_distance(size, near, (a.0, a.1)).total_cmp(&wrap_distance(
                    size,
                    near,
                    (b.0, b.1),
                ))
            });
        }
        Ok(Json::Array(
            out.into_iter().map(|(x, y, s)| json!({ "x": x, "y": y, "siteId": s })).collect(),
        ))
    }

    /// The queries only a resident's script has.
    fn resident_query(&self, name: &str, args: &[Value]) -> Result<Json, CallError> {
        let world = self.world();
        let size = self.size();
        let r = self.me();
        let arg = |i: usize| args.get(i);
        let time = |a: (i32, i32), b: (i32, i32)| {
            walk_time(world, self.ctx.terrain, self.ctx.explored, r, a, b)
        };
        Ok(match name {
            "fits" => {
                let good = arg(0).and_then(Value::as_str).and_then(good_of);
                let Some(good) = good else {
                    return Err(script_error(format!(
                        "\"fits\" needs a good, not {}",
                        arg(0).map_or("undefined".to_string(), csp_lang::interpreter::describe)
                    )));
                };
                json!(units_that_fit(r, good, world.tick as f64))
            }
            "inputToFetch" => {
                let Some(b) = self.building_of(arg(0)).filter(|b| b.site.is_none()) else {
                    return Ok(Json::Array(vec![]));
                };
                if !(self.own_building(b) || self.in_sight((b.x as i32, b.y as i32))) {
                    return Ok(Json::Array(vec![]));
                }
                let makes = arg(1).and_then(Value::as_str);
                let Some(recipe) = recipe_for(b.kind, makes) else {
                    return Ok(Json::Array(vec![]));
                };
                let load = input_to_fetch(world, b, recipe, r);
                Json::Array(
                    load.iter()
                        .map(|(g, u)| json!({ "good": good_name(*g), "units": u }))
                        .collect(),
                )
            }
            "breedingPair" => {
                let Some(b) = self.building_of(arg(0)).filter(|b| b.kind == BuildingKind::Stable)
                else {
                    return Ok(Json::Null);
                };
                let Some(side) = &self.side else { return Ok(Json::Null) };
                if !(self.own_building(b) || self.in_sight((b.x as i32, b.y as i32))) {
                    return Ok(Json::Null);
                }
                let owner =
                    if self.npc() { HorseOwner::City(side) } else { HorseOwner::Realm(side) };
                breeding_pair(world, b, owner, Some(&r.id))
                    .map_or(Json::Null, |[a, b]| json!([a.id, b.id]))
            }
            "walkTime" => json!(time(spot(arg(0), "walkTime")?, spot(arg(1), "walkTime")?)),
            "wayFood" => json!(way_food(
                world,
                self.ctx.terrain,
                self.ctx.explored,
                r,
                spot(arg(0), "wayFood")?,
                spot(arg(1), "wayFood")?
            )),
            "exploredEdge" => {
                let toward = arg(1).filter(|v| !v.is_null());
                let toward = match toward {
                    None => None,
                    Some(Value::String(t)) if compass(t).is_some() => Some(t.to_string()),
                    Some(other) => {
                        return Err(script_error(format!(
                            "\"exploredEdge\" needs a compass direction, not {}",
                            csp_lang::interpreter::describe(other)
                        )))
                    }
                };
                let skips: Vec<(i32, i32)> = match arg(2).filter(|v| !v.is_null()) {
                    None => Vec::new(),
                    Some(Value::List(l)) => {
                        let items = l.borrow().items.clone();
                        items
                            .iter()
                            .map(|s| spot(Some(s), "exploredEdge"))
                            .collect::<Result<_, _>>()?
                    }
                    Some(_) => return Err(script_error("\"exploredEdge\" skips a list")),
                };
                let terrain = self.ctx.terrain;
                let riding = r.riding.is_some();
                let can_enter = move |x: i32, y: i32| {
                    if riding {
                        carriage_can_go_to(world, terrain, x, y)
                    } else {
                        is_passable_terrain(terrain_at(terrain, x, y))
                    }
                };
                let edge = match self.ctx.edge {
                    Some(edge) => edge(&can_enter, &skips),
                    None => explored_edge(&EdgeSearch {
                        size,
                        explored: self.ctx.explored,
                        can_enter: &can_enter,
                        from: spot(arg(0), "exploredEdge")?,
                        toward: toward.as_deref(),
                        skip: &skips,
                    }),
                };
                edge.map_or(Json::Null, |(x, y)| json!({ "x": x, "y": y }))
            }
            "crewTile" => {
                let Some(b) = self.building_of(arg(0)) else { return Ok(Json::Null) };
                if !(self.own_building(b) || self.in_sight((b.x as i32, b.y as i32))) {
                    return Ok(Json::Null);
                }
                let (x, y) = crew_tile(world, b, r, &|x| self.own(x), size);
                json!({ "x": x, "y": y })
            }
            "storages" => {
                let wanted = plain(arg(1))?;
                let wanted: Option<Vec<Good>> =
                    match wanted {
                        None => None,
                        Some(Json::Array(goods)) => {
                            let parsed: Option<Vec<Good>> =
                                goods.iter().map(|g| g.as_str().and_then(good_of)).collect();
                            Some(parsed.ok_or_else(|| {
                                script_error("\"storages\" needs a list of goods")
                            })?)
                        }
                        Some(_) => return Err(script_error("\"storages\" needs a list of goods")),
                    };
                let holds = |b: &Building| {
                    let free = free_stock(world, b);
                    wanted
                        .as_ref()
                        .is_none_or(|w| w.iter().any(|g| free.get(g).copied().unwrap_or(0.0) > 0.0))
                };
                // A Trade Org city's warehouses hold its goods (`CONTEXT.md`: Warehouse).
                let kinds: &[BuildingKind] = if wanted.is_some() && self.npc() {
                    &[BuildingKind::Storage, BuildingKind::Warehouse]
                } else {
                    &[BuildingKind::Storage]
                };
                let mut storages: Vec<&Building> = world
                    .buildings
                    .iter()
                    .filter(|b| {
                        kinds.contains(&b.kind)
                            && b.site.is_none()
                            && self.own_building(b)
                            && holds(b)
                    })
                    .collect();
                if arg(0).is_some_and(|v| !v.is_null()) {
                    let at = spot(arg(0), "storages")?;
                    let by: Vec<f64> =
                        storages.iter().map(|b| time(at, (b.x as i32, b.y as i32))).collect();
                    let mut order: Vec<usize> = (0..storages.len()).collect();
                    order.sort_by(|&a, &b| by[a].total_cmp(&by[b]));
                    storages = order.into_iter().map(|i| storages[i]).collect();
                }
                Json::Array(
                    storages
                        .into_iter()
                        .map(|b| Json::Object(merge(to_json(b), self.offers_of(b))))
                        .collect(),
                )
            }
            _ => return Err(host_error(format!("the script binding {name} is not implemented"))),
        })
    }

    /// Asks for an order for `me`, checked exactly as one from the UI (`request`).
    fn request(
        &mut self,
        kind: &str,
        input: Vec<(&str, Option<Json>)>,
    ) -> Result<Value, CallError> {
        let mut fields = Map::new();
        fields.insert(self.for_me.0.to_string(), Json::String(self.for_me.1.clone()));
        for (k, v) in input {
            if let Some(v) = v {
                fields.insert(k.to_string(), v);
            }
        }
        let order = OrderRequest { kind: kind.to_string(), fields };
        let Some(order_kind) = self.ctx.kinds.get(kind) else {
            return Err(host_error(format!("no order kind {kind} for the script action")));
        };
        if let Some(reason) =
            order_kind.validate(self.world(), self.ctx.sender, &order, Some(self.ctx.terrain))
        {
            return Ok(Value::string(&reason));
        }
        self.requests.push(order);
        Ok(Value::Null)
    }

    /// The actions (`actions[name]`).
    fn action(&mut self, name: &str, args: &[Value]) -> Result<Value, CallError> {
        let a = |i: usize| args.get(i);
        let p = |i: usize| plain(args.get(i));
        let or_null = |i: usize| plain(Some(args.get(i).unwrap_or(&Value::Null)));
        let place = |i: usize| match args.get(i).filter(|v| !v.is_null()) {
            None => Ok(Some(Json::Null)),
            Some(v) => place_id(v),
        };
        if self.ctx.army_id.is_some() {
            return match name {
                "walkTo" | "guard" => {
                    let kind = army_script_order(name).expect("an army action");
                    self.request(kind, vec![("x", p(0)?), ("y", p(1)?)])
                }
                "attack" | "follow" => {
                    let kind = army_script_order(name).expect("an army action");
                    self.request(kind, vec![("targetId", p(0)?)])
                }
                "stop" => self.request("armyStop", vec![]),
                "addWaypoint" | "removeWaypoint" => self.waypoint_action(name, args),
                _ => Err(host_error(format!("the script binding {name} is not implemented"))),
            };
        }
        let r = self.me();
        let here = || {
            building_at(self.world(), r.x as i32, r.y as i32, self.size())
                .map(|b| json!(b.id))
                .or(Some(Json::Null))
        };
        match name {
            "walkTo" => self.request("walkTo", vec![("x", p(0)?), ("y", p(1)?)]),
            "drive" => {
                let mut input = vec![("carriageId", p(0)?), ("x", p(1)?), ("y", p(2)?)];
                if a(3).is_some() {
                    input.push(("horseId", p(3)?));
                }
                self.request("drive", input)
            }
            "haul" => {
                let returns =
                    plain(Some(a(4).filter(|v| !v.is_null()).unwrap_or(&Value::list(vec![]))))?;
                let keep = plain(Some(
                    a(5).filter(|v| !v.is_null()).unwrap_or(&Value::Number(HAUL_KEEP_FOOD)),
                ))?;
                self.request(
                    "haul",
                    vec![
                        ("carriageId", p(0)?),
                        ("x", p(1)?),
                        ("y", p(2)?),
                        ("goods", p(3)?),
                        ("returnGoods", returns),
                        ("keepFood", keep),
                    ],
                )
            }
            "mount" => self.request("mount", vec![("horseId", p(0)?)]),
            "dismount" => self.request("dismount", vec![]),
            "unhitch" => self.request("unhitch", vec![("carriageId", place(0)?)]),
            "hitch" => {
                self.request("hitch", vec![("carriageId", place(0)?), ("horseId", place(1)?)])
            }
            "board" => self.request("board", vec![("carriageId", p(0)?)]),
            "getOff" => {
                let given = a(0).filter(|v| !v.is_null()).or(a(1).filter(|v| !v.is_null()));
                let input = if given.is_none() { vec![] } else { vec![("x", p(0)?), ("y", p(1)?)] };
                self.request("getOff", input)
            }
            "stop" => self.request("stop", vec![]),
            "pickUp" | "drop" => self.request(name, vec![("spot", p(0)?), ("goods", p(1)?)]),
            "store" => {
                let mut input = vec![("goods", p(0)?)];
                if let Some(to) = a(1).filter(|v| !v.is_null()) {
                    input.push(("to", place_id(to)?));
                }
                if a(2).is_some_and(|v| !v.is_null()) {
                    input.push(("ownFood", p(2)?));
                }
                self.request("store", input)
            }
            "fetch" => {
                let mut input = vec![("goods", p(0)?)];
                if let Some(from) = a(1).filter(|v| !v.is_null()) {
                    input.push(("from", place_id(from)?));
                }
                self.request("fetch", input)
            }
            "build" => self.request("build", vec![("building", p(0)?)]),
            "tearDown" => self.request("tearDown", vec![("buildingId", p(0)?)]),
            "workAt" => {
                let input = if a(0).is_some_and(|v| !v.is_null()) {
                    vec![("makes", p(0)?)]
                } else {
                    vec![]
                };
                self.request("workAt", input)
            }
            "teach" => self.request("teach", vec![("buildingId", here()), ("subject", p(0)?)]),
            "train" => self.request("train", vec![("buildingId", here())]),
            "breed" => self.request("breed", vec![("stableId", p(0)?), ("horseIds", p(1)?)]),
            "pair" => self.request("pair", vec![("partnerId", p(0)?)]),
            "attack" => self.request("attack", vec![("targetId", p(0)?)]),
            "feed" => self.request("feed", vec![("targetId", p(0)?), ("units", p(1)?)]),
            "climb" => self.request("climb", vec![("wallId", p(0)?)]),
            "pay" => self.request("pay", vec![("contractId", p(0)?), ("weeks", p(1)?)]),
            "buyCity" => self.request("buyCity", vec![("cityId", p(0)?)]),
            "buy" | "sell" => {
                let mut input =
                    vec![("good", p(0)?), ("units", p(1)?), ("carriageId", or_null(2)?)];
                if a(3).is_some_and(|v| !v.is_null()) {
                    input.push(("cityId", p(3)?));
                }
                self.request(name, input)
            }
            "swap" => self.request(
                "swap",
                vec![
                    ("give", p(0)?),
                    ("want", p(1)?),
                    ("units", p(2)?),
                    ("carriageId", or_null(3)?),
                ],
            ),
            "buyHorse" | "sellHorse" => self.request(name, vec![("horseId", place(0)?)]),
            "handIn" => self.request(
                "handIn",
                vec![
                    ("good", p(0)?),
                    ("units", p(1)?),
                    ("toCityId", p(2)?),
                    ("carriageId", or_null(3)?),
                ],
            ),
            "buyOff" => {
                self.request("buyOff", vec![("directiveId", p(0)?), ("carriageId", or_null(1)?)])
            }
            "payDebt" => {
                self.request("payDebt", vec![("coins", p(0)?), ("carriageId", or_null(1)?)])
            }
            "postOffer" => self.request(
                "postOffer",
                vec![
                    ("storageId", p(0)?),
                    ("gives", p(1)?),
                    ("givesUnits", p(2)?),
                    ("wants", p(3)?),
                    ("wantsUnits", p(4)?),
                    ("times", p(5)?),
                ],
            ),
            "takeDownOffer" | "acceptCarriedOffer" | "declineOffer" => {
                self.request(name, vec![("offerId", p(0)?)])
            }
            "acceptOffer" => self.request(
                "acceptOffer",
                vec![("offerId", p(0)?), ("times", p(1)?), ("carriageId", or_null(2)?)],
            ),
            "sendDirectOffer" => self.request(
                "sendDirectOffer",
                vec![
                    ("toId", p(0)?),
                    ("storageId", p(1)?),
                    ("gives", p(2)?),
                    ("givesUnits", p(3)?),
                    ("wants", p(4)?),
                    ("wantsUnits", p(5)?),
                    ("times", p(6)?),
                ],
            ),
            "sendCarriedOffer" => self.request(
                "sendCarriedOffer",
                vec![
                    ("toId", p(0)?),
                    ("fromCityId", p(1)?),
                    ("toCityId", p(2)?),
                    ("gives", p(3)?),
                    ("givesUnits", p(4)?),
                    ("wants", p(5)?),
                    ("wantsUnits", p(6)?),
                    ("times", p(7)?),
                    ("feeBy", p(8)?),
                ],
            ),
            "handOver" => self.request("handOver", vec![("newLeaderId", p(0)?)]),
            "rename" => {
                let mut input = vec![("targetId", p(0)?), ("name", p(1)?)];
                if a(2).is_some_and(|v| !v.is_null()) {
                    input.push(("realmName", p(2)?));
                }
                self.request("rename", input)
            }
            "renameCity" => self.request("renameCity", vec![("cityId", p(0)?), ("name", p(1)?)]),
            "relocate" => self.request("relocate", vec![("cityId", p(0)?)]),
            "renameHorse" => self.request("renameHorse", vec![("horseId", p(0)?), ("name", p(1)?)]),
            "claimHorses" => self.request("claimHorses", vec![]),
            "sendDemand" => self.request(
                "sendDemand",
                vec![("realmId", p(0)?), ("terms", p(1)?), ("note", p(2)?), ("days", p(3)?)],
            ),
            "acceptDemand" => {
                self.request("acceptDemand", vec![("demandId", p(0)?), ("handOver", p(1)?)])
            }
            "declineDemand" => self.request("declineDemand", vec![("demandId", p(0)?)]),
            "roadLine" | "wallLine" => {
                let from = json!({ "x": r.x, "y": r.y });
                let mut to = Map::new();
                if let Some(x) = p(0)? {
                    to.insert("x".into(), x);
                }
                if let Some(y) = p(1)? {
                    to.insert("y".into(), y);
                }
                self.request(name, vec![("from", Some(from)), ("to", Some(Json::Object(to)))])
            }
            "doing" => {
                let doing = doing_text(a(0))?;
                let mut memory = self.ctx.memory.borrow_mut();
                match doing {
                    None => {
                        memory.remove("doing");
                    }
                    Some(text) => memory.insert("doing", Value::string(&text)),
                }
                Ok(Value::Null)
            }
            "end" => {
                self.end_reason = short_text(a(0), "end")?;
                self.ended = true;
                Ok(Value::Null)
            }
            "wait" => {
                self.waited = true;
                Ok(Value::Null)
            }
            "log" => {
                if let Some(line) = short_text(a(0), "log")? {
                    self.logged.push(line);
                }
                Ok(Value::Null)
            }
            "addWaypoint" | "removeWaypoint" => self.waypoint_action(name, args),
            _ => Err(host_error(format!("the script binding {name} is not implemented"))),
        }
    }

    /// The Player's waypoints' actions, for residents' and armies' scripts alike. Requests are
    /// applied only after the run, so the cap counts the waypoints the run added, and one it
    /// removed can't be removed again.
    fn waypoint_action(&mut self, name: &str, args: &[Value]) -> Result<Value, CallError> {
        let world = self.world();
        let user = self.ctx.sender.user_id;
        if name == "addWaypoint" {
            let (x, y, n) = (plain(args.first())?, plain(args.get(1))?, plain(args.get(2))?);
            let added = self.requests.iter().filter(|r| r.kind == "addWaypoint").count();
            let mut held: Vec<Waypoint> = waypoints_of(world, user).to_vec();
            held.extend((0..added).map(|_| Waypoint {
                id: String::new(),
                name: String::new(),
                x: 0.0,
                y: 0.0,
            }));
            if let Some(problem) =
                add_waypoint_problem(&held, x.as_ref(), y.as_ref(), n.as_ref(), self.size())
            {
                return Ok(Value::string(&problem));
            }
            return self.request("addWaypoint", vec![("x", x), ("y", y), ("name", n)]);
        }
        let id = match args.first().filter(|v| !v.is_null()) {
            None => Some(Json::Null),
            Some(v) => place_id(v)?,
        };
        let removed: HashSet<String> = self
            .requests
            .iter()
            .filter(|r| r.kind == "removeWaypoint")
            .filter_map(|r| r.fields.get("waypointId").and_then(Json::as_str).map(str::to_string))
            .collect();
        let held: Vec<Waypoint> = waypoints_of(world, user)
            .iter()
            .filter(|w| !removed.contains(&w.id))
            .cloned()
            .collect();
        if let Some(problem) = remove_waypoint_problem(&held, id.as_ref()) {
            return Ok(Value::string(&problem));
        }
        self.request("removeWaypoint", vec![("waypointId", id)])
    }

    /// A building a param names (`paramBuilding`): one of the side's own as it is; another's as
    /// the Player sees it, else as they last saw it.
    fn param_building(&self, b: &Building) -> Option<Json> {
        self.as_seen_building(b).or_else(|| self.last_saw(b))
    }

    /// Each param as what it names (`params`), the number typed, the word picked or its default.
    /// With no value picked, as for every NPC script, that is the defaults alone: made once for
    /// the same param lines and shared, frozen, by the runs after (#1092).
    fn params_value(&self) -> Value {
        let params = self.ctx.params.unwrap_or_default();
        if !params.iter().all(|p| p.value.is_none()) {
            return self.params_value_of(params);
        }
        DEFAULT_PARAMS.with(|cache| {
            let mut cache = cache.borrow_mut();
            if let Some((_, v)) = cache.iter().find(|(ps, _)| ps.as_slice() == params) {
                return v.clone();
            }
            let v = self.params_value_of(params);
            if cache.len() >= DEFAULT_PARAMS_KEPT {
                cache.remove(0);
            }
            cache.push((params.to_vec(), v.clone()));
            v
        })
    }

    fn params_value_of(&self, params: &[ParamWithValue]) -> Value {
        let world = self.world();
        let side = self.side.as_deref();
        let mut entries: Vec<(String, Value)> = Vec::new();
        for p in params {
            let decl = &p.param.param;
            let default = || match &decl.default {
                Some(csp_lang::ParamDefault::Number(n)) => Value::Number(*n),
                Some(csp_lang::ParamDefault::Word(w)) => Value::string(w),
                None => Value::Null,
            };
            let picked_id = match &p.value {
                Some(csp_shared::world::ScriptParamValue::Id(id)) => Some(id.as_str()),
                _ => None,
            };
            let value = match decl.ty {
                ParamType::Number => match &p.value {
                    Some(csp_shared::world::ScriptParamValue::Number(n)) => Value::Number(*n),
                    _ => default(),
                },
                ParamType::Choice => {
                    let word = picked_id.filter(|w| {
                        decl.choices.as_ref().is_some_and(|c| c.iter().any(|x| x == w))
                    });
                    word.map_or_else(default, Value::string)
                }
                ParamType::Waypoint => {
                    let w = picked_id.and_then(|id| param_waypoint(world, side, id));
                    view_value(
                        &w.map_or(Json::Null, |w| serde_json::to_value(w).unwrap_or(Json::Null)),
                        ScriptType::View("waypoint"),
                    )
                }
                ty => match picked_id.and_then(|id| param_target(world, side, ty, id)) {
                    Some(ParamTarget::Building(b)) => view_value(
                        &self.param_building(b).unwrap_or(Json::Null),
                        ScriptType::View("building"),
                    ),
                    Some(ParamTarget::Carriage(k)) => {
                        let mut m = to_json(k);
                        let ids: Vec<Json> =
                            passengers_of(world, &k.id).iter().map(|r| json!(r.id)).collect();
                        m.insert("passengerIds".into(), Json::Array(ids));
                        m.insert("standsStill".into(), Json::Bool(stands_still(world, k)));
                        view_value(&Json::Object(m), ScriptType::View("carriage"))
                    }
                    None => Value::Null,
                },
            };
            entries.push((decl.name.clone(), value));
        }
        Value::object(entries).freeze()
    }

    /// What `me` is (`me`): the resident or army as its view shows it.
    fn me_value(&self) -> Value {
        let world = self.world();
        let side = self.side.as_deref();
        let Some(army_id) = self.ctx.army_id else {
            return resident_view(world, self.me(), side, true);
        };
        let ty = binding(self.api, "me").expect("every API has me").returns;
        let army = world.armies.iter().find(|a| a.id == army_id).expect("checked on binding");
        let members: Vec<&Resident> = army
            .member_ids
            .iter()
            .filter_map(|id| world.residents.iter().find(|r| &r.id == id))
            .collect();
        let mut m = to_json(army);
        m.insert(
            "members".into(),
            Json::Array(
                members
                    .iter()
                    .map(|r| Json::Object(as_view(world, resident_data(world, r, side, false))))
                    .collect(),
            ),
        );
        if let Some(s) = last_struck(members.iter().copied()) {
            m = merge(m, struck_view(world, s));
        }
        view_value(&Json::Object(m), ty)
    }

    /// The global `b`, the `id`th name of the API (`globals[name]`), made when the script first
    /// reads it: the world doesn't change during a run, so it is what the TypeScript made up front.
    fn global_value(&self, id: usize, b: &ScriptBinding) -> Value {
        let world = self.world();
        match (b.is, b.name) {
            (Is::Value, "me") => self.me_value(),
            (Is::Value, "memory") => Value::Object(self.ctx.memory.clone()),
            (Is::Value, "params") => self.params_value(),
            (Is::Value, "debt") => {
                Value::Number(self.side.as_deref().map_or(0.0, |s| debt_of(world, s)))
            }
            (Is::Value, "tick") => Value::Number(world.tick as f64),
            (Is::Value, "mapSize") => Value::Number(f64::from(self.size())),
            (Is::Value, "random") => Value::Number(self.random),
            (Is::Value, other) => panic!("no value {other} to bind"),
            _ => Value::native(b.name, id as u32, b.cost as u64),
        }
    }

    /// The helpers (`scriptHelpers`): `floor(n)`, and `pickRandom(list)`.
    fn helper(&self, name: &str, args: &[Value]) -> Option<Result<Value, CallError>> {
        Some(match name {
            "floor" => match args.first() {
                Some(Value::Number(n)) => Ok(Value::Number(n.floor())),
                _ => Err(script_error("\"floor\" needs a number")),
            },
            "pickRandom" => match args.first() {
                Some(Value::List(l)) => {
                    let items = &l.borrow().items;
                    Ok(if items.is_empty() {
                        Value::Null
                    } else {
                        items[(self.random * items.len() as f64).floor() as usize].clone()
                    })
                }
                _ => Err(script_error("\"pickRandom\" needs a list")),
            },
            _ => return None,
        })
    }
}

impl Host for ScriptBindings<'_> {
    fn global(&mut self, name: &str) -> Option<Value> {
        let (id, b) = self.api.iter().enumerate().find(|(_, b)| b.name == name)?;
        Some(self.global_value(id, b))
    }

    fn call(&mut self, function: &NativeFunction, args: Vec<Value>) -> Result<Value, CallError> {
        let Some(b) = self.api.get(function.id as usize) else {
            return Err(host_error(format!("no native function {}", function.name)));
        };
        if let Some(answer) = self.helper(b.name, &args) {
            return answer;
        }
        match b.is {
            Is::Query => match self.direct_query(b.name, &args) {
                Some(answer) => answer,
                None => self.query(b.name, &args).map(|d| view_value(&d, b.returns)),
            },
            Is::Action => self.action(b.name, &args),
            Is::Value => Err(host_error(format!("{} is a value", b.name))),
        }
    }
}

/// Invariant (`script-requests-as-orders`, ADR 0004): a script can request nothing an order
/// couldn't. Each request a resident's script made is one of the script order kinds, for that
/// resident, and passes that order kind's own check against the world as it is
/// (`scriptRequestsSound`).
pub fn script_requests_sound(
    world: &WorldState,
    terrain: &TerrainMap,
    sender: &OrderSender,
    resident_id: &str,
    requests: &[OrderRequest],
    kinds: &OrderKinds,
) -> Vec<InvariantViolation> {
    requests_sound(world, terrain, sender, resident_id, requests, kinds, false)
}

/// The same invariant for an army's script (`armyScriptRequestsSound`).
pub fn army_script_requests_sound(
    world: &WorldState,
    terrain: &TerrainMap,
    sender: &OrderSender,
    army_id: &str,
    requests: &[OrderRequest],
    kinds: &OrderKinds,
) -> Vec<InvariantViolation> {
    requests_sound(world, terrain, sender, army_id, requests, kinds, true)
}

fn requests_sound(
    world: &WorldState,
    terrain: &TerrainMap,
    sender: &OrderSender,
    id: &str,
    requests: &[OrderRequest],
    kinds: &OrderKinds,
    army: bool,
) -> Vec<InvariantViolation> {
    let allowed = if army { army_script_order_kinds() } else { script_order_kinds() };
    let field_name = if army { "armyId" } else { "residentId" };
    let mut out = Vec::new();
    for order in requests {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "script-requests-as-orders".into(),
                message: format!("{id}'s script requested {}: {message}", order.kind),
                entity_ids: vec![id.to_string()],
            });
        };
        let kind = kinds.get(&order.kind);
        let for_whom = order.fields.get(field_name);
        match kind {
            Some(kind) if allowed.contains(&order.kind.as_str()) => {
                if for_whom.and_then(Json::as_str) != Some(id) {
                    let who = if army { "army" } else { "resident" };
                    let named = for_whom.map_or("undefined".to_string(), |v| match v {
                        Json::String(s) => s.clone(),
                        other => js_stringify(other),
                    });
                    fail(format!("for another {who}, {named}"));
                } else if let Some(reason) = kind.validate(world, sender, order, Some(terrain)) {
                    fail(reason);
                }
            }
            _ => fail(format!(
                "not an order {} can get",
                if army { "an army" } else { "a resident" }
            )),
        }
    }
    out
}

#[cfg(test)]
mod tests;
