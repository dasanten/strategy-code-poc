//! Boats in queues (`CONTEXT.md`: Beside a vessel, Rowing, Queue; T90.6): boarding, rowing,
//! getting off and loading are queue steps like any other, so a saved queue takes a resident
//! across a lake and back.

use std::sync::Arc;

use csp_shared::balance::{LIFESPAN_MAX, OWN_FOOD};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Good, RealmEventWhat, Stock, Vessel, VesselKind};
use serde_json::{json, Value};

use crate::game_test_world::Game;
use crate::movement_test_world::{draw, resident, world_with_realm};
use crate::order_sender::OrderSender;
use crate::orders::order_kinds;
use crate::queues::{QueueHost, QueueRunner};

struct Host;
impl QueueHost for Host {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(|| OrderSender::player(7, "Mara"))
    }
}

/// A Lake over x 2..=15, y 2..=8 on a 20 × 20 map: land all round it.
fn lake() -> TerrainMap {
    let rows: Vec<String> = (0..20)
        .map(|y| {
            (0..20)
                .map(|x| if (2..=15).contains(&x) && (2..=8).contains(&y) { '~' } else { '.' })
                .collect()
        })
        .collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

fn boat(id: &str, realm: &str, x: f64, y: f64) -> Vessel {
    Vessel {
        id: id.into(),
        kind: VesselKind::Boat,
        realm_id: Some(realm.into()),
        x,
        y,
        load: Stock::new(),
        rower_id: None,
    }
}

/// The game with its queues run each tick before the rest, as the server runs them.
struct Queued {
    game: Game,
    queues: QueueRunner,
}

impl Queued {
    fn tick(&mut self) {
        self.queues.run_all(&mut self.game.world, &mut self.game.scratch);
        self.game.tick();
    }

    /// Ticks until nobody has a queue left, at most `max` ticks.
    fn until_queues_end(&mut self, max: usize) {
        for _ in 0..max {
            if self.game.world.residents.iter().all(|r| r.queue.is_none()) {
                return;
            }
            self.tick();
        }
        panic!("a queue is still going after {max} ticks");
    }

    fn queue(&mut self, id: &str, steps: Value) -> String {
        self.game.order(7, json!({ "kind": "queue", "residentId": id, "steps": steps }))
    }

    fn skips(&self) -> Vec<String> {
        self.game
            .world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::QueueStepSkipped { order, reason, .. } => {
                    Some(format!("{order}: {reason}"))
                }
                _ => None,
            })
            .collect()
    }

    fn at(&self, id: &str) -> (f64, f64) {
        let r = self.game.r(id);
        (r.x, r.y)
    }

    fn v1(&self) -> &Vessel {
        self.game.world.vessels.iter().find(|v| v.id == "v1").expect("boat v1")
    }
}

/// Realm r1 (Player 7) with w1 on the west shore at (0, 4) and its empty boat v1 at (2, 4);
/// realm r2's boat v2 at (2, 6).
fn setup() -> Queued {
    let map = lake();
    let mut world = world_with_realm(&map);
    let r2 = json!({ "id": "r2", "userId": 8, "leaderId": "x1" });
    world.realms.push(serde_json::from_value(r2).expect("a realm"));
    let mut x1 = resident("x1", Some("r2"), 19.0, 19.0);
    x1.lifespan = LIFESPAN_MAX;
    world.residents.push(x1);
    let mut r = resident("w1", Some("r1"), 0.0, 4.0);
    r.carried = [(Good::Food, OWN_FOOD), (Good::Wood, 3.0)].into_iter().collect();
    r.lifespan = LIFESPAN_MAX;
    world.residents.push(r);
    world.vessels.push(boat("v1", "r1", 2.0, 4.0));
    world.vessels.push(boat("v2", "r2", 2.0, 6.0));
    let terrain = Arc::new(map.clone());
    let queues = QueueRunner::new(Box::new(Host), order_kinds(), Some(terrain));
    Queued { game: Game::new(world, map), queues }
}

fn step(order: Value) -> Value {
    json!({ "order": order })
}

