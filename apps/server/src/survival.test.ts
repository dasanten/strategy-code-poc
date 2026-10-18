import {
  FOOD_PER_DAY,
  MAX_HEALTH,
  TICKS_PER_GAME_DAY,
  isInsideWalls,
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
    died.push(...stepSurvival(world).died)
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
      ended.push(...stepSurvival(world).ended.map((x) => x.id))
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
})
