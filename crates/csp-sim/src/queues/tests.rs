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
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(0));
    s.tick();
    // A game minute in, the first walk ends and the second starts.
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("walking") };
    assert_eq!(w.target, Tile { x: 6.0, y: 9.0 });
    let q = s.r().queue.as_ref().unwrap();
    assert_eq!((q.current_index(), q.started_at), (Some(1), Some(started + TICKS_PER_GAME_MINUTE)));
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
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(1));
}

#[test]
fn skips_a_kept_step_whose_kind_is_unknown_or_inherited() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(8, 6), walk(9, 6)] }));
    s.tick();
    // Saved before a kind went, or tampered with: kinds no step can be, one of them a name that
    // finds a function inherited from `Object.prototype` in the TypeScript.
    let q = s.r_mut().queue.as_mut().unwrap();
    step_mut(q, 0).order.kind = "constructor".into();
    step_mut(q, 1).order.kind = "gone".into();
    q.started_at = None;
    q.current = 1;
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
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(1));
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
        rejected("a queue holds at most 50 steps and blocks")
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
    assert_eq!(q.steps().iter().map(|st| st.id).collect::<Vec<_>>(), vec![3, 4, 1]);
    assert_eq!((q.current, q.started_at, q.r#loop, q.next_step_id), (1, started, true, 5));
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
    assert_eq!(q.current, 2);
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("walking") };
    assert_eq!(w.target, Tile { x: 6.0, y: 9.0 });

    // With nothing in its place and no loop, the queue ends and they stop.
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [walk(6, 9), walk(20, 6)] }));
    s.tick();
    s.r_mut().queue.as_mut().unwrap().current = 2;
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
    step_mut(q, 0).order.kind = "queue".into();
    step_mut(q, 0).id = 7;
    let terrain = TerrainMap { size: SIZE, tiles: Vec::new() };
    let messages: Vec<String> =
        queues_sound(&s.world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        vec![
            "w1's queue is at step id 3, not one of its 1 steps",
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

/// The queue's step `i`, counted top to bottom from 0, to change.
fn step_mut(q: &mut Queue, i: usize) -> &mut csp_shared::world::QueueStep {
    fn walk<'a>(
        items: &'a mut [csp_shared::world::QueueItem],
        out: &mut Vec<&'a mut csp_shared::world::QueueStep>,
    ) {
        for item in items {
            match item {
                csp_shared::world::QueueItem::Step(s) => out.push(s),
                csp_shared::world::QueueItem::Repeat(b) => walk(&mut b.items, out),
            }
        }
    }
    let mut out = Vec::new();
    walk(&mut q.items, &mut out);
    out.swap_remove(i)
}

/// The round block `id` of w1's queue is on, 0 when none.
fn round_of(s: &Setup, id: u32) -> u32 {
    let q = s.r().queue.as_ref().expect("a queue");
    crate::queue_tree::rounds_of(&q.items).get(&id).map_or(0, |r| r.0)
}

fn block(repeat: Value, items: Vec<Value>) -> Value {
    json!({ "repeat": repeat, "items": items })
}

#[test]
fn a_repeat_block_runs_its_rounds_then_the_queue_goes_on() {
    let mut s = setup();
    // Ids: the block 1, its walks 2 and 3, the walk after it 4.
    let back_and_forth = block(json!(3), vec![walk(7, 6), walk(6, 6)]);
    assert_eq!(s.give(json!({ "kind": "queue", "steps": [back_and_forth, walk(6, 8)] })), ack());
    let mut seen = Vec::new();
    for i in 0..100 {
        if i > 0 && s.r().queue.is_none() {
            break;
        }
        s.tick();
        if let Some(q) = &s.r().queue {
            let now = (q.current, round_of(&s, 1));
            if seen.last() != Some(&now) {
                seen.push(now);
            }
        }
    }
    assert_eq!(seen, vec![(2, 1), (3, 1), (2, 2), (3, 2), (2, 3), (3, 3), (4, 0)]);
    assert_eq!((s.r().x, s.r().y), (6.0, 8.0));
    assert_eq!(s.skips(), vec![]);
}

#[test]
fn a_nested_block_runs_all_its_rounds_in_each_round_of_the_outer_one() {
    let mut s = setup();
    let inner = block(json!(2), vec![walk(7, 6), walk(6, 6)]);
    s.give(json!({ "kind": "queue", "steps": [block(json!(3), vec![inner])] }));
    let mut arrivals = 0;
    for i in 0..200 {
        if i > 0 && s.r().queue.is_none() {
            break;
        }
        let before = (s.r().x, s.r().y);
        s.tick();
        if (s.r().x, s.r().y) == (7.0, 6.0) && before != (7.0, 6.0) {
            arrivals += 1;
        }
    }
    assert!(s.r().queue.is_none());
    assert_eq!(arrivals, 3 * 2);
}

#[test]
fn a_block_repeated_forever_keeps_going() {
    let mut s = setup();
    let forever = block(json!("forever"), vec![walk(7, 6), walk(6, 6)]);
    s.give(json!({ "kind": "queue", "steps": [forever] }));
    for _ in 0..60 {
        s.tick();
    }
    assert!(round_of(&s, 1) > 5, "round {}", round_of(&s, 1));
}

#[test]
fn a_round_in_which_no_step_could_start_ends_the_block() {
    let mut s = setup();
    let pick = json!({ "order": { "kind": "pickUp" } });
    let never = block(json!("forever"), vec![pick.clone(), pick.clone()]);
    s.give(json!({ "kind": "queue", "steps": [never, walk(8, 6)] }));
    s.tick();
    // Both picks are skipped once, the block ends, and the walk after it starts the same tick.
    assert_eq!(s.skips().len(), 2);
    assert!(s.skips().iter().all(|k| k.3.is_none()));
    let Some(ResidentOrder::WalkTo(_)) = &s.r().order else { panic!("walking on") };
    assert_eq!(s.r().queue.as_ref().unwrap().current, 4);
}

#[test]
fn a_queue_crosses_one_block_edge_a_tick_when_steps_fail() {
    let mut s = setup();
    let pick = json!({ "order": { "kind": "pickUp" } });
    let a = block(json!("forever"), vec![pick.clone()]);
    let b = block(json!(2), vec![pick]);
    // Ids: block 1 with pick 2, block 3 with pick 4, the walk 5.
    s.give(json!({ "kind": "queue", "steps": [a, b, walk(8, 6)] }));
    s.tick();
    // Pick 2 fails and the queue moves into block 3; pick 4 fails and it would leave it too: that
    // waits for the next tick.
    assert_eq!(s.skips().len(), 2);
    assert!(s.r().order.is_none());
    let q = s.r().queue.as_ref().unwrap();
    assert_eq!((q.current, q.started_at), (5, None));
    s.tick();
    let Some(ResidentOrder::WalkTo(_)) = &s.r().order else { panic!("walking on") };
}

#[test]
fn a_live_edit_keeps_each_blocks_round_by_its_id() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [block(json!(5), vec![walk(7, 6), walk(6, 6)])] }));
    s.tick();
    while round_of(&s, 1) < 3 {
        s.tick();
    }
    let current = s.r().queue.as_ref().unwrap().current;
    let kept = || {
        json!([
            { "id": 2, "order": { "kind": "walkTo", "x": 7, "y": 6 } },
            { "id": 3, "order": { "kind": "walkTo", "x": 6, "y": 6 } },
        ])
    };
    // The count goes down to 4 and a step goes after the block: round 3 goes on.
    let edit = json!({ "kind": "editQueue", "steps": [
        { "id": 1, "repeat": 4, "items": kept() },
        walk(6, 8),
    ] });
    assert_eq!(s.give(edit), ack());
    s.orders.apply_all(&mut s.world);
    assert_eq!(round_of(&s, 1), 3);
    assert_eq!(s.r().queue.as_ref().unwrap().current, current);
    // Wrapped in a new block, the step they are on keeps going in the new block's first round.
    let wrap = json!({ "kind": "editQueue", "steps": [
        { "repeat": 2, "items": [{ "id": 1, "repeat": 4, "items": kept() }] },
    ] });
    assert_eq!(s.give(wrap), ack());
    s.orders.apply_all(&mut s.world);
    assert_eq!((round_of(&s, 5), round_of(&s, 1)), (1, 3));
    assert_eq!(s.r().queue.as_ref().unwrap().next_step_id, 6);
}

