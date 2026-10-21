import {
  MAX_DIRECTIVE_REASON,
  TRADE_ORG,
  buyOffCoinWarehouseAt,
  buyOffProblem,
  commanderOf,
  commands,
  isAllianceCity,
  organizationLabel,
  standingOrganization,
  type AdminDirectiveView,
  type Directive,
  type DirectiveTarget,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Admin directives (`CONTEXT.md`: Admin directive): an admin, in the admin panel apart from the
 * game, orders the Trade Organization to weaken an Organization. The game still forbids nothing:
 * the Trade Organization refuses it trade and sends its army against it through its normal rules
 * (`tradeOrgRefuses`, `stepPunishments`) until an admin lifts the directive, or the target buys
 * it off where the admin allows it.
 */

/** Whether an id names an Organization a directive can name: a realm, or an NPC city. */
export function canBeNamed(world: WorldState, org: string): boolean {
  return world.realms.some((r) => r.id === org) || isAllianceCity(world, org)
}

/**
 * Every Organization an admin can name, realms first, each by name; `accountOf` gives a realm's
 * Player's account name.
 */
export function directiveTargetChoices(
  world: WorldState,
  accountOf: (userId: number) => string | undefined,
): DirectiveTarget[] {
  const realms: DirectiveTarget[] = world.realms.map((r) => ({
    org: r.id,
    name: organizationLabel(world, r.id),
    is: 'realm',
    account: accountOf(r.userId),
  }))
  const cities: DirectiveTarget[] = world.cities
    .filter((c) => isAllianceCity(world, c.id))
    .map((c) => ({ org: c.id, name: c.name, is: 'city' }))
  const byName = (a: DirectiveTarget, b: DirectiveTarget) => a.name.localeCompare(b.name)
  return [...realms.sort(byName), ...cities.sort(byName)]
}

/** Every directive in force as admins see it, with who gave it. */
export function adminDirectives(world: WorldState): AdminDirectiveView[] {
  return world.directives.map((d) => ({
    id: d.id,
    target: d.target,
    targetName: organizationLabel(world, d.target),
    withAlliance: d.withAlliance,
    reason: d.reason,
    givenAt: d.givenAt,
    price: d.price,
    givenBy: d.givenBy,
  }))
}

/** Whether a price to buy a directive off is one an admin can set: whole Coins, at least one. */
function isPrice(price: unknown): price is number {
  return Number.isInteger(price) && (price as number) > 0
}

/** Why a price to buy a directive off can't be set, or undefined: null, or whole Coins. */
function priceProblem(price: unknown): string | undefined {
  if (price === null || isPrice(price)) return undefined
  return 'A price to buy it off is a whole number of Coins, at least one, or none.'
}

/**
 * An admin gives a directive. Returns it, or why it can't be given: the target must be a realm
 * or an NPC city not already named by a directive of its own, the reason must be said, and the
 * price to buy it off is whole Coins or null when the admin doesn't allow it (left out, null).
 */
export function giveDirective(
  world: WorldState,
  input: { target: unknown; withAlliance: unknown; reason: unknown; price?: unknown },
  givenBy: string,
): Directive | string {
  const { target, withAlliance } = input
  const price = input.price ?? null
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (typeof target !== 'string' || !canBeNamed(world, target)) {
    return 'Name a realm or an NPC city.'
  }
  if (typeof withAlliance !== 'boolean') return 'Say whether it names the alliance too.'
  if (reason.length === 0) return 'Give a reason; every Player sees it.'
  if (reason.length > MAX_DIRECTIVE_REASON) {
    return `Keep the reason to ${MAX_DIRECTIVE_REASON} characters.`
  }
  const badPrice = priceProblem(price)
  if (badPrice) return badPrice
  if (world.directives.some((d) => d.target === target)) {
    return `A directive already names ${organizationLabel(world, target)}.`
  }
  const directive: Directive = {
    id: newId(world, 'directive'),
    target,
    withAlliance,
    reason,
    givenBy,
    givenAt: world.tick,
    price: price as number | null,
  }
  world.directives.push(directive)
  return directive
}

/**
 * An admin allows buying a directive off at a price, changes the price, or stops allowing it
 * (null). Returns the directive, or why not: there is none by that id, or the price isn't whole
 * Coins.
 */
export function setDirectivePrice(
  world: WorldState,
  id: string,
  price: unknown,
): Directive | string {
  const d = world.directives.find((x) => x.id === id)
  if (!d) return 'No such directive.'
  const badPrice = priceProblem(price ?? null)
  if (badPrice) return badPrice
  d.price = (price ?? null) as number | null
  return d
}

/** An admin lifts a directive. Returns whether there was one by that id. */
export function liftDirective(world: WorldState, id: string): boolean {
  const before = world.directives.length
  world.directives = world.directives.filter((d) => d.id !== id)
  return world.directives.length < before
}

/** The input of a buy-off order: the resident, the directive, maybe a carriage to pay from. */
interface BuyOffRequest extends OrderRequest {
  residentId: string
  directiveId: string
  carriageId?: string | null
}

/**
 * The buy-off order (`CONTEXT.md`: Admin directive): one of the target realm's residents, on a
 * Trade Org warehouse's tile, pays the directive's price from their hands or their carriage
 * `carriageId` there (`buyOffProblem`). It happens this tick.
 */
export const buyOff: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<BuyOffRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return buyOffProblem(world, realm.id, r, o.directiveId, o.carriageId)
  },
  apply(world, _sender, order) {
    const o = order as BuyOffRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r)
      r.order = { kind: 'buyOff', directiveId: o.directiveId, carriageId: o.carriageId ?? null }
  },
}

