import {
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  TRANSFER_FEE_FACTOR,
  deliveryFee,
  nearestWarehouse,
  owedBy,
  quoteTransfer,
  stockFloor,
  transferFee,
  transferLoad,
  transferTiles,
  wrapDistance,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { changeStanding } from './standing.js'
import { collectsTransferFrom, transfersSound } from './transfers.js'
import { stepWorld } from './world.js'
import { mara, ivo, setup, order, total, runUntil, eventsOf, carrier } from './transfers.fixture.js'

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
      // Every warehouse at its floor in every good, so the Trade Organization's own chain
      // (`CONTEXT.md`: Trade Org HQ) forges no Iron away while the transfer is under way.
      for (const b of world.buildings) {
        if (b.kind === 'warehouse') b.stock = { ...stockFloor(world, b), ...b.stock }
      }
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
