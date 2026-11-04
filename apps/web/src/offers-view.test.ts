import type { DirectOfferView, Good, Resident, SeenBuilding, SeenOffer } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  acceptPreview,
  carriedDetails,
  carriedLine,
  carriedPreview,
  directOffersSent,
  freeAtStorage,
  offerIsFor,
  offerPlace,
  offerStands,
  offerStoragesOf,
  offerTerms,
  outpostOfferStorages,
  ownStorages,
  postPreview,
  setAsideLine,
} from './offers-view.js'

const labels = new Proxy({} as Record<Good, string>, {
  get: (_t, g: string) => g[0]!.toUpperCase() + g.slice(1),
})

const offer = (terms: Partial<SeenOffer> = {}): SeenOffer => ({
  id: 'o1',
  realmId: 'r1',
  storageId: 's1',
  x: 6,
  y: 6,
  gives: 'wood',
  givesUnits: 10,
  wants: 'stone',
  wantsUnits: 5,
  times: 2,
  rate: 0.5,
  ...terms,
})

const storage = (terms: Partial<SeenBuilding> = {}): SeenBuilding => ({
  id: 's1',
  kind: 'storage',
  cityId: 'c1',
  x: 6,
  y: 6,
  ...terms,
})

const seen = (buildings: SeenBuilding[]) => ({
  cities: [
    { id: 'c1', realmId: 'r1' },
    { id: 'c2', realmId: 'r2' },
  ],
  buildings,
})

const trader = (carried: Resident['carried'] = {}) =>
  ({
    id: 't1',
    bornAt: -1e9,
    carried,
    stats: { strength: { base: 10, trained: 0 } },
  }) as unknown as Resident

describe('which storages show offers', () => {
  it('every finished storage of the Player’s own, another realm’s only with an offer', () => {
    const mine = storage()
    const site = storage({ id: 's2', site: { delivered: {}, work: 0 } })
    const house = storage({ id: 's3', kind: 'house' })
    const theirs = storage({ id: 's4', cityId: 'c2' })
    const theirsWithOne = storage({ id: 's5', cityId: 'c2', offers: [offer()] })
    const all = seen([mine, site, house, theirs, theirsWithOne])
    expect(offerStoragesOf({ id: 'c1' }, all, 'r1')).toEqual([mine])
    expect(offerStoragesOf({ id: 'c2' }, all, 'r1')).toEqual([theirsWithOne])
  })

  it('outpost storages likewise', () => {
    const mine = storage({ cityId: null, realmId: 'r1' })
    const theirs = storage({ id: 's2', cityId: null, realmId: 'r2' })
    const theirsWithOne = storage({ id: 's3', cityId: null, realmId: 'r2', offers: [offer()] })
    const city = storage({ id: 's4' })
    expect(outpostOfferStorages(seen([mine, theirs, theirsWithOne, city]), 'r1')).toEqual([
      mine,
      theirsWithOne,
    ])
  })
})

describe('offer lines', () => {
  it('says the terms and the rate', () => {
    expect(offerTerms(offer(), labels)).toBe('Gives 10 wood, wants 5 stone')
    expect(offerStands(offer(), labels)).toBe('2 times left, 0.5 stone for 1 wood')
    expect(offerStands(offer({ times: 1, rate: 1 / 3 }), labels)).toBe(
      'once more, 0.33 stone for 1 wood',
    )
  })

  it('adds up what is set aside', () => {
    expect(setAsideLine(storage(), labels)).toBeUndefined()
    expect(
      setAsideLine(
        storage({ offers: [offer(), offer({ id: 'o2', times: 1 }), offer({ gives: 'food' })] }),
        labels,
      ),
    ).toBe('Set aside for offers: 20 food, 30 wood')
  })
})

describe('carried direct offers', () => {
  const way = { fromCityId: 'c1', toCityId: 'c2' }
  const known = { ...way, senderTiles: 100, otherTiles: 120 }
  const goods = {
    gives: 'iron',
    givesUnits: 10,
    wants: 'stone',
    wantsUnits: 5,
    times: 2,
  } as const

  it('tells the whole terms, taken at once', () => {
    expect(carriedLine(offer(), labels)).toBe('Gives 20 wood, wants 10 stone, carried')
  })

  it('tells each side the way and what they pay', () => {
    const view = (feeBy: 'sender' | 'split') =>
      ({
        ...offer(),
        direct: {
          toId: 'r2',
          lapsesAt: 500,
          carried: { ...way, feeBy, senderFee: 30, otherFee: feeBy === 'split' ? 20 : 0 },
        },
        from: { realmId: 'r1', realm: 'Mara' },
        to: { realmId: 'r2', realm: 'Bo' },
        city: 'Oakford',
        toCity: 'Brook',
      }) as DirectOfferView
    expect(carriedDetails(view('sender'), 'r2')).toBe(
      'By caravan between Oakford and Brook, taking what is there up to what was agreed. Paid by the sender: 30 coins, for all of the goods.',
    )
    expect(carriedDetails(view('split'), 'r1')).toContain('Split: 30 coins from you, 20 from them')
    expect(carriedDetails(view('split'), 'r2')).toContain('Split: 20 coins from you, 30 from them')
  })

  it('shows the fee before sending, or why it can’t go', () => {
    const paid = carriedPreview(known, 'sender', goods, labels)
    expect(paid.canPost).toBe(true)
    expect(paid.text).toMatch(/^Gives 20 iron, wants 10 stone\. You pay \d+ coins, for all/)
    const split = carriedPreview(known, 'split', goods, labels)
    expect(split.text).toMatch(/You pay \d+ coins and they pay \d+, for all/)
    const load = carriedPreview(known, 'sender', { ...goods, times: 10_000 }, labels)
    expect(load).toEqual({ text: 'Each side’s goods must fit one carriage load.', canPost: false })
    expect(carriedPreview(undefined, 'sender', goods, labels)).toEqual({
      text: 'No Trade Org warehouse can send a caravan there.',
      canPost: false,
    })
  })
})

