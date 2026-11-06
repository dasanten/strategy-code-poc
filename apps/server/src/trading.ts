import {
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  MAP_SIZE,
  NPC_HORSES_KEPT,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG,
  buyHorseProblem,
  commanderOf,
  commands,
  commandsCarriage,
  deliveryStorage,
  freeStock,
  handsOf,
  loadOf,
  goodsCapacity,
  npcCityRefuses,
  npcHorseAt,
  npcHorseBuyPrice,
  npcHorseBuyerAt,
  npcHorsePrice,
  npcHorsesOf,
  npcHorsesWanted,
  npcReserve,
  npcCityStock,
  npcStorages,
  npcTradeProblem,
  npcTradingStorageAt,
  owedBy,
  quoteWithTrader,
  quoteDelivery,
  quoteNpcSwap,
  quoteNpcTrade,
  quotePickUp,
  quoteSwap,
  quoteTrade,
  sellHorseProblem,
  standingOrganization,
  swapProblem,
  tradeCoinWarehouse,
  tradeProblem,
  tradeOrgHq,
  tradeOrgRefuses,
  traderStandingAt,
  traderTradeProblem,
  caravanFoodFor,
  tradingWarehouseAt,
  wrapDistance,
  type Building,
  type BuyHorseOrder,
  type City,
  type Good,
  type OrderRequest,
  type PricedGood,
  type Resident,
  type SellHorseOrder,
  type Stock,
  type SwapOrder,
  type Trader,
  type TradeOrder,
  type TradeSide,
  type WorldState,
  isAt,
} from '@csp/shared'
import { endBreedingOf } from './breeding.js'
import { recordEvent } from './events.js'
import type { Invariant } from './invariants.js'
import type { OrderKind } from './orders.js'
import { raiseStandingBothWays, raiseStandingByTrade } from './standing.js'
import { handIn } from './transfers.js'
import { newId, realmOf } from './starting-city.js'

/** The input of a buy or sell order: the resident, the good, how many units, maybe a carriage. */
interface TradeRequest extends OrderRequest {
  residentId: string
  good: PricedGood
  units: number
  carriageId?: string | null
  /** A city of the realm to deliver the goods bought to, or to pick up the goods sold from. */
  cityId?: string | null
}

/**
 * A buy or sell order (`CONTEXT.md`: Trading with the Trade Organization): one of the Player's
 * residents, on a Trade Org warehouse's tile, trades up to `units` of a good there at its prices,
 * from and into their hands or the load of their carriage `carriageId` on the tile. It happens
 * this tick. With `cityId` it orders a delivery to or a pick-up from that city instead
 * (`CONTEXT.md`: Delivery). On an NPC city's storage the resident trades with that city instead
 * (`CONTEXT.md`: Trading with an NPC city), on the tile of a wandering trader standing at a stop
 * with that trader (`CONTEXT.md`: Trader stop).
 */
function tradeOrder(side: TradeSide): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<TradeRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      const problem = traderStandingAt(world, r.x, r.y)
        ? traderTradeProblem
        : npcTradingStorageAt(world, r.x, r.y)
          ? npcTradeProblem
          : tradeProblem
      return problem(world, realm.id, r, side, o.good, o.units, o.carriageId, o.cityId)
    },
    apply(world, _sender, order) {
      const o = order as TradeRequest
      const r = world.residents.find((x) => x.id === o.residentId)
      if (r) {
        r.order = {
          kind: 'trade',
          side,
          good: o.good,
          units: o.units,
          carriageId: o.carriageId ?? null,
          ...(o.cityId ? { cityId: o.cityId } : {}),
        }
      }
    },
  }
}

export const buy = tradeOrder('buy')
export const sell = tradeOrder('sell')

/** The input of a swap order: the resident, the goods, how many units wanted, maybe a carriage. */
interface SwapRequest extends OrderRequest {
  residentId: string
  give: PricedGood
  want: PricedGood
  units: number
  carriageId?: string | null
}

/**
 * A swap order (`CONTEXT.md`: Swap): one of the Player's residents, on a Trade Org warehouse's tile
 * or an NPC city's storage, gets up to `units` of a good for another they hold, from and into their
 * hands or the load of their carriage `carriageId` on the tile. It happens this tick.
 */
