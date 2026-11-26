// Ported from packages/shared/src/trader-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { WAREHOUSE_FLOOR } from './narrowed.js'
import { stockWeight } from './stats.js'
import { quoteAtPrices } from './warehouse.js'
import { TRADER_FLOOR_SHARE } from '@csp/balance'
import type {
  PricedGood,
  Stock,
  TradeHolder,
  TradeQuote,
  TradeSide,
  Trader,
} from '@csp/shared-types'
import { traderStock } from '@csp/lang-wasm'

export { traderStock } from '@csp/lang-wasm'

export { traderPriceFor } from '@csp/lang-wasm'

/*
 * Trading with a wandering trader at a stop (`CONTEXT.md`: Trader stop). Queries here are the game
 * API that orders, scripts and the game's own NPC behaviour share (ADR 0002); nothing moves.
 */

/** What a wandering trader prices a good from: a share of a warehouse's floor. */
const traderFloor = (good: PricedGood) => WAREHOUSE_FLOOR[good] * TRADER_FLOOR_SHARE

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
