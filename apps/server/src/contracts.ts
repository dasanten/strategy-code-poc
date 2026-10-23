import {
  CONTRACT_MAX_DAYS,
  STANDING_CONTRACT_BROKEN_LOSS,
  STANDING_PER_PAID_WEEK,
  SIGHT_RANGE,
  commands,
  handedOverTo,
  contractEndsAt,
  contractPayBy,
  contractWeeks,
  TRADE_ORG,
  contractSide,
  forSale,
  npcCityRefuses,
  organizationLabel,
  realmName,
  spareResidents,
  townHallOf,
  tradeOrgHq,
  wrapDistance,
  type MercenaryContract,
  type OrderRequest,
  type Resident,
  type WorldState,
  isAt,
} from '@csp/shared'
import { leaveArmies } from './armies.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { walkTo } from './npc-behaviour.js'
import type { OrderKind } from './orders.js'
import { newId, realmOf } from './starting-city.js'
import { spareSoldiers } from './trade-org-army.js'
import { changeStanding, raiseStandingBothWays } from './standing.js'

/*
 * Mercenary contracts (`CONTEXT.md`: Mercenary contract): one realm rents some of its residents
 * to another for coins over a number of game days. One side offers, the other accepts. While it
 * is in force the residents stay the lender's, and the lender still sees them, but they take only
 * the hirer's orders (`commanderOf`). Each game week is paid in advance into the lender's storage
 * with a pay order; a week that ends unpaid breaks the contract. At the end, or when it breaks,
 * the residents walk home. A side is a Player's realm, the Trade Organization (`TRADE_ORG`,
 * `CONTEXT.md`: Trade Org army), which the game runs (`stepTradeOrgArmy`), or an NPC city lending
 * its residents (`CONTEXT.md`: Hiring from an NPC city, `stepNpcHire`).
 */

/** The NPC city an id names, if it is one (`forSale`). */
function npcCity(world: WorldState, id: unknown) {
  const city = world.cities.find((c) => c.id === id)
  return city && forSale(city) ? city : undefined
}

/**
 * The side whose storage it is: the realm of the city a finished storage belongs to, the city
 * itself for an NPC city's, or `TRADE_ORG` for a finished warehouse of one of the Trade
 * Organization's cities.
 */
function storageRealm(world: WorldState, storageId: unknown): string | null {
  const b = world.buildings.find((x) => x.id === storageId)
  if (!b || b.site) return null
  const city = world.cities.find((c) => c.id === b.cityId)
  if (b.kind === 'storage') return city && forSale(city) ? city.id : (city?.realmId ?? null)
  return b.kind === 'warehouse' && city?.tradeOrg ? TRADE_ORG : null
}

/**
 * Whether a contract side exists: a realm, the Trade Organization while it has its HQ, or an
 * NPC city while it is one.
 */
function sideExists(world: WorldState, id: string): boolean {
  if (id === TRADE_ORG) return tradeOrgHq(world) !== undefined
  return world.realms.some((r) => r.id === id) || npcCity(world, id) !== undefined
}

/** Whether the resident is a realm's Leader (`CONTEXT.md`: Leader), whom nobody hires. */
const isLeader = (world: WorldState, id: string) => world.realms.some((r) => r.leaderId === id)

/** Whether the resident is named in any contract, offered or in force. */
const contracted = (world: WorldState, id: string) =>
  world.contracts.some((c) => c.residentIds.includes(id))

/** Whether any of the realm's residents sees the spot. */
function inSightOf(world: WorldState, realmId: string, at: Resident, size: number): boolean {
  return world.residents.some(
    (x) => commands(world, realmId, x) && wrapDistance(size, x, at) <= SIGHT_RANGE,
  )
}

/**
 * The residents an offer names: `residentIds`, or, asking the Trade Organization (`realmId` is
 * `TRADE_ORG`) for a number of `soldiers`, that many it can spare (`spareSoldiers`), or asking an
 * NPC city (`realmId` is its id) for a number of `residents`, that many it would lend
 * (`spareResidents`). A reason when they can't be.
 */
