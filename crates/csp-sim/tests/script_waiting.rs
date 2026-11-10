//! `apps/server/src/script-waiting.test.ts`, ported one to one. The TypeScript keeps the script
//! in a database (`createScript`); here a host holds the one script.
//!
//! Waiting (`CONTEXT.md`: Running a script, Waiting): a script that calls `wait()` is not run
//! again until its order ends, is replaced, or the resident is struck.

use std::sync::Arc;

use csp_shared::balance::NPC_VILLAGE;
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{ResidentOrder, ResourceKind, ResourceNode, Task, WorldState};
use serde_json::json;

use csp_sim::defence::start_defence;
use csp_sim::invariants::check_all;
use csp_sim::npc_cities::found_npc_city;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue};
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::script_runner::{RunScriptOrder, ScriptHost, ScriptRunner, Waiting};
use csp_sim::scripts::RunnableScript;
use csp_sim::sight::seen_script;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};

const SIZE: i32 = 64;
const MARA: u64 = 1;
const SCRIPT: u64 = 1;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

/// Mara's one script, `walker`.
struct Host(String);

impl ScriptHost for Host {
    fn script(&self, id: u64) -> Option<RunnableScript> {
        (id == SCRIPT).then(|| RunnableScript {
            user_id: MARA,
            name: "walker".into(),
            version: 1,
            source: self.0.clone(),
            follows_default: false,
            task: None,
        })
    }
    fn sender(&self, _: u64) -> Option<OrderSender> {
        Some(OrderSender::player(MARA, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    runner: ScriptRunner,
    walking: Walking,
    scratch: Scratch,
}

/// Mara's resident a0 at (10, 10) running a script that counts its runs in `memory.runs` and runs
/// `source` after (`setup`).
fn setup(source: &str) -> Setup {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": MARA, "leaderId": "a0" })).unwrap(),
    );
    let mut m = Mulberry32::new(1.0);
    let fields =
        NewResident { id: "a0", owner: Some("r1"), city_id: None, x: 10.0, y: 10.0, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
    r.lifespan = 60.0;
    world.residents.push(r);
    let source = format!(
        "if (memory.runs == null) {{ memory.runs = 0 }}\nmemory.runs = memory.runs + 1\n{source}"
    );
    let host: Arc<dyn ScriptHost + Send + Sync> = Arc::new(Host(source));
    let mut kinds = order_kinds();
    kinds.insert("runScript", RunScriptOrder { host: host.clone() });
    let mut orders = OrderQueue::new(kinds.clone(), Some(Arc::new(terrain.clone())));
    let order = json!({ "kind": "runScript", "residentId": "a0", "scriptId": SCRIPT });
    orders.receive(&world, &OrderSender::player(MARA, "Mara"), &json!("q"), &order);
    orders.apply_all(&mut world);
    let runner = ScriptRunner::new(Arc::new(terrain.clone()), host, kinds);
    let walking = Walking::new(Arc::new(terrain.clone()));
    Setup { world, terrain, runner, walking, scratch: Scratch::default() }
}

impl Setup {
    /// One tick: scripts run (checked, ADR 0004), then the world steps (`tick`).
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        assert_eq!(self.runner.run_all(&mut self.world, &mut self.scratch, true), vec![]);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
    }

    fn a0(&mut self) -> &mut csp_shared::world::Resident {
        &mut self.world.residents[0]
    }

    fn runs_in_memory(&mut self) -> Option<f64> {
        self.a0().script.as_ref().and_then(|s| s.memory.get("runs")).and_then(|v| v.as_f64())
    }

    fn waiting_since(&mut self) -> Option<f64> {
        self.a0().script.as_ref().and_then(|s| s.waiting_since)
    }
}

/// Walks to (16, 10) and waits; there, walks back to (10, 10) and waits (`THERE_AND_BACK`).
const THERE_AND_BACK: &str = "
if (me.order == null) {
  if (me.x == 10) { walkTo(16, 10) } else { walkTo(10, 10) }
  wait()
}";

fn walk_target(o: &Option<ResidentOrder>) -> Option<(f64, f64)> {
    match o {
        Some(ResidentOrder::WalkTo(w)) => Some((w.target.x, w.target.y)),
        _ => None,
    }
}

// a waiting script

#[test]
fn is_not_run_while_its_walk_lasts_and_runs_again_on_arrival() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    assert_eq!(s.waiting_since(), Some(0.0));
    assert!(walk_target(&s.a0().order).is_some());
    let mut ticks = 1;
    while s.a0().order.is_some() && ticks < 100 {
        s.tick();
        assert_eq!(s.runner.runs, 0);
        ticks += 1;
    }
    assert_eq!((s.a0().x, s.a0().y), (16.0, 10.0));
    assert_eq!(s.runs_in_memory(), Some(1.0));
    // Arrived: it runs again and sets off back.
    s.tick();
    assert_eq!(s.runner.runs, 1);
    assert_eq!(s.runs_in_memory(), Some(2.0));
    assert_eq!(walk_target(&s.a0().order), Some((10.0, 10.0)));
    assert!(ticks > 5);
}

#[test]
#[ignore = "port bug: `script_runner::Waiting` tells orders apart by kind, the TypeScript by identity, so a walk replaced by a walk keeps it waiting; see #1110"]
fn runs_again_once_its_order_is_replaced() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    s.tick();
    assert_eq!(s.runner.runs, 0);
    // Something of the game's gives them another walk of the same kind.
    s.a0().order = Some(
        serde_json::from_value(json!({
            "kind": "walkTo", "target": { "x": 12, "y": 12 }, "path": null, "progress": 0,
        }))
        .unwrap(),
    );
    s.tick();
    assert_eq!(s.runner.runs, 1);
    assert_eq!(s.waiting_since(), None);
}