#[test]
fn blocks_are_checked_when_given() {
    let mut s = setup();
    let queue = |steps: Value| json!({ "kind": "queue", "steps": steps });
    let mut deep = vec![walk(7, 6)];
    for _ in 0..4 {
        deep = vec![block(json!(2), deep)];
    }
    assert_eq!(s.give(queue(json!(deep))), rejected("blocks nest at most 3 deep"));
    let count = "a repeat block repeats from 1 to 1000 times, or forever";
    assert_eq!(s.give(queue(json!([block(json!(0), vec![walk(7, 6)])]))), rejected(count));
    assert_eq!(s.give(queue(json!([block(json!(1001), vec![walk(7, 6)])]))), rejected(count));
    assert_eq!(
        s.give(queue(json!([block(json!(2), vec![])]))),
        rejected("a repeat block needs a step")
    );
    // A block counts once, however often it repeats: 49 walks in it make 50.
    let walks: Vec<Value> = (0..49).map(|_| walk(7, 6)).collect();
    assert_eq!(s.give(queue(json!([block(json!(100), walks.clone())]))), ack());
    let mut over = walks;
    over.push(walk(7, 6));
    assert_eq!(
        s.give(queue(json!([block(json!(100), over)]))),
        rejected("a queue holds at most 50 steps and blocks")
    );
    // Work that repeats is followed by itself, so it needs a duration even when last.
    let work = json!({ "order": { "kind": "workAt" } });
    assert_eq!(
        s.give(queue(json!([block(json!(2), vec![work])]))),
        rejected("step 1 never ends on its own: give it a duration or make it the last")
    );
    // An edit may not pass a step's id off as a block's.
    s.give(queue(json!([walk(7, 6)])));
    s.tick();
    let as_block = json!({ "id": 1, "repeat": 2, "items": [walk(7, 6)] });
    let edit = json!({ "kind": "editQueue", "steps": [as_block] });
    assert_eq!(s.give(edit), rejected("no such step in the queue"));
}

