import {
  DIRECT_OFFER_DAYS,
  TICKS_PER_GAME_DAY,
  acceptOfferProblem,
  carriageCommanderOf,
  commanderOf,
  declineOfferProblem,
  directOfferProblem,
  goodsCapacity,
  handsOf,
  isAt,
  loadOf,
  offerOpenTo,
  offerStorage,
  organizationLabel,
  postOfferProblem,
  quoteOffer,
  realmsToOfferTo,
  STANDING_TRADE_COINS_PER_POINT,
  timesToPost,
  type DirectOfferTerms,
  type Good,
  type Offer,
  type OfferEnd,
  type OfferTerms,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { orderedResident } from './order-sender.js'
import type { OrderKind, OrderSender } from './orders.js'
import { sightOf } from './sight.js'
import { raiseStandingBothWays } from './standing.js'
import { newId, realmOf } from './starting-city.js'
import { worthOf } from './trade-org-punishment.js'

/** The terms of an offer as the realm log tells them. */
const terms = (o: Offer) => ({
  gives: o.gives,
  givesUnits: o.givesUnits,
  wants: o.wants,
  wantsUnits: o.wantsUnits,
  x: o.x,
  y: o.y,
})

/** A new offer on checked terms at the realm's storage, its goods set aside from now on. */
function standOffer(
  world: WorldState,
  realmId: string,
  t: OfferTerms,
  direct?: DirectOfferTerms,
): Offer {
  const storage = offerStorage(world, realmId, t.storageId)!
  const gives = t.gives as Good
  const givesUnits = t.givesUnits as number
  const offer: Offer = {
    id: newId(world, 'offer'),
    realmId,
    storageId: storage.id,
    x: storage.x,
    y: storage.y,
    gives,
    givesUnits,
    wants: t.wants as Good,
    wantsUnits: t.wantsUnits as number,
    times: timesToPost(world, storage, gives, givesUnits, t.times as number),
    ...(direct && { direct }),
  }
  world.offers.push(offer)
  return offer
}

/**
 * The post-offer order (`CONTEXT.md`: Offer): a Player posts an offer at a storage of their realm,
 * wherever their residents are, up to `times` over. The goods not yet set aside there go aside.
 */
const postOffer: OrderKind = {
  validate(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    if (!realm) return 'you have no realm'
    return postOfferProblem(world, realm.id, order as unknown as OfferTerms)
  },
  apply(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    const t = order as unknown as OfferTerms
    // Something may have taken the goods or the storage since the order came.
    if (!realm || postOfferProblem(world, realm.id, t)) return
    standOffer(world, realm.id, t)
  },
}

/** The input of a send-direct-offer order: an offer's terms and the realm it goes to. */
type DirectOfferRequest = OfferTerms & { toId: unknown }

/** Whether the realm has anyone of `otherId`'s in sight, on a map of `size` tiles. */
function seesResidentsOf(world: WorldState, realmId: string, otherId: string, size: number) {
  const sees = sightOf(world, size, realmId)
  return world.residents.some((r) => r.owner === otherId && sees(r))
}

/** Why the realm can't send this Direct offer, or undefined when it can (`CONTEXT.md`). */
function sendProblem(
  world: WorldState,
  realmId: string,
  t: DirectOfferRequest,
  size?: number,
): string | undefined {
  const problem = directOfferProblem(world, realmId, t.toId, t)
  if (problem) return problem
  const known =
    realmsToOfferTo(world, realmId, []).includes(t.toId as string) ||
    (size !== undefined && seesResidentsOf(world, realmId, t.toId as string, size))
  return known ? undefined : 'you don’t know of that realm'
}

/**
 * The send-direct-offer order (`CONTEXT.md`: Direct offer): an offer at a storage of the Player's
 * realm, wherever their residents are, that only the named realm can accept until it lapses. The
 * other side hears at once, wherever they are.
 */
const sendDirectOffer: OrderKind = {
  validate(world, sender, order, terrain) {
    const realm = realmOf(world, sender.userId)
    if (!realm) return 'you have no realm'
    return sendProblem(world, realm.id, order as unknown as DirectOfferRequest, terrain?.size)
  },
  apply(world, sender, order, terrain) {
    const realm = realmOf(world, sender.userId)
    const t = order as unknown as DirectOfferRequest
    // Something may have taken the goods, the storage or the other realm since the order came.
    if (!realm || sendProblem(world, realm.id, t, terrain?.size)) return
    const toId = t.toId as string
    const lapsesAt = world.tick + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY
    const offer = standOffer(world, realm.id, t, { toId, lapsesAt })
    recordEvent(world, toId, {
      kind: 'directOffer',
      what: 'received',
      from: organizationLabel(world, realm.id),
      times: offer.times,
      ...terms(offer),
    })
  },
}

/** The decline order (`CONTEXT.md`: Direct offer): the realm it was sent to turns it down. */
const declineOffer: OrderKind = {
  validate(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    if (!realm) return 'you have no realm'
    return declineOfferProblem(world, realm.id, (order as unknown as TakeDownRequest).offerId)
  },
  apply(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    const { offerId } = order as unknown as TakeDownRequest
    if (!realm || declineOfferProblem(world, realm.id, offerId)) return
    endOffer(world, world.offers.find((o) => o.id === offerId)!, 'declined')
  },
}

/** The input of a take-down order. */
interface TakeDownRequest {
  offerId: unknown
}

/** The offer `offerId` if it is the sender's realm's. */
function ownOffer(world: WorldState, sender: OrderSender, offerId: unknown): Offer | undefined {
  const realm = realmOf(world, sender.userId)
  return realm && world.offers.find((o) => o.id === offerId && o.realmId === realm.id)
}

/**
 * The take-down order (`CONTEXT.md`: Offer): a Player takes down an offer of their realm, and what
 * it set aside is ordinary goods of the storage again.
 */
const takeDownOffer: OrderKind = {
  validate(world, sender, order) {
    const { offerId } = order as unknown as TakeDownRequest
    return ownOffer(world, sender, offerId) ? undefined : 'not an offer of yours'
  },
  apply(world, sender, order) {
    const { offerId } = order as unknown as TakeDownRequest
    const offer = ownOffer(world, sender, offerId)
    if (offer) endOffer(world, offer, 'takenDown')
  },
}

/** The input of an accept order: the resident, the offer, how many times, maybe a carriage. */
interface AcceptRequest {
  residentId: unknown
  offerId: string
  times: number
  carriageId?: string | null
}

/**
 * The accept order (`CONTEXT.md`: Offer): one of the side's residents, on the storage's tile, gets
 * the order to take an offer up to `times` over, which happens this tick (`resolveOffers`). A
 * Player's realm or an NPC city's default can give it; the offer's own realm can't accept it.
 */
const acceptOffer: OrderKind = {
  validate(world, sender, order) {
    const o = order as unknown as AcceptRequest
    const r = orderedResident(world, sender, o.residentId)
    const side = sender.npcCityId ?? realmOf(world, sender.userId)?.id
    if (!r || side === undefined) return 'not one of your residents'
    return acceptOfferProblem(world, side, r, o.offerId, o.times, o.carriageId)
  },
  apply(world, _sender, order) {
    const o = order as unknown as AcceptRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) {
      r.order = {
        kind: 'acceptOffer',
        offerId: o.offerId,
        times: o.times,
        carriageId: o.carriageId ?? null,
      }
    }
  },
}

