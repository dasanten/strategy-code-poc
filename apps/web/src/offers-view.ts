import {
  GOODS,
  buildingRealm,
  carriageCapacity,
  carriedFeesOver,
  freeStock,
  handsOf,
  loadOf,
  offerOpenTo,
  quoteOffer,
  timesToPost,
  transferLoad,
  wantsNothing,
  type CarriedFeeBy,
  type CarriedWay,
  type Carriage,
  type City,
  type DirectOfferView,
  type Good,
  type OfferQuote,
  type Resident,
  type SeenBuilding,
  type SeenOffer,
  type Stock,
  type TradeHolder,
  type TradeLimit,
} from '@csp/shared'

/** What is needed of the world to reckon with the offers the Player sees. */
type Seen = { cities: readonly Pick<City, 'id' | 'realmId'>[]; buildings: SeenBuilding[] }

/**
 * The storages of a city to show offers at in its trade section (`CONTEXT.md`: Offer): every
 * finished storage of the Player's own, where they can post one, and those of another realm in
 * sight with an offer standing. An NPC city posts none.
 */
export function offerStoragesOf(
  city: Pick<City, 'id'>,
  seen: Seen,
  realmId: string,
): SeenBuilding[] {
  return offerStoragesIn(city.id, seen, realmId)
}

/** The same for storages of no city (`CONTEXT.md`: Outpost storage). */
export function outpostOfferStorages(seen: Seen, realmId: string): SeenBuilding[] {
  return offerStoragesIn(null, seen, realmId)
}

function offerStoragesIn(cityId: string | null, seen: Seen, realmId: string): SeenBuilding[] {
  return seen.buildings.filter(
    (b) =>
      b.cityId === cityId &&
      b.kind === 'storage' &&
      !b.site &&
      (buildingRealm(seen, b) === realmId || (b.offers?.length ?? 0) > 0),
  )
}

/** The finished storages of the Player's own: where a Direct offer can set goods aside. */
export function ownStorages(seen: Seen, realmId: string): SeenBuilding[] {
  return seen.buildings.filter(
    (b) => b.kind === 'storage' && !b.site && buildingRealm(seen, b) === realmId,
  )
}

/** The Direct offers the realm sent, waiting for an answer, oldest first. */
export function directOffersSent(
  offers: readonly DirectOfferView[],
  realmId: string,
): DirectOfferView[] {
  return offers.filter((o) => o.from.realmId === realmId)
}

/** Where a Direct offer stands, in a sentence: `the storage at (6, 6) in Oakford`. */
export function offerPlace(o: Pick<DirectOfferView, 'x' | 'y' | 'city'>): string {
  return `the storage at (${o.x}, ${o.y})${o.city ? ` in ${o.city}` : ''}`
}

/**
 * What the Player sees of who a Direct offer at a storage is for, undefined for an offer to anyone
 * (`CONTEXT.md`: Direct offer).
 */
export function offerIsFor(
  o: Pick<SeenOffer, 'realmId' | 'direct'>,
  realmId: string,
): string | undefined {
  if (!o.direct) return undefined
  if (o.realmId === realmId) return 'A direct offer you sent'
  return offerOpenTo(o, realmId) ? 'A direct offer to you' : 'Only for another realm'
}

/** A good by its name in a sentence, lower case. */
type Labels = Readonly<Record<string, string>>

const amount = (units: number, good: Good, labels: Labels) =>
  `${units} ${labels[good]!.toLowerCase()}`

/**
 * An offer's terms in a line: `Gives 10 wood, wants 5 stone`. Goods set aside on accepting a demand
 * want nothing back (`CONTEXT.md`: Demand), and all of what is left shows: `Gives 5 food, wants nothing`.
 */
export function offerTerms(
  o: Pick<SeenOffer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits'> &
    Partial<Pick<SeenOffer, 'times'>>,
  labels: Labels,
): string {
  if (wantsNothing(o)) {
    return `Gives ${amount(o.givesUnits * (o.times ?? 1), o.gives, labels)}, wants nothing`
  }
  return `Gives ${amount(o.givesUnits, o.gives, labels)}, wants ${amount(o.wantsUnits, o.wants, labels)}`
}

/**
 * An offer's rate and how long it stands: `2 times left, 0.5 stone for 1 wood`. What wants nothing
 * back has no rate, and is there to fetch.
 */
export function offerStands(o: SeenOffer, labels: Labels): string {
  if (wantsNothing(o)) return `${amount(o.times * o.givesUnits, o.gives, labels)} left to fetch`
  const rate = Math.round(o.rate * 100) / 100
  const left = o.times === 1 ? 'once more' : `${o.times} times left`
  return `${left}, ${rate} ${labels[o.wants]!.toLowerCase()} for 1 ${labels[o.gives]!.toLowerCase()}`
}

/**
 * A carried Direct offer's whole terms, taken at once: `Gives 20 wood, wants 10 stone, carried`
 * (`CONTEXT.md`: Direct offer).
 */
export function carriedLine(
  o: Pick<SeenOffer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>,
  labels: Labels,
): string {
  const whole = { ...o, givesUnits: o.givesUnits * o.times, wantsUnits: o.wantsUnits * o.times }
  return `${offerTerms(whole, labels)}, carried`
}

