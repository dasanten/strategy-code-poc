//! `apps/server/src/hitching.test.ts`, ported (T86.17): the Hitch order (`CONTEXT.md`: Hitched
//! horse), the horse a resident chooses pulls the carriage.

mod build_common;

use build_common::*;
use csp_shared::balance::{ticks_for_age, AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Carriage, Horse, HorseStats, RealmEventWhat, Resident, ResidentOrder, Stock, WorldState,
};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use serde_json::{json, Value};
use std::sync::Arc;

const SIZE: i32 = 16;

fn me() -> OrderSender {
    player(7)
}

fn add_horse(world: &mut WorldState, id: &str) {
    world.horses.push(Horse {
        id: id.into(),
        name: id.into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 2.0,
        y: 2.0,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        },
        born_at: 0.0,
        down_until: None,
    });
}

fn add_carriage(world: &mut WorldState, id: &str) {
    world.carriages.push(Carriage {
        id: id.into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 2.0,
        y: 2.0,
        horse_id: None,
        load: Stock::new(),
    });
}

/// A world with realm r1 (Player 7, Leader w1) and, at (2, 2), w1, carriage k1 with no horse
/// hitched and horses h1, h2 and h3 of r1.
fn setup() -> (WorldState, TerrainMap) {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    let i = resident(&mut world, "w1", 2.0, 2.0);
    world.residents[i].carried = serde_json::from_value(json!({ "food": 10 })).unwrap();
    for id in ["h1", "h2", "h3"] {
        add_horse(&mut world, id);
    }
    add_carriage(&mut world, "k1");
    (world, terrain)
}

fn w1(world: &WorldState) -> &Resident {
    world.residents.iter().find(|r| r.id == "w1").unwrap()
}

fn horse_of<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Horse {
    world.horses.iter_mut().find(|h| h.id == id).unwrap()
}

fn carriage_of<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Carriage {
    world.carriages.iter_mut().find(|c| c.id == id).unwrap()
}

fn horse_at(world: &WorldState, id: &str) -> (f64, f64) {
    let h = world.horses.iter().find(|h| h.id == id).unwrap();
    (h.x, h.y)
}

fn carriage_at(world: &WorldState, id: &str) -> (f64, f64) {
    let c = world.carriages.iter().find(|c| c.id == id).unwrap();
    (c.x, c.y)
}

/// Sends an order of the Player's and applies it, as the next tick would; the reason when it was
/// refused.
fn give(world: &mut WorldState, terrain: &TerrainMap, o: Value) -> Result<(), String> {
    let mut orders = Orders::default();
    let answer = orders.receive(world, &me(), o, terrain);
    orders.apply_all(world, terrain);
    answer
}

/// Has w1 hitch a horse, by default h2 to k1.
fn hitch(world: &mut WorldState, terrain: &TerrainMap, more: Value) -> Result<(), String> {
    let mut o = json!({ "kind": "hitch", "residentId": "w1", "carriageId": "k1", "horseId": "h2" });
    o.as_object_mut().unwrap().extend(more.as_object().unwrap().clone());
    give(world, terrain, o)
}

#[track_caller]
fn refused(answer: Result<(), String>, reason: &str) {
    assert_eq!(answer, Err(reason.to_string()));
}

/// Steps the world while w1 has an order (at most 2000 ticks); every invariant holds after each.
fn step_while_ordered(world: &mut WorldState, terrain: &TerrainMap, walking: &mut Walking) {
    let mut scratch = Scratch::default();
    for _ in 0..2000 {
        if w1(world).order.is_none() {
            break;
        }
        step_world(world, terrain, &mut scratch, Some(walking), None);
        assert_sound(world, terrain);
    }
}

#[test]
fn hitches_the_named_horse_among_several_and_that_one_is_driven_off() {
    let (mut world, terrain) = setup();
    assert_eq!(hitch(&mut world, &terrain, json!({})), Ok(()));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
    assert_sound(&world, &terrain);

    give(
        &mut world,
        &terrain,
        json!({ "kind": "drive", "residentId": "w1", "carriageId": "k1", "x": 6, "y": 2 }),
    )
    .unwrap();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    step_while_ordered(&mut world, &terrain, &mut walking);
    assert_eq!(carriage_at(&world, "k1"), (6.0, 2.0));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
    assert_eq!(horse_at(&world, "h2"), (6.0, 2.0));
    assert_eq!(horse_at(&world, "h1"), (2.0, 2.0));
    assert_eq!(horse_at(&world, "h3"), (2.0, 2.0));
}

#[test]
fn leaves_drive_taking_the_first_free_horse_with_none_hitched() {
    let (mut world, terrain) = setup();
    give(
        &mut world,
        &terrain,
        json!({ "kind": "drive", "residentId": "w1", "carriageId": "k1", "x": 3, "y": 2 }),
    )
    .unwrap();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    step_while_ordered(&mut world, &terrain, &mut walking);
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h1"));
}

