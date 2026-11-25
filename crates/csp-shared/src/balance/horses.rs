//! Horses and stables (and how long a defence script waits for calm).

use serde::Serialize;

use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HorseStatValues {
    pub speed: f64,
    pub strength: f64,
    pub endurance: f64,
}

balance! {
/// Food a horse eats per game day, in units (`CONTEXT.md`: Horse). More than a resident; its
/// hunger meter otherwise runs like a resident's (`HUNGER_DAYS`, `STARVE_DAYS`, `HEAL_DAYS`).
pub const HORSE_FOOD_PER_DAY: f64 = 0.75;

/// Horses the one-time Horse grant gives each realm without any (`CONTEXT.md`: Horse grant).
pub const HORSE_GRANT_HORSES: f64 = 2.0;

/// Food laid on the ground by each granted horse that has no stable to stand in (`CONTEXT.md`:
/// Horse grant), in units: five game days of an average horse's meals, time to fetch it more.
pub const HORSE_GRANT_FOOD: f64 = ceil(5.0 * HORSE_FOOD_PER_DAY);

/// How far from its tile a horse reaches Food lying on the ground, in tiles either way
/// (`CONTEXT.md`: Horses have no inventory, "on its tile or right next to it"): its own tile and
/// the eight around it.
pub const HORSE_REACH: f64 = 1.0;

/// Share of a full hunger meter below which the tile card calls a horse hungry rather than fed;
/// at 0 it is starving.
pub const HORSE_HUNGRY_SHARE: f64 = 0.25;

/// Health a Down horse wakes with once it has eaten (`CONTEXT.md`: Reviving): low, out of
/// `MAX_HEALTH`, so a fed horse takes most of `HEAL_DAYS` to be well again.
pub const HORSE_WAKE_HEALTH: f64 = 20.0;

/// Game days of Food for the horses standing in it that the Feed the stable task keeps in a stable
/// (`CONTEXT.md`: Feeding the stable): `HORSE_FOOD_PER_DAY` for each, this many days. Below it the
/// resident fetches more. Written into the default's source, where a Player can change it.
pub const STABLE_FEED_DAYS: f64 = 10.0;

/// Game days of Food for a starting city's horses (`START_HORSES`, `HORSE_FOOD_PER_DAY` each)
/// below which the stable hand's "Farm and feed" queue feeds the stable once (`CONTEXT.md`:
/// Starting city): a few days, so a round fills it from well before it runs out.
pub const STABLE_HAND_FEED_DAYS: f64 = 3.0;

/// Game minutes the stable hand works the farm between two looks at the stable (`CONTEXT.md`:
/// Starting city): a game hour.
pub const STABLE_HAND_WORK_MINUTES: f64 = 60.0;

/// Game days of Food for its horses below which an NPC city sends one of its residents to fill its
/// stable up to `STABLE_FEED_DAYS` (`CONTEXT.md`: NPC horses). Half of it, so they go in one trip
/// every few days and work for the city in between, rather than walk for every unit eaten.
pub const NPC_STABLE_REFILL_DAYS: f64 = 5.0;

/// Game days of Food for each hungry horse an NPC city takes from below its Food reserve
/// (`CONTEXT.md`: NPC horses): enough to get them past hungry, so its people still come first.
pub const NPC_STABLE_HUNGRY_DAYS: f64 = 2.0;

/// Horses a new NPC village or town starts with (`CONTEXT.md`: NPC horses): a pair to breed.
pub const NPC_START_HORSES: f64 = 2.0;

/// Game days of Food laid on the ground by an NPC city's first horses (`CONTEXT.md`: NPC horses),
/// for each of them: long enough for a new village to find the Wood and put up its stable, whose
/// feeder takes over from there.
pub const NPC_START_HORSE_FOOD_DAYS: f64 = 40.0;

/// The horses an NPC city wants however small it is (`CONTEXT.md`: NPC horses): a pair, so even a
/// new daughter has one to breed once a Player sells it some.
pub const NPC_HORSES_BASE: f64 = 2.0;

/// Residents of an NPC city for each horse it wants beyond `NPC_HORSES_BASE`, up to what a stable
/// holds (`STABLE_CAPACITY`): a village of 6 wants 4, a town of 16 wants the full 6.
pub const NPC_RESIDENTS_PER_HORSE: f64 = 3.0;

/// The horses an NPC city keeps to breed from and won't sell (`CONTEXT.md`: Horse market): a
/// breeding pair.
pub const NPC_HORSES_KEPT: f64 = 2.0;

/// What an NPC city asks for an average new horse with as many as it wants, in Coins (`CONTEXT.md`:
/// Horse market): about what a stolen one is worth (`HORSE_STOLEN_WORTH`).
pub const HORSE_PRICE_BASE: f64 = 100.0;

/// How much more a horse costs for each point its mean stat is above average (less below), as a
/// share: the full range of new horses goes from half the price to half as much again, so breeding
/// good ones pays.
pub const HORSE_PRICE_PER_STAT: f64 = 0.1;

/// The least a horse's stats leave of its price, for a foal bred far below the range.
pub const HORSE_PRICE_STATS_FLOOR: f64 = 0.25;

/// How much less a horse costs for each game year of its age, as a share.
pub const HORSE_PRICE_AGE_PER_YEAR: f64 = 0.03;

/// The least a horse's age leaves of its price.
pub const HORSE_PRICE_AGE_FLOOR: f64 = 0.5;

/// How much more an NPC city asks for the last horse it would sell, beyond the pair it keeps, as a
/// share: twice the price of one it has as many as it wants of.
pub const HORSE_PRICE_SCARCITY: f64 = 1.0;

/// How much less an NPC city asks at most with more horses than it wants, as a share.
pub const HORSE_PRICE_GLUT: f64 = 0.25;

/// What an NPC city pays for a horse, as a share of what it would ask for it with that horse among
/// its own (`CONTEXT.md`: Horse market): as much as it pays for goods against what it sells them for
/// (`BUY_SHARE`).
pub const HORSE_PRICE_PAID_SHARE: f64 = 0.6;

/// Ticks without a blow after which the Defend default ends for a resident fleeing home
/// (`CONTEXT.md`: Defence script): half a minute, so a lone blow from someone who walks off
/// doesn't send them all the way home. Written into the default's source, where a Player can
/// change it.
pub const DEFEND_CALM_TICKS: f64 = 30.0;

/// Most horses a stable has room for; no foal is bred there once that many stand in it.
pub const STABLE_CAPACITY: f64 = 6.0;

/// Game days a resident tends two fed horses at a stable before a foal is born (`CONTEXT.md`:
/// Breeding). Breeding that pauses before then carries on where it stopped.
pub const STABLE_BREED_DAYS: f64 = 10.0;

/// How far each of a foal's stats may land from its parents' average, either way (`CONTEXT.md`:
/// Breeding), as `CHILD_STAT_SPREAD` does for a resident's children.
pub const FOAL_STAT_SPREAD: f64 = 1.0;

/// A new horse's stats are whole numbers drawn from this range (`CONTEXT.md`: Horse stats), like a
/// resident's base stats.
pub const HORSE_STAT_MIN: f64 = 5.0;

pub const HORSE_STAT_MAX: f64 = 15.0;

/// The stat at which a horse is average: it pulls, holds and eats as the plain numbers say.
pub const HORSE_STAT_AVERAGE: f64 = 10.0;

/// An average horse's stats: the middle of the range, what horses from before stats got.
pub const AVERAGE_HORSE_STATS: HorseStatValues = HorseStatValues {
    speed: HORSE_STAT_AVERAGE,
    strength: HORSE_STAT_AVERAGE,
    endurance: HORSE_STAT_AVERAGE,
};

/// A new horse is this many game years old, drawn in the range; foals start at 0.
pub const HORSE_START_AGE_MIN: f64 = 3.0;

pub const HORSE_START_AGE_MAX: f64 = 8.0;

/// The most a base stat picked for a Resident or horse added in creative mode can be (`CONTEXT.md`:
/// Creative mode): well past any drawn one, to test the extremes.
pub const CREATIVE_STAT_MAX: f64 = 30.0;

/// The oldest a horse added in creative mode can be, in game years.
pub const CREATIVE_HORSE_AGE_MAX: f64 = 30.0;

/// How much faster a horse pulls its carriage for each point of Speed above average (slower below).
pub const HORSE_SPEED_EFFECT: f64 = 0.04;

/// The furthest Speed moves a horse's pace, either way, as a share of it.
pub const HORSE_SPEED_LIMIT: f64 = 0.5;

/// How much more a carriage holds for each point of its horse's Strength above average (less below).
pub const HORSE_STRENGTH_EFFECT: f64 = 0.04;

/// The furthest Strength moves what a carriage holds, either way, as a share of `CARRIAGE_CAPACITY`.
pub const HORSE_STRENGTH_LIMIT: f64 = 0.5;

/// How much less Food a horse needs for each point of Endurance above average (more below).
pub const HORSE_ENDURANCE_EFFECT: f64 = 0.03;

/// The furthest Endurance moves the Food a horse needs, either way.
pub const HORSE_ENDURANCE_LIMIT: f64 = 0.3;
}
