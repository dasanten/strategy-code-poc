//! `apps/server/src/combat.test.ts`, ported one to one where the conflict phases alone run it.
//! The TypeScript steps the whole world with the default scripts; here the conflict phases step
//! (`test_world::step`), so a test that needs walking (T86.4) or the Defend default (T86.12)
//! is kept, ignored, with what it waits for.

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, BLOW_BASE, BLOW_PER_STRENGTH, COMBAT_SKILL_LIMIT, DODGE_LIMIT, MAX_HEALTH, MAX_HUNGER,
    MIN_BLOW_DAMAGE, PROTECTION_DEFENCE, SIGHT_RANGE, STRIKE_TICKS, WEAPON_ATTACK,
};
use csp_shared::world::{
    Alliance, AllianceMember, Carriage, DeathCause, DriveOrder, Good, Horse, Interrupted, RealmEventWhat,
    ResidentOrder, SkillName, Stat, Task, Tile, WalkOrder, WorldState,
};

use super::*;
use crate::armies::{apply_army_order, validate_army_order, ArmyOrderKind, ArmyRequest};
use crate::pending::Sender;
use crate::queries::residents::{best_weapon, is_armed};
use crate::queries::combat::protection;
use crate::test_world::{add_city, empty_world, live, live_mut, realm, resident, run, until_hit};

const SIZE: i32 = 256;
const ME: u64 = 7;

fn stock(goods: &[(Good, f64)]) -> csp_shared::world::Stock {
    goods.iter().copied().collect()
}

/// A world with realm r1 (Player 7, Leader a1) and realm r2 (Player 8, Leader b1), a1 at (10, 10)
/// and b1 next to them at (11, 10).
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "b1", Some("r2"), 11.0, 10.0);
    world
}

/// Sends an attack order from Player 7 and answers whether it was taken (`order`).
fn order(world: &mut WorldState, resident_id: &str, target_id: &str) -> &'static str {
    let sender = Sender { user_id: ME, npc_city_id: None };
    let request = AttackRequest { resident_id: Some(resident_id.into()), target_id: Some(target_id.into()) };
    if let Some(reason) = validate_attack(world, &sender, &request, Some(SIZE)) {
        return reason;
    }
    apply_attack(world, &request, Some(SIZE));
    "ack"
}

fn stat(base: f64) -> Stat {
    Stat { base, trained: 0.0 }
}

#[test]
fn a_blow_comes_from_strength_and_the_best_weapon_carried_harder_with_combat_skill() {
    let mut world = empty_world();
    let r = resident(&mut world, "x", None, 0.0, 0.0);
    let fist = BLOW_BASE + BLOW_PER_STRENGTH * 10.0;
    assert!((attack_power(&world.residents[r], 0.0) - fist).abs() < 1e-9);
    world.residents[r].carried = stock(&[(Good::Spear, 1.0), (Good::Sword, 1.0)]);
    assert_eq!(best_weapon(&world.residents[r].carried), Some(Good::Sword));
    assert!(is_armed(&world.residents[r].carried));
    let sword = WEAPON_ATTACK.get("sword").unwrap();
    assert!((attack_power(&world.residents[r], 0.0) - (fist + sword)).abs() < 1e-9);
    world.residents[r].skills.insert(SkillName::Combat, 1000.0);
    assert!((attack_power(&world.residents[r], 0.0) - (fist + sword) * (1.0 + COMBAT_SKILL_LIMIT)).abs() < 1e-9);
}

#[test]
fn a_shield_and_armour_take_damage_off_a_blow_but_a_blow_that_lands_always_hurts() {
    let mut world = empty_world();
    let a = resident(&mut world, "a", None, 0.0, 0.0);
    let d = resident(&mut world, "d", None, 0.0, 0.0);
    world.residents[a].carried = stock(&[(Good::Sword, 1.0)]);
    let full = attack_power(&world.residents[a], 0.0);
    assert!((blow_damage(&world.residents[a], &world.residents[d], 0.0) - full).abs() < 1e-9);
    world.residents[d].carried = stock(&[(Good::Shield, 2.0), (Good::Armour, 1.0)]);
    let both = PROTECTION_DEFENCE.get("shield").unwrap() + PROTECTION_DEFENCE.get("armour").unwrap();
    assert_eq!(protection(&world.residents[d]), both);
    let (ar, dr) = (&world.residents[a], &world.residents[d]);
    assert!((blow_damage(ar, dr, 0.0) - (full - protection(dr))).abs() < 1e-9);
    world.residents[a].carried = Default::default();
    assert_eq!(blow_damage(&world.residents[a], &world.residents[d], 0.0), MIN_BLOW_DAMAGE);
}