export const swap: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<SwapRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return swapProblem(world, realm.id, r, o.give, o.want, o.units, o.carriageId)
  },
  apply(world, _sender, order) {
    const o = order as SwapRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) {
      r.order = {
        kind: 'swap',
        give: o.give,
        want: o.want,
        units: o.units,
        carriageId: o.carriageId ?? null,
      }
    }
  },
}

/** The input of a buy or sell horse order: the resident and the horse. */
interface HorseTradeRequest extends OrderRequest {
  residentId: string
  horseId: string
}

/**
 * A buy horse order (`CONTEXT.md`: Horse market): one of the Player's residents, at an NPC city's
 * finished stable, buys a horse standing in it with the Coins in their hands. It happens this tick.
 */
export const buyHorse: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<HorseTradeRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return buyHorseProblem(world, realm.id, r, o.horseId)
  },
  apply(world, _sender, order) {
    const o = order as HorseTradeRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) r.order = { kind: 'buyHorse', horseId: o.horseId }
  },
}

/**
 * A sell horse order (`CONTEXT.md`: Horse market): one of the Player's residents, at an NPC city's
 * finished stable, sells it a horse of their realm standing in it, for Coins in their hands. It
 * happens this tick.
 */
export const sellHorse: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<HorseTradeRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return sellHorseProblem(world, realm.id, r, o.horseId)
  },
  apply(world, _sender, order) {
    const o = order as HorseTradeRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) r.order = { kind: 'sellHorse', horseId: o.horseId }
  },
}

/** One trade carried out this tick, with the goods and coins of everyone in it before and after. */
interface TradeRecord {
  residentId: string
  /**
   * The realm that traded, if any, and whether the side it traded with (the Trade Organization
   * or an NPC city) refused it as it traded.
   */
  realm: string | null
  refused: boolean
  before: Stock
  after: Stock
  /**
   * For a trade with an NPC city (`CONTEXT.md`: Trading with an NPC city): the city, and whether
   * the trade kept to its reserve: it sold none of the reserve and bought nothing beyond it. A swap
   * counts both of its goods.
   */
  npcCityId?: string
  keptReserve?: boolean
  /**
   * For a trade with a wandering trader (`CONTEXT.md`: Trader stop): the trader, and whether it
   * still has the Food its crew keep on board, or never sold any of it.
   */
  traderId?: string
  keptFood?: boolean
  /**
   * For a horse traded with an NPC city (`CONTEXT.md`: Horse market): the horse, whether the city
   * still has the pair it keeps after selling it, and whether it has no more than it wants after
   * buying it.
   */
  horseId?: string
  keptPair?: boolean
  wanted?: boolean
}

/** The trades of the latest `resolveTrades`, kept beside the world for `tradesKeepGoods`. */
const ledger = new WeakMap<WorldState, TradeRecord[]>()

/** The goods of several stocks added up. */
function total(stocks: (Stock | undefined)[]): Stock {
  const sum: Stock = {}
  for (const s of stocks) {
    for (const [good, n] of Object.entries(s ?? {}) as [Good, number][]) {
      sum[good] = (sum[good] ?? 0) + n
    }
  }
  return sum
}

/** Moves units of one good between two stocks, dropping a good that reaches 0. */
function move(from: Stock, to: Stock, good: Good, units: number): void {
  if (units <= 0) return
  const left = (from[good] ?? 0) - units
  if (left > 0) from[good] = left
  else delete from[good]
  to[good] = (to[good] ?? 0) + units
}

/**
 * Carries out buy and sell orders (`CONTEXT.md`: Trading with the Trade Organization). Where the
 * trader still stands on the warehouse (and their carriage too), the goods and coins swap between
 * their hands or carriage and the warehouse at its prices, cut down to what can be traded and
 * what fits (`quoteTrade`). At the HQ the coins come from and go into its coin warehouse. The
 * coins raise standing both ways between the realm and the Trade Organization (`CONTEXT.md`:
 * Standing). A realm the Trade Organization refuses (`CONTEXT.md`: Trade Org reaction) trades
 * nothing. Either way the order is done, with a line in the realm log. An order with a city
 * orders a delivery or pick-up instead (`orderDelivery`), and a hand-in order hands in a transfer
 * (`handIn`, `CONTEXT.md`: Transfer), and a swap order swaps (`swapHere`, `CONTEXT.md`: Swap).
 * Returns how many trades moved anything.
 * `size` is the map's.
 */
