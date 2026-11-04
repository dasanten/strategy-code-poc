import {
  TRADE_ORG,
  buyOffCoinWarehouseAt,
  commanderOf,
  commands,
  payDebtProblem,
  standingOrganization,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { organizationExists } from './standing.js'
import { realmOf } from './starting-city.js'

/*
 * What the Trade Organization came for and couldn't take stays owed by that Organization
 * (`CONTEXT.md`: Trade Org debt; ADR 0025), and it rises by what later crimes cost. A resident pays
 * it in Coins at any Trade Org warehouse, in part or in full.
 */

/**
 * `org` owes the Trade Organization `coins` more (rounded up to whole Coins), and reads so in its
 * log. Nothing for nothing owed, or from an Organization that is gone or is the Trade Organization.
 */
export function oweTradeOrg(world: WorldState, org: string, coins: number): void {
  const more = Math.ceil(coins)
  if (more <= 0) return
  if (!organizationExists(world, org) || standingOrganization(world, org) === TRADE_ORG) return
  const debt = world.debts.find((d) => d.org === org)
  if (debt) debt.coins += more
  else world.debts.push({ org, coins: more })
  recordEvent(world, org, {
    kind: 'debt',
    what: debt ? 'rose' : 'owed',
    coins: more,
    owed: debt?.coins ?? more,
  })
}

/**
 * The debt of an Organization that is gone goes with it (a realm whose Leader died, a city that
 * joined a realm). Run after whatever ends Organizations in a tick.
 */
export function stepDebts(world: WorldState): void {
  if (world.debts.length === 0) return
  world.debts = world.debts.filter((d) => organizationExists(world, d.org))
}

/** The input of a pay-debt order: the resident, the Coins, maybe a carriage to pay from. */
interface PayDebtRequest extends OrderRequest {
  residentId: string
  coins: number
  carriageId?: string | null
}

/**
 * The pay-debt order (`CONTEXT.md`: Trade Org debt): one of the realm's residents, on a Trade Org
 * warehouse's tile, pays up to `coins` from their hands or their carriage `carriageId` there
 * (`payDebtProblem`). It happens this tick.
 */
export const payDebt: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<PayDebtRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return payDebtProblem(world, realm.id, r, o.coins, o.carriageId)
  },
  apply(world, _sender, order) {
    const o = order as PayDebtRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) r.order = { kind: 'payDebt', coins: o.coins, carriageId: o.carriageId ?? null }
  },
}

/** One payment this tick: the coins of payer and coin warehouse and the debt, before and after. */
interface DebtPayment {
  residentId: string
  coinsBefore: number
  coinsAfter: number
  paid: number
  owedBefore: number
  owedAfter: number
}

/** The payments of the latest `resolveDebtPayments`, kept beside the world for its invariants. */
const ledger = new WeakMap<WorldState, DebtPayment[]>()

/**
 * Carries out pay-debt orders (`CONTEXT.md`: Trade Org debt). Where the resident's realm can still
 * pay where they stand (`payDebtProblem`: the debt may be paid, the coins gone), what they hold up
 * to the order's `coins` and what is owed goes from their hands or carriage into the coin warehouse
 * there, and off the debt. The realm log tells the payer. Either way the order is done. Returns how
 * many paid.
 */
export function resolveDebtPayments(world: WorldState): number {
  const records: DebtPayment[] = []
  ledger.set(world, records)
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'payDebt') continue
    r.order = null
    const realm = commanderOf(world, r)
    if (realm === null || payDebtProblem(world, realm, r, o.coins, o.carriageId)) continue
    const debt = world.debts.find((d) => d.org === realm)!
    const coinWarehouse = buyOffCoinWarehouseAt(world, r.x, r.y)!
    const carriage =
      o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
    const payer = carriage ? carriage.load : r.carried
    const into = (coinWarehouse.stock ??= {})
    const coinsBefore = payer.coins! + (into.coins ?? 0)
    const owedBefore = debt.coins
    const paid = Math.min(o.coins, debt.coins, Math.floor(payer.coins!))
    const left = payer.coins! - paid
    if (left > 0) payer.coins = left
    else delete payer.coins
    into.coins = (into.coins ?? 0) + paid
    debt.coins -= paid
    if (debt.coins <= 0) world.debts = world.debts.filter((d) => d !== debt)
    records.push({
      residentId: r.id,
      coinsBefore,
      coinsAfter: (payer.coins ?? 0) + into.coins,
      paid,
      owedBefore,
      owedAfter: debt.coins,
    })
    recordEvent(world, realm, {
      kind: 'debtPaid',
      residentId: r.id,
      name: r.name,
      coins: paid,
      owed: debt.coins,
      x: r.x,
      y: r.y,
    })
  }
  return records.length
}

/** Test hook: the payments of the latest `resolveDebtPayments`, so a test can tamper with one. */
export function debtPaymentsOf(world: WorldState): DebtPayment[] {
  return ledger.get(world) ?? []
}

/**
 * Debts hold together (`CONTEXT.md`: Trade Org debt; ADR 0004): each is positive, owed by an
 * Organization that exists and isn't the Trade Organization, at most one for each.
 */
export const debtsSound: Invariant = {
  name: 'debts-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, org: string) =>
      out.push({ invariant: this.name, message, entityIds: [org] })
    const seen = new Set<string>()
    for (const d of world.debts ?? []) {
      if (!(d.coins > 0)) fail(`the debt of ${d.org} is ${d.coins}`, d.org)
      if (!organizationExists(world, d.org)) fail(`${d.org} owes a debt but is gone`, d.org)
      if (standingOrganization(world, d.org) === TRADE_ORG) {
        fail(`the Trade Organization owes itself, as ${d.org}`, d.org)
      }
      if (seen.has(d.org)) fail(`${d.org} has two debts`, d.org)
      seen.add(d.org)
    }
    return out
  },
}

/**
 * Paying a debt moves coins (`CONTEXT.md`: Trade Org debt; ADR 0004): across each payment of the
 * latest tick, payer and coin warehouse hold the same coins before and after, and the debt falls by
 * what was paid.
 */
export const debtPaymentsSound: Invariant = {
  name: 'debt-payments-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const p of ledger.get(world) ?? []) {
      const fail = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: [p.residentId] })
      if (p.coinsBefore !== p.coinsAfter) {
        fail(`a payment by ${p.residentId} turned ${p.coinsBefore} coins into ${p.coinsAfter}`)
      }
      if (p.owedAfter !== p.owedBefore - p.paid) {
        fail(
          `a payment of ${p.paid} by ${p.residentId} took a debt from ${p.owedBefore} to ${p.owedAfter}`,
        )
      }
    }
    return out
  },
}

/** Every pay-debt order is done the tick it is given (`resolveDebtPayments`): none outlasts a tick. */
export const debtOrdersDone: Invariant = {
  name: 'debt-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'payDebt')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a pay-debt order after the tick`,
        entityIds: [r.id],
      }))
  },
}
