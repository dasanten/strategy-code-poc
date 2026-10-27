import { Terrain } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  effective,
  type BuildingKind,
  type CrimeKind,
  type Good,
  type Horse,
  type HorseStats,
  type Protection,
  type ResourceKind,
  type Resident,
  type SkillName,
  type StatName,
  type Stock,
  type Weapon,
} from './world.js'

/**
 * Balance numbers: how much, how fast, how often. The rules (what happens) are in `CONTEXT.md`;
 * these are the values Daniel tunes. One commented constant each.
 *
 * Work (eating, production, building, skill, spoilage, breeding) is counted in game days; social
 * and political timers (memory, standing, persuasion, contracts, punishment, alliance delays) keep
 * their real-time length (`CONTEXT.md`: Game time).
 */

/** Tiles along each side of the map: once around is a ~12 h walk at ~7.5 s per plains tile. */
export const MAP_SIZE = 5760

/**
 * Share of the map's tiles each terrain covers in a freshly generated map. Plains take the rest.
 * The generator hits these closely; the map test checks them.
 */
export const TERRAIN_SHARES = {
  /** A few large bodies of water. */
  sea: 0.08,
  /** Inland water, a few scattered lakes. */
  lake: 0.025,
  /** In ranges. */
  mountain: 0.07,
  /** Mostly around the ranges. */
  hills: 0.13,
  forest: 0.25,
} as const

/**
 * Resource nodes per tile of each terrain they lie on, when the world is created: as many per
 * area as on the old 40 m grid, so a sixteenth per tile. Ore is denser in Mountain than in Hills;
 * gold is rare.
 */
export const NODE_DENSITY = {
  forest: { [Terrain.Forest]: 1 / 4800 },
  stone: { [Terrain.Hills]: 1 / 4000 },
  ironOre: { [Terrain.Hills]: 1 / 24000, [Terrain.Mountain]: 1 / 4800 },
  goldOre: { [Terrain.Hills]: 1 / 240000, [Terrain.Mountain]: 1 / 48000 },
} as const satisfies Record<ResourceKind, Partial<Record<Terrain, number>>>

/** No two resource nodes lie closer than this many tiles (in either direction). */
export const NODE_MIN_SPACING = 16

/**
 * How fast an unloaded resident crosses each terrain, relative to Plains (`CONTEXT.md`:
 * Terrain). Agility softens the penalty (`walkSpeed`).
 */
export const TERRAIN_SPEED = {
  [Terrain.Plains]: 1,
  [Terrain.Forest]: 0.7,
  [Terrain.Hills]: 0.7,
  [Terrain.Mountain]: 0.35,
  /** A road, whatever the terrain beneath (`CONTEXT.md`: Road). */
  [Terrain.Road]: 1.3,
} as const satisfies Partial<Record<Terrain, number>>

/** A resident's base stats are drawn from this range when no parents pass theirs on. */
export const STAT_BASE_MIN = 5
export const STAT_BASE_MAX = 15

/** Training can add at most this share of a stat's base value (`CONTEXT.md`: Trained bonus). */
export const TRAINED_CAP_SHARE = 0.5

/** Most health a resident can have. */
export const MAX_HEALTH = 100

/** A full hunger meter. */
export const MAX_HUNGER = 100

/** Placeholder residents (until starting cities, T2.2) are this many game years old. */
export const START_AGE_MIN = 16
export const START_AGE_MAX = 45

/** A new resident's lifespan, the age in game years they die of old age, lies in this range. */
export const LIFESPAN_MIN = 55
export const LIFESPAN_MAX = 65

/**
 * Children are grown at this age in game years (`CONTEXT.md`: Aging, Child): from then on they
 * can work, build, tear down and pair.
 */
export const ADULT_AGE = 14

/**
 * Game days each year of age up to `ADULT_AGE` takes: children age faster, so a newborn is grown
 * after 140 game days (~56 real hours). Later years take a full game year (`CONTEXT.md`: Aging).
 */
export const CHILD_YEAR_DAYS = 10

/** Ticks from birth until a resident is grown up. */
const CHILDHOOD_TICKS = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY

/**
 * A resident's age in game years at the given tick: each year up to `ADULT_AGE` takes
 * `CHILD_YEAR_DAYS`, later years a full game year (`CONTEXT.md`: Aging).
 */
export function ageInYears(resident: Resident, tick: number): number {
  const lived = tick - resident.bornAt
  if (lived <= CHILDHOOD_TICKS) return lived / (CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY)
  return ADULT_AGE + (lived - CHILDHOOD_TICKS) / TICKS_PER_GAME_YEAR
}

/** The ticks a resident has lived at an age in game years: the inverse of `ageInYears`. */
export function ticksForAge(age: number): number {
  if (age <= ADULT_AGE) return age * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
  return CHILDHOOD_TICKS + (age - ADULT_AGE) * TICKS_PER_GAME_YEAR
}

/** Whether a resident is grown up, so they can work, build or take any job (`CONTEXT.md`: Child). */
export function canWork(resident: Resident, tick: number): boolean {
  return ageInYears(resident, tick) >= ADULT_AGE
}

/** Stats start to decline at this age in game years (`CONTEXT.md`: Aging). */
export const DECLINE_AGE = 45

/** Share of a stat's effective value lost for each full game year past `DECLINE_AGE`. */
export const DECLINE_PER_YEAR = 0.02

/** However old a resident gets, their stats keep at least this share of their effective value. */
export const DECLINE_FLOOR = 0.6

/**
 * How much of their stats a resident keeps at the given tick: all of it until `DECLINE_AGE`,
 * then a little less with each full game year (`CONTEXT.md`: Aging).
 */
export function ageFactor(resident: Resident, tick: number): number {
  const past = Math.floor(ageInYears(resident, tick)) - DECLINE_AGE
  if (past <= 0) return 1
  return Math.max(DECLINE_FLOOR, 1 - past * DECLINE_PER_YEAR)
}

/** A stat as it counts at the given tick: base and trained bonus, less the decline of old age. */
export function statValue(resident: Resident, stat: StatName, tick: number): number {
  return effective(resident.stats[stat]) * ageFactor(resident, tick)
}

/** The most a stat's trained bonus can be, for a given base value. */
export function trainedCap(base: number): number {
  return Math.floor(base * TRAINED_CAP_SHARE)
}

/**
 * Tiles along each side of a starting city, wall included: 27×27 tiles inside the wall. An odd
 * number, so its storage has a middle tile.
 */
export const START_CITY_SIZE = 29

/** Residents in a starting city, the Leader included. */
export const START_RESIDENTS = 8

/**
 * Residents each kind of building houses (`CONTEXT.md`: House, Free housing). Only houses so far;
 * later housing buildings (a palace, a castle) add their room here.
 */
export const HOUSING_ROOM: Partial<Record<BuildingKind, number>> = {
  house: 4,
}

/** Houses a starting city gets beyond what its residents need. */
export const START_SPARE_HOUSES = 1

/** Food in a starting city's storage, in kg: about 25 game days for its residents. */
export const START_FOOD = 100

/**
 * Food each resident of a starting city carries, in units: four game days' meals, so they have
 * something to eat while the farm's first harvest comes in (`CONTEXT.md`: Eating).
 */
export const START_CARRIED_FOOD = 2

/** Horses in a starting city's stable: two, so they can breed (`CONTEXT.md`: Starting city). */
export const START_HORSES = 2

/**
 * Food in a starting city's stable, in units: 20 game days for its horses, time to start
 * bringing it food from the farm.
 */
export const START_STABLE_FOOD = 30

/**
 * Food a horse eats per game day, in units (`CONTEXT.md`: Horse). More than a resident; its
 * hunger meter otherwise runs like a resident's (`HUNGER_DAYS`, `STARVE_DAYS`, `HEAL_DAYS`).
 */
export const HORSE_FOOD_PER_DAY = 0.75

/**
 * How far from its tile a horse reaches Food lying on the ground, in tiles either way
 * (`CONTEXT.md`: Horses have no inventory, "on its tile or right next to it"): its own tile and
 * the eight around it.
 */
export const HORSE_REACH = 1

/**
 * Share of a full hunger meter below which the tile card calls a horse hungry rather than fed;
 * at 0 it is starving.
 */
export const HORSE_HUNGRY_SHARE = 0.25

/** Most horses a stable has room for; it breeds no foal once that many stand in it. */
export const STABLE_CAPACITY = 6

/**
 * Game days two fed horses at a stable take to breed a foal (`CONTEXT.md`: Stable). Time without
 * two fed horses or without room does not count.
 */
export const STABLE_BREED_DAYS = 10

/**
 * A new horse's stats are whole numbers drawn from this range (`CONTEXT.md`: Horse stats), like a
 * resident's base stats.
 */
export const HORSE_STAT_MIN = 5
export const HORSE_STAT_MAX = 15

