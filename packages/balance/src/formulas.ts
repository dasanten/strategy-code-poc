import {
  ADULT_AGE,
  AGILITY_AVERAGE,
  AGILITY_LIMIT,
  AGILITY_SPEED_EFFECT,
  AGILITY_TERRAIN_EFFECT,
  BATCHES_PER_DAY,
  BLOW_BASE,
  BLOW_PER_STRENGTH,
  BUILD_MATERIALS,
  BUILD_STRENGTH_AVERAGE,
  BUY_SHARE,
  CARRIAGE_CAPACITY,
  CARRIAGE_SPEED,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CHILD_YEAR_DAYS,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_LIMIT,
  CONSTRUCTION_SKILL_EFFECT,
  CONSTRUCTION_SKILL_LIMIT,
  DECLINE_AGE,
  DECLINE_FLOOR,
  DECLINE_PER_YEAR,
  DELIVERY_FEE_BASE,
  DELIVERY_FEE_PER_KG_TILE,
  DRIVING_SKILL_EFFECT,
  DRIVING_SKILL_LIMIT,
  HORSE_ENDURANCE_EFFECT,
  HORSE_ENDURANCE_LIMIT,
  HORSE_SPEED_EFFECT,
  HORSE_SPEED_LIMIT,
  HORSE_STAT_AVERAGE,
  HORSE_STRENGTH_EFFECT,
  HORSE_STRENGTH_LIMIT,
  HUNGER_ENDURANCE_AVERAGE,
  HUNGER_ENDURANCE_EFFECT,
  HUNGER_ENDURANCE_LIMIT,
  INTELLECT_AVERAGE,
  MOUNTAIN_ROAD_WORK_FACTOR,
  PRICE_ELASTICITY,
  PRICE_RANGE,
  PRICE_REFERENCE_FLOORS,
  SKILL_MAX,
  SKILL_PER_DAY,
  TEARDOWN_MATERIALS_RETURNED,
  TERRAIN,
  TERRAIN_SPEED,
  TERRITORY_MAX_REACH,
  TERRITORY_REACH_PER_ROOT,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_YEAR,
  TICK_MS,
  TRAINED_CAP_SHARE,
  TRAIN_COMBAT_FACTOR,
  TRAIN_SKILL_FACTOR,
  TRAIN_STAT_PER_TICK,
  TRANSFER_FEE_FACTOR,
  WALK_TICKS_PER_TILE,
  WAREHOUSE_BASE_PRICE,
  WEAPON_ATTACK,
  WORKPLACE_SKILL,
  WORK_OUTPUT_PER_DAY,
  WORK_SKILL_EFFECT,
  WORK_SKILL_LIMIT,
  WORK_STRENGTH_AVERAGE,
} from './constants.js'

/**
 * The formulas the Wiki works its figures out with, written from the numbers in `balance.json`.
 * The game's own rules are in Rust (`csp-sim`, `csp-shared::balance`); these are the few of them
 * the Wiki shows, over plain structural types so the package needs nothing but the JSON. Until
 * the cutover `formulas.test.ts` checks each against its twin in `packages/shared`.
 */

/** A stat: what the resident was born with plus what training added. */
export interface StatLike {
  base: number
  trained: number
}

/** What the formulas read of a resident. */
export interface ResidentLike {
  stats: Record<'strength' | 'endurance' | 'agility' | 'intellect', StatLike>
  skills: Partial<Record<string, number>>
  bornAt: number
  carried: Partial<Record<string, number>>
}

/** What the formulas read of a horse. */
export interface HorseLike {
  stats: { speed: number; strength: number; endurance: number }
}

type Stat = keyof ResidentLike['stats']

/** A table keyed by name, read by a key the types don't know. */
const lookup = <V>(table: object, key: string): V | undefined => (table as Record<string, V>)[key]

const CHILDHOOD_TICKS = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY

/** The ticks a resident has lived at an age in game years. */
export function ticksForAge(age: number): number {
  if (age <= ADULT_AGE) return age * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
  return CHILDHOOD_TICKS + (age - ADULT_AGE) * TICKS_PER_GAME_YEAR
}

/** A resident's age in game years at the given tick. */
function ageInYears(resident: Pick<ResidentLike, 'bornAt'>, tick: number): number {
  const lived = tick - resident.bornAt
  if (lived <= CHILDHOOD_TICKS) return lived / (CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY)
  return ADULT_AGE + (lived - CHILDHOOD_TICKS) / TICKS_PER_GAME_YEAR
}

/** How much of their stats a resident keeps at the given tick (old age takes a little). */
function ageFactor(resident: Pick<ResidentLike, 'bornAt'>, tick: number): number {
  const past = Math.floor(ageInYears(resident, tick)) - DECLINE_AGE
  if (past <= 0) return 1
  return Math.max(DECLINE_FLOOR, 1 - past * DECLINE_PER_YEAR)
}

/** A stat as it counts at the given tick: base and trained bonus, less the decline of old age. */
export function statValue(resident: ResidentLike, stat: Stat, tick: number): number {
  const s = resident.stats[stat]
  return (s.base + s.trained) * ageFactor(resident, tick)
}

