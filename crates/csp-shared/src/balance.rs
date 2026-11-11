//! Balance numbers: how much, how fast, how often. The rules (what happens) are in `CONTEXT.md`;
//! these are the values Daniel tunes. One commented constant each.
//!
//! Work (eating, production, building, skill, spoilage, breeding) is counted in game days; social
//! and political timers (memory, standing, persuasion, contracts, punishment, alliance delays) keep
//! their real-time length (`CONTEXT.md`: Game time).
//!
//! Ported from `packages/shared/src/balance.ts` (ADR 0030): same names in `SCREAMING_SNAKE_CASE`,
//! same values, same comments. Numbers are `f64` as in TypeScript; the one exception is
//! `MAP_SIZE`, an `i32` because a grid size is a tile count. Structured constants are structs
//! (serialised under the TypeScript field names) or `Table`s keyed by the TypeScript string key.
//! Helpers that take a world type (`Resident`, `Horse`, `Stock`) are not here: they come with the
//! world types, in `csp-sim`. Since the cutover (T88.6) the numbers live here; the client reads
//! them from `packages/balance`, which `pnpm balance:rust` writes from this file.

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::{json, to_value, Map, Value};

use crate::terrain::Terrain;
use crate::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};

/// A static table from a string key (a good, a building kind, a skill) to a value, in the order
/// the TypeScript object lists them; serialised as a JSON object.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Table<V: 'static>(pub &'static [(&'static str, V)]);

impl<V: Copy> Table<V> {
    /// The value under `key`, if the table has one.
    pub fn get(&self, key: &str) -> Option<V> {
        self.0.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
    }
}

impl<V: Serialize> Serialize for Table<V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

/// A static table from a terrain byte (`Terrain as u8`) to a number, as the TypeScript objects
/// keyed by `[Terrain.X]`; serialised as a JSON object with the byte as the key.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TerrainTable(pub &'static [(u8, f64)]);

impl TerrainTable {
    /// The number for a terrain byte, if the table lists it.
    pub fn get(&self, terrain: u8) -> Option<f64> {
        self.0.iter().find(|(t, _)| *t == terrain).map(|(_, v)| *v)
    }
}

impl Serialize for TerrainTable {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (terrain, value) in self.0 {
            map.serialize_entry(&terrain.to_string(), value)?;
        }
        map.end()
    }
}

/// `Math.ceil` for constants: `f64::ceil` is not `const` yet.
const fn ceil(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t < x {
        t + 1.0
    } else {
        t
    }
}

/// Tiles along each side of the map: once around is a ~12 h walk at ~7.5 s per plains tile.
pub const MAP_SIZE: i32 = 5760;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainShares {
    /// A few large bodies of water.
    pub sea: f64,
    /// Inland water, a few scattered lakes.
    pub lake: f64,
    /// In ranges.
    pub mountain: f64,
    /// Mostly around the ranges.
    pub hills: f64,
    pub forest: f64,
}

/// Share of the map's tiles each terrain covers in a freshly generated map. Plains take the rest.
/// The generator hits these closely; the map test checks them.
pub const TERRAIN_SHARES: TerrainShares =
    TerrainShares { sea: 0.08, lake: 0.025, mountain: 0.07, hills: 0.13, forest: 0.25 };

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDensity {
    pub forest: TerrainTable,
    pub stone: TerrainTable,
    pub iron_ore: TerrainTable,
    pub gold_ore: TerrainTable,
}

/// Resource nodes per tile of each terrain they lie on, when the world is created: as many per
/// area as on the old 40 m grid, so a sixteenth per tile. Ore is denser in Mountain than in Hills;
/// gold is rare.
pub const NODE_DENSITY: NodeDensity = NodeDensity {
    forest: TerrainTable(&[(Terrain::Forest as u8, 1.0 / 4800.0)]),
    stone: TerrainTable(&[(Terrain::Hills as u8, 1.0 / 4000.0)]),
    iron_ore: TerrainTable(&[
        (Terrain::Hills as u8, 1.0 / 24000.0),
        (Terrain::Mountain as u8, 1.0 / 4800.0),
    ]),
    gold_ore: TerrainTable(&[
        (Terrain::Hills as u8, 1.0 / 240000.0),
        (Terrain::Mountain as u8, 1.0 / 48000.0),
    ]),
};

/// No two resource nodes lie closer than this many tiles (in either direction).
pub const NODE_MIN_SPACING: f64 = 16.0;

/// How fast an unloaded resident crosses each terrain, relative to Plains (`CONTEXT.md`:
/// Terrain). Agility softens the penalty (`walkSpeed`).
pub const TERRAIN_SPEED: TerrainTable = TerrainTable(&[
    (Terrain::Plains as u8, 1.0),
    (Terrain::Forest as u8, 0.7),
    (Terrain::Hills as u8, 0.7),
    (Terrain::Mountain as u8, 0.35),
    // A road, whatever the terrain beneath (`CONTEXT.md`: Road).
    (Terrain::Road as u8, 1.3),
]);

/// A resident's base stats are drawn from this range when no parents pass theirs on.
pub const STAT_BASE_MIN: f64 = 5.0;

pub const STAT_BASE_MAX: f64 = 15.0;

/// Training can add at most this share of a stat's base value (`CONTEXT.md`: Trained bonus).
pub const TRAINED_CAP_SHARE: f64 = 0.5;

/// Most health a resident can have.
pub const MAX_HEALTH: f64 = 100.0;

/// A full hunger meter.
pub const MAX_HUNGER: f64 = 100.0;

/// Placeholder residents (until starting cities, T2.2) are this many game years old.
pub const START_AGE_MIN: f64 = 16.0;

pub const START_AGE_MAX: f64 = 45.0;

/// A new resident's lifespan, the age in game years they die of old age, lies in this range.
pub const LIFESPAN_MIN: f64 = 55.0;

pub const LIFESPAN_MAX: f64 = 65.0;

/// Children are grown at this age in game years (`CONTEXT.md`: Aging, Child): from then on they
/// can work, build, tear down and pair.
pub const ADULT_AGE: f64 = 14.0;

/// Game days each year of age up to `ADULT_AGE` takes: children age faster, so a newborn is grown
/// after 140 game days (~56 real hours). Later years take a full game year (`CONTEXT.md`: Aging).
pub const CHILD_YEAR_DAYS: f64 = 10.0;

/// Ticks from birth until a resident is grown up.
const CHILDHOOD_TICKS: f64 = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;

// `ageInYears` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// The ticks a resident has lived at an age in game years: the inverse of `ageInYears`.
pub fn ticks_for_age(age: f64) -> f64 {
    if age <= ADULT_AGE {
        return age * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY;
    }
    CHILDHOOD_TICKS + (age - ADULT_AGE) * TICKS_PER_GAME_YEAR
}

// `canWork` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// The goods a child may pick up, put down, Fetch and Store: their meals (`CONTEXT.md`: Child).
pub const CHILD_GOODS: &[&str] = &["food"];

// `canHandle` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Stats start to decline at this age in game years (`CONTEXT.md`: Aging).
pub const DECLINE_AGE: f64 = 45.0;

/// Share of a stat's effective value lost for each full game year past `DECLINE_AGE`.
pub const DECLINE_PER_YEAR: f64 = 0.02;

/// However old a resident gets, their stats keep at least this share of their effective value.
pub const DECLINE_FLOOR: f64 = 0.6;

// `ageFactor` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `statValue` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// The most a stat's trained bonus can be, for a given base value.
pub fn trained_cap(base: f64) -> f64 {
    (base * TRAINED_CAP_SHARE).floor()
}

/// Tiles along each side of a starting city, wall included: 27×27 tiles inside the wall. An odd
/// number, so its storage has a middle tile.
pub const START_CITY_SIZE: f64 = 29.0;

/// Residents in a starting city, the Leader included.
pub const START_RESIDENTS: f64 = 8.0;

/// Residents each kind of building houses (`CONTEXT.md`: House, Free housing). Only houses so far;
/// later housing buildings (a palace, a castle) add their room here.
pub const HOUSING_ROOM: Table<f64> = Table(&[("house", 4.0)]);

/// Houses a starting city gets beyond what its residents need.
pub const START_SPARE_HOUSES: f64 = 1.0;

/// Food in a starting city's storage, in kg: about 25 game days for its residents.
pub const START_FOOD: f64 = 100.0;

/// Food each resident of a starting city carries, in units: four game days' meals, so they have
/// something to eat while the farm's first harvest comes in (`CONTEXT.md`: Eating).
pub const START_CARRIED_FOOD: f64 = 2.0;

/// Horses in a starting city's stable: two, so a resident can breed them (`CONTEXT.md`: Starting city).
pub const START_HORSES: f64 = 2.0;

/// Food in a starting city's stable, in units: 20 game days for its horses, time to start
/// bringing it food from the farm.
pub const START_STABLE_FOOD: f64 = 30.0;

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

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HorseStatValues {
    pub speed: f64,
    pub strength: f64,
    pub endurance: f64,
}

/// An average horse's stats: the middle of the range, what horses from before stats got.
pub const AVERAGE_HORSE_STATS: HorseStatValues = HorseStatValues {
    speed: HORSE_STAT_AVERAGE,
    strength: HORSE_STAT_AVERAGE,
    endurance: HORSE_STAT_AVERAGE,
};

/// A new horse is this many game years old, drawn in the range; foals start at 0.
pub const HORSE_START_AGE_MIN: f64 = 3.0;

pub const HORSE_START_AGE_MAX: f64 = 8.0;

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

// `horseStatShare` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `horseSpeedFactor` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `horseStrengthFactor` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `horseFoodFactor` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `horseAgeInYears` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Starting cities lie at least this many tiles apart (about 2.5 hours' walk on plains), when the
/// map has room; otherwise as far apart as it allows.
pub const CITY_MIN_DISTANCE: f64 = 1200.0;

/// How near a city building must stand to the city's town hall, or to another building already
/// part of that city, to be part of it too (`CONTEXT.md`: City building), in tiles along each
/// direction from footprint to footprint. A wall with gaps of up to eleven tiles still holds
/// together.
pub const CITY_BUILDING_REACH: f64 = 12.0;

/// How far around each of its buildings' footprints a city's area reaches (`CONTEXT.md`: City
/// area), in tiles along each direction: about the old 40 m tile right next to them.
pub const CITY_AREA_MARGIN: f64 = 4.0;

/// Most tiles a ring of walls and gates can shut in (`CONTEXT.md`: Walls in combat): ground cut
/// off by walls from more than this, a square of 400 tiles along each side, counts as outside.
pub const WALL_ENCLOSES_MAX: f64 = 160_000.0;

/// How far a resident sees, in tiles (`CONTEXT.md`: Sight).
pub const SIGHT_RANGE: f64 = 48.0;

/// How often each realm's Last seen is brought up to date, in ticks (`CONTEXT.md`: Last seen).
/// Realms are staggered by their id, so about one in this many refreshes on a tick; a building
/// that leaves sight between two refreshes is remembered as it was up to this many ticks earlier.
pub const LAST_SEEN_EVERY_TICKS: f64 = 5.0;

/// NPC villages placed on a full-size map (`CONTEXT.md`: NPC city); a smaller map gets fewer, by
/// its area. Fewer are placed when the map has no room left for them.
pub const NPC_VILLAGES: f64 = 12.0;

/// NPC towns placed on a full-size map, like `NPC_VILLAGES`. Towns are placed first.
pub const NPC_TOWNS: f64 = 4.0;

/// NPC cities lie at least this many tiles from every other city, starting cities and NPC cities
/// alike (about an hour's walk on plains), the short way round the map.
pub const NPC_CITY_MIN_DISTANCE: f64 = 480.0;

/// What an NPC city is placed with, by its size: a walled square like a starting city's.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcCitySize {
    /// Tiles along each side, wall included: an odd number, so its storage has a middle tile.
    pub size: f64,
    /// Adult residents, with random stats like a starting city's.
    pub residents: f64,
    /// Houses inside the wall, in a row north of the storage; room for everyone and a little more.
    pub houses: f64,
    /// Farms outside the wall, by the gate; the residents start on them, working them.
    pub farms: f64,
    /// Food in its storage, in units.
    pub food: f64,
}

/// A village: a starting city's square, a few fewer residents, one farm.
pub const NPC_VILLAGE: NpcCitySize =
    NpcCitySize { size: 29.0, residents: 6.0, houses: 2.0, farms: 1.0, food: 75.0 };

/// A town: a wider square, twice the residents of a starting city, two farms.
pub const NPC_TOWN: NpcCitySize =
    NpcCitySize { size: 45.0, residents: 16.0, houses: 5.0, farms: 2.0, food: 200.0 };

/// Game days a realm must occupy a city's town hall without a break to capture the city
/// (`CONTEXT.md`: Capturing a city, Occupying a town hall; ADR 0017): long enough for its owner to
/// hear of it and march back.
pub const OCCUPATION_GAME_DAYS: f64 = 10.0;

/// What an NPC city asks for each resident living there when it is bought (`CONTEXT.md`: Buying a
/// city), in Coins: twenty game days of one mint worker's coins (`RECIPES`, `BATCHES_PER_DAY`), or
/// five of a full gold mine and its mint.
pub const CITY_PRICE_PER_RESIDENT: f64 = 400.0;

/// What an NPC city asks for each of its finished buildings when it is bought, in Coins, by kind;
/// a kind missing here adds nothing. A village (6 residents, a town hall, a storage, 2 houses, a
/// farm and its wall ring) comes to about 2 800 coins, which three residents can carry; a town to
/// about 7 000. A stretch of wall is a quarter of what it was on the old 40 m tiles.
pub const CITY_PRICE_BY_BUILDING: Table<f64> = Table(&[
    ("townHall", 200.0),
    ("house", 50.0),
    ("storage", 50.0),
    ("farm", 30.0),
    ("stable", 40.0),
    ("wall", 0.5),
    ("gate", 1.25),
]);

/// An NPC city's Food runs short (`CONTEXT.md`: NPC city) when its storages hold less than its
/// residents eat in this many game days. It then puts residents on its farms first.
pub const NPC_FOOD_SHORT_DAYS: f64 = 5.0;

/// Units of Food a farm's pile keeps when a worker carries its output away (`CONTEXT.md`:
/// Carrying the output), so the workers there can still refill at their workplace (Refilling at a
/// workplace). Written into the Work default's source, where a Player can change it.
pub const WORK_FOOD_KEPT: f64 = 2.0;

/// Share of an NPC city's adults it keeps as soldiers (`CONTEXT.md`: NPC city, Soldier), rounded
/// up so even a village keeps one: a starting village (6 residents) keeps 2, a town (16) keeps 4.
pub const NPC_SOLDIER_SHARE: f64 = 0.25;

/// How many of an NPC city's soldiers stand on its town hall between fights, the first to be posted
/// (`CONTEXT.md`: Soldier posts). One there is enough to block an occupation; a second keeps it held
/// when the first is called away.
pub const NPC_SOLDIERS_ON_HALL: f64 = 2.0;

/// How many of an NPC city's soldiers stand at each of its gates, once its hall is held.
pub const NPC_SOLDIERS_AT_GATE: f64 = 1.0;

/// How many tiles out from its town hall an NPC city's soldiers stand around it when its wall has too
/// few tiles for them, or it has none (`CONTEXT.md`: Soldier posts).
pub const NPC_POST_AROUND_HALL: f64 = 2.0;

/// Ticks each lot of a big NPC city's soldiers trains before the next lot's turn (`CONTEXT.md`: Who
/// trains): five game days, long enough to be worth the walk there and back.
pub const NPC_TRAIN_TURN_TICKS: f64 = 5.0 * TICKS_PER_GAME_DAY;

/// The most of an NPC city's soldiers walking a round at once, whatever its size (`CONTEXT.md`: Soldier
/// posts). They walk every tick, the dearest of a soldier's jobs, so a city's cost stops growing here.
pub const NPC_PATROLS_MAX: f64 = 3.0;

/// One soldier walks a round for every this many on an NPC city's wall, up to `NPC_PATROLS_MAX`.
pub const NPC_SOLDIERS_PER_PATROL: f64 = 4.0;

/// How many stops a round has along an NPC city's wall, spread evenly round it. Each costs one path
/// search; a town's wall of 180 tiles gives legs of about 22 tiles, some 3 game hours each.
pub const NPC_PATROL_WALL_STOPS: f64 = 8.0;

/// How many stops a round has along an NPC city's roads inside it, after those on its wall.
pub const NPC_PATROL_ROAD_STOPS: f64 = 3.0;

/// Coins an NPC city keeps as its war chest for each of its residents (`CONTEXT.md`: NPC reserve):
/// a town of 16 keeps 160, what four mint workers strike in two game days (`RECIPES`).
pub const NPC_WAR_CHEST_PER_RESIDENT: f64 = 10.0;

/// How near to an NPC city's gate, in tiles, an armed outsider makes it close its gates
/// (`CONTEXT.md`: NPC city): a little inside sight, so the gate shuts before they reach it.
pub const NPC_GATE_WATCH_RANGE: f64 = 32.0;

/// An NPC city keeps one pair for every this many of its adults (`CONTEXT.md`: NPC city,
/// Pairing): a village of six one pair, a town of sixteen two. Only the partner carrying the child
/// stops working, and only for `CARRYING_DAYS`.
pub const NPC_ADULTS_PER_PAIR: f64 = 6.0;

/// Game days a partner carries a child before it is born (`CONTEXT.md`: Carrying), not working
/// meanwhile: 10 game days, 4 real hours.
pub const CARRYING_DAYS: f64 = 10.0;

/// Ticks from the start of carrying until the child is born (`CARRYING_DAYS`).
pub const CARRYING_TICKS: f64 = CARRYING_DAYS * TICKS_PER_GAME_DAY;