/** The stat at which a horse is average: it pulls, holds and eats as the plain numbers say. */
export const HORSE_STAT_AVERAGE = 10

/** An average horse's stats: the middle of the range, what horses from before stats got. */
export const AVERAGE_HORSE_STATS: Readonly<HorseStats> = {
  speed: HORSE_STAT_AVERAGE,
  strength: HORSE_STAT_AVERAGE,
  endurance: HORSE_STAT_AVERAGE,
}

/** A new horse is this many game years old, drawn in the range; foals start at 0. */
export const HORSE_START_AGE_MIN = 3
export const HORSE_START_AGE_MAX = 8

/** How much faster a horse pulls its carriage for each point of Speed above average (slower below). */
export const HORSE_SPEED_EFFECT = 0.04

/** The furthest Speed moves a horse's pace, either way, as a share of it. */
export const HORSE_SPEED_LIMIT = 0.5

/** How much more a carriage holds for each point of its horse's Strength above average (less below). */
export const HORSE_STRENGTH_EFFECT = 0.04

/** The furthest Strength moves what a carriage holds, either way, as a share of `CARRIAGE_CAPACITY`. */
export const HORSE_STRENGTH_LIMIT = 0.5

/** How much less Food a horse needs for each point of Endurance above average (more below). */
export const HORSE_ENDURANCE_EFFECT = 0.03

/** The furthest Endurance moves the Food a horse needs, either way. */
export const HORSE_ENDURANCE_LIMIT = 0.3

/** How far a horse stat is from average, as a share, at most `limit` either way. */
function horseStatShare(stat: number, effect: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, (stat - HORSE_STAT_AVERAGE) * effect))
}

/** How much faster than an average horse a horse goes, from its Speed (`CONTEXT.md`: Horse stats). */
export function horseSpeedFactor(horse: Pick<Horse, 'stats'>): number {
  return 1 + horseStatShare(horse.stats.speed, HORSE_SPEED_EFFECT, HORSE_SPEED_LIMIT)
}

/** How much more than usual a carriage pulled by the horse holds, from its Strength. */
export function horseStrengthFactor(horse: Pick<Horse, 'stats'>): number {
  return 1 + horseStatShare(horse.stats.strength, HORSE_STRENGTH_EFFECT, HORSE_STRENGTH_LIMIT)
}

/**
 * How much of `HORSE_FOOD_PER_DAY` a horse needs, from its Endurance, as `hungerFactor` is for a
 * resident.
 */
export function horseFoodFactor(horse: Pick<Horse, 'stats'>): number {
  return 1 - horseStatShare(horse.stats.endurance, HORSE_ENDURANCE_EFFECT, HORSE_ENDURANCE_LIMIT)
}

/** A horse's age in game years at the given tick; unlike a resident, a foal ages at the usual pace. */
export function horseAgeInYears(horse: Pick<Horse, 'bornAt'>, tick: number): number {
  return (tick - horse.bornAt) / TICKS_PER_GAME_YEAR
}

/**
 * Starting cities lie at least this many tiles apart (about 2.5 hours' walk on plains), when the
 * map has room; otherwise as far apart as it allows.
 */
export const CITY_MIN_DISTANCE = 1200

/**
 * How near a city building must stand to the city's town hall, or to another building already
 * part of that city, to be part of it too (`CONTEXT.md`: City building), in tiles along each
 * direction from footprint to footprint. A wall with gaps of up to eleven tiles still holds
 * together.
 */
export const CITY_BUILDING_REACH = 12

/**
 * How far around each of its buildings' footprints a city's area reaches (`CONTEXT.md`: City
 * area), in tiles along each direction: about the old 40 m tile right next to them.
 */
export const CITY_AREA_MARGIN = 4

/**
 * Most tiles a ring of walls and gates can shut in (`CONTEXT.md`: Walls in combat): ground cut
 * off by walls from more than this, a square of 400 tiles along each side, counts as outside.
 */
export const WALL_ENCLOSES_MAX = 160_000

/** How far a resident sees, in tiles (`CONTEXT.md`: Sight). */
export const SIGHT_RANGE = 48

/**
 * NPC villages placed on a full-size map (`CONTEXT.md`: NPC city); a smaller map gets fewer, by
 * its area. Fewer are placed when the map has no room left for them.
 */
export const NPC_VILLAGES = 12

/** NPC towns placed on a full-size map, like `NPC_VILLAGES`. Towns are placed first. */
export const NPC_TOWNS = 4

/**
 * NPC cities lie at least this many tiles from every other city, starting cities and NPC cities
 * alike (about an hour's walk on plains), the short way round the map.
 */
export const NPC_CITY_MIN_DISTANCE = 480

/** What an NPC city is placed with, by its size: a walled square like a starting city's. */
export interface NpcCitySize {
  /** Tiles along each side, wall included: an odd number, so its storage has a middle tile. */
  size: number
  /** Adult residents, with random stats like a starting city's. */
  residents: number
  /** Houses inside the wall, in a row north of the storage; room for everyone and a little more. */
  houses: number
  /** Farms outside the wall, by the gate; the residents start on them, working them. */
  farms: number
  /** Food in its storage, in units. */
  food: number
}

/** A village: a starting city's square, a few fewer residents, one farm. */
export const NPC_VILLAGE: NpcCitySize = { size: 29, residents: 6, houses: 2, farms: 1, food: 75 }

/** A town: a wider square, twice the residents of a starting city, two farms. */
export const NPC_TOWN: NpcCitySize = { size: 45, residents: 16, houses: 5, farms: 2, food: 200 }

/**
 * What an NPC city asks for each resident living there when it is bought (`CONTEXT.md`: Buying a
 * city), in Coins: five game days of one mint worker's coins (`RECIPES`, `BATCHES_PER_DAY`).
 */
export const CITY_PRICE_PER_RESIDENT = 200

/**
 * What an NPC city asks for each of its finished buildings when it is bought, in Coins, by kind;
 * a kind missing here adds nothing. A village (6 residents, a town hall, a storage, 2 houses, a
 * farm and its wall ring) comes to about 1 600 coins, which three residents can carry; a town to
 * about 4 000. A stretch of wall is a quarter of what it was on the old 40 m tiles.
 */
export const CITY_PRICE_BY_BUILDING: Partial<Record<BuildingKind, number>> = {
  townHall: 200,
  house: 50,
  storage: 50,
  farm: 30,
  stable: 40,
  wall: 0.5,
  gate: 1.25,
}

/**
 * An NPC city's Food runs short (`CONTEXT.md`: NPC city) when its storages hold less than its
 * residents eat in this many game days. It then puts residents on its farms first.
 */
export const NPC_FOOD_SHORT_DAYS = 5

/**
 * Units of Food a farm's pile keeps when a worker carries its output away (`CONTEXT.md`:
 * Carrying the output), so the workers there can still refill at their workplace (Refilling at a
 * workplace). Written into the Work default's source, where a Player can change it.
 */
export const WORK_FOOD_KEPT = 2

/**
 * Share of an NPC city's adults it keeps as soldiers (`CONTEXT.md`: NPC city, Soldier), rounded
 * up so even a village keeps one: a starting village (6 residents) keeps 2, a town (16) keeps 4.
 */
export const NPC_SOLDIER_SHARE = 0.25

/**
 * How near to an NPC city's gate, in tiles, an armed outsider makes it close its gates
 * (`CONTEXT.md`: NPC city): a little inside sight, so the gate shuts before they reach it.
 */
export const NPC_GATE_WATCH_RANGE = 32

/**
 * An NPC city keeps one pair for every this many of its adults (`CONTEXT.md`: NPC city,
 * Pairing): a village of six one pair, a town of sixteen two. Only the partner carrying the child
 * stops working, and only for `CARRYING_DAYS`.
 */
export const NPC_ADULTS_PER_PAIR = 6

/**
 * Game days a partner carries a child before it is born (`CONTEXT.md`: Carrying), not working
 * meanwhile: 10 game days, 4 real hours.
 */
export const CARRYING_DAYS = 10

/** Ticks from the start of carrying until the child is born (`CARRYING_DAYS`). */
export const CARRYING_TICKS = CARRYING_DAYS * TICKS_PER_GAME_DAY

/**
 * Most of an NPC city's adults that build at once (`CONTEXT.md`: NPC city): laying out, carrying
 * materials to the site, building or tearing down. The others keep working.
 */
export const NPC_BUILDERS = 2

/**
 * How many tiles further out an NPC city puts up its new wall when it has no room left inside
 * the old one (`CONTEXT.md`: NPC city), on every side, with the gate in the same place. At most
 * `CITY_BUILDING_REACH`, so the new wall stays part of the city once the old one is gone.
 */
export const NPC_WALL_STEP = 8

