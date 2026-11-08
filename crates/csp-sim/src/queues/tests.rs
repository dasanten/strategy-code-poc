//! `queues.test.ts`. Its tests run the real game: walking (T86.4), the task order and default
//! scripts (T86.12), work, storing and building. Until those are ported, these run the queue
//! logic itself with stand-in order kinds: `walkTo` moves a resident one tile a tick towards its
//! target, `pickUp` can never start, `rename` keeps scripts running. The TypeScript cases that
//! need the real kinds (the timed `task` step, a script step ending itself, Planning ahead's
//! work/store/road/teach/mount steps, sight) are left to T86.14, which runs the whole file.

use super::*;
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::world::create_world;
use csp_shared::terrain::Terrain;
use csp_shared::world::{Army, OrderEnded, Realm, RealmEventWhat, ResidentOrder, Tile, WalkOrder};
use serde_json::json;

pub(crate) const SIZE: i32 = 32;

pub(crate) fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

/// A resident from the stepped-world fixture, moved and given to `owner`.
pub(crate) fn resident(id: &str, owner: Option<&str>, x: f64, y: f64) -> Resident {
    thread_local! {
        static TEMPLATE: Resident = {
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/worlds/village-0.json");
            let file: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            serde_json::from_value(file["world"]["residents"][0].clone()).unwrap()
        };
    }
    let mut r = TEMPLATE.with(Clone::clone);
    r.id = id.into();
    r.name = format!("Resident {id}");
    r.owner = owner.map(str::to_string);
    r.city_id = None;
    r.x = x;
    r.y = y;
    r.order = None;
    r.script = None;
    r.queue = None;
    r.interrupted = None;
    r.struck = None;
    r.down_until = None;
    r.aboard = None;
    r.order_ended = None;
    r
}

/// Stand-in `walkTo`: the sender's resident walks to (x, y) on the map.
struct FakeWalk;
impl OrderKind for FakeWalk {
    fn validate(
        &self,
        w: &WorldState,
        s: &OrderSender,
        o: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        crate::order_sender::ordered_resident(w, s, field_str(o, "residentId"))
            .is_none()
            .then(|| "not one of your residents".into())
    }
    fn apply(&self, w: &mut WorldState, s: &OrderSender, o: &OrderRequest, _: Option<&TerrainMap>) {
        let Some(i) = crate::order_sender::ordered_resident(w, s, field_str(o, "residentId"))
        else {
            return;
        };
        let at = |k: &str| o.fields.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        w.residents[i].order = Some(ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: at("x"), y: at("y") },
            path: None,
            progress: 0.0,
            army: None,
        }));
    }
}

/// Stand-in for an order that can't start where the resident stands.
struct NeverStarts;
impl OrderKind for NeverStarts {
    fn validate(
        &self,
        _: &WorldState,
        _: &OrderSender,
        _: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        Some("nothing to pick up here".into())
    }
    fn apply(&self, _: &mut WorldState, _: &OrderSender, _: &OrderRequest, _: Option<&TerrainMap>) {
    }
}

/// Stand-in `rename`: changes the name, nobody's order.
struct FakeRename;
impl OrderKind for FakeRename {
    fn validate(
        &self,
        _: &WorldState,
        _: &OrderSender,
        _: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        None
    }
    fn apply(&self, w: &mut WorldState, _: &OrderSender, o: &OrderRequest, _: Option<&TerrainMap>) {
        let id = field_str(o, "residentId");
        if let Some(r) = w.residents.iter_mut().find(|r| Some(r.id.as_str()) == id) {
            r.name = field_str(o, "name").unwrap_or_default().into();
        }
    }
}

pub(crate) fn kinds() -> OrderKinds {
    let mut kinds = crate::orders::order_kinds();
    kinds.insert("walkTo", FakeWalk);
    kinds.insert("pickUp", NeverStarts);
    kinds.insert("rename", FakeRename);
    kinds
}

struct Host;
impl QueueHost for Host {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(me)
    }
}

