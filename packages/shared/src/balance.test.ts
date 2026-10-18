import { describe, expect, it } from 'vitest'
import {
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  GOOD_WEIGHT,
  carryCapacity,
  stockWeight,
} from './balance.js'
import type { Resident } from './world.js'

const withStrength = (base: number, trained: number) =>
  ({ stats: { strength: { base, trained } } }) as unknown as Resident

describe('goods and carrying', () => {
  it('weighs goods by their unit weights', () => {
    expect(stockWeight({})).toBe(0)
    expect(stockWeight({ food: 10, stone: 5 })).toBe(10 * GOOD_WEIGHT.food + 5 * GOOD_WEIGHT.stone)
    // Coins weigh too: a fortune is heavy.
    expect(stockWeight({ coins: 1000 })).toBeCloseTo(1000 * GOOD_WEIGHT.coins)
    expect(GOOD_WEIGHT.coins).toBeGreaterThan(0)
  })

  it('sets carry capacity from effective Strength', () => {
    expect(carryCapacity(withStrength(10, 0))).toBe(CARRY_BASE + 10 * CARRY_PER_STRENGTH)
    expect(carryCapacity(withStrength(10, 3))).toBe(CARRY_BASE + 13 * CARRY_PER_STRENGTH)
    expect(carryCapacity(withStrength(15, 0))).toBeGreaterThan(carryCapacity(withStrength(5, 0)))
  })
})
