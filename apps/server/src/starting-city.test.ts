import {
  ADULT_AGE,
  CITY_MIN_DISTANCE,
  HOUSING_ROOM,
  MAX_HEALTH,
  MAX_HUNGER,
  START_CARRIED_FOOD,
  START_CITY_SIZE,
  START_FOOD,
  START_HORSES,
  START_RESIDENTS,
  START_STABLE_FOOD,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STAT_NAMES,
  Terrain,
  ageInYears,
  inCityArea,
  terrainAt,
  wrapDistance,
  isCityBuilding,
  townHallOf,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld } from './world.js'

/** Where a city's town hall stands. */
const centreOf = (world: WorldState, c: City) => townHallOf(world, c)!

describe('foundStartingCity', () => {
  it('gives a Player a realm with everything a starting city has', () => {
    const { world, terrain } = worldWithCity()
    const realm = realmOf(world, 1)!
    const [city] = world.cities
    expect(world.realms).toEqual([realm])
    expect(city).toMatchObject({ realmId: realm.id })
    // A town hall, and a ring of wooden wall with one gate in the middle of a side.
    const hall = townHallOf(world, city!)!
    expect(hall).toMatchObject({ kind: 'townHall', cityId: city!.id })
    const walls = world.buildings.filter((b) => b.kind === 'wall' || b.kind === 'gate')
    expect(walls).toHaveLength(4 * (START_CITY_SIZE - 1))
    expect(walls.filter((b) => b.kind === 'gate')).toHaveLength(1)
    for (const b of world.buildings.filter(isCityBuilding)) expect(b.cityId).toBe(city!.id)

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
    // The farm lies just past the city's area, so working it is not being at home.
    expect(inCityArea(world, city!, farm.x, farm.y, terrain.size)).toBe(false)
    expect(terrainAt(terrain, farm.x, farm.y)).toBe(Terrain.Plains)
    // A stable on Plains next to the farm, with a little food and the realm's horses in it.
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    expect(kinds.filter((k) => k === 'stable')).toHaveLength(1)
    expect(stable).toMatchObject({ cityId: city!.id, stock: { food: START_STABLE_FOOD } })
    expect(terrainAt(terrain, stable.x, stable.y)).toBe(Terrain.Plains)
    expect(inCityArea(world, city!, stable.x, stable.y, terrain.size)).toBe(false)
    expect(Math.max(Math.abs(stable.x - farm.x), Math.abs(stable.y - farm.y))).toBeLessThan(4)
    expect(world.horses).toHaveLength(START_HORSES)
    for (const h of world.horses) {
      expect(h).toMatchObject({ realmId: realm.id, x: stable.x, y: stable.y })
      expect(h).toMatchObject({ hunger: MAX_HUNGER, health: MAX_HEALTH })
    }
    // The carriage stands at the stable with one of its horses hitched, ready to drive.
    const horseIds = world.horses.map((h) => h.id)
    expect(world.carriages).toEqual([
      expect.objectContaining({ realmId: realm.id, load: {}, x: stable.x, y: stable.y }),
    ])
    expect(horseIds).toContain(world.carriages[0]!.horseId)
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
        const own = world.buildings.filter((b) => b.cityId === c.id)
        const xs = own.map((b) => b.x)
        const ys = own.map((b) => b.y)
        // Inside the map's square: a city never straddles a join.
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(1)
        expect(Math.max(...xs)).toBeLessThan(terrain.size - 1)
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(1)
        expect(Math.max(...ys)).toBeLessThan(terrain.size - 1)
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(START_CITY_SIZE + 4)
        for (const b of own) {
          expect([Terrain.Plains, Terrain.Forest, Terrain.Hills]).toContain(
            terrainAt(terrain, b.x, b.y),
          )
        }
        for (const other of world.cities) {
          if (other === c) continue
          expect(
            wrapDistance(terrain.size, centreOf(world, c), centreOf(world, other)),
          ).toBeGreaterThanOrEqual(CITY_MIN_DISTANCE)
        }
      }
      expect(checkInvariants(world, terrain)).toEqual([])
    })
  })
})
