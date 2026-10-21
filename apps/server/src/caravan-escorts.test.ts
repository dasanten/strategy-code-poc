import {
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_FOOD,
  CARAVAN_FOOD_PER_ESCORT,
  CARAVAN_GUARD_RANGE,
  CARAVAN_ROBBERIES_PER_ESCORT,
  MAX_HEALTH,
  Terrain,
  caravanEscortsWanted,
  caravanFoodFor,
  isArmed,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  caravansSound,
  caravanThreats,
  placeCaravans,
  routeEnd,
  waitingForEscort,
} from './caravans.js'
import { attackOrder } from './combat.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** The Trade Org HQ at (32, 32), one trading post with its caravan, and a Player's realm. */
function route() {
  const terrain = plains(128)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  foundTradeOrgHq(world, terrain, 32, 32, rand)
  const post = foundTradingPost(world, terrain, 80, 80, undefined, rand)
  const [caravan] = placeCaravans(world)
  const realm = foundStartingCity(world, terrain, 7)
  const carriage = world.carriages.find((k) => k.id === caravan!.carriageId)!
  const hqWarehouse = routeEnd(world, caravan!, 'hq').warehouse!
  return { world, terrain, post, caravan: caravan!, carriage, realm, hqWarehouse }
}

const byId = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

/**
 * The caravan out on its way at (60, 60), heading for the post, its escort armed with spears:
 * a carriage away from the HQ, whose own soldiers don't come into it.
 */
function onTheWay(world: WorldState, caravan: ReturnType<typeof route>['caravan']) {
  const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  for (const thing of [
    carriage,
    horse,
    ...[caravan.driverId, ...caravan.escortIds].map((id) => byId(world, id)),
  ]) {
    thing.x = 60
    thing.y = 60
  }
  for (const id of caravan.escortIds) byId(world, id).carried.spear = 1
  caravan.heading = 'post'
  caravan.stop = 'storage'
  carriage.load = { food: CARAVAN_FOOD, iron: 20 }
  return carriage
}

/** A grown resident of the Player's realm at (x, y), carrying `carried`. */
function outsider(world: WorldState, realmId: string, id: string, x: number, y: number): Resident {
  const cityId = world.cities.find((c) => c.realmId === realmId)!.id
  const r = newResident(mulberry32(17), { id, owner: realmId, cityId, x, y, tick: 0 })
  r.bornAt = -20 * 24 * 3600
  world.residents.push(r)
  return r
}