/// Game days a pair waits after pairing before one partner starts carrying (`CONTEXT.md`: Pairing),
/// if their city then has free housing and a food surplus: 10 game days, 4 real hours.
pub const PAIRING_WAIT_DAYS: f64 = 10.0;

/// Ticks from pairing until a partner can start carrying (`PAIRING_WAIT_DAYS`).
pub const PAIRING_WAIT_TICKS: f64 = PAIRING_WAIT_DAYS * TICKS_PER_GAME_DAY;

/// Ticks between a game-run city's planning passes (`CONTEXT.md`: NPC city; ADR 0016): a game
/// hour, so a city reacts to a change within a real minute. Cities are staggered by their id, so
/// about one plans per tick.
pub const NPC_PLAN_TICKS: f64 = 60.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcJobScore {
    /// Farming for a worker off the farms, while Food runs short: past the farmers it keeps.
    pub farm_food_short: f64,
    /// Farming, while it lacks the farmers it keeps.
    pub farm: f64,
    /// Not weighed: where revivers get their turn, Food for those who aren't Down coming first.
    pub revive: f64,
    /// Building its project.
    pub project: f64,
    /// Making a good short of its reserve, at the least.
    pub short: f64,
    pub short_range: f64,
    /// Its road crew.
    pub road: f64,
    /// Scouting.
    pub scout: f64,
    /// Going back to the workplace they were let go from.
    pub back: f64,
    /// Working for surplus, at the least.
    pub surplus: f64,
    pub surplus_range: f64,
}

/// What each job of an NPC city is worth to a free adult (`CONTEXT.md`: NPC city; ADR 0029): each
/// goes to the highest-scoring job with room. Only the order and the gaps mean anything: `short` runs
/// up to `short` + `shortRange` by how much of a good it lacks, staying below `project`, and `surplus`
/// up to `surplus` + `surplusRange` by how far below its cap, staying below `back`.
pub const NPC_JOB_SCORE: NpcJobScore = NpcJobScore {
    farm_food_short: 110.0,
    farm: 100.0,
    revive: 80.0,
    project: 55.0,
    short: 50.0,
    short_range: 4.0,
    road: 30.0,
    scout: 28.0,
    back: 20.0,
    surplus: 10.0,
    surplus_range: 5.0,
};

/// How much more another job must score for an NPC city's worker to leave theirs (`CONTEXT.md`: NPC
/// city; ADR 0029), so nobody goes back and forth: more than the whole of `NPC_JOB_SCORE.shortRange`
/// and the step up to `project`, so a worker on one short good stays for another or for the project,
/// and less than the gaps above `back`, so one let go leaves for anything that wants them.
pub const NPC_JOB_MARGIN: f64 = 6.0;

/// Residents to each step of an NPC city's needs and crews (`CONTEXT.md`: NPC reserve, Spare hands'
/// work, NPC road): its Wood and Stone kept, surplus caps, builders and road crew are this many steps
/// of a village's (`npcNeedsScale`), in whole steps so one birth doesn't move them. Below two steps
/// it keeps a village's numbers, and from two on it is a big city (`isBigNpcCity`): at 50 residents,
/// about three times a town.
pub const NPC_RESIDENTS_PER_NEEDS_STEP: f64 = 25.0;

/// Most of an NPC city's adults that build at once, per step of its needs (`npcNeedsScale`;
/// `CONTEXT.md`: NPC city): laying out, carrying materials to the site, building or tearing down. The
/// others keep working.
pub const NPC_BUILDERS: f64 = 2.0;

/// Most of an NPC city's spare hands on its road crew at once, per step of its needs
/// (`npcNeedsScale`; `CONTEXT.md`: NPC road), apart from its builders: enough for a road to grow out
/// day by day and to fetch for each other, while the rest go on working for surplus.
pub const NPC_ROAD_CREW: f64 = 2.0;

/// The longest way an NPC city's road crew takes on (`CONTEXT.md`: NPC road), in tiles: a way longer
/// than this is given up. Past `NPC_FOUND_REACH`, so a city can join its daughter round a lake.
pub const NPC_ROAD_LONGEST: f64 = 1200.0;

/// How far outside its area an NPC city still fetches a Down resident of its own (`CONTEXT.md`:
/// Reviving), in tiles: about a quarter of a game day's walk on plains each way.
pub const NPC_REVIVE_REACH: f64 = 48.0;

/// How far past its reserve an NPC city's spare hands work for surplus, by good, in units per step
/// of its needs (`npcNeedsScale`; `CONTEXT.md`: Spare hands' work). Several of a trader's full loads
/// (about 30 kg, `CARRY_BASE`), so its trader has something to sell, and above the materials a Full city wants (`townHall` and
/// `storage` in `BUILD_MATERIALS`), or it could never found; few weapons, which its trader never
/// sells. A good not named here is not worked for surplus.
pub const NPC_SURPLUS_CAP: Table<f64> = Table(&[
    ("food", 100.0),
    ("wood", 150.0),
    ("stone", 100.0),
    ("ironOre", 60.0),
    ("iron", 60.0),
    ("goldOre", 60.0),
    ("coins", 300.0),
    ("spear", 4.0),
]);

/// How many tiles further out an NPC city puts up its new wall when it has no room left inside
/// the old one (`CONTEXT.md`: NPC city), on every side, with the gate in the same place. At most
/// `CITY_BUILDING_REACH`, so the new wall stays part of the city once the old one is gone.
pub const NPC_WALL_STEP: f64 = 8.0;

/// How far from the middle of its town hall a big NPC city's inner ring of wall may stand
/// (`CONTEXT.md`: Bigger projects), in tiles: room for its first lanes round the hall and storage,
/// and always short of its outer wall, which stands at least 14 from its home.
pub const NPC_INNER_WALL_REACH: f64 = 9.0;

/// Tiles along each side of a block of the Grid layout (`CONTEXT.md`: City layout): room for two
/// houses each way, or one stable. A lane one tile wide, left free for a street, runs between blocks.
pub const CITY_GRID_BLOCK: f64 = 4.0;

/// Tiles from one circular lane of the Rings layout to the next (`CONTEXT.md`: City layout), the first
/// this far from the middle of the town hall: room between two lanes for a circle of houses, or
/// stables, all the way round.
pub const CITY_RING_STEP: f64 = 5.0;

/// Tiles along the street between two side lanes of the Main street layout (`CONTEXT.md`: City
/// layout): a row of four houses, long enough to read as a row and not as a block of the Grid. A lane
/// one tile wide, left free for a street, comes after them.
pub const CITY_SIDE_LANE_GAP: f64 = 8.0;

/// Tiles deep of a band of rows in the Quarters layout (`CONTEXT.md`: City layout): two rows of houses
/// back to back, or one row of stables. A lane one tile wide, left free for a street, runs between
/// bands.
pub const CITY_QUARTER_ROWS: f64 = 4.0;

/// How many tiles of wall an NPC city's builder fetches the materials for in one trip to the
/// storage (`CONTEXT.md`: NPC city, Fetching materials): a 40 m stretch's worth, so a long wall is
/// not one walk per tile. What a tile doesn't take goes to the next.
pub const NPC_WALL_TILES_PER_TRIP: f64 = 4.0;

/// How far from its home an NPC city looks for a resource node to build a workplace on when it
/// needs a material it has no workplace for (`CONTEXT.md`: NPC city), in tiles: about twenty
/// minutes' walk on plains.
pub const NPC_NODE_REACH: f64 = 160.0;

/// How many of an NPC city's residents it takes to send one scout at a time, rounded up
/// (`CONTEXT.md`: Scout): a village one, a town of 16 two, a city of 48 four.
pub const NPC_RESIDENTS_PER_SCOUT: f64 = 12.0;

/// How far from its home an NPC city comes to know resource nodes through its scouts (`CONTEXT.md`:
/// Scout), in tiles: 2.5 times its set reach (`NPC_NODE_REACH`), about 50 minutes' walk on plains.
pub const NPC_SCOUT_LIMIT: f64 = 400.0;

/// The squares of map an NPC city's knowledge from its scouts goes by (`CONTEXT.md`: Scout), in tiles
/// along each side. Small enough that a scout standing in one has its middle and its neighbours' in
/// sight (`SIGHT_RANGE`), large enough that what a city knows stays a few hundred numbers.
pub const NPC_SCOUT_SECTOR: f64 = 32.0;

/// How far from its home a Trade Org warehouse may be for an NPC city to send its trader there
/// (`CONTEXT.md`: NPC trader), in tiles: about a game day and a half's walk on plains each way.
pub const NPC_TRADER_REACH: f64 = 720.0;

/// Residents of an NPC city for each trader it has out at once (`CONTEXT.md`: NPC trader), rounded
/// down: a village, a town and a city of under 60 keep one; a city of 110 sends three. Each walks
/// every tick, so this is what its trading costs the server.
pub const NPC_RESIDENTS_PER_TRADER: f64 = 30.0;

/// How far from its home a Player's offer may be for an NPC city to send its trader there
/// (`CONTEXT.md`: NPC cities at an offer), in tiles: as far as it goes to a Trade Org warehouse
/// (`NPC_TRADER_REACH`), since it is the same trader on the same Food.
pub const NPC_OFFER_REACH: f64 = 720.0;

/// Game days after it left that an NPC city stops waiting for its trader (`CONTEXT.md`: NPC
/// trader): dead, robbed or stuck, they are dropped from its plan and it may send another.
/// Several times the longest trade run (`NPC_TRADER_REACH` there and back).
pub const NPC_TRADER_GIVE_UP_DAYS: f64 = 10.0;

/// How far beyond its wall an NPC city looks for Plains to lay out a new farm on, in tiles. Farms
/// go beyond where its next wall would stand.
pub const NPC_FARM_REACH: f64 = 48.0;

/// Game days an NPC city of up to `NPC_FOUND_VILLAGE_RESIDENTS` must have been full before it founds
/// a daughter (`CONTEXT.md`: Full city): a game week of idle spare hands and nothing short. A bigger
/// city waits less (`npcFullDays`).
pub const NPC_FULL_DAYS: f64 = 7.0;

/// Residents up to which an NPC city founds as a village does (`CONTEXT.md`: Full city, Founding): it
/// waits `NPC_FULL_DAYS` and sends a village's worth. About twice a town as it is placed.
pub const NPC_FOUND_VILLAGE_RESIDENTS: f64 = 30.0;

/// Residents past `NPC_FOUND_VILLAGE_RESIDENTS` that take a game day off how long a full city waits
/// (`npcFullDays`): a city of 110 waits 3 game days.
pub const NPC_FULL_RESIDENTS_PER_DAY: f64 = 20.0;

/// The fewest game days any full NPC city waits before it founds (`npcFullDays`).
pub const NPC_FULL_DAYS_LEAST: f64 = 2.0;

/// Game days a dip below its reserve may last before a full NPC city's wait starts over (`CONTEXT.md`:
/// Full city): Food its scouts and road crew take out and bring back doesn't count.
pub const NPC_FULL_DIP_DAYS: f64 = 1.0;

/// Residents past `NPC_FOUND_VILLAGE_RESIDENTS` that add one adult to a founding party
/// (`npcFoundingPartySize`): a city of 110 sends the most, about one in eight of it.
pub const NPC_FOUND_RESIDENTS_PER_MEMBER: f64 = 10.0;

/// The largest founding party (`npcFoundingPartySize`): with the houses it carries for those past a
/// village's worth (`foundingMaterials`), its materials stay under the surplus caps
/// (`NPC_SURPLUS_CAP`), or a big city could never found on what it makes.
pub const NPC_FOUND_PARTY_MOST: f64 = 14.0;

/// Random tiles a full NPC city tries in one search for its daughter's site (`CONTEXT.md`:
/// Founding), once a game day: enough to find free Plains on most maps, cheap enough to do while
/// it waits.
pub const NPC_FOUND_SAMPLES: f64 = 200.0;

/// How far from its home a full NPC city looks for its daughter's site, in tiles (`CONTEXT.md`:
/// Founding): twice the usual distance between cities, about five game days' walk on Plains.
pub const NPC_FOUND_REACH: f64 = 960.0;

/// Game days of Food a founding party's member carries for their first weeks at the site
/// (`CONTEXT.md`: Founding), besides the Food for twice the walk there.
pub const NPC_FOUND_FOOD_DAYS: f64 = 20.0;

/// Game days after setting out that a founding party whose town hall doesn't stand gives up and
/// walks home (`CONTEXT.md`: Founding); the mother may try again once it is full again.
pub const NPC_FOUND_GIVE_UP_DAYS: f64 = 20.0;

/// The standing a daughter and its mother start at toward each other (`CONTEXT.md`: Founding):
/// high, of `STANDING_RANGE`, fading like any standing.
pub const NPC_FOUND_STANDING: f64 = 80.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgHq {
    /// Tiles from the middle of the town hall to the inner ring of wall, which holds its warehouses.
    pub inner_radius: f64,
    /// Tiles from the middle of the town hall to the outer ring of wall; about twice an NPC town's
    /// width across.
    pub outer_radius: f64,
    /// Tiles from one outer ring to the next one it grows (`CONTEXT.md`: Trade Org HQ): as far as a
    /// city building reaches (`CITY_BUILDING_REACH`), so the new ring joins the HQ, with a band of
    /// houses between.
    pub ring_step: f64,
    /// Gates in each ring, evenly round it, the first due north.
    pub gates: f64,
    /// Adult residents, with random stats like a starting city's.
    pub residents: f64,
    /// Houses between the rings: room for everyone and one house more.
    pub houses: f64,
    /// Farms outside the outer ring, by its gates.
    pub farms: f64,
    /// Food in its storage, in units: about two weeks of what everyone eats.
    pub food: f64,
    /// Coins in its coin warehouse.
    pub coins: f64,
    /// Goods in its goods warehouse, in units.
    pub goods: Table<f64>,
}

/// What the Trade Org HQ is placed with (`CONTEXT.md`: Trade Org HQ): a round city, the largest on
/// the map, with two rings of wall around its town hall.
pub const TRADE_ORG_HQ: TradeOrgHq = TradeOrgHq {
    inner_radius: 16.0,
    outer_radius: 40.0,
    ring_step: 12.0,
    gates: 4.0,
    residents: 32.0,
    houses: 9.0,
    farms: 4.0,
    food: 225.0,
    coins: 20_000.0,
    goods: Table(&[
        ("wood", 300.0),
        ("stone", 300.0),
        ("ironOre", 150.0),
        ("iron", 100.0),
        ("goldOre", 50.0),
    ]),
};

/// Starting cities lie at least this many tiles from the Trade Org HQ when the map has room
/// (`CITY_MIN_DISTANCE` for other starting cities), and the HQ is placed as far from every city
/// as the map allows.
pub const TRADE_ORG_HQ_MIN_DISTANCE: f64 = 1600.0;

/// How wide a region is for trading posts (`CONTEXT.md`: Trading post), in tiles along each side:
/// the map is cut into a grid of about this size, one post in each square. A full-size map gets
/// 4 × 4 = 16 posts, as many as it gets NPC cities; a small map gets at least one.
pub const TRADING_POST_REGION: f64 = 1440.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingPost {
    /// Tiles along each side, wall included: a village's square.
    pub size: f64,
    /// Adult residents: enough for its farm and its one workplace, besides the quarter it keeps as
    /// soldiers (`NPC_SOLDIER_SHARE`).
    pub residents: f64,
    /// Houses inside the wall: room for everyone.
    pub houses: f64,
    /// Farms outside the wall, by the gate.
    pub farms: f64,
    /// Food in its storage, in units: about 25 game days of what everyone eats.
    pub food: f64,
    /// Coins in its warehouse.
    pub coins: f64,
    /// Goods in its warehouse, in units: twice its floor (`WAREHOUSE_FLOOR`), so it has a market of every
    /// good until its first trader and caravan come by, and its soldiers' weapons.
    pub goods: Table<f64>,
}

/// What a trading post is placed with (`CONTEXT.md`: Trading post): a walled village with a
/// warehouse. It keeps this size; it never grows.
pub const TRADING_POST: TradingPost = TradingPost {
    size: 29.0,
    residents: 6.0,
    houses: 2.0,
    farms: 1.0,
    food: 75.0,
    coins: 2_000.0,
    goods: Table(&[
        ("food", 40.0),
        ("wood", 50.0),
        ("stone", 50.0),
        ("ironOre", 20.0),
        ("iron", 10.0),
        ("goldOre", 10.0),
        ("spear", 4.0),
        ("sword", 2.0),
        ("shield", 4.0),
        ("armour", 2.0),
    ]),
};

/// A trading post's stock floor (`CONTEXT.md`: Stock floor, ADR 0023), in units: what its spare
/// hands, caravan and wandering traders go for, and what its prices are reckoned from. It tops up
/// nothing at a post; the HQ's warehouses top up to `HQ_FLOOR_FACTOR` times this each game day. Half
/// of what a post starts with, so a fresh post is well above it.
pub const WAREHOUSE_FLOOR: Table<f64> = Table(&[
    ("food", 20.0),
    ("wood", 25.0),
    ("stone", 25.0),
    ("ironOre", 10.0),
    ("iron", 5.0),
    ("goldOre", 5.0),
    ("coins", 1_000.0),
    ("spear", 2.0),
    ("sword", 1.0),
    ("shield", 2.0),
    ("armour", 1.0),
]);

/// How many times a trading post's floor (`WAREHOUSE_FLOOR`) the Trade Org HQ's warehouses keep.
pub const HQ_FLOOR_FACTOR: f64 = 5.0;

