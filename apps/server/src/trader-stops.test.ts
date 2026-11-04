import {
  AVERAGE_HORSE_STATS,
  CARAVAN_ESCORTS,
  CARAVAN_FOOD,
  NPC_VILLAGE,
  TRADER_DRIVE_TRIES,
  TRADER_STOP_REACH,
  TRADER_STOP_TICKS,
  Terrain,
  TRADE_ORG,
  WEAPONS,
  covers,
  crewIdsOf,
  isArmed,
  npcCityStock,
  npcReserve,
  quoteTraderTrade,
  standingOf,
  traderPriceFor,
  traderPrices,
  traderStandingAt,
  traderStock,
  traderVisitsTo,
  tileIndex,
  townHallOf,
  wallMap,
  wrapDistance,
  type City,
  type Resident,
  type TerrainMap,
  type Trader,
  type Weapon,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { planCity } from './npc-plan.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight, sentInsideUnseen } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { takeOver } from './stealing.js'
import { callsOnTheWay, stopTile, traderStopsSound } from './trader-stops.js'
import { foundTradeOrgHq } from './trade-org.js'
import { placeTraders, stepTraders } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { tradesOf, traderTradesKeepFood } from './trading.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** The Trade Org HQ and one trading post far apart, with one trader, out and bound for the post. */
function fixture() {
  const terrain = plains(2048)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 100, 500, rand)
  const post = foundTradingPost(world, terrain, 700, 500, undefined, rand)
  placeTraders(world, terrain.size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  const trader = world.traders[0]!
  trader.heading = 'post'
  trader.postId = post.id
  return { world, terrain, hq, post, trader }
}

const carriageOf = (world: WorldState, t: Trader) =>
  world.carriages.find((k) => k.id === t.carriageId)!

const crewOf = (world: WorldState, t: Trader) =>
  crewIdsOf(t).map((id) => world.residents.find((r) => r.id === id)!)

/** Stands a trader's carriage, its hitched horse and its crew on tile (x, y). */
function put(world: WorldState, t: Trader, x: number, y: number) {
  const carriage = carriageOf(world, t)
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  for (const thing of [carriage, horse, ...crewOf(world, t)]) {
    thing.x = x
    thing.y = y
  }
  for (const r of crewOf(world, t)) r.order = null
}

/** Stands a trader at a stop by `city`, with `ticks` left there. */
function standAt(world: WorldState, t: Trader, city: City, x: number, y: number, ticks = 500) {
  put(world, t, x, y)
  t.calls = []
  t.stand = { cityId: city.id, x, y, until: world.tick + ticks }
}

function resident(world: WorldState, id: string, owner: string | null, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId: null,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

function runUntil(world: WorldState, terrain: TerrainMap, done: () => boolean, ticks = 4000) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && !done(); t++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
  }
  expect(done()).toBe(true)
}

describe('which cities a wandering trader stops at', () => {
  it('those within reach of its way, in the order it passes them, not the rest', () => {
    const { world, terrain } = fixture()
    const rand = mulberry32(9)
    const near = foundNpcCity(world, terrain, NPC_VILLAGE, 500, 500 + TRADER_STOP_REACH - 40, rand)
    const nearer = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500 - 60, rand)
    const far = foundNpcCity(world, terrain, NPC_VILLAGE, 500, 500 - TRADER_STOP_REACH - 80, rand)
    const behind = foundNpcCity(world, terrain, NPC_VILLAGE, 900, 500, rand)
    const calls = callsOnTheWay(world, { x: 100, y: 500 }, { x: 700, y: 500 }, terrain.size)
    expect(calls).toEqual([nearer.id, near.id])
    expect(calls).not.toContain(far.id)
    expect(calls).not.toContain(behind.id)
  })

  it('never the Trade Organization’s, which are stops of their own, and none on no way at all', () => {
    const { world, terrain, hq, post } = fixture()
    const calls = callsOnTheWay(world, { x: 100, y: 500 }, { x: 700, y: 500 }, terrain.size)
    expect(calls).not.toContain(hq.id)
    expect(calls).not.toContain(post.id)
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    expect(callsOnTheWay(world, { x: 300, y: 500 }, { x: 302, y: 500 }, terrain.size)).toEqual([])
    expect(callsOnTheWay(world, { x: 100, y: 500 }, { x: 700, y: 500 }, terrain.size)).toEqual([
      city.id,
    ])
  })

  it('a Player’s too, and it reckons across the map’s joins', () => {
    const { world, terrain } = fixture()
    const realm = foundStartingCity(world, terrain, 7)
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const hall = townHallOf(world, city)!
    const from = { x: (hall.x + 2000) % 2048, y: hall.y }
    const to = { x: (hall.x + 50) % 2048, y: hall.y }
    expect(callsOnTheWay(world, from, to, terrain.size)).toContain(city.id)
  })
})