/**
 * How many tiles of wall an NPC city's builder fetches the materials for in one trip to the
 * storage (`CONTEXT.md`: NPC city, Fetching materials): a 40 m stretch's worth, so a long wall is
 * not one walk per tile. What a tile doesn't take goes to the next.
 */
export const NPC_WALL_TILES_PER_TRIP = 4

/**
 * How far from its home an NPC city looks for a resource node to build a workplace on when it
 * needs a material it has no workplace for (`CONTEXT.md`: NPC city), in tiles: about twenty
 * minutes' walk on plains.
 */
export const NPC_NODE_REACH = 160

/**
 * How far beyond its wall an NPC city looks for Plains to lay out a new farm on, in tiles. Farms
 * go beyond where its next wall would stand.
 */
export const NPC_FARM_REACH = 48

/**
 * What the Trade Org HQ is placed with (`CONTEXT.md`: Trade Org HQ): a round city, the largest on
 * the map, with two rings of wall around its town hall.
 */
export const TRADE_ORG_HQ = {
  /** Tiles from the middle of the town hall to the inner ring of wall, which holds its warehouses. */
  innerRadius: 16,
  /**
   * Tiles from the middle of the town hall to the outer ring of wall; about twice an NPC town's
   * width across.
   */
  outerRadius: 40,
  /**
   * Tiles from one outer ring to the next one it grows (`CONTEXT.md`: Trade Org HQ): as far as a
   * city building reaches (`CITY_BUILDING_REACH`), so the new ring joins the HQ, with a band of
   * houses between.
   */
  ringStep: 12,
  /** Gates in each ring, evenly round it, the first due north. */
  gates: 4,
  /** Adult residents, with random stats like a starting city's. */
  residents: 32,
  /** Houses between the rings: room for everyone and one house more. */
  houses: 9,
  /** Farms outside the outer ring, by its gates. */
  farms: 4,
  /** Food in its storage, in units: about two weeks of what everyone eats. */
  food: 225,
  /** Coins in its coin warehouse. */
  coins: 20_000,
  /** Goods in its goods warehouse, in units. */
  goods: { wood: 300, stone: 300, ironOre: 150, iron: 100, goldOre: 50 } as Partial<
    Record<Good, number>
  >,
}

/**
 * Starting cities lie at least this many tiles from the Trade Org HQ when the map has room
 * (`CITY_MIN_DISTANCE` for other starting cities), and the HQ is placed as far from every city
 * as the map allows.
 */
export const TRADE_ORG_HQ_MIN_DISTANCE = 1600

/**
 * How wide a region is for trading posts (`CONTEXT.md`: Trading post), in tiles along each side:
 * the map is cut into a grid of about this size, one post in each square. A full-size map gets
 * 4 × 4 = 16 posts, as many as it gets NPC cities; a small map gets at least one.
 */
export const TRADING_POST_REGION = 1440

/**
 * What a trading post is placed with (`CONTEXT.md`: Trading post): a walled village with a
 * warehouse. It keeps this size; it never grows.
 */
export const TRADING_POST = {
  /** Tiles along each side, wall included: a village's square. */
  size: 29,
  /**
   * Adult residents: enough for its farm and its one workplace, besides the quarter it keeps as
   * soldiers (`NPC_SOLDIER_SHARE`).
   */
  residents: 6,
  /** Houses inside the wall: room for everyone. */
  houses: 2,
  /** Farms outside the wall, by the gate. */
  farms: 1,
  /** Food in its storage, in units: about 25 game days of what everyone eats. */
  food: 75,
  /** Coins in its warehouse. */
  coins: 2_000,
  /** Goods in its warehouse, in units. */
  goods: { wood: 50, stone: 50, ironOre: 20, iron: 10, spear: 4 } as Partial<Record<Good, number>>,
}

/**
 * A trading post's stock floor (`CONTEXT.md`: Stock floor, ADR 0003), in units: once a game day
 * its warehouse tops up every good below this to this. Half of what a post starts with, so a
 * fresh post is well above it.
 */
export const WAREHOUSE_FLOOR: Record<Good, number> = {
  food: 20,
  wood: 25,
  stone: 25,
  ironOre: 10,
  iron: 5,
  goldOre: 5,
  coins: 1_000,
  spear: 2,
  sword: 1,
  shield: 2,
  armour: 1,
}

/** How many times a trading post's floor (`WAREHOUSE_FLOOR`) the Trade Org HQ's warehouses keep. */
export const HQ_FLOOR_FACTOR = 5

/**
 * What a warehouse sells a unit of each good for, in coins, when it holds `PRICE_REFERENCE_FLOORS`
 * times its floor (`CONTEXT.md`: Warehouse prices, Price anchor). Roughly what goes into it: an
 * iron is two iron ore and the work, a sword two iron and a wood; gold ore stays below the 20
 * coins the mint strikes from it.
 */
export const WAREHOUSE_BASE_PRICE: Record<Exclude<Good, 'coins'>, number> = {
  food: 2,
  wood: 2,
  stone: 2,
  ironOre: 4,
  iron: 10,
  goldOre: 15,
  spear: 20,
  sword: 30,
  shield: 22,
  armour: 90,
}

/** Stock, in floors, at which a warehouse sells at its base price; less stock costs more. */
export const PRICE_REFERENCE_FLOORS = 4

/**
 * How strongly prices follow stock: the sell price is the base price times (reference stock /
 * stock) to this power, so half the stock costs about 1.4 times as much.
 */
export const PRICE_ELASTICITY = 0.5

/** The lowest and highest a sell price goes, as shares of the base price. */
export const PRICE_RANGE = { min: 0.5, max: 4 }

/**
 * The share of its sell price a warehouse pays when it buys (`CONTEXT.md`: Price anchor): it
 * buys low and sells high, so Players usually get better deals trading with each other.
 */
export const BUY_SHARE = 0.6

/**
 * Residents of the Trade Org HQ who walk along with each caravan as its escort, besides its
 * driver (`CONTEXT.md`: Caravan), on a route never robbed.
 */
export const CARAVAN_ESCORTS = 2

/**
 * Robberies of a route that earn its caravan one more escort (`CONTEXT.md`: Caravan, a route that
 * is attacked more often gets more escorts): the second robbery adds the first extra escort.
 */
export const CARAVAN_ROBBERIES_PER_ESCORT = 2

/** The most escorts a caravan walks with, however often its route was robbed. */
export const CARAVAN_ESCORTS_MAX = 8

/**
 * Extra Food a caravan keeps on board for each escort beyond `CARAVAN_ESCORTS`, in units: the
 * same ~32 game days of `FOOD_PER_DAY` as `CARAVAN_FOOD`.
 */
export const CARAVAN_FOOD_PER_ESCORT = 16

/**
 * How near its carriage, in tiles, a caravan's escort defends it (`CONTEXT.md`: Caravan): they go
 * after robbers and attackers of the crew this close, and give up a chase that leads further.
 */
export const CARAVAN_GUARD_RANGE = 16

/**
 * Food a caravan keeps on board for its crew and its horse, in units, topped up at the storage
 * at each end of its route (`CONTEXT.md`: Caravan): a driver, two escorts and a horse eat 2.25 a
 * game day, so this lasts about 32 game days, twice the longest leg on a full-size map (~15).
 */
export const CARAVAN_FOOD = 72

/**
 * How many tiles further along their way a caravan's driver or an escort may get than the one
 * furthest behind (`CONTEXT.md`: Caravan): one ahead waits, so the escort keeps up with the
 * carriage.
 */
export const CARAVAN_SPREAD = 8

/**
 * The part of a delivery's fee every delivery or pick-up pays, in coins (`CONTEXT.md`:
 * Delivery), however light or near.
 */
export const DELIVERY_FEE_BASE = 5

/**
 * The part of a delivery's fee that grows with weight and distance, in coins per kg and tile from
 * the warehouse to the city's storage (`CONTEXT.md`: Delivery). 100 kg over 400 tiles, about a
 * trading post's region, costs 50: a tenth of what 100 iron fetch, a lot for cheap Food.
 */
export const DELIVERY_FEE_PER_KG_TILE = 0.00125

/**
 * How often a caravan's drive towards a delivery's storage may end short of it before it turns
 * back (`CONTEXT.md`: Delivery), say behind closed gates or out of reach of carriages.
 */
export const DELIVERY_DRIVE_TRIES = 3

/**
 * How many times a delivery's fee a transfer between realms costs, for its weight over the
 * caravan's whole way (`CONTEXT.md`: Transfer): clearly higher, since the Trade Organization
 * carries for others what they could carry themselves. 100 iron over a region and back cost
 * about 300 coins.
 */
export const TRANSFER_FEE_FACTOR = 3

/** Large seas the generator makes, roughly; together they cover `TERRAIN_SHARES.sea`. */
export const SEA_COUNT = 3

