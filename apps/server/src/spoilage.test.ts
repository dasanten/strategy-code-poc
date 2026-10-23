import { FOOD_SPOIL_PER_DAY, TICKS_PER_GAME_DAY, type WorldState } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { stepSpoilage } from './spoilage.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { stepWorld } from './world.js'

const terrain = cityTerrain()

/** Runs spoilage alone for some game days. */
function wait(world: WorldState, days: number) {
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    stepSpoilage(world)
    world.tick++
  }
}

const storageOf = (world: WorldState) => world.buildings.find((b) => b.kind === 'storage')!

describe('stepSpoilage', () => {
  it('spoils the balance share of a storage’s food each game day, and nothing else', () => {
    const { world } = worldWithCity()
    storageOf(world).stock = { food: 1000, wood: 1000, coins: 1000 }
    wait(world, 0.99)
    expect(storageOf(world).stock).toEqual({ food: 1000, wood: 1000, coins: 1000 })
    wait(world, 0.02)
    expect(storageOf(world).stock).toEqual({
      food: 1000 - 1000 * FOOD_SPOIL_PER_DAY,
      wood: 1000,
      coins: 1000,
    })
  })

  it('spoils food carried by residents and carriages, and in piles', () => {
    const { world } = worldWithCity()
    const [r] = world.residents
    const [k] = world.carriages
    r!.carried = { food: 10, stone: 5 }
    k!.load = { food: 400 }
    world.piles.push({ id: 'p1', x: r!.x, y: r!.y, goods: { food: 400, iron: 2 } })
    wait(world, 1)
    expect(r!.carried.food).toBeLessThanOrEqual(10)
    expect(r!.carried.stone).toBe(5)
    expect(k!.load).toEqual({ food: 400 - 400 * FOOD_SPOIL_PER_DAY })
    expect(world.piles[0]!.goods).toEqual({ food: 400 - 400 * FOOD_SPOIL_PER_DAY, iron: 2 })
  })

  it('keeps small stocks in whole units and spoils them at the right rate on average', () => {
    const { world } = worldWithCity()
    for (let i = 0; i < 1000; i++) {
      world.piles.push({ id: `p${i}`, x: i % 300, y: Math.floor(i / 300), goods: { food: 10 } })
    }
    wait(world, 1)
    const left = world.piles.map((p) => p.goods.food!)
    expect(left.every((n) => n === 9 || n === 10)).toBe(true)
    const lost = 10_000 - left.reduce((a, b) => a + b, 0)
    expect(Math.abs(lost - 10_000 * FOOD_SPOIL_PER_DAY)).toBeLessThan(50)
  })

  it('lets a pile of food rot away entirely', () => {
    const { world } = worldWithCity()
    world.piles.push({ id: 'p1', x: 0, y: 0, goods: { food: 1 } })
    wait(world, 1000)
    expect(world.piles).toEqual([])
  })

  it('spoils the same way given the same seed', () => {
    const run = () => {
      const { world } = worldWithCity()
      for (const r of world.residents) r.carried = { food: 7 }
      wait(world, 5)
      return world.residents.map((r) => r.carried.food)
    }
    expect(run()).toEqual(run())
  })
})

describe('spoilage in the world', () => {
  it('keeps the invariants over a game day', () => {
    const { world } = worldWithCity()
    world.residents[0]!.carried = { food: 3 }
    for (let t = 0; t < TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('reports goods held in part units', () => {
    const { world } = worldWithCity()
    storageOf(world).stock = { food: 2.5 }
    expect(checkInvariants(world, terrain)).toEqual([
      expect.objectContaining({
        invariant: 'goods-in-whole-units',
        entityIds: [storageOf(world).id],
      }),
    ])
  })
})