/** A carried Direct offer's way and who pays what, from `realmId`'s side, in a sentence. */
export function carriedDetails(o: DirectOfferView, realmId: string): string {
  const c = o.direct.carried!
  const own = o.from.realmId === realmId ? c.senderFee : c.otherFee
  const theirs = o.from.realmId === realmId ? c.otherFee : c.senderFee
  const fee =
    c.feeBy === 'sender'
      ? `Paid by the sender: ${c.senderFee} coins`
      : `Split: ${own} coins from you, ${theirs} from them`
  return `By caravan between ${o.city} and ${o.toCity}, taking what is there up to what was agreed. ${fee}, for all of the goods.`
}

/** What the sender would see before sending a carried Direct offer, and whether it can go. */
export function carriedPreview(
  way: CarriedWay | undefined,
  feeBy: CarriedFeeBy,
  goods: {
    gives: Good
    givesUnits: number
    wants: Good
    wantsUnits: number
    times: number
  },
  labels: Labels,
): { text: string; canPost: boolean } {
  const { gives, wants, givesUnits, wantsUnits, times } = goods
  const whole = [givesUnits, wantsUnits, times].every((n) => Number.isInteger(n) && n > 0)
  if (!whole) return { text: 'Units and times must be whole numbers.', canPost: false }
  if (gives === wants) return { text: 'An offer wants a different good.', canPost: false }
  if (givesUnits * times > transferLoad(gives) || wantsUnits * times > transferLoad(wants)) {
    return { text: 'Each side’s goods must fit one carriage load.', canPost: false }
  }
  if (!way) return { text: 'No Trade Org warehouse can send a caravan there.', canPost: false }
  const fees = carriedFeesOver(way, feeBy, goods)
  const fee =
    feeBy === 'sender'
      ? `You pay ${fees.senderFee} coins, for all of the goods.`
      : `You pay ${fees.senderFee} coins and they pay ${fees.otherFee}, for all of the goods.`
  const line = `Gives ${amount(givesUnits * times, gives, labels)}, wants ${amount(wantsUnits * times, wants, labels)}`
  return { text: `${line}. ${fee} Nothing is set aside.`, canPost: true }
}

/** The goods set aside for a storage's offers as a line, undefined with none. */
export function setAsideLine(b: Pick<SeenBuilding, 'offers'>, labels: Labels): string | undefined {
  const aside: Stock = {}
  for (const o of b.offers ?? []) aside[o.gives] = (aside[o.gives] ?? 0) + o.times * o.givesUnits
  const parts = GOODS.filter((g) => (aside[g] ?? 0) > 0).map((g) => amount(aside[g]!, g, labels))
  return parts.length > 0 ? `Set aside for offers: ${parts.join(', ')}` : undefined
}

/** What the Player's own side can still post at a storage: its goods not set aside. */
export function freeAtStorage(b: SeenBuilding): Stock {
  return freeStock({ offers: b.offers ?? [] }, b)
}

/** What posting these terms would set aside, in a line; says why not when it can't go. */
export function postPreview(
  b: SeenBuilding,
  gives: Good,
  givesUnits: number,
  wants: Good,
  wantsUnits: number,
  times: number,
  labels: Labels,
): { text: string; canPost: boolean } {
  const whole = [givesUnits, wantsUnits, times].every((n) => Number.isInteger(n) && n > 0)
  if (!whole) return { text: 'Units and times must be whole numbers.', canPost: false }
  if (gives === wants) return { text: 'An offer wants a different good.', canPost: false }
  const can = timesToPost({ offers: b.offers ?? [] }, b, gives, givesUnits, times)
  if (can === 0) {
    return {
      text: `Not enough ${labels[gives]!.toLowerCase()} here not set aside.`,
      canPost: false,
    }
  }
  const over = can === 1 ? 'once' : `${can} times over`
  return {
    text: `Sets aside ${amount(can * givesUnits, gives, labels)}: ${offerTerms({ gives, givesUnits, wants, wantsUnits }, labels).toLowerCase()}, ${over}.`,
    canPost: true,
  }
}

/** What a trader trades an offer with: a resident's hands, or their carriage. */
function holderFor(
  resident: Resident,
  carriage: Carriage | undefined,
  tick: number,
  horses: Parameters<typeof carriageCapacity>[0]['horses'],
): TradeHolder {
  return carriage
    ? loadOf(carriage, carriageCapacity({ horses, carriages: [carriage] }, carriage))
    : handsOf(resident, tick)
}

const LIMIT_TEXT: Partial<Record<TradeLimit, (wants: string) => string>> = {
  held: (wants) => `not enough ${wants} to pay`,
  coins: () => 'not enough coins to pay',
  room: () => 'no room to carry it',
  stock: () => 'it stands no more times than that',
}

/** What accepting an offer would move for a trader, in a line; says what cuts it. */
export function acceptPreview(
  offer: SeenOffer,
  resident: Resident,
  carriage: Carriage | undefined,
  wanted: number,
  tick: number,
  horses: Parameters<typeof carriageCapacity>[0]['horses'],
  labels: Labels,
): { quote: OfferQuote; text: string } {
  const quote = quoteOffer(offer, holderFor(resident, carriage, tick, horses), wanted)
  const wants = labels[offer.wants]!.toLowerCase()
  const why = quote.limit && LIMIT_TEXT[quote.limit]?.(wants)
  if (quote.times === 0) return { quote, text: `Won’t go: ${why ?? 'nothing to accept'}.` }
  const moved = wantsNothing(offer)
    ? amount(quote.gives, offer.gives, labels)
    : `${amount(quote.gives, offer.gives, labels)} for ${amount(quote.wants, offer.wants, labels)}`
  return { quote, text: `Takes ${moved}${why ? ` (${why})` : ''}.` }
}