/// How many times a trading post's floor of Food the HQ's warehouse keeps, instead of
/// `HQ_FLOOR_FACTOR`: wandering traders alone carry Food to the posts (`CONTEXT.md`: Caravan, Wandering
/// trader) and it spoils on the way, so they leave the HQ with more of it, for the posts far along
/// their loop.
pub const HQ_FOOD_FLOOR_FACTOR: f64 = 15.0;

/// What a warehouse sells a unit of each good for, in coins, when it holds `PRICE_REFERENCE_FLOORS`
/// times its floor (`CONTEXT.md`: Warehouse prices, Price anchor). Roughly what goes into it: an
/// iron is two iron ore and the work, a sword two iron and a wood; gold ore stays below the 10
/// coins the mint strikes from it.
pub const WAREHOUSE_BASE_PRICE: Table<f64> = Table(&[
    ("food", 2.0),
    ("wood", 2.0),
    ("stone", 2.0),
    ("ironOre", 4.0),
    ("iron", 10.0),
    ("goldOre", 8.0),
    ("spear", 20.0),
    ("sword", 30.0),
    ("shield", 22.0),
    ("armour", 90.0),
]);

/// Stock, in floors, at which a warehouse sells at its base price; less stock costs more.
pub const PRICE_REFERENCE_FLOORS: f64 = 4.0;

/// How strongly prices follow stock: the sell price is the base price times (reference stock /
/// stock) to this power, so half the stock costs about 1.4 times as much.
pub const PRICE_ELASTICITY: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceRange {
    pub min: f64,
    pub max: f64,
}

/// The lowest and highest a sell price goes, as shares of the base price.
pub const PRICE_RANGE: PriceRange = PriceRange { min: 0.5, max: 4.0 };

/// The share of its sell price a warehouse pays when it buys (`CONTEXT.md`: Price anchor): it
/// buys low and sells high, so Players usually get better deals trading with each other.
pub const BUY_SHARE: f64 = 0.6;

/// Residents of the Trade Org HQ who walk along with each caravan as its escort, besides its
/// driver (`CONTEXT.md`: Caravan), on a route never robbed.
pub const CARAVAN_ESCORTS: f64 = 2.0;

/// Robberies of a route that earn its caravan one more escort (`CONTEXT.md`: Caravan, a route that
/// is attacked more often gets more escorts): the second robbery adds the first extra escort.
pub const CARAVAN_ROBBERIES_PER_ESCORT: f64 = 2.0;

/// The most escorts a caravan walks with, however often its route was robbed.
pub const CARAVAN_ESCORTS_MAX: f64 = 8.0;

/// Extra Food a caravan keeps on board for each escort beyond `CARAVAN_ESCORTS`, in units: the
/// same ~32 game days of `FOOD_PER_DAY` as `CARAVAN_FOOD`.
pub const CARAVAN_FOOD_PER_ESCORT: f64 = 16.0;

/// How near its carriage, in tiles, a caravan's escort defends it (`CONTEXT.md`: Caravan): they go
/// after robbers and attackers of the crew this close, and give up a chase that leads further.
pub const CARAVAN_GUARD_RANGE: f64 = 16.0;

/// Food a caravan keeps on board for its crew and its horse, in units, topped up at the storage
/// at each end of its route (`CONTEXT.md`: Caravan): a driver, two escorts and a horse eat 2.25 a
/// game day, so this lasts about 32 game days, twice the longest leg on a full-size map (~15).
pub const CARAVAN_FOOD: f64 = 72.0;

/// How much longer than a plain walk a carriage's way to its next stop may take, for the Food it waits
/// for at the HQ (`CONTEXT.md`: Waiting for Food): the escort sets its pace, and its way winds and
/// crosses slower ground. With this a full-size map's longest way, about 4,000 tiles, wants about all
/// of `CARAVAN_FOOD`.
pub const WAY_FOOD_MARGIN: f64 = 1.5;

/// What a carriage leaves in the HQ's storage (`CONTEXT.md`: Waiting for Food), in game days of what
/// its people off the carriages eat. No more than `NPC_FOOD_SHORT_DAYS`, below which the HQ puts
/// residents on its farms first, so the farms always bring the storage up past it.
pub const HQ_PEOPLE_FOOD_DAYS: f64 = 5.0;

/// Food a carriage waiting at the HQ may always hold, even from what the HQ's people are left
/// (`CONTEXT.md`: Waiting for Food), in units: its horse eats only from the load, and this is four
/// game days of it (`HORSE_FOOD_PER_DAY`).
pub const WAITING_HORSE_FOOD: f64 = 3.0;

/// How far under the Food for its way a carriage just set off from the HQ may hold (`CONTEXT.md`:
/// Waiting for Food; ADR 0004), in units: its horse goes on eating while its load goes on.
pub const SET_OFF_FOOD_SLACK: f64 = 2.0;

/// How many tiles further along their way a caravan's driver or an escort may get than the one
/// furthest behind (`CONTEXT.md`: Caravan): one ahead waits, so the escort keeps up with the
/// carriage.
pub const CARAVAN_SPREAD: f64 = 8.0;

/// How many wandering traders the HQ sends out (`CONTEXT.md`: Wandering trader), spread evenly round
/// one loop of all its posts and itself, or one for each post with fewer. A full-size map's loop takes
/// about 150 game days with its stops, so with six a post sees a trader about every 25 game days. They
/// are all that brings a post Food and Coins (ADR 0023): with four, posts far along the loop run out
/// of Food with nobody buying it, as it spoils between visits.
pub const TRADERS: f64 = 6.0;

/// Residents of the Trade Org HQ who walk along with each wandering trader as its escort, besides
/// its driver (`CONTEXT.md`: Wandering trader), before it was ever robbed: a caravan's.
pub const TRADER_ESCORTS: f64 = CARAVAN_ESCORTS;

/// How often a wandering trader's drive to a stop may end short of it before it goes on to the next
/// post (`CONTEXT.md`: Wandering trader), say out of reach of carriages, so one post can't hold up
/// the whole loop.
pub const TRADER_DRIVE_TRIES: f64 = 3.0;

/// How far from the straight way between two of its places a city's town hall may lie for a wandering
/// trader to stop at it on the way (`CONTEXT.md`: Trader stop), in tiles: under half the way between
/// NPC cities (`NPC_CITY_MIN_DISTANCE`), so about one or two stops a way and no long detours.
pub const TRADER_STOP_REACH: f64 = 200.0;

/// How many ticks a wandering trader stands at a stop (`CONTEXT.md`: Trader stop): a game day, long
/// enough for a Player who gets the notice to send someone over.
pub const TRADER_STOP_TICKS: f64 = 1440.0;

/// The share of a warehouse's floor (`WAREHOUSE_FLOOR`) a wandering trader prices each good from
/// (`CONTEXT.md`: Trader stop): a carriage holds far less than a warehouse, so a quarter makes
/// carrying one floor's worth of a good sell at about its base price.
pub const TRADER_FLOOR_SHARE: f64 = 0.25;

/// The part of a delivery's fee every delivery or pick-up pays, in coins (`CONTEXT.md`:
/// Delivery), however light or near.
pub const DELIVERY_FEE_BASE: f64 = 5.0;

/// The part of a delivery's fee that grows with weight and distance, in coins per kg and tile from
/// the warehouse to the city's storage (`CONTEXT.md`: Delivery). 100 kg over 400 tiles, about a
/// trading post's region, costs 50: a tenth of what 100 iron fetch, a lot for cheap Food.
pub const DELIVERY_FEE_PER_KG_TILE: f64 = 0.00125;

/// How often a caravan's drive towards a delivery's storage may end short of it before it turns
/// back (`CONTEXT.md`: Delivery), say behind closed gates or out of reach of carriages.
pub const DELIVERY_DRIVE_TRIES: f64 = 3.0;

/// How many times a delivery's fee a transfer between realms costs, for its weight over the
/// caravan's whole way (`CONTEXT.md`: Transfer): clearly higher, since the Trade Organization
/// carries for others what they could carry themselves. 100 iron over a region and back cost
/// about 300 coins.
pub const TRANSFER_FEE_FACTOR: f64 = 3.0;

/// Large seas the generator makes, roughly; together they cover `TERRAIN_SHARES.sea`.
pub const SEA_COUNT: f64 = 3.0;

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
]);

/// Attack each weapon adds to a resident's blow (`CONTEXT.md`: Weapons and armour, Combat). A
/// sword hits harder than a spear; combat (T10.2) adds it to Strength and Combat skill.
pub const WEAPON_ATTACK: Table<f64> = Table(&[("spear", 4.0), ("sword", 6.0)]);

/// Damage each piece of protection takes off a blow (`CONTEXT.md`: Weapons and armour, Combat).
/// Armour takes off more than a shield but weighs twice as much.
pub const PROTECTION_DEFENCE: Table<f64> = Table(&[("shield", 3.0), ("armour", 5.0)]);

/// Carry capacity of a resident with no Strength at all, in kg.
pub const CARRY_BASE: f64 = 10.0;

/// Carry capacity each point of effective Strength adds, in kg.
pub const CARRY_PER_STRENGTH: f64 = 2.0;

// `stockWeight` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `carryCapacity` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

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

/// Game days a fed resident takes to heal from no health back to full.
pub const HEAL_DAYS: f64 = 3.0;

/// The Endurance at which a resident needs exactly `FOOD_PER_DAY`.
pub const HUNGER_ENDURANCE_AVERAGE: f64 = 10.0;

/// How much less food each point of Endurance above average needs (more below it).
pub const HUNGER_ENDURANCE_EFFECT: f64 = 0.02;

/// The furthest Endurance moves the food a resident needs, either way.
pub const HUNGER_ENDURANCE_LIMIT: f64 = 0.3;

// `hungerFactor` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

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

// `foodUse` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// A city has a food surplus when its storages hold more Food than all its residents eat in this
/// many game days (`CONTEXT.md`: Food surplus). Food residents carry doesn't count.
pub const FOOD_SURPLUS_DAYS: f64 = 10.0;

/// A child's base stats are the parents' average, rounded, plus a whole random amount of at most
/// this much either way (`CONTEXT.md`: Child), and never below 1.
pub const CHILD_STAT_SPREAD: f64 = 2.0;

/// Ticks (real seconds) an unloaded resident of average Agility takes to walk a plains tile
/// (`CONTEXT.md`: Tile). Carriages go at a multiple of this (`CARRIAGE_SPEED`).
pub const WALK_TICKS_PER_TILE: f64 = 7.5;

/// How dear a way may be before a path search gives up on it: this many times the cheapest the
/// way could possibly cost (every step on the cheapest ground), plus `PATH_DETOUR_SLACK`. A goal
/// only behind a longer detour counts as unreachable, so a search for one never crosses the
/// whole map.
pub const PATH_DETOUR_LIMIT: f64 = 8.0;

/// The fixed part of a path search's limit (`PATH_DETOUR_LIMIT`), in plains-tiles on foot.
pub const PATH_DETOUR_SLACK: f64 = 500.0;

/// The Agility at which a resident walks at the usual speed.
pub const AGILITY_AVERAGE: f64 = 10.0;

/// How much faster each point of Agility above average walks (slower below).
pub const AGILITY_SPEED_EFFECT: f64 = 0.02;

/// How much of a terrain's slowdown each point of Agility above average takes away.
pub const AGILITY_TERRAIN_EFFECT: f64 = 0.03;

/// The furthest Agility moves either effect, up or down.
pub const AGILITY_LIMIT: f64 = 0.3;

// `walkSpeed` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Most weight a carriage carries, in kg (`CONTEXT.md`: Carriage): about thirteen residents of
/// average Strength, so one carriage moves what a whole starting city could carry.
pub const CARRIAGE_CAPACITY: f64 = 400.0;

/// Up to this share of `CARRIAGE_CAPACITY` a carriage whose load a Player can't see looks lightly
/// loaded (`CONTEXT.md`: Seeing inside a storage, `loadLevel`).
pub const CARRIAGE_LIGHT_LOAD: f64 = 1.0 / 3.0;

/// Up to this share of `CARRIAGE_CAPACITY` it looks half loaded; above it, heavily.
pub const CARRIAGE_HALF_LOAD: f64 = 2.0 / 3.0;

/// The most one delivery or pick-up carries, in kg (`CONTEXT.md`: Delivery): a caravan's carriage
/// with room left for the Food it keeps on board (`CARAVAN_FOOD`, a kg a unit).
pub const DELIVERY_LOAD: f64 = CARRIAGE_CAPACITY - CARAVAN_FOOD;

/// The horse's share of the Food a haul route keeps on board, in units (`CONTEXT.md`: Haul route,
/// Refilling from a carriage): five game days (two real hours) of the horse's eating, rounded up.
/// The driver refills from the rest of what is kept, never from this.
pub const HAUL_HORSE_FOOD: f64 = ceil(5.0 * HORSE_FOOD_PER_DAY);

/// Food a haul route keeps on board for its horse and its driver unless the Player picks another
/// amount, in units (`CONTEXT.md`: Haul route, Refilling from a carriage): five game days (two
/// real hours) of the horse's eating and the driver's, topped up at each stop that has Food. A trip
/// takes real time, so this keeps its real-time length; rounded up to whole units.
pub const HAUL_KEEP_FOOD: f64 = ceil(5.0 * (HORSE_FOOD_PER_DAY + FOOD_PER_DAY));

/// How fast a carriage crosses each terrain, relative to an unloaded resident of average Agility on
/// Plains (`CONTEXT.md`: Carriage): twice as fast on Plains, a little slower than walking in Forest
/// and Hills, and faster still on a road. Mountains are missing: a carriage enters them only on a
/// road (`Terrain.Road`).
pub const CARRIAGE_SPEED: TerrainTable = TerrainTable(&[
    (Terrain::Plains as u8, 2.0),
    (Terrain::Forest as u8, 0.6),
    (Terrain::Hills as u8, 0.6),
    // A road, whatever the terrain beneath (`CONTEXT.md`: Road): 1.3 times Plains, as on foot.
    (Terrain::Road as u8, 2.6),
]);

/// How much faster a carriage goes for each point of its driver's Driving skill.
pub const DRIVING_SKILL_EFFECT: f64 = 0.02;

/// The furthest Driving skill speeds a carriage up, as a share of its speed.
pub const DRIVING_SKILL_LIMIT: f64 = 0.5;

/// Driving skill a driver of average Intellect gains per game day of driving.
pub const DRIVING_SKILL_PER_DAY: f64 = 1.0;

/// Whether a carriage can enter ground of the given kind (`groundAt`): passable land or a road, but
/// no bare mountains (`carriageCanGoTo`).
pub fn carriage_can_enter(terrain: u8) -> bool {
    CARRIAGE_SPEED.get(terrain).unwrap_or(0.0) > 0.0
}

// `driveSpeed` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// How fast a hungry horse goes under its rider (`HORSE_HUNGRY_SHARE`), as a share of its pace.
pub const HUNGRY_HORSE_PACE: f64 = 0.5;

// `rideSpeed` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `carriageCapacityWith` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// The most any carriage can hold, behind the strongest horse.
pub const CARRIAGE_MAX_CAPACITY: f64 = CARRIAGE_CAPACITY * (1.0 + HORSE_STRENGTH_LIMIT);

/// What each passenger counts for against what a carriage holds, in kg (`CONTEXT.md`: Passenger),
/// grown-up or child: five fit on a carriage behind an average horse, or four with some Food.
pub const PASSENGER_WEIGHT: f64 = 70.0;

/// Most weight a boat carries, in kg (`CONTEXT.md`: Boat): passengers at `PASSENGER_WEIGHT` and
/// goods together, so three residents and a little cargo, or a single rower's worth of goods eight
/// times over. Its rower doesn't count against it.
pub const BOAT_CAPACITY: f64 = 250.0;

/// How fast an average rower moves a boat over water, as a share of walking on Plains
/// (`CONTEXT.md`: Rowing): a little quicker than walking round the shore, so crossing pays off.
pub const ROW_SPEED: f64 = 1.2;

/// How much faster a boat goes for each point of its rower's Strength above
/// `ROW_STRENGTH_AVERAGE`, and slower below it (`CONTEXT.md`: Seafaring: a stronger rower goes
/// faster).
pub const ROW_STRENGTH_EFFECT: f64 = 0.03;

/// The Strength at which a rower moves a boat at `ROW_SPEED`.
pub const ROW_STRENGTH_AVERAGE: f64 = 10.0;

/// The furthest Strength speeds a boat up or slows it down, as a share of its speed.
pub const ROW_STRENGTH_LIMIT: f64 = 0.3;

/// How much faster a boat goes for each point of its rower's Seafaring skill.
pub const SEAFARING_SKILL_EFFECT: f64 = 0.02;

/// The furthest Seafaring speeds a boat up, as a share of its speed: a master rower, half as fast
/// again, as a master driver.
pub const SEAFARING_SKILL_LIMIT: f64 = 0.5;

/// Seafaring a rower of average Intellect gains per game day of rowing, as Driving.
pub const SEAFARING_SKILL_PER_DAY: f64 = 1.0;

// `drivingLearned` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Share of the Food in one place (a storage, a resident's or carriage's load, a pile) that goes
/// bad each game day (`CONTEXT.md`: Spoilage). Half of a stock is gone in about 140 game days.
pub const FOOD_SPOIL_PER_DAY: f64 = 0.005;

/// Events kept in each Player's realm log; the oldest go first. A Player who logs
/// in sees these, so a few game days of a busy realm should fit.
pub const REALM_LOG_LENGTH: f64 = 100.0;

/// How long, in game days, an Organization remembers a crime once it is known and nobody carries
/// news of it any more (`CONTEXT.md`: Crime). About seven real hours: long enough to count as
/// "recent".
pub const CRIME_MEMORY_DAYS: f64 = 18.0;

