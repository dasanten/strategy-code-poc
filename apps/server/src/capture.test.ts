import {
  AVERAGE_HORSE_STATS,
  TICKS_PER_GAME_DAY,
  Terrain,
  captorOf,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { routeEnd } from './caravans.js'
import { attackOrder } from './combat.js'
import {
  checkInvariants,
  cityResidentsInItsRealm,
  takenCitiesCaptured,
  type Invariant,
} from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { stepStockFloor } from './stock-floor.js'
import { addCity, worldWithPost } from './test-terrain.js'
import { stepWorld } from './world.js'
import { createWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }

/**
 * A world with realm r1 (Player 7, Leader a1, far away), realm r2 (Player 8, Leader b1) and the
 * NPC city npc around (20, 20), where n1 and n2 live.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  resident(world, 'a1', 'r1', 50, 50)
  resident(world, 'b1', 'r2', 50, 10)
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  const n1 = resident(world, 'n1', null, 20, 20, 'npc')
  const n2 = resident(world, 'n2', null, 30, 30, 'npc')
  return { world, npc, n1, n2 }
}

/** A grown resident at (x, y) with every stat 10 and Agility 1, so they hardly dodge. */
function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  x: number,
  y: number,
  cityId: string | null = null,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  for (const s of ['strength', 'endurance', 'intellect'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.stats.agility = { base: 1, trained: 0 }
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** A resident carrying a sword, so they are armed. */
function armed<T extends { carried: Record<string, number | undefined> }>(r: T): T {
  r.carried.sword = 1
  return r
}

/** Steps the world until `done` holds, at most `ticks` times; answers whether it did. */
function stepUntil(world: WorldState, done: () => boolean, ticks = 200): boolean {
  for (let i = 0; i < ticks && !done(); i++) stepWorld(world, terrain)
  return done()
}

const capture: Invariant[] = [cityResidentsInItsRealm, takenCitiesCaptured]

describe('capturing a city', () => {
  it('an armed resident in an NPC city with no defender captures it with its residents', () => {
    const { world, npc, n1, n2 } = setup()
    n1.order = { kind: 'walkTo', target: { x: 0, y: 0 }, path: null, progress: 0 }
    const a2 = armed(resident(world, 'a2', 'r1', 21, 21))
    expect(captorOf(world, npc, terrain.size)).toBe('r1')
    const step = stepWorld(world, terrain)
    expect(step.captures).toEqual([{ cityId: 'npc', from: null, to: 'r1' }])
    expect(npc.realmId).toBe('r1')
    // Its residents join wherever they stand, loyal at once, and drop the orders they had.
    expect([n1.owner, n2.owner]).toEqual(['r1', 'r1'])
    expect(n1.order).toBeNull()
    expect(a2.owner).toBe('r1')
    expect(world.events.filter((e) => e.kind === 'cityCaptured')).toEqual([
      expect.objectContaining({
        userId: 7,
        cityId: 'npc',
        city: 'Dunmere',
        other: null,
        captor: true,
        residents: 2,
      }),
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('needs the attacker armed and inside the city area', () => {
    const { world, npc } = setup()
    const a2 = resident(world, 'a2', 'r1', 21, 21)
    resident(world, 'a3', 'r1', 28, 28).carried.sword = 1
    stepWorld(world, terrain)
    expect(npc.realmId).toBeNull()
    armed(a2)
    stepWorld(world, terrain)
    expect(npc.realmId).toBe('r1')
  })

  it('waits until no defender is left fighting', () => {
    const { world, npc, n1 } = setup()
    armed(n1).health = 1
    const a2 = armed(resident(world, 'a2', 'r1', 21, 20))
    expect(captorOf(world, npc, terrain.size)).toBeNull()
    stepWorld(world, terrain)
    expect(npc.realmId).toBeNull()
    a2.order = attackOrder('n1')
    expect(stepUntil(world, () => npc.realmId !== null)).toBe(true)
    expect(world.residents.some((r) => r.id === 'n1')).toBe(false)
    expect(npc.realmId).toBe('r1')
    expect(world.events.find((e) => e.kind === 'cityCaptured')).toMatchObject({ residents: 1 })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a defender who drops their weapon stops defending', () => {
    const { world, npc, n1 } = setup()
    armed(n1)
    armed(resident(world, 'a2', 'r1', 21, 20))
    stepWorld(world, terrain)
    expect(npc.realmId).toBeNull()
    n1.carried.sword = 0
    stepWorld(world, terrain)
    expect(npc.realmId).toBe('r1')
  })

  it('takes an NPC city with its own horses and carriages, not those of another NPC city', () => {
    const { world, npc } = setup()
    addCity(world, { id: 'npc2', realmId: null, x: 60, y: 60, name: 'Redbank' })
    const horse = (id: string, cityId: string) => ({
      id,
      realmId: null,
      cityId,
      x: 21,
      y: 21,
      hunger: 100,
      health: 100,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
    world.horses.push(horse('hN', 'npc'), horse('hO', 'npc2'))
    world.carriages.push({
      id: 'kN',
      realmId: null,
      cityId: 'npc',
      x: 21,
      y: 21,
      horseId: null,
      load: {},
    })
    armed(resident(world, 'a2', 'r1', 21, 20))
    stepWorld(world, terrain)
    expect(npc.realmId).toBe('r1')
    expect(world.horses.map((h) => [h.realmId, h.cityId])).toEqual([
      ['r1', null],
      [null, 'npc2'],
    ])
    expect(world.carriages[0]).toMatchObject({ realmId: 'r1', cityId: null })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes a Player’s city with its horses and carriages, and both realm logs show it', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 40, name: 'Hartwell' })
    world.buildings.push({ id: 'h2', kind: 'house', cityId: 'c2', x: 43, y: 40 })
    const leader = world.residents.find((r) => r.id === 'b1')!
    const a1 = world.residents.find((r) => r.id === 'a1')!
    Object.assign(leader, { x: 40, y: 41, cityId: 'c2' })
    const b2 = resident(world, 'b2', 'r2', 41, 41, 'c2')
    const b3 = resident(world, 'b3', 'r2', 41, 40, 'c2')
    b2.pair = { partnerId: 'b3', since: 0 }
    b3.pair = { partnerId: 'b2', since: 0 }
    const away = resident(world, 'b4', 'r2', 41, 39)
    world.horses.push({
      id: 'hA',
      realmId: 'r2',
      cityId: null,
      x: 43,
      y: 40,
      hunger: 100,
      health: 100,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
    world.horses.push({
      id: 'hB',
      realmId: 'r2',
      cityId: null,
      x: 50,
      y: 40,
      hunger: 100,
      health: 100,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
    world.carriages.push({
      id: 'kA',
      realmId: 'r2',
      cityId: null,
      x: 43,
      y: 41,
      horseId: null,
      load: {},
    })
    world.carriages.push({
      id: 'kB',
      realmId: 'r2',
      cityId: null,
      x: 10,
      y: 40,
      horseId: null,
      load: {},
    })
    const a2 = armed(resident(world, 'a2', 'r1', 43, 39))
    a2.order = attackOrder('b2')
    stepWorld(world, terrain)
    expect(city.realmId).toBe('r1')
    expect([b2.owner, b3.owner]).toEqual(['r1', 'r1'])
    // A pair who both join holds together; nobody keeps attacking their own realm.
    expect(b2.pair).toMatchObject({ partnerId: 'b3' })
    expect(a2.order).toBeNull()
    // The Leader is never captured: they stay in their realm, homeless.
    expect(leader).toMatchObject({ owner: 'r2', cityId: null })
    // A resident of the realm living elsewhere stays, even standing in the city.
    expect(away.owner).toBe('r2')
    expect(world.horses.map((h) => h.realmId)).toEqual(['r1', 'r2'])
    expect(world.carriages.map((k) => k.realmId)).toEqual(['r1', 'r2'])
    const logs = world.events.filter((e) => e.kind === 'cityCaptured')
    expect(logs).toEqual([
      expect.objectContaining({ userId: 7, other: leader.name, captor: true, residents: 2 }),
      expect.objectContaining({ userId: 8, other: a1.name, captor: false, residents: 2 }),
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a pair with the Leader ends when the city is captured', () => {
    const { world } = setup()
    addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 40 })
    const leader = world.residents.find((r) => r.id === 'b1')!
    Object.assign(leader, { cityId: 'c2' })
    const b2 = resident(world, 'b2', 'r2', 41, 41, 'c2')
    leader.pair = { partnerId: 'b2', since: 0 }
    b2.pair = { partnerId: 'b1', since: 0 }
    armed(resident(world, 'a2', 'r1', 40, 40))
    stepWorld(world, terrain)
    expect([leader.pair, b2.pair]).toEqual([undefined, undefined])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('nobody captures while two realms’ armed residents are inside', () => {
    const { world, npc } = setup()
    armed(resident(world, 'a2', 'r1', 21, 20))
    const b2 = armed(resident(world, 'b2', 'r2', 19, 20))
    stepWorld(world, terrain)
    expect(npc.realmId).toBeNull()
    b2.x = 30
    stepWorld(world, terrain)
    expect(npc.realmId).toBe('r1')
  })

  it('an ally neither captures nor lets the city fall while armed inside', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 40 })
    world.alliances.push({
      id: 'al1',
      name: 'North',
      leaderId: 'r1',
      members: [
        { realmId: 'r1', joinedAt: 0, leaving: null },
        { realmId: 'r2', joinedAt: 0, leaving: null },
      ],
      invites: [],
      army: [],
    })
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'c1' })
    resident(world, 'c1', 'r3', 5, 5)
    const ally = armed(resident(world, 'a2', 'r1', 40, 41))
    stepWorld(world, terrain)
    expect(city.realmId).toBe('r2')
    armed(resident(world, 'c3', 'r3', 41, 41))
    stepWorld(world, terrain)
    expect(city.realmId).toBe('r2')
    ally.x = 10
    stepWorld(world, terrain)
    expect(city.realmId).toBe('r3')
  })

  it('an NPC city’s residents who are armed defend only their own city', () => {
    const { world, npc } = setup()
    addCity(world, { id: 'npc2', realmId: null, x: 30, y: 20 })
    armed(resident(world, 'm1', null, 20, 21, 'npc2'))
    armed(resident(world, 'a2', 'r1', 21, 20))
    stepWorld(world, terrain)
    expect(npc.realmId).toBe('r1')
  })

  it('the invariants catch a city left standing taken and residents in the wrong realm', () => {
    const { world, npc, n2 } = setup()
    armed(resident(world, 'a2', 'r1', 21, 20))
    expect(checkInvariants(world, terrain, capture).map((v) => v.invariant)).toEqual([
      'taken-cities-captured',
    ])
    npc.realmId = 'r1'
    expect(checkInvariants(world, terrain, capture).map((v) => v.invariant)).toEqual([
      'city-residents-in-its-realm',
      'city-residents-in-its-realm',
    ])
    for (const r of world.residents) if (r.cityId === 'npc') r.owner = 'r1'
    expect(n2.owner).toBe('r1')
    expect(checkInvariants(world, terrain, capture)).toEqual([])
  })
})

describe('Capturing a trading post', () => {
  it('takes it out of the Trade Organization: its warehouse a storage, its orders to the HQ', () => {
    const { world, terrain: land, post } = worldWithPost()
    const realm = world.realms[0]!
    const home = world.cities.find((c) => c.realmId === realm.id)!
    const warehouse = world.buildings.find((b) => b.cityId === post.id && b.kind === 'warehouse')!
    const route = world.caravans.find((c) => c.postId === post.id)!
    const goods = routeEnd(world, route, 'hq').warehouse!
    const delivery = {
      id: 'delivery1',
      kind: 'delivery' as const,
      realmId: realm.id,
      warehouseId: warehouse.id,
      cityId: home.id,
      good: 'wood' as const,
      units: 5,
      fee: 10,
      caravanId: null,
    }
    world.deliveries.push(delivery)
    const people = world.residents.filter((r) => r.cityId === post.id)
    captureCity(world, post, realm.id, land.size)
    expect(post).toMatchObject({ realmId: realm.id })
    expect(post.tradeOrg).toBeUndefined()
    for (const r of people) expect(r.owner).toBe(realm.id)
    expect(warehouse.kind).toBe('storage')
    expect(world.caravans.some((c) => c.postId === post.id)).toBe(false)
    expect(world.deliveries).toEqual([{ ...delivery, warehouseId: goods.id }])
    // No stock floor any more: what it holds runs out like any storage's.
    warehouse.stock = {}
    world.tick = TICKS_PER_GAME_DAY - 1
    stepStockFloor(world)
    expect(warehouse.stock).toEqual({})
    expect(checkInvariants(world, land)).toEqual([])
  })
})
