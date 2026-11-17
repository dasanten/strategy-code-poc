//! High ground (T105.3, `CONTEXT.md`: Walls in combat, High ground; ADR 0036): someone up strikes
//! down at the ground next to the wall, nobody on the ground strikes anyone up, up against up
//! fights as anywhere, and whoever is up on their own city's wall keeps its cover.

use csp_shared::balance::{MAX_HEALTH, STRIKE_TICKS, WALL_DEFENCE};
use csp_shared::world::{BuildingKind, ClimbOrder, Good, ResidentOrder, Task, Tile, UpSide};

use super::*;
use crate::game_test_world::Game;
use crate::order_sender::OrderSender;
use crate::test_world::until_hit;
use crate::test_world::{add_city, building, empty_world, live, live_mut, realm, resident, run};

const SIZE: i32 = 256;

fn stock(goods: &[(Good, f64)]) -> csp_shared::world::Stock {
    goods.iter().copied().collect()
}

/// Realm r1 (Player 7) with city c1, whose wall tile w1 at (10, 10) has a1 up on it; realm r2
/// (Player 8) with city c2 far away, and b1 of it on the ground next to the wall at (11, 10).
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    add_city(&mut world, "c1", Some("r1"), 10.0, 14.0, None);
    add_city(&mut world, "c2", Some("r2"), 40.0, 40.0, None);
    building(&mut world, "w1", BuildingKind::Wall, Some("c1"), 10.0, 10.0);
    resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "b1", Some("r2"), 11.0, 10.0);
    live_mut(&mut world, "a1").up = Some(UpSide::Inside);
    live_mut(&mut world, "a1").city_id = Some("c1".into());
    live_mut(&mut world, "b1").city_id = Some("c2".into());
    world
}

/// Sends an attack order from Player `user_id`: "ack", or the reason it was rejected.
fn order(world: &mut WorldState, user_id: u64, resident_id: &str, target_id: &str) -> &'static str {
    let sender = OrderSender::player(user_id, "Mara");
    let request = AttackRequest {
        resident_id: Some(resident_id.into()),
        target_id: Some(target_id.into()),
        ..AttackRequest::default()
    };
    if let Some(reason) = validate_attack(world, &sender, &request, Some(SIZE)) {
        return reason;
    }
    apply_attack(world, &request, Some(SIZE));
    "ack"
}

fn health(world: &WorldState, id: &str) -> f64 {
    live(world, id).expect("the resident").health
}

#[test]
fn someone_up_strikes_down_at_the_ground_next_to_the_wall() {
    let mut world = setup();
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 2 * STRIKE_TICKS as usize).is_some());
}

#[test]
fn nobody_on_the_ground_strikes_anyone_up() {
    let mut world = setup();
    // Told to, they get the reason.
    assert_eq!(order(&mut world, 8, "b1", "a1"), "they are up on the wall");
    // An attack order from before the target got up ends, no blow struck.
    live_mut(&mut world, "b1").order = Some(ResidentOrder::Attack(attack_order("a1", true, false)));
    run(&mut world, SIZE, 2 * STRIKE_TICKS as usize);
    assert_eq!(live(&world, "b1").unwrap().order, None);
    assert!((health(&world, "a1") - MAX_HEALTH).abs() < 1e-9);
    // Fighting back from below doesn't reach either: struck, b1 is not given an attack on a1.
    live_mut(&mut world, "b1").carried = stock(&[(Good::Spear, 1.0)]);
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    run(&mut world, SIZE, 6 * STRIKE_TICKS as usize);
    assert!(health(&world, "b1") < MAX_HEALTH);
    assert!((health(&world, "a1") - MAX_HEALTH).abs() < 1e-9);
}

#[test]
fn a_climber_is_on_the_ground_until_over() {
    let mut world = setup();
    live_mut(&mut world, "b1").order = Some(ResidentOrder::Climb(ClimbOrder {
        wall_id: "w1".into(),
        at: Tile { x: 11.0, y: 10.0 },
        progress: 0.0,
    }));
    assert!(!is_up(&world, live(&world, "b1").unwrap()));
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 2 * STRIKE_TICKS as usize).is_some());
}

#[test]
fn an_attacker_below_can_still_break_the_wall_tile() {
    let mut world = setup();
    assert_eq!(order(&mut world, 8, "b1", "w1"), "ack");
    run(&mut world, SIZE, STRIKE_TICKS as usize);
    let wall = world.buildings.iter().find(|b| b.id == "w1").unwrap();
    assert!(wall.damage.unwrap_or(0.0) > 0.0, "{:?}", wall.damage);
}

