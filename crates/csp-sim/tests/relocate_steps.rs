//! `apps/server/src/relocate-steps.test.ts`, ported (T86.17, part 5): Relocate in queues and
//! scripts (`CONTEXT.md`: Relocate, Queue, Script). A queue step or a script's `relocate(cityId)`
//! gives the same order as the card, checked the same way.

mod build_common;
mod scripts_common;

use build_common::*;
use csp_shared::balance::OWN_FOOD;
use csp_shared::world::{BuildingKind, Good, ResidentOrder, Stock};
use csp_sim::invariants::world_invariants;
use csp_sim::queries::city_area::free_housing;
use csp_sim::queues::queues_sound;
use csp_sim::scripts::RunnableScript;
use scripts_common::{acked, rejected, Game};
use serde_json::{json, Value};

const SIZE: i32 = 64;
const SCRIPT_ID: u64 = 750;

/// Realm r1 (Player 7) with its city c1 (town hall at (9, 3)), where Ana (a1) lives and stands,
/// and its city c2, Redbank (town hall at (40, 3)), with one house and nobody living there; or
/// full, when `full`. Realm r2 has a city c3 of its own. `source` is the script Ana can run.
fn setup(full: bool, source: &str) -> Game {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "x1"));
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    add_city(&mut world, "c2", Some("r1"), 40.0, 3.0);
    world.cities.iter_mut().find(|c| c.id == "c2").unwrap().name = "Redbank".into();
    add_city(&mut world, "c3", Some("r2"), 9.0, 40.0);
    let mut h2 = building("h2", BuildingKind::House, 40.0, 7.0);
    h2.city_id = Some("c2".into());
    world.buildings.push(h2);
    let mut ana = new_resident("a1", Some("r1"), 9.0, 7.0);
    ana.name = "Ana".into();
    ana.city_id = Some("c1".into());
    ana.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    let mut x1 = new_resident("x1", Some("r2"), 9.0, 44.0);
    x1.city_id = Some("c3".into());
    x1.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    world.residents.push(ana);
    world.residents.push(x1);
    if full {
        fill_redbank(&mut world, "b");
    }
    let game = Game::new(world, terrain, player(7));
    game.scripts.library.insert(
        SCRIPT_ID,
        RunnableScript {
            user_id: 7,
            name: "Move".into(),
            version: 1,
            source: source.into(),
            follows_default: false,
            task: None,
        },
    );
    game
}

/// Residents of r1 move into Redbank until its houses are full.
fn fill_redbank(world: &mut csp_shared::world::WorldState, prefix: &str) {
    let room = free_housing(world, "c2") as usize;
    for i in 0..room {
        let mut r = new_resident(&format!("{prefix}{i}"), Some("r1"), 44.0, 9.0);
        r.city_id = Some("c2".into());
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        world.residents.push(r);
    }
}

impl Game {
    /// One tick, then the queues are sound (`tick` of the TypeScript `setup`).
    fn step(&mut self) {
        self.tick();
        let broken = queues_sound(&self.world, &self.terrain);
        assert!(broken.is_empty(), "{broken:?}");
    }

    fn step_until(&mut self, done: impl Fn(&Game) -> bool) {
        for _ in 0..300 {
            if done(self) {
                break;
            }
            self.step();
        }
        assert!(done(self), "not done after 300 ticks");
    }

    fn give(&mut self, order: Value) -> csp_sim::orders::OrderReply {
        self.give_to("a1", order)
    }
}

fn relocate_step(city: &str) -> Value {
    json!({ "order": { "kind": "relocate", "cityId": city } })
}

fn walk(x: i32, y: i32) -> Value {
    json!({ "order": { "kind": "walkTo", "x": x, "y": y } })
}

// Asks to relocate to Redbank once and waits on it; then keeps how it ended.
const RELOCATE_AND_READ: &str = r#"
if (memory.started == null) {
  memory.started = true
  memory.asked = relocate("c2")
  if (memory.asked == null) { wait() }
} else if (memory.ended == null) {
  memory.ended = me.orderEnded
  memory.cityId = me.cityId
}"#;

fn assert_sound(g: &Game) {
    for i in world_invariants() {
        let v = i.check(&g.world, &g.terrain);
        assert!(v.is_empty(), "{}: {v:?}", i.name);
    }
}

fn relocating_to(g: &Game, city: &str) -> bool {
    matches!(&g.r("a1").order, Some(ResidentOrder::Relocate(o)) if o.city_id == city)
}

// a script's relocate(cityId)

#[test]
fn moves_the_resident_in_and_once_it_waited_reads_that_it_ended_well() {
    let mut s = setup(false, RELOCATE_AND_READ);
    assert!(acked(&s.give(json!({ "kind": "runScript", "scriptId": SCRIPT_ID }))));
    s.step();
    assert!(relocating_to(&s, "c2"));
    assert!(s.r("a1").script.as_ref().unwrap().waiting_since.is_some());
    s.step_until(|g| {
        g.r("a1")
            .script
            .as_ref()
            .is_some_and(|s| s.memory.get("ended").is_some_and(|e| !e.is_null()))
    });
    assert_eq!(s.r("a1").city_id.as_deref(), Some("c2"));
    let m = s.memory("a1");
    assert_eq!(m["asked"], Value::Null);
    assert_eq!(m["ended"]["kind"], "relocate");
    assert_eq!(m["ended"]["reason"], Value::Null);
    assert_eq!(m["cityId"], "c2");
    assert_sound(&s);
}

