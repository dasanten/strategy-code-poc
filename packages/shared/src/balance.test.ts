import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CHILD_YEAR_DAYS,
  GOOD_WEIGHT,
  ageInYears,
  canWork,
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