/// b1 made it over and came down on c1's next wall tile w2 at (11, 10), the far side being walled
/// in (`climb_landing`): up, they fight a1 as anywhere, and a1 on their own wall keeps its cover.
#[test]
fn a_climber_who_made_it_fights_those_up_against_the_walls_cover() {
    let mut world = setup();
    building(&mut world, "w2", BuildingKind::Wall, Some("c1"), 11.0, 10.0);
    assert!(is_up(&world, live(&world, "b1").unwrap()));
    assert_eq!(order(&mut world, 8, "b1", "a1"), "ack");
    let damage = blow_damage(live(&world, "b1").unwrap(), live(&world, "a1").unwrap(), 0.0);
    assert!(until_hit(&mut world, SIZE, "a1", 2 * STRIKE_TICKS as usize).is_some());
    let taken = MAX_HEALTH - health(&world, "a1");
    assert!((taken - damage * WALL_DEFENCE).abs() < 0.01, "{taken} of {damage}");
    // And the other way: a1 strikes them, b1 having no cover on a wall not theirs.
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 2 * STRIKE_TICKS as usize).is_some());
}

#[test]
fn up_against_up_on_touching_walls_fights_as_anywhere() {
    let mut world = setup();
    building(&mut world, "v1", BuildingKind::Wall, Some("c2"), 11.0, 10.0);
    live_mut(&mut world, "b1").up = Some(UpSide::Outside);
    assert_eq!(order(&mut world, 8, "b1", "a1"), "ack");
    assert!(until_hit(&mut world, SIZE, "a1", 2 * STRIKE_TICKS as usize).is_some());
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 2 * STRIKE_TICKS as usize).is_some());
}

/// The Defend default: an armed Player's resident struck from above with no way to strike back
/// walks home, away from the wall, as an unarmed one does.
#[test]
fn the_defend_default_struck_from_above_flees_home() {
    let mut world = setup();
    live_mut(&mut world, "b1").carried = stock(&[(Good::Spear, 1.0)]);
    let mut game = Game::new(world, crate::test_support::plains(SIZE))
        .checking(&["attack-orders-sound", "up-only-on-walls"]);
    game.walks = false;
    let attack = serde_json::json!({ "kind": "attack", "residentId": "a1", "targetId": "b1" });
    assert_eq!(game.order(7, attack), "ack");
    assert!(game.until_hit("b1", 2 * STRIKE_TICKS as usize).is_some());
    game.tick();
    let b = game.r("b1");
    assert_eq!(b.script.as_ref().and_then(|s| s.task), Some(Task::Defend));
    assert!(
        matches!(&b.order, Some(ResidentOrder::WalkTo(w)) if w.target == Tile { x: 40.0, y: 40.0 }),
        "{:?}",
        b.order
    );
    let doing = b.script.as_ref().and_then(|s| s.memory.get("doing")).cloned();
    assert_eq!(doing, Some(serde_json::json!("Defending: fleeing home")));
}

/// An NPC city's armed resident struck from above walks home too; one already at the wall itself
/// keeps at it.
#[test]
fn an_npc_citys_armed_resident_struck_from_above_flees_home_unless_at_the_wall() {
    let mut world = setup();
    add_city(&mut world, "c3", None, 30.0, 30.0, None);
    resident(&mut world, "n1", None, 11.0, 10.0);
    let n = live_mut(&mut world, "n1");
    n.city_id = Some("c3".into());
    n.carried = stock(&[(Good::Spear, 1.0)]);
    assert_eq!(order(&mut world, 7, "a1", "n1"), "ack");
    assert!(until_hit(&mut world, SIZE, "n1", 2 * STRIKE_TICKS as usize).is_some());
    assert!(
        matches!(&live(&world, "n1").unwrap().order,
            Some(ResidentOrder::WalkTo(w)) if w.target == Tile { x: 30.0, y: 30.0 }),
        "{:?}",
        live(&world, "n1").unwrap().order
    );
    let n = live_mut(&mut world, "n1");
    n.health = MAX_HEALTH;
    n.order = Some(ResidentOrder::Attack(attack_order("w1", true, false)));
    assert!(until_hit(&mut world, SIZE, "n1", 2 * STRIKE_TICKS as usize).is_some());
    assert!(matches!(&live(&world, "n1").unwrap().order,
        Some(ResidentOrder::Attack(o)) if o.target_id == "w1"));
}

#[test]
fn the_invariant_catches_an_attack_order_from_below_and_the_tick_ends_it() {
    let mut world = setup();
    let terrain = crate::test_support::plains(SIZE);
    let check = || crate::wall_walk::none_attack_up_from_below;
    assert_eq!(check()(&world, &terrain), vec![]);
    live_mut(&mut world, "b1").order = Some(ResidentOrder::Attack(attack_order("a1", true, false)));
    let found = check()(&world, &terrain);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].entity_ids, ["b1", "a1"]);
    run(&mut world, SIZE, 1);
    assert_eq!(check()(&world, &terrain), vec![]);
}
