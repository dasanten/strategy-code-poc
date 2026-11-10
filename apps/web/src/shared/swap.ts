// Ported from packages/shared/src/swap.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { npcCityRefuses } from './city.js'
import { isAt } from './footprint.js'
import { GOOD_WEIGHT } from './narrowed.js'
import {
  npcCityStock,
  npcPriceFor,
  npcReserve,
  npcTradingStorageAt,
  standingSwing,
} from './npc-trade.js'
import { tradeOrgRefuses } from './standing.js'
import { canWork } from './stats.js'
import {
  PRICED_GOODS,
  priceFor,
  stockFloor,
  tradeCoinWarehouse,
  tradingWarehouseAt,
} from './warehouse.js'
import { type WorldState } from './world.js'
import type {
  Building,
  City,
  NpcCityPrice,
  PricedGood,
  Resident,
  SwapQuote,
  SwapRate,
  TradeHolder,
  TradeLimit,
} from '@csp/shared-types'

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

/**
 * What a swap with an NPC city at its `storage` would move (`CONTEXT.md`: Swap, Trading with an NPC
 * city): each unit priced as `quoteNpcTrade` prices it, moved by its standing toward `traderId`. It
 * hands over only its surplus that this storage holds and takes only what it lacks of its reserve,
 * so it swaps only surplus for what it is short of. The Coins back come from this storage. Pure.
 */
export function quoteNpcSwap(
  world: WorldState,
  city: City,
  storage: Building,
  holder: TradeHolder,
  give: PricedGood,
  want: PricedGood,
  wanted: number,
  traderId: string | null,
): SwapQuote {
  if (storage.cityId !== city.id) return noSwap()
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  const swing = standingSwing(world, city, traderId)
  const giveStock = stock[give] ?? 0
  const wantStock = stock[want] ?? 0
  return cutSwap({
    give,
    want,
    wanted,
    holder,
    spare: Math.min(storage.stock?.[want] ?? 0, wantStock - (reserve[want] ?? 0)),
    takes: (reserve[give] ?? 0) - giveStock,
    placeCoins: storage.stock?.coins ?? 0,
    wantPrice: (n) => npcPriceFor(want, wantStock - (n - 1), reserve, swing).sell,
    givePrice: (n) => npcPriceFor(give, giveStock + n, reserve, swing).buy,
  })
}

/**
 * An NPC city's rates (`CONTEXT.md`: Swap): each good it is short of against each it has spare,
 * worked out from the prices it names, so nothing new is kept and the city plans nothing. A rate
 * goes in the smallest whole units its prices allow: the units of what it has spare that one unit
 * of what it is short of pays for, or the units of that good one unit of its spare costs, rounded
 * up as a swap is. It stays within what the city has spare; a pair it could not swap even once,
 * needing more than it is short of, has no rate. Pure.
 */
export function npcSwapRates(
  prices: readonly Pick<NpcCityPrice, 'good' | 'forSale' | 'wanted' | 'buy' | 'sell'>[],
): SwapRate[] {
  const spare = prices.filter((p) => p.forSale >= 1)
  return prices
    .filter((p) => p.wanted >= 1)
    .flatMap((give) =>
      spare.flatMap((want) => {
        const onePays = Math.floor(give.buy / want.sell)
        const gives = onePays >= 1 ? 1 : Math.ceil(want.sell / give.buy)
        if (gives > give.wanted) return []
        const units = Math.min(Math.max(onePays, 1), Math.floor(want.forSale))
        return [{ give: give.good, gives, want: want.good, units }]
      }),
    )
}

/**
 * Why a resident can't swap now, or undefined when they can (`CONTEXT.md`: Swap): they stand on a
 * Trade Org warehouse or an NPC city's storage that doesn't refuse `realmId`, are grown up, and
 * name two different goods it trades and a whole, positive number of units, with some of the good
 * they give in their hands or on `carriageId`, a carriage on their tile that `realmId` commands. An
 * NPC city must be short of what they give and have some of what they want to spare.
 */
export function swapProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  give: unknown,
  want: unknown,
  units: unknown,
  carriageId: unknown,
): string | undefined {
  const npc = npcTradingStorageAt(world, resident.x, resident.y)
  const warehouse = npc ? undefined : tradingWarehouseAt(world, resident.x, resident.y)
  const place = npc?.storage ?? warehouse
  if (!place) return 'not at a Trade Org warehouse or an NPC city’s storage'
  if (npc && npcCityRefuses(world, npc.city, realmId))
    return `${npc.city.name} won’t trade with you`
  if (!npc && tradeOrgRefuses(world, realmId)) return 'the Trade Organization won’t trade with you'
  if (!canWork(resident, world.tick)) return 'children can’t trade'
  const goods = PRICED_GOODS as readonly unknown[]
  if (!goods.includes(give) || !goods.includes(want)) return 'not goods that can be swapped'
  if (give === want) return 'a swap takes two different goods'
  const given = give as PricedGood
  const got = want as PricedGood
  if (warehouse) {
    const floor = stockFloor(world, warehouse)
    if (floor[given] === undefined || floor[got] === undefined) {
      return 'this warehouse doesn’t trade that good'
    }
  }
  if (!Number.isInteger(units) || (units as number) <= 0) return 'units must be a whole number'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (!isAt(k, place)) return 'that carriage is not there'
    stock = k.load
  }
  if (!((stock[given] ?? 0) > 0)) return 'none of that good to give'
  if (npc) {
    const held = npcCityStock(world, npc.city)
    const reserve = npcReserve(world, npc.city)
    if ((held[given] ?? 0) >= (reserve[given] ?? 0)) {
      return `${npc.city.name} isn’t short of that good`
    }
    if ((held[got] ?? 0) <= (reserve[got] ?? 0) || !((place.stock?.[got] ?? 0) > 0)) {
      return `${npc.city.name} has none of that good to spare`
    }
  }
  return undefined
}
