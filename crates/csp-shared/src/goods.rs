//! Goods (`CONTEXT.md`: Good, Weapons and armour): the list of them and the one helper of
//! `packages/shared/src/goods.ts` that needs no world state. The world queries there (`pileAt`,
//! `storageAt`, `goodsAtSpot`, `unitsThatFit`, …) take the world types and come with them, in
//! `csp-sim`. What a unit weighs is `GOOD_WEIGHT` in [`crate::balance`].

/// PoC goods (`CONTEXT.md`: Good, Weapons and armour). Amounts are counted in units;
/// `GOOD_WEIGHT` weighs them.
pub const GOODS: [&str; 11] = [
    "food", "wood", "stone", "ironOre", "iron", "goldOre", "coins", "spear", "sword", "shield",
    "armour",
];

/// Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour).
pub const WEAPONS: [&str; 2] = ["spear", "sword"];

/// Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour.
pub const PROTECTION: [&str; 2] = ["shield", "armour"];

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
    }
}
