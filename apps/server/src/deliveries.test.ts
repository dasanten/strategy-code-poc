import {
  DELIVERY_FEE_BASE,
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  Terrain,
  deliveryFee,
  deliveryStorage,
  owedBy,
  priceFor,
  quoteDelivery,
  quotePickUp,
  quoteTrade,
  stockFloor,
  wrapDistance,
  type Building,
  type Good,
  type RealmEvent,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { placeCaravans, routeEnd } from './caravans.js'
import { collectsFrom, deliveriesSound } from './deliveries.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * The Trade Org HQ, a trading post with its caravan, Mara's starting city and her resident p1
 * standing on the post’s warehouse with 1,000 coins.
 */
function setup() {
  const terrain = plains(128)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  foundTradeOrgHq(world, terrain, 32, 32, rand)
  foundTradingPost(world, terrain, 80, 80, undefined, rand)
  const [caravan] = placeCaravans(world)
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
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, mara, 'q', { residentId: 'p1', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Every unit of a good in the world: in buildings, on carriages, carried and on the ground. */
function total(world: WorldState, good: Good): number {
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
function runUntil(world: WorldState, terrain: TerrainMap, done: () => boolean, ticks = 20_000) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && (t === 0 || !done()); t++) {
    stepWorld(world, terrain, walking)
    if (t % 500 === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
  expect(done()).toBe(true)
  expect(checkInvariants(world, terrain)).toEqual([])
}

const eventsOf = <K extends RealmEvent['kind']>(world: WorldState, kind: K) =>
  world.events.filter((e): e is Extract<RealmEvent, { kind: K }> => e.kind === kind)

describe('delivery fees and quotes', () => {
  const post = () => {
    const { world, warehouse, storage } = setup()
    return { world, warehouse, storage }
  }

  it('charge a base fee and more for weight and distance', () => {
    expect(deliveryFee(0, 100)).toBe(DELIVERY_FEE_BASE)
    expect(deliveryFee(100, 100)).toBe(DELIVERY_FEE_BASE + 50)
    expect(deliveryFee(100, 200)).toBeGreaterThan(deliveryFee(100, 100))
    expect(deliveryFee(200, 100)).toBeGreaterThan(deliveryFee(100, 100))
  })

  it('price a delivery like a purchase, plus the fee, cut down to the coins and one load', () => {
    const { world, warehouse } = post()
    warehouse.stock!.stone = 5_000
    const floor = stockFloor(world, warehouse).stone!
    const q = quoteDelivery(world, warehouse, { coins: 100_000 }, 'stone', 1_000, 40)
    expect(q.units).toBe(Math.floor(DELIVERY_LOAD / GOOD_WEIGHT.stone))
    let price = 0
    for (let n = 0; n < q.units; n++) price += priceFor('stone', 5_000 - n, floor).sell
    expect(q.coins).toBe(price)
    expect(q.fee).toBe(deliveryFee(q.units * GOOD_WEIGHT.stone, 40))
    const poor = quoteDelivery(world, warehouse, { coins: 30 }, 'stone', 1_000, 40)
    expect(poor.coins + poor.fee).toBeLessThanOrEqual(30)
    expect(poor.units).toBeGreaterThan(0)
  })

  it('never sell what a warehouse keeps for deliveries', () => {
    const { world, warehouse } = post()
    warehouse.stock!.iron = 30
    const hands = { stock: { coins: 100_000 }, room: 1_000 }
    expect(quoteTrade(world, warehouse, hands, 'buy', 'iron', 100, 25).units).toBe(5)
    expect(quoteDelivery(world, warehouse, { coins: 100_000 }, 'iron', 100, 10, 25).units).toBe(5)
  })

  it('pay for a pick-up what the warehouse would pay, less the fee, within the budget', () => {
    const { world, warehouse } = post()
    const stock = warehouse.stock!.iron ?? 0
    const floor = stockFloor(world, warehouse).iron!
    const q = quotePickUp(world, warehouse, 'iron', 20, 15, 30, Infinity)
    expect(q.units).toBe(15)
    let price = 0
    for (let n = 1; n <= 15; n++) price += priceFor('iron', stock + n, floor).buy
    expect(q.fee).toBe(deliveryFee(15, 30))
    expect(q.coins).toBe(price - q.fee)
    expect(quotePickUp(world, warehouse, 'iron', 20, 15, 30, 10).coins).toBeLessThanOrEqual(10)
    // Cheap goods far away: the fee eats the price, so there is nothing to pick up.
    expect(quotePickUp(world, warehouse, 'food', 1, 1, 700, Infinity).units).toBe(0)
  })
})

describe('ordering a delivery', () => {
  it('pays for the goods and the fee now, and the warehouse keeps the goods for it', () => {
    const { world, terrain, warehouse, storage, city, p1, queue } = setup()
    const iron = warehouse.stock!.iron!
    const coins = warehouse.stock!.coins!
    const tiles = wrapDistance(terrain.size, warehouse, storage)
    const q = quoteDelivery(world, warehouse, p1.carried, 'iron', 4, tiles)
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 4, cityId: city.id })).toBe(
      'ack',
    )
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
    expect(q.units).toBe(4)
    expect(p1.carried).toEqual({ coins: 1_000 - q.coins - q.fee })
    expect(warehouse.stock!.coins).toBe(coins + q.coins + q.fee)
    expect(warehouse.stock!.iron).toBe(iron)
    expect(world.deliveries).toEqual([
      expect.objectContaining({ kind: 'delivery', good: 'iron', units: 4, fee: q.fee }),
    ])
    expect(owedBy(world, warehouse.id, 'iron')).toBe(4)
    expect(eventsOf(world, 'deliveryOrdered')).toEqual([
      expect.objectContaining({ side: 'buy', units: 4, coins: q.coins, fee: q.fee }),
    ])
  })

  it('refuses a city that is not theirs, and a pick-up from a carriage', () => {
    const { world, queue, warehouse } = setup()
    const post = world.cities.find((c) => c.id === warehouse.cityId)!
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 1, cityId: post.id })).toBe(
      'not one of your cities',
    )
    const city = world.cities.find((c) => c.realmId !== null)!
    const pickUp = { kind: 'sell', good: 'food', units: 1, cityId: city.id, carriageId: 'k' }
    expect(order(world, queue, pickUp)).not.toBe('ack')
  })

  it('refuses a pick-up of a good the city’s storage has none of', () => {
    const { world, queue, city } = setup()
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 1, cityId: city.id })).toBe(
      'none of that good to sell',
    )
  })
})

