//! Goods (`CONTEXT.md`: Good, Weapons and armour): the list of them and the one helper of
//! `packages/shared/src/goods.ts` that needs no world state. The world queries there (`pileAt`,
//! `storageAt`, `goodsAtSpot`, `unitsThatFit`, …) take the world types and come with them, in
//! `csp-sim`. What a unit weighs is `GOOD_WEIGHT` in [`crate::balance`].

/// PoC goods (`CONTEXT.md`: Good, Weapons and armour). Amounts are counted in units;
/// `GOOD_WEIGHT` weighs them.
pub const GOODS: [&str; 17] = [
    "food",
    "wood",
    "stone",
    "ironOre",
    "iron",
    "goldOre",
    "coins",
    "spear",
    "sword",
    "shield",
    "armour",
    "coal",
    "steel",
    "steelSword",
    "steelShield",
    "steelArmour",
    "tools",
];

/// Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour).
pub const WEAPONS: [&str; 3] = ["spear", "sword", "steelSword"];

/// Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour, of iron
/// or of steel.
pub const PROTECTION: [&str; 4] = ["shield", "armour", "steelShield", "steelArmour"];

/// The kinds of protection (`CONTEXT.md`: Weapons and armour): a shield and armour, each of iron
/// or of steel. A resident is protected by the best of each kind they carry, so a second shield
/// adds nothing.
pub const PROTECTION_KINDS: [&[&str]; 2] = [&["shield", "steelShield"], &["armour", "steelArmour"]];

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
