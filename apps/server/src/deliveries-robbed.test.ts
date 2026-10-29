// Robbed caravans, apart from `deliveries.test.ts` so that the two run side by side.

import { owedBy, type Caravan, type Stock, type TerrainMap, type WorldState } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { routeRobberiesSound } from './caravans.js'
import { resolveCarrying } from './carrying.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { tradeOrgHq } from './trade-org.js'
import { setup, order, runUntil, eventsOf } from './deliveries.fixture.js'

/** Has a new resident of Mara's realm, standing at the caravan's carriage, take `goods` off it. */
function rob(world: WorldState, terrain: TerrainMap, caravan: Caravan, goods: Stock, id = 'thief') {
  const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
  let thief = world.residents.find((r) => r.id === id)
  if (!thief) {
    const realmId = world.realms[0]!.id
    const cityId = world.cities.find((c) => c.realmId === realmId)!.id
    thief = newResident(mulberry32(17), { id, owner: realmId, cityId, x: 0, y: 0, tick: 0 })
    thief.bornAt = -20 * 24 * 3600
    world.residents.push(thief)
  }
  thief.x = carriage.x
  thief.y = carriage.y
  const spot = { kind: 'carriage' as const, carriageId: carriage.id }
  resolveCarrying(world, [{ kind: 'take', residentId: id, spot, goods }], terrain.size)
  return thief
}

describe('robbed caravans', () => {
  it(
    'send what was taken of a delivery again, and all of it arrives',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, warehouse, storage, city, caravan, queue } = setup()
      order(world, queue, { kind: 'buy', good: 'iron', units: 6, cityId: city.id })
      const before = storage.stock!.iron ?? 0
      runUntil(world, terrain, () => caravan.job?.step === 'deliver')
      const thief = rob(world, terrain, caravan, { iron: 4 })
      expect(thief.carried.iron).toBe(4)
      expect(caravan.job).toMatchObject({ units: 2, robbed: 4 })
      // The warehouse keeps nothing for it until the caravan has delivered the rest.
      expect(owedBy(world, warehouse.id, 'iron')).toBe(0)
      runUntil(world, terrain, () => eventsOf(world, 'deliveryRobbed').length > 0)
      expect(eventsOf(world, 'deliveryRobbed')).toEqual([
        expect.objectContaining({ good: 'iron', units: 4, cityId: city.id }),
      ])
      expect(world.deliveries).toEqual([expect.objectContaining({ units: 4, caravanId: null })])
      expect(storage.stock!.iron).toBe(before + 2)
      runUntil(world, terrain, () => world.deliveries.length === 0)
      expect(storage.stock!.iron).toBe(before + 6)
      expect(eventsOf(world, 'delivered').map((e) => e.units)).toEqual([2, 4])
      expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
      // Taking from the Trade Org's caravan is theft from it.
      expect(world.crimes).toEqual([
        expect.objectContaining({ kind: 'theft', victimOrg: tradeOrgHq(world)!.id }),
      ])
    },
  )

  it('send a delivery again that robbers took all of', { tags: ['slow'], timeout: 120_000 }, () => {
    const { world, terrain, storage, city, caravan, queue } = setup()
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    const before = storage.stock!.iron ?? 0
    runUntil(world, terrain, () => caravan.job?.step === 'deliver')
    rob(world, terrain, caravan, { iron: 3 })
    runUntil(world, terrain, () => world.deliveries.length === 0)
    expect(storage.stock!.iron).toBe(before + 3)
    expect(eventsOf(world, 'deliveryRobbed')).toEqual([expect.objectContaining({ units: 3 })])
    expect(eventsOf(world, 'delivered').map((e) => e.units)).toEqual([3])
  })

  it(
    'fetch coins taken from a pick-up again, so the seller is paid for all of it',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, storage, city, caravan, queue } = setup()
      storage.stock!.stone = 40
      order(world, queue, { kind: 'sell', good: 'stone', units: 30, cityId: city.id })
      runUntil(world, terrain, () => caravan.job?.step === 'collect')
      rob(world, terrain, caravan, { coins: caravan.job!.coins })
      expect(caravan.job).toMatchObject({ step: 'load', coins: 0 })
      runUntil(world, terrain, () => world.deliveries.length === 0)
      const [done] = eventsOf(world, 'delivered')
      expect(done).toMatchObject({ delivery: 'pickUp', units: 30 })
      expect(done!.coins).toBeGreaterThan(0)
      expect(storage.stock!.coins).toBe(done!.coins)
    },
  )

  it(
    'fetch coins taken while a pick-up pays, and pay the rest',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, storage, city, caravan, queue } = setup()
      storage.stock!.stone = 40
      order(world, queue, { kind: 'sell', good: 'stone', units: 30, cityId: city.id })
      runUntil(world, terrain, () => caravan.job?.step === 'pay')
      const toPay = caravan.job!.toPay
      rob(world, terrain, caravan, { coins: caravan.job!.coins, stone: 5 })
      expect(caravan.job).toMatchObject({ robbed: 5 })
      runUntil(world, terrain, () => world.deliveries.length === 0)
      const [done] = eventsOf(world, 'delivered')
      expect(done).toMatchObject({ delivery: 'pickUp', units: 30, coins: toPay })
      expect(storage.stock!.coins).toBe(toPay)
    },
  )

  it('count robberies per route, once a tick, and none by the Trade Organization', () => {
    const { world, terrain, caravan } = setup()
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
    carriage.load.iron = 10
    rob(world, terrain, caravan, { iron: 1 }, 'thief1')
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
    // Two robbers in one tick are one robbery.
    const spot = { kind: 'carriage' as const, carriageId: carriage.id }
    resolveCarrying(
      world,
      ['thief1', 'thief2'].map((id) => {
        rob(world, terrain, caravan, {}, id)
        return { kind: 'take' as const, residentId: id, spot, goods: { iron: 1 } }
      }),
      terrain.size,
    )
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 2 })
    // Its own driver unloading robs nothing.
    const driver = world.residents.find((r) => r.id === caravan.driverId)!
    driver.x = carriage.x
    driver.y = carriage.y
    resolveCarrying(world, [{ kind: 'take', residentId: driver.id, spot, goods: { iron: 1 } }])
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 2 })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('flag robberies counted for no trading post, or not a whole number of times', () => {
    const { world, terrain, caravan } = setup()
    world.routeRobberies = { [caravan.postId]: 2 }
    expect(routeRobberiesSound.check(world, terrain)).toEqual([])
    world.routeRobberies = { [caravan.postId]: 0, nowhere: 1 }
    expect(routeRobberiesSound.check(world, terrain)).toHaveLength(2)
  })
})
