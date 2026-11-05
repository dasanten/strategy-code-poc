import { isAllianceCity, sharingSight, type RealmLabel } from './alliance.js'
import {
  DEMANDS_PER_GAME_DAY,
  DEMAND_NOTE_MAX_LENGTH,
  DEMAND_YIELD_RESPECT_MIN,
  DEMAND_YIELD_RESPECT_TIMES,
  GOOD_WEIGHT,
} from './balance.js'
import { forSale } from './city.js'
import { freeStock, offerStorage } from './offers.js'
import { citySoldiers, respectSeenBy } from './persuasion.js'
import { organizationLabel } from './standing.js'
import { TRADE_ORG } from './trade-org.js'
import { pickUpTransferProblem, transferFee, transferLoad } from './transfer.js'
import { deliveryStorage } from './warehouse.js'
import {
  GOODS,
  TICKS_PER_GAME_DAY,
  type City,
  type Demand,
  type DemandTerms,
  type Good,
  type Realm,
  type Stock,
  type WorldState,
} from './world.js'

/** World queries about demands (`CONTEXT.md`: Demand; ADR 0002: the API orders and scripts share). */

/** Control characters but tab and line breaks: they mean nothing in a note and can garble a page. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

/**
 * What is wrong with a demand's note, if anything: it must be text, trimmed not empty, at most
 * `DEMAND_NOTE_MAX_LENGTH` characters and free of control characters. It is kept and shown as
 * plain text, so markup in it is only ever read as the words it is.
 */
export function demandNoteProblem(note: unknown): string | undefined {
  if (typeof note !== 'string' || note.trim() === '') return 'a demand needs a note'
  if (note.trim().length > DEMAND_NOTE_MAX_LENGTH) {
    return `a note is at most ${DEMAND_NOTE_MAX_LENGTH} characters`
  }
  if (CONTROL_CHARACTERS.test(note)) return 'a note can’t hold control characters'
  return undefined
}

/** When the realm sent the demands that still count against `DEMANDS_PER_GAME_DAY`. */
export function demandsCounted(realm: Pick<Realm, 'demandsSentAt'>, tick: number): number[] {
  return (realm.demandsSentAt ?? []).filter((at) => tick - at < TICKS_PER_GAME_DAY)
}

/** How many more demands the realm may send now. */
export function demandsLeft(realm: Pick<Realm, 'demandsSentAt'>, tick: number): number {
  return Math.max(0, DEMANDS_PER_GAME_DAY - demandsCounted(realm, tick).length)
}

/**
 * The other realms a realm knows of (`CONTEXT.md`: Demand): those it sees residents of
 * (`seenRealms`, which may hold anything else too), its allies, those whose cities it has seen
 * (Last seen), those with a standing toward it or it toward them, and its sides in contracts,
 * demands and Direct offers.
 */
export function realmsKnownTo(
  world: Pick<
    WorldState,
    'realms' | 'alliances' | 'lastSeen' | 'standings' | 'contracts' | 'demands' | 'offers'
  >,
  realmId: string,
  seenRealms: Iterable<string>,
): string[] {
  const known = new Set<string>(seenRealms)
  for (const id of sharingSight(world, realmId)) known.add(id)
  const userId = world.realms.find((r) => r.id === realmId)?.userId
  const remembered = userId === undefined ? undefined : world.lastSeen[userId]
  for (const m of remembered ?? []) {
    if (m.is === 'city' && m.realmId !== null) known.add(m.realmId)
  }
  for (const s of world.standings) {
    if (s.of === realmId) known.add(s.toward)
    if (s.toward === realmId) known.add(s.of)
  }
  for (const c of world.contracts) {
    if (c.lenderId === realmId) known.add(c.hirerId)
    if (c.hirerId === realmId) known.add(c.lenderId)
  }
  for (const d of world.demands) {
    if (d.fromId === realmId) known.add(d.toId)
    if (d.toId === realmId) known.add(d.fromId)
  }
  for (const o of world.offers) {
    if (!o.direct) continue
    if (o.realmId === realmId) known.add(o.direct.toId)
    if (o.direct.toId === realmId) known.add(o.realmId)
  }
  return world.realms.map((r) => r.id).filter((id) => id !== realmId && known.has(id))
}