describe('direct offers', () => {
  const direct = { toId: 'r2', lapsesAt: 500 }

  it('says who an offer at a storage is for, to each who sees it', () => {
    expect(offerIsFor(offer(), 'r2')).toBeUndefined()
    expect(offerIsFor(offer({ direct }), 'r1')).toBe('A direct offer you sent')
    expect(offerIsFor(offer({ direct }), 'r2')).toBe('A direct offer to you')
    expect(offerIsFor(offer({ direct }), 'r3')).toBe('Only for another realm')
  })

  it('says where one stands, with its city when it has one', () => {
    expect(offerPlace({ x: 6, y: 6, city: 'Oakford' })).toBe('the storage at (6, 6) in Oakford')
    expect(offerPlace({ x: 6, y: 6, city: null })).toBe('the storage at (6, 6)')
  })

  it('finds what the realm sent, and its finished storages to send from', () => {
    const view = (fromId: string, toId: string) =>
      ({
        ...offer({ direct: { toId, lapsesAt: 500 } }),
        direct: { toId, lapsesAt: 500 },
        from: { realmId: fromId, realm: fromId },
        to: { realmId: toId, realm: toId },
        city: null,
      }) as DirectOfferView
    const mine = view('r1', 'r2')
    expect(directOffersSent([mine, view('r2', 'r1')], 'r1')).toEqual([mine])
    const cities = [
      { id: 'c1', realmId: 'r1' },
      { id: 'c2', realmId: 'r2' },
    ]
    const storage = (id: string, cityId: string, more = {}) =>
      ({ id, kind: 'storage', cityId, x: 1, y: 1, ...more }) as SeenBuilding
    const buildings = [
      storage('s1', 'c1'),
      storage('s2', 'c1', { site: { needed: {}, delivered: {} } }),
      storage('s3', 'c2'),
    ]
    expect(ownStorages({ cities, buildings }, 'r1').map((b) => b.id)).toEqual(['s1'])
  })
})

describe('posting', () => {
  const b = storage({ stock: { wood: 25 }, offers: [offer({ times: 1 })] })

  it('counts only what isn’t set aside yet', () => {
    expect(freeAtStorage(b)).toEqual({ wood: 15 })
    expect(postPreview(b, 'wood', 5, 'coins', 1, 9, labels)).toEqual({
      text: 'Sets aside 15 wood: gives 5 wood, wants 1 coins, 3 times over.',
      canPost: true,
    })
    expect(postPreview(b, 'wood', 15, 'coins', 1, 1, labels).text).toMatch(/, once\.$/)
  })

  it('says why it won’t go', () => {
    expect(postPreview(b, 'wood', 20, 'coins', 1, 1, labels)).toEqual({
      text: 'Not enough wood here not set aside.',
      canPost: false,
    })
    expect(postPreview(b, 'wood', 5, 'wood', 1, 1, labels).canPost).toBe(false)
    expect(postPreview(b, 'wood', 0, 'coins', 1, 1, labels).canPost).toBe(false)
  })
})

describe('accepting', () => {
  it('says what it moves and what cuts it', () => {
    const preview = (carried: Resident['carried'], wanted = 1, o = offer()) =>
      acceptPreview(o, trader(carried), undefined, wanted, 0, [], labels)
    expect(preview({ stone: 5 }).text).toBe('Takes 10 wood for 5 stone.')
    expect(preview({ stone: 7 }, 2).text).toBe(
      'Takes 10 wood for 5 stone (not enough stone to pay).',
    )
    expect(preview({}).text).toBe('Won’t go: not enough stone to pay.')
    expect(preview({}, 1, offer({ wants: 'coins' })).text).toBe(
      'Won’t go: not enough coins to pay.',
    )
    expect(preview({ stone: 10 }, 5).text).toMatch(/it stands no more times than that/)
    expect(preview({ stone: 10 }, 5).quote.times).toBe(2)
  })
})