#[test]
fn queues_sound_finds_a_round_beyond_its_count_or_away_from_the_step() {
    let mut s = setup();
    s.give(json!({ "kind": "queue", "steps": [block(json!(2), vec![walk(7, 6)]), walk(6, 6)] }));
    s.tick();
    let terrain = TerrainMap { size: SIZE, tiles: Vec::new() };
    let q = s.r_mut().queue.as_mut().unwrap();
    let csp_shared::world::QueueItem::Repeat(b) = &mut q.items[0] else { panic!("a block") };
    b.round = 3;
    let messages = |s: &Setup| -> Vec<String> {
        queues_sound(&s.world, &terrain).into_iter().map(|v| v.message).collect()
    };
    assert_eq!(messages(&s), vec!["w1's queue runs round 3 of block 1 around its step"]);
    s.r_mut().queue.as_mut().unwrap().current = 3;
    assert_eq!(messages(&s), vec!["w1's queue runs round 3 of block 1 away from its step"]);
}

/// An outpost storage `s1` of realm r1 at (8, 8) holding `wood`, and `s2` of realm r2.
fn storages(s: &mut Setup, wood: f64) {
    let mut s1 = crate::test_support::building(
        "s1",
        csp_shared::world::BuildingKind::Storage,
        None,
        8.0,
        8.0,
    );
    s1.realm_id = Some("r1".into());
    s1.stock = Some(csp_shared::world::Stock::from([(csp_shared::world::Good::Wood, wood)]));
    let mut s2 = s1.clone();
    s2.id = "s2".into();
    s2.realm_id = Some("r2".into());
    s2.x = 2.0;
    s.world.buildings.extend([s1, s2]);
}

fn wood_in(place: &str, amount: u32) -> Value {
    json!({ "kind": "stock", "placeId": place, "good": "wood", "compare": "atLeast",
        "amount": amount })
}

fn wait_until(condition: Value) -> Value {
    json!({ "order": { "kind": "waitUntil", "condition": condition } })
}

fn set_wood(s: &mut Setup, wood: f64) {
    let b = s.world.buildings.iter_mut().find(|b| b.id == "s1").unwrap();
    b.stock = Some(csp_shared::world::Stock::from([(csp_shared::world::Good::Wood, wood)]));
}

