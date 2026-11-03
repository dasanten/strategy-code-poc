import {
  AVERAGE_HORSE_STATS,
  OCCUPATION_TICKS,
  Terrain,
  cityPrice,
  inCityArea,
  tradeOrgHq,
  type City,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { checkInvariants, ownersExist, carriagesInPlace } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { endRealm } from './survival.js'
import { addCity, worldWithPost } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const buyer = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A grown resident at (x, y). */
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
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

function horse(
  world: WorldState,
  id: string,
  owner: { realmId?: string; cityId?: string },
  x: number,
  y: number,
): Horse {
  const h: Horse = {
    id,
    name: 'Rowan',
    realmId: owner.realmId ?? null,
    cityId: owner.cityId ?? null,
    x,
    y,
    hunger: 100,
    health: 100,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(h)
  return h
}

function carriage(
  world: WorldState,
  id: string,
  owner: { realmId?: string; cityId?: string },
  x: number,
  y: number,
  horseId: string | null = null,
) {
  const k = {
    id,
    realmId: owner.realmId ?? null,
    cityId: owner.cityId ?? null,
    x,
    y,
    horseId,
    load: {},
  }
  world.carriages.push(k)
  return k
}

const stable = (world: WorldState, id: string, cityId: string, x: number, y: number) =>
  world.buildings.push({ id, kind: 'stable', cityId, x, y, stock: {} })

const ownerOf = (world: WorldState, id: string) => {
  const t = [...world.horses, ...world.carriages].find((x) => x.id === id)!
  return { realmId: t.realmId, cityId: t.cityId }
}
const JOINED = { realmId: 'r1', cityId: null }

/**
 * Realm r1 (Player 7, Leader a1, far away) and the NPC city npc, its town hall on (20..22, 20..22),
 * where n1 lives, with a stable st past its area.
 */
function npcCity() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  resident(world, 'a1', 'r1', 60, 60)
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  resident(world, 'n1', null, 24, 20, 'npc')
  stable(world, 'st', 'npc', 34, 20)
  expect(inCityArea(world, npc, 34, 20, terrain.size)).toBe(false)
  return { world, npc }
}

/** The ways a realm's resident brings an NPC city in, each a whole tick of the world. */
const WAYS: [string, (world: WorldState, city: City) => void][] = [
  [
    'captured',
    (world, city) => {
      resident(world, 'p1', 'r1', 21, 21).carried.sword = 1
      city.occupation = { realmId: 'r1', since: world.tick + 1 - OCCUPATION_TICKS }
      stepWorld(world, terrain)
    },
  ],
  [
    'bought',
    (world, city) => {
      const queue = new OrderQueue(undefined, terrain)
      resident(world, 'p1', 'r1', 21, 21).carried.coins = cityPrice(world, city)
      const order = { kind: 'buyCity', residentId: 'p1', cityId: city.id }
      expect(queue.receive(world, buyer, 'q', order).type).toBe('ack')
      queue.applyAll(world)
      stepWorld(world, terrain)
    },
  ],
  [
    'persuaded',
    (world, city) => {
      const queue = new OrderQueue(undefined, terrain)
      world.joinRequests.push({ cityId: city.id, realmId: 'r1', at: 0, declined: false })
      const order = { kind: 'acceptJoin', cityId: city.id }
      expect(queue.receive(world, buyer, 'q', order).type).toBe('ack')
      queue.applyAll(world)
      stepWorld(world, terrain)
    },
  ],
]

describe.each(WAYS)('an NPC city %s', (_, join) => {
  it('brings all its own horses and carriages, wherever they stand', () => {
    const { world, npc } = npcCity()
    horse(world, 'atStable', { cityId: 'npc' }, 34, 20)
    horse(world, 'inArea', { cityId: 'npc' }, 21, 24)
    horse(world, 'farAway', { cityId: 'npc' }, 50, 10)
    horse(world, 'pulling', { cityId: 'npc' }, 50, 12)
    carriage(world, 'kFar', { cityId: 'npc' }, 50, 12, 'pulling')
    carriage(world, 'kStable', { cityId: 'npc' }, 34, 20)
    join(world, npc)
    expect(npc.realmId).toBe('r1')
    for (const id of ['atStable', 'inArea', 'farAway', 'pulling', 'kFar', 'kStable'])
      expect(ownerOf(world, id), id).toEqual(JOINED)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves another NPC city’s, even at its stable or in its area', () => {
    const { world, npc } = npcCity()
    addCity(world, { id: 'npc2', realmId: null, x: 50, y: 50, name: 'Redbank' })
    horse(world, 'visitor', { cityId: 'npc2' }, 34, 20)
    horse(world, 'passing', { cityId: 'npc2' }, 21, 24)
    carriage(world, 'kPassing', { cityId: 'npc2' }, 21, 25)
    join(world, npc)
    for (const id of ['visitor', 'passing', 'kPassing'])
      expect(ownerOf(world, id), id).toEqual({ realmId: null, cityId: 'npc2' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a resident who rides keeps their horse, and one who drives their carriage', () => {
    const { world, npc } = npcCity()
    horse(world, 'ridden', { cityId: 'npc' }, 50, 10)
    const rider = resident(world, 'n2', null, 50, 10, 'npc')
    rider.riding = 'ridden'
    horse(world, 'pulling', { cityId: 'npc' }, 50, 12)
    carriage(world, 'kDriven', { cityId: 'npc' }, 50, 12, 'pulling')
    const driver = resident(world, 'n3', null, 50, 12, 'npc')
    driver.order = {
      kind: 'drive',
      carriageId: 'kDriven',
      target: { x: 50, y: 20 },
      path: null,
      progress: 0,
    }
    join(world, npc)
    expect(rider).toMatchObject({ owner: 'r1', riding: 'ridden' })
    expect(driver.owner).toBe('r1')
    for (const id of ['ridden', 'pulling', 'kDriven'])
      expect(ownerOf(world, id), id).toEqual(JOINED)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('a Player’s city captured', () => {
  /**
   * The world of `npcCity`, with realm r2 (Player 8, Leader b1) and its cities c2, its town hall at
   * (40, 40) and a stable st2 past its area, where b2 lives, and c3, with a stable st3.
   */
  function playerCity() {
    const { world } = npcCity()
    world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
    resident(world, 'b1', 'r2', 60, 5)
    const c2 = addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 40, name: 'Hartwell' })
    addCity(world, { id: 'c3', realmId: 'r2', x: 10, y: 50, name: 'Elmstead' })
    stable(world, 'st2', 'c2', 54, 40)
    stable(world, 'st3', 'c3', 24, 50)
    expect(inCityArea(world, c2, 54, 40, terrain.size)).toBe(false)
    resident(world, 'b2', 'r2', 41, 44, 'c2')
    return { world, c2 }
  }

  /** Captures c2 by r1, whose p1 stands armed on its hall. */
  function captured(world: WorldState, city: City) {
    resident(world, 'p1', 'r1', 41, 41).carried.sword = 1
    city.occupation = { realmId: 'r1', since: world.tick + 1 - OCCUPATION_TICKS }
    stepWorld(world, terrain)
    expect(city.realmId).toBe('r1')
  }

  it('brings those in its area or at its stables, and none elsewhere', () => {
    const { world, c2 } = playerCity()
    horse(world, 'atStable', { realmId: 'r2' }, 55, 41)
    horse(world, 'inArea', { realmId: 'r2' }, 41, 45)
    horse(world, 'elsewhere', { realmId: 'r2' }, 5, 5)
    horse(world, 'atOtherStable', { realmId: 'r2' }, 24, 50)
    horse(world, 'pulling', { realmId: 'r2' }, 54, 40)
    carriage(world, 'kStable', { realmId: 'r2' }, 54, 40, 'pulling')
    carriage(world, 'kElsewhere', { realmId: 'r2' }, 5, 6)
    captured(world, c2)
    for (const id of ['atStable', 'inArea', 'pulling', 'kStable'])
      expect(ownerOf(world, id), id).toEqual(JOINED)
    for (const id of ['elsewhere', 'atOtherStable', 'kElsewhere'])
      expect(ownerOf(world, id), id).toEqual({ realmId: 'r2', cityId: null })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves another realm’s horse at its stable', () => {
    const { world, c2 } = playerCity()
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'c1' })
    resident(world, 'c1', 'r3', 5, 60)
    horse(world, 'visitor', { realmId: 'r3' }, 54, 40)
    captured(world, c2)
    expect(ownerOf(world, 'visitor')).toEqual({ realmId: 'r3', cityId: null })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a resident far away who rides keeps their horse, and one who drives their carriage', () => {
    const { world, c2 } = playerCity()
    horse(world, 'ridden', { realmId: 'r2' }, 5, 5)
    const rider = resident(world, 'b3', 'r2', 5, 5, 'c2')
    rider.riding = 'ridden'
    horse(world, 'pulling', { realmId: 'r2' }, 8, 8)
    carriage(world, 'kDriven', { realmId: 'r2' }, 8, 8, 'pulling')
    const driver = resident(world, 'b4', 'r2', 8, 8, 'c2')
    driver.order = {
      kind: 'drive',
      carriageId: 'kDriven',
      target: { x: 8, y: 20 },
      path: null,
      progress: 0,
    }
    captured(world, c2)
    expect(rider).toMatchObject({ owner: 'r1', riding: 'ridden' })
    expect(driver).toMatchObject({ owner: 'r1', order: null })
    for (const id of ['ridden', 'pulling', 'kDriven'])
      expect(ownerOf(world, id), id).toEqual(JOINED)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('whoever doesn’t join loses the horse or carriage that does, and goes on foot', () => {
    const { world, c2 } = playerCity()
    horse(world, 'atStable', { realmId: 'r2' }, 54, 40)
    const rider = resident(world, 'b3', 'r2', 54, 40)
    rider.riding = 'atStable'
    horse(world, 'pulling', { realmId: 'r2' }, 56, 40)
    carriage(world, 'kStable', { realmId: 'r2' }, 56, 40, 'pulling')
    const driver = resident(world, 'b4', 'r2', 56, 40)
    driver.order = {
      kind: 'drive',
      carriageId: 'kStable',
      target: { x: 56, y: 50 },
      path: null,
      progress: 0,
    }
    captured(world, c2)
    expect(ownerOf(world, 'atStable')).toEqual(JOINED)
    expect(ownerOf(world, 'kStable')).toEqual(JOINED)
    expect(rider.owner).toBe('r2')
    expect(rider.riding).toBeUndefined()
    expect(driver).toMatchObject({ owner: 'r2', order: null })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a self-managed former Player’s city brings what it got from the realm, wherever it stands', () => {
    const { world, c2 } = playerCity()
    horse(world, 'atStable', { realmId: 'r2' }, 54, 40)
    endRealm(
      world,
      world.realms.find((r) => r.id === 'r2')!,
      terrain.size,
    )
    expect(ownerOf(world, 'atStable')).toEqual({ realmId: null, cityId: 'c2' })
    captureCity(world, c2, 'r1', terrain.size)
    expect(ownerOf(world, 'atStable')).toEqual(JOINED)
  })
})

describe('a trading post captured', () => {
  it('leaves the Trade Organization’s caravans to it', () => {
    const { world, terrain: land, post } = worldWithPost()
    const hq = tradeOrgHq(world)!
    const route = world.caravans.find((c) => c.postId === post.id)!
    captureCity(world, post, world.realms[0]!.id, land.size)
    const k = world.carriages.find((x) => x.id === route.carriageId)!
    expect(k).toMatchObject({ realmId: null, cityId: hq.id })
    expect(world.horses.find((h) => h.id === k.horseId)).toMatchObject({
      realmId: null,
      cityId: hq.id,
    })
  })
})

describe('the invariants', () => {
  it('catch a horse or carriage left to a city that has a realm', () => {
    const { world, npc } = npcCity()
    horse(world, 'h', { cityId: 'npc' }, 34, 20)
    carriage(world, 'k', { cityId: 'npc' }, 34, 21)
    const stranded = () => ownersExist.check(world, terrain).flatMap((v) => v.entityIds)
    expect(stranded()).toEqual([])
    npc.realmId = 'r1'
    expect(stranded()).toEqual(['h', 'k'])
  })

  it('catch a hitched horse that isn’t its carriage’s realm’s or city’s', () => {
    const { world } = npcCity()
    const h = horse(world, 'h', { realmId: 'r1' }, 34, 20)
    carriage(world, 'k', { realmId: 'r1' }, 34, 20, 'h')
    const found = () => carriagesInPlace.check(world, terrain).map((v) => v.message)
    expect(found()).toEqual([])
    Object.assign(h, { realmId: null, cityId: 'npc' })
    expect(found()).toEqual([expect.stringContaining('not its own')])
    Object.assign(h, { realmId: 'r1', cityId: null })
    expect(found()).toEqual([])
  })
})
