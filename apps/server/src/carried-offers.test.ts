import {
  GOOD_WEIGHT,
  carriedFeesOver,
  carriedOfferFees,
  carriedWaysFor,
  carriedUnloadShares,
  deliveryStorage,
  feeAtPickUp,
  freeStock,
  nearestWarehouse,
  offerOpenTo,
  offersAt,
  quoteTransfer,
  transferFee,
  transferLoad,
  transferTiles,
  type CarriedFeeBy,
  type Offer,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { hqFalls } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { offersSound, stepOffers } from './offers.js'
import type { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { collectsTransferFrom, transfersSound } from './transfers.js'
import { ivo, mara, order, eventsOf, runUntil, setup, total } from './transfers.fixture.js'
import { stillTradeOrgChain } from './test-terrain.js'

/** Mara's resident stands on Ivo's storage, so she sees it and knows of his realm. */
function carriedSetup() {
  const s = setup()
  const watcher = newResident(mulberry32(23), {
    id: 'watcher',
    owner: s.realm.id,
    cityId: s.city.id,
    x: s.toStorage.x,
    y: s.toStorage.y,
    tick: 0,
  })
  watcher.bornAt = -20 * 24 * 3600
  s.world.residents.push(watcher)
  s.storage.stock!.iron = 40
  s.toStorage.stock!.stone = 40
  s.toStorage.stock!.coins = 2_000
  return s
}

type Setup = ReturnType<typeof carriedSetup>

const terms = { gives: 'iron', givesUnits: 25, wants: 'stone', wantsUnits: 10, times: 1 }

/** What Mara's send order says, with the terms overridden by `over`. */
function send(s: Setup, feeBy: CarriedFeeBy | string = 'sender', over: object = {}) {
  return order(s.world, s.queue, {
    kind: 'sendCarriedOffer',
    toId: s.other.id,
    ...terms,
    fromCityId: s.city.id,
    toCityId: s.toCity.id,
    feeBy,
    ...over,
  })
}

/** Ivo's order, applied, and what it answers. */
function asIvo(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, ivo, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Mara's carried offer, sent and accepted by Ivo. */
function accepted(s: Setup, feeBy: CarriedFeeBy) {
  expect(send(s, feeBy)).toBe('ack')
  const offerId = s.world.offers[0]!.id
  expect(asIvo(s.world, s.queue, { kind: 'acceptCarriedOffer', offerId })).toBe('ack')
}

/** What each Transfer's fee comes to, both coming from the warehouse nearest its pick-up. */
function fullFees({ world, terrain, storage, toStorage }: Setup) {
  const size = terrain.size
  const near = nearestWarehouse(world, storage, size)!
  const toNear = nearestWarehouse(world, toStorage, size)!
  return {
    iron: transferFee(25 * GOOD_WEIGHT.iron, transferTiles(size, near, storage, toStorage)),
    stone: transferFee(10 * GOOD_WEIGHT.stone, transferTiles(size, toNear, toStorage, storage)),
  }
}

describe('a carried direct offer’s fee', () => {
  it('takes the pick-up’s part at the pick-up, and rounds what is due on unloading up', () => {
    expect(feeAtPickUp(101)).toBe(101)
    expect(feeAtPickUp(101, 0.5)).toBe(50)
    expect(feeAtPickUp(101, 1)).toBe(0)
    expect(carriedUnloadShares('sender')).toEqual({ sender: 0, other: 1 })
    expect(carriedUnloadShares('split')).toEqual({ sender: 0.5, other: 0.5 })
  })

  it('counts only what is taken at the pick-up against the coins held', () => {
    const whole = transferFee(25, 160)
    expect(quoteTransfer({ iron: 25 }, 'iron', 25, 160, 1)).toEqual({ units: 25, fee: whole })
    const half = { iron: 25, coins: feeAtPickUp(whole, 0.5) }
    expect(quoteTransfer(half, 'iron', 25, 160, 0.5)).toEqual({ units: 25, fee: whole })
    expect(quoteTransfer(half, 'iron', 25, 160).units).toBeLessThan(25)
  })

  it('is all the sender’s when they pay, and half of both each when split', () => {
    const s = carriedSetup()
    const { iron, stone } = fullFees(s)
    const cities = { fromCityId: s.city.id, toCityId: s.toCity.id }
    const goods = { ...terms, gives: 'iron', wants: 'stone' } as const
    const size = s.terrain.size
    expect(carriedOfferFees(s.world, size, { ...cities, feeBy: 'sender' }, goods)).toEqual({
      senderFee: iron + stone,
      otherFee: 0,
    })
    const split = carriedOfferFees(s.world, size, { ...cities, feeBy: 'split' }, goods)!
    expect(split.senderFee + split.otherFee).toBe(iron + stone)
    expect(Math.abs(split.senderFee - split.otherFee)).toBeLessThanOrEqual(1)
  })
})

describe('the ways a realm can name for a carried direct offer', () => {
  it('give the fee exactly, with no warehouse in sight and only to storages it sees', () => {
    const s = carriedSetup()
    const size = s.terrain.size
    const seen = [{ cityId: s.toCity.id }, { cityId: s.city.id }, { cityId: null }]
    const ways = carriedWaysFor(s.world, size, s.realm.id, seen)
    expect(ways.map((w) => [w.fromCityId, w.toCityId])).toEqual([[s.city.id, s.toCity.id]])
    expect(carriedWaysFor(s.world, size, s.realm.id, [{ cityId: s.city.id }])).toEqual([])
    const sent = { ...terms, gives: 'iron', wants: 'stone' } as const
    const cities = { fromCityId: s.city.id, toCityId: s.toCity.id, feeBy: 'split' } as const
    expect(carriedFeesOver(ways[0]!, 'split', sent)).toEqual(
      carriedOfferFees(s.world, size, cities, sent),
    )
    hqFalls(
      s.world,
      s.world.cities.find((c) => c.tradeOrg === 'hq')!,
    )
    expect(carriedWaysFor(s.world, size, s.realm.id, seen)).toEqual([])
  })
})

describe('sending a carried direct offer', () => {
  it('sets nothing aside and stands at no storage, with the fee told to the other side', () => {
    const s = carriedSetup()
    const { iron, stone } = fullFees(s)
    expect(send(s)).toBe('ack')
    const offer = s.world.offers[0]!
    expect(offer.direct?.carried).toEqual({
      fromCityId: s.city.id,
      toCityId: s.toCity.id,
      feeBy: 'sender',
      senderFee: iron + stone,
      otherFee: 0,
    })
    expect(freeStock(s.world, s.storage).iron).toBe(40)
    expect(offersAt(s.world, s.storage.id)).toEqual([])
    expect(offerOpenTo(offer, s.other.id)).toBe(false)
    expect(eventsOf(s.world, 'directOffer', ivo.userId)).toEqual([
      expect.objectContaining({
        what: 'received',
        carried: { fromCity: s.city.name, toCity: s.toCity.name, fee: 0 },
      }),
    ])
  })

  it('needs no goods there yet', () => {
    const s = carriedSetup()
    delete s.storage.stock!.iron
    expect(send(s)).toBe('ack')
  })

  it('refuses a fee nobody pays, too much for a load, or a city that isn’t the side’s', () => {
    const s = carriedSetup()
    expect(send(s, 'other')).toBe('the fee is paid by the sender or split')
    const tooMany = { givesUnits: transferLoad('iron') + 1 }
    expect(send(s, 'sender', tooMany)).toBe('more than one carriage load')
    expect(send(s, 'sender', { times: 1_000 })).toBe('more than one carriage load')
    const own = { toCityId: s.city.id }
    expect(send(s, 'sender', own)).toBe('the goods go to a city of the realm it is sent to')
    const theirs = { fromCityId: s.toCity.id }
    expect(send(s, 'sender', theirs)).toBe('the goods are picked up at a city of the sender')
    expect(send(s, 'sender', { gives: 'stone' })).toBe(
      'an offer wants a different good than it gives',
    )
    expect(s.world.offers).toEqual([])
  })

  it('refuses a city whose storage the sender doesn’t see', () => {
    const s = carriedSetup()
    // Known by a standing alone, the watcher gone.
    s.world.residents = s.world.residents.filter((r) => r.id !== 'watcher')
    s.world.standings.push({ of: s.realm.id, toward: s.other.id, value: 1 })
    expect(send(s)).toBe('you don’t see that city’s storage')
  })

  it('isn’t offered once the HQ has fallen, or by a realm the Trade Org refuses', () => {
    const refused = carriedSetup()
    changeStanding(refused.world, 'trade-org', refused.realm.id, -100)
    expect(send(refused)).toBe('the Trade Organization won’t carry for you')
    const them = carriedSetup()
    changeStanding(them.world, 'trade-org', them.other.id, -100)
    expect(send(them)).toBe('the Trade Organization won’t carry for them')
    const fallen = carriedSetup()
    hqFalls(
      fallen.world,
      fallen.world.cities.find((c) => c.tradeOrg === 'hq')!,
    )
    expect(send(fallen)).toMatch(/no caravans/i)
  })
})

describe('answering a carried direct offer', () => {
  it('becomes two Transfers on accepting, from anywhere, with no change in standing', () => {
    const s = carriedSetup()
    const standings = [...s.world.standings]
    accepted(s, 'sender')
    const near = nearestWarehouse(s.world, s.storage, s.terrain.size)!.id
    const toNear = nearestWarehouse(s.world, s.toStorage, s.terrain.size)!.id
    expect(s.world.offers).toEqual([])
    expect(s.world.transfers).toEqual([
      expect.objectContaining({
        realmId: s.realm.id,
        toRealmId: s.other.id,
        fromCityId: s.city.id,
        toCityId: s.toCity.id,
        warehouseId: near,
        good: 'iron',
        units: 25,
        carriedOffer: { unloadShare: 0, due: 0 },
      }),
      expect.objectContaining({
        realmId: s.other.id,
        toRealmId: s.realm.id,
        fromCityId: s.toCity.id,
        toCityId: s.city.id,
        warehouseId: toNear,
        good: 'stone',
        units: 10,
        carriedOffer: { unloadShare: 1, due: 0 },
      }),
    ])
    expect(s.world.standings).toEqual(standings)
    expect(eventsOf(s.world, 'directOffer', mara.userId).at(-1)).toMatchObject({
      what: 'carriedAccepted',
    })
    expect(eventsOf(s.world, 'directOffer', ivo.userId).at(-1)).toMatchObject({
      what: 'youAccepted',
      carried: { fee: 0 },
    })
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('takes it whole, times over', () => {
    const s = carriedSetup()
    expect(send(s, 'split', { givesUnits: 5, wantsUnits: 2, times: 5 })).toBe('ack')
    const offerId = s.world.offers[0]!.id
    expect(asIvo(s.world, s.queue, { kind: 'acceptCarriedOffer', offerId })).toBe('ack')
    expect(s.world.transfers.map((t) => t.units)).toEqual([25, 10])
    expect(s.world.transfers.map((t) => t.carriedOffer?.unloadShare)).toEqual([0.5, 0.5])
  })

  it('takes only the realm it was sent to, and only this way', () => {
    const s = carriedSetup()
    send(s)
    const offerId = s.world.offers[0]!.id
    expect(order(s.world, s.queue, { kind: 'acceptCarriedOffer', offerId })).toBe(
      'that offer wasn’t sent to you',
    )
    const trader = newResident(mulberry32(29), {
      id: 'trader',
      owner: s.other.id,
      cityId: s.toCity.id,
      x: s.storage.x,
      y: s.storage.y,
      tick: 0,
    })
    trader.bornAt = -20 * 24 * 3600
    trader.carried = { stone: 10 }
    s.world.residents.push(trader)
    expect(
      asIvo(s.world, s.queue, { kind: 'acceptOffer', residentId: 'trader', offerId, times: 1 }),
    ).toBe('a carried offer is accepted from anywhere')
    expect(asIvo(s.world, s.queue, { kind: 'acceptCarriedOffer', offerId: 'nope' })).toBe(
      'that offer is gone',
    )
  })

  it('declined, it ends and both are told, nothing having been set aside', () => {
    const s = carriedSetup()
    send(s)
    const offerId = s.world.offers[0]!.id
    expect(asIvo(s.world, s.queue, { kind: 'declineOffer', offerId })).toBe('ack')
    expect(s.world.offers).toEqual([])
    expect(s.world.transfers).toEqual([])
    expect(eventsOf(s.world, 'offerEnded', mara.userId)).toEqual([
      expect.objectContaining({ why: 'declined', carried: true }),
    ])
  })
})

describe('a carried direct offer standing', () => {
  it('isn’t cut down by goods leaving the storage', () => {
    const s = carriedSetup()
    send(s)
    delete s.storage.stock!.iron
    stepOffers(s.world)
    expect(s.world.offers).toHaveLength(1)
    expect(offersSound.check(s.world, s.terrain)).toEqual([])
  })

  it('lapses at its time', () => {
    const s = carriedSetup()
    send(s)
    s.world.tick = s.world.offers[0]!.direct!.lapsesAt
    stepOffers(s.world)
    expect(s.world.offers).toEqual([])
    expect(eventsOf(s.world, 'offerEnded', mara.userId)[0]).toMatchObject({ why: 'lapsed' })
  })

  it('ends when either city is no longer its side’s', () => {
    for (const lost of ['city', 'toCity'] as const) {
      const s = carriedSetup()
      send(s)
      s.world.residents.push(
        newResident(mulberry32(3), { id: 'q1', owner: 'realm3', x: 5, y: 5, tick: 0 }),
      )
      s.world.realms.push({ id: 'realm3', userId: 9, leaderId: 'q1' })
      s[lost].realmId = 'realm3'
      stepOffers(s.world)
      expect(s.world.offers).toEqual([])
      expect(eventsOf(s.world, 'offerEnded', mara.userId)[0]).toMatchObject({ why: 'storageLost' })
    }
  })

  it('is cancelled when the HQ falls, and its accepted Transfers with it', () => {
    const s = carriedSetup()
    send(s)
    send(s, 'split')
    const offerId = s.world.offers[0]!.id
    asIvo(s.world, s.queue, { kind: 'acceptCarriedOffer', offerId })
    expect(s.world.transfers).toHaveLength(2)
    hqFalls(
      s.world,
      s.world.cities.find((c) => c.tradeOrg === 'hq')!,
    )
    stepOffers(s.world)
    expect(s.world.offers).toEqual([])
    expect(s.world.transfers).toEqual([])
    expect(eventsOf(s.world, 'offerEnded', mara.userId)).toEqual([
      expect.objectContaining({ why: 'noCaravans' }),
    ])
    expect(eventsOf(s.world, 'directOffer', ivo.userId).at(-1)).toMatchObject({
      what: 'noCaravans',
    })
    expect(eventsOf(s.world, 'orderEndedWithHq', mara.userId)).toHaveLength(1)
    expect(eventsOf(s.world, 'orderEndedWithHq', ivo.userId)).toHaveLength(1)
  })
})

describe('invariants of a carried direct offer', () => {
  /** An offer that stands, to spoil. */
  function standing(): { s: Setup; offer: Offer } {
    const s = carriedSetup()
    send(s)
    return { s, offer: s.world.offers[0]! }
  }

  const messages = (s: Setup) => offersSound.check(s.world, s.terrain).map((v) => v.message)

  it('hold for one sent', () => {
    expect(messages(standing().s)).toEqual([])
  })

  it('catch more than one load, or a fee that isn’t whole', () => {
    const { s, offer } = standing()
    offer.times = 10_000
    offer.direct!.carried!.senderFee = 1.5
    expect(messages(s)).toEqual([
      expect.stringContaining('gives more than one load'),
      expect.stringContaining('wants more than one load'),
      expect.stringContaining('fees that aren’t whole'),
    ])
  })

  it('catch one with the HQ fallen, or between cities not its sides’', () => {
    const { s } = standing()
    s.toCity.realmId = s.realm.id
    hqFalls(
      s.world,
      s.world.cities.find((c) => c.tradeOrg === 'hq')!,
    )
    expect(messages(s)).toEqual([
      expect.stringContaining('the HQ fallen'),
      expect.stringContaining('cities not its sides’'),
    ])
  })

  it('catch coins due that aren’t whole, or due on the way back', () => {
    const s = carriedSetup()
    accepted(s, 'split')
    const t = s.world.transfers[0]!
    t.carriedOffer!.due = 1.5
    expect(transfersSound.check(s.world, s.terrain)).toHaveLength(1)
    t.carriedOffer!.due = 3
    t.back = true
    expect(transfersSound.check(s.world, s.terrain)).toHaveLength(1)
  })
})

describe('the caravans of a carried direct offer', () => {
  /** Accepts Mara's offer and runs both Transfers out; answers what each storage paid in coins. */
  function runOut(s: Setup, feeBy: CarriedFeeBy) {
    stillTradeOrgChain(s.world)
    const coins = s.storage.stock!.coins ?? 0
    const toCoins = s.toStorage.stock!.coins ?? 0
    accepted(s, feeBy)
    runUntil(s.world, s.terrain, () => s.world.transfers.length === 0)
    return {
      sender: coins - (s.storage.stock!.coins ?? 0),
      other: toCoins - (s.toStorage.stock!.coins ?? 0),
    }
  }

  it(
    'carry both ways with the sender paying both fees, and no crime',
    { tags: ['slow'], timeout: 240_000 },
    () => {
      const s = carriedSetup()
      const { iron, stone } = fullFees(s)
      const before = {
        iron: s.toStorage.stock!.iron ?? 0,
        stone: s.storage.stock!.stone ?? 0,
        toIron: total(s.world, 'iron'),
      }
      const paid = runOut(s, 'sender')
      expect(s.toStorage.stock!.iron).toBe(before.iron + 25)
      expect(s.storage.stock!.stone).toBe(before.stone + 10)
      expect(s.storage.stock!.iron).toBe(15)
      expect(s.toStorage.stock!.stone).toBe(30)
      expect(paid).toEqual({ sender: iron + stone, other: 0 })
      expect(total(s.world, 'iron')).toBe(before.toIron)
      expect(s.world.crimes).toEqual([])
      expect(
        eventsOf(s.world, 'transferred', mara.userId)
          .map((e) => e.fee)
          .sort(),
      ).toEqual([iron, stone].sort())
    },
  )

  it('carry both ways with the fee split', { tags: ['slow'], timeout: 240_000 }, () => {
    const s = carriedSetup()
    const { iron, stone } = fullFees(s)
    const paid = runOut(s, 'split')
    expect(paid.sender + paid.other).toBe(iron + stone)
    expect(paid.sender).toBe(feeAtPickUp(iron, 0.5) + Math.ceil(stone * 0.5))
    expect(paid.other).toBe(feeAtPickUp(stone, 0.5) + Math.ceil(iron * 0.5))
    expect(s.world.crimes).toEqual([])
  })

  it(
    'take what is there of goods short, with a fee for what they take',
    { tags: ['slow'], timeout: 240_000 },
    () => {
      const s = carriedSetup()
      s.storage.stock!.iron = 6
      delete s.toStorage.stock!.stone
      const near = nearestWarehouse(s.world, s.storage, s.terrain.size)!
      const fee = transferFee(
        6 * GOOD_WEIGHT.iron,
        transferTiles(s.terrain.size, near, s.storage, s.toStorage),
      )
      const before = s.toStorage.stock!.iron ?? 0
      const paid = runOut(s, 'split')
      expect(s.toStorage.stock!.iron).toBe(before + 6)
      expect(paid.sender + paid.other).toBe(fee)
      expect(eventsOf(s.world, 'transferStuck', ivo.userId)).toEqual([
        expect.objectContaining({ why: 'nothing', good: 'stone' }),
      ])
      expect(eventsOf(s.world, 'transferStuck', mara.userId)).toEqual([
        expect.objectContaining({ why: 'nothingCame', good: 'stone' }),
      ])
    },
  )

  it(
    'leave the goods delivered when the storage they unload at is short of coins',
    { tags: ['slow'], timeout: 240_000 },
    () => {
      const s = carriedSetup()
      delete s.toStorage.stock!.coins
      const before = s.toStorage.stock!.iron ?? 0
      const { iron } = fullFees(s)
      stillTradeOrgChain(s.world)
      accepted(s, 'split')
      let collecting = false
      runUntil(s.world, s.terrain, () => {
        const c = s.world.caravans.find((x) => x.transfer?.step === 'unloadFee')
        const driver = c && s.world.residents.find((r) => r.id === c.driverId)
        collecting ||= !!driver && collectsTransferFrom(s.world, driver, s.toStorage.id)
        return s.world.transfers.length === 0
      })
      expect(collecting).toBe(true)
      // Ivo's own Transfer found no coins for its half, so took fewer goods or none; Mara's arrived.
      expect(s.toStorage.stock!.iron).toBe(before + 25)
      expect(s.toStorage.stock!.coins ?? 0).toBe(0)
      const mine = eventsOf(s.world, 'transferred', mara.userId).find((e) => e.good === 'iron')!
      expect(mine.fee).toBe(feeAtPickUp(iron, 0.5))
      expect(s.world.crimes).toEqual([])
    },
  )
})

describe('deliveryStorage of a carried offer', () => {
  it('is where the offer tells its place', () => {
    const s = carriedSetup()
    send(s)
    const offer = s.world.offers[0]!
    const storage = deliveryStorage(s.world, s.city.id)!
    expect(offer).toMatchObject({ storageId: storage.id, x: storage.x, y: storage.y })
  })
})
