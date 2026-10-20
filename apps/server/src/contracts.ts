import {
  CONTRACT_MAX_DAYS,
  SIGHT_RANGE,
  commands,
  handedOverTo,
  contractEndsAt,
  contractPayBy,
  contractWeeks,
  realmName,
  townHallOf,
  wrapDistance,
  type MercenaryContract,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { walkTo } from './npc-behaviour.js'
import type { OrderKind } from './orders.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Mercenary contracts (`CONTEXT.md`: Mercenary contract): one realm rents some of its residents
 * to another for coins over a number of game days. One side offers, the other accepts. While it
 * is in force the residents stay the lender's, and the lender still sees them, but they take only
 * the hirer's orders (`commanderOf`). Each game week is paid in advance into the lender's storage
 * with a pay order; a week that ends unpaid breaks the contract. At the end, or when it breaks,
 * the residents walk home. For now both sides are Players' realms.
 */

/** The realm whose storage it is: the realm of the city it belongs to, if a finished storage. */
function storageRealm(world: WorldState, storageId: unknown): string | null {
  const b = world.buildings.find((x) => x.id === storageId)
  if (!b || b.kind !== 'storage' || b.site) return null
  return world.cities.find((c) => c.id === b.cityId)?.realmId ?? null
}

/** Whether the resident is named in any contract, offered or in force. */
const contracted = (world: WorldState, id: string) =>
  world.contracts.some((c) => c.residentIds.includes(id))

/** Whether any of the realm's residents sees the spot. */
function inSightOf(world: WorldState, realmId: string, at: Resident, size: number): boolean {
  return world.residents.some(
    (x) => commands(world, realmId, x) && wrapDistance(size, x, at) <= SIGHT_RANGE,
  )
}

/** An offer's terms as plain data, or a reason they are not good. */
function readOffer(
  world: WorldState,
  realmId: string,
  order: OrderRequest,
  size?: number,
): MercenaryContract | string {
  const ids = order.residentIds
  if (!Array.isArray(ids) || ids.length === 0) return 'a contract needs at least one resident'
  if (new Set(ids).size !== ids.length) return 'a resident is named twice'
  const residents = ids.map((id) => world.residents.find((r) => r.id === id))
  if (residents.some((r) => !r)) return 'no such resident'
  const lenderId = residents[0]!.owner
  if (lenderId === null || !residents.every((r) => r!.owner === lenderId)) {
    return 'the residents must all be of one realm'
  }
  if (ids.some((id) => contracted(world, id as string))) {
    return 'a resident is already in a contract'
  }
  if (ids.some((id) => handedOverTo(world, id as string))) {
    return 'a resident is in an alliance army'
  }
  let hirerId: string
  if (lenderId === realmId) {
    if (typeof order.realmId !== 'string' || !world.realms.some((r) => r.id === order.realmId)) {
      return 'offer them to a realm'
    }
    if (order.realmId === realmId) return 'offer them to another realm'
    hirerId = order.realmId
  } else {
    if (!world.realms.some((r) => r.id === lenderId)) return 'the residents must be of a realm'
    if (size !== undefined && !residents.every((r) => inSightOf(world, realmId, r!, size))) {
      return 'those residents are out of sight'
    }
    hirerId = realmId
  }
  const days = order.days
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > CONTRACT_MAX_DAYS) {
    return `a contract runs 1 to ${CONTRACT_MAX_DAYS} game days`
  }
  const price = order.pricePerWeek
  if (!Number.isInteger(price) || (price as number) < 1) {
    return 'the price is a whole number of coins a week, at least 1'
  }
  if (storageRealm(world, order.storageId) !== lenderId) {
    return 'the coins go into a storage of the realm renting them out'
  }
  return {
    id: '',
    lenderId,
    hirerId,
    offeredBy: lenderId === realmId ? 'lender' : 'hirer',
    residentIds: [...(ids as string[])],
    days: days as number,
    pricePerWeek: price as number,
    storageId: order.storageId as string,
    startedAt: null,
    paidWeeks: 0,
  }
}

