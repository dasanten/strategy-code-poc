//! Goods: weights, weapons, armour, wear, and what a resident carries.

use super::*;

balance! {
/// What one unit of each good weighs, in kg (`CONTEXT.md`: Good). Coins are light but not
/// weightless, so a fortune still has to be carried. Weapons and armour weigh what went into them
/// (`RECIPES`): an average resident (30 kg) in armour with a sword and a shield has half
/// their room left for food.
pub const GOOD_WEIGHT: Table<f64> = Table(&[
    ("food", 1.0),
    ("wood", 1.0),
    ("stone", 1.0),
    ("ironOre", 1.0),
    ("iron", 1.0),
    ("goldOre", 1.0),
    ("coins", 0.02),
    ("spear", 3.0),
    ("sword", 3.0),
    ("shield", 4.0),
    ("armour", 8.0),
    ("coal", 1.0),
    ("steel", 1.0),
    ("steelSword", 3.0),
    ("steelShield", 4.0),
    ("steelArmour", 8.0),
    ("tools", 2.0),
    ("bow", 2.0),
    ("crossbow", 4.0),
    ("arrows", 0.1),
]);

/// Attack each weapon adds to a resident's blow (`CONTEXT.md`: Weapons and armour, Combat). A
/// sword hits harder than a spear, a steel sword half again as hard as an iron one (`CONTEXT.md`:
/// Coal); combat (T10.2) adds it to Strength and Combat skill. A Bow or Crossbow adds nothing to
/// a blow: it is a weapon for shooting (`CONTEXT.md`: Ranged combat), and in a blow its archer
/// fights with their fists.
pub const WEAPON_ATTACK: Table<f64> =
    Table(&[("spear", 4.0), ("sword", 6.0), ("steelSword", 9.0), ("bow", 0.0), ("crossbow", 0.0)]);

/// How far a Bow or Crossbow shoots, in tiles (`CONTEXT.md`: Ranged combat), on the ground: a
/// Bow further than a Crossbow. Contact counts too.
pub const SHOT_REACH: Table<f64> = Table(&[("bow", 8.0), ("crossbow", 5.0)]);

/// Ticks between two shots (`CONTEXT.md`: Ranged combat): a Bow looses one every three seconds, a
/// Crossbow, slow to span, one every six. A blow in contact comes every `STRIKE_TICKS`.
pub const SHOT_TICKS: Table<f64> = Table(&[("bow", 3.0), ("crossbow", 6.0)]);

/// Damage a shot does before Combat skill and armour (`CONTEXT.md`: Ranged combat): Strength adds
/// nothing. An unskilled Bow does about what an average fist does, a Crossbow hits hard.
pub const SHOT_DAMAGE: Table<f64> = Table(&[("bow", 6.0), ("crossbow", 14.0)]);

/// The furthest Combat skill raises a shot, as a share of it, reached at the same skill as a blow's
/// `COMBAT_SKILL_LIMIT`: a master bowman shoots three times as hard as a beginner, a Crossbow
/// needs little skill.
pub const SHOT_SKILL_LIMIT: Table<f64> = Table(&[("bow", 2.0), ("crossbow", 0.25)]);

/// Share of the target's shield and armour a shot goes through (`CONTEXT.md`: Ranged combat): a
/// Crossbow's bolt half of it, an arrow from a Bow none.
pub const SHOT_PIERCE: Table<f64> = Table(&[("bow", 0.0), ("crossbow", 0.5)]);

/// Tiles of reach an archer up on a wall walk gets on top of their weapon's (`CONTEXT.md`: Ranged
/// combat, Walls in combat): half a Bow's again, so a Bow on the wall outshoots one on the ground
/// by four tiles and a Crossbow on the wall outshoots a Bow below.
pub const WALL_SHOT_REACH_BONUS: f64 = 4.0;

/// Damage each piece of protection takes off a blow (`CONTEXT.md`: Weapons and armour, Combat).
/// Armour takes off more than a shield but weighs twice as much; steel takes off more than iron
/// at the same weight. Only the best shield and the best armour carried count (`PROTECTION_KINDS`).
pub const PROTECTION_DEFENCE: Table<f64> =
    Table(&[("shield", 3.0), ("armour", 5.0), ("steelShield", 5.0), ("steelArmour", 8.0)]);

/// How many blows each piece of gear lasts before it breaks (`CONTEXT.md`: Wear): a weapon's
/// blows struck, a shield's or armour's blows taken. A fight to the death is some 15 to 30 blows,
/// so an iron sword sees about twenty fights; steel lasts half again as long as iron.
pub const WEAR_BLOWS: Table<f64> = Table(&[
    ("spear", 400.0),
    ("sword", 600.0),
    ("steelSword", 900.0),
    ("shield", 300.0),
    ("steelShield", 450.0),
    ("armour", 400.0),
    ("steelArmour", 600.0),
]);

/// How many blows' wear a game day of training puts on each piece a trainee has equipped
/// (`CONTEXT.md`: Wear): a little, so a soldier training every day wears out an iron sword in
/// well over a game year.
pub const TRAINING_WEAR_BLOWS_PER_DAY: f64 = 1.0;

/// Share of its life worn away from which a piece's condition reads "worn" (`CONTEXT.md`: Wear).
pub const WORN_FROM: f64 = 0.5;

/// Share of its life worn away from which a piece's condition reads "nearly broken".
pub const NEARLY_BROKEN_FROM: f64 = 0.85;

/// Share of a piece's smithy recipe that mending it takes (`CONTEXT.md`: Mending): each input's
/// units times this, rounded, and at least one unit of its biggest input. A worn Sword takes 1
/// Iron, worn Armour 2 Iron, a worn Spear or Shield 1 Wood.
pub const MEND_RECIPE_SHARE: f64 = 0.3;

/// Share of a batch's work that mending a piece takes (`CONTEXT.md`: Mending): a smithy worker
/// mends twice as many pieces a day as they forge.
pub const MEND_WORK_SHARE: f64 = 0.5;

/// What a worn piece sells and buys for, as a share of a new one's price (`CONTEXT.md`: Wear).
pub const WORN_PRICE_SHARE: f64 = 0.6;

/// What a nearly broken piece sells and buys for, as a share of a new one's price.
pub const NEARLY_BROKEN_PRICE_SHARE: f64 = 0.25;

/// Carry capacity of a resident with no Strength at all, in kg.
pub const CARRY_BASE: f64 = 10.0;

/// Carry capacity each point of effective Strength adds, in kg.
pub const CARRY_PER_STRENGTH: f64 = 2.0;
}
