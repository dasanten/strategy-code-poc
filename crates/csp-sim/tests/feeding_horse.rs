//! `apps/server/src/feeding-horse.test.ts`, ported (T86.17): feeding a horse (`CONTEXT.md`): any
//! grown resident next to a horse that isn't full can Feed it.

mod build_common;
mod default_scripts_host;

use build_common::*;
use csp_shared::balance::{HORSE_FILL_PER_FOOD, HORSE_WAKE_HEALTH, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Horse, WorldState};
use csp_sim::horses::{new_horse, NewHorse, HORSE_DOWN_TICKS};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::queries::residents::is_down;
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::random::Mulberry32;
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use default_scripts_host::{default_scripts, DefaultScripts, Library};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const ADULT: f64 = -20.0 * 24.0 * 3600.0;

fn mara() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn other() -> OrderSender {
    OrderSender::player(8, "Olaf")
}

struct Host;
impl QueueHost for Host {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        match user_id {
            7 => Some(mara()),
            8 => Some(other()),
            _ => None,
        }
    }
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: OrderQueue,
    queues: QueueRunner,
    scripts: DefaultScripts,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with Ben (a3), holding 6 Food, next to its horse Rowan (h1) at (10, 10);
/// realm r2 (Player 8) with its horse Star (h2) on Rowan's tile. `library` holds Player 7's
/// scripts.
fn setup(library: Library) -> Setup {
    let terrain = plains(64);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    world.realms.push(realm("r2", 8, "b1"));
    add(&mut world, "a1", "r1", 30.0, 30.0);
    add(&mut world, "b1", "r2", 40.0, 40.0);
    let ben = add(&mut world, "a3", "r1", 11.0, 10.0);
    world.residents[ben].carried = serde_json::from_value(json!({ "food": 6 })).unwrap();
    add_horse(&mut world, "h1", "r1");
    add_horse(&mut world, "h2", "r2");
    let scripts = default_scripts(&terrain, vec![mara(), other()], library);
    let arc = Arc::new(terrain.clone());
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(arc.clone()));
    let queues = QueueRunner::new(Box::new(Host), scripts.kinds.clone(), Some(arc.clone()));
    Setup {
        world,
        terrain,
        orders,
        queues,
        scripts,
        walking: Walking::new(arc),
        scratch: Scratch::default(),
    }
}

fn no_library() -> Library {
    Arc::new(Mutex::new(HashMap::new()))
}

impl Setup {
    /// One tick as the game runs it, the residents kept fed.
    fn tick(&mut self) {
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), vec![]);
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
        assert_sound(&self.world, &self.terrain);
    }

    fn give(&mut self, order: Value) -> OrderReply {
        self.give_as(order, &mara())
    }

    fn give_as(&mut self, order: Value, sender: &OrderSender) -> OrderReply {
        self.orders.receive(&self.world, sender, &json!("q"), &order)
    }

    fn rowan(&mut self) -> &mut Horse {
        &mut self.world.horses[0]
    }

    fn star(&mut self) -> &mut Horse {
        &mut self.world.horses[1]
    }

    fn ben(&mut self) -> &mut csp_shared::world::Resident {
        at(&mut self.world, "a3")
    }

    fn carried(&mut self) -> Value {
        serde_json::to_value(&self.ben().carried).unwrap()
    }
}

fn add(world: &mut WorldState, id: &str, owner: &str, x: f64, y: f64) -> usize {
    let n = world.residents.len();
    let i = resident(world, id, x, y);
    let r = &mut world.residents[i];
    r.owner = Some(owner.into());
    r.born_at = ADULT;
    r.lifespan = 60.0;
    debug_assert_eq!(i, n);
    i
}

fn add_horse(world: &mut WorldState, id: &str, realm_id: &str) {
    let mut rand = Mulberry32::new((world.horses.len() + 1) as f64);
    world.horses.push(new_horse(
        &mut || rand.next(),
        NewHorse {
            id: id.into(),
            realm_id: Some(realm_id.into()),
            city_id: None,
            x: 10.0,
            y: 10.0,
            tick: 0.0,
        },
    ));
}

