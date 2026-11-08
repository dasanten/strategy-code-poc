//! `script-runner.test.ts`. The TypeScript keeps the scripts in a database (`createScript`,
//! `saveScript`, `deleteScript`); here [`Library`] stands in for it with the same rules: a version
//! that doesn't parse never becomes active. The cases over the realm log, budgets, memory, errors
//! and the script log are ported one to one; the sight-per-phase and game-error cases need the
//! socket layer and a failing host, and are left to T86.14.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::*;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::tests::resident;
use crate::script_log::script_logs_sound;
use crate::walking::Walking;
use crate::world::{create_world, step_world};
use csp_shared::balance::{DOING_MAX_LENGTH, SCRIPT_LOG_INTERVAL, SCRIPT_LOG_LINES};
use csp_shared::terrain::Terrain;
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{Realm, RealmEvent};
use serde_json::json;

const SIZE: i32 = 64;
const MARA: u64 = 7;

/// The script library (`scripts.ts` over the database), in memory.
#[derive(Default)]
struct Library {
    scripts: Mutex<HashMap<u64, RunnableScript>>,
    next: Mutex<u64>,
}

impl Library {
    /// A new script with its first version (`createScript`); one that doesn't parse has no
    /// version that can run.
    fn create(&self, user_id: u64, name: &str, source: &str) -> u64 {
        let mut next = self.next.lock().unwrap();
        *next += 1;
        let id = *next;
        if parse(source).is_ok() {
            let script = RunnableScript {
                user_id,
                name: name.into(),
                version: 1,
                source: source.into(),
                follows_default: false,
                task: None,
            };
            self.scripts.lock().unwrap().insert(id, script);
        }
        id
    }

    /// A new version, active at once when it parses (`saveScript`).
    fn save(&self, id: u64, source: &str) {
        if parse(source).is_err() {
            return;
        }
        let mut scripts = self.scripts.lock().unwrap();
        let s = scripts.get_mut(&id).unwrap();
        s.version += 1;
        s.source = source.into();
    }

    fn delete(&self, id: u64) {
        self.scripts.lock().unwrap().remove(&id);
    }
}

struct Host(Arc<Library>);

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        self.0.scripts.lock().unwrap().get(&id).cloned()
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        Some(OrderSender::player(user_id, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    lib: Arc<Library>,
    orders: OrderQueue,
    runner: ScriptRunner,
    scratch: Scratch,
}

fn sender() -> OrderSender {
    OrderSender::player(MARA, "Mara")
}

/// Mara's realm r1 with `count` grown residents a0, a1, … side by side from (10, 10).
fn setup(count: usize) -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    let realm: Realm =
        serde_json::from_value(json!({ "id": "r1", "userId": MARA, "leaderId": "a0" })).unwrap();
    world.realms.push(realm);
    for i in 0..count {
        let mut r = resident(&format!("a{i}"), Some("r1"), 10.0 + i as f64, 10.0);
        r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
        r.lifespan = 60.0;
        world.residents.push(r);
    }
    let lib = Arc::new(Library::default());
    let terrain = Arc::new(terrain);
    let host: Arc<dyn ScriptHost + Send + Sync> = Arc::new(Host(lib.clone()));
    let mut kinds = order_kinds();
    kinds.insert("runScript", RunScriptOrder { host: host.clone() });
    let orders = OrderQueue::new(kinds.clone(), Some(terrain.clone()));
    let runner = ScriptRunner::new(terrain.clone(), host, kinds);
    Setup { world, terrain, lib, orders, runner, scratch: Scratch::default() }
}

impl Setup {
    fn give_script(&mut self, script_id: u64, ids: &[&str]) {
        for id in ids {
            let order = json!({ "kind": "runScript", "residentId": id, "scriptId": script_id });
            assert_eq!(
                self.orders.receive(&self.world, &sender(), &json!("q"), &order),
                OrderReply::Ack { request_id: "q".into() }
            );
        }
        self.orders.apply_all(&mut self.world);
    }