#[test]
fn agility_dodges_up_to_a_limit_intellect_speeds_up_learning_combat() {
    let mut world = empty_world();
    let r = resident(&mut world, "x", None, 0.0, 0.0);
    assert_eq!(dodge_chance(&world.residents[r], 0.0), 0.0);
    world.residents[r].stats.agility = stat(10.0);
    assert!(dodge_chance(&world.residents[r], 0.0) > 0.0);
    world.residents[r].stats.agility = stat(100.0);
    assert_eq!(dodge_chance(&world.residents[r], 0.0), DODGE_LIMIT);
    let slow = combat_learned(&world.residents[r], 0.0);
    world.residents[r].stats.intellect = stat(20.0);
    assert!((combat_learned(&world.residents[r], 0.0) - slow * 2.0).abs() < 1e-9);
}

#[test]
fn residents_are_in_contact_on_the_same_or_a_neighbouring_tile_across_the_maps_joins() {
    assert!(in_contact(64, (3.0, 3.0), (3.0, 3.0)));
    assert!(in_contact(64, (3.0, 3.0), (4.0, 4.0)));
    assert!(!in_contact(64, (3.0, 3.0), (5.0, 3.0)));
    assert!(in_contact(64, (0.0, 0.0), (63.0, 63.0)));
}

#[test]
fn attacks_a_resident_of_another_realm_in_sight_with_one_of_your_own() {
    let mut world = setup();
    assert_eq!(order(&mut world, "b1", "a1"), "not one of your residents");
    resident(&mut world, "a2", Some("r1"), 12.0, 12.0);
    assert_eq!(order(&mut world, "a1", "a2"), "that is one of your own residents");
    assert_eq!(order(&mut world, "a1", "nobody"), "no such resident");
    live_mut(&mut world, "b1").x = 10.0 + SIGHT_RANGE + 2.0;
    assert_eq!(order(&mut world, "a1", "b1"), "that resident is out of sight");
    live_mut(&mut world, "b1").x = 11.0;
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    assert_eq!(live(&world, "a1").unwrap().order, Some(ResidentOrder::Attack(attack_order("b1", false, false))));
}

#[test]
#[ignore = "needs walking (T86.4)"]
fn walks_after_the_target_until_in_contact_then_strikes() {}

#[test]
fn ends_when_the_target_gets_out_of_the_attackers_sight() {
    let mut world = setup();
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    live_mut(&mut world, "b1").x = 10.0 + SIGHT_RANGE + 2.0;
    run(&mut world, SIZE, 1);
    assert_eq!(live(&world, "a1").unwrap().order, None);
}

#[test]
fn strikes_once_every_strike_ticks_for_the_blows_damage_and_both_learn_combat() {
    let mut world = setup();
    live_mut(&mut world, "a1").carried = stock(&[(Good::Sword, 1.0)]);
    live_mut(&mut world, "b1").carried = stock(&[(Good::Armour, 1.0)]);
    live_mut(&mut world, "b1").order =
        Some(ResidentOrder::WalkTo(WalkOrder { target: Tile { x: 11.0, y: 10.0 }, path: Some(vec![]), progress: 0.0, army: None }));
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    let damage = blow_damage(live(&world, "a1").unwrap(), live(&world, "b1").unwrap(), world.tick as f64);
    let armour = PROTECTION_DEFENCE.get("armour").unwrap();
    assert!((damage - (attack_power(live(&world, "a1").unwrap(), 0.0) - armour)).abs() < 1e-9);
    run(&mut world, SIZE, STRIKE_TICKS as usize - 1);
    assert!((live(&world, "b1").unwrap().health - MAX_HEALTH).abs() < 0.5);
    run(&mut world, SIZE, 1);
    assert!((live(&world, "b1").unwrap().health - (MAX_HEALTH - damage)).abs() < 0.5);
    assert!(live(&world, "a1").unwrap().skills[&SkillName::Combat] > 0.0);
    assert!(live(&world, "b1").unwrap().skills[&SkillName::Combat] > 0.0);
}

