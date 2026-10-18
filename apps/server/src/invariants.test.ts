import { describe, expect, it } from 'vitest'
import { Terrain } from '@csp/shared'
import { checkInvariants, shouldCheckInvariants } from './invariants.js'
import { smallTerrain } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const terrain = smallTerrain()

describe('invariants', () => {
  it('hold on a fresh world and after many ticks', () => {
    const world = createWorld(terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
    for (let i = 0; i < 200; i++) stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it.each([
    ['lake', Terrain.Lake],
    ['sea', Terrain.Sea],
  ])('catch a unit on impassable terrain (%s)', (_, kind) => {
    const world = createWorld(terrain)
    const tile = terrain.tiles.indexOf(kind)
    expect(tile).toBeGreaterThanOrEqual(0)
    const unit = world.units[0]!
    unit.x = tile % terrain.diameter
    unit.y = Math.floor(tile / terrain.diameter)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'nothing-on-impassable-terrain', entityIds: [unit.id] }),
    ])
  })

  it('catch a resource node on terrain that does not fit it', () => {
    const world = createWorld(terrain)
    const node = world.nodes.find((n) => n.kind === 'forest')!
    const plains = terrain.tiles.indexOf(Terrain.Plains)
    node.x = plains % terrain.diameter
    node.y = Math.floor(plains / terrain.diameter)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'nodes-on-fitting-terrain', entityIds: [node.id] }),
    ])
  })

  it('catch a unit outside the disc', () => {
    const world = createWorld(terrain)
    const unit = world.units[0]!
    unit.x = 0
    unit.y = 0
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'nothing-on-impassable-terrain', entityIds: [unit.id] }),
    ])
  })

  it('catch two units on one tile', () => {
    const world = createWorld(terrain)
    const [a, b] = world.units as [(typeof world.units)[0], (typeof world.units)[0]]
    b.x = a.x
    b.y = a.y
    expect(checkInvariants(world, terrain)).toEqual([
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
