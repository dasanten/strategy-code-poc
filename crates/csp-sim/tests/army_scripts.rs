//! `army-scripts.test.ts`, one test per `it`: scripts for armies (`CONTEXT.md`: Running a script,
//! Army). The script library is the test host's (`tasks_support`), where the TypeScript keeps it
//! in a database; a script saved with a syntax error has no version that can run, as there.

mod goods_support;
mod tasks_support;

use csp_lang::interpreter::Host as _;
use csp_shared::balance::{SCRIPT_REALM_STEP_BUDGET, SCRIPT_STEP_BUDGET};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{Army, ArmyOrder, OrderRequest};
use csp_sim::armies::ArmyOrderKind;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::OrderReply;
use csp_sim::script_api::ARMY_SCRIPT_API;
use csp_sim::script_bindings::{
    army_script_order_kinds, army_script_requests_sound, bind_script, ScriptContext,
};
use csp_sim::script_runner::running_scripts_sound;
use csp_sim::sight::{entities_in_sight, sight_of};
use csp_sim::world_index::WorldIndex;
use goods_support::{drawn_resident, open, realm};
use serde_json::{json, Value};
use tasks_support::{ack, events, from, reason, Game};

const SIZE: i32 = 64;
const MARA: u64 = 1;

fn sender() -> OrderSender {
    OrderSender::player(MARA, "Mara")
}

/// Mara's realm r1 with residents a0, a1, a2 side by side from (10, 10), and the army "North" of
/// a0 and a1. Realm r2 has b0 at (14, 10), in sight.
fn setup() -> Game {
    let terrain = open(SIZE);
    let mut world = csp_sim::world::create_world(&terrain, 1);
    world.realms.push(realm("r1", MARA, "a0"));
    world.realms.push(realm("r2", MARA + 1, "b0"));
    let mut add = |id: &str, owner: &str, x: f64| {
        let seed = world.residents.len() as f64 + 1.0;
        let mut r = drawn_resident(seed, id, Some(owner), None, x, 10.0);
        r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
        r.lifespan = 60.0;
        world.residents.push(r);
    };
    for i in 0..3 {
        add(&format!("a{i}"), "r1", 10.0 + f64::from(i));
    }
    add("b0", "r2", 14.0);
    world.armies.push(army("army1", "North", "r1", &["a0", "a1"]));
    let senders = vec![sender(), OrderSender::player(MARA + 1, "Mara")];
    Game::new(world, terrain, senders)
}

fn army(id: &str, name: &str, realm_id: &str, members: &[&str]) -> Army {
    from(
        json!({ "id": id, "name": name, "realmId": realm_id, "memberIds": members, "order": null }),
    )
}

fn the_army(g: &Game) -> &Army {
    g.world.armies.iter().find(|a| a.id == "army1").unwrap()
}

fn create(g: &Game, name: &str, source: &str) -> u64 {
    g.tasks.host.create_script(MARA, name, source)
}

/// An order from Mara, answered but not applied (`order`).
fn order(g: &mut Game, o: Value) -> OrderReply {
    g.queue.receive(&g.world, &sender(), &json!("q"), &o)
}

/// Gives the army the run-script order and applies it, as the next tick would (`giveScript`).
fn give_script(g: &mut Game, script_id: u64) {
    let o = json!({ "kind": "armyRunScript", "armyId": "army1", "scriptId": script_id });
    assert_eq!(order(g, o), ack());
    g.queue.apply_all(&mut g.world);
}

fn script_json(g: &Game) -> Value {
    serde_json::to_value(&the_army(g).script).unwrap()
}

fn memory(g: &Game) -> Value {
    script_json(g)["memory"].clone()
}

fn order_kind(o: &Option<ArmyOrder>) -> Value {
    serde_json::to_value(o).unwrap()["kind"].clone()
}

// the run-script order for an army

