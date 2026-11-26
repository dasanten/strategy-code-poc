// Ported from packages/shared/src/trader-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { carriageCapacity } from './carriages.js'
import { tradeOrgRefuses } from './standing.js'
import { canWork } from './stats.js'
import { PRICED_GOODS } from './warehouse.js'
import type {
  Carriage,
  PricedGood,
  Resident,
  StandingTrader,
  TradeHolder,
  TradeQuote,
  TradeSide,
  Trader,
  TraderVisit,
  WorldState,
} from '@csp/shared-types'
import { quoteTraderTrade } from '@csp/lang-wasm'

export { traderPrices } from '@csp/lang-wasm'

export { quoteTraderTrade } from '@csp/lang-wasm'

export { traderStock } from '@csp/lang-wasm'

export { traderPriceFor } from '@csp/lang-wasm'

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