/**
 * What one unit of each good weighs, in kg (`CONTEXT.md`: Good). Coins are light but not
 * weightless, so a fortune still has to be carried. Weapons and armour weigh what went into them
 * (`RECIPES`): an average resident (30 kg) in armour with a sword and a shield has half
 * their room left for food.
 */
export const GOOD_WEIGHT: Record<Good, number> = {
  food: 1,
  wood: 1,
  stone: 1,
  ironOre: 1,
  iron: 1,
  goldOre: 1,
  coins: 0.02,
  spear: 3,
  sword: 3,
  shield: 4,
  armour: 8,
}

/**
 * Attack each weapon adds to a resident's blow (`CONTEXT.md`: Weapons and armour, Combat). A
 * sword hits harder than a spear; combat (T10.2) adds it to Strength and Combat skill.
 */
export const WEAPON_ATTACK: Record<Weapon, number> = {
  spear: 4,
  sword: 6,
}

/**
 * Damage each piece of protection takes off a blow (`CONTEXT.md`: Weapons and armour, Combat).
 * Armour takes off more than a shield but weighs twice as much.
 */
export const PROTECTION_DEFENCE: Record<Protection, number> = {
  shield: 3,
  armour: 5,
}

/** Carry capacity of a resident with no Strength at all, in kg. */
export const CARRY_BASE = 10

/** Carry capacity each point of effective Strength adds, in kg. */
export const CARRY_PER_STRENGTH = 2

/** What some goods weigh together, in kg. */
export function stockWeight(stock: Stock): number {
  return (Object.entries(stock) as [Good, number][]).reduce(
    (kg, [good, units]) => kg + units * GOOD_WEIGHT[good],
    0,
  )
}

/** The most weight a resident can carry at the given tick, in kg (`CONTEXT.md`: Carry capacity). */
export function carryCapacity(resident: Resident, tick: number): number {
  return CARRY_BASE + CARRY_PER_STRENGTH * statValue(resident, 'strength', tick)
}

/** Food a resident of average Endurance eats per game day, in units (`CONTEXT.md`: Hunger). */
export const FOOD_PER_DAY = 0.5

/**
 * A resident at home is running low on food when they carry fewer units than this: less than one
 * meal, two game days' eating (`CONTEXT.md`: Eating). They then take meals from their city's storage.
 */
export const HOME_FOOD_LOW = 1

/**
 * A resident's own food (`CONTEXT.md`: Own food), in units: four game days of meals. Putting goods
 * away leaves it in their hands unless the Player asks for an exact amount (`putAwayUnits`); NPC
 * residents always keep it, so nobody walks to the storage for the food they carry anyway.
 */
export const OWN_FOOD = 4 * FOOD_PER_DAY

/**
 * Units of food in one meal, what a resident at home takes from storage at a time: two game days'
 * eating.
 */
export const MEAL_UNITS = 1

/**
 * Game days a full hunger meter lasts without eating, at average Endurance. A unit of food fills
 * two thirds of it, so a fed resident's meter never drops below a third. With `STARVE_DAYS`, a
 * resident dies about 5 game days (2 real hours) after their last meal.
 */
export const HUNGER_DAYS = 3

/** Game days an empty hunger meter takes to cost a resident all their health. */
export const STARVE_DAYS = 2

/** Game days a fed resident takes to heal from no health back to full. */
export const HEAL_DAYS = 3

/** The Endurance at which a resident needs exactly `FOOD_PER_DAY`. */
export const HUNGER_ENDURANCE_AVERAGE = 10

/** How much less food each point of Endurance above average needs (more below it). */
export const HUNGER_ENDURANCE_EFFECT = 0.02

/** The furthest Endurance moves the food a resident needs, either way. */
export const HUNGER_ENDURANCE_LIMIT = 0.3

/** How much of the usual food a resident needs, from their Endurance at the given tick. */
export function hungerFactor(resident: Resident, tick: number): number {
  const away = statValue(resident, 'endurance', tick) - HUNGER_ENDURANCE_AVERAGE
  const change = Math.max(
    -HUNGER_ENDURANCE_LIMIT,
    Math.min(HUNGER_ENDURANCE_LIMIT, away * HUNGER_ENDURANCE_EFFECT),
  )
  return 1 - change
}

/**
 * How much food a resident burns on each terrain, relative to Plains (`CONTEXT.md`: Terrain).
 * Endurance softens the extra (`foodUse`).
 */
export const TERRAIN_FOOD = {
  [Terrain.Plains]: 1,
  [Terrain.Forest]: 1,
  [Terrain.Hills]: 1.3,
  [Terrain.Mountain]: 2,
  /** On a road residents eat as on Plains, whatever the terrain beneath. */
  [Terrain.Road]: 1,
} as const satisfies Partial<Record<Terrain, number>>

/** How much of a terrain's extra food use each point of Endurance above average takes away. */
export const ENDURANCE_TERRAIN_EFFECT = 0.03

/**
 * How much of the usual food a resident needs on a tile of the given terrain at the given tick
 * (`CONTEXT.md`: Terrain, Hunger): their `hungerFactor`, times the terrain's extra food use
 * softened by Endurance (by up to `HUNGER_ENDURANCE_LIMIT` of it, either way).
 */
export function foodUse(resident: Resident, terrain: number, tick: number): number {
  const extra = ((TERRAIN_FOOD as Partial<Record<number, number>>)[terrain] ?? 1) - 1
  const away = statValue(resident, 'endurance', tick) - HUNGER_ENDURANCE_AVERAGE
  const soften = Math.max(
    -HUNGER_ENDURANCE_LIMIT,
    Math.min(HUNGER_ENDURANCE_LIMIT, away * ENDURANCE_TERRAIN_EFFECT),
  )
  return hungerFactor(resident, tick) * (1 + extra * (1 - soften))
}

/**
 * A city has a food surplus when its storages hold more Food than all its residents eat in this
 * many game days (`CONTEXT.md`: Food surplus). Food residents carry doesn't count.
 */
export const FOOD_SURPLUS_DAYS = 10

/**
 * A child's base stats are the parents' average, rounded, plus a whole random amount of at most
 * this much either way (`CONTEXT.md`: Child), and never below 1.
 */
export const CHILD_STAT_SPREAD = 2

/**
 * Ticks (real seconds) an unloaded resident of average Agility takes to walk a plains tile
 * (`CONTEXT.md`: Tile). Carriages go at a multiple of this (`CARRIAGE_SPEED`).
 */
export const WALK_TICKS_PER_TILE = 7.5

/**
 * How dear a way may be before a path search gives up on it: this many times the cheapest the
 * way could possibly cost (every step on the cheapest ground), plus `PATH_DETOUR_SLACK`. A goal
 * only behind a longer detour counts as unreachable, so a search for one never crosses the
 * whole map.
 */
export const PATH_DETOUR_LIMIT = 8

/** The fixed part of a path search's limit (`PATH_DETOUR_LIMIT`), in plains-tiles on foot. */
export const PATH_DETOUR_SLACK = 500

/** The Agility at which a resident walks at the usual speed. */
export const AGILITY_AVERAGE = 10

/** How much faster each point of Agility above average walks (slower below). */
export const AGILITY_SPEED_EFFECT = 0.02

/** How much of a terrain's slowdown each point of Agility above average takes away. */
export const AGILITY_TERRAIN_EFFECT = 0.03

/** The furthest Agility moves either effect, up or down. */
export const AGILITY_LIMIT = 0.3

/**
 * How many tiles per tick a resident walks onto a tile of the given terrain (`CONTEXT.md`:
 * Terrain, Stats): plains speed from Agility at the given tick, and the terrain's slowdown softened by Agility.
 * A road's speed-up comes on top, as it is. Zero for terrain nobody can enter.
 */
export function walkSpeed(resident: Resident, terrain: number, tick: number): number {
  const base = (TERRAIN_SPEED as Partial<Record<number, number>>)[terrain]
  if (!base) return 0
  const away = statValue(resident, 'agility', tick) - AGILITY_AVERAGE
  const clamp = (v: number) => Math.max(-AGILITY_LIMIT, Math.min(AGILITY_LIMIT, v))
  const pace = 1 + clamp(away * AGILITY_SPEED_EFFECT)
  const slowdown = Math.max(0, 1 - base) * (1 - clamp(away * AGILITY_TERRAIN_EFFECT))
  const speedUp = Math.max(0, base - 1)
  return (pace * (1 - slowdown + speedUp)) / WALK_TICKS_PER_TILE
}

/**
 * Most weight a carriage carries, in kg (`CONTEXT.md`: Carriage): about thirteen residents of
 * average Strength, so one carriage moves what a whole starting city could carry.
 */
export const CARRIAGE_CAPACITY = 400

/**
 * Up to this share of `CARRIAGE_CAPACITY` a carriage whose load a Player can't see looks lightly
 * loaded (`CONTEXT.md`: Seeing inside a storage, `loadLevel`).
 */