describe('caravans carrying out deliveries', () => {
  it('bring a delivery from the trading post to the city’s storage', () => {
    const { world, terrain, warehouse, storage, city, caravan, queue } = setup()
    order(world, queue, { kind: 'buy', good: 'iron', units: 6, cityId: city.id })
    const iron = total(world, 'iron')
    const before = storage.stock!.iron ?? 0
    runUntil(world, terrain, () => world.deliveries.length === 0)
    expect(storage.stock!.iron).toBe(before + 6)
    expect(eventsOf(world, 'delivered')).toEqual([
      expect.objectContaining({ delivery: 'delivery', good: 'iron', units: 6, cityId: city.id }),
    ])
    // Then it goes back to its route, at the post's end.
    runUntil(world, terrain, () => caravan.job === null, 5_000)
    expect(owedBy(world, warehouse.id, 'iron')).toBe(0)
    expect(total(world, 'iron')).toBe(iron)
    // Bringing what was bought into someone's storage is no crime.
    expect(world.crimes).toEqual([])
  }, 60_000)

  it('pick up goods sold from the city’s storage, pay there, and bring them to the warehouse', () => {
    const { world, terrain, warehouse, storage, city, caravan, queue } = setup()
    storage.stock!.stone = 40
    const stone = warehouse.stock!.stone ?? 0
    expect(order(world, queue, { kind: 'sell', good: 'stone', units: 30, cityId: city.id })).toBe(
      'ack',
    )
    let collecting = false
    runUntil(world, terrain, () => {
      const driver = world.residents.find((r) => r.id === caravan.driverId)!
      collecting ||= collectsFrom(world, driver, storage.id)
      return world.deliveries.length === 0
    })
    expect(collecting).toBe(true)
    const [done] = eventsOf(world, 'delivered')
    expect(done).toMatchObject({ delivery: 'pickUp', good: 'stone', units: 30 })
    expect(done!.coins).toBeGreaterThan(0)
    expect(storage.stock!.stone).toBe(10)
    expect(storage.stock!.coins).toBe(done!.coins)
    // Taking what was sold to it is no theft.
    expect(world.crimes).toEqual([])
    runUntil(world, terrain, () => caravan.job === null, 10_000)
    expect(warehouse.stock!.stone).toBeGreaterThanOrEqual(stone + 30 - 1)
  }, 60_000)

  it('turn back from a city behind closed gates, and the delivery waits for the next caravan', () => {
    const { world, terrain, warehouse, city, caravan, queue } = setup()
    for (const b of world.buildings) if (b.kind === 'gate' && b.cityId === city.id) b.closed = true
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    runUntil(world, terrain, () => eventsOf(world, 'deliveryStuck').length > 0)
    expect(eventsOf(world, 'deliveryStuck')[0]).toMatchObject({ cancelled: false, units: 3 })
    expect(world.deliveries).toEqual([expect.objectContaining({ caravanId: null, units: 3 })])
    runUntil(world, terrain, () => caravan.job === null, 10_000)
    expect(owedBy(world, warehouse.id, 'iron')).toBe(3)
  }, 60_000)

  it('drop a delivery to a city that is no longer the realm’s', () => {
    const { world, terrain, city, caravan, queue } = setup()
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    runUntil(world, terrain, () => caravan.job?.step === 'deliver')
    // The delivery's realm is another than the city's now, as when the city was taken.
    world.realms.push({ id: 'realm2', userId: 8, leaderId: 'q1' })
    world.residents.push(
      newResident(mulberry32(3), { id: 'q1', owner: 'realm2', x: 5, y: 5, tick: 0 }),
    )
    world.deliveries[0]!.realmId = 'realm2'
    runUntil(world, terrain, () => eventsOf(world, 'deliveryStuck').length > 0, 100)
    expect(eventsOf(world, 'deliveryStuck')[0]).toMatchObject({ cancelled: true })
    expect(world.deliveries).toEqual([])
  }, 60_000)

  it('let go of a delivery when the caravan breaks up', () => {
    const { world, terrain, city, caravan, queue } = setup()
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    runUntil(world, terrain, () => caravan.job !== null)
    world.residents = world.residents.filter((r) => r.id !== caravan.driverId)
    stepWorld(world, terrain)
    expect(world.caravans).toEqual([])
    expect(world.deliveries).toEqual([expect.objectContaining({ caravanId: null })])
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 60_000)
})

describe('deliveries sound', () => {
  it('flags a delivery whose caravan carries out another', () => {
    const { world, terrain, city, caravan, warehouse } = setup()
    world.deliveries.push({
      id: 'delivery1',
      kind: 'delivery',
      realmId: city.realmId!,
      warehouseId: warehouse.id,
      cityId: city.id,
      good: 'iron',
      units: 2,
      fee: 5,
      caravanId: caravan.id,
    })
    expect(deliveriesSound.check(world, terrain)).toHaveLength(1)
    world.deliveries[0]!.units = 0
    world.deliveries[0]!.caravanId = null
    expect(deliveriesSound.check(world, terrain)).toHaveLength(1)
  })

  it('flags a caravan counting more on board than its carriage holds', () => {
    const { world, terrain, caravan, warehouse } = setup()
    caravan.job = {
      deliveryId: 'gone',
      kind: 'delivery',
      warehouseId: (warehouse as Building).id,
      good: 'iron',
      step: 'return',
      units: 5,
      coins: 0,
      target: null,
      toPay: 0,
      paid: 0,
      fee: 0,
      misses: 0,
    }
    expect(deliveriesSound.check(world, terrain)).toHaveLength(1)
  })
})