#[test]
fn is_only_for_the_players_own_armies_and_scripts_that_can_run() {
    let mut g = setup();
    let s = create(&g, "idle", "let x = 1");
    let broken = create(&g, "broken", "let = ");
    g.world.armies.push(army("army2", "Theirs", "r2", &["b0"]));
    let run = |g: &mut Game, script_id: u64, army_id: &str| {
        order(g, json!({ "kind": "armyRunScript", "armyId": army_id, "scriptId": script_id }))
    };
    assert_eq!(run(&mut g, s, "army1"), ack());
    assert_eq!(reason(&run(&mut g, s, "army2")).as_deref(), Some("not one of your armies"));
    assert_eq!(reason(&run(&mut g, s, "nope")).as_deref(), Some("not one of your armies"));
    for id in [broken, 999] {
        assert!(reason(&run(&mut g, id, "army1")).is_some(), "script {id}");
    }
}

#[test]
fn starts_from_fresh_memory_ends_the_armys_order_keeps_its_members_and_any_other_army_order_ends_it(
) {
    let mut g = setup();
    let s = create(&g, "idle", "memory.n = 1");
    order(&mut g, json!({ "kind": "armyWalkTo", "armyId": "army1", "x": 30, "y": 10 }));
    g.queue.apply_all(&mut g.world);
    g.step();
    let o = serde_json::to_value(&g.world.residents[0].order).unwrap();
    assert_eq!(o["kind"], "walkTo", "{o}");

    give_script(&mut g, s);
    assert!(the_army(&g).order.is_none());
    assert_eq!(script_json(&g), json!({ "scriptId": s, "memory": {} }));
    assert_eq!(the_army(&g).member_ids, ["a0", "a1"]);
    assert!(g.world.residents[0].order.is_none());

    order(&mut g, json!({ "kind": "armyGuard", "armyId": "army1", "x": 12, "y": 10 }));
    g.queue.apply_all(&mut g.world);
    assert!(the_army(&g).script.is_none());
    assert_eq!(order_kind(&the_army(&g).order), "guard");
}

#[test]
fn is_not_ended_by_a_residents_order() {
    let mut g = setup();
    let s = create(&g, "idle", "memory.n = 1");
    give_script(&mut g, s);
    order(&mut g, json!({ "kind": "walkTo", "residentId": "a2", "x": 20, "y": 10 }));
    g.queue.apply_all(&mut g.world);
    assert_eq!(the_army(&g).script.as_ref().map(|s| s.script_id), Some(s));
}

// an army's script

#[test]
fn runs_once_a_tick_with_the_armys_memory_and_gives_army_orders_the_members_carry_out() {
    let mut g = setup();
    // Walk the army to (20, 10); once there, guard (11, 12); count the ticks it ran.
    let s = create(
        &g,
        "march",
        r#"
        if (memory.n == null) { memory.n = 0 }
        memory.n = memory.n + 1
        if (me.order == null) {
          if (memory.leg == null) { memory.leg = 1; memory.answer = walkTo(20, 10) }
          else if (memory.leg == 1) { memory.leg = 2; guard(11, 12) }
        }"#,
    );
    give_script(&mut g, s);
    let mut ticks = 0;
    while ticks < 3000 && order_kind(&the_army(&g).order) != "guard" {
        let found = g.run_scripts();
        assert!(found.is_empty(), "{found:?}");
        g.step();
        ticks += 1;
    }
    assert_eq!(order_kind(&the_army(&g).order), "guard");
    let m = memory(&g);
    assert_eq!(m["n"].as_f64(), Some(ticks as f64), "{m}");
    assert_eq!(m["leg"].as_f64(), Some(2.0), "{m}");
    assert_eq!(m.get("answer"), Some(&Value::Null), "{m}");
    let logged: Vec<Value> = g
        .world
        .events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .filter(|e| e["kind"].as_str().unwrap().starts_with("script"))
        .collect();
    assert_eq!(logged, Vec::<Value>::new());
    let (a0, a1) = (&g.world.residents[0], &g.world.residents[1]);
    // They got there together and are still the army's.
    assert!((a0.x - a1.x).abs() <= 2.0);
    assert_eq!(the_army(&g).member_ids, ["a0", "a1"]);
}