    fn run(&mut self, check: bool) -> Vec<InvariantViolation> {
        self.runner.run_all(&mut self.world, &mut self.scratch, check)
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn memory(&self, id: &str) -> Option<Json> {
        self.r(id).script.as_ref().map(|s| Json::Object(s.memory.clone()))
    }

    fn script_events(&self) -> Vec<&RealmEvent> {
        self.world
            .events
            .iter()
            .filter(|e| {
                serde_json::to_value(&e.what).unwrap()["kind"]
                    .as_str()
                    .is_some_and(|k| k.starts_with("script"))
            })
            .collect()
    }
}

fn kind_of(e: &RealmEvent) -> String {
    serde_json::to_value(e).unwrap()["kind"].as_str().unwrap().to_string()
}

#[test]
fn the_run_script_order_is_only_for_the_players_own_residents_and_scripts_that_can_run() {
    let mut s = setup(1);
    let ok = s.lib.create(MARA, "idle", "let x = 1");
    let broken = s.lib.create(MARA, "broken", "let = ");
    let theirs = s.lib.create(8, "theirs", "let x = 1");
    let mut order = |s: &mut Setup, id: u64, who: &str| {
        let o = json!({ "kind": "runScript", "residentId": who, "scriptId": id });
        s.orders.receive(&s.world, &sender(), &json!("q"), &o)
    };
    assert_eq!(order(&mut s, ok, "a0"), OrderReply::Ack { request_id: "q".into() });
    assert_eq!(
        order(&mut s, ok, "nobody"),
        OrderReply::Rejected { request_id: "q".into(), reason: "not one of your residents".into() }
    );
    for id in [broken, theirs, 999] {
        assert!(matches!(order(&mut s, id, "a0"), OrderReply::Rejected { .. }));
    }
}

#[test]
fn the_run_script_order_starts_from_fresh_memory_ends_the_order_before_it_and_is_ended_by_any_other(
) {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "count", "memory.n = 1");
    s.world.residents[0].order = serde_json::from_value(
        json!({ "kind": "walkTo", "target": { "x": 30, "y": 30 }, "path": null, "progress": 0 }),
    )
    .unwrap();
    s.give_script(id, &["a0"]);
    assert!(s.r("a0").order.is_none());
    assert_eq!(
        s.r("a0").script,
        Some(serde_json::from_value(json!({ "scriptId": id, "memory": {} })).unwrap())
    );

    let walk = json!({ "kind": "walkTo", "residentId": "a0", "x": 20, "y": 10 });
    s.orders.receive(&s.world, &sender(), &json!("q"), &walk);
    s.orders.apply_all(&mut s.world);
    s.run(false);
    assert!(s.r("a0").script.is_none());
    assert!(matches!(s.r("a0").order, Some(ResidentOrder::WalkTo(_))));
}

#[test]
fn keeps_memory_between_ticks() {
    let mut s = setup(1);
    let id = s.lib.create(
        MARA,
        "count",
        "if (memory.n == null) { memory.n = 0 } memory.n = memory.n + 1",
    );
    s.give_script(id, &["a0"]);
    for _ in 0..3 {
        s.run(false);
        s.world.tick += 1;
    }
    assert_eq!(s.memory("a0"), Some(json!({ "n": 3 })));
    assert_eq!(running_scripts_sound(&s.world), vec![]);
}

#[test]
fn hands_over_to_a_built_in_order_and_takes_control_back_when_it_is_done() {
    let mut s = setup(1);
    // Walk to (13, 10); once there, walk back to (10, 10); then stay.
    let source = "
        if (me.order == null) {
          if (memory.leg == null) { memory.leg = 1; walkTo(13, 10) }
          else if (memory.leg == 1) { memory.leg = 2; walkTo(10, 10) }
        }";
    let id = s.lib.create(MARA, "there and back", source);
    s.give_script(id, &["a0"]);
    let mut walking = Walking::new(s.terrain.clone());
    let mut seen = Vec::new();
    for _ in 0..200 {
        let a0 = s.r("a0");
        if a0.script.as_ref().is_some_and(|x| x.memory.get("leg") == Some(&json!(2)))
            && a0.order.is_none()
        {
            break;
        }
        assert_eq!(s.run(true), vec![]);
        let terrain = s.terrain.clone();
        step_world(&mut s.world, &terrain, &mut s.scratch, Some(&mut walking), None);
        seen.push((s.r("a0").x, s.r("a0").y));
    }
    assert!(seen.contains(&(13.0, 10.0)));
    assert_eq!((s.r("a0").x, s.r("a0").y), (10.0, 10.0));
    assert!(s.r("a0").order.is_none());
    assert_eq!(s.memory("a0"), Some(json!({ "leg": 2 })));
}

