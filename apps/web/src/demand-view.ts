import { GOODS } from './shared/world.js'
import { TRADE_ORG } from './shared/trade-org.js'
import { goodsToHandOver, transferLoadsFee } from './shared/demand.js'
import type { DemandTerms, DemandView, Good, RealmLabel, SeenCity, Stock } from '@csp/shared-types'
import type { LastSeenCity } from './last-seen.js'
import { goodsLine } from './realm-log.js'

/** What a demand asks for, in words: a city's name, or "5 Food, 20 Coins". */
export function termsLine(terms: DemandTerms): string {
  return terms.kind === 'city' ? terms.cityName : goodsLine(terms.goods)
}

/** Who sent a demand, as the one it was sent to reads it. */
export const senderLine = (from: RealmLabel) =>
  from.realmId === TRADE_ORG ? 'The Trade Organization' : `The realm of ${from.realm}`

/** Whether the game answers demands sent to this side: an NPC city or the Trade Organization. */
export const answersByGame = (org: RealmLabel) => org.city === true || org.realmId === TRADE_ORG

/** What was demanded of whom, as the one who sent it reads it, waiting for the answer. */
export function sentLine(d: Pick<DemandView, 'to' | 'terms'>): string {
  if (d.to.city && d.terms.kind === 'city') return `${d.to.realm}, to join you`
  const them = answersByGame(d.to) ? d.to.realm : `the realm of ${d.to.realm}`
  return `${termsLine(d.terms)} from ${them}`
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
  const line = `${senderLine(newest.from)} demands ${termsLine(newest.terms)} of you`
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
  if (d.from.realmId === TRADE_ORG) {
    return `Give ${city.name} back to the Trade Organization as a trading post, with those who live there, its horses and carriages? That settles its worth of your debt. This can’t be undone.${last}`
  }
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

/**
 * What setting a demand's goods aside at a storage holding `free` would do. The Trade Organization
 * sends a caravan for them (`CONTEXT.md`: Trade Org debt).
 */
export function setAsidePreview(
  goods: Partial<Record<Good, number>>,
  free: Stock,
  byCaravan = false,
): HandOverPreview {
  return previewFrom(goods, free, (going) =>
    byCaravan
      ? `Sets aside ${goodsLine(going)}. A caravan of the Trade Organization comes to fetch them, for no fee, and what it brings in comes off your debt.`
      : `Sets aside ${goodsLine(going)} for them alone to fetch.`,
  )
}

/**
 * What sending the Coins of the Trade Organization's demand by Transfer from a storage holding `free`
 * would do (`CONTEXT.md`: Trade Org debt). The caravan's warehouse is out of the Player's sight, so
 * the fee isn't known here.
 */
export function debtTransferPreview(
  goods: Partial<Record<Good, number>>,
  free: Stock,
): HandOverPreview {
  return previewFrom(
    goods,
    free,
    (going) =>
      `A Transfer carries ${goodsLine(going)} to its nearest warehouse, where they come off your debt. You pay the caravan’s fee, out of this storage.`,
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
  return citiesKnownAs((c) => c.realmId === realmId, cities, lastSeen)
}

/** The cities the Player knows that `theirs` says yes to: in sight, or last seen so, by name. */
function citiesKnownAs(
  theirs: (c: SeenCity) => boolean,
  cities: readonly SeenCity[],
  lastSeen: readonly LastSeenCity[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const m of lastSeen) if (theirs(m)) seen.set(m.id, m.name)
  for (const c of cities) {
    if (theirs(c)) seen.set(c.id, c.name)
    else seen.delete(c.id)
  }
  return [...seen]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/**
 * The cities the Player can name in a demand sent to this side: an NPC city only itself, the Trade
 * Organization its trading posts and HQ that they know, a realm its cities that they know.
 */
export function citiesToDemandOf(
  to: RealmLabel,
  cities: readonly SeenCity[],
  lastSeen: readonly LastSeenCity[],
): { id: string; name: string }[] {
  if (to.city) return [{ id: to.realmId, name: to.realm }]
  if (to.realmId === TRADE_ORG) return citiesKnownAs((c) => !!c.tradeOrg, cities, lastSeen)
  return knownCitiesOf(to.realmId, cities, lastSeen)
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
