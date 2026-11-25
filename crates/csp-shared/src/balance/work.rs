//! Workplaces: workers, recipes, gathering, work skill and Tools.

use serde::Serialize;

use super::*;
use crate::building_spec::{opt, spec_table};

/// What a workplace that processes goods turns into what, one batch at a time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Recipe {
    /// Goods one batch uses up.
    pub input: Table<f64>,
    /// Goods one batch makes.
    pub output: Table<f64>,
}

balance! {
/// Most residents who can work each kind of workplace at a time (`CONTEXT.md`: Workplace). A farm
/// has room for a whole starting city; the workplaces on nodes for a smaller crew; smelters,
/// mints and smithies for a few.
pub const WORKPLACE_MAX_WORKERS: Table<f64> =
    spec_table!(f64, |s| opt!(s.workplace, w => Some(w.max_workers)));

/// What each kind of workplace counts for against a debt when the Trade Organization's army tears it
/// down (`CONTEXT.md`: Trade Org debt), in Coins: about twice its materials at their warehouse base
/// price and 20 Coins for each game day of a builder's work (as `CARRIAGE_STOLEN_WORTH` weighs a
/// carriage), and never less than 200, as a farm or lumber camp is cheap to build but worth more than
/// that to a city. So a debt for a killing (`TRADE_ORG_LOSS`, twice) takes about two to four workplaces.
pub const WORKPLACE_WRECK_WORTH: Table<f64> =
    spec_table!(f64, |s| opt!(s.workplace, w => Some(w.wreck_worth)));

/// The skill each kind of workplace uses and teaches (`CONTEXT.md`: Skill): Farming on a farm,
/// Woodcutting in a lumber camp, Mining in quarries and mines, Smelting in smelters and mints,
/// Smithing in a smithy.
pub const WORKPLACE_SKILL: Table<&str> =
    spec_table!(&'static str, |s| opt!(s.workplace, w => Some(w.skill.name())));

/// The fixed recipes of the workplaces that process goods (`CONTEXT.md`: Smelter, Coins, Smithy).
/// A smelter turns 2 iron ore into 1 iron, or 1 iron and 1 coal into 1 steel (`CONTEXT.md`: Coal);
/// its first recipe, Iron, is what its workers make when they name none. A mint 1 gold ore into 10 coins (less weight than the
/// ore, but a fortune still weighs something). A smithy has one recipe for each weapon and piece
/// of armour, each from Iron and Wood weighing what the good weighs (`GOOD_WEIGHT`): a spear is
/// mostly wood, a sword mostly iron, a shield wood bound with iron, armour nearly all iron. The
/// steel Sword, Shield and Armour (`CONTEXT.md`: Coal) take Steel where the iron ones take Iron,
/// and the same Wood; the Spear is iron only. A Bow is all wood, a Crossbow wood with an iron
/// bow and trigger, and a batch of 40 Arrows mostly wood with a little iron for the heads
/// (`CONTEXT.md`: Smithy).
pub const RECIPES: Table<&[Recipe]> = spec_table!(
    &'static [Recipe],
    |s| opt!(s.workplace, w => opt!(w.processing, p => Some(p.recipes)))
);

/// Batches one worker of average Strength and no skill gets through per game day: a smelter worker
/// smelts what two miners dig (4 iron ore into 2 iron), or 2 iron and 2 coal into 2 steel, a mint worker strikes what two gold miners
/// dig (2 gold ore into 20 coins), a smithy worker makes two weapons or pieces of armour.
pub const BATCHES_PER_DAY: Table<f64> =
    spec_table!(f64, |s| opt!(s.workplace, w => opt!(w.processing, p => Some(p.batches_per_day))));

/// Units of each good one worker of average Strength and no skill makes per game day. Food is four
/// times the `FOOD_PER_DAY` a resident eats, so about a quarter of a city farms; ore is slow, and
/// gold ore slowest; coal as fast as iron ore.
pub const WORK_OUTPUT_PER_DAY: Table<f64> = Table(&[
    ("food", 2.0),
    ("wood", 4.0),
    ("stone", 3.0),
    ("ironOre", 2.0),
    ("goldOre", 1.0),
    ("coal", 2.0),
]);

/// Units of each good a resident of average Strength and no skill gathers by hand per game day
/// (`CONTEXT.md`: Gathering): four fifths of `WORK_OUTPUT_PER_DAY`, so between working a poor node
/// (`RICHNESS_FACTOR.poor`, three fifths) and a normal one. Strength, skill and Tools count as at a
/// workplace. Only these goods are gathered.
pub const GATHER_PER_DAY: Table<f64> = Table(&[("wood", 3.2), ("stone", 2.4), ("food", 1.6)]);

/// Units a full patch holds (`CONTEXT.md`: Patch): about one load of an average resident
/// (`CARRY_BASE` + 10 Strength × `CARRY_PER_STRENGTH` = 30 kg of 1 kg goods).
pub const PATCH_SIZE: f64 = 30.0;

/// Game days a picked-over patch takes to grow back to full, steadily (`CONTEXT.md`: Patch): long
/// enough that the land beside a city empties under a few gatherers, so a camp on a node stays
/// worth building.
pub const PATCH_REGROW_DAYS: f64 = 10.0;

/// Game days nobody must gather on a tile before its patch starts growing back (`CONTEXT.md`:
/// Patch): a tile being gathered doesn't grow while it is worked (a gatherer takes a unit every
/// few hundred ticks), so it runs out under one gatherer rather than growing about as fast as
/// they take from it.
pub const PATCH_REST_DAYS: f64 = 1.0;

/// Tiles from where a resident on the Gather task started that they look for a tile to gather on
/// (`CONTEXT.md`: Gather): about a city's surroundings and a short walk beyond, so a gatherer
/// beside a forest works it for many loads and ends once the land around has emptied, rather than
/// wandering off.
pub const GATHER_REACH: f64 = 24.0;

/// The Strength at which a worker makes `WORK_OUTPUT_PER_DAY`.
pub const WORK_STRENGTH_AVERAGE: f64 = 10.0;

/// How much more each point of the workplace's skill makes: 1 % a point.
pub const WORK_SKILL_EFFECT: f64 = 0.01;

/// The furthest a workplace's skill raises output, as a share of it: +100 %, so a worker makes at
/// most twice what an unskilled one does, reached at `WORK_SKILL_MAX` points.
pub const WORK_SKILL_LIMIT: f64 = 1.0;

/// The most of a workplace's skill a resident can have: where it reaches `WORK_SKILL_LIMIT`.
pub const WORK_SKILL_MAX: f64 = WORK_SKILL_LIMIT / WORK_SKILL_EFFECT;

/// How much faster a resident carrying Tools works (`CONTEXT.md`: Tools), as a share of their
/// plain pace: a quarter, at a workplace (what they make) and at a construction site (building,
/// tearing down, repairing). One set counts; a second adds nothing.
pub const TOOLS_WORK_BONUS: f64 = 0.25;

/// Game days of work a set of Tools lasts before it breaks (`CONTEXT.md`: Tools, Wear): some two
/// months of daily work, so a set made from an Iron and a Wood (`RECIPES`) pays for itself many
/// times over before a worker needs the next.
pub const TOOLS_WORK_DAYS: f64 = 60.0;

/// Skill a worker of average Intellect gains per game day of work at a workplace: the cap takes
/// about a game year (one real week).
pub const WORK_SKILL_PER_DAY: f64 = 100.0 / 420.0;
}
