//! Goods (`CONTEXT.md`: Good, Weapons and armour): the list of them and the one helper that needs
//! no world state. The world queries (`pileAt`, `storageAt`, `goodsAtSpot`, `unitsThatFit`, …) take
//! the world types and come with them, in `csp-sim`. What a unit weighs is `GOOD_WEIGHT` in
//! [`crate::balance`].

use crate::building_spec::kinds_where;
use crate::good_spec::ProtectionKind;
use crate::views::Weapon;
use crate::world::{Good, PricedGood};

/// Every good.
pub const ALL_GOODS: [Good; Good::ALL.len()] = array(Good::ALL);

const PRICED: &[Good] = kinds_where!(Good, |g| g.spec().base_price.is_some());
const ARMING: &[Good] = kinds_where!(Good, |g| g.spec().weapon().is_some());
const BOTH_HANDS: &[Good] =
    kinds_where!(Good, |g| matches!(g.spec().weapon(), Some(w) if w.two_handed));
const PROTECTING: &[Good] = kinds_where!(Good, |g| g.spec().protection().is_some());
const SHIELDS: &[Good] = kinds_where!(Good, |g| protects_as(g, ProtectionKind::Shield));
const ARMOUR: &[Good] = kinds_where!(Good, |g| protects_as(g, ProtectionKind::Armour));

/// Goods with a price, every one but Coins: what a warehouse puts a price on (`PRICED_GOODS`).
pub const PRICED_GOODS: [Good; PRICED.len()] = array(PRICED);

/// The goods' names (`CONTEXT.md`: Good, Weapons and armour). Amounts are counted in units;
/// `GOOD_WEIGHT` weighs them.
pub const GOODS: [&str; Good::ALL.len()] = names(Good::ALL);

/// Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour).
pub const WEAPONS: [&str; ARMING.len()] = names(ARMING);

/// Weapons that take both hands (`CONTEXT.md`: Equipment): with one equipped the shield slot stays
/// empty.
pub const TWO_HANDED: [&str; BOTH_HANDS.len()] = names(BOTH_HANDS);

/// Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour, of iron
/// or of steel.
pub const PROTECTION: [&str; PROTECTING.len()] = names(PROTECTING);

/// The kinds of protection (`CONTEXT.md`: Weapons and armour): a shield and armour, each of iron
/// or of steel. A resident is protected by the best of each kind they carry, so a second shield
/// adds nothing.
pub const PROTECTION_KINDS: [&[&str]; 2] =
    [&names::<{ SHIELDS.len() }>(SHIELDS), &names::<{ ARMOUR.len() }>(ARMOUR)];

// The enums of some of the goods are those goods, in their order.
const _: () = {
    assert!(PricedGood::ALL.len() == PRICED.len(), "PricedGood is not the goods with a price");
    let mut i = 0;
    while i < PRICED.len() {
        assert!(same(PricedGood::ALL[i].name(), PRICED[i].name()), "PricedGood differs");
        i += 1;
    }
    assert!(Weapon::ALL.len() == ARMING.len(), "Weapon is not the goods that are weapons");
    let mut i = 0;
    while i < ARMING.len() {
        assert!(same(Weapon::ALL[i].name(), ARMING[i].name()), "Weapon differs");
        i += 1;
    }
};

const fn protects_as(good: Good, kind: ProtectionKind) -> bool {
    match good.spec().protection() {
        Some(p) => p.kind as u8 == kind as u8,
        None => false,
    }
}

const fn array<const N: usize>(goods: &[Good]) -> [Good; N] {
    let mut out = [goods[0]; N];
    out.copy_from_slice(goods);
    out
}

const fn names<const N: usize>(goods: &[Good]) -> [&'static str; N] {
    let mut out = [""; N];
    let mut i = 0;
    while i < N {
        out[i] = goods[i].name();
        i += 1;
    }
    out
}

const fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut i = 0;
    while i < a.len() && i < b.len() && a[i] == b[i] {
        i += 1;
    }
    i == a.len() && i == b.len()
}

/// How many of a carried good a resident puts away (stores, drops, loads, delivers) unless asked
/// for an exact amount: all of it, but Food only beyond their own food (`CONTEXT.md`: Own food),
/// `own_food` units: `OWN_FOOD` unless a store order asks to keep another amount.
pub fn put_away_units(good: &str, carried: f64, own_food: f64) -> f64 {
    if good == "food" {
        (carried - own_food).max(0.0)
    } else {
        carried
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance::{GOOD_WEIGHT, OWN_FOOD};

    #[test]
    fn puts_away_all_but_their_own_food() {
        assert_eq!(put_away_units("food", OWN_FOOD + 7.0, OWN_FOOD), 7.0);
    }

    #[test]
    fn puts_away_no_food_when_they_carry_only_their_own_food_or_less() {
        assert_eq!(put_away_units("food", OWN_FOOD, OWN_FOOD), 0.0);
        assert_eq!(put_away_units("food", 1.0, OWN_FOOD), 0.0);
    }

    #[test]
    fn puts_away_all_of_other_goods() {
        assert_eq!(put_away_units("wood", 12.0, OWN_FOOD), 12.0);
        assert_eq!(put_away_units("coins", 3.0, OWN_FOOD), 3.0);
    }

    #[test]
    fn weighs_every_good() {
        for good in GOODS {
            assert!(GOOD_WEIGHT.get(good).is_some(), "{good} has no weight");
        }
        assert_eq!(GOOD_WEIGHT.0.len(), GOODS.len());
        for good in WEAPONS.iter().chain(&PROTECTION) {
            assert!(GOODS.contains(good));
        }
        let kinds: Vec<&str> = PROTECTION_KINDS.iter().flat_map(|k| k.iter().copied()).collect();
        assert_eq!(kinds.len(), PROTECTION.len());
        assert!(PROTECTION.iter().all(|p| kinds.contains(p)));
    }
}
