import { commandsCarriage } from './alliance.js'
import {
  BUY_SHARE,
  CARRIAGE_CAPACITY,
  GOOD_WEIGHT,
  HQ_FLOOR_FACTOR,
  PRICE_ELASTICITY,
  PRICE_RANGE,
  PRICE_REFERENCE_FLOORS,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  canWork,
  carryCapacity,
  stockWeight,
} from './balance.js'
import { townHallOf } from './city.js'
import { KEEPS_GOODS } from './building.js'
import {
  GOODS,
  type Building,
  type Carriage,
  type Good,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

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

/** A good a warehouse prices: anything but coins. */
export type PricedGood = Exclude<Good, 'coins'>

/** Which way a trade goes, from the trader's side: they buy from or sell to the warehouse. */
export type TradeSide = 'buy' | 'sell'

/**
 * Where a Trade Org warehouse's coins are when someone trades there (`CONTEXT.md`: Warehouse,
 * Trading with the Trade Organization): a trading post's own warehouse, at the HQ its coin
 * warehouse. Undefined for a building that prices nothing, or when the HQ's coin warehouse is
 * gone.
 */
export function tradeCoinWarehouse(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
): Building | undefined {
  const keeps = warehouseKeeps(world, warehouse)
  if (!keeps.some((g) => g !== 'coins')) return undefined
  if (keeps.includes('coins')) return warehouse
  return world.buildings.find(
    (b) => b.cityId === warehouse.cityId && warehouseKeeps(world, b).includes('coins'),
  )
}

/**
 * The Trade Org warehouse a resident on tile (x, y) can trade at (`CONTEXT.md`: Trading with the
 * Trade Organization): a finished one that prices goods and has its coins at hand
 * (`tradeCoinWarehouse`).
 */
export function tradingWarehouseAt(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  x: number,
  y: number,
): Building | undefined {
  return world.buildings.find(
    (b) =>
      KEEPS_GOODS.includes(b.kind) &&
      b.x === x &&
      b.y === y &&
      tradeCoinWarehouse(world, b) !== undefined,
  )
}

/** What a trader trades with: the goods in their hands or on their carriage, and the room left, in kg. */
export interface TradeHolder {
  stock: Stock
  room: number
}

/** A resident's hands as a trade holder: what they carry and what more they could. */
export function handsOf(resident: Resident, tick: number): TradeHolder {
  return {
    stock: resident.carried,
    room: carryCapacity(resident, tick) - stockWeight(resident.carried),
  }
}

/** A carriage as a trade holder: its load and the room left on it (`CARRIAGE_CAPACITY`). */
export function loadOf(carriage: Carriage): TradeHolder {
  return { stock: carriage.load, room: CARRIAGE_CAPACITY - stockWeight(carriage.load) }
}

/** What a trade moves: `units` of the good one way, `coins` the other. */
export interface TradeQuote {
  units: number
  coins: number
}

/**
 * What a trade of up to `wanted` units of a good would move (`CONTEXT.md`: Trading with the Trade
 * Organization, Warehouse prices). Each unit goes at the warehouse's price as its stock stands
 * with that unit in it: bought at the sell price before it leaves, sold at the buy price once it
 * is in, so buying and selling back always costs coins. The trade is cut down to the units the
 * trader holds (selling) or the warehouse holds (buying), the coins the payer has, and what fits
 * in the holder's room. Pure: nothing moves.
 */
export function quoteTrade(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
): TradeQuote {
  const floor = stockFloor(world, warehouse)[good]
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  if (floor === undefined || !coinWarehouse) return { units: 0, coins: 0 }
  const coinStock = coinWarehouse.stock?.coins ?? 0
  const stock = warehouse.stock?.[good] ?? 0
  const held = holder.stock[good] ?? 0
  const heldCoins = holder.stock.coins ?? 0
  let units = 0
  let coins = 0
  while (units < wanted) {
    const n = units + 1
    if (side === 'sell') {
      if (n > held) break
      const p = priceFor(good, stock + n, floor).buy
      const room = holder.room + n * GOOD_WEIGHT[good] - (coins + p) * GOOD_WEIGHT.coins
      if (coins + p > coinStock || room < -1e-9) break
      coins += p
    } else {
      if (n > stock) break
      const p = priceFor(good, stock - units, floor).sell
      const room = holder.room + (coins + p) * GOOD_WEIGHT.coins - n * GOOD_WEIGHT[good]
      if (coins + p > heldCoins || room < -1e-9) break
      coins += p
    }
    units = n
  }
  return { units, coins }
}

/**
 * Why a resident can't trade at a warehouse now, or undefined when they can (`CONTEXT.md`:
 * Trading with the Trade Organization): grown up, on a Trade Org warehouse's tile that prices the
 * good, `units` whole and positive, with some of the good to sell or coins to buy, in their hands
 * or on `carriageId`, a carriage on their tile that `realmId` commands.
 */
export function tradeProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  side: TradeSide,
  good: unknown,
  units: unknown,
  carriageId: unknown,
): string | undefined {
  if (!canWork(resident, world.tick)) return 'children can’t trade'
  const warehouse = tradingWarehouseAt(world, resident.x, resident.y)
  if (!warehouse) return 'not on a Trade Org warehouse'
  if (!(PRICED_GOODS as readonly unknown[]).includes(good)) return 'not a good warehouses trade'
  if (stockFloor(world, warehouse)[good as PricedGood] === undefined) {
    return 'this warehouse doesn’t trade that good'
  }
  if (!Number.isInteger(units) || (units as number) <= 0) return 'units must be a whole number'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (k.x !== resident.x || k.y !== resident.y)
      return 'that carriage is not on the resident’s tile'
    stock = k.load
  }
  if (side === 'sell' && !((stock[good as PricedGood] ?? 0) > 0)) return 'none of that good to sell'
  if (side === 'buy' && !((stock.coins ?? 0) > 0)) return 'no coins to buy with'
  return undefined
}