/** The most a stat's trained bonus can be, for a given base value. */
export function trainedCap(base: number): number {
  return Math.floor(base * TRAINED_CAP_SHARE)
}

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/** The most weight a resident can carry at the given tick, in kg. */
export function carryCapacity(resident: ResidentLike, tick: number): number {
  return CARRY_BASE + CARRY_PER_STRENGTH * statValue(resident, 'strength', tick)
}

/** How much of the usual food a resident needs, from their Endurance at the given tick. */
export function hungerFactor(resident: ResidentLike, tick: number): number {
  const away = statValue(resident, 'endurance', tick) - HUNGER_ENDURANCE_AVERAGE
  return 1 - clamp(away * HUNGER_ENDURANCE_EFFECT, HUNGER_ENDURANCE_LIMIT)
}

/** How many tiles per tick a resident walks onto a tile of the given terrain; 0 where none can. */
export function walkSpeed(resident: ResidentLike, terrain: number, tick: number): number {
  const base = lookup<number>(TERRAIN_SPEED, String(terrain))
  if (!base) return 0
  const away = statValue(resident, 'agility', tick) - AGILITY_AVERAGE
  const pace = 1 + clamp(away * AGILITY_SPEED_EFFECT, AGILITY_LIMIT)
  const slowdown = Math.max(0, 1 - base) * (1 - clamp(away * AGILITY_TERRAIN_EFFECT, AGILITY_LIMIT))
  const speedUp = Math.max(0, base - 1)
  return (pace * (1 - slowdown + speedUp)) / WALK_TICKS_PER_TILE
}

function horseStatShare(stat: number, effect: number, limit: number): number {
  return clamp((stat - HORSE_STAT_AVERAGE) * effect, limit)
}

function horseSpeedFactor(horse: HorseLike): number {
  return 1 + horseStatShare(horse.stats.speed, HORSE_SPEED_EFFECT, HORSE_SPEED_LIMIT)
}

function horseStrengthFactor(horse: HorseLike): number {
  return 1 + horseStatShare(horse.stats.strength, HORSE_STRENGTH_EFFECT, HORSE_STRENGTH_LIMIT)
}

/** How much of `HORSE_FOOD_PER_DAY` a horse needs, from its Endurance. */
export function horseFoodFactor(horse: HorseLike): number {
  return 1 - horseStatShare(horse.stats.endurance, HORSE_ENDURANCE_EFFECT, HORSE_ENDURANCE_LIMIT)
}

/** How many tiles per tick a carriage goes onto a tile of the given terrain; 0 where none can. */
export function driveSpeed(driver: ResidentLike, horse: HorseLike, terrain: number): number {
  const base = lookup<number>(CARRIAGE_SPEED, String(terrain)) ?? 0
  const skilled =
    1 + Math.min(DRIVING_SKILL_LIMIT, (driver.skills.driving ?? 0) * DRIVING_SKILL_EFFECT)
  return (base * horseSpeedFactor(horse) * skilled) / WALK_TICKS_PER_TILE
}

/** Most weight a carriage pulled by `horse` holds, in kg. */
export function carriageCapacityWith(horse: HorseLike | undefined): number {
  return horse ? CARRIAGE_CAPACITY * horseStrengthFactor(horse) : CARRIAGE_CAPACITY
}

/** Building work a resident puts in per tick at the given tick. */
export function buildWork(resident: ResidentLike, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / BUILD_STRENGTH_AVERAGE
  const skill = (resident.skills.construction ?? 0) * CONSTRUCTION_SKILL_EFFECT
  return strength * (1 + Math.min(CONSTRUCTION_SKILL_LIMIT, skill))
}

function workPace(resident: ResidentLike, perDay: number, skill: string, tick: number): number {
  const strength = statValue(resident, 'strength', tick) / WORK_STRENGTH_AVERAGE
  const skilled = 1 + Math.min(WORK_SKILL_LIMIT, (resident.skills[skill] ?? 0) * WORK_SKILL_EFFECT)
  return (perDay / TICKS_PER_GAME_DAY) * strength * skilled
}

/** How much of a unit of `good` a worker makes per tick, using `skill`. */
export function workOutput(
  resident: ResidentLike,
  good: string,
  skill: string,
  tick: number,
): number {
  return workPace(resident, lookup<number>(WORK_OUTPUT_PER_DAY, good) ?? 0, skill, tick)
}

/** How much of a batch a worker gets through per tick at a workplace that processes goods. */
export function batchWork(resident: ResidentLike, kind: string, tick: number): number {
  const skill = lookup<string>(WORKPLACE_SKILL, kind)
  return skill ? workPace(resident, lookup<number>(BATCHES_PER_DAY, kind) ?? 0, skill, tick) : 0
}

/** The weapon a resident fights with: the best one they carry, if any. */
function bestWeapon(resident: Pick<ResidentLike, 'carried'>): string | undefined {
  const attack = (w: string) => lookup<number>(WEAPON_ATTACK, w) ?? 0
  return Object.keys(WEAPON_ATTACK)
    .filter((w) => (resident.carried[w] ?? 0) > 0)
    .sort((a, b) => attack(b) - attack(a))[0]
}

