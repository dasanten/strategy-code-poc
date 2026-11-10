// Ported from packages/shared/src/balance.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import {
  CHILD_GOODS,
  GOOD_WEIGHT,
  RECIPES,
  SKILL_MAX,
  WEAPON_ATTACK,
  WORKPLACE_SKILL,
} from './narrowed.js'
import {
  ADULT_AGE,
  CARRIAGE_SPEED,
  CHILD_YEAR_DAYS,
  CONSTRUCTION_SKILL_MAX,
  CONSTRUCTION_SKILL_PER_DAY,
  DECLINE_AGE,
  DECLINE_FLOOR,
  DECLINE_PER_YEAR,
  ENDURANCE_TERRAIN_EFFECT,
  HORSE_HUNGRY_SHARE,
  HUNGER_ENDURANCE_AVERAGE,
  HUNGER_ENDURANCE_LIMIT,
  HUNGRY_HORSE_PACE,
  INTELLECT_AVERAGE,
  MAX_HUNGER,
  TERRAIN_FOOD,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  WORK_SKILL_MAX,
  WORK_SKILL_PER_DAY,
  batchWork,
  driveSpeed,
  hungerFactor,
  statValue,
  trainedCap,
  workOutput,
} from '@csp/balance'
import type {
  BuildingKind,
  Good,
  Horse,
  Resident,
  SkillName,
  StatName,
  Stock,
  Weapon,
} from '@csp/shared-types'

/** Ticks from birth until a resident is grown up. */
const CHILDHOOD_TICKS = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY

/**
 * A resident's age in game years at the given tick: each year up to `ADULT_AGE` takes
 * `CHILD_YEAR_DAYS`, later years a full game year (`CONTEXT.md`: Aging).
 */
export function ageInYears(resident: Pick<Resident, 'bornAt'>, tick: number): number {
  const lived = tick - resident.bornAt
  if (lived <= CHILDHOOD_TICKS) return lived / (CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY)
  return ADULT_AGE + (lived - CHILDHOOD_TICKS) / TICKS_PER_GAME_YEAR
}

/** Whether a resident is grown up, so they can work, build or take any job (`CONTEXT.md`: Child). */
export function canWork(resident: Pick<Resident, 'bornAt'>, tick: number): boolean {
  return ageInYears(resident, tick) >= ADULT_AGE
}

/**
 * Whether a resident may pick up, put down, Fetch or Store these goods: anyone grown up, a child
 * only `CHILD_GOODS` (`CONTEXT.md`: Child).
 */
export function canHandle(
  resident: Pick<Resident, 'bornAt'>,
  tick: number,
  goods: readonly string[],
): boolean {
  return (
    canWork(resident, tick) || goods.every((g) => (CHILD_GOODS as readonly string[]).includes(g))
  )
}

/**
 * How much of their stats a resident keeps at the given tick: all of it until `DECLINE_AGE`,
 * then a little less with each full game year (`CONTEXT.md`: Aging).
 */
export function ageFactor(resident: Resident, tick: number): number {
  const past = Math.floor(ageInYears(resident, tick)) - DECLINE_AGE
  if (past <= 0) return 1
  return Math.max(DECLINE_FLOOR, 1 - past * DECLINE_PER_YEAR)
}

/** A horse's age in game years at the given tick; unlike a resident, a foal ages at the usual pace. */
export function horseAgeInYears(horse: Pick<Horse, 'bornAt'>, tick: number): number {
  return (tick - horse.bornAt) / TICKS_PER_GAME_YEAR
}

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

/** What some goods weigh together, in kg. */
export function stockWeight(stock: Stock): number {
  return (Object.entries(stock) as [Good, number][]).reduce(
    (kg, [good, units]) => kg + units * GOOD_WEIGHT[good],
    0,
  )
}

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
 * Whether a carriage can enter ground of the given kind (`groundAt`): passable land or a road, but
 * no bare mountains (`carriageCanGoTo`).
 */
export function carriageCanEnter(terrain: number): boolean {
  return ((CARRIAGE_SPEED as Partial<Record<number, number>>)[terrain] ?? 0) > 0
}

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
 * Construction skill a resident learns from one tick of building work (`CONTEXT.md`: Skill,
 * learned by doing), faster with more Intellect, and never past `CONSTRUCTION_SKILL_MAX`.
 */
export function constructionLearned(resident: Resident, tick: number): number {
  const pace = statValue(resident, 'intellect', tick) / INTELLECT_AVERAGE
  const room = Math.max(0, CONSTRUCTION_SKILL_MAX - (resident.skills.construction ?? 0))
  return Math.min(room, (CONSTRUCTION_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace)
}

/** What a workplace that processes goods turns into what, one batch at a time. */
export interface Recipe {
  /** Goods one batch uses up. */
  input: Stock
  /** Goods one batch makes. */
  output: Stock
}

/**
 * How much of `good` a worker makes a game day at a workplace of `kind`, at their pace at the given
 * tick, while they have what they need (`CONTEXT.md`: Workplace amounts): `workOutput`, or at a
 * workplace that processes goods its batches (`batchWork`) times what a batch of the recipe yields.
 */
export function madePerDay(
  resident: Resident,
  kind: BuildingKind,
  good: Good,
  tick: number,
): number {
  const recipes = RECIPES[kind]
  if (recipes) {
    const yields = recipes.find((r) => r.output[good] !== undefined)?.output[good] ?? 0
    return batchWork(resident, kind, tick) * yields * TICKS_PER_GAME_DAY
  }
  const skill = WORKPLACE_SKILL[kind]
  return skill ? workOutput(resident, good, skill, tick) * TICKS_PER_GAME_DAY : 0
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
 * A resident's value in a training subject (`CONTEXT.md`: Training): a stat as it counts now
 * (`statValue`), or a skill's points.
 */
export function subjectValue(
  resident: Resident,
  subject: StatName | SkillName,
  tick: number,
): number {
  return subject in resident.stats
    ? statValue(resident, subject as StatName, tick)
    : (resident.skills[subject as SkillName] ?? 0)
}

/**
 * The most `trainee` can reach in `subject` under `teacher` (`CONTEXT.md`: Training), as
 * `subjectValue` counts it: the lower of the teacher's own value and the trainee's cap, a stat's
 * base with its full trained bonus, or a skill's `SKILL_MAX`. `trainingGain` stops there.
 */
export function trainingCeiling(
  trainee: Resident,
  teacher: Resident,
  subject: StatName | SkillName,
  tick: number,
): number {
  const teaches = subjectValue(teacher, subject, tick)
  if (!(subject in trainee.stats)) return Math.min(teaches, SKILL_MAX[subject as SkillName])
  const { base } = trainee.stats[subject as StatName]
  return Math.min(teaches, (base + trainedCap(base)) * ageFactor(trainee, tick))
}
