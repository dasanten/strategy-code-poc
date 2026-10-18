import { describe, expect, it } from 'vitest'
import { MAX_HEALTH, MAX_HUNGER, Terrain, trainedCap, type Resident } from '@csp/shared'
import { checkInvariants, shouldCheckInvariants } from './invariants.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { stepWorld } from './world.js'

const terrain = cityTerrain()

describe('invariants', () => {
  it('hold on a fresh world and after many ticks', () => {
    const world = worldWithCity().world
    expect(checkInvariants(world, terrain)).toEqual([])
    for (let i = 0; i < 200; i++) stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it.each([
    ['lake', Terrain.Lake],
    ['sea', Terrain.Sea],
  ])('catch a resident on impassable terrain (%s)', (_, kind) => {
    const world = worldWithCity().world
    const tile = terrain.tiles.indexOf(kind)
    expect(tile).toBeGreaterThanOrEqual(0)
    const resident = world.residents[0]!
    resident.x = tile % terrain.diameter
    resident.y = Math.floor(tile / terrain.diameter)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({
        invariant: 'nothing-on-impassable-terrain',
        entityIds: [resident.id],
      }),
    ])
  })

  it('catch a resource node on terrain that does not fit it', () => {
    const world = worldWithCity().world
    const node = world.nodes.find((n) => n.kind === 'forest')!
    const plains = terrain.tiles.indexOf(Terrain.Plains)
    node.x = plains % terrain.diameter
    node.y = Math.floor(plains / terrain.diameter)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'nodes-on-fitting-terrain', entityIds: [node.id] }),
    ])
  })

  it('catch a resident outside the disc', () => {
    const world = worldWithCity().world
    const resident = world.residents[0]!
    resident.x = 0
    resident.y = 0
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({
        invariant: 'nothing-on-impassable-terrain',
        entityIds: [resident.id],
      }),
    ])
  })

  it('catch a trained bonus above its cap, below zero, or on a base of nothing', () => {
    const world = worldWithCity().world
    const [a, b, c] = world.residents as [Resident, Resident, Resident]
    a.stats.strength = { base: 10, trained: trainedCap(10) }
    expect(checkInvariants(world, terrain)).toEqual([])
    a.stats.strength.trained++
    b.stats.agility.trained = -1
    c.stats.intellect = { base: 0, trained: 0 }
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'trained-within-cap', entityIds: [a.id] }),
      expect.objectContaining({ invariant: 'trained-within-cap', entityIds: [b.id] }),
      expect.objectContaining({ invariant: 'trained-within-cap', entityIds: [c.id] }),
    ])
  })

  it('catch health or hunger out of range', () => {
    const world = worldWithCity().world
    const [a, b, c] = world.residents as [Resident, Resident, Resident]
    a.health = MAX_HEALTH + 1
    b.hunger = -1
    c.hunger = MAX_HUNGER
    c.health = 0
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'health-and-hunger-in-range', entityIds: [a.id] }),
      expect.objectContaining({ invariant: 'health-and-hunger-in-range', entityIds: [b.id] }),
    ])
  })

  it('catch a realm whose Leader is gone or belongs elsewhere', () => {
    const { world } = worldWithCity()
    const [realm] = world.realms
    realm!.leaderId = 'nobody'
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'realms-have-leaders', entityIds: [realm!.id] }),
    ])
  })

  it('catch buildings out of place, a farm off Plains and negative stock', () => {
    const { world } = worldWithCity()
    const city = world.cities[0]!
    const house = world.buildings.find((b) => b.kind === 'house')!
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    house.x = city.x // onto the wall
    storage.stock = { food: -1 }
    const forest = terrain.tiles.indexOf(Terrain.Forest)
    farm.x = forest % terrain.diameter
    farm.y = Math.floor(forest / terrain.diameter)
    const ids = checkInvariants(world, terrain)
      .filter((v) => v.invariant === 'buildings-in-place')
      .map((v) => v.entityIds[0])
    expect(ids.sort()).toEqual([farm.id, house.id, storage.id].sort())
  })

  it('are checked every tick at rate 1 and sampled below it', () => {
    expect(shouldCheckInvariants(1, () => 0.99)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.05)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.5)).toBe(false)
    expect(shouldCheckInvariants(0, () => 0)).toBe(false)
  })
})
