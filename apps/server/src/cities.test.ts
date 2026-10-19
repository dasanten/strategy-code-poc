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

/** All Plains, 40 tiles a side. */
const terrain: TerrainMap = { size: 40, tiles: new Uint8Array(40 * 40).fill(Terrain.Plains) }
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

/** Puts a finished building of no city on the tile; `updateCityMembership` decides its city. */
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

describe('city membership (`CONTEXT.md`: City building)', () => {
  it('grows outward from the town hall in a chain of city buildings within reach', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    const near = put(world, 'house', 10 + CITY_BUILDING_REACH, 10)
    const wall = wallEast(world, 14, 10, 6)
    const far = put(world, 'storage', 19 + CITY_BUILDING_REACH, 10)
    const beyond = put(world, 'house', 19 + 2 * CITY_BUILDING_REACH + 1, 10)
    expect(cityOf(world, near)).toBe('c1')
    for (const w of wall) expect(cityOf(world, w)).toBe('c1')
    expect(cityOf(world, far)).toBe('c1')
    expect(cityOf(world, beyond)).toBeUndefined()
  })

  it('leaves out farms, workplaces and stables, and construction sites, and so chains nothing through them', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    const farm = put(world, 'farm', 13, 10)
    const past = put(world, 'house', 16, 10)
    const site = put(world, 'wall', 10, 13)
    site.site = { delivered: {}, work: 0 }
    const pastSite = put(world, 'house', 10, 16)
    const members = cityMembership(world, terrain.size)
    for (const b of [farm, past, site, pastSite]) expect(members.has(b.id)).toBe(false)
  })

  it('gives a building both chains reach to the city whose town hall is nearer', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    addCity(world, { id: 'c2', realmId: 'r1', x: 17, y: 10 })
    // A wall from one town hall to the other: each half goes to the nearer hall.
    const wall = wallEast(world, 11, 10, 6)
    expect(wall.map((w) => cityOf(world, w))).toEqual(['c1', 'c1', 'c1', 'c2', 'c2', 'c2'])
  })

  it('settles a tie for the older city', () => {
    const { world } = setup()
    addCity(world, { id: 'c9', realmId: 'r1', x: 10, y: 10 })
    addCity(world, { id: 'c3', realmId: 'r1', x: 16, y: 10 })
    const middle = put(world, 'house', 13, 10)
    expect(cityOf(world, middle)).toBe('c3')
  })

  it('lets a chain go on only through its own buildings', () => {
    const { world } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    addCity(world, { id: 'c2', realmId: 'r1', x: 10, y: 14 })
    // A house c2 holds, and past it, out of c1's reach except through that house.
    const held = put(world, 'house', 12, 13)
    const past = put(world, 'house', 15, 13)
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
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    const link = put(world, 'wall', 13, 10)
    const end = put(world, 'house', 16, 10)
    updateCityMembership(world, terrain.size)
    expect(end.cityId).toBe('c1')
    world.buildings = world.buildings.filter((b) => b !== link)
    updateCityMembership(world, terrain.size)
    expect(end.cityId).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('city area (`CONTEXT.md`: City area)', () => {
  it('is the tiles right around the city’s buildings', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    wallEast(world, 11, 10, 3)
    updateCityMembership(world, terrain.size)
    const m = CITY_AREA_MARGIN
    expect(inCityArea(world, city, 10 - m, 10 - m, terrain.size)).toBe(true)
    expect(inCityArea(world, city, 13 + m, 10 + m, terrain.size)).toBe(true)
    expect(inCityArea(world, city, 13 + m + 1, 10, terrain.size)).toBe(false)
    expect(inCityArea(world, city, 10, 10 - m - 1, terrain.size)).toBe(false)
    expect(citiesAt(world, 12, 11, terrain.size)).toEqual([city])
  })

  it('is where residents are at home and take meals from the storage', () => {
    const { world, r } = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    const storage = put(world, 'storage', 11, 10)
    storage.stock = { food: 50 }
    // Out along a new stretch of wall, far from the storage, but in the city's area.
    wallEast(world, 12, 10, 10)
    updateCityMembership(world, terrain.size)
    Object.assign(r, { x: 21, y: 11, carried: {} })
    stepWorld(world, terrain)
    expect(r.carried.food).toBeGreaterThanOrEqual(HOME_FOOD_LOW)
    // One step further out there is nothing.
    Object.assign(r, { x: 23, y: 12, carried: {} })
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
    Object.assign(r, { x: 4, y: 1 })
    const wall = nearlyBuilt(world, r, 'wall')
    expect(inCityArea(world, city, 5, 1, terrain.size)).toBe(false)
    stepWorld(world, terrain)
    expect(wall.cityId).toBe('c1')
    expect(inCityArea(world, city, 5, 1, terrain.size)).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('torn down, dissolves the city: buildings and residents stay, residents are homeless', () => {
    const { world, r } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 1, y: 1 })
    const house = put(world, 'house', 2, 1)
    const farm = put(world, 'farm', 6, 6)
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
    partner.order = { kind: 'pair', partnerId: r.id, since: 0 }
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    r.order = { kind: 'tearDown', buildingId: hall.id, at: { x: r.x, y: r.y } }
    // Almost torn down already: one tick of work finishes it.
    hall.teardown = teardownWork(hall) - 0.5
    stepWorld(world, terrain)
    expect(world.buildings).not.toContain(hall)
    expect(world.cities).toEqual([])
    expect(house).toMatchObject({ cityId: null, x: 2, y: 1 })
    expect(farm.cityId).toBeNull()
    expect(world.residents.map((x) => x.cityId)).toEqual([null, null])
    expect(partner.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('are watched by an invariant: one finished town hall per city, and cities follow the buildings', () => {
    const { world } = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
    const house = put(world, 'house', 11, 10)
    expect(citiesFromBuildings.check(world, terrain).map((v) => v.message)).toEqual([
      `${house.id} belongs to city null, but stands in c1`,
    ])
    updateCityMembership(world, terrain.size)
    expect(citiesFromBuildings.check(world, terrain)).toEqual([])
    const stray = put(world, 'townHall', 30, 30)
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