export const CARRIAGE_LIGHT_LOAD = 1 / 3

/** Up to this share of `CARRIAGE_CAPACITY` it looks half loaded; above it, heavily. */
export const CARRIAGE_HALF_LOAD = 2 / 3

/**
 * The most one delivery or pick-up carries, in kg (`CONTEXT.md`: Delivery): a caravan's carriage
 * with room left for the Food it keeps on board (`CARAVAN_FOOD`, a kg a unit).
 */
export const DELIVERY_LOAD = CARRIAGE_CAPACITY - CARAVAN_FOOD

/**
 * Food a haul route keeps on board for its horse unless the Player picks another amount, in
 * units (`CONTEXT.md`: Haul route): five game days (two real hours) of the horse's eating, topped
 * up at each stop that has Food. A trip takes real time, so this keeps its real-time length;
 * rounded up to whole units.
 */
export const HAUL_KEEP_FOOD = Math.ceil(5 * HORSE_FOOD_PER_DAY)

/**
 * How fast a carriage crosses each terrain, relative to an unloaded resident of average Agility on
 * Plains (`CONTEXT.md`: Carriage): twice as fast on Plains, a little slower than walking in Forest
 * and Hills, and faster still on a road. Mountains are missing: a carriage cannot enter them.
 */
export const CARRIAGE_SPEED = {
  [Terrain.Plains]: 2,
  [Terrain.Forest]: 0.6,
  [Terrain.Hills]: 0.6,
  /** A road, whatever the terrain beneath (`CONTEXT.md`: Road): 1.3 times Plains, as on foot. */
  [Terrain.Road]: 2.6,
} as const satisfies Partial<Record<Terrain, number>>

/** How much faster a carriage goes for each point of its driver's Driving skill. */
export const DRIVING_SKILL_EFFECT = 0.02

/** The furthest Driving skill speeds a carriage up, as a share of its speed. */
export const DRIVING_SKILL_LIMIT = 0.5

/** Driving skill a driver of average Intellect gains per game day of driving. */
export const DRIVING_SKILL_PER_DAY = 1

/** Whether a carriage can enter a tile of the given terrain: passable land, but no mountains. */
export function carriageCanEnter(terrain: number): boolean {
  return ((CARRIAGE_SPEED as Partial<Record<number, number>>)[terrain] ?? 0) > 0
}

/**
 * How many tiles per tick a carriage driven by `driver` and pulled by `horse` goes onto a tile of
 * the given terrain (`CONTEXT.md`: Carriage, Horse stats): the terrain's `CARRIAGE_SPEED`, scaled
 * by the horse's Speed, and up to `DRIVING_SKILL_LIMIT` faster with Driving skill. The horse sets
 * the pace, so the driver's Agility does not count. Zero for terrain a carriage cannot enter.
 */
export function driveSpeed(driver: Resident, horse: Pick<Horse, 'stats'>, terrain: number): number {
  const base = (CARRIAGE_SPEED as Partial<Record<number, number>>)[terrain] ?? 0
  const skilled =
    1 + Math.min(DRIVING_SKILL_LIMIT, (driver.skills.driving ?? 0) * DRIVING_SKILL_EFFECT)
  return (base * horseSpeedFactor(horse) * skilled) / WALK_TICKS_PER_TILE
}

/** How fast a hungry horse goes under its rider (`HORSE_HUNGRY_SHARE`), as a share of its pace. */
export const HUNGRY_HORSE_PACE = 0.5

/**
 * How many tiles per tick a resident riding `horse` goes onto a tile of the given terrain
 * (`CONTEXT.md`: Riding): as fast as the horse would pull a carriage there (`driveSpeed`), and
 * only `HUNGRY_HORSE_PACE` of that while the horse is hungry. Zero where no carriage can go.
 */
export function rideSpeed(
  rider: Resident,
  horse: Pick<Horse, 'stats' | 'hunger'>,
  terrain: number,
): number {
  const hungry = horse.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER
  return driveSpeed(rider, horse, terrain) * (hungry ? HUNGRY_HORSE_PACE : 1)
}

/**
 * Most weight a carriage pulled by `horse` holds, in kg (`CONTEXT.md`: Horse stats):
 * `CARRIAGE_CAPACITY`, scaled by the horse's Strength. A carriage with no horse holds
 * `CARRIAGE_CAPACITY`.
 */
export function carriageCapacityWith(horse: Pick<Horse, 'stats'> | undefined): number {
  return horse ? CARRIAGE_CAPACITY * horseStrengthFactor(horse) : CARRIAGE_CAPACITY
}

/** The most any carriage can hold, behind the strongest horse. */
export const CARRIAGE_MAX_CAPACITY = CARRIAGE_CAPACITY * (1 + HORSE_STRENGTH_LIMIT)

/**
 * Driving skill a driver learns from one tick of driving (`CONTEXT.md`: Skill, learned by doing),
 * faster with more Intellect.
 */
export function drivingLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  return (DRIVING_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace
}

/**
 * Share of the Food in one place (a storage, a resident's or carriage's load, a pile) that goes
 * bad each game day (`CONTEXT.md`: Spoilage). Half of a stock is gone in about 140 game days.
 */
export const FOOD_SPOIL_PER_DAY = 0.005

/**
 * Events kept in each Player's realm log; the oldest go first. A Player who logs
 * in sees these, so a few game days of a busy realm should fit.
 */
export const REALM_LOG_LENGTH = 100

/**
 * How long, in game days, an Organization remembers a crime once it is known and nobody carries
 * news of it any more (`CONTEXT.md`: Crime). About seven real hours: long enough to count as
 * "recent".
 */
export const CRIME_MEMORY_DAYS = 18

/** How far standing goes each way from neutral (`CONTEXT.md`: Standing): -100 to +100. */
export const STANDING_RANGE = 100

/**
 * What a crime costs in the victim's standing toward the culprit's Organization once the victim
 * knows of it (`CONTEXT.md`: Standing). Killing is the worst; a theft is forgiven soonest.
 */
export const CRIME_STANDING_LOSS: Record<CrimeKind, number> = {
  theft: 10,
  attack: 15,
  tearDown: 20,
  killing: 30,
}

/**
 * Coins of trade that raise standing by one point, both ways between the trader's realm and the
 * Trade Organization (`CONTEXT.md`: Standing). About two spears' worth.
 */
export const STANDING_TRADE_COINS_PER_POINT = 50

/** Standing each paid game week of a mercenary contract raises, both ways between its sides. */
export const STANDING_PER_PAID_WEEK = 0.8

/** What a contract broken by an unpaid week costs in the lender's standing toward the hirer. */
export const STANDING_CONTRACT_BROKEN_LOSS = 20

/**
 * Points standing drifts back toward neutral each game day (`CONTEXT.md`: Standing): a killing is
 * forgotten in about 75 game days, a little over a real day.
 */
export const STANDING_DRIFT_PER_DAY = 0.4

/**
 * Below this standing toward an Organization an NPC city won't trade with it or hire out to it
 * and keeps its gates shut to its residents (`CONTEXT.md`: NPC city reaction). A killing known
 * to it, not a single theft or attack.
 */
export const NPC_CITY_REFUSES_STANDING = -25

/**
 * Below this standing toward a realm an NPC city won't sell itself to it at all (`CONTEXT.md`:
 * NPC city reaction). Two killings known to it.
 */
export const NPC_CITY_WONT_SELL_STANDING = -60

/**
 * How far standing moves an NPC city's price (`CONTEXT.md`: Buying a city): its price times
 * 1 - this × standing / `STANDING_RANGE`, so half price at the best standing and half again as
 * much at the worst.
 */
export const CITY_PRICE_STANDING_SWING = 0.5

/** Trading with and hiring from an NPC city (`CONTEXT.md`: Trading with / Hiring from an NPC city). */
export const NPC_TRADE = {
  /**
   * Game days of Food for all its residents an NPC city keeps in reserve and never sells: more
   * than its food surplus line (`FOOD_SURPLUS_DAYS`), so selling never stops it growing.
   */
  reserveFoodDays: 15,
  /**
   * Stretches of wall whose materials it keeps in reserve, beside a house's (`BUILD_MATERIALS`):
   * with a house that makes 68 Wood.
   */
  reserveWallStretches: 16,
  /**
   * What it asks for each resident it lends and game week, in coins, at neutral standing: less
   * than a Trade Org soldier (`TRADE_ORG_ARMY.pricePerSoldierWeek`), as they come mostly unarmed.
   */
  pricePerResidentWeek: 5,
  /** Share of its adults, rounded up, it keeps at home to defend it and never lends. */
  defenceShare: 0.25,
}

/**
 * The standing an NPC city needs toward a realm before it asks to join it (`CONTEXT.md`:
 * Persuading a city): "high standing", where the standing list starts calling it trusted.
 */
