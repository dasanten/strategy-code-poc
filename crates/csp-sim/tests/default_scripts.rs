//! The world half of `apps/server/src/default-scripts.test.ts`, ported (T86.17, part 5): Default
//! scripts (`CONTEXT.md`: Default script, Memory, Step budget; ADR 0009) in the running world:
//! Work, Haul, Tear down and Build from the UI, waiting while their order runs, a group building,
//! and the step budget. The library half (renaming, resetting, following the game's default) is
//! `crates/csp-server/tests/default_scripts.rs`.

mod build_common;
mod scripts_common;

use std::sync::Arc;

use build_common::*;
use csp_lang::interpreter::{run, RunOptions, RunResult, ValueLimits};
use csp_lang::{parse, plain_value, script_params, Object, Value as LangValue};
use csp_shared::balance::{
    SCRIPT_MAX_CALL_DEPTH, SCRIPT_STEP_BUDGET, SCRIPT_VALUE_LIMITS, STABLE_CAPACITY,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, Carriage, Good, Horse, OrderRequest, ResidentOrder, ResourceKind,
    ResourceNode, Stock, Task, WorldState,
};
use csp_sim::default_scripts::{default_script, TASKS};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderReply};
use csp_sim::queries::building::{node_corner, pile_tile};
use csp_sim::script_bindings::{bind_script, ScriptContext};
use csp_sim::script_params::ParamWithValue;
use csp_sim::sight::sight_of;
use csp_sim::world::step_world;
use csp_sim::world_index::WorldIndex;
use scripts_common::{as_numbers, assert_matches, default_script_id, from, order_json, Game};
use serde_json::{json, Value};

const SIZE: i32 = 16;
const MARA: u64 = 7;
const TOBIN: u64 = 8;

fn mara() -> OrderSender {
    player(MARA)
}

fn id_of(task: Task) -> u64 {
    default_script_id(MARA, task)
}

/// Realm r1 of Mara with a farm at (3, 3) and residents w1 and w2 on it; realm r2 of Tobin.
fn farm_world() -> (WorldState, TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    world.realms.push(realm("r2", TOBIN, "t1"));
    let mut farm = building("farm", BuildingKind::Farm, 3.0, 3.0);
    farm.city_id = Some("c1".into());
    world.buildings.push(farm);
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for (id, owner) in [("w1", "r1"), ("w2", "r1"), ("t1", "r2")] {
        world.residents.push(new_resident(id, Some(owner), 3.0, 3.0));
    }
    (world, terrain)
}

fn game() -> Game {
    let (world, terrain) = farm_world();
    Game::new(world, terrain, mara())
}

fn receive(g: &mut Game, id: &str, order: Value) -> Result<(), String> {
    match g.orders.receive(&g.world, &mara(), &json!(id), &order) {
        OrderReply::Ack { .. } => Ok(()),
        OrderReply::Rejected { reason, .. } => Err(reason),
    }
}

fn task_order(g: &mut Game, mut o: Value) -> Result<(), String> {
    o["kind"] = json!("task");
    receive(g, "q", o)
}

fn refused(reason: &str) -> Result<(), String> {
    Err(reason.to_string())
}

fn script_json(g: &Game, id: &str) -> Value {
    as_numbers(&serde_json::to_value(&g.r(id).script).unwrap())
}

fn runner_once(g: &mut Game) {
    let broken = g.scripts.run_all(&mut g.world, &mut g.scratch);
    assert!(broken.is_empty(), "{broken:?}");
}

/// Ticks as the game does but with no queues: fed, orders, scripts (their invariants hold), then
/// the world, walking if `walking`.
fn tick(g: &mut Game, walking: bool) {
    for r in &mut g.world.residents {
        r.hunger = 100.0;
    }
    g.orders.apply_all(&mut g.world);
    let broken = g.scripts.run_all(&mut g.world, &mut g.scratch);
    assert!(broken.is_empty(), "{broken:?}");
    let w: Option<&mut dyn csp_sim::tick::Walk> = if walking { Some(&mut g.walking) } else { None };
    step_world(&mut g.world, &g.terrain, &mut g.scratch, w, None);
}

// residents' memory

/// Everything in the world as seen, which is enough for these tests (`seenAll`).
fn seen_all(world: &WorldState) -> Arc<Vec<csp_shared::protocol::SeenEntity>> {
    Arc::new(
        world
            .residents
            .iter()
            .map(|r| {
                let mut v = serde_json::to_value(r).unwrap();
                let script = v.as_object_mut().unwrap().remove("script");
                v["is"] = json!("resident");
                if let Some(script) = script {
                    v["script"] = json!({ "scriptId": script["scriptId"] });
                }
                from(v)
            })
            .collect(),
    )
}