export const offerOrders: Record<string, OrderKind> = {
  postOffer,
  takeDownOffer,
  acceptOffer,
  sendDirectOffer,
  declineOffer,
}

/** One offer accepted this tick, with the goods of everyone in it before and after. */
interface Accepted {
  residentId: string
  before: Stock
  after: Stock
}

/** The offers accepted by the latest `resolveOffers`, kept beside the world for `offersKeepGoods`. */
const ledger = new WeakMap<WorldState, Accepted[]>()

/** The goods of two stocks added up. */
function total(a: Stock, b: Stock): Stock {
  const sum: Stock = { ...a }
  for (const [good, n] of Object.entries(b) as [Good, number][]) sum[good] = (sum[good] ?? 0) + n
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
 * What an offer accepted moved, in Coins, for standing as a trade raises it. With Coins on one side
 * it is a sale or a purchase: the Coins that changed hands. Goods for goods it is a sale and a
 * purchase at once, like a swap (`CONTEXT.md`: Swap), so both goods count; an offer has no prices of
 * its own, so they count at warehouse base prices. Its two goods always differ (`offerProblem`).
 */
function offerWorth(offer: Offer, gives: number, wants: number): number {
  if (offer.gives === 'coins') return gives
  if (offer.wants === 'coins') return wants
  return worthOf({ [offer.gives]: gives, [offer.wants]: wants })
}

/**
 * Carries out accept orders (`CONTEXT.md`: Offer): where the offer stands and the trader and any
 * carriage are still on its storage's tile, it is taken as many times as they can pay and carry
 * (`quoteOffer`), whether or not its Player is online. What they pay goes into the storage as
 * ordinary goods, what it gives comes out of what was set aside. It raises standing both ways, like
 * a trade. An offer used up ends. Either way the order is done, with a line in each realm's log.
 * Returns how many moved anything.
 */
export function resolveOffers(world: WorldState): number {
  const records: Accepted[] = []
  ledger.set(world, records)
  let done = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'acceptOffer') continue
    r.order = null
    const offer = world.offers.find((x) => x.id === o.offerId)
    if (offer && acceptNow(world, r, offer, o.times, o.carriageId, records)) done++
  }
  return done
}

