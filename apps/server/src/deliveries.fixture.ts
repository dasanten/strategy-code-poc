// Setup shared by `deliveries.test.ts` and `deliveries-robbed.test.ts`; left out of the build.

import {
  AVERAGE_HORSE_STATS,
  Terrain,
  deliveryStorage,
  type Good,
  type RealmEvent,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { expect } from 'vitest'
import { placeCaravans, routeEnd } from './caravans.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

export const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** An open map of Plains, `size` tiles along each side. */
export const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * The Trade Org HQ, a trading post with its caravan, Mara's starting city and her resident p1
 * standing on the post’s warehouse with 1,000 coins.
 */
export function setup() {
  const terrain = plains(512)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  foundTradeOrgHq(world, terrain, 128, 128, rand)
  foundTradingPost(world, terrain, 320, 320, undefined, rand)
  const [caravan] = placeCaravans(world)
  // An average horse, so the caravan's loads are what the delivery numbers below expect.
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  const realm = foundStartingCity(world, terrain, mara.userId)
  const city = world.cities.find((c) => c.realmId === realm.id)!
  const storage = deliveryStorage(world, city.id)!
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
  return { world, terrain, caravan: caravan!, realm, city, storage, warehouse, p1, queue }
}

/** Sends an order from p1, applies it and answers whether it was taken. */
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

export const eventsOf = <K extends RealmEvent['kind']>(world: WorldState, kind: K) =>
  world.events.filter((e): e is Extract<RealmEvent, { kind: K }> => e.kind === kind)
