import {
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  TRANSFER_FEE_FACTOR,
  Terrain,
  deliveryFee,
  deliveryStorage,
  nearestWarehouse,
  owedBy,
  quoteTransfer,
  transferFee,
  transferLoad,
  transferTiles,
  wrapDistance,
  type Caravan,
  type Good,
  type RealmEvent,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { placeCaravans, routeEnd } from './caravans.js'
import { resolveCarrying } from './carrying.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { changeStanding } from './standing.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { collectsTransferFrom, transfersSound } from './transfers.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const ivo = { userId: 8, account: { name: 'Ivo', isAdmin: false } }

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * The Trade Org HQ, a trading post with its caravan, Mara's and Ivo's starting cities, and Mara's
 * resident p1 standing on the post's warehouse with 1,000 coins.
 */
function setup() {
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

const eventsOf = <K extends RealmEvent['kind']>(world: WorldState, kind: K, userId?: number) =>
  world.events.filter(
    (e): e is Extract<RealmEvent, { kind: K }> =>
      e.kind === kind && (userId === undefined || e.userId === userId),
  )

/** The caravan carrying out a transfer, if any. */
const carrier = (world: WorldState): Caravan | undefined =>
  world.caravans.find((c) => c.transfer !== null)

/** Has a new resident of Mara's realm, standing at the caravan's carriage, take `goods` off it. */
function rob(world: WorldState, terrain: TerrainMap, caravan: Caravan, goods: Stock) {
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

describe('transfer fees and quotes', () => {
  it('cost a multiple of a delivery’s fee over the caravan’s whole way', () => {
    expect(transferFee(100, 100)).toBe(TRANSFER_FEE_FACTOR * deliveryFee(100, 100))
    expect(TRANSFER_FEE_FACTOR).toBeGreaterThan(1)
    const w = { x: 0, y: 0 }
    expect(transferTiles(100, w, { x: 10, y: 0 }, { x: 10, y: 20 })).toBe(
      10 + 20 + wrapDistance(100, w, { x: 10, y: 20 }),
    )
    expect(transferTiles(100, w, null, { x: 0, y: 15 })).toBe(30)
  })

  it('take what is held, up to one load and the coins for the fee', () => {
    expect(quoteTransfer({ iron: 50, coins: 10_000 }, 'iron', 30, 160)).toEqual({
      units: 30,
      fee: transferFee(30, 160),
    })
    expect(quoteTransfer({ iron: 12, coins: 10_000 }, 'iron', 30, 160).units).toBe(12)
    const load = quoteTransfer({ stone: 10_000, coins: 100_000 }, 'stone', 10_000, 160)
    expect(load.units).toBe(Math.floor(DELIVERY_LOAD / GOOD_WEIGHT.stone))
    // Short of coins for the whole fee, it takes fewer.
    const poor = quoteTransfer({ iron: 100, coins: transferFee(10, 160) }, 'iron', 100, 160)
    expect(poor).toEqual({ units: 10, fee: transferFee(10, 160) })
    expect(quoteTransfer({ iron: 100 }, 'iron', 100, 160).units).toBe(0)
    // Coins pay their own fee out of the same coins.
    const coins = quoteTransfer({ coins: 500 }, 'coins', 1_000, 160)
    expect(coins.units + coins.fee).toBeLessThanOrEqual(500)
    expect(coins.units).toBeGreaterThan(0)
  })

  it('come from the warehouse nearest the sender’s city', () => {
    const { world, terrain, storage } = setup()
    const w = nearestWarehouse(world, storage, terrain.size)!
    for (const b of world.buildings.filter((x) => x.kind === 'warehouse')) {
      expect(wrapDistance(terrain.size, w, storage)).toBeLessThanOrEqual(
        wrapDistance(terrain.size, b, storage),
      )
    }
  })
})

describe('ordering a transfer', () => {
  it('needs nobody at a warehouse, and moves nothing until the caravan comes', () => {
    const { world, terrain, queue, city, toCity, other, storage } = setup()
    storage.stock!.iron = 40
    const ordered = { kind: 'transfer', fromCityId: city.id, toCityId: toCity.id }
    expect(order(world, queue, { ...ordered, good: 'iron', units: 25 })).toBe('ack')
    expect(world.transfers).toEqual([
      expect.objectContaining({
        toRealmId: other.id,
        fromCityId: city.id,
        good: 'iron',
        units: 25,
        fee: 0,
        warehouseId: nearestWarehouse(world, storage, terrain.size)!.id,
      }),
    ])
    expect(storage.stock!.iron).toBe(40)
    expect(eventsOf(world, 'transferOrdered', mara.userId)).toEqual([
      expect.objectContaining({ fromCity: city.name, city: toCity.name, units: 25 }),
    ])
  })

  it('refuses one to its own city, to no realm’s, beyond one load, or for a refused realm', () => {
    const { world, queue, city, toCity, realm, warehouse } = setup()
    const from = { kind: 'transfer', fromCityId: city.id, good: 'iron', units: 5 }
    expect(order(world, queue, { ...from, toCityId: city.id })).toBe('that city is your own')
    expect(order(world, queue, { ...from, toCityId: warehouse.cityId })).toBe(
      'not a city of a realm',
    )
    expect(
      order(world, queue, { ...from, toCityId: toCity.id, units: transferLoad('iron') + 1 }),
    ).toBe('more than one carriage load')
    expect(order(world, queue, { ...from, fromCityId: toCity.id, toCityId: toCity.id })).not.toBe(
      'ack',
    )
    changeStanding(world, 'trade-org', realm.id, -100)
    expect(order(world, queue, { ...from, toCityId: toCity.id })).toBe(
      'the Trade Organization won’t carry for you',
    )
    expect(world.transfers).toEqual([])
  })

  it('hands in coins at a warehouse, paying the fee there at once', () => {
    const { world, terrain, queue, p1, toCity, toStorage, warehouse } = setup()
    const tiles = transferTiles(terrain.size, warehouse, null, toStorage)
    const q = quoteTransfer(p1.carried, 'coins', 300, tiles)
    expect(
      order(world, queue, { kind: 'handIn', good: 'coins', units: 300, toCityId: toCity.id }),
    ).toBe('ack')
    const coins = total(world, 'coins')
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
    expect(q.units).toBe(300)
    expect(p1.carried.coins).toBe(1_000 - 300 - q.fee)
    expect(total(world, 'coins')).toBe(coins)
    expect(world.transfers).toEqual([
      expect.objectContaining({ fromCityId: null, good: 'coins', units: 300, fee: q.fee }),
    ])
    expect(eventsOf(world, 'transferOrdered')).toEqual([
      expect.objectContaining({ name: p1.name, units: 300, fee: q.fee, fromCity: null }),
    ])
  })

  it('keeps goods handed in for the transfer, so the warehouse sells none of them', () => {
    const { world, terrain, queue, p1, toCity, warehouse } = setup()
    p1.carried.iron = 8
    order(world, queue, { kind: 'handIn', good: 'iron', units: 8, toCityId: toCity.id })
    stepWorld(world, terrain)
    expect(owedBy(world, warehouse.id, 'iron')).toBe(8)
  })
})

describe('caravans carrying out transfers', () => {
  it(
    'pick a transfer up at the sender’s city and bring it to the recipient’s',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage, toStorage, realm, other } = setup()
      storage.stock!.iron = 40
      const coins = storage.stock!.coins ?? 0
      const iron = total(world, 'iron')
      const before = toStorage.stock!.iron ?? 0
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 25,
      })
      const warehouse = world.buildings.find((b) => b.id === world.transfers[0]!.warehouseId)!
      let collecting = false
      runUntil(world, terrain, () => {
        const c = carrier(world)
        const driver = c && world.residents.find((r) => r.id === c.driverId)
        collecting ||= !!driver && collectsTransferFrom(world, driver, storage.id)
        return world.transfers.length === 0
      })
      expect(collecting).toBe(true)
      const fee = transferFee(25, transferTiles(terrain.size, warehouse, storage, toStorage))
      expect(toStorage.stock!.iron).toBe(before + 25)
      expect(storage.stock!.iron).toBe(15)
      expect(storage.stock!.coins ?? 0).toBe(coins - fee)
      expect(total(world, 'iron')).toBe(iron)
      const arrived = { good: 'iron', units: 25, fee, fromRealmId: realm.id, toRealmId: other.id }
      // Both realms' logs show it.
      expect(eventsOf(world, 'transferred', mara.userId)).toEqual([
        expect.objectContaining(arrived),
      ])
      expect(eventsOf(world, 'transferred', ivo.userId)).toEqual([expect.objectContaining(arrived)])
      // Taking what it was given to carry, and putting it into someone's storage, is no crime.
      expect(world.crimes).toEqual([])
    },
  )

  it(
    'take what the sender’s storage holds, with a fee for what it takes',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage, toStorage } = setup()
      storage.stock!.iron = 6
      const before = toStorage.stock!.iron ?? 0
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 20,
      })
      runUntil(world, terrain, () => world.transfers.length === 0)
      expect(toStorage.stock!.iron).toBe(before + 6)
      expect(eventsOf(world, 'transferred')[0]).toMatchObject({ units: 6 })
    },
  )

  it(
    'drop a transfer the sender’s storage holds none of',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage } = setup()
      delete storage.stock!.iron
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 5,
      })
      runUntil(world, terrain, () => world.transfers.length === 0)
      expect(eventsOf(world, 'transferStuck')).toEqual([
        expect.objectContaining({ why: 'nothing' }),
      ])
      runUntil(world, terrain, () => carrier(world) === undefined, 10_000)
    },
  )

  it(
    'turn back from a recipient behind closed gates, the warehouse keeping it for the next caravan',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage } = setup()
      storage.stock!.iron = 40
      for (const b of world.buildings)
        if (b.kind === 'gate' && b.cityId === toCity.id) b.closed = true
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 12,
      })
      const warehouseId = world.transfers[0]!.warehouseId
      runUntil(world, terrain, () => eventsOf(world, 'transferStuck').length > 0)
      expect(eventsOf(world, 'transferStuck')).toEqual([
        expect.objectContaining({ why: 'turnedBack', units: 12, cityId: toCity.id }),
      ])
      expect(world.transfers).toEqual([
        expect.objectContaining({ fromCityId: null, caravanId: null, units: 12 }),
      ])
      runUntil(world, terrain, () => carrier(world) === undefined, 10_000)
      expect(owedBy(world, warehouseId, 'iron')).toBe(12)
      expect(storage.stock!.iron).toBe(28)
    },
  )

  it(
    'bring coins handed in at a warehouse to the recipient’s storage',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, toCity, toStorage } = setup()
      const before = toStorage.stock!.coins ?? 0
      order(world, queue, { kind: 'handIn', good: 'coins', units: 300, toCityId: toCity.id })
      runUntil(world, terrain, () => world.transfers.length === 0)
      expect(toStorage.stock!.coins).toBe(before + 300)
      expect(eventsOf(world, 'transferred', ivo.userId)).toEqual([
        expect.objectContaining({ good: 'coins', units: 300 }),
      ])
    },
  )

  it(
    'bring a transfer back to the sender when the recipient’s city is no longer theirs',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage, toStorage } = setup()
      storage.stock!.iron = 40
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 25,
      })
      runUntil(world, terrain, () => carrier(world)?.transfer?.step === 'deliver')
      const toIron = toStorage.stock!.iron ?? 0
      // The recipient's realm is another than the city's now, as when the city was taken.
      world.realms.push({ id: 'realm3', userId: 9, leaderId: 'q1' })
      world.residents.push(
        newResident(mulberry32(3), { id: 'q1', owner: 'realm3', x: 5, y: 5, tick: 0 }),
      )
      world.transfers[0]!.toRealmId = 'realm3'
      runUntil(world, terrain, () => world.transfers.length === 0)
      expect(eventsOf(world, 'transferStuck')).toEqual([
        expect.objectContaining({ why: 'cancelled' }),
      ])
      expect(eventsOf(world, 'transferred', mara.userId)).toEqual([
        expect.objectContaining({ back: true, units: 25, cityId: city.id }),
      ])
      // The goods are back, the fee is not.
      expect(storage.stock!.iron).toBe(40)
      expect(toStorage.stock!.iron ?? 0).toBe(toIron)
      expect(world.transfers).toEqual([])
    },
  )

  it(
    'send again what robbers took of a transfer, and all of it arrives',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain, queue, city, toCity, storage, toStorage } = setup()
      storage.stock!.iron = 40
      const before = toStorage.stock!.iron ?? 0
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        toCityId: toCity.id,
        good: 'iron',
        units: 25,
      })
      runUntil(world, terrain, () => {
        const job = carrier(world)?.transfer
        return job?.step === 'deliver' && job.units === 25
      })
      const caravan = carrier(world)!
      const thief = rob(world, terrain, caravan, { iron: 10 })
      expect(thief.carried.iron).toBe(10)
      expect(caravan.transfer).toMatchObject({ units: 15, robbed: 10 })
      runUntil(world, terrain, () => eventsOf(world, 'transferStuck').length > 0)
      expect(eventsOf(world, 'transferStuck')).toEqual([
        expect.objectContaining({ why: 'robbed', units: 10 }),
      ])
      expect(world.transfers).toEqual([
        expect.objectContaining({ units: 10, fromCityId: null, caravanId: null }),
      ])
      runUntil(world, terrain, () => world.transfers.length === 0)
      expect(toStorage.stock!.iron).toBe(before + 25)
      expect(eventsOf(world, 'transferred', ivo.userId).map((e) => e.units)).toEqual([15, 10])
      // The sender paid once.
      expect(storage.stock!.iron).toBe(15)
    },
  )
})

describe('transfers sound', () => {
  it('flags a transfer of no units, to its sender, or carried by a caravan whose job is another', () => {
    const { world, terrain, realm, toCity, warehouse } = setup()
    world.transfers.push({
      id: 't',
      realmId: realm.id,
      toRealmId: realm.id,
      toCityId: toCity.id,
      warehouseId: warehouse.id,
      fromCityId: null,
      good: 'iron',
      units: 0,
      fee: -1,
      back: false,
      caravanId: 'nobody',
    })
    expect(transfersSound.check(world, terrain)).toHaveLength(4)
  })

  it('flags a caravan counting more on board than its carriage holds', () => {
    const { world, terrain, caravan, warehouse } = setup()
    caravan.transfer = {
      transferId: 'gone',
      warehouseId: warehouse.id,
      good: 'iron',
      step: 'return',
      units: 5,
      coins: 0,
      target: null,
      fee: 0,
      misses: 0,
      robbed: 0,
      fromCityId: null,
    }
    expect(transfersSound.check(world, terrain)).toHaveLength(1)
  })
})
