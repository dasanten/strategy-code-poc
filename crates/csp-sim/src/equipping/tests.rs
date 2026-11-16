//! Swapping and taking off gear (`CONTEXT.md`: Equipment), through the order queue and the
//! running game, and the script calls that give the same orders.

use csp_shared::balance::EQUIP_TICKS;
use csp_shared::world::{Good, Stock, WorldState};
use serde_json::json;

use super::*;
use crate::equipment::{equipped, settle_equipment, Slot};
use crate::game_test_world::{player, run_script, Game};
use crate::queries::residents::is_armed;
use crate::test_world::{empty_world, realm, resident};

const SIZE: i32 = 64;

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

/// Realm r1 (Player 7) with a1 at (10, 10) carrying a Sword (equipped) and a Spear; realm r2
/// (Player 8) with b1 next to them.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    let a = resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "b1", Some("r2"), 11.0, 10.0);
    world.residents[a].carried = stock(&[(Good::Sword, 1.0), (Good::Spear, 1.0)]);
    settle_equipment(&mut world.residents[a]);
    assert_eq!(world.residents[a].equipped.weapon, Some(Good::Sword));
    world
}

fn game(world: WorldState) -> Game {
    let mut g = Game::new(world, crate::test_support::plains(SIZE)).checking(&[
        "equipment-sound",
        "attack-orders-sound",
        "given-under-attack-sound",
    ]);
    g.walks = false;
    g
}

fn equip(id: &str, good: &str) -> serde_json::Value {
    json!({ "kind": "equip", "residentId": id, "good": good })
}

fn take_off(id: &str, slot: &str) -> serde_json::Value {
    json!({ "kind": "takeOff", "residentId": id, "slot": slot })
}

#[test]
fn an_equip_order_swaps_the_item_in_after_the_ticks_and_the_old_one_stays_carried() {
    let mut g = game(setup());
    assert_eq!(g.order(7, equip("a1", "spear")), "ack");
    for _ in 1..EQUIP_TICKS as usize {
        g.tick();
        assert_eq!(g.r("a1").equipped.weapon, Some(Good::Sword), "not swapped yet");
        assert!(is_equipping(g.r("a1")));
    }
    g.tick();
    let a = g.r("a1");
    assert_eq!(a.equipped.weapon, Some(Good::Spear));
    assert_eq!(a.carried.get(&Good::Sword), Some(&1.0), "the sword stays carried");
    assert!(a.order.is_none(), "the order is done");
    g.run(3);
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Spear), "the slot keeps what was put in");
}

#[test]
fn swapping_strikes_no_blows_even_when_struck_and_given_under_attack() {
    let mut world = setup();
    // b1 is attacking a1 already.
    world.residents[0].struck = Some(csp_shared::world::Struck { by: "b1".into(), tick: 0.0 });
    let mut g = game(world);
    assert_eq!(
        g.order(8, json!({ "kind": "attack", "residentId": "b1", "targetId": "a1" })),
        "ack"
    );
    assert_eq!(g.order(7, equip("a1", "spear")), "ack");
    let b_health = g.r("b1").health;
    for _ in 0..EQUIP_TICKS as usize {
        g.tick();
        assert_eq!(g.r("b1").health, b_health, "a1 strikes no blows while swapping");
    }
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Spear), "the swap went through the blows");
    // Struck again with the swap done, they fight back with the Spear.
    let mut fought = false;
    for _ in 0..20 {
        g.tick();
        if g.r("b1").health < b_health {
            fought = true;
            break;
        }
    }
    assert!(fought, "armed again, a1 fights back");
}

#[test]
fn taking_off_leaves_the_item_carried_the_slot_empty_and_the_resident_unarmed() {
    let mut g = game(setup());
    assert_eq!(g.order(7, take_off("a1", "weapon")), "ack");
    g.run(EQUIP_TICKS as usize);
    let a = g.r("a1");
    assert_eq!(a.equipped.weapon, None);
    assert_eq!(equipped(a, Slot::Weapon), None, "the spear doesn't fill the slot");
    assert!(!is_armed(a));
    assert_eq!(a.carried.get(&Good::Sword), Some(&1.0));
    assert_eq!(a.carried.get(&Good::Spear), Some(&1.0));
    g.run(3);
    assert_eq!(g.r("a1").equipped.weapon, None, "the slot stays empty");
    // Picking up another weapon fills it at once again.
    g.r_mut("a1").carried.insert(Good::SteelSword, 1.0);
    g.tick();
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::SteelSword));
}

