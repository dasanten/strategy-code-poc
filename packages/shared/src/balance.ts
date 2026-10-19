import { Terrain } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  ageInYears,
  effective,
  type BuildingKind,
  type Good,
  type ResourceKind,
  type Resident,
  type SkillName,
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

/**
 * Children are grown at this age in game years (`CONTEXT.md`: Aging, Child): from then on they
 * can work, build, tear down and pair.
 */
export const ADULT_AGE = 14

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

/** Tiles along each side of a starting city, wall included: 5×5 tiles inside the wall. */
export const START_CITY_SIZE = 7

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

/** Food in a starting city's storage, in kg. */
export const START_FOOD = 200

/**
 * Food each resident of a starting city carries, in units: two game days' meals, so they have
 * something to eat while the farm's first harvest comes in (`CONTEXT.md`: Eating).
 */
export const START_CARRIED_FOOD = 4

/** Horses in a starting city's stable: two, so they can breed (`CONTEXT.md`: Starting city). */
export const START_HORSES = 2

/**
 * Food in a starting city's stable, in units: ten game days for its horses, time to start
 * bringing it food from the farm.
 */
export const START_STABLE_FOOD = 60

/**
 * Food a horse eats per game day, in units (`CONTEXT.md`: Horse). More than a resident; its
 * hunger meter otherwise runs like a resident's (`HUNGER_DAYS`, `STARVE_DAYS`, `HEAL_DAYS`).
 */
export const HORSE_FOOD_PER_DAY = 3

/**
 * How far from its tile a horse reaches Food lying on the ground, in tiles either way
 * (`CONTEXT.md`: Horses have no inventory): its own tile and the eight around it.
 */
export const HORSE_REACH = 1

/** Most horses a stable has room for; it breeds no foal once that many stand in it. */
export const STABLE_CAPACITY = 6

/**
 * Game days two fed horses at a stable take to breed a foal (`CONTEXT.md`: Stable). Time without
 * two fed horses or without room does not count.
 */
export const STABLE_BREED_DAYS = 10

/**
 * Starting cities lie at least this many tiles apart (about 2.5 hours' walk on plains), when the
 * map has room; otherwise as far apart as it allows.
 */
export const CITY_MIN_DISTANCE = 300

/**
 * How near a city building must stand to the city's town hall, or to another building already
 * part of that city, to be part of it too (`CONTEXT.md`: City building), in tiles along each
 * direction. A wall with gaps of up to two tiles still holds together.
 */
export const CITY_BUILDING_REACH = 3

/**
 * How far around each of its buildings a city's area reaches (`CONTEXT.md`: City area), in tiles
 * along each direction: the tiles right next to them.
 */
export const CITY_AREA_MARGIN = 1

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

/**
 * A resident at home is running low on food when they carry fewer units than this: less than a
 * game day's meals (`CONTEXT.md`: Eating). They then take meals from their city's storage.
 */
export const HOME_FOOD_LOW = 2

/** Units of food in one meal, what a resident at home takes from storage at a time. */
export const MEAL_UNITS = 1

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
 * Most weight a carriage carries, in kg (`CONTEXT.md`: Carriage): about thirteen residents of
 * average Strength, so one carriage moves what a whole starting city could carry.
 */
export const CARRIAGE_CAPACITY = 400

/**
 * Food a haul route keeps on board for its horse unless the Player picks another amount, in
 * units (`CONTEXT.md`: Haul route): two game days of the horse's eating, topped up at each stop
 * that has Food.
 */
export const HAUL_KEEP_FOOD = 2 * HORSE_FOOD_PER_DAY

/**
 * How fast a carriage crosses each terrain, relative to an unloaded resident of average Agility on
 * Plains (`CONTEXT.md`: Carriage): twice as fast on Plains, a little slower than walking in Forest
 * and Hills. Mountains are missing: a carriage cannot enter them. Roads, once there are any, go
 * here at about 2.6.
 */