/// How far standing goes each way from neutral (`CONTEXT.md`: Standing): -100 to +100.
pub const STANDING_RANGE: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrimeStandingLoss {
    pub theft: f64,
    pub attack: f64,
    pub tear_down: f64,
    pub killing: f64,
    /// A trading post captured (`CONTEXT.md`: Lost post found out): worse than any one killing.
    pub capture: f64,
}

/// What a crime costs in the victim's standing toward the culprit's Organization once the victim
/// knows of it (`CONTEXT.md`: Standing). Killing is the worst; a theft is forgiven soonest.
pub const CRIME_STANDING_LOSS: CrimeStandingLoss =
    CrimeStandingLoss { theft: 10.0, attack: 15.0, tear_down: 20.0, killing: 30.0, capture: 50.0 };

/// Coins of trade that raise standing by one point, both ways between the trader's realm and the
/// Trade Organization, or between two realms (`CONTEXT.md`: Standing). About two spears' worth.
pub const STANDING_TRADE_COINS_PER_POINT: f64 = 50.0;

/// Coins of trade that raise standing by one point, both ways between the trader's realm and an NPC
/// city (`CONTEXT.md`: Standing, Trading with an NPC city). A village's surplus grows by about 12
/// coins' worth a game day, so buying half of it and selling back half of that holds about 0.9 points
/// a game day against a drift of `STANDING_DRIFT_PER_DAY`: `PERSUADE_STANDING` in about two real days
/// for a Player who trades there regularly.
pub const STANDING_NPC_TRADE_COINS_PER_POINT: f64 = 10.0;

/// Standing each paid game week of a mercenary contract raises, both ways between its sides.
pub const STANDING_PER_PAID_WEEK: f64 = 0.8;

/// What a contract broken by an unpaid week costs in the lender's standing toward the hirer.
pub const STANDING_CONTRACT_BROKEN_LOSS: f64 = 20.0;

/// Points standing drifts back toward neutral each game day (`CONTEXT.md`: Standing): a killing is
/// forgotten in about 75 game days, a little over a real day.
pub const STANDING_DRIFT_PER_DAY: f64 = 0.4;

/// Below this standing toward an Organization an NPC city won't trade with it or hire out to it
/// and keeps its gates shut to its residents (`CONTEXT.md`: NPC city reaction). A killing known
/// to it, not a single theft or attack.
pub const NPC_CITY_REFUSES_STANDING: f64 = -25.0;

/// Below this standing toward a realm an NPC city won't sell itself to it at all (`CONTEXT.md`:
/// NPC city reaction). Two killings known to it.
pub const NPC_CITY_WONT_SELL_STANDING: f64 = -60.0;

/// How far standing moves an NPC city's price (`CONTEXT.md`: Buying a city): its price times
/// 1 - this × standing / `STANDING_RANGE`, so half price at the best standing and half again as
/// much at the worst.
pub const CITY_PRICE_STANDING_SWING: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcTrade {
    /// Game days of Food for all its residents an NPC city keeps in reserve and never sells: more
    /// than its food surplus line (`FOOD_SURPLUS_DAYS`), so selling never stops it growing.
    pub reserve_food_days: f64,
    /// Stretches of wall whose materials it keeps in reserve, beside a house's (`BUILD_MATERIALS`),
    /// per step of its needs (`npcNeedsScale`): with a house that makes 68 Wood a step.
    pub reserve_wall_stretches: f64,
    /// Stone it keeps in reserve for each step of its needs past the first (`npcNeedsScale`), so a
    /// village keeps none: about a smelter's (`BUILD_MATERIALS`), or a road 40 tiles long.
    pub reserve_stone_per_step: f64,
    /// What it asks for each resident it lends and game week, in coins, at neutral standing: less
    /// than a Trade Org soldier (`TRADE_ORG_ARMY.pricePerSoldierWeek`), as they come mostly unarmed.
    pub price_per_resident_week: f64,
    /// Share of its adults, rounded up, it keeps at home to defend it and never lends.
    pub defence_share: f64,
}

/// Trading with and hiring from an NPC city (`CONTEXT.md`: Trading with / Hiring from an NPC city).
pub const NPC_TRADE: NpcTrade = NpcTrade {
    reserve_food_days: 15.0,
    reserve_wall_stretches: 16.0,
    reserve_stone_per_step: 40.0,
    price_per_resident_week: 5.0,
    defence_share: 0.25,
};

/// The standing an NPC city needs toward a realm before it asks to join it (`CONTEXT.md`:
/// Persuading a city): "high standing", where the standing list starts calling it trusted.
pub const PERSUADE_STANDING: f64 = 50.0;

/// How often, in ticks, an NPC city weighs whether to ask a realm to join (`CONTEXT.md`:
/// Persuading a city): once a game hour (a real minute), so standing and respect aren't counted
/// every tick.
pub const PERSUADE_CHECK_TICKS: f64 = 60.0;

/// Game days an NPC city waits after a realm declined it before it asks that realm again
/// (`CONTEXT.md`: Persuading a city). As long as a remembered crime.
pub const PERSUADE_ASK_AGAIN_DAYS: f64 = 18.0;

/// The standing a self-managed city starts out holding its former Player in (`CONTEXT.md`:
/// Self-managed city): good, and like any standing gone in about 150 game days, two and a half
/// real days.
pub const FORMER_PLAYER_STANDING: f64 = 60.0;

/// Below this standing toward an Organization the Trade Organization refuses to trade with it
/// (`CONTEXT.md`: Trade Org reaction): no buying or selling at its warehouses, no hiring its
/// soldiers, no hiring theirs. Any known crime against it gets there; a theft is forgiven in about
/// 12 game days.
pub const TRADE_ORG_REFUSES_TRADE_BELOW: f64 = -5.0;

/// Below this standing toward an Organization the Trade Organization sends its army to punish it
/// for the crimes against it it knows of (`CONTEXT.md`: Trade Org reaction). Lower than refusing
/// trade, and still above what a single theft costs, since it punishes anyone who steals from it
/// (`CONTEXT.md`: Self-interest).
pub const TRADE_ORG_PUNISHES_BELOW: f64 = -8.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgLoss {
    pub attack: f64,
    pub killing: f64,
    pub tear_down: f64,
    pub capture: f64,
}

/// What a crime costs the Trade Organization in Coins, besides stolen goods, which are worth their
/// warehouse base price (`WAREHOUSE_BASE_PRICE`): a resident wounded, one killed (worth as much as
/// a resident in a city's price, `CITY_PRICE_PER_RESIDENT`), a building torn down, or a trading post
/// captured (what a city of its adults would be priced at).
pub const TRADE_ORG_LOSS: TradeOrgLoss = TradeOrgLoss {
    attack: 50.0,
    killing: CITY_PRICE_PER_RESIDENT,
    tear_down: 150.0,
    capture: CITY_PRICE_PER_RESIDENT * TRADING_POST.residents,
};

/// What a stolen carriage is worth in Coins (`CONTEXT.md`: Stealing a carriage or horse), besides
/// its load: about its materials at their warehouse base price (`BUILD_MATERIALS.carriage`, 110
/// Coins) and two game days of a builder's work.
pub const CARRIAGE_STOLEN_WORTH: f64 = 150.0;

/// What a stolen horse is worth in Coins (`CONTEXT.md`: Stealing a carriage or horse): less than a
/// carriage, as it takes only two horses and a resident's time to breed one.
pub const HORSE_STOLEN_WORTH: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgPunish {
    pub times: f64,
    pub soldiers: f64,
    pub give_up_days: f64,
    /// How much longer a walk takes than the same distance straight over Plains, for the Food packed:
    /// Forest and Hills go at 0.7 of the speed, and the way winds around what can't be crossed.
    pub walk_margin: f64,
    /// Kilos a soldier keeps free as they pack at the HQ, whatever the trip asks for, for what they
    /// will carry home: 150 Coins. Eating on the way there makes more room by the time they take it.
    pub pack_room: f64,
    /// Tiles from a place within which a soldier short of Food counts as passing it and goes to refill
    /// or buy: about a third of a game day's walk, little against what it brings.
    pub post_reach: f64,
    /// Coins a soldier packs at the HQ to buy Food on the way (`CONTEXT.md`: Trade Org debt): the
    /// longest trip's Food at about three Coins a unit, 1.2 kg of their hands. What is left goes back
    /// into the HQ's coin warehouse when they are home.
    pub purse: f64,
    /// The most Coins a soldier pays for a unit of Food at a Player's offer: three times what a
    /// warehouse asks at its usual stock. Above that they pass it by, or an offer of one Food at any
    /// price would empty their purse.
    pub offer_food_price: f64,
    /// How many times the straight walk over Plains it keeps trying to reach the city (never less
    /// than `giveUpDays`). Past that it has no way there, as with every gate shut, and turns back.
    pub road_times: f64,
    /// Kilos its supply wagon keeps free of Food, whatever the trip asks for, for what the army takes
    /// (`CONTEXT.md`: Trade Org debt): a quarter of a carriage, 5,000 Coins or 100 Iron.
    pub wagon_room: f64,
    /// Tiles from its supply wagon within which a soldier carries what they took over to it, rather
    /// than on home: as far as they would go for a trading post (`postReach`).
    pub wagon_reach: f64,
    /// Ticks between a supply wagon's tries to set off after its army: only a failed search for a way
    /// tries again, and these keep a wagon with no way from searching every tick.
    pub wagon_retry_ticks: f64,
    /// Tiles from its army within which a supply wagon goes after them step by step, finding its way
    /// again as they move. Further behind it first drives to where they were: a search that far takes
    /// longer than they take to move on, so it would never end.
    pub wagon_follow_reach: f64,
}

/// How the Trade Organization's army punishes (`CONTEXT.md`: Trade Org reaction): it takes back
/// `times` what it lost, sends at most `soldiers` of its spare soldiers, and gives up and goes
/// home after `giveUpDays` game days at the city, from when it arrived (`CONTEXT.md`: Punishment
/// trip), if it can't get it all.
pub const TRADE_ORG_PUNISH: TradeOrgPunish = TradeOrgPunish {
    times: 2.0,
    soldiers: 8.0,
    give_up_days: 12.0,
    walk_margin: 1.4,
    pack_room: 3.0,
    post_reach: 60.0,
    purse: 60.0,
    offer_food_price: 6.0,
    road_times: 3.0,
    wagon_room: 100.0,
    wagon_reach: 60.0,
    wagon_retry_ticks: 60.0,
    wagon_follow_reach: 48.0,
};

/// Food for a walk of `tiles` on a punishment trip (`CONTEXT.md`: Punishment trip), in whole units:
/// at `FOOD_PER_DAY`, the walk taking `TRADE_ORG_PUNISH.walkMargin` times the straight way over
/// Plains.
pub fn trip_food(tiles: f64) -> f64 {
    let days = (tiles * WALK_TICKS_PER_TILE * TRADE_ORG_PUNISH.walk_margin) / TICKS_PER_GAME_DAY;
    (days * FOOD_PER_DAY).ceil()
}

/// The Food a supply wagon means to set out with (`CONTEXT.md`: Trade Org debt), for `soldiers` going
/// `tiles` there and back as much: all of the trip's for each of them, as they may pack little, for
/// its driver and for its horse. A carriage takes it only as far as it keeps
/// `TRADE_ORG_PUNISH.wagonRoom` free.
pub fn wagon_food_for(tiles: f64, soldiers: f64) -> f64 {
    let walk = trip_food(2.0 * tiles);
    let stay = TRADE_ORG_PUNISH.give_up_days * FOOD_PER_DAY;
    let horse = ((walk + stay) / FOOD_PER_DAY) * HORSE_FOOD_PER_DAY;
    ((soldiers + 1.0) * (walk + stay) + horse).ceil()
}

/// What the Trade Organization's army comes to take, in Coins' worth, each time it goes out against
/// the target of an admin directive (`CONTEXT.md`: Admin directive), which names no crimes to weigh
/// it by: as much as it takes back for a killing (`TRADE_ORG_PUNISH.times` its loss). It goes again
/// as soon as one punishment is over, until the directive is lifted.
pub const DIRECTIVE_PUNISH_WORTH: f64 = TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing;

/// The price, in Coins, the admin panel offers for buying off an admin directive (`CONTEXT.md`:
/// Admin directive) when an admin allows it; they may set another. About a couple of punishments'
/// worth (`DIRECTIVE_PUNISH_WORTH`), and 30 kg of coins: an average resident's hands or a carriage
/// can bring it.
pub const DIRECTIVE_BUY_OFF_PRICE: f64 = 1500.0;

/// Materials each kind of building needs before its construction site can become the building
/// (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
/// the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
/// the smelter's iron goes into the mint and the smithy.
pub const BUILD_MATERIALS: Table<Table<f64>> = Table(&[
    ("lumberCamp", Table(&[])),
    ("quarry", Table(&[("wood", 30.0)])),
    ("mine", Table(&[("wood", 40.0), ("stone", 20.0)])),
    ("stable", Table(&[("wood", 40.0)])),
    ("smelter", Table(&[("stone", 40.0), ("wood", 20.0)])),
    ("mint", Table(&[("stone", 40.0), ("iron", 10.0)])),
    ("smithy", Table(&[("stone", 30.0), ("wood", 20.0), ("iron", 10.0)])),
    ("townHall", Table(&[("wood", 60.0), ("stone", 40.0)])),
    // A tile of wall: about a quarter of what a 40 m stretch took.
    ("wall", Table(&[("wood", 3.0)])),
    // A gate, of a wall's tile.
    ("gate", Table(&[("wood", 4.0)])),
    // A tile of road (`CONTEXT.md`: Road): a little Stone, so a quarry pays for a long road; about a
    // quarter of what a 40 m tile took.
    ("road", Table(&[("stone", 1.0)])),
    // A house (`CONTEXT.md`: House): timber for four residents' room.
    ("house", Table(&[("wood", 20.0)])),
    // A storage (`CONTEXT.md`: Storage): a timber store on a stone floor, a little more than a house.
    ("storage", Table(&[("wood", 30.0), ("stone", 10.0)])),
    // A farm is fields on Plains: work, but no materials, so a city can always feed itself.
    ("farm", Table(&[])),
    // A training ground (`CONTEXT.md`: Training ground): a fenced yard with posts and racks on a
    // few paving stones, so mostly Wood and a little Stone, no iron; a bit more timber than a
    // stable, and buildable before any smelter.
    ("trainingGround", Table(&[("wood", 50.0), ("stone", 10.0)])),
    // A haven (`CONTEXT.md`: Haven): timber jetties and slipways on stone footings at the shore, so
    // mostly Wood and some Stone; a little more timber than a town hall, which covers as much.
    ("haven", Table(&[("wood", 70.0), ("stone", 20.0)])),
    // A carriage, built at a stable (`CONTEXT.md`: Carriage): a wooden cart with iron fittings, so a
    // realm needs a smelter's iron for its second carriage.
    ("carriage", Table(&[("wood", 30.0), ("iron", 5.0)])),
    // A boat, built at a haven (`CONTEXT.md`: Building a boat): planks, a thwart and oars, pegged
    // rather than nailed, so all Wood and buildable before any smelter; two thirds of a carriage's
    // timber.
    ("boat", Table(&[("wood", 20.0)])),
]);

/// Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
/// lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
/// a mint 5, a smithy 5, a town hall 6, a training ground 3 (about a stable), a haven 4. A tile of wooden
/// wall takes a sixteenth of a game day, a gate an eighth, a tile of road a sixteenth (a quarter of
/// what a 40 m tile took), a house one game day, a storage two and a farm half of one; a carriage
/// two, a boat one. More or stronger workers finish it sooner (`buildWork`).
pub const BUILD_WORK: Table<f64> = Table(&[
    ("lumberCamp", 2.0 * TICKS_PER_GAME_DAY),
    ("quarry", 3.0 * TICKS_PER_GAME_DAY),
    ("mine", 4.0 * TICKS_PER_GAME_DAY),
    ("stable", 3.0 * TICKS_PER_GAME_DAY),
    ("smelter", 4.0 * TICKS_PER_GAME_DAY),
    ("mint", 5.0 * TICKS_PER_GAME_DAY),
    ("smithy", 5.0 * TICKS_PER_GAME_DAY),
    ("townHall", 6.0 * TICKS_PER_GAME_DAY),
    ("wall", TICKS_PER_GAME_DAY / 16.0),
    ("gate", TICKS_PER_GAME_DAY / 8.0),
    ("road", TICKS_PER_GAME_DAY / 16.0),
    ("house", TICKS_PER_GAME_DAY),
    ("storage", 2.0 * TICKS_PER_GAME_DAY),
    ("farm", TICKS_PER_GAME_DAY / 2.0),
    ("trainingGround", 3.0 * TICKS_PER_GAME_DAY),
    ("haven", 4.0 * TICKS_PER_GAME_DAY),
    ("carriage", 2.0 * TICKS_PER_GAME_DAY),
    ("boat", TICKS_PER_GAME_DAY),
]);

/// How many times `BUILD_WORK.road` a road tile on Mountain takes (`CONTEXT.md`: Road): the same
/// materials, but building goes at a quarter of the usual speed.
pub const MOUNTAIN_ROAD_WORK_FACTOR: f64 = 4.0;

/// The most tiles one road order along a line may cover (`roadLine`): about a game week of one
/// resident's work, so a long road is a few orders rather than one that runs for months.
pub const ROAD_LINE_MAX_TILES: f64 = 128.0;

/// The Strength at which a resident puts in one unit of building work per tick.
pub const BUILD_STRENGTH_AVERAGE: f64 = 10.0;

/// How much more work each point of Construction skill puts in per tick: 1 % a point.
pub const CONSTRUCTION_SKILL_EFFECT: f64 = 0.01;

