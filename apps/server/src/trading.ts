import {
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  MAP_SIZE,
  commanderOf,
  commands,
  commandsCarriage,
  deliveryStorage,
  handsOf,
  loadOf,
  owedBy,
  quoteDelivery,
  quotePickUp,
  quoteTrade,
  tradeCoinWarehouse,
  tradeProblem,
  tradingWarehouseAt,
  wrapDistance,
  type Building,
  type Good,
  type OrderRequest,
  type PricedGood,
  type Resident,
  type Stock,
  type TradeOrder,
  type TradeSide,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant } from './invariants.js'
import type { OrderKind } from './orders.js'
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
 * (`CONTEXT.md`: Delivery).
 */
function tradeOrder(side: TradeSide): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<TradeRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      return tradeProblem(world, realm.id, r, side, o.good, o.units, o.carriageId, o.cityId)
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
  before: Stock
  after: Stock
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
 * what fits (`quoteTrade`). At the HQ the coins come from and go into its coin warehouse. Either
 * way the order is done, with a line in the realm log. An order with a city orders a delivery or
 * pick-up instead (`orderDelivery`). Returns how many trades moved anything. `size` is the map's.
 */
export function resolveTrades(world: WorldState, size = MAP_SIZE): number {
  const records: TradeRecord[] = []
  ledger.set(world, records)
  let traded = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'trade') continue
    r.order = null
    const warehouse = tradingWarehouseAt(world, r.x, r.y)
    const coinWarehouse = warehouse && tradeCoinWarehouse(world, warehouse)
    if (!warehouse || !coinWarehouse) continue
    const realm = commanderOf(world, r)
    const carriage =
      o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
    if (o.carriageId !== null) {
      if (realm === null || !commandsCarriage(world, realm, carriage)) continue
      if (carriage.x !== r.x || carriage.y !== r.y) continue
    }
    const holder = carriage ? loadOf(carriage) : handsOf(r, world.tick)
    const parties = [holder.stock, (warehouse.stock ??= {}), (coinWarehouse.stock ??= {})]
    const before = total([...new Set(parties)])
    if (o.cityId !== undefined) {
      if (realm === null) continue
      if (orderDelivery(world, size, r, realm, o, warehouse, holder.stock)) traded++
      records.push({ residentId: r.id, before, after: total([...new Set(parties)]) })
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
    records.push({ residentId: r.id, before, after: total([...new Set(parties)]) })
    if (units > 0) traded++
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
 * Orders a delivery or pick-up (`CONTEXT.md`: Delivery) for the trade order `o` of resident `r`
 * of `realm`, at `warehouse`, paying from `payer` (their hands or carriage). Buying, the goods
 * and the fee (`quoteDelivery`) are paid now into the coin warehouse, and the warehouse keeps
 * the goods for a caravan to bring to the city's storage. Selling, nothing moves yet: a caravan
 * picks the goods up and pays there, up to `o.units` and one delivery load (`DELIVERY_LOAD`). Either way with a
 * line in the realm log. Returns whether a delivery was ordered.
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

/** Every buy and sell order is done the tick it is given (`resolveTrades`): none outlasts a tick. */
export const tradeOrdersDone: Invariant = {
  name: 'trade-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'trade')
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
