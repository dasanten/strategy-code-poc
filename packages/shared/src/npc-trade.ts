import { commandsCarriage } from './alliance.js'
import {
  BUILD_MATERIALS,
  CITY_PRICE_STANDING_SWING,
  GOOD_WEIGHT,
  NPC_TRADE,
  STANDING_RANGE,
  WAREHOUSE_FLOOR,
  canWork,
  isArmed,
} from './balance.js'
import { cityFoodUse, forSale, npcCityRefuses } from './city.js'
import { covers, isAt } from './footprint.js'
import { standingOf } from './standing.js'
import {
  PRICED_GOODS,
  priceFor,
  type Price,
  type PricedGood,
  type TradeHolder,
  type TradeQuote,
  type TradeSide,
} from './warehouse.js'
import type { Building, City, Good, Resident, Stock, WorldState } from './world.js'

/*
 * Trading with and hiring from an NPC city (`CONTEXT.md`: Trading with an NPC city, Hiring from
 * an NPC city). Queries here are the game API that orders, scripts and the game's own NPC
 * behaviour share (ADR 0002); nothing moves.
 */

/** An NPC city's finished storages: where it trades and is paid for its residents. */
export function npcStorages(world: Pick<WorldState, 'buildings'>, city: City): Building[] {
  return world.buildings.filter((b) => b.cityId === city.id && b.kind === 'storage' && !b.site)
}

/**
 * The NPC city whose finished storage covers tile (x, y), with that storage: where a resident
 * there trades with it (`CONTEXT.md`: At a building). Undefined anywhere else, and at a storage
 * of a Player's city.
 */
export function npcTradingStorageAt(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  x: number,
  y: number,
): { city: City; storage: Building } | undefined {
  const storage = world.buildings.find((b) => b.kind === 'storage' && !b.site && covers(b, x, y))
  const city = storage && world.cities.find((c) => c.id === storage.cityId)
  return city && forSale(city) ? { city, storage: storage! } : undefined
}

/** What an NPC city's storages hold together. */
export function npcCityStock(world: Pick<WorldState, 'buildings'>, city: City): Stock {
  const sum: Stock = {}
  for (const b of npcStorages(world, city)) {
    for (const [good, n] of Object.entries(b.stock ?? {}) as [Good, number][]) {
      sum[good] = (sum[good] ?? 0) + n
    }
  }
  return sum
}

/**
 * The reserve an NPC city keeps (`CONTEXT.md`: Trading with an NPC city): Food for
 * `NPC_TRADE.reserveFoodDays` game days for all its residents, and the materials of a house and
 * `NPC_TRADE.reserveWallStretches` stretches of wall. Nothing of any other good. Whole units.
 */
export function npcCityReserve(world: WorldState, city: City): Stock {
  const reserve: Stock = {}
  const food = Math.ceil(cityFoodUse(world, city, NPC_TRADE.reserveFoodDays) - 1e-9)
  if (food > 0) reserve.food = food
  const add = (materials: Stock | undefined, times: number) => {
    for (const [good, n] of Object.entries(materials ?? {}) as [Good, number][]) {
      reserve[good] = (reserve[good] ?? 0) + n * times
    }
  }
  add(BUILD_MATERIALS.house, 1)
  add(BUILD_MATERIALS.wall, NPC_TRADE.reserveWallStretches)
  return reserve
}

/**
 * The floor an NPC city prices a good from, as a warehouse prices from its stock floor
 * (`priceFor`): its reserve of the good, or a trading post's floor (`WAREHOUSE_FLOOR`) when that
 * is more, so a good it barely keeps is not given away.
 */
function priceFloor(good: PricedGood, reserve: Stock): number {
  return Math.max(WAREHOUSE_FLOOR[good], reserve[good] ?? 0)
}

/**
 * How far an NPC city's standing toward the trader moves its prices (`CONTEXT.md`: Trading with
 * an NPC city): the share `CITY_PRICE_STANDING_SWING` × standing / `STANDING_RANGE`, as for its
 * own price (`cityPrice`). 0 without a trader.
 */
function standingSwing(
  world: Pick<WorldState, 'standings' | 'cities'>,
  city: City,
  traderId: string | null | undefined,
): number {
  if (traderId === null || traderId === undefined) return 0
  return (CITY_PRICE_STANDING_SWING * standingOf(world, city.id, traderId)) / STANDING_RANGE
}

