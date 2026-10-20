import {
  BUY_SHARE,
  HQ_FLOOR_FACTOR,
  PRICE_ELASTICITY,
  PRICE_RANGE,
  PRICE_REFERENCE_FLOORS,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
} from './balance.js'
import { townHallOf } from './city.js'
import { GOODS, type Building, type Good, type Stock, type WorldState } from './world.js'

/**
 * Where the Trade Org HQ's coin warehouse stands from its town hall (`CONTEXT.md`: Warehouse):
 * the HQ keeps its coins there and its other goods in its other warehouse.
 */
export const HQ_COIN_WAREHOUSE = { dx: 1, dy: -1 }

/** Goods other than coins: what a warehouse puts a price on. */
export const PRICED_GOODS = GOODS.filter((g): g is Exclude<Good, 'coins'> => g !== 'coins')

/**
 * The goods a finished Trade Org warehouse keeps (`CONTEXT.md`: Warehouse, Stock floor): a
 * trading post's every good, the HQ's coin warehouse its coins and its other warehouse every other
 * good. None for a warehouse that is not the Trade Organization's (its city gone) or for an HQ
 * warehouse whose town hall is not known.
 */
export function warehouseKeeps(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  b: Building,
): readonly Good[] {
  if (b.kind !== 'warehouse' || b.site || b.cityId === null) return []
  const city = world.cities.find((c) => c.id === b.cityId)
  if (city?.tradeOrg === 'post') return GOODS
  if (city?.tradeOrg !== 'hq') return []
  const hall = townHallOf(world, city)
  if (!hall) return []
  const coins = b.x === hall.x + HQ_COIN_WAREHOUSE.dx && b.y === hall.y + HQ_COIN_WAREHOUSE.dy
  return coins ? ['coins'] : PRICED_GOODS
}

/**
 * A warehouse's stock floor (`CONTEXT.md`: Stock floor, ADR 0003): `WAREHOUSE_FLOOR` of every
 * good it keeps (`warehouseKeeps`), `HQ_FLOOR_FACTOR` times that at the HQ. Goods only, never
 * people; empty for any building that is not a Trade Org warehouse.
 */
export function stockFloor(world: Pick<WorldState, 'cities' | 'buildings'>, b: Building): Stock {
  const keeps = warehouseKeeps(world, b)
  const hq = world.cities.find((c) => c.id === b.cityId)?.tradeOrg === 'hq'
  const floor: Stock = {}
  for (const g of keeps) floor[g] = WAREHOUSE_FLOOR[g] * (hq ? HQ_FLOOR_FACTOR : 1)
  return floor
}

/** What a warehouse pays for (`buy`) and asks for (`sell`) one unit of a good, in coins. */
export interface Price {
  buy: number
  sell: number
}

/**
 * A warehouse's price for one good from its own stock and floor (`CONTEXT.md`: Warehouse prices,
 * Price anchor): the base price at `PRICE_REFERENCE_FLOORS` floors of stock, rising as stock
 * falls and falling as it grows, within `PRICE_RANGE`. It buys at `BUY_SHARE` of that, always at
 * least a coin lower than it sells. Whole coins.
 */
export function priceFor(good: Exclude<Good, 'coins'>, stock: number, floor: number): Price {
  const base = WAREHOUSE_BASE_PRICE[good]
  const reference = Math.max(1, floor * PRICE_REFERENCE_FLOORS)
  const factor = Math.min(
    PRICE_RANGE.max,
    Math.max(PRICE_RANGE.min, (reference / Math.max(1, stock)) ** PRICE_ELASTICITY),
  )
  const sell = Math.max(2, Math.round(base * factor))
  const buy = Math.max(1, Math.min(sell - 1, Math.floor(sell * BUY_SHARE)))
  return { buy, sell }
}

/** One line of a warehouse's prices: the good, how much it holds and its price. */
export interface WarehousePrice extends Price {
  good: Exclude<Good, 'coins'>
  stock: number
}

/**
 * A Trade Org warehouse's prices (`CONTEXT.md`: Warehouse prices): every good it keeps but coins,
 * from its own stock. Empty for a building that is not one, and for the HQ's coin warehouse.
 */
export function warehousePrices(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  b: Building,
): WarehousePrice[] {
  const floor = stockFloor(world, b)
  return PRICED_GOODS.filter((g) => floor[g] !== undefined).map((good) => {
    const stock = b.stock?.[good] ?? 0
    return { good, stock, ...priceFor(good, stock, floor[good]!) }
  })
}