#[test]
fn sees_the_army_as_me_with_its_members_and_is_told_why_an_order_is_turned_down() {
    let mut g = setup();
    let s = create(
        &g,
        "look",
        r#"
        memory.me = [me.id, me.name, me.members[1].id, me.members[0].age > 19, me.memberIds[0]]
        memory.own = attack("a2")
        memory.out = follow("a0")
        memory.ok = attack("b0")"#,
    );
    give_script(&mut g, s);
    g.run_scripts();
    assert_eq!(
        memory(&g),
        json!({
            "me": ["army1", "North", "a1", true, "a0"],
            "own": "that is one of your own residents",
            "out": "that is one of the army",
            "ok": null,
        })
    );
    let o = serde_json::to_value(&the_army(&g).order).unwrap();
    assert_eq!(o["kind"], "attack", "{o}");
    assert_eq!(o["targetId"], "b0");
}

#[test]
fn logs_trouble_naming_the_army_and_ends_when_the_script_is_deleted() {
    let mut g = setup();
    let s = create(&g, "oops", "let x = nothing + 1");
    give_script(&mut g, s);
    g.run_scripts();
    let all: Vec<Value> = g.world.events.iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    assert_eq!(all.len(), 1, "{all:?}");
    assert_eq!(all[0]["kind"], "scriptError");
    assert_eq!(all[0]["armyId"], "army1");
    assert_eq!(all[0]["name"], "North");
    assert_eq!(all[0]["scriptId"], json!(s));
    g.tasks.host.delete_script(s);
    g.run_scripts();
    assert!(the_army(&g).script.is_none());
    let last = serde_json::to_value(g.world.events.last().unwrap()).unwrap();
    assert_eq!(last["kind"], "scriptEnded");
    assert_eq!(last["armyId"], "army1");
}

#[test]
fn shares_the_realms_step_budget_with_its_residents_scripts() {
    let mut g = setup();
    let lp = create(&g, "loop", "while (true) { }");
    // Enough residents' scripts to use up the realm's budget, and the army's too.
    let count = (SCRIPT_REALM_STEP_BUDGET / SCRIPT_STEP_BUDGET) as usize;
    for i in 0..count {
        let id = format!("c{i}");
        let r = drawn_resident(100.0 + i as f64, &id, Some("r1"), None, 20.0, 20.0);
        g.world.residents.push(r);
        order(&mut g, json!({ "kind": "runScript", "residentId": id, "scriptId": lp }));
    }
    give_script(&mut g, lp);
    g.run_scripts();
    let cut: Vec<Value> = events(&g.world, "scriptOutOfSteps")
        .into_iter()
        .filter(|e| e["realm"] == json!(true))
        .collect();
    assert_eq!(cut.len(), 1, "{cut:?}");
}

#[test]
fn is_seen_by_its_player_as_which_script_it_runs_not_its_memory() {
    let mut g = setup();
    let s = create(&g, "idle", "let x = 1");
    give_script(&mut g, s);
    let army = g.world.armies.iter_mut().find(|a| a.id == "army1").unwrap();
    army.script.as_mut().unwrap().memory = from(json!({ "secret": 1 }));
    let index = WorldIndex::new(&g.world, SIZE);
    let seen = entities_in_sight(&g.world, &index, Some("r1"), None);
    let seen: Vec<Value> = seen.iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    let army = seen.iter().find(|e| e["is"] == "army").expect("the army seen");
    assert_eq!(army["id"], "army1");
    assert_eq!(army["script"]["scriptId"], json!(s));
    assert!(!army.to_string().contains("secret"), "{army}");
}