export function resolveTrades(world: WorldState, size = MAP_SIZE): number {
  const records: TradeRecord[] = []
  ledger.set(world, records)
  let traded = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind === 'swap') {
      r.order = null
      if (swapHere(world, r, o, records)) traded++
      continue
    }
    if (o?.kind === 'buyHorse') {
      r.order = null
      if (buyHorseHere(world, r, o, records)) traded++
      continue
    }
    if (o?.kind === 'sellHorse') {
      r.order = null
      if (sellHorseHere(world, r, o, records)) traded++
      continue
    }
    if (o?.kind !== 'trade' && o?.kind !== 'handIn') continue
    r.order = null
    const visitor = o.kind === 'trade' ? traderStandingAt(world, r.x, r.y) : undefined
    if (visitor && o.kind === 'trade') {
      if (tradeWithTrader(world, r, o, visitor, records)) traded++
      continue
    }
    const npc = npcTradingStorageAt(world, r.x, r.y)
    // A transfer is handed in only at a Trade Org warehouse.
    if (npc && o.kind === 'trade') {
      if (tradeWithCity(world, r, o, npc.city, npc.storage, records)) traded++
      continue
    }
    const warehouse = tradingWarehouseAt(world, r.x, r.y)
    const coinWarehouse = warehouse && tradeCoinWarehouse(world, warehouse)
    if (!warehouse || !coinWarehouse) continue
    const realm = commanderOf(world, r)
    // The Trade Organization may have come to refuse the realm since the order was given.
    if (realm !== null && tradeOrgRefuses(world, realm)) continue
    const carriage =
      o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
    if (o.carriageId !== null) {
      if (realm === null || !commandsCarriage(world, realm, carriage)) continue
      if (!isAt(carriage, warehouse)) continue
    }
    const holder = carriage
      ? loadOf(carriage, goodsCapacity(world, carriage))
      : handsOf(r, world.tick)
    const parties = [holder.stock, (warehouse.stock ??= {}), (coinWarehouse.stock ??= {})]
    const before = total([...new Set(parties)])
    if (o.kind === 'handIn' || o.cityId !== undefined) {
      if (realm === null) continue
      const ordered =
        o.kind === 'handIn'
          ? handIn(world, size, r, realm, o, warehouse, holder.stock)
          : orderDelivery(world, size, r, realm, o, warehouse, holder.stock)
      if (ordered) traded++
      records.push({
        residentId: r.id,
        realm,
        refused: tradeOrgRefuses(world, realm),
        before,
        after: total([...new Set(parties)]),
      })
      continue
    }
    const owed = owedBy(world, warehouse.id, o.good)
    const { units, coins } = quoteTrade(world, warehouse, holder, o.side, o.good, o.units, owed)
    const goodsFrom = o.side === 'buy' ? warehouse.stock : holder.stock
    const goodsTo = o.side === 'buy' ? holder.stock : warehouse.stock
    move(goodsFrom, goodsTo, o.good, units)
    const coinsFrom = o.side === 'buy' ? holder.stock : coinWarehouse.stock
    const coinsTo = o.side === 'buy' ? coinWarehouse.stock : holder.stock
    move(coinsFrom, coinsTo, 'coins', coins)
    records.push({
      residentId: r.id,
      realm,
      refused: realm !== null && tradeOrgRefuses(world, realm),
      before,
      after: total([...new Set(parties)]),
    })
    if (units > 0) traded++
    const moved =
      realm !== null && coins > 0 ? raiseStandingByTrade(world, realm, TRADE_ORG, coins) : undefined
    recordEvent(world, realm, {
      kind: 'traded',
      residentId: r.id,
      name: r.name,
      side: o.side,
      good: o.good,
      units,
      wanted: o.units,
      coins,
      x: warehouse.x,
      y: warehouse.y,
      ...(moved && { standing: moved }),
    })
  }
  return traded
}