function offeredResidents(world: WorldState, order: OrderRequest): unknown[] | string {
  const city = npcCity(world, order.realmId)
  if (city) {
    const n = order.residents
    if (!Number.isInteger(n) || (n as number) < 1) return 'ask for a whole number of residents'
    const spare = spareResidents(world, city)
    if (spare.length < (n as number)) {
      return `${city.name} can spare only ${spare.length} residents`
    }
    return spare.slice(0, n as number).map((r) => r.id)
  }
  if (order.realmId !== TRADE_ORG || order.soldiers === undefined) {
    return Array.isArray(order.residentIds) ? order.residentIds : []
  }
  const n = order.soldiers
  if (!Number.isInteger(n) || (n as number) < 1) return 'ask for a whole number of soldiers'
  const spare = spareSoldiers(world)
  if (spare.length < (n as number)) {
    return `the Trade Organization can spare only ${spare.length} soldiers`
  }
  return spare.slice(0, n as number).map((r) => r.id)
}

/** An offer's terms as plain data, or a reason they are not good. */
function readOffer(
  world: WorldState,
  realmId: string,
  order: OrderRequest,
  size?: number,
): MercenaryContract | string {
  const ids = offeredResidents(world, order)
  if (typeof ids === 'string') return ids
  if (ids.length === 0) return 'a contract needs at least one resident'
  if (new Set(ids).size !== ids.length) return 'a resident is named twice'
  const residents = ids.map((id) => world.residents.find((r) => r.id === id))
  if (residents.some((r) => !r)) return 'no such resident'
  const lenderId = contractSide(world, residents[0]!)
  if (lenderId === null || !residents.every((r) => contractSide(world, r!) === lenderId)) {
    return 'the residents must all be of one realm'
  }
  if (ids.some((id) => contracted(world, id as string))) {
    return 'a resident is already in a contract'
  }
  if (ids.some((id) => handedOverTo(world, id as string))) {
    return 'a resident is in an alliance army'
  }
  if (ids.some((id) => isLeader(world, id as string))) return 'a Leader is never hired out'
  let hirerId: string
  if (lenderId === realmId) {
    if (order.realmId === TRADE_ORG) return 'the Trade Organization hires only by its own offers'
    if (typeof order.realmId !== 'string' || !world.realms.some((r) => r.id === order.realmId)) {
      return 'offer them to a realm'
    }
    if (order.realmId === realmId) return 'offer them to another realm'
    hirerId = order.realmId
  } else if (lenderId === TRADE_ORG) {
    // It hires out its spare soldiers wherever they are, seen or not.
    const spare = new Set(spareSoldiers(world).map((r) => r.id))
    if (!ids.every((id) => spare.has(id as string))) {
      return 'the Trade Organization can’t spare those residents'
    }
    hirerId = realmId
  } else if (npcCity(world, lenderId)) {
    // An NPC city lends only by being asked for a number of its residents, wherever they are.
    if (order.realmId !== lenderId) return 'ask the city for a number of its residents'
    hirerId = realmId
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
    if (lenderId === TRADE_ORG) return 'the coins go into a warehouse of the Trade Organization'
    return npcCity(world, lenderId)
      ? 'the coins go into a storage of the city'
      : 'the coins go into a storage of the realm renting them out'
  }
  // A city that refuses the hirer says so at once; a low price it declines like any offer.
  const city = npcCity(world, lenderId)
  if (city && npcCityRefuses(world, city, hirerId)) return `${city.name} won’t hire out to you`
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
  leaderDied?: 'lender' | 'hirer',
): void {
  const n = c.residentIds.length
  const extra = {
    ...(weeks === undefined ? {} : { weeks }),
    ...(leaderDied === undefined ? {} : { leaderDied }),
  }
  const base = { kind: 'contract' as const, contractId: c.id, what, residents: n, ...extra }
  recordEvent(world, c.lenderId, {
    ...base,
    lender: true,
    other: organizationLabel(world, c.hirerId),
  })
  recordEvent(world, c.hirerId, {
    ...base,
    lender: false,
    other: organizationLabel(world, c.lenderId),
  })
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
export function cannotStart(world: WorldState, c: MercenaryContract): string | undefined {
  const lenders = (id: string) =>
    world.residents.some((r) => r.id === id && contractSide(world, r) === c.lenderId)
  if (!c.residentIds.every(lenders)) return 'the residents are no longer all the lender’s'
  if (c.residentIds.some((id) => isLeader(world, id))) return 'a Leader is never hired out'
  if (storageRealm(world, c.storageId) !== c.lenderId)
    return 'the storage is no longer the lender’s'
  return undefined
}

/**
 * Puts an offer in force from now: its residents stop what they were doing, scripts included,
 * and wait for the hirer's orders.
 */
export function startContract(world: WorldState, c: MercenaryContract): void {
  c.startedAt = world.tick
  for (const r of world.residents) {
    if (!c.residentIds.includes(r.id)) continue
    r.order = null
    delete r.script
  }
  tellBoth(world, c, 'started')
}

/** Accepting an offer the other side made (`startContract`). */
export const acceptContract = contractOrderKind(
  (world, realmId, order) => {
    const c = offerOf(world, realmId, order)
    if (typeof c === 'string') return c
    const mine = c.offeredBy === 'lender' ? c.hirerId : c.lenderId
    if (mine !== realmId) return 'the other side has to accept your offer'
    return cannotStart(world, c)
  },
  (world, _realmId, order) => {
    startContract(
      world,
      world.contracts.find((x) => x.id === order.contractId)!,
    )
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
  if (!b || !isAt(r, b)) return 'the resident must stand at the contract’s storage'
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
 * paid; each week paid raises standing both ways between its sides (`CONTEXT.md`: Standing). Whoever brings them (a pay order, later a Trade Org transfer) has checked there are weeks
 * left and taken the coins from where they were.
 */
export function payInto(world: WorldState, c: MercenaryContract, weeks: number): void {
  const storage = world.buildings.find((b) => b.id === c.storageId)!
  const stock = (storage.stock ??= {})
  stock.coins = (stock.coins ?? 0) + weeks * c.pricePerWeek
  c.paidWeeks += weeks
  raiseStandingBothWays(world, c.lenderId, c.hirerId, weeks * STANDING_PER_PAID_WEEK)
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
  if (hall && !isAt(r, hall)) walkTo(r, hall)
}

/**
 * A side's Leader died (`CONTEXT.md`: Self-managed city): every contract of the realm ends at
 * once, as a contract ends, not breaks, so it costs no standing. The rented residents stop what
 * they did for the hirer, haul routes included, leave the hirer's armies and walk home. Offers
 * lapse. Call it before the realm ends, while its residents are still the lender's and its name
 * is known.
 */
export function endContractsOnLeaderDeath(world: WorldState, realmId: string): void {
  const ending = world.contracts.filter((c) => c.lenderId === realmId || c.hirerId === realmId)
  if (ending.length === 0) return
  world.contracts = world.contracts.filter((c) => !ending.includes(c))
  for (const c of ending) {
    if (c.startedAt === null) continue
    const ids = new Set(c.residentIds)
    for (const r of world.residents) if (ids.has(r.id)) sendHome(world, r)
    leaveArmies(world, ids)
    tellBoth(world, c, 'ended', undefined, c.lenderId === realmId ? 'lender' : 'hirer')
  }
}

/**
 * Keeps contracts sound and ends them, as a tick ends: a resident who died or no longer belongs
 * to the lender drops out, and a contract left with nobody, or with a side whose realm ended, is
 * gone. An offer whose storage is no longer the lender's is gone too. A contract in force ends
 * when its time is up with every week paid, and breaks once a week ends unpaid (`contractPayBy`),
 * which costs standing with the lender (`CONTEXT.md`: Mercenary contract); either way its
 * residents walk home.
 */
export function stepContracts(world: WorldState): void {
  if (world.contracts.length === 0) return
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const kept: MercenaryContract[] = []
  for (const c of world.contracts) {
    c.residentIds = c.residentIds.filter((id) => {
      const r = byId.get(id)
      return r !== undefined && contractSide(world, r) === c.lenderId
    })
    const sound =
      c.residentIds.length > 0 && sideExists(world, c.lenderId) && sideExists(world, c.hirerId)
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
    if (broken && sound)
      changeStanding(world, c.lenderId, c.hirerId, -STANDING_CONTRACT_BROKEN_LOSS)
    if (c.residentIds.length > 0) tellBoth(world, c, broken ? 'broken' : 'ended')
  }
  world.contracts = kept
}

/**
 * Contracts hold together (`CONTEXT.md`: Mercenary contract): two different sides that exist,
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
    const seen = new Set<string>()
    for (const c of world.contracts) {
      if (c.lenderId === c.hirerId) report(`contract ${c.id} rents to its own lender`, [c.id])
      for (const realm of [c.lenderId, c.hirerId]) {
        if (!sideExists(world, realm))
          report(`contract ${c.id} has realm ${realm}, which does not exist`, [c.id])
      }
      if (c.residentIds.length === 0) report(`contract ${c.id} has no residents`, [c.id])
      for (const id of c.residentIds) {
        const r = byId.get(id)
        if (!r) report(`contract ${c.id} has resident ${id}, who does not exist`, [c.id, id])
        else if (contractSide(world, r) !== c.lenderId) {
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