export const PERSUADE_STANDING = 50

/**
 * How often, in ticks, an NPC city weighs whether to ask a realm to join (`CONTEXT.md`:
 * Persuading a city): once a game hour (a real minute), so standing and respect aren't counted
 * every tick.
 */
export const PERSUADE_CHECK_TICKS = 60

/**
 * Game days an NPC city waits after a realm declined it before it asks that realm again
 * (`CONTEXT.md`: Persuading a city). As long as a remembered crime.
 */
export const PERSUADE_ASK_AGAIN_DAYS = 18

/**
 * The standing a self-managed city starts out holding its former Player in (`CONTEXT.md`:
 * Self-managed city): good, and like any standing gone in about 150 game days, two and a half
 * real days.
 */
export const FORMER_PLAYER_STANDING = 60

/**
 * Below this standing toward an Organization the Trade Organization refuses to trade with it
 * (`CONTEXT.md`: Trade Org reaction): no buying or selling at its warehouses, no hiring its
 * soldiers, no hiring theirs. Any known crime against it gets there; a theft is forgiven in about
 * 12 game days.
 */
export const TRADE_ORG_REFUSES_TRADE_BELOW = -5

/**
 * Below this standing toward an Organization the Trade Organization sends its army to punish it
 * for the crimes against it it knows of (`CONTEXT.md`: Trade Org reaction). Lower than refusing
 * trade, and still above what a single theft costs, since it punishes anyone who steals from it
 * (`CONTEXT.md`: Self-interest).
 */
export const TRADE_ORG_PUNISHES_BELOW = -8

/**
 * What a crime costs the Trade Organization in Coins, besides stolen goods, which are worth their
 * warehouse base price (`WAREHOUSE_BASE_PRICE`): a resident wounded, one killed (worth as much as
 * a resident in a city's price, `CITY_PRICE_PER_RESIDENT`), or a building torn down.
 */
export const TRADE_ORG_LOSS: Record<Exclude<CrimeKind, 'theft'>, number> = {
  attack: 50,
  killing: 200,
  tearDown: 150,
}

/**
 * How the Trade Organization's army punishes (`CONTEXT.md`: Trade Org reaction): it takes back
 * `times` what it lost, sends at most `soldiers` of its spare soldiers, and gives up and goes
 * home after `giveUpDays` game days out if it can't get it all.
 */
export const TRADE_ORG_PUNISH = {
  times: 2,
  soldiers: 8,
  giveUpDays: 12,
}

/**
 * What the Trade Organization's army comes to take, in Coins' worth, each time it goes out against
 * the target of an admin directive (`CONTEXT.md`: Admin directive), which names no crimes to weigh
 * it by: as much as it takes back for a killing (`TRADE_ORG_PUNISH.times` its loss). It goes again
 * as soon as one punishment is over, until the directive is lifted.
 */
export const DIRECTIVE_PUNISH_WORTH = 400

/**
 * The price, in Coins, the admin panel offers for buying off an admin directive (`CONTEXT.md`:
 * Admin directive) when an admin allows it; they may set another. A couple of punishments'
 * worth (`DIRECTIVE_PUNISH_WORTH`), and 20 kg of coins: a resident's hands or a carriage can
 * bring it.
 */
export const DIRECTIVE_BUY_OFF_PRICE = 1000

/**
 * Materials each kind of building needs before its construction site can become the building
 * (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
 * the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
 * the smelter's iron goes into the mint and the smithy.
 */
export const BUILD_MATERIALS: Partial<Record<BuildingKind, Stock>> = {
  lumberCamp: {},
  quarry: { wood: 30 },
  mine: { wood: 40, stone: 20 },
  stable: { wood: 40 },
  smelter: { stone: 40, wood: 20 },
  mint: { stone: 40, iron: 10 },
  smithy: { stone: 30, wood: 20, iron: 10 },
  townHall: { wood: 60, stone: 40 },
  /** A tile of wall: about a quarter of what a 40 m stretch took. */
  wall: { wood: 3 },
  /** A gate, of a wall's tile. */
  gate: { wood: 4 },
  /**
   * A tile of road (`CONTEXT.md`: Road): a little Stone, so a quarry pays for a long road; about a
   * quarter of what a 40 m tile took.
   */
  road: { stone: 1 },
  /** A house (`CONTEXT.md`: House): timber for four residents' room. */
  house: { wood: 20 },
  /** A storage (`CONTEXT.md`: Storage): a timber store on a stone floor, a little more than a house. */
  storage: { wood: 30, stone: 10 },
  /** A farm is fields on Plains: work, but no materials, so a city can always feed itself. */
  farm: {},
}

/**
 * Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
 * lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
 * a mint 5, a smithy 5, a town hall 6. A tile of wooden wall takes a sixteenth of a game day, a
 * gate an eighth, a tile of road a sixteenth (a quarter of what a 40 m tile took), a house one
 * game day, a storage two and a farm half of one. More or stronger workers finish it sooner
 * (`buildWork`).
 */
export const BUILD_WORK: Partial<Record<BuildingKind, number>> = {
  lumberCamp: 2 * TICKS_PER_GAME_DAY,
  quarry: 3 * TICKS_PER_GAME_DAY,
  mine: 4 * TICKS_PER_GAME_DAY,
  stable: 3 * TICKS_PER_GAME_DAY,
  smelter: 4 * TICKS_PER_GAME_DAY,
  mint: 5 * TICKS_PER_GAME_DAY,
  smithy: 5 * TICKS_PER_GAME_DAY,
  townHall: 6 * TICKS_PER_GAME_DAY,
  wall: TICKS_PER_GAME_DAY / 16,
  gate: TICKS_PER_GAME_DAY / 8,
  road: TICKS_PER_GAME_DAY / 16,
  house: TICKS_PER_GAME_DAY,
  storage: 2 * TICKS_PER_GAME_DAY,
  farm: TICKS_PER_GAME_DAY / 2,
}

/**
 * The most tiles one road order along a line may cover (`roadLine`): about a game week of one
 * resident's work, so a long road is a few orders rather than one that runs for months.
 */
export const ROAD_LINE_MAX_TILES = 128

/** The Strength at which a resident puts in one unit of building work per tick. */
export const BUILD_STRENGTH_AVERAGE = 10

/** How much more work each point of Construction skill puts in per tick: 1 % a point. */
export const CONSTRUCTION_SKILL_EFFECT = 0.01

/**
 * The furthest Construction skill speeds building work up, as a share of it: +100 %, reached at
 * `CONSTRUCTION_SKILL_MAX` points, beyond which nobody learns.
 */
export const CONSTRUCTION_SKILL_LIMIT = 1

/** The most Construction skill a resident can have: where it reaches `CONSTRUCTION_SKILL_LIMIT`. */
export const CONSTRUCTION_SKILL_MAX = CONSTRUCTION_SKILL_LIMIT / CONSTRUCTION_SKILL_EFFECT

/**
 * Construction skill a resident of average Intellect gains per game day of building work: the
 * cap takes about a game year (one real week).
 */
export const CONSTRUCTION_SKILL_PER_DAY = 100 / 420

/** The Intellect at which a resident learns at the usual pace (`CONTEXT.md`: Stats). */
export const INTELLECT_AVERAGE = 10

/**
 * Building work a resident puts in per tick at the given tick (`CONTEXT.md`: Construction site):
 * in proportion to Strength, plus `CONSTRUCTION_SKILL_EFFECT` for each point of Construction, up
 * to `CONSTRUCTION_SKILL_LIMIT`.
 */
export function buildWork(resident: Resident, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / BUILD_STRENGTH_AVERAGE
  const skill = (resident.skills.construction ?? 0) * CONSTRUCTION_SKILL_EFFECT
  return strength * (1 + Math.min(CONSTRUCTION_SKILL_LIMIT, skill))
}

/**
 * Construction skill a resident learns from one tick of building work (`CONTEXT.md`: Skill,
 * learned by doing), faster with more Intellect, and never past `CONSTRUCTION_SKILL_MAX`.
 */
export function constructionLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  const room = Math.max(0, CONSTRUCTION_SKILL_MAX - (resident.skills.construction ?? 0))
  return Math.min(room, (CONSTRUCTION_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace)
}

/**
 * Most residents who can work each kind of workplace at a time (`CONTEXT.md`: Workplace). A farm
 * has room for a whole starting city; the workplaces on nodes for a smaller crew; smelters,
 * mints and smithies for a few.
 */
export const WORKPLACE_MAX_WORKERS: Partial<Record<BuildingKind, number>> = {
  farm: 10,
  lumberCamp: 6,
  quarry: 6,
  mine: 8,
  smelter: 4,
  mint: 4,
  smithy: 4,
}

