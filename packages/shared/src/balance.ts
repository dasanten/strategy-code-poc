import { Terrain } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  ageInYears,
  effective,
  type BuildingKind,
  type Good,
  type ResourceKind,
  type Resident,
  type StatName,
  type Stock,
} from './world.js'

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
 * Terrain). Agility softens the penalty (`walkSpeed`).
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

/** A new resident's lifespan, the age in game years they die of old age, lies in this range. */
export const LIFESPAN_MIN = 55
export const LIFESPAN_MAX = 65

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
 * Food each resident of a starting city carries, in units: two game days' meals, so they have
 * something to eat while the farm's first harvest comes in (`CONTEXT.md`: Eating).
 */
export const START_CARRIED_FOOD = 4

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

/** The most weight a resident can carry at the given tick, in kg (`CONTEXT.md`: Carry capacity). */
export function carryCapacity(resident: Resident, tick: number): number {
  return CARRY_BASE + CARRY_PER_STRENGTH * statValue(resident, 'strength', tick)
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

/** Ticks (real seconds) an unloaded resident of average Agility takes to walk a plains tile. */
export const WALK_TICKS_PER_TILE = 30

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
 * Zero for terrain nobody can enter.
 */
export function walkSpeed(resident: Resident, terrain: number, tick: number): number {
  const base = (TERRAIN_SPEED as Partial<Record<number, number>>)[terrain]
  if (!base) return 0
  const away = statValue(resident, 'agility', tick) - AGILITY_AVERAGE
  const clamp = (v: number) => Math.max(-AGILITY_LIMIT, Math.min(AGILITY_LIMIT, v))
  const pace = 1 + clamp(away * AGILITY_SPEED_EFFECT)
  const slowdown = (1 - base) * (1 - clamp(away * AGILITY_TERRAIN_EFFECT))
  return (pace * (1 - slowdown)) / WALK_TICKS_PER_TILE
}

/**
 * Share of the Food in one place (a storage, a resident's or carriage's load, a pile) that goes
 * bad each game day (`CONTEXT.md`: Spoilage). About a third of a stock is lost over a game year.
 */
export const FOOD_SPOIL_PER_DAY = 0.02

/**
 * Events kept in each Player's realm log; the oldest go first. A Player who logs
 * in sees these, so a few game days of a busy realm should fit.
 */
export const REALM_LOG_LENGTH = 100

/**
 * Materials each kind of building needs before its construction site can become the building
 * (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
 * the lumber camp's wood builds the quarry, wood and stone build the mine.
 */
export const BUILD_MATERIALS: Partial<Record<BuildingKind, Stock>> = {
  lumberCamp: {},
  quarry: { wood: 30 },
  mine: { wood: 40, stone: 20 },
}

/**
 * Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
 * lumber camp takes one such resident 2 game days, a quarry 3, a mine 4. More or stronger
 * workers finish it sooner (`buildWork`).
 */
export const BUILD_WORK: Partial<Record<BuildingKind, number>> = {
  lumberCamp: 2 * TICKS_PER_GAME_DAY,
  quarry: 3 * TICKS_PER_GAME_DAY,
  mine: 4 * TICKS_PER_GAME_DAY,
}

/** The Strength at which a resident puts in one unit of building work per tick. */
export const BUILD_STRENGTH_AVERAGE = 10

/** How much more work each point of Construction skill puts in per tick. */
export const CONSTRUCTION_SKILL_EFFECT = 0.05

/** Construction skill a resident of average Intellect gains per game day of building work. */
export const CONSTRUCTION_SKILL_PER_DAY = 1

/** The Intellect at which a resident learns at the usual pace (`CONTEXT.md`: Stats). */
export const INTELLECT_AVERAGE = 10

/**
 * Building work a resident puts in per tick at the given tick (`CONTEXT.md`: Construction site):
 * in proportion to Strength, plus `CONSTRUCTION_SKILL_EFFECT` for each point of Construction.
 */
export function buildWork(resident: Resident, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / BUILD_STRENGTH_AVERAGE
  return strength * (1 + (resident.skills.construction ?? 0) * CONSTRUCTION_SKILL_EFFECT)
}

/**
 * Construction skill a resident learns from one tick of building work (`CONTEXT.md`: Skill,
 * learned by doing), faster with more Intellect.
 */
export function constructionLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  return (CONSTRUCTION_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace
}

/** Most residents who can work one farm at a time (`CONTEXT.md`: Workplace, Farm). */
export const FARM_MAX_WORKERS = 10

/**
 * Food one farm worker of average Strength and no Farming skill makes per game day, in units.
 * More than the `FOOD_PER_DAY` a resident eats, so a farm feeds its workers with some to spare.
 */
export const FARM_FOOD_PER_DAY = 3

/** The Strength at which a farm worker makes `FARM_FOOD_PER_DAY`. */
export const FARM_STRENGTH_AVERAGE = 10

/** How much more food each point of Farming skill makes. */
export const FARMING_SKILL_EFFECT = 0.05

/** Farming skill a resident of average Intellect gains per game day of farm work. */
export const FARMING_SKILL_PER_DAY = 1

/**
 * Food a farm worker makes per tick at the given tick (`CONTEXT.md`: Workplace): in proportion to
 * Strength, plus `FARMING_SKILL_EFFECT` for each point of Farming.
 */
export function farmOutput(resident: Resident, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / FARM_STRENGTH_AVERAGE
  const skill = 1 + (resident.skills.farming ?? 0) * FARMING_SKILL_EFFECT
  return (FARM_FOOD_PER_DAY / TICKS_PER_GAME_DAY) * strength * skill
}

/**
 * Farming skill a resident learns from one tick of farm work (`CONTEXT.md`: Skill, learned by
 * doing), faster with more Intellect.
 */
export function farmingLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  return (FARMING_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace
}