/// The furthest Construction skill speeds building work up, as a share of it: +100 %, reached at
/// `CONSTRUCTION_SKILL_MAX` points, beyond which nobody learns.
pub const CONSTRUCTION_SKILL_LIMIT: f64 = 1.0;

/// The most Construction skill a resident can have: where it reaches `CONSTRUCTION_SKILL_LIMIT`.
pub const CONSTRUCTION_SKILL_MAX: f64 = CONSTRUCTION_SKILL_LIMIT / CONSTRUCTION_SKILL_EFFECT;

/// Construction skill a resident of average Intellect gains per game day of building work: the
/// cap takes about a game year (one real week).
pub const CONSTRUCTION_SKILL_PER_DAY: f64 = 100.0 / 420.0;

/// The Intellect at which a resident learns at the usual pace (`CONTEXT.md`: Stats).
pub const INTELLECT_AVERAGE: f64 = 10.0;

// `buildWork` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `constructionLearned` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Most residents who can work each kind of workplace at a time (`CONTEXT.md`: Workplace). A farm
/// has room for a whole starting city; the workplaces on nodes for a smaller crew; smelters,
/// mints and smithies for a few.
pub const WORKPLACE_MAX_WORKERS: Table<f64> = Table(&[
    ("farm", 10.0),
    ("lumberCamp", 6.0),
    ("quarry", 6.0),
    ("mine", 8.0),
    ("smelter", 4.0),
    ("mint", 4.0),
    ("smithy", 4.0),
]);

/// What each kind of workplace counts for against a debt when the Trade Organization's army tears it
/// down (`CONTEXT.md`: Trade Org debt), in Coins: about twice its materials at their warehouse base
/// price and 20 Coins for each game day of a builder's work (as `CARRIAGE_STOLEN_WORTH` weighs a
/// carriage), and never less than 200, as a farm or lumber camp is cheap to build but worth more than
/// that to a city. So a debt for a killing (`TRADE_ORG_LOSS`, twice) takes about two to four workplaces.
pub const WORKPLACE_WRECK_WORTH: Table<f64> = Table(&[
    ("farm", 200.0),
    ("lumberCamp", 200.0),
    ("quarry", 240.0),
    ("mine", 400.0),
    ("smelter", 400.0),
    ("mint", 560.0),
    ("smithy", 600.0),
]);

/// The skill each kind of workplace uses and teaches (`CONTEXT.md`: Skill): Farming on a farm,
/// Woodcutting in a lumber camp, Mining in quarries and mines, Smelting in smelters and mints,
/// Smithing in a smithy.
pub const WORKPLACE_SKILL: Table<&str> = Table(&[
    ("farm", "farming"),
    ("lumberCamp", "woodcutting"),
    ("quarry", "mining"),
    ("mine", "mining"),
    ("smelter", "smelting"),
    ("mint", "smelting"),
    ("smithy", "smithing"),
]);

/// What a workplace that processes goods turns into what, one batch at a time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Recipe {
    /// Goods one batch uses up.
    pub input: Table<f64>,
    /// Goods one batch makes.
    pub output: Table<f64>,
}

/// The fixed recipes of the workplaces that process goods (`CONTEXT.md`: Smelter, Coins, Smithy).
/// A smelter turns 2 iron ore into 1 iron, a mint 1 gold ore into 10 coins (less weight than the
/// ore, but a fortune still weighs something). A smithy has one recipe for each weapon and piece
/// of armour, each from Iron and Wood weighing what the good weighs (`GOOD_WEIGHT`): a spear is
/// mostly wood, a sword mostly iron, a shield wood bound with iron, armour nearly all iron.
pub const RECIPES: Table<&[Recipe]> = Table(&[
    ("smelter", &[Recipe { input: Table(&[("ironOre", 2.0)]), output: Table(&[("iron", 1.0)]) }]),
    ("mint", &[Recipe { input: Table(&[("goldOre", 1.0)]), output: Table(&[("coins", 10.0)]) }]),
    (
        "smithy",
        &[
            Recipe {
                input: Table(&[("iron", 1.0), ("wood", 2.0)]),
                output: Table(&[("spear", 1.0)]),
            },
            Recipe {
                input: Table(&[("iron", 2.0), ("wood", 1.0)]),
                output: Table(&[("sword", 1.0)]),
            },
            Recipe {
                input: Table(&[("iron", 1.0), ("wood", 3.0)]),
                output: Table(&[("shield", 1.0)]),
            },
            Recipe {
                input: Table(&[("iron", 7.0), ("wood", 1.0)]),
                output: Table(&[("armour", 1.0)]),
            },
        ],
    ),
]);

/// Batches one worker of average Strength and no skill gets through per game day: a smelter worker
/// smelts what two miners dig (4 iron ore into 2 iron), a mint worker strikes what two gold miners
/// dig (2 gold ore into 20 coins), a smithy worker makes two weapons or pieces of armour.
pub const BATCHES_PER_DAY: Table<f64> = Table(&[("smelter", 2.0), ("mint", 2.0), ("smithy", 2.0)]);

/// Units of each good one worker of average Strength and no skill makes per game day. Food is four
/// times the `FOOD_PER_DAY` a resident eats, so about a quarter of a city farms; ore is slow, and
/// gold ore slowest.
pub const WORK_OUTPUT_PER_DAY: Table<f64> =
    Table(&[("food", 2.0), ("wood", 4.0), ("stone", 3.0), ("ironOre", 2.0), ("goldOre", 1.0)]);

/// The Strength at which a worker makes `WORK_OUTPUT_PER_DAY`.
pub const WORK_STRENGTH_AVERAGE: f64 = 10.0;

/// How much more each point of the workplace's skill makes: 1 % a point.
pub const WORK_SKILL_EFFECT: f64 = 0.01;

/// The furthest a workplace's skill raises output, as a share of it: +100 %, so a worker makes at
/// most twice what an unskilled one does, reached at `WORK_SKILL_MAX` points.
pub const WORK_SKILL_LIMIT: f64 = 1.0;

/// The most of a workplace's skill a resident can have: where it reaches `WORK_SKILL_LIMIT`.
pub const WORK_SKILL_MAX: f64 = WORK_SKILL_LIMIT / WORK_SKILL_EFFECT;

/// Skill a worker of average Intellect gains per game day of work at a workplace: the cap takes
/// about a game year (one real week).
pub const WORK_SKILL_PER_DAY: f64 = 100.0 / 420.0;

// `workOutput` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `batchWork` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `madePerDay` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `workPace` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `workLearned` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Tearing down takes less work than building (`CONTEXT.md`: Tearing down): this share of the
/// building's `BUILD_WORK`, or of the work put into an unfinished site so far.
pub const TEARDOWN_WORK_SHARE: f64 = 0.5;

/// Share of a finished building's materials left in its pile when it is torn down, rounded down
/// to whole units. An unfinished site leaves all its delivered materials.
pub const TEARDOWN_MATERIALS_RETURNED: f64 = 0.5;

/// How long after a realm says it leaves an alliance, or the alliance leader removes it, it stops
/// being a member (`CONTEXT.md`: Alliance): one real hour, time enough for the others to react.
pub const ALLIANCE_LEAVE_DELAY: f64 = 3600.0;

/// How long after its owner recalls a soldier or carriage from the alliance army it is theirs to
/// command again (`CONTEXT.md`: Alliance army): one real hour.
pub const ALLIANCE_RECALL_DELAY: f64 = 3600.0;

/// The standing an NPC city must hold toward every member of an alliance to accept its
/// invitation (`CONTEXT.md`: NPC city in an alliance): half the way to the best. Some 25
/// paid contract weeks, or a lot of trade, earn it from neutral.
pub const NPC_ALLIANCE_JOIN_STANDING: f64 = 50.0;

/// The standing toward a member below which an NPC city leaves its alliance on its own
/// (`CONTEXT.md`: NPC city in an alliance): a theft and an attack from neutral, so standing merely
/// drifting back to neutral never makes it go.
pub const NPC_ALLIANCE_LEAVE_STANDING: f64 = -20.0;

/// Control a city projects before counting anyone in it (`CONTEXT.md`: Territory), so even an
/// empty city holds the ground it stands on.
pub const TERRITORY_CITY_BASE: f64 = 5.0;

/// Control a guarded workplace projects before counting its workers and guards.
pub const TERRITORY_WORKPLACE_BASE: f64 = 2.0;

/// Control each resident adds: of a city, one living there; of a workplace, one working it.
pub const TERRITORY_PER_RESIDENT: f64 = 1.0;

/// Control each armed resident adds on top: of a city, one living there and standing in its area
/// (its garrison); of a workplace, one of its holder's guarding it. Soldiers count most.
pub const TERRITORY_PER_ARMED: f64 = 3.0;

/// How far control reaches, in tiles, per square root of its strength: a city of 5 control reaches
/// 17 tiles, one of 30 forty-three, one of 100 eighty.
pub const TERRITORY_REACH_PER_ROOT: f64 = 8.0;

/// The farthest any one city or workplace projects control, in tiles.
pub const TERRITORY_MAX_REACH: f64 = 96.0;

/// Ticks between two blows of a resident in a fight (`CONTEXT.md`: Combat): a blow every two
/// seconds, so a fight between two unarmed residents lasts about a minute.
pub const STRIKE_TICKS: f64 = 2.0;

/// Damage a blow does before Strength, weapon and Combat skill: a little even from the weakest.
pub const BLOW_BASE: f64 = 1.0;

/// Damage each point of Strength adds to a blow: an average resident's fist does 4.
pub const BLOW_PER_STRENGTH: f64 = 0.3;

/// How much harder each point of Combat skill makes a blow, as a share of it.
pub const COMBAT_SKILL_EFFECT: f64 = 0.05;

/// The furthest Combat skill raises a blow, as a share of it: at most twice as hard.
pub const COMBAT_SKILL_LIMIT: f64 = 1.0;

/// The least damage a blow that lands does, however well the one hit is protected.
pub const MIN_BLOW_DAMAGE: f64 = 1.0;

/// What a blow that lands does to a defender standing on their own city's wall, as a share of its
/// damage (`CONTEXT.md`: Walls in combat): a quarter, so a wall's defenders hold out four times
/// as long.
pub const WALL_DEFENCE: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallStrength {
    pub wall: f64,
    pub gate: f64,
}

/// Damage a wall or gate takes from blows before it falls (`CONTEXT.md`: Walls in combat,
/// broken). An average unarmed resident (4 a blow, one blow every `STRIKE_TICKS`) breaks a stretch
/// of wall alone in about five minutes; ten soldiers with swords in well under one. A gate holds
/// out half as long again.
pub const WALL_STRENGTH: WallStrength = WallStrength { wall: 600.0, gate: 900.0 };

/// Share of a broken wall's or gate's materials left on its tile, rounded down to whole units:
/// less than tearing it down leaves (`TEARDOWN_MATERIALS_RETURNED`), as much of it is splintered;
/// enough that a tile of wall leaves a unit of Wood.
pub const BROKEN_MATERIALS_RETURNED: f64 = 0.34;

/// Ticks it takes to climb over a wall or gate (`CONTEXT.md`: Walls in combat, climbed): a
/// minute, as long as walking eight tiles of plains, all the while unable to dodge or strike back.
pub const CLIMB_TICKS: f64 = 60.0;

/// Chance of dodging a blow for each point of Agility: an average resident dodges one in five.
pub const DODGE_PER_AGILITY: f64 = 0.02;

/// However agile a resident is, they dodge at most this share of blows.
pub const DODGE_LIMIT: f64 = 0.5;

/// Combat skill a resident of average Intellect learns from each blow they strike or that is
/// struck at them (`CONTEXT.md`: Combat, fighting teaches Combat): a point every 50 blows.
pub const COMBAT_SKILL_PER_BLOW: f64 = 0.02;

// `bestWeapon` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `isArmed` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `protection` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `attackPower` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `blowDamage` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `dodgeChance` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `combatLearned` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// Most trainees at one training ground at a time (`CONTEXT.md`: Trainee).
pub const TRAINING_GROUND_MAX_TRAINEES: f64 = 6.0;

/// Trained bonus a trainee of average Intellect gains in a stat each tick a teacher is there
/// (`CONTEXT.md`: Training): an average base of 10 reaches its cap of 5 in half a game year.
pub const TRAIN_STAT_PER_TICK: f64 = 5.0 / (TICKS_PER_GAME_YEAR / 2.0);

/// How much faster training a work skill, Construction or Driving goes than learning it by doing
/// (`CONTEXT.md`: Training). Fast enough that training first and then working has made more by the
/// end of a game year than learning at the job, the teacher's lost work counted.
pub const TRAIN_SKILL_FACTOR: f64 = 6.0;

/// How much faster training Combat goes than its game year in `SKILL_PER_DAY`, half a game year to
/// its maximum. Slower than `TRAIN_SKILL_FACTOR`: it doubles a blow and has no output to give up.
pub const TRAIN_COMBAT_FACTOR: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValues {
    pub mining: f64,
    pub woodcutting: f64,
    pub smelting: f64,
    pub smithing: f64,
    pub farming: f64,
    pub construction: f64,
    pub combat: f64,
    pub driving: f64,
    pub seafaring: f64,
}

/// The most of each skill a resident can have (`CONTEXT.md`: Skill): where it stops making them
/// better. Training never takes a skill past it.
pub const SKILL_MAX: SkillValues = SkillValues {
    mining: WORK_SKILL_MAX,
    woodcutting: WORK_SKILL_MAX,
    smelting: WORK_SKILL_MAX,
    smithing: WORK_SKILL_MAX,
    farming: WORK_SKILL_MAX,
    construction: CONSTRUCTION_SKILL_MAX,
    combat: COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT,
    driving: DRIVING_SKILL_LIMIT / DRIVING_SKILL_EFFECT,
    seafaring: SEAFARING_SKILL_LIMIT / SEAFARING_SKILL_EFFECT,
};

/// Each skill learned by doing, in points per game day for a learner of average Intellect. Combat
/// is learned by blows rather than days; for training it counts as reaching its maximum in a game
/// year, as the work skills do.
pub const SKILL_PER_DAY: SkillValues = SkillValues {
    mining: WORK_SKILL_PER_DAY,
    woodcutting: WORK_SKILL_PER_DAY,
    smelting: WORK_SKILL_PER_DAY,
    smithing: WORK_SKILL_PER_DAY,
    farming: WORK_SKILL_PER_DAY,
    construction: CONSTRUCTION_SKILL_PER_DAY,
    combat: SKILL_MAX.combat / (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY),
    driving: DRIVING_SKILL_PER_DAY,
    seafaring: SEAFARING_SKILL_PER_DAY,
};

// `trainingGain` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `subjectValue` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

// `trainingCeiling` takes a world type (`Resident`, `Horse` or `Stock`): it is ported with the world types, in `csp-sim`.

/// How many tiles further along an army's way a member may get than the one furthest behind
/// (`CONTEXT.md`: Army): one ahead waits, so the army keeps together at the pace of the slowest.
pub const ARMY_SPREAD: f64 = 4.0;

/// The longest a mercenary contract may run, in game days (`CONTEXT.md`: Mercenary contract): two
/// real days, so a contract is a campaign, not a permanent transfer of residents.
pub const CONTRACT_MAX_DAYS: f64 = 120.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgArmy {
    /// Soldiers the HQ arms from its own adults: half of the residents it starts with.
    pub size: f64,
    /// Adults the HQ keeps at work and never arms: its farms, workplaces and some spare.
    pub workers: f64,
    /// Soldiers that always stay at the HQ: it never hires out more than the rest.
    pub guard: f64,
    /// What it asks for each soldier and game week, in coins: about a spear's price each seven real hours.
    pub price_per_soldier_week: f64,
    /// It has lost too many once its soldiers, the adults it could still arm and its mercenaries
    /// are fewer than this share of `size`.
    pub hire_below: f64,
    /// What it offers for each mercenary and game week, in coins: less than it asks itself.
    pub hire_price_per_soldier_week: f64,
    /// How long it hires mercenaries for, in game days: 14 real hours.
    pub hire_days: f64,
    /// The HQ keeps at least this many times the strongest Organization's armed residents as
    /// soldiers (`CONTEXT.md`: Trade Org HQ), and `size` at the least: a little more than any
    /// Player can bring.
    pub strongest_multiple: f64,
    /// The HQ closes its outer gates while more armed outsiders than this share of its soldiers at
    /// home stand near it (`CONTEXT.md`: Trade Org HQ): half, so it can still drive them off.
    pub gate_share: f64,
    /// How near to one of the HQ's outer gates, in tiles, an armed outsider counts as near it, as
    /// well as anywhere in its area: as for an NPC city (`NPC_GATE_WATCH_RANGE`).
    pub gate_watch_range: f64,
}

/// The Trade Org army (`CONTEXT.md`: Trade Org army).
pub const TRADE_ORG_ARMY: TradeOrgArmy = TradeOrgArmy {
    size: 16.0,
    workers: 12.0,
    guard: 8.0,
    price_per_soldier_week: 8.0,
    hire_below: 0.6,
    hire_price_per_soldier_week: 5.0,
    hire_days: 35.0,
    strongest_multiple: 1.5,
    gate_share: 0.5,
    gate_watch_range: 32.0,
};

/// How many interpreter steps one resident's or army's script may use each tick (`CONTEXT.md`:
/// Step budget). Every evaluated node costs 1; enough for a few loops over what it sees.
pub const SCRIPT_STEP_BUDGET: f64 = 2000.0;

/// How deeply a script's own function calls may nest before the run stops with an error.
pub const SCRIPT_MAX_CALL_DEPTH: f64 = 50.0;

