// Ported from packages/shared/src/standing.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { TRADE_ORG } from './trade-org.js'
import type { WorldState } from '@csp/shared-types'

/*
 * Standing (`CONTEXT.md`: Standing): how one Organization regards another, from
 * -`STANDING_RANGE` to +`STANDING_RANGE`, neutral at 0. Queries here are the game API that orders,
 * scripts and the game's own NPC behaviour share (ADR 0002).
 */

/**
 * The Organization an id names for standing: a realm, an NPC city, or the Trade Organization
 * (`TRADE_ORG`), whose cities are all one Organization.
 */
export function standingOrganization(world: Pick<WorldState, 'cities'>, org: string): string {
  return world.cities.some((c) => c.id === org && c.tradeOrg !== undefined) ? TRADE_ORG : org
}

/** How `of` regards `toward` (`CONTEXT.md`: Standing); 0 is neutral, also for an Organization itself. */
export function standingOf(
  world: Pick<WorldState, 'standings' | 'cities'>,
  of: string,
  toward: string,
): number {
  const a = standingOrganization(world, of)
  const b = standingOrganization(world, toward)
  return world.standings.find((s) => s.of === a && s.toward === b)?.value ?? 0
}
