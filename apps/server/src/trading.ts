import {
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  MAP_SIZE,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG,
  commanderOf,
  commands,
  commandsCarriage,
  deliveryStorage,
  handsOf,
  loadOf,
  goodsCapacity,
  npcCityRefuses,
  npcCityReserve,
  npcCityStock,
  npcTradeProblem,
  npcTradingStorageAt,
  owedBy,
  quoteDelivery,
  quoteNpcTrade,
  quotePickUp,
  quoteTrade,
  tradeCoinWarehouse,
  tradeProblem,
  tradeOrgRefuses,
  tradingWarehouseAt,
  wrapDistance,
  type Building,
  type City,
  type Good,
  type OrderRequest,
  type PricedGood,
  type Resident,
  type Stock,
  type TradeOrder,
  type TradeSide,
  type WorldState,
  isAt,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant } from './invariants.js'
import type { OrderKind } from './orders.js'
import { raiseStandingBothWays } from './standing.js'
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
 * (`CONTEXT.md`: Trading with an NPC city).
 */
function tradeOrder(side: TradeSide): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<TradeRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      const problem = npcTradingStorageAt(world, r.x, r.y) ? npcTradeProblem : tradeProblem
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
   * the trade kept to its reserve: it sold none of the reserve and bought nothing beyond it.
   */
  npcCityId?: string
  keptReserve?: boolean
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
 * (`handIn`, `CONTEXT.md`: Transfer). Returns how many trades moved anything.
 * `size` is the map's.
 */
export function resolveTrades(world: WorldState, size = MAP_SIZE): number {
  const records: TradeRecord[] = []
  ledger.set(world, records)
  let traded = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'trade' && o?.kind !== 'handIn') continue
    r.order = null
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
    if (realm !== null && coins > 0) {
      raiseStandingBothWays(world, realm, TRADE_ORG, coins / STANDING_TRADE_COINS_PER_POINT)
    }
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
  if (o.cityId !== undefined) return false
  // The city may have come to refuse the realm since the order was given.
  if (realm !== null && npcCityRefuses(world, city, realm)) return false
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
    realm,
  )
  const goodsFrom = o.side === 'buy' ? storage.stock : holder.stock
  const goodsTo = o.side === 'buy' ? holder.stock : storage.stock
  move(goodsFrom, goodsTo, o.good, units)
  move(goodsTo, goodsFrom, 'coins', coins)
  const held = npcCityStock(world, city)[o.good] ?? 0
  const keep = npcCityReserve(world, city)[o.good] ?? 0
  records.push({
    residentId: r.id,
    realm,
    refused: realm !== null && npcCityRefuses(world, city, realm),
    before,
    after: total(parties),
    npcCityId: city.id,
    keptReserve: units === 0 || (o.side === 'buy' ? held >= keep : held <= keep),
  })
  if (realm !== null && coins > 0) {
    raiseStandingBothWays(world, realm, city.id, coins / STANDING_TRADE_COINS_PER_POINT)
  }
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
  })
  return units > 0
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
  if (!city || !storage || !coinWarehouse) return false
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
          storage.stock?.[o.good] ?? 0,
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
 * Every buy, sell and hand-in order is done the tick it is given (`resolveTrades`): none outlasts
 * a tick.
 */
export const tradeOrdersDone: Invariant = {
  name: 'trade-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'trade' || r.order?.kind === 'handIn')
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
