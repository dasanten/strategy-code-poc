// Setup shared by `transfers.test.ts` and `transfers-caravans.test.ts`; left out of the build.

import {
  Terrain,
  deliveryStorage,
  type Caravan,
  type Good,
  type RealmEvent,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { expect } from 'vitest'
import { placeCaravans, routeEnd } from './caravans.js'
import { resolveCarrying } from './carrying.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

export const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
export const ivo = { userId: 8, account: { name: 'Ivo', isAdmin: false } }

/** An open map of Plains, `size` tiles along each side. */
export const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * The Trade Org HQ, a trading post with its caravan, Mara's and Ivo's starting cities, and Mara's
 * resident p1 standing on the post's warehouse with 1,000 coins.
 */
export function setup() {
  const terrain = plains(512)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  foundTradeOrgHq(world, terrain, 128, 128, rand)
  foundTradingPost(world, terrain, 320, 320, undefined, rand)
  const [caravan] = placeCaravans(world)
  const realm = foundStartingCity(world, terrain, mara.userId)
  const other = foundStartingCity(world, terrain, ivo.userId)
  const city = world.cities.find((c) => c.realmId === realm.id)!
  const toCity = world.cities.find((c) => c.realmId === other.id)!
  const storage = deliveryStorage(world, city.id)!
  const toStorage = deliveryStorage(world, toCity.id)!
  // Coins for the fees of transfers picked up there.
  storage.stock!.coins = 2_000
  const warehouse = routeEnd(world, caravan!, 'post').warehouse!
  const p1 = newResident(mulberry32(11), {
    id: 'p1',
    owner: realm.id,
    cityId: city.id,
    x: warehouse.x,
    y: warehouse.y,
    tick: 0,
  })
  p1.bornAt = -20 * 24 * 3600
  p1.carried = { coins: 1_000 }
  world.residents.push(p1)
  const queue = new OrderQueue(undefined, terrain)
  return {
    world,
    terrain,
    caravan: caravan!,
    realm,
    other,
    city,
    toCity,
    storage,
    toStorage,
    warehouse,
    p1,
    queue,
  }
}

/** Sends an order from Mara (for p1, when it is a resident's), applies it and answers. */
export function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, mara, 'q', { residentId: 'p1', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Every unit of a good in the world: in buildings, on carriages, carried and on the ground. */
export function total(world: WorldState, good: Good): number {
  const stocks = [
    ...world.buildings.map((b) => b.stock ?? {}),
    ...world.carriages.map((k) => k.load),
    ...world.residents.map((r) => r.carried),
    ...world.piles.map((p) => p.goods),
  ]
  return stocks.reduce((n, s) => n + (s[good] ?? 0), 0)
}

/**
 * Steps the world at least once and then until `done`, at most `ticks` times, checking every
 * invariant now and then.
 */
export function runUntil(
  world: WorldState,
  terrain: TerrainMap,
  done: () => boolean,
  ticks = 20_000,
) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && (t === 0 || !done()); t++) {
    stepWorld(world, terrain, walking)
    if (t % 500 === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
  expect(done()).toBe(true)
  expect(checkInvariants(world, terrain)).toEqual([])
}

export const eventsOf = <K extends RealmEvent['kind']>(
  world: WorldState,
  kind: K,
  userId?: number,
) =>
  world.events.filter(
    (e): e is Extract<RealmEvent, { kind: K }> =>
      e.kind === kind && (userId === undefined || e.userId === userId),
  )

/** The caravan carrying out a transfer, if any. */
export const carrier = (world: WorldState): Caravan | undefined =>
  world.caravans.find((c) => c.transfer !== null)

/** Has a new resident of Mara's realm, standing at the caravan's carriage, take `goods` off it. */
export function rob(world: WorldState, terrain: TerrainMap, caravan: Caravan, goods: Stock) {
  const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
  const realmId = world.realms[0]!.id
  const cityId = world.cities.find((c) => c.realmId === realmId)!.id
  const thief = newResident(mulberry32(17), {
    id: 'thief',
    owner: realmId,
    cityId,
    x: 0,
    y: 0,
    tick: 0,
  })
  thief.bornAt = -20 * 24 * 3600
  thief.x = carriage.x
  thief.y = carriage.y
  world.residents.push(thief)
  const spot = { kind: 'carriage' as const, carriageId: carriage.id }
  resolveCarrying(world, [{ kind: 'take', residentId: 'thief', spot, goods }], terrain.size)
  return thief
}
