import {
  STANDING_DRIFT_PER_DAY,
  STANDING_RANGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  standingInRange,
  standingOrganization,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * Standing (`CONTEXT.md`: Standing): how one Organization regards another. Known crimes lower the
 * victim's standing toward the culprit's Organization (`stepCrimes`); trades at a Trade Org
 * warehouse (`resolveTrades`) and paid contract weeks (`payInto`) raise it both ways; a contract
 * broken by an unpaid week lowers the lender's toward the hirer (`stepContracts`). Every day it
 * drifts back toward neutral. For Players it is shown only; the game acts on it for NPC cities
 * and the Trade Organization.
 */

/**
 * Changes how `of` regards `toward` by `delta`, kept within its range. Nothing happens between an
 * Organization and itself. A standing back at neutral is dropped.
 */
export function changeStanding(world: WorldState, of: string, toward: string, delta: number): void {
  const a = standingOrganization(world, of)
  const b = standingOrganization(world, toward)
  if (a === b || delta === 0) return
  const s = world.standings.find((x) => x.of === a && x.toward === b)
  const value = Math.max(-STANDING_RANGE, Math.min(STANDING_RANGE, (s?.value ?? 0) + delta))
  if (s) s.value = value
  else world.standings.push({ of: a, toward: b, value })
  if (value === 0) world.standings = world.standings.filter((x) => x.value !== 0)
}

/** Raises standing by `delta` both ways between two Organizations. */
export function raiseStandingBothWays(
  world: WorldState,
  a: string,
  b: string,
  delta: number,
): void {
  changeStanding(world, a, b, delta)
  changeStanding(world, b, a, delta)
}

/**
 * Whether an Organization still exists: a realm, a city of no realm, or the Trade Organization
 * while it has a city. A city that joined a realm is part of that realm's Organization now.
 */
function organizationExists(world: WorldState, org: string): boolean {
  if (org === TRADE_ORG) return world.cities.some((c) => c.tradeOrg !== undefined)
  return (
    world.realms.some((r) => r.id === org) ||
    world.cities.some((c) => c.id === org && c.realmId === null)
  )
}

/**
 * Standing drifts back toward neutral by `STANDING_DRIFT_PER_DAY` each game day, a little each
 * tick, and is dropped once neutral. Standing of or toward an Organization that is gone (a realm
 * whose Leader died, a city torn down) is dropped too.
 */
export function stepStanding(world: WorldState): void {
  if (world.standings.length === 0) return
  const drift = STANDING_DRIFT_PER_DAY / TICKS_PER_GAME_DAY
  world.standings = world.standings.filter((s) => {
    if (!organizationExists(world, s.of) || !organizationExists(world, s.toward)) return false
    s.value = s.value > 0 ? Math.max(0, s.value - drift) : Math.min(0, s.value + drift)
    return s.value !== 0
  })
}

/**
 * Standing holds together (`CONTEXT.md`: Standing): every value within its range and not
 * neutral, between two different Organizations that exist, the Trade Organization named as one,
 * and at most one standing for each pair.
 */
export const standingsSound: Invariant = {
  name: 'standings-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const seen = new Set<string>()
    for (const s of world.standings ?? []) {
      const ids = [s.of, s.toward]
      const report = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: ids })
      const pair = `${s.of} → ${s.toward}`
      if (!standingInRange(s.value)) report(`standing ${pair} is ${s.value}, out of its range`)
      if (s.value === 0) report(`standing ${pair} is neutral but kept`)
      if (s.of === s.toward) report(`${s.of} has a standing toward itself`)
      for (const org of ids) {
        if (!organizationExists(world, org)) report(`standing ${pair} names ${org}, which is gone`)
        if (standingOrganization(world, org) !== org) {
          report(`standing ${pair} names a Trade Org city instead of the Trade Organization`)
        }
      }
      if (seen.has(pair)) report(`standing ${pair} is kept twice`)
      seen.add(pair)
    }
    return out
  },
}
