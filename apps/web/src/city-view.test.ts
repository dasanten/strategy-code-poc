import {
  PRICED_GOODS,
  deliveryFee,
  priceFor,
  transferFee,
  transferTiles,
  WAREHOUSE_FLOOR,
  type Building,
  type City,
  type NpcCityPrice,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  buildingCount,
  describeBuying,
  describeCity,
  deliveryCities,
  npcStoragesInSight,
  previewDelivery,
  previewNpcTrade,
  previewTrade,
  previewTransfer,
  takesTransfers,
  tradersAt,
  warehousesInSight,
} from './city-view.js'

const city = (realmId: string | null): City => ({
  id: 'city1',
  name: 'Ashford',
  realmId,
  townHallId: 'b1',
})
const b = (id: string, kind: Building['kind'], cityId: string | null, site = false): Building => ({
  id,
  kind,
  cityId,
  x: 0,
  y: 0,
  ...(site ? { site: { delivered: {}, work: 0 } } : {}),
})
const resident = (cityId: string | null) => ({ cityId }) as Resident
const realms = [{ realmId: 'realm2', realm: 'Mara' }]

describe('city inspector', () => {
  it('says whose a city is', () => {
    const none = { residents: [], buildings: [] }
    expect(describeCity(city(null), none, 'realm1', realms).whose).toBe('NPC city')
    expect(describeCity({ ...city(null), tradeOrg: 'hq' }, none, 'realm1', realms).whose).toBe(
      'Trade Org HQ',
    )
    expect(describeCity(city('realm1'), none, 'realm1', realms).whose).toBe('Your city')
    expect(describeCity(city('realm2'), none, 'realm1', realms).whose).toBe(
      'City of the realm of Mara',
    )
    expect(describeCity(city('realm3'), none, 'realm1', realms).whose).toBe(
      'City of the realm of another Player',
    )
  })

  it('counts the residents and finished buildings in sight that belong to it', () => {
    const seen = {
      residents: [resident('city1'), resident('city1'), resident('city2'), resident(null)],
      buildings: [
        b('b1', 'townHall', 'city1'),
        b('b2', 'house', 'city1'),
        b('b3', 'house', 'city1'),
        b('b4', 'house', 'city1', true),
        b('b5', 'house', 'city2'),
      ],
    }
    expect(describeCity(city(null), seen, 'realm1', realms)).toEqual({
      id: 'city1',
      name: 'Ashford',
      whose: 'NPC city',
      residents: 2,
      buildings: [
        ['house', 2],
        ['townHall', 1],
      ],
    })
  })

  it('names building counts', () => {
    expect(buildingCount('house', 3)).toBe('3 houses')
    expect(buildingCount('townHall', 1)).toBe('1 town hall')
    expect(buildingCount('lumberCamp', 2)).toBe('2 lumber camps')
  })
})

describe('warehouse prices in sight', () => {
  it('lists each warehouse of a trading post in sight with the prices the server names', () => {
    const post = { ...city(null), tradeOrg: 'post' as const }
    // Seen from afar: prices without what it holds (`CONTEXT.md`: Seeing inside a storage).
    const prices = PRICED_GOODS.map((good) => ({
      good,
      ...priceFor(good, 0, WAREHOUSE_FLOOR[good]),
    }))
    const warehouse = { ...b('w1', 'warehouse', 'city1'), prices }
    const seen = { cities: [post], buildings: [b('b1', 'townHall', 'city1'), warehouse] }
    const [view] = warehousesInSight(post, seen)
    expect(view!.id).toBe('w1')
    expect(view!.prices).toEqual(prices)
    expect(view!.prices.every((p) => p.stock === undefined)).toBe(true)
  })

  it('shows nothing for a city without warehouses in sight', () => {
    const seen = { cities: [city(null)], buildings: [b('w1', 'warehouse', 'city2')] }
    expect(warehousesInSight(city(null), seen)).toEqual([])
  })
})

