import {
  DELIVERY_FEE_BASE,
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  deliveryFee,
  owedBy,
  priceFor,
  quoteDelivery,
  quotePickUp,
  quoteTrade,
  stockFloor,
  wrapDistance,
  type Building,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { collectsFrom, deliveriesSound } from './deliveries.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { stepWorld } from './world.js'
import { setup, order, total, runUntil, eventsOf } from './deliveries.fixture.js'

describe('delivery fees and quotes', () => {
  const post = () => {
    const { world, warehouse, storage } = setup()
    return { world, warehouse, storage }
  }

  it('charge a base fee and more for weight and distance', () => {
    expect(deliveryFee(0, 400)).toBe(DELIVERY_FEE_BASE)
    expect(deliveryFee(100, 400)).toBe(DELIVERY_FEE_BASE + 50)
    expect(deliveryFee(100, 800)).toBeGreaterThan(deliveryFee(100, 400))
    expect(deliveryFee(200, 400)).toBeGreaterThan(deliveryFee(100, 400))
  })

  it('price a delivery like a purchase, plus the fee, cut down to the coins and one load', () => {
    const { world, warehouse } = post()
    warehouse.stock!.stone = 5_000
    const floor = stockFloor(world, warehouse).stone!
    const q = quoteDelivery(world, warehouse, { coins: 100_000 }, 'stone', 1_000, 160)
    expect(q.units).toBe(Math.floor(DELIVERY_LOAD / GOOD_WEIGHT.stone))
    let price = 0
    for (let n = 0; n < q.units; n++) price += priceFor('stone', 5_000 - n, floor).sell
    expect(q.coins).toBe(price)
    expect(q.fee).toBe(deliveryFee(q.units * GOOD_WEIGHT.stone, 160))
    const poor = quoteDelivery(world, warehouse, { coins: 30 }, 'stone', 1_000, 160)
    expect(poor.coins + poor.fee).toBeLessThanOrEqual(30)
    expect(poor.units).toBeGreaterThan(0)
  })

  it('never sell what a warehouse keeps for deliveries', () => {
    const { world, warehouse } = post()
    warehouse.stock!.iron = 30
    const hands = { stock: { coins: 100_000 }, room: 1_000 }
    expect(quoteTrade(world, warehouse, hands, 'buy', 'iron', 100, 25).units).toBe(5)
    expect(quoteDelivery(world, warehouse, { coins: 100_000 }, 'iron', 100, 40, 25).units).toBe(5)
  })

  it('pay for a pick-up what the warehouse would pay, less the fee, within the budget', () => {
    const { world, warehouse } = post()
    const stock = warehouse.stock!.iron ?? 0
    const floor = stockFloor(world, warehouse).iron!
    const q = quotePickUp(world, warehouse, 'iron', 20, 15, 120, Infinity)
    expect(q.units).toBe(15)
    let price = 0
    for (let n = 1; n <= 15; n++) price += priceFor('iron', stock + n, floor).buy
    expect(q.fee).toBe(deliveryFee(15, 120))
    expect(q.coins).toBe(price - q.fee)
    expect(quotePickUp(world, warehouse, 'iron', 20, 15, 120, 10).coins).toBeLessThanOrEqual(10)
    // Cheap goods far away: the fee eats the price, so there is nothing to pick up.
    expect(quotePickUp(world, warehouse, 'food', 1, 1, 2800, Infinity).units).toBe(0)
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
  it(
    'bring a delivery from the trading post to the city’s storage',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, warehouse, storage, city, caravan, queue } = setup()
      // Every warehouse at its floor in every good, so the Trade Organization's own chain
      // (`CONTEXT.md`: Trade Org HQ) forges no Iron away while the delivery is under way.
      for (const b of world.buildings) {
        if (b.kind === 'warehouse') b.stock = { ...stockFloor(world, b), ...b.stock }
      }
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
    },
  )

  it(
    'pick up goods sold from the city’s storage, pay there, and bring them to the warehouse',
    { tags: ['slow'], timeout: 120_000 },
    () => {
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
    },
  )

  it('turn back from a city behind closed gates, and the delivery waits for the next caravan', () => {
    const { world, terrain, warehouse, city, caravan, queue } = setup()
    for (const b of world.buildings) if (b.kind === 'gate' && b.cityId === city.id) b.closed = true
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    runUntil(world, terrain, () => eventsOf(world, 'deliveryStuck').length > 0)
    expect(eventsOf(world, 'deliveryStuck')[0]).toMatchObject({ cancelled: false, units: 3 })
    expect(world.deliveries).toEqual([expect.objectContaining({ caravanId: null, units: 3 })])
    runUntil(world, terrain, () => caravan.job === null, 10_000)
    expect(owedBy(world, warehouse.id, 'iron')).toBe(3)
  }, 120_000)

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
  }, 120_000)

  it('let go of a delivery when the caravan breaks up', () => {
    const { world, terrain, city, caravan, queue } = setup()
    order(world, queue, { kind: 'buy', good: 'iron', units: 3, cityId: city.id })
    runUntil(world, terrain, () => caravan.job !== null)
    world.residents = world.residents.filter((r) => r.id !== caravan.driverId)
    stepWorld(world, terrain)
    expect(world.caravans).toEqual([])
    expect(world.deliveries).toEqual([expect.objectContaining({ caravanId: null })])
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)
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
      robbed: 0,
    }
    expect(deliveriesSound.check(world, terrain)).toHaveLength(1)
  })
})
