import {
  GOOD_WEIGHT,
  STANDING_NPC_TRADE_COINS_PER_POINT,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG,
  Terrain,
  carryCapacity,
  npcCityPrices,
  npcReserve,
  npcSwapRates,
  priceFor,
  quoteNpcSwap,
  quoteSwap,
  standingOf,
  stockFloor,
  stockWeight,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradingPost } from './trading-posts.js'
import { tradesKeepGoods, tradesOf } from './trading.js'
import { createWorld, stepWorld } from './world.js'

/*
 * A swap (`CONTEXT.md`: Swap): goods for goods in person at a warehouse or an NPC city's storage,
 * a sale and a purchase at once, rounded up on the side given, with what is over back in Coins as
 * far as the place holds them.
 */

const terrain: TerrainMap = { size: 128, tiles: new Uint8Array(128 * 128).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  x: number,
  y: number,
  cityId: string | null = null,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Realm r1 (Player 7, Leader a1 far away) and its p1 standing on a trading post's warehouse. */
function post() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const city = foundTradingPost(world, terrain, 20, 20, 'stone', mulberry32(3))
  const warehouse = world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!
  resident(world, 'a1', 'r1', 110, 110)
  const p1 = resident(world, 'p1', 'r1', warehouse.x, warehouse.y)
  warehouse.stock = { ...warehouse.stock, wood: 50, stone: 50, coins: 1000 }
  return { world, warehouse, p1, queue: new OrderQueue(undefined, terrain) }
}

/**
 * Realm r1 and the NPC city npc, with a storage at (23, 20) that holds no stock yet and six of its
 * residents; r1's p1 stands on the storage.
 */
function npcCity() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  const storage = { id: 'store', kind: 'storage' as const, cityId: 'npc', x: 23, y: 20, stock: {} }
  world.buildings.push(storage)
  resident(world, 'a1', 'r1', 110, 110)
  for (let i = 1; i <= 6; i++) resident(world, `n${i}`, null, 20, 21, 'npc')
  const p1 = resident(world, 'p1', 'r1', 23, 20)
  return { world, npc, storage, p1, queue: new OrderQueue(undefined, terrain) }
}

