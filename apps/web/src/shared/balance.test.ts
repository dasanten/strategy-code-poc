import { describe, expect, it } from 'vitest'
import { GOOD_WEIGHT, SKILL_MAX, SKILL_PER_DAY, WORK_OUTPUT_PER_DAY } from './narrowed.js'
import {
  ageInYears,
  canWork,
  constructionLearned,
  stockWeight,
  subjectValue,
  trainingCeiling,
  workLearned,
} from './stats.js'
import {
  ADULT_AGE,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CHILD_YEAR_DAYS,
  CONSTRUCTION_SKILL_MAX,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  TRAINING_GROUND_MAX_TRAINEES,
  TRAIN_SKILL_FACTOR,
  WORK_SKILL_MAX,
  buildWork,
  carryCapacity,
  ticksForAge,
  trainingGain,
  workOutput,
} from '@csp/balance'
import type { Resident } from '@csp/shared-types'
const withStrength = (base: number, trained: number) =>
  ({ stats: { strength: { base, trained } }, bornAt: 0 }) as unknown as Resident

describe('goods and carrying', () => {
  it('weighs goods by their unit weights', () => {
    expect(stockWeight({})).toBe(0)
    expect(stockWeight({ food: 10, stone: 5 })).toBe(10 * GOOD_WEIGHT.food + 5 * GOOD_WEIGHT.stone)
    // Coins weigh too: a fortune is heavy.
    expect(stockWeight({ coins: 1000 })).toBeCloseTo(1000 * GOOD_WEIGHT.coins)
    expect(GOOD_WEIGHT.coins).toBeGreaterThan(0)
  })

  it('sets carry capacity from effective Strength', () => {
    expect(carryCapacity(withStrength(10, 0), 0)).toBe(CARRY_BASE + 10 * CARRY_PER_STRENGTH)
    expect(carryCapacity(withStrength(10, 3), 0)).toBe(CARRY_BASE + 13 * CARRY_PER_STRENGTH)
    expect(carryCapacity(withStrength(15, 0), 0)).toBeGreaterThan(
      carryCapacity(withStrength(5, 0), 0),
    )
  })
})

describe('aging', () => {
  const newborn = { bornAt: 0 } as unknown as Resident
  const day = TICKS_PER_GAME_DAY

  it('ages a child a year every CHILD_YEAR_DAYS game days', () => {
    expect(ageInYears(newborn, 0)).toBe(0)
    expect(ageInYears(newborn, CHILD_YEAR_DAYS * day)).toBe(1)
    expect(ageInYears(newborn, 70 * day)).toBe(7)
    expect(ageInYears(newborn, 140 * day - 1)).toBeLessThan(ADULT_AGE)
    expect(ageInYears(newborn, 140 * day)).toBe(ADULT_AGE)
  })

  it('ages an adult a year every game year', () => {
    expect(ageInYears(newborn, 140 * day + TICKS_PER_GAME_YEAR)).toBe(ADULT_AGE + 1)
    expect(ageInYears(newborn, 140 * day + 6 * TICKS_PER_GAME_YEAR + 210 * day)).toBe(20.5)
  })

  it('lets a newborn work after 140 game days, not before', () => {
    expect(canWork(newborn, 140 * day - 1)).toBe(false)
    expect(canWork(newborn, 140 * day)).toBe(true)
  })

  it('turns an age back into ticks lived on both sides of the boundary', () => {
    for (const age of [0, 3.5, ADULT_AGE, ADULT_AGE + 0.25, 30, 60]) {
      expect(ageInYears(newborn, ticksForAge(age))).toBeCloseTo(age, 9)
    }
    expect(ticksForAge(ADULT_AGE)).toBe(140 * day)
  })
})

/** An adult of average Strength and Intellect with the given skills. */
const worker = (skills: Resident['skills']) =>
  ({
    stats: { strength: { base: 10, trained: 0 }, intellect: { base: 10, trained: 0 } },
    skills,
    bornAt: -ticksForAge(25),
  }) as unknown as Resident

describe('work and Construction skill', () => {
  it('never makes more than twice what an unskilled worker does', () => {
    const unskilled = workOutput(worker({}), 'food', 'farming', 0)
    expect(unskilled * TICKS_PER_GAME_DAY).toBeCloseTo(WORK_OUTPUT_PER_DAY.food!)
    expect(workOutput(worker({ farming: 50 }), 'food', 'farming', 0)).toBeCloseTo(unskilled * 1.5)
    for (const farming of [100, 150, 1000]) {
      expect(workOutput(worker({ farming }), 'food', 'farming', 0)).toBeCloseTo(unskilled * 2)
    }
    const unskilledBuild = buildWork(worker({}), 0)
    expect(buildWork(worker({ construction: 1000 }), 0)).toBeCloseTo(unskilledBuild * 2)
  })

  it('takes an average worker about a game year to learn up to 100, and no further', () => {
    const year = TICKS_PER_GAME_YEAR
    expect(WORK_SKILL_MAX).toBe(100)
    expect(CONSTRUCTION_SKILL_MAX).toBe(100)
    expect(workLearned(worker({}), 'farming', 0) * year).toBeCloseTo(WORK_SKILL_MAX)
    expect(constructionLearned(worker({}), 0) * year).toBeCloseTo(CONSTRUCTION_SKILL_MAX)
    expect(workLearned(worker({ farming: 100 }), 'farming', 0)).toBe(0)
    expect(workLearned(worker({ farming: 100 - 1e-6 }), 'farming', 0)).toBeCloseTo(1e-6, 9)
    expect(constructionLearned(worker({ construction: 100 }), 0)).toBe(0)
  })
})

