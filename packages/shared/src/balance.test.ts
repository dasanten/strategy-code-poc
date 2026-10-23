import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CHILD_YEAR_DAYS,
  GOOD_WEIGHT,
  CONSTRUCTION_SKILL_MAX,
  WORK_OUTPUT_PER_DAY,
  WORK_SKILL_MAX,
  ageInYears,
  buildWork,
  canWork,
  constructionLearned,
  workLearned,
  workOutput,
  carryCapacity,
  stockWeight,
  ticksForAge,
} from './balance.js'
import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR, type Resident } from './world.js'

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

describe('work and Construction skill', () => {
  /** An adult of average Strength and Intellect with the given skills. */
  const worker = (skills: Resident['skills']) =>
    ({
      stats: { strength: { base: 10, trained: 0 }, intellect: { base: 10, trained: 0 } },
      skills,
      bornAt: -ticksForAge(25),
    }) as unknown as Resident

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