/** Sends a swap from the Player, applies it and answers whether it was taken. */
function swap(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', { kind: 'swap', residentId: 'p1', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world once, keeping residents fed, and checks every invariant. */
function run(world: WorldState) {
  for (const r of world.residents) r.hunger = 100
  stepWorld(world, terrain)
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** What a warehouse's prices make of `want` units wanted: the units given and the Coins over. */
function worked(
  floorWood: number,
  floorStone: number,
  wood: number,
  stone: number,
  want: number,
): { gives: number; over: number; bought: number; sold: number } {
  let bought = 0
  for (let n = 1; n <= want; n++) bought += priceFor('stone', stone - (n - 1), floorStone).sell
  let sold = 0
  let gives = 0
  while (sold < bought) {
    gives++
    sold += priceFor('wood', wood + gives, floorWood).buy
  }
  return { gives, over: sold - bought, bought, sold }
}

describe('a swap at a warehouse', () => {
  it('needs no Coins in hand, rounds up what is given and gives what is over back in Coins', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { wood: 20 }
    const floor = stockFloor(world, warehouse)
    const w = worked(floor.wood!, floor.stone!, 50, 50, 5)
    expect(w.over).toBeGreaterThanOrEqual(0)
    expect(w.over).toBeLessThan(priceFor('wood', 50 + w.gives, floor.wood!).buy)
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 5 })).toBe('ack')
    run(world)
    expect(p1.order).toBeNull()
    expect(p1.carried).toEqual({
      stone: 5,
      ...(w.gives < 20 ? { wood: 20 - w.gives } : {}),
      ...(w.over > 0 ? { coins: w.over } : {}),
    })
    expect(warehouse.stock!.wood).toBe(50 + w.gives)
    expect(warehouse.stock!.stone).toBe(45)
    expect(warehouse.stock!.coins).toBe(1000 - w.over)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'swapped',
      place: 'warehouse',
      give: 'wood',
      gave: w.gives,
      want: 'stone',
      units: 5,
      wanted: 5,
      coins: w.over,
    })
  })

  it('moves the rate with the stock as it goes', () => {
    const { world, warehouse, p1 } = post()
    // Little of what is wanted and much of what is given: each unit asks more for less.
    warehouse.stock = { wood: 400, stone: 8, coins: 1000 }
    p1.carried = {}
    const holder = { stock: { wood: 1000 }, room: 1e6 }
    const q = (n: number) => quoteSwap(world, warehouse, holder, 'wood', 'stone', n)
    expect(q(1).gives).toBeGreaterThan(0)
    expect(q(6).gives).toBeGreaterThan(q(1).gives * 6)
  })

  it('is cut down by what the trader holds', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { wood: 3 }
    const floor = stockFloor(world, warehouse)
    const holder = { stock: p1.carried, room: 1e6 }
    const q = quoteSwap(world, warehouse, holder, 'wood', 'stone', 40)
    expect(q.limit).toBe('held')
    expect(q.units).toBeLessThan(40)
    expect(q.gives).toBeLessThanOrEqual(3)
    // One unit more would take more wood than they hold.
    expect(worked(floor.wood!, floor.stone!, 50, 50, q.units + 1).gives).toBeGreaterThan(3)
    swap(world, queue, { give: 'wood', want: 'stone', units: 40 })
    run(world)
    expect(p1.carried.stone ?? 0).toBe(q.units)
    expect(world.events.at(-1)).toMatchObject({ kind: 'swapped', units: q.units, wanted: 40 })
  })

  it('is cut down by what the warehouse holds, and keeps what is owed for deliveries', () => {
    const { world, warehouse, queue } = post()
    warehouse.stock!.stone = 3
    const load = { wood: 100 }
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: warehouse.x,
      y: warehouse.y,
      horseId: null,
      load,
    })
    const holder = { stock: load, room: 1e6 }
    const q = quoteSwap(world, warehouse, holder, 'wood', 'stone', 10)
    expect(q).toMatchObject({ units: 3, limit: 'stock' })
    expect(quoteSwap(world, warehouse, holder, 'wood', 'stone', 10, 2)).toMatchObject({
      units: 1,
      limit: 'stock',
    })
    expect(quoteSwap(world, warehouse, holder, 'wood', 'stone', 10, 3)).toMatchObject({
      units: 0,
      limit: 'stock',
    })
    swap(world, queue, { give: 'wood', want: 'stone', units: 10, carriageId: 'k1' })
    run(world)
    expect(world.carriages.find((k) => k.id === 'k1')!.load.stone).toBe(3)
    expect(warehouse.stock!.stone ?? 0).toBe(0)
  })

  it('is cut down by what fits, counting what is given, what is got and the Coins back', () => {
    const { world, warehouse, p1, queue } = post()
    // A shield is heavier than the gold ore that pays for it: each swapped adds to the load.
    expect(GOOD_WEIGHT.shield).toBeGreaterThan(GOOD_WEIGHT.goldOre)
    warehouse.stock = { ...warehouse.stock, shield: 8, goldOre: 20 }
    const capacity = carryCapacity(p1, world.tick)
    p1.carried = { goldOre: capacity - 2 }
    const room = capacity - stockWeight(p1.carried)
    const q = quoteSwap(world, warehouse, { stock: p1.carried, room }, 'goldOre', 'shield', 5)
    expect(q.limit).toBe('room')
    expect(q.units).toBeGreaterThan(0)
    expect(q.units).toBeLessThan(5)
    swap(world, queue, { give: 'goldOre', want: 'shield', units: 5 })
    run(world)
    expect(p1.carried.shield).toBe(q.units)
    expect(stockWeight(p1.carried)).toBeLessThanOrEqual(capacity + 1e-9)
  })

  it('gives Coins back only as far as the place holds them; the coins left stay', () => {
    const { world, warehouse, p1, queue } = post()
    warehouse.stock!.coins = 0
    p1.carried = { wood: 20 }
    const floor = stockFloor(world, warehouse)
    const w = worked(floor.wood!, floor.stone!, 50, 50, 5)
    swap(world, queue, { give: 'wood', want: 'stone', units: 5 })
    run(world)
    expect(p1.carried.stone).toBe(5)
    expect(p1.carried.coins ?? 0).toBe(0)
    expect(p1.carried.wood).toBe(20 - w.gives)
    expect(warehouse.stock!.coins ?? 0).toBe(0)
  })

  it('swaps from the load of a carriage on the tile', () => {
    const { world, warehouse, p1, queue } = post()
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: warehouse.x,
      y: warehouse.y,
      horseId: null,
      load: { wood: 40 },
    })
    p1.carried = {}
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2, carriageId: 'k1' })).toBe(
      'ack',
    )
    run(world)
    const k = world.carriages.find((x) => x.id === 'k1')!
    expect(k.load.stone).toBe(2)
    expect(k.load.wood).toBeLessThan(40)
    expect(p1.carried).toEqual({})
  })

  it('raises standing both ways by the sale and the purchase', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { wood: 20 }
    const floor = stockFloor(world, warehouse)
    const w = worked(floor.wood!, floor.stone!, 50, 50, 5)
    const before = standingOf(world, 'r1', TRADE_ORG)
    swap(world, queue, { give: 'wood', want: 'stone', units: 5 })
    run(world)
    expect(standingOf(world, 'r1', TRADE_ORG)).toBeCloseTo(
      before + (w.bought + w.sold) / STANDING_TRADE_COINS_PER_POINT,
    )
  })

  it('turns down what is no swap', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = {}
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 5 })).toBe(
      'none of that good to give',
    )
    p1.carried = { wood: 5 }
    expect(swap(world, queue, { give: 'wood', want: 'wood', units: 5 })).toBe(
      'a swap takes two different goods',
    )
    expect(swap(world, queue, { give: 'coins', want: 'wood', units: 5 })).toBe(
      'not goods that can be swapped',
    )
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 1.5 })).toBe(
      'units must be a whole number',
    )
    p1.x = warehouse.x + 20
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 5 })).toBe(
      'not at a Trade Org warehouse or an NPC city’s storage',
    )
  })

  it('swaps nothing with a realm the Trade Organization has come to refuse', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { wood: 20 }
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 5 })).toBe('ack')
    changeStanding(world, TRADE_ORG, 'r1', -1000)
    run(world)
    expect(p1.carried).toEqual({ wood: 20 })
    expect(warehouse.stock!.stone).toBe(50)
  })
})