/** An event about the contract for both its sides. */
function tellBoth(
  world: WorldState,
  c: MercenaryContract,
  what: 'started' | 'paid' | 'ended' | 'broken',
  weeks?: number,
): void {
  const n = c.residentIds.length
  const extra = weeks === undefined ? {} : { weeks }
  const base = { kind: 'contract' as const, contractId: c.id, what, residents: n, ...extra }
  recordEvent(world, c.lenderId, { ...base, lender: true, other: realmName(world, c.hirerId) })
  recordEvent(world, c.hirerId, { ...base, lender: false, other: realmName(world, c.lenderId) })
}

/** A contract order: `check` gives a reason to reject it, on a map of `size` tiles when known. */
function contractOrderKind(
  check: (
    world: WorldState,
    realmId: string,
    order: OrderRequest,
    size?: number,
  ) => string | undefined,
  act: (world: WorldState, realmId: string, order: OrderRequest) => void,
): OrderKind {
  return {
    validate(world, sender, order, terrain) {
      const realmId = realmOf(world, sender.userId)?.id
      if (!realmId) return 'you have no realm'
      return check(world, realmId, order, terrain?.size)
    },
    apply(world, sender, order) {
      const realmId = realmOf(world, sender.userId)?.id
      if (realmId && !check(world, realmId, order)) act(world, realmId, order)
    },
  }
}

/**
 * Offering a contract: the lender offers some of its residents to a realm (`realmId`), or a
 * hirer asks for residents of another realm it sees; for `days` game days at `pricePerWeek`
 * coins a week, paid into a storage of the lender (`storageId`).
 */
export const offerContract = contractOrderKind(
  (world, realmId, order, size) => {
    const terms = readOffer(world, realmId, order, size)
    return typeof terms === 'string' ? terms : undefined
  },
  (world, realmId, order) => {
    const c = readOffer(world, realmId, order) as MercenaryContract
    c.id = newId(world, 'contract')
    world.contracts.push(c)
    const to = c.offeredBy === 'lender' ? c.hirerId : c.lenderId
    recordEvent(world, to, {
      kind: 'contract',
      contractId: c.id,
      what: 'offered',
      lender: c.offeredBy === 'hirer',
      other: realmName(world, realmId),
      residents: c.residentIds.length,
    })
  },
)

/** The offer named by `order.contractId` that the realm is a side of, or a reason. */
function offerOf(
  world: WorldState,
  realmId: string,
  order: OrderRequest,
): MercenaryContract | string {
  const c = world.contracts.find((x) => x.id === order.contractId)
  if (!c || (c.lenderId !== realmId && c.hirerId !== realmId)) return 'no such contract'
  if (c.startedAt !== null) return 'that contract is already in force'
  return c
}

/** A reason the offer can't start now, if any: its residents or storage changed hands. */
function cannotStart(world: WorldState, c: MercenaryContract): string | undefined {
  if (
    !c.residentIds.every((id) => world.residents.some((r) => r.id === id && r.owner === c.lenderId))
  ) {
    return 'the residents are no longer all the lender’s'
  }
  if (storageRealm(world, c.storageId) !== c.lenderId)
    return 'the storage is no longer the lender’s'
  return undefined
}

/**
 * Accepting an offer the other side made: the contract is in force from now. The residents stop
 * what they were doing, scripts included, and wait for the hirer's orders.
 */
export const acceptContract = contractOrderKind(
  (world, realmId, order) => {
    const c = offerOf(world, realmId, order)
    if (typeof c === 'string') return c
    const mine = c.offeredBy === 'lender' ? c.hirerId : c.lenderId
    if (mine !== realmId) return 'the other side has to accept your offer'
    return cannotStart(world, c)
  },
  (world, _realmId, order) => {
    const c = world.contracts.find((x) => x.id === order.contractId)!
    c.startedAt = world.tick
    for (const r of world.residents) {
      if (!c.residentIds.includes(r.id)) continue
      r.order = null
      delete r.script
    }
    tellBoth(world, c, 'started')
  },
)