describe('what training is worth (`CONTEXT.md`: Training)', () => {
  it('training a work skill to its maximum and then working beats learning by doing by game day 420, the teacher’s share counted', () => {
    const teacher = worker({ mining: WORK_SKILL_MAX })
    const doer = worker({})
    const trainee = worker({})
    let byDoing = 0
    let byTraining = 0
    let teachersShare = 0
    for (let tick = 0; tick < TICKS_PER_GAME_YEAR; tick++) {
      byDoing += workOutput(doer, 'ironOre', 'mining', tick)
      doer.skills.mining = (doer.skills.mining ?? 0) + workLearned(doer, 'mining', tick)
      const gain = trainingGain(trainee, teacher, 'mining', tick)
      if (gain > 0) {
        trainee.skills.mining = (trainee.skills.mining ?? 0) + gain
        // The teacher gives up a master's work, shared by a full ground.
        teachersShare +=
          workOutput(teacher, 'ironOre', 'mining', tick) / TRAINING_GROUND_MAX_TRAINEES
      } else {
        byTraining += workOutput(trainee, 'ironOre', 'mining', tick)
      }
    }
    // In game days of an unskilled worker's output.
    const unskilledDay = WORK_OUTPUT_PER_DAY.ironOre!
    expect(byDoing / unskilledDay).toBeCloseTo(630, 0)
    expect(byTraining / unskilledDay).toBeCloseTo(700, 0)
    expect(teachersShare / unskilledDay).toBeCloseTo(70 / 3, 0)
    expect(byTraining - teachersShare).toBeGreaterThan(byDoing)
  })

  it('takes Combat half a game year to its maximum, under a teacher who has it', () => {
    const teacher = worker({ combat: SKILL_MAX.combat })
    const perTick = trainingGain(worker({}), teacher, 'combat', 0)
    expect(SKILL_MAX.combat / perTick).toBeCloseTo(TICKS_PER_GAME_YEAR / 2)
  })

  it('takes a stat’s trained bonus to its cap in half a game year', () => {
    const teacher = worker({})
    teacher.stats.strength = { base: 20, trained: 0 }
    const perTick = trainingGain(worker({}), teacher, 'strength', 0)
    expect(5 / perTick).toBeCloseTo(TICKS_PER_GAME_YEAR / 2)
  })

  it('trains Construction and Driving by the same factor as a work skill', () => {
    for (const skill of ['mining', 'construction', 'driving'] as const) {
      const perTick = trainingGain(worker({}), worker({ [skill]: 1e6 }), skill, 0)
      expect(perTick * TICKS_PER_GAME_DAY).toBeCloseTo(SKILL_PER_DAY[skill] * TRAIN_SKILL_FACTOR)
    }
  })
})

describe('training ceilings (`CONTEXT.md`: Training)', () => {
  const someone = (strength: [number, number], combat: number) =>
    ({
      stats: { strength: { base: strength[0], trained: strength[1] } },
      skills: { combat },
      bornAt: 0,
    }) as unknown as Resident
  const t = 20 * TICKS_PER_GAME_YEAR

  it('stops a stat at the teacher’s value, or at the trainee’s cap if that is lower', () => {
    const teacher = someone([14, 0], 0)
    expect(subjectValue(someone([10, 2.5], 0), 'strength', t)).toBe(12.5)
    // Base 10: cap 5, so 15; the teacher has 14.
    expect(trainingCeiling(someone([10, 0], 0), teacher, 'strength', t)).toBe(14)
    // Base 8: cap 4, so 12, under the teacher's 14.
    expect(trainingCeiling(someone([8, 0], 0), teacher, 'strength', t)).toBe(12)
  })

  it('stops a skill at the teacher’s, never past its maximum', () => {
    expect(subjectValue(someone([10, 0], 7), 'combat', t)).toBe(7)
    expect(subjectValue(someone([10, 0], 7), 'mining', t)).toBe(0)
    expect(trainingCeiling(someone([10, 0], 0), someone([10, 0], 6), 'combat', t)).toBe(6)
    const master = someone([10, 0], 1e6)
    expect(trainingCeiling(someone([10, 0], 0), master, 'combat', t)).toBe(SKILL_MAX.combat)
  })
})