describe('where a wandering trader stands at a city', () => {
  it('beside the town hall, on a free tile, on the side it comes from', () => {
    const { world, terrain } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 300, mulberry32(9))
    world.buildings = world.buildings.filter(
      (b) => b.cityId !== city.id || (b.kind !== 'wall' && b.kind !== 'gate'),
    )
    const hall = townHallOf(world, city)!
    const tile = stopTile(world, terrain, city, { x: 0, y: hall.y })!
    expect(world.buildings.some((b) => b.kind !== 'road' && covers(b, tile.x, tile.y))).toBe(false)
    expect(wrapDistance(terrain.size, tile, { x: hall.x + 1, y: hall.y + 1 })).toBeLessThan(12)
  })

  it('outside any ring of walls, so a closed gate doesn’t stop it', () => {
    const { world, terrain, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    const gates = world.buildings.filter((b) => b.cityId === city.id && b.kind === 'gate')
    expect(gates.length).toBeGreaterThan(0)
    for (const g of gates) g.closed = true
    const hall = townHallOf(world, city)!
    const { inside } = wallMap(world, terrain)
    const home = npcHome(world, city)!
    expect(inside.has(tileIndex(terrain.size, home.x, home.y))).toBe(true)
    const tile = stopTile(world, terrain, city, { x: 100, y: 500 })!
    expect(inside.has(tileIndex(terrain.size, tile.x, tile.y))).toBe(false)
    // And it gets there with its armed escort, the city shutting its gates against them.
    put(world, trader, hall.x - 25, hall.y)
    for (const r of crewOf(world, trader)) r.carried = { spear: 1 }
    trader.calls = [city.id]
    runUntil(world, terrain, () => trader.stand?.until !== null && trader.stand !== null)
    expect(traderStandingAt(world, trader.stand!.x, trader.stand!.y)).toBe(trader)
    expect(gates.every((g) => g.closed)).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)

  it('not on a tile another trader stands on or is bound for', () => {
    const { world, terrain, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 300, mulberry32(9))
    const first = stopTile(world, terrain, city, { x: 0, y: 300 })!
    trader.stand = { cityId: city.id, x: first.x, y: first.y, until: null }
    expect(stopTile(world, terrain, city, { x: 0, y: 300 })).not.toEqual(first)
  })
})

describe('a wandering trader on its way', () => {
  it('stops at a city on its way for its time, then goes on to the post', () => {
    const { world, terrain, post, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    put(world, trader, 270, 500)
    carriageOf(world, trader).load = { food: CARAVAN_FOOD }
    trader.calls = null
    runUntil(world, terrain, () => trader.stand?.until != null)
    expect(trader.stand!.cityId).toBe(city.id)
    const carriage = carriageOf(world, trader)
    expect([carriage.x, carriage.y]).toEqual([trader.stand!.x, trader.stand!.y])
    expect(trader.stand!.until!).toBeGreaterThanOrEqual(world.tick + TRADER_STOP_TICKS - 1)
    // It stands there with its time left, here cut short so the test needn't wait a game day.
    const until = world.tick + 30
    trader.stand!.until = until
    const at = { x: carriage.x, y: carriage.y }
    runUntil(world, terrain, () => world.tick >= until - 1)
    expect({ x: carriage.x, y: carriage.y }).toEqual(at)
    expect(traderStandingAt(world, at.x, at.y)).toBe(trader)
    // And goes on when it is up, and no trade can be made with it.
    runUntil(world, terrain, () => trader.stand === null)
    expect(traderStandingAt(world, at.x, at.y)).toBeUndefined()
    runUntil(world, terrain, () => carriage.x !== at.x || carriage.y !== at.y, 100)
    expect(trader.postId).toBe(post.id)
    expect(trader.calls).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)

  it('works out the cities anew on each way', () => {
    const { world, terrain, trader, post } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    put(world, trader, 200, 500)
    trader.calls = null
    stepTraders(world, terrain.size, terrain)
    expect(trader.stand?.cityId).toBe(city.id)
    expect(trader.postId).toBe(post.id)
  })

  it('makes no stops without terrain to look for a tile on, as a test of the loop alone', () => {
    const { world, terrain, trader } = fixture()
    foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    put(world, trader, 200, 500)
    trader.calls = null
    stepTraders(world, terrain.size)
    expect(trader.stand).toBeNull()
  })

  it('passes a city by whose tile it can’t reach, so one can’t hold up the loop', () => {
    const { world, terrain, trader, post } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    put(world, trader, 200, 500)
    trader.stand = { cityId: city.id, x: 310, y: 510, until: null }
    trader.calls = []
    trader.misses = TRADER_DRIVE_TRIES
    stepTraders(world, terrain.size, terrain)
    expect(trader.stand).toBeNull()
    expect(trader.misses).toBe(1)
    expect(trader.postId).toBe(post.id)
  })

  it('passes by a city with no town hall left, and leaves one that lost it', () => {
    const { world, terrain, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    put(world, trader, 200, 500)
    trader.calls = [city.id]
    world.buildings = world.buildings.filter((b) => b.kind !== 'townHall' || b.cityId !== city.id)
    stepTraders(world, terrain.size, terrain)
    expect(trader.stand).toBeNull()
    expect(trader.calls).toEqual([])
    trader.stand = { cityId: city.id, x: 200, y: 500, until: world.tick + 100 }
    trader.calls = []
    put(world, trader, 200, 500)
    stepTraders(world, terrain.size, terrain)
    expect(trader.stand).toBeNull()
  })

  it('stolen, it starts over at the HQ with no stop to make', () => {
    const { world, terrain, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    standAt(world, trader, city, 290, 490)
    const thief = resident(world, 'thief', 'r1', 290, 490)
    takeOver(world, thief, 'r1', { carriage: carriageOf(world, trader) }, terrain.size)
    expect(trader.stand).toBeNull()
    expect(trader.calls).toBeNull()
    expect(trader.heading).toBe('hq')
  })
})

describe('a wandering trader’s prices', () => {
  const one = { escortIds: Array.from({ length: CARAVAN_ESCORTS }, (_, i) => `e${i}`) }

  it('come from what it carries, buying lower than it sells, rising as it holds less', () => {
    const { world, trader } = fixture()
    const k = carriageOf(world, trader)
    k.load = { wood: 40, stone: 2 }
    const prices = traderPrices(trader, k)
    const wood = prices.find((p) => p.good === 'wood')!
    const stone = prices.find((p) => p.good === 'stone')!
    expect(wood.stock).toBe(40)
    expect(wood.buy).toBeLessThan(wood.sell)
    expect(stone.sell).toBeGreaterThan(wood.sell)
    expect(prices.map((p) => p.good)).not.toContain('coins')
    expect(wood).toMatchObject(traderPriceFor('wood', 40))
  })

  it('leave out the Food its crew keep on board', () => {
    expect(traderStock(one, { food: CARAVAN_FOOD + 5 }).food).toBe(5)
    expect(traderStock(one, { food: 1 }).food).toBe(0)
  })

  it('moves the price as a trade goes, cut down to what it holds and its coins', () => {
    const load = { wood: 3, coins: 10 }
    const hands = { stock: { coins: 1_000 }, room: 100 }
    const buy = quoteTraderTrade(one, load, 400, hands, 'buy', 'wood', 10)
    expect(buy.units).toBe(3)
    expect(buy.limit).toBe('stock')
    expect(buy.coins).toBe(
      traderPriceFor('wood', 3).sell +
        traderPriceFor('wood', 2).sell +
        traderPriceFor('wood', 1).sell,
    )
    const selling = { stock: { wood: 100 }, room: 100 }
    const sell = quoteTraderTrade(one, load, 400, selling, 'sell', 'wood', 100)
    expect(sell.limit).toBe('theirCoins')
    expect(sell.coins).toBeLessThanOrEqual(10)
  })

  it('takes goods only as far as its carriage holds', () => {
    const load = { stone: 395, coins: 100 }
    const selling = { stock: { wood: 100 }, room: 100 }
    const sell = quoteTraderTrade(one, load, 400, selling, 'sell', 'wood', 100)
    expect(sell.limit).toBe('theirRoom')
    expect(sell.units).toBeGreaterThan(0)
    expect(sell.units).toBeLessThan(10)
    // An overloaded carriage may still sell.
    const full = { stone: 500, coins: 0 }
    const hands = { stock: { coins: 100 }, room: 100 }
    expect(quoteTraderTrade(one, full, 400, hands, 'buy', 'stone', 2).units).toBe(2)
  })

  it('sells none of the Food on board', () => {
    const load = { food: CARAVAN_FOOD + 2 }
    const hands = { stock: { coins: 1_000 }, room: 100 }
    expect(quoteTraderTrade(one, load, 400, hands, 'buy', 'food', 50).units).toBe(2)
  })
})

describe('trading with a wandering trader at a stop', () => {
  const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

  /** A trader standing by an NPC village, and r1's p1 on its tile. */
  function atStop() {
    const f = fixture()
    const city = foundNpcCity(f.world, f.terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    f.world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
    resident(f.world, 'a1', 'r1', 900, 900)
    const p1 = resident(f.world, 'p1', 'r1', 290, 490)
    standAt(f.world, f.trader, city, 290, 490)
    const k = carriageOf(f.world, f.trader)
    k.load = { food: CARAVAN_FOOD, wood: 40, coins: 200 }
    return { ...f, city, p1, k, queue: new OrderQueue(undefined, f.terrain) }
  }

  function run(world: WorldState, terrain: TerrainMap) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  }

  function order(
    world: WorldState,
    queue: OrderQueue,
    o: Record<string, unknown>,
    residentId = 'p1',
  ) {
    const answer = queue.receive(world, player, 'q', { residentId, ...o })
    queue.applyAll(world)
    return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
  }

  it('buys: goods from its load into their hands, coins the other way, with standing', () => {
    const { world, terrain, p1, k, queue } = atStop()
    p1.carried = { coins: 100 }
    const price = traderPriceFor('wood', 40).sell + traderPriceFor('wood', 39).sell
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 2 })).toBe('ack')
    run(world, terrain)
    expect(p1.carried).toEqual({ wood: 2, coins: 100 - price })
    expect(k.load).toEqual({ food: CARAVAN_FOOD, wood: 38, coins: 200 + price })
    expect(standingOf(world, 'r1', TRADE_ORG)).toBeGreaterThan(0)
    const line = world.events.find((e) => e.kind === 'traded')
    expect(line).toMatchObject({ withTrader: true, units: 2, side: 'buy' })
  })

  it('sells: goods onto its carriage, its coins into their hands', () => {
    const { world, terrain, p1, k, queue } = atStop()
    p1.carried = { iron: 2 }
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 2 })).toBe('ack')
    run(world, terrain)
    expect(p1.carried.iron).toBeUndefined()
    expect(k.load.iron).toBe(2)
    expect(p1.carried.coins).toBeGreaterThan(0)
    expect((k.load.coins ?? 0) + (p1.carried.coins ?? 0)).toBe(200)
  })

  it('trades from a carriage of theirs on the tile instead of their hands', () => {
    const { world, terrain, p1, k, queue } = atStop()
    world.carriages.push({
      id: 'own',
      realmId: 'r1',
      cityId: null,
      x: p1.x,
      y: p1.y,
      horseId: null,
      load: { coins: 100 },
    })
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1, carriageId: 'own' })).toBe(
      'ack',
    )
    run(world, terrain)
    expect(world.carriages.find((c) => c.id === 'own')!.load.wood).toBe(1)
    expect(k.load.wood).toBe(39)
  })

  it('refuses one not on its tile, a delivery, and those the Trade Organization refuses', () => {
    const { world, p1, queue } = atStop()
    p1.carried = { coins: 100 }
    p1.x += 1
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1 })).toBe(
      'not at a Trade Org warehouse',
    )
    p1.x -= 1
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1, cityId: 'c' })).toBe(
      'a wandering trader delivers nothing',
    )
    expect(order(world, queue, { kind: 'buy', good: 'coins', units: 1 })).toBe(
      'not a good traders trade',
    )
    world.standings.push({ of: TRADE_ORG, toward: 'r1', value: -100 })
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1 })).toMatch(/won’t trade/)
  })

  it('doesn’t trade before it stands there, nor once it goes on', () => {
    const { world, trader, p1, queue } = atStop()
    p1.carried = { coins: 100 }
    trader.stand!.until = null
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1 })).toBe(
      'not at a Trade Org warehouse',
    )
    trader.stand!.until = world.tick
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1 })).toBe(
      'not at a Trade Org warehouse',
    )
    // Nor with its crew gone.
    trader.stand!.until = world.tick + 10
    trader.driverId = null
    expect(traderStandingAt(world, p1.x, p1.y)).toBeUndefined()
  })

  it('sells none of the Food on board, and the invariant catches one that did', () => {
    const { world, terrain, p1, k, queue } = atStop()
    p1.carried = { coins: 500 }
    expect(order(world, queue, { kind: 'buy', good: 'food', units: 5 })).toBe('ack')
    run(world, terrain)
    expect(k.load.food).toBe(CARAVAN_FOOD)
    expect(p1.carried.food).toBeUndefined()
    const record = {
      residentId: 'p1',
      realm: 'r1',
      refused: false,
      before: {},
      after: {},
      traderId: 'x',
      keptFood: false,
    }
    tradesOf(world).push(record)
    expect(traderTradesKeepFood.check(world, terrain)).toHaveLength(1)
  })

  it('tells the realm while one stands at one of its cities, wherever it is', () => {
    const { world, terrain, trader, city } = atStop()
    world.realms.push({ id: 'r2', userId: 8, leaderId: 'a2' })
    resident(world, 'a2', 'r2', 900, 910)
    expect(traderVisitsTo(world, 'r1')).toEqual([])
    city.realmId = 'r1'
    expect(traderVisitsTo(world, 'r1')).toEqual([
      {
        traderId: trader.id,
        cityId: city.id,
        city: city.name,
        x: 290,
        y: 490,
        until: trader.stand!.until,
      },
    ])
    expect(traderVisitsTo(world, 'r2')).toEqual([])
    // A capture changes whom it tells.
    captureCity(world, city, 'r2', terrain.size)
    expect(traderVisitsTo(world, 'r1')).toEqual([])
    expect(traderVisitsTo(world, 'r2')).toHaveLength(1)
  })

  it('names its prices to those in sight, what it holds only to those on its tile', () => {
    const { world, terrain, trader } = atStop()
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'b1' })
    resident(world, 'b1', 'r3', 300, 495)
    const seen = (realm: string) =>
      entitiesInSight(world, terrain, realm).find((e) => e.is === 'trader' && e.id === trader.id)
    const here = seen('r1')
    expect(here).toMatchObject({ standing: { x: 290, y: 490 } })
    expect(here?.is === 'trader' && here.prices?.find((p) => p.good === 'wood')?.stock).toBe(40)
    const there = seen('r3')
    expect(there?.is === 'trader' && there.prices?.find((p) => p.good === 'wood')?.stock).toBe(
      undefined,
    )
    expect(there?.is === 'trader' && there.prices?.length).toBeGreaterThan(0)
    expect(sentInsideUnseen(world, terrain, 'r3', [there!])).toEqual([])
    // Sent what only those on its tile may see, the invariant catches it.
    expect(sentInsideUnseen(world, terrain, 'r3', [here!])).toHaveLength(1)
    // On the way it names none.
    trader.stand = null
    expect(seen('r1')).not.toHaveProperty('prices')
    expect(seen('r1')).not.toHaveProperty('standing')
  })
})

