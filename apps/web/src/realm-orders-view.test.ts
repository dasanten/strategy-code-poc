import { describe, expect, it } from 'vitest'
import type { City } from '@csp/shared-types'
import {
  heldGoods,
  paramsPlace,
  realmRelocateChoices,
  realmTileOrders,
  relocateAt,
  storePlaceAt,
  townHallAt,
  type StoreSeen,
} from './realm-orders-view.js'

const seen = (more: Partial<StoreSeen> = {}): StoreSeen => ({
  buildings: [],
  vessels: [],
  carriages: [],
  ...more,
})

describe('the place on a tile to store at or fetch from', () => {
  it('is a finished storage anywhere on its footprint, with what it holds', () => {
    const storage = { id: 's1', kind: 'storage' as const, x: 4, y: 4, stock: { wood: 5 } }
    expect(storePlaceAt(seen({ buildings: [storage] }), 'me', 5, 5)).toEqual({
      id: 's1',
      name: 'storage',
      x: 5,
      y: 5,
      holds: { wood: 5 },
    })
  })

  it('is not a site of one', () => {
    const site = { id: 's1', kind: 'storage' as const, x: 4, y: 4, site: {} as never }
    expect(storePlaceAt(seen({ buildings: [site] }), 'me', 4, 4)).toBeUndefined()
  })

  it('is a carriage or boat of the realm, never another realm’s', () => {
    const carriages = [
      { id: 'k1', realmId: 'them', x: 2, y: 2, load: { food: 1 } },
      { id: 'k2', realmId: 'me', x: 3, y: 3 },
    ]
    expect(storePlaceAt(seen({ carriages }), 'me', 2, 2)).toBeUndefined()
    expect(storePlaceAt(seen({ carriages }), 'me', 3, 3)).toMatchObject({
      id: 'k2',
      name: 'carriage',
      holds: {},
    })
    const vessels = [{ id: 'b1', kind: 'boat' as const, realmId: 'me', x: 6, y: 6 }]
    expect(storePlaceAt(seen({ vessels }), 'me', 6, 6)).toMatchObject({ id: 'b1', name: 'boat' })
  })

  it('offers to fetch only the goods it holds', () => {
    expect([...heldGoods({ wood: 3, stone: 0, food: 1 })].sort()).toEqual(['food', 'wood'])
    expect(heldGoods({})).toEqual([])
  })
})

describe('the realm orders on a tile’s card', () => {
  const place = { id: 's1', name: 'storage', x: 0, y: 0, holds: { wood: 2 } }

  it('offers Walk here and Build here on a bare tile', () => {
    expect(realmTileOrders({ building: false, place: undefined }).map((o) => o.id)).toEqual([
      'walkHere',
      'buildHere',
    ])
  })

  it('offers no Build here where a building stands', () => {
    expect(realmTileOrders({ building: true, place: undefined }).map((o) => o.id)).toEqual([
      'walkHere',
    ])
  })

  it('offers Store here and Fetch from here at a storage, Fetch greyed while it holds nothing', () => {
    const orders = realmTileOrders({ building: true, place })
    expect(orders.map((o) => o.id)).toEqual(['walkHere', 'storeHere', 'fetchFrom'])
    expect(orders.every((o) => o.reason === undefined)).toBe(true)
    const empty = realmTileOrders({ building: true, place: { ...place, holds: {} } })
    expect(empty.find((o) => o.id === 'fetchFrom')?.reason).toBe('it holds nothing')
  })
})

describe('where the who-list measures from', () => {
  const cities = [
    { id: 'c1', name: 'Home', townHallId: 'h1' },
    { id: 'c2', name: 'Ashford', townHallId: 'h2' },
  ]
  const buildings = [
    { id: 'h1', x: 10, y: 10 },
    { id: 'h2', x: 30, y: 30 },
  ]

  it('is the town hall for an order with no target tile, and says so', () => {
    expect(townHallAt({ cities, buildings }, 'c1')).toEqual({ x: 10, y: 10, near: 'the town hall' })
    expect(townHallAt({ cities, buildings: [] }, 'c1')).toBeUndefined()
  })

  it('is the town hall of the city moved to for Relocate', () => {
    expect(relocateAt({ cities, buildings }, 'c2')).toEqual({
      x: 30,
      y: 30,
      near: 'the town hall of Ashford',
    })
  })

  it('is the first building, carriage or waypoint picked for a script’s param', () => {
    const places = {
      buildings: [{ id: 'b1', kind: 'storage' as const, x: 5, y: 6 }],
      carriages: [{ id: 'k1', x: 7, y: 8 }],
      waypoints: [{ id: 'w1', name: 'Ford', x: 1, y: 2 }],
    }
    expect(paramsPlace({ amount: 3, at: 'b1' }, places)).toEqual({
      x: 5,
      y: 6,
      near: 'the storage',
    })
    expect(paramsPlace({ cart: 'k1' }, places)).toEqual({ x: 7, y: 8, near: 'the carriage' })
    expect(paramsPlace({ to: 'w1' }, places)).toEqual({ x: 1, y: 2, near: 'Ford' })
    // A word of a choice param, or nothing picked: then the town hall.
    expect(paramsPlace({ find: 'iron' }, places)).toBeUndefined()
    expect(paramsPlace(undefined, places)).toBeUndefined()
  })
})

describe('the cities to relocate to from the realm bar', () => {
  const city = (id: string, name: string, realmId: string) =>
    ({ id, name, realmId, townHallId: `h-${id}` }) as City

  it('lists the realm’s cities by name, none refused before who moves is picked', () => {
    const cities = [city('c1', 'Home', 'me'), city('c2', 'Ashford', 'me'), city('c3', 'X', 'them')]
    const choices = realmRelocateChoices({ cities, buildings: [], residents: [] }, 'me')
    expect(choices.map((c) => c.name)).toEqual(['Ashford', 'Home'])
    expect(choices.every((c) => c.problem === undefined)).toBe(true)
  })

  it('has nowhere to go with only one city', () => {
    const cities = [city('c1', 'Home', 'me')]
    expect(realmRelocateChoices({ cities, buildings: [], residents: [] }, 'me')).toEqual([])
  })
})