describe('a swap with an NPC city', () => {
  it('swaps its surplus for what it is short of, at its prices', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    // Short of wood, with stone over its reserve and coins enough.
    storage.stock = { stone: (reserve.stone ?? 0) + 20, wood: 0, coins: 500 }
    p1.carried = { wood: 20 }
    const prices = npcCityPrices(world, npc, 'r1')
    expect(prices.find((p) => p.good === 'wood')!.wanted).toBeGreaterThan(0)
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2 })).toBe('ack')
    run(world)
    expect(p1.carried.stone).toBe(2)
    expect(p1.carried.wood ?? 0).toBeLessThan(20)
    expect(storage.stock.stone).toBe((reserve.stone ?? 0) + 18)
    expect(world.events.at(-1)).toMatchObject({ kind: 'swapped', place: 'storage', units: 2 })
    expect(standingOf(world, 'r1', 'npc')).toBeGreaterThan(0)
  })

  it('raises standing both ways by an NPC city’s own number, and the log says how far', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    storage.stock = { stone: (reserve.stone ?? 0) + 20, wood: 0, coins: 500 }
    p1.carried = { wood: 20 }
    const q = quoteNpcSwap(
      world,
      npc,
      storage,
      { stock: p1.carried, room: 100 },
      'wood',
      'stone',
      2,
      'r1',
    )
    swap(world, queue, { give: 'wood', want: 'stone', units: 2 })
    run(world)
    const raised = (q.bought + q.sold) / STANDING_NPC_TRADE_COINS_PER_POINT
    expect(raised).toBeGreaterThan(0)
    expect(standingOf(world, 'npc', 'r1')).toBeCloseTo(raised, 2)
    expect(standingOf(world, 'r1', 'npc')).toBeCloseTo(raised, 2)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'swapped',
      standing: { org: 'npc', name: npc.name, by: Math.round(raised * 100) / 100 },
    })
  })

  it('refuses a good it isn’t short of', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    storage.stock = { stone: (reserve.stone ?? 0) + 20, wood: reserve.wood ?? 0, coins: 500 }
    p1.carried = { wood: 20 }
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2 })).toBe(
      'Dunmere isn’t short of that good',
    )
    expect(p1.order).toBeNull()
  })

  it('refuses to part with what it has no surplus of', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    storage.stock = { stone: reserve.stone ?? 0, coins: 500 }
    p1.carried = { wood: 20 }
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2 })).toBe(
      'Dunmere has none of that good to spare',
    )
  })

  it('is cut down to what it lacks of its reserve and its surplus, and keeps its reserve', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    // It lacks only so much wood of its reserve: that is all it takes.
    expect(reserve.wood).toBeGreaterThan(6)
    storage.stock = { stone: (reserve.stone ?? 0) + 20, wood: reserve.wood! - 6, coins: 500 }
    p1.carried = { wood: 20 }
    const holder = { stock: p1.carried, room: 1e6 }
    expect(quoteNpcSwap(world, npc, storage, holder, 'wood', 'stone', 20, 'r1').limit).toBe(
      'unwanted',
    )
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 20 })).toBe('ack')
    run(world)
    expect(p1.carried.wood).toBeGreaterThanOrEqual(14)
    expect(p1.carried.stone).toBeGreaterThan(0)
    expect(p1.carried.stone).toBeLessThan(20)
    expect(storage.stock.wood).toBeLessThanOrEqual(reserve.wood!)
    expect(storage.stock.stone).toBeGreaterThanOrEqual(reserve.stone ?? 0)
    expect(tradesOf(world).at(-1)!.keptReserve).toBe(true)
  })

  it('moves nothing when what it lacks can’t pay for a single unit', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    // One wood fetches less than one stone costs, and it takes no more than one.
    storage.stock = { stone: (reserve.stone ?? 0) + 20, wood: reserve.wood! - 1, coins: 500 }
    p1.carried = { wood: 20 }
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 1 })).toBe('ack')
    run(world)
    expect(p1.carried).toEqual({ wood: 20 })
    expect(world.events.at(-1)).toMatchObject({ kind: 'swapped', units: 0, gave: 0, wanted: 1 })
  })

  it('swaps nothing once it refuses the realm', () => {
    const { world, npc, storage, p1, queue } = npcCity()
    const reserve = npcReserve(world, npc)
    storage.stock = { stone: (reserve.stone ?? 0) + 20, coins: 500 }
    p1.carried = { wood: 20 }
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2 })).toBe('ack')
    changeStanding(world, 'npc', 'r1', -1000)
    run(world)
    expect(p1.carried).toEqual({ wood: 20 })
    expect(swap(world, queue, { give: 'wood', want: 'stone', units: 2 })).toBe(
      'Dunmere won’t trade with you',
    )
  })
})