/// The longest string a script may build, in characters (`CONTEXT.md`: Value limits): as much as
/// its whole memory holds (`SCRIPT_MEMORY_MAX`), so no one string outgrows it. Past the cap the
/// script stops with a runtime error.
pub const SCRIPT_MAX_STRING_LENGTH: f64 = 4000.0;

/// The most items a list a script builds may hold (`CONTEXT.md`: Value limits): more than a large
/// realm has residents and buildings in sight, so a script can collect all it sees in one list.
pub const SCRIPT_MAX_LIST_LENGTH: f64 = 500.0;

/// The most keys an object a script builds may hold (`CONTEXT.md`: Value limits): plenty for a
/// memory keyed by id or tile, far fewer than the memory could hold anyway.
pub const SCRIPT_MAX_OBJECT_KEYS: f64 = 200.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptValueLimits {
    pub max_string_length: f64,
    pub max_list_length: f64,
    pub max_object_keys: f64,
}

/// The three together, in the shape the interpreter's `run` takes (`ValueLimits` in `@csp/lang`).
pub const SCRIPT_VALUE_LIMITS: ScriptValueLimits = ScriptValueLimits {
    max_string_length: SCRIPT_MAX_STRING_LENGTH,
    max_list_length: SCRIPT_MAX_LIST_LENGTH,
    max_object_keys: SCRIPT_MAX_OBJECT_KEYS,
};

/// Extra steps a script pays to ask the world something it sees as a list (`residents()`,
/// `buildings()`, `nodes()`, …), on top of the 1 every evaluated node costs (`CONTEXT.md`: Step
/// budget). Dear enough that a script keeps what it found in a variable rather than asking again.
pub const SCRIPT_LIST_QUERY_COST: f64 = 20.0;

/// Extra steps for a small query about one tile or two things, such as `terrainAt` or `distance`.
pub const SCRIPT_TILE_QUERY_COST: f64 = 1.0;

/// Extra steps for a helper that only works on what it is given: `floor`, `pickRandom`.
pub const SCRIPT_HELPER_COST: f64 = 1.0;

/// Extra steps a script pays to request an action (`walkTo`, `pickUp`, …), accepted or not.
pub const SCRIPT_ACTION_COST: f64 = 10.0;

/// How many interpreter steps all of a realm's running scripts may use together each tick
/// (`CONTEXT.md`: Step budget): ten residents at their full `SCRIPT_STEP_BUDGET`. When it runs
/// out, the rest skip the tick; who goes first rotates, so the same ones don't always skip.
pub const SCRIPT_REALM_STEP_BUDGET: f64 = 20000.0;

/// The most a running script's memory may hold, in characters of its JSON (`CONTEXT.md`:
/// Memory). Enough for a role, a few tiles and ids; a run that leaves more keeps the old memory.
pub const SCRIPT_MEMORY_MAX: f64 = 4000.0;

/// The most a value a script passes to an action or `withMemory` may hold, in characters of its
/// JSON: as much as its memory, so anything a script keeps it can also pass. Script values are
/// shared by reference, so one built in a few steps can stand for far more than this; the check
/// gives up as soon as it passes the limit and the call fails with a runtime error.
pub const SCRIPT_ACTION_VALUE_MAX: f64 = SCRIPT_MEMORY_MAX;

/// The longest text a script can give `doing()` for its resident's Doing line (`CONTEXT.md`:
/// Doing), in characters after trimming; longer text is cut. One line of the resident card.
pub const DOING_MAX_LENGTH: f64 = 60.0;

/// The lines a resident's script log keeps (`CONTEXT.md`: Script log); once full, the oldest
/// goes. Enough to follow a few minutes of a script logging its turns.
pub const SCRIPT_LOG_LINES: f64 = 20.0;

/// Ticks between two realm-log entries about the same resident's script going wrong (an error,
/// or running out of steps), so a script failing every tick doesn't flood the log. A minute.
pub const SCRIPT_LOG_INTERVAL: f64 = 60.0;

/// The most scripts a Player's library holds (`CONTEXT.md`: Library cap), their default scripts
/// among them; a new script past it is refused until one is deleted. A few dozen: room for a
/// script per task and plenty of experiments, too few to grow the database without bound.
pub const SCRIPT_LIBRARY_MAX_SCRIPTS: f64 = 40.0;

/// The most versions one script keeps (`CONTEXT.md`: Library cap); a save or reset past it is
/// refused until old versions are deleted. A few dozen saves of history to go back to.
pub const SCRIPT_MAX_VERSIONS: f64 = 40.0;

/// Script library writes (create, save, rename, activate, reset, delete) one Player may make in a
/// minute before the server answers 429. One a second: far more than anyone saves by hand, so
/// only a script hammering the API ever meets it.
pub const SCRIPT_WRITES_PER_MINUTE: f64 = 60.0;

/// The most steps a queue holds (`CONTEXT.md`: Queue, Repeat block): a day's round, or a few steps
/// repeated ten times over. With `QUEUE_STEP_MAX_CHARS` a full queue still fits the socket's
/// largest frame (`realtime.maxPayloadBytes`).
pub const QUEUE_MAX_STEPS: f64 = 50.0;

/// The most a queue step's order request may hold, in characters of its JSON.
pub const QUEUE_STEP_MAX_CHARS: f64 = 1000.0;

/// The duration, in game minutes, the card gives a step that never ends on its own (work, haul)
/// once another step is put after it without one: a game hour, a real minute.
pub const QUEUE_DEFAULT_STEP_MINUTES: f64 = 60.0;

/// The longest realm name a Player may give, in characters after trimming (`CONTEXT.md`: Realm name).
pub const REALM_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a resident, the Leader included, in characters after trimming.
pub const RESIDENT_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a city of their realm, in characters after trimming.
pub const CITY_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a horse of their realm, in characters after trimming (`CONTEXT.md`: Renaming a horse).
pub const HORSE_NAME_MAX_LENGTH: f64 = 30.0;

/// The longest name a Player may give a waypoint, in characters after trimming (`CONTEXT.md`: Waypoint).
pub const WAYPOINT_NAME_MAX_LENGTH: f64 = 30.0;

/// The most waypoints a Player holds (`CONTEXT.md`: Waypoint): enough to mark passes, nodes and
/// meeting points across a wide realm, few enough that the drawer and the map stay readable.
pub const WAYPOINTS_MAX: f64 = 50.0;

/// The Food an explorer keeps beyond what the way back needs (`CONTEXT.md`: Explore), in units:
/// they turn back once the Food on them, a rider's horse's included, covers no more than the way
/// back plus this. Their own food (`OWN_FOOD`) and a unit more: a horse eats only what its rider
/// carries beyond their own food, so it eats all the way home, and an estimate a little short of
/// the real way still gets them there.
pub const EXPLORE_FOOD_MARGIN: f64 = OWN_FOOD + 1.0;

/// How far around a place the edge of a Player's explored terrain is looked for (`exploredEdge`),
/// in tiles along each direction. Sight reaches `SIGHT_RANGE`, so an explorer finds the edge well
/// inside it; this only bounds the search where none is near.
pub const EXPLORED_EDGE_RANGE: f64 = 4.0 * SIGHT_RANGE;

/// How near a tile the Explore default found no way to it may lie and still be left out of the
/// edge it looks for next (`exploredEdge`'s `skip`), in tiles: the far shore of a lake goes along
/// with the tile it tried.
pub const EXPLORE_SKIP_RANGE: f64 = 8.0;

/// The longest note a demand may carry, in characters (`CONTEXT.md`: Demand): a few sentences, as
/// "give the city back or we attack" takes, and few enough to keep them cheap to store and show.
pub const DEMAND_NOTE_MAX_LENGTH: f64 = 280.0;

/// How many demands a realm may send in any one game day (`CONTEXT.md`: Demand): about seven a
/// real hour, plenty for a war and little for spam. Scripts count too.
pub const DEMANDS_PER_GAME_DAY: f64 = 3.0;

/// The longest deadline a demand may set, in game days (`CONTEXT.md`: Demand): one real day, so a
/// Player who comes by once a day can still answer.
pub const DEMAND_MAX_DAYS: f64 = 60.0;

/// The deadline of the Trade Organization's demand for a debt, in game days (`CONTEXT.md`: Trade Org
/// debt): one real day, the longest a demand has, so a Player who comes by once a day can still pay.
pub const TRADE_ORG_DEBT_DEMAND_DAYS: f64 = 60.0;

/// How many of the Trade Organization's armies come to tear down workplaces for a debt before its next
/// one comes to hold the town hall and take the city (`CONTEXT.md`: Trade Org debt): two, so a Player
/// who loses workplaces once and again still has time to pay before it comes to that.
pub const TRADE_ORG_DEBT_TRIPS: f64 = 2.0;

/// The deadline the Demands form starts with, in game days: a game week.
pub const DEMAND_DEFAULT_DAYS: f64 = 7.0;

/// How many times its soldiers the respect an NPC city sees from a realm must be before it yields to
/// that realm's demand (`CONTEXT.md`: Demand): "far outweighs", so an army at the gate wins it and a
/// few spears more than it has soldiers don't. Persuading a city takes only more than its soldiers.
pub const DEMAND_YIELD_RESPECT_TIMES: f64 = 3.0;

/// The least respect an NPC city yields to a demand for, however few soldiers it has (`CONTEXT.md`:
/// Demand): a small band, so a city without soldiers doesn't give in to one person with a spear.
pub const DEMAND_YIELD_RESPECT_MIN: f64 = 5.0;

/// What an NPC city's standing toward a realm drops by when it declines that realm's demand
/// (`CONTEXT.md`: Demand): as much as a theft, so three in a game day shut its gates.
pub const DEMAND_DECLINED_STANDING_LOSS: f64 = 10.0;

/// What the Trade Organization's standing toward a realm drops by for being sent a demand
/// (`CONTEXT.md`: Demand). Small, as it refuses trade and sends its army at small numbers
/// (`TRADE_ORG_REFUSES_TRADE_BELOW`, `TRADE_ORG_PUNISHES_BELOW`): it takes several to matter.
pub const DEMAND_TRADE_ORG_STANDING_LOSS: f64 = 2.0;

/// How long a Direct offer stands, in game days (`CONTEXT.md`: Direct offer): one real day, so a
/// Player who comes by once a day can still answer and send someone. The sender can take it down
/// sooner.
pub const DIRECT_OFFER_DAYS: f64 = 60.0;

/// How many Direct offers a realm may have standing to any one realm (`CONTEXT.md`: Direct offer):
/// room to deal in several goods at once, and few enough that it can't flood the other's list.
pub const DIRECT_OFFERS_TO_ONE_REALM: f64 = 5.0;