fn sight_context_run(
    world: &WorldState,
    terrain: &TerrainMap,
    source: &str,
    memory: &Object,
) -> RunResult {
    let index = WorldIndex::new(world, terrain.size);
    let sender = mara();
    let seen = || seen_all(world);
    let eyes = || sight_of(world, &index, "r1", None);
    let explored = |_: i32, _: i32| true;
    let kinds = order_kinds();
    let program = parse(source).unwrap();
    let declared = script_params(source);
    let params: Vec<ParamWithValue> =
        declared.into_iter().map(|param| ParamWithValue { param, value: None }).collect();
    let ctx = ScriptContext {
        world,
        terrain,
        index: &index,
        sender: &sender,
        resident_id: Some("w1"),
        army_id: None,
        memory: memory.clone(),
        seen: &seen,
        places: None,
        place: None,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: Some(&params),
    };
    let mut bound = bind_script(ctx).unwrap();
    let limits = ValueLimits {
        max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
        max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
        max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
    };
    let options = RunOptions {
        steps: SCRIPT_STEP_BUDGET as u64,
        max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32,
        limits,
    };
    run(&program, &mut bound, &options).unwrap()
}

#[test]
fn residents_memory_is_readable_by_scripts_for_the_players_own_residents_never_other_players() {
    let (mut world, terrain) = farm_world();
    world.residents[1].script =
        Some(from(json!({ "scriptId": 1, "memory": { "role": "carrier" } })));
    world.residents[2].script =
        Some(from(json!({ "scriptId": 2, "memory": { "secret": "plans" } })));
    let memory = Object::new();
    let result = sight_context_run(
        &world,
        &terrain,
        r#"
        let found = {}
        for (r of residents()) {
          if (r.script != null) { found[r.id] = r.script.memory }
        }
        memory.found = found
        let w2 = residents()[1]
        w2.script.memory.role = "changed"
      "#,
        &memory,
    );
    assert!(matches!(result, RunResult::Error { .. }), "{result:?}");
    let found = memory.borrow().get("found").cloned().unwrap();
    let found = plain_value(&found, usize::MAX).unwrap().value;
    assert_eq!(found, json!({ "w2": { "role": "carrier" }, "t1": null }));
    // Read, never changed.
    assert_eq!(
        serde_json::to_value(&world.residents[1].script.as_ref().unwrap().memory).unwrap(),
        json!({ "role": "carrier" })
    );
}

// Work from the UI

#[test]
fn work_from_the_ui_runs_the_players_work_default_with_the_workplace_in_memory() {
    let mut g = game();
    let work = |p: Value| {
        let mut o = json!({ "task": "work", "residentId": "w1", "workplaceId": "farm" });
        o.as_object_mut().unwrap().extend(p.as_object().unwrap().clone());
        o
    };
    assert_eq!(task_order(&mut g, work(json!({}))), Ok(()));
    assert_eq!(
        task_order(&mut g, work(json!({ "workplaceId": "elsewhere" }))),
        refused("not standing on that workplace")
    );
    assert_eq!(task_order(&mut g, work(json!({ "task": "dance" }))), refused("no such task"));
    assert_eq!(
        task_order(&mut g, work(json!({ "residentId": "t1" }))),
        refused("not one of your residents")
    );
    g.orders.apply_all(&mut g.world);
    assert_eq!(
        script_json(&g, "w1"),
        as_numbers(&json!({
            "scriptId": id_of(Task::Work), "memory": { "workplaceId": "farm" }, "settingsFrom": "farm"
        }))
    );
}

#[test]
fn work_from_the_ui_is_given_to_a_resident_working_by_a_bare_work_at_order_but_not_twice() {
    let mut g = game();
    g.world.residents[0].order = Some(from(json!({
        "kind": "workAt", "buildingId": "farm", "at": { "x": 3, "y": 3 }, "progress": 0.5
    })));
    let work = json!({ "kind": "task", "task": "work", "residentId": "w1", "workplaceId": "farm" });
    assert_eq!(receive(&mut g, "q", work.clone()), Ok(()));
    g.orders.apply_all(&mut g.world);
    runner_once(&mut g);
    assert_eq!(g.r("w1").script.as_ref().unwrap().script_id, id_of(Task::Work));
    assert!(matches!(g.r("w1").order, Some(ResidentOrder::WorkAt(_))));
    assert_eq!(receive(&mut g, "q", work), refused("already working here"));
}

#[test]
fn work_from_the_ui_plays_as_the_work_at_order_did_the_same_food_on_the_farms_pile_tick_for_tick() {
    let mut g = game();
    g.world.residents.retain(|r| r.owner.as_deref() == Some("r1"));
    // w1 is given Work from the UI, w2 the plain work-at order: equal residents, equal output.
    // Each on a tile of the farm's own, so neither walks to spread out (Spreading over the
    // footprint).
    g.world.residents[1].stats = g.world.residents[0].stats.clone();
    g.world.residents[1].x = 4.0;
    receive(
        &mut g,
        "a",
        json!({ "kind": "task", "task": "work", "residentId": "w1", "workplaceId": "farm" }),
    )
    .unwrap();
    receive(&mut g, "b", json!({ "kind": "workAt", "residentId": "w2" })).unwrap();
    let mut progress: Vec<(f64, f64)> = Vec::new();
    for _ in 0..2000 {
        tick(&mut g, false);
        let of = |r: &csp_shared::world::Resident| match &r.order {
            Some(ResidentOrder::WorkAt(o)) => o.progress,
            _ => -1.0,
        };
        assert!(matches!(g.world.residents[0].order, Some(ResidentOrder::WorkAt(_))));
        progress.push((of(&g.world.residents[0]), of(&g.world.residents[1])));
    }
    for (a, b) in &progress {
        assert!((a - b).abs() < 1e-9, "{a} vs {b}");
    }
    // They really worked: Food on the pile, or the next unit coming along.
    let (px, py) = pile_tile(&g.world, 3, 3, SIZE);
    let food = g
        .world
        .piles
        .iter()
        .find(|p| (p.x as i32, p.y as i32) == (px, py))
        .and_then(|p| p.goods.get(&Good::Food).copied())
        .unwrap_or(0.0);
    assert!(food + progress.last().unwrap().0 > progress[0].0);
    assert_eq!(
        serde_json::to_value(&g.world.residents[0].script.as_ref().unwrap().memory).unwrap(),
        json!({ "workplaceId": "farm", "at": { "x": 3, "y": 3 } })
    );
}

