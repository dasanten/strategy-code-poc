import { describe, expect, it } from 'vitest'
import {
  CARRYING_TICKS,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  buildingAt,
  carryCapacity,
  covers,
  trainedCap,
  type Resident,
} from '@csp/shared'
import { checkInvariants, shouldCheckInvariants } from './invariants.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { stepWorld } from './world.js'

const terrain = cityTerrain()

/** The nearest tile east of (x, y) that no footprint covers. */
function offFootprints(world: Parameters<typeof buildingAt>[0], x: number, y: number) {
  while (buildingAt(world, x, y, terrain.size)) x++
  return { x, y }
}

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
    resident.order = null
    resident.x = tile % terrain.size
    resident.y = Math.floor(tile / terrain.size)
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
    node.x = plains % terrain.size
    node.y = Math.floor(plains / terrain.size)
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'nodes-on-fitting-terrain', entityIds: [node.id] }),
    ])
  })

  it('catch a position stored past a side of the map', () => {
    const world = worldWithCity().world
    const resident = world.residents[0]!
    resident.order = null
    resident.x -= terrain.size // the same tile, under another name
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'positions-on-map', entityIds: [resident.id] }),
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

  it('catch a resident carrying more than their capacity', () => {
    const world = worldWithCity().world
    const r = world.residents[0]!
    r.carried = { stone: carryCapacity(r, world.tick) }
    expect(checkInvariants(world, terrain)).toEqual([])
    r.carried = { stone: carryCapacity(r, world.tick) + 1 }
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'carried-within-capacity', entityIds: [r.id] }),
    ])
  })

  it('catch negative goods, empty piles and two piles on one tile', () => {
    const world = worldWithCity().world
    const r = world.residents[0]!
    r.carried = { food: -1 }
    const at = { x: r.x, y: r.y }
    world.piles.push(
      { id: 'p1', ...at, goods: { wood: 3 } },
      { id: 'p2', ...at, goods: { wood: 2 } },
      // Off every footprint, so it is one tile's pile and not the farm's.
      { id: 'p3', ...offFootprints(world, r.x, r.y), goods: {} },
    )
    const ids = checkInvariants(world, terrain)
      .filter((v) => v.invariant === 'goods-in-place')
      .map((v) => v.entityIds[0])
    expect(ids.sort()).toEqual([r.id, 'p2', 'p3'].sort())
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
      // No health is in range, but a resident with none should have died and left their goods.
      expect.objectContaining({ invariant: 'dead-leave-loot', entityIds: [c.id] }),
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
    const wall = world.buildings.find((b) => b.kind === 'wall')!
    const house = world.buildings.find((b) => b.kind === 'house')!
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    Object.assign(house, { x: wall.x, y: wall.y }) // onto the wall and the walls next to it
    const walls = world.buildings.filter(
      (b) => b.kind === 'wall' && covers(house, b.x, b.y, terrain.size),
    )
    storage.stock = { food: -1 }
    const forest = terrain.tiles.indexOf(Terrain.Forest)
    farm.x = forest % terrain.size
    farm.y = Math.floor(forest / terrain.size)
    const ids = checkInvariants(world, terrain)
      .filter((v) => v.invariant === 'buildings-in-place')
      .map((v) => v.entityIds[0])
    expect(walls.length).toBeGreaterThan(1)
    expect(ids.sort()).toEqual([farm.id, storage.id, ...walls.map((b) => b.id)].sort())
  })

  it('catch goods kept in a building that is not a storage', () => {
    const { world } = worldWithCity()
    const house = world.buildings.find((b) => b.kind === 'house')!
    house.stock = { food: 3 }
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'goods-in-place', entityIds: [house.id] }),
    ])
  })

  it('catch a pick-up or drop order left over after its tick', () => {
    const { world } = worldWithCity()
    const [a, b] = world.residents
    a!.order = { kind: 'pickUp', from: { kind: 'ground' }, goods: { food: 1 } }
    b!.order = { kind: 'drop', to: { kind: 'ground' }, goods: { food: 1 } }
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'carry-orders-done', entityIds: [a!.id] }),
      expect.objectContaining({ invariant: 'carry-orders-done', entityIds: [b!.id] }),
    ])
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('catch a resident living in a city that does not exist', () => {
    const world = worldWithCity().world
    const r = world.residents[0]!
    r.cityId = 'nowhere'
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'residents-in-cities', entityIds: [r.id] }),
    ])
  })

  it('catch a resident of an NPC city who belongs to a realm', () => {
    const world = worldWithCity().world
    world.cities[0]!.realmId = null
    const [r, ...others] = world.residents
    for (const o of others) o.owner = null
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'npc-city-residents-unowned', entityIds: [r!.id] }),
    ])
  })

  it('catch an NPC city resident holding an order the city never gives', () => {
    const world = worldWithCity().world
    world.cities[0]!.realmId = null
    for (const o of world.residents) o.owner = null
    const r = world.residents[0]!
    r.order = { kind: 'drive', carriageId: 'k0', target: { x: 0, y: 0 }, path: null, progress: 0 }
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'npc-orders-allowed', entityIds: [r.id] }),
    )
  })

  it('catch an NPC city resident attacking someone of their own city', () => {
    const world = worldWithCity().world
    world.cities[0]!.realmId = null
    for (const o of world.residents) o.owner = null
    const [r, other] = world.residents
    r!.order = {
      kind: 'attack',
      targetId: other!.id,
      path: null,
      progress: 0,
      strike: 0,
      started: false,
    }
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'npc-fights-outsiders', entityIds: [r!.id] }),
    )
  })

  it('catch a pair that does not hold together', () => {
    const world = worldWithCity().world
    const [a, b, c] = world.residents as [Resident, Resident, Resident]
    const pairs = () =>
      checkInvariants(world, terrain).filter((v) => v.invariant === 'pairs-hold-together')
    a.pair = { partnerId: b.id, since: world.tick }
    b.pair = { partnerId: a.id, since: world.tick }
    expect(pairs()).toEqual([])
    c.pair = { partnerId: a.id, since: world.tick }
    expect(pairs().map((v) => v.message)).toEqual([expect.stringMatching(/doesn't pair back/)])
    delete c.pair
    b.pair.since = world.tick + 1
    expect(pairs().map((v) => v.message)).toEqual([
      expect.stringMatching(/pairs since/),
      expect.stringMatching(/pairs since/),
      expect.stringMatching(/after now/),
    ])
    b.pair.since = world.tick
    b.bornAt = world.tick
    expect(pairs().map((v) => v.message)).toEqual([expect.stringMatching(/as a child/)])
  })

  it('catch a resident carrying a child who works, or carries past the time', () => {
    const world = worldWithCity().world
    const [a, b] = world.residents as [Resident, Resident]
    const carrying = () =>
      checkInvariants(world, terrain).filter((v) => v.invariant === 'carrying-doesnt-work')
    a.order = null
    a.carrying = {
      since: world.tick,
      partnerId: b.id,
      partnerName: b.name,
      partnerBase: { strength: 10, endurance: 10, agility: 10, intellect: 10 },
    }
    expect(carrying()).toEqual([])
    const farm = world.buildings.find((x) => x.kind === 'farm')!
    a.order = { kind: 'workAt', buildingId: farm.id, at: { x: a.x, y: a.y }, progress: 0 }
    expect(carrying().map((v) => v.message)).toEqual([expect.stringMatching(/workAt order/)])
    a.order = null
    world.tick += CARRYING_TICKS + 1
    expect(carrying().map((v) => v.message)).toEqual([expect.stringMatching(/past its time/)])
  })

  it('are checked every tick at rate 1 and sampled below it', () => {
    expect(shouldCheckInvariants(1, () => 0.99)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.05)).toBe(true)
    expect(shouldCheckInvariants(0.1, () => 0.5)).toBe(false)
    expect(shouldCheckInvariants(0, () => 0)).toBe(false)
  })
})
