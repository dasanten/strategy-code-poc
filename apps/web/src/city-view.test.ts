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
  type TradeLimit,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  buildingCount,
  describeBuying,
  describeCity,
  deliveryCities,
  holderText,
  npcStoragesInSight,
  previewDelivery,
  previewNpcTrade,
  previewTrade,
  previewTransfer,
  takesTransfers,
  tradedGoods,
  tradeLists,
  tradersAt,
  tradeText,
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
    const empty = previewTrade(seen, 'w1', trader, carriage, 'iron', 2, 0, [])
    expect(empty.buy).toEqual({ units: 0, coins: 0, limit: 'coins' })
    expect(empty.sell).toEqual({ units: 0, coins: 0, limit: 'held' })
    expect(empty.holder.stock).toBe(carriage.load)
  })

  it('says why a trade at the warehouse won’t go, or what cut it down', () => {
    const q = (carried: Resident['carried'], stock: Building['stock']) =>
      previewTrade(
        { ...seen, buildings: [seen.buildings[0]!, { ...warehouse, stock }] },
        'w1',
        { ...trader, carried } as Resident,
        undefined,
        'iron',
        5,
        0,
        [],
      )
    expect(q({ iron: 2 }, { iron: 20, coins: 500 }).buy.limit).toBe('coins')
    expect(q({ coins: 100 }, { iron: 0, coins: 500 }).buy.limit).toBe('stock')
    expect(q({ coins: 100 }, { iron: 20, coins: 500 }).sell.limit).toBe('held')
    expect(q({ iron: 2 }, { iron: 20, coins: 0 }).sell.limit).toBe('theirCoins')
    expect(q({ coins: 100, stone: 40 }, { iron: 20, coins: 500 }).buy.limit).toBe('room')
    // Cut down: 3 of the 5 in stock, 2 of the 5 held to sell.
    const cut = q({ iron: 2, coins: 100 }, { iron: 3, coins: 500 })
    expect(cut.buy).toMatchObject({ units: 3, limit: 'stock' })
    expect(cut.sell).toMatchObject({ units: 2, limit: 'held' })
    // A trade that moves all it asks for names no limit.
    expect(q({ iron: 9, coins: 100 }, { iron: 20, coins: 500 }).sell.limit).toBe(undefined)
  })

  it('says what the trader holds and the room left', () => {
    const hands = previewTrade(seen, 'w1', trader, undefined, 'iron', 1, 0, []).holder
    expect(holderText(hands, 'iron', 'iron', undefined)).toBe(
      `Carries 100 coins and 2 iron; room for ${hands.room} kg more (${Math.floor(hands.room)} iron)`,
    )
    const load = { stock: { coins: 40, spear: 1 }, room: 10.5 }
    expect(holderText(load, 'spear', 'spear', 'k1')).toBe(
      'Carriage k1 holds 40 coins and 1 spear; room for 10.5 kg more (3 spear)',
    )
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
    expect(q('food', 50).buy).toEqual({ units: 10, coins: 30, limit: 'stock' })
    expect(q('food', 50).sell.units).toBe(0)
    // It lacks 20 wood, but has only 12 coins: 3 wood at 4 coins.
    expect(q('wood', 10).sell).toEqual({ units: 3, coins: 12, limit: 'theirCoins' })
    expect(q('wood', 10).buy.units).toBe(0)
  })

  it('says why a trade with an NPC city won’t go, or what cut it down', () => {
    const trader = (carried: Resident['carried']) =>
      ({ carried, bornAt: -1e9, stats: { strength: { base: 10, trained: 0 } } }) as never
    const q = (carried: Resident['carried'], good: 'food' | 'wood') =>
      previewNpcTrade([food, wood], storage, trader(carried), undefined, good, 50, 0, [])
    expect(q({ coins: 100 }, 'food').buy).toEqual({ units: 10, coins: 30, limit: 'stock' })
    expect(q({ coins: 100 }, 'wood').buy.limit).toBe('stock')
    expect(q({ wood: 1 }, 'food').buy.limit).toBe('coins')
    expect(q({ coins: 100, stone: 40 }, 'food').buy.limit).toBe('room')
    expect(q({ food: 5 }, 'food').sell.limit).toBe('unwanted')
    expect(q({ coins: 5 }, 'wood').sell.limit).toBe('held')
    // A city that names the Player no prices won't trade with them.
    const refused = previewNpcTrade(undefined, storage, trader({}), undefined, 'food', 5, 0, [])
    expect(refused.buy).toEqual({
      units: 0,
      coins: 0,
      limit: 'refused',
    })
  })
})

