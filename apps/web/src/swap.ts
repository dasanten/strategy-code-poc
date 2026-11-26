// Ported from packages/shared/src/swap.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { priceFor } from '@csp/lang-wasm'
import { stockFloor, tradeCoinWarehouse } from './warehouse.js'
import type {
  Building,
  PricedGood,
  SwapQuote,
  TradeHolder,
  TradeLimit,
  WorldState,
} from '@csp/shared-types'
import { cutSwap } from '@csp/lang-wasm'

/** A swap that moves nothing, and says why when `limit` is given. */
export function noSwap(limit?: TradeLimit): SwapQuote {
  const none = { units: 0, gives: 0, coins: 0, bought: 0, sold: 0 }
  return limit ? { ...none, limit } : none
}

/**
 * What a swap at a Trade Org warehouse would move (`CONTEXT.md`: Swap, Warehouse prices): each unit
 * priced as `quoteTrade` prices it, so the rate moves with the stock as it goes. A warehouse doesn't
 * part with the `owed` units it keeps for deliveries (`owedBy`). At the HQ the Coins back come from
 * its coin warehouse. Pure.
 */
export function quoteSwap(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  warehouse: Building,
  holder: TradeHolder,
  give: PricedGood,
  want: PricedGood,
  wanted: number,
  owed = 0,
): SwapQuote {
  const floor = stockFloor(world, warehouse)
  const giveFloor = floor[give]
  const wantFloor = floor[want]
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  if (giveFloor === undefined || wantFloor === undefined || !coinWarehouse) return noSwap()
  const giveStock = warehouse.stock?.[give] ?? 0
  const wantStock = warehouse.stock?.[want] ?? 0
  return cutSwap({
    give,
    want,
    wanted,
    holder,
    spare: wantStock - owed,
    takes: Infinity,
    placeCoins: coinWarehouse.stock?.coins ?? 0,
    wantPrice: (n) => priceFor(want, wantStock - (n - 1), wantFloor).sell,
    givePrice: (n) => priceFor(give, giveStock + n, giveFloor).buy,
  })
}