/** Declining an offer, or taking back one's own: either side, while it is only offered. */
export const cancelContract = contractOrderKind(
  (world, realmId, order) => {
    const c = offerOf(world, realmId, order)
    return typeof c === 'string' ? c : undefined
  },
  (world, _realmId, order) => {
    world.contracts = world.contracts.filter((x) => x.id !== order.contractId)
  },
)

/** A reason the resident can't pay `weeks` of the contract now, if any. */
function cannotPay(
  world: WorldState,
  r: Resident,
  c: MercenaryContract | undefined,
  weeks: unknown,
): string | undefined {
  if (!c || c.startedAt === null) return 'no such contract in force'
  if (!Number.isInteger(weeks) || (weeks as number) < 1) return 'pay for a whole number of weeks'
  if ((weeks as number) > contractWeeks(c) - c.paidWeeks) return 'that is more weeks than are left'
  const b = world.buildings.find((x) => x.id === c.storageId)
  if (!b || b.x !== r.x || b.y !== r.y) return 'the resident must stand on the contract’s storage'
  if ((r.carried.coins ?? 0) < (weeks as number) * c.pricePerWeek) {
    return 'the resident doesn’t carry enough coins'
  }
  return undefined
}

/**
 * The pay order: one of the hirer's residents, standing on the contract's storage, puts in the
 * coins for `weeks` game weeks (`CONTEXT.md`: Mercenary contract). It happens this tick.
 */
export const pay: OrderKind = {
  validate(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === order.residentId)
    if (!r || !realm || !commands(world, realm.id, r)) return 'not one of your residents'
    const c = world.contracts.find((x) => x.id === order.contractId)
    if (c && c.hirerId !== realm.id) return 'you are not the hirer of that contract'
    return cannotPay(world, r, c, order.weeks)
  },
  apply(world, _sender, order) {
    const r = world.residents.find((x) => x.id === order.residentId)
    if (r)
      r.order = {
        kind: 'pay',
        contractId: order.contractId as string,
        weeks: order.weeks as number,
      }
  },
}

/** The contract order kinds, besides the resident's pay order. */
export const contractOrders: Record<string, OrderKind> = {
  offerContract,
  acceptContract,
  cancelContract,
}

/**
 * Puts the coins for `weeks` game weeks of the contract into its storage, and counts them as
 * paid. Whoever brings them (a pay order, later a Trade Org transfer) has checked there are weeks
 * left and taken the coins from where they were.
 */
export function payInto(world: WorldState, c: MercenaryContract, weeks: number): void {
  const storage = world.buildings.find((b) => b.id === c.storageId)!
  const stock = (storage.stock ??= {})
  stock.coins = (stock.coins ?? 0) + weeks * c.pricePerWeek
  c.paidWeeks += weeks
  tellBoth(world, c, 'paid', weeks)
}

/**
 * Carries out pay orders: each payer who still can puts the coins into the storage, and the
 * contract counts the weeks as paid. Either way the order is done. Returns how many paid.
 */
export function resolvePayments(world: WorldState): number {
  let paid = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'pay') continue
    r.order = null
    const c = world.contracts.find((x) => x.id === o.contractId)
    if (!c || cannotPay(world, r, c, o.weeks)) continue
    const coins = o.weeks * c.pricePerWeek
    const left = r.carried.coins! - coins
    if (left > 0) r.carried.coins = left
    else delete r.carried.coins
    payInto(world, c, o.weeks)
    paid++
  }
  return paid
}

/** Sends a resident whose contract is over home to their city, if it still stands. */
function sendHome(world: WorldState, r: Resident): void {
  delete r.script
  r.order = null
  const city = world.cities.find((c) => c.id === r.cityId)
  const hall = city && townHallOf(world, city)
  if (hall && (r.x !== hall.x || r.y !== hall.y)) walkTo(r, hall)
}