/**
 * Whether the game answers demands sent to `id` (`CONTEXT.md`: Demand), and why: the Trade
 * Organization, or a city by its id. Undefined for a realm, or nothing at all.
 */
export function answeredByGame(
  world: Pick<WorldState, 'cities'>,
  id: string,
): 'tradeOrg' | 'city' | undefined {
  if (id === TRADE_ORG) return 'tradeOrg'
  return world.cities.some((c) => c.id === id) ? 'city' : undefined
}

/**
 * Whom else a realm can send a demand, for the game to answer (`CONTEXT.md`: Demand): the Trade
 * Organization, which everyone knows of, and the NPC cities it knows of: those it sees (`seen`, which
 * may hold anything else too), those it last saw as NPC cities, and those with a standing either way.
 */
export function npcOrgsKnownTo(
  world: Pick<WorldState, 'realms' | 'cities' | 'lastSeen' | 'standings'>,
  realmId: string,
  seen: Iterable<string>,
): string[] {
  const known = new Set<string>()
  for (const id of seen) if (isAllianceCity(world, id)) known.add(id)
  for (const s of world.standings) {
    if (s.toward === realmId && isAllianceCity(world, s.of)) known.add(s.of)
    if (s.of === realmId && isAllianceCity(world, s.toward)) known.add(s.toward)
  }
  const userId = world.realms.find((r) => r.id === realmId)?.userId
  const remembered = userId === undefined ? undefined : world.lastSeen[userId]
  for (const m of remembered ?? []) {
    if (m.is === 'city' && m.realmId === null && m.tradeOrg === undefined) known.add(m.id)
  }
  const cities = world.cities.filter((c) => known.has(c.id) && c.realmId !== realmId)
  return [TRADE_ORG, ...cities.map((c) => c.id)]
}

/**
 * Whether an NPC city gives in to a realm's demand (`CONTEXT.md`: Demand): the respect it sees from
 * the realm, its armed residents and walls in the city's sight, far outweighs its soldiers. `size`
 * is the map's.
 */
export function yieldsToDemand(
  world: Pick<WorldState, 'residents' | 'buildings' | 'cities'>,
  city: City,
  realmId: string,
  size: number,
): boolean {
  if (!forSale(city)) return false
  const needed = Math.max(
    DEMAND_YIELD_RESPECT_MIN,
    DEMAND_YIELD_RESPECT_TIMES * citySoldiers(world, city),
  )
  return respectSeenBy(world, city, realmId, size) >= needed
}

/**
 * How the one accepting a demand hands over the goods and Coins it names (`CONTEXT.md`: Demand), as
 * they pick: set aside at a storage of theirs, for the sender alone to fetch, or sent by a Transfer
 * from a city of theirs to a city of the sender's, the fee theirs.
 */
export type DemandHandOver =
  { way: 'setAside'; storageId: string } | { way: 'transfer'; fromCityId: string; toCityId: string }

/**
 * What goes of the goods demanded from a storage holding `free` that isn't set aside already: as
 * many whole units of each as it holds, up to what was demanded (`CONTEXT.md`: Demand).
 */
export function goodsToHandOver(goods: Partial<Record<Good, number>>, free: Stock): Stock {
  const going: Stock = {}
  for (const good of GOODS) {
    const units = Math.min(goods[good] ?? 0, Math.floor(free[good] ?? 0))
    if (units > 0) going[good] = units
  }
  return going
}

/** Goods sent by Transfer, as the Transfers they take: each good by itself, one load at a time. */
export function transferLoads(goods: Stock): { good: Good; units: number }[] {
  const loads: { good: Good; units: number }[] = []
  for (const good of GOODS) {
    const load = transferLoad(good)
    for (let left = goods[good] ?? 0; left > 0; left -= load) {
      loads.push({ good, units: Math.min(left, load) })
    }
  }
  return loads
}