/**
 * Carries out the trade order `o` of resident `r` on the storage of an NPC city (`CONTEXT.md`:
 * Trading with an NPC city): where the trader's carriage, if any, is still theirs and on the
 * tile, the goods and coins swap between their hands or carriage and the storage at the city's
 * prices, cut down to its surplus or what it lacks of its reserve and to what fits
 * (`quoteNpcTrade`). The coins raise standing both ways between the realm and the city. A realm
 * the city refuses (`npcCityRefuses`) trades nothing, and nothing is delivered. The trade goes
 * into `records`, with a line in the realm log. Returns whether it moved anything.
 */
function tradeWithCity(
  world: WorldState,
  r: Resident,
  o: TradeOrder,
  city: City,
  storage: Building,
  records: TradeRecord[],
): boolean {
  const realm = commanderOf(world, r)
  // A resident of the Trade Organization trades for it, like a realm's for theirs (its army buying
  // Food, `CONTEXT.md`: Trade Org debt); another NPC city's residents trade for nobody.
  const ofTradeOrg = r.cityId !== null && standingOrganization(world, r.cityId) === TRADE_ORG
  const trader = realm ?? (ofTradeOrg ? TRADE_ORG : null)
  if (o.cityId !== undefined) return false
  // The city may have come to refuse the realm since the order was given.
  if (trader !== null && npcCityRefuses(world, city, trader)) return false
  const carriage =
    o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
  if (o.carriageId !== null) {
    if (realm === null || !commandsCarriage(world, realm, carriage)) return false
    if (!isAt(carriage, storage)) return false
  }
  const holder = carriage
    ? loadOf(carriage, goodsCapacity(world, carriage))
    : handsOf(r, world.tick)
  const parties = [holder.stock, (storage.stock ??= {})]
  const before = total(parties)
  const { units, coins } = quoteNpcTrade(
    world,
    city,
    storage,
    holder,
    o.side,
    o.good,
    o.units,
    trader,
  )
  const goodsFrom = o.side === 'buy' ? storage.stock : holder.stock
  const goodsTo = o.side === 'buy' ? holder.stock : storage.stock
  move(goodsFrom, goodsTo, o.good, units)
  move(goodsTo, goodsFrom, 'coins', coins)
  const held = npcCityStock(world, city)[o.good] ?? 0
  const keep = npcReserve(world, city)[o.good] ?? 0
  records.push({
    residentId: r.id,
    realm: trader,
    refused: trader !== null && npcCityRefuses(world, city, trader),
    before,
    after: total(parties),
    npcCityId: city.id,
    keptReserve: units === 0 || (o.side === 'buy' ? held >= keep : held <= keep),
  })
  const moved =
    trader !== null && coins > 0 ? raiseStandingByTrade(world, trader, city.id, coins) : undefined
  recordEvent(world, realm, {
    kind: 'traded',
    residentId: r.id,
    name: r.name,
    side: o.side,
    good: o.good,
    units,
    wanted: o.units,
    coins,
    x: storage.x,
    y: storage.y,
    atStorage: true,
    ...(moved && { standing: moved }),
  })
  return units > 0
}

/**
 * Carries out the trade order `o` of resident `r` on the tile of wandering trader `trader`, standing
 * at a stop (`CONTEXT.md`: Trader stop), as at a warehouse: where the trader's carriage, if any, is
 * still theirs and on the tile, the goods and coins swap between their hands or carriage and its
 * load at its prices, cut down to what it has to trade and what fits (`quoteWithTrader`). The coins
 * raise standing both ways between the realm and the Trade Organization. A realm it refuses trades
 * nothing. The trade goes into `records`, with a line in the realm log. Returns whether it moved
 * anything.
 */
