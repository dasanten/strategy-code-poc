// Ported from packages/shared/src/swap.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { npcCityRefuses } from './city.js'
import { isAt } from './footprint.js'
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
import type {
  Building,
  City,
  PricedGood,
  Resident,
  SwapQuote,
  TradeHolder,
  TradeLimit,
  WorldState,
} from '@csp/shared-types'
import { cutSwap } from '@csp/lang-wasm'

export { type SwapTerms, cutSwap } from '@csp/lang-wasm'

export { npcSwapRates } from '@csp/lang-wasm'

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
