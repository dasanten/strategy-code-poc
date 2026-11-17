//! Wear of [`super`]: blows and training wear gear, a worn-out piece breaks and is gone, worn gear
//! fights as well as new, and the wear goes with the goods.

use csp_shared::balance::{TRAINING_WEAR_BLOWS_PER_DAY, WEAR_BLOWS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Pile, Stat};

use super::*;
use crate::combat::{apply_attack, resolve_strikes, AttackRequest, StrikeAction};
use crate::holders::{move_between, Holder};
use crate::queries::combat::{blow_damage, protection};
use crate::test_world::{empty_world, live, live_mut, realm, resident};

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

fn life(good: &str) -> f64 {
    WEAR_BLOWS.get(good).unwrap()
}

/// Realm r1's a1 at (10, 10) with a Sword, attacking realm r2's b1 next to them with a Shield and
/// Armour, who never dodges.
fn fight() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    realm(&mut world, "r2", 8, "b1");
    resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "b1", Some("r2"), 11.0, 10.0);
    live_mut(&mut world, "a1").carried = stock(&[(Good::Sword, 1.0)]);
    let b = live_mut(&mut world, "b1");
    b.carried = stock(&[(Good::Shield, 1.0), (Good::Armour, 1.0)]);
    b.stats.agility = Stat { base: 0.0, trained: 0.0 };
    b.health = 1000.0;
    crate::equipment::settle_all(&mut world);
    let request = AttackRequest { resident_id: Some("a1".into()), target_id: Some("b1".into()) };
    apply_attack(&mut world, &request, Some(256));
    world
}

fn strike(world: &mut WorldState) {
    let s = [StrikeAction { attacker_id: "a1".into(), target_id: "b1".into() }];
    let blows =
        resolve_strikes(world, &s, 256, &mut crate::defence::NoAlarms, &mut Default::default())
            .blows;
    assert_eq!(blows, 1);
}

fn worn(world: &WorldState, id: &str, good: Good) -> f64 {
    in_use(world, id, good)
}

#[test]
fn a_blow_wears_the_weapon_that_strikes_it_and_the_shield_and_armour_that_take_it() {
    let mut world = fight();
    strike(&mut world);
    strike(&mut world);
    assert!((worn(&world, "a1", Good::Sword) - 2.0 / life("sword")).abs() < 1e-12);
    assert!((worn(&world, "b1", Good::Shield) - 2.0 / life("shield")).abs() < 1e-12);
    assert!((worn(&world, "b1", Good::Armour) - 2.0 / life("armour")).abs() < 1e-12);
    assert_eq!(wear_problems(&world), vec![]);
}

#[test]
fn worn_gear_fights_as_well_as_new_and_breaks_with_its_last_blow() {
    let mut world = fight();
    let new_damage =
        blow_damage(live(&world, "a1").unwrap(), live(&world, "b1").unwrap(), world.tick as f64);
    let new_cover = protection(live(&world, "b1").unwrap());
    // Half a blow short of breaking: nearly broken, and as good as new.
    let nearly = 1.0 - 0.5 / life("sword");
    world.wear.insert("a1".into(), [(Good::Sword, vec![nearly])].into_iter().collect());
    world.wear.insert("b1".into(), [(Good::Armour, vec![0.9])].into_iter().collect());
    assert_eq!(
        gear_condition(&world, live(&world, "a1").unwrap()).weapon,
        Some(PieceCondition::NearlyBroken)
    );
    let (a, b) = (live(&world, "a1").unwrap(), live(&world, "b1").unwrap());
    assert_eq!(blow_damage(a, b, world.tick as f64), new_damage);
    assert_eq!(protection(b), new_cover);
    let health = live(&world, "b1").unwrap().health;
    strike(&mut world);
    assert!(
        // Combat learned with the blow adds a little.
        (health - live(&world, "b1").unwrap().health - new_damage).abs() < 0.5,
        "the breaking blow still lands as hard: {health} -> {}, {new_damage}",
        live(&world, "b1").unwrap().health
    );
    let a = live(&world, "a1").unwrap();
    assert_eq!(held(&a.carried, Good::Sword), 0.0, "the Sword broke and is gone");
    assert_eq!(a.equipped.weapon, None);
    assert!(!world.wear.contains_key("a1"), "nothing kept for a piece that is gone");
    assert_eq!(wear_problems(&world), vec![]);
}

#[test]
fn a_broken_piece_is_replaced_by_the_next_carried() {
    let mut world = fight();
    live_mut(&mut world, "a1").carried = stock(&[(Good::Sword, 2.0)]);
    world.wear.insert("a1".into(), [(Good::Sword, vec![0.9999999])].into_iter().collect());
    strike(&mut world);
    let a = live(&world, "a1").unwrap();
    assert_eq!(held(&a.carried, Good::Sword), 1.0);
    assert_eq!(a.equipped.weapon, Some(Good::Sword), "the second Sword, new");
    assert_eq!(worn(&world, "a1", Good::Sword), 0.0);
}