/**
 * An NPC city's price for one unit of a good with `stock` of it in its storages (`CONTEXT.md`:
 * Trading with an NPC city): a warehouse's price from that stock (`priceFor`) and its floor,
 * then moved by its standing (`swing`): it sells for (1 − swing) of that and buys for (1 + swing),
 * always at least a coin lower than it sells. Whole coins.
 */
export function npcPriceFor(good: PricedGood, stock: number, reserve: Stock, swing: number): Price {
  const base = priceFor(good, stock, priceFloor(good, reserve))
  const sell = Math.max(2, Math.round(base.sell * (1 - swing)))
  const buy = Math.max(1, Math.min(sell - 1, Math.round(base.buy * (1 + swing))))
  return { buy, sell }
}

/** One line of an NPC city's prices: the good, what it holds, its price, and what it trades of it. */
export interface NpcCityPrice extends Price {
  good: PricedGood
  stock: number
  /** Units it would sell: what it holds above its reserve. */
  forSale: number
  /** Units it would buy: what it lacks of its reserve. */
  wanted: number
}

/**
 * An NPC city's prices to a trader (`CONTEXT.md`: Trading with an NPC city), every good but
 * coins, from what its storages hold together and its reserve; standing toward `traderId` moves
 * them. Empty for a city that is not an NPC city.
 */
export function npcCityPrices(
  world: WorldState,
  city: City,
  traderId?: string | null,
): NpcCityPrice[] {
  if (!forSale(city)) return []
  const stock = npcCityStock(world, city)
  const reserve = npcCityReserve(world, city)
  const swing = standingSwing(world, city, traderId)
  return PRICED_GOODS.map((good) => {
    const held = stock[good] ?? 0
    const keep = reserve[good] ?? 0
    return {
      good,
      stock: held,
      forSale: Math.max(0, held - keep),
      wanted: Math.max(0, keep - held),
      ...npcPriceFor(good, held, reserve, swing),
    }
  })
}

/**
 * What a trade of up to `wanted` units of a good with an NPC city at its `storage` would move
 * (`CONTEXT.md`: Trading with an NPC city), as `quoteTrade` at a warehouse: each unit at the
 * city's price as its stock stands with that unit in it, moved by its standing toward
 * `traderId`. Buying is cut down to its surplus, what its storages hold above the reserve, and
 * what this storage holds; selling to what it lacks of the reserve and the coins in this storage.
 * Either way to what the trader holds and what fits in the holder's room. Pure: nothing moves.
 */
export function quoteNpcTrade(
  world: WorldState,
  city: City,
  storage: Building,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
  traderId: string | null,
): TradeQuote {
  if (!forSale(city) || storage.cityId !== city.id) return { units: 0, coins: 0 }
  const total = npcCityStock(world, city)[good] ?? 0
  const reserve = npcCityReserve(world, city)
  const keep = reserve[good] ?? 0
  const swing = standingSwing(world, city, traderId)
  const here = storage.stock?.[good] ?? 0
  const coinStock = storage.stock?.coins ?? 0
  const held = holder.stock[good] ?? 0
  const heldCoins = holder.stock.coins ?? 0
  let units = 0
  let coins = 0
  while (units < wanted) {
    const n = units + 1
    if (side === 'sell') {
      if (n > held || total + n > keep) break
      const p = npcPriceFor(good, total + n, reserve, swing).buy
      const room = holder.room + n * GOOD_WEIGHT[good] - (coins + p) * GOOD_WEIGHT.coins
      if (coins + p > coinStock || room < -1e-9) break
      coins += p
    } else {
      if (n > here || total - n < keep) break
      const p = npcPriceFor(good, total - units, reserve, swing).sell
      const room = holder.room + (coins + p) * GOOD_WEIGHT.coins - n * GOOD_WEIGHT[good]
      if (coins + p > heldCoins || room < -1e-9) break
      coins += p
    }
    units = n
  }
  return { units, coins }
}

/**
 * Why a resident can't trade with an NPC city now, or undefined when they can (`CONTEXT.md`:
 * Trading with an NPC city): the resident stands on its finished storage, the city doesn't refuse
 * `realmId` (`npcCityRefuses`), the resident is grown up, the good is one it trades, `units` whole
 * and positive, with some of the good to sell or coins to buy, in their hands or on `carriageId`,
 * a carriage on their tile that `realmId` commands. No delivery (`cityId`): that is a Trade Org
 * service.
 */
