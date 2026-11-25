//! Goods: weights, weapons, armour, wear, and what a resident carries.

use super::*;
use crate::building_spec::{opt, spec_table};

balance! {
/// What one unit of each good weighs, in kg (`CONTEXT.md`: Good). Coins are light but not
/// weightless, so a fortune still has to be carried. Weapons and armour weigh what went into them
/// (`RECIPES`): an average resident (30 kg) in armour with a sword and a shield has half
/// their room left for food.
pub const GOOD_WEIGHT: Table<f64> = spec_table!(Good: f64, |s| Some(s.weight));

/// Attack each weapon adds to a resident's blow (`CONTEXT.md`: Weapons and armour, Combat). A
/// sword hits harder than a spear, a steel sword half again as hard as an iron one (`CONTEXT.md`:
/// Coal); combat (T10.2) adds it to Strength and Combat skill. A Bow or Crossbow adds nothing to
/// a blow: it is a weapon for shooting (`CONTEXT.md`: Ranged combat), and in a blow its archer
/// fights with their fists.
pub const WEAPON_ATTACK: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => Some(w.attack)));

/// How far a Bow or Crossbow shoots, in tiles (`CONTEXT.md`: Ranged combat), on the ground: a
/// Bow further than a Crossbow. Contact counts too.
pub const SHOT_REACH: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => opt!(w.shot, x => Some(x.reach))));

/// Ticks between two shots (`CONTEXT.md`: Ranged combat): a Bow looses one every three seconds, a
/// Crossbow, slow to span, one every six. A blow in contact comes every `STRIKE_TICKS`.
pub const SHOT_TICKS: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => opt!(w.shot, x => Some(x.ticks))));

/// Damage a shot does before Combat skill and armour (`CONTEXT.md`: Ranged combat): Strength adds
/// nothing. An unskilled Bow does about what an average fist does, a Crossbow hits hard.
pub const SHOT_DAMAGE: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => opt!(w.shot, x => Some(x.damage))));

/// The furthest Combat skill raises a shot, as a share of it, reached at the same skill as a blow's
/// `COMBAT_SKILL_LIMIT`: a master bowman shoots three times as hard as a beginner, a Crossbow
/// needs little skill.
pub const SHOT_SKILL_LIMIT: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => opt!(w.shot, x => Some(x.skill_limit))));

/// Share of the target's shield and armour a shot goes through (`CONTEXT.md`: Ranged combat): a
/// Crossbow's bolt half of it, an arrow from a Bow none.
pub const SHOT_PIERCE: Table<f64> = spec_table!(Good: f64, |s| opt!(s.weapon(), w => opt!(w.shot, x => Some(x.pierce))));

/// Tiles of reach an archer up on a wall walk gets on top of their weapon's (`CONTEXT.md`: Ranged
/// combat, Walls in combat): half a Bow's again, so a Bow on the wall outshoots one on the ground
/// by four tiles and a Crossbow on the wall outshoots a Bow below.
pub const WALL_SHOT_REACH_BONUS: f64 = 4.0;

/// Damage each piece of protection takes off a blow (`CONTEXT.md`: Weapons and armour, Combat).
/// Armour takes off more than a shield but weighs twice as much; steel takes off more than iron
/// at the same weight. Only the best shield and the best armour carried count (`PROTECTION_KINDS`).
pub const PROTECTION_DEFENCE: Table<f64> = spec_table!(Good: f64, |s| opt!(s.protection(), p => Some(p.defence)));

/// How many blows each piece of gear lasts before it breaks (`CONTEXT.md`: Wear): a weapon's
/// blows struck, a shield's or armour's blows taken. A fight to the death is some 15 to 30 blows,
/// so an iron sword sees about twenty fights; steel lasts half again as long as iron.
pub const WEAR_BLOWS: Table<f64> = spec_table!(Good: f64, |s| s.wear_blows);

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
