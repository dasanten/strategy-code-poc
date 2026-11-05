import {
  TRADE_ORG,
  TRADE_ORG_LOSS,
  buyOffCoinWarehouseAt,
  commanderOf,
  commands,
  debtOf,
  payDebtProblem,
  standingOrganization,
  tradeOrgHq,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import {
  debtGoesUp,
  isDebtDemand,
  isPostDemand,
  sendDebtDemand,
  sendPostDemand,
} from './demands.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { endOffer } from './offers.js'
import type { OrderKind } from './orders.js'
import { organizationExists } from './standing.js'
import { realmOf } from './starting-city.js'

/*
 * What the Trade Organization came for and couldn't take stays owed by that Organization
 * (`CONTEXT.md`: Trade Org debt; ADR 0025), and it rises by what later crimes cost. A resident pays
 * it in Coins at any Trade Org warehouse, in part or in full. While it is owed the Trade Organization
 * goes up its steps, the first a demand for it with a deadline (`stepDebts`, ADR 0025).
 */

/**
 * `org` owes the Trade Organization `coins` more (rounded up to whole Coins), and reads so in its
 * log, as `first` says when it owed nothing before. Nothing for nothing owed, or from an Organization
 * that is gone or is the Trade Organization.
 */
export function oweTradeOrg(
  world: WorldState,
  org: string,
  coins: number,
  first: 'owed' | 'postOwed' = 'owed',
): void {
  const more = Math.ceil(coins)
  if (more <= 0) return
  if (!organizationExists(world, org) || standingOrganization(world, org) === TRADE_ORG) return
  const debt = world.debts.find((d) => d.org === org)
  if (debt) debt.coins += more
  else world.debts.push({ org, coins: more })
  recordEvent(world, org, {
    kind: 'debt',
    what: debt ? 'rose' : first,
    coins: more,
    owed: debt?.coins ?? more,
  })
}

/**
 * Once the Trade Organization has heard who took a post (`CONTEXT.md`: Lost post found out), that is
 * a debt for its worth (`CONTEXT.md`: Trade Org debt), once, and it sends no army of its own. While
 * they still hold the city it demands it back. One they no longer hold they can't give back, so that
 * debt goes like any other.
 */
function lostPostsBecomeDebts(world: WorldState): void {
  for (const c of world.crimes) {
    if (c.post === undefined || c.punished || !c.knownBy.includes(c.victimOrg)) continue
    c.punished = true
    oweTradeOrg(world, c.culprit.org, TRADE_ORG_LOSS.capture, 'postOwed')
    const city = world.cities.find((x) => x.id === c.post && x.realmId === c.culprit.org)
    if (city && debtOf(world, c.culprit.org) > 0) sendPostDemand(world, c.culprit.org, city)
  }
}

/** Whether a caravan is still to bring in, or on the way with, what `org` handed over on its demand. */
const beingCollected = (world: WorldState, org: string) =>
  world.transfers.some((t) => t.debt && !t.back && t.realmId === org)

/**
 * Whatever a debt set in motion ends once it is no longer owed, however that came about (paid in full
 * at a warehouse, collected, the Organization gone, the Fall of the HQ): its demands, for a post too,
 * go without a word, as the log has said what became of the debt; caravans not yet sent for its Coins
 * stay home; and what is set aside with no caravan left to fetch it is ordinary again.
 */
function endWhatIsNoLongerOwed(world: WorldState): void {
  const owed = (org: string) => debtOf(world, org) > 0
  world.demands = world.demands.filter((d) => d.fromId !== TRADE_ORG || owed(d.toId))
  world.transfers = world.transfers.filter(
    (t) => !t.debt || t.back || t.caravanId !== null || t.fromCityId === null || owed(t.realmId),
  )
  for (const o of [...world.offers]) {
    if (o.direct?.toId !== TRADE_ORG) continue
    if (!world.transfers.some((t) => t.debt?.offerId === o.id)) endOffer(world, o, 'lapsed')
  }
}

/**
 * The debts of a tick (`CONTEXT.md`: Trade Org debt). The debt of an Organization that is gone goes
 * with it (a realm whose Leader died, a city that joined a realm), so run this after whatever ends
 * Organizations in a tick, and after what changes a debt, which its demand's amount follows, and
 * after news of crimes, as a captured post it has heard of becomes a debt (`lostPostsBecomeDebts`). A
 * debt with no demand yet gets one, once, unless a demand for a post is the one it has: that one
 * answered, whatever is still owed gets its own. Declined or lapsed, that starts the next step at
 * once (`debtDemandEnded`). Accepted, it starts it past the deadline, with what is handed over brought
 * in and something still owed.
 */
export function stepDebts(world: WorldState): void {
  world.debts = world.debts.filter((d) => organizationExists(world, d.org))
  endWhatIsNoLongerOwed(world)
  if (!tradeOrgHq(world)) return
  lostPostsBecomeDebts(world)
  for (const debt of world.debts) {
    const open = world.demands.find((d) => isDebtDemand(d) && d.toId === debt.org)
    if (open) open.terms = { kind: 'goods', goods: { coins: debt.coins } }
    else if (debt.step === undefined) {
      if (!world.demands.some((d) => isPostDemand(d) && d.toId === debt.org)) {
        sendDebtDemand(world, debt)
      }
    } else if (
      debt.step === 'demanded' &&
      world.tick >= debt.deadline! &&
      !beingCollected(world, debt.org)
    ) {
      debtGoesUp(world, debt)
    }
  }
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
 * The Trade Organization's demands for debts hold together (`CONTEXT.md`: Trade Org debt; ADR 0004):
 * each is for all the Coins of a debt that is at its step `demanded`, at most one for each debt, and
 * a debt at that step has a deadline. What caravans collect of a debt goes to the Trade Organization.
 * Its demand for a captured post goes with a debt, once for each city, and a post it has heard of has
 * been made a debt by the end of the tick (`lostPostsBecomeDebts`).
 */
export const debtDemandsSound: Invariant = {
  name: 'debt-demands-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, id: string) =>
      out.push({ invariant: this.name, message, entityIds: [id] })
    const seen = new Set<string>()
    const posts = new Set<string>()
    for (const d of world.demands.filter(isPostDemand)) {
      const city = d.terms.kind === 'city' ? d.terms.cityId : ''
      if (posts.has(city)) fail(`${city} was demanded back twice`, d.id)
      posts.add(city)
      if (debtOf(world, d.toId) <= 0)
        fail(`demand ${d.id} is for a post ${d.toId} owes nothing for`, d.id)
    }
    if (tradeOrgHq(world)) {
      for (const c of world.crimes) {
        if (c.post !== undefined && c.knownBy.includes(c.victimOrg) && !c.punished) {
          fail(`it heard who took ${c.post}, and that is on no debt`, c.id)
        }
      }
    }
    for (const d of world.demands.filter(isDebtDemand)) {
      const debt = world.debts.find((x) => x.org === d.toId)
      if (!debt) fail(`demand ${d.id} is for a debt ${d.toId} doesn’t owe`, d.id)
      else if (debt.step !== 'demanded') fail(`demand ${d.id} is out at step ${debt.step}`, d.id)
      if (seen.has(d.toId)) fail(`${d.toId} was sent two demands for its debt`, d.id)
      seen.add(d.toId)
      const coins = d.terms.kind === 'goods' ? d.terms.goods.coins : undefined
      if (debt && coins !== debt.coins) {
        fail(`demand ${d.id} is for ${coins} Coins, of a debt of ${debt.coins}`, d.id)
      }
    }
    for (const debt of world.debts) {
      if (debt.step === 'demanded' && debt.deadline === undefined) {
        fail(`the debt of ${debt.org} was demanded with no deadline`, debt.org)
      }
    }
    for (const t of world.transfers) {
      if (t.debt && t.toRealmId !== TRADE_ORG) {
        fail(`${t.id} collects a debt for ${t.toRealmId}`, t.id)
      }
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
