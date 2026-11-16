//! Shooting (`CONTEXT.md`: Ranged combat): an archer with a Bow or Crossbow equipped shoots anyone
//! they may strike within their weapon's reach, one Arrow a shot; out of Arrows they punch.

use csp_shared::balance::{
    MAX_HEALTH, MIN_BLOW_DAMAGE, SHOT_DAMAGE, SHOT_REACH, SHOT_TICKS, STRIKE_TICKS,
};
use csp_shared::world::{AlarmKind, Good, RealmEventWhat, SkillName, Stat, WorldState};

use super::*;
use crate::alarms::GameAlarms;
use crate::defence::under_attack;
use crate::game_test_world::Game;
use crate::invariants::invariant_named;
use crate::order_sender::OrderSender;
use crate::queries::combat::{protection, strike_reach};
use crate::test_world::{add_city, empty_world, live, live_mut, realm, resident, run};

const SIZE: i32 = 256;
const ME: u64 = 7;

fn stock(goods: &[(Good, f64)]) -> csp_shared::world::Stock {
    goods.iter().copied().collect()
}

fn reach(weapon: &str) -> f64 {
    SHOT_REACH.get(weapon).expect("a reach")
}

/// Realm r1's a1 at (10, 10) with `weapon` equipped and `arrows` Arrows; realm r2's b1 `apart`
/// tiles east, who never dodges.
fn archers(weapon: Good, arrows: f64, apart: f64) -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    let a = resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    let b = resident(&mut world, "b1", Some("r2"), 10.0 + apart, 10.0);
    world.residents[a].carried = stock(&[(weapon, 1.0), (Good::Arrows, arrows)]);
    crate::equipment::settle_equipment(&mut world.residents[a]);
    world.residents[b].stats.agility = Stat { base: 0.0, trained: 0.0 };
    world
}

fn order(world: &mut WorldState, resident_id: &str, target_id: &str) -> &'static str {
    let sender = OrderSender::player(ME, "Mara");
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

fn arrows(world: &WorldState, id: &str) -> f64 {
    live(world, id).unwrap().carried.get(&Good::Arrows).copied().unwrap_or(0.0)
}

fn health(world: &WorldState, id: &str) -> f64 {
    live(world, id).unwrap().health
}

#[test]
fn a_bowman_hits_a_target_within_reach_and_not_beyond() {
    let r = reach("bow");
    let mut world = archers(Good::Bow, 10.0, r);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    run(&mut world, SIZE, SHOT_TICKS.get("bow").unwrap() as usize);
    let shot = shot_damage(live(&world, "a1").unwrap(), live(&world, "b1").unwrap(), "bow");
    assert!((health(&world, "b1") - (MAX_HEALTH - shot)).abs() < 1e-9, "hit from {r} tiles");
    assert_eq!(arrows(&world, "a1"), 9.0);
    // A tile further, no shot reaches.
    let mut world = archers(Good::Bow, 10.0, r + 1.0);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    run(&mut world, SIZE, 20);
    assert_eq!(health(&world, "b1"), MAX_HEALTH);
    assert_eq!(arrows(&world, "a1"), 10.0);
}

#[test]
fn an_archer_walks_only_until_in_reach_and_shoots_from_there() {
    let world = archers(Good::Crossbow, 10.0, 12.0);
    let mut game = Game::new(world, crate::test_support::plains(SIZE))
        .checking(&["attack-orders-sound", "shots-within-reach"]);
    game.walks = true;
    let attack = serde_json::json!({ "kind": "attack", "residentId": "a1", "targetId": "b1" });
    assert_eq!(game.order(ME, attack), "ack");
    game.until_hit("b1", 600).expect("a shot lands");
    let (a, b) = (game.r("a1"), game.r("b1"));
    assert_eq!(b.x - a.x, reach("crossbow"), "stopped at the crossbow's reach");
    // A Bow reaches further than a Crossbow.
    assert!(reach("bow") > reach("crossbow"));
}

#[test]
fn each_shot_takes_an_arrow_and_out_of_arrows_they_punch_in_contact() {
    let mut world = archers(Good::Bow, 2.0, 1.0);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    let bow = SHOT_TICKS.get("bow").unwrap() as usize;
    run(&mut world, SIZE, bow);
    assert_eq!(arrows(&world, "a1"), 1.0, "a shot in contact uses an Arrow too");
    run(&mut world, SIZE, bow);
    assert_eq!(arrows(&world, "a1"), 0.0);
    assert!(!live(&world, "a1").unwrap().carried.contains_key(&Good::Arrows));
    // Out of Arrows: a blow every STRIKE_TICKS, with the fists (the Bow adds nothing).
    let before = health(&world, "b1");
    run(&mut world, SIZE, STRIKE_TICKS as usize);
    let fist = blow_damage(live(&world, "a1").unwrap(), live(&world, "b1").unwrap(), 0.0);
    assert!((health(&world, "b1") - (before - fist)).abs() < 1e-9);
    assert!((fist - attack_power(live(&world, "a1").unwrap(), 0.0)).abs() < 1e-9);
    // Arrows never go below none.
    assert_eq!(arrows(&world, "a1"), 0.0);
    // And out of Arrows at a distance, nothing reaches: they would walk into contact.
    let mut world = archers(Good::Bow, 0.0, 4.0);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    run(&mut world, SIZE, 10);
    assert_eq!(health(&world, "b1"), MAX_HEALTH);
}

