//! Script parameters (`apps/server/src/script-params.ts`, `CONTEXT.md`: Script parameter): a
//! script's `param name: type` lines, read as `params.name`, and the values the Player picks for
//! them on a resident's card, kept per resident per script (`Resident.scriptParams`) as plain ids.

use std::sync::Arc;

use csp_lang::{script_params, ParamDefault, ParamType};
use csp_shared::balance::WORKPLACE_MAX_WORKERS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, Carriage, OrderRequest, Remembered, Resident, ScriptParamValue, Task,
    Waypoint, WorldState,
};
use indexmap::IndexMap;
use serde_json::Value;

use crate::default_scripts::target_param;
use crate::order_sender::{commands, realm_of, OrderSender};
use crate::orders::OrderKind;
use crate::queries::names::kind_name;
use crate::queries::territory::city_organization;
use crate::queue::field_str;
use crate::script_api::{is_param_choice, is_param_number, ScriptParam};
use crate::scripts::ScriptLibrary;
use crate::sight::InvariantViolation;

/// The buildings a storage param may name besides carriages: those a store or fetch goes to.
const STORAGE_KINDS: [BuildingKind; 2] = [BuildingKind::Storage, BuildingKind::Stable];

/// A workplace or construction site, which anyone may work (`anyonesToWork`).
fn anyones_to_work(b: &Building) -> bool {
    b.site.is_some() || WORKPLACE_MAX_WORKERS.get(kind_name(b.kind)).is_some()
}

/// The Organization a building belongs to (`buildingOrganization`).
// TODO(T86.7): `crimes::building_organization`.
fn building_organization(world: &WorldState, b: &Building) -> Option<String> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.clone();
    }
    match world.cities.iter().find(|c| Some(&c.id) == b.city_id.as_ref()) {
        Some(city) => Some(city_organization(city).to_string()),
        None => b.realm_id.clone(),
    }
}

/// The Organization a carriage belongs to (`carriageOrganization`).
// TODO(T86.7): `crimes::carriage_organization`.
fn carriage_organization(k: &Carriage) -> Option<&str> {
    k.realm_id.as_deref().or(k.city_id.as_deref())
}

/// A Player's waypoints (`waypointsOf`).
// TODO(T86.11): `waypoints::waypoints_of`.
fn waypoints_of(world: &WorldState, user_id: u64) -> &[Waypoint] {
    world.waypoints.get(&user_id).map_or(&[], Vec::as_slice)
}

/// Whether the realm's Player knows the building, in sight or last seen (`knows`).
fn knows(world: &WorldState, realm_id: &str, b: &Building) -> bool {
    let Some(user_id) = world.realms.iter().find(|x| x.id == realm_id).map(|r| r.user_id) else {
        return false;
    };
    world.last_seen.get(&user_id).is_some_and(|memory| {
        memory.iter().any(|e| matches!(e, Remembered::Building(rb) if rb.id == b.id))
    })
}

/// What a param names (`paramTarget`): a building or a carriage.
#[derive(Debug, Clone, Copy)]
pub enum ParamTarget<'w> {
    Building(&'w Building),
    Carriage(&'w Carriage),
}

/// What a param of `type` holding `id` names for the side (a realm, or an NPC city)
/// (`paramTarget`): for `building` one of its own buildings or construction sites, or a workplace
/// or site of anyone's that its Player knows; for `storage` one of its own finished storages or
/// stables, or one of its carriages. `None` when the id names nothing of the kind, or nothing the
/// side may name.
pub fn param_target<'w>(
    world: &'w WorldState,
    side: Option<&str>,
    ty: ParamType,
    id: &str,
) -> Option<ParamTarget<'w>> {
    let side = side?;
    if let Some(b) = world.buildings.iter().find(|x| x.id == id) {
        if building_organization(world, b).as_deref() != Some(side) {
            let known = ty == ParamType::Building && anyones_to_work(b) && knows(world, side, b);
            return known.then_some(ParamTarget::Building(b));
        }
        if ty == ParamType::Storage && (!STORAGE_KINDS.contains(&b.kind) || b.site.is_some()) {
            return None;
        }
        return Some(ParamTarget::Building(b));
    }
    if ty != ParamType::Storage {
        return None;
    }
    let k = world.carriages.iter().find(|x| x.id == id)?;
    (carriage_organization(k) == Some(side)).then_some(ParamTarget::Carriage(k))
}

