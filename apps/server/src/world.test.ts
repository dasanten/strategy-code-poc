import { describe, expect, it } from 'vitest'
import { wrapDelta } from '@csp/shared'
import { smallTerrain } from './test-terrain.js'
import { createWorld, isWalkable, nearestFreeTile, stepWorld } from './world.js'

const terrain = smallTerrain()

describe('world', () => {
  it('creates the same world from the same seed', () => {
    expect(createWorld(terrain, 7)).toEqual(createWorld(terrain, 7))
  })

  it('starts with resource nodes and nobody yet', () => {
    const world = createWorld(terrain)
    expect(world.nodes.length).toBeGreaterThan(0)
    expect(world).toMatchObject({
      tick: 0,
      nextId: 1,
      residents: [],
      realms: [],
      cities: [],
      buildings: [],
      horses: [],
      carriages: [],
    })
  })

  it('advances the tick; nobody moves without an order', () => {
    const world = createWorld(terrain)
    for (let i = 0; i < 50; i++) stepWorld(world, terrain)
    expect(world.tick).toBe(50)
  })

  it('finds the nearest free passable tile', () => {
    const [x, y] = nearestFreeTile(terrain, new Set(), 0, 0)
    expect(isWalkable(terrain, x, y)).toBe(true)
    const taken = new Set([`${x},${y}`])
    const next = nearestFreeTile(terrain, taken, x, y)
    expect(next).not.toEqual([x, y])
    const steps = (a: number, b: number) => Math.abs(wrapDelta(a, b, terrain.size))
    expect(Math.max(steps(next[0], x), steps(next[1], y))).toBeLessThanOrEqual(2)
  })
})
