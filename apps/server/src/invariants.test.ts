import { describe, expect, it } from 'vitest'
import { checkInvariants, shouldCheckInvariants } from './invariants.js'
import { createWorld, stepWorld } from './world.js'

describe('invariants', () => {
  it('hold on a fresh world and after many ticks', () => {
    const world = createWorld()
    expect(checkInvariants(world)).toEqual([])
    for (let i = 0; i < 200; i++) stepWorld(world)
    expect(checkInvariants(world)).toEqual([])
  })

  it('catch a unit on an unwalkable tile', () => {
    const world = createWorld()
    const rock = world.tiles.indexOf('rock')
    const unit = world.units[0]!
    unit.x = rock % world.width
    unit.y = Math.floor(rock / world.width)
    expect(checkInvariants(world)).toEqual([
      expect.objectContaining({ invariant: 'units-on-walkable-tiles', entityIds: [unit.id] }),
    ])
  })

  it('catch two units on one tile', () => {
    const world = createWorld()
    const [a, b] = world.units as [(typeof world.units)[0], (typeof world.units)[0]]
    b.x = a.x
    b.y = a.y
    expect(checkInvariants(world)).toEqual([
      expect.objectContaining({ invariant: 'one-unit-per-tile', entityIds: [a.id, b.id] }),
    ])
  })

  it('are checked every tick at rate 1 and sampled below it', () => {
    expect(shouldCheckInvariants(1, () => 0.99)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.05)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.5)).toBe(false)
    expect(shouldCheckInvariants(0, () => 0)).toBe(false)
  })
})