/** One accept order of `r` carried out; whether it moved anything. */
function acceptNow(
  world: WorldState,
  r: Resident,
  offer: Offer,
  wanted: number,
  carriageId: string | null,
  records: Accepted[],
): boolean {
  const side = commanderOf(world, r) ?? r.cityId
  const storage = world.buildings.find((b) => b.id === offer.storageId)
  if (side === null || side === offer.realmId || !offerOpenTo(offer, side)) return false
  if (!storage || !isAt(r, storage)) return false
  const carriage =
    carriageId === null ? undefined : world.carriages.find((k) => k.id === carriageId)
  if (carriageId !== null) {
    if (!carriage || carriageCommanderOf(world, carriage) !== side || !isAt(carriage, storage)) {
      return false
    }
  }
  const holder = carriage
    ? loadOf(carriage, goodsCapacity(world, carriage))
    : handsOf(r, world.tick)
  const stock = (storage.stock ??= {})
  const q = quoteOffer(offer, holder, wanted, stock[offer.gives] ?? 0)
  const before = total(holder.stock, stock)
  move(stock, holder.stock, offer.gives, q.gives)
  move(holder.stock, stock, offer.wants, q.wants)
  records.push({ residentId: r.id, before, after: total(holder.stock, stock) })
  offer.times -= q.times
  if (q.times > 0) {
    const worth = offerWorth(offer, q.gives, q.wants)
    raiseStandingBothWays(world, side, offer.realmId, worth / STANDING_TRADE_COINS_PER_POINT)
    recordEvent(world, offer.realmId, {
      kind: 'offerTaken',
      by: organizationLabel(world, side),
      ...terms(offer),
      givesUnits: q.gives,
      wantsUnits: q.wants,
      times: q.times,
    })
  }
  recordEvent(world, commanderOf(world, r), {
    kind: 'offerAccepted',
    residentId: r.id,
    name: r.name,
    realm: organizationLabel(world, offer.realmId),
    ...terms(offer),
    givesUnits: q.gives,
    wantsUnits: q.wants,
    times: q.times,
    wanted,
  })
  if (offer.times <= 0) endOffer(world, offer, 'usedUp')
  return q.times > 0
}

/**
 * Takes an offer out of the world, with a line in its realm's log and, for a Direct offer, in the
 * log of the realm it was sent to, who already heard if they used it up.
 */
function endOffer(world: WorldState, offer: Offer, why: OfferEnd): void {
  world.offers = world.offers.filter((o) => o !== offer)
  const toId = offer.direct?.toId
  recordEvent(world, offer.realmId, {
    kind: 'offerEnded',
    why,
    ...(toId !== undefined && { to: organizationLabel(world, toId) }),
    ...terms(offer),
  })
  if (toId === undefined || why === 'usedUp') return
  recordEvent(world, toId, {
    kind: 'directOffer',
    what: why,
    from: organizationLabel(world, offer.realmId),
    ...terms(offer),
  })
}

/** Whether a Direct offer's time is up, or the realm it was sent to is gone. */
const lapsed = (world: WorldState, direct: DirectOfferTerms) =>
  world.tick >= direct.lapsesAt || !world.realms.some((r) => r.id === direct.toId)