#[test]
fn swaps_a_hitched_horse_which_stands_free_on_the_tile_to_be_mounted() {
    let (mut world, terrain) = setup();
    world.carriages[0].horse_id = Some("h1".into());
    assert_eq!(hitch(&mut world, &terrain, json!({})), Ok(()));
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
    assert_eq!(horse_at(&world, "h1"), (2.0, 2.0));
    assert_eq!(
        give(&mut world, &terrain, json!({ "kind": "mount", "residentId": "w1", "horseId": "h1" })),
        Ok(())
    );
    assert_sound(&world, &terrain);
}

#[test]
fn lets_the_driver_drive_on_behind_the_new_horse_and_leaves_the_old_one_behind() {
    let (mut world, terrain) = setup();
    world.carriages[0].horse_id = Some("h1".into());
    give(
        &mut world,
        &terrain,
        json!({ "kind": "drive", "residentId": "w1", "carriageId": "k1", "x": 8, "y": 2 }),
    )
    .unwrap();
    let mut walking = Walking::new(Arc::new(terrain.clone()));
    let mut scratch = Scratch::default();
    while world.carriages[0].x < 4.0 {
        step_world(&mut world, &terrain, &mut scratch, Some(&mut walking), None);
    }
    let (x, y) = carriage_at(&world, "k1");
    let h2 = horse_of(&mut world, "h2");
    h2.x = x;
    h2.y = y;

    assert_eq!(hitch(&mut world, &terrain, json!({})), Ok(()));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::Drive(_))));
    step_while_ordered(&mut world, &terrain, &mut walking);
    assert_eq!(carriage_at(&world, "k1"), (8.0, 2.0));
    assert_eq!(horse_at(&world, "h2"), (8.0, 2.0));
    assert_eq!(horse_at(&world, "h1"), (x, y));
}

#[test]
fn goes_on_with_what_the_resident_was_doing() {
    let (mut world, terrain) = setup();
    give(&mut world, &terrain, json!({ "kind": "walkTo", "residentId": "w1", "x": 9, "y": 9 }))
        .unwrap();
    assert_eq!(hitch(&mut world, &terrain, json!({})), Ok(()));
    assert!(matches!(w1(&world).order, Some(ResidentOrder::WalkTo(_))));
}

#[test]
fn refuses_a_horse_that_isnt_the_realms_on_the_tile_and_free() {
    let (mut world, terrain) = setup();
    refused(hitch(&mut world, &terrain, json!({ "horseId": "nope" })), "no such horse");
    refused(hitch(&mut world, &terrain, json!({ "carriageId": "nope" })), "no such carriage");

    horse_of(&mut world, "h2").realm_id = Some("r2".into());
    refused(hitch(&mut world, &terrain, json!({})), "not a horse of your realm");
    assert_eq!(horse_of(&mut world, "h2").realm_id.as_deref(), Some("r2"));
    horse_of(&mut world, "h2").realm_id = Some("r1".into());

    horse_of(&mut world, "h2").x = 3.0;
    refused(hitch(&mut world, &terrain, json!({})), "that horse is not on the carriage’s tile");
    horse_of(&mut world, "h2").x = 2.0;

    horse_of(&mut world, "h2").down_until = Some(world.tick as f64 + 100.0);
    refused(hitch(&mut world, &terrain, json!({})), "that horse is Down");
    horse_of(&mut world, "h2").down_until = None;

    let p = resident(&mut world, "p1", 2.0, 2.0);
    world.residents[p].riding = Some("h2".into());
    refused(hitch(&mut world, &terrain, json!({})), "someone rides that horse");
    world.residents[p].riding = None;

    let mut second = world.carriages[0].clone();
    second.id = "k2".into();
    second.horse_id = Some("h2".into());
    world.carriages.push(second);
    refused(hitch(&mut world, &terrain, json!({})), "that horse already pulls a carriage");
    carriage_of(&mut world, "k1").horse_id = Some("h1".into());
    refused(
        hitch(&mut world, &terrain, json!({ "horseId": "h1" })),
        "that horse already pulls a carriage",
    );
    assert_eq!(carriage_of(&mut world, "k1").horse_id.as_deref(), Some("h1"));
    assert!(w1(&world).order.is_none());
}

#[test]
fn refuses_a_child_a_resident_off_the_tile_another_realms_carriage_and_a_stranger() {
    let (mut world, terrain) = setup();
    let born = world.residents[0].born_at;
    world.residents[0].born_at = world.tick as f64 - ticks_for_age(5.0);
    refused(hitch(&mut world, &terrain, json!({})), "children can’t hitch");
    world.residents[0].born_at = born;

    world.residents[0].x = 3.0;
    refused(hitch(&mut world, &terrain, json!({})), "that carriage is not on the resident’s tile");
    world.residents[0].x = 2.0;

    carriage_of(&mut world, "k1").realm_id = Some("r2".into());
    refused(hitch(&mut world, &terrain, json!({})), "not a carriage of your realm");
    carriage_of(&mut world, "k1").realm_id = Some("r1".into());

    let o = json!({ "kind": "hitch", "residentId": "w1", "carriageId": "k1", "horseId": "h2" });
    let mut orders = Orders::default();
    refused(orders.receive(&world, &player(8), o, &terrain), "not one of your residents");
    assert_eq!(world.carriages[0].horse_id, None);
}