/** What the Transfers for these goods cost together, each over a whole way of `tiles`. */
export function transferLoadsFee(goods: Stock, tiles: number): number {
  return transferLoads(goods).reduce(
    (fee, { good, units }) => fee + transferFee(units * GOOD_WEIGHT[good], tiles),
    0,
  )
}

/** The storage goods demanded would go from, for a hand-over named as an order takes it. */
function handOverStorage(
  world: Pick<WorldState, 'buildings' | 'cities'>,
  realmId: string,
  how: DemandHandOver,
) {
  if (how.way === 'setAside') return offerStorage(world, realmId, how.storageId)
  return deliveryStorage(world, how.fromCityId)
}

/**
 * What of a demand's goods this hand-over would move now, by `realmId`: an empty stock with none
 * there, or when the storage named isn't theirs.
 */
export function goodsHandedOver(
  world: Pick<WorldState, 'buildings' | 'cities' | 'offers'>,
  realmId: string,
  goods: Partial<Record<Good, number>>,
  how: DemandHandOver,
): Stock {
  const storage = handOverStorage(world, realmId, how)
  return storage ? goodsToHandOver(goods, freeStock(world, storage)) : {}
}

/**
 * Why `realmId` can't hand over a demand's goods this way, or undefined when it can
 * (`CONTEXT.md`: Demand): a storage of its own holding some of them, or a Transfer it could order to
 * a city of the sender's. Less than demanded will do: what is short is said before accepting.
 */
export function demandHandOverProblem(
  world: WorldState,
  realmId: string,
  demand: Pick<Demand, 'fromId' | 'terms'>,
  how: unknown,
): string | undefined {
  if (demand.terms.kind !== 'goods') return undefined
  const h = (typeof how === 'object' && how !== null ? how : {}) as Record<string, unknown>
  let handOver: DemandHandOver
  if (h.way === 'setAside') {
    if (!offerStorage(world, realmId, h.storageId)) return 'not a finished storage of yours'
    handOver = { way: 'setAside', storageId: h.storageId as string }
  } else if (h.way === 'transfer') {
    const to = world.cities.find((c) => c.id === h.toCityId)
    if (to?.realmId !== demand.fromId) return 'send it to a city of theirs'
    for (const good of Object.keys(demand.terms.goods)) {
      const problem = pickUpTransferProblem(world, realmId, h.fromCityId, good, 1, h.toCityId)
      if (problem) return problem
    }
    handOver = { way: 'transfer', fromCityId: h.fromCityId as string, toCityId: to.id }
  } else {
    return 'set the goods aside at a storage, or send them by a Transfer'
  }
  return Object.keys(goodsHandedOver(world, realmId, demand.terms.goods, handOver)).length === 0
    ? 'that storage holds none of it that isn’t set aside'
    : undefined
}

/** A demand as one of its sides sees it. */
export interface DemandView {
  id: string
  from: RealmLabel
  to: RealmLabel
  terms: DemandTerms
  /** The sender's words: plain text, never markup. */
  note: string
  sentAt: number
  deadline: number
}

/** The demands waiting for an answer that the realm sent or was sent, oldest first. */
export function demandsFor(
  world: Pick<WorldState, 'demands' | 'realms' | 'residents' | 'cities'>,
  realmId: string,
): DemandView[] {
  const label = (id: string): RealmLabel => ({
    realmId: id,
    realm: organizationLabel(world, id),
    ...(answeredByGame(world, id) === 'city' && { city: true as const }),
  })
  return world.demands
    .filter((d: Demand) => d.fromId === realmId || d.toId === realmId)
    .map((d) => ({
      id: d.id,
      from: label(d.fromId),
      to: label(d.toId),
      terms: d.terms,
      note: d.note,
      sentAt: d.sentAt,
      deadline: d.deadline,
    }))
}
