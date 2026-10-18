import {
  ADULT_AGE,
  CITY_MIN_DISTANCE,
  HOUSING_ROOM,
  MAX_HEALTH,
  MAX_HUNGER,
  START_CARRIED_FOOD,
  START_CITY_SIZE,
  START_FOOD,
  START_RESIDENTS,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STAT_NAMES,
  Terrain,
  ageInYears,
  isInsideWalls,
  terrainAt,
  wrapDistance,
  type City,
  type TerrainMap,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld } from './world.js'

const centreOf = (c: City) => ({ x: c.x + c.size / 2, y: c.y + c.size / 2 })

describe('foundStartingCity', () => {
  it('gives a Player a realm with everything a starting city has', () => {
    const { world, terrain } = worldWithCity()
    const realm = realmOf(world, 1)!
    const [city] = world.cities
    expect(world.realms).toEqual([realm])
    expect(city).toMatchObject({ realmId: realm.id, size: START_CITY_SIZE, wall: 'wooden' })

    const residents = world.residents.filter((r) => r.owner === realm.id)
    expect(residents).toHaveLength(START_RESIDENTS)
    expect(residents.map((r) => r.id)).toContain(realm.leaderId)
    // Everyone starts on the farm, working it, with a little food on them.
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    for (const r of residents) {
      expect(r.cityId).toBe(city!.id)
      expect(r).toMatchObject({ x: farm.x, y: farm.y, carried: { food: START_CARRIED_FOOD } })
      expect(r.order).toEqual({
        kind: 'workAt',
        buildingId: farm.id,
        at: { x: farm.x, y: farm.y },
        progress: 0,
      })
      expect(r.health).toBe(MAX_HEALTH)
      expect(r.hunger).toBe(MAX_HUNGER)
      expect(ageInYears(r, world.tick)).toBeGreaterThanOrEqual(ADULT_AGE)
      for (const s of STAT_NAMES) {
        expect(r.stats[s].base).toBeGreaterThanOrEqual(STAT_BASE_MIN)
        expect(r.stats[s].base).toBeLessThanOrEqual(STAT_BASE_MAX)
      }
    }

    const kinds = world.buildings.map((b) => b.kind)
    const houses = kinds.filter((k) => k === 'house').length
    expect(houses * HOUSING_ROOM.house!).toBeGreaterThan(START_RESIDENTS)
    expect(kinds.filter((k) => k === 'storage')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'farm')).toHaveLength(1)
    expect(world.buildings.find((b) => b.kind === 'storage')!.stock).toEqual({ food: START_FOOD })
    expect(isInsideWalls(city!, farm.x, farm.y)).toBe(false)
    expect(terrainAt(terrain, farm.x, farm.y)).toBe(Terrain.Plains)
    expect(world.horses).toEqual([expect.objectContaining({ realmId: realm.id })])
    expect(world.carriages).toEqual([expect.objectContaining({ realmId: realm.id, load: {} })])
    for (const e of [...world.horses, ...world.carriages]) {
      expect(isInsideWalls(city!, e.x, e.y)).toBe(true)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('founds nothing more for a Player who already has a realm', () => {
    const { world, terrain } = worldWithCity()
    const before = structuredClone(world)
    expect(foundStartingCity(world, terrain, 1)).toEqual(before.realms[0])
    expect(world).toEqual(before)
  })

  it('gives the same world and Player the same city, and ids are never reused', () => {
    const a = worldWithCity().world
    const b = worldWithCity().world
    expect(a).toEqual(b)
    const ids = [
      ...a.realms,
      ...a.cities,
      ...a.residents,
      ...a.buildings,
      ...a.horses,
      ...a.carriages,
    ].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('still finds room on a crowded map, closer together', () => {
    const terrain = cityTerrain()
    const world = createWorld(terrain)
    for (let user = 1; user <= 6; user++) foundStartingCity(world, terrain, user)
    expect(world.cities).toHaveLength(6)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  describe('on the full-size map', () => {
    let terrain: TerrainMap

    beforeAll(() => {
      terrain = generateTerrain(1)
    }, 120_000)

    it('places cities on open land, far from each other the short way round', () => {
      const world = createWorld(terrain)
      for (let user = 1; user <= 5; user++) foundStartingCity(world, terrain, user)
      for (const c of world.cities) {
        // Inside the map's square: a city never straddles a join.
        expect(c.x).toBeGreaterThanOrEqual(1)
        expect(c.x + c.size).toBeLessThan(terrain.size)
        expect(c.y).toBeGreaterThanOrEqual(1)
        expect(c.y + c.size).toBeLessThan(terrain.size)
        for (let y = c.y; y < c.y + c.size; y++) {
          for (let x = c.x; x < c.x + c.size; x++) {
            expect([Terrain.Plains, Terrain.Forest, Terrain.Hills]).toContain(
              terrainAt(terrain, x, y),
            )
          }
        }
        for (const other of world.cities) {
          if (other === c) continue
          expect(wrapDistance(terrain.size, centreOf(c), centreOf(other))).toBeGreaterThanOrEqual(
            CITY_MIN_DISTANCE,
          )
        }
      }
      expect(checkInvariants(world, terrain)).toEqual([])
    })
  })
})