// Haul and Tear down from the UI

/// Carriage k1 of realm r1 with its horse, at w1's tile in `farm_world`.
fn with_carriage(world: &mut WorldState) {
    world.horses.push(from::<Horse>(json!({
        "id": "h1", "realmId": "r1", "cityId": null, "x": 3, "y": 3, "hunger": 100, "health": 100,
        "name": "Rowan", "stats": { "speed": 5, "strength": 5, "endurance": 5 }, "bornAt": 0
    })));
    world.carriages.push(from::<Carriage>(json!({
        "id": "k1", "realmId": "r1", "cityId": null, "x": 3, "y": 3, "horseId": null, "load": {}
    })));
}

#[test]
fn haul_and_tear_down_run_the_players_defaults_with_the_route_or_the_building_in_memory() {
    let mut g = game();
    with_carriage(&mut g.world);
    let haul = |extra: Value| {
        let mut o = json!({
            "task": "haul", "residentId": "w1", "carriageId": "k1", "x": 10, "y": 3, "keepFood": 4
        });
        let m = o.as_object_mut().unwrap();
        for (k, v) in extra.as_object().unwrap() {
            if v.is_null() {
                m.remove(k);
            } else {
                m.insert(k.clone(), v.clone());
            }
        }
        o
    };
    // Checked as the haul order is; a supply line to an army stays the bare haul order's.
    assert_eq!(task_order(&mut g, haul(json!({ "goods": [] }))), refused("pick the goods to haul"));
    assert_eq!(
        task_order(&mut g, haul(json!({ "goods": ["food"], "x": 3 }))),
        refused("the other stop must be another tile")
    );
    assert_eq!(
        task_order(&mut g, haul(json!({ "goods": ["food"], "x": null, "armyId": "a1" }))),
        refused("the other stop must be a tile")
    );
    assert_eq!(
        task_order(&mut g, haul(json!({ "goods": ["food"], "returnGoods": ["wood"] }))),
        Ok(())
    );
    // Checked as the tear-down order is.
    assert_eq!(
        task_order(&mut g, json!({ "task": "tearDown", "residentId": "w2", "buildingId": "nope" })),
        refused("the resident is not at that building")
    );
    assert_eq!(
        task_order(&mut g, json!({ "task": "tearDown", "residentId": "w2", "buildingId": "farm" })),
        Ok(())
    );
    g.orders.apply_all(&mut g.world);
    assert_eq!(
        script_json(&g, "w1"),
        as_numbers(&json!({
            "scriptId": id_of(Task::Haul),
            "memory": {
                "carriageId": "k1", "from": { "x": 3, "y": 3 }, "to": { "x": 10, "y": 3 },
                "goods": ["food"], "returnGoods": ["wood"], "keepFood": 4
            }
        }))
    );
    assert_eq!(
        script_json(&g, "w2"),
        as_numbers(&json!({
            "scriptId": id_of(Task::TearDown), "memory": { "buildingId": "farm" }
        }))
    );
    // Their first run starts the built-in orders.
    runner_once(&mut g);
    assert_matches(
        &order_json(g.r("w1")),
        json!({ "kind": "haul", "to": { "x": 10, "y": 3 }, "keepFood": 4 }),
    );
    assert_eq!(
        as_numbers(&order_json(g.r("w2"))),
        as_numbers(&json!({ "kind": "tearDown", "buildingId": "farm", "at": { "x": 3, "y": 3 } }))
    );
}

// Build a … here from a node's card

