import {
  GOODS,
  HQ_COIN_WAREHOUSE,
  HQ_FLOOR_FACTOR,
  PRICED_GOODS,
  TICKS_PER_GAME_DAY,
  Terrain,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  priceFor,
  stockFloor,
  tileIndex,
  townHallOf,
  warehouseKeeps,
  warehousePrices,
  type Building,
  type ResourceKind,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { tallyGoods, takeMade } from './goods-made.js'
import { checkInvariants, goodsOnlyFromNothingAtTheFloor } from './invariants.js'
import { mulberry32 } from './residents.js'
import { stepStockFloor } from './stock-floor.js'
import { worldWithCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side, with one node of each kind. */
function plains(size: number, nodes: [ResourceKind, number, number][]) {
  const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
  for (const [kind, x, y] of nodes) {
    terrain.tiles[tileIndex(size, x, y)] = kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = nodes.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  return { world, terrain }
}

/** A trading post alone on a small map, and its warehouse. */
function post() {
  const { world, terrain } = plains(64, [['stone', 40, 20]])
  const city = foundTradingPost(world, terrain, 20, 20, 'stone', mulberry32(3))
  const warehouse = world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!
  return { world, terrain, city, warehouse }
}

/** The Trade Org HQ alone on a map, and its coin and goods warehouses. */
function hq() {
  const mid = 80
  const { world, terrain } = plains(160, [
    ['forest', mid + 20, mid],
    ['stone', mid + 20, mid + 3],
    ['ironOre', mid + 22, mid - 3],
    ['goldOre', mid + 24, mid],
  ])
  const city = foundTradeOrgHq(world, terrain, mid, mid, mulberry32(7))
  const hall = townHallOf(world, city)!
  const warehouses = world.buildings.filter((b) => b.kind === 'warehouse')
  const isCoins = (b: Building) =>
    b.x === hall.x + HQ_COIN_WAREHOUSE.dx && b.y === hall.y + HQ_COIN_WAREHOUSE.dy
  return {
    world,
    terrain,
    coins: warehouses.find(isCoins)!,
    goods: warehouses.find((b) => !isCoins(b))!,
  }
}

/** Steps the world to the last tick of the current game day, where the floor tops up. */
function toDayEnd(world: WorldState) {
  world.tick =
    Math.floor(world.tick / TICKS_PER_GAME_DAY) * TICKS_PER_GAME_DAY + TICKS_PER_GAME_DAY - 1
}

describe('the stock floor', () => {
  it('is every good at a trading post, coins in the HQ coin warehouse and the rest in the other', () => {
    const p = post()
    expect(warehouseKeeps(p.world, p.warehouse)).toEqual(GOODS)
    expect(stockFloor(p.world, p.warehouse)).toEqual(WAREHOUSE_FLOOR)
    const h = hq()
    expect(stockFloor(h.world, h.coins)).toEqual({ coins: WAREHOUSE_FLOOR.coins * HQ_FLOOR_FACTOR })
    expect(Object.keys(stockFloor(h.world, h.goods))).toEqual(PRICED_GOODS)
    expect(stockFloor(h.world, h.goods).wood).toBe(WAREHOUSE_FLOOR.wood * HQ_FLOOR_FACTOR)
  })

  it('applies to Trade Org warehouses only', () => {
    const p = post()
    const storage = p.world.buildings.find((b) => b.kind === 'storage')!
    expect(stockFloor(p.world, storage)).toEqual({})
    // A warehouse whose city is gone belongs to nobody, and nobody else gets a floor (ADR 0003).
    expect(stockFloor(p.world, { ...p.warehouse, cityId: null })).toEqual({})
    expect(stockFloor(p.world, { ...p.warehouse, site: { delivered: {}, work: 0 } })).toEqual({})
  })

  it('tops up what is below the floor once a game day, and nothing else', () => {
    const { world, warehouse } = post()
    warehouse.stock = { wood: 3, stone: 500, coins: 10 }
    stepStockFloor(world)
    expect(warehouse.stock).toEqual({ wood: 3, stone: 500, coins: 10 })
    expect(takeMade(world)).toEqual({})
    toDayEnd(world)
    stepStockFloor(world)
    expect(warehouse.stock).toEqual({ ...WAREHOUSE_FLOOR, stone: 500 })
    const rest: Stock = { ...WAREHOUSE_FLOOR }
    delete rest.stone
    expect(takeMade(world)).toEqual({ ...rest, wood: rest.wood! - 3, coins: rest.coins! - 10 })
  })

  it('never adds people: residents and horses stay as they are', () => {
    const { world, warehouse } = post()
    warehouse.stock = {}
    const residents = world.residents.length
    const horses = world.horses.length
    toDayEnd(world)
    stepStockFloor(world)
    expect(world.residents).toHaveLength(residents)
    expect(world.horses).toHaveLength(horses)
  })

  it('tops up an emptied warehouse as the world steps', () => {
    const { world, terrain, warehouse } = post()
    warehouse.stock = {}
    toDayEnd(world)
    stepWorld(world, terrain)
    expect(warehouse.stock).toEqual(WAREHOUSE_FLOOR)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('warehouse prices', () => {
  it('sell at the base price at the reference stock and buy lower', () => {
    const { buy, sell } = priceFor('iron', 40, 10)
    expect(sell).toBe(WAREHOUSE_BASE_PRICE.iron)
    expect(buy).toBeLessThan(sell)
  })

  it('rise as stock falls and fall as it grows, within their range', () => {
    const sells = [0, 5, 10, 40, 160, 10_000].map((n) => priceFor('iron', n, 10).sell)
    for (let i = 1; i < sells.length; i++) expect(sells[i]).toBeLessThanOrEqual(sells[i - 1]!)
    expect(sells[0]).toBe(4 * WAREHOUSE_BASE_PRICE.iron)
    expect(sells.at(-1)).toBe(WAREHOUSE_BASE_PRICE.iron / 2)
  })

  it('always buy lower than they sell, in whole coins', () => {
    for (const good of PRICED_GOODS) {
      for (const stock of [0, 1, 7, 50, 999, 100_000]) {
        const { buy, sell } = priceFor(good, stock, WAREHOUSE_FLOOR[good])
        expect(Number.isInteger(buy) && Number.isInteger(sell)).toBe(true)
        expect(buy).toBeGreaterThanOrEqual(1)
        expect(buy).toBeLessThan(sell)
      }
    }
  })

  it('come from each warehouse’s own stock', () => {
    const a = post()
    const b = post()
    a.warehouse.stock = { iron: 1 }
    b.warehouse.stock = { iron: 1000 }
    const iron = (p: ReturnType<typeof post>) =>
      warehousePrices(p.world, p.warehouse).find((x) => x.good === 'iron')!
    expect(iron(a)).toMatchObject({ stock: 1 })
    expect(iron(a).sell).toBeGreaterThan(iron(b).sell)
  })

  it('cover every good but coins, and none at the HQ coin warehouse', () => {
    const p = post()
    expect(warehousePrices(p.world, p.warehouse).map((x) => x.good)).toEqual(PRICED_GOODS)
    const h = hq()
    expect(warehousePrices(h.world, h.coins)).toEqual([])
    expect(warehousePrices(h.world, h.goods).map((x) => x.good)).toEqual(PRICED_GOODS)
  })
})

/** Steps the world `ticks` times, checking that goods appear from nothing only at the floor. */
function stepChecked(world: WorldState, terrain: TerrainMap, ticks: number) {
  const walking = new Walking(terrain)
  const violations = []
  for (let t = 0; t < ticks; t++) {
    const before = tallyGoods(world)
    takeMade(world)
    stepWorld(world, terrain, walking)
    violations.push(...goodsOnlyFromNothingAtTheFloor(before, world, takeMade(world)))
  }
  return violations
}

describe('goods appear from nothing only at the floor', () => {
  it('holds while the HQ works, eats and tops up for days', () => {
    const { world, terrain, goods } = hq()
    goods.stock = {}
    expect(stepChecked(world, terrain, 3 * TICKS_PER_GAME_DAY)).toEqual([])
    expect(goods.stock.wood).toBeGreaterThanOrEqual(WAREHOUSE_FLOOR.wood * HQ_FLOOR_FACTOR)
  })

  it('holds while a starting city works its farm', () => {
    const { world, terrain } = worldWithCity()
    expect(stepChecked(world, terrain, TICKS_PER_GAME_DAY)).toEqual([])
  })

  it('catches goods that appear anywhere else', () => {
    const { world, terrain, warehouse } = post()
    const before = tallyGoods(world)
    stepWorld(world, terrain)
    warehouse.stock = { ...warehouse.stock, iron: (warehouse.stock?.iron ?? 0) + 5 }
    expect(goodsOnlyFromNothingAtTheFloor(before, world, {})).toEqual([
      {
        invariant: 'goods-only-from-nothing-at-the-floor',
        message: `5 iron appeared from nothing at tick ${world.tick}`,
        entityIds: [],
      },
    ])
  })
})