/**
 * The skill each kind of workplace uses and teaches (`CONTEXT.md`: Skill): Farming on a farm,
 * Woodcutting in a lumber camp, Mining in quarries and mines, Smelting in smelters and mints,
 * Smithing in a smithy.
 */
export const WORKPLACE_SKILL: Partial<Record<BuildingKind, SkillName>> = {
  farm: 'farming',
  lumberCamp: 'woodcutting',
  quarry: 'mining',
  mine: 'mining',
  smelter: 'smelting',
  mint: 'smelting',
  smithy: 'smithing',
}

/** What a workplace that processes goods turns into what, one batch at a time. */
export interface Recipe {
  /** Goods one batch uses up. */
  input: Stock
  /** Goods one batch makes. */
  output: Stock
}

/**
 * The fixed recipes of the workplaces that process goods (`CONTEXT.md`: Smelter, Coins, Smithy).
 * A smelter turns 2 iron ore into 1 iron, a mint 1 gold ore into 20 coins (less weight than the
 * ore, but a fortune still weighs something). A smithy has one recipe for each weapon and piece
 * of armour, each from Iron and Wood weighing what the good weighs (`GOOD_WEIGHT`): a spear is
 * mostly wood, a sword mostly iron, a shield wood bound with iron, armour nearly all iron.
 */
export const RECIPES: Partial<Record<BuildingKind, readonly Recipe[]>> = {
  smelter: [{ input: { ironOre: 2 }, output: { iron: 1 } }],
  mint: [{ input: { goldOre: 1 }, output: { coins: 20 } }],
  smithy: [
    { input: { iron: 1, wood: 2 }, output: { spear: 1 } },
    { input: { iron: 2, wood: 1 }, output: { sword: 1 } },
    { input: { iron: 1, wood: 3 }, output: { shield: 1 } },
    { input: { iron: 7, wood: 1 }, output: { armour: 1 } },
  ],
}

/**
 * Batches one worker of average Strength and no skill gets through per game day: a smelter worker
 * smelts what two miners dig (4 iron ore into 2 iron), a mint worker strikes what two gold miners
 * dig (2 gold ore into 40 coins), a smithy worker makes two weapons or pieces of armour.
 */
export const BATCHES_PER_DAY: Partial<Record<BuildingKind, number>> = {
  smelter: 2,
  mint: 2,
  smithy: 2,
}

/**
 * Units of each good one worker of average Strength and no skill makes per game day. Food is four
 * times the `FOOD_PER_DAY` a resident eats, so about a quarter of a city farms; ore is slow, and
 * gold ore slowest.
 */
export const WORK_OUTPUT_PER_DAY: Partial<Record<Good, number>> = {
  food: 2,
  wood: 4,
  stone: 3,
  ironOre: 2,
  goldOre: 1,
}

/** The Strength at which a worker makes `WORK_OUTPUT_PER_DAY`. */
export const WORK_STRENGTH_AVERAGE = 10

/** How much more each point of the workplace's skill makes: 1 % a point. */
export const WORK_SKILL_EFFECT = 0.01

/**
 * The furthest a workplace's skill raises output, as a share of it: +100 %, so a worker makes at
 * most twice what an unskilled one does, reached at `WORK_SKILL_MAX` points.
 */
export const WORK_SKILL_LIMIT = 1

/** The most of a workplace's skill a resident can have: where it reaches `WORK_SKILL_LIMIT`. */
export const WORK_SKILL_MAX = WORK_SKILL_LIMIT / WORK_SKILL_EFFECT

/**
 * Skill a worker of average Intellect gains per game day of work at a workplace: the cap takes
 * about a game year (one real week).
 */
export const WORK_SKILL_PER_DAY = 100 / 420

/**
 * How much of a unit of `good` a worker makes per tick at the given tick, using `skill`
 * (`CONTEXT.md`: Workplace): in proportion to Strength, plus `WORK_SKILL_EFFECT` for each point
 * of the skill, up to `WORK_SKILL_LIMIT`.
 */
export function workOutput(resident: Resident, good: Good, skill: SkillName, tick: number): number {
  return workPace(resident, WORK_OUTPUT_PER_DAY[good] ?? 0, skill, tick)
}

/**
 * How much of a batch a worker gets through per tick at a workplace that processes goods
 * (`RECIPES`), at the given tick: like `workOutput`, at the kind's `BATCHES_PER_DAY`.
 */
export function batchWork(resident: Resident, kind: BuildingKind, tick: number): number {
  const skill = WORKPLACE_SKILL[kind]
  return skill ? workPace(resident, BATCHES_PER_DAY[kind] ?? 0, skill, tick) : 0
}

/** `perDay` a game day, as a share per tick: in proportion to Strength, more with the skill. */
function workPace(resident: Resident, perDay: number, skill: SkillName, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / WORK_STRENGTH_AVERAGE
  const skilled = 1 + Math.min(WORK_SKILL_LIMIT, (resident.skills[skill] ?? 0) * WORK_SKILL_EFFECT)
  return (perDay / TICKS_PER_GAME_DAY) * strength * skilled
}

/**
 * How much of `skill` a worker learns from one tick of work at a workplace (`CONTEXT.md`: Skill,
 * learned by doing), faster with more Intellect, and never past `WORK_SKILL_MAX`.
 */