#[test]
fn build_a_here_walks_the_resident_to_where_the_nodes_workplace_fits_and_lays_out_its_site_there() {
    let mut g = game();
    g.world.residents.retain(|r| r.owner.as_deref() == Some("r1"));
    // A forest node with the farm's corner west of it: the footprint over the node goes east.
    g.world.nodes.push(ResourceNode {
        id: "n1".into(),
        kind: ResourceKind::Forest,
        x: 11.0,
        y: 9.0,
    });
    let corner = node_corner(&g.world, &g.terrain, &g.world.nodes[0]);
    assert_eq!(corner, Some((11, 9)));
    let corner = json!({ "x": 11, "y": 9 });
    let build = |g: &mut Game, o: Value| {
        let mut order = json!({ "kind": "task", "task": "build", "residentId": "w1" });
        order.as_object_mut().unwrap().extend(o.as_object().unwrap().clone());
        receive(g, "q", order)
    };
    // Checked as the build order there: off the node it doesn't fit, nor for a child.
    assert_eq!(
        build(&mut g, json!({ "building": "lumberCamp", "at": { "x": 1, "y": 12 } })),
        refused("a lumberCamp goes with one tile on a fitting resource node")
    );
    assert_eq!(
        build(&mut g, json!({ "building": "lumberCamp", "at": { "x": 11.5, "y": 9 } })),
        refused("the target must be a tile")
    );
    g.world.residents[1].born_at = g.world.tick as f64 - csp_shared::balance::ticks_for_age(5.0);
    assert_eq!(
        build(&mut g, json!({ "residentId": "w2", "building": "lumberCamp", "at": corner })),
        refused("children can’t build")
    );
    assert_eq!(build(&mut g, json!({ "building": "lumberCamp", "at": corner })), Ok(()));
    g.orders.apply_all(&mut g.world);
    assert_eq!(
        as_numbers(&Value::Object(g.r("w1").script.as_ref().unwrap().memory.clone())),
        as_numbers(&json!({ "building": "lumberCamp", "at": corner }))
    );
    for _ in 0..500 {
        if g.world.buildings.iter().any(|b| b.kind == BuildingKind::LumberCamp) {
            break;
        }
        tick(&mut g, true);
    }
    assert_eq!((g.r("w1").x, g.r("w1").y), (11.0, 9.0));
    let site = g.world.buildings.iter().find(|b| b.kind == BuildingKind::LumberCamp).unwrap();
    assert_eq!((site.x, site.y), (11.0, 9.0));
    assert!(site.site.is_some());
    let site_id = site.id.clone();
    assert_matches(&order_json(g.r("w1")), json!({ "kind": "build", "siteId": site_id }));
}

// Defaults waiting while their order runs

/// w1 given Build at a node far off, its default as shipped or as an edited copy: the ticks its
/// script ran, until the site is laid out, and where they stand then.
fn build_far_off(edited: bool) -> (Vec<u64>, Game, u64) {
    let mut g = game();
    g.world.residents.retain(|r| r.id == "w1");
    g.world.nodes.push(ResourceNode {
        id: "n1".into(),
        kind: ResourceKind::Forest,
        x: 13.0,
        y: 9.0,
    });
    let corner = node_corner(&g.world, &g.terrain, &g.world.nodes[0]).unwrap();
    if edited {
        let (name, source) = default_script(Task::Build);
        g.scripts.library.insert(
            id_of(Task::Build),
            csp_sim::scripts::RunnableScript {
                user_id: MARA,
                name: format!("{name} (default)"),
                version: 2,
                source: format!("{source}\n// mine\n"),
                follows_default: false,
                task: Some(Task::Build),
            },
        );
    }
    receive(
        &mut g,
        "q",
        json!({
            "kind": "task", "task": "build", "residentId": "w1", "building": "lumberCamp",
            "at": { "x": corner.0, "y": corner.1 }
        }),
    )
    .unwrap();
    g.orders.apply_all(&mut g.world);
    let mut ran = Vec::new();
    for _ in 0..500 {
        if g.world.buildings.iter().any(|b| b.kind == BuildingKind::LumberCamp) {
            break;
        }
        for r in &mut g.world.residents {
            r.hunger = 100.0;
        }
        let broken = g.scripts.run_all(&mut g.world, &mut g.scratch);
        assert!(broken.is_empty(), "{broken:?}");
        if g.scripts.runs() > 0 {
            ran.push(g.world.tick);
        }
        step_world(&mut g.world, &g.terrain, &mut g.scratch, Some(&mut g.walking), None);
    }
    let tick = g.world.tick;
    (ran, g, tick)
}

#[test]
fn build_runs_once_to_set_off_not_on_the_way_and_again_on_arrival() {
    let (ran, g, tick) = build_far_off(false);
    assert_eq!((g.r("w1").x, g.r("w1").y), (13.0, 9.0));
    assert!(matches!(g.r("w1").order, Some(ResidentOrder::Build(_))));
    // Set off, arrived, laid out: the walk of many ticks between ran no script.
    assert!(tick > 8);
    assert!(ran.len() <= 3, "{ran:?}");
}

#[test]
fn an_edited_copy_waits_just_like_the_default() {
    let (shipped_ran, _, shipped_tick) = build_far_off(false);
    let (edited_ran, edited, edited_tick) = build_far_off(true);
    assert_eq!(edited_ran, shipped_ran);
    assert_eq!(edited_tick, shipped_tick);
    assert_eq!((edited.r("w1").x, edited.r("w1").y), (13.0, 9.0));
}

// Build for a group