#[test]
fn ends_with_its_army() {
    let mut g = setup();
    let s = create(&g, "count", "memory.n = 1");
    give_script(&mut g, s);
    order(&mut g, json!({ "kind": "disbandArmy", "armyId": "army1" }));
    g.queue.apply_all(&mut g.world);
    assert!(g.world.armies.is_empty());
    assert_eq!(g.run_scripts(), vec![]);
}

// army script bindings

#[test]
fn bind_every_name_in_the_army_script_api_every_army_order_but_forming_and_disbanding_and_adding_and_removing_waypoints(
) {
    let g = setup();
    let index = WorldIndex::new(&g.world, SIZE);
    let sender = sender();
    let seen = || entities_in_sight(&g.world, &index, Some("r1"), None);
    let eyes = || sight_of(&g.world, &index, "r1", None);
    let explored = |_: i32, _: i32| true;
    let kinds = csp_sim::orders::order_kinds();
    let ctx = ScriptContext {
        world: &g.world,
        terrain: &g.terrain,
        index: &index,
        sender: &sender,
        resident_id: None,
        army_id: Some("army1"),
        memory: csp_lang::Object::new(),
        seen: &seen,
        places: None,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: None,
    };
    let mut bound = bind_script(ctx).unwrap();
    // Every name of the army API is bound, and none of the residents' API that it lacks.
    for b in ARMY_SCRIPT_API {
        assert!(bound.global(b.name).is_some(), "{}", b.name);
    }
    for b in csp_sim::script_api::SCRIPT_API {
        if !ARMY_SCRIPT_API.iter().any(|a| a.name == b.name) {
            assert!(bound.global(b.name).is_none(), "{}", b.name);
        }
    }
    // `armyOrders` but forming and disbanding.
    let commands = ["armyWalkTo", "armyGuard", "armyAttack", "armyFollow", "armyStop"];
    assert!(commands.iter().all(|k| ArmyOrderKind::of(k).is_some()));
    let mut want: Vec<&str> = commands.to_vec();
    want.extend(["addWaypoint", "removeWaypoint"]);
    want.sort();
    let mut kinds = army_script_order_kinds();
    kinds.sort();
    assert_eq!(kinds, want);
}

#[test]
fn invariant_an_armys_script_requests_only_its_own_army_orders() {
    let g = setup();
    let kinds = csp_sim::orders::order_kinds();
    let request = |v: Value| -> OrderRequest { from(v) };
    let bad = [
        json!({ "kind": "walkTo", "residentId": "a0", "x": 1, "y": 1 }),
        json!({ "kind": "armyWalkTo", "armyId": "army9", "x": 1, "y": 1 }),
        json!({ "kind": "disbandArmy", "armyId": "army1" }),
        json!({ "kind": "armyAttack", "armyId": "army1", "targetId": "a2" }),
    ];
    let found: Vec<_> = bad
        .iter()
        .flat_map(|o| {
            army_script_requests_sound(
                &g.world,
                &g.terrain,
                &sender(),
                "army1",
                &[request(o.clone())],
                &kinds,
            )
        })
        .collect();
    assert_eq!(found.len(), bad.len(), "{found:?}");
    let good = request(json!({ "kind": "armyWalkTo", "armyId": "army1", "x": 1, "y": 1 }));
    assert_eq!(
        army_script_requests_sound(&g.world, &g.terrain, &sender(), "army1", &[good], &kinds),
        vec![]
    );
}

#[test]
fn invariant_an_armys_running_script_is_sound() {
    let mut g = setup();
    let tick = g.world.tick;
    let army = g.world.armies.iter_mut().find(|a| a.id == "army1").unwrap();
    army.script = Some(from(json!({ "scriptId": 0, "memory": {}, "errorLoggedAt": tick + 5 })));
    let messages: Vec<String> =
        running_scripts_sound(&g.world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "army army1 runs script 0".to_string(),
            format!("army army1 logged script trouble at tick {}, after {tick}", tick + 5),
        ]
    );
}
