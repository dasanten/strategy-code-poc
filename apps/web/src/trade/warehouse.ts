// Trade Org warehouses and their quotes, as the city card shows them. Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import { townHallOf } from '../city/city.js'
import { GOOD_WEIGHT, WAREHOUSE_FLOOR } from '../world/narrowed.js'
import { GOODS } from '../world/world.js'
import { DELIVERY_LOAD, HQ_FLOOR_FACTOR, HQ_FOOD_FLOOR_FACTOR } from '@csp/balance'
import type {
  Building,
  DeliveryQuote,
  Good,
  PricedGood,
  Stock,
  TradeHolder,
  TradeQuote,
  TradeSide,
  WorldState,
} from '@csp/shared-types'
import { HQ_COIN_WAREHOUSE } from '@csp/shared-types'
import { priceFor, deliveryFee, quoteAtPrices } from '@csp/lang-wasm'

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
 * A warehouse's stock floor (`CONTEXT.md`: Stock floor, ADR 0003, ADR 0023): `WAREHOUSE_FLOOR` of
 * every good it keeps (`warehouseKeeps`), `HQ_FLOOR_FACTOR` times that at the HQ (of Food,
 * `HQ_FOOD_FLOOR_FACTOR`), where it tops up
 * (`stepStockFloor`); at a post it only says what its hands and carriages go for. Goods only, never
 * people; empty for any building that is not a Trade Org warehouse.
 */
export function stockFloor(world: Pick<WorldState, 'cities' | 'buildings'>, b: Building): Stock {
  const keeps = warehouseKeeps(world, b)
  const hq = world.cities.find((c) => c.id === b.cityId)?.tradeOrg === 'hq'
  const floor: Stock = {}
  const factor = (g: Good) => (!hq ? 1 : g === 'food' ? HQ_FOOD_FLOOR_FACTOR : HQ_FLOOR_FACTOR)
  // A good with no floor (the steel weapons and armour, T101.5) is not traded at a warehouse yet.
  for (const g of keeps) if (WAREHOUSE_FLOOR[g] > 0) floor[g] = WAREHOUSE_FLOOR[g] * factor(g)
  return floor
}

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
 * What a trade of up to `wanted` units of a good would move (`CONTEXT.md`: Trading with the Trade
 * Organization, Warehouse prices). Each unit goes at the warehouse's price as its stock stands
 * with that unit in it: bought at the sell price before it leaves, sold at the buy price once it
 * is in, so buying and selling back always costs coins. The trade is cut down to the units the
 * trader holds (selling) or the warehouse holds (buying), the coins the payer has, and what fits
 * in the holder's room, and says which of them cut it (`limit`). A warehouse doesn't sell the
 * `owed` units it keeps for deliveries (`owedBy`). Pure: nothing moves.
 */
export function quoteTrade(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
  owed = 0,
): TradeQuote {
  const floor = stockFloor(world, warehouse)[good]
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  if (floor === undefined || !coinWarehouse) return { units: 0, coins: 0 }
  const coinStock = coinWarehouse.stock?.coins ?? 0
  const stock = warehouse.stock?.[good] ?? 0
  return quoteAtPrices(stock, floor, coinStock, holder, side, good, wanted, owed)
}

/**
 * The storage of a city that deliveries go to and pick-ups come from (`CONTEXT.md`: Delivery):
 * its first finished one. Undefined when it has none.
 */
export function deliveryStorage(
  world: Pick<WorldState, 'buildings'>,
  cityId: string,
): Building | undefined {
  return world.buildings.find((b) => b.cityId === cityId && b.kind === 'storage' && !b.site)
}

const noDelivery: DeliveryQuote = { units: 0, coins: 0, fee: 0 }

/**
 * What buying up to `wanted` units of a good for delivery `tiles` away would take (`CONTEXT.md`:
 * Delivery): the units at the warehouse's prices, as `quoteTrade` buys them, and the fee for
 * their weight (`deliveryFee`), all paid from the `payer`'s coins. Cut down to what the payer
 * pays for, what the warehouse holds beyond the `owed` units it keeps for other deliveries, and
 * one delivery load (`DELIVERY_LOAD`). The goods stay in the warehouse until a caravan loads them. Pure.
 */
export function quoteDelivery(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
  payer: Stock,
  good: PricedGood,
  wanted: number,
  tiles: number,
  owed = 0,
): DeliveryQuote {
  const floor = stockFloor(world, warehouse)[good]
  if (floor === undefined || !tradeCoinWarehouse(world, warehouse)) return noDelivery
  const stock = warehouse.stock?.[good] ?? 0
  const held = payer.coins ?? 0
  let best = noDelivery
  let coins = 0
  for (let n = 1; n <= wanted; n++) {
    const kg = n * GOOD_WEIGHT[good]
    if (n > stock - owed || kg > DELIVERY_LOAD + 1e-9) break
    coins += priceFor(good, stock - (n - 1), floor).sell
    const fee = deliveryFee(kg, tiles)
    if (coins + fee > held) break
    best = { units: n, coins, fee }
  }
  return best
}

/**
 * What a pick-up of up to `wanted` units of a good `tiles` away would pay (`CONTEXT.md`:
 * Delivery): the units at the warehouse's prices, as `quoteTrade` sells them, less the fee for
 * their weight (`deliveryFee`). Cut down to the `held` units at the storage, one delivery load and
 * the `budget` of coins to pay with; none when the fee eats the whole price. Pure.
 */
export function quotePickUp(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
  good: PricedGood,
  wanted: number,
  held: number,
  tiles: number,
  budget: number,
): DeliveryQuote {
  const floor = stockFloor(world, warehouse)[good]
  if (floor === undefined || !tradeCoinWarehouse(world, warehouse)) return noDelivery
  const stock = warehouse.stock?.[good] ?? 0
  let best = noDelivery
  let price = 0
  for (let n = 1; n <= wanted; n++) {
    const kg = n * GOOD_WEIGHT[good]
    if (n > held || kg > DELIVERY_LOAD + 1e-9) break
    price += priceFor(good, stock + n, floor).buy
    const fee = deliveryFee(kg, tiles)
    if (price - fee > budget) break
    if (price > fee) best = { units: n, coins: price - fee, fee }
  }
  return best
}