#[test]
fn a_crossbow_does_more_than_a_bow_through_armour() {
    let mut world = archers(Good::Bow, 10.0, 3.0);
    let a = live(&world, "a1").unwrap().clone();
    let b = live_mut(&mut world, "b1");
    b.carried = stock(&[(Good::SteelArmour, 1.0), (Good::SteelShield, 1.0)]);
    crate::equipment::settle_equipment(b);
    let b = live(&world, "b1").unwrap();
    assert!(protection(b) > SHOT_DAMAGE.get("bow").unwrap());
    let bow = shot_damage(&a, b, "bow");
    let crossbow = shot_damage(&a, b, "crossbow");
    assert_eq!(bow, MIN_BLOW_DAMAGE, "a bow's arrow is kept off");
    assert!(crossbow > 2.0 * bow, "{crossbow} through armour");
    // Unarmoured, each does its own damage.
    let bare = live(&world, "a1").unwrap();
    assert_eq!(shot_damage(&a, bare, "crossbow"), SHOT_DAMAGE.get("crossbow").unwrap());
}

#[test]
fn combat_skill_moves_a_bow_far_more_than_a_crossbow() {
    let mut world = archers(Good::Bow, 10.0, 3.0);
    let b = live(&world, "b1").unwrap().clone();
    let novice = live(&world, "a1").unwrap().clone();
    live_mut(&mut world, "a1").skills.insert(SkillName::Combat, 1000.0);
    let master = live(&world, "a1").unwrap();
    let gain = |w: &str| shot_damage(master, &b, w) / shot_damage(&novice, &b, w);
    assert!((gain("bow") - 3.0).abs() < 1e-9, "{}", gain("bow"));
    assert!(gain("crossbow") < 1.5, "{}", gain("crossbow"));
    assert!(gain("bow") > 2.0 * gain("crossbow"));
}

#[test]
fn a_shot_is_a_strike_it_raises_under_attack_the_attacked_alarm_and_the_fight() {
    let mut world = archers(Good::Bow, 10.0, 6.0);
    // b1's neighbour w1, armed, in city c1 of realm r2: an attacked alarm reaches them.
    add_city(&mut world, "c1", Some("r2"), 16.0, 11.0, None);
    live_mut(&mut world, "b1").city_id = Some("c1".into());
    let w = resident(&mut world, "w1", Some("r2"), 17.0, 10.0);
    world.residents[w].city_id = Some("c1".into());
    world.residents[w].carried = stock(&[(Good::Spear, 1.0)]);
    crate::equipment::settle_equipment(&mut world.residents[w]);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    let mut hit = false;
    for _ in 0..SHOT_TICKS.get("bow").unwrap() as usize {
        let strikes = request_strikes(&mut world, SIZE);
        resolve_strikes(&mut world, &strikes, SIZE, &mut GameAlarms, &mut Default::default());
        hit |= !strikes.is_empty();
    }
    assert!(hit);
    let b = live(&world, "b1").unwrap();
    assert_eq!(b.struck.as_ref().map(|s| s.by.as_str()), Some("a1"));
    assert!(under_attack(&world, b));
    let alarm = live(&world, "w1").unwrap().script.as_ref().and_then(|s| s.alarm.as_ref());
    assert_eq!(alarm.map(|a| (a.kind, a.about.as_str())), Some((AlarmKind::Attacked, "a1")));
    let fights =
        world.events.iter().filter(|e| matches!(e.what, RealmEventWhat::Fight { .. })).count();
    assert_eq!(fights, 2, "the fight is in both realm logs");
}

#[test]
fn the_invariant_catches_a_blow_from_beyond_reach() {
    let mut world = archers(Good::Bow, 10.0, 3.0);
    let check = invariant_named("shots-within-reach").expect("an invariant").check;
    let terrain = crate::test_support::plains(SIZE);
    world.tick = 5;
    let r = strike_reach(live(&world, "a1").unwrap());
    assert_eq!(r, reach("bow"));
    live_mut(&mut world, "b1").struck =
        Some(csp_shared::world::Struck { by: "a1".into(), tick: 4.0 });
    assert!(check(&world, &terrain).is_empty(), "three tiles is within a bow's reach");
    live_mut(&mut world, "b1").x = 10.0 + r + 2.0;
    assert_eq!(check(&world, &terrain).len(), 1);
    // A blow struck before the last tick is not looked at again.
    live_mut(&mut world, "b1").struck.as_mut().unwrap().tick = 3.0;
    assert!(check(&world, &terrain).is_empty());
    // Without a ranged weapon, reach is contact.
    live_mut(&mut world, "a1").carried.clear();
    assert_eq!(strike_reach(live(&world, "a1").unwrap()), 1.0);
}