/// Every exported constant of the table as JSON, keyed by its TypeScript name: what
/// `pnpm balance:rust` writes to `packages/balance/balance.json` for the client.
pub fn balance_json() -> Value {
    let mut m = Map::new();
    m.insert("MAP_SIZE".into(), json!(MAP_SIZE));
    m.insert("TERRAIN_SHARES".into(), to_value(TERRAIN_SHARES).expect("serialisable"));
    m.insert("NODE_DENSITY".into(), to_value(NODE_DENSITY).expect("serialisable"));
    m.insert("NODE_MIN_SPACING".into(), json!(NODE_MIN_SPACING));
    m.insert("TERRAIN_SPEED".into(), to_value(TERRAIN_SPEED).expect("serialisable"));
    m.insert("STAT_BASE_MIN".into(), json!(STAT_BASE_MIN));
    m.insert("STAT_BASE_MAX".into(), json!(STAT_BASE_MAX));
    m.insert("TRAINED_CAP_SHARE".into(), json!(TRAINED_CAP_SHARE));
    m.insert("MAX_HEALTH".into(), json!(MAX_HEALTH));
    m.insert("MAX_HUNGER".into(), json!(MAX_HUNGER));
    m.insert("START_AGE_MIN".into(), json!(START_AGE_MIN));
    m.insert("START_AGE_MAX".into(), json!(START_AGE_MAX));
    m.insert("LIFESPAN_MIN".into(), json!(LIFESPAN_MIN));
    m.insert("LIFESPAN_MAX".into(), json!(LIFESPAN_MAX));
    m.insert("ADULT_AGE".into(), json!(ADULT_AGE));
    m.insert("CHILD_YEAR_DAYS".into(), json!(CHILD_YEAR_DAYS));
    m.insert("CHILD_GOODS".into(), to_value(CHILD_GOODS).expect("serialisable"));
    m.insert("DECLINE_AGE".into(), json!(DECLINE_AGE));
    m.insert("DECLINE_PER_YEAR".into(), json!(DECLINE_PER_YEAR));
    m.insert("DECLINE_FLOOR".into(), json!(DECLINE_FLOOR));
    m.insert("START_CITY_SIZE".into(), json!(START_CITY_SIZE));
    m.insert("START_RESIDENTS".into(), json!(START_RESIDENTS));
    m.insert("HOUSING_ROOM".into(), to_value(HOUSING_ROOM).expect("serialisable"));
    m.insert("START_SPARE_HOUSES".into(), json!(START_SPARE_HOUSES));
    m.insert("START_FOOD".into(), json!(START_FOOD));
    m.insert("START_CARRIED_FOOD".into(), json!(START_CARRIED_FOOD));
    m.insert("START_HORSES".into(), json!(START_HORSES));
    m.insert("START_STABLE_FOOD".into(), json!(START_STABLE_FOOD));
    m.insert("HORSE_FOOD_PER_DAY".into(), json!(HORSE_FOOD_PER_DAY));
    m.insert("HORSE_GRANT_HORSES".into(), json!(HORSE_GRANT_HORSES));
    m.insert("HORSE_GRANT_FOOD".into(), json!(HORSE_GRANT_FOOD));
    m.insert("HORSE_REACH".into(), json!(HORSE_REACH));
    m.insert("HORSE_HUNGRY_SHARE".into(), json!(HORSE_HUNGRY_SHARE));
    m.insert("HORSE_WAKE_HEALTH".into(), json!(HORSE_WAKE_HEALTH));
    m.insert("STABLE_FEED_DAYS".into(), json!(STABLE_FEED_DAYS));
    m.insert("NPC_STABLE_REFILL_DAYS".into(), json!(NPC_STABLE_REFILL_DAYS));
    m.insert("NPC_STABLE_HUNGRY_DAYS".into(), json!(NPC_STABLE_HUNGRY_DAYS));
    m.insert("NPC_START_HORSES".into(), json!(NPC_START_HORSES));
    m.insert("NPC_START_HORSE_FOOD_DAYS".into(), json!(NPC_START_HORSE_FOOD_DAYS));
    m.insert("NPC_HORSES_BASE".into(), json!(NPC_HORSES_BASE));
    m.insert("NPC_RESIDENTS_PER_HORSE".into(), json!(NPC_RESIDENTS_PER_HORSE));
    m.insert("NPC_HORSES_KEPT".into(), json!(NPC_HORSES_KEPT));
    m.insert("HORSE_PRICE_BASE".into(), json!(HORSE_PRICE_BASE));
    m.insert("HORSE_PRICE_PER_STAT".into(), json!(HORSE_PRICE_PER_STAT));
    m.insert("HORSE_PRICE_STATS_FLOOR".into(), json!(HORSE_PRICE_STATS_FLOOR));
    m.insert("HORSE_PRICE_AGE_PER_YEAR".into(), json!(HORSE_PRICE_AGE_PER_YEAR));
    m.insert("HORSE_PRICE_AGE_FLOOR".into(), json!(HORSE_PRICE_AGE_FLOOR));
    m.insert("HORSE_PRICE_SCARCITY".into(), json!(HORSE_PRICE_SCARCITY));
    m.insert("HORSE_PRICE_GLUT".into(), json!(HORSE_PRICE_GLUT));
    m.insert("HORSE_PRICE_PAID_SHARE".into(), json!(HORSE_PRICE_PAID_SHARE));
    m.insert("DEFEND_CALM_TICKS".into(), json!(DEFEND_CALM_TICKS));
    m.insert("STABLE_CAPACITY".into(), json!(STABLE_CAPACITY));
    m.insert("STABLE_BREED_DAYS".into(), json!(STABLE_BREED_DAYS));
    m.insert("FOAL_STAT_SPREAD".into(), json!(FOAL_STAT_SPREAD));
    m.insert("HORSE_STAT_MIN".into(), json!(HORSE_STAT_MIN));
    m.insert("HORSE_STAT_MAX".into(), json!(HORSE_STAT_MAX));
    m.insert("HORSE_STAT_AVERAGE".into(), json!(HORSE_STAT_AVERAGE));
    m.insert("AVERAGE_HORSE_STATS".into(), to_value(AVERAGE_HORSE_STATS).expect("serialisable"));
    m.insert("HORSE_START_AGE_MIN".into(), json!(HORSE_START_AGE_MIN));
    m.insert("HORSE_START_AGE_MAX".into(), json!(HORSE_START_AGE_MAX));
    m.insert("HORSE_SPEED_EFFECT".into(), json!(HORSE_SPEED_EFFECT));
    m.insert("HORSE_SPEED_LIMIT".into(), json!(HORSE_SPEED_LIMIT));
    m.insert("HORSE_STRENGTH_EFFECT".into(), json!(HORSE_STRENGTH_EFFECT));
    m.insert("HORSE_STRENGTH_LIMIT".into(), json!(HORSE_STRENGTH_LIMIT));
    m.insert("HORSE_ENDURANCE_EFFECT".into(), json!(HORSE_ENDURANCE_EFFECT));
    m.insert("HORSE_ENDURANCE_LIMIT".into(), json!(HORSE_ENDURANCE_LIMIT));
    m.insert("CITY_MIN_DISTANCE".into(), json!(CITY_MIN_DISTANCE));
    m.insert("CITY_BUILDING_REACH".into(), json!(CITY_BUILDING_REACH));
    m.insert("CITY_AREA_MARGIN".into(), json!(CITY_AREA_MARGIN));
    m.insert("WALL_ENCLOSES_MAX".into(), json!(WALL_ENCLOSES_MAX));
    m.insert("SIGHT_RANGE".into(), json!(SIGHT_RANGE));
    m.insert("LAST_SEEN_EVERY_TICKS".into(), json!(LAST_SEEN_EVERY_TICKS));
    m.insert("NPC_VILLAGES".into(), json!(NPC_VILLAGES));
    m.insert("NPC_TOWNS".into(), json!(NPC_TOWNS));
    m.insert("NPC_CITY_MIN_DISTANCE".into(), json!(NPC_CITY_MIN_DISTANCE));
    m.insert("NPC_VILLAGE".into(), to_value(NPC_VILLAGE).expect("serialisable"));
    m.insert("NPC_TOWN".into(), to_value(NPC_TOWN).expect("serialisable"));
    m.insert("OCCUPATION_GAME_DAYS".into(), json!(OCCUPATION_GAME_DAYS));
    m.insert("CITY_PRICE_PER_RESIDENT".into(), json!(CITY_PRICE_PER_RESIDENT));
    m.insert(
        "CITY_PRICE_BY_BUILDING".into(),
        to_value(CITY_PRICE_BY_BUILDING).expect("serialisable"),
    );
    m.insert("NPC_FOOD_SHORT_DAYS".into(), json!(NPC_FOOD_SHORT_DAYS));
    m.insert("WORK_FOOD_KEPT".into(), json!(WORK_FOOD_KEPT));
    m.insert("NPC_SOLDIER_SHARE".into(), json!(NPC_SOLDIER_SHARE));
    m.insert("NPC_SOLDIERS_ON_HALL".into(), json!(NPC_SOLDIERS_ON_HALL));
    m.insert("NPC_SOLDIERS_AT_GATE".into(), json!(NPC_SOLDIERS_AT_GATE));
    m.insert("NPC_POST_AROUND_HALL".into(), json!(NPC_POST_AROUND_HALL));
    m.insert("NPC_TRAIN_TURN_TICKS".into(), json!(NPC_TRAIN_TURN_TICKS));
    m.insert("NPC_PATROLS_MAX".into(), json!(NPC_PATROLS_MAX));
    m.insert("NPC_SOLDIERS_PER_PATROL".into(), json!(NPC_SOLDIERS_PER_PATROL));
    m.insert("NPC_PATROL_WALL_STOPS".into(), json!(NPC_PATROL_WALL_STOPS));
    m.insert("NPC_PATROL_ROAD_STOPS".into(), json!(NPC_PATROL_ROAD_STOPS));
    m.insert("NPC_WAR_CHEST_PER_RESIDENT".into(), json!(NPC_WAR_CHEST_PER_RESIDENT));
    m.insert("NPC_GATE_WATCH_RANGE".into(), json!(NPC_GATE_WATCH_RANGE));
    m.insert("NPC_ADULTS_PER_PAIR".into(), json!(NPC_ADULTS_PER_PAIR));
    m.insert("CARRYING_DAYS".into(), json!(CARRYING_DAYS));
    m.insert("CARRYING_TICKS".into(), json!(CARRYING_TICKS));
    m.insert("PAIRING_WAIT_DAYS".into(), json!(PAIRING_WAIT_DAYS));
    m.insert("PAIRING_WAIT_TICKS".into(), json!(PAIRING_WAIT_TICKS));
    m.insert("NPC_PLAN_TICKS".into(), json!(NPC_PLAN_TICKS));
    m.insert("NPC_JOB_SCORE".into(), to_value(NPC_JOB_SCORE).expect("serialisable"));
    m.insert("NPC_JOB_MARGIN".into(), json!(NPC_JOB_MARGIN));
    m.insert("NPC_RESIDENTS_PER_NEEDS_STEP".into(), json!(NPC_RESIDENTS_PER_NEEDS_STEP));
    m.insert("NPC_BUILDERS".into(), json!(NPC_BUILDERS));
    m.insert("NPC_ROAD_CREW".into(), json!(NPC_ROAD_CREW));
    m.insert("NPC_ROAD_LONGEST".into(), json!(NPC_ROAD_LONGEST));
    m.insert("NPC_REVIVE_REACH".into(), json!(NPC_REVIVE_REACH));
    m.insert("NPC_SURPLUS_CAP".into(), to_value(NPC_SURPLUS_CAP).expect("serialisable"));
    m.insert("NPC_WALL_STEP".into(), json!(NPC_WALL_STEP));
    m.insert("NPC_INNER_WALL_REACH".into(), json!(NPC_INNER_WALL_REACH));
    m.insert("CITY_GRID_BLOCK".into(), json!(CITY_GRID_BLOCK));
    m.insert("CITY_RING_STEP".into(), json!(CITY_RING_STEP));
    m.insert("CITY_SIDE_LANE_GAP".into(), json!(CITY_SIDE_LANE_GAP));
    m.insert("CITY_QUARTER_ROWS".into(), json!(CITY_QUARTER_ROWS));
    m.insert("NPC_WALL_TILES_PER_TRIP".into(), json!(NPC_WALL_TILES_PER_TRIP));
    m.insert("NPC_NODE_REACH".into(), json!(NPC_NODE_REACH));
    m.insert("NPC_RESIDENTS_PER_SCOUT".into(), json!(NPC_RESIDENTS_PER_SCOUT));
    m.insert("NPC_SCOUT_LIMIT".into(), json!(NPC_SCOUT_LIMIT));
    m.insert("NPC_SCOUT_SECTOR".into(), json!(NPC_SCOUT_SECTOR));
    m.insert("NPC_TRADER_REACH".into(), json!(NPC_TRADER_REACH));
    m.insert("NPC_RESIDENTS_PER_TRADER".into(), json!(NPC_RESIDENTS_PER_TRADER));
    m.insert("NPC_OFFER_REACH".into(), json!(NPC_OFFER_REACH));
    m.insert("NPC_TRADER_GIVE_UP_DAYS".into(), json!(NPC_TRADER_GIVE_UP_DAYS));
    m.insert("NPC_FARM_REACH".into(), json!(NPC_FARM_REACH));
    m.insert("NPC_FULL_DAYS".into(), json!(NPC_FULL_DAYS));
    m.insert("NPC_FOUND_VILLAGE_RESIDENTS".into(), json!(NPC_FOUND_VILLAGE_RESIDENTS));
    m.insert("NPC_FULL_RESIDENTS_PER_DAY".into(), json!(NPC_FULL_RESIDENTS_PER_DAY));
    m.insert("NPC_FULL_DAYS_LEAST".into(), json!(NPC_FULL_DAYS_LEAST));
    m.insert("NPC_FULL_DIP_DAYS".into(), json!(NPC_FULL_DIP_DAYS));
    m.insert("NPC_FOUND_RESIDENTS_PER_MEMBER".into(), json!(NPC_FOUND_RESIDENTS_PER_MEMBER));
    m.insert("NPC_FOUND_PARTY_MOST".into(), json!(NPC_FOUND_PARTY_MOST));
    m.insert("NPC_FOUND_SAMPLES".into(), json!(NPC_FOUND_SAMPLES));
    m.insert("NPC_FOUND_REACH".into(), json!(NPC_FOUND_REACH));
    m.insert("NPC_FOUND_FOOD_DAYS".into(), json!(NPC_FOUND_FOOD_DAYS));
    m.insert("NPC_FOUND_GIVE_UP_DAYS".into(), json!(NPC_FOUND_GIVE_UP_DAYS));
    m.insert("NPC_FOUND_STANDING".into(), json!(NPC_FOUND_STANDING));
    m.insert("TRADE_ORG_HQ".into(), to_value(TRADE_ORG_HQ).expect("serialisable"));
    m.insert("TRADE_ORG_HQ_MIN_DISTANCE".into(), json!(TRADE_ORG_HQ_MIN_DISTANCE));
    m.insert("TRADING_POST_REGION".into(), json!(TRADING_POST_REGION));
    m.insert("TRADING_POST".into(), to_value(TRADING_POST).expect("serialisable"));
    m.insert("WAREHOUSE_FLOOR".into(), to_value(WAREHOUSE_FLOOR).expect("serialisable"));
    m.insert("HQ_FLOOR_FACTOR".into(), json!(HQ_FLOOR_FACTOR));
    m.insert("HQ_FOOD_FLOOR_FACTOR".into(), json!(HQ_FOOD_FLOOR_FACTOR));
    m.insert("WAREHOUSE_BASE_PRICE".into(), to_value(WAREHOUSE_BASE_PRICE).expect("serialisable"));
    m.insert("PRICE_REFERENCE_FLOORS".into(), json!(PRICE_REFERENCE_FLOORS));
    m.insert("PRICE_ELASTICITY".into(), json!(PRICE_ELASTICITY));
    m.insert("PRICE_RANGE".into(), to_value(PRICE_RANGE).expect("serialisable"));
    m.insert("BUY_SHARE".into(), json!(BUY_SHARE));
    m.insert("CARAVAN_ESCORTS".into(), json!(CARAVAN_ESCORTS));
    m.insert("CARAVAN_ROBBERIES_PER_ESCORT".into(), json!(CARAVAN_ROBBERIES_PER_ESCORT));
    m.insert("CARAVAN_ESCORTS_MAX".into(), json!(CARAVAN_ESCORTS_MAX));
    m.insert("CARAVAN_FOOD_PER_ESCORT".into(), json!(CARAVAN_FOOD_PER_ESCORT));
    m.insert("CARAVAN_GUARD_RANGE".into(), json!(CARAVAN_GUARD_RANGE));
    m.insert("CARAVAN_FOOD".into(), json!(CARAVAN_FOOD));
    m.insert("WAY_FOOD_MARGIN".into(), json!(WAY_FOOD_MARGIN));
    m.insert("HQ_PEOPLE_FOOD_DAYS".into(), json!(HQ_PEOPLE_FOOD_DAYS));
    m.insert("WAITING_HORSE_FOOD".into(), json!(WAITING_HORSE_FOOD));
    m.insert("SET_OFF_FOOD_SLACK".into(), json!(SET_OFF_FOOD_SLACK));
    m.insert("CARAVAN_SPREAD".into(), json!(CARAVAN_SPREAD));
    m.insert("TRADERS".into(), json!(TRADERS));
    m.insert("TRADER_ESCORTS".into(), json!(TRADER_ESCORTS));
    m.insert("TRADER_DRIVE_TRIES".into(), json!(TRADER_DRIVE_TRIES));
    m.insert("TRADER_STOP_REACH".into(), json!(TRADER_STOP_REACH));
    m.insert("TRADER_STOP_TICKS".into(), json!(TRADER_STOP_TICKS));
    m.insert("TRADER_FLOOR_SHARE".into(), json!(TRADER_FLOOR_SHARE));
    m.insert("DELIVERY_FEE_BASE".into(), json!(DELIVERY_FEE_BASE));
    m.insert("DELIVERY_FEE_PER_KG_TILE".into(), json!(DELIVERY_FEE_PER_KG_TILE));
    m.insert("DELIVERY_DRIVE_TRIES".into(), json!(DELIVERY_DRIVE_TRIES));
    m.insert("TRANSFER_FEE_FACTOR".into(), json!(TRANSFER_FEE_FACTOR));
    m.insert("SEA_COUNT".into(), json!(SEA_COUNT));
    m.insert("GOOD_WEIGHT".into(), to_value(GOOD_WEIGHT).expect("serialisable"));
    m.insert("WEAPON_ATTACK".into(), to_value(WEAPON_ATTACK).expect("serialisable"));
    m.insert("PROTECTION_DEFENCE".into(), to_value(PROTECTION_DEFENCE).expect("serialisable"));
    m.insert("CARRY_BASE".into(), json!(CARRY_BASE));
    m.insert("CARRY_PER_STRENGTH".into(), json!(CARRY_PER_STRENGTH));
    m.insert("FOOD_PER_DAY".into(), json!(FOOD_PER_DAY));
    m.insert("HOME_FOOD_LOW".into(), json!(HOME_FOOD_LOW));
    m.insert("OUTPOST_REFILL_REACH".into(), json!(OUTPOST_REFILL_REACH));
    m.insert("OWN_FOOD".into(), json!(OWN_FOOD));
    m.insert("GET_FOOD_AT".into(), json!(GET_FOOD_AT));
    m.insert("GET_FOOD_TAKE".into(), json!(GET_FOOD_TAKE));
    m.insert("CREW_FOOD".into(), json!(CREW_FOOD));
    m.insert("SET_OUT_WORK_DAYS".into(), json!(SET_OUT_WORK_DAYS));
    m.insert("BREED_FOOD".into(), json!(BREED_FOOD));
    m.insert("MEAL_UNITS".into(), json!(MEAL_UNITS));
    m.insert("HUNGER_DAYS".into(), json!(HUNGER_DAYS));
    m.insert("HORSE_FILL_PER_FOOD".into(), json!(HORSE_FILL_PER_FOOD));
    m.insert("STARVE_DAYS".into(), json!(STARVE_DAYS));
    m.insert("DOWN_DAYS".into(), json!(DOWN_DAYS));
    m.insert("WAKE_HEALTH".into(), json!(WAKE_HEALTH));
    m.insert("FEED_UNITS".into(), json!(FEED_UNITS));
    m.insert("HEAL_DAYS".into(), json!(HEAL_DAYS));
    m.insert("HUNGER_ENDURANCE_AVERAGE".into(), json!(HUNGER_ENDURANCE_AVERAGE));
    m.insert("HUNGER_ENDURANCE_EFFECT".into(), json!(HUNGER_ENDURANCE_EFFECT));
    m.insert("HUNGER_ENDURANCE_LIMIT".into(), json!(HUNGER_ENDURANCE_LIMIT));
    m.insert("TERRAIN_FOOD".into(), to_value(TERRAIN_FOOD).expect("serialisable"));
    m.insert("ENDURANCE_TERRAIN_EFFECT".into(), json!(ENDURANCE_TERRAIN_EFFECT));
    m.insert("FOOD_SURPLUS_DAYS".into(), json!(FOOD_SURPLUS_DAYS));
    m.insert("CHILD_STAT_SPREAD".into(), json!(CHILD_STAT_SPREAD));
    m.insert("WALK_TICKS_PER_TILE".into(), json!(WALK_TICKS_PER_TILE));
    m.insert("PATH_DETOUR_LIMIT".into(), json!(PATH_DETOUR_LIMIT));
    m.insert("PATH_DETOUR_SLACK".into(), json!(PATH_DETOUR_SLACK));
    m.insert("AGILITY_AVERAGE".into(), json!(AGILITY_AVERAGE));
    m.insert("AGILITY_SPEED_EFFECT".into(), json!(AGILITY_SPEED_EFFECT));
    m.insert("AGILITY_TERRAIN_EFFECT".into(), json!(AGILITY_TERRAIN_EFFECT));
    m.insert("AGILITY_LIMIT".into(), json!(AGILITY_LIMIT));
    m.insert("CARRIAGE_CAPACITY".into(), json!(CARRIAGE_CAPACITY));
    m.insert("CARRIAGE_LIGHT_LOAD".into(), json!(CARRIAGE_LIGHT_LOAD));
    m.insert("CARRIAGE_HALF_LOAD".into(), json!(CARRIAGE_HALF_LOAD));
    m.insert("DELIVERY_LOAD".into(), json!(DELIVERY_LOAD));
    m.insert("HAUL_HORSE_FOOD".into(), json!(HAUL_HORSE_FOOD));
    m.insert("HAUL_KEEP_FOOD".into(), json!(HAUL_KEEP_FOOD));
    m.insert("CARRIAGE_SPEED".into(), to_value(CARRIAGE_SPEED).expect("serialisable"));
    m.insert("DRIVING_SKILL_EFFECT".into(), json!(DRIVING_SKILL_EFFECT));
    m.insert("DRIVING_SKILL_LIMIT".into(), json!(DRIVING_SKILL_LIMIT));
    m.insert("DRIVING_SKILL_PER_DAY".into(), json!(DRIVING_SKILL_PER_DAY));
    m.insert("HUNGRY_HORSE_PACE".into(), json!(HUNGRY_HORSE_PACE));
    m.insert("CARRIAGE_MAX_CAPACITY".into(), json!(CARRIAGE_MAX_CAPACITY));
    m.insert("PASSENGER_WEIGHT".into(), json!(PASSENGER_WEIGHT));
    m.insert("BOAT_CAPACITY".into(), json!(BOAT_CAPACITY));
    m.insert("ROW_SPEED".into(), json!(ROW_SPEED));
    m.insert("ROW_STRENGTH_EFFECT".into(), json!(ROW_STRENGTH_EFFECT));
    m.insert("ROW_STRENGTH_AVERAGE".into(), json!(ROW_STRENGTH_AVERAGE));
    m.insert("ROW_STRENGTH_LIMIT".into(), json!(ROW_STRENGTH_LIMIT));
    m.insert("SEAFARING_SKILL_EFFECT".into(), json!(SEAFARING_SKILL_EFFECT));
    m.insert("SEAFARING_SKILL_LIMIT".into(), json!(SEAFARING_SKILL_LIMIT));
    m.insert("SEAFARING_SKILL_PER_DAY".into(), json!(SEAFARING_SKILL_PER_DAY));
    m.insert("FOOD_SPOIL_PER_DAY".into(), json!(FOOD_SPOIL_PER_DAY));
    m.insert("REALM_LOG_LENGTH".into(), json!(REALM_LOG_LENGTH));
    m.insert("CRIME_MEMORY_DAYS".into(), json!(CRIME_MEMORY_DAYS));
    m.insert("STANDING_RANGE".into(), json!(STANDING_RANGE));
    m.insert("CRIME_STANDING_LOSS".into(), to_value(CRIME_STANDING_LOSS).expect("serialisable"));
    m.insert("STANDING_TRADE_COINS_PER_POINT".into(), json!(STANDING_TRADE_COINS_PER_POINT));
    m.insert(
        "STANDING_NPC_TRADE_COINS_PER_POINT".into(),
        json!(STANDING_NPC_TRADE_COINS_PER_POINT),
    );
    m.insert("STANDING_PER_PAID_WEEK".into(), json!(STANDING_PER_PAID_WEEK));
    m.insert("STANDING_CONTRACT_BROKEN_LOSS".into(), json!(STANDING_CONTRACT_BROKEN_LOSS));
    m.insert("STANDING_DRIFT_PER_DAY".into(), json!(STANDING_DRIFT_PER_DAY));
    m.insert("NPC_CITY_REFUSES_STANDING".into(), json!(NPC_CITY_REFUSES_STANDING));
    m.insert("NPC_CITY_WONT_SELL_STANDING".into(), json!(NPC_CITY_WONT_SELL_STANDING));
    m.insert("CITY_PRICE_STANDING_SWING".into(), json!(CITY_PRICE_STANDING_SWING));
    m.insert("NPC_TRADE".into(), to_value(NPC_TRADE).expect("serialisable"));
    m.insert("PERSUADE_STANDING".into(), json!(PERSUADE_STANDING));
    m.insert("PERSUADE_CHECK_TICKS".into(), json!(PERSUADE_CHECK_TICKS));
    m.insert("PERSUADE_ASK_AGAIN_DAYS".into(), json!(PERSUADE_ASK_AGAIN_DAYS));
    m.insert("FORMER_PLAYER_STANDING".into(), json!(FORMER_PLAYER_STANDING));
    m.insert("TRADE_ORG_REFUSES_TRADE_BELOW".into(), json!(TRADE_ORG_REFUSES_TRADE_BELOW));
    m.insert("TRADE_ORG_PUNISHES_BELOW".into(), json!(TRADE_ORG_PUNISHES_BELOW));
    m.insert("TRADE_ORG_LOSS".into(), to_value(TRADE_ORG_LOSS).expect("serialisable"));
    m.insert("CARRIAGE_STOLEN_WORTH".into(), json!(CARRIAGE_STOLEN_WORTH));
    m.insert("HORSE_STOLEN_WORTH".into(), json!(HORSE_STOLEN_WORTH));
    m.insert("TRADE_ORG_PUNISH".into(), to_value(TRADE_ORG_PUNISH).expect("serialisable"));
    m.insert("DIRECTIVE_PUNISH_WORTH".into(), json!(DIRECTIVE_PUNISH_WORTH));
    m.insert("DIRECTIVE_BUY_OFF_PRICE".into(), json!(DIRECTIVE_BUY_OFF_PRICE));
    m.insert("BUILD_MATERIALS".into(), to_value(BUILD_MATERIALS).expect("serialisable"));
    m.insert("BUILD_WORK".into(), to_value(BUILD_WORK).expect("serialisable"));
    m.insert("MOUNTAIN_ROAD_WORK_FACTOR".into(), json!(MOUNTAIN_ROAD_WORK_FACTOR));
    m.insert("ROAD_LINE_MAX_TILES".into(), json!(ROAD_LINE_MAX_TILES));
    m.insert("BUILD_STRENGTH_AVERAGE".into(), json!(BUILD_STRENGTH_AVERAGE));
    m.insert("CONSTRUCTION_SKILL_EFFECT".into(), json!(CONSTRUCTION_SKILL_EFFECT));
    m.insert("CONSTRUCTION_SKILL_LIMIT".into(), json!(CONSTRUCTION_SKILL_LIMIT));
    m.insert("CONSTRUCTION_SKILL_MAX".into(), json!(CONSTRUCTION_SKILL_MAX));
    m.insert("CONSTRUCTION_SKILL_PER_DAY".into(), json!(CONSTRUCTION_SKILL_PER_DAY));
    m.insert("INTELLECT_AVERAGE".into(), json!(INTELLECT_AVERAGE));
    m.insert(
        "WORKPLACE_MAX_WORKERS".into(),
        to_value(WORKPLACE_MAX_WORKERS).expect("serialisable"),
    );
    m.insert(
        "WORKPLACE_WRECK_WORTH".into(),
        to_value(WORKPLACE_WRECK_WORTH).expect("serialisable"),
    );
    m.insert("WORKPLACE_SKILL".into(), to_value(WORKPLACE_SKILL).expect("serialisable"));
    m.insert("RECIPES".into(), to_value(RECIPES).expect("serialisable"));
    m.insert("BATCHES_PER_DAY".into(), to_value(BATCHES_PER_DAY).expect("serialisable"));
    m.insert("WORK_OUTPUT_PER_DAY".into(), to_value(WORK_OUTPUT_PER_DAY).expect("serialisable"));
    m.insert("WORK_STRENGTH_AVERAGE".into(), json!(WORK_STRENGTH_AVERAGE));
    m.insert("WORK_SKILL_EFFECT".into(), json!(WORK_SKILL_EFFECT));
    m.insert("WORK_SKILL_LIMIT".into(), json!(WORK_SKILL_LIMIT));
    m.insert("WORK_SKILL_MAX".into(), json!(WORK_SKILL_MAX));
    m.insert("WORK_SKILL_PER_DAY".into(), json!(WORK_SKILL_PER_DAY));
    m.insert("TEARDOWN_WORK_SHARE".into(), json!(TEARDOWN_WORK_SHARE));
    m.insert("TEARDOWN_MATERIALS_RETURNED".into(), json!(TEARDOWN_MATERIALS_RETURNED));
    m.insert("ALLIANCE_LEAVE_DELAY".into(), json!(ALLIANCE_LEAVE_DELAY));
    m.insert("ALLIANCE_RECALL_DELAY".into(), json!(ALLIANCE_RECALL_DELAY));
    m.insert("NPC_ALLIANCE_JOIN_STANDING".into(), json!(NPC_ALLIANCE_JOIN_STANDING));
    m.insert("NPC_ALLIANCE_LEAVE_STANDING".into(), json!(NPC_ALLIANCE_LEAVE_STANDING));
    m.insert("TERRITORY_CITY_BASE".into(), json!(TERRITORY_CITY_BASE));
    m.insert("TERRITORY_WORKPLACE_BASE".into(), json!(TERRITORY_WORKPLACE_BASE));
    m.insert("TERRITORY_PER_RESIDENT".into(), json!(TERRITORY_PER_RESIDENT));
    m.insert("TERRITORY_PER_ARMED".into(), json!(TERRITORY_PER_ARMED));
    m.insert("TERRITORY_REACH_PER_ROOT".into(), json!(TERRITORY_REACH_PER_ROOT));
    m.insert("TERRITORY_MAX_REACH".into(), json!(TERRITORY_MAX_REACH));
    m.insert("STRIKE_TICKS".into(), json!(STRIKE_TICKS));
    m.insert("BLOW_BASE".into(), json!(BLOW_BASE));
    m.insert("BLOW_PER_STRENGTH".into(), json!(BLOW_PER_STRENGTH));
    m.insert("COMBAT_SKILL_EFFECT".into(), json!(COMBAT_SKILL_EFFECT));
    m.insert("COMBAT_SKILL_LIMIT".into(), json!(COMBAT_SKILL_LIMIT));
    m.insert("MIN_BLOW_DAMAGE".into(), json!(MIN_BLOW_DAMAGE));
    m.insert("WALL_DEFENCE".into(), json!(WALL_DEFENCE));
    m.insert("WALL_STRENGTH".into(), to_value(WALL_STRENGTH).expect("serialisable"));
    m.insert("BROKEN_MATERIALS_RETURNED".into(), json!(BROKEN_MATERIALS_RETURNED));
    m.insert("CLIMB_TICKS".into(), json!(CLIMB_TICKS));
    m.insert("DODGE_PER_AGILITY".into(), json!(DODGE_PER_AGILITY));
    m.insert("DODGE_LIMIT".into(), json!(DODGE_LIMIT));
    m.insert("COMBAT_SKILL_PER_BLOW".into(), json!(COMBAT_SKILL_PER_BLOW));
    m.insert("TRAINING_GROUND_MAX_TRAINEES".into(), json!(TRAINING_GROUND_MAX_TRAINEES));
    m.insert("TRAIN_STAT_PER_TICK".into(), json!(TRAIN_STAT_PER_TICK));
    m.insert("TRAIN_SKILL_FACTOR".into(), json!(TRAIN_SKILL_FACTOR));
    m.insert("TRAIN_COMBAT_FACTOR".into(), json!(TRAIN_COMBAT_FACTOR));
    m.insert("SKILL_MAX".into(), to_value(SKILL_MAX).expect("serialisable"));
    m.insert("SKILL_PER_DAY".into(), to_value(SKILL_PER_DAY).expect("serialisable"));
    m.insert("ARMY_SPREAD".into(), json!(ARMY_SPREAD));
    m.insert("CONTRACT_MAX_DAYS".into(), json!(CONTRACT_MAX_DAYS));
    m.insert("TRADE_ORG_ARMY".into(), to_value(TRADE_ORG_ARMY).expect("serialisable"));
    m.insert("SCRIPT_STEP_BUDGET".into(), json!(SCRIPT_STEP_BUDGET));
    m.insert("SCRIPT_MAX_CALL_DEPTH".into(), json!(SCRIPT_MAX_CALL_DEPTH));
    m.insert("SCRIPT_MAX_STRING_LENGTH".into(), json!(SCRIPT_MAX_STRING_LENGTH));
    m.insert("SCRIPT_MAX_LIST_LENGTH".into(), json!(SCRIPT_MAX_LIST_LENGTH));
    m.insert("SCRIPT_MAX_OBJECT_KEYS".into(), json!(SCRIPT_MAX_OBJECT_KEYS));
    m.insert("SCRIPT_VALUE_LIMITS".into(), to_value(SCRIPT_VALUE_LIMITS).expect("serialisable"));
    m.insert("SCRIPT_LIST_QUERY_COST".into(), json!(SCRIPT_LIST_QUERY_COST));
    m.insert("SCRIPT_TILE_QUERY_COST".into(), json!(SCRIPT_TILE_QUERY_COST));
    m.insert("SCRIPT_HELPER_COST".into(), json!(SCRIPT_HELPER_COST));
    m.insert("SCRIPT_ACTION_COST".into(), json!(SCRIPT_ACTION_COST));
    m.insert("SCRIPT_REALM_STEP_BUDGET".into(), json!(SCRIPT_REALM_STEP_BUDGET));
    m.insert("SCRIPT_MEMORY_MAX".into(), json!(SCRIPT_MEMORY_MAX));
    m.insert("SCRIPT_ACTION_VALUE_MAX".into(), json!(SCRIPT_ACTION_VALUE_MAX));
    m.insert("DOING_MAX_LENGTH".into(), json!(DOING_MAX_LENGTH));
    m.insert("SCRIPT_LOG_LINES".into(), json!(SCRIPT_LOG_LINES));
    m.insert("SCRIPT_LOG_INTERVAL".into(), json!(SCRIPT_LOG_INTERVAL));
    m.insert("SCRIPT_LIBRARY_MAX_SCRIPTS".into(), json!(SCRIPT_LIBRARY_MAX_SCRIPTS));
    m.insert("SCRIPT_MAX_VERSIONS".into(), json!(SCRIPT_MAX_VERSIONS));
    m.insert("SCRIPT_WRITES_PER_MINUTE".into(), json!(SCRIPT_WRITES_PER_MINUTE));
    m.insert("QUEUE_MAX_STEPS".into(), json!(QUEUE_MAX_STEPS));
    m.insert("QUEUE_STEP_MAX_CHARS".into(), json!(QUEUE_STEP_MAX_CHARS));
    m.insert("QUEUE_DEFAULT_STEP_MINUTES".into(), json!(QUEUE_DEFAULT_STEP_MINUTES));
    m.insert("REALM_NAME_MAX_LENGTH".into(), json!(REALM_NAME_MAX_LENGTH));
    m.insert("RESIDENT_NAME_MAX_LENGTH".into(), json!(RESIDENT_NAME_MAX_LENGTH));
    m.insert("CITY_NAME_MAX_LENGTH".into(), json!(CITY_NAME_MAX_LENGTH));
    m.insert("HORSE_NAME_MAX_LENGTH".into(), json!(HORSE_NAME_MAX_LENGTH));
    m.insert("WAYPOINT_NAME_MAX_LENGTH".into(), json!(WAYPOINT_NAME_MAX_LENGTH));
    m.insert("WAYPOINTS_MAX".into(), json!(WAYPOINTS_MAX));
    m.insert("EXPLORE_FOOD_MARGIN".into(), json!(EXPLORE_FOOD_MARGIN));
    m.insert("EXPLORED_EDGE_RANGE".into(), json!(EXPLORED_EDGE_RANGE));
    m.insert("EXPLORE_SKIP_RANGE".into(), json!(EXPLORE_SKIP_RANGE));
    m.insert("DEMAND_NOTE_MAX_LENGTH".into(), json!(DEMAND_NOTE_MAX_LENGTH));
    m.insert("DEMANDS_PER_GAME_DAY".into(), json!(DEMANDS_PER_GAME_DAY));
    m.insert("DEMAND_MAX_DAYS".into(), json!(DEMAND_MAX_DAYS));
    m.insert("TRADE_ORG_DEBT_DEMAND_DAYS".into(), json!(TRADE_ORG_DEBT_DEMAND_DAYS));
    m.insert("TRADE_ORG_DEBT_TRIPS".into(), json!(TRADE_ORG_DEBT_TRIPS));
    m.insert("DEMAND_DEFAULT_DAYS".into(), json!(DEMAND_DEFAULT_DAYS));
    m.insert("DEMAND_YIELD_RESPECT_TIMES".into(), json!(DEMAND_YIELD_RESPECT_TIMES));
    m.insert("DEMAND_YIELD_RESPECT_MIN".into(), json!(DEMAND_YIELD_RESPECT_MIN));
    m.insert("DEMAND_DECLINED_STANDING_LOSS".into(), json!(DEMAND_DECLINED_STANDING_LOSS));
    m.insert("DEMAND_TRADE_ORG_STANDING_LOSS".into(), json!(DEMAND_TRADE_ORG_STANDING_LOSS));
    m.insert("DIRECT_OFFER_DAYS".into(), json!(DIRECT_OFFER_DAYS));
    m.insert("DIRECT_OFFERS_TO_ONE_REALM".into(), json!(DIRECT_OFFERS_TO_ONE_REALM));
    Value::Object(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weighs_goods_by_their_unit_weights() {
        // Coins weigh too: a fortune is heavy.
        assert!(GOOD_WEIGHT.get("coins").unwrap() > 0.0);
        assert_eq!(GOOD_WEIGHT.get("armour"), Some(8.0));
    }

    #[test]
    fn turns_an_age_back_into_ticks_on_both_sides_of_the_boundary() {
        assert_eq!(ticks_for_age(ADULT_AGE), 140.0 * TICKS_PER_GAME_DAY);
        assert_eq!(ticks_for_age(0.0), 0.0);
        assert_eq!(ticks_for_age(3.5), 35.0 * TICKS_PER_GAME_DAY);
        assert_eq!(
            ticks_for_age(ADULT_AGE + 1.0),
            140.0 * TICKS_PER_GAME_DAY + TICKS_PER_GAME_YEAR
        );
    }

    #[test]
    fn caps_a_skill_at_where_its_bonus_reaches_the_limit() {
        assert_eq!(WORK_SKILL_MAX, 100.0);
        assert_eq!(CONSTRUCTION_SKILL_MAX, 100.0);
        assert_eq!(SKILL_MAX.combat, COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT);
    }

    #[test]
    fn caps_training_a_stat_at_half_its_base() {
        assert_eq!(trained_cap(10.0), 5.0);
        assert_eq!(trained_cap(8.0), 4.0);
        assert_eq!(trained_cap(7.0), 3.0);
    }

    #[test]
    fn rounds_food_for_a_trip_up_to_whole_units() {
        // 100 tiles: 100 * 7.5 * 1.4 ticks = 1050, 0.73 game days, 0.36 units of Food.
        assert_eq!(trip_food(100.0), 1.0);
        assert_eq!(set_out_food(0.0), 2.0 * 0.0 + (SET_OUT_WORK_DAYS * FOOD_PER_DAY).ceil());
        assert_eq!(road_crew_food(TICKS_PER_GAME_DAY * 4.0), 2.0 + GET_FOOD_AT);
        assert!(wagon_food_for(1000.0, 8.0) > wagon_food_for(1000.0, 1.0));
    }

    #[test]
    fn lets_a_carriage_into_everything_but_bare_mountain() {
        use crate::terrain::Terrain;
        for t in [Terrain::Plains, Terrain::Forest, Terrain::Hills, Terrain::Road] {
            assert!(carriage_can_enter(t as u8));
        }
        for t in [Terrain::Mountain, Terrain::Lake, Terrain::Sea] {
            assert!(!carriage_can_enter(t as u8));
        }
    }

    #[test]
    fn computes_the_derived_constants_as_typescript_does() {
        assert_eq!(HORSE_GRANT_FOOD, 4.0);
        assert_eq!(OWN_FOOD, 2.0);
        assert_eq!(DELIVERY_LOAD, 400.0 - 72.0);
        assert_eq!(DIRECTIVE_PUNISH_WORTH, 2.0 * 400.0);
        assert_eq!(TRADE_ORG_LOSS.capture, 400.0 * 6.0);
    }
}
