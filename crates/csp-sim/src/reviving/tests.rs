//! `reviving.test.ts`. Its script-action case runs through the default-scripts host and is left
//! to the script runner's tests; the rest is here, through the order queue, the queue runner and
//! the world step as the game runs them.

use std::sync::Arc;

use super::*;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::tests::resident;
use crate::queues::{QueueHost, QueueRunner};
use crate::survival::{awake_alive, down_do_nothing, go_down};
use crate::walking::Walking;
use crate::world::{create_world, step_world};
use csp_shared::balance::MAX_HUNGER;
use csp_shared::terrain::Terrain;
use csp_shared::world::Realm;
use serde_json::json;

const SIZE: i32 = 64;
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
    terrain: Arc<TerrainMap>,
    orders: OrderQueue,
    queues: QueueRunner,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with Ana (a2), Down at (10, 10), and Ben (a3) next to her with Food; realm
/// r2 (Player 8) with Cid (b2) on Ana's tile.
fn setup() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(
        serde_json::from_value::<Realm>(json!({ "id": "r1", "userId": 7, "leaderId": "a1" }))
            .unwrap(),
    );
    world.realms.push(
        serde_json::from_value::<Realm>(json!({ "id": "r2", "userId": 8, "leaderId": "b1" }))
            .unwrap(),
    );
    for (id, owner, x, y, name) in [
        ("a1", "r1", 30.0, 30.0, "a1"),
        ("b1", "r2", 40.0, 40.0, "b1"),
        ("a2", "r1", 10.0, 10.0, "Ana"),
        ("a3", "r1", 11.0, 10.0, "Ben"),
        ("b2", "r2", 10.0, 10.0, "Cid"),
    ] {
        let mut r = resident(id, Some(owner), x, y);
        r.name = name.into();
        r.born_at = ADULT;
        r.lifespan = 60.0;
        world.residents.push(r);
    }
    world.residents[3].carried = [(Good::Food, 6.0)].into_iter().collect();
    world.residents[4].carried = [(Good::Food, 2.0)].into_iter().collect();
    world.residents[2].hunger = 0.0;
    world.residents[2].carried = [(Good::Stone, 2.0)].into_iter().collect();
    go_down(&mut world, 2);
    let terrain = Arc::new(terrain);
    Setup {
        world,
        orders: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        queues: QueueRunner::new(Box::new(Host), order_kinds(), Some(terrain.clone())),
        walking: Walking::new(terrain.clone()),
        terrain,
        scratch: Scratch::default(),
    }
}

impl Setup {
    /// One tick as the game runs it, everyone but Ana kept fed.
    fn tick(&mut self) {
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        for r in &mut self.world.residents {
            if r.id != "a2" {
                r.hunger = MAX_HUNGER;
            }
        }
        let terrain = self.terrain.clone();
        step_world(&mut self.world, &terrain, &mut self.scratch, Some(&mut self.walking), None);
        assert_eq!(down_do_nothing(&self.world), vec![]);
        assert_eq!(awake_alive(&self.world), vec![]);
    }

    fn give(&mut self, order: Value, sender: &OrderSender) -> OrderReply {
        self.orders.receive(&self.world, sender, &json!("q"), &order)
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    fn woke(&self) -> Vec<Value> {
        self.world
            .events
            .iter()
            .filter(|e| e.user_id == 7)
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == "woke")
            .collect()
    }
}

fn feed_ana(units: f64) -> Value {
    json!({ "kind": "feed", "residentId": "a3", "targetId": "a2", "units": units })
}

fn food(r: &Resident) -> Option<f64> {
    r.carried.get(&Good::Food).copied()
}

fn ack() -> OrderReply {
    OrderReply::Ack { request_id: "q".into() }
}

fn rejected(reason: &str) -> OrderReply {
    OrderReply::Rejected { request_id: "q".into(), reason: reason.into() }
}

#[test]
fn wakes_a_down_resident_at_low_health_idle_with_a_hunger_meter_that_isnt_empty() {
    let mut s = setup();
    assert_eq!(s.give(feed_ana(3.0), &mara()), ack());
    s.tick();
    let ana = s.r("a2");
    assert!(!is_down(ana.down_until));
    assert!(ana.health > 0.0 && ana.health <= csp_shared::balance::WAKE_HEALTH);
    assert!(ana.hunger > 0.0);
    assert!(ana.order.is_none());
    // One unit eaten at once, the other two in her hands; Ben keeps the rest.
    assert_eq!((food(ana), ana.carried.get(&Good::Stone).copied()), (Some(2.0), Some(2.0)));
    assert_eq!(food(s.r("a3")), Some(3.0));
    assert!(s.r("a3").order.is_none());
    let woke = s.woke();
    assert_eq!(woke.len(), 1);
    assert_eq!(
        (woke[0]["residentId"].as_str(), woke[0]["name"].as_str(), woke[0]["by"].as_str()),
        (Some("a2"), Some("Ana"), Some("Ben"))
    );
    // Awake, she takes orders again.
    assert_eq!(
        s.give(json!({ "kind": "walkTo", "residentId": "a2", "x": 12, "y": 12 }), &mara()),
        ack()
    );
}

