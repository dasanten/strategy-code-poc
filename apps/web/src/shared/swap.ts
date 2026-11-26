// Ported from packages/shared/src/swap.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { GOOD_WEIGHT } from './narrowed.js'
import { priceFor, stockFloor, tradeCoinWarehouse } from './warehouse.js'
import type {
  Building,
  PricedGood,
  SwapQuote,
  TradeHolder,
  TradeLimit,
  WorldState,
} from '@csp/shared-types'

export { npcSwapRates } from '@csp/lang-wasm'

/** A swap that moves nothing, and says why when `limit` is given. */
export function noSwap(limit?: TradeLimit): SwapQuote {
  const none = { units: 0, gives: 0, coins: 0, bought: 0, sold: 0 }
  return limit ? { ...none, limit } : none
}

/** What a place swaps on: the goods, what it will part with and take, and each unit's price. */
export interface SwapTerms {
  give: PricedGood
  want: PricedGood
  /** The units of `want` the trader asks for. */
  wanted: number
  holder: TradeHolder
  /** The units of `want` it will hand over. */
  spare: number
  /** The units of `give` it will take. */
  takes: number
  /** The Coins it has to give back. */
  placeCoins: number
  /** The price of the `n`th unit of `want` it hands over, from 1. */
  wantPrice: (n: number) => number
  /** What it pays for the `n`th unit of `give` it takes, from 1. */
  givePrice: (n: number) => number
}

/**
 * Works a swap out unit by unit (`CONTEXT.md`: Swap): each unit wanted adds its price to what is
 * owed, and the trader hands over units of the good they give until those pay for it, so what they
 * give is rounded up. What is over comes back in Coins as far as the place holds them. Cut down to
 * what the place can spare, what the trader holds, what the place takes and what fits, and says
 * which cut it (`limit`). Pure.
 */
export function cutSwap(terms: SwapTerms): SwapQuote {
  const { give, want, wanted, holder } = terms
  const held = holder.stock[give] ?? 0
  let best = noSwap()
  let bought = 0
  let sold = 0
  let gives = 0
  let limit: TradeLimit | undefined
  for (let n = 1; n <= wanted && !limit; n++) {
    if (n > terms.spare) {
      limit = 'stock'
      break
    }
    bought += terms.wantPrice(n)
    while (sold < bought && !limit) {
      const g = gives + 1
      if (g > held) limit = 'held'
      else if (g > terms.takes) limit = 'unwanted'
      else {
        sold += terms.givePrice(g)
        gives = g
      }
    }
    if (limit) break
    const coins = Math.min(sold - bought, terms.placeCoins)
    const room =
      holder.room + gives * GOOD_WEIGHT[give] - n * GOOD_WEIGHT[want] - coins * GOOD_WEIGHT.coins
    if (room < -1e-9) limit = 'room'
    else best = { units: n, gives, coins, bought, sold }
  }
  return limit ? { ...best, limit } : best
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