/// The waypoint a `waypoint` param holding `id` names for the realm `side` (`paramWaypoint`):
/// one of its Player's. `None` once it is removed, and for a side without a Player.
pub fn param_waypoint<'w>(
    world: &'w WorldState,
    side: Option<&str>,
    id: &str,
) -> Option<&'w Waypoint> {
    let user_id = world.realms.iter().find(|x| Some(x.id.as_str()) == side)?.user_id;
    waypoints_of(world, user_id).iter().find(|w| w.id == id)
}

/// A kept value as the JSON the TypeScript held.
fn value_json(v: &ScriptParamValue) -> Value {
    match v {
        ScriptParamValue::Id(s) => Value::String(s.clone()),
        ScriptParamValue::Number(n) => {
            serde_json::Number::from_f64(*n).map_or(Value::Null, Value::Number)
        }
    }
}

/// Whether a value kept for `param` still fits it (`stillFits`): by its type, and naming what is
/// still there.
fn still_fits(
    world: &WorldState,
    r: &Resident,
    param: Option<&ScriptParam>,
    value: &ScriptParamValue,
) -> bool {
    let Some(param) = param else { return false };
    let json = value_json(value);
    match param.param.ty {
        ParamType::Number => is_param_number(&json),
        ParamType::Choice => is_param_choice(param, &json),
        ParamType::Waypoint => match value {
            ScriptParamValue::Id(id) => param_waypoint(world, r.owner.as_deref(), id).is_some(),
            ScriptParamValue::Number(_) => false,
        },
        ParamType::Building | ParamType::Storage => match value {
            ScriptParamValue::Id(id) => {
                world.buildings.iter().any(|b| &b.id == id)
                    || world.carriages.iter().any(|k| &k.id == id)
            }
            ScriptParamValue::Number(_) => false,
        },
    }
}

/// A param line with the value picked for it, if any (`ScriptParam & { value? }`).
#[derive(Debug, Clone, PartialEq)]
pub struct ParamWithValue {
    pub param: ScriptParam,
    pub value: Option<ScriptParamValue>,
}

/// Drops the resident's group for the script once empty, and their params once they hold none.
fn tidy(r: &mut Resident, script_id: u64) {
    if let Some(all) = &mut r.script_params {
        if all.get(&script_id).is_some_and(IndexMap::is_empty) {
            all.remove(&script_id);
        }
        if all.is_empty() {
            r.script_params = None;
        }
    }
}

/// The values picked for a resident's script as the script reads them (`paramValues`), by the
/// script's `param` lines: the id, number or word picked for each, or none. Picked values of a
/// param the script no longer has, those that no longer fit, ids naming something gone from the
/// world and waypoints their Player removed are dropped from the resident at `i`.
pub fn param_values(
    world: &mut WorldState,
    i: usize,
    script_id: u64,
    params: &[ScriptParam],
) -> Vec<ParamWithValue> {
    let picked = world.residents[i].script_params.as_ref().and_then(|p| p.get(&script_id)).cloned();
    if let Some(picked) = &picked {
        let r = &world.residents[i];
        let gone: Vec<String> = picked
            .iter()
            .filter(|(name, value)| {
                let param = params.iter().find(|p| &p.param.name == *name);
                !still_fits(world, r, param, value)
            })
            .map(|(name, _)| name.clone())
            .collect();
        let r = &mut world.residents[i];
        if let Some(group) = r.script_params.as_mut().and_then(|p| p.get_mut(&script_id)) {
            for name in &gone {
                group.shift_remove(name);
            }
        }
        tidy(r, script_id);
    }
    let picked = world.residents[i].script_params.as_ref().and_then(|p| p.get(&script_id));
    params
        .iter()
        .map(|p| ParamWithValue {
            param: p.clone(),
            value: picked.and_then(|g| g.get(&p.param.name)).cloned(),
        })
        .collect()
}

