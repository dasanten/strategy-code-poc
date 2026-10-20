import {
  commanderOf,
  commands,
  commandsCarriage,
  handsOf,
  loadOf,
  quoteTrade,
  tradeCoinWarehouse,
  tradeProblem,
  tradingWarehouseAt,
  type Good,
  type OrderRequest,
  type PricedGood,
  type Stock,
  type TradeSide,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant } from './invariants.js'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/** The input of a buy or sell order: the resident, the good, how many units, maybe a carriage. */
interface TradeRequest extends OrderRequest {
  residentId: string
  good: PricedGood
  units: number
  carriageId?: string | null
}

/**
 * A buy or sell order (`CONTEXT.md`: Trading with the Trade Organization): one of the Player's
 * residents, on a Trade Org warehouse's tile, trades up to `units` of a good there at its prices,
 * from and into their hands or the load of their carriage `carriageId` on the tile. It happens
 * this tick.
 */
function tradeOrder(side: TradeSide): OrderKind {
  return {
    validate(world, sender, order) {
      const o = order as Partial<TradeRequest>
      const realm = realmOf(world, sender.userId)
      const r = world.residents.find((x) => x.id === o.residentId)
      if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
      return tradeProblem(world, realm.id, r, side, o.good, o.units, o.carriageId)
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
 * way the order is done, with a line in the realm log. Returns how many trades moved anything.
 */
export function resolveTrades(world: WorldState): number {
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
    const { units, coins } = quoteTrade(world, warehouse, holder, o.side, o.good, o.units)
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
