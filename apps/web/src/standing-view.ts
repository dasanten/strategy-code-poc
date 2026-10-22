import type { StandingView } from '@csp/shared'
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