pub(crate) struct Setup {
    pub world: WorldState,
    pub orders: OrderQueue,
    queues: QueueRunner,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with resident w1 at (6, 6), and Player 8's resident x1 of realm r2.
pub(crate) fn setup() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "x1"));
    world.residents.push(resident("w1", Some("r1"), 6.0, 6.0));
    world.residents.push(resident("x1", Some("r2"), 1.0, 1.0));
    let terrain = Some(Arc::new(terrain));
    Setup {
        world,
        orders: OrderQueue::new(kinds(), terrain.clone()),
        queues: QueueRunner::new(Box::new(Host), kinds(), terrain),
        scratch: Scratch::default(),
    }
}

fn realm(id: &str, user_id: u64, leader: &str) -> Realm {
    serde_json::from_value(json!({ "id": id, "userId": user_id, "leaderId": leader })).unwrap()
}

impl Setup {
    pub fn r(&self) -> &Resident {
        self.world.residents.iter().find(|r| r.id == "w1").unwrap()
    }
    fn r_mut(&mut self) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == "w1").unwrap()
    }

    pub fn give(&mut self, order: Value) -> OrderReply {
        let mut order = order;
        order.as_object_mut().unwrap().insert("residentId".into(), json!("w1"));
        self.orders.receive(&self.world, &me(), &json!("q"), &order)
    }

    /// One tick as the game runs it: orders, queues, then the stand-in walking and the tick turns.
    fn tick(&mut self) {
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        for r in &mut self.world.residents {
            if let Some(ResidentOrder::WalkTo(w)) = &r.order {
                let (tx, ty) = (w.target.x, w.target.y);
                r.x += step(tx - r.x);
                r.y += step(ty - r.y);
                if r.x == tx && r.y == ty {
                    r.order = None;
                }
            }
        }
        self.world.tick += 1;
        let terrain = TerrainMap { size: SIZE, tiles: Vec::new() };
        assert_eq!(queues_sound(&self.world, &terrain), vec![]);
    }

    fn skips(&self) -> Vec<(f64, String, String, Option<bool>)> {
        self.world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::QueueStepSkipped { step, order, reason, queue_ended, .. } => {
                    Some((*step, order.clone(), reason.clone(), *queue_ended))
                }
                _ => None,
            })
            .collect()
    }
}

fn walk(x: i32, y: i32) -> Value {
    json!({ "order": { "kind": "walkTo", "x": x, "y": y } })
}

fn ack() -> OrderReply {
    OrderReply::Ack { request_id: "q".into() }
}

fn rejected(reason: &str) -> OrderReply {
    OrderReply::Rejected { request_id: "q".into(), reason: reason.into() }
}

#[test]
fn does_its_steps_in_order_then_ends() {
    let mut s = setup();
    assert_eq!(s.give(json!({ "kind": "queue", "steps": [walk(9, 6), walk(9, 9)] })), ack());
    let mut been = Vec::new();
    for i in 0..100 {
        if i > 0 && s.r().queue.is_none() {
            break;
        }
        s.tick();
        been.push((s.r().x, s.r().y));
    }
    let first = been.iter().position(|&p| p == (9.0, 6.0)).unwrap();
    let second = been.iter().position(|&p| p == (9.0, 9.0)).unwrap();
    assert!(first < second);
    assert_eq!((s.r().x, s.r().y), (9.0, 9.0));
    assert!(s.r().order.is_none());
    assert!(s.r().queue.is_none());
    assert_eq!(s.skips(), vec![]);
}

#[test]
fn hands_a_timed_step_over_to_the_next_once_its_minutes_are_up() {
    let mut s = setup();
    // A walk too far to finish in one game minute.
    let first = json!({ "order": { "kind": "walkTo", "x": 30, "y": 6 }, "minutes": 1 });
    s.give(json!({ "kind": "queue", "steps": [first, walk(6, 9)] }));
    s.tick();
    let started = s.r().queue.as_ref().unwrap().started_at.unwrap();
    while (s.world.tick as f64) < started + TICKS_PER_GAME_MINUTE {
        s.tick();
    }
    assert_eq!(s.r().queue.as_ref().unwrap().current, 0);
    s.tick();
    // A game minute in, the first walk ends and the second starts.
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("walking") };
    assert_eq!(w.target, Tile { x: 6.0, y: 9.0 });
    let q = s.r().queue.as_ref().unwrap();
    assert_eq!((q.current, q.started_at), (1, Some(started + TICKS_PER_GAME_MINUTE)));
}