/// Walks to the shore at (from), boards v1, rows it to the far shore at (to), gets off and walks
/// on to (on).
fn crossing(from: (i32, i32), to: (i32, i32), on: (i32, i32)) -> Vec<Value> {
    vec![
        step(json!({ "kind": "walkTo", "x": from.0, "y": from.1 })),
        step(json!({ "kind": "board", "vesselId": "v1" })),
        step(json!({ "kind": "row", "vesselId": "v1", "x": to.0, "y": to.1 })),
        step(json!({ "kind": "getOff" })),
        step(json!({ "kind": "walkTo", "x": on.0, "y": on.1 })),
    ]
}

#[test]
fn a_queue_boards_rows_gets_off_and_walks_on_to_the_end() {
    let mut s = setup();
    assert_eq!(s.queue("w1", json!(crossing((1, 4), (16, 5), (19, 5)))), "ack");
    s.until_queues_end(600);
    assert_eq!(s.skips(), Vec::<String>::new());
    let w1 = s.game.r("w1");
    assert_eq!(w1.aboard, None);
    assert_eq!((w1.x, w1.y), (19.0, 5.0));
    // Rowed to the free water beside the far shore it was given.
    let v = s.v1();
    assert_eq!(v.x, 15.0);
    assert!((4.0..=6.0).contains(&v.y), "beside (16, 5): {}, {}", v.x, v.y);
}

#[test]
fn a_saved_queue_takes_a_resident_across_and_back_loading_the_boat_on_the_way() {
    let mut s = setup();
    let mut steps = crossing((1, 4), (16, 5), (18, 5));
    // At the far shore: back beside the boat, load the Wood carried, and row it home.
    steps.extend(crossing((16, 5), (1, 4), (0, 4)).into_iter().enumerate().flat_map(|(i, st)| {
        let store = step(json!({ "kind": "store", "to": "v1", "goods": { "wood": 3 } }));
        if i == 1 {
            vec![store, st]
        } else {
            vec![st]
        }
    }));
    assert_eq!(s.queue("w1", Value::Array(steps)), "ack");
    s.until_queues_end(1200);
    assert_eq!(s.skips(), Vec::<String>::new());
    assert_eq!(s.at("w1"), (0.0, 4.0));
    assert_eq!(s.game.r("w1").aboard, None);
    assert_eq!(s.game.r("w1").carried.get(&Good::Wood).copied().unwrap_or(0.0), 0.0);
    let v = s.v1();
    assert_eq!(v.load.get(&Good::Wood).copied(), Some(3.0));
    assert_eq!(v.x, 2.0, "back on the west side");
}

#[test]
fn a_step_naming_a_boat_that_isnt_there_or_isnt_the_realms_is_turned_down() {
    let mut s = setup();
    for (order, reason) in [
        (json!({ "kind": "board", "vesselId": "v9" }), "step 1: no such boat"),
        (json!({ "kind": "row", "vesselId": "v2", "x": 5, "y": 5 }), "step 1: not a boat of your realm"),
        (json!({ "kind": "store", "to": "v2", "goods": ["wood"] }), "step 1: not a boat of your realm"),
        (
            json!({ "kind": "pickUp", "spot": { "kind": "vessel", "vesselId": "v2" }, "goods": { "wood": 1 } }),
            "step 1: not a boat of your realm",
        ),
    ] {
        assert_eq!(s.queue("w1", json!([step(order)])), reason);
    }
}

#[test]
fn a_boat_step_that_cant_start_where_they_stand_is_skipped() {
    let mut s = setup();
    // Not beside the boat: boarding is skipped, and rowing then too.
    let steps = json!([
        step(json!({ "kind": "walkTo", "x": 0, "y": 12 })),
        step(json!({ "kind": "board", "vesselId": "v1" })),
        step(json!({ "kind": "row", "vesselId": "v1", "x": 10, "y": 5 })),
    ]);
    assert_eq!(s.queue("w1", steps), "ack");
    s.until_queues_end(200);
    assert_eq!(
        s.skips(),
        vec![
            "board: that boat is not beside the resident".to_string(),
            "row: that boat is not beside the resident".to_string()
        ]
    );
    assert_eq!((s.v1().x, s.v1().y), (2.0, 4.0));
}
