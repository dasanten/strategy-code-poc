import {
  DIRECT_OFFERS_TO_ONE_REALM,
  DIRECT_OFFER_DAYS,
  GOOD_WEIGHT,
  TICKS_PER_GAME_DAY,
  directOfferProblem,
  freeStock,
  nearestWarehouse,
  quoteOffer,
  transferFee,
  transferLoad,
  transferLoads,
  transferLoadsFee,
  transferTiles,
  type RealmEvent,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { demandsSound } from './demands.js'
import { hqFalls } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { offersKeepGoods, offersSound, stepOffers } from './offers.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { eventsOf, ivo, mara, order, runUntil, setup, total } from './transfers.fixture.js'

/** A grown resident of `owner` on a tile, with nothing in hand. */
function stand(world: WorldState, id: string, owner: string, at: { x: number; y: number }) {
  const r = newResident(mulberry32(world.residents.length + 31), {
    id,
    owner,
    cityId: null,
    x: at.x,
    y: at.y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.carried = {}
  world.residents.push(r)
  return r
}

/**
 * Mara has demanded goods of Ivo, whose storage holds them, and he has someone at her storage, so he
 * sees where to send them. The demand is `d1`.
 */
function demanded(goods: Partial<Record<'food' | 'iron' | 'coins' | 'stone', number>>) {
  const s = setup()
  s.world.demands.push({
    id: 'd1',
    fromId: s.realm.id,
    toId: s.other.id,
    terms: { kind: 'goods', goods },
    note: 'Pay what you owe.',
    sentAt: 0,
    deadline: 10 * TICKS_PER_GAME_DAY,
  })
  s.toStorage.stock = { food: 40, iron: 40, stone: 40, coins: 3_000 }
  stand(s.world, 'scout', s.other.id, s.storage)
  return s
}
type Setup = ReturnType<typeof demanded>

/** Ivo's answer to the demand, applied, and what it says. */
function accept(s: Setup, handOver?: object, demandId = 'd1') {
  const answer = s.queue.receive(s.world, ivo, 'a', { kind: 'acceptDemand', demandId, handOver })
  s.queue.applyAll(s.world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const setAside = (s: Setup) => ({ way: 'setAside', storageId: s.toStorage.id })
const byTransfer = (s: Setup) => ({
  way: 'transfer',
  fromCityId: s.toCity.id,
  toCityId: s.city.id,
})

/** The demand's log lines, Ivo's and Mara's. */
const told = (world: WorldState, userId: number) =>
  world.events.filter(
    (e): e is Extract<RealmEvent, { kind: 'demand' }> => e.userId === userId && e.kind === 'demand',
  )

describe('accepting a demand for goods: set aside', () => {
  it('sets each good aside at the storage picked, for the sender, and answers the demand', () => {
    const s = demanded({ food: 5, coins: 20 })
    expect(accept(s, setAside(s))).toBe('ack')
    expect(s.world.demands).toEqual([])
    expect(s.world.offers.map((o) => [o.gives, o.times, o.givesUnits, o.wantsUnits])).toEqual([
      ['food', 5, 1, 0],
      ['coins', 20, 1, 0],
    ])
    for (const o of s.world.offers) {
      expect(o).toMatchObject({
        realmId: s.other.id,
        storageId: s.toStorage.id,
        direct: {
          toId: s.realm.id,
          lapsesAt: s.world.tick + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY,
        },
      })
    }
    // Still in the storage, but no longer free for anyone else to use.
    expect(s.toStorage.stock!.food).toBe(40)
    expect(freeStock(s.world, s.toStorage).food).toBe(35)
    const handedOver = {
      way: 'setAside',
      goods: { food: 5, coins: 20 },
      x: s.toStorage.x,
      y: s.toStorage.y,
    }
    expect(told(s.world, mara.userId).at(-1)).toMatchObject({ what: 'accepted', handedOver })
    expect(told(s.world, ivo.userId).at(-1)).toMatchObject({ what: 'accepted', handedOver })
    expect(checkInvariants(s.world, s.terrain, [offersSound, demandsSound])).toEqual([])
  })

  it('is fetched by the sender alone, wanting nothing back, and changes no standing', () => {
    const s = demanded({ iron: 4 })
    accept(s, setAside(s))
    const offerId = s.world.offers[0]!.id
    const third = foundStartingCity(s.world, s.terrain, 9)
    stand(s.world, 'stranger', third.id, s.toStorage)
    stand(s.world, 'own', s.other.id, s.toStorage)
    const fetcher = stand(s.world, 'fetcher', s.realm.id, s.toStorage)
    const accepting = { kind: 'acceptOffer', offerId, times: 4 }
    const wren = { userId: 9, account: { name: 'Wren', isAdmin: false } }
    const refused = (from: typeof mara, residentId: string) =>
      s.queue.receive(s.world, from, 'q', { ...accepting, residentId })
    expect(refused(wren, 'stranger')).toMatchObject({
      type: 'rejected',
      reason: 'that offer is for another realm',
    })
    expect(refused(ivo, 'own')).toMatchObject({
      type: 'rejected',
      reason: 'that offer is your own',
    })
    const iron = total(s.world, 'iron')
    const standings = structuredClone(s.world.standings)
    expect(order(s.world, s.queue, { ...accepting, residentId: 'fetcher' })).toBe('ack')
    runUntil(s.world, s.terrain, () => s.world.offers.length === 0, 5)
    expect(fetcher.carried.iron).toBe(4)
    expect(fetcher.carried.coins).toBeUndefined()
    expect(s.toStorage.stock!.iron).toBe(36)
    expect(total(s.world, 'iron')).toBe(iron)
    expect(s.world.standings).toEqual(standings)
    expect(eventsOf(s.world, 'offerAccepted', mara.userId)[0]).toMatchObject({
      givesUnits: 4,
      wantsUnits: 0,
      times: 4,
    })
    expect(eventsOf(s.world, 'offerTaken', ivo.userId)[0]).toMatchObject({ givesUnits: 4 })
    expect(checkInvariants(s.world, s.terrain, [offersKeepGoods])).toEqual([])
  })

  it('can be fetched over several trips, as much as the hands hold', () => {
    const s = demanded({ iron: 40 })
    accept(s, setAside(s))
    const offer = s.world.offers[0]!
    const fetcher: Resident = stand(s.world, 'fetcher', s.realm.id, s.toStorage)
    expect(
      order(s.world, s.queue, {
        kind: 'acceptOffer',
        offerId: offer.id,
        times: 40,
        residentId: fetcher.id,
      }),
    ).toBe('ack')
    runUntil(s.world, s.terrain, () => (fetcher.carried.iron ?? 0) > 0, 5)
    const took = fetcher.carried.iron!
    expect(took).toBeLessThan(40)
    expect(s.world.offers[0]!.times).toBe(40 - took)
  })

  it('sets aside only what the storage holds when it is short', () => {
    const s = demanded({ food: 50, iron: 5, stone: 3 })
    s.toStorage.stock = { food: 12.5, iron: 5 }
    expect(accept(s, setAside(s))).toBe('ack')
    expect(s.world.offers.map((o) => [o.gives, o.times])).toEqual([
      ['food', 12],
      ['iron', 5],
    ])
    expect(told(s.world, mara.userId).at(-1)?.handedOver?.goods).toEqual({ food: 12, iron: 5 })
    expect(told(s.world, mara.userId).at(-1)?.terms).toMatchObject({
      goods: { food: 50, iron: 5, stone: 3 },
    })
    expect(checkInvariants(s.world, s.terrain, [offersSound])).toEqual([])
  })

  it('counts goods already set aside as not there', () => {
    const s = demanded({ food: 50 })
    s.toStorage.stock = { food: 10 }
    s.world.offers.push({
      id: 'held',
      realmId: s.other.id,
      storageId: s.toStorage.id,
      x: s.toStorage.x,
      y: s.toStorage.y,
      gives: 'food',
      givesUnits: 1,
      wants: 'coins',
      wantsUnits: 1,
      times: 10,
    })
    expect(accept(s, setAside(s))).toMatch(/holds none of it/)
    expect(s.world.demands).toHaveLength(1)
  })

  it('is refused with none of it there, and the demand stays to decline', () => {
    const s = demanded({ food: 5 })
    s.toStorage.stock = { iron: 5 }
    expect(accept(s, setAside(s))).toMatch(/holds none of it/)
    expect(s.world.demands).toHaveLength(1)
    expect(told(s.world, ivo.userId)).toEqual([])
  })

  it('takes the storage’s goods for the first of two demands accepted in one tick', () => {
    const s = demanded({ food: 8 })
    s.toStorage.stock = { food: 8 }
    s.world.demands.push({ ...s.world.demands[0]!, id: 'd2' })
    s.queue.receive(s.world, ivo, 'a', {
      kind: 'acceptDemand',
      demandId: 'd1',
      handOver: setAside(s),
    })
    s.queue.receive(s.world, ivo, 'b', {
      kind: 'acceptDemand',
      demandId: 'd2',
      handOver: setAside(s),
    })
    s.queue.applyAll(s.world)
    expect(s.world.offers).toHaveLength(1)
    expect(s.world.demands.map((d) => d.id)).toEqual(['d2'])
    expect(checkInvariants(s.world, s.terrain, [offersSound])).toEqual([])
  })

  it('needs a way, at a finished storage of their own', () => {
    const s = demanded({ food: 5 })
    expect(accept(s)).toMatch(/set the goods aside/)
    expect(accept(s, { way: 'throw' })).toMatch(/set the goods aside/)
    expect(accept(s, { way: 'setAside', storageId: s.storage.id })).toMatch(/not a finished/)
    expect(accept(s, { way: 'setAside', storageId: 'nowhere' })).toMatch(/not a finished/)
    expect(s.world.demands).toHaveLength(1)
    expect(s.world.offers).toEqual([])
  })

  it('takes no slot of the Direct offers that can stand to one realm', () => {
    const s = demanded({ food: 1, iron: 1, stone: 1, coins: 1 })
    accept(s, setAside(s))
    s.world.offers.push(
      ...Array.from({ length: DIRECT_OFFERS_TO_ONE_REALM - 1 }, (_, i) => ({
        ...s.world.offers[0]!,
        id: `sent${i}`,
        wantsUnits: 1,
      })),
    )
    const terms = {
      storageId: s.toStorage.id,
      gives: 'stone',
      givesUnits: 1,
      wants: 'iron',
      wantsUnits: 1,
      times: 1,
    }
    expect(directOfferProblem(s.world, s.other.id, s.realm.id, terms)).toBeUndefined()
  })

  it('goes back to ordinary goods when the sender declines it or it lapses, and both hear', () => {
    const s = demanded({ food: 5, iron: 2 })
    accept(s, setAside(s))
    const [food, iron] = s.world.offers
    expect(order(s.world, s.queue, { kind: 'declineOffer', offerId: food!.id })).toBe('ack')
    expect(freeStock(s.world, s.toStorage).food).toBe(40)
    expect(eventsOf(s.world, 'offerEnded', ivo.userId).map((e) => e.why)).toEqual(['declined'])
    s.world.tick = iron!.direct!.lapsesAt
    stepOffers(s.world)
    expect(s.world.offers).toEqual([])
    expect(freeStock(s.world, s.toStorage).iron).toBe(40)
    expect(eventsOf(s.world, 'directOffer', mara.userId).map((e) => e.what)).toEqual([
      'declined',
      'lapsed',
    ])
  })

  it('is cut down with what goes from the storage, as any offer is', () => {
    const s = demanded({ iron: 10 })
    accept(s, setAside(s))
    s.toStorage.stock!.iron = 4
    stepOffers(s.world)
    expect(s.world.offers[0]!.times).toBe(4)
    expect(checkInvariants(s.world, s.terrain, [offersSound])).toEqual([])
  })
})

describe('accepting a demand for goods: by Transfer', () => {
  it('orders a Transfer for each good that the one accepting pays for', () => {
    const s = demanded({ iron: 10, food: 5 })
    expect(accept(s, byTransfer(s))).toBe('ack')
    expect(s.world.demands).toEqual([])
    expect(s.world.offers).toEqual([])
    expect(
      s.world.transfers.map((t) => [
        t.realmId,
        t.toRealmId,
        t.fromCityId,
        t.toCityId,
        t.good,
        t.units,
      ]),
    ).toEqual([
      [s.other.id, s.realm.id, s.toCity.id, s.city.id, 'food', 5],
      [s.other.id, s.realm.id, s.toCity.id, s.city.id, 'iron', 10],
    ])
    expect(told(s.world, mara.userId).at(-1)).toMatchObject({
      what: 'accepted',
      handedOver: {
        way: 'transfer',
        goods: { food: 5, iron: 10 },
        fromCity: s.toCity.name,
        toCity: s.city.name,
      },
    })
    expect(eventsOf(s.world, 'transferOrdered', ivo.userId)).toHaveLength(2)
  })

  it('brings them to the sender’s storage by caravan, the fee out of the one accepting', () => {
    const s = demanded({ iron: 10 })
    const tiles = transferTiles(
      s.terrain.size,
      nearestWarehouse(s.world, s.toStorage, s.terrain.size)!,
      s.toStorage,
      s.storage,
    )
    const iron = s.storage.stock!.iron ?? 0
    const coins = s.toStorage.stock!.coins!
    const herCoins = s.storage.stock!.coins!
    expect(accept(s, byTransfer(s))).toBe('ack')
    runUntil(s.world, s.terrain, () => s.world.transfers.length === 0)
    expect(s.storage.stock!.iron).toBe(iron + 10)
    expect(s.toStorage.stock!.iron).toBeLessThanOrEqual(30)
    const fee = transferFee(10 * GOOD_WEIGHT.iron, tiles)
    expect(transferLoadsFee({ iron: 10 }, tiles)).toBe(fee)
    expect(s.toStorage.stock!.coins).toBeLessThanOrEqual(coins - fee)
    expect(s.storage.stock!.coins).toBeGreaterThanOrEqual(herCoins - 1)
    expect(eventsOf(s.world, 'transferred', mara.userId)[0]).toMatchObject({ units: 10, fee })
  })

  it('takes more than one load as several Transfers', () => {
    const load = transferLoad('iron')
    const s = demanded({ iron: load + 3 })
    s.toStorage.stock!.iron = load + 3
    expect(transferLoads({ iron: load + 3 })).toEqual([
      { good: 'iron', units: load },
      { good: 'iron', units: 3 },
    ])
    expect(accept(s, byTransfer(s))).toBe('ack')
    expect(s.world.transfers.map((t) => t.units)).toEqual([load, 3])
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('sends only what the storage holds, and none of it is refused', () => {
    const s = demanded({ iron: 10, stone: 3 })
    s.toStorage.stock = { iron: 4, coins: 500 }
    expect(accept(s, byTransfer(s))).toBe('ack')
    expect(s.world.transfers.map((t) => [t.good, t.units])).toEqual([['iron', 4]])
    const none = demanded({ stone: 3 })
    none.toStorage.stock = { coins: 500 }
    expect(accept(none, byTransfer(none))).toMatch(/holds none of it/)
    expect(none.world.demands).toHaveLength(1)
  })

  it('goes only from a city of theirs to a city of the sender’s whose storage they see', () => {
    const s = demanded({ iron: 1 })
    const away = { way: 'transfer', toCityId: s.city.id }
    expect(accept(s, { ...away, fromCityId: s.city.id })).toMatch(/not one of your cities/)
    expect(accept(s, { ...byTransfer(s), toCityId: s.toCity.id })).toMatch(/city of theirs/)
    s.world.residents = s.world.residents.filter((r) => r.id !== 'scout')
    expect(accept(s, byTransfer(s))).toMatch(/don’t see/)
    expect(s.world.demands).toHaveLength(1)
    expect(s.world.transfers).toEqual([])
  })

  it('is out of the question once the HQ has fallen', () => {
    const s = demanded({ iron: 1 })
    hqFalls(
      s.world,
      s.world.cities.find((c) => c.tradeOrg === 'hq')!,
    )
    expect(accept(s, byTransfer(s))).toMatch(/caravans/i)
    expect(accept(s, setAside(s))).toBe('ack')
  })
})

describe('an offer that wants nothing', () => {
  const offer = { gives: 'iron', givesUnits: 1, wants: 'coins', wantsUnits: 0, times: 8 } as const

  it('asks for nothing to pay with, and is cut only by what fits', () => {
    expect(quoteOffer(offer, { stock: {}, room: 1_000 }, 8)).toEqual({
      times: 8,
      gives: 8,
      wants: 0,
    })
    expect(quoteOffer(offer, { stock: {}, room: 3 * GOOD_WEIGHT.iron }, 8)).toMatchObject({
      times: 3,
      limit: 'room',
    })
  })

  it('is sound only as a Direct offer', () => {
    const s = demanded({ iron: 8 })
    accept(s, setAside(s))
    expect(checkInvariants(s.world, s.terrain, [offersSound])).toEqual([])
    delete s.world.offers[0]!.direct
    expect(checkInvariants(s.world, s.terrain, [offersSound])[0]?.message).toMatch(
      /aren’t whole and positive/,
    )
  })
})
