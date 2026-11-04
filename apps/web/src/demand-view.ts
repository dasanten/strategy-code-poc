import type { DemandTerms, DemandView, Good, SeenCity } from '@csp/shared'
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