function tradeWithTrader(
  world: WorldState,
  r: Resident,
  o: TradeOrder,
  trader: Trader,
  records: TradeRecord[],
): boolean {
  const realm = commanderOf(world, r)
  if (o.cityId !== undefined) return false
  if (realm !== null && tradeOrgRefuses(world, realm)) return false
  const wagon = world.carriages.find((k) => k.id === trader.carriageId)
  if (!wagon) return false
  const carriage =
    o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
  if (o.carriageId !== null) {
    if (realm === null || !commandsCarriage(world, realm, carriage)) return false
    if (carriage!.x !== wagon.x || carriage!.y !== wagon.y) return false
  }
  const holder = carriage
    ? loadOf(carriage, goodsCapacity(world, carriage))
    : handsOf(r, world.tick)
  const parties = [holder.stock, wagon.load]
  const before = total(parties)
  const { units, coins } = quoteWithTrader(world, trader, wagon, holder, o.side, o.good, o.units)
  const goodsFrom = o.side === 'buy' ? wagon.load : holder.stock
  const goodsTo = o.side === 'buy' ? holder.stock : wagon.load
  move(goodsFrom, goodsTo, o.good, units)
  move(goodsTo, goodsFrom, 'coins', coins)
  const keep = caravanFoodFor(trader.escortIds.length)
  records.push({
    residentId: r.id,
    realm,
    refused: realm !== null && tradeOrgRefuses(world, realm),
    before,
    after: total(parties),
    traderId: trader.id,
    keptFood:
      units === 0 || o.good !== 'food' || o.side === 'sell' || (wagon.load.food ?? 0) >= keep,
  })
  const moved =
    realm !== null && coins > 0 ? raiseStandingByTrade(world, realm, TRADE_ORG, coins) : undefined
  recordEvent(world, realm, {
    kind: 'traded',
    residentId: r.id,
    name: r.name,
    side: o.side,
    good: o.good,
    units,
    wanted: o.units,
    coins,
    x: wagon.x,
    y: wagon.y,
    withTrader: true,
    ...(moved && { standing: moved }),
  })
  return units > 0
}

/**
 * Carries out the swap order `o` of resident `r` (`CONTEXT.md`: Swap) on the warehouse or NPC city's
 * storage they stand on: where the place doesn't refuse their realm and their carriage, if any, is
 * still theirs and on the tile, the good they give goes in, the good they want comes out and what
 * is over comes back in Coins (`quoteSwap`, `quoteNpcSwap`), from the HQ's coin warehouse at the HQ.
 * As a sale and a purchase at once, both raise standing both ways. The swap goes into `records`,
 * with a line in the realm log. Returns whether it moved anything.
 */
function swapHere(world: WorldState, r: Resident, o: SwapOrder, records: TradeRecord[]): boolean {
  const realm = commanderOf(world, r)
  const npc = npcTradingStorageAt(world, r.x, r.y)
  const warehouse = npc ? undefined : tradingWarehouseAt(world, r.x, r.y)
  const place = npc?.storage ?? warehouse
  const coinPlace = warehouse ? tradeCoinWarehouse(world, warehouse) : place
  if (!place || !coinPlace) return false
  // The place may have come to refuse the realm since the order was given.
  const refuses = () =>
    realm !== null && (npc ? npcCityRefuses(world, npc.city, realm) : tradeOrgRefuses(world, realm))
  if (refuses()) return false
  const carriage =
    o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
  if (o.carriageId !== null) {
    if (realm === null || !commandsCarriage(world, realm, carriage)) return false
    if (!isAt(carriage, place)) return false
  }
  const holder = carriage
    ? loadOf(carriage, goodsCapacity(world, carriage))
    : handsOf(r, world.tick)
  const stock = (place.stock ??= {})
  const coinStock = (coinPlace.stock ??= {})
  const parties = [...new Set([holder.stock, stock, coinStock])]
  const before = total(parties)
  const q = npc
    ? quoteNpcSwap(world, npc.city, npc.storage, holder, o.give, o.want, o.units, realm)
    : quoteSwap(world, place, holder, o.give, o.want, o.units, owedBy(world, place.id, o.want))
  move(holder.stock, stock, o.give, q.gives)
  move(stock, holder.stock, o.want, q.units)
  move(coinStock, holder.stock, 'coins', q.coins)
  const record: TradeRecord = {
    residentId: r.id,
    realm,
    refused: refuses(),
    before,
    after: total(parties),
  }
  if (npc) {
    const held = npcCityStock(world, npc.city)
    const keep = npcReserve(world, npc.city)
    record.npcCityId = npc.city.id
    record.keptReserve =
      q.units === 0 ||
      ((held[o.want] ?? 0) >= (keep[o.want] ?? 0) && (held[o.give] ?? 0) <= (keep[o.give] ?? 0))
  }
  records.push(record)
  const moved =
    realm !== null && q.units > 0
      ? raiseStandingByTrade(world, realm, npc ? npc.city.id : TRADE_ORG, q.bought + q.sold)
      : undefined
  recordEvent(world, realm, {
    kind: 'swapped',
    residentId: r.id,
    name: r.name,
    place: npc ? 'storage' : 'warehouse',
    give: o.give,
    gave: q.gives,
    want: o.want,
    units: q.units,
    wanted: o.units,
    coins: q.coins,
    x: place.x,
    y: place.y,
    ...(moved && { standing: moved }),
  })
  return q.units > 0
}