#[test]
fn starts_again_from_the_first_step_when_it_loops() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(8, 6), walk(6, 6)], "loop": true }));
    let mut at = Vec::new();
    for _ in 0..60 {
        s.tick();
        at.push((s.r().x, s.r().y));
    }
    // Back and forth, more than once.
    assert!(at.iter().filter(|&&p| p == (8.0, 6.0)).count() > 1);
    let last_home = at.iter().rposition(|&p| p == (6.0, 6.0)).unwrap();
    assert!(last_home > at.iter().position(|&p| p == (8.0, 6.0)).unwrap());
    assert!(s.r().queue.is_some());
}

#[test]
fn skips_a_step_that_cant_start_and_notes_it_in_the_realm_log() {
    let mut s = setup();
    let pick = json!({ "order": { "kind": "pickUp", "goods": { "food": 1 } } });
    s.give(json!({ "kind": "queue", "steps": [pick, walk(8, 6)] }));
    s.tick();
    let Some(ResidentOrder::WalkTo(_)) = &s.r().order else { panic!("walking") };
    assert_eq!(s.skips(), vec![(1.0, "pickUp".into(), "nothing to pick up here".into(), None)]);
    assert_eq!(s.r().queue.as_ref().unwrap().current, 1);
}

#[test]
fn skips_a_kept_step_whose_kind_is_unknown_or_inherited() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(8, 6), walk(9, 6)] }));
    s.tick();
    // Saved before a kind went, or tampered with: kinds no step can be, one of them a name that
    // finds a function inherited from `Object.prototype` in the TypeScript.
    let q = s.r_mut().queue.as_mut().unwrap();
    q.steps[0].order.kind = "constructor".into();
    q.steps[1].order.kind = "gone".into();
    q.started_at = None;
    q.current = 0;
    s.r_mut().order = None;
    s.queues.run_all(&mut s.world, &mut s.scratch);
    assert_eq!(
        s.skips(),
        vec![
            (1.0, "constructor".into(), "unknown order: constructor".into(), None),
            (2.0, "gone".into(), "unknown order: gone".into(), Some(true)),
        ]
    );
    assert!(s.r().queue.is_none());
}

#[test]
fn skips_a_step_that_ends_in_a_failure_and_notes_it() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(7, 6), walk(8, 6)] }));
    s.tick();
    // The step ends early, as a store that found no room.
    let tick = s.world.tick as f64;
    let r = s.r_mut();
    r.order = None;
    r.order_ended =
        Some(OrderEnded { kind: OrderEndedKind::Store, tick, reason: Some("no room".into()) });
    s.tick();
    assert_eq!(s.skips(), vec![(1.0, "walkTo".into(), "no room".into(), None)]);
    assert_eq!(s.r().queue.as_ref().unwrap().current, 1);
    // Starting the next step forgets how the last one ended.
    assert!(s.r().order_ended.is_none());
}

#[test]
fn ends_when_none_of_its_looping_steps_can_start() {
    let mut s = setup();
    let pick = json!({ "order": { "kind": "pickUp" } });
    s.give(json!({ "kind": "queue", "steps": [pick.clone(), pick], "loop": true }));
    s.tick();
    assert!(s.r().queue.is_none());
    let skips = s.skips();
    assert_eq!(skips.len(), 2);
    assert_eq!(skips[1].3, Some(true));
}