#[test]
fn gives_no_more_than_the_food_in_their_hands() {
    let mut s = setup();
    s.give(feed_ana(50.0), &mara());
    s.tick();
    assert_eq!(food(s.r("a3")), None);
    assert_eq!(food(s.r("a2")), Some(5.0));
}

#[test]
fn is_refused_from_too_far_by_a_child_without_food_or_for_someone_not_down() {
    let mut s = setup();
    s.world.residents[3].x = 13.0;
    assert_eq!(
        s.give(feed_ana(3.0), &mara()),
        rejected("stand on or next to their tile to feed them")
    );
    s.world.residents[3].x = 11.0;
    s.world.residents[3].born_at = s.world.tick as f64;
    assert_eq!(s.give(feed_ana(3.0), &mara()), rejected(NO_CHILD_FEEDS));
    s.world.residents[3].born_at = ADULT;
    s.world.residents[3].carried = [(Good::Wood, 3.0)].into_iter().collect();
    assert_eq!(s.give(feed_ana(3.0), &mara()), rejected(NO_FOOD_TO_FEED));
    s.world.residents[3].carried = [(Good::Food, 3.0)].into_iter().collect();
    let mut cid = feed_ana(3.0);
    cid["targetId"] = json!("b2");
    assert_eq!(s.give(cid, &mara()), rejected("nobody Down there to feed"));
    assert!(matches!(s.give(feed_ana(0.0), &mara()), OrderReply::Rejected { .. }));
    assert!(matches!(s.give(feed_ana(1.5), &mara()), OrderReply::Rejected { .. }));
    // Someone Down feeds nobody: they take no orders.
    let own = json!({ "kind": "feed", "residentId": "a2", "targetId": "a2", "units": 1 });
    assert!(matches!(s.give(own, &mara()), OrderReply::Rejected { .. }));
}

#[test]
fn does_nothing_once_the_food_is_gone() {
    let mut s = setup();
    s.give(feed_ana(3.0), &mara());
    s.world.residents[3].carried.clear();
    s.tick();
    assert!(is_down(s.r("a2").down_until));
    assert!(s.r("a3").order.is_none());
}

#[test]
fn lets_another_realms_resident_feed_them() {
    let mut s = setup();
    let order = json!({ "kind": "feed", "residentId": "b2", "targetId": "a2", "units": 1 });
    assert_eq!(s.give(order, &other()), ack());
    s.tick();
    assert!(!is_down(s.r("a2").down_until));
    assert_eq!(food(s.r("b2")), Some(1.0));
    // Ana's Player hears of it, by the feeder's name.
    assert_eq!(s.woke()[0]["by"], "Cid");
}

#[test]
fn wakes_them_only_once_when_two_feed_them_in_one_tick() {
    let mut s = setup();
    s.give(feed_ana(1.0), &mara());
    s.give(json!({ "kind": "feed", "residentId": "b2", "targetId": "a2", "units": 1 }), &other());
    s.tick();
    assert!(!is_down(s.r("a2").down_until));
    assert_eq!(s.woke().len(), 1);
    // The second found her awake and kept their Food.
    assert_eq!(food(s.r("a3")).unwrap() + food(s.r("b2")).unwrap(), 7.0);
}

#[test]
fn can_be_a_queue_step() {
    let mut s = setup();
    s.world.residents[3].x = 14.0;
    let steps = json!([{ "order": { "kind": "walkTo", "x": 11, "y": 11 } }, { "order": { "kind": "feed", "targetId": "a2", "units": 2 } }]);
    assert_eq!(
        s.give(json!({ "kind": "queue", "residentId": "a3", "steps": steps }), &mara()),
        ack()
    );
    for _ in 0..200 {
        if !is_down(s.r("a2").down_until) {
            break;
        }
        s.tick();
    }
    assert!(!is_down(s.r("a2").down_until));
    assert_eq!(food(s.r("a3")), Some(4.0));
}

#[test]
fn feed_problem_reaches_the_tiles_next_to_the_down_resident_wrapping_round_the_map() {
    let mut down = resident("d", None, 0.0, 0.0);
    down.down_until = Some(100.0);
    let at = |x: f64, y: f64| {
        let mut r = resident("f", None, x, y);
        r.born_at = ADULT;
        r.carried = [(Good::Food, 1.0)].into_iter().collect();
        r
    };
    assert_eq!(feed_problem(&at(63.0, 63.0), Some(&down), 0.0, SIZE), None);
    assert_eq!(feed_problem(&at(0.0, 0.0), Some(&down), 0.0, SIZE), None);
    assert!(feed_problem(&at(2.0, 0.0), Some(&down), 0.0, SIZE).is_some());
}