/**
 * Carries out the buy horse order `o` of resident `r` (`CONTEXT.md`: Horse market), if nothing came
 * in its way since it was given (`buyHorseProblem`): the Coins go from their hands into the NPC
 * city's storage and the horse joins their realm where it stands, ending any breeding it was part of
 * (`endBreedingOf`). The Coins raise standing both ways. It goes into `records`, with a line in the
 * realm log. Returns whether it moved anything.
 */
function buyHorseHere(
  world: WorldState,
  r: Resident,
  o: BuyHorseOrder,
  records: TradeRecord[],
): boolean {
  const realm = commanderOf(world, r)
  const horse = world.horses.find((h) => h.id === o.horseId)
  const at = horse && npcHorseAt(world, r, horse)
  if (realm === null || !horse || !at) return false
  const { city, stable } = at
  const log = { residentId: r.id, name: r.name, horseId: horse.id, horse: horse.name }
  const where = { city: city.name, x: stable.x, y: stable.y }
  const problem = buyHorseProblem(world, realm, r, horse.id)
  if (problem) {
    recordEvent(world, realm, { kind: 'horseBought', ...log, ...where, coins: 0, problem })
    return false
  }
  const coins = npcHorsePrice(world, city, horse, realm)
  const storage = npcStorages(world, city)[0]!
  const parties = [r.carried, (storage.stock ??= {})]
  const before = total(parties)
  move(r.carried, storage.stock, 'coins', coins)
  horse.realmId = realm
  horse.cityId = null
  endBreedingOf(world, horse.id)
  records.push({
    residentId: r.id,
    realm,
    refused: npcCityRefuses(world, city, realm),
    before,
    after: total(parties),
    npcCityId: city.id,
    keptReserve: true,
    horseId: horse.id,
    keptPair: npcHorsesOf(world, city).length >= NPC_HORSES_KEPT,
  })
  raiseStandingBothWays(world, realm, city.id, coins / STANDING_TRADE_COINS_PER_POINT)
  recordEvent(world, realm, { kind: 'horseBought', ...log, ...where, coins })
  return true
}

/**
 * Carries out the sell horse order `o` of resident `r` (`CONTEXT.md`: Horse market), if nothing came
 * in its way since it was given (`sellHorseProblem`): the Coins go from the NPC city's storages into
 * their hands and the horse joins the city where it stands, ending any breeding it was part of
 * (`endBreedingOf`). The Coins raise standing both ways. It goes into `records`, with a line in the
 * realm log. Returns whether it moved anything.
 */
function sellHorseHere(
  world: WorldState,
  r: Resident,
  o: SellHorseOrder,
  records: TradeRecord[],
): boolean {
  const realm = commanderOf(world, r)
  const horse = world.horses.find((h) => h.id === o.horseId)
  const at = realm !== null && horse ? npcHorseBuyerAt(world, r, horse, realm) : undefined
  if (realm === null || !horse || !at) return false
  const { city, stable } = at
  const log = { residentId: r.id, name: r.name, horseId: horse.id, horse: horse.name }
  const where = { city: city.name, x: stable.x, y: stable.y }
  const problem = sellHorseProblem(world, realm, r, horse.id)
  if (problem) {
    recordEvent(world, realm, { kind: 'horseSold', ...log, ...where, coins: 0, problem })
    return false
  }
  const coins = npcHorseBuyPrice(world, city, horse, realm)
  const storages = npcStorages(world, city)
  const parties = [r.carried, ...storages.map((s) => (s.stock ??= {}))]
  const before = total(parties)
  let owed = coins
  for (const s of storages) {
    const paid = Math.min(owed, s.stock?.coins ?? 0)
    move(s.stock!, r.carried, 'coins', paid)
    owed -= paid
  }
  horse.realmId = null
  horse.cityId = city.id
  endBreedingOf(world, horse.id)
  records.push({
    residentId: r.id,
    realm,
    refused: npcCityRefuses(world, city, realm),
    before,
    after: total(parties),
    npcCityId: city.id,
    keptReserve: true,
    horseId: horse.id,
    keptPair: true,
    wanted: npcHorsesOf(world, city).length <= npcHorsesWanted(world, city),
  })
  raiseStandingBothWays(world, realm, city.id, coins / STANDING_TRADE_COINS_PER_POINT)
  recordEvent(world, realm, { kind: 'horseSold', ...log, ...where, coins })
  return true
}