#[test]
fn ends_with_any_other_order_and_keeps_going_when_the_player_renames_them() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6), walk(6, 6)] }));
    s.tick();
    s.give(json!({ "kind": "rename", "name": "Ada" }));
    s.tick();
    assert!(s.r().queue.is_some());
    assert_eq!(s.r().name, "Ada");
    s.give(json!({ "kind": "walkTo", "x": 6, "y": 9 }));
    s.tick();
    assert!(s.r().queue.is_none());
}

#[test]
fn shows_scripts_where_it_is_and_the_current_step() {
    let mut s = setup();
    let timed = json!({ "order": { "kind": "walkTo", "x": 20, "y": 6 }, "minutes": 30 });
    s.give(json!({ "kind": "queue", "steps": [walk(9, 6), timed], "loop": true }));
    s.tick();
    let view =
        serde_json::to_value(crate::queue::queue_view(s.r().queue.as_ref().unwrap())).unwrap();
    assert_eq!(
        view,
        json!({ "step": 1, "steps": 2, "loop": true, "kind": "walkTo", "startedAt": 0.0 })
    );
}

#[test]
fn takes_a_resident_out_of_their_army_and_ends_once_an_army_takes_them_in() {
    let mut s = setup();
    let army = |members: &[&str]| -> Army {
        serde_json::from_value(json!({ "id": "a1", "name": "Guard", "realmId": "r1",
            "memberIds": members, "order": null }))
        .unwrap()
    };
    s.world.armies.push(army(&["w1"]));
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6)] }));
    s.tick();
    assert!(s.world.armies.is_empty());
    assert!(s.r().queue.is_some());
    s.world.armies.push(army(&["w1"]));
    s.tick();
    assert!(s.r().queue.is_none());
}

#[test]
fn is_checked_when_given() {
    let mut s = setup();
    let give_for = |s: &mut Setup, who: &str, order: Value| {
        let mut order = order;
        order.as_object_mut().unwrap().insert("residentId".into(), json!(who));
        s.orders.receive(&s.world, &me(), &json!("q"), &order)
    };
    assert_eq!(
        give_for(&mut s, "x1", json!({ "kind": "queue", "steps": [walk(1, 1)] })),
        rejected("not one of your residents")
    );
    assert_eq!(s.give(json!({ "kind": "queue", "steps": [] })), rejected("a queue needs a step"));
    assert_eq!(
        s.give(json!({ "kind": "queue", "steps": [walk(1, 1)], "loop": "yes" })),
        rejected("loop must be true or false")
    );
    assert_eq!(
        s.give(json!({ "kind": "queue", "steps": [{ "order": { "kind": "queue" } }] })),
        rejected("step 1: queue can't be a queue step")
    );
    let many: Vec<Value> = (0..51).map(|_| walk(1, 1)).collect();
    assert_eq!(
        s.give(json!({ "kind": "queue", "steps": many })),
        rejected("a queue holds at most 50 steps")
    );
    assert_eq!(
        s.give(json!({ "kind": "queue", "steps": [walk(1, 1), walk(40, 1)] })),
        rejected("step 2: that tile is off the map")
    );
}

#[test]
fn turns_down_a_step_whose_place_cant_make_sense() {
    let mut s = setup();
    for (step, reason) in [
        (
            json!({ "order": { "kind": "drive", "carriageId": "k9", "x": 1, "y": 1 } }),
            "step 1: no such carriage",
        ),
        (json!({ "order": { "kind": "mount", "horseId": "h9" } }), "step 1: no such horse"),
        (
            json!({ "order": { "kind": "relocate", "cityId": "c9" } }),
            "step 1: not a city of your realm",
        ),
        (
            json!({ "order": { "kind": "store", "to": { "x": -1, "y": 0 } } }),
            "step 1: that tile is off the map",
        ),
    ] {
        assert_eq!(s.give(json!({ "kind": "queue", "steps": [step] })), rejected(reason));
    }
    // A storage that is gone may still be named: the step is skipped when its turn comes.
    let store = json!({ "order": { "kind": "store", "to": "s9", "goods": { "food": 1 } } });
    assert_eq!(s.give(json!({ "kind": "queue", "steps": [store] })), ack());
}

