import { describe, expect, it } from 'vitest'
import {
  ADULT_AGE,
  MAX_HEALTH,
  MAX_HUNGER,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STAT_NAMES,
  ageInYears,
} from '@csp/shared'
import { smallTerrain } from './test-terrain.js'
import { createWorld, isWalkable, nearestFreeTile, stepWorld } from './world.js'

const terrain = smallTerrain()

describe('world', () => {
  it('creates the same world from the same seed', () => {
    expect(createWorld(terrain, 7)).toEqual(createWorld(terrain, 7))
  })

  it('starts with healthy, fed adult residents on passable terrain, untrained', () => {
    const world = createWorld(terrain)
    expect(world.residents).toHaveLength(6)
    for (const r of world.residents) {
      expect(isWalkable(terrain, r.x, r.y)).toBe(true)
      expect(r.health).toBe(MAX_HEALTH)
      expect(r.hunger).toBe(MAX_HUNGER)
      expect(r.skills).toEqual({})
      expect(r.name).toBeTruthy()
      expect(ageInYears(r, world.tick)).toBeGreaterThanOrEqual(ADULT_AGE)
      for (const s of STAT_NAMES) {
        expect(r.stats[s].base).toBeGreaterThanOrEqual(STAT_BASE_MIN)
        expect(r.stats[s].base).toBeLessThanOrEqual(STAT_BASE_MAX)
        expect(r.stats[s].trained).toBe(0)
      }
    }
    expect(new Set(world.residents.map((r) => r.id)).size).toBe(6)
  })

  it('advances the tick; nobody moves without an order', () => {
    const world = createWorld(terrain)
    const before = structuredClone(world.residents)
    for (let i = 0; i < 50; i++) stepWorld(world, terrain)
    expect(world.tick).toBe(50)
    expect(world.residents).toEqual(before)
  })

  it('finds the nearest free passable tile', () => {
    const [x, y] = nearestFreeTile(terrain, new Set(), 0, 0)
    expect(isWalkable(terrain, x, y)).toBe(true)
    const taken = new Set([`${x},${y}`])
    const next = nearestFreeTile(terrain, taken, x, y)
    expect(next).not.toEqual([x, y])
    expect(Math.max(Math.abs(next[0] - x), Math.abs(next[1] - y))).toBeLessThanOrEqual(2)
  })
})