export function workLearned(resident: Resident, skill: SkillName, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  const room = Math.max(0, WORK_SKILL_MAX - (resident.skills[skill] ?? 0))
  return Math.min(room, (WORK_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace)
}
/**
 * Tearing down takes less work than building (`CONTEXT.md`: Tearing down): this share of the
 * building's `BUILD_WORK`, or of the work put into an unfinished site so far.
 */
export const TEARDOWN_WORK_SHARE = 0.5

/**
 * Share of a finished building's materials left in its pile when it is torn down, rounded down
 * to whole units. An unfinished site leaves all its delivered materials.
 */
export const TEARDOWN_MATERIALS_RETURNED = 0.5

/**
 * How long after a realm says it leaves an alliance, or the alliance leader removes it, it stops
 * being a member (`CONTEXT.md`: Alliance): one real hour, time enough for the others to react.
 */
export const ALLIANCE_LEAVE_DELAY = 3600

/**
 * How long after its owner recalls a soldier or carriage from the alliance army it is theirs to
 * command again (`CONTEXT.md`: Alliance army): one real hour.
 */
export const ALLIANCE_RECALL_DELAY = 3600

/**
 * The standing an NPC city must hold toward every member of an alliance to accept its
 * invitation (`CONTEXT.md`: NPC city in an alliance): half the way to the best. Some 25
 * paid contract weeks, or a lot of trade, earn it from neutral.
 */
export const NPC_ALLIANCE_JOIN_STANDING = 50

/**
 * The standing toward a member below which an NPC city leaves its alliance on its own
 * (`CONTEXT.md`: NPC city in an alliance): a theft and an attack from neutral, so standing merely
 * drifting back to neutral never makes it go.
 */
export const NPC_ALLIANCE_LEAVE_STANDING = -20

/**
 * Control a city projects before counting anyone in it (`CONTEXT.md`: Territory), so even an
 * empty city holds the ground it stands on.
 */
export const TERRITORY_CITY_BASE = 5

/** Control a guarded workplace projects before counting its workers and guards. */
export const TERRITORY_WORKPLACE_BASE = 2

/** Control each resident adds: of a city, one living there; of a workplace, one working it. */
export const TERRITORY_PER_RESIDENT = 1

/**
 * Control each armed resident adds on top: of a city, one living there and standing in its area
 * (its garrison); of a workplace, one of its holder's guarding it. Soldiers count most.
 */
export const TERRITORY_PER_ARMED = 3

/**
 * How far control reaches, in tiles, per square root of its strength: a city of 5 control reaches
 * 17 tiles, one of 30 forty-three, one of 100 eighty.
 */
export const TERRITORY_REACH_PER_ROOT = 8

/** The farthest any one city or workplace projects control, in tiles. */
export const TERRITORY_MAX_REACH = 96

/**
 * Ticks between two blows of a resident in a fight (`CONTEXT.md`: Combat): a blow every two
 * seconds, so a fight between two unarmed residents lasts about a minute.
 */
export const STRIKE_TICKS = 2

/** Damage a blow does before Strength, weapon and Combat skill: a little even from the weakest. */
export const BLOW_BASE = 1

/** Damage each point of Strength adds to a blow: an average resident's fist does 4. */
export const BLOW_PER_STRENGTH = 0.3

/** How much harder each point of Combat skill makes a blow, as a share of it. */
export const COMBAT_SKILL_EFFECT = 0.05

/** The furthest Combat skill raises a blow, as a share of it: at most twice as hard. */
export const COMBAT_SKILL_LIMIT = 1

/** The least damage a blow that lands does, however well the one hit is protected. */
export const MIN_BLOW_DAMAGE = 1

/**
 * What a blow that lands does to a defender standing on their own city's wall, as a share of its
 * damage (`CONTEXT.md`: Walls in combat): a quarter, so a wall's defenders hold out four times
 * as long.
 */
export const WALL_DEFENCE = 0.25

/**
 * Damage a wall or gate takes from blows before it falls (`CONTEXT.md`: Walls in combat,
 * broken). An average unarmed resident (4 a blow, one blow every `STRIKE_TICKS`) breaks a stretch
 * of wall alone in about five minutes; ten soldiers with swords in well under one. A gate holds
 * out half as long again.
 */
export const WALL_STRENGTH: Record<'wall' | 'gate', number> = { wall: 600, gate: 900 }

/**
 * Share of a broken wall's or gate's materials left on its tile, rounded down to whole units:
 * less than tearing it down leaves (`TEARDOWN_MATERIALS_RETURNED`), as much of it is splintered;
 * enough that a tile of wall leaves a unit of Wood.
 */
export const BROKEN_MATERIALS_RETURNED = 0.34

/**
 * Ticks it takes to climb over a wall or gate (`CONTEXT.md`: Walls in combat, climbed): a
 * minute, as long as walking eight tiles of plains, all the while unable to dodge or strike back.
 */
export const CLIMB_TICKS = 60

/** Chance of dodging a blow for each point of Agility: an average resident dodges one in five. */
export const DODGE_PER_AGILITY = 0.02

/** However agile a resident is, they dodge at most this share of blows. */
export const DODGE_LIMIT = 0.5

/**
 * Combat skill a resident of average Intellect learns from each blow they strike or that is
 * struck at them (`CONTEXT.md`: Combat, fighting teaches Combat): a point every 50 blows.
 */
export const COMBAT_SKILL_PER_BLOW = 0.02

/** The weapon a resident fights with: the best one they carry, if any (`CONTEXT.md`: Weapons and armour). */
export function bestWeapon(resident: Pick<Resident, 'carried'>): Weapon | undefined {
  const carried = (Object.keys(WEAPON_ATTACK) as Weapon[]).filter(
    (w) => (resident.carried[w] ?? 0) > 0,
  )
  return carried.sort((a, b) => WEAPON_ATTACK[b] - WEAPON_ATTACK[a])[0]
}

/** Whether a resident is armed: carries a weapon (`CONTEXT.md`: Soldier). */
export function isArmed(resident: Pick<Resident, 'carried'>): boolean {
  return bestWeapon(resident) !== undefined
}

/**
 * Damage a resident's protection takes off each blow (`CONTEXT.md`: Weapons and armour): a shield
 * and armour, if they carry them, one of each counting.
 */
export function protection(resident: Resident): number {
  return (Object.keys(PROTECTION_DEFENCE) as Protection[])
    .filter((p) => (resident.carried[p] ?? 0) > 0)
    .reduce((sum, p) => sum + PROTECTION_DEFENCE[p], 0)
}

/**
 * How hard a resident strikes at the given tick (`CONTEXT.md`: Combat): from Strength and the
 * best weapon they carry, harder with Combat skill.
 */
export function attackPower(resident: Resident, tick: number): number {
  const weapon = bestWeapon(resident)
  const raw =
    BLOW_BASE +
    BLOW_PER_STRENGTH * statValue(resident, 'strength', tick) +
    (weapon ? WEAPON_ATTACK[weapon] : 0)
  const skill = Math.min(COMBAT_SKILL_LIMIT, (resident.skills.combat ?? 0) * COMBAT_SKILL_EFFECT)
  return raw * (1 + skill)
}

/**
 * Damage a blow from `attacker` does to `defender` when it lands, at the given tick: the
 * attacker's `attackPower` less the defender's `protection`, but at least `MIN_BLOW_DAMAGE`.
 */
export function blowDamage(attacker: Resident, defender: Resident, tick: number): number {
  return Math.max(MIN_BLOW_DAMAGE, attackPower(attacker, tick) - protection(defender))
}

/** Chance a resident dodges a blow at the given tick, from their Agility (`CONTEXT.md`: Combat). */
export function dodgeChance(resident: Resident, tick: number): number {
  return Math.min(DODGE_LIMIT, statValue(resident, 'agility', tick) * DODGE_PER_AGILITY)
}

/**
 * Combat skill a resident learns from one blow they strike or that is struck at them, faster with
 * more Intellect (`CONTEXT.md`: Skill, learned by doing).
 */
export function combatLearned(resident: Resident, tick: number): number {
  return COMBAT_SKILL_PER_BLOW * (statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE)
}

/**
 * How many tiles further along an army's way a member may get than the one furthest behind
 * (`CONTEXT.md`: Army): one ahead waits, so the army keeps together at the pace of the slowest.
 */
export const ARMY_SPREAD = 4

/**
 * The longest a mercenary contract may run, in game days (`CONTEXT.md`: Mercenary contract): two
 * real days, so a contract is a campaign, not a permanent transfer of residents.
 */
export const CONTRACT_MAX_DAYS = 120

/** The Trade Org army (`CONTEXT.md`: Trade Org army). */
export const TRADE_ORG_ARMY = {
  /** Soldiers the HQ arms from its own adults: half of the residents it starts with. */
  size: 16,
  /** Adults the HQ keeps at work and never arms: its farms, workplaces and some spare. */
  workers: 12,
  /** Soldiers that always stay at the HQ: it never hires out more than the rest. */
  guard: 8,
  /** What it asks for each soldier and game week, in coins: about a spear's price each seven real hours. */
  pricePerSoldierWeek: 8,
  /**
   * It has lost too many once its soldiers, the adults it could still arm and its mercenaries
   * are fewer than this share of `size`.
   */
  hireBelow: 0.6,
  /** What it offers for each mercenary and game week, in coins: less than it asks itself. */
  hirePricePerSoldierWeek: 5,
  /** How long it hires mercenaries for, in game days: 14 real hours. */
  hireDays: 35,
  /**
   * The HQ keeps at least this many times the strongest Organization's armed residents as
   * soldiers (`CONTEXT.md`: Trade Org HQ), and `size` at the least: a little more than any
   * Player can bring.
   */
  strongestMultiple: 1.5,
  /**
   * The HQ closes its outer gates while more armed outsiders than this share of its soldiers at
   * home stand near it (`CONTEXT.md`: Trade Org HQ): half, so it can still drive them off.
   */
  gateShare: 0.5,
  /**
   * How near to one of the HQ's outer gates, in tiles, an armed outsider counts as near it, as
   * well as anywhere in its area: as for an NPC city (`NPC_GATE_WATCH_RANGE`).
   */
  gateWatchRange: 32,
}

/**
 * How many interpreter steps one resident's or army's script may use each tick (`CONTEXT.md`:
 * Step budget). Every evaluated node costs 1; enough for a few loops over what it sees.
 */
export const SCRIPT_STEP_BUDGET = 2000

/** How deeply a script's own function calls may nest before the run stops with an error. */
export const SCRIPT_MAX_CALL_DEPTH = 50

/**
 * Extra steps a script pays to ask the world something it sees as a list (`residents()`,
 * `buildings()`, `nodes()`, …), on top of the 1 every evaluated node costs (`CONTEXT.md`: Step
 * budget). Dear enough that a script keeps what it found in a variable rather than asking again.
 */
export const SCRIPT_LIST_QUERY_COST = 20

/** Extra steps for a small query about one tile or two things, such as `terrainAt` or `distance`. */
export const SCRIPT_TILE_QUERY_COST = 1

/** Extra steps a script pays to request an action (`walkTo`, `pickUp`, …), accepted or not. */
export const SCRIPT_ACTION_COST = 10

/**
 * How many interpreter steps all of a realm's running scripts may use together each tick
 * (`CONTEXT.md`: Step budget): ten residents at their full `SCRIPT_STEP_BUDGET`. When it runs
 * out, the rest skip the tick; who goes first rotates, so the same ones don't always skip.
 */
export const SCRIPT_REALM_STEP_BUDGET = 20000

/**
 * The most a running script's memory may hold, in characters of its JSON (`CONTEXT.md`:
 * Memory). Enough for a role, a few tiles and ids; a run that leaves more keeps the old memory.
 */
export const SCRIPT_MEMORY_MAX = 4000

/**
 * Ticks between two realm-log entries about the same resident's script going wrong (an error,
 * or running out of steps), so a script failing every tick doesn't flood the log. A minute.
 */
export const SCRIPT_LOG_INTERVAL = 60

/** The longest realm name a Player may give, in characters after trimming (`CONTEXT.md`: Realm name). */
export const REALM_NAME_MAX_LENGTH = 30

/** The longest name a Player may give a resident, the Leader included, in characters after trimming. */
export const RESIDENT_NAME_MAX_LENGTH = 30

/** The longest name a Player may give a city of their realm, in characters after trimming. */
export const CITY_NAME_MAX_LENGTH = 30
