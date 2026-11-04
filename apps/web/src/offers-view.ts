import {
  GOODS,
  buildingRealm,
  carriageCapacity,
  freeStock,
  handsOf,
  loadOf,
  quoteOffer,
  timesToPost,
  type Carriage,
  type City,
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

/** A good by its name in a sentence, lower case. */
type Labels = Readonly<Record<string, string>>

const amount = (units: number, good: Good, labels: Labels) =>
  `${units} ${labels[good]!.toLowerCase()}`

/** An offer's terms in a line: `Gives 10 wood, wants 5 stone`. */
export function offerTerms(
  o: Pick<SeenOffer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits'>,
  labels: Labels,
): string {
  return `Gives ${amount(o.givesUnits, o.gives, labels)}, wants ${amount(o.wantsUnits, o.wants, labels)}`
}

/** An offer's rate and how long it stands: `2 times left, 0.5 stone for 1 wood`. */
export function offerStands(o: SeenOffer, labels: Labels): string {
  const rate = Math.round(o.rate * 100) / 100
  const left = o.times === 1 ? 'once more' : `${o.times} times left`
  return `${left}, ${rate} ${labels[o.wants]!.toLowerCase()} for 1 ${labels[o.gives]!.toLowerCase()}`
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
  const moved = `${amount(quote.gives, offer.gives, labels)} for ${amount(quote.wants, offer.wants, labels)}`
  return { quote, text: `Takes ${moved}${why ? ` (${why})` : ''}.` }
}