/**
 * Keeps contracts sound and ends them, as a tick ends: a resident who died or no longer belongs
 * to the lender drops out, and a contract left with nobody, or with a side whose realm ended, is
 * gone. An offer whose storage is no longer the lender's is gone too. A contract in force ends
 * when its time is up with every week paid, and breaks once a week ends unpaid (`contractPayBy`);
 * either way its residents walk home.
 */
export function stepContracts(world: WorldState): void {
  if (world.contracts.length === 0) return
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const realms = new Set(world.realms.map((r) => r.id))
  const kept: MercenaryContract[] = []
  for (const c of world.contracts) {
    c.residentIds = c.residentIds.filter((id) => byId.get(id)?.owner === c.lenderId)
    const sound = c.residentIds.length > 0 && realms.has(c.lenderId) && realms.has(c.hirerId)
    if (c.startedAt === null) {
      if (sound && storageRealm(world, c.storageId) === c.lenderId) kept.push(c)
      continue
    }
    const payBy = contractPayBy(c)
    const over = !sound || world.tick >= contractEndsAt({ ...c, startedAt: c.startedAt })
    const broken = payBy !== null && world.tick >= payBy
    if (!over && !broken) {
      kept.push(c)
      continue
    }
    for (const id of c.residentIds) sendHome(world, byId.get(id)!)
    if (c.residentIds.length > 0) tellBoth(world, c, broken ? 'broken' : 'ended')
  }
  world.contracts = kept
}

/**
 * Contracts hold together (`CONTEXT.md`: Mercenary contract): two different realms that exist,
 * residents who all live and belong to the lender, none in two contracts, a positive length and
 * price, a storage that exists, and no more weeks paid than it has. A contract in force has every
 * week paid that has ended, and has not run past its time.
 */
export const contractsSound: Invariant = {
  name: 'contracts-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const report = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const byId = new Map(world.residents.map((r) => [r.id, r]))
    const realms = new Set(world.realms.map((r) => r.id))
    const seen = new Set<string>()
    for (const c of world.contracts) {
      if (c.lenderId === c.hirerId) report(`contract ${c.id} rents to its own lender`, [c.id])
      for (const realm of [c.lenderId, c.hirerId]) {
        if (!realms.has(realm))
          report(`contract ${c.id} has realm ${realm}, which does not exist`, [c.id])
      }
      if (c.residentIds.length === 0) report(`contract ${c.id} has no residents`, [c.id])
      for (const id of c.residentIds) {
        const r = byId.get(id)
        if (!r) report(`contract ${c.id} has resident ${id}, who does not exist`, [c.id, id])
        else if (r.owner !== c.lenderId) {
          report(`contract ${c.id} rents out ${id}, who is not the lender’s`, [c.id, id])
        }
        if (seen.has(id)) report(`resident ${id} is in two contracts`, [id])
        seen.add(id)
      }
      if (!(c.days >= 1) || !(c.pricePerWeek >= 1)) {
        report(`contract ${c.id} has no length or price`, [c.id])
      }
      if (!world.buildings.some((b) => b.id === c.storageId) && c.startedAt === null) {
        report(`contract ${c.id} is offered with storage ${c.storageId}, which is gone`, [c.id])
      }
      if (c.paidWeeks < 0 || c.paidWeeks > contractWeeks(c)) {
        report(`contract ${c.id} has ${c.paidWeeks} weeks paid of ${contractWeeks(c)}`, [c.id])
      }
      if (c.startedAt === null) {
        if (c.paidWeeks !== 0) report(`contract ${c.id} is only offered but paid`, [c.id])
        continue
      }
      const payBy = contractPayBy(c)
      if (payBy !== null && world.tick >= payBy) {
        report(`contract ${c.id} has a week that ended unpaid`, [c.id])
      }
      if (world.tick >= contractEndsAt({ ...c, startedAt: c.startedAt })) {
        report(`contract ${c.id} ran past its time`, [c.id])
      }
    }
    return out
  },
}