export const CARRIAGE_SPEED = {
  [Terrain.Plains]: 2,
  [Terrain.Forest]: 0.6,
  [Terrain.Hills]: 0.6,
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
 * How many tiles per tick a carriage driven by `driver` goes onto a tile of the given terrain
 * (`CONTEXT.md`: Carriage): the terrain's `CARRIAGE_SPEED`, up to `DRIVING_SKILL_LIMIT` faster
 * with Driving skill. The horse sets the pace, so the driver's Agility does not count. Zero for
 * terrain a carriage cannot enter.
 */
export function driveSpeed(driver: Resident, terrain: number): number {
  const base = (CARRIAGE_SPEED as Partial<Record<number, number>>)[terrain] ?? 0
  const skilled =
    1 + Math.min(DRIVING_SKILL_LIMIT, (driver.skills.driving ?? 0) * DRIVING_SKILL_EFFECT)
  return (base * skilled) / WALK_TICKS_PER_TILE
}

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
 * the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
 * the smelter's iron goes into the mint.
 */
export const BUILD_MATERIALS: Partial<Record<BuildingKind, Stock>> = {
  lumberCamp: {},
  quarry: { wood: 30 },
  mine: { wood: 40, stone: 20 },
  stable: { wood: 40 },
  smelter: { stone: 40, wood: 20 },
  mint: { stone: 40, iron: 10 },
  townHall: { wood: 60, stone: 40 },
  wall: { wood: 10 },
  gate: { wood: 15 },
}

/**
 * Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
 * lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
 * a mint 5, a town hall 6. A stretch of wooden wall takes a quarter of a game day, a gate half
 * of one. More or stronger workers finish it sooner (`buildWork`).
 */
export const BUILD_WORK: Partial<Record<BuildingKind, number>> = {
  lumberCamp: 2 * TICKS_PER_GAME_DAY,
  quarry: 3 * TICKS_PER_GAME_DAY,
  mine: 4 * TICKS_PER_GAME_DAY,
  stable: 3 * TICKS_PER_GAME_DAY,
  smelter: 4 * TICKS_PER_GAME_DAY,
  mint: 5 * TICKS_PER_GAME_DAY,
  townHall: 6 * TICKS_PER_GAME_DAY,
  wall: TICKS_PER_GAME_DAY / 4,
  gate: TICKS_PER_GAME_DAY / 2,
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

/**
 * Most residents who can work each kind of workplace at a time (`CONTEXT.md`: Workplace). A farm
 * has room for a whole starting city; the workplaces on nodes for a smaller crew; smelters and
 * mints for a few.
 */
export const WORKPLACE_MAX_WORKERS: Partial<Record<BuildingKind, number>> = {
  farm: 10,
  lumberCamp: 6,
  quarry: 6,
  mine: 8,
  smelter: 4,
  mint: 4,
}

/**
 * The skill each kind of workplace uses and teaches (`CONTEXT.md`: Skill): Farming on a farm,
 * Woodcutting in a lumber camp, Mining in quarries and mines, Smelting in smelters and mints.
 */
export const WORKPLACE_SKILL: Partial<Record<BuildingKind, SkillName>> = {
  farm: 'farming',
  lumberCamp: 'woodcutting',
  quarry: 'mining',
  mine: 'mining',
  smelter: 'smelting',
  mint: 'smelting',
}

/** What a workplace that processes goods turns into what, one batch at a time. */
export interface Recipe {
  /** Goods one batch uses up. */
  input: Stock
  /** Goods one batch makes. */
  output: Stock
}

/**
 * The conversion rates of the workplaces that process goods (`CONTEXT.md`: Smelter, Coins): a
 * smelter turns 2 iron ore into 1 iron, a mint 1 gold ore into 20 coins (less weight than the
 * ore, but a fortune still weighs something).
 */
export const RECIPES: Partial<Record<BuildingKind, Recipe>> = {
  smelter: { input: { ironOre: 2 }, output: { iron: 1 } },
  mint: { input: { goldOre: 1 }, output: { coins: 20 } },
}

/**
 * Batches one worker of average Strength and no skill gets through per game day: a smelter worker
 * smelts what two miners dig (4 iron ore into 2 iron), a mint worker strikes what two gold miners
 * dig (2 gold ore into 40 coins).
 */
export const BATCHES_PER_DAY: Partial<Record<BuildingKind, number>> = {
  smelter: 2,
  mint: 2,
}

/**
 * Units of each good one worker of average Strength and no skill makes per game day. Food is more
 * than the `FOOD_PER_DAY` a resident eats, so a farm feeds its workers with some to spare; ore is
 * slow, and gold ore slowest.
 */
export const WORK_OUTPUT_PER_DAY: Partial<Record<Good, number>> = {
  food: 3,
  wood: 4,
  stone: 3,
  ironOre: 2,
  goldOre: 1,
}

/** The Strength at which a worker makes `WORK_OUTPUT_PER_DAY`. */
export const WORK_STRENGTH_AVERAGE = 10

/** How much more each point of the workplace's skill makes. */
export const WORK_SKILL_EFFECT = 0.05

/** Skill a worker of average Intellect gains per game day of work at a workplace. */
export const WORK_SKILL_PER_DAY = 1

/**
 * How much of a unit of `good` a worker makes per tick at the given tick, using `skill`
 * (`CONTEXT.md`: Workplace): in proportion to Strength, plus `WORK_SKILL_EFFECT` for each point
 * of the skill.
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
  const skilled = 1 + (resident.skills[skill] ?? 0) * WORK_SKILL_EFFECT
  return (perDay / TICKS_PER_GAME_DAY) * strength * skilled
}

/**
 * Skill a worker learns from one tick of work at a workplace (`CONTEXT.md`: Skill, learned by
 * doing), faster with more Intellect.
 */
export function workLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  return (WORK_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace
}
/**
 * Tearing down takes less work than building (`CONTEXT.md`: Tearing down): this share of the
 * building's `BUILD_WORK`, or of the work put into an unfinished site so far.
 */
export const TEARDOWN_WORK_SHARE = 0.5

/**
 * Share of a finished building's materials left on the tile when it is torn down, rounded down
 * to whole units. An unfinished site leaves all its delivered materials.
 */
export const TEARDOWN_MATERIALS_RETURNED = 0.5