/// Why `value` can't be picked for `param` by the realm (`valueProblem`), by the param's type.
fn value_problem(
    world: &WorldState,
    realm_id: &str,
    param: &ScriptParam,
    value: &Value,
) -> Option<String> {
    match param.param.ty {
        ParamType::Number => {
            (!is_param_number(value)).then(|| "must be a whole number of zero or more".into())
        }
        ParamType::Choice => (!is_param_choice(param, value)).then(|| {
            format!(
                "must be one of {}",
                param.param.choices.as_deref().unwrap_or_default().join(", ")
            )
        }),
        ParamType::Waypoint => {
            let fits = value
                .as_str()
                .is_some_and(|id| param_waypoint(world, Some(realm_id), id).is_some());
            (!fits).then(|| "must be one of your waypoints".into())
        }
        ty @ (ParamType::Building | ParamType::Storage) => {
            let fits = value
                .as_str()
                .is_some_and(|id| param_target(world, Some(realm_id), ty, id).is_some());
            (!fits).then(|| {
                if ty == ParamType::Storage {
                    "must be a storage, a stable or a carriage of yours".into()
                } else {
                    "must be a building of yours, or a workplace or construction site you know"
                        .into()
                }
            })
        }
    }
}

/// A picked value as it is kept: an id or word, or a number.
fn kept_value(value: &Value) -> Option<ScriptParamValue> {
    match value {
        Value::String(s) => Some(ScriptParamValue::Id(s.clone())),
        Value::Number(n) => n.as_f64().map(ScriptParamValue::Number),
        _ => None,
    }
}

/// Keeps `value` for the resident's param of the script, or with `None` clears it (`keep`).
fn keep(r: &mut Resident, script_id: u64, name: &str, value: Option<ScriptParamValue>) {
    match value {
        None => {
            let Some(group) = r.script_params.as_mut().and_then(|p| p.get_mut(&script_id)) else {
                return;
            };
            group.shift_remove(name);
            tidy(r, script_id);
        }
        Some(value) => {
            let all = r.script_params.get_or_insert_with(Default::default);
            all.entry(script_id).or_default().insert(name.to_string(), value);
        }
    }
}

/// Why the param values an order starting a script gives don't fit the script's `param` lines
/// (`startParamsProblem`): each must name one of them and fit its type, or be null.
pub fn start_params_problem(
    world: &WorldState,
    realm_id: &str,
    declared: &[ScriptParam],
    params: Option<&Value>,
) -> Option<String> {
    let params = params?;
    let Value::Object(params) = params else {
        return Some("params must be values by name".into());
    };
    for (name, value) in params {
        let Some(param) = declared.iter().find(|p| &p.param.name == name) else {
            return Some(format!("{name}: the script has no such param"));
        };
        if value.is_null() {
            continue;
        }
        if let Some(problem) = value_problem(world, realm_id, param, value) {
            return Some(format!("{name}: {problem}"));
        }
    }
    None
}

/// Sets the param values an order starting script `script_id` gives (`setStartParams`): each one
/// kept for the resident, null clearing it; those left out keep theirs.
pub fn set_start_params(
    r: &mut Resident,
    script_id: u64,
    params: Option<&serde_json::Map<String, Value>>,
) {
    for (name, value) in params.into_iter().flatten() {
        keep(r, script_id, name, kept_value(value));
    }
}

/// The param values a start sets, with the script's target param never kept from the start
/// before (`withTargetParam`): `target`, else what the order gives, else cleared. Only while the
/// script declares it.
pub fn with_target_param(
    script: Option<(&str, Option<Task>)>,
    params: Option<serde_json::Map<String, Value>>,
    target: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let Some((source, task)) = script else { return params };
    let Some(name) = target_param(task) else { return params };
    if !script_params(source).iter().any(|p| p.param.name == name) {
        return params;
    }
    let mut out = params.unwrap_or_default();
    let given = out.get(name).filter(|v| !v.is_null()).cloned();
    let value = target.map(|t| Value::String(t.to_string())).or(given).unwrap_or(Value::Null);
    out.insert(name.to_string(), value);
    Some(out)
}

