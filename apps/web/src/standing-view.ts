import {
  TRADE_ORG,
  TRADE_ORG_NAME,
  type City,
  type RealmEvent,
  type SeenBuilding,
  type SeenCity,
  type SeenTrader,
  type StandingMove,
  type StandingView,
  type TraderVisit,
} from '@csp/shared'
import { npcStoragesInSight, traderStopsAt, warehousesInSight } from './city-view.js'
import type { Relationship } from './theme.js'

/** A standing in words (`CONTEXT.md`: Standing), from hostile through neutral to trusted. */
export function standingWord(value: number): string {
  if (value <= -50) return 'hostile'
  if (value <= -10) return 'wary'
  if (value < 10) return 'neutral'
  if (value < 50) return 'friendly'
  return 'trusted'
}

/** A standing as a signed number of points: "+12", "−30", "0". */
export function formatStanding(value: number): string {
  if (value > 0) return `+${value}`
  if (value < 0) return `−${-value}`
  return '0'
}

/** How far a trade moved standing, in points: "+2.4", and "+0.02" for a very small one. */
export function formatMove(by: number): string {
  return `+${by.toFixed(by < 0.1 ? 2 : 1)}`
}

/**
 * The line of the Trade section on standing (`CONTEXT.md`: Trade section): what the Organization a
 * trade here moves it with holds the Player at, and how far the latest trade with it moved it. That
 * is the NPC city with a storage in sight, or the Trade Organization at a warehouse in sight or a
 * wandering trader standing here. None where nobody trades here.
 */
export function tradeStandingLine(
  city: SeenCity,
  seen: { cities: City[]; buildings: SeenBuilding[]; traders?: readonly SeenTrader[] },
  visits: readonly TraderVisit[],
  standings: readonly StandingView[],
  events: readonly RealmEvent[],
): string | undefined {
  const npc = npcStoragesInSight(city, seen).length > 0
  const tradeOrg =
    warehousesInSight(city, seen).length > 0 ||
    traderStopsAt(city, seen.traders ?? [], visits).length > 0
  if (!npc && !tradeOrg) return undefined
  const org = npc ? city.id : TRADE_ORG
  const name = npc ? city.name : TRADE_ORG_NAME
  const value = standings.find((s) => s.org === org)?.theirs ?? 0
  const line = `Standing with ${name}: ${standingWord(value)} ${formatStanding(value)}.`
  const moved = lastTradeMove(events, org)
  return moved ? `${line} Your last trade moved it ${formatMove(moved.by)}.` : line
}

/** How far the latest trade with an Organization moved standing, of those in the realm's log. */
function lastTradeMove(events: readonly RealmEvent[], org: string): StandingMove | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.kind !== 'traded' && e.kind !== 'swapped' && e.kind !== 'offerTaken') continue
    if (e.standing?.org === org) return e.standing
  }
  return undefined
}

/** How an Organization is called in the standing list. */
export function standingName(s: StandingView): string {
  return s.is === 'realm' ? `the realm of ${s.name}` : s.name
}

/**
 * Who an Organization in the standing list is to the Player (ADR 0008: relationship colours). An
 * alliance member is still another realm here: the list is about standing, not the alliance.
 */
export function standingRelationship(s: StandingView): Relationship {
  if (s.is === 'city') return 'npcCity'
  if (s.is === 'tradeOrg') return 'tradeOrg'
  return 'otherRealm'
}
