// Ported from packages/shared/src/npc-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { recipeFor } from './building.js'
import { cityFoodUse, cityResidents, forSale, npcCityRefuses } from './city.js'
import { covers, isAt } from './footprint.js'
import { horsesIn, ownsHorse } from './horses.js'
import { BUILD_MATERIALS, GOOD_WEIGHT, NPC_VILLAGE, WAREHOUSE_FLOOR } from './narrowed.js'
import { standingOf } from './standing.js'
import { canWork, isArmed } from './stats.js'
import { PRICED_GOODS, priceFor, type Price } from './warehouse.js'
import { WEAPONS, type Offer, type WorldState } from './world.js'
import {
  CITY_PRICE_STANDING_SWING,
  HORSE_FOOD_PER_DAY,
  NPC_FOUND_PARTY_MOST,
  NPC_FOUND_RESIDENTS_PER_MEMBER,
  NPC_FOUND_VILLAGE_RESIDENTS,
  NPC_FULL_DAYS,
  NPC_FULL_DAYS_LEAST,
  NPC_FULL_RESIDENTS_PER_DAY,
  NPC_HORSES_BASE,
  NPC_RESIDENTS_PER_HORSE,
  NPC_RESIDENTS_PER_NEEDS_STEP,
  NPC_SOLDIER_SHARE,
  NPC_TRADE,
  NPC_WAR_CHEST_PER_RESIDENT,
  STABLE_CAPACITY,
  STABLE_FEED_DAYS,
  STANDING_RANGE,
} from '@csp/balance'
import type {
  Building,
  City,
  Good,
  NpcCityPrice,
  PricedGood,
  Resident,
  Stock,
  TradeHolder,
  TradeQuote,
  TradeSide,
  Weapon,
} from '@csp/shared-types'

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

/** What an NPC city's smithy makes for its soldiers: the cheapest weapon (`RECIPES`). */
export const NPC_SMITHY_WEAPON: Weapon = 'spear'

/**
 * How many soldiers an NPC city keeps (`CONTEXT.md`: NPC city): `NPC_SOLDIER_SHARE` of its
 * adults, rounded up.
 */
export function npcSoldierTarget(adults: number): number {
  return Math.ceil(adults * NPC_SOLDIER_SHARE)
}

/**
 * Game days a full NPC city of `residents` waits before it founds (`CONTEXT.md`: Full city): a game
 * week up to `NPC_FOUND_VILLAGE_RESIDENTS`, a game day less for each `NPC_FULL_RESIDENTS_PER_DAY`
 * past that, and never less than `NPC_FULL_DAYS_LEAST`.
 */
export function npcFullDays(residents: number): number {
  const past = Math.max(0, residents - NPC_FOUND_VILLAGE_RESIDENTS)
  return Math.max(NPC_FULL_DAYS_LEAST, NPC_FULL_DAYS - past / NPC_FULL_RESIDENTS_PER_DAY)
}

/**
 * How many adults a full NPC city of `residents` sends to found a daughter (`CONTEXT.md`: Founding):
 * a village's worth up to `NPC_FOUND_VILLAGE_RESIDENTS`, one more for each
 * `NPC_FOUND_RESIDENTS_PER_MEMBER` past that, and never more than `NPC_FOUND_PARTY_MOST`.
 */
export function npcFoundingPartySize(residents: number): number {
  const past = Math.max(0, residents - NPC_FOUND_VILLAGE_RESIDENTS)
  const more = Math.floor(past / NPC_FOUND_RESIDENTS_PER_MEMBER)
  return Math.min(NPC_FOUND_PARTY_MOST, NPC_VILLAGE.residents + more)
}

/**
 * How many horses an NPC city wants for its size (`CONTEXT.md`: NPC horses): it breeds up to this
 * many. None for the Trade Organization's cities, which don't take part.
 */
export function npcHorsesWanted(world: Pick<WorldState, 'residents'>, city: City): number {
  if (city.tradeOrg) return 0
  const residents = cityResidents(world, city).length
  return Math.min(
    STABLE_CAPACITY,
    NPC_HORSES_BASE + Math.floor(residents / NPC_RESIDENTS_PER_HORSE),
  )
}

/** The Food an NPC city keeps in a stable (`CONTEXT.md`: NPC horses), for its own horses in it. */
export function npcStableKeep(world: Pick<WorldState, 'horses'>, city: City, stable: Building) {
  const own = horsesIn(world.horses, stable).filter((h) => ownsHorse({ cityId: city.id }, h))
  return own.length * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY
}

/**
 * The Food an NPC city's finished stables lack of what it keeps in them (`npcStableKeep`). What a
 * stable holds counts, so carrying Food from a storage to it leaves the city's surplus as it was.
 * The Trade Organization's cities don't take part (`CONTEXT.md`: NPC horses).
 */
export function npcStablesLack(
  world: Pick<WorldState, 'horses' | 'buildings'>,
  city: City,
): number {
  if (city.tradeOrg) return 0
  let lack = 0
  for (const b of world.buildings) {
    if (b.kind !== 'stable' || b.site || b.cityId !== city.id) continue
    lack += Math.max(0, npcStableKeep(world, city, b) - (b.stock?.food ?? 0))
  }
  return lack
}