#[test]
fn a_dodged_blow_wears_only_the_weapon() {
    let mut world = fight();
    live_mut(&mut world, "b1").stats.agility = Stat { base: 1e6, trained: 0.0 };
    let mut landed = 0.0;
    for _ in 0..20 {
        let health = live(&world, "b1").unwrap().health;
        world.tick += 1;
        strike(&mut world);
        if live(&world, "b1").unwrap().health < health {
            landed += 1.0;
        }
    }
    assert!(landed < 20.0, "some blows were dodged");
    assert!((worn(&world, "a1", Good::Sword) - 20.0 / life("sword")).abs() < 1e-12);
    assert!((worn(&world, "b1", Good::Shield) - landed / life("shield")).abs() < 1e-12);
}

#[test]
fn training_wears_all_equipped_pieces_a_little() {
    let mut world = fight();
    for _ in 0..TICKS_PER_GAME_DAY as usize {
        wear_in_training(&mut world, 1);
    }
    let day = TRAINING_WEAR_BLOWS_PER_DAY;
    assert!((worn(&world, "b1", Good::Shield) - day / life("shield")).abs() < 1e-9);
    assert!((worn(&world, "b1", Good::Armour) - day / life("armour")).abs() < 1e-9);
    assert_eq!(condition_of(worn(&world, "b1", Good::Shield)), PieceCondition::Good);
}

#[test]
fn conditions_read_good_worn_and_nearly_broken() {
    assert_eq!(condition_of(0.0), PieceCondition::Good);
    assert_eq!(condition_of(WORN_FROM - 0.01), PieceCondition::Good);
    assert_eq!(condition_of(WORN_FROM), PieceCondition::Worn);
    assert_eq!(condition_of(NEARLY_BROKEN_FROM), PieceCondition::NearlyBroken);
    assert_eq!(condition_name(PieceCondition::NearlyBroken), "nearlyBroken");
}

#[test]
fn goods_moved_take_their_wear_new_pieces_first() {
    let mut world = fight();
    live_mut(&mut world, "a1").carried = stock(&[(Good::Sword, 2.0)]);
    world.wear.insert("a1".into(), [(Good::Sword, vec![0.6])].into_iter().collect());
    world.piles.push(Pile { id: "p1".into(), x: 10.0, y: 10.0, goods: Stock::new() });
    move_between(&mut world, Holder::Resident(0), Holder::Pile(0), Good::Sword, 1.0);
    assert_eq!(worn(&world, "a1", Good::Sword), 0.6, "the worn one in use stays");
    assert!(!world.wear.contains_key("p1"));
    move_between(&mut world, Holder::Resident(0), Holder::Pile(0), Good::Sword, 1.0);
    assert!(!world.wear.contains_key("a1"));
    assert_eq!(world.wear["p1"][&Good::Sword], vec![0.6]);
    move_between(&mut world, Holder::Pile(0), Holder::Resident(1), Good::Sword, 2.0);
    assert_eq!(world.wear["b1"][&Good::Sword], vec![0.6]);
    assert_eq!(wear_problems(&world), vec![]);
}

#[test]
fn a_fallen_residents_worn_gear_lies_worn_in_their_pile() {
    let mut world = fight();
    world.wear.insert("b1".into(), [(Good::Armour, vec![0.7])].into_iter().collect());
    crate::survival::die(&mut world, "b1");
    let pile = &world.piles[0];
    assert_eq!(world.wear[&pile.id][&Good::Armour], vec![0.7]);
    assert_eq!(wear_problems(&world), vec![]);
}

#[test]
fn settling_keeps_wear_within_the_units_kept_and_forgets_holders_gone() {
    let mut world = fight();
    world.wear.insert("a1".into(), [(Good::Sword, vec![0.8, 0.3])].into_iter().collect());
    world.wear.insert("gone".into(), [(Good::Sword, vec![0.5])].into_iter().collect());
    assert_eq!(wear_problems(&world).len(), 2, "two worn Swords for one, and a holder gone");
    settle_wear(&mut world);
    assert_eq!(world.wear["a1"][&Good::Sword], vec![0.8], "the most worn stays");
    assert!(!world.wear.contains_key("gone"));
    assert_eq!(wear_problems(&world), vec![]);
}

#[test]
fn the_invariant_flags_wear_out_of_range() {
    let mut world = fight();
    world.wear.insert("a1".into(), [(Good::Sword, vec![1.0])].into_iter().collect());
    assert_eq!(wear_problems(&world).len(), 1);
    world.wear.insert("a1".into(), [(Good::Food, vec![0.1])].into_iter().collect());
    assert!(!wear_problems(&world).is_empty());
}

#[test]
fn a_world_saved_before_wear_has_all_gear_in_good_condition() {
    // `empty_world` is parsed from JSON without `wear`, as a save from before format 136.
    let world = fight();
    assert!(world.wear.is_empty());
    let json = serde_json::to_value(&world).unwrap();
    assert!(json.get("wear").is_none(), "left out while all gear is new");
    let a = live(&world, "a1").unwrap();
    assert_eq!(gear_condition(&world, a).weapon, Some(PieceCondition::Good));
}
