import { describe, expect, it } from 'vitest'
import { createWorld, isWalkable, stepWorld } from './world.js'

describe('world', () => {
  it('creates the same world from the same seed', () => {
    expect(createWorld(7)).toEqual(createWorld(7))
  })

  it('advances the tick and keeps units on walkable tiles', () => {
    const world = createWorld()
    for (let i = 0; i < 50; i++) stepWorld(world)
    expect(world.tick).toBe(50)
    for (const u of world.units) expect(isWalkable(world, u.x, u.y)).toBe(true)
    const positions = new Set(world.units.map((u) => `${u.x},${u.y}`))
    expect(positions.size).toBe(world.units.length)
  })
})
