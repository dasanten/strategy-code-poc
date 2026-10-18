import { describe, expect, it } from 'vitest'
import { smallTerrain } from './test-terrain.js'
import { createWorld, isWalkable, nearestFreeTile, stepWorld } from './world.js'

const terrain = smallTerrain()

describe('world', () => {
  it('creates the same world from the same seed', () => {
    expect(createWorld(terrain, 7)).toEqual(createWorld(terrain, 7))
  })

  it('advances the tick and keeps units on passable terrain', () => {
    const world = createWorld(terrain)
    for (let i = 0; i < 50; i++) stepWorld(world, terrain)
    expect(world.tick).toBe(50)
    for (const u of world.units) expect(isWalkable(terrain, u.x, u.y)).toBe(true)
    const positions = new Set(world.units.map((u) => `${u.x},${u.y}`))
    expect(positions.size).toBe(world.units.length)
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
