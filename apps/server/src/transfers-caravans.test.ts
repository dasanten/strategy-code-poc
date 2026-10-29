// The second half of `transfers.test.ts`’s caravans, apart so that the two run side by side.

import { owedBy } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { mulberry32, newResident } from './residents.js'
import { mara, ivo, setup, order, runUntil, eventsOf, carrier, rob } from './transfers.fixture.js'

describe('caravans carrying out transfers', () => {
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
