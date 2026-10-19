import {
  NPC_CITY_MIN_DISTANCE,
  NPC_TOWN,
  NPC_TOWNS,
  NPC_VILLAGE,
  NPC_VILLAGES,
  SIGHT_RANGE,
  Terrain,
  inCityArea,
  isCityBuilding,
  terrainAt,
  townHallOf,
  wrapDistance,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { findNpcCitySite, foundNpcCity, npcCityCount, npcSiteFits } from './npc-cities.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { worldWithCity } from './test-terrain.js'
import { createWorld, generateWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** Every tile an NPC city's buildings and residents stand on. */
const tilesOf = (world: WorldState, c: City) => [
  ...world.buildings.filter((b) => b.cityId === c.id),
  ...world.residents.filter((r) => r.cityId === c.id),
]

describe('placeNpcCities (through generateWorld)', () => {
  let terrain: TerrainMap
  let world: WorldState
  beforeAll(() => {
    terrain = generateTerrain(1, 720)
    world = generateWorld(terrain)
  })

  it('places towns and villages by the map area, run by the game', () => {
    expect(npcCityCount(NPC_TOWNS, 1440)).toBe(NPC_TOWNS)
    expect(npcCityCount(NPC_VILLAGES, 1440)).toBe(NPC_VILLAGES)
    const towns = npcCityCount(NPC_TOWNS, 720)
    const villages = npcCityCount(NPC_VILLAGES, 720)
    expect(towns).toBeGreaterThan(0)
    expect(world.cities).toHaveLength(towns + villages)
    const sizes = world.cities.map((c) => world.residents.filter((r) => r.cityId === c.id).length)
    expect(sizes).toEqual([
      ...Array<number>(towns).fill(NPC_TOWN.residents),
      ...Array<number>(villages).fill(NPC_VILLAGE.residents),
    ])
    for (const c of world.cities) expect(c.realmId).toBeNull()
    for (const r of world.residents) expect(r.owner).toBeNull()
    expect(world.realms).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('lays each one out with a town hall, a storage, houses, a wall with a gate and farms', () => {
    for (const c of world.cities) {
      const own = world.buildings.filter((b) => b.cityId === c.id)
      const kind = own.filter((b) => b.kind === 'farm').length === 1 ? NPC_VILLAGE : NPC_TOWN
      const count = (k: string) => own.filter((b) => b.kind === k).length
      expect(count('townHall')).toBe(1)
      expect(count('storage')).toBe(1)
      expect(count('house')).toBe(kind.houses)
      expect(count('gate')).toBe(1)
      expect(count('wall')).toBe(4 * (kind.size - 1) - 1)
      expect(count('farm')).toBe(kind.farms)
      expect(own.find((b) => b.kind === 'storage')!.stock).toEqual({ food: kind.food })
      // Every city building is part of the city; the farms lie outside its area.
      for (const b of own) {
        if (isCityBuilding(b)) expect(inCityArea(world, c, b.x, b.y, terrain.size)).toBe(true)
        else expect(inCityArea(world, c, b.x, b.y, terrain.size)).toBe(false)
      }
      // Residents start on the farms, working them.
      for (const r of world.residents.filter((x) => x.cityId === c.id)) {
        expect(r.order).toMatchObject({ kind: 'workAt' })
        const farm = own.find((b) => b.kind === 'farm' && b.x === r.x && b.y === r.y)
        expect(farm).toBeDefined()
      }
    }
  })

  it('puts them on Plains, far from each other', () => {
    for (const c of world.cities) {
      for (const t of tilesOf(world, c)) expect(terrainAt(terrain, t.x, t.y)).toBe(Terrain.Plains)
      for (const o of world.cities) {
        if (o === c) continue
        const d = wrapDistance(terrain.size, townHallOf(world, c)!, townHallOf(world, o)!)
        expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE - NPC_TOWN.size)
      }
    }
  })

  it('places the same cities for the same world', () => {
    expect(generateWorld(terrain)).toEqual(world)
  })

  it('leaves room for starting cities, far from the NPC cities', () => {
    const w = structuredClone(world)
    foundStartingCity(w, terrain, 1)
    const hall = townHallOf(
      w,
      w.cities.find((c) => c.realmId !== null)!,
    )!
    for (const c of world.cities) {
      expect(wrapDistance(terrain.size, hall, townHallOf(w, c)!)).toBeGreaterThanOrEqual(
        NPC_CITY_MIN_DISTANCE - NPC_TOWN.size,
      )
    }
    expect(checkInvariants(w, terrain)).toEqual([])
  })
})

describe('findNpcCitySite', () => {
  it('keeps away from starting cities and out of every Player’s sight', () => {
    const { world, terrain } = worldWithCity()
    const realm = realmOf(world, 1)!
    const start = world.cities[0]!
    const rand = mulberry32(5)
    const [x, y] = findNpcCitySite(world, terrain, NPC_VILLAGE, rand)!
    const c = foundNpcCity(world, terrain, NPC_VILLAGE, x, y, rand)
    const d = wrapDistance(terrain.size, townHallOf(world, start)!, townHallOf(world, c)!)
    expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size)
    const seen = entitiesInSight(world, terrain, realm.id)
    const ids = new Set(tilesOf(world, c).map((e) => e.id))
    expect(seen.filter((e) => ids.has(e.id) || e.id === c.id)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('shows an NPC city to a Player once one of their residents comes in sight of it', () => {
    const { world, terrain } = worldWithCity()
    const realm = realmOf(world, 1)!
    const rand = mulberry32(5)
    const [x, y] = findNpcCitySite(world, terrain, NPC_VILLAGE, rand)!
    const c = foundNpcCity(world, terrain, NPC_VILLAGE, x, y, rand)
    const scout = world.residents.find((r) => r.owner === realm.id)!
    // Just south of its gate, where its farms are.
    Object.assign(scout, { x: x + 3, y: y + NPC_VILLAGE.size + 3, order: null })
    const seen = entitiesInSight(world, terrain, realm.id)
    expect(seen).toContainEqual({ is: 'city', ...c })
    const hall = townHallOf(world, c)!
    expect(seen).toContainEqual({ is: 'building', ...hall })
    expect(seen.filter((e) => e.is === 'resident' && e.cityId === c.id).length).toBeGreaterThan(0)
  })

  it('finds no site when the map has no room left', () => {
    const terrain = plains(150)
    const world = createWorld(terrain)
    const rand = mulberry32(1)
    const [x, y] = findNpcCitySite(world, terrain, NPC_VILLAGE, rand)!
    foundNpcCity(world, terrain, NPC_VILLAGE, x, y, rand)
    expect(findNpcCitySite(world, terrain, NPC_VILLAGE, rand)).toBeUndefined()
  })
})

describe('npcSiteFits', () => {
  const terrain = plains(200)

  it('takes open Plains far from cities and Players', () => {
    expect(npcSiteFits(createWorld(terrain), terrain, NPC_TOWN, 50, 50)).toBe(true)
  })

  it('avoids taken tiles', () => {
    const world = createWorld(terrain)
    world.nodes.push({ id: 'n1', kind: 'stone', x: 49, y: 55 })
    expect(npcSiteFits(world, terrain, NPC_TOWN, 50, 50)).toBe(false)
  })

  it('avoids tiles other than Plains', () => {
    const t = plains(200)
    t.tiles[55 * 200 + 60] = Terrain.Forest
    expect(npcSiteFits(createWorld(t), t, NPC_TOWN, 50, 50)).toBe(false)
  })

  it('avoids tiles a Player’s resident sees, but not where nobody of a realm looks', () => {
    const world = createWorld(terrain)
    // Just within sight of the north-west corner of the city's ring of open land.
    const corner = { x: 50 - 2, y: 50 - 2 }
    const r = newResident(mulberry32(1), {
      id: 'r1',
      owner: 'realm1',
      x: corner.x - SIGHT_RANGE + 1,
      y: corner.y,
      tick: 0,
    })
    world.residents.push(r)
    expect(npcSiteFits(world, terrain, NPC_TOWN, 50, 50)).toBe(false)
    r.owner = null
    expect(npcSiteFits(world, terrain, NPC_TOWN, 50, 50)).toBe(true)
  })

  it('keeps its distance from every city', () => {
    const world = createWorld(terrain)
    const rand = mulberry32(1)
    foundNpcCity(world, terrain, NPC_VILLAGE, 50 + NPC_CITY_MIN_DISTANCE - 20, 50, rand)
    expect(npcSiteFits(world, terrain, NPC_TOWN, 50, 50)).toBe(false)
  })
})