#[test]
fn ends_when_the_script_calls_end_and_the_resident_stands_idle() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "one walk", "walkTo(13, 10)\nend()");
    s.give_script(id, &["a0"]);
    s.run(true);
    assert!(s.r("a0").script.is_none());
    assert!(s.r("a0").order.is_none());
    // Without a reason, the realm log notes nothing.
    assert!(s.script_events().is_empty());
}

#[test]
fn notes_the_reason_end_reason_gives_in_the_realm_log_each_time() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "Work", "end(\"no workplace here\")");
    s.give_script(id, &["a0"]);
    assert_eq!(s.run(true), vec![]);
    assert!(s.r("a0").script.is_none());
    let events: Vec<Json> =
        s.script_events().iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["kind"], "scriptStopped");
    assert_eq!(events[0]["residentId"], "a0");
    assert_eq!(events[0]["scriptId"], id);
    assert_eq!(events[0]["script"], "Work");
    assert_eq!(events[0]["reason"], "no workplace here");
    // One note for each end: running it again notes it again, not rate-limited like errors.
    s.give_script(id, &["a0"]);
    s.run(false);
    assert_eq!(s.script_events().iter().filter(|e| kind_of(e) == "scriptStopped").count(), 2);
}

#[test]
fn picks_up_a_saved_change_on_the_next_tick_and_ends_when_the_script_is_deleted() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "role", "memory.role = \"miner\"");
    s.give_script(id, &["a0"]);
    s.run(false);
    assert_eq!(s.memory("a0"), Some(json!({ "role": "miner" })));
    s.lib.save(id, "memory.role = \"farmer\"");
    s.run(false);
    assert_eq!(s.memory("a0"), Some(json!({ "role": "farmer" })));
    // A version with syntax errors never becomes active, so the last good one keeps running.
    s.lib.save(id, "memory.role = ");
    s.run(false);
    assert_eq!(s.memory("a0"), Some(json!({ "role": "farmer" })));
    s.lib.delete(id);
    s.run(false);
    assert!(s.r("a0").script.is_none());
    let events = s.script_events();
    assert_eq!(events.len(), 1);
    assert_eq!(kind_of(events[0]), "scriptEnded");
}

#[test]
fn gives_each_resident_its_own_step_budget_and_the_realm_one_together() {
    let count = (SCRIPT_REALM_STEP_BUDGET / SCRIPT_STEP_BUDGET) as usize + 2;
    let mut s = setup(count);
    let id = s.lib.create(MARA, "busy", "memory.ran = tick; while (true) {}");
    let ids: Vec<String> = s.world.residents.iter().map(|r| r.id.clone()).collect();
    s.give_script(id, &ids.iter().map(String::as_str).collect::<Vec<_>>());
    // Each tick two residents skip, and who skips rotates: over `count` ticks everyone runs.
    let mut ran = HashSet::new();
    for _ in 0..count {
        s.run(false);
        let tick = json!(s.world.tick);
        let now: Vec<String> = s
            .world
            .residents
            .iter()
            .filter(|r| r.script.as_ref().is_some_and(|x| x.memory.get("ran") == Some(&tick)))
            .map(|r| r.id.clone())
            .collect();
        assert_eq!(now.len(), count - 2);
        ran.extend(now);
        s.world.tick += 1;
    }
    assert_eq!(ran.len(), count);
    // Out of steps is a warning in the realm log: once per resident, rate-limited.
    let warnings: Vec<Json> = s
        .script_events()
        .iter()
        .filter(|e| kind_of(e) == "scriptOutOfSteps")
        .map(|e| serde_json::to_value(e).unwrap())
        .collect();
    let who: HashSet<String> =
        warnings.iter().map(|w| w["residentId"].as_str().unwrap().to_string()).collect();
    assert_eq!(who.len(), count);
    assert_eq!(warnings.len(), count);
    assert!(warnings.iter().any(|w| w["realm"] == true));
}