/// The set-script-param order (`setScriptParamOrder`, `CONTEXT.md`: Script parameter): the
/// Player picks, or clears with a null `targetId`, the value of a `param` of the script one of
/// their residents runs. Free and instant, from anywhere.
pub struct SetScriptParamOrder {
    pub library: Arc<dyn ScriptLibrary + Send + Sync>,
}

impl OrderKind for SetScriptParamOrder {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let realm = realm_of(world, sender.user_id);
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == field_str(order, "residentId"));
        let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
            return Some("not one of your residents".into());
        };
        let r = r.expect("commanded");
        let script_id = f.get("scriptId").and_then(Value::as_f64);
        let runs = r.script.as_ref().is_some_and(|s| Some(s.script_id as f64) == script_id);
        if !runs {
            return Some("not the script they run".into());
        }
        let script = self.library.script(script_id.expect("runs") as u64);
        let Some(script) = script.filter(|s| s.user_id == sender.user_id) else {
            return Some("not the script they run".into());
        };
        let name = field_str(order, "name");
        let params = script_params(&script.source);
        let Some(param) = params.iter().find(|p| Some(p.param.name.as_str()) == name) else {
            return Some("the script has no such param".into());
        };
        let target = f.get("targetId");
        let value = f.get("value");
        if target.is_some_and(Value::is_null) && value.is_none() {
            return None;
        }
        match param.param.ty {
            ParamType::Number | ParamType::Choice => match target {
                None => value_problem(world, &realm.id, param, value.unwrap_or(&Value::Null)),
                Some(_) if param.param.ty == ParamType::Number => {
                    Some("must be a whole number of zero or more".into())
                }
                Some(_) => Some("takes a word, not a pick".into()),
            },
            _ if value.is_some() => Some("takes no number or word".into()),
            _ => value_problem(world, &realm.id, param, target.unwrap_or(&Value::Null)),
        }
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = field_str(order, "residentId");
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        let script_id = f.get("scriptId").and_then(Value::as_f64).unwrap_or(0.0) as u64;
        let name = field_str(order, "name").unwrap_or_default().to_string();
        let value = f.get("value").or(f.get("targetId")).and_then(kept_value);
        keep(r, script_id, &name, value);
    }
}

/// Invariant (`script-params-sound`, ADR 0004): every resident's picked script param values are
/// plain ids, words or whole numbers of zero or more, kept by a whole positive script id, with no
/// empty group left behind.
pub fn script_params_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(groups) = &r.script_params else { continue };
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "script-params-sound".into(),
                message: format!("resident {} {message}", r.id),
                entity_ids: vec![r.id.clone()],
            });
        };
        if groups.is_empty() {
            fail("keeps no script params, but an empty group".into());
        }
        for (script_id, picked) in groups {
            if *script_id == 0 {
                fail(format!("keeps params for script {script_id}"));
            }
            if picked.is_empty() {
                fail(format!("keeps an empty group of params for script {script_id}"));
            }
            if picked.values().any(|v| {
                matches!(v, ScriptParamValue::Number(_)) && !is_param_number(&value_json(v))
            }) {
                fail(format!(
                    "keeps a param value of script {script_id} that is no id, word or whole number"
                ));
            }
        }
    }
    out
}

/// A `number` param's default, or a `choice` param's word, as the script reads it while none is
/// picked.
pub fn param_default(p: &ScriptParam) -> Option<Value> {
    match &p.param.default {
        Some(ParamDefault::Number(n)) => serde_json::Number::from_f64(*n).map(Value::Number),
        Some(ParamDefault::Word(w)) => Some(Value::String(w.clone())),
        None => None,
    }
}