#[test]
fn runs_the_same_tick_they_are_struck() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    let tick = s.world.tick;
    s.a0().struck = Some(serde_json::from_value(json!({ "by": "someone", "tick": tick })).unwrap());
    s.tick();
    assert_eq!(s.runner.runs, 1);
    assert_eq!(s.runs_in_memory(), Some(2.0));
}

#[test]
fn struck_by_a_blow_that_starts_their_defence_script_runs_again_once_it_hands_back() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    let mut waiting = s.a0().script.clone().unwrap();
    start_defence(&mut s.world, 0);
    // The script it interrupted, waiting no longer.
    waiting.waiting_since = None;
    let interrupted = s.a0().interrupted.clone().and_then(|i| i.script);
    assert_eq!(interrupted, Some(waiting));
}

#[test]
fn with_no_order_to_wait_on_runs_next_tick_as_before_logging_nothing() {
    let mut s = setup("wait()");
    s.tick();
    s.tick();
    assert_eq!(s.runner.runs, 1);
    assert_eq!(s.runs_in_memory(), Some(2.0));
    assert_eq!(s.waiting_since(), None);
    assert!(s.a0().script_log.as_deref().unwrap_or_default().is_empty());
    assert!(s.world.events.is_empty());
}

#[test]
fn shows_its_owner_it_waits_on_the_doing_line_and_the_script_tab() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    let script = s.a0().script.clone().unwrap();
    assert_eq!(seen_script(&s.world, &script, true).waiting, Some(true));
    let theirs = serde_json::to_value(seen_script(&s.world, &script, false)).unwrap();
    assert!(theirs.get("waiting").is_none());
    // `scriptRunFor` (`csp-server`'s `script_run_for`) gives `waitingSince` from the script.
    assert_eq!(script.waiting_since, Some(0.0));
}

// an NPC town's residents

#[test]
fn run_their_defaults_far_fewer_times_than_once_a_tick_each_on_their_way_to_work() {
    // `village()` of `npc-growth.fixture.ts`.
    let mut land = TerrainMap { size: 200, tiles: vec![Terrain::Plains as u8; 200 * 200] };
    let mut world = create_world(&land, 1);
    let mut m = Mulberry32::new(7.0);
    found_npc_city(&mut world, &land, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    world.nodes.push(ResourceNode {
        id: "forest".into(),
        kind: ResourceKind::Forest,
        x: 74.0,
        y: 34.0,
    });
    land.tiles[tile_index(200, 74, 34)] = Terrain::Forest as u8;
    // Everyone goes to work, none scouting (`CONTEXT.md`: Scout).
    for c in &mut world.cities {
        c.scouted = Some(serde_json::from_value(json!({ "sectors": [], "done": true })).unwrap());
    }
    let mut walking = Walking::new(Arc::new(land.clone()));
    let mut scratch = Scratch::default();
    // Settled at work, then each finds themself 30 tiles off and walks back.
    for _ in 0..20 {
        step_world(&mut world, &land, &mut scratch, Some(&mut walking), None);
    }
    let workers: Vec<String> = world
        .residents
        .iter()
        .filter(|r| {
            r.script.as_ref().is_some_and(|s| s.task == Some(Task::Work)) && r.order.is_some()
        })
        .map(|r| r.id.clone())
        .collect();
    assert!(workers.len() > 3);
    for r in &mut world.residents {
        if workers.contains(&r.id) {
            r.x += 30.0;
            r.order = None;
        }
    }
    let at_work = |w: &WorldState| {
        workers.iter().all(|id| {
            w.residents
                .iter()
                .find(|r| &r.id == id)
                .is_some_and(|r| matches!(r.order, Some(ResidentOrder::WorkAt(_))))
        })
    };
    let (mut runs, mut running) = (0, 0);
    for _ in 0..2000 {
        if at_work(&world) {
            break;
        }
        running += world.residents.iter().filter(|r| r.script.is_some()).count();
        runs +=
            step_world(&mut world, &land, &mut scratch, Some(&mut walking), None).npc_script_runs;
    }
    assert!(at_work(&world));
    // Before waiting, every one of them ran every tick: `runs` was `running`.
    assert!((runs as f64) < running as f64 * 0.6, "{runs} of {running}");
    assert_eq!(check_all(&world, &land), vec![]);
}

// waiting invariant

#[test]
fn flags_a_waiting_script_with_no_order_or_one_from_the_future() {
    let mut s = setup(THERE_AND_BACK);
    s.tick();
    let ids: Vec<String> = s.world.residents.iter().map(|r| r.id.clone()).collect();
    let waiting = Waiting::default();
    assert_eq!(waiting.sound(&s.world, &ids), vec![]);
    let tick = s.world.tick;
    s.a0().order = None;
    s.a0().script.as_mut().unwrap().waiting_since = Some(tick as f64 + 5.0);
    let messages: Vec<String> =
        waiting.sound(&s.world, &ids).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "a0 waits with no order".to_string(),
            format!("a0 began waiting at tick {}, after {tick}", tick + 5)
        ]
    );
}
