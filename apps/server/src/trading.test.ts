import {
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG,
  standingOf,
  CARRIAGE_CAPACITY,
  GOOD_WEIGHT,
  FOOTPRINT,
  HQ_COIN_WAREHOUSE,
  Terrain,
  carryCapacity,
  priceFor,
  stockFloor,
  stockWeight,
  tileIndex,
  townHallOf,
  type Building,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { tallyGoods, takeMade } from './goods-made.js'
import { checkInvariants, goodsOnlyFromNothingAtTheFloor } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { tradesKeepGoods, tradesOf } from './trading.js'
import { createWorld, stepWorld } from './world.js'

const trader = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** An open map of Plains, `size` tiles along each side, with the given resource nodes. */
function plains(size: number, nodes: [ResourceKind, number, number][]) {
  const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
  for (const [kind, x, y] of nodes) {
    terrain.tiles[tileIndex(size, x, y)] = kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = nodes.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  return { world, terrain }
}

/**
 * A trading post and its warehouse, realm r1 (Player 7) with its Leader a1 far away, and r1's p1
 * standing on the warehouse.
 */
function post() {
  const { world, terrain } = plains(128, [['stone', 70, 40]])
  const city = foundTradingPost(world, terrain, 20, 20, 'stone', mulberry32(3))
  const warehouse = world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!
  resident(world, 'a1', 110, 110)
  const p1 = resident(world, 'p1', warehouse.x, warehouse.y)
  return { world, terrain, warehouse, p1, queue: new OrderQueue(undefined, terrain) }
}

function resident(world: WorldState, id: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
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

/** Sends an order from the trader, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, trader, 'q', { residentId: 'p1', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world once, keeping residents fed, and checks every invariant. */
function run(world: WorldState, terrain: TerrainMap) {
  for (const r of world.residents) r.hunger = 100
  const before = tallyGoods(world)
  takeMade(world)
  stepWorld(world, terrain)
  expect(checkInvariants(world, terrain)).toEqual([])
  expect(goodsOnlyFromNothingAtTheFloor(before, world, takeMade(world))).toEqual([])
}

/** What `units` units sold into (or bought out of) a warehouse holding `stock` come to. */
function sum(units: number, price: (n: number) => number) {
  let coins = 0
  for (let n = 1; n <= units; n++) coins += price(n)
  return coins
}

describe('trading at a warehouse', () => {
  it('sells: the goods go into the warehouse and its buy price per unit into the hands', () => {
    const { world, terrain, warehouse, p1, queue } = post()
    p1.carried = { iron: 10 }
    const stock = warehouse.stock!.iron ?? 0
    const coins = warehouse.stock!.coins!
    const floor = stockFloor(world, warehouse).iron!
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 4 })).toBe('ack')
    run(world, terrain)
    const paid = sum(4, (n) => priceFor('iron', stock + n, floor).buy)
    expect(paid).toBeGreaterThan(0)
    expect(p1.carried).toEqual({ iron: 6, coins: paid })
    expect(warehouse.stock!.iron).toBe(stock + 4)
    expect(warehouse.stock!.coins).toBe(coins - paid)
    expect(p1.order).toBe(null)
    // The trade raises standing both ways with the Trade Organization, by the coins it moved.
    const raised = paid / STANDING_TRADE_COINS_PER_POINT
    expect(standingOf(world, TRADE_ORG, 'r1')).toBeCloseTo(raised, 2)
    expect(standingOf(world, 'r1', TRADE_ORG)).toBeCloseTo(raised, 2)
    // Named by any of its cities, the Trade Organization is one.
    expect(standingOf(world, warehouse.cityId!, 'r1')).toBeCloseTo(raised, 2)
  })

  it('buys: the coins go into the warehouse and the goods into the hands at its sell price', () => {
    const { world, terrain, warehouse, p1, queue } = post()
    p1.carried = { coins: 500 }
    const stock = warehouse.stock!.wood!
    const coins = warehouse.stock!.coins!
    const floor = stockFloor(world, warehouse).wood!
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 3 })).toBe('ack')
    run(world, terrain)
    const cost = sum(3, (n) => priceFor('wood', stock - n + 1, floor).sell)
    expect(p1.carried).toEqual({ coins: 500 - cost, wood: 3 })
    expect(warehouse.stock!.wood).toBe(stock - 3)
    expect(warehouse.stock!.coins).toBe(coins + cost)
  })

  it('cuts a purchase down to what fits in their hands, and to the coins they have', () => {
    const { world, terrain, warehouse, p1, queue } = post()
    p1.carried = { coins: 1_000 }
    warehouse.stock!.stone = 10_000
    order(world, queue, { kind: 'buy', good: 'stone', units: 10_000 })
    run(world, terrain)
    const stone = p1.carried.stone!
    expect(stone).toBeGreaterThan(0)
    expect(stone).toBeLessThan(10_000)
    expect(stockWeight(p1.carried)).toBeLessThanOrEqual(carryCapacity(p1, world.tick))
    // One more stone would not have fitted.
    expect(stockWeight(p1.carried) + GOOD_WEIGHT.stone).toBeGreaterThan(
      carryCapacity(p1, world.tick),
    )

    const poor = post()
    poor.p1.carried = { coins: 5 }
    order(poor.world, poor.queue, { kind: 'buy', good: 'iron', units: 10 })
    run(poor.world, poor.terrain)
    expect(poor.p1.carried).toEqual({ coins: 5 })
  })

  it('cuts a sale down to what they hold and to the coins the warehouse has', () => {
    const { world, terrain, p1, queue } = post()
    p1.carried = { iron: 3 }
    order(world, queue, { kind: 'sell', good: 'iron', units: 50 })
    run(world, terrain)
    expect(p1.carried.iron).toBeUndefined()
    expect(p1.carried.coins).toBeGreaterThan(0)

    const broke = post()
    broke.p1.carried = { iron: 3 }
    broke.warehouse.stock!.coins = 0
    order(broke.world, broke.queue, { kind: 'sell', good: 'iron', units: 3 })
    run(broke.world, broke.terrain)
    expect(broke.p1.carried).toEqual({ iron: 3 })
    expect(broke.world.events.at(-1)).toMatchObject({ kind: 'traded', units: 0, wanted: 3 })
  })

  it('logs each trade in the realm log', () => {
    const { world, terrain, warehouse, p1, queue } = post()
    p1.carried = { iron: 10 }
    order(world, queue, { kind: 'sell', good: 'iron', units: 2 })
    run(world, terrain)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'traded',
      residentId: 'p1',
      side: 'sell',
      good: 'iron',
      units: 2,
      wanted: 2,
      coins: p1.carried.coins,
      x: warehouse.x,
      y: warehouse.y,
      userId: 7,
    })
  })

  it('trades from and into a carriage of theirs on the tile', () => {
    const { world, terrain, warehouse, p1, queue } = post()
    const load = { stone: 100 }
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: warehouse.x,
      y: warehouse.y,
      horseId: null,
      load,
    })
    const stock = warehouse.stock!.stone!
    expect(order(world, queue, { kind: 'sell', good: 'stone', units: 100, carriageId: 'k1' })).toBe(
      'ack',
    )
    run(world, terrain)
    const k = world.carriages[0]!
    expect(k.load.stone).toBeUndefined()
    expect(k.load.coins).toBeGreaterThan(0)
    expect(warehouse.stock!.stone).toBe(stock + 100)
    expect(p1.carried).toEqual({})
    expect(stockWeight(k.load)).toBeLessThanOrEqual(CARRIAGE_CAPACITY)
  })

  it('at the HQ, takes and pays coins from its coin warehouse', () => {
    const mid = 320
    const { world, terrain } = plains(640, [
      ['forest', mid + 80, mid],
      ['stone', mid + 80, mid + 12],
      ['ironOre', mid + 88, mid - 12],
      ['goldOre', mid + 96, mid],
    ])
    const city = foundTradeOrgHq(world, terrain, mid, mid, mulberry32(7))
    const hall = townHallOf(world, city)!
    const isCoins = (b: Building) =>
      b.x === hall.x + HQ_COIN_WAREHOUSE.dx && b.y === hall.y + HQ_COIN_WAREHOUSE.dy
    const warehouses = world.buildings.filter((b) => b.kind === 'warehouse')
    const coins = warehouses.find(isCoins)!
    const goods = warehouses.find((b) => !isCoins(b))!
    resident(world, 'a1', 10, 10)
    const p1 = resident(world, 'p1', goods.x, goods.y)
    p1.carried = { iron: 5 }
    const queue = new OrderQueue(undefined, terrain)
    const before = coins.stock!.coins!
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 5 })).toBe('ack')
    run(world, terrain)
    expect(p1.carried.iron).toBeUndefined()
    expect(coins.stock!.coins).toBe(before - p1.carried.coins!)
    expect(goods.stock!.coins).toBeUndefined()

    // Its coin warehouse prices nothing: nobody trades on it.
    p1.x = coins.x
    p1.y = coins.y
    p1.carried = { iron: 5 }
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 5 })).toBe(
      'not at a Trade Org warehouse',
    )
  })

  it('always costs coins to buy and sell back, or sell and buy back', () => {
    const { world, terrain, p1, queue } = post()
    for (const good of ['food', 'iron', 'goldOre'] as const) {
      p1.carried = { coins: 2_000 }
      order(world, queue, { kind: 'buy', good, units: 5 })
      run(world, terrain)
      const bought = p1.carried[good]!
      order(world, queue, { kind: 'sell', good, units: bought })
      run(world, terrain)
      expect(p1.carried.coins).toBeLessThan(2_000)

      p1.carried = { [good]: 5 }
      order(world, queue, { kind: 'sell', good, units: 5 })
      run(world, terrain)
      order(world, queue, { kind: 'buy', good, units: 5 })
      run(world, terrain)
      expect(p1.carried[good] ?? 0).toBeLessThan(5)
    }
  })

  it('rejects trades off a warehouse, by children, of unknown goods and with others’ carriages', () => {
    const { world, warehouse, p1, queue } = post()
    p1.carried = { iron: 2, coins: 50 }
    expect(order(world, queue, { kind: 'sell', good: 'coins', units: 1 })).toBe(
      'not a good warehouses trade',
    )
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 0 })).toBe(
      'units must be a whole number',
    )
    expect(order(world, queue, { kind: 'sell', good: 'wood', units: 1 })).toBe(
      'none of that good to sell',
    )
    world.carriages.push({
      id: 'k2',
      realmId: 'r2',
      cityId: null,
      x: warehouse.x,
      y: warehouse.y,
      horseId: null,
      load: { iron: 5 },
    })
    expect(order(world, queue, { kind: 'sell', good: 'iron', units: 1, carriageId: 'k2' })).toBe(
      'not one of your carriages',
    )
    p1.bornAt = world.tick
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 1 })).toBe(
      'children can’t trade',
    )
    p1.bornAt = -20 * 24 * 3600
    p1.x += FOOTPRINT.warehouse
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 1 })).toBe(
      'not at a Trade Org warehouse',
    )
  })

  it('has an invariant that a trade never creates or destroys goods or coins', () => {
    const { world, terrain, p1, queue } = post()
    p1.carried = { iron: 4 }
    order(world, queue, { kind: 'sell', good: 'iron', units: 4 })
    run(world, terrain)
    expect(tradesOf(world)).toHaveLength(1)
    expect(tradesKeepGoods.check(world, terrain)).toEqual([])
    tradesOf(world)[0]!.after.coins! += 1
    expect(tradesKeepGoods.check(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'trades-keep-goods', entityIds: ['p1'] }),
    ])
  })
})
