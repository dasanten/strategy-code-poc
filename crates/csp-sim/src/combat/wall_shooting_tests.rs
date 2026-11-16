//! Shooting from and at the wall (T108.3, `CONTEXT.md`: Ranged combat, Walls in combat; ADR 0036):
//! an archer up on a wall walk reaches further, archers on the ground shoot those up (the one way
//! to hit them from below), and those up on their own city's wall keep its cover against shots.

use csp_shared::balance::{
    MAX_HEALTH, SHOT_REACH, SHOT_TICKS, WALL_DEFENCE, WALL_SHOT_REACH_BONUS,
};
use csp_shared::world::{BuildingKind, Good, ResidentOrder, Stat, UpSide};

use super::*;
use crate::game_test_world::Game;
use crate::order_sender::OrderSender;
use crate::queries::combat::strike_reach;
use crate::test_world::{
    add_city, building, empty_world, live, live_mut, realm, resident, run, until_hit,
};

const SIZE: i32 = 256;

fn stock(goods: &[(Good, f64)]) -> csp_shared::world::Stock {
    goods.iter().copied().collect()
}

fn bow_reach() -> f64 {
    SHOT_REACH.get("bow").expect("a reach")
}

fn bow_ticks() -> usize {
    SHOT_TICKS.get("bow").expect("ticks") as usize
}

/// Realm r1 (Player 7) with city c1, whose wall tile w1 at (10, 10) has a1 up on it with a Bow and
/// 40 Arrows; realm r2 (Player 8) with city c2 far away, and b1 of it on the ground `apart` tiles
/// east. Neither dodges, so a hit is a hit.
fn setup(apart: f64, b_gear: &[(Good, f64)]) -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    add_city(&mut world, "c1", Some("r1"), 10.0, 14.0, None);
    add_city(&mut world, "c2", Some("r2"), 60.0, 60.0, None);
    building(&mut world, "w1", BuildingKind::Wall, Some("c1"), 10.0, 10.0);
    let a = resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    let b = resident(&mut world, "b1", Some("r2"), 10.0 + apart, 10.0);
    for (i, city) in [(a, "c1"), (b, "c2")] {
        let r = &mut world.residents[i];
        r.city_id = Some(city.into());
        r.stats.agility = Stat { base: 0.0, trained: 0.0 };
    }
    world.residents[a].up = Some(UpSide::Inside);
    world.residents[a].carried = stock(&[(Good::Bow, 1.0), (Good::Arrows, 40.0)]);
    world.residents[b].carried = stock(b_gear);
    for r in &mut world.residents {
        crate::equipment::settle_equipment(r);
    }
    world
}

fn order(world: &mut WorldState, user_id: u64, resident_id: &str, target_id: &str) -> &'static str {
    let sender = OrderSender::player(user_id, "Mara");
    let request =
        AttackRequest { resident_id: Some(resident_id.into()), target_id: Some(target_id.into()) };
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
fn an_archer_up_on_the_wall_hits_a_target_beyond_a_ground_archers_reach() {
    let far = bow_reach() + WALL_SHOT_REACH_BONUS;
    let mut world = setup(far, &[]);
    assert_eq!(strike_reach(&world, live(&world, "a1").unwrap()), far);
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", bow_ticks()).is_some(), "hit from {far} tiles");
    // Off the wall, the same archer reaches no further than their Bow.
    let mut world = setup(far, &[]);
    live_mut(&mut world, "a1").up = None;
    world.buildings.retain(|b| b.id != "w1");
    assert_eq!(strike_reach(&world, live(&world, "a1").unwrap()), bow_reach());
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    run(&mut world, SIZE, 4 * bow_ticks());
    assert_eq!(health(&world, "b1"), MAX_HEALTH);
}