#[test]
fn edit_keeps_the_current_step_going_while_steps_are_added_removed_and_reordered() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6), walk(6, 9), walk(7, 7)] }));
    s.tick();
    let started = s.r().queue.as_ref().unwrap().started_at;
    // Step 2 goes, step 1 moves behind a new one, step 3 stays first.
    let edit = json!({ "kind": "editQueue", "steps": [
        { "id": 3, "order": { "kind": "walkTo", "x": 7, "y": 7 } },
        { "order": { "kind": "walkTo", "x": 9, "y": 9 } },
        { "id": 1, "order": { "kind": "walkTo", "x": 20, "y": 6 } },
    ], "loop": true });
    assert_eq!(s.give(edit), ack());
    s.tick();
    let q = s.r().queue.as_ref().unwrap();
    assert_eq!(q.steps.iter().map(|st| st.id).collect::<Vec<_>>(), vec![3, 4, 1]);
    assert_eq!((q.current, q.started_at, q.r#loop, q.next_step_id), (2, started, true, 5));
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("still walking") };
    assert_eq!(w.target, Tile { x: 20.0, y: 6.0 });
}

#[test]
fn edit_starts_the_step_in_its_place_when_the_current_one_is_removed() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6), walk(6, 9)] }));
    s.tick();
    s.give(json!({ "kind": "editQueue", "steps": [{ "id": 2, "order": { "kind": "walkTo", "x": 6, "y": 9 } }] }));
    s.tick();
    let q = s.r().queue.as_ref().unwrap();
    assert_eq!(q.current, 0);
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("walking") };
    assert_eq!(w.target, Tile { x: 6.0, y: 9.0 });

    // With nothing in its place and no loop, the queue ends and they stop.
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(6, 9), walk(20, 6)] }));
    s.tick();
    s.r_mut().queue.as_mut().unwrap().current = 1;
    s.give(json!({ "kind": "editQueue", "steps": [{ "id": 1, "order": { "kind": "walkTo", "x": 6, "y": 9 } }] }));
    s.orders.apply_all(&mut s.world);
    assert!(s.r().queue.is_none());
    assert!(s.r().order.is_none());
}

#[test]
fn edit_is_checked_when_given() {
    let mut s = setup();
    let edit = |steps: Value| json!({ "kind": "editQueue", "steps": steps });
    assert_eq!(s.give(edit(json!([walk(1, 1)]))), rejected("not working through a queue"));
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6)] }));
    s.tick();
    let step = |id: u32| json!({ "id": id, "order": { "kind": "walkTo", "x": 1, "y": 1 } });
    assert_eq!(s.give(edit(json!([step(1), step(1)]))), rejected("a step is in the list twice"));
    assert_eq!(s.give(edit(json!([step(9)]))), rejected("no such step in the queue"));
    // Only the steps added are checked.
    let off = json!({ "order": { "kind": "walkTo", "x": 99, "y": 1 } });
    assert_eq!(s.give(edit(json!([step(1), off]))), rejected("step 2: that tile is off the map"));
}

#[test]
fn queues_sound_finds_a_step_out_of_range_a_queue_in_a_queue_and_a_step_started_in_the_future() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(20, 6)] }));
    s.tick();
    let q = s.r_mut().queue.as_mut().unwrap();
    q.current = 3;
    q.started_at = Some(99.0);
    q.steps[0].order.kind = "queue".into();
    q.steps[0].id = 7;
    let terrain = TerrainMap { size: SIZE, tiles: Vec::new() };
    let messages: Vec<String> =
        queues_sound(&s.world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        vec![
            "w1's queue is at step 3 of 1",
            "w1's queue started a step at tick 99, after 1",
            "w1's queue has step ids 7 with 2 next",
            "w1's queue holds a queue step",
        ]
    );
}

/// One tile towards a target `d` away along an axis (`signum` gives 1 for 0).
fn step(d: f64) -> f64 {
    if d > 0.0 {
        1.0
    } else if d < 0.0 {
        -1.0
    } else {
        0.0
    }
}