/// Puts a horse Down, as hunger does.
fn lay(world: &WorldState, h: &mut Horse) {
    h.hunger = 0.0;
    h.health = 0.0;
    h.down_until = Some(world.tick as f64 + HORSE_DOWN_TICKS);
}

fn feed_rowan(units: f64) -> Value {
    json!({ "kind": "feed", "residentId": "a3", "targetId": "h1", "units": units })
}

#[track_caller]
fn acked(reply: OrderReply) {
    assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
}

#[track_caller]
fn rejected(reply: OrderReply, why: &str) {
    match reply {
        OrderReply::Rejected { reason, .. } => assert_eq!(reason, why),
        other => panic!("{other:?}"),
    }
}

fn close(got: f64, want: f64) {
    assert!((got - want).abs() < 0.5, "{got} is not close to {want}");
}

#[test]
fn wakes_a_down_horse_at_low_health_with_something_in_its_hunger_meter() {
    let mut s = setup(no_library());
    let world = s.world.clone();
    lay(&world, s.rowan());
    acked(s.give(feed_rowan(1.0)));
    s.tick();
    assert!(!is_down(s.rowan().down_until));
    assert!(s.rowan().health <= HORSE_WAKE_HEALTH + 1.0);
    assert!(s.rowan().health > 0.0);
    assert!(s.rowan().hunger > 0.0);
    assert_eq!(s.carried(), json!({ "food": 5.0 }));
    assert!(s.ben().order.is_none());
}

#[test]
fn eats_a_hungry_horse_full_and_leaves_the_rest_with_the_feeder() {
    let mut s = setup(no_library());
    s.rowan().hunger = 10.0;
    s.give(feed_rowan(50.0));
    s.tick();
    // 90 of the meter to fill at about 44 a unit: two units fit, a third would be partly wasted.
    assert_eq!(s.carried(), json!({ "food": 4.0 }));
    close(s.rowan().hunger, 10.0 + 2.0 * HORSE_FILL_PER_FOOD);
    assert!(s.rowan().hunger <= MAX_HUNGER);
}

#[test]
fn wastes_no_food_a_horse_with_room_for_just_a_whole_unit_eats_it_with_less_it_is_full() {
    let mut s = setup(no_library());
    s.rowan().hunger = MAX_HUNGER - HORSE_FILL_PER_FOOD;
    s.give(feed_rowan(3.0));
    s.tick();
    assert_eq!(s.carried(), json!({ "food": 5.0 }));
    close(s.rowan().hunger, MAX_HUNGER);

    let mut t = setup(no_library());
    t.rowan().hunger = MAX_HUNGER - HORSE_FILL_PER_FOOD + 1.0;
    rejected(t.give(feed_rowan(3.0)), "that horse is full");
}

#[test]
fn eats_only_the_units_asked_for() {
    let mut s = setup(no_library());
    s.rowan().hunger = 0.0;
    s.give(feed_rowan(1.0));
    s.tick();
    assert_eq!(s.carried(), json!({ "food": 5.0 }));
    assert!(s.rowan().hunger < MAX_HUNGER / 2.0);
}

#[test]
fn eats_no_more_than_the_food_in_their_hands() {
    let mut s = setup(no_library());
    s.rowan().hunger = 0.0;
    s.ben().carried = serde_json::from_value(json!({ "food": 1, "stone": 2 })).unwrap();
    s.give(feed_rowan(3.0));
    s.tick();
    assert_eq!(s.carried(), json!({ "stone": 2.0 }));
}

