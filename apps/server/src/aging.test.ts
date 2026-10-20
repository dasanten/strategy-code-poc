import {
  ADULT_AGE,
  DECLINE_AGE,
  DECLINE_FLOOR,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  TICKS_PER_GAME_YEAR,
  Terrain,
  ageFactor,
  ageInYears,
  canWork,
  carryCapacity,
  hungerFactor,
  stockWeight,
  walkSpeed,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAging } from './aging.js'
import { checkInvariants } from './invariants.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { stepWorld } from './world.js'

const terrain = cityTerrain()

/** Makes a resident the given age in game years at `tick`. */
function aged(r: Resident, years: number, tick: number) {
  r.bornAt = tick - Math.round(years * TICKS_PER_GAME_YEAR)
}

describe('aging', () => {
  it('ages residents over simulated years until each dies of old age at their lifespan', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const lifespans = new Map(world.residents.map((r) => [r.id, r.lifespan]))
    const deaths: { id: string; age: number }[] = []
    let realmEnded: number | undefined
    for (let year = 1; world.residents.length > 0; year++) {
      expect(year).toBeLessThan(LIFESPAN_MAX)
      world.tick = year * TICKS_PER_GAME_YEAR
      const { died, ended } = stepAging(world, terrain.size)
      deaths.push(...died.map((r) => ({ id: r.id, age: ageInYears(r, world.tick) })))
      if (ended.includes(realm)) realmEnded = year
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(deaths).toHaveLength(lifespans.size)
    for (const { id, age } of deaths) {
      // Stepped a year at a time, so each dies within a year after reaching their lifespan.
      expect(age).toBeGreaterThanOrEqual(lifespans.get(id)!)
      expect(age).toBeLessThan(lifespans.get(id)! + 1)
      expect(age).toBeGreaterThanOrEqual(LIFESPAN_MIN)
    }
    // The Leader died of old age too, which ended the realm.
    expect(realmEnded).toBeDefined()
    expect(world.realms).toEqual([])
  })

  it('lets a resident die of old age in the running world, dropping what they carried', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    r.carried = { stone: 3 }
    r.lifespan = ageInYears(r, world.tick) + 5 / TICKS_PER_GAME_YEAR
    for (let t = 0; t < 10; t++) stepWorld(world, terrain)
    expect(world.residents).not.toContain(r)
    expect(world.residents).toHaveLength(7)
    expect(world.piles).toEqual([expect.objectContaining({ x: r.x, y: r.y, goods: { stone: 3 } })])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('does not let children work until they are grown', () => {
    const { world } = worldWithCity()
    const child = world.residents[1]!
    aged(child, 0, world.tick)
    expect(canWork(child, world.tick)).toBe(false)
    expect(canWork(child, world.tick + (ADULT_AGE - 0.01) * TICKS_PER_GAME_YEAR)).toBe(false)
    expect(canWork(child, world.tick + ADULT_AGE * TICKS_PER_GAME_YEAR)).toBe(true)
    expect(world.residents.every((r) => r === child || canWork(r, world.tick))).toBe(true)
  })

  it('makes stats decline late in life, down to a floor', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    r.stats.strength = { base: 10, trained: 0 }
    r.stats.agility = { base: 10, trained: 0 }
    r.stats.endurance = { base: 10, trained: 0 }
    const at = (years: number) => {
      aged(r, years, world.tick)
      return {
        factor: ageFactor(r, world.tick),
        carry: carryCapacity(r, world.tick),
        speed: walkSpeed(r, Terrain.Plains, world.tick),
        hunger: hungerFactor(r, world.tick),
      }
    }
    const young = at(20)
    expect(young.factor).toBe(1)
    expect(at(DECLINE_AGE + 0.9)).toEqual(young)
    const old = at(DECLINE_AGE + 10)
    expect(old.factor).toBeLessThan(1)
    expect(old.carry).toBeLessThan(young.carry)
    expect(old.speed).toBeLessThan(young.speed)
    // Less Endurance: the old need more food.
    expect(old.hunger).toBeGreaterThan(young.hunger)
    expect(at(200).factor).toBe(DECLINE_FLOOR)
  })

  it('puts down what declining Strength can no longer carry, Food last', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    r.lifespan = LIFESPAN_MAX
    aged(r, 30, world.tick)
    r.carried = { food: 5, stone: Math.floor(carryCapacity(r, world.tick)) - 5 }
    expect(checkInvariants(world, terrain)).toEqual([])
    aged(r, DECLINE_AGE + 10, world.tick)
    stepAging(world, terrain.size)
    const capacity = carryCapacity(r, world.tick)
    expect(stockWeight(r.carried)).toBeLessThanOrEqual(capacity)
    expect(stockWeight(r.carried)).toBeGreaterThan(capacity - 1)
    expect(r.carried.food).toBe(5)
    expect(world.piles).toEqual([
      expect.objectContaining({ x: r.x, y: r.y, goods: { stone: expect.any(Number) } }),
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is watched by an invariant: nobody outlives their lifespan', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    aged(r, r.lifespan, world.tick)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'ages-in-range', entityIds: [r.id] }),
    ])
    r.lifespan = LIFESPAN_MAX + 1
    aged(r, 20, world.tick)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'ages-in-range', entityIds: [r.id] }),
    ])
  })
})