/**
 * Offers follow their storages at the end of each tick (`CONTEXT.md`: Offer): one whose storage is
 * torn down or no longer its realm's ends, and goods gone from the storage, to thieves or raiders
 * or spoiling, cut it down, the newest at a storage first. One cut down to nothing ends, and any
 * goods short of its next time over are ordinary again. A Direct offer lapses at its time, or when
 * the realm it was sent to is gone, for nobody else can accept it.
 */
export function stepOffers(world: WorldState): void {
  if (world.offers.length === 0) return
  const left = new Map<string, Stock>()
  for (const offer of [...world.offers]) {
    const storage = offerStorage(world, offer.realmId, offer.storageId)
    if (!storage) {
      endOffer(world, offer, 'storageLost')
      continue
    }
    if (offer.direct && lapsed(world, offer.direct)) {
      endOffer(world, offer, 'lapsed')
      continue
    }
    const stock = left.get(storage.id) ?? { ...storage.stock }
    left.set(storage.id, stock)
    const held = stock[offer.gives] ?? 0
    const times = Math.min(offer.times, Math.floor(held / offer.givesUnits))
    stock[offer.gives] = held - times * offer.givesUnits
    if (times === offer.times) continue
    offer.times = times
    if (times === 0) endOffer(world, offer, 'goodsGone')
    else recordEvent(world, offer.realmId, { kind: 'offerCutDown', times, ...terms(offer) })
  }
}

/**
 * An offer's storage exists and is its realm's, its terms are whole and positive, and what its
 * storage's offers set aside never exceeds what the storage holds (`CONTEXT.md`: Offer). A Direct
 * offer goes to a realm other than its own that is still there, and hasn't outlived its time.
 */
export const offersSound: Invariant = {
  name: 'offers-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (o: Offer, message: string) =>
      out.push({
        invariant: this.name,
        message: `offer ${o.id} ${message}`,
        entityIds: [o.id, o.storageId],
      })
    const aside = new Map<string, Stock>()
    for (const o of world.offers) {
      const storage = offerStorage(world, o.realmId, o.storageId)
      if (!storage) fail(o, `stands at ${o.storageId}, no finished storage of ${o.realmId}`)
      const whole = [o.givesUnits, o.wantsUnits, o.times].every((n) => Number.isInteger(n) && n > 0)
      if (!whole) fail(o, 'has terms that aren’t whole and positive')
      if (o.gives === o.wants) fail(o, `wants the ${o.gives} it gives`)
      if (o.direct?.toId === o.realmId) fail(o, 'was sent to its own realm')
      if (o.direct && lapsed(world, o.direct)) fail(o, `outlived its time for ${o.direct.toId}`)
      const stock = aside.get(o.storageId) ?? {}
      aside.set(o.storageId, stock)
      stock[o.gives] = (stock[o.gives] ?? 0) + o.times * o.givesUnits
      const holds = storage?.stock?.[o.gives] ?? 0
      if (storage && stock[o.gives]! > holds + 1e-6) {
        fail(o, `has ${stock[o.gives]} ${o.gives} set aside where ${holds} are held`)
      }
    }
    return out
  },
}

/** Accepting an offer moves goods and creates none: as `tradesKeepGoods` for trades. */
export const offersKeepGoods: Invariant = {
  name: 'offers-keep-goods',
  check(world) {
    return (ledger.get(world) ?? []).flatMap((t) => {
      const goods = new Set([...Object.keys(t.before), ...Object.keys(t.after)] as Good[])
      return [...goods]
        .filter((g) => Math.abs((t.before[g] ?? 0) - (t.after[g] ?? 0)) > 1e-6)
        .map((g) => ({
          invariant: this.name,
          message: `an offer accepted by ${t.residentId} turned ${t.before[g] ?? 0} ${g} into ${t.after[g] ?? 0}`,
          entityIds: [t.residentId],
        }))
    })
  },
}

/** Every accept order is done the tick it is given (`resolveOffers`): none outlasts a tick. */
export const acceptOrdersDone: Invariant = {
  name: 'accept-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'acceptOffer')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds an accept order after the tick`,
        entityIds: [r.id],
      }))
  },
}

/** Test hook: the offers accepted by the latest `resolveOffers`, so a test can tamper with one. */
export function offersAcceptedIn(world: WorldState): Accepted[] {
  return ledger.get(world) ?? []
}