#[test]
fn build_for_a_group_walks_each_to_the_same_tile_the_first_lays_out_the_site_and_the_others_join_it(
) {
    let mut g = game();
    g.world.residents.retain(|r| r.owner.as_deref() == Some("r1"));
    g.world.residents[1].x = 12.0;
    g.world.residents[1].y = 12.0;
    let at = json!({ "x": 8, "y": 12 });
    for id in ["w1", "w2"] {
        let order = json!({
            "kind": "task", "task": "build", "residentId": id, "building": "house", "at": at
        });
        assert_eq!(receive(&mut g, id, order), Ok(()));
    }
    g.orders.apply_all(&mut g.world);
    let joined = |g: &Game| {
        g.world
            .residents
            .iter()
            .all(|r| matches!(&r.order, Some(ResidentOrder::Build(o)) if o.site_id.is_some()))
    };
    for _ in 0..500 {
        if joined(&g) {
            break;
        }
        tick(&mut g, true);
    }
    let sites: Vec<&Building> =
        g.world.buildings.iter().filter(|b| b.kind == BuildingKind::House).collect();
    assert_eq!(sites.len(), 1);
    assert_eq!((sites[0].x, sites[0].y), (8.0, 12.0));
    assert!(sites[0].site.is_some());
    for r in &g.world.residents {
        assert_matches(&order_json(r), json!({ "kind": "build", "siteId": sites[0].id }));
    }
}

// the step budget

type Prepare = Box<dyn Fn(&mut WorldState)>;

/// What a default script finds as it runs: its memory, and the world made ready for it.
struct Case {
    memory: Value,
    prepare: Prepare,
    /// What the Player has explored; all of the map without it.
    explored: Option<fn(i32, i32) -> bool>,
}

fn case(memory: Value, prepare: impl Fn(&mut WorldState) + 'static) -> Case {
    Case { memory, prepare: Box::new(prepare), explored: None }
}

/// Steps a default script takes in one run for w1 of `farm_world`, as it finds the world.
fn steps(task: Task, c: &Case) -> u64 {
    let (mut world, terrain) = farm_world();
    (c.prepare)(&mut world);
    let source = default_script(task).1;
    let program = parse(source).unwrap();
    let index = WorldIndex::new(&world, SIZE);
    let sender = mara();
    let seen = || seen_all(&world);
    let eyes = || sight_of(&world, &index, "r1", None);
    let explored = |x: i32, y: i32| c.explored.is_none_or(|e| e(x, y));
    let kinds = order_kinds();
    // Nothing picked: every param reads its default.
    let params: Vec<ParamWithValue> = script_params(source)
        .into_iter()
        .map(|param| ParamWithValue { param, value: None })
        .collect();
    let memory = match LangValue::from_json(&c.memory) {
        LangValue::Object(o) => o,
        _ => Object::new(),
    };
    let ctx = ScriptContext {
        world: &world,
        terrain: &terrain,
        index: &index,
        sender: &sender,
        resident_id: Some("w1"),
        army_id: None,
        memory,
        seen: &seen,
        places: None,
        place: None,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: Some(&params),
    };
    let mut bound = bind_script(ctx).unwrap();
    let options = RunOptions {
        steps: SCRIPT_STEP_BUDGET as u64,
        max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32,
        limits: ValueLimits {
            max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
            max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
            max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
        },
    };
    let result = run(&program, &mut bound, &options).unwrap();
    match result {
        RunResult::Done { steps } => steps,
        other => panic!("{task:?}: {other:?}"),
    }
}

fn add(world: &mut WorldState, b: Value) {
    world.buildings.push(from(b));
}

/// A storage of Mara's with Food, away from the farm.
fn stocked(world: &mut WorldState) {
    add(
        world,
        json!({ "id": "s9", "kind": "storage", "cityId": "c1", "x": 12, "y": 12, "stock": { "food": 50 } }),
    );
}

fn w1(world: &mut WorldState) -> &mut csp_shared::world::Resident {
    &mut world.residents[0]
}

/// Mara's residents all at work on the farm by Work.
fn working(world: &mut WorldState) {
    for r in world.residents.iter_mut().filter(|x| x.owner.as_deref() == Some("r1")) {
        r.order = Some(from(json!({
            "kind": "workAt", "buildingId": "farm", "at": { "x": 3, "y": 3 }, "progress": 0
        })));
        r.script = Some(from(json!({ "scriptId": 1, "memory": { "workplaceId": "farm" } })));
    }
}

fn stable_memory() -> Value {
    json!({ "building": "stable", "at": { "x": 3, "y": 3 }, "siteId": "site" })
}

/// Mara's residents all building a stable's site where the farm was, lacking its Wood.
fn building_a_stable(world: &mut WorldState) {
    world.buildings.retain(|b| b.id != "farm");
    add(
        world,
        json!({ "id": "site", "kind": "stable", "cityId": null, "x": 3, "y": 3,
                "site": { "delivered": {}, "work": 0 } }),
    );
    for r in world.residents.iter_mut().filter(|x| x.owner.as_deref() == Some("r1")) {
        r.order = Some(from(json!({
            "kind": "build", "building": "stable", "at": { "x": 3, "y": 3 }, "siteId": "site"
        })));
        r.script = Some(from(json!({ "scriptId": 1, "memory": stable_memory() })));
    }
}