#[test]
fn a_slot_kept_empty_fills_on_the_next_pickup_after_something_was_put_down() {
    let mut g = game(setup());
    g.order(7, take_off("a1", "weapon"));
    g.run(EQUIP_TICKS as usize);
    g.r_mut("a1").carried.shift_remove(&Good::Sword);
    g.tick();
    assert_eq!(g.r("a1").equipped.weapon, None, "putting one down fills nothing");
    g.r_mut("a1").carried.insert(Good::Sword, 1.0);
    g.tick();
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Sword), "the pickup fills it");
}

#[test]
fn putting_on_after_taking_off_works_and_ends_keeping_it_empty() {
    let mut g = game(setup());
    g.order(7, take_off("a1", "weapon"));
    g.run(EQUIP_TICKS as usize);
    assert_eq!(g.order(7, equip("a1", "spear")), "ack");
    g.run(EQUIP_TICKS as usize);
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Spear));
    assert!(g.r("a1").equipped.kept_off.is_empty());
}

#[test]
fn refuses_what_is_not_carried_not_gear_already_equipped_an_empty_slot_or_another_realms() {
    let mut g = game(setup());
    assert_eq!(g.order(7, equip("a1", "steelSword")), "doesn’t carry a steelSword");
    assert_eq!(g.order(7, equip("a1", "wood")), "wood goes in no equipment slot");
    assert_eq!(g.order(7, equip("a1", "sword")), "sword is equipped already");
    assert_eq!(g.order(7, equip("a1", "nonsense")), "no such good");
    assert_eq!(g.order(7, take_off("a1", "shield")), "nothing in the shield slot");
    assert_eq!(g.order(7, take_off("a1", "hat")), "slot must be weapon, shield or armour");
    assert_eq!(g.order(7, equip("b1", "sword")), "not one of your residents");
    assert!(g.r("a1").order.is_none());
}

#[test]
fn a_swap_whose_item_was_put_down_meanwhile_does_nothing() {
    let mut g = game(setup());
    g.order(7, equip("a1", "spear"));
    g.tick();
    g.r_mut("a1").carried.shift_remove(&Good::Spear);
    g.run(EQUIP_TICKS as usize);
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Sword));
    assert!(g.r("a1").order.is_none());
}

#[test]
fn a_shield_and_armour_swap_into_their_own_slots() {
    let mut world = setup();
    world.residents[0].carried.insert(Good::Shield, 1.0);
    world.residents[0].carried.insert(Good::SteelShield, 1.0);
    settle_equipment(&mut world.residents[0]);
    assert_eq!(world.residents[0].equipped.shield, Some(Good::SteelShield));
    let mut g = game(world);
    assert_eq!(g.order(7, equip("a1", "shield")), "ack");
    g.run(EQUIP_TICKS as usize);
    assert_eq!(g.r("a1").equipped.shield, Some(Good::Shield));
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Sword), "the weapon is untouched");
}

#[test]
fn the_script_calls_give_the_same_orders_and_answer_why_not() {
    let world = setup();
    let terrain = crate::test_support::plains(SIZE);
    let mara = player(7);
    let (answer, requests) =
        run_script(&world, &terrain, &mara, "a1", "memory.answer = equip(\"spear\")");
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
    assert_eq!(
        serde_json::to_value(&requests).unwrap(),
        json!([{ "kind": "equip", "residentId": "a1", "good": "spear" }])
    );
    let (_, requests) =
        run_script(&world, &terrain, &mara, "a1", "memory.answer = takeOff(\"weapon\")");
    assert_eq!(
        serde_json::to_value(&requests).unwrap(),
        json!([{ "kind": "takeOff", "residentId": "a1", "slot": "weapon" }])
    );
    let (answer, requests) =
        run_script(&world, &terrain, &mara, "a1", "memory.answer = equip(\"steelSword\")");
    assert_eq!(answer, Some(json!("doesn’t carry a steelSword")));
    assert_eq!(requests, vec![]);

    // Run as the game runs them, the script's order swaps like the Player's.
    let mut g = game(world);
    let (_, requests) =
        run_script(&g.world, &terrain, &mara, "a1", "memory.answer = equip(\"spear\")");
    for r in requests {
        assert_eq!(g.order(7, serde_json::to_value(r).unwrap()), "ack");
    }
    g.run(EQUIP_TICKS as usize);
    assert_eq!(g.r("a1").equipped.weapon, Some(Good::Spear));
}