#[test]
fn an_agile_resident_dodges_some_blows() {
    let mut world = setup();
    live_mut(&mut world, "b1").stats.agility = stat(25.0);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    let mut landed = 0;
    for _ in 0..40 {
        let before = live(&world, "b1").unwrap().health;
        run(&mut world, SIZE, STRIKE_TICKS as usize);
        if live(&world, "b1").unwrap().health < before - 0.5 {
            landed += 1;
        }
        let b = live_mut(&mut world, "b1");
        b.health = MAX_HEALTH;
        b.order = None;
    }
    assert!(landed > 5, "{landed} landed");
    assert!(landed < 35, "{landed} landed");
    assert!(matches!(live(&world, "a1").unwrap().order, Some(ResidentOrder::Attack(_))));
}

#[test]
fn the_target_keeps_who_struck_them_and_when_a_dodged_blow_too() {
    let mut world = setup();
    live_mut(&mut world, "b1").stats.agility = stat(25.0);
    assert_eq!(live(&world, "b1").unwrap().struck, None);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    let mut dodged = 0;
    for _ in 0..20 {
        let before = live(&world, "b1").unwrap().health;
        run(&mut world, SIZE, STRIKE_TICKS as usize);
        if live(&world, "b1").unwrap().health >= before - 0.5 {
            dodged += 1;
        }
        let struck = live(&world, "b1").unwrap().struck.clone().unwrap();
        assert_eq!((struck.by.as_str(), struck.tick), ("a1", world.tick as f64 - 1.0));
        let b = live_mut(&mut world, "b1");
        b.health = MAX_HEALTH;
        b.order = None;
    }
    assert!(dodged > 0);
}

/// The first half of the TypeScript test; the rest (Defend gives the attack order back) is the
/// Defend default's, T86.12.
#[test]
fn an_armed_resident_who_is_hit_fights_back_by_their_defence_script() {
    let mut world = setup();
    live_mut(&mut world, "b1").carried = stock(&[(Good::Spear, 1.0)]);
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 20).is_some());
    // Idle before, they stand idle again once it ends.
    let b = live(&world, "b1").unwrap();
    assert_eq!(b.interrupted, Some(Interrupted { order: None, script: None, alarm: None }));
    assert_eq!(b.script.as_ref().and_then(|s| s.task), Some(Task::Defend));
}

#[test]
#[ignore = "needs the Defend default script (T86.12)"]
fn an_unarmed_resident_who_is_hit_flees_home_to_their_citys_town_hall() {}

#[test]
fn a_resident_of_an_npc_city_reacts_by_built_in_orders_fighting_back_or_fleeing_home() {
    let mut world = setup();
    add_city(&mut world, "c3", None, 30.0, 30.0, None);
    resident(&mut world, "n1", None, 11.0, 10.0);
    live_mut(&mut world, "n1").city_id = Some("c3".into());
    assert_eq!(order(&mut world, "a1", "n1"), "ack");
    assert!(until_hit(&mut world, SIZE, "n1", 20).is_some());
    let v = live(&world, "n1").unwrap();
    assert_eq!(v.interrupted, None);
    assert!(matches!(&v.order, Some(ResidentOrder::WalkTo(w)) if w.target == Tile { x: 30.0, y: 30.0 }));
    let v = live_mut(&mut world, "n1");
    v.carried = stock(&[(Good::Spear, 1.0)]);
    v.order = None;
    assert!(until_hit(&mut world, SIZE, "n1", 20).is_some());
    assert!(matches!(&live(&world, "n1").unwrap().order,
        Some(ResidentOrder::Attack(o)) if o.target_id == "a1" && o.defending == Some(true)));
}

/// An NPC city's carriage k1 with a horse at (11, 10), driver n1 on it, attacker a1 beside.
fn on_carriage() -> WorldState {
    let mut world = setup();
    add_city(&mut world, "c3", None, 30.0, 30.0, None);
    world.horses.push(Horse {
        id: "h1".into(),
        name: "Rowan".into(),
        realm_id: None,
        city_id: Some("c3".into()),
        x: 11.0,
        y: 10.0,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: csp_shared::world::HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        },
        born_at: 0.0,
        down_until: None,
    });
    world.carriages.push(Carriage {
        id: "k1".into(),
        realm_id: None,
        city_id: Some("c3".into()),
        x: 11.0,
        y: 10.0,
        horse_id: Some("h1".into()),
        load: Default::default(),
    });
    resident(&mut world, "n1", None, 11.0, 10.0);
    let driver = live_mut(&mut world, "n1");
    driver.city_id = Some("c3".into());
    driver.order = Some(ResidentOrder::Drive(DriveOrder {
        carriage_id: "k1".into(),
        target: Tile { x: 11.0, y: 30.0 },
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    }));
    world
}

