import {
  BUILD_MATERIALS,
  BUILD_WORK,
  CITY_AREA_MARGIN,
  CITY_BUILDING_REACH,
  HOME_FOOD_LOW,
  Terrain,
  cityMembership,
  citiesAt,
  inCityArea,
  teardownWork,
  type Building,
  type BuildingKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { updateCityMembership } from './cities.js'
import { checkInvariants, citiesFromBuildings } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

/** All Plains, 160 tiles a side. */
const terrain: TerrainMap = { size: 160, tiles: new Uint8Array(160 * 160).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** An empty world on the plains with realm r1 (Player 7) and its resident w1 at (1, 1). */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 1, y: 1, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  world.residents.push(r)
  return { world, r }
}

/**
 * Puts a finished building of no city with the north-west tile of its footprint on (x, y);
 * `updateCityMembership` decides its city.
 */
function put(world: WorldState, kind: BuildingKind, x: number, y: number, id = `${kind}${x},${y}`) {
  const b: Building = { id, kind, cityId: null, x, y }
  world.buildings.push(b)
  return b
}

/** A stretch of wall from (x, y) eastward, `n` tiles long. */
function wallEast(world: WorldState, x: number, y: number, n: number) {
  return Array.from({ length: n }, (_, i) => put(world, 'wall', x + i, y))
}

const cityOf = (world: WorldState, b: Building) => cityMembership(world, terrain.size).get(b.id)

/** Reach between footprints, `CITY_BUILDING_REACH`. */
const R = CITY_BUILDING_REACH

// A test city's town hall stands at (40, 40): its footprint runs to (42, 42).
describe('city membership (`CONTEXT.md`: City building)', () => {
  it('grows outward from the town hall in a chain of city buildings within reach', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    // Reach counts from footprint to footprint.
    const near = put(world, 'house', 42 + R, 40)
    const wall = wallEast(world, 44 + R, 40, 6)
    const far = put(world, 'storage', 49 + 2 * R, 40)
    const beyond = put(world, 'house', 51 + 3 * R, 40)
    expect(cityOf(world, near)).toBe('c1')
    for (const w of wall) expect(cityOf(world, w)).toBe('c1')
    expect(cityOf(world, far)).toBe('c1')
    expect(cityOf(world, beyond)).toBeUndefined()
  })

  it('leaves out farms, workplaces and stables, and construction sites, and so chains nothing through them', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    const farm = put(world, 'farm', 44, 40)
    const past = put(world, 'house', 43 + R, 40)
    const site = put(world, 'wall', 40, 44)
    site.site = { delivered: {}, work: 0 }
    const pastSite = put(world, 'house', 40, 43 + R)
    const members = cityMembership(world, terrain.size)
    for (const b of [farm, past, site, pastSite]) expect(members.has(b.id)).toBe(false)
  })

  it('gives a building both chains reach to the city whose town hall is nearer', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    addCity(world, { id: 'c2', realmId: 'r1', x: 60, y: 40 })
    // A wall from one town hall to the other: each part goes to the nearer hall, the older city
    // on a tie.
    const wall = wallEast(world, 43, 40, 17)
    expect(wall.map((w) => cityOf(world, w))).toEqual([
      ...Array<string>(8).fill('c1'),
      ...Array<string>(9).fill('c2'),
    ])
  })

  it('settles a tie for the older city', () => {
    const { world } = setup()
    addCity(world, { id: 'c9', realmId: 'r1', x: 40, y: 40 })
    addCity(world, { id: 'c3', realmId: 'r1', x: 60, y: 40 })
    const middle = put(world, 'house', 50, 40)
    expect(cityOf(world, middle)).toBe('c3')
  })

  it('lets a chain go on only through its own buildings', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    addCity(world, { id: 'c2', realmId: 'r1', x: 40, y: 56 })
    // A house c2 holds, and past it, out of c1's reach except through that house.
    const held = put(world, 'house', 48, 52)
    const past = put(world, 'house', 49 + R, 52)
    expect(cityOf(world, held)).toBe('c2')
    expect(cityOf(world, past)).toBe('c2')
  })

  it('reaches across the joins of the map', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 0, y: 0 })
    const across = put(world, 'house', terrain.size - 2, terrain.size - 1)
    expect(cityOf(world, across)).toBe('c1')
    expect(inCityArea(world, world.cities[0]!, terrain.size - 1, 1, terrain.size)).toBe(true)
  })

  it('drops a building cut off from the chain once the building between goes', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    const link = put(world, 'wall', 42 + R, 40)
    const end = put(world, 'house', 42 + 2 * R, 40)
    updateCityMembership(world, terrain.size)
    expect(end.cityId).toBe('c1')
    world.buildings = world.buildings.filter((b) => b !== link)
    updateCityMembership(world, terrain.size)
    expect(end.cityId).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('city area (`CONTEXT.md`: City area)', () => {
  it('is the tiles right around the city’s buildings’ footprints', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    wallEast(world, 43, 40, 3)
    updateCityMembership(world, terrain.size)
    const m = CITY_AREA_MARGIN
    expect(inCityArea(world, city, 40 - m, 40 - m, terrain.size)).toBe(true)
    expect(inCityArea(world, city, 45 + m, 40 + m, terrain.size)).toBe(true)
    expect(inCityArea(world, city, 42 + m, 42 + m, terrain.size)).toBe(true)
    expect(inCityArea(world, city, 45 + m + 1, 40, terrain.size)).toBe(false)
    expect(inCityArea(world, city, 40, 40 - m - 1, terrain.size)).toBe(false)
    expect(citiesAt(world, 44, 41, terrain.size)).toEqual([city])
  })

  it('is where residents are at home and take meals from the storage', () => {
    const { world, r } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    const storage = put(world, 'storage', 43, 40)
    storage.stock = { food: 50 }
    // Out along a new stretch of wall, far from the storage, but in the city's area.
    wallEast(world, 45, 40, 10)
    updateCityMembership(world, terrain.size)
    Object.assign(r, { x: 54 + CITY_AREA_MARGIN, y: 41, carried: {} })
    stepWorld(world, terrain)
    expect(r.carried.food).toBeGreaterThanOrEqual(HOME_FOOD_LOW)
    // One step further out there is nothing.
    Object.assign(r, { x: 55 + CITY_AREA_MARGIN, y: 41, carried: {} })
    stepWorld(world, terrain)
    expect(r.carried.food ?? 0).toBe(0)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

/** Lays a site of `kind` at the resident's tile with all its materials and all but a tick's work. */
function nearlyBuilt(
  world: WorldState,
  r: { id: string; x: number; y: number },
  kind: BuildingKind,
) {
  const site = put(world, kind, r.x, r.y, `site${world.buildings.length}`)
  site.site = { delivered: { ...BUILD_MATERIALS[kind] }, work: (BUILD_WORK[kind] ?? 1) - 1 }
  const resident = world.residents.find((x) => x.id === r.id)!
  resident.order = { kind: 'build', building: kind, at: { x: r.x, y: r.y }, siteId: site.id }
  return site
}

describe('town halls (`CONTEXT.md`: Town hall)', () => {
  it('can be built, and the finished town hall founds a city of the builder’s realm', () => {
    const { world, r } = setup()
    const q = new OrderQueue(undefined, terrain)
    expect(
      q.receive(world, me, 'q', { kind: 'build', residentId: r.id, building: 'townHall' }),
    ).toMatchObject({ type: 'ack' })
    const hall = nearlyBuilt(world, r, 'townHall')
    stepWorld(world, terrain)
    expect(hall.site).toBeUndefined()
    expect(world.cities).toEqual([expect.objectContaining({ realmId: 'r1', townHallId: hall.id })])
    expect(hall.cityId).toBe(world.cities[0]!.id)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a wall built near it grows the city', () => {
    const { world, r } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 2, y: 1 })
    Object.assign(r, { x: 4 + R, y: 1 })
    const wall = nearlyBuilt(world, r, 'wall')
    const out = 4 + R + CITY_AREA_MARGIN
    expect(inCityArea(world, city, out, 1, terrain.size)).toBe(false)
    stepWorld(world, terrain)
    expect(wall.cityId).toBe('c1')
    expect(inCityArea(world, city, out, 1, terrain.size)).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('torn down, dissolves the city: buildings and residents stay, residents are homeless', () => {
    const { world, r } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 1, y: 1 })
    const house = put(world, 'house', 5, 1)
    const farm = put(world, 'farm', 20, 20)
    farm.cityId = 'c1'
    updateCityMembership(world, terrain.size)
    const partner = newResident(mulberry32(2), {
      id: 'w2',
      owner: 'r1',
      cityId: 'c1',
      x: 3,
      y: 3,
      tick: 0,
    })
    world.residents.push(partner)
    r.cityId = 'c1'
    // Pairing changes no order: paired, they still tear down.
    partner.pair = { partnerId: r.id, since: 0 }
    r.pair = { partnerId: partner.id, since: 0 }
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    r.order = { kind: 'tearDown', buildingId: hall.id, at: { x: r.x, y: r.y } }
    // Almost torn down already: one tick of work finishes it.
    hall.teardown = teardownWork(hall) - 0.5
    stepWorld(world, terrain)
    expect(world.buildings).not.toContain(hall)
    expect(world.cities).toEqual([])
    expect(house).toMatchObject({ cityId: null, x: 5, y: 1 })
    expect(farm.cityId).toBeNull()
    expect(world.residents.map((x) => x.cityId)).toEqual([null, null])
    expect([r.pair, partner.pair]).toEqual([undefined, undefined])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('are watched by an invariant: one finished town hall per city, and cities follow the buildings', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    const house = put(world, 'house', 43, 40)
    expect(citiesFromBuildings.check(world, terrain).map((v) => v.message)).toEqual([
      `${house.id} belongs to city null, but stands in c1`,
    ])
    updateCityMembership(world, terrain.size)
    expect(citiesFromBuildings.check(world, terrain)).toEqual([])
    const stray = put(world, 'townHall', 120, 120)
    city.townHallId = 'gone'
    expect(citiesFromBuildings.check(world, terrain).map((v) => v.message)).toEqual([
      'c1 has no town hall',
      'c1-hall makes no city',
      'c1-hall belongs to city c1, but stands in null',
      `${house.id} belongs to city c1, but stands in null`,
      `${stray.id} makes no city`,
    ])
  })
})

describe('storages (`CONTEXT.md`: Storage)', () => {
  it('can be laid out in a city’s area and not outside it', () => {
    const { world, r } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    const q = new OrderQueue(undefined, terrain)
    const order = { kind: 'build', residentId: r.id, building: 'storage' }
    // Its footprint would reach a tile past the city's area.
    Object.assign(r, { x: 42 + CITY_AREA_MARGIN, y: 40 })
    expect(q.receive(world, me, 'q', order)).toMatchObject({
      type: 'rejected',
      reason: 'a storage goes in a city’s area',
    })
    Object.assign(r, { x: 43, y: 40 })
    expect(q.receive(world, me, 'q', order)).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    stepWorld(world, terrain)
    expect(world.buildings.find((b) => b.kind === 'storage')).toMatchObject({
      x: 43,
      y: 40,
      cityId: null,
      site: { delivered: {}, work: expect.any(Number) },
    })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('once finished belongs to the city and holds goods', () => {
    const { world, r } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
    Object.assign(r, { x: 43, y: 40 })
    const storage = nearlyBuilt(world, r, 'storage')
    stepWorld(world, terrain)
    expect(storage.site).toBeUndefined()
    expect(storage.cityId).toBe('c1')

    r.carried = { wood: 5 }
    const q = new OrderQueue(undefined, terrain)
    const spot = { kind: 'storage', storageId: storage.id }
    q.receive(world, me, 'd', { kind: 'drop', residentId: r.id, spot, goods: { wood: 5 } })
    q.applyAll(world)
    stepWorld(world, terrain)
    expect(storage.stock).toEqual({ wood: 5 })
    expect(r.carried.wood ?? 0).toBe(0)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})