describe('an NPC city’s rates', () => {
  const line = (
    good: 'wood' | 'stone' | 'iron' | 'food',
    forSale: number,
    wanted: number,
    buy: number,
    sell: number,
  ) => ({ good, forSale, wanted, buy, sell })

  it('sets each good it is short of against each it has spare, in small whole units', () => {
    const rates = npcSwapRates([
      line('wood', 0, 9, 4, 6),
      line('iron', 0, 9, 20, 30),
      line('food', 10, 0, 1, 3),
      line('stone', 10, 0, 5, 9),
    ])
    expect(rates).toEqual([
      // A wood fetches 4 and a food costs 3; a stone costs 9, so it takes 3 wood, rounded up.
      { give: 'wood', gives: 1, want: 'food', units: 1 },
      { give: 'wood', gives: 3, want: 'stone', units: 1 },
      // An iron fetches 20: that pays for 6 food or 2 stone.
      { give: 'iron', gives: 1, want: 'food', units: 6 },
      { give: 'iron', gives: 1, want: 'stone', units: 2 },
    ])
  })

  it('stays within what it has spare and what it is short of', () => {
    // One iron would pay for 6 food, but it has only 2 to spare.
    expect(npcSwapRates([line('iron', 0, 9, 20, 30), line('food', 2, 0, 1, 3)])).toEqual([
      { give: 'iron', gives: 1, want: 'food', units: 2 },
    ])
    // A stone takes 3 wood and it lacks only 2: no swap of them can go, so no rate.
    expect(npcSwapRates([line('wood', 0, 2, 4, 6), line('stone', 10, 0, 5, 9)])).toEqual([])
    // Less than a whole unit either way is nothing to swap.
    expect(npcSwapRates([line('wood', 0, 0.5, 4, 6), line('food', 10, 0, 1, 3)])).toEqual([])
    expect(npcSwapRates([line('wood', 0, 9, 4, 6), line('food', 0.5, 0, 1, 3)])).toEqual([])
  })

  it('has none when nothing is spare or nothing is short', () => {
    const { world, npc, storage } = npcCity()
    const reserve = npcReserve(world, npc)
    const rates = () => npcSwapRates(npcCityPrices(world, npc, 'r1'))
    // Holding nothing, it is short of everything it keeps and has nothing to spare.
    expect(rates()).toEqual([])
    // Exactly its reserve of everything, and a surplus of nothing.
    storage.stock = { ...reserve }
    expect(rates()).toEqual([])
    // A surplus, with nothing it is short of.
    storage.stock = { ...reserve, stone: (reserve.stone ?? 0) + 20 }
    expect(rates()).toEqual([])
  })

  it('comes from its stock and goes as a swap does, keeping nothing new', () => {
    const { world, npc, storage } = npcCity()
    const reserve = npcReserve(world, npc)
    // At its reserve of everything but wood, which it is short of, and stone, which it has spare.
    storage.stock = { ...reserve, wood: 0, stone: (reserve.stone ?? 0) + 20, coins: 500 }
    const before = JSON.stringify(world)
    const prices = npcCityPrices(world, npc, 'r1')
    const rates = npcSwapRates(prices)
    expect(JSON.stringify(world)).toBe(before)
    // Wood is all it is short of. Holding its weapons, it needs less iron too, so that is spare.
    expect(rates.map((r) => r.give)).toEqual(rates.map(() => 'wood'))
    const rate = rates.find((r) => r.want === 'stone')!
    const wood = prices.find((p) => p.good === 'wood')!
    const stone = prices.find((p) => p.good === 'stone')!
    expect(rate.gives * wood.buy).toBeGreaterThanOrEqual(rate.units * stone.sell)
    const holder = { stock: { wood: 100 }, room: 1e6 }
    const quote = quoteNpcSwap(world, npc, storage, holder, 'wood', 'stone', rate.units, 'r1')
    expect(quote.units).toBe(rate.units)
    expect(quote.gives).toBeGreaterThanOrEqual(rate.gives)
  })
})

describe('a swap keeps every good (ADR 0004)', () => {
  it('creates and loses nothing, and the invariant catches a swap that does', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { wood: 20 }
    const coinsBefore = warehouse.stock!.coins!
    swap(world, queue, { give: 'wood', want: 'stone', units: 5 })
    run(world)
    expect(tradesKeepGoods.check(world, terrain)).toEqual([])
    const total = (g: 'wood' | 'stone' | 'coins') =>
      (p1.carried[g] ?? 0) + (warehouse.stock![g] ?? 0)
    expect(total('wood')).toBe(70)
    expect(total('stone')).toBe(50)
    expect(total('coins')).toBe(coinsBefore)
    const record = tradesOf(world).at(-1)!
    record.after = { ...record.after, stone: (record.after.stone ?? 0) + 1 }
    expect(tradesKeepGoods.check(world, terrain).map((v) => v.invariant)).toEqual([
      'trades-keep-goods',
    ])
  })
})
