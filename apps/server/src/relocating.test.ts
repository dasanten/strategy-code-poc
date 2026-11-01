import {
  CARRYING_A_CHILD,
  HOUSING_ROOM,
  Terrain,
  buildProblem,
  cityAreaTiles,
  freeHousing,
  inCityArea,
  relocateProblem,
  relocateRoom,
  terrainAt,
  townHallOf,
  wrapDistance,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { dissolveCity } from './cities.js'
import {
  checkInvariants,
  cityResidentsInItsRealm,
  npcCityResidentsUnowned,
  relocateOrdersSound,
  residentsInCities,
} from './invariants.js'
import { OrderQueue } from './orders.js'
import { npcSender } from './order-sender.js'
import { baseStats, mulberry32, newResident } from './residents.js'
import { addCity, worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

const me = { userId: 1, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 2, account: { name: 'Tobin', isAdmin: false } }

/** A free Plains tile at least `far` tiles from every building, for another city's town hall. */
function freePlains(world: WorldState, terrain: TerrainMap, far: number) {
  const size = terrain.size
  const home = world.buildings.find((b) => b.kind === 'townHall')!
  const taken = new Set(world.buildings.map((b) => `${b.x},${b.y}`))
  for (const n of world.nodes) taken.add(`${n.x},${n.y}`)
  // Near home, so the walk there is short.
  let best: { x: number; y: number } | undefined
  for (let y = home.y - 80; y < home.y + 80; y++) {
    for (let x = home.x - 80; x < home.x + 80; x++) {
      const t = { x: (x + size) % size, y: (y + size) % size }
      if (taken.has(`${t.x},${t.y}`)) continue
      const plains = [0, 1, 2].every((dy) =>
        [0, 1, 2].every((dx) => terrainAt(terrain, t.x + dx, t.y + dy) === Terrain.Plains),
      )
      if (!plains) continue
      if (!world.buildings.every((b) => wrapDistance(size, b, t) >= far)) continue
      if (!best || wrapDistance(size, home, t) < wrapDistance(size, home, best)) best = t
    }
  }
  if (!best) throw new Error('no free Plains')
  return best
}

/** Adds `n` finished houses to a city where they fit in its area (`CONTEXT.md`: City area). */
function addHouses(world: WorldState, terrain: TerrainMap, city: City, n: number) {
  for (let i = 0; i < n; i++) {
    const free = [...cityAreaTiles(world, city, terrain.size)].find((key) => {
      const [x, y] = key.split(',').map(Number) as [number, number]
      return !buildProblem(world, x, y, 'house', terrain)
    })
    if (!free) throw new Error('no free tile in the city')
    const [x, y] = free.split(',').map(Number) as [number, number]
    world.buildings.push({ id: `h${x},${y}`, kind: 'house', cityId: city.id, x, y })
  }
}

/**
 * Player 1's starting city and a second city of their realm, Redbank, some way off, with one house
 * (`houses`) and nobody living there.
 */
function setup(houses = 1) {
  const { world, terrain } = worldWithCity()
  const realm = world.realms[0]!
  const first = world.cities[0]!
  const second = addCity(world, {
    id: 'city-second',
    realmId: realm.id,
    ...freePlains(world, terrain, 16),
    name: 'Redbank',
  })
  addHouses(world, terrain, second, houses)
  const queue = new OrderQueue(undefined, terrain)
  const walking = new Walking(terrain)
  const ana = world.residents.find((r) => r.id !== realm.leaderId && r.cityId === first.id)!
  ana.name = 'Ana'
  return { world, terrain, realm, first, second, queue, walking, ana }
}

/** Sends an order from `sender` and applies it as the next tick would; returns the answer. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  queue.applyAll(world)
  return answer
}

const relocate = (world: WorldState, queue: OrderQueue, r: Resident, city: City, sender = me) =>
  order(world, queue, { kind: 'relocate', residentId: r.id, cityId: city.id }, sender)

/** Steps the world until the resident's order is over, at most `max` ticks; returns the ticks. */
function untilDone(
  world: WorldState,
  terrain: TerrainMap,
  walking: Walking,
  r: Resident,
  max = 600,
) {
  for (let t = 1; t <= max; t++) {
    stepWorld(world, terrain, walking)
    if (r.order?.kind !== 'relocate') return t
  }
  throw new Error(`${r.name} still relocating after ${max} ticks`)
}

/** `r` starts carrying a child by `partner` (`CONTEXT.md`: Carrying). */
function carryChild(r: Resident, partner: Resident) {
  r.carrying = {
    since: 0,
    partnerId: partner.id,
    partnerName: partner.name,
    partnerBase: baseStats(partner),
  }
}

/** Another resident of the realm, living in `cityId` (or homeless), standing at (x, y). */
function addResident(world: WorldState, id: string, cityId: string | null, x: number, y: number) {
  const realm = world.realms[0]!
  const r = newResident(mulberry32(id.length), { id, owner: realm.id, cityId, x, y, tick: 0 })
  world.residents.push(r)
  return r
}

describe('giving the relocate order', () => {
  it('heads for the nearest tile of the city’s area', () => {
    const { world, terrain, second, queue, ana } = setup()
    expect(relocate(world, queue, ana, second)).toEqual({ type: 'ack', requestId: 'q' })
    const o = ana.order
    expect(o?.kind).toBe('relocate')
    if (o?.kind !== 'relocate') return
    expect(o.cityId).toBe(second.id)
    expect(inCityArea(world, second, o.target.x, o.target.y, terrain.size)).toBe(true)
    const d = wrapDistance(terrain.size, ana, o.target)
    for (const key of cityAreaTiles(world, second, terrain.size)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      if (terrainAt(terrain, x, y) === Terrain.Lake || terrainAt(terrain, x, y) === Terrain.Sea)
        continue
      expect(wrapDistance(terrain.size, ana, { x, y })).toBeGreaterThanOrEqual(d - 1e-9)
    }
  })

  it('turns it down for someone else’s resident, or an NPC city’s', () => {
    const { world, second, queue, ana } = setup()
    const before = structuredClone(ana.order)
    expect(relocate(world, queue, ana, second, stranger)).toMatchObject({
      type: 'rejected',
      reason: 'not one of your residents',
    })
    const npc = addCity(world, { id: 'npc', realmId: null, x: 0, y: 0 })
    expect(relocate(world, queue, ana, second, npcSender(npc))).toMatchObject({
      reason: 'not one of your residents',
    })
    expect(ana.order).toEqual(before)
  })

  it('turns it down for a city that isn’t the realm’s, or their own', () => {
    const { world, first, second, queue, ana } = setup()
    const npc = addCity(world, { id: 'npc', realmId: null, x: 0, y: 0 })
    expect(relocate(world, queue, ana, npc)).toMatchObject({ reason: 'not a city of your realm' })
    second.realmId = 'someone-else'
    expect(relocate(world, queue, ana, second)).toMatchObject({
      reason: 'not a city of your realm',
    })
    expect(relocate(world, queue, ana, first)).toMatchObject({
      reason: `Ana already lives in ${first.name}`,
    })
    expect(order(world, queue, { kind: 'relocate', residentId: ana.id, cityId: 7 })).toMatchObject({
      reason: 'not a city of your realm',
    })
  })

  it('turns it down for a city with no free housing', () => {
    const { world, second, queue, ana } = setup(0)
    expect(freeHousing(world, second)).toBe(0)
    expect(relocate(world, queue, ana, second)).toMatchObject({ reason: 'no free housing' })
  })

  it('counts the residents already relocating there against its free housing', () => {
    const { world, first, second, queue, ana } = setup()
    const room = HOUSING_ROOM.house!
    const hall = townHallOf(world, first)!
    const others = Array.from({ length: room }, (_, i) =>
      addResident(world, `mover${i}`, first.id, hall.x, hall.y),
    )
    for (const r of others) expect(relocate(world, queue, r, second).type).toBe('ack')
    expect(relocateRoom(world, second)).toBe(0)
    expect(relocate(world, queue, ana, second)).toMatchObject({ reason: 'no free housing' })
    // One of them told again counts once.
    expect(relocate(world, queue, others[0]!, second).type).toBe('ack')
    // A group needs room for all (`relocateProblem`, for T55.2).
    others[0]!.order = null
    const pair = [others[0]!, ana]
    expect(relocateProblem(world, world.realms[0]!.id, pair, second.id)).toBe(
      'free housing for 1 only',
    )
  })

  it('turns it down for a partner carrying a child', () => {
    const { world, first, second, queue, ana } = setup()
    carryChild(
      ana,
      world.residents.find((r) => r !== ana && r.cityId === first.id)!,
    )
    expect(relocate(world, queue, ana, second)).toMatchObject({
      reason: `Ana is ${CARRYING_A_CHILD}`,
    })
  })
})

describe('moving in', () => {
  it('walks there and moves in on stepping into its area, free housing changing in both cities', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    const freeFirst = freeHousing(world, first)
    const freeSecond = freeHousing(world, second)
    relocate(world, queue, ana, second)
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(second.id)
    expect(ana.order).toBeNull()
    expect(inCityArea(world, second, ana.x, ana.y, terrain.size)).toBe(true)
    expect(freeHousing(world, first)).toBe(freeFirst + 1)
    expect(freeHousing(world, second)).toBe(freeSecond - 1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('moves in at once when already in its area', () => {
    const { world, terrain, second, queue, walking, ana } = setup()
    const hall = townHallOf(world, second)!
    Object.assign(ana, { x: hall.x - 1, y: hall.y })
    relocate(world, queue, ana, second)
    expect(untilDone(world, terrain, walking, ana)).toBe(1)
    expect(ana.cityId).toBe(second.id)
  })

  it('gives a homeless resident a home', () => {
    const { world, terrain, first, second, queue, walking } = setup()
    const hall = townHallOf(world, first)!
    const homeless = addResident(world, 'homeless', null, hall.x, hall.y)
    relocate(world, queue, homeless, second)
    untilDone(world, terrain, walking, homeless)
    expect(homeless.cityId).toBe(second.id)
  })

  it('ends a pair, on both partners', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    const partner = world.residents.find((r) => r !== ana && r.cityId === first.id)!
    ana.pair = { partnerId: partner.id, since: world.tick }
    partner.pair = { partnerId: ana.id, since: world.tick }
    relocate(world, queue, ana, second)
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(second.id)
    expect(ana.pair).toBeUndefined()
    expect(partner.pair).toBeUndefined()
  })

  it('ends a pair whose other partner carries the child, who goes on carrying it', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    const carrier = world.residents.find((r) => r !== ana && r.cityId === first.id)!
    ana.pair = { partnerId: carrier.id, since: world.tick }
    carrier.pair = { partnerId: ana.id, since: world.tick }
    carryChild(carrier, ana)
    // The carrier can't be told to relocate; Ana can.
    expect(relocate(world, queue, carrier, second).type).toBe('rejected')
    expect(relocate(world, queue, ana, second).type).toBe('ack')
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(second.id)
    expect(carrier.cityId).toBe(first.id)
    expect(ana.pair).toBeUndefined()
    expect(carrier.pair).toBeUndefined()
    expect(carrier.carrying?.partnerId).toBe(ana.id)
  })
})

describe('failing to move in', () => {
  const failed = (world: WorldState) => world.events.filter((e) => e.kind === 'relocateFailed')

  it('stops when the free housing is gone on arrival, keeping their old city', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    relocate(world, queue, ana, second)
    // Someone moves in first and fills the house.
    const hall = townHallOf(world, second)!
    for (let i = 0; i < HOUSING_ROOM.house!; i++)
      addResident(world, `settler${i}`, second.id, hall.x, hall.y)
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(first.id)
    expect(ana.order).toBeNull()
    expect(failed(world)).toMatchObject([
      { name: 'Ana', city: 'Redbank', cityId: second.id, reason: 'no free housing' },
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stops when the city changed hands on the way', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    relocate(world, queue, ana, second)
    world.realms.push({ ...world.realms[0]!, id: 'realm-other', userId: 2, leaderId: 'nobody' })
    second.realmId = 'realm-other'
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(first.id)
    expect(failed(world)).toMatchObject([
      { name: 'Ana', city: 'Redbank', reason: 'it is no longer your realm’s' },
    ])
  })

  it('stops when the city is gone', () => {
    const { world, terrain, first, second, queue, walking, ana } = setup()
    relocate(world, queue, ana, second)
    dissolveCity(world, second)
    untilDone(world, terrain, walking, ana)
    expect(ana.cityId).toBe(first.id)
    expect(failed(world)).toMatchObject([{ name: 'Ana', reason: 'the city is gone' }])
    expect(failed(world)[0]).not.toHaveProperty('city')
  })
})

describe('relocating invariants', () => {
  // A realm's residents live in one of its cities or in none: the city must exist
  // (`residents-in-cities`), be no NPC city (`npc-city-residents-unowned`) and be theirs
  // (`city-residents-in-its-realm`).
  it('flag a realm’s resident living in a city not of their realm', () => {
    const { world, terrain, second, ana } = setup()
    expect(checkInvariants(world, terrain)).toEqual([])
    const homes = [residentsInCities, npcCityResidentsUnowned, cityResidentsInItsRealm]
    const flagged = () => homes.flatMap((i) => i.check(world, terrain)).map((v) => v.invariant)
    ana.cityId = second.id
    second.realmId = 'realm-other'
    expect(flagged()).toEqual(['city-residents-in-its-realm'])
    second.realmId = null
    expect(flagged()).toEqual(['npc-city-residents-unowned'])
    ana.cityId = 'gone'
    expect(flagged()).toEqual(['residents-in-cities'])
  })

  it('flag a relocate order to the city the resident lives in, or by someone carrying', () => {
    const { world, first, second, ana } = setup()
    ana.order = { kind: 'relocate', cityId: first.id, target: ana, path: null, progress: 0 }
    expect(relocateOrdersSound.check(world, undefined!)).toHaveLength(1)
    ana.order.cityId = second.id
    expect(relocateOrdersSound.check(world, undefined!)).toEqual([])
    carryChild(
      ana,
      world.residents.find((r) => r !== ana)!,
    )
    expect(relocateOrdersSound.check(world, undefined!)).toHaveLength(1)
  })
})
