import { Terrain } from './terrain.js'
import { effective, type Good, type ResourceKind, type Resident, type Stock } from './world.js'

/**
 * Balance numbers: how much, how fast, how often. The rules (what happens) are in `CONTEXT.md`;
 * these are the values Daniel tunes. One commented constant each.
 */

/** Tiles along each side of the map: once around is a ~12 h walk at ~30 s per plains tile. */
export const MAP_SIZE = 1440

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
 * Resource nodes per tile of each terrain they lie on, when the world is created. Ore is denser
 * in Mountain than in Hills; gold is rare.
 */
export const NODE_DENSITY = {
  forest: { [Terrain.Forest]: 1 / 300 },
  stone: { [Terrain.Hills]: 1 / 250 },
  ironOre: { [Terrain.Hills]: 1 / 1500, [Terrain.Mountain]: 1 / 300 },
  goldOre: { [Terrain.Hills]: 1 / 15000, [Terrain.Mountain]: 1 / 3000 },
} as const satisfies Record<ResourceKind, Partial<Record<Terrain, number>>>

/** No two resource nodes lie closer than this many tiles (in either direction). */
export const NODE_MIN_SPACING = 4

/**
 * How fast an unloaded resident crosses each terrain, relative to Plains (`CONTEXT.md`:
 * Terrain). Agility softens the penalty; that comes with walking (T4.2).
 */
export const TERRAIN_SPEED = {
  [Terrain.Plains]: 1,
  [Terrain.Forest]: 0.7,
  [Terrain.Hills]: 0.7,
  [Terrain.Mountain]: 0.35,
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

/** The most a stat's trained bonus can be, for a given base value. */
export function trainedCap(base: number): number {
  return Math.floor(base * TRAINED_CAP_SHARE)
}

/** Tiles along each side of a starting city, wall included: 5×5 tiles inside the wall. */
export const START_CITY_SIZE = 7

/** Residents in a starting city, the Leader included. */
export const START_RESIDENTS = 8

/** Residents one house holds. */
export const HOUSE_CAPACITY = 4

/** Houses a starting city gets beyond what its residents need. */
export const START_SPARE_HOUSES = 1

/** Food in a starting city's storage, in kg. */
export const START_FOOD = 200

/**
 * Starting cities lie at least this many tiles apart (about 2.5 hours' walk on plains), when the
 * map has room; otherwise as far apart as it allows.
 */
export const CITY_MIN_DISTANCE = 300

/** How far a resident sees, in tiles (`CONTEXT.md`: Sight). */
export const SIGHT_RANGE = 12

/** Large seas the generator makes, roughly; together they cover `TERRAIN_SHARES.sea`. */
export const SEA_COUNT = 3

/**
 * What one unit of each good weighs, in kg (`CONTEXT.md`: Good). Coins are light but not
 * weightless, so a fortune still has to be carried.
 */
export const GOOD_WEIGHT: Record<Good, number> = {
  food: 1,
  wood: 1,
  stone: 1,
  ironOre: 1,
  iron: 1,
  goldOre: 1,
  coins: 0.02,
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

/** The most weight a resident can carry, in kg (`CONTEXT.md`: Carry capacity). */
export function carryCapacity(resident: Resident): number {
  return CARRY_BASE + CARRY_PER_STRENGTH * effective(resident.stats.strength)
}

/** Food a resident of average Endurance eats per game day, in units (`CONTEXT.md`: Hunger). */
export const FOOD_PER_DAY = 2

/** Game days a full hunger meter lasts without eating, at average Endurance. */
export const HUNGER_DAYS = 1

/** Game days an empty hunger meter takes to cost a resident all their health. */
export const STARVE_DAYS = 1

/** Game days a fed resident takes to heal from no health back to full. */
export const HEAL_DAYS = 3

/** The Endurance at which a resident needs exactly `FOOD_PER_DAY`. */
export const HUNGER_ENDURANCE_AVERAGE = 10

/** How much less food each point of Endurance above average needs (more below it). */
export const HUNGER_ENDURANCE_EFFECT = 0.02

/** The furthest Endurance moves the food a resident needs, either way. */
export const HUNGER_ENDURANCE_LIMIT = 0.3

/** How much of the usual food a resident needs, from their effective Endurance. */
export function hungerFactor(resident: Resident): number {
  const away = effective(resident.stats.endurance) - HUNGER_ENDURANCE_AVERAGE
  const change = Math.max(
    -HUNGER_ENDURANCE_LIMIT,
    Math.min(HUNGER_ENDURANCE_LIMIT, away * HUNGER_ENDURANCE_EFFECT),
  )
  return 1 - change
}