#[test]
fn logs_runtime_errors_in_the_realm_log_at_most_once_a_minute_and_keeps_what_it_requested() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "oops", "walkTo(12, 10)\nlet x = null\nx.a");
    s.give_script(id, &["a0"]);
    for _ in 0..=(SCRIPT_LOG_INTERVAL as u64) {
        s.run(false);
        s.world.tick += 1;
    }
    assert!(matches!(s.r("a0").order, Some(ResidentOrder::WalkTo(_))));
    let errors: Vec<Json> =
        s.script_events().iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0]["kind"], "scriptError");
    assert_eq!(errors[0]["residentId"], "a0");
    assert_eq!(errors[0]["scriptId"], id);
    assert_eq!(errors[0]["message"], "Can't read \"a\" of null");
    assert_eq!(errors[0]["line"], 3.0);
    assert_eq!(errors[0]["tick"], 0);
    assert_eq!(errors[1]["tick"], SCRIPT_LOG_INTERVAL as u64);
}

#[test]
fn keeps_its_last_error_until_another_version_runs() {
    let mut s = setup(1);
    // Fails on its second tick only.
    let source = "if (memory.n == null) { memory.n = 0 }\nmemory.n = memory.n + 1\nif (memory.n == 2) { null.x }";
    let id = s.lib.create(MARA, "once", source);
    s.give_script(id, &["a0"]);
    s.run(false);
    assert!(s.r("a0").script.as_ref().unwrap().last_error.is_none());
    s.world.tick = 5;
    s.run(false);
    let last_error = ScriptRunError {
        message: "Can't read \"x\" of null".into(),
        line: Some(3.0),
        column: Some(22.0),
        tick: 5.0,
        version: 1,
    };
    assert_eq!(s.r("a0").script.as_ref().unwrap().last_error, Some(last_error.clone()));
    // Runs that go well after it leave it there.
    s.world.tick = 6;
    s.run(true);
    assert_eq!(s.r("a0").script.as_ref().unwrap().last_error, Some(last_error.clone()));
    assert_eq!(running_scripts_sound(&s.world), vec![]);

    s.lib.save(id, &format!("{source}\n"));
    s.run(false);
    assert!(s.r("a0").script.as_ref().unwrap().last_error.is_none());
    // The memory it couldn't keep is an error too, with no line.
    s.lib.save(id, "memory.f = fn() {}");
    s.run(false);
    let e = s.r("a0").script.as_ref().unwrap().last_error.clone().unwrap();
    assert!(e.message.contains("functions"));
    assert_eq!((e.line, e.tick, e.version), (None, 6.0, 3));
}

#[test]
fn keeps_the_steps_it_used_last_tick_and_whether_it_ran_out_of_its_own_or_the_realms() {
    let count = (SCRIPT_REALM_STEP_BUDGET / SCRIPT_STEP_BUDGET) as usize + 1;
    let mut s = setup(count);
    let light = s.lib.create(MARA, "light", "memory.n = 1");
    let busy = s.lib.create(MARA, "busy", "while (true) {}");
    s.give_script(light, &["a0"]);
    let rest: Vec<String> = s.world.residents[1..].iter().map(|r| r.id.clone()).collect();
    s.give_script(busy, &rest.iter().map(String::as_str).collect::<Vec<_>>());
    s.run(true);
    let a0 = s.r("a0").script.as_ref().unwrap().last_run.clone().unwrap();
    assert!(a0.steps > 0.0 && a0.steps < SCRIPT_STEP_BUDGET);
    assert!(a0.out_of_steps.is_none());
    let busy_runs: Vec<ScriptRunSteps> = s.world.residents[1..]
        .iter()
        .map(|r| r.script.as_ref().unwrap().last_run.clone().unwrap())
        .collect();
    // The realm's budget runs out: one is cut short or skipped, the rest use their own up.
    assert_eq!(
        busy_runs.iter().filter(|r| r.out_of_steps == Some(OutOfSteps::Own)).count(),
        count - 2
    );
    assert_eq!(busy_runs.iter().filter(|r| r.out_of_steps == Some(OutOfSteps::Realm)).count(), 1);
    for r in busy_runs.iter().filter(|r| r.out_of_steps == Some(OutOfSteps::Own)) {
        assert_eq!(r.steps, SCRIPT_STEP_BUDGET);
    }
    assert_eq!(running_scripts_sound(&s.world), vec![]);
}

