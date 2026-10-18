import {
  FOOD_PER_DAY,
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
import { checkInvariants } from './invariants.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { stepSurvival } from './survival.js'
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
  it('feeds a city from its storage: everyone lives and the food goes down by what they eat', () => {
    const { world } = worldWithCity()
    averageEndurance(world)
    const before = storageOf(world).stock!.food!
    expect(live(world, 5)).toEqual([])
    const eaten = before - (storageOf(world).stock!.food ?? 0)
    const expected = world.residents.length * FOOD_PER_DAY * 5
    expect(Math.abs(eaten - expected)).toBeLessThanOrEqual(world.residents.length)
    for (const r of world.residents) {
      expect(r.hunger).toBeGreaterThan(0)
      expect(r.health).toBe(MAX_HEALTH)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('starves a city without food in about 2 game days', () => {
    const { world } = worldWithCity()
    storageOf(world).stock = {}
    expect(live(world, 1.6)).toEqual([])
    const died = live(world, 1)
    expect(died).toHaveLength(8)
    expect(world.residents).toEqual([])
  })

  it('eats what a resident carries first', () => {
    const { world } = worldWithCity()
    averageEndurance(world)
    const r = world.residents[1]!
    r.carried = { food: 3 }
    live(world, 1.1) // two meals: half a day in, and at the end of the day
    expect(r.carried.food).toBe(1)
  })

  it('does not feed residents from storage while they are away from home', () => {
    const { world } = worldWithCity()
    const city = world.cities[0]!
    const r = world.residents[1]!
    Object.assign(r, { x: city.x + city.size + 3, y: city.y })
    expect(isInsideWalls(city, r.x, r.y)).toBe(false)
    const died = live(world, 2.6)
    expect(died).toContain(r)
    expect(world.residents).toHaveLength(7)
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
    Object.assign(leader, { x: city.x + city.size + 3, y: city.y })
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
    // The old city's people still eat from their storage: it's theirs, and they're at home.
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
    for (const r of tough.residents) r.stats.endurance = { base: 15, trained: 7 }
    for (const r of frail.residents) r.stats.endurance = { base: 5, trained: 0 }
    live(tough, 6)
    live(frail, 6)
    expect(storageOf(tough).stock!.food!).toBeGreaterThan(storageOf(frail).stock!.food! + 20)
  })

  it('burns more food on hard terrain, as `TERRAIN_FOOD` says (`CONTEXT.md`: Terrain)', () => {
    const eaten = (t: Terrain) => {
      const { world } = worldWithCity()
      averageEndurance(world)
      const city = world.cities[0]!
      const [x, y] = tileOf(t, (x, y) => !isInsideWalls(city, x, y))
      const r = world.residents[1]!
      r.stats.strength = { base: 15, trained: 0 } // room to carry the food
      Object.assign(r, { x, y, carried: { food: 25 } })
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