#[test]
fn gives_one_horse_to_the_first_of_two_carriages_hitching_it_in_the_same_tick() {
    let (mut world, terrain) = setup();
    add_carriage(&mut world, "k2");
    let mut orders = Orders::default();
    for carriage_id in ["k1", "k2"] {
        let o = json!({
            "kind": "hitch", "residentId": "w1", "carriageId": carriage_id, "horseId": "h2"
        });
        assert_eq!(orders.receive(&world, &me(), o, &terrain), Ok(()));
    }
    orders.apply_all(&mut world, &terrain);
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
    assert_eq!(world.carriages[1].horse_id, None);
    assert_sound(&world, &terrain);
}

#[test]
fn gets_a_passenger_off_the_carriage_first() {
    let (mut world, terrain) = setup();
    assert_eq!(
        give(
            &mut world,
            &terrain,
            json!({ "kind": "board", "residentId": "w1", "carriageId": "k1" })
        ),
        Ok(())
    );
    assert_eq!(w1(&world).aboard.as_deref(), Some("k1"));
    assert_eq!(hitch(&mut world, &terrain, json!({})), Ok(()));
    assert_eq!(w1(&world).aboard, None);
    assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
    assert_sound(&world, &terrain);
}

mod as_a_queue_step {
    use super::*;

    struct Host;
    impl QueueHost for Host {
        fn sender(&self, user_id: u64) -> Option<OrderSender> {
            (user_id == 7).then(me)
        }
    }

    /// Steps the world and its queues while the resident has a queue.
    fn run(world: &mut WorldState, terrain: &TerrainMap, orders: &mut Orders) {
        let arc = Arc::new(terrain.clone());
        let mut queues = QueueRunner::new(Box::new(Host), order_kinds(), Some(arc.clone()));
        let mut walking = Walking::new(arc);
        let mut scratch = Scratch::default();
        orders.apply_all(world, terrain);
        for _ in 0..2000 {
            if w1(world).queue.is_none() {
                break;
            }
            queues.run_all(world, &mut scratch);
            step_world(world, terrain, &mut scratch, Some(&mut walking), None);
            assert_sound(world, terrain);
        }
    }

    fn skipped(world: &WorldState) -> Vec<(String, String)> {
        world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::QueueStepSkipped { order, reason, .. } => {
                    Some((order.clone(), reason.clone()))
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn hitches_the_named_horse_when_its_turn_comes_then_drives_off_with_it() {
        let (mut world, terrain) = setup();
        world.residents[0].x = 5.0;
        let mut orders = Orders::default();
        let reply = orders.receive(
            &world,
            &me(),
            json!({
                "kind": "queue", "residentId": "w1",
                "steps": [
                    { "order": { "kind": "walkTo", "x": 2, "y": 2 } },
                    { "order": { "kind": "hitch", "carriageId": "k1", "horseId": "h2" } },
                    { "order": { "kind": "drive", "carriageId": "k1", "x": 4, "y": 2 } },
                ]
            }),
            &terrain,
        );
        assert_eq!(reply, Ok(()));
        run(&mut world, &terrain, &mut orders);
        assert_eq!(world.carriages[0].horse_id.as_deref(), Some("h2"));
        assert_eq!(carriage_at(&world, "k1"), (4.0, 2.0));
        assert_eq!(horse_at(&world, "h2"), (4.0, 2.0));
        assert_eq!(skipped(&world), vec![]);
    }

    #[test]
    fn refuses_another_realms_horse_when_added_and_skips_a_step_whose_horse_has_gone() {
        let (mut world, terrain) = setup();
        let mut orders = Orders::default();
        let queue = json!({
            "kind": "queue", "residentId": "w1",
            "steps": [{ "order": { "kind": "hitch", "carriageId": "k1", "horseId": "h2" } }]
        });
        horse_of(&mut world, "h2").realm_id = Some("r2".into());
        refused(
            orders.receive(&world, &me(), queue.clone(), &terrain),
            "step 1: not a horse of your realm",
        );
        horse_of(&mut world, "h2").realm_id = Some("r1".into());

        horse_of(&mut world, "h2").x = 3.0;
        assert_eq!(orders.receive(&world, &me(), queue, &terrain), Ok(()));
        run(&mut world, &terrain, &mut orders);
        assert_eq!(
            skipped(&world),
            vec![("hitch".to_string(), "that horse is not on the carriage’s tile".to_string())]
        );
    }
}