describe('an NPC city and its visiting trader', () => {
  /** A village with a surplus of Wood, short of Iron, and a trader standing at it. */
  function visited(load: Record<string, number> = {}) {
    const f = fixture()
    const city = foundNpcCity(f.world, f.terrain, NPC_VILLAGE, 300, 500, mulberry32(9))
    const storage = npcHome(f.world, city)!
    storage.stock = {}
    const reserve = npcReserve(f.world, city)
    storage.stock = {
      food: (reserve.food ?? 0) + 5,
      wood: (reserve.wood ?? 0) + 30,
      stone: reserve.stone ?? 0,
      coins: reserve.coins ?? 0,
    }
    const k = carriageOf(f.world, f.trader)
    k.load = { food: CARAVAN_FOOD, iron: 20, coins: 500, ...load }
    const hall = townHallOf(f.world, city)!
    const tile = stopTile(f.world, f.terrain, city, { x: hall.x - 100, y: hall.y })!
    standAt(f.world, f.trader, city, tile.x, tile.y, TRADER_STOP_TICKS)
    return { ...f, city, storage, k, tile }
  }

  const sent = (world: WorldState, city: City) => world.cityPlans[city.id]?.trader

  it('sends a spare hand, never a soldier, who sells its surplus and buys what it is short of', () => {
    const { world, terrain, city, k } = visited()
    world.cityPlans[city.id] = planCity(world, city, terrain)
    const run = sent(world, city)!
    expect(run.visitingId).toBe(world.traders[0]!.id)
    expect(run.warehouseId).toBeNull()
    expect(run.sells.wood).toBeGreaterThan(0)
    expect(run.buys.iron).toBeGreaterThan(0)
    const hand = world.residents.find((r) => r.id === run.residentId)!
    expect(isArmed(hand)).toBe(false)
    const before = { wood: npcCityStock(world, city).wood ?? 0, load: k.load.wood ?? 0 }
    runUntil(world, terrain, () => (k.load.wood ?? 0) > before.load)
    runUntil(world, terrain, () => (k.load.iron ?? 0) < 20)
    runUntil(world, terrain, () => (npcCityStock(world, city).iron ?? 0) > 0)
    expect(npcCityStock(world, city).wood).toBeLessThan(before.wood)
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)

  it('counts the crew as nobody to fear, though they are armed', () => {
    const { world, terrain, city, trader } = visited()
    for (const r of crewOf(world, trader)) r.carried = { spear: 1 }
    world.cityPlans[city.id] = planCity(world, city, terrain)
    expect(sent(world, city)?.visitingId).toBe(trader.id)
  })

  it('sends nobody with another armed outsider in its area', () => {
    const { world, terrain, city, tile } = visited()
    const stranger = resident(world, 'raider', 'r9', tile.x, tile.y)
    stranger.carried = { spear: 1 }
    world.cityPlans[city.id] = planCity(world, city, terrain)
    expect(sent(world, city)?.visitingId).toBeUndefined()
  })

  it('makes no deal when there is none to make', () => {
    const { world, terrain, city, storage, k } = visited({ iron: 0, coins: 0 })
    storage.stock = { ...npcReserve(world, city) }
    k.load = { food: CARAVAN_FOOD }
    world.cityPlans[city.id] = planCity(world, city, terrain)
    expect(sent(world, city)?.visitingId).toBeUndefined()
  })

  it('buys Food from it when Food runs short, with the coins it has above its reserve', () => {
    const { world, terrain, city, storage, k } = visited({ iron: 0, food: CARAVAN_FOOD + 40 })
    const reserve = npcReserve(world, city)
    storage.stock = { ...reserve, food: 0, coins: (reserve.coins ?? 0) + 200 }
    world.cityPlans[city.id] = planCity(world, city, terrain)
    expect(sent(world, city)?.buys.food).toBeGreaterThan(0)
    runUntil(world, terrain, () => (k.load.food ?? 0) < CARAVAN_FOOD + 40)
    expect(k.load.food).toBeGreaterThanOrEqual(CARAVAN_FOOD)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('never deals in weapons, which would arm the hand', () => {
    const { world, terrain, city, storage, k } = visited({ iron: 0 })
    storage.stock = { ...npcReserve(world, city), sword: 5 }
    k.load = { food: CARAVAN_FOOD, spear: 5, coins: 500 }
    world.cityPlans[city.id] = planCity(world, city, terrain)
    const run = sent(world, city)
    expect(
      Object.keys({ ...run?.sells, ...run?.buys }).filter((g) => WEAPONS.includes(g as Weapon)),
    ).toEqual([])
  })

  it('takes a hand home when the trader goes on before they get there', () => {
    const { world, terrain, city, trader, storage } = visited()
    world.cityPlans[city.id] = planCity(world, city, terrain)
    const run = sent(world, city)!
    const hand = world.residents.find((r) => r.id === run.residentId) as Resident
    trader.stand = null
    trader.calls = []
    const wood = storage.stock!.wood
    runUntil(world, terrain, () => sent(world, city)?.residentId !== hand.id)
    expect(hand.carried.wood).toBeUndefined()
    expect(storage.stock!.wood).toBe(wood)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('what holds trader stops together', () => {
  const messages = (world: WorldState, terrain: TerrainMap) =>
    traderStopsSound.check(world, terrain).map((v) => v.message)

  it('catches a city called at twice, too long a stay and two on one tile', () => {
    const { world, terrain, trader, post } = fixture()
    trader.calls = ['a', 'a']
    expect(messages(world, terrain).join()).toMatch(/twice/)
    trader.calls = []
    trader.stand = { cityId: post.id, x: 1, y: 1, until: world.tick + TRADER_STOP_TICKS + 1 }
    put(world, trader, 1, 1)
    expect(messages(world, terrain).join()).toMatch(/too long/)
    trader.stand.until = world.tick + 5
    world.traders.push({ ...structuredClone(trader), id: 'other' })
    expect(messages(world, terrain).join()).toMatch(/with another trader/)
  })

  it('catches one that left its stop with time to stand', () => {
    const { world, terrain, trader, post } = fixture()
    trader.stand = { cityId: post.id, x: 1, y: 1, until: world.tick + 5 }
    put(world, trader, 2, 2)
    expect(messages(world, terrain).join()).toMatch(/left its stop/)
  })

  it('is one of the world’s invariants', () => {
    const { world, terrain, trader, post } = fixture()
    trader.stand = { cityId: post.id, x: 1, y: 1, until: world.tick + 5 }
    put(world, trader, 2, 2)
    expect(checkInvariants(world, terrain).map((v) => v.invariant)).toContain('trader-stops-sound')
  })
})
