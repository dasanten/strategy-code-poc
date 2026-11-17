//! The slots of [`super`]: what fills and empties them, and that only what is equipped counts.

use csp_shared::balance::{PROTECTION_DEFENCE, WEAPON_ATTACK};
use csp_shared::world::{Equipment, Good, Stock};

use super::*;
use crate::queries::combat::{protection, weapon_attack};
use crate::queries::residents::is_armed;
use crate::test_world::{empty_world, resident};

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

fn someone() -> Resident {
    let mut world = empty_world();
    let i = resident(&mut world, "x", None, 0.0, 0.0);
    world.residents.swap_remove(i)
}

#[test]
fn an_empty_slot_takes_the_best_fitting_item_carried() {
    let mut r = someone();
    r.carried = stock(&[(Good::Spear, 1.0), (Good::SteelSword, 1.0), (Good::Shield, 2.0)]);
    assert!(settle_equipment(&mut r));
    assert_eq!(
        r.equipped,
        Equipment {
            weapon: Some(Good::SteelSword),
            shield: Some(Good::Shield),
            armour: None,
            ..Equipment::default()
        }
    );
    assert!(!settle_equipment(&mut r), "settled slots stay as they are");
}

#[test]
fn a_full_slot_keeps_its_item_when_a_better_one_is_picked_up() {
    let mut r = someone();
    r.carried = stock(&[(Good::Spear, 1.0)]);
    settle_equipment(&mut r);
    r.carried.insert(Good::SteelSword, 1.0);
    settle_equipment(&mut r);
    assert_eq!(r.equipped.weapon, Some(Good::Spear));
    assert_eq!(weapon_attack(&r), WEAPON_ATTACK.get("spear").unwrap(), "only the equipped counts");
}

#[test]
fn putting_the_equipped_item_down_empties_its_slot_and_the_next_best_fills_it() {
    let mut r = someone();
    r.carried = stock(&[(Good::Sword, 1.0), (Good::Armour, 1.0)]);
    settle_equipment(&mut r);
    r.carried.insert(Good::Spear, 1.0);
    r.carried.shift_remove(&Good::Sword);
    r.carried.shift_remove(&Good::Armour);
    settle_equipment(&mut r);
    assert_eq!(r.equipped, Equipment { weapon: Some(Good::Spear), ..Equipment::default() });
}

#[test]
fn a_carried_but_unequipped_sword_does_not_count_nor_does_a_spare_shield() {
    let mut r = someone();
    r.carried = stock(&[(Good::Shield, 1.0), (Good::Armour, 1.0)]);
    assert!(!is_armed(&r), "a shield and armour are no weapon");
    r.carried.insert(Good::Spear, 1.0);
    settle_equipment(&mut r);
    r.carried.insert(Good::Sword, 1.0);
    r.carried.insert(Good::SteelShield, 1.0);
    r.carried.insert(Good::SteelArmour, 1.0);
    assert_eq!(weapon_attack(&r), WEAPON_ATTACK.get("spear").unwrap(), "the Sword is only carried");
    let worn =
        PROTECTION_DEFENCE.get("shield").unwrap() + PROTECTION_DEFENCE.get("armour").unwrap();
    assert_eq!(protection(&r), worn, "the steel spares add nothing");
    r.carried.shift_remove(&Good::Spear);
    assert!(is_armed(&r), "with the Spear put down, the Sword fills the slot at once");
    assert_eq!(equipped(&r, Slot::Weapon), Some(Good::Sword));
}

#[test]
fn an_empty_slot_counts_the_best_fitting_item_at_once_before_it_is_written_back() {
    let mut r = someone();
    r.carried = stock(&[(Good::Sword, 1.0)]);
    assert!(r.equipped.is_empty());
    assert!(is_armed(&r));
    assert_eq!(weapon_attack(&r), WEAPON_ATTACK.get("sword").unwrap());
    settle_equipment(&mut r);
    assert_eq!(r.equipped.weapon, Some(Good::Sword));
}

#[test]
fn every_slot_holds_only_its_kind() {
    for g in [Good::Spear, Good::Sword, Good::SteelSword] {
        assert!(Slot::Weapon.fits(g) && !Slot::Shield.fits(g) && !Slot::Armour.fits(g));
    }
    for g in [Good::Shield, Good::SteelShield] {
        assert!(Slot::Shield.fits(g) && !Slot::Weapon.fits(g) && !Slot::Armour.fits(g));
    }
    for g in [Good::Armour, Good::SteelArmour] {
        assert!(Slot::Armour.fits(g) && !Slot::Weapon.fits(g) && !Slot::Shield.fits(g));
    }
    assert!(!is_gear(Good::Iron) && !is_gear(Good::Food) && is_gear(Good::SteelShield));
    let mut r = someone();
    r.carried = stock(&[(Good::Shield, 1.0)]);
    r.equipped.weapon = Some(Good::Shield);
    assert!(equipment_problem(&r).is_some());
}

#[test]
fn a_bow_takes_both_hands_so_the_shield_slot_empties_and_the_shield_stays_carried() {
    let mut r = someone();
    r.carried = stock(&[(Good::Shield, 1.0)]);
    settle_equipment(&mut r);
    assert_eq!(r.equipped.shield, Some(Good::Shield));
    r.carried.insert(Good::Bow, 1.0);
    settle_equipment(&mut r);
    assert_eq!(r.equipped.weapon, Some(Good::Bow), "an empty weapon slot takes the bow");
    assert_eq!(r.equipped.shield, None, "the bow empties the shield slot");
    assert_eq!(r.carried.get(&Good::Shield), Some(&1.0), "the shield stays carried");
    assert_eq!(protection(&r), 0.0, "a shield carried beside a bow takes nothing off");
    assert!(is_armed(&r));
    assert_eq!(equipment_problem(&r), None);
    // Put the bow down and the shield goes back on.
    r.carried.shift_remove(&Good::Bow);
    settle_equipment(&mut r);
    assert_eq!(r.equipped, Equipment { shield: Some(Good::Shield), ..Equipment::default() });
}

#[test]
fn a_crossbow_strikes_no_harder_than_fists_and_keeps_the_shield_off_too() {
    let mut r = someone();
    r.carried = stock(&[(Good::Crossbow, 1.0), (Good::SteelShield, 1.0), (Good::Arrows, 40.0)]);
    settle_equipment(&mut r);
    assert_eq!(
        r.equipped,
        Equipment { weapon: Some(Good::Crossbow), ..Equipment::default() },
        "Arrows go in no slot"
    );
    assert_eq!(weapon_attack(&r), 0.0);
    assert_eq!(slot_of(Good::Arrows), None);
}

#[test]
fn the_invariant_catches_a_shield_stored_beside_a_bow() {
    let mut r = someone();
    r.carried = stock(&[(Good::Bow, 1.0), (Good::Shield, 1.0)]);
    r.equipped =
        Equipment { weapon: Some(Good::Bow), shield: Some(Good::Shield), ..Equipment::default() };
    assert!(equipment_problem(&r).is_some_and(|m| m.contains("both hands")));
}