#[test]
fn refuses_a_full_horse_from_too_far_a_child_or_without_food() {
    let mut s = setup(no_library());
    s.rowan().hunger = MAX_HUNGER;
    rejected(s.give(feed_rowan(3.0)), "that horse is full");
    s.rowan().hunger = 10.0;
    s.ben().x = 13.0;
    rejected(s.give(feed_rowan(3.0)), "stand on or next to its tile to feed it");
    s.ben().x = 11.0;
    s.ben().born_at = s.world.tick as f64;
    rejected(s.give(feed_rowan(3.0)), "children can’t feed others");
    s.ben().born_at = ADULT;
    s.ben().carried = serde_json::from_value(json!({ "wood": 3 })).unwrap();
    rejected(s.give(feed_rowan(3.0)), "no Food in hand");
}

#[test]
fn does_nothing_once_the_food_is_gone_or_another_filled_the_horse_first() {
    let mut s = setup(no_library());
    s.rowan().hunger = 10.0;
    s.give(feed_rowan(3.0));
    s.ben().carried.clear();
    let hunger = s.rowan().hunger;
    s.tick();
    assert!(s.rowan().hunger <= hunger);
    assert!(s.ben().order.is_none());

    let mut t = setup(no_library());
    let cid = add(&mut t.world, "a4", "r1", 10.0, 10.0);
    t.world.residents[cid].carried = serde_json::from_value(json!({ "food": 6 })).unwrap();
    t.rowan().hunger = 10.0;
    t.give(feed_rowan(50.0));
    t.give(json!({ "kind": "feed", "residentId": "a4", "targetId": "h1", "units": 50 }));
    t.tick();
    // Whoever goes first fills it; the other keeps all their Food.
    let food = |t: &mut Setup, id: &str| {
        at(&mut t.world, id).carried.values().copied().next().unwrap_or(0.0)
    };
    assert_eq!(food(&mut t, "a3") + food(&mut t, "a4"), 10.0);
}

#[test]
fn can_feed_another_realms_horse_and_that_is_no_crime() {
    let mut s = setup(no_library());
    let world = s.world.clone();
    lay(&world, s.star());
    let mut order = feed_rowan(1.0);
    order["targetId"] = json!("h2");
    acked(s.give(order));
    s.tick();
    assert!(!is_down(s.star().down_until));
    assert_eq!(s.star().realm_id.as_deref(), Some("r2"));
    assert_eq!(s.carried(), json!({ "food": 5.0 }));
    assert!(s.world.crimes.is_empty());
}

#[test]
fn can_be_a_queue_step() {
    let mut s = setup(no_library());
    s.ben().x = 14.0;
    let world = s.world.clone();
    lay(&world, s.rowan());
    let steps = json!([
        { "order": { "kind": "walkTo", "x": 11, "y": 11 } },
        { "order": { "kind": "feed", "targetId": "h1", "units": 2 } },
    ]);
    acked(s.give(json!({ "kind": "queue", "residentId": "a3", "steps": steps })));
    for _ in 0..200 {
        if !is_down(s.rowan().down_until) {
            break;
        }
        s.tick();
    }
    assert!(!is_down(s.rowan().down_until));
    assert_eq!(s.carried(), json!({ "food": 4.0 }));
}

#[test]
fn is_the_script_action_feed_target_id_units() {
    let feeder = RunnableScript {
        user_id: 7,
        name: "Feeder".into(),
        version: 1,
        follows_default: false,
        source: "feed(\"h1\", 1)".into(),
        task: None,
    };
    let library: Library = Arc::new(Mutex::new(HashMap::from([(750, feeder)])));
    let mut s = setup(library);
    let world = s.world.clone();
    lay(&world, s.rowan());
    acked(s.give(json!({ "kind": "runScript", "residentId": "a3", "scriptId": 750 })));
    s.tick();
    s.tick();
    assert!(!is_down(s.rowan().down_until));
    let food = s.ben().carried.values().copied().next().unwrap_or(0.0);
    assert!(food < 6.0, "{food}");
}

#[allow(dead_code)]
const _: f64 = MAX_HEALTH;