describe('trading at a warehouse in the inspector', () => {
  const post = { ...city(null), tradeOrg: 'post' as const }
  const warehouse = {
    ...b('w1', 'warehouse', 'city1'),
    x: 3,
    y: 4,
    stock: { iron: 20, coins: 500 },
  }
  const seen = { cities: [post], buildings: [b('b1', 'townHall', 'city1'), warehouse] }
  const trader = {
    id: 'p1',
    owner: 'realm1',
    x: 3,
    y: 4,
    carried: { iron: 2, coins: 100 },
    bornAt: -1e9,
    stats: { strength: { base: 10, trained: 0 } },
    hunger: 100,
    health: 100,
  } as unknown as Resident

  it('finds the Player’s residents and carriages on the warehouse', () => {
    const other = { ...trader, id: 'p2', owner: 'realm2' } as Resident
    const away = { ...trader, id: 'p3', x: 9 } as Resident
    const carriage = {
      id: 'k1',
      realmId: 'realm1',
      cityId: null,
      x: 3,
      y: 4,
      horseId: null,
      load: {},
    }
    const theirs = { ...carriage, id: 'k2', realmId: 'realm2' }
    expect(
      tradersAt(
        warehouse,
        { residents: [trader, other, away], carriages: [carriage, theirs] },
        'realm1',
      ),
    ).toEqual({ residents: [trader], carriages: [carriage] })
  })

  it('previews what buying and selling would move at the warehouse’s prices', () => {
    const preview = previewTrade(seen, 'w1', trader, undefined, 'iron', 2, 0, [])
    const floor = WAREHOUSE_FLOOR.iron
    expect(preview.sell).toEqual({
      units: 2,
      coins: priceFor('iron', 21, floor).buy + priceFor('iron', 22, floor).buy,
    })
    expect(preview.buy.units).toBe(2)
    expect(preview.buy.coins).toBe(
      priceFor('iron', 20, floor).sell + priceFor('iron', 19, floor).sell,
    )
    // From a carriage holding nothing, there is nothing to sell or pay with.
    const carriage = {
      id: 'k1',
      realmId: 'realm1',
      cityId: null,
      x: 3,
      y: 4,
      horseId: null,
      load: {},
    }
    expect(previewTrade(seen, 'w1', trader, carriage, 'iron', 2, 0, [])).toEqual({
      buy: { units: 0, coins: 0 },
      sell: { units: 0, coins: 0 },
    })
  })

  it('previews a delivery to and a pick-up from one of the Player’s cities, fee and all', () => {
    const home: City = { id: 'city2', name: 'Home', realmId: 'realm1', townHallId: 'h2' }
    const storage = { ...b('s2', 'storage', 'city2'), x: 23, y: 4, stock: { iron: 5 } }
    const theirs = { ...b('s3', 'storage', 'city3'), x: 30, y: 4 }
    const all = {
      cities: [post, home, { ...home, id: 'city3', realmId: 'realm2' }],
      buildings: [...seen.buildings, storage, theirs],
    }
    const [to] = deliveryCities(all, 'realm1')
    expect(deliveryCities(all, 'realm1')).toEqual([{ id: 'city2', name: 'Home', storage }])
    const preview = previewDelivery(all, 'w1', trader, undefined, 'iron', 2, to!, 128)
    const floor = WAREHOUSE_FLOOR.iron
    expect(preview.buy).toEqual({
      units: 2,
      coins: priceFor('iron', 20, floor).sell + priceFor('iron', 19, floor).sell,
      fee: deliveryFee(2, 20),
    })
    const price = priceFor('iron', 21, floor).buy + priceFor('iron', 22, floor).buy
    const fee = deliveryFee(2, 20)
    expect(preview.sell).toEqual({ units: 2, coins: price - fee, fee })
  })

  it('previews a transfer from one of the Player’s cities to another realm’s, fee and all', () => {
    const home: City = { id: 'city2', name: 'Home', realmId: 'realm1', townHallId: 'h2' }
    const theirs: City = { ...home, id: 'city3', name: 'Yonder', realmId: 'realm2' }
    const storage = { ...b('s2', 'storage', 'city2'), x: 23, y: 4, stock: { iron: 5, coins: 900 } }
    const their = { ...b('s3', 'storage', 'city3'), x: 30, y: 4 }
    const all = { cities: [post, home, theirs], buildings: [...seen.buildings, storage, their] }
    expect(takesTransfers(theirs, all, 'realm1')).toBe(true)
    expect(takesTransfers(home, all, 'realm1')).toBe(false)
    expect(takesTransfers(post, all, 'realm1')).toBe(false)
    const [from] = deliveryCities(all, 'realm1')
    const fee = transferFee(5, transferTiles(128, warehouse, storage, their))
    expect(previewTransfer(all, from!, 'city3', 'iron', 9, 128)).toEqual({ units: 5, fee })
    // Without the recipient's storage in sight there is nothing to preview.
    expect(previewTransfer(all, from!, 'city4', 'iron', 9, 128)).toBe(undefined)
  })
})