describe('the trade buttons', () => {
  it('names the trade, and what cut it down', () => {
    expect(tradeText('buy', 'iron', { units: 4, coins: 36 }, false)).toBe('Buy 4 iron for 36 coins')
    expect(tradeText('buy', 'iron', { units: 4, coins: 36, limit: 'coins' }, false)).toBe(
      'Buy 4 iron for 36 coins: your coins run out',
    )
    expect(tradeText('sell', 'wood', { units: 3, coins: 12, limit: 'theirCoins' }, false)).toBe(
      'Sell 3 wood for 12 coins: its coins run out',
    )
  })

  it('says why a trade won’t go', () => {
    const zero = (limit?: TradeLimit) => ({ units: 0, coins: 0, ...(limit ? { limit } : {}) })
    expect(tradeText('buy', 'iron', zero('coins'), false)).toBe('Can’t buy iron: no coins in hand')
    expect(tradeText('buy', 'iron', zero('coins'), true)).toBe(
      'Can’t buy iron: no coins on the carriage',
    )
    expect(tradeText('sell', 'iron', zero('held'), false)).toBe(
      'Can’t sell iron: nothing of it to sell',
    )
    expect(tradeText('buy', 'iron', zero('room'), false)).toBe('Can’t buy iron: no room')
    expect(tradeText('buy', 'iron', zero('stock'), false)).toBe('Can’t buy iron: none in stock')
    expect(tradeText('sell', 'food', zero('unwanted'), false)).toBe(
      'Can’t sell food: it doesn’t want it',
    )
    expect(tradeText('buy', 'food', zero('refused'), false)).toBe(
      'Can’t buy food: it won’t trade with you',
    )
    expect(tradeText('buy', 'food', zero(), false)).toBe('Can’t buy food')
  })
})

describe('prices from the Player’s side', () => {
  const lines = PRICED_GOODS.map((good) => ({ good, buy: 2, sell: 5 }))
  const warehouse = { id: 'w1', kind: 'warehouse' as const, x: 0, y: 0 }

  it('lists every good both ways at a warehouse, its units for sale only when seen inside', () => {
    const inside = tradeLists(
      { ...warehouse, prices: lines.map((p) => ({ ...p, stock: p.good === 'food' ? 40 : 0 })) },
      { buildings: [] },
    )
    expect(inside.canBuy.map((l) => l.good)).toEqual(PRICED_GOODS)
    expect(inside.canBuy[0]).toEqual({ good: 'food', units: 40, price: 5 })
    // It takes any amount: no units, its buying price.
    expect(inside.canSell[0]).toEqual({ good: 'food', price: 2 })
    expect(inside.canSell.map((l) => l.good)).toEqual(PRICED_GOODS)
    expect(inside.takesOnlyListed).toBe(false)
    const afar = tradeLists({ ...warehouse, prices: lines }, { buildings: [] })
    expect(afar.canBuy.every((l) => l.units === undefined)).toBe(true)
    expect(tradedGoods({ ...warehouse, prices: lines }, afar)).toEqual(PRICED_GOODS)
  })

  describe('at an NPC city’s storage', () => {
    // Surplus food, short of wood and stone, iron neither: it won’t trade iron.
    const prices: NpcCityPrice[] = [
      { good: 'food', stock: 30, forSale: 10, wanted: 0, buy: 1, sell: 3 },
      { good: 'wood', stock: 5, forSale: 0, wanted: 20, buy: 4, sell: 6 },
      { good: 'stone', stock: 0, forSale: 0, wanted: 2, buy: 3, sell: 5 },
      { good: 'iron', stock: 8, forSale: 0, wanted: 0, buy: 5, sell: 9 },
    ]
    const view = { id: 's1', kind: 'storage' as const, x: 0, y: 0, prices }

    it('lists only its surplus to buy and what it is short of to sell, as far as its coins go', () => {
      // This storage holds 6 of its 10 spare food, and 14 coins: 3 wood at 4, 2 stone at 3.
      const storage = { ...b('s1', 'storage', 'city1'), stock: { food: 6, coins: 14 } }
      const lists = tradeLists(view, { buildings: [storage] })
      expect(lists.canBuy).toEqual([{ good: 'food', units: 6, price: 3 }])
      expect(lists.canSell).toEqual([
        { good: 'wood', units: 3, price: 4 },
        { good: 'stone', units: 2, price: 3 },
      ])
      expect(lists.takesOnlyListed).toBe(true)
      expect(tradedGoods(view, lists)).toEqual(['food', 'wood', 'stone'])
    })

    it('drops what its coins or this storage can’t cover', () => {
      const storage = { ...b('s1', 'storage', 'city1'), stock: { coins: 3 } }
      const lists = tradeLists(view, { buildings: [storage] })
      expect(lists.canBuy).toEqual([])
      expect(lists.canSell).toEqual([{ good: 'stone', units: 1, price: 3 }])
    })

    it('shows the prices without units when the Player doesn’t see inside', () => {
      const shown = prices.map(({ stock: _, ...p }) => p)
      const lists = tradeLists(
        { ...view, prices: shown },
        { buildings: [b('s1', 'storage', 'city1')] },
      )
      expect(lists.canBuy).toEqual([{ good: 'food', price: 3 }])
      expect(lists.canSell).toEqual([
        { good: 'wood', price: 4 },
        { good: 'stone', price: 3 },
      ])
    })
  })
})