/// Without walking (T86.4) the carriage stands; the driver's reaction is the same.
#[test]
fn an_unarmed_driver_drives_on() {
    let mut world = on_carriage();
    assert_eq!(order(&mut world, "a1", "n1"), "ack");
    assert!(until_hit(&mut world, SIZE, "n1", 20).is_some());
    let driver = live(&world, "n1").unwrap();
    assert!(matches!(&driver.order, Some(ResidentOrder::Drive(d)) if d.carriage_id == "k1"));
    assert_eq!(driver.interrupted, None);
}

#[test]
fn an_armed_driver_fights_back() {
    let mut world = on_carriage();
    live_mut(&mut world, "n1").carried = stock(&[(Good::Spear, 1.0)]);
    assert_eq!(order(&mut world, "a1", "n1"), "ack");
    assert!(until_hit(&mut world, SIZE, "n1", 20).is_some());
    assert!(matches!(&live(&world, "n1").unwrap().order,
        Some(ResidentOrder::Attack(o)) if o.target_id == "a1" && o.defending == Some(true)));
}

#[test]
fn an_unarmed_passenger_stays_aboard_while_it_is_driven_and_gets_off_once_it_stands() {
    let mut world = on_carriage();
    resident(&mut world, "n2", None, 11.0, 10.0);
    let p = live_mut(&mut world, "n2");
    p.city_id = Some("c3".into());
    p.aboard = Some("k1".into());
    assert_eq!(order(&mut world, "a1", "n2"), "ack");
    // The blows alone, without the city's own orders for someone idle.
    let strike = [StrikeAction { attacker_id: "a1".into(), target_id: "n2".into() }];
    assert_eq!(resolve_strikes(&mut world, &strike, SIZE, &mut crate::defence::NoAlarms).blows, 1);
    let p = live(&world, "n2").unwrap();
    assert_eq!(p.struck.as_ref().map(|s| s.by.as_str()), Some("a1"));
    assert_eq!(p.aboard.as_deref(), Some("k1"));
    assert_eq!(p.order, None);

    live_mut(&mut world, "n1").order = None;
    resolve_strikes(&mut world, &strike, SIZE, &mut crate::defence::NoAlarms);
    let p = live(&world, "n2").unwrap();
    assert_eq!(p.aboard, None);
    assert!(matches!(&p.order, Some(ResidentOrder::WalkTo(w)) if w.target == Tile { x: 30.0, y: 30.0 }));
}

#[test]
fn an_armed_passenger_gets_off_and_fights_back() {
    let mut world = on_carriage();
    resident(&mut world, "n2", None, 11.0, 10.0);
    let p = live_mut(&mut world, "n2");
    p.city_id = Some("c3".into());
    p.aboard = Some("k1".into());
    p.carried = stock(&[(Good::Spear, 1.0)]);
    assert_eq!(order(&mut world, "a1", "n2"), "ack");
    assert!(until_hit(&mut world, SIZE, "n2", 20).is_some());
    let p = live(&world, "n2").unwrap();
    assert_eq!(p.aboard, None);
    assert!(matches!(&p.order, Some(ResidentOrder::Attack(o)) if o.target_id == "a1" && o.defending == Some(true)));
}

#[test]
fn a_fight_goes_in_both_realm_logs_once() {
    let mut world = setup();
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    run(&mut world, SIZE, 10);
    let fights: Vec<_> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::Fight { resident_id, other_id, attacker, .. } => {
                Some((e.user_id, resident_id.as_str(), other_id.as_str(), *attacker))
            }
            _ => None,
        })
        .collect();
    assert_eq!(fights, vec![(7, "a1", "b1", true), (8, "b1", "a1", false)]);
}