/// A stable of Mara's where the farm was, with two of her horses and Food in it.
fn stabled(world: &mut WorldState) {
    world.buildings = Vec::new();
    add(
        world,
        json!({ "id": "st", "kind": "stable", "cityId": "c1", "x": 3, "y": 3, "stock": { "food": 50 } }),
    );
    for id in ["h1", "h2"] {
        world.horses.push(from(json!({
            "id": id, "realmId": "r1", "cityId": null, "x": 3, "y": 3, "hunger": 100,
            "health": 100, "name": "Rowan", "stats": { "speed": 5, "strength": 5, "endurance": 5 },
            "bornAt": 0
        })));
    }
}

/// A finished stable where the farm was, holding `food`, with as many horses as fit.
fn feeding(world: &mut WorldState, food: f64) {
    world.buildings.retain(|b| b.id != "farm");
    add(
        world,
        json!({ "id": "stable", "kind": "stable", "cityId": "c1", "x": 3, "y": 3,
                "stock": { "food": food } }),
    );
    for i in 0..STABLE_CAPACITY as i32 {
        world.horses.push(from(json!({
            "id": format!("h{i}"), "realmId": "r1", "cityId": null, "x": 3 + (i % 3),
            "y": 3 + i / 3, "hunger": 100, "health": 100, "name": "Rowan",
            "stats": { "speed": 5, "strength": 5, "endurance": 5 }, "bornAt": 0
        })));
    }
}

/// A finished training ground where the farm was.
fn grounded(world: &mut WorldState) {
    world.buildings.retain(|b| b.id != "farm");
    add(world, json!({ "id": "g1", "kind": "trainingGround", "cityId": null, "x": 3, "y": 3 }));
}

/// Road sites on every tile of the line, w1 on the first, building it while `building`.
fn road_sites(world: &mut WorldState, building: bool) {
    for x in 4..=12 {
        add(
            world,
            json!({ "id": format!("rd{x}"), "kind": "road", "cityId": null, "x": x, "y": 10,
                    "site": { "delivered": {}, "work": 0 } }),
        );
    }
    let r = w1(world);
    (r.x, r.y) = (4.0, 10.0);
    if building {
        r.order = Some(from(json!({
            "kind": "build", "building": "road", "at": { "x": 4, "y": 10 }, "siteId": "rd4"
        })));
    }
}

/// Ten storages from the nearest, the farthest holding `good`, the others something else.
fn many_storages(
    world: &mut WorldState,
    good: &str,
    other: &str,
    place: impl Fn(i32) -> (i32, i32),
) {
    for i in 0..10 {
        let (x, y) = place(i);
        let stock = if i == 9 { json!({ good: 100 }) } else { json!({ other: 5 }) };
        add(
            world,
            json!({ "id": format!("s{i}"), "kind": "storage", "cityId": "c1", "x": x, "y": y,
                    "stock": stock }),
        );
    }
}

fn alarm_case(kind: &str, about: &str, realm: Option<&'static str>, tarring: bool) -> Case {
    let (kind, about) = (kind.to_string(), about.to_string());
    case(json!({}), move |world| {
        w1(world).carried.insert(Good::Spear, 1.0);
        if tarring {
            world
                .residents
                .iter_mut()
                .find(|r| r.id == "t1")
                .unwrap()
                .carried
                .insert(Good::Spear, 1.0);
        }
        let realm_id = match realm {
            Some(r) => json!(r),
            None => json!(world.residents.iter().find(|r| r.id == "t1").unwrap().owner),
        };
        let tick = world.tick;
        w1(world).script = Some(from(json!({
            "scriptId": 1, "task": "alarm", "memory": {},
            "alarm": { "kind": kind, "cityId": "c1", "about": about, "realmId": realm_id,
                       "x": 3, "y": 3, "tick": tick }
        })));
    })
}

fn south_half(_x: i32, y: i32) -> bool {
    y >= 8
}