/**
 * How many steps of a village's needs and crews an NPC city has (`CONTEXT.md`: NPC reserve, Spare
 * hands' work, NPC road): one for each `NPC_RESIDENTS_PER_NEEDS_STEP` residents, whole, and at least
 * one, so a village and a town keep a village's numbers.
 */
export function npcNeedsScale(world: Pick<WorldState, 'residents'>, city: City): number {
  return Math.max(1, Math.floor(cityResidents(world, city).length / NPC_RESIDENTS_PER_NEEDS_STEP))
}

/** Whether an NPC city counts as big (`CONTEXT.md`: Spare hands' work): two steps of needs or more. */
export function isBigNpcCity(world: Pick<WorldState, 'residents'>, city: City): boolean {
  return npcNeedsScale(world, city) > 1
}

/**
 * The reserve an NPC city keeps (`CONTEXT.md`: NPC reserve): Food for `NPC_TRADE.reserveFoodDays`
 * game days for all its residents and what its stables lack (`npcStablesLack`); for each step of its
 * needs (`npcNeedsScale`) the materials of a house and `NPC_TRADE.reserveWallStretches` stretches of
 * wall, and `NPC_TRADE.reserveStonePerStep` Stone for each step past the first; a weapon
 * (`NPC_SMITHY_WEAPON`) for each soldier it keeps by its size
 * (`npcSoldierTarget`) and has not armed yet, and the smithy recipe's Iron and Wood for those of
 * them its storages hold no weapon for; and `NPC_WAR_CHEST_PER_RESIDENT` coins for each of its
 * residents. Whole units. What it holds above this is for sale, what it lacks drives its work.
 */
export function npcReserve(world: WorldState, city: City): Stock {
  const reserve: Stock = {}
  const eaten = cityFoodUse(world, city, NPC_TRADE.reserveFoodDays)
  const food = Math.ceil(eaten + npcStablesLack(world, city) - 1e-9)
  if (food > 0) reserve.food = food
  const add = (goods: Stock | undefined, times: number) => {
    if (times <= 0) return
    for (const [good, n] of Object.entries(goods ?? {}) as [Good, number][]) {
      reserve[good] = (reserve[good] ?? 0) + n * times
    }
  }
  const steps = npcNeedsScale(world, city)
  add(BUILD_MATERIALS.house, steps)
  add(BUILD_MATERIALS.wall, NPC_TRADE.reserveWallStretches * steps)
  add({ stone: NPC_TRADE.reserveStonePerStep }, steps - 1)
  const residents = cityResidents(world, city).filter((r) => r.owner === null && r.health > 0)
  const adults = residents.filter((r) => canWork(r, world.tick))
  const unarmed = npcSoldierTarget(adults.length) - adults.filter(isArmed).length
  if (unarmed > 0) {
    reserve[NPC_SMITHY_WEAPON] = unarmed
    const stock = npcCityStock(world, city)
    const held = WEAPONS.reduce((n, w) => n + (stock[w] ?? 0), 0)
    add(recipeFor('smithy', NPC_SMITHY_WEAPON)?.input, unarmed - held)
  }
  if (residents.length > 0) reserve.coins = residents.length * NPC_WAR_CHEST_PER_RESIDENT
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
export function standingSwing(
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
  const reserve = npcReserve(world, city)
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
  const reserve = npcReserve(world, city)
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
 * How many times over, up to `wanted`, an offer is at a rate at least as good as an NPC city's own
 * prices (`CONTEXT.md`: NPC cities at an offer): what it gets is worth what it would pay for it,
 * what it gives up what it would sell it for, each unit priced with its stock as it moves and
 * moved by its standing toward the offer's realm, as a swap with that realm would be. A Coin is
 * worth a Coin. Pure: nothing moves.
 */
export function npcOfferTimes(
  world: WorldState,
  city: City,
  offer: Pick<Offer, 'realmId' | 'gives' | 'givesUnits' | 'wants' | 'wantsUnits'>,
  wanted: number,
): number {
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  const swing = standingSwing(world, city, offer.realmId)
  const { gives, wants } = offer
  const givesStock = stock[gives] ?? 0
  const wantsStock = stock[wants] ?? 0
  let got = 0
  let paid = 0
  let gotUnits = 0
  let paidUnits = 0
  let times = 0
  while (times < wanted) {
    for (let i = 0; i < offer.givesUnits; i++) {
      gotUnits++
      got += gives === 'coins' ? 1 : npcPriceFor(gives, givesStock + gotUnits, reserve, swing).buy
    }
    for (let i = 0; i < offer.wantsUnits; i++) {
      paid +=
        wants === 'coins' ? 1 : npcPriceFor(wants, wantsStock - paidUnits, reserve, swing).sell
      paidUnits++
    }
    if (got < paid) break
    times++
  }
  return times
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

// What an NPC city would lend (`spareResidents`, `npcHireProblem`) is the server's alone since
// T96.3 (ADR 0033): it reads the city's plan and threats. The client shows `hire.spare` as seen.
