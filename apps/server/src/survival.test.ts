import {
  FOOD_PER_DAY,
  HOME_FOOD_LOW,
  START_FOOD,
  carryCapacity,
  HUNGER_ENDURANCE_LIMIT,
  MAX_HEALTH,
  TERRAIN_FOOD,
  Terrain,
  TICKS_PER_GAME_DAY,
  foodUse,
  isInsideWalls,
  terrainAt,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, refilledWhenLow } from './invariants.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { stepRefill, stepSurvival } from './survival.js'
import { stepWorld } from './world.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'

const terrain = cityTerrain()

/** Runs survival for some game days; returns everyone who died, in order. */
function live(world: WorldState, days: number): Resident[] {
  const died: Resident[] = []
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    died.push(...stepSurvival(world, terrain).died)
    world.tick++
  }
  return died
}

const storageOf = (world: WorldState) => world.buildings.find((b) => b.kind === 'storage')!

/** Every resident gets the same Endurance, so food use is predictable. */
function averageEndurance(world: WorldState) {
  for (const r of world.residents) r.stats.endurance = { base: 10, trained: 0 }
}

describe('stepSurvival', () => {
  it('feeds residents from what they carry: everyone lives and the food goes down by what they eat', () => {
    const { world } = worldWithCity()
    averageEndurance(world)
    for (const r of world.residents) {
      r.stats.strength = { base: 15, trained: 0 } // room to carry the food
      r.carried = { food: 15 }
    }
    const carried = () => world.residents.reduce((n, r) => n + (r.carried.food ?? 0), 0)
    const before = carried()
    expect(live(world, 5)).toEqual([])
    const eaten = before - carried()
    const expected = world.residents.length * FOOD_PER_DAY * 5
    expect(Math.abs(eaten - expected)).toBeLessThanOrEqual(world.residents.length)
    for (const r of world.residents) {
      expect(r.hunger).toBeGreaterThan(0)
      expect(r.health).toBe(MAX_HEALTH)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('never eats straight from storage, also at home (`CONTEXT.md`: Eating)', () => {
    const { world } = worldWithCity()
    const city = world.cities[0]!
    const before = structuredClone(storageOf(world).stock)
    for (const r of world.residents) {
      Object.assign(r, { x: storageOf(world).x, y: storageOf(world).y, order: null, carried: {} })
      expect(isInsideWalls(city, r.x, r.y)).toBe(true)
    }
    expect(live(world, 2.6)).toHaveLength(8)
    expect(storageOf(world).stock).toEqual(before)
  })

  it('starves a city without food in about 2 game days', () => {
    const { world } = worldWithCity()
    for (const r of world.residents) r.carried = {}
    expect(live(world, 1.6)).toEqual([])
    const died = live(world, 1)
    expect(died).toHaveLength(8)
    expect(world.residents).toEqual([])
  })

  it('eats what a resident carries, a unit at a time', () => {
    const { world } = worldWithCity()
    averageEndurance(world)
    const r = world.residents[1]!
    r.carried = { food: 3 }
    live(world, 1.1) // two meals: half a day in, and at the end of the day
    expect(r.carried.food).toBe(1)
  })

  it('drops what a dead resident carried in a pile on their tile', () => {
    const { world } = worldWithCity()
    const city = world.cities[0]!
    const r = world.residents[1]!
    Object.assign(r, { x: city.x + city.size + 3, y: city.y, carried: { stone: 4 } })
    world.piles.push({ id: 'p0', x: r.x, y: r.y, goods: { stone: 1, wood: 2 } })
    live(world, 2.6)
    expect(world.piles).toEqual([{ id: 'p0', x: r.x, y: r.y, goods: { stone: 5, wood: 2 } }])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('ends the realm when the Leader dies; the Player gets a new city next time', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    const city = world.cities[0]!
    Object.assign(leader, { x: city.x + city.size + 3, y: city.y, order: null, carried: {} })
    const ended: string[] = []
    for (let t = 0; t < 2.6 * TICKS_PER_GAME_DAY; t++) {
      ended.push(...stepSurvival(world, terrain).ended.map((x) => x.id))
      world.tick++
    }
    expect(ended).toEqual([realm.id])
    expect(world.realms).toEqual([])
    expect(world.residents.every((r) => r.owner === null)).toBe(true)
    expect(world.cities[0]!.realmId).toBeNull()
    expect(world.horses[0]!.realmId).toBeNull()
    // The others still have food on them.
    expect(world.residents).toHaveLength(7)
    expect(checkInvariants(world, terrain)).toEqual([])

    const fresh = foundStartingCity(world, terrain, realm.userId)
    expect(fresh.id).not.toBe(realm.id)
    expect(realmOf(world, realm.userId)).toBe(fresh)
    expect(world.cities).toHaveLength(2)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('slowly heals a fed resident', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    r.health = MAX_HEALTH / 2
    live(world, 1)
    expect(r.health).toBeGreaterThan(MAX_HEALTH / 2)
    expect(r.health).toBeLessThan(MAX_HEALTH)
    live(world, 1)
    expect(r.health).toBe(MAX_HEALTH)
  })

  it('lets high Endurance get by on less food', () => {
    const tough = worldWithCity().world
    const frail = worldWithCity().world
    const stock = (world: WorldState, endurance: number) => {
      for (const r of world.residents) {
        r.stats.endurance = { base: endurance, trained: endurance > 10 ? 7 : 0 }
        r.stats.strength = { base: 15, trained: 0 } // room to carry the food
        r.carried = { food: 30 }
      }
    }
    stock(tough, 15)
    stock(frail, 5)
    live(tough, 6)
    live(frail, 6)
    const left = (world: WorldState) => world.residents.reduce((n, r) => n + r.carried.food!, 0)
    expect(left(tough)).toBeGreaterThan(left(frail) + 20)
  })

  it('burns more food on hard terrain, as `TERRAIN_FOOD` says (`CONTEXT.md`: Terrain)', () => {
    const eaten = (t: Terrain) => {
      const { world } = worldWithCity()
      averageEndurance(world)
      const city = world.cities[0]!
      const [x, y] = tileOf(t, (x, y) => !isInsideWalls(city, x, y))
      const r = world.residents[1]!
      r.stats.strength = { base: 15, trained: 0 } // room to carry the food
      Object.assign(r, { x, y, order: null, carried: { food: 25 } })
      live(world, 5)
      expect(world.residents).toContain(r)
      expect(checkInvariants(world, terrain)).toEqual([])
      return 25 - (r.carried.food ?? 0)
    }
    // Meals come in whole units, so each count may be one meal off what the days need.
    const plains = eaten(Terrain.Plains)
    expect(Math.abs(plains - FOOD_PER_DAY * 5)).toBeLessThanOrEqual(1)
    expect(Math.abs(eaten(Terrain.Forest) - plains)).toBeLessThanOrEqual(1)
    expect(
      Math.abs(eaten(Terrain.Hills) - FOOD_PER_DAY * 5 * TERRAIN_FOOD[Terrain.Hills]),
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(eaten(Terrain.Mountain) - FOOD_PER_DAY * 5 * TERRAIN_FOOD[Terrain.Mountain]),
    ).toBeLessThanOrEqual(1)
  })

  it('lets Endurance soften the extra food hard terrain costs, within its limit', () => {
    const { world } = worldWithCity()
    const r = world.residents[1]!
    const extra = (endurance: number, t: Terrain) => {
      r.stats.endurance = { base: endurance, trained: 0 }
      return foodUse(r, t, world.tick) / foodUse(r, Terrain.Plains, world.tick)
    }
    expect(extra(10, Terrain.Mountain)).toBeCloseTo(2)
    expect(extra(20, Terrain.Mountain)).toBeLessThan(2)
    expect(extra(0, Terrain.Mountain)).toBeGreaterThan(2)
    // However tough or frail, hard terrain costs more than plains and Endurance moves the extra
    // by no more than `HUNGER_ENDURANCE_LIMIT` of it.
    for (const e of [0, 5, 10, 15, 22, 40, 100]) {
      for (const t of [Terrain.Hills, Terrain.Mountain]) {
        const more = TERRAIN_FOOD[t] - 1
        expect(extra(e, t)).toBeGreaterThan(1)
        expect(extra(e, t)).toBeGreaterThanOrEqual(1 + more * (1 - HUNGER_ENDURANCE_LIMIT) - 1e-9)
        expect(extra(e, t)).toBeLessThanOrEqual(1 + more * (1 + HUNGER_ENDURANCE_LIMIT) + 1e-9)
      }
      expect(extra(e, Terrain.Forest)).toBeCloseTo(1)
    }
  })
})

/** The first tile of terrain `t` on the test map that also passes `fits`. */
function tileOf(t: Terrain, fits: (x: number, y: number) => boolean): [number, number] {
  for (let y = 0; y < terrain.size; y++) {
    for (let x = 0; x < terrain.size; x++) {
      if (terrainAt(terrain, x, y) === t && fits(x, y)) return [x, y]
    }
  }
  throw new Error(`no tile of terrain ${t}`)
}

describe('stepRefill', () => {
  /** A starting city with everyone idle on the storage's tile, inside the walls, carrying nothing. */
  function atHome() {
    const { world } = worldWithCity()
    const storage = storageOf(world)
    for (const r of world.residents) {
      Object.assign(r, { x: storage.x, y: storage.y, order: null, carried: {} })
      r.stats.strength = { base: 10, trained: 0 }
    }
    return { world, storage, city: world.cities[0]! }
  }

  it('tops up a resident at home who runs low with meals from their city’s storage', () => {
    const { world, storage } = atHome()
    const r = world.residents[0]!
    r.carried = { food: HOME_FOOD_LOW - 1 }
    stepRefill(world)
    expect(r.carried.food).toBe(HOME_FOOD_LOW)
    for (const other of world.residents.slice(1)) expect(other.carried.food).toBe(HOME_FOOD_LOW)
    expect(storage.stock!.food).toBe(START_FOOD - (world.residents.length * HOME_FOOD_LOW - 1))
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves a resident who isn’t running low alone', () => {
    const { world, storage } = atHome()
    for (const r of world.residents) r.carried = { food: HOME_FOOD_LOW }
    stepRefill(world)
    expect(storage.stock!.food).toBe(START_FOOD)
  })

  it('gives nothing away from home, nor in someone else’s city', () => {
    const { world, storage, city } = atHome()
    const [away, stranger] = world.residents as [Resident, Resident]
    Object.assign(away, { x: city.x + city.size + 3, y: city.y })
    stranger.owner = 'someone else'
    stepRefill(world)
    expect(away.carried).toEqual({})
    expect(stranger.carried).toEqual({})
    expect(storage.stock!.food).toBe(START_FOOD - (world.residents.length - 2) * HOME_FOOD_LOW)
  })

  it('takes only what the storage has and what fits', () => {
    const { world, storage } = atHome()
    const [full, ...rest] = world.residents as [Resident, ...Resident[]]
    full.carried = { stone: carryCapacity(full, world.tick) }
    storage.stock = { food: 1 }
    stepRefill(world)
    expect(full.carried.food).toBeUndefined()
    expect(rest.map((r) => r.carried.food ?? 0)).toEqual([1, ...rest.slice(1).map(() => 0)])
    expect(storage.stock).toEqual({})
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps a city at home fed from its storage: nobody starves and the storage goes down', () => {
    const { world, storage } = atHome()
    averageEndurance(world)
    for (let t = 0; t < 5 * TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain)
    expect(world.residents).toHaveLength(8)
    for (const r of world.residents) expect(r.health).toBe(MAX_HEALTH)
    const eaten = START_FOOD - storage.stock!.food! - 8 * HOME_FOOD_LOW
    // Spoilage takes a little more than the meals.
    expect(eaten).toBeGreaterThanOrEqual(8 * FOOD_PER_DAY * 5 - 8)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is caught by the invariant when skipped', () => {
    const { world } = atHome()
    expect(refilledWhenLow.check(world, terrain)).toHaveLength(8)
    stepRefill(world)
    expect(refilledWhenLow.check(world, terrain)).toEqual([])
  })
})