#[test]
fn a_ground_archer_hits_a_defender_up_with_the_walls_cover() {
    let mut world = setup(5.0, &[(Good::Bow, 1.0), (Good::Arrows, 10.0)]);
    assert_eq!(order(&mut world, 8, "b1", "a1"), "ack");
    let shot = shot_damage(live(&world, "b1").unwrap(), live(&world, "a1").unwrap(), "bow");
    assert!(until_hit(&mut world, SIZE, "a1", bow_ticks()).is_some());
    let taken = MAX_HEALTH - health(&world, "a1");
    // The archer learns a little Combat from the shot before it lands.
    assert!((taken - shot * WALL_DEFENCE).abs() < 0.01, "{taken} of {shot}");
    // In contact too: an archer below shoots up where a blow can't reach.
    let mut world = setup(1.0, &[(Good::Crossbow, 1.0), (Good::Arrows, 10.0)]);
    assert_eq!(order(&mut world, 8, "b1", "a1"), "ack");
    let ticks = SHOT_TICKS.get("crossbow").unwrap() as usize;
    assert!(until_hit(&mut world, SIZE, "a1", ticks).is_some());
    assert!(matches!(live(&world, "b1").unwrap().order, Some(ResidentOrder::Attack(_))));
}

#[test]
fn a_ground_swordsman_still_cant_strike_them_nor_an_archer_out_of_arrows() {
    let mut world = setup(1.0, &[(Good::Sword, 1.0)]);
    assert_eq!(order(&mut world, 8, "b1", "a1"), "they are up on the wall");
    let mut world = setup(1.0, &[(Good::Bow, 1.0)]);
    assert_eq!(order(&mut world, 8, "b1", "a1"), "they are up on the wall");
    // Given it anyway (a script, say), no blow lands and the order ends.
    live_mut(&mut world, "b1").order =
        Some(ResidentOrder::Attack(attack_order("a1", false, false)));
    run(&mut world, SIZE, 10);
    assert_eq!(health(&world, "a1"), MAX_HEALTH);
    assert!(live(&world, "b1").unwrap().order.is_none());
}

#[test]
fn a_ground_archer_shot_at_from_the_wall_shoots_back_up_rather_than_flee() {
    let mut world = setup(5.0, &[(Good::Bow, 1.0), (Good::Arrows, 10.0)]);
    // An NPC city's resident reacts by built-in orders (a Player's by their defence script).
    live_mut(&mut world, "b1").owner = None;
    world.cities.iter_mut().find(|c| c.id == "c2").unwrap().realm_id = None;
    assert_eq!(order(&mut world, 7, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", bow_ticks()).is_some());
    let b = live(&world, "b1").unwrap();
    assert!(
        matches!(&b.order, Some(ResidentOrder::Attack(o)) if o.target_id == "a1"),
        "{:?}",
        b.order
    );
}

/// One duel: a1 up on their wall and b1 on the ground, both with a Bow, b1 starting out of reach
/// and walking in. Who is left standing.
fn duel(seed: u32) -> (f64, f64) {
    let mut world = setup(bow_reach() + 3.0, &[(Good::Bow, 1.0), (Good::Arrows, 40.0)]);
    world.seed = i64::from(seed);
    for r in &mut world.residents {
        r.stats.agility = Stat { base: 10.0, trained: 0.0 };
    }
    let mut game = Game::new(world, crate::test_support::plains(SIZE)).checking(&[
        "attack-orders-sound",
        "shots-within-reach",
        "none-attack-up-from-below",
    ]);
    game.walks = true;
    let attack = |by: &str, at: &str| serde_json::json!({ "kind": "attack", "residentId": by, "targetId": at });
    assert_eq!(game.order(7, attack("a1", "b1")), "ack");
    assert_eq!(game.order(8, attack("b1", "a1")), "ack");
    for _ in 0..600 {
        game.tick();
        let alive = |id: &str| game.world.residents.iter().any(|r| r.id == id && r.health > 0.0);
        if !alive("a1") || !alive("b1") {
            break;
        }
    }
    let left =
        |id: &str| game.world.residents.iter().find(|r| r.id == id).map_or(0.0, |r| r.health);
    (left("a1"), left("b1"))
}

#[test]
fn archer_duels_between_wall_and_ground_go_to_the_wall() {
    let mut wall = 0;
    for seed in 1..=12 {
        let (a, b) = duel(seed);
        if a > 0.0 && b <= 0.0 {
            wall += 1;
        }
    }
    assert!(wall >= 11, "the wall won {wall} of 12");
}