/**
 * Orders a delivery or pick-up (`CONTEXT.md`: Delivery) for the trade order `o` of resident `r`
 * of `realm`, at `warehouse`, paying from `payer` (their hands or carriage). Buying, the goods
 * and the fee (`quoteDelivery`) are paid now into the coin warehouse, and the warehouse keeps
 * the goods for a caravan to bring to the city's storage. Selling, nothing moves yet: a caravan
 * picks the goods up and pays there, up to `o.units` and one delivery load (`DELIVERY_LOAD`).
 * Either way with a line in the realm log. The coins for goods bought raise standing like any
 * trade. Returns whether a delivery was ordered.
 */
function orderDelivery(
  world: WorldState,
  size: number,
  r: Resident,
  realm: string,
  o: TradeOrder,
  warehouse: Building,
  payer: Stock,
): boolean {
  const city = world.cities.find((c) => c.id === o.cityId)
  const storage = city?.realmId === realm ? deliveryStorage(world, city.id) : undefined
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  // No caravan would ever come, should the HQ have fallen since the order was given.
  if (!city || !storage || !coinWarehouse || !tradeOrgHq(world)) return false
  const tiles = wrapDistance(size, warehouse, storage)
  const q =
    o.side === 'buy'
      ? quoteDelivery(
          world,
          warehouse,
          payer,
          o.good,
          o.units,
          tiles,
          owedBy(world, warehouse.id, o.good),
        )
      : quotePickUp(
          world,
          warehouse,
          o.good,
          o.units,
          freeStock(world, storage)[o.good] ?? 0,
          tiles,
          coinWarehouse.stock?.coins ?? 0,
        )
  const units =
    o.side === 'buy' || q.units === 0
      ? q.units
      : Math.min(o.units, Math.floor(DELIVERY_LOAD / GOOD_WEIGHT[o.good] + 1e-9))
  if (o.side === 'buy') move(payer, (coinWarehouse.stock ??= {}), 'coins', q.coins + q.fee)
  if (o.side === 'buy' && q.coins > 0) {
    raiseStandingBothWays(world, realm, TRADE_ORG, q.coins / STANDING_TRADE_COINS_PER_POINT)
  }
  if (units > 0) {
    world.deliveries.push({
      id: newId(world, 'delivery'),
      kind: o.side === 'buy' ? 'delivery' : 'pickUp',
      realmId: realm,
      warehouseId: warehouse.id,
      cityId: city.id,
      good: o.good,
      units,
      fee: o.side === 'buy' ? q.fee : 0,
      caravanId: null,
    })
  }
  recordEvent(world, realm, {
    kind: 'deliveryOrdered',
    residentId: r.id,
    name: r.name,
    side: o.side,
    good: o.good,
    units,
    wanted: o.units,
    coins: q.coins,
    fee: q.fee,
    cityId: city.id,
    city: city.name,
    x: warehouse.x,
    y: warehouse.y,
  })
  return units > 0
}

/**
 * A trade never creates or destroys goods or coins (`CONTEXT.md`: Trading with the Trade
 * Organization): across each trade of the latest tick, the trader's hands or carriage and the
 * warehouses together hold the same of every good before and after.
 */
export const tradesKeepGoods: Invariant = {
  name: 'trades-keep-goods',
  check(world) {
    return (ledger.get(world) ?? []).flatMap((t) => {
      const goods = new Set([...Object.keys(t.before), ...Object.keys(t.after)] as Good[])
      return [...goods]
        .filter((g) => (t.before[g] ?? 0) !== (t.after[g] ?? 0))
        .map((g) => ({
          invariant: this.name,
          message: `a trade by ${t.residentId} turned ${t.before[g] ?? 0} ${g} into ${t.after[g] ?? 0}`,
          entityIds: [t.residentId],
        }))
    })
  },
}