export function npcTradeProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  side: TradeSide,
  good: unknown,
  units: unknown,
  carriageId: unknown,
  cityId: unknown = undefined,
): string | undefined {
  const at = npcTradingStorageAt(world, resident.x, resident.y)
  if (!at) return 'not at an NPC city’s storage'
  if (npcCityRefuses(world, at.city, realmId)) return `${at.city.name} won’t trade with you`
  if (!canWork(resident, world.tick)) return 'children can’t trade'
  if (!(PRICED_GOODS as readonly unknown[]).includes(good)) return 'not a good cities trade'
  if (!Number.isInteger(units) || (units as number) <= 0) return 'units must be a whole number'
  if (cityId !== null && cityId !== undefined) return 'only the Trade Organization delivers'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (!isAt(k, at.storage)) return 'that carriage is not at the storage'
    stock = k.load
  }
  if (side === 'sell' && !((stock[good as PricedGood] ?? 0) > 0)) return 'none of that good to sell'
  if (side === 'buy' && !((stock.coins ?? 0) > 0)) return 'no coins to buy with'
  return undefined
}

/**
 * What an NPC city asks for each resident it lends and game week (`CONTEXT.md`: Hiring from an
 * NPC city): `NPC_TRADE.pricePerResidentWeek`, moved by its standing toward the hirer like its
 * prices: the better, the less. At least a coin.
 */
export function npcHirePrice(
  world: Pick<WorldState, 'standings' | 'cities'>,
  city: City,
  hirerId: string,
): number {
  const swing = standingSwing(world, city, hirerId)
  return Math.max(1, Math.round(NPC_TRADE.pricePerResidentWeek * (1 - swing)))
}

/**
 * The residents an NPC city would lend now, in the order it lends them (`CONTEXT.md`: Hiring from
 * an NPC city): its living adults in no contract, offered or in force, but never its farmers, nor
 * so many that fewer than `NPC_TRADE.defenceShare` of its adults (rounded up) stay at home; its
 * soldiers (armed adults) are among those who stay. Idle adults go first, then workers from its
 * other workplaces, each by id. `except` is a contract whose residents count as free, for
 * checking that contract itself. Empty for a city that is not an NPC city.
 */
export function spareResidents(
  world: Pick<WorldState, 'residents' | 'contracts' | 'buildings' | 'cities' | 'tick'>,
  city: City,
  except?: string,
): Resident[] {
  if (!forSale(city)) return []
  const busy = new Set(world.contracts.filter((c) => c.id !== except).flatMap((c) => c.residentIds))
  const farms = new Set(world.buildings.filter((b) => b.kind === 'farm').map((b) => b.id))
  const farming = (r: Resident) => r.order?.kind === 'workAt' && farms.has(r.order.buildingId)
  const adults = world.residents.filter(
    (r) =>
      r.cityId === city.id &&
      r.owner === null &&
      r.health > 0 &&
      canWork(r, world.tick) &&
      !busy.has(r.id),
  )
  const farmers = adults.filter(farming).length
  const staying = Math.ceil(NPC_TRADE.defenceShare * adults.length - 1e-9)
  const working = (r: Resident) => (r.order?.kind === 'workAt' ? 1 : 0)
  const candidates = adults
    .filter((r) => !farming(r) && !isArmed(r))
    .sort((a, b) => working(a) - working(b) || a.id.localeCompare(b.id))
  return candidates.slice(0, Math.max(0, adults.length - farmers - staying))
}

/**
 * Why an NPC city turns down an ask for `count` of its residents, if it does (`CONTEXT.md`:
 * Hiring from an NPC city): it refuses the hirer, it can't spare that many, or `pricePerWeek` is
 * less than its asking price for them (`npcHirePrice`). `except` as for `spareResidents`.
 */
export function npcHireProblem(
  world: WorldState,
  city: City,
  hirerId: string,
  count: number,
  pricePerWeek: number,
  except?: string,
): string | undefined {
  if (!forSale(city)) return 'only NPC cities hire out their residents'
  if (npcCityRefuses(world, city, hirerId)) return `${city.name} won’t hire out to you`
  const spare = spareResidents(world, city, except).length
  if (spare < count) return `${city.name} can spare only ${spare} residents`
  const asks = count * npcHirePrice(world, city, hirerId)
  if (pricePerWeek < asks) return `${city.name} asks ${asks} coins a week for them`
  return undefined
}