#[test]
fn a_wait_until_stands_idle_until_its_condition_holds_then_goes_on() {
    let mut s = setup();
    storages(&mut s, 5.0);
    assert_eq!(
        s.give(json!({ "kind": "queue", "steps": [walk(7, 6), wait_until(wood_in("s1", 20)),
            walk(9, 6)] })),
        ack()
    );
    for _ in 0..10 {
        s.tick();
    }
    // At (7, 6), idle on the Wait until.
    assert_eq!((s.r().x, s.r().y), (7.0, 6.0));
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(1));
    assert!(s.r().order.is_none());
    set_wood(&mut s, 20.0);
    s.tick();
    let Some(ResidentOrder::WalkTo(w)) = &s.r().order else { panic!("walking on") };
    assert_eq!(w.target, Tile { x: 9.0, y: 6.0 });
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(2));
    assert_eq!(s.skips(), vec![]);
}

#[test]
fn a_wait_until_with_a_duration_ends_when_it_is_up() {
    let mut s = setup();
    storages(&mut s, 5.0);
    let mut wait = wait_until(wood_in("s1", 20));
    wait["minutes"] = json!(2);
    s.give(json!({ "kind": "queue", "steps": [wait, walk(9, 6)] }));
    s.tick();
    let started = s.r().queue.as_ref().unwrap().started_at.unwrap();
    while (s.world.tick as f64) <= started + 2.0 * TICKS_PER_GAME_MINUTE - 1.0 {
        s.tick();
        assert!(s.r().order.is_none(), "still waiting at tick {}", s.world.tick);
    }
    s.tick();
    let Some(ResidentOrder::WalkTo(_)) = &s.r().order else { panic!("walking on") };
}

#[test]
fn a_wait_until_already_true_ends_the_tick_after_it_started() {
    let mut s = setup();
    storages(&mut s, 30.0);
    s.give(json!({ "kind": "queue", "steps": [wait_until(wood_in("s1", 20)), walk(9, 6)] }));
    s.tick();
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(0));
    s.tick();
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(1));
    // A looping queue of nothing but a wait that holds starts it once a tick, never more.
    let mut s = setup();
    storages(&mut s, 30.0);
    s.give(json!({ "kind": "queue", "loop": true, "steps": [wait_until(wood_in("s1", 20))] }));
    for _ in 0..5 {
        s.tick();
        let q = s.r().queue.as_ref().unwrap();
        assert_eq!(q.started_at, Some(s.world.tick as f64 - 1.0));
    }
}

#[test]
fn a_wait_on_a_place_gone_waits_on_and_notes_it_once() {
    let mut s = setup();
    storages(&mut s, 5.0);
    s.give(json!({ "kind": "queue", "steps": [wait_until(wood_in("s1", 1)), walk(9, 6)] }));
    s.tick();
    s.world.buildings.retain(|b| b.id != "s1");
    for _ in 0..5 {
        s.tick();
    }
    assert_eq!(s.r().queue.as_ref().unwrap().current_index(), Some(0));
    let notes: Vec<_> = s
        .world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::ConditionPlaceGone { resident_id, place_id, .. } => {
                Some((resident_id.clone(), place_id.clone()))
            }
            _ => None,
        })
        .collect();
    assert_eq!(notes, vec![("w1".to_string(), "s1".to_string())]);
}

#[test]
fn a_wait_until_is_checked_when_given_and_asks_nothing_about_another_realm() {
    let mut s = setup();
    storages(&mut s, 5.0);
    let give = |s: &mut Setup, step: Value| s.give(json!({ "kind": "queue", "steps": [step] }));
    assert_eq!(
        give(&mut s, wait_until(wood_in("s2", 1))),
        rejected("step 1: not a storage, workplace or site of your realm")
    );
    assert_eq!(
        give(&mut s, json!({ "order": { "kind": "waitUntil" } })),
        rejected("step 1: needs a condition")
    );
    assert_eq!(
        give(
            &mut s,
            json!({ "order": { "kind": "waitUntil", "condition": wood_in("s1", 1),
            "x": 1 } })
        ),
        rejected("step 1: a Wait until holds only its condition")
    );
    assert_eq!(give(&mut s, wait_until(wood_in("s1", 1))), ack());
    // An edit adding one is checked the same way.
    s.tick();
    let edit = json!({ "kind": "editQueue", "steps": [{ "id": 1, "order": { "kind": "waitUntil",
        "condition": wood_in("s1", 1) } }, wait_until(wood_in("s2", 1))] });
    assert_eq!(s.give(edit), rejected("step 2: not a storage, workplace or site of your realm"));
}