#[test]
fn reads_why_not_when_the_city_filled_up_on_the_way_and_keeps_the_old_city() {
    let mut s = setup(false, RELOCATE_AND_READ);
    s.give(json!({ "kind": "runScript", "scriptId": SCRIPT_ID }));
    s.step();
    assert!(matches!(s.r("a1").order, Some(ResidentOrder::Relocate(_))));
    // Someone else moves in meanwhile, filling Redbank.
    fill_redbank(&mut s.world, "n");
    s.step_until(|g| {
        g.r("a1")
            .script
            .as_ref()
            .is_some_and(|s| s.memory.get("ended").is_some_and(|e| !e.is_null()))
    });
    assert_eq!(s.r("a1").city_id.as_deref(), Some("c1"));
    let m = s.memory("a1");
    assert_eq!(m["ended"]["kind"], "relocate");
    assert_eq!(m["ended"]["reason"], "no free housing");
    assert_eq!(m["cityId"], "c1");
    assert_eq!(s.events("relocateFailed").len(), 1);
}

#[test]
fn is_refused_with_the_orders_reasons() {
    let mut full = setup(true, RELOCATE_AND_READ);
    full.give(json!({ "kind": "runScript", "scriptId": SCRIPT_ID }));
    full.step();
    assert_eq!(full.memory("a1")["asked"], "no free housing");
    assert!(full.r("a1").order.is_none());

    let mut theirs = setup(false, r#"memory.asked = relocate("c3")"#);
    theirs.give(json!({ "kind": "runScript", "scriptId": SCRIPT_ID }));
    theirs.step();
    assert_eq!(theirs.memory("a1")["asked"], "not a city of your realm");

    let mut home = setup(false, r#"memory.asked = relocate("c1")"#);
    home.give(json!({ "kind": "runScript", "scriptId": SCRIPT_ID }));
    home.step();
    assert_eq!(home.memory("a1")["asked"], "Ana already lives in Ashford");
}

// a Relocate queue step

#[test]
fn moves_the_resident_in_then_the_next_step_starts() {
    let mut s = setup(false, "");
    assert!(acked(
        &s.give(json!({ "kind": "queue", "steps": [relocate_step("c2"), walk(44, 10)] }))
    ));
    s.step();
    assert!(relocating_to(&s, "c2"));
    s.step_until(|g| g.r("a1").city_id.as_deref() == Some("c2"));
    s.step();
    assert_eq!(s.r("a1").queue.as_ref().map(|q| q.current), Some(1));
    match &s.r("a1").order {
        Some(ResidentOrder::WalkTo(o)) => assert_eq!((o.target.x, o.target.y), (44.0, 10.0)),
        other => panic!("not walking: {other:?}"),
    }
    s.step_until(|g| g.r("a1").queue.is_none());
    let a = s.r("a1");
    assert_eq!((a.x, a.y), (44.0, 10.0));
    assert_eq!(a.city_id.as_deref(), Some("c2"));
    assert_eq!(s.events("queueStepSkipped"), Vec::<Value>::new());
}

#[test]
fn is_skipped_for_lack_of_housing_when_its_turn_comes_and_noted_in_the_realm_log() {
    let mut s = setup(true, "");
    // Adding it only checks that the city is the realm's.
    assert!(acked(
        &s.give(json!({ "kind": "queue", "steps": [relocate_step("c2"), walk(9, 10)] }))
    ));
    s.step();
    let skipped = s.events("queueStepSkipped");
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0]["name"], "Ana");
    assert_eq!(skipped[0]["step"].as_f64(), Some(1.0));
    assert_eq!(skipped[0]["order"], "relocate");
    assert_eq!(skipped[0]["reason"], "no free housing");
    match &s.r("a1").order {
        Some(ResidentOrder::WalkTo(o)) => assert_eq!((o.target.x, o.target.y), (9.0, 10.0)),
        other => panic!("not walking: {other:?}"),
    }
    assert_eq!(s.r("a1").city_id.as_deref(), Some("c1"));
}

#[test]
fn that_fails_on_arrival_goes_in_the_realm_log_once_and_the_next_step_starts() {
    let mut s = setup(false, "");
    s.give(json!({ "kind": "queue", "steps": [relocate_step("c2"), walk(44, 10)] }));
    s.step();
    s.world.cities.iter_mut().find(|c| c.id == "c2").unwrap().realm_id = Some("r2".into());
    s.step_until(|g| g.r("a1").queue.as_ref().map(|q| q.current) == Some(1));
    assert_eq!(s.r("a1").city_id.as_deref(), Some("c1"));
    assert_eq!(s.events("relocateFailed").len(), 1);
    assert_eq!(s.events("queueStepSkipped"), Vec::<Value>::new());
}

#[test]
fn can_only_be_added_for_a_city_of_the_realm() {
    let mut s = setup(false, "");
    let steps = json!([walk(9, 10), relocate_step("c3")]);
    assert_eq!(
        rejected(&s.give(json!({ "kind": "queue", "steps": steps }))),
        Some("step 2: not a city of your realm")
    );
    assert_eq!(
        rejected(&s.give(json!({ "kind": "queue", "steps": [relocate_step("nowhere")] }))),
        Some("step 1: not a city of your realm")
    );
}
