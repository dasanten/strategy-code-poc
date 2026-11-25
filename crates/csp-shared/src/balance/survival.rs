//! Food and hunger, health, birth and drifters.

use super::*;
use crate::terrain::Terrain;

use crate::time::TICKS_PER_GAME_DAY;

balance! {
/// Food a resident of average Endurance eats per game day, in units (`CONTEXT.md`: Hunger).
pub const FOOD_PER_DAY: f64 = 0.5;

/// A resident at home is running low on food when they carry fewer units than this: less than one
/// meal, two game days' eating (`CONTEXT.md`: Eating). They then take meals from their city's storage.
pub const HOME_FOOD_LOW: f64 = 1.0;

/// How many tiles from an outpost storage's footprint, along each direction, a resident of its
/// realm still takes a meal from it when running low (`CONTEXT.md`: Refilling at an outpost
/// storage): enough for the workers of a mine or farm built right beside it.
pub const OUTPOST_REFILL_REACH: f64 = 3.0;

/// A resident's own food (`CONTEXT.md`: Own food), in units: four game days of meals. Putting goods
/// away leaves it in their hands unless the Player asks for an exact amount (`putAwayUnits`); NPC
/// residents always keep it, so nobody walks to the storage for the food they carry anyway.
pub const OWN_FOOD: f64 = 4.0 * FOOD_PER_DAY;

/// The default of `foodAt` in the Work, Build and Tear down defaults (`CONTEXT.md`: Getting food),
/// in whole units: about a day of Food, rounded up. No more than `HOME_FOOD_LOW`, so a resident at
/// home refills before they would walk for Food.
pub const GET_FOOD_AT: f64 = ceil(FOOD_PER_DAY);

/// The default of `foodTake` in those defaults, in whole units: six game days of Food.
pub const GET_FOOD_TAKE: f64 = ceil(6.0 * FOOD_PER_DAY);

/// The default of `crewFood` in the Work default (`CONTEXT.md`: Crew food), in whole units: the
/// Food the workplace's pile keeps for its crew, which the carrier tops up on the way back from
/// storing a load. About six days for a crew of six, ten for one of four, and well inside a load.
/// 0 brings none.
pub const CREW_FOOD: f64 = 20.0;

/// Game days of work a resident an NPC city sends to a workplace sets out with Food for, on top
/// of the walk there and back (`setOutFood`; `CONTEXT.md`: Crew food, NPC city): enough to last
/// until the carrier's first round trip brings the crew's Food.
pub const SET_OUT_WORK_DAYS: f64 = 3.0;

/// Food a resident running the Breed horses default takes from the stable before they start, if
/// they carry less (`CONTEXT.md`: Breeding): their meals for the `STABLE_BREED_DAYS` of tending,
/// away from home.
pub const BREED_FOOD: f64 = STABLE_BREED_DAYS * FOOD_PER_DAY;

/// Units of food in one meal, what a resident at home takes from storage at a time: two game days'
/// eating.
pub const MEAL_UNITS: f64 = 1.0;

/// Game days a full hunger meter lasts without eating, at average Endurance. A unit of food fills
/// two thirds of it, so a fed resident's meter never drops below a third. With `STARVE_DAYS`, a
/// resident goes Down about 5 game days (2 real hours) after their last meal.
pub const HUNGER_DAYS: f64 = 3.0;

/// How far one unit of food fills a horse's hunger meter: a full meter holds `HUNGER_DAYS` of food.
pub const HORSE_FILL_PER_FOOD: f64 = MAX_HUNGER / (HUNGER_DAYS * HORSE_FOOD_PER_DAY);

/// Game days an empty hunger meter takes to cost a resident all their health and put them Down.
pub const STARVE_DAYS: f64 = 2.0;

/// Game days a resident lies Down before they die of hunger, unless revived (`CONTEXT.md`: Down):
/// one real day, the window in which a Player can notice and act (ADR 0021).
pub const DOWN_DAYS: f64 = 60.0;

/// The health a Down resident wakes with once fed (`CONTEXT.md`: Reviving), of `MAX_HEALTH`: low,
/// coming back while their hunger meter isn't empty.
pub const WAKE_HEALTH: f64 = 10.0;

/// Units of Food the Feed row suggests giving (`CONTEXT.md`: Reviving): one eaten at once to wake,
/// one more to go on with, about four game days of eating.
pub const FEED_UNITS: f64 = 2.0;

/// Ticks a resident takes to swap an item into an equipment slot or take one off (`CONTEXT.md`:
/// Equipment), striking no blows meanwhile: long enough that swapping mid-fight costs a blow or
/// two, short enough to be done before the next one comes.
pub const EQUIP_TICKS: f64 = 3.0;

/// Game days a fed resident takes to heal from no health back to full.
pub const HEAL_DAYS: f64 = 3.0;

/// The Endurance at which a resident needs exactly `FOOD_PER_DAY`.
pub const HUNGER_ENDURANCE_AVERAGE: f64 = 10.0;

/// How much less food each point of Endurance above average needs (more below it).
pub const HUNGER_ENDURANCE_EFFECT: f64 = 0.02;

/// The furthest Endurance moves the food a resident needs, either way.
pub const HUNGER_ENDURANCE_LIMIT: f64 = 0.3;

/// How much food a resident burns on each terrain, relative to Plains (`CONTEXT.md`: Terrain).
/// Endurance softens the extra (`foodUse`).
pub const TERRAIN_FOOD: TerrainTable = TerrainTable(&[
    (Terrain::Plains as u8, 1.0),
    (Terrain::Forest as u8, 1.0),
    (Terrain::Hills as u8, 1.3),
    (Terrain::Mountain as u8, 2.0),
    // Rowing or aboard a boat, as walking on Plains (`CONTEXT.md`: Rowing).
    (Terrain::Lake as u8, 1.0),
    (Terrain::Sea as u8, 1.0),
    // On a road residents eat as on Plains, whatever the terrain beneath.
    (Terrain::Road as u8, 1.0),
]);

/// How much of a terrain's extra food use each point of Endurance above average takes away.
pub const ENDURANCE_TERRAIN_EFFECT: f64 = 0.03;

/// A city has a food surplus when its storages hold more Food than all its residents eat in this
/// many game days (`CONTEXT.md`: Food surplus). Food residents carry doesn't count.
pub const FOOD_SURPLUS_DAYS: f64 = 10.0;

/// A child's base stats are the parents' average, rounded, plus a whole random amount of at most
/// this much either way (`CONTEXT.md`: Child), and never below 1.
pub const CHILD_STAT_SPREAD: f64 = 2.0;

/// A Player's realm draws drifters while it has fewer residents than this, the drifter on its way
/// counted (`CONTEXT.md`: Drifter): twice a starting city's, so a small realm grows a little on
/// its own and a grown one no longer.
pub const DRIFTER_REALM_CAP: f64 = 16.0;

/// Game days a realm waits for each drifter (`CONTEXT.md`: Drifter), counted only while one may
/// come: about 1.2 real hours.
pub const DRIFTER_WAIT_DAYS: f64 = 3.0;

/// How far from the town hall a drifter comes into being, in tiles (`CONTEXT.md`: Drifter): the
/// nearest that is out of every Player's sight from here on, so just past the city's own sight
/// (`SIGHT_RANGE`), seven to ten minutes' walk on plains.
pub const DRIFTER_DISTANCE_MIN: f64 = 60.0;

/// The farthest from the town hall a drifter comes into being, in tiles (`CONTEXT.md`: Drifter).
pub const DRIFTER_DISTANCE_MAX: f64 = 80.0;

/// Food a drifter carries for the walk (`CONTEXT.md`: Drifter), and nothing else.
pub const DRIFTER_FOOD: f64 = 1.0;
}

/// Units of Food a resident sent to a workplace sets out with (`CONTEXT.md`: Crew food): twice a
/// walk of `walkTicks` ticks plus `SET_OUT_WORK_DAYS` of work, at `FOOD_PER_DAY`, in whole units
/// rounded up. Never less than their own food (`OWN_FOOD`).
pub fn set_out_food(walk_ticks: f64) -> f64 {
    let days = (2.0 * walk_ticks) / TICKS_PER_GAME_DAY + SET_OUT_WORK_DAYS;
    OWN_FOOD.max((days * FOOD_PER_DAY).ceil())
}

/// Units of Food an NPC city's road crew has on them before they start a tile of road a walk of
/// `walkTicks` ticks from the storage (`CONTEXT.md`: NPC road): what the walk home eats, in whole units
/// rounded up, over what the Build default fetches Food below (`GET_FOOD_AT`), which from far out
/// would come too late to get home fed.
pub fn road_crew_food(walk_ticks: f64) -> f64 {
    ((walk_ticks / TICKS_PER_GAME_DAY) * FOOD_PER_DAY).ceil() + GET_FOOD_AT
}