describe('buying a city in the inspector', () => {
  const hall = { ...b('b1', 'townHall', 'city1'), x: 5, y: 6 }
  const mine = (x: number, y: number, coins?: number) =>
    ({ id: `r${x}${y}`, owner: 'realm1', x, y, carried: coins ? { coins } : {} }) as Resident

  it('names no price for a city that is not for sale', () => {
    expect(describeBuying(city('realm2'), { residents: [], buildings: [hall] }, 'realm1')).toBe(
      undefined,
    )
  })

  it('shows the price and where to bring the coins', () => {
    const view = describeBuying(
      { ...city(null), price: 900 },
      { residents: [mine(1, 1, 500)], buildings: [hall] },
      'realm1',
    )
    expect(view).toEqual({ price: 900, townHall: { x: 5, y: 6 }, coins: 0 })
  })

  it('adds up the coins of the Player’s residents on the town hall and picks one to buy', () => {
    const other = { ...mine(5, 6, 700), owner: 'realm2' } as Resident
    const view = describeBuying(
      { ...city(null), price: 900 },
      { residents: [mine(5, 6, 500), mine(5, 6, 300), other], buildings: [hall] },
      'realm1',
    )
    expect(view).toEqual({ price: 900, townHall: { x: 5, y: 6 }, coins: 800, buyerId: 'r56' })
  })
})

describe('trading with an NPC city in the inspector', () => {
  const food: NpcCityPrice = { good: 'food', stock: 30, forSale: 10, wanted: 0, buy: 1, sell: 3 }
  const wood: NpcCityPrice = { good: 'wood', stock: 5, forSale: 0, wanted: 20, buy: 4, sell: 6 }
  const storage = { ...b('s1', 'storage', 'city1'), stock: { food: 30, wood: 5, coins: 12 } }

  it('lists the storages in sight of an NPC city that names its prices', () => {
    const seen = {
      buildings: [storage, b('s2', 'storage', 'city1', true), b('h', 'house', 'city1')],
    }
    expect(npcStoragesInSight({ ...city(null), trade: [food] }, seen)).toEqual([
      { id: 's1', kind: 'storage', x: 0, y: 0, prices: [food] },
    ])
    expect(npcStoragesInSight(city(null), seen)).toEqual([])
  })

  it('previews a trade cut down to its surplus, what it lacks and the coins on either side', () => {
    const trader = {
      carried: { coins: 100, wood: 10 },
      bornAt: -1e9,
      stats: { strength: { base: 10, trained: 0 } },
    } as unknown as Resident
    const q = (good: 'food' | 'wood', units: number) =>
      previewNpcTrade([food, wood], storage, trader, undefined, good, units, 0, [])
    expect(q('food', 50).buy).toEqual({ units: 10, coins: 30 })
    expect(q('food', 50).sell.units).toBe(0)
    // It lacks 20 wood, but has only 12 coins: 3 wood at 4 coins.
    expect(q('wood', 10).sell).toEqual({ units: 3, coins: 12 })
    expect(q('wood', 10).buy.units).toBe(0)
  })
})