/** One buy-off this tick: the coins of payer and coin warehouse before and after, and the directive. */
interface BuyOffRecord {
  residentId: string
  directiveId: string
  before: number
  after: number
}

/** The buy-offs of the latest `resolveBuyOffs`, kept beside the world for its invariants. */
const ledger = new WeakMap<WorldState, BuyOffRecord[]>()

/**
 * Carries out buy-off orders (`CONTEXT.md`: Admin directive). Where the resident's realm can
 * still buy the directive off where they stand (`buyOffProblem`: the price may have changed, the
 * coins gone), the price goes from their hands or carriage into the coin warehouse there, and
 * the directive ends as if lifted: the Trade Organization's army sent for it heads home. The
 * realm log tells the payer. Either way the order is done. Returns how many were bought off.
 */
export function resolveBuyOffs(world: WorldState): number {
  const records: BuyOffRecord[] = []
  ledger.set(world, records)
  let bought = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'buyOff') continue
    r.order = null
    const realm = commanderOf(world, r)
    if (realm === null || buyOffProblem(world, realm, r, o.directiveId, o.carriageId)) continue
    const d = world.directives.find((x) => x.id === o.directiveId)!
    const coinWarehouse = buyOffCoinWarehouseAt(world, r.x, r.y)!
    const carriage =
      o.carriageId === null ? undefined : world.carriages.find((k) => k.id === o.carriageId)
    const payer = carriage ? carriage.load : r.carried
    const into = (coinWarehouse.stock ??= {})
    const before = (payer.coins ?? 0) + (into.coins ?? 0)
    const price = d.price!
    const left = payer.coins! - price
    if (left > 0) payer.coins = left
    else delete payer.coins
    into.coins = (into.coins ?? 0) + price
    records.push({
      residentId: r.id,
      directiveId: d.id,
      before,
      after: (payer.coins ?? 0) + into.coins,
    })
    liftDirective(world, d.id)
    bought++
    recordEvent(world, realm, {
      kind: 'boughtOff',
      residentId: r.id,
      name: r.name,
      reason: d.reason,
      coins: price,
      x: coinWarehouse.x,
      y: coinWarehouse.y,
    })
  }
  return bought
}

/** Test hook: the buy-offs of the latest `resolveBuyOffs`, so a test can tamper with one. */
export function buyOffsOf(world: WorldState): BuyOffRecord[] {
  return ledger.get(world) ?? []
}

/**
 * Buying off moves coins and ends the directive (`CONTEXT.md`: Admin directive; ADR 0004): across
 * each buy-off of the latest tick, payer and coin warehouse hold the same coins before and after,
 * and the directive bought off is no longer in force.
 */
export const buyOffsSound: Invariant = {
  name: 'buy-offs-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const b of ledger.get(world) ?? []) {
      if (b.before !== b.after) {
        out.push({
          invariant: this.name,
          message: `a buy-off by ${b.residentId} turned ${b.before} coins into ${b.after}`,
          entityIds: [b.residentId],
        })
      }
      if (world.directives.some((d) => d.id === b.directiveId)) {
        out.push({
          invariant: this.name,
          message: `directive ${b.directiveId} still holds after it was bought off`,
          entityIds: [b.directiveId],
        })
      }
    }
    return out
  },
}

/** Every buy-off order is done the tick it is given (`resolveBuyOffs`): none outlasts a tick. */
export const buyOffOrdersDone: Invariant = {
  name: 'buy-off-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'buyOff')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a buy-off order after the tick`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Directives hold together (`CONTEXT.md`: Admin directive; ADR 0004): each has its own id, names
 * an Organization other than the Trade Organization that no other directive names, says a reason
 * within `MAX_DIRECTIVE_REASON` and who gave it, was given no later than now, and asks whole
 * Coins to buy it off, if anything.
 */
export const directivesSound: Invariant = {
  name: 'directives-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (const d of world.directives ?? []) {
      if (ids.has(d.id)) fail(`directive id ${d.id} is used twice`, [d.id])
      ids.add(d.id)
      if (d.target === TRADE_ORG || standingOrganization(world, d.target) === TRADE_ORG) {
        fail(`directive ${d.id} names the Trade Organization`, [d.id])
      }
      if (targets.has(d.target)) fail(`${d.target} is named by two directives`, [d.id])
      targets.add(d.target)
      if (d.reason.trim().length === 0 || d.reason.length > MAX_DIRECTIVE_REASON) {
        fail(`directive ${d.id} has a reason of ${d.reason.length} characters`, [d.id])
      }
      if (d.givenBy.length === 0) fail(`directive ${d.id} says no admin gave it`, [d.id])
      if (d.givenAt > world.tick) fail(`directive ${d.id} was given in the future`, [d.id])
      if (d.price !== null && !isPrice(d.price)) {
        fail(`directive ${d.id} asks ${d.price} coins to buy it off`, [d.id])
      }
    }
    return out
  },
}