#[test]
fn caps_memory_a_run_that_leaves_too_much_keeps_the_memory_from_before() {
    let mut s = setup(1);
    let source = format!(
        "if (memory.n == null) {{ memory.n = 0 }} else {{ let s = \"x\"; while (s.length < {}) {{ s = s + s }} memory.big = s }}",
        SCRIPT_MEMORY_MAX
    );
    let id = s.lib.create(MARA, "hoard", &source);
    s.give_script(id, &["a0"]);
    s.run(false);
    s.run(false);
    assert_eq!(s.memory("a0"), Some(json!({ "n": 0 })));
    let events: Vec<Json> =
        s.script_events().iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["kind"], "scriptError");
    assert!(events[0]["message"].as_str().unwrap().contains("at most"));
}

#[test]
fn keeps_no_functions_or_values_that_hold_themselves_in_memory() {
    let plain = Value::from_json(&json!({ "a": [1, { "b": "c" }], "d": null }));
    let Value::Object(plain) = plain else { panic!() };
    assert_eq!(
        Json::Object(keep_memory(&plain).unwrap()),
        json!({ "a": [1, { "b": "c" }], "d": null })
    );
    let looped = Object::new();
    looped.borrow_mut().insert("self", Value::Object(looped.clone()));
    assert!(keep_memory(&looped).unwrap_err().contains("holds itself"));
    let f = Object::new();
    f.borrow_mut().insert("f", Value::native("f", 0, 0));
    assert!(keep_memory(&f).unwrap_err().contains("functions"));
}

#[test]
fn stops_for_a_resident_who_no_longer_belongs_to_the_scripts_player() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "count", "memory.n = 1");
    s.give_script(id, &["a0"]);
    let realm: Realm =
        serde_json::from_value(json!({ "id": "r2", "userId": 8, "leaderId": "a0" })).unwrap();
    s.world.realms.push(realm);
    s.world.residents[0].owner = Some("r2".into());
    s.run(false);
    assert!(s.r("a0").script.is_none());
}

#[test]
fn the_script_log_keeps_what_log_and_end_reason_give_with_the_tick() {
    let mut s = setup(1);
    let id = s.lib.create(MARA, "talky", "log(\"  first  \")\nlog(\"\")\nend(\"done here\")");
    s.give_script(id, &["a0"]);
    s.world.tick = 4;
    s.run(false);
    let log: Vec<(f64, String)> =
        s.r("a0").script_log.iter().flatten().map(|l| (l.tick, l.text.clone())).collect();
    assert_eq!(log, [(4.0, "first".to_string()), (4.0, "done here".to_string())]);
    assert_eq!(script_logs_sound(&s.world), vec![]);
}

#[test]
fn the_script_log_drops_the_oldest_lines_once_full_and_cuts_long_ones() {
    let mut s = setup(1);
    let long = "x".repeat(DOING_MAX_LENGTH as usize + 5);
    let id = s.lib.create(MARA, "chatty", &format!("log(\"line \" + tick)\nlog(\"{long}\")"));
    s.give_script(id, &["a0"]);
    for _ in 0..(SCRIPT_LOG_LINES as u64) {
        s.run(false);
        s.world.tick += 1;
    }
    let log = s.r("a0").script_log.clone().unwrap();
    assert_eq!(log.len(), SCRIPT_LOG_LINES as usize);
    assert_eq!(log.last().unwrap().text.len(), DOING_MAX_LENGTH as usize);
    assert_eq!(log[0].text, format!("line {}", SCRIPT_LOG_LINES as u64 / 2));
    assert_eq!(script_logs_sound(&s.world), vec![]);
}
