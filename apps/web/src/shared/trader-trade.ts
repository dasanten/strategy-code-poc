// Ported from packages/shared/src/trader-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { caravanFoodFor, carriageCapacity } from './carriages.js'
import { WAREHOUSE_FLOOR } from './narrowed.js'
import { tradeOrgRefuses } from './standing.js'
import { canWork, stockWeight } from './stats.js'
import { PRICED_GOODS, priceFor, quoteAtPrices, type Price } from './warehouse.js'
import { type TraderPrice, type WorldState } from './world.js'
import { TRADER_FLOOR_SHARE } from '@csp/balance'
import type {
  Carriage,
  PricedGood,
  Resident,
  StandingTrader,
  Stock,
  TradeHolder,
  TradeQuote,
  TradeSide,
  Trader,
  TraderVisit,
} from '@csp/shared-types'

/*
 * Trading with a wandering trader at a stop (`CONTEXT.md`: Trader stop). Queries here are the game
 * API that orders, scripts and the game's own NPC behaviour share (ADR 0002); nothing moves.
 */

type StopWorld = Pick<WorldState, 'traders' | 'carriages' | 'tick'>

/**
 * Where a wandering trader stands at a stop now, if it does (`CONTEXT.md`: Trader stop): it has
 * reached the stop's tile, its time there isn't up, and it still has a driver.
 */
export function traderStanding(world: StopWorld, t: Trader): StandingTrader | undefined {
  const s = t.stand
  if (!s || s.until === null || world.tick >= s.until || t.driverId === null) return undefined
  const k = world.carriages.find((c) => c.id === t.carriageId)
  if (!k || k.x !== s.x || k.y !== s.y) return undefined
  return { cityId: s.cityId, x: s.x, y: s.y, until: s.until }
}

/** The wandering trader standing at a stop on tile (x, y), if one is. */
export function traderStandingAt(world: StopWorld, x: number, y: number): Trader | undefined {
  return world.traders.find((t) => {
    const s = traderStanding(world, t)
    return s?.x === x && s.y === y
  })
}

/** The wandering traders standing at a realm's cities: their notices (`CONTEXT.md`: Trader stop). */
export function traderVisitsTo(
  world: StopWorld & Pick<WorldState, 'cities'>,
  realmId: string,
): TraderVisit[] {
  return world.traders.flatMap((t) => {
    const s = traderStanding(world, t)
    const city = s && world.cities.find((c) => c.id === s.cityId)
    return s && city?.realmId === realmId ? [{ ...s, traderId: t.id, city: city.name }] : []
  })
}

/** What a trader has to trade of its `load`: all of it but the Food its crew keep on board. */
export function traderStock(t: Pick<Trader, 'escortIds'>, load: Stock): Stock {
  const stock = { ...load }
  stock.food = Math.max(0, (load.food ?? 0) - caravanFoodFor(t.escortIds.length))
  return stock
}

/** What a wandering trader prices a good from: a share of a warehouse's floor. */
const traderFloor = (good: PricedGood) => WAREHOUSE_FLOOR[good] * TRADER_FLOOR_SHARE

/**
 * A wandering trader's price for one unit of a good with `stock` of it to trade (`CONTEXT.md`:
 * Trader stop): as a warehouse's (`priceFor`), buying lower than it sells.
 */
export function traderPriceFor(good: PricedGood, stock: number): Price {
  return priceFor(good, stock, traderFloor(good))
}

/** A wandering trader's prices for every good but coins, from what it has to trade. */
export function traderPrices(t: Pick<Trader, 'escortIds'>, carriage: Carriage): TraderPrice[] {
  const stock = traderStock(t, carriage.load)
  return PRICED_GOODS.map((good) => {
    const held = stock[good] ?? 0
    return { good, stock: held, ...traderPriceFor(good, held) }
  })
}

/**
 * What a trade of up to `wanted` units of a good with a wandering trader would move (`CONTEXT.md`:
 * Trader stop), as at a warehouse (`quoteTrade`): each unit priced as what it has to trade moves
 * (`traderStock`), the coins from and into its load, and what it takes in only as far as its
 * carriage holds (`capacity`). Pure: nothing moves.
 */
export function quoteTraderTrade(
  t: Pick<Trader, 'escortIds'>,
  load: Stock,
  capacity: number,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
): TradeQuote {
  const stock = traderStock(t, load)[good] ?? 0
  const room = Math.max(0, capacity - stockWeight(load))
  return quoteAtPrices(
    stock,
    traderFloor(good),
    load.coins ?? 0,
    holder,
    side,
    good,
    wanted,
    0,
    room,
  )
}

/** `quoteTraderTrade` on the world as it is: the room on its `carriage` goes by its horse. */
export function quoteWithTrader(
  world: Pick<WorldState, 'horses' | 'carriages'>,
  t: Pick<Trader, 'escortIds'>,
  carriage: Carriage,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
): TradeQuote {
  const capacity = carriageCapacity(world, carriage)
  return quoteTraderTrade(t, carriage.load, capacity, holder, side, good, wanted)
}

/**
 * Why a resident can't trade with a wandering trader now, or undefined when they can (`CONTEXT.md`:
 * Trader stop): `realmId` isn't refused by the Trade Organization (`CONTEXT.md`: Trade Org
 * reaction), the resident is grown up and on the tile of one standing at a stop, the good is one it
 * prices, `units` whole and positive, with some of the good to sell or coins to buy, in their hands
 * or on `carriageId`, a carriage on their tile that `realmId` commands. No delivery (`cityId`): that
 * is ordered at a warehouse.
 */
export function traderTradeProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  side: TradeSide,
  good: unknown,
  units: unknown,
  carriageId: unknown,
  cityId: unknown = undefined,
): string | undefined {
  if (tradeOrgRefuses(world, realmId)) return 'the Trade Organization won’t trade with you'
  if (!canWork(resident, world.tick)) return 'children can’t trade'
  if (!traderStandingAt(world, resident.x, resident.y)) return 'no wandering trader stands here'
  if (!(PRICED_GOODS as readonly unknown[]).includes(good)) return 'not a good traders trade'
  if (!Number.isInteger(units) || (units as number) <= 0) return 'units must be a whole number'
  if (cityId !== null && cityId !== undefined) return 'a wandering trader delivers nothing'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (k.x !== resident.x || k.y !== resident.y) return 'that carriage is not at the trader'
    stock = k.load
  }
  if (side === 'sell' && !((stock[good as PricedGood] ?? 0) > 0)) return 'none of that good to sell'
  if (side === 'buy' && !((stock.coins ?? 0) > 0)) return 'no coins to buy with'
  return undefined
}