/** How hard a resident strikes at the given tick. */
export function attackPower(resident: ResidentLike, tick: number): number {
  const weapon = bestWeapon(resident)
  const raw =
    BLOW_BASE +
    BLOW_PER_STRENGTH * statValue(resident, 'strength', tick) +
    (weapon ? (lookup<number>(WEAPON_ATTACK, weapon) ?? 0) : 0)
  const skill = Math.min(COMBAT_SKILL_LIMIT, (resident.skills.combat ?? 0) * COMBAT_SKILL_EFFECT)
  return raw * (1 + skill)
}

/** What `trainee` gains in `subject` (a stat or a skill) from one tick with `teacher`. */
export function trainingGain(
  trainee: ResidentLike,
  teacher: ResidentLike,
  subject: string,
  tick: number,
): number {
  const pace = statValue(trainee, 'intellect', tick) / INTELLECT_AVERAGE
  if (subject in trainee.stats) {
    const stat = subject as Stat
    const { base, trained } = trainee.stats[stat]
    const toCap = trainedCap(base) - trained
    const toTeacher =
      (statValue(teacher, stat, tick) - statValue(trainee, stat, tick)) / ageFactor(trainee, tick)
    return Math.max(0, Math.min(TRAIN_STAT_PER_TICK * pace, toCap, toTeacher))
  }
  const has = trainee.skills[subject] ?? 0
  const toTeacher = (teacher.skills[subject] ?? 0) - has
  const factor = subject === 'combat' ? TRAIN_COMBAT_FACTOR : TRAIN_SKILL_FACTOR
  const perTick =
    ((lookup<number>(SKILL_PER_DAY, subject) ?? 0) / TICKS_PER_GAME_DAY) * factor * pace
  return Math.max(0, Math.min(perTick, (lookup<number>(SKILL_MAX, subject) ?? 0) - has, toTeacher))
}

/** How many times its `BUILD_WORK` a building of `kind` takes, with `under` the terrain beneath. */
export function workFactor(kind: string, under?: number): number {
  return kind === 'road' && under === TERRAIN.Mountain ? MOUNTAIN_ROAD_WORK_FACTOR : 1
}

/** Goods left on the tile once a finished building of `kind` is torn down, in whole units. */
export function teardownReturns(kind: string): Record<string, number> {
  const out: Record<string, number> = {}
  const materials = lookup<Record<string, number>>(BUILD_MATERIALS, kind) ?? {}
  for (const [good, units] of Object.entries(materials)) {
    const back = Math.floor(units * TEARDOWN_MATERIALS_RETURNED)
    if (back > 0) out[good] = back
  }
  return out
}

/** How far control of the given strength reaches, in tiles. */
export function controlReach(strength: number): number {
  return Math.min(TERRITORY_MAX_REACH, Math.floor(TERRITORY_REACH_PER_ROOT * Math.sqrt(strength)))
}

/** A delivery's fee, in coins, for `kg` over `tiles`. */
export function deliveryFee(kg: number, tiles: number): number {
  return DELIVERY_FEE_BASE + Math.ceil(kg * tiles * DELIVERY_FEE_PER_KG_TILE - 1e-9)
}

/** A transfer's fee, in coins. */
export function transferFee(kg: number, tiles: number): number {
  return TRANSFER_FEE_FACTOR * deliveryFee(kg, tiles)
}

/** A warehouse's price for one good from its own stock and floor: whole coins. */
export function priceFor(
  good: string,
  stock: number,
  floor: number,
): { buy: number; sell: number } {
  const base = lookup<number>(WAREHOUSE_BASE_PRICE, good) ?? 0
  const reference = Math.max(1, floor * PRICE_REFERENCE_FLOORS)
  const factor = Math.min(
    PRICE_RANGE.max,
    Math.max(PRICE_RANGE.min, (reference / Math.max(1, stock)) ** PRICE_ELASTICITY),
  )
  const sell = Math.max(2, Math.round(base * factor))
  const buy = Math.max(1, Math.min(sell - 1, Math.floor(sell * BUY_SHARE)))
  return { buy, sell }
}

/** The most game hours `aboutTime` counts in hours; longer is half a game day, then days. */
const HOURS_UP_TO = 8

function gameTimeAbout(ticks: number): string {
  const hours = Math.max(1, Math.round(ticks / TICKS_PER_GAME_HOUR))
  if (hours <= HOURS_UP_TO) return hours === 1 ? 'a game hour' : `${hours} game hours`
  if (hours < 18) return 'half a game day'
  const days = Math.max(1, Math.round(ticks / TICKS_PER_GAME_DAY))
  return days === 1 ? 'a game day' : `${days} game days`
}

/** About how long `ticks` last: real time first, game time in brackets. */
export function aboutTime(ticks: number): string {
  const seconds = (ticks * TICK_MS) / 1000
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  const real = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
  return `about ${real} (${gameTimeAbout(ticks)})`
}

/** The terrain codes by name, as the game stores them: `Terrain.Plains` is 0. */
export const Terrain = TERRAIN