/**
 * Every buy, sell, swap and hand-in order is done the tick it is given (`resolveTrades`): none
 * outlasts a tick.
 */
export const tradeOrdersDone: Invariant = {
  name: 'trade-orders-done',
  check(world) {
    return world.residents
      .filter(
        (r) =>
          r.order?.kind === 'trade' ||
          r.order?.kind === 'swap' ||
          r.order?.kind === 'handIn' ||
          r.order?.kind === 'buyHorse' ||
          r.order?.kind === 'sellHorse',
      )
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a trade order after the tick`,
        entityIds: [r.id],
      }))
  },
}

/** Test hook: the trades of the latest `resolveTrades`, so a test can tamper with one. */
export function tradesOf(world: WorldState): TradeRecord[] {
  return ledger.get(world) ?? []
}

/**
 * The Trade Organization and NPC cities trade with nobody they refuse (`CONTEXT.md`: Trade Org
 * reaction, NPC city reaction): no trade of the latest tick was by a realm the side it traded with
 * refused as it traded.
 */
export const refusedTradeNothing: Invariant = {
  name: 'refused-trade-nothing',
  check(world) {
    return (ledger.get(world) ?? [])
      .filter((t) => t.refused)
      .map((t) => ({
        invariant: this.name,
        message: `${t.residentId} of ${t.realm} traded with ${t.npcCityId ?? 'the Trade Organization'}, which refuses it`,
        entityIds: [t.residentId],
      }))
  },
}

/**
 * A wandering trader sells only what it has to trade (`CONTEXT.md`: Trader stop, `traderStock`): no
 * trade with one of the latest tick sold the Food its crew keep on board.
 */
export const traderTradesKeepFood: Invariant = {
  name: 'trader-trades-keep-food',
  check(world) {
    return (ledger.get(world) ?? [])
      .filter((t) => t.traderId !== undefined && !t.keptFood)
      .map((t) => ({
        invariant: this.name,
        message: `a trade by ${t.residentId} sold the Food on board of trader ${t.traderId}`,
        entityIds: [t.residentId, t.traderId!],
      }))
  },
}

/**
 * An NPC city keeps a breeding pair (`CONTEXT.md`: Horse market): no horse bought from one in the
 * latest tick left it with fewer.
 */
export const npcHorseSalesKeepPair: Invariant = {
  name: 'npc-horse-sales-keep-pair',
  check(world) {
    return (ledger.get(world) ?? [])
      .filter((t) => t.horseId !== undefined && !t.keptPair)
      .map((t) => ({
        invariant: this.name,
        message: `${t.residentId} bought ${t.horseId} out of the pair ${t.npcCityId} keeps`,
        entityIds: [t.residentId, t.horseId!, t.npcCityId!],
      }))
  },
}

/**
 * An NPC city buys a horse only while it has fewer than it wants (`CONTEXT.md`: Horse market): no
 * horse sold to one in the latest tick left it with more.
 */
export const npcHorsePurchasesWanted: Invariant = {
  name: 'npc-horse-purchases-wanted',
  check(world) {
    return (ledger.get(world) ?? [])
      .filter((t) => t.wanted === false)
      .map((t) => ({
        invariant: this.name,
        message: `${t.residentId} sold ${t.horseId} to ${t.npcCityId}, which wanted no more`,
        entityIds: [t.residentId, t.horseId!, t.npcCityId!],
      }))
  },
}

/**
 * An NPC city keeps its reserve (`CONTEXT.md`: Trading with an NPC city): no trade with one of
 * the latest tick sold any of its reserve or bought beyond it.
 */
export const npcTradesKeepReserve: Invariant = {
  name: 'npc-trades-keep-reserve',
  check(world) {
    return (ledger.get(world) ?? [])
      .filter((t) => t.npcCityId !== undefined && !t.keptReserve)
      .map((t) => ({
        invariant: this.name,
        message: `a trade by ${t.residentId} broke into the reserve of ${t.npcCityId}`,
        entityIds: [t.residentId, t.npcCityId!],
      }))
  },
}