describe('caravan escorts', () => {
  it('arm themselves at the HQ goods warehouse before the caravan sets off', () => {
    const { world, terrain, caravan, hqWarehouse } = route()
    hqWarehouse.stock = { ...hqWarehouse.stock, spear: 10 }
    const walking = new Walking(terrain)
    for (let t = 0; t < 50; t++) stepWorld(world, terrain, walking)
    for (const id of caravan.escortIds) expect(isArmed(byId(world, id))).toBe(true)
    expect(hqWarehouse.stock!.spear).toBe(10 - CARAVAN_ESCORTS)
    expect(world.crimes).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('defend their caravan against a robber, which is no crime', () => {
    const { world, terrain, caravan, realm } = route()
    const carriage = onTheWay(world, caravan)
    const thief = outsider(world, realm.id, 'thief', 60, 60)
    thief.order = {
      kind: 'pickUp',
      from: { kind: 'carriage', carriageId: carriage.id },
      goods: { iron: 5 },
    }
    expect(caravanThreats(world, caravan, carriage, terrain.size)).toEqual([thief])
    const walking = new Walking(terrain)
    stepWorld(world, terrain, walking)
    for (const id of caravan.escortIds) {
      expect(byId(world, id).order).toMatchObject({
        kind: 'attack',
        targetId: 'thief',
        defending: true,
      })
    }
    for (let t = 0; t < 300 && world.residents.includes(thief); t++) {
      stepWorld(world, terrain, walking)
    }
    // The unarmed robber was beaten off: killed, or fled home hurt.
    expect(!world.residents.includes(thief) || thief.health < MAX_HEALTH).toBe(true)
    const escorts = new Set(caravan.escortIds)
    expect(world.crimes.filter((c) => escorts.has(c.culprit.residentId))).toEqual([])
    expect(world.crimes).toContainEqual(
      expect.objectContaining({
        kind: 'theft',
        culprit: expect.objectContaining({ residentId: 'thief' }),
      }),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 30_000)

  it('defend its driver against an attacker, and the carriage waits for them', () => {
    const { world, terrain, caravan, realm } = route()
    const carriage = onTheWay(world, caravan)
    const raider = outsider(world, realm.id, 'raider', 61, 60)
    raider.carried.spear = 1
    raider.order = attackOrder(caravan.driverId)
    expect(caravanThreats(world, caravan, carriage, terrain.size)).toEqual([raider])
    stepWorld(world, terrain, new Walking(terrain))
    for (const id of caravan.escortIds) {
      expect(byId(world, id).order).toMatchObject({ kind: 'attack', targetId: 'raider' })
    }
    const driver = byId(world, caravan.driverId)
    driver.order = {
      kind: 'drive',
      carriageId: carriage.id,
      target: { x: 80, y: 80 },
      path: null,
      progress: 0,
    }
    expect(waitingForEscort(world, terrain.size)).toEqual(new Set([driver.id]))
  })

  it('leave alone who is far from the carriage, fighting back, or of the Trade Organization', () => {
    const { world, terrain, caravan, realm } = route()
    const carriage = onTheWay(world, caravan)
    const far = outsider(world, realm.id, 'far', 60 + CARAVAN_GUARD_RANGE + 1, 60)
    far.order = attackOrder(caravan.driverId)
    const back = outsider(world, realm.id, 'back', 61, 60)
    back.order = attackOrder(caravan.escortIds[0]!, true, true)
    const driver = byId(world, caravan.driverId)
    driver.order = {
      kind: 'pickUp',
      from: { kind: 'carriage', carriageId: carriage.id },
      goods: { iron: 1 },
    }
    expect(caravanThreats(world, caravan, carriage, terrain.size)).toEqual([])
  })

  it('give up a chase that leads too far from the carriage', () => {
    const { world, terrain, caravan, realm } = route()
    onTheWay(world, caravan)
    const thief = outsider(world, realm.id, 'thief', 60 + CARAVAN_GUARD_RANGE + 2, 60)
    const escort = byId(world, caravan.escortIds[0]!)
    escort.order = attackOrder(thief.id, false, true)
    stepWorld(world, terrain, new Walking(terrain))
    expect(escort.order?.kind).not.toBe('attack')
  })
})

describe('escorts per route', () => {
  it('grow with how often the route was robbed, up to a most', () => {
    const wanted = (n: number) => caravanEscortsWanted({ routeRobberies: { p: n } }, 'p')
    expect(caravanEscortsWanted({ routeRobberies: {} }, 'p')).toBe(CARAVAN_ESCORTS)
    expect(wanted(CARAVAN_ROBBERIES_PER_ESCORT - 1)).toBe(CARAVAN_ESCORTS)
    expect(wanted(CARAVAN_ROBBERIES_PER_ESCORT)).toBe(CARAVAN_ESCORTS + 1)
    expect(wanted(3 * CARAVAN_ROBBERIES_PER_ESCORT)).toBe(CARAVAN_ESCORTS + 3)
    expect(wanted(1_000)).toBe(CARAVAN_ESCORTS_MAX)
    expect(caravanFoodFor(CARAVAN_ESCORTS)).toBe(CARAVAN_FOOD)
    expect(caravanFoodFor(CARAVAN_ESCORTS + 2)).toBe(CARAVAN_FOOD + 2 * CARAVAN_FOOD_PER_ESCORT)
  })

  it('a route robbed more often gets more escorts, armed, from the HQ', () => {
    const { world, terrain, caravan, hqWarehouse, post } = route()
    hqWarehouse.stock = { ...hqWarehouse.stock, spear: 20 }
    world.routeRobberies[post.id] = 2 * CARAVAN_ROBBERIES_PER_ESCORT
    const first = [...caravan.escortIds]
    const walking = new Walking(terrain)
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
    const ready = () =>
      caravan.escortIds.length === CARAVAN_ESCORTS + 2 &&
      caravan.escortIds.every((id) => isArmed(byId(world, id)))
    for (let t = 0; t < 2_000 && !ready(); t++) {
      stepWorld(world, terrain, walking)
      // The caravan waits at the warehouse for its new escorts to come and arm themselves.
      expect([carriage.x, carriage.y]).toEqual([hqWarehouse.x, hqWarehouse.y])
    }
    expect(caravan.escortIds).toHaveLength(CARAVAN_ESCORTS + 2)
    expect(caravan.escortIds.slice(0, CARAVAN_ESCORTS)).toEqual(first)
    for (const id of caravan.escortIds) {
      const r = byId(world, id)
      expect(r).toMatchObject({ owner: null, cityId: hqWarehouse.cityId })
      expect(isArmed(r)).toBe(true)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 30_000)

  it('flag a caravan with more escorts than its route gets', () => {
    const { world, terrain, caravan } = route()
    const extra = world.residents.find(
      (r) =>
        r.owner === null &&
        r.cityId === byId(world, caravan.driverId).cityId &&
        !caravan.escortIds.includes(r.id) &&
        r.id !== caravan.driverId,
    )!
    caravan.escortIds.push(extra.id)
    expect(caravansSound.check(world, terrain)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('more than the 2 of its route') }),
    ])
  })
})
