import {
  GOODS,
  goodsToHandOver,
  transferLoadsFee,
  type DemandTerms,
  type DemandView,
  type Good,
  type SeenCity,
  type Stock,
} from '@csp/shared'
import type { LastSeenCity } from './last-seen.js'
import { goodsLine } from './realm-log.js'

/** What a demand asks for, in words: a city's name, or "5 Food, 20 Coins". */
export function termsLine(terms: DemandTerms): string {
  return terms.kind === 'city' ? terms.cityName : goodsLine(terms.goods)
}

/** The demands sent to the realm, and those it sent, each oldest first. */
export function demandSides(
  demands: readonly DemandView[],
  realmId: string,
): { incoming: DemandView[]; sent: DemandView[] } {
  return {
    incoming: demands.filter((d) => d.to.realmId === realmId),
    sent: demands.filter((d) => d.from.realmId === realmId),
  }
}

/**
 * What the notice says of the demands sent to the realm that it hasn't put away: the newest, and
 * how many more. Undefined when there are none, or while the Demands drawer is open.
 */
export function demandNoticeLine(
  demands: readonly DemandView[],
  realmId: string,
  putAway: ReadonlySet<string>,
  drawerOpen: boolean,
): string | undefined {
  if (drawerOpen) return undefined
  const fresh = demandSides(demands, realmId).incoming.filter((d) => !putAway.has(d.id))
  const newest = fresh.at(-1)
  if (!newest) return undefined
  const line = `The realm of ${newest.from.realm} demands ${termsLine(newest.terms)} of you`
  return fresh.length === 1 ? line : `${line}, and ${fresh.length - 1} more`
}

/**
 * What to ask before accepting a demand that hands over a city, which can't be taken back, saying
 * so when it is the last of the realm's. Undefined for goods and Coins, and for a city that is no
 * longer the realm's, which the server refuses with its reason.
 */
export function handOverQuestion(
  d: DemandView,
  realmId: string,
  cities: readonly SeenCity[],
): string | undefined {
  const { terms } = d
  if (terms.kind !== 'city') return undefined
  const own = cities.filter((c) => c.realmId === realmId)
  const city = own.find((c) => c.id === terms.cityId)
  if (!city) return undefined
  const last = own.length === 1 ? ' It is your last city.' : ''
  return `Hand ${city.name} over to the realm of ${d.from.realm}, with those who live there, its horses and carriages? This can’t be undone.${last}`
}

/** What the storage holds of what was demanded, where it holds too little: `3 of 5 Food`. */
function shortLine(goods: Partial<Record<Good, number>>, going: Stock): string {
  return GOODS.filter((g) => (going[g] ?? 0) < (goods[g] ?? 0))
    .map((g) => `${going[g] ?? 0} of ${goodsLine({ [g]: goods[g] })}`)
    .join(', ')
}

/** What the Player reads before accepting a demand for goods, and whether it can go. */
export interface HandOverPreview {
  text: string
  canAccept: boolean
}

/**
 * What goes from a storage holding `free` for a demand, said before accepting (`CONTEXT.md`:
 * Demand): undefined when none of it is there. `line` says what is done with what goes.
 */
function previewFrom(
  goods: Partial<Record<Good, number>>,
  free: Stock,
  line: (going: Stock) => string,
): HandOverPreview {
  const going = goodsToHandOver(goods, free)
  if (Object.keys(going).length === 0) {
    return { text: 'This storage holds none of it that isn’t set aside.', canAccept: false }
  }
  const short = shortLine(goods, going)
  return {
    text: short ? `This storage is short: only ${short}. ${line(going)}` : line(going),
    canAccept: true,
  }
}

/** What setting a demand's goods aside at a storage holding `free` would do. */
export function setAsidePreview(
  goods: Partial<Record<Good, number>>,
  free: Stock,
): HandOverPreview {
  return previewFrom(
    goods,
    free,
    (going) => `Sets aside ${goodsLine(going)} for them alone to fetch.`,
  )
}

/**
 * What sending a demand's goods by Transfer from a storage holding `free` would do, over a whole way
 * of `tiles` (undefined when no caravan's way there is known), with the fee the Player pays.
 */
export function transferPreview(
  goods: Partial<Record<Good, number>>,
  free: Stock,
  tiles: number | undefined,
): HandOverPreview {
  if (tiles === undefined) {
    return { text: 'No Trade Org warehouse can send a caravan there.', canAccept: false }
  }
  let coinsShort = false
  const preview = previewFrom(goods, free, (going) => {
    const fee = transferLoadsFee(going, tiles)
    coinsShort = fee + (going.coins ?? 0) > (free.coins ?? 0)
    return `A Transfer carries ${goodsLine(going)}. You pay ${fee} coins.`
  })
  if (!coinsShort) return preview
  return {
    ...preview,
    text: `${preview.text} The storage is short of coins for that, so the caravans take less.`,
  }
}

/**
 * The cities the Player knows of a realm, for naming one in a demand: those in sight, and those
 * they last saw as that realm's, by name.
 */
export function knownCitiesOf(
  realmId: string,
  cities: readonly SeenCity[],
  lastSeen: readonly LastSeenCity[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const m of lastSeen) if (m.realmId === realmId) seen.set(m.id, m.name)
  for (const c of cities) {
    if (c.realmId === realmId) seen.set(c.id, c.name)
    else seen.delete(c.id)
  }
  return [...seen]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** One line of goods on the Demands form; `units` is what the field holds. */
export interface GoodsLine {
  good: Good
  units: number
}

/** The form's lines as a demand's goods, adding up a good named twice; none that are not whole. */
export function goodsOfLines(lines: readonly GoodsLine[]): Partial<Record<Good, number>> {
  const goods: Partial<Record<Good, number>> = {}
  for (const { good, units } of lines) {
    if (Number.isSafeInteger(units) && units > 0) goods[good] = (goods[good] ?? 0) + units
  }
  return goods
}
