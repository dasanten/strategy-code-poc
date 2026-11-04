import { commandsCarriage } from './alliance.js'
import { GOOD_WEIGHT, canWork } from './balance.js'
import { buildingRealm } from './city.js'
import { covers, isAt } from './footprint.js'
import type { TradeHolder, TradeLimit } from './warehouse.js'
import {
  GOODS,
  type Building,
  type Good,
  type Offer,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

/*
 * Offers (`CONTEXT.md`: Offer): world queries the orders, scripts and the UI share (ADR 0002). An
 * offer's goods stay in its storage's stock; what it sets aside is worked out from its `times`.
 */

/** An offer as anyone in sight sees it: with its rate, what it wants for one unit it gives. */
export type SeenOffer = Offer & { rate: number }

/** What an offer wants for one unit it gives. */
export const offerRate = (o: Pick<Offer, 'givesUnits' | 'wantsUnits'>) =>
  o.wantsUnits / o.givesUnits

/** An offer as anyone in sight sees it. */
export const seenOffer = (o: Offer): SeenOffer => ({ ...o, rate: offerRate(o) })

/** The offers standing at a storage, oldest first. */
export function offersAt(world: Pick<WorldState, 'offers'>, storageId: string): Offer[] {
  return world.offers.filter((o) => o.storageId === storageId)
}

/** The goods its offers set aside at a storage. */
export function setAsideAt(world: Pick<WorldState, 'offers'>, storageId: string): Stock {
  const aside: Stock = {}
  for (const o of offersAt(world, storageId)) {
    aside[o.gives] = (aside[o.gives] ?? 0) + o.times * o.givesUnits
  }
  return aside
}

/**
 * The goods of a storage that aren't set aside for its offers: what workers, builders, Fetch,
 * pick-ups and refills may take (`CONTEXT.md`: Offer). Only to read: without offers it is the
 * stock itself.
 */
export function freeStock(
  world: Pick<WorldState, 'offers'>,
  storage: Pick<Building, 'id' | 'stock'>,
): Stock {
  const stock = storage.stock ?? {}
  if (world.offers.length === 0) return stock
  const aside = setAsideAt(world, storage.id)
  const goods = Object.keys(aside) as Good[]
  if (goods.length === 0) return stock
  const free: Stock = { ...stock }
  for (const good of goods) {
    const left = (stock[good] ?? 0) - aside[good]!
    if (left > 0) free[good] = left
    else delete free[good]
  }
  return free
}

/** The finished storage `storageId` if it is the realm's: where the realm can post an offer. */
export function offerStorage(
  world: Pick<WorldState, 'buildings' | 'cities'>,
  realmId: string,
  storageId: unknown,
): Building | undefined {
  const b = world.buildings.find((x) => x.id === storageId)
  return b?.kind === 'storage' && !b.site && buildingRealm(world, b) === realmId ? b : undefined
}

/** The input of an order that posts an offer. */
export interface OfferTerms {
  storageId: unknown
  gives: unknown
  givesUnits: unknown
  wants: unknown
  wantsUnits: unknown
  times: unknown
}

const isGood = (g: unknown): g is Good => (GOODS as readonly unknown[]).includes(g)
const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0

/**
 * How many times over an offer of `givesUnits` a time can be posted at a storage, of the `times`
 * asked for: as many as there are goods not yet set aside.
 */
export function timesToPost(
  world: Pick<WorldState, 'offers'>,
  storage: Pick<Building, 'id' | 'stock'>,
  gives: Good,
  givesUnits: number,
  times: number,
): number {
  return Math.min(times, Math.floor((freeStock(world, storage)[gives] ?? 0) / givesUnits))
}

/**
 * Why `realmId` can't post an offer on these terms, or undefined when it can (`CONTEXT.md`:
 * Offer): at a finished storage of its own, a good for a different good, in whole positive units,
 * with the goods for it once there and not already set aside.
 */
export function postOfferProblem(
  world: Pick<WorldState, 'buildings' | 'cities' | 'offers'>,
  realmId: string,
  terms: OfferTerms,
): string | undefined {
  const storage = offerStorage(world, realmId, terms.storageId)
  if (!storage) return 'not a finished storage of yours'
  if (!isGood(terms.gives) || !isGood(terms.wants)) return 'gives and wants must be goods'
  if (terms.gives === terms.wants) return 'an offer wants a different good than it gives'
  if (!isCount(terms.givesUnits) || !isCount(terms.wantsUnits) || !isCount(terms.times)) {
    return 'units and times must be whole numbers'
  }
  if (timesToPost(world, storage, terms.gives, terms.givesUnits, terms.times) === 0) {
    return 'not enough of that good here that isn’t set aside'
  }
  return undefined
}

/**
 * Whether `side` may accept an offer, its own aside: anyone, unless it is a Direct offer to another
 * realm (`CONTEXT.md`: Direct offer). What goes looking for offers to take asks this first.
 */
export const offerOpenTo = (o: Pick<Offer, 'direct'>, side: string): boolean =>
  !o.direct || o.direct.toId === side

/** What accepting an offer moves: `times` over, `gives` to the trader and `wants` from them. */
export interface OfferQuote {
  times: number
  gives: number
  wants: number
  /** What cut it short of the times wanted, if anything did. */
  limit?: TradeLimit
}

/**
 * What accepting an offer up to `wanted` times moves (`CONTEXT.md`: Offer): as many times as it
 * still stands (`available` units of what it gives are in the storage), as the trader can pay, and
 * as fits them, what they hand over making room. Pure: nothing moves.
 */
export function quoteOffer(
  offer: Pick<Offer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>,
  holder: TradeHolder,
  wanted: number,
  available = Infinity,
): OfferQuote {
  const left = Math.min(offer.times, Math.floor(available / offer.givesUnits))
  const paid = Math.floor((holder.stock[offer.wants] ?? 0) / offer.wantsUnits)
  const gain =
    offer.givesUnits * GOOD_WEIGHT[offer.gives] - offer.wantsUnits * GOOD_WEIGHT[offer.wants]
  const fits = gain > 0 ? Math.floor((Math.max(0, holder.room) + 1e-9) / gain) : Infinity
  const times = Math.min(wanted, left, paid, fits)
  const quote = { times, gives: times * offer.givesUnits, wants: times * offer.wantsUnits }
  if (times === wanted) return quote
  if (times === left) return { ...quote, limit: 'stock' }
  if (times === paid) return { ...quote, limit: offer.wants === 'coins' ? 'coins' : 'held' }
  return { ...quote, limit: 'room' }
}

/**
 * Why `resident` of `side` can't accept an offer, or undefined when they can (`CONTEXT.md`: Offer):
 * they are grown up and on its storage's tile, it isn't their own side's or a Direct offer to
 * another realm, `times` is whole and positive, and they hold something to pay with in their hands
 * or on `carriageId`, a carriage on the tile that `side` commands.
 */
export function acceptOfferProblem(
  world: Pick<WorldState, 'offers' | 'buildings' | 'carriages' | 'alliances' | 'tick'>,
  side: string,
  resident: Resident,
  offerId: unknown,
  times: unknown,
  carriageId: unknown,
): string | undefined {
  const offer = world.offers.find((o) => o.id === offerId)
  if (!offer) return 'that offer is gone'
  if (offer.realmId === side) return 'that offer is your own'
  if (!offerOpenTo(offer, side)) return 'that offer is for another realm'
  if (!canWork(resident, world.tick)) return 'children can’t trade'
  const storage = world.buildings.find((b) => b.id === offer.storageId)
  if (!storage || !covers(storage, resident.x, resident.y)) return 'not at that offer’s storage'
  if (!isCount(times)) return 'times must be a whole number'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, side, k)) return 'not one of your carriages'
    if (!isAt(k, storage)) return 'that carriage is not at the storage'
    stock = k.load
  }
  if ((stock[offer.wants] ?? 0) < offer.wantsUnits) return 'not enough to pay for it even once'
  return undefined
}