#[test]
fn keeps_every_default_at_most_a_quarter_of_a_residents_budget() {
    let work = json!({ "workplaceId": "farm" });
    let route = json!({
        "carriageId": "k1", "from": { "x": 3, "y": 3 }, "to": { "x": 10, "y": 3 },
        "goods": ["food"], "returnGoods": ["wood"], "keepFood": 4
    });
    let tear_down = json!({ "buildingId": "farm" });
    let breeding = json!({ "stableId": "st", "horseIds": ["h1", "h2"] });
    let feed = json!({ "stableId": "stable" });
    let training = json!({ "groundId": "g1" });
    let line =
        json!({ "building": "road", "from": { "x": 4, "y": 10 }, "to": { "x": 12, "y": 10 } });
    let no_way: Vec<Value> = (0..10).map(|i| json!({ "x": i, "y": 8 })).collect();

    let mut cases: Vec<(Task, Vec<Case>)> = Vec::new();
    cases.push((
        Task::BuildLine,
        vec![
            // Starting: walking to the nearest tile.
            case(json!({ "line": line }), |_| {}),
            // At a site lacking stone: fetching from the nearest of many storages, the farthest
            // holding stone.
            case(json!({ "line": line, "at": { "x": 4, "y": 10 } }), |world| {
                road_sites(world, true);
                many_storages(world, "stone", "wood", |i| (3 + i, 13));
            }),
            // No stone anywhere and every tile laid out: looking for one, then ending.
            case(json!({ "line": line, "noStock": ["stone"] }), |world| road_sites(world, false)),
        ],
    ));
    cases.push((
        Task::Build,
        vec![
            // Starting: laying out, or turned down with the tile taken.
            case(json!({ "building": "stable", "at": { "x": 3, "y": 3 } }), |_| {}),
            // Away from the site: walking there.
            case(stable_memory(), |world| w1(world).x = 5.0),
            // Picking who fetches, from the nearest of many storages, the farthest holding Wood.
            case(stable_memory(), |world| {
                building_a_stable(world);
                many_storages(world, "wood", "stone", |i| (5 + 2 * i, 12));
            }),
            // Fetching: picking up at the storage.
            case(
                {
                    let mut m = stable_memory();
                    m["fetch"] =
                        json!({ "storageId": "s1", "goods": { "wood": 40 }, "step": "pickUp" });
                    m
                },
                |world| {
                    building_a_stable(world);
                    add(
                        world,
                        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 3, "y": 5 }),
                    );
                    w1(world).y = 5.0;
                },
            ),
            // Back with it: delivering.
            case(stable_memory(), |world| {
                building_a_stable(world);
                w1(world).carried = Stock::from([(Good::Food, 4.0), (Good::Wood, 40.0)]);
            }),
        ],
    ));
    let work_at = |world: &mut WorldState| {
        w1(world).order = Some(from(json!({
            "kind": "workAt", "buildingId": "farm", "at": { "x": 3, "y": 3 }, "progress": 0
        })));
    };
    cases.push((
        Task::Work,
        vec![
            // Starting work, and working on.
            case(work.clone(), |_| {}),
            case(work.clone(), work_at),
            // Away from the workplace: walking back.
            case(work.clone(), |world| w1(world).x = 5.0),
            // A full pile: picking who carries it, and the nearest of many storages.
            case(work.clone(), |world| {
                working(world);
                world
                    .piles
                    .push(from(json!({ "id": "p", "x": 3, "y": 3, "goods": { "food": 200 } })));
                for i in 0..10 {
                    add(
                        world,
                        json!({ "id": format!("s{i}"), "kind": "storage", "cityId": "c1",
                                "x": 5 + i, "y": 8 }),
                    );
                }
            }),
            // Carrying: ordering the load stored.
            case(
                {
                    let mut m = work.clone();
                    m["carry"] =
                        json!({ "storageId": "s1", "goods": ["food"], "load": { "food": 24 } });
                    m
                },
                |world| {
                    add(
                        world,
                        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 3, "y": 3 }),
                    );
                    w1(world).carried = Stock::from([(Good::Food, 30.0)]);
                },
            ),
        ],
    ));
    cases.push((
        Task::Haul,
        vec![
            // Starting the route, and on it.
            case(route.clone(), with_carriage),
            case(route.clone(), |world| {
                with_carriage(world);
                let order: OrderRequest = from(json!({
                    "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 10, "y": 3,
                    "goods": ["food"], "returnGoods": ["wood"], "keepFood": 4
                }));
                order_kinds().get("haul").unwrap().apply(world, &mara(), &order, None);
            }),
            // Not at the first stop, and no carriage: nothing to start.
            case(route.clone(), |world| w1(world).x = 5.0),
            case(route.clone(), |_| {}),
        ],
    ));
    cases.push((
        Task::TearDown,
        vec![
            // Starting, tearing down, the building gone, and standing idle after.
            case(tear_down.clone(), |_| {}),
            case(tear_down.clone(), |world| {
                w1(world).order = Some(from(json!({
                    "kind": "tearDown", "buildingId": "farm", "at": { "x": 3, "y": 3 }
                })));
            }),
            case(tear_down.clone(), |world| world.buildings = Vec::new()),
            case(
                {
                    let mut m = tear_down.clone();
                    m["done"] = json!(true);
                    m
                },
                |world| world.buildings = Vec::new(),
            ),
        ],
    ));
    let with = |m: &Value, k: &str, v: Value| {
        let mut m = m.clone();
        m[k] = v;
        m
    };
    cases.push((
        Task::Breed,
        vec![
            // Taking Food along, breeding, away from the stable, breeding, turned down, and done.
            case(breeding.clone(), stabled),
            case(with(&breeding, "fed", json!(true)), |world| {
                stabled(world);
                w1(world).x = 20.0;
            }),
            case(with(&with(&breeding, "fed", json!(true)), "started", json!(true)), |world| {
                stabled(world);
                w1(world).order = Some(from(json!({
                    "kind": "breed", "stableId": "st", "at": { "x": 3, "y": 3 }, "progress": 5,
                    "horseIds": ["h1", "h2"]
                })));
            }),
            case(with(&breeding, "fed", json!(true)), |_| {}),
            case(with(&breeding, "done", json!(true)), stabled),
        ],
    ));
    cases.push((
        Task::FeedStable,
        vec![
            // A full stable short of Food: counting its horses, fetching from the nearest of
            // many storages, the farthest holding Food.
            case(feed.clone(), |world| {
                feeding(world, 0.0);
                many_storages(world, "food", "stone", |i| (5 + 2 * i, 12));
            }),
            // Back with Food: storing it.
            case(with(&feed, "fetched", json!({ "before": 4 })), |world| {
                feeding(world, 0.0);
                w1(world).carried = Stock::from([(Good::Food, 30.0)]);
            }),
            // Enough, away from it: walking back.
            case(feed.clone(), |world| {
                feeding(world, 100.0);
                w1(world).x = 5.0;
            }),
        ],
    ));
    cases.push((
        Task::Train,
        vec![
            // Starting, training with a teacher there, away getting Food from the nearest of many
            // storages, and walking back.
            case(training.clone(), grounded),
            case(training.clone(), |world| {
                grounded(world);
                world.residents[0].order = Some(from(
                    json!({ "kind": "train", "buildingId": "g1", "learning": "strength" }),
                ));
                world.residents[1].order = Some(from(
                    json!({ "kind": "teach", "buildingId": "g1", "subject": "strength" }),
                ));
                world.residents[1].x = 4.0;
            }),
            case(training.clone(), |world| {
                grounded(world);
                world.residents[0].order =
                    Some(from(json!({ "kind": "train", "buildingId": "g1", "learning": null })));
                world.residents[0].carried = Stock::new();
                many_storages(world, "food", "stone", |i| (5 + 2 * i, 12));
            }),
            case(training.clone(), |world| {
                grounded(world);
                world.residents[0].x = 9.0;
            }),
        ],
    ));
    let explore =
        |memory: Value, prepare: fn(&mut WorldState), explored: Option<fn(i32, i32) -> bool>| {
            Case { memory, prepare: Box::new(prepare), explored }
        };
    fn with_food_on_hand(world: &mut WorldState) {
        stocked(world);
        w1(world).carried = Stock::from([(Good::Food, 20.0)]);
    }
    cases.push((
        Task::Explore,
        vec![
            // The south half explored, a storage with Food: setting out, out with Food to the
            // edge past ten tiles with no way, refilled and going back out, and short of the tile
            // walked to. With all explored: walking back to end.
            explore(json!({}), stocked, Some(south_half)),
            explore(json!({ "out": true, "skip": no_way }), with_food_on_hand, Some(south_half)),
            explore(
                json!({ "out": true, "fetching": true, "turnedAt": { "x": 3, "y": 9 }, "skip": [] }),
                with_food_on_hand,
                Some(south_half),
            ),
            explore(
                json!({ "out": true, "target": { "x": 5, "y": 8 }, "skip": no_way, "skipNext": 4 }),
                stocked,
                Some(south_half),
            ),
            explore(json!({ "out": true, "skip": [] }), stocked, None),
        ],
    ));
    cases.push((
        Task::Defend,
        vec![
            // Struck by Tobin's t1: armed, fighting back; unarmed, fleeing home; calm again.
            case(json!({}), |world| {
                w1(world).carried.insert(Good::Spear, 1.0);
                let tick = world.tick;
                w1(world).struck = Some(from(json!({ "by": "t1", "tick": tick })));
            }),
            case(json!({}), |world| {
                let tick = world.tick;
                w1(world).struck = Some(from(json!({ "by": "t1", "tick": tick })));
            }),
            case(json!({}), |world| {
                w1(world).struck = Some(from(json!({ "by": "t1", "tick": -1000 })));
            }),
        ],
    ));
    cases.push((
        Task::Alarm,
        vec![
            // Armed with Tobin's t1 on the hall: going after them, or at it already; they gone;
            // Tobin's t1 attacking, then gone; no alarm at all.
            alarm_case("occupied", "t1", None, true),
            alarm_case("occupied", "nobody", Some("nobody"), false),
            alarm_case("attacked", "t1", None, false),
            alarm_case("attacked", "nobody", Some("nobody"), false),
            case(json!({}), |_| {}),
        ],
    ));
    for task in TASKS {
        let (_, list) =
            cases.iter().find(|(t, _)| *t == task).unwrap_or_else(|| panic!("{task:?}"));
        for (n, c) in list.iter().enumerate() {
            let s = steps(task, c);
            assert!(s as f64 <= SCRIPT_STEP_BUDGET / 4.0, "{task:?} case {n} took {s} steps");
        }
    }
}

#[test]
fn flags_a_resident_running_an_unedited_default_that_ran_out_of_it() {
    let mut g = game();
    for follows_default in [true, false] {
        g.world.residents[0].script = Some(from(json!({ "scriptId": 1, "memory": {} })));
        g.scripts.library.insert(
            1,
            csp_sim::scripts::RunnableScript {
                user_id: MARA,
                name: "loop".into(),
                version: 1,
                source: "while (true) { }".into(),
                follows_default,
                task: None,
            },
        );
        let violations = g.scripts.run_all(&mut g.world, &mut g.scratch);
        let names: Vec<&str> = violations.iter().map(|v| v.invariant.as_str()).collect();
        assert_eq!(names, if follows_default { vec!["default-scripts-in-budget"] } else { vec![] });
    }
}