#[test]
fn a_killed_resident_leaves_everything_they_carried_as_loot_and_the_fight_ends() {
    let mut world = setup();
    resident(&mut world, "b2", Some("r2"), 10.0, 11.0);
    let v = live_mut(&mut world, "b2");
    v.carried = stock(&[(Good::Food, 3.0), (Good::Coins, 40.0), (Good::Shield, 1.0)]);
    v.health = 1.0;
    live_mut(&mut world, "a1").carried = stock(&[(Good::Sword, 1.0)]);
    assert_eq!(order(&mut world, "a1", "b2"), "ack");
    run(&mut world, SIZE, STRIKE_TICKS as usize);
    assert!(live(&world, "b2").is_none());
    let pile = world.piles.iter().find(|p| p.x == 10.0 && p.y == 11.0).unwrap();
    assert_eq!(pile.goods, stock(&[(Good::Food, 3.0), (Good::Coins, 40.0), (Good::Shield, 1.0)]));
    assert_eq!(live(&world, "a1").unwrap().order, None);
    let died = world.events.iter().find(|e| matches!(e.what, RealmEventWhat::Died { .. })).unwrap();
    assert_eq!(died.user_id, 8);
    assert!(matches!(&died.what, RealmEventWhat::Died { resident_id, cause: DeathCause::Killed, by: Some(by), leader: false, .. }
        if resident_id == "b2" && by == "a1"));
}

#[test]
#[ignore = "needs endRealm (T86.3)"]
fn killing_a_leader_ends_their_realm() {
    let mut world = setup();
    live_mut(&mut world, "b1").health = 1.0;
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    run(&mut world, SIZE, STRIKE_TICKS as usize);
    assert_eq!(world.realms.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["r1"]);
}

// `combat invariants` (`deadLeaveLoot`, `attackOrdersSound`) are `invariants.ts`'s: T86.13.

/// The setup world with r1 and r2 in one alliance, both residents armed and next to each other.
fn allied() -> WorldState {
    let mut world = setup();
    world.alliances.push(Alliance {
        id: "alliance-1".into(),
        name: "North".into(),
        leader_id: "r1".into(),
        members: ["r1", "r2"]
            .iter()
            .map(|id| AllianceMember { realm_id: (*id).into(), joined_at: 0.0, leaving: None })
            .collect(),
        invites: vec![],
        army: vec![],
    });
    live_mut(&mut world, "a1").carried = stock(&[(Good::Spear, 1.0)]);
    live_mut(&mut world, "b1").carried = stock(&[(Good::Spear, 1.0)]);
    world
}

#[test]
fn armed_allies_side_by_side_leave_each_other_alone() {
    let mut world = allied();
    assert_eq!(until_hit(&mut world, SIZE, "a1", STRIKE_TICKS as usize * 3), None);
    assert_eq!((live(&world, "a1").unwrap().order.clone(), live(&world, "b1").unwrap().order.clone()), (None, None));
    assert!(world.crimes.is_empty());
}

/// The first half of the TypeScript test; Defend fighting back is T86.12's.
#[test]
fn a_direct_order_attacks_an_ally_and_that_is_a_crime() {
    let mut world = allied();
    assert_eq!(order(&mut world, "a1", "b1"), "ack");
    assert!(until_hit(&mut world, SIZE, "b1", 20).is_some());
    assert_eq!(world.crimes.len(), 1);
    let c = &world.crimes[0];
    assert_eq!(c.kind, csp_shared::world::CrimeKind::Attack);
    assert_eq!((c.victim_org.as_str(), c.culprit.resident_id.as_str(), c.culprit.org.as_str()), ("r2", "a1", "r1"));
}

#[test]
fn an_army_ordered_to_attack_an_ally_does_and_that_is_a_crime() {
    let mut world = allied();
    let send = |world: &mut WorldState, kind: ArmyOrderKind, request: ArmyRequest| {
        let answer = validate_army_order(world, kind, ME, &request, Some(SIZE));
        apply_army_order(world, kind, ME, &request);
        answer
    };
    let form = ArmyRequest { name: Some("Foot".into()), resident_ids: Some(vec!["a1".into()]), ..Default::default() };
    assert_eq!(send(&mut world, ArmyOrderKind::FormArmy, form), None);
    let army_id = world.armies[0].id.clone();
    let attack = ArmyRequest { army_id: Some(army_id), target_id: Some("b1".into()), ..Default::default() };
    assert_eq!(send(&mut world, ArmyOrderKind::ArmyAttack, attack), None);
    run(&mut world, SIZE, 1);
    assert!(until_hit(&mut world, SIZE, "b1", 20).is_some());
    assert!(matches!(world.crimes.as_slice(), [c] if c.kind == csp_shared::world::CrimeKind::Attack && c.culprit.resident_id == "a1"));
}
