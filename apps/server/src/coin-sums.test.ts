import {
  BATCHES_PER_DAY,
  BUY_SHARE,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CITY_PRICE_PER_RESIDENT,
  DIRECTIVE_BUY_OFF_PRICE,
  DIRECTIVE_PUNISH_WORTH,
  GOOD_WEIGHT,
  NPC_TOWN,
  NPC_VILLAGE,
  RECIPES,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  WAREHOUSE_BASE_PRICE,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_WRECK_WORTH,
  WORK_OUTPUT_PER_DAY,
  WORK_STRENGTH_AVERAGE,
  cityPrice,
  type NpcCitySize,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { mulberry32 } from './residents.js'
import { createWorld } from './world.js'

// The sums behind Coins (`CONTEXT.md`: Coins, Mint, Buying a city, Price anchor), for one full gold
// mine and the mint that strikes all it digs, with average workers of no skill.
const miners = WORKPLACE_MAX_WORKERS.mine!
const minters = WORKPLACE_MAX_WORKERS.mint!
const recipe = RECIPES.mint![0]!
const orePerDay = miners * WORK_OUTPUT_PER_DAY.goldOre!
const coinsPerDay = orePerDay * recipe.output.coins!
const coinsPerWorkerDay = coinsPerDay / (miners + minters)

/** What a resident of average Strength can carry, in kg. */
const averageHands = CARRY_BASE + WORK_STRENGTH_AVERAGE * CARRY_PER_STRENGTH

/** What one worker's output of a good fetches in a game day, sold to a warehouse at its base price. */
const soldPerWorkerDay = (good: 'wood' | 'ironOre' | 'goldOre') =>
  WORK_OUTPUT_PER_DAY[good]! * WAREHOUSE_BASE_PRICE[good] * BUY_SHARE

/** A newly founded NPC city's price, in Coins. */
function priceOf(kind: NpcCitySize): number {
  const terrain = plains(200)
  const world = createWorld(terrain)
  return cityPrice(world, foundNpcCity(world, terrain, kind, 60, 60, mulberry32(7)))
}

describe('what a gold mine makes', () => {
  it('has its mint strike all its ore: 80 Coins a game day', () => {
    expect(minters * BATCHES_PER_DAY.mint! * recipe.input.goldOre!).toBe(orePerDay)
    expect(coinsPerDay).toBe(80)
  })

  it('pays each worker a little better than wood or iron ore sold', () => {
    expect(coinsPerWorkerDay).toBeCloseTo(6.67, 2)
    expect(soldPerWorkerDay('wood')).toBeCloseTo(4.8)
    expect(soldPerWorkerDay('ironOre')).toBeCloseTo(4.8)
    expect(coinsPerWorkerDay / soldPerWorkerDay('wood')).toBeGreaterThan(1)
    expect(coinsPerWorkerDay / soldPerWorkerDay('wood')).toBeLessThan(1.5)
  })

  it('makes gold ore worth less at a warehouse than what the mint strikes from it', () => {
    expect(WAREHOUSE_BASE_PRICE.goldOre).toBeLessThan(recipe.output.coins! / recipe.input.goldOre!)
    expect(soldPerWorkerDay('goldOre')).toBeCloseTo(soldPerWorkerDay('wood'))
  })
})

describe('what a city costs in days of one full gold mine', () => {
  it('asks five days for a resident', () => {
    expect(CITY_PRICE_PER_RESIDENT / coinsPerDay).toBe(5)
  })

  it('asks about 35 days for a village, and three of its residents can carry the coins', () => {
    const price = priceOf(NPC_VILLAGE)
    expect(price / coinsPerDay).toBeGreaterThan(33)
    expect(price / coinsPerDay).toBeLessThan(37)
    expect(price * GOOD_WEIGHT.coins).toBeLessThan(3 * averageHands)
  })

  it('asks about 90 days for a town', () => {
    const days = priceOf(NPC_TOWN) / coinsPerDay
    expect(days).toBeGreaterThan(85)
    expect(days).toBeLessThan(95)
  })
})

describe('what is reckoned from a resident in a city’s price', () => {
  it('counts a killing as one', () => {
    expect(TRADE_ORG_LOSS.killing).toBe(CITY_PRICE_PER_RESIDENT)
  })

  it('takes as much for an admin directive as for a killing', () => {
    expect(DIRECTIVE_PUNISH_WORTH).toBe(TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing)
  })

  it('offers to be bought off for what an average resident’s hands can bring', () => {
    expect(DIRECTIVE_BUY_OFF_PRICE * GOOD_WEIGHT.coins).toBeLessThanOrEqual(averageHands)
    expect(DIRECTIVE_BUY_OFF_PRICE).toBeGreaterThan(DIRECTIVE_PUNISH_WORTH)
  })

  it('has a debt for a killing take at most four workplaces', () => {
    const debt = TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing
    for (const worth of Object.values(WORKPLACE_WRECK_WORTH)) {
      expect(debt / worth).toBeLessThanOrEqual(4)
    }
  })
})
